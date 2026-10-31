import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { z } from "zod";

import {
  initializeVajraRuntime,
  shutdownVajraRuntime,
  reconcileVajraCleanup,
  getVajraController,
  getVajraReadiness,
  isVajraInitialized,
  VajraCompositionOptions,
  DisabledModelCoprocessorAdapter,
  _resetCompositionStateForTesting,
} from "../../src/vajra/composition";
import { CapabilityRegistry } from "../../src/contracts/capabilities/registry";
import { CapabilityDescriptor } from "../../src/contracts/capabilities/descriptor";
import { EventBus } from "../../src/instrumentation/event-bus";
import { InMemoryGenesisAdapter } from "../../src/vajra/boundaries/genesis-port";
import { SqliteOperationalStateStore } from "../../src/persistence/vajra/sqlite-operational-state-store";
import { createVajraMissionRecord, createVajraStepRecord } from "../../src/vajra/types/mission-record";
import { createMissionDefinition, createMissionStep } from "../../src/contracts/mission/mission-definition";
import { createMissionState } from "../../src/contracts/mission/mission-state";
import { UnavailableHandsAdapter, IHandsPort } from "../../src/vajra/boundaries/hands-port";
import {
  IModelCoprocessorPort,
  ModelCoprocessorRequest,
} from "../../src/vajra/boundaries/model-coprocessor-port";
import { Result } from "../../src/contracts/results/result";

describe("VAJRA Production Composition Root (Phase 8A / Part B)", () => {
  let db: Database.Database;
  let stateStore: SqliteOperationalStateStore;
  let registry: CapabilityRegistry;
  let eventBus: EventBus;
  let genesisPort: InMemoryGenesisAdapter;

  beforeEach(async () => {
    // Ensure clean state before each test
    _resetCompositionStateForTesting();

    // 1. Setup in-memory SQLite database
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    const schemaPath = path.join(process.cwd(), "src", "persistence", "schema.sql");
    db.exec(fs.readFileSync(schemaPath, "utf8"));
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (1, ?)").run(
      new Date().toISOString(),
    );

    const migPath = path.join(
      process.cwd(),
      "src",
      "persistence",
      "migrations",
      "003_vajra_operational_state.sql",
    );
    db.exec(fs.readFileSync(migPath, "utf8"));
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (3, ?)").run(
      new Date().toISOString(),
    );

    stateStore = new SqliteOperationalStateStore(db);

    // 2. Setup isolated registry and event bus
    registry = new CapabilityRegistry();
    const taskDescriptor: CapabilityDescriptor = {
      name: "task.create",
      kind: "Command",
      version: "1.0.0",
      owner: "AKIRA OS · tasks",
      description: "Create an operational task",
      executionCharacteristics: {
        isSynchronous: true,
        isReadOnly: false,
        isIdempotent: true,
      },
      activationTier: 0,
      costClass: "local_cheap",
      isAvailable: true,
      permissions: {
        allowVajra: true,
        allowInternal: true,
      },
      inputSchema: z.object({ title: z.string().optional() }).passthrough(),
    };
    registry.register(taskDescriptor, (input) => ({
      id: "task-comp-1",
      title: (input as any)?.title ?? "Task",
    }));

    eventBus = new EventBus();
    genesisPort = new InMemoryGenesisAdapter();
  });

  afterEach(async () => {
    try {
      await shutdownVajraRuntime({ force: true });
    } catch {
      // Best-effort cleanup in test harness
    }
    _resetCompositionStateForTesting();
    if (db.open) {
      db.close();
    }
  });

  it("constructs full Phase 2–7 dependency graph and transitions to operational DEGRADED state when coprocessor and real execution are offline", async () => {
    const options: VajraCompositionOptions = {
      stateStore,
      capabilityRegistry: registry,
      eventPublisher: eventBus,
      genesisPort,
      coprocessorPort: new DisabledModelCoprocessorAdapter(),
    };

    const controller = await initializeVajraRuntime(options);
    expect(controller).toBeDefined();
    expect(controller.getState()).toBe("RUNNING");
    expect(isVajraInitialized()).toBe(true);

    const activeCtrl = getVajraController();
    expect(activeCtrl).toBe(controller);

    const readiness = getVajraReadiness();
    expect(readiness.status).toBe("DEGRADED");
    expect(readiness.isOperational).toBe(true);
    expect(readiness.initialized).toBe(true);
    expect(readiness.controllerState).toBe("RUNNING");
    expect(readiness.capabilitiesCount).toBeGreaterThanOrEqual(1);
    expect(readiness.failureReason).toBeUndefined();

    // Verify fine-grained subsystem breakdown
    expect(readiness.subsystems.coreRuntime).toBe(true);
    expect(readiness.subsystems.deterministicReasoning).toBe(true);
    expect(readiness.subsystems.missionPlanning).toBe(true);
    expect(readiness.subsystems.modelAssistedReasoning).toBe(false);
    expect(readiness.subsystems.realExecution).toBe(false);
    expect(readiness.subsystems.recoveryCompleted).toBe(true);

    // Verify explicit degraded reasons
    expect(readiness.degradedReasons).toContain("Model-assisted reasoning coprocessor is offline or unconfigured.");
    expect(readiness.degradedReasons).toContain(
      "Physical sandbox execution (HANDS) is unavailable; capability execution is constrained to AKIRA OS.",
    );
  });

  it("reports full READY status when both model coprocessor and real execution are available", async () => {
    const mockCoprocessor: IModelCoprocessorPort = {
      invokeStructuredCoprocessor: async <T>(req: ModelCoprocessorRequest<T>) =>
        Result.success(
          {
            output: {} as T,
            rationale: "mock",
            provider: "mock-llm",
            model: "mock-v1",
            latencyMs: 10,
          },
          req.correlation,
        ),
    };

    const mockLiveHands: IHandsPort = {
      isAvailable: () => true,
      executeSandbox: async <T>(_cmd: string, _args: readonly string[], corr: any) =>
        Result.success({} as T, corr),
    };

    const options: VajraCompositionOptions = {
      stateStore,
      capabilityRegistry: registry,
      eventPublisher: eventBus,
      genesisPort,
      coprocessorPort: mockCoprocessor,
      handsPort: mockLiveHands,
    };

    const controller = await initializeVajraRuntime(options);
    expect(controller.getState()).toBe("RUNNING");

    const readiness = getVajraReadiness();
    expect(readiness.status).toBe("READY");
    expect(readiness.isOperational).toBe(true);
    expect(readiness.degradedReasons).toHaveLength(0);
    expect(readiness.subsystems.modelAssistedReasoning).toBe(true);
    expect(readiness.subsystems.realExecution).toBe(true);
  });

  it("executes crash recovery triaging before marking the runtime operational", async () => {
    // Seed an interrupted in-flight mission in SQLite
    const missionId = "mission-interrupted-01";
    const stepId = "step-interrupted-01";

    const stepDef = createMissionStep({
      id: stepId,
      missionId,
      stepOrder: 1,
      description: "Interrupted step",
      targetCapability: "task.create",
      input: {},
      expectedEvidence: "evidence.ok",
    });

    const def = createMissionDefinition({
      id: missionId,
      objective: "Interrupted task execution",
      steps: [stepDef],
      completionCriteria: { description: "done", requiredEvidence: ["evidence.ok"] },
      correlation: {
        requestId: "req-int-1",
        correlationId: "corr-int-1",
        invocationId: "inv-int-1",
      },
    });

    const mission = createVajraMissionRecord({
      id: missionId,
      objective: def.objective,
      lifecycleState: "RUNNING",
      definition: def,
      state: createMissionState({ missionId, definitionId: missionId }),
      allocatedBudget: { maxCostCents: 10, maxSteps: 3 },
      idempotencyKey: `idemp-${missionId}`,
      requestId: "req-int-1",
      correlationId: "corr-int-1",
      invocationId: "inv-int-1",
    });

    const step = createVajraStepRecord({
      id: stepId,
      missionId,
      stepOrder: 1,
      description: "Dispatched step that crashed before completion",
      targetCapability: "task.create",
      input: {},
      expectedEvidence: "evidence.ok",
      dispatchState: "DISPATCHED",
      idempotencyKey: `idemp-${stepId}`,
      correlationId: "corr-int-1",
      dispatchedAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await stateStore.createMission(mission, [step]);

    const options: VajraCompositionOptions = {
      stateStore,
      capabilityRegistry: registry,
      eventPublisher: eventBus,
      genesisPort,
      coprocessorPort: new DisabledModelCoprocessorAdapter(),
    };

    const controller = await initializeVajraRuntime(options);
    expect(controller.getState()).toBe("RUNNING");

    const readiness = getVajraReadiness();
    expect(readiness.status).toBe("DEGRADED");
    expect(readiness.isOperational).toBe(true);
    expect(readiness.interruptedMissionsRecovered).toBe(1);

    // Verify mission was triaged and paused rather than blindly executed
    const updatedMission = await stateStore.getMission(missionId);
    expect(updatedMission?.lifecycleState).toBe("PAUSED_RECOVERY");
  });

  it("is idempotent when called repeatedly on an active runtime", async () => {
    const options: VajraCompositionOptions = {
      stateStore,
      capabilityRegistry: registry,
      eventPublisher: eventBus,
      genesisPort,
      coprocessorPort: new DisabledModelCoprocessorAdapter(),
    };

    const first = await initializeVajraRuntime(options);
    const second = await initializeVajraRuntime(options);

    expect(first).toBe(second);
    expect(getVajraController()).toBe(first);
  });

  it("implements symmetrical graceful shutdown and leaves shared infrastructure intact", async () => {
    const options: VajraCompositionOptions = {
      stateStore,
      capabilityRegistry: registry,
      eventPublisher: eventBus,
      genesisPort,
      coprocessorPort: new DisabledModelCoprocessorAdapter(),
    };

    const controller = await initializeVajraRuntime(options);
    expect(controller.getState()).toBe("RUNNING");

    await shutdownVajraRuntime();

    expect(isVajraInitialized()).toBe(false);
    expect(controller.getState()).toBe("STOPPED");
    expect(getVajraReadiness().status).toBe("STOPPED");
    expect(getVajraReadiness().isOperational).toBe(false);

    expect(() => getVajraController()).toThrow(/not operational/i);

    // Shared infrastructure must remain completely open and functional
    expect(db.open).toBe(true);
    expect(registry.has("task.create")).toBe(true);

    // Symmetrical re-initialization can succeed
    const reinitialized = await initializeVajraRuntime(options);
    expect(reinitialized.getState()).toBe("RUNNING");
    expect(isVajraInitialized()).toBe(true);
  });

  it("executes LIFO rollback on initialization failure and preserves shared DB/Registry", async () => {
    // Intentionally cause failure during initialization by providing an invalid state store
    const brokenStateStore = {
      ...stateStore,
      detectInterruptedMissions: async () => {
        throw new Error("Simulated SQLite failure during recovery");
      },
    };

    const options: VajraCompositionOptions = {
      stateStore: brokenStateStore as any,
      capabilityRegistry: registry,
      eventPublisher: eventBus,
      genesisPort,
    };

    await expect(initializeVajraRuntime(options)).rejects.toThrow(
      "Simulated SQLite failure during recovery",
    );

    expect(isVajraInitialized()).toBe(false);
    const readiness = getVajraReadiness();
    expect(readiness.status).toBe("FAILED");
    expect(readiness.isOperational).toBe(false);
    expect(readiness.failureReason).toContain("Simulated SQLite failure during recovery");

    expect(() => getVajraController()).toThrow(/not operational/i);

    // Crucial Invariant: Shared DB and CapabilityRegistry MUST survive rollback
    expect(db.open).toBe(true);
    expect(registry.has("task.create")).toBe(true);
  });

  it("fails closed when mandatory dependencies are null or undefined", async () => {
    await expect(
      initializeVajraRuntime({ stateStore: null as any }),
    ).rejects.toThrow(/Mandatory dependency 'stateStore'/i);

    await expect(
      initializeVajraRuntime({ capabilityRegistry: null as any }),
    ).rejects.toThrow(/Mandatory dependency 'capabilityRegistry'/i);

    await expect(
      initializeVajraRuntime({ akiraOSPort: null as any }),
    ).rejects.toThrow(/Mandatory dependency 'akiraOSPort'/i);

    await expect(
      initializeVajraRuntime({ genesisPort: null as any }),
    ).rejects.toThrow(/Mandatory dependency 'genesisPort'/i);

    await expect(
      initializeVajraRuntime({ escalationPort: null as any }),
    ).rejects.toThrow(/Mandatory dependency 'escalationPort'/i);

    expect(isVajraInitialized()).toBe(false);
    expect(getVajraReadiness().status).toBe("FAILED");
  });

  it("ensures recovery executes before boot and does not duplicate or bypass recovery", async () => {
    let firstRecoveryCallOrder = 0;
    let bootCallOrder = 0;
    let counter = 0;

    const customStateStore = Object.assign(
      Object.create(Object.getPrototypeOf(stateStore)),
      stateStore,
      {
        detectInterruptedMissions: async () => {
          counter++;
          if (firstRecoveryCallOrder === 0) {
            firstRecoveryCallOrder = counter;
          }
          return [];
        },
        loadOperationalContext: async () => {
          counter++;
          if (bootCallOrder === 0) {
            bootCallOrder = counter;
          }
          return null;
        },
      },
    );

    const options: VajraCompositionOptions = {
      stateStore: customStateStore as any,
      capabilityRegistry: registry,
      eventPublisher: eventBus,
      genesisPort,
    };

    const controller = await initializeVajraRuntime(options);
    expect(controller.getState()).toBe("RUNNING");

    // Recovery must execute BEFORE boot
    expect(firstRecoveryCallOrder).toBe(1);
    expect(bootCallOrder).toBe(2);
    expect(firstRecoveryCallOrder).toBeLessThan(bootCallOrder);
  });

  it("ensures durable mission records survive rollback untouched", async () => {
    // Seed a durable mission
    const mission = createVajraMissionRecord({
      id: "mission-durable-01",
      objective: "Must survive rollback",
      lifecycleState: "CREATED",
      definition: createMissionDefinition({
        id: "mission-durable-01",
        objective: "Must survive rollback",
        steps: [],
        completionCriteria: { description: "done", requiredEvidence: [] },
        correlation: { requestId: "r", correlationId: "c", invocationId: "i" },
      }),
      state: createMissionState({ missionId: "mission-durable-01", definitionId: "mission-durable-01" }),
      allocatedBudget: { maxCostCents: 5, maxSteps: 2 },
      idempotencyKey: "idemp-durable-01",
      requestId: "r",
      correlationId: "c",
      invocationId: "i",
    });
    await stateStore.createMission(mission, []);

    // Cause failure
    const brokenStateStore = {
      ...stateStore,
      detectInterruptedMissions: async () => {
        throw new Error("Triggered rollback");
      },
    };

    await expect(
      initializeVajraRuntime({
        stateStore: brokenStateStore as any,
        capabilityRegistry: registry,
        eventPublisher: eventBus,
        genesisPort,
      }),
    ).rejects.toThrow("Triggered rollback");

    // Mission must still exist in SQLite unchanged
    const survivingMission = await stateStore.getMission("mission-durable-01");
    expect(survivingMission).not.toBeNull();
    expect(survivingMission?.id).toBe("mission-durable-01");
    expect(survivingMission?.objective).toBe("Must survive rollback");
  });

  it("handles shutdown idempotently and safely when called multiple times", async () => {
    const options: VajraCompositionOptions = {
      stateStore,
      capabilityRegistry: registry,
      eventPublisher: eventBus,
      genesisPort,
      coprocessorPort: new DisabledModelCoprocessorAdapter(),
    };

    await initializeVajraRuntime(options);
    expect(isVajraInitialized()).toBe(true);

    // First shutdown
    await shutdownVajraRuntime();
    expect(isVajraInitialized()).toBe(false);
    expect(getVajraReadiness().status).toBe("STOPPED");

    // Second shutdown must not throw and remain STOPPED
    await expect(shutdownVajraRuntime()).resolves.toBeUndefined();
    expect(isVajraInitialized()).toBe(false);
    expect(getVajraReadiness().status).toBe("STOPPED");
  });

  it("UnavailableHandsAdapter explicitly rejects execution and produces zero simulated success evidence", async () => {
    const hands = new UnavailableHandsAdapter();
    expect(hands.isAvailable()).toBe(false);

    const corr = {
      requestId: "req-hands-1",
      correlationId: "corr-hands-1",
      invocationId: "inv-hands-1",
    };
    const result = await hands.executeSandbox("rm", ["-rf", "/"], corr);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("unavailable in Phase 8A");
  });

  it("durably persists PAUSED operational mode on shutdown and restores on subsequent boot", async () => {
    const options: VajraCompositionOptions = {
      stateStore,
      capabilityRegistry: registry,
      eventPublisher: eventBus,
      genesisPort,
      coprocessorPort: new DisabledModelCoprocessorAdapter(),
    };

    // 1. Initial boot: transitions to REQUEST_DRIVEN and saves
    const controller = await initializeVajraRuntime(options);
    expect(controller.getState()).toBe("RUNNING");
    let persistedContext = await stateStore.loadOperationalContext();
    expect(persistedContext?.mode).toBe("REQUEST_DRIVEN");

    // 2. Graceful shutdown: persists PAUSED state to SQLite
    await shutdownVajraRuntime();
    persistedContext = await stateStore.loadOperationalContext();
    expect(persistedContext?.mode).toBe("PAUSED");

    // 3. Subsequent boot: loads persisted context and transitions back to REQUEST_DRIVEN
    const rebootedController = await initializeVajraRuntime(options);
    expect(rebootedController.getState()).toBe("RUNNING");
    persistedContext = await stateStore.loadOperationalContext();
    expect(persistedContext?.mode).toBe("REQUEST_DRIVEN");
  });

  it("continues rollback after individual cleanup step failures, surfaces diagnostics, and enforces true reconciliation", async () => {
    let task1PoppedOrder = 0;
    let task2PoppedOrder = 0;
    let task3PoppedOrder = 0;
    let popCounter = 0;
    let task2ShouldFail = true;

    let genesisSubscribeCount = 0;
    let genesisUnsubscribeCount = 0;

    const trackingGenesis = new InMemoryGenesisAdapter();
    const origSubscribe = trackingGenesis.subscribeToCognitiveDiscoveries.bind(trackingGenesis);
    trackingGenesis.subscribeToCognitiveDiscoveries = (listener: any) => {
      genesisSubscribeCount++;
      const origUnsub = origSubscribe(listener);
      return () => {
        genesisUnsubscribeCount++;
        origUnsub();
      };
    };

    const brokenStateStore = Object.assign(
      Object.create(Object.getPrototypeOf(stateStore)),
      stateStore,
      {
        detectInterruptedMissions: async () => {
          throw new Error("Simulated fatal database corruption during recovery");
        },
      },
    );

    const testCleanupTasks = [
      {
        name: "test-task-1",
        cleanup: async () => {
          popCounter++;
          task1PoppedOrder = popCounter;
        },
      },
      {
        name: "test-task-2-faulty",
        cleanup: async () => {
          popCounter++;
          task2PoppedOrder = popCounter;
          if (task2ShouldFail) {
            throw new Error("Injected unhandled cleanup exception in task 2");
          }
        },
      },
      {
        name: "test-task-3",
        cleanup: async () => {
          popCounter++;
          task3PoppedOrder = popCounter;
        },
      },
    ];

    const failingOptions: VajraCompositionOptions = {
      stateStore: brokenStateStore,
      capabilityRegistry: registry,
      eventPublisher: eventBus,
      genesisPort: trackingGenesis,
      testCleanupTasks,
    };

    // 1. Initial attempt fails during boot recovery
    await expect(initializeVajraRuntime(failingOptions)).rejects.toThrow(
      "Simulated fatal database corruption during recovery",
    );

    // 2. Verify LIFO order of cleanup: task3 was pushed last, so popped first; task2 popped second; task1 popped third
    expect(task3PoppedOrder).toBe(1);
    expect(task2PoppedOrder).toBe(2);
    expect(task1PoppedOrder).toBe(3);

    // 3. Verify diagnostics retained cleanup failure
    let readiness = getVajraReadiness();
    expect(readiness.status).toBe("FAILED");
    expect(readiness.hasUnreconciledCleanup).toBe(true);
    expect(readiness.cleanupFailures).toBeDefined();
    expect(readiness.cleanupFailures!.length).toBe(1);
    expect(readiness.cleanupFailures![0].name).toBe("test-task-2-faulty");
    expect(readiness.cleanupFailures![0].error).toContain(
      "Injected unhandled cleanup exception in task 2",
    );
    expect(readiness.unreconciledTaskNames).toContain("test-task-2-faulty");

    const validOptions: VajraCompositionOptions = {
      stateStore,
      capabilityRegistry: registry,
      eventPublisher: eventBus,
      genesisPort: trackingGenesis,
    };

    // 4. Forced reconciliation fails when underlying resource is still unresolvable
    // Never clear an unresolved cleanup failure merely because force mode was requested!
    await shutdownVajraRuntime({ force: true });
    readiness = getVajraReadiness();
    expect(readiness.hasUnreconciledCleanup).toBe(true);
    expect(readiness.cleanupFailures).toBeDefined();
    expect(readiness.cleanupFailures!.length).toBe(1);

    // 5. Reconciliation failure continues blocking startup
    await expect(initializeVajraRuntime(validOptions)).rejects.toThrow(
      /VAJRA initialization blocked: 1 unreconciled cleanup failure\(s\)/,
    );

    // 6. Underlying resource issue resolves
    task2ShouldFail = false;

    // 7. Successful reconciliation releases the resource and clears failure
    const reconciliationRes = await reconcileVajraCleanup();
    expect(reconciliationRes.success).toBe(true);
    expect(reconciliationRes.unreconciledCount).toBe(0);
    expect(reconciliationRes.remainingFailures).toHaveLength(0);

    readiness = getVajraReadiness();
    expect(readiness.hasUnreconciledCleanup).toBe(false);
    expect(readiness.cleanupFailures).toBeUndefined();
    expect(readiness.unreconciledTaskNames).toBeUndefined();

    // 8. Successful reconciliation permits startup
    const recoveredController = await initializeVajraRuntime(validOptions);
    expect(recoveredController.getState()).toBe("RUNNING");
    expect(isVajraInitialized()).toBe(true);

    // 9. No duplicate subscriptions after reconciliation and retry
    // Exactly 1 active subscription should exist (subscribeCount - unsubscribeCount === 1)
    expect(genesisSubscribeCount - genesisUnsubscribeCount).toBe(1);
  });

  it("handles controller shutdown failure, retains task in unreconciledCleanupTasks, and reconciles upon controller retry", async () => {
    let unsubShouldFail = true;
    let unsubCalls = 0;

    const mockGenesis: any = {
      subscribeToCognitiveDiscoveries: () => {
        return () => {
          unsubCalls++;
          if (unsubShouldFail) {
            throw new Error("GENESIS bus shutdown failed");
          }
        };
      },
    };

    const controller = await initializeVajraRuntime({
      stateStore,
      capabilityRegistry: registry,
      eventPublisher: eventBus,
      genesisPort: mockGenesis,
      skipRecovery: true,
    });
    expect(controller.getState()).toBe("RUNNING");

    // Shutdown fails due to injected unsubscription failure
    await expect(shutdownVajraRuntime()).rejects.toThrow("GENESIS bus shutdown failed");

    let readiness = getVajraReadiness();
    expect(readiness.hasUnreconciledCleanup).toBe(true);
    expect(readiness.unreconciledTaskNames).toContain("controller-shutdown");
    expect(readiness.cleanupFailures).toBeDefined();
    expect(readiness.cleanupFailures![0].name).toBe("controller-shutdown");

    // Resolve unsubscription failure
    unsubShouldFail = false;

    // Reconcile cleanup: controller shutdown must be genuinely retried
    const reconcileRes = await reconcileVajraCleanup();
    expect(reconcileRes.success).toBe(true);
    expect(reconcileRes.unreconciledCount).toBe(0);
    expect(reconcileRes.remainingFailures).toHaveLength(0);
    expect(unsubCalls).toBe(2);

    readiness = getVajraReadiness();
    expect(readiness.hasUnreconciledCleanup).toBe(false);
    expect(readiness.unreconciledTaskNames).toBeUndefined();
    expect(readiness.cleanupFailures).toBeUndefined();
  });

  it("proves that a subsequent initialization attempt succeeds only after controller shutdown is reconciled", async () => {
    let unsubShouldFail = true;

    const mockGenesis: any = {
      subscribeToCognitiveDiscoveries: () => {
        return () => {
          if (unsubShouldFail) {
            throw new Error("GENESIS bus unsubscription failed");
          }
        };
      },
    };

    const options: VajraCompositionOptions = {
      stateStore,
      capabilityRegistry: registry,
      eventPublisher: eventBus,
      genesisPort: mockGenesis,
      skipRecovery: true,
    };

    await initializeVajraRuntime(options);

    // Shutdown fails
    await expect(shutdownVajraRuntime()).rejects.toThrow("GENESIS bus unsubscription failed");

    // Initialization attempt blocked by unreconciled controller-shutdown failure
    await expect(initializeVajraRuntime(options)).rejects.toThrow(
      /VAJRA initialization blocked: 1 unreconciled cleanup failure\(s\) \(controller-shutdown\)/,
    );

    // Unblock and reconcile
    unsubShouldFail = false;
    const reconcileRes = await reconcileVajraCleanup();
    expect(reconcileRes.success).toBe(true);

    // Now initialization succeeds
    const recoveredController = await initializeVajraRuntime(options);
    expect(recoveredController.getState()).toBe("RUNNING");
    expect(isVajraInitialized()).toBe(true);
  });
});
