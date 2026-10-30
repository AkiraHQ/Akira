import { ExecutiveActionKind, DecisionApprovalState } from "../types/action";
import { ImpactClass, ReversibilityClass } from "../types/policy";

export { DecisionApprovalState };

/**
 * Canonical classification of decision necessity.
 * Evaluates whether the situation requires an operational action, conversational answer,
 * epistemic verification, human escalation, or a safe hold.
 */
export type DecisionNecessityClass =
  | "NO_ACTION_REQUIRED"           // Stimulus is informational ping; state is nominal
  | "ANSWER_CONVERSATION"          // Direct conversational response to human query
  | "REQUEST_CLARIFICATION"        // Ambiguous intent or missing parameters; ask user
  | "REQUEST_VERIFICATION"         // Contradiction detected; observation probe needed
  | "WAIT_AND_OBSERVE"             // External task in flight; await telemetry or timer
  | "ESCALATE_TO_HUMAN"            // High-impact or irreversible action; mandatory approval
  | "DISAGREE_AND_COUNTERPROPOSE"  // Human intent conflicts with facts; initiate protocol
  | "START_MISSION"                // Multi-step operational objective requiring Phase 6
  | "REJECT_SAFETY_VIOLATION";     // Prohibited action or attempt to breach blast doors

/**
 * A concrete candidate option formulated during decision arbitration.
 */
export interface DecisionOption {
  readonly id: string;
  readonly kind: ExecutiveActionKind;
  readonly intent: string;
  readonly targetCapability?: string;
  readonly estimatedCostCents: number;
  readonly estimatedSteps: number;
  readonly impactClass: ImpactClass;
  readonly reversibility: ReversibilityClass;
  readonly requiredEvidence: readonly string[];
  readonly rationale: string;
  readonly payload?: unknown;
}

/**
 * Hard gate disqualification reasons.
 */
export type EvaluationDisqualificationReason =
  | "PROHIBITED_CAPABILITY"
  | "EXCEEDS_SPEND_CAP"
  | "EXCEEDS_STEP_LIMIT"
  | "CONTRADICTED_PREMISE"
  | "CAPABILITY_UNAVAILABLE"
  | "CAPABILITY_DISALLOWS_VAJRA"
  | "CRITICAL_HEALTH_HALT"
  | "STALE_CONTEXT_VERSION"
  | "ARCHITECTURAL_SAFETY_VIOLATION";

/**
 * Detailed outcome of evaluating a candidate decision option across the 4 evaluation categories.
 */
export interface OptionEvaluationResult {
  readonly option: DecisionOption;
  readonly isDisqualified: boolean;
  readonly disqualificationReason?: EvaluationDisqualificationReason;
  readonly requiresApproval: boolean;
  readonly approvalReason?: string;
  readonly confidence: number;
  readonly policyCompliant: boolean;
  readonly evaluationNotes: readonly string[];
}

/**
 * Disagreement categorization in the Disagreement Protocol.
 */
export type DisagreementType =
  | "PREFERENCE_DISAGREEMENT"       // Human preference differs from optimal; safe override possible
  | "SAFETY_VIOLATION_DISAGREEMENT"; // Human directive breaches absolute safety; override prohibited

/**
 * Canonical payload for the 4-step Disagreement Protocol.
 */
export interface DisagreementPayload {
  readonly type: DisagreementType;
  readonly humanIntentAcknowledged: string;
  readonly disagreementReason: string;
  readonly evidenceCitations: readonly string[];
  readonly counterProposal: DecisionOption;
  readonly alternativeOptions?: readonly DecisionOption[];
}

/**
 * Durable token descriptor bound to human approval escalations (Contract K1).
 */
export interface ApprovalGateDescriptor {
  readonly decisionId: string;
  readonly actionId: string;
  readonly contextVersion: number;
  readonly policyVersion: string;
  readonly capabilityFingerprint?: string;
  readonly scope: string;
  readonly proposedAction: DecisionOption;
  readonly riskExplanation: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}
