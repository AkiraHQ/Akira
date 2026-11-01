import { IOperationalStateStore } from "../ports/state-store";
import { ICoordinationDispatcher } from "../ports/coordination";
import { IObservationReceiver } from "../ports/observation";
import { IVerificationEvaluator } from "../ports/verification";
import { createObservation, Observation } from "../../contracts/events/observation";
import { VerificationRecord, MissionResult } from "../../contracts/capabilities/verification";
import { CorrelationMetadata } from "../../contracts/results/result";
import { MissionClosureManager } from "../closure/closure-manager";
import { MissionRuntimeEvent } from "./types";
import { VajraMissionRecord, VajraStepRecord } from "../types/mission-record";
import { VajraVerificationRecord } from "../types/verification-record";

/**
 * Authorization contract required to resume an interrupted mission in PAUSED_RECOVERY.
 *
 * TRUST BOUNDARY INVARIANT (Phase 8B Part 1):
 * - ResumeAuthorization is supplied by a trusted internal caller (e.g. human operator directive
 *   or explicit supervisor escalation resolution).
 * - The runtime currently validates its presence and the structural validity of required fields
 *   (non-empty string `authorizedBy` and non-empty string `reason`), but does NOT authenticate the
 *   caller's identity against an external identity store, cryptographic key, or role-based access control (RBAC).
 * - Missing, null, undefined, or malformed authorization payloads strictly fail closed by throwing
 *   UnauthorizedResumeError.
 * - This provides an architectural boundary ensuring that boot-time recovery, background event loops,
 *   or ordinary executeMission() calls cannot blindly or automatically redispatch paused recovery work.
 */
export interface ResumeAuthorization {
  readonly authorizedBy: string;
  readonly reason: string;
  readonly correlation?: CorrelationMetadata;
}

export class UnauthorizedResumeError extends Error {
  constructor(missionId: string, reason: string) {
    super(`Unauthorized attempt to resume mission '${missionId}' in PAUSED_RECOVERY: ${reason}`);
    this.name = "UnauthorizedResumeError";
  }
}

export interface IMissionRuntime {
  executeMission(missionId: string): Promise<VajraMissionRecord>;
  resumeMission(missionId: string, authorization: ResumeAuthorization): Promise<VajraMissionRecord>;
  pauseMission(missionId: string, reason: string): Promise<void>;
  cancelMission(missionId: string, reason: string): Promise<void>;
  getLastMissionResult?(missionId?: string): MissionResult | undefined;
  requestShutdown?(options?: { timeoutMs?: number }): Promise<void>;
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
  private isShutdownRequested: boolean = false;
  private activeExecutionPromise: Promise<VajraMissionRecord> | null = null;
  private activeMissionId: string | null = null;

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

    if (mission.lifecycleState === "PAUSED_RECOVERY") {
      throw new UnauthorizedResumeError(
        missionId,
        "Cannot automatically resume mission in PAUSED_RECOVERY via executeMission(). Explicit resumeMission() with ResumeAuthorization is strictly required.",
      );
    }

    const executionPromise = this.runMissionLoop(mission);
    this.activeExecutionPromise = executionPromise;
    this.activeMissionId = missionId;
    try {
      return await executionPromise;
    } finally {
      if (this.activeMissionId === missionId) {
        this.activeMissionId = null;
        this.activeExecutionPromise = null;
      }
    }
  }

  async resumeMission(
    missionId: string,
    authorization: ResumeAuthorization,
  ): Promise<VajraMissionRecord> {
    if (
      !authorization ||
      typeof authorization !== "object" ||
      typeof authorization.authorizedBy !== "string" ||
      authorization.authorizedBy.trim() === "" ||
      typeof authorization.reason !== "string" ||
      authorization.reason.trim() === ""
    ) {
      throw new UnauthorizedResumeError(
        missionId,
        "Missing or malformed ResumeAuthorization: non-empty 'authorizedBy' and 'reason' are required.",
      );
    }

    const mission = await this.stateStore.getMission(missionId);
    if (!mission) {
      throw new Error(`Mission '${missionId}' not found in state store.`);
    }

    const executionPromise = this.runMissionLoop(mission, authorization);
    this.activeExecutionPromise = executionPromise;
    this.activeMissionId = missionId;
    try {
      return await executionPromise;
    } finally {
      if (this.activeMissionId === missionId) {
        this.activeMissionId = null;
        this.activeExecutionPromise = null;
      }
    }
  }

  private async runMissionLoop(
    mission: VajraMissionRecord,
    _authorization?: ResumeAuthorization,
  ): Promise<VajraMissionRecord> {
    const missionId = mission.id;
    if (
      mission.lifecycleState === "COMPLETED" ||
      mission.lifecycleState === "FAILED" ||
      mission.lifecycleState === "CANCELLED"
    ) {
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
            await this.stateStore.updateMissionLifecycle(
              mission.id,
              "FAILED",
              new Date().toISOString(),
            );
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

      // Guard against blind redispatch of unresolved DISPATCHED steps (Phase 8B Part 1)
      if (step.dispatchState === "DISPATCHED") {
        if (
          step.recoveryClassification !== "VERIFIED_NEVER_STARTED" &&
          step.recoveryClassification !== "REPLAY_PERMITTED"
        ) {
          // Unresolved DISPATCHED step (BLOCKED_UNRESOLVED or unclassified)
          // Halt execution loop immediately. Do NOT call dispatcher!
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
      }

      // Mid-mission confirmation gate check
      if (
        mission.definition.constraints.confirmationRequired &&
        step.stepOrder > 1 &&
        step.dispatchState === "PENDING"
      ) {
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

      // Cooperative shutdown check before dispatching unexecuted step
      if (this.isShutdownRequested) {
        await this.stateStore.updateMissionLifecycle(missionId, "PAUSED_RECOVERY");
        this.emit({
          missionId,
          type: "MISSION_PAUSED_RECOVERY",
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

    if (!terminalVerification || terminalVerification.outcome !== "criteria_satisfied") {
      // Invariant: No mission can transition to COMPLETED without a valid criteria_satisfied verification record.
      const targetState =
        terminalVerification?.outcome === "criteria_not_satisfied" ? "FAILED" : "PAUSED_RECOVERY";
      await this.stateStore.updateMissionLifecycle(missionId, targetState);
      this.emit({
        missionId,
        type: targetState === "FAILED" ? "MISSION_FAILED" : "MISSION_PAUSED_RECOVERY",
        stepOrder: mission.currentStepOrder,
        timestamp: new Date().toISOString(),
      });
      return (await this.stateStore.getMission(missionId))!;
    }

    const closureResult = await this.closureManager.closeMission({
      missionId,
      terminalVerificationRecord: terminalVerification,
    });
    this.lastMissionResult = closureResult.missionResult;

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

    const executionResult = await this.coordinator.dispatchStep(missionStep, correlation, {
      idempotencyKey: step.idempotencyKey,
    });
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

          if (verification.outcome === "inconclusive") {
            // Inconclusive verification: transition to PAUSED_RECOVERY (Invariant K-P7-5)
            await this.stateStore.updateMissionLifecycle(mission.id, "PAUSED_RECOVERY", executedAt);
            this.emit({
              missionId: mission.id,
              type: "MISSION_PAUSED_RECOVERY",
              stepOrder: step.stepOrder,
              stepId: step.id,
              timestamp: executedAt,
            });
            return false;
          }

          if (verification.outcome !== "criteria_satisfied") {
            // Verification explicitly contradicted or criteria not satisfied
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
      if (
        executionResult.error.category === "timeout" ||
        executionResult.error.category === "execution_failure"
      ) {
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

  /**
   * Requests cooperative shutdown of the mission runtime.
   *
   * Bounded Shutdown & Durable Safety Invariant:
   * 1. Signals all in-flight loops that shutdown is requested.
   * 2. Allows any currently executing capability step up to `timeoutMs` (default 5000ms)
   *    to complete its discrete execution and verification recording.
   * 3. Pauses execution BEFORE dispatching any subsequent step, persisting the mission as PAUSED_RECOVERY.
   * 4. If an in-flight capability does not resolve within `timeoutMs`, shutdown proceeds without
   *    fabricating completion or evidence; the unresolved step remains DISPATCHED in SQLite for
   *    Phase 8B crash recovery to audit and triage safely upon restart.
   */
  async requestShutdown(options?: { timeoutMs?: number }): Promise<void> {
    this.isShutdownRequested = true;
    if (!this.activeExecutionPromise) {
      return;
    }

    const timeoutMs = options?.timeoutMs ?? 5000;
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        resolve();
      }, timeoutMs);
    });

    try {
      await Promise.race([
        this.activeExecutionPromise.then(
          () => {},
          () => {},
        ),
        timeoutPromise,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  _resetShutdownForTesting(): void {
    this.isShutdownRequested = false;
    this.activeExecutionPromise = null;
    this.activeMissionId = null;
  }
}
