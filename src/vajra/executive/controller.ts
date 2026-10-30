import { Result, CorrelationMetadata } from "../../contracts/results/result";
import { SelfModel } from "../self-model/self-model";
import { IGenesisPort } from "../boundaries/genesis-port";
import { IAkiraOSPort } from "../boundaries/akira-os-port";
import { IEscalationPort } from "../boundaries/escalation-port";
import { IOperationalStateStore } from "../ports/state-store";
import { CognitiveStimulus } from "../types/stimulus";
import { ExecutiveAction, createExecutiveAction } from "../types/action";
import { OperationalContext } from "../types/operational-context";
import { ICooperativeScheduler, CooperativeTurnScheduler } from "./scheduler";
import { ProactiveRateLimiter } from "./rate-limiter";
import { IReasoningEngine } from "../ports/reasoning";
import { IDecisionArbiter } from "../ports/decision";
import { IMissionAdmissionGateway } from "../mission/admission";
import { IPlanningEngine } from "../ports/planning";
import { IMissionRuntime } from "../mission/runtime";
import { MissionClosureManager } from "../closure/closure-manager";
import { ReasoningContext } from "../reasoning/types";
import { createVajraMissionRecord, createVajraStepRecord } from "../types/mission-record";
import { createMissionState } from "../../contracts/mission/mission-state";

export type VajraLifecycleState =
  | "UNINITIALIZED"
  | "BOOTING"
  | "RUNNING"
  | "STOPPING"
  | "STOPPED";

export interface ExecutiveControllerDependencies {
  readonly selfModel: SelfModel;
  readonly genesisPort: IGenesisPort;
  readonly akiraOSPort: IAkiraOSPort;
  readonly escalationPort: IEscalationPort;
  readonly stateStore?: IOperationalStateStore;
  readonly scheduler?: ICooperativeScheduler;
  readonly rateLimiter?: ProactiveRateLimiter;
  readonly reasoningEngine?: IReasoningEngine;
  readonly decisionArbiter?: IDecisionArbiter;
  readonly admissionGateway?: IMissionAdmissionGateway;
  readonly planningEngine?: IPlanningEngine;
  readonly missionRuntime?: IMissionRuntime;
  readonly closureManager?: MissionClosureManager;
}

/**
 * Executive Controller for the VAJRA brain.
 *
 * Coordinates lifecycle, turn scheduling, rate limits, and the end-to-end
 * cognitive deliberation loop (Reasoning -> Decision Arbiter -> Admission -> Planning -> Runtime -> Closure).
 */
export class ExecutiveController {
  private state: VajraLifecycleState = "UNINITIALIZED";
  private selfModel: SelfModel;
  private genesisPort: IGenesisPort;
  private akiraOSPort: IAkiraOSPort;
  private escalationPort: IEscalationPort;
  private stateStore?: IOperationalStateStore;
  private scheduler: ICooperativeScheduler;
  private rateLimiter: ProactiveRateLimiter;
  private reasoningEngine?: IReasoningEngine;
  private decisionArbiter?: IDecisionArbiter;
  private admissionGateway?: IMissionAdmissionGateway;
  private planningEngine?: IPlanningEngine;
  private missionRuntime?: IMissionRuntime;
  private closureManager?: MissionClosureManager;
  private unsubscribeGenesis?: () => void;

  constructor(deps: ExecutiveControllerDependencies) {
    this.selfModel = deps.selfModel;
    this.genesisPort = deps.genesisPort;
    this.akiraOSPort = deps.akiraOSPort;
    this.escalationPort = deps.escalationPort;
    this.stateStore = deps.stateStore;
    this.scheduler = deps.scheduler ?? new CooperativeTurnScheduler();
    this.rateLimiter =
      deps.rateLimiter ??
      new ProactiveRateLimiter(() => this.selfModel.getPolicy().maxAutonomousRatePerHour);
    this.reasoningEngine = deps.reasoningEngine;
    this.decisionArbiter = deps.decisionArbiter;
    this.admissionGateway = deps.admissionGateway;
    this.planningEngine = deps.planningEngine;
    this.missionRuntime = deps.missionRuntime;
    this.closureManager = deps.closureManager;
  }

  getState(): VajraLifecycleState {
    return this.state;
  }

  getStateStore(): IOperationalStateStore | undefined {
    return this.stateStore;
  }

  getSelfModel(): SelfModel {
    return this.selfModel;
  }

  getOperationalContext(): OperationalContext {
    return this.selfModel.getOperationalContext();
  }

  setOperationalFocus(focus: string): void {
    this.selfModel.updateOperationalContext({ currentFocus: focus });
  }

  async boot(correlation?: CorrelationMetadata): Promise<Result<void, string>> {
    const corr: CorrelationMetadata = correlation ?? {
      requestId: "vajra-boot",
      correlationId: "vajra-boot",
      invocationId: `inv-boot-${Date.now()}`,
    };

    if (this.state === "RUNNING" || this.state === "BOOTING") {
      return Result.failure(`Cannot boot VAJRA; already in state '${this.state}'.`, corr);
    }

    this.state = "BOOTING";

    try {
      // 1. Discover registered capabilities from AKIRA OS and populate SelfModel
      const capabilities = this.akiraOSPort.listAvailableCapabilities();
      for (const cap of capabilities) {
        this.selfModel.registerCapability(cap);
      }

      // 2. Subscribe to cognitive discovery signals from GENESIS
      this.unsubscribeGenesis = this.genesisPort.subscribeToCognitiveDiscoveries((event: unknown) => {
        this.handleCognitiveDiscovery(event);
      });

      // 3. Hydrate operational context and perform crash recovery detection if stateStore provided
      if (this.stateStore) {
        const persistedContext = await this.stateStore.loadOperationalContext();
        if (persistedContext) {
          this.selfModel.updateOperationalContext({
            currentFocus: persistedContext.currentFocus,
            mode: persistedContext.mode,
            activeMissionId: persistedContext.activeMissionId,
            humanPresence: persistedContext.humanPresence,
            systemHealthStatus: persistedContext.systemHealthStatus,
            version: persistedContext.version,
          });
        }

        const recoveryStates = await this.stateStore.detectInterruptedMissions();
        if (recoveryStates.length > 0) {
          const first = recoveryStates[0];
          if (first.interruptedSteps.length > 0) {
            const step = first.interruptedSteps[0];
            await this.stateStore.updateMissionLifecycle(first.mission.id, "PAUSED_RECOVERY");
            this.setOperationalFocus(
              `Interrupted operation detected: step ${step.stepOrder} (${step.targetCapability})`,
            );
            this.selfModel.updateOperationalContext({
              mode: "RECOVERY",
              activeMissionId: first.mission.id,
            });
          } else if (first.pendingEscalations.length > 0) {
            await this.stateStore.updateMissionLifecycle(first.mission.id, "PAUSED_APPROVAL");
            this.setOperationalFocus(
              `Pending human approval required for mission ${first.mission.id}`,
            );
            this.selfModel.updateOperationalContext({
              mode: "PAUSED",
              activeMissionId: first.mission.id,
            });
          }
        } else {
          this.selfModel.updateOperationalContext({
            mode: "REQUEST_DRIVEN",
            systemHealthStatus: "NOMINAL",
          });
        }
      } else {
        this.selfModel.updateOperationalContext({
          mode: "REQUEST_DRIVEN",
          systemHealthStatus: "NOMINAL",
        });
      }

      this.state = "RUNNING";
      return Result.success(undefined, corr);
    } catch (err: any) {
      this.state = "STOPPED";
      return Result.failure(`VAJRA boot failed: ${err?.message ?? String(err)}`, corr);
    }
  }

  async shutdown(correlation?: CorrelationMetadata): Promise<Result<void, string>> {
    const corr: CorrelationMetadata = correlation ?? {
      requestId: "vajra-shutdown",
      correlationId: "vajra-shutdown",
      invocationId: `inv-shutdown-${Date.now()}`,
    };

    if (this.state !== "RUNNING") {
      return Result.failure(`Cannot shutdown VAJRA; not currently running (state: '${this.state}').`, corr);
    }

    this.state = "STOPPING";

    if (this.unsubscribeGenesis) {
      this.unsubscribeGenesis();
      this.unsubscribeGenesis = undefined;
    }

    this.selfModel.updateOperationalContext({
      mode: "PAUSED",
    });

    this.state = "STOPPED";
    return Result.success(undefined, corr);
  }

  async receiveStimulus(
    stimulus: CognitiveStimulus,
  ): Promise<Result<ExecutiveAction, string>> {
    if (this.state !== "RUNNING") {
      return Result.failure(
        `VAJRA cannot accept stimulus; not in RUNNING state (current: '${this.state}').`,
        stimulus.correlation,
      );
    }

    // Rate limit proactive wakeups
    if (stimulus.kind === "scheduled_timer") {
      if (!this.rateLimiter.canAct()) {
        return Result.failure(
          "Rate limit exceeded for proactive execution.",
          stimulus.correlation,
        );
      }
      this.rateLimiter.recordAction();
    }

    // Process turn cooperatively through scheduler
    return this.scheduler.enqueueTurn(async () => {
      // 1. Authoritative Cognitive Deliberation Pipeline (Phases 4–7)
      if (this.reasoningEngine && this.decisionArbiter) {
        const opContext = this.getOperationalContext();
        const activeMission = this.stateStore ? await this.stateStore.getActiveMission() : null;
        const relevantBeliefs = this.stateStore ? await this.stateStore.loadBeliefs() : [];
        const availableCapabilities = this.selfModel.listCapabilities();

        const selfSnapshot = this.selfModel.getSnapshot();
        const reasoningContext: ReasoningContext = {
          stimulus,
          operationalContext: opContext,
          activeMission,
          relevantBeliefs,
          recentObservations: [],
          availableCapabilities,
          selfModelLimits: {
            isDegraded: selfSnapshot.isDegraded,
            degradedReasons: selfSnapshot.degradedReasons,
            knownUnknowns: selfSnapshot.knownUnknowns,
            policyEnvelope: selfSnapshot.policy,
          },
          contextVersion: opContext.version,
          assembledAt: new Date().toISOString(),
        };

        const reasoningResult = await this.reasoningEngine.deliberate(
          reasoningContext,
          stimulus.correlation,
        );
        if (!reasoningResult.ok) {
          return Result.failure(reasoningResult.error, stimulus.correlation);
        }

        const decisionResult = await this.decisionArbiter.arbitrate(
          reasoningResult.value,
          opContext,
          this.selfModel,
          stimulus.correlation,
        );
        if (!decisionResult.ok) {
          return Result.failure(decisionResult.error, stimulus.correlation);
        }

        const action = decisionResult.value;

        // 2. Operational Mission Execution Bridge (Phases 6–7)
        if (
          action.kind === "start_mission" &&
          this.admissionGateway &&
          this.planningEngine &&
          this.missionRuntime &&
          this.stateStore
        ) {
          const admissionOutcome = await this.admissionGateway.admitAction(action, opContext);
          if (admissionOutcome.status !== "ADMITTED") {
            // Admission halted by gate (e.g. PAUSED_APPROVAL, CONCURRENCY_LOCKED, STALE)
            return Result.success(action, stimulus.correlation);
          }

          const targetCap = action.requiredCapability ?? (action as any).targetCapability;
          const templateStep = targetCap
            ? {
                targetCapability: targetCap,
                input: (action.payload as any)?.input ?? {},
                expectedEvidence: `evidence.${targetCap}.ok`,
              }
            : undefined;

          const planResult = await this.planningEngine.createPlan(
            action.intent ?? "Execute operational mission",
            { maxSteps: 5 },
            action.correlation,
            templateStep,
          );
          if (!planResult.ok) {
            return Result.failure(planResult.error, stimulus.correlation);
          }

          const def = planResult.value;
          const missionRecord = createVajraMissionRecord({
            id: def.id,
            objective: def.objective,
            lifecycleState: "CREATED",
            definition: def,
            state: createMissionState({ missionId: def.id, definitionId: def.id }),
            allocatedBudget: { maxCostCents: 10, maxSteps: def.steps.length },
            idempotencyKey: admissionOutcome.idempotencyKey,
            requestId: action.correlation.requestId,
            correlationId: action.correlation.correlationId,
            invocationId: action.correlation.invocationId,
          });

          const stepRecords = def.steps.map((s) =>
            createVajraStepRecord({
              id: s.id,
              missionId: def.id,
              stepOrder: s.stepOrder,
              description: s.description,
              targetCapability: s.targetCapability,
              input: s.input,
              expectedEvidence: s.expectedEvidence,
              idempotencyKey: `idemp-step-${s.id}`,
              correlationId: action.correlation.correlationId,
            }),
          );

          await this.stateStore.createMission(missionRecord, stepRecords);
          await this.missionRuntime.executeMission(def.id);
        }

        return Result.success(action, stimulus.correlation);
      }

      // Phase 2 shell fallback: stimulus ingested and queued; full loop activates when dependencies are wired
      const action = createExecutiveAction({
        id: `act-${stimulus.id}`,
        kind: "wait_and_observe",
        rationale:
          "Phase 2 lifecycle shell: stimulus ingested and queued; full cognitive deliberation loop activates in subsequent phases.",
        confidence: 1.0,
        policyCompliance: true,
        correlation: stimulus.correlation,
      });

      return Result.success(action, stimulus.correlation);
    });
  }

  private handleCognitiveDiscovery(event: unknown): void {
    // In Phase 2: Ingest discovery signal safely without executing operational side-effects
    if (event && typeof event === "object" && "pattern" in event) {
      this.setOperationalFocus(`Investigating cognitive pattern: ${(event as any).pattern}`);
    }
  }
}
