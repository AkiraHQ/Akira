import { OperationalContext } from "../types/operational-context";
import { EpistemicBelief } from "../types/belief";
import { DeliberationTrace } from "../types/trace";
import {
  VajraMissionRecord,
  VajraStepRecord,
  MissionLifecycleState,
  StepRecoveryClassification,
} from "../types/mission-record";
import { VajraEscalationRecord, EscalationStatus } from "../types/escalation-record";
import { VajraVerificationRecord } from "../types/verification-record";
import { ProvenanceRecord } from "../types/provenance";

/**
 * Encapsulates interrupted in-flight work detected during boot recovery.
 */
export interface InterruptedRecoveryState {
  readonly mission: VajraMissionRecord;
  readonly interruptedSteps: readonly VajraStepRecord[];
  readonly pendingEscalations: readonly VajraEscalationRecord[];
}

/**
 * Architectural Port for the Operational State Store.
 *
 * Implemented by SqliteOperationalStateStore in src/persistence/vajra/.
 *
 * INVARIANT: Domain code in src/vajra/ interacts only with this port contract,
 * completely isolated from SQLite drivers and SQL statements.
 */
export interface IOperationalStateStore {
  // Operational Context (Singleton)
  saveOperationalContext(ctx: OperationalContext): Promise<void>;
  loadOperationalContext(): Promise<OperationalContext | null>;

  // Epistemic Beliefs
  saveBelief(belief: EpistemicBelief): Promise<void>;
  loadBeliefs(): Promise<readonly EpistemicBelief[]>;
  getBelief(id: string): Promise<EpistemicBelief | null>;
  deleteBelief(id: string): Promise<void>;

  // Reality Closure Atomic Transaction
  /**
   * Atomically finalizes mission reality closure:
   * - Persists reconciled epistemic beliefs
   * - Clears active_mission_id if matching this missionId
   * - Updates mission lifecycle state and completed_at
   * All executed within a single database transaction.
   */
  completeMissionRealityClosure?(
    missionId: string,
    targetLifecycle: MissionLifecycleState,
    completedAt: string | null,
    updatedBeliefs?: readonly EpistemicBelief[],
  ): Promise<void>;

  // Deliberation Traces (Audit Log)
  appendAuditTrace(trace: DeliberationTrace): Promise<void>;
  queryAuditTraces(limit?: number): Promise<readonly DeliberationTrace[]>;
  queryAuditTracesByCorrelation(correlationId: string): Promise<readonly DeliberationTrace[]>;
  queryAuditTracesByStimulus(stimulusId: string): Promise<readonly DeliberationTrace[]>;

  // Missions Ledger
  createMission(mission: VajraMissionRecord, steps: readonly VajraStepRecord[]): Promise<void>;
  getMission(id: string): Promise<VajraMissionRecord | null>;
  getActiveMission(): Promise<VajraMissionRecord | null>;
  updateMissionLifecycle(
    id: string,
    lifecycleState: MissionLifecycleState,
    completedAt?: string | null,
  ): Promise<void>;

  // Mission Steps (Two-Phase Dispatch)
  getStep(id: string): Promise<VajraStepRecord | null>;
  getStepsForMission(missionId: string): Promise<readonly VajraStepRecord[]>;
  preDispatchStep(stepId: string, idempotencyKey: string, dispatchedAt?: string): Promise<void>;
  recordStepExecution(
    stepId: string,
    executionResultId: string,
    executedAt?: string,
    evidenceHash?: string,
  ): Promise<void>;
  updateStepRecoveryClassification(
    stepId: string,
    classification: StepRecoveryClassification,
  ): Promise<void>;
  failStep(stepId: string, error: unknown, executedAt?: string): Promise<void>;

  // Escalations (Human Gates)
  createEscalation(escalation: VajraEscalationRecord): Promise<void>;
  getEscalation(id: string): Promise<VajraEscalationRecord | null>;
  resolveEscalation(
    id: string,
    status: EscalationStatus,
    resolutionComment?: string | null,
    resolvedAt?: string,
  ): Promise<void>;
  getPendingEscalations(): Promise<readonly VajraEscalationRecord[]>;

  // Verification Records
  saveVerification(verification: VajraVerificationRecord): Promise<void>;
  getVerificationsForStep(stepId: string): Promise<readonly VajraVerificationRecord[]>;
  getVerificationsForMission(missionId: string): Promise<readonly VajraVerificationRecord[]>;

  // Provenance & Recovery
  getExecutionProvenance(correlationId: string): Promise<readonly ProvenanceRecord[]>;
  detectInterruptedMissions(): Promise<readonly InterruptedRecoveryState[]>;
}
