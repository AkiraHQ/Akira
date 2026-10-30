import { CorrelationMetadata } from "../results/result";

/**
 * Contract K4 — Observation
 *
 * Per Foundation Contracts §2.4 (K4) and Target Architecture §9.1:
 *
 *   "Here is evidence or state that I observed."
 *
 * An Observation is DISTINCT from:
 *   - Event (K3)  — "something happened" (state change notification, no addressee)
 *   - Query (K2)  — a request for information
 *   - Command (K1) — a request to perform an action
 *   - Result (K5) — the outcome of one invocation, correlated to its requester
 *
 * Key invariants from frozen contracts:
 *   I8  — An Observation is never verification (D7).
 *   I15 — An Event never requests action; an Observation reports evidence to an addressee.
 *
 * Required fields per K4:
 *   - Observation identity
 *   - producer (source: any capability or system — D7)
 *   - subject (what was observed: an entity, an execution, a capability, the user)
 *   - observationTime
 *   - correlation and causation (K19 — §16)
 *   - payload (evidence, state or result information)
 *   - confidence  ← required on EVERY Observation (TA §9.1)
 *   - provenance  ← required on EVERY Observation (TA §9.1); what the evidence was derived from
 *
 * Interaction semantics (K20): fire-and-observe; no response required.
 * Changes state? No — reporting changes nothing in the observed system.
 */
export interface Observation<TPayload = unknown> {
  /** Unique Observation identifier — for deduplication and reference (K19) */
  readonly id: string;

  /**
   * Producer: the capability or system that produced this observation.
   * Typical values: 'GENESIS · Memory', 'HANDS · executor', 'AKIRA OS · runtime'
   * Contract: any capability or system (D7).
   */
  readonly producer: string;

  /**
   * Subject: what was observed.
   * May be an entity id, a capability name, an execution id, or a description
   * of the user/environment being observed.
   */
  readonly subject: string;

  /** ISO-8601 timestamp of the observation (when the evidence was gathered) */
  readonly observationTime: string;

  /**
   * Correlation and causation identifiers per Contract K19 (§16).
   * correlationId — end-to-end trace
   * causationId   — the invocation or event that led to this observation
   * requestId     — the originating request or trigger
   * missionId     — optional; absent for non-mission observations
   * stepId        — optional; the step within a mission plan this serves
   * invocationId  — optional; the Command or Query this is evidence for
   */
  readonly correlation: CorrelationMetadata & {
    readonly missionId?: string;
    readonly stepId?: string;
    readonly executionId?: string;
  };

  /** Causation ID: the immediate cause (invocation or event) that led to this observation */
  readonly causationId: string;

  /** Payload: evidence, state or result information observed */
  readonly payload: TPayload;

  /**
   * Confidence: normalized [0, 1] float representing how confident the producer
   * is in this evidence, when explicitly supplied by the producer.
   * If unstated by the producer, left undefined to prevent synthetic heuristics.
   */
  readonly confidence?: number;

  /**
   * Provenance: human-readable description of what the evidence was derived from.
   * Required on every Observation per TA §9.1.
   * Examples: 'GENESIS memory replay', 'HANDS terminal output capture', 'SQLite task query'
   */
  readonly provenance: string;

  /**
   * isRecommendation: true when this Observation proposes an option with a
   * rationale (per K4 "Recommendations" row). A recommendation is never a Command;
   * the addressee may ignore it.
   */
  readonly isRecommendation?: boolean;
}

/**
 * Factory helper to construct a Contract K4 Observation.
 *
 * Enforces that provenance is always present and confidence (if supplied) is in [0, 1].
 * The produced Observation is immutable once returned.
 */
export function createObservation<TPayload>(opts: {
  producer: string;
  subject: string;
  payload: TPayload;
  confidence?: number;
  provenance: string;
  correlation: CorrelationMetadata & {
    missionId?: string;
    stepId?: string;
    executionId?: string;
  };
  isRecommendation?: boolean;
}): Observation<TPayload> {
  if (opts.confidence !== undefined && (opts.confidence < 0 || opts.confidence > 1)) {
    throw new RangeError(
      `Observation confidence must be in [0, 1]; received ${opts.confidence}`,
    );
  }

  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);

  return Object.freeze({
    id,
    producer: opts.producer,
    subject: opts.subject,
    observationTime: new Date().toISOString(),
    correlation: opts.correlation,
    causationId: opts.correlation.invocationId,
    payload: opts.payload,
    confidence: opts.confidence,
    provenance: opts.provenance,
    isRecommendation: opts.isRecommendation ?? false,
  });
}
