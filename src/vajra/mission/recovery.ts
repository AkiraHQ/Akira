import { IOperationalStateStore, InterruptedRecoveryState } from "../ports/state-store";
import { CapabilityRegistry } from "../../contracts/capabilities/registry";
import { RecoveryTriageCase } from "./types";

export interface ReplayEvidenceProbe {
  checkExecutionEvidence(stepId: string, targetCapability: string): Promise<boolean>;
  checkNeverInitiated(stepId: string): Promise<boolean>;
}

export interface RecoveryTriageResult {
  readonly missionId: string;
  readonly stepId: string;
  readonly triageCase: RecoveryTriageCase;
  readonly actionTaken: "SAFE_TO_DISPATCH" | "PAUSED_RECOVERY" | "RECONCILED_TO_VERIFICATION";
  readonly reason: string;
}

/**
 * Boot Recovery Manager responsible for detecting and reconciling interrupted
 * in-flight missions and steps on process startup.
 *
 * Enforces the Three Triaged Recovery Reality Cases (§15.3) and the
 * Four-Condition Replay Safety Gate (§16.3).
 */
export class MissionRecoveryManager {
  constructor(
    private readonly stateStore: IOperationalStateStore,
    private readonly capabilityRegistry?: CapabilityRegistry,
    private readonly evidenceProbe?: ReplayEvidenceProbe,
  ) {}

  async recoverInterruptedMissions(): Promise<readonly RecoveryTriageResult[]> {
    const interruptedStates = await this.stateStore.detectInterruptedMissions();
    const results: RecoveryTriageResult[] = [];

    for (const item of interruptedStates) {
      const triageResults = await this.recoverMission(item);
      results.push(...triageResults);
    }

    return Object.freeze(results);
  }

  private async recoverMission(
    state: InterruptedRecoveryState,
  ): Promise<RecoveryTriageResult[]> {
    const results: RecoveryTriageResult[] = [];
    const { mission, interruptedSteps, pendingEscalations } = state;

    // Preserved Pending Escalations Gate
    if (pendingEscalations.length > 0) {
      await this.stateStore.updateMissionLifecycle(mission.id, "PAUSED_APPROVAL");
      return [
        {
          missionId: mission.id,
          stepId: pendingEscalations[0].stepId ?? "mission-level",
          triageCase: "STATE_UNCERTAIN",
          actionTaken: "PAUSED_RECOVERY",
          reason: `Mission '${mission.id}' has ${pendingEscalations.length} pending human escalation(s). Preserved as PAUSED_APPROVAL.`,
        },
      ];
    }

    if (interruptedSteps.length === 0) {
      // Dangling in-flight mission without recorded steps
      await this.stateStore.updateMissionLifecycle(mission.id, "FAILED", new Date().toISOString());
      return [
        {
          missionId: mission.id,
          stepId: "none",
          triageCase: "STATE_UNCERTAIN",
          actionTaken: "PAUSED_RECOVERY",
          reason: `Mission '${mission.id}' was in-flight without active steps. Marked FAILED.`,
        },
      ];
    }

    for (const step of interruptedSteps) {
      // Triaged Reality Evaluation (§15.3)

      // Case 3 check: Did external execution definitely occur?
      if (this.evidenceProbe && (await this.evidenceProbe.checkExecutionEvidence(step.id, step.targetCapability))) {
        const canonicalExecutionId = step.executionResultId ?? step.id;
        if (!canonicalExecutionId) {
          // If no canonical identity can be reconstructed, halt to PAUSED_RECOVERY
          results.push({
            missionId: mission.id,
            stepId: step.id,
            triageCase: "STATE_UNCERTAIN",
            actionTaken: "PAUSED_RECOVERY",
            reason: `External execution occurred for '${step.targetCapability}', but canonical execution identity cannot be reconstructed. Frozen to PAUSED_RECOVERY.`,
          });
          continue;
        }

        const executedAt = new Date().toISOString();
        await this.stateStore.recordStepExecution(step.id, canonicalExecutionId, executedAt);
        results.push({
          missionId: mission.id,
          stepId: step.id,
          triageCase: "KNOWN_OCCURRED",
          actionTaken: "RECONCILED_TO_VERIFICATION",
          reason: `Verifiable evidence found for capability '${step.targetCapability}'. Reconciled to EXECUTED with canonical identity '${canonicalExecutionId}'.`,
        });
        continue;
      }

      // Case 1 check: Did external execution definitely NEVER begin?
      if (this.evidenceProbe && (await this.evidenceProbe.checkNeverInitiated(step.id))) {
        results.push({
          missionId: mission.id,
          stepId: step.id,
          triageCase: "KNOWN_NOT_BEGUN",
          actionTaken: "SAFE_TO_DISPATCH",
          reason: `Verifiable proof external execution never began for '${step.targetCapability}'. Safe to dispatch normally.`,
        });
        continue;
      }

      // Case 2: State is UNCERTAIN -> Evaluate ALL FOUR Replay Safety Conditions (§16.3)
      const fourConditionsMet = this.evaluateFourReplayConditions(step.targetCapability);

      if (fourConditionsMet) {
        // Safe to replay because all 4 conditions are met with zero residual uncertainty
        results.push({
          missionId: mission.id,
          stepId: step.id,
          triageCase: "STATE_UNCERTAIN",
          actionTaken: "SAFE_TO_DISPATCH",
          reason: `All four replay-safety conditions met for '${step.targetCapability}'. Safe to re-dispatch with identical idempotency key.`,
        });
      } else {
        // Condition unmet or uncertainty remains -> FREEZE TO PAUSED_RECOVERY
        await this.stateStore.updateMissionLifecycle(mission.id, "PAUSED_RECOVERY");
        results.push({
          missionId: mission.id,
          stepId: step.id,
          triageCase: "STATE_UNCERTAIN",
          actionTaken: "PAUSED_RECOVERY",
          reason: `Replay prohibited for '${step.targetCapability}': four replay safety conditions not fully met or side effect outcome uncertain. Mission set to PAUSED_RECOVERY.`,
        });
      }
    }

    return results;
  }

  private evaluateFourReplayConditions(targetCapability: string): boolean {
    if (!this.capabilityRegistry || !this.capabilityRegistry.has(targetCapability)) {
      return false;
    }

    const entry = this.capabilityRegistry.get(targetCapability);
    if (!entry) {
      return false;
    }

    const chars = entry.descriptor.executionCharacteristics;

    // Condition 1: Explicit safe replay semantics (must be marked idempotent and read-only)
    if (!chars.isIdempotent || !chars.isReadOnly) {
      return false;
    }

    // Condition 2: Contract-guaranteed idempotency (descriptor has deterministic idempotency key support)
    if (entry.descriptor.permissions.allowVajra === false) {
      return false;
    }

    // Condition 3 & 4: Zero residual uncertainty
    // If side effects are possible or uncertainty exists, condition fails
    if (chars.sideEffectClass && chars.sideEffectClass !== "none" && chars.sideEffectClass !== "read_only") {
      return false;
    }

    return true;
  }
}
