/**
 * Outcome of evaluating accumulated evidence against completion criteria.
 */
export type VerificationOutcome =
  | "criteria_satisfied"
  | "criteria_not_satisfied"
  | "inconclusive";

/**
 * Durable record of a cognitive verification judgment (Contract K6).
 */
export interface VajraVerificationRecord {
  readonly id: string;
  readonly missionId: string;
  readonly stepId: string;
  readonly outcome: VerificationOutcome;
  readonly evidenceIds: readonly string[];
  readonly evaluatorNotes?: string | null;
  readonly correlationId: string;
  readonly invocationId: string;
  readonly recordedAt: string;
}

/**
 * Pure factory helper to construct an immutable VajraVerificationRecord.
 */
export function createVajraVerificationRecord(opts: {
  id: string;
  missionId: string;
  stepId: string;
  outcome: VerificationOutcome;
  evidenceIds: readonly string[];
  evaluatorNotes?: string | null;
  correlationId: string;
  invocationId: string;
  recordedAt?: string;
}): VajraVerificationRecord {
  return Object.freeze({
    id: opts.id,
    missionId: opts.missionId,
    stepId: opts.stepId,
    outcome: opts.outcome,
    evidenceIds: Object.freeze([...opts.evidenceIds]),
    evaluatorNotes: opts.evaluatorNotes ?? null,
    correlationId: opts.correlationId,
    invocationId: opts.invocationId,
    recordedAt: opts.recordedAt ?? new Date().toISOString(),
  });
}
