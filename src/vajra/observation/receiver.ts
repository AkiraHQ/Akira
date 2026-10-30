import { IObservationReceiver } from "../ports/observation";
import { Observation, createObservation } from "../../contracts/events/observation";
import { ObservationFilter, NormalizeExecutionOptions, ObservationPoolStats } from "./types";

/**
 * Concrete Observation Receiver implementing IObservationReceiver.
 *
 * Responsibilities:
 * - Standardizes raw execution results into Contract K4 Observation envelopes.
 * - Enforces zero wall-clock execution identity generation (reusing canonical Phase 6 identities).
 * - Preserves producer-supplied confidence in [0, 1] without inventing epistemic heuristics.
 * - Indexes observations in an in-memory session pool by missionId and stepId.
 * - Deduplicates incoming observations via an LRU-bounded identity set.
 */
export class ObservationReceiver implements IObservationReceiver {
  private readonly observationsById = new Map<string, Observation>();
  private readonly observationsByMission = new Map<string, Set<string>>();
  private readonly observationsByStep = new Map<string, Set<string>>();
  private readonly ingestedIdLru: string[] = [];
  private readonly maxLruCapacity: number;

  constructor(maxLruCapacity: number = 10000) {
    this.maxLruCapacity = maxLruCapacity;
  }

  /**
   * Ingests a Contract K4 Observation into the in-memory pool.
   * Silently ignores duplicate observation IDs (idempotent ingestion).
   */
  ingestObservation<T = unknown>(observation: Observation<T>): void {
    if (!observation || !observation.id) {
      return;
    }

    // Deduplication check
    if (this.observationsById.has(observation.id)) {
      return;
    }

    // Track in LRU cache
    this.ingestedIdLru.push(observation.id);
    if (this.ingestedIdLru.length > this.maxLruCapacity) {
      const evictedId = this.ingestedIdLru.shift();
      if (evictedId) {
        this.evictObservation(evictedId);
      }
    }

    // Store in primary index
    this.observationsById.set(observation.id, observation as Observation);

    // Index by missionId
    const missionId = observation.correlation?.missionId;
    if (missionId) {
      let missionSet = this.observationsByMission.get(missionId);
      if (!missionSet) {
        missionSet = new Set<string>();
        this.observationsByMission.set(missionId, missionSet);
      }
      missionSet.add(observation.id);
    }

    // Index by stepId
    const stepId = observation.correlation?.stepId;
    if (stepId) {
      let stepSet = this.observationsByStep.get(stepId);
      if (!stepSet) {
        stepSet = new Set<string>();
        this.observationsByStep.set(stepId, stepSet);
      }
      stepSet.add(observation.id);
    }
  }

  /**
   * Normalizes a raw execution result into a Contract K4 Observation.
   *
   * INVARIANT (K-P7-16): Strictly reuses the canonical Phase 6 / Contract K19 execution
   * or invocation identity. Wall-clock Date.now() execution ID generation is prohibited.
   */
  normalizeExecutionResult<T>(options: NormalizeExecutionOptions<T>): Observation<T> {
    const canonicalExecutionId =
      options.correlation.executionId ??
      options.executionResultId ??
      options.correlation.invocationId;

    const confidence = this.extractProducerConfidence(options.producerConfidence);

    const provenance =
      options.provenance ??
      `Execution result from capability '${options.targetCapability}' (invocation: ${options.stepId})`;

    const observation = createObservation<T>({
      producer: `capability.${options.targetCapability}`,
      subject: options.stepId,
      payload: options.payload,
      confidence,
      provenance,
      correlation: {
        ...options.correlation,
        requestId: options.correlation.requestId,
        missionId: options.missionId,
        stepId: options.stepId,
        executionId: canonicalExecutionId,
      },
      isRecommendation: options.isRecommendation,
    });

    this.ingestObservation(observation);
    return observation;
  }

  /**
   * Returns all observations recorded for the specified mission ID.
   */
  getObservationsForMission(missionId: string): readonly Observation[] {
    const ids = this.observationsByMission.get(missionId);
    if (!ids) {
      return Object.freeze([]);
    }
    const results: Observation[] = [];
    for (const id of ids) {
      const obs = this.observationsById.get(id);
      if (obs) {
        results.push(obs);
      }
    }
    return Object.freeze(results);
  }

  /**
   * Returns all observations recorded for the specified step ID.
   */
  getObservationsForStep(stepId: string): readonly Observation[] {
    const ids = this.observationsByStep.get(stepId);
    if (!ids) {
      return Object.freeze([]);
    }
    const results: Observation[] = [];
    for (const id of ids) {
      const obs = this.observationsById.get(id);
      if (obs) {
        results.push(obs);
      }
    }
    return Object.freeze(results);
  }

  /**
   * Queries observations matching flexible filter options.
   */
  queryObservations(filter: ObservationFilter): readonly Observation[] {
    let candidatePool: Iterable<Observation>;

    if (filter.stepId) {
      candidatePool = this.getObservationsForStep(filter.stepId);
    } else if (filter.missionId) {
      candidatePool = this.getObservationsForMission(filter.missionId);
    } else {
      candidatePool = this.observationsById.values();
    }

    const filtered: Observation[] = [];
    for (const obs of candidatePool) {
      if (filter.missionId && obs.correlation.missionId !== filter.missionId) {
        continue;
      }
      if (filter.stepId && obs.correlation.stepId !== filter.stepId) {
        continue;
      }
      if (filter.producer && obs.producer !== filter.producer) {
        continue;
      }
      if (filter.subject && obs.subject !== filter.subject) {
        continue;
      }
      if (filter.minObservationTime && obs.observationTime < filter.minObservationTime) {
        continue;
      }
      if (filter.maxObservationTime && obs.observationTime > filter.maxObservationTime) {
        continue;
      }
      if (filter.includeRecommendations === false && obs.isRecommendation) {
        continue;
      }
      filtered.push(obs);
    }

    return Object.freeze(filtered);
  }

  /**
   * Returns summary counts of the in-memory pool.
   */
  getStats(): ObservationPoolStats {
    return {
      totalObservations: this.observationsById.size,
      totalMissionsTracked: this.observationsByMission.size,
      totalStepsTracked: this.observationsByStep.size,
    };
  }

  /**
   * Clears in-memory data for a specific mission.
   */
  clearMission(missionId: string): void {
    const ids = this.observationsByMission.get(missionId);
    if (ids) {
      for (const id of ids) {
        this.evictObservation(id);
      }
      this.observationsByMission.delete(missionId);
    }
  }

  /**
   * Completely clears the in-memory observation session pool.
   */
  clearSession(): void {
    this.observationsById.clear();
    this.observationsByMission.clear();
    this.observationsByStep.clear();
    this.ingestedIdLru.length = 0;
  }

  private evictObservation(id: string): void {
    const obs = this.observationsById.get(id);
    if (obs) {
      this.observationsById.delete(id);
      if (obs.correlation.missionId) {
        this.observationsByMission.get(obs.correlation.missionId)?.delete(id);
      }
      if (obs.correlation.stepId) {
        this.observationsByStep.get(obs.correlation.stepId)?.delete(id);
      }
    }
  }

  /**
   * Validates producer-supplied confidence without inventing synthetic heuristics.
   * If unstated by the producer, returns undefined (no numerical baseline invented).
   */
  private extractProducerConfidence(supplied?: number): number | undefined {
    if (typeof supplied === "number" && !Number.isNaN(supplied)) {
      if (supplied < 0 || supplied > 1) {
        throw new RangeError(`Observation confidence must be in [0, 1]; received ${supplied}`);
      }
      return supplied;
    }
    return undefined;
  }
}
