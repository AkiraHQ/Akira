import { CorrelationMetadata } from "../results/result";

/**
 * Contract K6 — Verification Evidence & Mission Result
 *
 * Per Foundation Contracts §2.5 (K6), §16 (K19), and Target Architecture §5.5:
 *
 * Two related primitives are defined here:
 *
 *   VerificationRecord — the evidence VAJRA examined and the judgement it produced
 *   MissionResult      — the mission-level outcome, produced by VAJRA only after verification
 *
 * KEY INVARIANTS from frozen contracts (must never be violated):
 *
 *   I8  — An Observation is never verification (D7).
 *   I9  — Execution is never mission completion. Only VAJRA issues a MissionResult,
 *          and only after verification. (D7; TA §5.5)
 *   I2  — VAJRA is the only cross-system orchestration authority. Only VAJRA
 *          creates a MissionResult. Capability owners, AKIRA OS and GENESIS never do.
 *
 * WHAT THIS IS NOT:
 *   - This is NOT a mission runtime or lifecycle implementation.
 *   - This is NOT a capability execution result (that is K5 Result<T>).
 *   - This is NOT an Event (K3) or Observation (K4).
 *   - This does NOT implement the VAJRA orchestration loop.
 *   - Persistence of VerificationRecord is NOT decided (K15 §22.3); these are
 *     pure contract types, not persistence entities.
 */

// ---------------------------------------------------------------------------
// VerificationRecord (K6 evidence side)
// ---------------------------------------------------------------------------

/**
 * The outcome of one verification judgement by VAJRA.
 * Lists the evidence IDs it relied on (Execution Result IDs and Observation IDs).
 * Whether verification records are persisted is OPEN (K15 §22.3); the type exists
 * regardless.
 *
 * Per K19 §16:
 *   "Verification record id — One verification judgement, listing the evidence ids
 *    it relied on (conceptual; whether it is persisted is not decided, K15)"
 */
export type VerificationOutcome =
  | "criteria_satisfied"     // Completion criteria are met → produces a successful MissionResult
  | "criteria_not_satisfied" // Evidence is insufficient or contradicts criteria
  | "inconclusive";          // Evidence is missing or indeterminate (K18 "observation failure")

export interface VerificationRecord {
  /** Unique identifier for this verification judgement (K19) */
  readonly id: string;

  /**
   * Mission identifier this verification belongs to.
   * Stable for the life of the Mission (K19 §16).
   */
  readonly missionId: string;

  /**
   * Step identifier within the mission plan that triggered this verification.
   * Optional: some verification passes are mission-wide rather than per-step.
   */
  readonly stepId?: string;

  /**
   * Execution Result IDs (K5) that constituted evidence in this judgement.
   * A succeeded ExecutionResult is evidence for verification — never a MissionResult (D7).
   */
  readonly executionResultIds: readonly string[];

  /**
   * Observation IDs (K4) that constituted evidence in this judgement.
   * Observations are evidence only; an Observation never satisfies a completion
   * criterion by itself (K4 "Force"; I8).
   */
  readonly observationIds: readonly string[];

  /**
   * The verification outcome — what VAJRA concluded after examining the evidence
   * against the mission's completion criteria.
   */
  readonly outcome: VerificationOutcome;

  /**
   * Human-readable rationale for the outcome.
   * Useful for escalation, debugging, and mission state history.
   */
  readonly rationale: string;

  /** ISO-8601 timestamp of when this verification judgement was made */
  readonly verifiedAt: string;

  /** Correlation metadata per K19 (§16) */
  readonly correlation: CorrelationMetadata & {
    readonly missionId: string;
    readonly stepId?: string;
  };
}

// ---------------------------------------------------------------------------
// MissionResult (K6 mission outcome)
// ---------------------------------------------------------------------------

/**
 * The mission-level outcome.
 *
 * Per K6:
 *   "A successful Mission Result means VAJRA verified that the mission's
 *    completion criteria were satisfied."
 *   "VAJRA only, and only after verification."
 *
 * This is DISTINCT from Execution Result (K5):
 *   - K5 Result<T> is the outcome of ONE Command or Query, addressed back to the requester.
 *   - K6 MissionResult is the verified outcome of an ENTIRE Mission.
 *
 * Status: The contract specifies two terminal categories:
 *   - "completed" — completion criteria verified satisfied (TA §5.5)
 *   - "not_completed" — mission that does not complete (failure, TA §13.1); NOT a successful MissionResult
 *
 * Termination semantics beyond these two (e.g. cancellation) are NOT decided (§22.3).
 * No additional statuses are introduced here.
 */
export type MissionOutcomeStatus =
  | "completed"      // Verified successful: VAJRA confirmed completion criteria satisfied
  | "not_completed"; // Not a successful MissionResult: failed, or criteria not satisfied

export interface MissionResult<TOutcome = unknown> {
  /** Unique identifier of this MissionResult instance */
  readonly id: string;

  /**
   * Mission identifier this result belongs to.
   * Stable for the life of the Mission (K19 §16).
   */
  readonly missionId: string;

  /**
   * Goal identifier, if this mission serves a Goal.
   * Optional: "A Mission does not require a long-lived Goal" (TA §6 DECISION).
   */
  readonly goalId?: string;

  /** Terminal mission outcome status */
  readonly status: MissionOutcomeStatus;

  /**
   * The verification record that produced this outcome.
   * A MissionResult is based on evidence listed in its verification record (K6).
   * Only present when status is "completed" (criteria were satisfied).
   */
  readonly verificationRecordId: string;

  /**
   * Mission-level outcome payload.
   * Concrete shape is OPEN (TA §20.3 "Mission schema OPEN"); no schema is fixed here.
   * The payload carries whatever the mission produced, typed by the generic parameter.
   */
  readonly outcome: TOutcome;

  /** ISO-8601 timestamp of when this MissionResult was produced by VAJRA */
  readonly producedAt: string;

  /** Correlation metadata per K19, carrying the full trace from the originating request */
  readonly correlation: CorrelationMetadata & {
    readonly missionId: string;
    readonly goalId?: string;
    readonly verificationRecordId: string;
  };
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Constructs a VerificationRecord after VAJRA evaluates evidence against
 * a mission's completion criteria.
 *
 * CONTRACT: Only VAJRA calls this. No capability owner, AKIRA OS, or GENESIS
 * may construct a VerificationRecord (I2, I9).
 */
export function createVerificationRecord(opts: {
  missionId: string;
  stepId?: string;
  executionResultIds: string[];
  observationIds: string[];
  outcome: VerificationOutcome;
  rationale: string;
  correlation: CorrelationMetadata & { missionId: string; stepId?: string };
}): VerificationRecord {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);

  return Object.freeze({
    id,
    missionId: opts.missionId,
    stepId: opts.stepId,
    executionResultIds: Object.freeze([...opts.executionResultIds]),
    observationIds: Object.freeze([...opts.observationIds]),
    outcome: opts.outcome,
    rationale: opts.rationale,
    verifiedAt: new Date().toISOString(),
    correlation: opts.correlation,
  });
}

/**
 * Constructs a MissionResult after VAJRA completes verification.
 *
 * CONTRACT: Only VAJRA calls this. The presence of a VerificationRecord with
 * outcome "criteria_satisfied" is required for status "completed".
 * Any other outcome must produce status "not_completed" (I9).
 */
export function createMissionResult<TOutcome>(opts: {
  missionId: string;
  goalId?: string;
  status: MissionOutcomeStatus;
  verificationRecordId: string;
  outcome: TOutcome;
  correlation: CorrelationMetadata & {
    missionId: string;
    goalId?: string;
    verificationRecordId: string;
  };
}): MissionResult<TOutcome> {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);

  return Object.freeze({
    id,
    missionId: opts.missionId,
    goalId: opts.goalId,
    status: opts.status,
    verificationRecordId: opts.verificationRecordId,
    outcome: opts.outcome,
    producedAt: new Date().toISOString(),
    correlation: opts.correlation,
  });
}
