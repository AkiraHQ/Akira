import { ImpactClass } from "./policy";

/**
 * Status of an escalation frame presented to the human.
 */
export type EscalationStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED";

/**
 * Durable record of an escalation gate requiring human intervention or approval.
 */
export interface VajraEscalationRecord {
  readonly id: string;
  readonly missionId?: string | null;
  readonly stepId?: string | null;
  readonly status: EscalationStatus;
  readonly actionProposed: string;
  readonly impactClass: ImpactClass;
  readonly riskExplanation: string;
  readonly resolutionComment?: string | null;
  readonly requestId: string;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly resolvedAt?: string | null;
}

/**
 * Pure factory helper to construct an immutable VajraEscalationRecord.
 */
export function createVajraEscalationRecord(opts: {
  id: string;
  missionId?: string | null;
  stepId?: string | null;
  status?: EscalationStatus;
  actionProposed: string;
  impactClass: ImpactClass;
  riskExplanation: string;
  resolutionComment?: string | null;
  requestId: string;
  correlationId: string;
  createdAt?: string;
  resolvedAt?: string | null;
}): VajraEscalationRecord {
  return Object.freeze({
    id: opts.id,
    missionId: opts.missionId ?? null,
    stepId: opts.stepId ?? null,
    status: opts.status ?? "PENDING_APPROVAL",
    actionProposed: opts.actionProposed,
    impactClass: opts.impactClass,
    riskExplanation: opts.riskExplanation,
    resolutionComment: opts.resolutionComment ?? null,
    requestId: opts.requestId,
    correlationId: opts.correlationId,
    createdAt: opts.createdAt ?? new Date().toISOString(),
    resolvedAt: opts.resolvedAt ?? null,
  });
}
