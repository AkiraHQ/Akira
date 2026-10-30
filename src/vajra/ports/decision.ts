import { Result, CorrelationMetadata } from "../../contracts/results/result";
import { ExecutiveAction } from "../types/action";
import { PolicyEnvelope } from "../types/policy";
import { ReasoningResult } from "../reasoning/types";
import { OperationalContext } from "../types/operational-context";
import { SelfModel } from "../self-model/self-model";

/**
 * Legacy arbitration candidate from Phase 2 stub (deprecated in Phase 5).
 */
export interface ArbitrationCandidate {
  readonly candidateAction: string;
  readonly riskClass: string;
  readonly expectedOutcome: string;
}

/**
 * Architectural Port for the Decision Arbiter (established in Phase 5).
 *
 * Consumes ReasoningResult, OperationalContext, and SelfModel,
 * formulating and selecting discrete operational pathways (Answer, Mission, Escalate, Wait, Proactive Act).
 */
export interface IDecisionArbiter {
  arbitrate(
    reasoning: ReasoningResult,
    context: OperationalContext,
    selfModel: SelfModel,
    correlation?: CorrelationMetadata,
  ): Promise<Result<ExecutiveAction, string>>;
}
