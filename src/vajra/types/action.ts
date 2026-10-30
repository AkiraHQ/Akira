import { CorrelationMetadata } from "../../contracts/results/result";
import { ImpactClass, ReversibilityClass } from "./policy";

/**
 * Discrete operational actions produced by the executive cognitive arbitration.
 */
export type ExecutiveActionKind =
  | "answer_conversation"     // Return an immediate conversational turn to the human
  | "request_clarification"   // Ask user clarifying question (high uncertainty)
  | "request_verification"    // Dispatch observation probe (epistemic conflict)
  | "execute_mission"         // Transition to multi-step mission execution (Phase 2 compat)
  | "start_mission"           // Transition to multi-step mission execution (Phase 6)
  | "escalate_to_human"       // Pause and request explicit human authorization (Contract K1)
  | "disagree_and_counter"    // Initiate Disagreement Protocol with evidence
  | "wait_and_observe"        // Await external event, telemetry, or pending step result
  | "proactive_notification"  // Dispatch a non-intrusive proactive notification
  | "reject_safety_violation";// Hard refusal of prohibited or destructive directive

/**
 * Lifecycle status of human approval gating for an executive action.
 */
export type DecisionApprovalState =
  | "NONE_REQUIRED"
  | "APPROVAL_REQUIRED"
  | "WAITING_FOR_HUMAN"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "STALE";

/**
 * Concrete executive action produced by VAJRA.
 */
export interface ExecutiveAction<TPayload = unknown> {
  readonly id: string;
  readonly decisionId?: string;
  readonly kind: ExecutiveActionKind;
  readonly intent?: string;
  readonly authorityLevel?: 1;
  readonly policyBasis?: string;
  readonly policyVersion?: string;
  readonly evidenceBasis?: readonly string[];
  readonly riskClass?: ImpactClass;
  readonly impactClass?: ImpactClass;
  readonly reversibility?: ReversibilityClass;
  readonly requiredCapability?: string;
  readonly approvalState?: DecisionApprovalState;
  readonly escalationId?: string;
  readonly correlation: CorrelationMetadata;
  readonly stateVersion?: number;
  readonly expiry?: string;
  readonly idempotencyKey?: string;
  readonly rationale: string;
  readonly confidence: number;
  readonly policyCompliance: boolean;
  readonly payload?: TPayload;
  readonly decidedAt: string;
}

/**
 * Factory helper to construct an immutable ExecutiveAction.
 */
export function createExecutiveAction<TPayload = unknown>(opts: {
  id: string;
  decisionId?: string;
  kind: ExecutiveActionKind;
  intent?: string;
  authorityLevel?: 1;
  policyBasis?: string;
  policyVersion?: string;
  evidenceBasis?: readonly string[];
  riskClass?: ImpactClass;
  impactClass?: ImpactClass;
  reversibility?: ReversibilityClass;
  requiredCapability?: string;
  approvalState?: DecisionApprovalState;
  escalationId?: string;
  correlation: CorrelationMetadata;
  stateVersion?: number;
  expiry?: string;
  idempotencyKey?: string;
  rationale: string;
  confidence: number;
  policyCompliance: boolean;
  payload?: TPayload;
  decidedAt?: string;
}): ExecutiveAction<TPayload> {
  if (
    typeof opts.confidence !== "number" ||
    Number.isNaN(opts.confidence) ||
    opts.confidence < 0.0 ||
    opts.confidence > 1.0
  ) {
    throw new RangeError(
      `ExecutiveAction confidence must be a finite number in [0.0, 1.0]. Received: ${opts.confidence}`,
    );
  }

  return Object.freeze({
    id: opts.id,
    decisionId: opts.decisionId,
    kind: opts.kind,
    intent: opts.intent,
    authorityLevel: opts.authorityLevel ?? 1,
    policyBasis: opts.policyBasis,
    policyVersion: opts.policyVersion,
    evidenceBasis: opts.evidenceBasis ? Object.freeze([...opts.evidenceBasis]) : undefined,
    riskClass: opts.riskClass,
    impactClass: opts.impactClass,
    reversibility: opts.reversibility,
    requiredCapability: opts.requiredCapability,
    approvalState: opts.approvalState ?? "NONE_REQUIRED",
    escalationId: opts.escalationId,
    correlation: Object.freeze({ ...opts.correlation }),
    stateVersion: opts.stateVersion,
    expiry: opts.expiry,
    idempotencyKey: opts.idempotencyKey,
    rationale: opts.rationale,
    confidence: opts.confidence,
    policyCompliance: opts.policyCompliance,
    payload: opts.payload,
    decidedAt: opts.decidedAt ?? new Date().toISOString(),
  });
}
