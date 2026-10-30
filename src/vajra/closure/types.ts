import { VerificationRecord, MissionResult } from "../../contracts/capabilities/verification";
import { VerificationState } from "../types/belief";

/**
 * Options for executing terminal mission closure.
 */
export interface MissionClosureOptions<TOutcome = unknown> {
  readonly missionId: string;
  readonly terminalVerificationRecord: VerificationRecord;
  readonly outcomePayload?: TOutcome;
  /** Whether to emit the decoupled domain event to EventBus (default: true) */
  readonly publishEvent?: boolean;
}

/**
 * Audit result of updating an epistemic belief during reality closure.
 */
export interface BeliefReconciliationReport {
  readonly beliefId: string;
  readonly previousState: VerificationState;
  readonly newState: VerificationState;
  readonly supportingEvidenceIdsCount: number;
  readonly contradictingEvidenceIdsCount: number;
}

/**
 * Final outcome summary produced by MissionClosureManager.
 */
export interface MissionClosureResult<TOutcome = unknown> {
  readonly missionId: string;
  readonly status: "completed" | "not_completed";
  readonly missionResult: MissionResult<TOutcome>;
  readonly reconciledBeliefs: readonly BeliefReconciliationReport[];
  readonly eventPublished: boolean;
}
