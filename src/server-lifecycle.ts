// Client-side prevention guard
if (typeof window !== "undefined") {
  throw new Error("src/server-lifecycle.ts must only be loaded on the server side.");
}

import { initializeDatabase } from "./persistence/initializer";
import { initializeGenesisCognition } from "./genesis/composition";
import { getCapabilityRegistry } from "./akira-os/capabilities/host";
import { initializeObservability, shutdownObservability } from "./observability/composition";
import {
  initializeVajraRuntime,
  shutdownVajraRuntime,
  getVajraReadiness,
  isVajraInitialized,
  getVajraController,
  _resetCompositionStateForTesting,
  VajraOperationalStatus,
  VajraReadinessReport,
  VajraCompositionOptions,
  getVajraIngressCoordinator,
} from "./vajra/composition";
import { ExecutiveController } from "./vajra/executive/controller";
import { CorrelationMetadata } from "./contracts/results/result";

export type ServerSubsystem = "sqlite" | "genesis" | "capabilities" | "observability" | "vajra";

/**
 * Diagnostic multi-tier readiness report representing application, persistence,
 * and VAJRA cognitive runtime operational statuses.
 */
export interface ApplicationReadiness {
  readonly processLive: boolean;
  readonly applicationReady: boolean;
  readonly sqliteReady: boolean;
  readonly genesisReady: boolean;
  readonly capabilitiesReady: boolean;
  readonly observabilityReady: boolean;
  readonly vajraReady: boolean;
  readonly missionExecutionReady: boolean;
  readonly vajraStatus: VajraOperationalStatus;
  readonly vajraReadiness?: VajraReadinessReport;
  readonly isDegraded?: boolean;
  readonly degradedReasons?: readonly string[];
  readonly hasUnresolvedRecovery?: boolean;
  readonly failedSubsystem?: ServerSubsystem;
  readonly error?: string;
  readonly timestamp: string;
}

export interface ServerLifecycleOptions {
  readonly initializeDatabase?: () => void;
  readonly initializeGenesis?: () => void;
  readonly initializeCapabilities?: () => void;
  readonly initializeObservability?: () => void;
  readonly initializeVajra?: (options?: VajraCompositionOptions) => Promise<ExecutiveController>;
  readonly vajraOptions?: VajraCompositionOptions;
}

export interface ServerShutdownOptions {
  readonly correlation?: CorrelationMetadata;
  readonly force?: boolean;
  readonly timeoutMs?: number;
  readonly shutdownVajra?: (options?: {
    correlation?: CorrelationMetadata;
    force?: boolean;
    timeoutMs?: number;
  }) => Promise<void>;
  readonly shutdownObservability?: () => void;
}

// Lifecycle singletons
let startupPromise: Promise<ApplicationReadiness> | null = null;
let shutdownPromise: Promise<void> | null = null;
let isShuttingDown = false;
let isShutdown = false;
let lastReadiness: ApplicationReadiness | null = null;
let activeLifecycleController: ExecutiveController | null = null;

let signalHandlersRegistered = false;
let registeredSignalTarget: NodeJS.EventEmitter | null = null;
let sigtermListener: (() => void) | null = null;
let sigintListener: (() => void) | null = null;

/**
 * Initializes AKIRA's server subsystems in exact dependency order:
 * 1. SQLite Database & Migrations
 * 2. GENESIS Cognition Pipeline
 * 3. Shared Host Capability Registry
 * 4. Observability & Telemetry Bus Observer
 * 5. VAJRA Production Composition Root (Recovery + Boot)
 *
 * Uses a single shared startup promise to eliminate startup race conditions
 * and guarantee all concurrent requests await identical initialization.
 */
export async function initializeServer(
  options?: ServerLifecycleOptions,
): Promise<ApplicationReadiness> {
  if (startupPromise) {
    return startupPromise;
  }

  isShutdown = false;
  isShuttingDown = false;

  startupPromise = (async (): Promise<ApplicationReadiness> => {
    let sqliteReady = false;
    let genesisReady = false;
    let capabilitiesReady = false;
    let observabilityReady = false;
    let vajraReady = false;
    let missionExecutionReady = false;
    let vajraStatus: VajraOperationalStatus = "UNINITIALIZED";
    let vajraReport: VajraReadinessReport | undefined;

    // 1. SQLite Database Initialization & Migrations
    const initDb = options?.initializeDatabase ?? initializeDatabase;
    try {
      initDb();
      sqliteReady = true;
    } catch (err: any) {
      const errorMsg = err?.message ?? String(err);
      console.error(
        "[ServerLifecycle] Critical: Failed to initialize SQLite database on startup:",
        err,
      );
      const report: ApplicationReadiness = {
        processLive: true,
        applicationReady: false,
        sqliteReady: false,
        genesisReady: false,
        capabilitiesReady: false,
        observabilityReady: false,
        vajraReady: false,
        missionExecutionReady: false,
        vajraStatus: "UNINITIALIZED",
        failedSubsystem: "sqlite",
        error: errorMsg,
        timestamp: new Date().toISOString(),
      };
      lastReadiness = report;
      return report;
    }

    // 2. GENESIS Cognition Initialization (idempotent, activates cognitive processors)
    const initGenesis = options?.initializeGenesis ?? initializeGenesisCognition;
    try {
      initGenesis();
      genesisReady = true;
    } catch (err: any) {
      console.error("[ServerLifecycle] Warning: GENESIS cognition initialization error:", err);
    }

    // 3. Shared Capability Registry (canonical host singleton)
    const initCaps = options?.initializeCapabilities ?? getCapabilityRegistry;
    try {
      initCaps();
      capabilitiesReady = true;
    } catch (err: any) {
      console.error("[ServerLifecycle] Warning: Capability registry initialization error:", err);
    }

    // 4. Observability Subsystem (health registry, bus delivery observer)
    const initObs = options?.initializeObservability ?? initializeObservability;
    try {
      initObs();
      observabilityReady = true;
    } catch (err: any) {
      console.error("[ServerLifecycle] Warning: Observability initialization error:", err);
    }

    // 5. VAJRA Production Runtime Initialization
    const initVajra = options?.initializeVajra ?? initializeVajraRuntime;
    try {
      const controller = await initVajra(options?.vajraOptions);
      activeLifecycleController = controller;

      if (isVajraInitialized()) {
        vajraReport = getVajraReadiness();
        vajraStatus = vajraReport.status;
        vajraReady = vajraReport.isOperational;
        missionExecutionReady = vajraReport.subsystems.realExecution;
      } else {
        const isRunning = controller.getState() === "RUNNING";
        vajraStatus = isRunning ? "READY" : "FAILED";
        vajraReady = isRunning;
        missionExecutionReady = false;
        vajraReport = {
          status: vajraStatus,
          isOperational: vajraReady,
          initialized: isRunning,
          controllerState: controller.getState(),
          activeMissionId: null,
          operationalMode: controller.getOperationalContext().mode,
          capabilitiesCount: controller.getSelfModel().listCapabilities().length,
          interruptedMissionsRecovered: 0,
          hasUnresolvedRecovery: false,
          subsystems: {
            coreRuntime: isRunning,
            deterministicReasoning: isRunning,
            modelAssistedReasoning: false,
            missionPlanning: isRunning,
            realExecution: false,
            recoveryCompleted: true,
          },
          degradedReasons: [],
          hasUnreconciledCleanup: false,
        };
      }
    } catch (err: any) {
      const errorMsg = err?.message ?? String(err);
      console.error("[ServerLifecycle] Failed to initialize VAJRA runtime:", err);
      const report: ApplicationReadiness = {
        processLive: true,
        applicationReady: true, // Non-VAJRA application endpoints remain serviceable
        sqliteReady,
        genesisReady,
        capabilitiesReady,
        observabilityReady,
        vajraReady: false,
        missionExecutionReady: false,
        vajraStatus: "FAILED",
        vajraReadiness: getVajraReadiness(),
        failedSubsystem: "vajra",
        error: errorMsg,
        timestamp: new Date().toISOString(),
      };
      lastReadiness = report;
      return report;
    }

    const report: ApplicationReadiness = {
      processLive: true,
      applicationReady: true,
      sqliteReady,
      genesisReady,
      capabilitiesReady,
      observabilityReady,
      vajraReady,
      missionExecutionReady,
      vajraStatus,
      vajraReadiness: vajraReport,
      timestamp: new Date().toISOString(),
    };
    lastReadiness = report;
    return report;
  })();

  return startupPromise;
}

/**
 * Ensures the server has finished its startup barrier.
 * Safe for concurrent invocation by incoming requests.
 */
export async function ensureServerStarted(
  options?: ServerLifecycleOptions,
): Promise<ApplicationReadiness> {
  if (!startupPromise) {
    return initializeServer(options);
  }
  return startupPromise;
}

/**
 * Retrieves the operational ExecutiveController instance once startup completes.
 * Fails closed if VAJRA initialization failed or has not completed.
 */
export async function getOperationalVajraController(): Promise<ExecutiveController> {
  const readiness = await ensureServerStarted();
  if (!readiness.vajraReady) {
    throw new Error(
      `VAJRA is not operationally ready (status: '${readiness.vajraStatus}', error: ${readiness.error ?? "initialization incomplete"}).`,
    );
  }
  if (activeLifecycleController) {
    return activeLifecycleController;
  }
  return getVajraController();
}

export { getVajraIngressCoordinator };

/**
 * Evaluates whether VAJRA can safely admit and execute new operational missions.
 *
 * Invariants:
 * - Server must not be shutting down or shut down.
 * - Host application and SQLite must be operational.
 * - VAJRA cognitive runtime must be operational (isOperational === true).
 * - No unresolved recovery mission can be active (hasUnresolvedRecovery !== true).
 * - System health must not be CRITICAL (Gate 5 admission gate).
 * - Note: Physical sandbox (HANDS) unavailability alone does not block admission;
 *   AKIRA OS software capabilities can execute safely in degraded mode.
 */
export function isMissionAdmissionReady(): boolean {
  if (isServerShuttingDown() || isServerShutdown()) {
    return false;
  }
  const appReadiness = getApplicationReadiness();
  if (!appReadiness.applicationReady || !appReadiness.vajraReady) {
    return false;
  }
  const vajraReport = appReadiness.vajraReadiness;
  if (!vajraReport || !vajraReport.isOperational) {
    return false;
  }
  if (vajraReport.hasUnresolvedRecovery) {
    return false;
  }
  if (activeLifecycleController?.getOperationalContext().systemHealthStatus === "CRITICAL") {
    return false;
  }
  return true;
}

/**
 * Dynamic snapshot of current application and subsystem readiness.
 * Produces a side-effect-free, live projection of operational status.
 */
export function getApplicationReadiness(): ApplicationReadiness {
  const timestamp = new Date().toISOString();

  if (!lastReadiness) {
    return {
      processLive: true,
      applicationReady: false,
      sqliteReady: false,
      genesisReady: false,
      capabilitiesReady: false,
      observabilityReady: false,
      vajraReady: false,
      missionExecutionReady: false,
      vajraStatus: "UNINITIALIZED",
      isDegraded: false,
      degradedReasons: [],
      hasUnresolvedRecovery: false,
      timestamp,
    };
  }

  if (isServerShuttingDown() || isServerShutdown()) {
    return {
      ...lastReadiness,
      processLive: true,
      applicationReady: false,
      vajraReady: false,
      missionExecutionReady: false,
      vajraStatus: "STOPPED",
      isDegraded: false,
      degradedReasons: [],
      hasUnresolvedRecovery: false,
      timestamp,
    };
  }

  // If VAJRA failed initialization, fail closed and preserve FAILED status
  if (lastReadiness.vajraStatus === "FAILED" || lastReadiness.failedSubsystem === "vajra") {
    return {
      ...lastReadiness,
      processLive: true,
      vajraReady: false,
      missionExecutionReady: false,
      vajraStatus: "FAILED",
      isDegraded: false,
      timestamp,
    };
  }

  let vajraReport: VajraReadinessReport | undefined;
  try {
    vajraReport = getVajraReadiness();
  } catch {
    vajraReport = undefined;
  }

  const vajraStatus = vajraReport ? vajraReport.status : lastReadiness.vajraStatus;
  const vajraReady = vajraReport ? vajraReport.isOperational : lastReadiness.vajraReady;
  const missionExecutionReady = vajraReport
    ? vajraReport.subsystems.realExecution
    : lastReadiness.missionExecutionReady;
  const isDegraded = vajraStatus === "DEGRADED";
  const degradedReasons = vajraReport ? vajraReport.degradedReasons : [];
  const hasUnresolvedRecovery = vajraReport ? vajraReport.hasUnresolvedRecovery : false;

  return {
    processLive: true,
    applicationReady: lastReadiness.applicationReady,
    sqliteReady: lastReadiness.sqliteReady,
    genesisReady: lastReadiness.genesisReady,
    capabilitiesReady: lastReadiness.capabilitiesReady,
    observabilityReady: lastReadiness.observabilityReady,
    vajraReady,
    missionExecutionReady,
    vajraStatus,
    vajraReadiness: vajraReport ?? lastReadiness.vajraReadiness,
    isDegraded,
    degradedReasons,
    hasUnresolvedRecovery,
    failedSubsystem: lastReadiness.failedSubsystem,
    error: lastReadiness.error,
    timestamp,
  };
}

export function isServerShuttingDown(): boolean {
  return isShuttingDown;
}

export function isServerShutdown(): boolean {
  return isShutdown;
}

/**
 * Gracefully shuts down the server runtime.
 * Symmetrical and ordered:
 * 1. VAJRA runtime shutdown (persists PAUSED mode, disposes subscriptions, reconciles cleanup).
 * 2. Observability shutdown (releases health subscription and bus observer; keeps store attached).
 * 3. Shared infrastructure (SQLite database, GENESIS singleton services, Capability Registry)
 *    is preserved intact.
 */
export async function shutdownServer(options?: ServerShutdownOptions): Promise<void> {
  if (isShutdown) {
    return;
  }
  if (isShuttingDown && shutdownPromise) {
    return shutdownPromise;
  }
  isShuttingDown = true;

  shutdownPromise = (async () => {
    try {
      console.info("[ServerLifecycle] Initiating graceful server shutdown...");

      // 1. VAJRA Shutdown
      const shutdownVajra = options?.shutdownVajra ?? shutdownVajraRuntime;
      try {
        await shutdownVajra({
          correlation: options?.correlation,
          force: options?.force,
          timeoutMs: options?.timeoutMs,
        });
      } catch (vajraErr: any) {
        console.error("[ServerLifecycle] Error during VAJRA runtime shutdown:", vajraErr);
        throw vajraErr;
      }

      // 2. Observability Shutdown
      const shutdownObs = options?.shutdownObservability ?? shutdownObservability;
      try {
        shutdownObs();
      } catch (obsErr: any) {
        console.error("[ServerLifecycle] Error during observability shutdown:", obsErr);
      }

      // 3. Shared infrastructure preserved
      isShutdown = true;
      if (lastReadiness) {
        lastReadiness = {
          ...lastReadiness,
          vajraReady: false,
          vajraStatus: "STOPPED",
          vajraReadiness: getVajraReadiness(),
          timestamp: new Date().toISOString(),
        };
      }
      console.info("[ServerLifecycle] Graceful server shutdown completed successfully.");
    } finally {
      isShuttingDown = false;
    }
  })();

  return shutdownPromise;
}

/**
 * Registers process signal handlers (SIGTERM, SIGINT) for graceful server teardown.
 * Safe against duplicate registration and supports dependency injection for test isolation.
 */
export function registerServerSignalHandlers(target?: NodeJS.EventEmitter): void {
  const signalTarget = target ?? (typeof process !== "undefined" ? process : null);
  if (!signalTarget || signalHandlersRegistered) {
    return;
  }

  signalHandlersRegistered = true;
  registeredSignalTarget = signalTarget;

  sigtermListener = () => {
    console.info("[ServerLifecycle] Received SIGTERM signal. Initiating graceful shutdown...");
    void shutdownServer().catch((err) => {
      console.error("[ServerLifecycle] Unhandled error during SIGTERM shutdown:", err);
    });
  };

  sigintListener = () => {
    console.info("[ServerLifecycle] Received SIGINT signal. Initiating graceful shutdown...");
    void shutdownServer().catch((err) => {
      console.error("[ServerLifecycle] Unhandled error during SIGINT shutdown:", err);
    });
  };

  signalTarget.on("SIGTERM", sigtermListener);
  signalTarget.on("SIGINT", sigintListener);
}

/**
 * Unregisters signal handlers from the target event emitter.
 */
export function unregisterServerSignalHandlers(): void {
  if (!signalHandlersRegistered || !registeredSignalTarget) {
    return;
  }
  if (sigtermListener) {
    registeredSignalTarget.removeListener("SIGTERM", sigtermListener);
    sigtermListener = null;
  }
  if (sigintListener) {
    registeredSignalTarget.removeListener("SIGINT", sigintListener);
    sigintListener = null;
  }
  signalHandlersRegistered = false;
  registeredSignalTarget = null;
}

/**
 * Test-only utility to force-reset server lifecycle state between tests.
 */
export function _resetServerLifecycleForTesting(): void {
  unregisterServerSignalHandlers();
  startupPromise = null;
  shutdownPromise = null;
  isShuttingDown = false;
  isShutdown = false;
  lastReadiness = null;
  activeLifecycleController = null;
  _resetCompositionStateForTesting();
}
