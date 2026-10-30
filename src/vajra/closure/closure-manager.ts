import { IOperationalStateStore } from "../ports/state-store";
import { AkiraEvent } from "../../instrumentation/event-types";
import { createMissionResult, MissionResult } from "../../contracts/capabilities/verification";
import { createBelief, EpistemicBelief } from "../types/belief";
import { MissionLifecycleState } from "../types/mission-record";
import { MissionClosureOptions, MissionClosureResult, BeliefReconciliationReport } from "./types";

/**
 * Decoupled event publisher port for emitting mission completion events.
 */
export interface IMissionEventPublisher {
  publish(event: AkiraEvent): void;
}

/**
 * Concrete Mission Closure Manager.
 *
 * Responsibilities:
 * - Synthesizes Contract K6 MissionResult upon completion of verification.
 * - Transitions vajra_missions lifecycle state in SQLite.
 * - Clears active_mission_id in vajra_operational_state.
 * - Reconciles registered vajra_beliefs strictly via verified evidence (Invariants K-P7-7, I8).
 * - Publishes decoupled domain events on EventBus for GENESIS intake without direct memory writes (Invariant K-P7-8).
 */
export class MissionClosureManager {
  constructor(
    private readonly stateStore: IOperationalStateStore,
    private readonly eventPublisher?: IMissionEventPublisher,
  ) {}

  /**
   * Executes terminal reality closure for a mission.
   */
  async closeMission<TOutcome = unknown>(
    options: MissionClosureOptions<TOutcome>,
  ): Promise<MissionClosureResult<TOutcome>> {
    const mission = await this.stateStore.getMission(options.missionId);
    if (!mission) {
      throw new Error(`Cannot close non-existent mission '${options.missionId}'`);
    }

    const { terminalVerificationRecord } = options;
    const isCompleted = terminalVerificationRecord.outcome === "criteria_satisfied";

    let targetLifecycle: MissionLifecycleState;
    if (isCompleted) {
      targetLifecycle = "COMPLETED";
    } else if (terminalVerificationRecord.outcome === "inconclusive") {
      targetLifecycle = "PAUSED_RECOVERY";
    } else {
      targetLifecycle = "FAILED";
    }

    // 1. Synthesize Contract K6 MissionResult
    const completedAt = new Date().toISOString();
    const missionResult = createMissionResult<TOutcome>({
      missionId: mission.id,
      goalId: mission.definition.goalId,
      status: isCompleted ? "completed" : "not_completed",
      verificationRecordId: terminalVerificationRecord.id,
      outcome: (options.outcomePayload ?? {
        objective: mission.objective,
        verificationOutcome: terminalVerificationRecord.outcome,
        stepsCount: mission.currentStepOrder,
        verifiedEvidenceIds: terminalVerificationRecord.observationIds,
        completedAt,
      }) as TOutcome,
      correlation: {
        requestId: mission.requestId,
        correlationId: mission.correlationId,
        causationId: mission.invocationId,
        invocationId: mission.invocationId,
        missionId: mission.id,
        goalId: mission.definition.goalId,
        verificationRecordId: terminalVerificationRecord.id,
      },
    });

    // 2. Persist mission lifecycle state update in SQLite
    await this.stateStore.updateMissionLifecycle(
      mission.id,
      targetLifecycle,
      isCompleted ? completedAt : null,
    );

    // 3. Clear active_mission_id in vajra_operational_state if active
    await this.clearActiveMissionIfMatching(mission.id);

    // 4. Reconcile registered vajra_beliefs
    const reconciledBeliefs = await this.reconcileRegisteredBeliefs(
      mission.definition.completionCriteria.requiredEvidence,
      options.terminalVerificationRecord.observationIds,
      terminalVerificationRecord.outcome,
    );

    // 5. Emit decoupled domain event on EventBus (GENESIS blast door)
    let eventPublished = false;
    if (this.eventPublisher && options.publishEvent !== false) {
      this.publishMissionCompletionEvent(mission.id, mission.correlationId, missionResult);
      eventPublished = true;
    }

    return {
      missionId: mission.id,
      status: isCompleted ? "completed" : "not_completed",
      missionResult,
      reconciledBeliefs: Object.freeze(reconciledBeliefs),
      eventPublished,
    };
  }

  private async clearActiveMissionIfMatching(missionId: string): Promise<void> {
    const ctx = await this.stateStore.loadOperationalContext();
    if (ctx && ctx.activeMissionId === missionId) {
      await this.stateStore.saveOperationalContext({
        ...ctx,
        activeMissionId: null,
        version: ctx.version,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  private async reconcileRegisteredBeliefs(
    requiredEvidence: readonly string[] | undefined,
    evidenceIds: readonly string[],
    outcome: string,
  ): Promise<BeliefReconciliationReport[]> {
    if (!requiredEvidence || requiredEvidence.length === 0 || evidenceIds.length === 0) {
      return [];
    }

    const reports: BeliefReconciliationReport[] = [];
    const beliefs = await this.stateStore.loadBeliefs();

    for (const belief of beliefs) {
      // Check if belief proposition corresponds to any required evidence token
      const matchesToken = requiredEvidence.some(
        (token) => belief.proposition.includes(token) || token.includes(belief.id),
      );

      if (!matchesToken) {
        continue;
      }

      const previousState = belief.verificationState;

      if (outcome === "criteria_satisfied") {
        // Invariant K-P7-7: If contradictingEvidenceIds is non-empty, can NEVER be VERIFIED
        if (belief.contradictingEvidenceIds.length > 0) {
          continue;
        }

        const newSupporting = Array.from(
          new Set([...belief.supportingEvidenceIds, ...evidenceIds]),
        );

        const updatedBelief: EpistemicBelief = createBelief({
          id: belief.id,
          proposition: belief.proposition,
          confidence: Math.min(1.0, Math.max(belief.confidence, 0.95)),
          verificationState: "VERIFIED",
          supportingEvidenceIds: newSupporting,
          contradictingEvidenceIds: belief.contradictingEvidenceIds,
          lastEvaluatedAt: new Date().toISOString(),
          ttlMs: belief.ttlMs,
        });

        await this.stateStore.saveBelief(updatedBelief);
        reports.push({
          beliefId: belief.id,
          previousState,
          newState: "VERIFIED",
          supportingEvidenceIdsCount: newSupporting.length,
          contradictingEvidenceIdsCount: belief.contradictingEvidenceIds.length,
        });
      } else if (outcome === "criteria_not_satisfied") {
        const newContradicting = Array.from(
          new Set([...belief.contradictingEvidenceIds, ...evidenceIds]),
        );

        const updatedBelief: EpistemicBelief = createBelief({
          id: belief.id,
          proposition: belief.proposition,
          confidence: belief.confidence,
          verificationState: "CONTRADICTED",
          supportingEvidenceIds: belief.supportingEvidenceIds,
          contradictingEvidenceIds: newContradicting,
          lastEvaluatedAt: new Date().toISOString(),
          ttlMs: belief.ttlMs,
        });

        await this.stateStore.saveBelief(updatedBelief);
        reports.push({
          beliefId: belief.id,
          previousState,
          newState: "CONTRADICTED",
          supportingEvidenceIdsCount: belief.supportingEvidenceIds.length,
          contradictingEvidenceIdsCount: newContradicting.length,
        });
      }
    }

    return reports;
  }

  private publishMissionCompletionEvent(
    missionId: string,
    correlationId: string,
    result: MissionResult,
  ): void {
    const event: AkiraEvent = {
      id: `evt-mission-completed-${missionId}`,
      type: "mission.completed",
      timestamp: new Date().toISOString(),
      source: "VAJRA · mission_closure",
      entityId: missionId,
      correlationId,
      payload: {
        missionId,
        status: result.status,
        verificationRecordId: result.verificationRecordId,
        outcome: result.outcome,
      },
      version: 1,
      transient: false,
    };

    this.eventPublisher?.publish(event);
  }
}
