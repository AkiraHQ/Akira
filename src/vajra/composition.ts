import { SqliteOperationalStateStore } from "../persistence/vajra/sqlite-operational-state-store";
import { IOperationalStateStore } from "./ports/state-store";
import { CapabilityRegistry } from "../contracts/capabilities/registry";
import { getCapabilityRegistry } from "../akira-os/capabilities/host";
import { publish } from "../instrumentation/publisher";
import { AkiraEvent } from "../instrumentation/event-types";
import { IAkiraOSPort, LiveAkiraOSAdapter } from "./boundaries/akira-os-port";
import { IGenesisPort, LiveGenesisAdapter } from "./boundaries/genesis-port";
import { memoryService, identityService } from "../genesis";
import { IEscalationPort, LiveEscalationAdapter } from "./boundaries/escalation-port";
import { IHandsPort, UnavailableHandsAdapter, StubHandsAdapter } from "./boundaries/hands-port";
import {
  IModelCoprocessorPort,
  ModelCoprocessorRequest,
  ModelCoprocessorResponse,
  AiProviderCoprocessorAdapter,
} from "./boundaries/model-coprocessor-port";
import { providerRegistry } from "../genesis/context/ai/provider-registry";
import { SelfModel } from "./self-model/self-model";
import { AdaptiveStrategyRouter } from "./reasoning/router";
import { DeterministicPolicyStrategy } from "./reasoning/strategies/deterministic-strategy";
import { EvidenceContradictionStrategy } from "./reasoning/strategies/evidence-contradiction-strategy";
import { ModelAssistedReasoningStrategy } from "./reasoning/strategies/model-assisted-strategy";
import { ReasoningEngine } from "./reasoning/engine";
import { ApprovalManager } from "./decision/approval-manager";
import { DecisionEvaluator } from "./decision/evaluator";
import { DecisionOptionFormulator } from "./decision/option-formulator";
import { DisagreementHandler } from "./decision/disagreement";
import { DecisionArbiter } from "./decision/arbiter";
import { MissionAdmissionGateway } from "./mission/admission";
import { PlanningEngine } from "./mission/planner";
import { CoordinationDispatcher } from "./mission/coordinator";
import { ObservationReceiver } from "./observation/receiver";
import { VerificationEvaluator } from "./verification/evaluator";
import { MissionClosureManager } from "./closure/closure-manager";
import { MissionRuntime } from "./mission/runtime";
import { MissionRecoveryManager } from "./mission/recovery";
import { ExecutiveController, VajraLifecycleState } from "./executive/controller";
import { CorrelationMetadata, Result } from "../contracts/results/result";
import { healthRegistry } from "../observability/health/health-registry";
import { VajraStimulusIngressCoordinator } from "./ingress/coordinator";
import { UserDirectiveIngressAdapter } from "./ingress/adapters/user-directive-adapter";
import { GenesisDiscoveryIngressAdapter } from "./ingress/adapters/genesis-discovery-adapter";
import { PlatformEventIngressAdapter } from "./ingress/adapters/platform-event-adapter";
import { insightEngine } from "../genesis/insights/insight-engine";

/**
 * High-level operational readiness status for the VAJRA runtime.
 */
export type VajraOperationalStatus =
  "UNINITIALIZED" | "BOOTING" | "READY" | "DEGRADED" | "FAILED" | "STOPPED";

/**
 * Detailed status of individual VAJRA subsystems for readiness diagnosis.
 */
export interface VajraSubsystemReadiness {
  readonly coreRuntime: boolean;
  readonly deterministicReasoning: boolean;
  readonly modelAssistedReasoning: boolean;
  readonly missionPlanning: boolean;
  readonly realExecution: boolean;
  readonly recoveryCompleted: boolean;
}

/**
 * Structured diagnostic recording a rollback cleanup step failure.
 */
export interface VajraCleanupFailure {
  readonly name: string;
  readonly error: string;
}

/**
 * Result of a reconciliation attempt on unreconciled cleanup tasks.
 */
export interface ReconciliationResult {
  readonly success: boolean;
  readonly unreconciledCount: number;
  readonly remainingFailures: readonly VajraCleanupFailure[];
}

/**
 * Diagnostic readiness report returned by getVajraReadiness().
 */
export interface VajraReadinessReport {
  readonly status: VajraOperationalStatus;
  readonly isOperational: boolean;
  readonly initialized: boolean;
  readonly controllerState: VajraLifecycleState;
  readonly activeMissionId: string | null;
  readonly operationalMode: string;
  readonly capabilitiesCount: number;
  readonly interruptedMissionsRecovered: number;
  readonly subsystems: VajraSubsystemReadiness;
  readonly degradedReasons: readonly string[];
  readonly cleanupFailures?: readonly VajraCleanupFailure[];
  readonly unreconciledTaskNames?: readonly string[];
  readonly hasUnreconciledCleanup: boolean;
  readonly failureReason?: string;
}

/**
 * Injection options for configuring the VAJRA composition root.
 * Enables dependency substitution during isolated testing while defaulting to
 * production singletons and adapters in live environments.
 */
export interface VajraCompositionOptions {
  /** Operational state store override (e.g. wrapping an in-memory database for testing) */
  readonly stateStore?: IOperationalStateStore;
  /** Canonical capability registry override */
  readonly capabilityRegistry?: CapabilityRegistry;
  /** Event publisher override (e.g. isolated EventBus in tests) */
  readonly eventPublisher?: { publish: (event: AkiraEvent) => void };
  /** GENESIS cognitive port override */
  readonly genesisPort?: IGenesisPort;
  /** AKIRA OS capability mediation port override */
  readonly akiraOSPort?: IAkiraOSPort;
  /** Human escalation port override */
  readonly escalationPort?: IEscalationPort;
  /** Model coprocessor port override */
  readonly coprocessorPort?: IModelCoprocessorPort;
  /** HANDS boundary port override */
  readonly handsPort?: IHandsPort;
  /** SelfModel instance override */
  readonly selfModel?: SelfModel;
  /** Bypass crash recovery detection on boot (defaults to false) */
  readonly skipRecovery?: boolean;
  /** Testing hook: additional cleanup tasks to verify LIFO rollback and fault resilience */
  readonly testCleanupTasks?: readonly CleanupTask[];
  /** Enable/disable background ingress adapters (defaults to true) */
  readonly enableIngress?: boolean;
  /** Ingress coordinator override */
  readonly ingressCoordinator?: VajraStimulusIngressCoordinator;
  /** User directive adapter override */
  readonly userDirectiveAdapter?: UserDirectiveIngressAdapter;
  /** GENESIS discovery adapter override */
  readonly genesisDiscoveryAdapter?: GenesisDiscoveryIngressAdapter;
  /** Platform event adapter override */
  readonly platformEventAdapter?: PlatformEventIngressAdapter;
}

/**
 * Safe fail-closed model coprocessor adapter used when no AI provider is registered.
 */
export class DisabledModelCoprocessorAdapter implements IModelCoprocessorPort {
  async invokeStructuredCoprocessor<TResponse>(
    request: ModelCoprocessorRequest<TResponse>,
  ): Promise<Result<ModelCoprocessorResponse<TResponse>, string>> {
    return Result.failure(
      "No active AI provider configured in providerRegistry; model coprocessor is disabled (fail-closed).",
      request.correlation,
    );
  }
}

export interface CleanupTask {
  readonly name: string;
  readonly cleanup: () => Promise<void> | void;
}

// Subsystem composition state
let activeController: ExecutiveController | null = null;
let operationalStatus: VajraOperationalStatus = "UNINITIALIZED";
let isInitializing = false;
let lastRecoveryCount = 0;
let lastFailureReason: string | undefined;
let hasUnreconciledCleanup = false;
let lastCleanupFailures: VajraCleanupFailure[] = [];
const unreconciledCleanupTasks = new Map<string, CleanupTask>();

let activeIngressCoordinator: VajraStimulusIngressCoordinator | null = null;
let activeUserDirectiveAdapter: UserDirectiveIngressAdapter | null = null;
let activeGenesisDiscoveryAdapter: GenesisDiscoveryIngressAdapter | null = null;
let activePlatformEventAdapter: PlatformEventIngressAdapter | null = null;

export function getVajraIngressCoordinator(): VajraStimulusIngressCoordinator | null {
  return activeIngressCoordinator;
}

export function getUserDirectiveAdapter(): UserDirectiveIngressAdapter | null {
  return activeUserDirectiveAdapter;
}

export function getGenesisDiscoveryAdapter(): GenesisDiscoveryIngressAdapter | null {
  return activeGenesisDiscoveryAdapter;
}

export function getPlatformEventAdapter(): PlatformEventIngressAdapter | null {
  return activePlatformEventAdapter;
}

let currentSubsystems: VajraSubsystemReadiness = {
  coreRuntime: false,
  deterministicReasoning: false,
  modelAssistedReasoning: false,
  missionPlanning: false,
  realExecution: false,
  recoveryCompleted: false,
};
let currentDegradedReasons: string[] = [];

/**
 * Initializes and wires the complete VAJRA production runtime.
 *
 * Responsibilities:
 * 1. Validates and wires all Phase 2–7 components without fallback shells.
 * 2. Triages and recovers interrupted in-flight missions prior to marking operational.
 * 3. Boots the ExecutiveController into the RUNNING state.
 * 4. Implements LIFO rollback on partial failure, preserving shared infrastructure.
 * 5. Prevents duplicate initialization (idempotent).
 */
export async function initializeVajraRuntime(
  options?: VajraCompositionOptions,
): Promise<ExecutiveController> {
  // Guard against retrying when previous cleanup had unreconciled failures
  if (unreconciledCleanupTasks.size > 0 || hasUnreconciledCleanup) {
    const taskNames = Array.from(unreconciledCleanupTasks.keys());
    throw new Error(
      `VAJRA initialization blocked: ${unreconciledCleanupTasks.size} unreconciled cleanup failure(s) (${taskNames.join(", ")}). Reconcile resources before retrying.`,
    );
  }

  // Idempotency check: if already active and running, return existing controller
  if (activeController !== null && activeController.getState() === "RUNNING") {
    return activeController;
  }

  if (isInitializing) {
    throw new Error("VAJRA initialization is already in progress.");
  }

  isInitializing = true;
  operationalStatus = "BOOTING";
  lastFailureReason = undefined;

  const cleanupStack: CleanupTask[] = [];

  try {
    // 0. Validate mandatory host dependencies
    if (options && "stateStore" in options && !options.stateStore) {
      throw new Error("Mandatory dependency 'stateStore' cannot be null or undefined.");
    }
    if (options && "capabilityRegistry" in options && !options.capabilityRegistry) {
      throw new Error("Mandatory dependency 'capabilityRegistry' cannot be null or undefined.");
    }
    if (options && "akiraOSPort" in options && !options.akiraOSPort) {
      throw new Error("Mandatory dependency 'akiraOSPort' cannot be null or undefined.");
    }
    if (options && "genesisPort" in options && !options.genesisPort) {
      throw new Error("Mandatory dependency 'genesisPort' cannot be null or undefined.");
    }
    if (options && "escalationPort" in options && !options.escalationPort) {
      throw new Error("Mandatory dependency 'escalationPort' cannot be null or undefined.");
    }

    // 1. Resolve operational persistence store
    const stateStore = options?.stateStore ?? new SqliteOperationalStateStore();

    // 2. Resolve platform ports and adapters
    const capabilityRegistry = options?.capabilityRegistry ?? getCapabilityRegistry();
    const eventPublisher = options?.eventPublisher ?? { publish };

    const akiraOSPort = options?.akiraOSPort ?? new LiveAkiraOSAdapter(capabilityRegistry);
    const genesisPort =
      options?.genesisPort ??
      new LiveGenesisAdapter(memoryService as any, identityService as any, (l) =>
        insightEngine.subscribe(l as any),
      );
    const escalationPort =
      options?.escalationPort ?? new LiveEscalationAdapter({ stateStore, eventPublisher });

    // Model coprocessor: use explicit port if provided, otherwise check providerRegistry
    let coprocessorPort: IModelCoprocessorPort;
    if (options?.coprocessorPort) {
      coprocessorPort = options.coprocessorPort;
    } else {
      const activeProvider = providerRegistry.getActiveProvider();
      coprocessorPort = activeProvider
        ? new AiProviderCoprocessorAdapter(activeProvider)
        : new DisabledModelCoprocessorAdapter();
    }

    // HANDS execution port: strictly unavailable in Phase 8A (physical sandbox execution disallowed)
    const handsPort = options?.handsPort ?? new UnavailableHandsAdapter();

    if (options?.testCleanupTasks) {
      for (const task of options.testCleanupTasks) {
        cleanupStack.push(task);
      }
    }

    // 3. Initialize SelfModel and register discovered capabilities
    const selfModel = options?.selfModel ?? new SelfModel();
    const availableCapabilities = akiraOSPort.listAvailableCapabilities();
    for (const cap of availableCapabilities) {
      selfModel.registerCapability(cap);
    }

    // 4. Construct Phase 4: Adaptive Reasoning Engine
    const router = new AdaptiveStrategyRouter();
    router.registerStrategy(new DeterministicPolicyStrategy());
    router.registerStrategy(new EvidenceContradictionStrategy());
    router.registerStrategy(new ModelAssistedReasoningStrategy(coprocessorPort));

    const reasoningEngine = new ReasoningEngine({
      router,
      stateStore,
    });

    // 5. Construct Phase 5: Decision Arbiter & Approval Management
    const approvalManager = new ApprovalManager(stateStore, escalationPort);
    const decisionEvaluator = new DecisionEvaluator();
    const decisionOptionFormulator = new DecisionOptionFormulator();
    const disagreementHandler = new DisagreementHandler();

    const decisionArbiter = new DecisionArbiter(
      stateStore,
      decisionEvaluator,
      decisionOptionFormulator,
      disagreementHandler,
      approvalManager,
    );

    // 6. Construct Phase 6: Mission Admission, Planning, Coordination & Runtime
    const admissionGateway = new MissionAdmissionGateway(
      stateStore,
      capabilityRegistry,
      approvalManager,
    );

    const planningEngine = new PlanningEngine(capabilityRegistry, coprocessorPort, stateStore);

    const coordinator = new CoordinationDispatcher(akiraOSPort);

    // 7. Construct Phase 7: Observation Receiver, Verification Evaluator & Reality Closure
    const observationReceiver = new ObservationReceiver();
    const verificationEvaluator = new VerificationEvaluator(stateStore);
    const closureManager = new MissionClosureManager(stateStore, eventPublisher);

    const missionRuntime = new MissionRuntime(
      stateStore,
      coordinator,
      observationReceiver,
      verificationEvaluator,
      closureManager,
    );

    // 8. Construct Phase 6 Recovery Manager
    const recoveryManager = new MissionRecoveryManager(stateStore, capabilityRegistry);

    // 9. Construct ExecutiveController with full Phase 2–7 dependency graph
    const controller = new ExecutiveController({
      selfModel,
      genesisPort,
      akiraOSPort,
      escalationPort,
      stateStore,
      reasoningEngine,
      decisionArbiter,
      admissionGateway,
      planningEngine,
      missionRuntime,
      closureManager,
    });

    // Register controller shutdown in rollback stack in case later steps fail
    cleanupStack.push({
      name: "controller-shutdown",
      cleanup: async () => {
        if (
          controller.getState() === "RUNNING" ||
          (controller.getState() === "STOPPED" && !controller.isTeardownReconciled())
        ) {
          const shutdownRes = await controller.shutdown();
          if (!shutdownRes.ok) {
            throw new Error(shutdownRes.error);
          }
        }
      },
    });

    // 10. Execute Crash Recovery Triaging BEFORE declaring runtime operational
    if (!options?.skipRecovery) {
      const triageResults = await recoveryManager.recoverInterruptedMissions();
      lastRecoveryCount = triageResults.length;
      if (triageResults.length > 0) {
        console.info(
          `[VajraComposition] Triaged ${triageResults.length} interrupted mission(s) on startup.`,
        );
      }
    } else {
      lastRecoveryCount = 0;
    }

    // 11. Boot Executive Controller
    const bootResult = await controller.boot();
    if (!bootResult.ok) {
      throw new Error(`Failed to boot ExecutiveController: ${bootResult.error}`);
    }

    // 12. Evaluate subsystem readiness and determine operational status
    const isModelAvailable =
      coprocessorPort !== undefined &&
      !(coprocessorPort instanceof DisabledModelCoprocessorAdapter);
    const isRealExecutionAvailable = handsPort.isAvailable();
    const isPlanningAvailable = true;
    const isDeterministicAvailable = true;
    const isRecoveryDone = !options?.skipRecovery;

    const degraded: string[] = [];
    if (!isModelAvailable) {
      degraded.push("Model-assisted reasoning coprocessor is offline or unconfigured.");
    }
    if (!isRealExecutionAvailable) {
      degraded.push(
        "Physical sandbox execution (HANDS) is unavailable; capability execution is constrained to AKIRA OS.",
      );
    }

    activeController = controller;
    currentSubsystems = {
      coreRuntime: true,
      deterministicReasoning: isDeterministicAvailable,
      modelAssistedReasoning: isModelAvailable,
      missionPlanning: isPlanningAvailable,
      realExecution: isRealExecutionAvailable,
      recoveryCompleted: isRecoveryDone,
    };
    currentDegradedReasons = degraded;
    operationalStatus = degraded.length > 0 ? "DEGRADED" : "READY";
    hasUnreconciledCleanup = false;
    lastCleanupFailures = [];

    // 13. Attach Production Ingress Adapters
    if (options?.enableIngress !== false) {
      const coordinator =
        options?.ingressCoordinator ?? new VajraStimulusIngressCoordinator(async () => controller);
      coordinator.attach();

      const userDirectiveAdapter =
        options?.userDirectiveAdapter ?? new UserDirectiveIngressAdapter(coordinator);
      userDirectiveAdapter.attach();

      const genesisDiscoveryAdapter =
        options?.genesisDiscoveryAdapter ??
        new GenesisDiscoveryIngressAdapter(coordinator, (l) => insightEngine.subscribe(l as any));
      genesisDiscoveryAdapter.attach();

      const platformEventAdapter =
        options?.platformEventAdapter ?? new PlatformEventIngressAdapter(coordinator);
      platformEventAdapter.attach();

      cleanupStack.push({
        name: "ingress-teardown",
        cleanup: async () => {
          platformEventAdapter.detach();
          genesisDiscoveryAdapter.detach();
          userDirectiveAdapter.detach();
          coordinator.detach();
          activeIngressCoordinator = null;
          activeUserDirectiveAdapter = null;
          activeGenesisDiscoveryAdapter = null;
          activePlatformEventAdapter = null;
        },
      });

      activeIngressCoordinator = coordinator;
      activeUserDirectiveAdapter = userDirectiveAdapter;
      activeGenesisDiscoveryAdapter = genesisDiscoveryAdapter;
      activePlatformEventAdapter = platformEventAdapter;
    }

    try {
      healthRegistry.register("vajra", { criticalAfterConsecutiveFailures: 3 });
      healthRegistry.recordSuccess("vajra");
    } catch {
      // Observability registration is additive and never interrupts composition
    }

    return controller;
  } catch (err: any) {
    operationalStatus = "FAILED";
    lastFailureReason = err?.message ?? String(err);
    console.error("[VajraComposition] Initialization failed. Rolling back partial state...", err);

    currentSubsystems = {
      coreRuntime: false,
      deterministicReasoning: false,
      modelAssistedReasoning: false,
      missionPlanning: false,
      realExecution: false,
      recoveryCompleted: false,
    };
    currentDegradedReasons = [];
    lastCleanupFailures = [];

    try {
      healthRegistry.register("vajra", { criticalAfterConsecutiveFailures: 3 });
      healthRegistry.recordFailure("vajra", err);
    } catch {
      // Best-effort health reporting
    }

    // Execute rollback stack in reverse (LIFO) order
    const rollbackFailures: VajraCleanupFailure[] = [];
    while (cleanupStack.length > 0) {
      const task = cleanupStack.pop()!;
      try {
        await task.cleanup();
        unreconciledCleanupTasks.delete(task.name);
      } catch (rollbackErr: any) {
        const error = rollbackErr?.message ?? String(rollbackErr);
        console.error(
          `[VajraComposition] Error executing rollback step '${task.name}':`,
          rollbackErr,
        );
        rollbackFailures.push({ name: task.name, error });
        unreconciledCleanupTasks.set(task.name, task);
      }
    }

    lastCleanupFailures = Array.from(unreconciledCleanupTasks.entries()).map(([name, _task]) => {
      const match = rollbackFailures.find((f) => f.name === name);
      return match ?? { name, error: "Unreconciled cleanup task" };
    });
    hasUnreconciledCleanup = unreconciledCleanupTasks.size > 0;

    activeController = null;
    throw err;
  } finally {
    isInitializing = false;
  }
}

/**
 * Re-attempts execution of all unresolved cleanup tasks.
 * Never clears failure diagnostics unless the cleanup action actually succeeds.
 * Safe to call repeatedly; tasks that already succeeded are never re-executed.
 */
export async function reconcileVajraCleanup(): Promise<ReconciliationResult> {
  if (unreconciledCleanupTasks.size === 0) {
    hasUnreconciledCleanup = false;
    lastCleanupFailures = [];
    return {
      success: true,
      unreconciledCount: 0,
      remainingFailures: [],
    };
  }

  const tasksToReconcile = Array.from(unreconciledCleanupTasks.entries());
  const remainingFailures: VajraCleanupFailure[] = [];

  for (const [name, task] of tasksToReconcile) {
    try {
      await task.cleanup();
      // Cleanup succeeded on this reconciliation pass! Remove task from unreconciled set
      unreconciledCleanupTasks.delete(name);
    } catch (err: any) {
      const error = err?.message ?? String(err);
      console.error(`[VajraComposition] Reconciliation failed for step '${name}':`, err);
      remainingFailures.push({ name, error });
    }
  }

  lastCleanupFailures = remainingFailures;
  hasUnreconciledCleanup = unreconciledCleanupTasks.size > 0;

  return {
    success: unreconciledCleanupTasks.size === 0,
    unreconciledCount: unreconciledCleanupTasks.size,
    remainingFailures,
  };
}

/**
 * Gracefully shuts down the active VAJRA runtime.
 * Symmetrical to initialization; preserves shared database, registry, and event bus.
 */
export async function shutdownVajraRuntime(options?: {
  correlation?: CorrelationMetadata;
  force?: boolean;
}): Promise<void> {
  // If force mode is requested, re-attempt reconciliation on all remaining unreconciled cleanup tasks
  if (options?.force && unreconciledCleanupTasks.size > 0) {
    await reconcileVajraCleanup();
  }

  operationalStatus = "STOPPED";
  currentSubsystems = {
    coreRuntime: false,
    deterministicReasoning: false,
    modelAssistedReasoning: false,
    missionPlanning: false,
    realExecution: false,
    recoveryCompleted: false,
  };
  currentDegradedReasons = [];

  // Detach background ingress adapters first so no new stimuli enter during shutdown
  if (activePlatformEventAdapter) activePlatformEventAdapter.detach();
  if (activeGenesisDiscoveryAdapter) activeGenesisDiscoveryAdapter.detach();
  if (activeUserDirectiveAdapter) activeUserDirectiveAdapter.detach();
  if (activeIngressCoordinator) activeIngressCoordinator.detach();
  activePlatformEventAdapter = null;
  activeGenesisDiscoveryAdapter = null;
  activeUserDirectiveAdapter = null;
  activeIngressCoordinator = null;

  if (!activeController) {
    return;
  }

  const controllerToShutdown = activeController;
  activeController = null;

  try {
    if (
      controllerToShutdown.getState() === "RUNNING" ||
      (controllerToShutdown.getState() === "STOPPED" &&
        !controllerToShutdown.isTeardownReconciled())
    ) {
      const shutdownResult = await controllerToShutdown.shutdown(options?.correlation);
      if (!shutdownResult.ok) {
        const error = shutdownResult.error;
        lastCleanupFailures.push({ name: "controller-shutdown", error });
        unreconciledCleanupTasks.set("controller-shutdown", {
          name: "controller-shutdown",
          cleanup: async () => {
            const res = await controllerToShutdown.shutdown(options?.correlation);
            if (!res.ok) {
              throw new Error(res.error);
            }
          },
        });
        hasUnreconciledCleanup = true;
        operationalStatus = "FAILED";
        throw new Error(`VAJRA shutdown failed: ${error}`);
      }
    }
  } catch (err) {
    operationalStatus = "FAILED";
    throw err;
  }
}

/**
 * Test-only utility to force-reset composition root state between isolated unit tests.
 */
export function _resetCompositionStateForTesting(): void {
  if (activePlatformEventAdapter) activePlatformEventAdapter.detach();
  if (activeGenesisDiscoveryAdapter) activeGenesisDiscoveryAdapter.detach();
  if (activeUserDirectiveAdapter) activeUserDirectiveAdapter.detach();
  if (activeIngressCoordinator) activeIngressCoordinator.detach();
  activePlatformEventAdapter = null;
  activeGenesisDiscoveryAdapter = null;
  activeUserDirectiveAdapter = null;
  activeIngressCoordinator = null;

  activeController = null;
  operationalStatus = "UNINITIALIZED";
  isInitializing = false;
  lastRecoveryCount = 0;
  lastFailureReason = undefined;
  hasUnreconciledCleanup = false;
  lastCleanupFailures = [];
  unreconciledCleanupTasks.clear();
  currentSubsystems = {
    coreRuntime: false,
    deterministicReasoning: false,
    modelAssistedReasoning: false,
    missionPlanning: false,
    realExecution: false,
    recoveryCompleted: false,
  };
  currentDegradedReasons = [];
}

/**
 * Retrieves the currently active, operational ExecutiveController.
 * Throws if the runtime has not been initialized or is not in a READY or DEGRADED state.
 */
export function getVajraController(): ExecutiveController {
  if (!activeController || (operationalStatus !== "READY" && operationalStatus !== "DEGRADED")) {
    throw new Error(
      `VAJRA runtime is not operational (current status: '${operationalStatus}'). Call initializeVajraRuntime() first.`,
    );
  }
  return activeController;
}

/**
 * Returns a diagnostic report describing the operational readiness of VAJRA.
 */
export function getVajraReadiness(): VajraReadinessReport {
  const isOperational =
    (operationalStatus === "READY" || operationalStatus === "DEGRADED") &&
    activeController?.getState() === "RUNNING";

  return {
    status: operationalStatus,
    isOperational,
    initialized: activeController !== null,
    controllerState: activeController?.getState() ?? "UNINITIALIZED",
    activeMissionId: activeController?.getOperationalContext().activeMissionId ?? null,
    operationalMode: activeController?.getOperationalContext().mode ?? "UNKNOWN",
    capabilitiesCount: activeController?.getSelfModel().listCapabilities().length ?? 0,
    interruptedMissionsRecovered: lastRecoveryCount,
    subsystems: {
      ...currentSubsystems,
      coreRuntime: isOperational,
    },
    degradedReasons: [...currentDegradedReasons],
    cleanupFailures: lastCleanupFailures.length > 0 ? [...lastCleanupFailures] : undefined,
    unreconciledTaskNames:
      unreconciledCleanupTasks.size > 0 ? Array.from(unreconciledCleanupTasks.keys()) : undefined,
    hasUnreconciledCleanup,
    failureReason: lastFailureReason,
  };
}

/**
 * Checks whether the VAJRA runtime has an active controller.
 */
export function isVajraInitialized(): boolean {
  return (
    activeController !== null && (operationalStatus === "READY" || operationalStatus === "DEGRADED")
  );
}
