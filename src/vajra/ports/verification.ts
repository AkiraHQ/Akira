import { VerificationRecord } from "../../contracts/capabilities/verification";
import { Observation } from "../../contracts/events/observation";
import { CompletionCriteria } from "../../contracts/mission/mission-definition";

/**
 * Architectural Port for the Verification Evaluator (to be implemented in future phases).
 *
 * Evaluates accumulated evidence against completion criteria, producing Contract K6 VerificationRecord.
 */
export interface IVerificationEvaluator {
  evaluateStep(
    stepId: string,
    missionId: string,
    observations: readonly Observation[],
    criteria: CompletionCriteria,
  ): VerificationRecord;
}
