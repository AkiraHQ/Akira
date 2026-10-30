import { IOperationalStateStore } from "../ports/state-store";
import { ICoordinationDispatcher } from "../ports/coordination";
import { IObservationReceiver } from "../ports/observation";
import { IVerificationEvaluator } from "../ports/verification";
import { createObservation, Observation } from "../../contracts/events/observation";
import { VerificationRecord, MissionResult } from "../../contracts/capabilities/verification";
import { MissionClosureManager } from "../closure/closure-manager";
import { MissionRuntimeEvent } from "./types";
import { VajraMissionRecord, VajraStepRecord } from "../types/mission-record";
import { VajraVerificationRecord } from "../types/verification-record";

export interface IMissionRuntime {
  executeMission(missionId: string): Promise<VajraMissionRecord>;
  pauseMission(missionId: string, reason: string): Promise<void>;
  cancelMission(missionId: string, reason: string): Promise<void>;
  getLastMissionResult?(missionId?: string): MissionResult | undefined;
}

export type MissionEventListener = (event: MissionRuntimeEvent) => void;

/**
 * Core Mission Runtime orchestrating the sequential execution loop,
 * two-phase commit dispatch, timeout uncertainty handling, verification handoff,
 * and reality closure via MissionClosureManager.
 */
export class MissionRuntime implements IMissionRuntime {
  private readonly listeners: MissionEventListener[] = [];
  private readonly closureManager: MissionClosureManager;
  private lastMissionResult?: MissionResult;

  constructor(
    private readonly stateStore: IOperationalStateStore,
    private readonly coordinator: ICoordinationDispatcher,
    private readonly observationReceiver?: IObservationReceiver,
    private readonly verificationEvaluator?: IVerificationEvaluator,
    closureManager?: MissionClosureManager,
  ) {
    this.closureManager = closureManager ?? new MissionClosureManager(this.stateStore);
  }

  onEvent(listener: MissionEventListener): void {
    this.listeners.push(listener);
  }

  getLastMissionResult(): MissionResult | undefined {
    return this.lastMissionResult;
  }

  private emit(event: MissionRuntimeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Observers must not interrupt execution loop
      }
    }
  }

  async executeMission(missionId: string): Promise<VajraMissionRecord> {
    const mission = await this.stateStore.getMission(missionId);
    if (!mission) {
      throw new Error(`Mission '${missionId}' not found in state store.`);
    }

    if (mission.lifecycleState === "COMPLETED" || mission.lifecycleState === "FAILED" || mission.lifecycleState === "CANCELLED") {
      return mission;
    }

    // Single Running Mission Guarantee: Enforce RUNNING transition in SQLite
    await this.stateStore.updateMissionLifecycle(missionId, "RUNNING");
    this.emit({
      missionId,
      type: "MISSION_STARTED",
      timestamp: new Date().toISOString(),
    });

    const steps = await this.stateStore.getStepsForMission(missionId);
    const sortedSteps = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
    const executedVerifications: VerificationRecord[] = [];

    for (const step of sortedSteps) {
      if (step.dispatchState === "VERIFIED") {
        const existingVerifications = await this.stateStore.getVerificationsForStep(step.id);
        const valid = existingVerifications.find((v) => v.outcome === "criteria_satisfied");
        if (valid) {
          executedVerifications.push(this.mapToVerificationRecord(valid, mission));
        }
        continue;
      }

      if (step.dispatchState === "EXECUTED") {
        // Step was executed, but was it verified?
        const existingVerifications = await this.stateStore.getVerificationsForStep(step.id);
        const validVerification = existingVerifications.find(
          (v) => v.outcome === "criteria_satisfied",
        );

        if (validVerification) {
          // Case A — Verification already durable: do not re-execute; continue
          executedVerifications.push(this.mapToVerificationRecord(validVerification, mission));
          continue;
        }

        // Case B & C — Verification missing: Check if complete K5 evidence is recoverable in observation pool
        const stepObservations = this.observationReceiver?.getObservationsForStep(step.id) ?? [];
        if (stepObservations.length > 0 && this.verificationEvaluator) {
          // Case B — Complete K5 evidence recoverable: evaluate verification without re-executing capability
          const verification = this.verificationEvaluator.evaluateStep(
            step.id,
            mission.id,
            stepObservations,
            mission.definition.completionCriteria,
          );
          if (verification.outcome !== "criteria_satisfied") {
            await this.stateStore.updateMissionLifecycle(mission.id, "FAILED", new Date().toISOString());
            this.emit({
              missionId: mission.id,
              type: "MISSION_FAILED",
              stepOrder: step.stepOrder,
              stepId: step.id,
              timestamp: new Date().toISOString(),
            });
            return (await this.stateStore.getMission(missionId))!;
          }
          executedVerifications.push(verification);
          continue;
        }

        // Case C — Execution occurred but complete K5 evidence is unavailable:
        // Rule: Inconclusive -> PAUSED_RECOVERY. Never fabricate synthetic result.
        await this.stateStore.updateMissionLifecycle(mission.id, "PAUSED_RECOVERY");
        this.emit({
          missionId: mission.id,
          type: "MISSION_PAUSED_RECOVERY",
          stepOrder: step.stepOrder,
          stepId: step.id,
          timestamp: new Date().toISOString(),
        });
        return (await this.stateStore.getMission(missionId))!;
      }

      // Mid-mission confirmation gate check
      if (mission.definition.constraints.confirmationRequired && step.stepOrder > 1 && step.dispatchState === "PENDING") {
        await this.stateStore.updateMissionLifecycle(missionId, "PAUSED_APPROVAL");
        this.emit({
          missionId,
          type: "MISSION_PAUSED_APPROVAL",
          stepOrder: step.stepOrder,
          stepId: step.id,
          timestamp: new Date().toISOString(),
        });
        return (await this.stateStore.getMission(missionId))!;
      }

      // Execute discrete step via Two-Phase Dispatch
      const stepSuccess = await this.executeStepTwoPhase(mission, step, executedVerifications);
      if (!stepSuccess) {
        // Halts loop; step failure or timeout transitions mission to terminal or paused state
        return (await this.stateStore.getMission(missionId))!;
      }
    }

    // All steps executed and verified: Delegate terminal closure to MissionClosureManager
    const terminalVerification =
      executedVerifications[executedVerifications.length - 1] ??
      (await this.getTerminalVerificationFromStore(missionId, mission));

    if (terminalVerification) {
      const closureResult = await this.closureManager.closeMission({
        missionId,
        terminalVerificationRecord: terminalVerification,
      });
      this.lastMissionResult = closureResult.missionResult;
    } else {
      const completedAt = new Date().toISOString();
      await this.stateStore.updateMissionLifecycle(missionId, "COMPLETED", completedAt);
    }

    this.emit({
      missionId,
      type: "MISSION_COMPLETED",
      timestamp: new Date().toISOString(),
    });

    const updated = await this.stateStore.getMission(missionId);
    if (updated && this.lastMissionResult) {
      return {
        ...updated,
        state: {
          ...updated.state,
          terminalResult: this.lastMissionResult,
        },
      };
    }
    return updated!;
  }

  private async executeStepTwoPhase(
    mission: VajraMissionRecord,
    step: VajraStepRecord,
    executedVerifications: VerificationRecord[],
  ): Promise<boolean> {
    const correlation = {
      requestId: mission.requestId,
      correlationId: mission.correlationId,
      invocationId: step.id,
    };

    // Phase A: Pre-Dispatch Persistence in DB
    const dispatchedAt = new Date().toISOString();
    await this.stateStore.preDispatchStep(step.id, step.idempotencyKey, dispatchedAt);
    this.emit({
      missionId: mission.id,
      type: "STEP_PRE_DISPATCHED",
      stepOrder: step.stepOrder,
      stepId: step.id,
      timestamp: dispatchedAt,
    });

    // Phase B: External Actuation outside DB transaction
    const missionStep = mission.definition.steps.find((s) => s.id === step.id) ?? {
      id: step.id,
      missionId: mission.id,
      stepOrder: step.stepOrder,
      description: step.description,
      targetCapability: step.targetCapability,
      input: step.input,
      expectedEvidence: step.expectedEvidence,
    };

    const executionResult = await this.coordinator.dispatchStep(missionStep, correlation);
    const executedAt = new Date().toISOString();

    if (executionResult.ok) {
      // Phase C: Result Persistence in DB (Invariant K-P7-16: Canonical K19 execution identity)
      const resultId = step.executionResultId ?? step.id;
      await this.stateStore.recordStepExecution(step.id, resultId, executedAt);
      this.emit({
        missionId: mission.id,
        type: "STEP_EXECUTED",
        stepOrder: step.stepOrder,
        stepId: step.id,
        timestamp: executedAt,
      });

      // Phase D: Observation & Verification Handoff
      if (this.observationReceiver) {
        const payloadConfidence =
          typeof (executionResult.value as { confidence?: unknown })?.confidence === "number"
            ? (executionResult.value as { confidence: number }).confidence
            : undefined;

        let obs: Observation;
        if (typeof (this.observationReceiver as any).normalizeExecutionResult === "function") {
          obs = (this.observationReceiver as any).normalizeExecutionResult({
            missionId: mission.id,
            stepId: step.id,
            targetCapability: step.targetCapability,
            payload: executionResult.value,
            correlation: {
              ...correlation,
              missionId: mission.id,
              stepId: step.id,
              executionId: resultId,
            },
            executionResultId: resultId,
            producerConfidence: payloadConfidence,
          });
        } else {
          obs = createObservation({
            producer: `capability.${step.targetCapability}`,
            subject: step.id,
            payload: executionResult.value,
            confidence: payloadConfidence,
            provenance: `Execution result from capability '${step.targetCapability}'`,
            correlation: {
              ...correlation,
              missionId: mission.id,
              stepId: step.id,
              executionId: resultId,
            },
          });
          this.observationReceiver.ingestObservation(obs);
        }

        if (this.verificationEvaluator) {
          const verification = this.verificationEvaluator.evaluateStep(
            step.id,
            mission.id,
            [obs],
            mission.definition.completionCriteria,
          );
          executedVerifications.push(verification);

          if (verification.outcome !== "criteria_satisfied") {
            // Verification contradicted or inconclusive
            await this.stateStore.updateMissionLifecycle(mission.id, "FAILED", executedAt);
            this.emit({
              missionId: mission.id,
              type: "MISSION_FAILED",
              stepOrder: step.stepOrder,
              stepId: step.id,
              timestamp: executedAt,
            });
            return false;
          }
        }
      }

      this.emit({
        missionId: mission.id,
        type: "STEP_VERIFIED",
        stepOrder: step.stepOrder,
        stepId: step.id,
        timestamp: executedAt,
      });

      return true;
    } else {
      // Phase C (Failure): Record Step Failure in DB
      await this.stateStore.failStep(step.id, executionResult.error, executedAt);
      this.emit({
        missionId: mission.id,
        type: "STEP_FAILED",
        stepOrder: step.stepOrder,
        stepId: step.id,
        timestamp: executedAt,
        payload: executionResult.error,
      });

      // Timeout and uncertain outcome rule (§17.2):
      // A timeout or uncertain failure transitions to PAUSED_RECOVERY (never blindly replay)
      if (executionResult.error.category === "timeout" || executionResult.error.category === "execution_failure") {
        await this.stateStore.updateMissionLifecycle(mission.id, "PAUSED_RECOVERY");
        this.emit({
          missionId: mission.id,
          type: "MISSION_PAUSED_RECOVERY",
          stepOrder: step.stepOrder,
          stepId: step.id,
          timestamp: executedAt,
        });
        return false;
      }

      // Hard non-recoverable error
      await this.stateStore.updateMissionLifecycle(mission.id, "FAILED", executedAt);
      this.emit({
        missionId: mission.id,
        type: "MISSION_FAILED",
        stepOrder: step.stepOrder,
        stepId: step.id,
        timestamp: executedAt,
      });
      return false;
    }
  }

  private mapToVerificationRecord(
    record: VajraVerificationRecord,
    mission: VajraMissionRecord,
  ): VerificationRecord {
    return {
      id: record.id,
      missionId: mission.id,
      stepId: record.stepId,
      executionResultIds: record.evidenceIds,
      observationIds: record.evidenceIds,
      outcome: record.outcome as any,
      verifiedAt: record.recordedAt,
      rationale: record.evaluatorNotes ?? "Verification judgment recorded.",
      correlation: {
        requestId: mission.requestId,
        correlationId: mission.correlationId,
        causationId: mission.invocationId,
        invocationId: record.invocationId ?? mission.invocationId,
        missionId: mission.id,
      },
    };
  }

  private async getTerminalVerificationFromStore(
    missionId: string,
    mission: VajraMissionRecord,
  ): Promise<VerificationRecord | undefined> {
    const records = await this.stateStore.getVerificationsForMission(missionId);
    const last = records[records.length - 1];
    return last ? this.mapToVerificationRecord(last, mission) : undefined;
  }

  async pauseMission(missionId: string, _reason: string): Promise<void> {
    await this.stateStore.updateMissionLifecycle(missionId, "PAUSED_APPROVAL");
    this.emit({
      missionId,
      type: "MISSION_PAUSED_APPROVAL",
      timestamp: new Date().toISOString(),
    });
  }

  async cancelMission(missionId: string, _reason: string): Promise<void> {
    const cancelledAt = new Date().toISOString();
    await this.stateStore.updateMissionLifecycle(missionId, "CANCELLED", cancelledAt);
    this.emit({
      missionId,
      type: "MISSION_CANCELLED",
      timestamp: cancelledAt,
    });
  }
}
