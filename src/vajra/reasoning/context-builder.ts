import { CorrelationMetadata } from "../../contracts/results/result";
import { CognitiveStimulus } from "../types/stimulus";
import { OperationalContext } from "../types/operational-context";
import { VajraMissionRecord } from "../types/mission-record";
import { EpistemicBelief } from "../types/belief";
import { Observation } from "../../contracts/events/observation";
import { KnownCapabilityInfo } from "../types/self-model";
import { SelfModel } from "../self-model/self-model";
import { IGenesisPort, HistoricalMemoryItem } from "../boundaries/genesis-port";
import { IOperationalStateStore } from "../ports/state-store";
import { ReasoningContext } from "./types";

export interface ContextBuilderOptions {
  readonly maxMemories?: number;
  readonly maxObservations?: number;
  readonly maxPayloadBytes?: number;
}

export class ReasoningContextBuilder {
  private readonly maxMemories: number;
  private readonly maxObservations: number;
  private readonly maxPayloadBytes: number;

  constructor(
    private readonly selfModel: SelfModel,
    private readonly genesisPort: IGenesisPort,
    private readonly stateStore?: IOperationalStateStore,
    options?: ContextBuilderOptions,
  ) {
    this.maxMemories = options?.maxMemories ?? 5;
    this.maxObservations = options?.maxObservations ?? 20;
    this.maxPayloadBytes = options?.maxPayloadBytes ?? 32 * 1024; // 32 KB ~ 8,000 tokens
  }

  async buildContext(
    stimulus: CognitiveStimulus,
    correlation: CorrelationMetadata,
    additionalBeliefs?: readonly EpistemicBelief[],
    additionalObservations?: readonly Observation[],
  ): Promise<ReasoningContext> {
    const operationalContext: OperationalContext = this.selfModel.getOperationalContext();
    const selfSnapshot = this.selfModel.getSnapshot();

    // 1. Resolve Active Mission (if any)
    let activeMission: VajraMissionRecord | null = null;
    if (this.stateStore && operationalContext.activeMissionId) {
      activeMission = (await this.stateStore.getMission(operationalContext.activeMissionId)) ?? null;
    }

    // 2. Load and Filter Epistemic Beliefs
    let allBeliefs: EpistemicBelief[] = [];
    if (this.stateStore) {
      allBeliefs = [...(await this.stateStore.loadBeliefs())];
    }
    if (additionalBeliefs) {
      allBeliefs.push(...additionalBeliefs);
    }

    const stimulusText = this.extractStimulusText(stimulus);
    const missionText = activeMission?.objective ?? "";
    const filterTokens = new Set(
      `${stimulusText} ${missionText}`
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(t => t.length > 2),
    );

    const relevantBeliefs = allBeliefs
      .filter(b => {
        // Always include contradicted beliefs
        if (b.verificationState === "CONTRADICTED" || b.contradictingEvidenceIds.length > 0) {
          return true;
        }
        // Match proposition keywords
        const propWords = b.proposition.toLowerCase().split(/\s+/);
        return propWords.some(w => filterTokens.has(w));
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    // 3. Collect Recent Observations
    const now = Date.now();
    const fifteenMinutesMs = 15 * 60 * 1000;
    const observations = (additionalObservations ?? [])
      .filter(obs => {
        const obsTime = new Date(obs.observationTime).getTime();
        return now - obsTime <= fifteenMinutesMs;
      })
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, this.maxObservations);

    // 4. Retrieve GENESIS Context (Memories + User Identity Traits)
    let genesisContext: ReasoningContext["genesisContext"] = undefined;
    try {
      const memoryResult = await this.genesisPort.recallMemories(stimulusText, correlation);
      const traitsResult = await this.genesisPort.getIdentityTraits(correlation);

      let memories: HistoricalMemoryItem[] = [];
      if (memoryResult.ok && memoryResult.value?.memories) {
        memories = [...memoryResult.value.memories]
          .sort((a, b) => b.relevance - a.relevance)
          .slice(0, this.maxMemories)
          .sort((a, b) => a.id.localeCompare(b.id));
      }

      const identityTraits = traitsResult.ok
        ? traitsResult.value
        : { traits: {} };

      genesisContext = Object.freeze({
        memories: Object.freeze(memories),
        identityTraits: Object.freeze(identityTraits),
      });
    } catch {
      // Degrades gracefully if GENESIS port encounters error
      genesisContext = undefined;
    }

    // 5. Available Capabilities (Deterministically Sorted)
    const capabilities: readonly KnownCapabilityInfo[] = Object.freeze(
      [...selfSnapshot.capabilities].sort((a, b) => a.name.localeCompare(b.name)),
    );

    // 6. Build Initial Context Candidate
    let context: ReasoningContext = Object.freeze({
      stimulus: Object.freeze({ ...stimulus }),
      operationalContext: Object.freeze({ ...operationalContext }),
      activeMission: activeMission ? Object.freeze({ ...activeMission }) : null,
      relevantBeliefs: Object.freeze(relevantBeliefs),
      recentObservations: Object.freeze(observations),
      availableCapabilities: capabilities,
      genesisContext,
      selfModelLimits: Object.freeze({
        isDegraded: selfSnapshot.isDegraded,
        degradedReasons: Object.freeze([...selfSnapshot.degradedReasons]),
        knownUnknowns: Object.freeze([...selfSnapshot.knownUnknowns]),
        policyEnvelope: Object.freeze({ ...selfSnapshot.policy }),
      }),
      contextVersion: operationalContext.version,
      assembledAt: new Date().toISOString(),
    });

    // 7. Enforce Size & Token Budget (Prune low-priority items if exceeded)
    context = this.enforceResourceBudget(context);

    return context;
  }

  private extractStimulusText(stimulus: CognitiveStimulus): string {
    if (typeof stimulus.payload === "string") {
      return stimulus.payload;
    }
    if (stimulus.payload && typeof stimulus.payload === "object") {
      const p = stimulus.payload as Record<string, unknown>;
      return String(p.text ?? p.message ?? p.content ?? JSON.stringify(p));
    }
    return stimulus.kind;
  }

  private enforceResourceBudget(ctx: ReasoningContext): ReasoningContext {
    let serialized = JSON.stringify(ctx);
    if (serialized.length <= this.maxPayloadBytes) {
      return ctx;
    }

    // Step A: Prune GENESIS memories if present
    if (ctx.genesisContext && ctx.genesisContext.memories.length > 0) {
      const trimmedMemories = ctx.genesisContext.memories.slice(0, 2);
      ctx = Object.freeze({
        ...ctx,
        genesisContext: Object.freeze({
          ...ctx.genesisContext,
          memories: Object.freeze(trimmedMemories),
        }),
      });
      serialized = JSON.stringify(ctx);
      if (serialized.length <= this.maxPayloadBytes) return ctx;
    }

    // Step B: Prune observations older than 5 minutes
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const prunedObservations = ctx.recentObservations.filter(
      obs => new Date(obs.observationTime).getTime() >= fiveMinutesAgo,
    );

    ctx = Object.freeze({
      ...ctx,
      recentObservations: Object.freeze(prunedObservations),
    });

    return ctx;
  }
}
