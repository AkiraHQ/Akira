import { Result, CorrelationMetadata } from "../../contracts/results/result";
import { MissionDefinition, MissionConstraint } from "../../contracts/mission/mission-definition";

/**
 * Architectural Port for the Planning Engine (to be implemented in future phases).
 *
 * Compiles high-level objectives into validated, bounded MissionDefinition instances.
 */
export interface IPlanningEngine {
  createPlan(
    objective: string,
    constraints: MissionConstraint,
    correlation: CorrelationMetadata,
    templateStep?: { targetCapability: string; input: unknown; expectedEvidence?: string },
  ): Promise<Result<MissionDefinition, string>>;

  replan(
    failedMissionId: string,
    failedStepOrder: number,
    newEvidenceIds: readonly string[],
    correlation: CorrelationMetadata,
  ): Promise<Result<MissionDefinition, string>>;
}
