import { IOperationalStateStore, InterruptedRecoveryState } from "../ports/state-store";
import { CapabilityRegistry } from "../../contracts/capabilities/registry";
import { VerificationRecord } from "../../contracts/capabilities/verification";
import { MissionClosureManager } from "../closure/closure-manager";
import {
  RecoveryTriageCase,
  EvidenceProbeResult,
  EvidenceOutcomeStatus,
  StepRecoveryClassification,
} from "./types";
import { VajraStepRecord } from "../types/mission-record";
import { isValidIdempotencyKey } from "../types/action";

export interface ReplayEvidenceProbe {
  checkEvidence?(step: VajraStepRecord): Promise<EvidenceProbeResult>;
  checkExecutionEvidence?(stepId: string, targetCapability: string): Promise<boolean>;
  checkNeverInitiated?(stepId: string): Promise<boolean>;
}

export interface RecoveryTriageResult {
  readonly missionId: string;
  readonly stepId: string;
  readonly triageCase: RecoveryTriageCase;
  readonly actionTaken: "SAFE_TO_DISPATCH" | "PAUSED_RECOVERY" | "RECONCILED_TO_VERIFICATION";
  readonly reason: string;
  readonly evidenceStatus?: EvidenceOutcomeStatus;
  readonly recoveryClassification?: StepRecoveryClassification;
}

export interface RecoveryOptions {
  /** If true, bypasses existing durable recovery classifications and re-evaluates the probe */
  readonly forceProbeReevaluation?: boolean;
}

/**
 * Production evidence probe that fails closed to UNKNOWN when durable external
 * execution evidence is unavailable (Phase 8B Part 1).
 */
export class ProductionEvidenceProbe implements ReplayEvidenceProbe {
  async checkEvidence(step: VajraStepRecord): Promise<EvidenceProbeResult> {
    return {
      status: "UNKNOWN",
      reason: `Durable external execution log unavailable for capability '${step.targetCapability}'.`,
    };
  }
}

/**
 * Boot Recovery Manager responsible for detecting and reconciling interrupted
 * in-flight missions and steps on process startup.
 *
 * Enforces the Three Triaged Recovery Reality Cases (§15.3), the
 * Four-Condition Replay Safety Gate (§16.3), and durable recovery classification.
 */
export class MissionRecoveryManager {
  constructor(
    private readonly stateStore: IOperationalStateStore,
    private readonly capabilityRegistry?: CapabilityRegistry,
    private readonly evidenceProbe?: ReplayEvidenceProbe,
    private readonly closureManager?: MissionClosureManager,
  ) {}

  async recoverInterruptedMissions(
    options?: RecoveryOptions,
  ): Promise<readonly RecoveryTriageResult[]> {
    const interruptedStates = await this.stateStore.detectInterruptedMissions();
    const results: RecoveryTriageResult[] = [];

    for (const item of interruptedStates) {
      const triageResults = await this.recoverMission(item, options);
      results.push(...triageResults);
    }

    return Object.freeze(results);
  }

  private async recoverMission(
    state: InterruptedRecoveryState,
    options?: RecoveryOptions,
  ): Promise<RecoveryTriageResult[]> {
    const results: RecoveryTriageResult[] = [];
    const { mission, interruptedSteps, pendingEscalations } = state;

    // Preserved Pending Escalations Gate
    if (pendingEscalations.length > 0 || mission.lifecycleState === "PAUSED_APPROVAL") {
      await this.stateStore.updateMissionLifecycle(mission.id, "PAUSED_APPROVAL");
      return [
        {
          missionId: mission.id,
          stepId: pendingEscalations[0]?.stepId ?? "mission-level",
          triageCase: "STATE_UNCERTAIN",
          actionTaken: "PAUSED_RECOVERY",
          reason: `Mission '${mission.id}' has ${pendingEscalations.length} pending human escalation(s) or is awaiting approval. Preserved as PAUSED_APPROVAL.`,
        },
      ];
    }

    if (interruptedSteps.length === 0) {
      const allSteps = await this.stateStore.getStepsForMission(mission.id);

      // Case A: Truly dangling in-flight mission without recorded steps
      if (allSteps.length === 0) {
        await this.stateStore.updateMissionLifecycle(
          mission.id,
          "FAILED",
          new Date().toISOString(),
        );
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

      // Check durable verification records
      const verifications = await this.stateStore.getVerificationsForMission(mission.id);
      const terminalVerif = verifications[verifications.length - 1];

      // Case B: Any step failed or verification contradicted / unsatisfied
      const hasFailed = allSteps.some((s) => s.dispatchState === "FAILED");
      const isContradicted = terminalVerif && terminalVerif.outcome === "criteria_not_satisfied";

      if (hasFailed || isContradicted) {
        if (isContradicted && this.closureManager) {
          const closureRecord: VerificationRecord = {
            id: terminalVerif.id,
            missionId: mission.id,
            stepId: terminalVerif.stepId,
            executionResultIds: terminalVerif.evidenceIds,
            observationIds: terminalVerif.evidenceIds,
            outcome: terminalVerif.outcome as any,
            verifiedAt: terminalVerif.recordedAt,
            rationale:
              terminalVerif.evaluatorNotes ?? "Recovered contradicted verification record.",
            correlation: {
              requestId: mission.requestId,
              correlationId: mission.correlationId,
              causationId: mission.invocationId,
              invocationId: terminalVerif.invocationId ?? mission.invocationId,
              missionId: mission.id,
            },
          };

          await this.closureManager.closeMission({
            missionId: mission.id,
            terminalVerificationRecord: closureRecord,
            publishEvent: false,
          });
        } else if (mission.lifecycleState !== "FAILED") {
          await this.stateStore.updateMissionLifecycle(
            mission.id,
            "FAILED",
            terminalVerif?.recordedAt ?? new Date().toISOString(),
          );
        }

        return [
          {
            missionId: mission.id,
            stepId:
              terminalVerif?.stepId ??
              allSteps.find((s) => s.dispatchState === "FAILED")?.id ??
              "none",
            triageCase: "STATE_UNCERTAIN",
            actionTaken: "PAUSED_RECOVERY",
            reason: isContradicted
              ? `Mission '${mission.id}' verification outcome was '${terminalVerif.outcome}'. Reconciled to FAILED.`
              : `Mission '${mission.id}' contains failed steps. Preserved as FAILED.`,
          },
        ];
      }

      // Case C: All steps completed / verified / skipped
      const allCompleted = allSteps.every(
        (s) => s.dispatchState === "VERIFIED" || s.dispatchState === "SKIPPED",
      );
      if (allCompleted) {
        if (terminalVerif && terminalVerif.outcome === "criteria_satisfied") {
          if (this.closureManager) {
            const closureRecord: VerificationRecord = {
              id: terminalVerif.id,
              missionId: mission.id,
              stepId: terminalVerif.stepId,
              executionResultIds: terminalVerif.evidenceIds,
              observationIds: terminalVerif.evidenceIds,
              outcome: terminalVerif.outcome as any,
              verifiedAt: terminalVerif.recordedAt,
              rationale: terminalVerif.evaluatorNotes ?? "Recovered verification record.",
              correlation: {
                requestId: mission.requestId,
                correlationId: mission.correlationId,
                causationId: mission.invocationId,
                invocationId: terminalVerif.invocationId ?? mission.invocationId,
                missionId: mission.id,
              },
            };

            await this.closureManager.closeMission({
              missionId: mission.id,
              terminalVerificationRecord: closureRecord,
              publishEvent: false,
            });
          } else {
            if (mission.lifecycleState !== "COMPLETED") {
              await this.stateStore.updateMissionLifecycle(
                mission.id,
                "COMPLETED",
                terminalVerif.recordedAt,
              );
            }
          }

          return [
            {
              missionId: mission.id,
              stepId: "all-steps",
              triageCase: "KNOWN_OCCURRED",
              actionTaken: "RECONCILED_TO_VERIFICATION",
              reason: `Mission '${mission.id}' has all steps verified with durable verification record '${terminalVerif.id}'. Reality closure finalized.`,
            },
          ];
        }

        // No verification record or inconclusive verification: Cannot complete!
        if (mission.lifecycleState !== "PAUSED_RECOVERY") {
          await this.stateStore.updateMissionLifecycle(mission.id, "PAUSED_RECOVERY");
        }
        return [
          {
            missionId: mission.id,
            stepId: allSteps[0]?.id ?? "none",
            triageCase: "STATE_UNCERTAIN",
            actionTaken: "PAUSED_RECOVERY",
            reason: `Mission '${mission.id}' steps completed but durable criteria_satisfied verification record is missing. Preserved as PAUSED_RECOVERY.`,
          },
        ];
      }

      // Case D: Steps remain pending or executed without verification (EXECUTED, PENDING)
      if (mission.lifecycleState === "RUNNING") {
        await this.stateStore.updateMissionLifecycle(mission.id, "PAUSED_RECOVERY");
      }

      const activeOrPendingStep = allSteps.find(
        (s) => s.dispatchState === "EXECUTED" || s.dispatchState === "PENDING",
      );

      return [
        {
          missionId: mission.id,
          stepId: activeOrPendingStep?.id ?? allSteps[0]?.id ?? "none",
          triageCase: "STATE_UNCERTAIN",
          actionTaken: "PAUSED_RECOVERY",
          reason: `Mission '${mission.id}' has ${allSteps.length} step(s) with confirmed or pending state. Preserved as PAUSED_RECOVERY.`,
        },
      ];
    }

    for (const step of interruptedSteps) {
      // 1. Redundant probing check: Preserve already durably classified steps across restart
      if (!options?.forceProbeReevaluation && step.recoveryClassification) {
        if (step.recoveryClassification === "VERIFIED_NEVER_STARTED") {
          await this.stateStore.updateMissionLifecycle(mission.id, "PAUSED_RECOVERY");
          results.push({
            missionId: mission.id,
            stepId: step.id,
            triageCase: "KNOWN_NOT_BEGUN",
            actionTaken: "SAFE_TO_DISPATCH",
            reason: `Preserved durable recovery classification 'VERIFIED_NEVER_STARTED' without re-probing.`,
            recoveryClassification: "VERIFIED_NEVER_STARTED",
          });
          continue;
        }

        if (step.recoveryClassification === "REPLAY_PERMITTED") {
          await this.stateStore.updateMissionLifecycle(mission.id, "PAUSED_RECOVERY");
          results.push({
            missionId: mission.id,
            stepId: step.id,
            triageCase: "STATE_UNCERTAIN",
            actionTaken: "SAFE_TO_DISPATCH",
            reason: `Preserved durable recovery classification 'REPLAY_PERMITTED' without re-probing.`,
            recoveryClassification: "REPLAY_PERMITTED",
          });
          continue;
        }

        if (step.recoveryClassification === "BLOCKED_UNRESOLVED") {
          await this.stateStore.updateMissionLifecycle(mission.id, "PAUSED_RECOVERY");
          results.push({
            missionId: mission.id,
            stepId: step.id,
            triageCase: "STATE_UNCERTAIN",
            actionTaken: "PAUSED_RECOVERY",
            reason: `Preserved durable recovery classification 'BLOCKED_UNRESOLVED' without re-probing.`,
            recoveryClassification: "BLOCKED_UNRESOLVED",
          });
          continue;
        }
      }

      // 2. Query Evidence Probe with exception normalization and timeout protection
      const probeResult = await this.queryEvidenceProbe(step);

      // Case 3 check: Did external execution definitely OCCUR with externally grounded canonical ID?
      if (probeResult.status === "VERIFIED_OCCURRED") {
        const canonicalExecutionId = probeResult.canonicalExecutionId;

        // Grounded Canonical Identity Rule: Never fall back to step.id or synthesize an unverified ID
        if (!canonicalExecutionId || canonicalExecutionId.trim() === "") {
          // If no canonical external identity was supplied, fail closed to UNKNOWN
          const fallbackOutcome = await this.handleUnknownEvidence(
            mission.id,
            step,
            "External execution was reported, but canonical external execution identity cannot be proven. Normalized to UNKNOWN.",
          );
          results.push(fallbackOutcome);
          continue;
        }

        const executedAt = probeResult.externalTimestamp ?? new Date().toISOString();
        await this.stateStore.recordStepExecution(
          step.id,
          canonicalExecutionId,
          executedAt,
          probeResult.evidenceHash,
        );
        await this.stateStore.updateMissionLifecycle(mission.id, "PAUSED_RECOVERY");

        results.push({
          missionId: mission.id,
          stepId: step.id,
          triageCase: "KNOWN_OCCURRED",
          actionTaken: "RECONCILED_TO_VERIFICATION",
          reason: `Verifiable evidence found for capability '${step.targetCapability}'. Reconciled to EXECUTED with canonical identity '${canonicalExecutionId}'.`,
          evidenceStatus: "VERIFIED_OCCURRED",
        });
        continue;
      }

      // Case 1 check: Did external execution definitely NEVER begin?
      if (probeResult.status === "VERIFIED_NEVER_STARTED") {
        await this.stateStore.updateStepRecoveryClassification(step.id, "VERIFIED_NEVER_STARTED");
        await this.stateStore.updateMissionLifecycle(mission.id, "PAUSED_RECOVERY");
        results.push({
          missionId: mission.id,
          stepId: step.id,
          triageCase: "KNOWN_NOT_BEGUN",
          actionTaken: "SAFE_TO_DISPATCH",
          reason: `Verifiable proof external execution never began for '${step.targetCapability}'. Classified as VERIFIED_NEVER_STARTED; safe to dispatch upon authorized resume.`,
          evidenceStatus: "VERIFIED_NEVER_STARTED",
          recoveryClassification: "VERIFIED_NEVER_STARTED",
        });
        continue;
      }

      // Case 2: Evidence is UNKNOWN (or probe failed/timed out/ambiguous) -> Replay Safety Gate
      const unknownOutcome = await this.handleUnknownEvidence(
        mission.id,
        step,
        probeResult.reason ?? "Evidence unavailable or ambiguous.",
      );
      results.push(unknownOutcome);
    }

    // Recovery only classifies and reconciles evidence. It NEVER dispatches.
    // Any mission with interrupted work is left explicitly paused.
    if (results.length > 0 && mission.lifecycleState === "RUNNING") {
      await this.stateStore.updateMissionLifecycle(mission.id, "PAUSED_RECOVERY");
    }

    return results;
  }

  private async handleUnknownEvidence(
    missionId: string,
    step: VajraStepRecord,
    baseReason: string,
  ): Promise<RecoveryTriageResult> {
    const fourConditionsMet = this.evaluateFourReplayConditions(step);

    if (fourConditionsMet) {
      await this.stateStore.updateStepRecoveryClassification(step.id, "REPLAY_PERMITTED");
      await this.stateStore.updateMissionLifecycle(missionId, "PAUSED_RECOVERY");
      return {
        missionId,
        stepId: step.id,
        triageCase: "STATE_UNCERTAIN",
        actionTaken: "SAFE_TO_DISPATCH",
        reason: `${baseReason} All four replay-safety conditions met for '${step.targetCapability}'. Classified as REPLAY_PERMITTED.`,
        evidenceStatus: "UNKNOWN",
        recoveryClassification: "REPLAY_PERMITTED",
      };
    } else {
      await this.stateStore.updateStepRecoveryClassification(step.id, "BLOCKED_UNRESOLVED");
      await this.stateStore.updateMissionLifecycle(missionId, "PAUSED_RECOVERY");
      return {
        missionId,
        stepId: step.id,
        triageCase: "STATE_UNCERTAIN",
        actionTaken: "PAUSED_RECOVERY",
        reason: `${baseReason} Replay prohibited for '${step.targetCapability}': four replay conditions not met or side-effects uncertain. Classified as BLOCKED_UNRESOLVED.`,
        evidenceStatus: "UNKNOWN",
        recoveryClassification: "BLOCKED_UNRESOLVED",
      };
    }
  }

  private async queryEvidenceProbe(
    step: VajraStepRecord,
    timeoutMs: number = 3000,
  ): Promise<EvidenceProbeResult> {
    if (!this.evidenceProbe) {
      return {
        status: "UNKNOWN",
        reason: "No evidence probe configured.",
      };
    }

    try {
      const probePromise = (async (): Promise<EvidenceProbeResult> => {
        // Modern interface
        if (typeof this.evidenceProbe!.checkEvidence === "function") {
          return await this.evidenceProbe!.checkEvidence(step);
        }

        // Legacy adapter interface support for existing test suites
        if (typeof this.evidenceProbe!.checkNeverInitiated === "function") {
          const never = await this.evidenceProbe!.checkNeverInitiated(step.id);
          if (never) {
            return { status: "VERIFIED_NEVER_STARTED" };
          }
        }

        if (typeof this.evidenceProbe!.checkExecutionEvidence === "function") {
          const occurred = await this.evidenceProbe!.checkExecutionEvidence(
            step.id,
            step.targetCapability,
          );
          if (occurred) {
            // If caller did not provide canonicalExecutionId, check if step already had one
            const canonicalId = step.executionResultId;
            if (canonicalId && canonicalId.trim() !== "") {
              return {
                status: "VERIFIED_OCCURRED",
                canonicalExecutionId: canonicalId,
              };
            }
            // Without verified canonical ID, fail closed to UNKNOWN
            return {
              status: "UNKNOWN",
              reason:
                "Evidence probe indicated execution occurred but provided no canonical external execution identity.",
            };
          }
        }

        return { status: "UNKNOWN", reason: "Probe returned no positive evidence." };
      })();

      const timeoutPromise = new Promise<EvidenceProbeResult>((resolve) => {
        const timer = setTimeout(() => {
          resolve({
            status: "UNKNOWN",
            reason: `Evidence probe timed out after ${timeoutMs}ms.`,
          });
        }, timeoutMs);
        if (typeof timer.unref === "function") {
          timer.unref();
        }
      });

      return await Promise.race([probePromise, timeoutPromise]);
    } catch (err: any) {
      // Normalize probe errors to UNKNOWN; never crash recovery
      return {
        status: "UNKNOWN",
        reason: `Evidence probe threw exception: ${err?.message ?? String(err)}`,
        details: err,
      };
    }
  }

  private evaluateFourReplayConditions(step: VajraStepRecord): boolean {
    // Condition 1: Enforceable, canonical idempotency key
    if (!isValidIdempotencyKey(step.idempotencyKey)) {
      return false;
    }

    if (!this.capabilityRegistry || !this.capabilityRegistry.has(step.targetCapability)) {
      return false;
    }

    const entry = this.capabilityRegistry.get(step.targetCapability);
    if (!entry) {
      return false;
    }

    const chars = entry.descriptor.executionCharacteristics;

    // Condition 2: Explicit safe replay semantics (must be marked idempotent)
    if (!chars.isIdempotent) {
      return false;
    }

    // Must be authorized for VAJRA
    if (entry.descriptor.permissions.allowVajra === false) {
      return false;
    }

    // Condition 3: Strictly read-only with zero mutating side-effects.
    // Real handlers do not yet enforce key-based deduplication for mutations.
    if (!chars.isReadOnly) {
      return false;
    }

    if (
      chars.sideEffectClass &&
      chars.sideEffectClass !== "none" &&
      chars.sideEffectClass !== "read_only"
    ) {
      return false;
    }

    // Condition 4: Capability is currently available and not declined
    if (!entry.descriptor.isAvailable || entry.declineActivation === true) {
      return false;
    }

    return true;
  }
}
