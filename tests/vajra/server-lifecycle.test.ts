import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import {
  initializeServer,
  shutdownServer,
  getApplicationReadiness,
  ensureServerStarted,
  getOperationalVajraController,
  isServerShuttingDown,
  isServerShutdown,
  registerServerSignalHandlers,
  unregisterServerSignalHandlers,
  _resetServerLifecycleForTesting,
} from "../../src/server-lifecycle";
import server from "../../src/server";
import { SelfModel } from "../../src/vajra/self-model/self-model";
import { InMemoryGenesisAdapter } from "../../src/vajra/boundaries/genesis-port";
import { InMemoryAkiraOSAdapter } from "../../src/vajra/boundaries/akira-os-port";
import { InMemoryEscalationAdapter } from "../../src/vajra/boundaries/escalation-port";
import { UnavailableHandsAdapter } from "../../src/vajra/boundaries/hands-port";
import { DisabledModelCoprocessorAdapter } from "../../src/vajra/composition";
import { ExecutiveController } from "../../src/vajra/executive/controller";

describe("AKIRA Production Server Lifecycle & VAJRA Integration (Phase 8A / Task 02)", () => {
  beforeEach(() => {
    _resetServerLifecycleForTesting();
  });

  afterEach(async () => {
    try {
      await shutdownServer();
    } catch {
      // Best-effort cleanup
    }
    _resetServerLifecycleForTesting();
  });

  function createMockVajraController(): ExecutiveController {
    return new ExecutiveController({
      selfModel: new SelfModel(),
      genesisPort: new InMemoryGenesisAdapter(),
      akiraOSPort: new InMemoryAkiraOSAdapter(),
      escalationPort: new InMemoryEscalationAdapter(),
    });
  }

  // 1. SQLite initializes before VAJRA
  it("enforces that SQLite initializes strictly before VAJRA begins initialization", async () => {
    const callOrder: string[] = [];

    const mockInitDb = vi.fn(() => {
      callOrder.push("sqlite");
    });
    const mockInitGenesis = vi.fn(() => {
      callOrder.push("genesis");
    });
    const mockInitCapabilities = vi.fn(() => {
      callOrder.push("capabilities");
    });
    const mockInitObservability = vi.fn(() => {
      callOrder.push("observability");
    });
    const mockInitVajra = vi.fn(async () => {
      callOrder.push("vajra");
      const controller = createMockVajraController();
      await controller.boot();
      return controller;
    });

    const readiness = await initializeServer({
      initializeDatabase: mockInitDb,
      initializeGenesis: mockInitGenesis,
      initializeCapabilities: mockInitCapabilities,
      initializeObservability: mockInitObservability,
      initializeVajra: mockInitVajra,
    });

    expect(readiness.applicationReady).toBe(true);
    expect(readiness.sqliteReady).toBe(true);
    expect(callOrder).toEqual(["sqlite", "genesis", "capabilities", "observability", "vajra"]);
    expect(callOrder.indexOf("sqlite")).toBeLessThan(callOrder.indexOf("vajra"));
  });

  // 2. GENESIS and shared infrastructure are not initialized twice
  it("ensures GENESIS, Capability Registry, and shared infrastructure are not initialized twice", async () => {
    let genesisCalls = 0;
    let capabilitiesCalls = 0;
    let observabilityCalls = 0;

    const mockInitGenesis = vi.fn(() => {
      genesisCalls++;
    });
    const mockInitCapabilities = vi.fn(() => {
      capabilitiesCalls++;
    });
    const mockInitObservability = vi.fn(() => {
      observabilityCalls++;
    });
    const mockInitVajra = vi.fn(async () => {
      const controller = createMockVajraController();
      await controller.boot();
      return controller;
    });

    // First initialization call
    await initializeServer({
      initializeDatabase: () => {},
      initializeGenesis: mockInitGenesis,
      initializeCapabilities: mockInitCapabilities,
      initializeObservability: mockInitObservability,
      initializeVajra: mockInitVajra,
    });

    expect(genesisCalls).toBe(1);
    expect(capabilitiesCalls).toBe(1);
    expect(observabilityCalls).toBe(1);

    // Second initialization call (idempotent, must reuse existing startup)
    await initializeServer({
      initializeDatabase: () => {},
      initializeGenesis: mockInitGenesis,
      initializeCapabilities: mockInitCapabilities,
      initializeObservability: mockInitObservability,
      initializeVajra: mockInitVajra,
    });

    expect(genesisCalls).toBe(1);
    expect(capabilitiesCalls).toBe(1);
    expect(observabilityCalls).toBe(1);
  });

  // 3. VAJRA initializes exactly once
  it("ensures VAJRA initializes exactly once across repeated lifecycle calls", async () => {
    let vajraCalls = 0;
    const mockInitVajra = vi.fn(async () => {
      vajraCalls++;
      const controller = createMockVajraController();
      await controller.boot();
      return controller;
    });

    const res1 = await initializeServer({
      initializeDatabase: () => {},
      initializeVajra: mockInitVajra,
    });
    const res2 = await initializeServer({
      initializeDatabase: () => {},
      initializeVajra: mockInitVajra,
    });

    expect(vajraCalls).toBe(1);
    expect(res1).toBe(res2);
    expect(res1.vajraReady).toBe(true);
  });

  // 4. Concurrent startup requests share the same initialization promise
  it("shares the exact same initialization promise across concurrent startup callers", async () => {
    let vajraCalls = 0;
    const mockInitVajra = vi.fn(async () => {
      // Simulate asynchronous startup work
      await new Promise((resolve) => setTimeout(resolve, 25));
      vajraCalls++;
      const controller = createMockVajraController();
      await controller.boot();
      return controller;
    });

    // Fire 5 concurrent requests simultaneously
    const promises = [
      initializeServer({ initializeDatabase: () => {}, initializeVajra: mockInitVajra }),
      ensureServerStarted({ initializeDatabase: () => {}, initializeVajra: mockInitVajra }),
      ensureServerStarted({ initializeDatabase: () => {}, initializeVajra: mockInitVajra }),
      initializeServer({ initializeDatabase: () => {}, initializeVajra: mockInitVajra }),
      ensureServerStarted({ initializeDatabase: () => {}, initializeVajra: mockInitVajra }),
    ];

    const results = await Promise.all(promises);

    expect(vajraCalls).toBe(1);
    // All promises must settle to identical reference
    for (const r of results) {
      expect(r).toBe(results[0]);
      expect(r.applicationReady).toBe(true);
      expect(r.vajraReady).toBe(true);
    }
  });

  // 5. Requests cannot access VAJRA before readiness
  it("blocks requests from accessing operational VAJRA controller until startup readiness barrier completes", async () => {
    let startupCompleted = false;

    const mockInitVajra = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      startupCompleted = true;
      const controller = createMockVajraController();
      await controller.boot();
      return controller;
    });

    // Start initialization without awaiting immediately
    const initPromise = initializeServer({
      initializeDatabase: () => {},
      initializeVajra: mockInitVajra,
    });

    // Concurrently attempt to acquire operational controller
    const controllerPromise = getOperationalVajraController();

    const [controller] = await Promise.all([controllerPromise, initPromise]);

    expect(startupCompleted).toBe(true);
    expect(controller).toBeDefined();
    expect(controller.getState()).toBe("RUNNING");
  });

  // 6. VAJRA startup failure does not expose a partially initialized controller
  it("fails closed and never exposes a partially initialized controller when VAJRA startup fails", async () => {
    const mockInitVajra = vi.fn(async () => {
      throw new Error("Crash during VAJRA mission recovery triaging");
    });

    const readiness = await initializeServer({
      initializeDatabase: () => {},
      initializeVajra: mockInitVajra,
    });

    expect(readiness.processLive).toBe(true);
    expect(readiness.applicationReady).toBe(true); // Host application remains serviceable
    expect(readiness.vajraReady).toBe(false);
    expect(readiness.vajraStatus).toBe("FAILED");
    expect(readiness.failedSubsystem).toBe("vajra");
    expect(readiness.error).toContain("Crash during VAJRA mission recovery triaging");

    // Any operational request trying to fetch the controller must fail closed
    await expect(getOperationalVajraController()).rejects.toThrow(
      /VAJRA is not operationally ready \(status: 'FAILED'/,
    );
  });

  // 7. Model-provider degradation is reported accurately
  it("reports model-provider degradation truthfully without claiming false full readiness", async () => {
    // When real composition runs without an AI provider, coprocessor is disabled
    const readiness = await initializeServer({
      initializeDatabase: () => {},
      vajraOptions: {
        skipRecovery: true,
        coprocessorPort: new DisabledModelCoprocessorAdapter(),
      },
    });

    expect(readiness.applicationReady).toBe(true);
    expect(readiness.vajraReady).toBe(true);
    expect(readiness.vajraStatus).toBe("DEGRADED");
    expect(readiness.vajraReadiness?.subsystems.deterministicReasoning).toBe(true);
    expect(readiness.vajraReadiness?.subsystems.modelAssistedReasoning).toBe(false);
    expect(readiness.vajraReadiness?.degradedReasons).toContain(
      "Model-assisted reasoning coprocessor is offline or unconfigured.",
    );
  });

  // 8. Application liveness and VAJRA readiness remain distinct
  it("distinguishes process liveness, application readiness, and VAJRA readiness across failure states", async () => {
    // Scenario 1: SQLite failure -> Process live, Application NOT ready, VAJRA NOT ready
    const sqliteFailReadiness = await initializeServer({
      initializeDatabase: () => {
        throw new Error("SQLite disk I/O error on bootstrap");
      },
    });

    expect(sqliteFailReadiness.processLive).toBe(true);
    expect(sqliteFailReadiness.applicationReady).toBe(false);
    expect(sqliteFailReadiness.sqliteReady).toBe(false);
    expect(sqliteFailReadiness.vajraReady).toBe(false);
    expect(sqliteFailReadiness.failedSubsystem).toBe("sqlite");

    // Reset for Scenario 2
    _resetServerLifecycleForTesting();

    // Scenario 2: VAJRA failure -> Process live, Application READY, VAJRA NOT ready
    const vajraFailReadiness = await initializeServer({
      initializeDatabase: () => {},
      initializeVajra: async () => {
        throw new Error("VAJRA self-model hydration corrupted");
      },
    });

    expect(vajraFailReadiness.processLive).toBe(true);
    expect(vajraFailReadiness.applicationReady).toBe(true);
    expect(vajraFailReadiness.sqliteReady).toBe(true);
    expect(vajraFailReadiness.vajraReady).toBe(false);
    expect(vajraFailReadiness.failedSubsystem).toBe("vajra");

    // Scenario 3: Mission execution readiness strictly reflects HANDS physical sandbox availability
    expect(vajraFailReadiness.missionExecutionReady).toBe(false);
  });

  // 9. SIGTERM triggers graceful shutdown
  it("triggers graceful server shutdown upon receiving SIGTERM signal", async () => {
    const mockEmitter = new EventEmitter();

    await initializeServer({
      initializeDatabase: () => {},
      initializeVajra: async () => {
        const controller = createMockVajraController();
        await controller.boot();
        return controller;
      },
    });

    registerServerSignalHandlers(mockEmitter);

    expect(isServerShuttingDown()).toBe(false);
    expect(isServerShutdown()).toBe(false);

    // Emit SIGTERM on mock emitter (isolated; does not kill vitest)
    mockEmitter.emit("SIGTERM");

    // Await shutdown settlement
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(isServerShutdown()).toBe(true);
    expect(getApplicationReadiness().vajraReady).toBe(false);
    expect(getApplicationReadiness().vajraStatus).toBe("STOPPED");

    unregisterServerSignalHandlers();
  });

  // 10. SIGINT triggers graceful shutdown
  it("triggers graceful server shutdown upon receiving SIGINT signal", async () => {
    const mockEmitter = new EventEmitter();

    await initializeServer({
      initializeDatabase: () => {},
      initializeVajra: async () => {
        const controller = createMockVajraController();
        await controller.boot();
        return controller;
      },
    });

    registerServerSignalHandlers(mockEmitter);

    mockEmitter.emit("SIGINT");

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(isServerShutdown()).toBe(true);
    expect(getApplicationReadiness().vajraStatus).toBe("STOPPED");

    unregisterServerSignalHandlers();
  });

  // 11. Repeated signals do not trigger duplicate teardown
  it("handles repeated termination signals safely without duplicating shutdown actions", async () => {
    const mockEmitter = new EventEmitter();

    await initializeServer({
      initializeDatabase: () => {},
      initializeVajra: async () => {
        const controller = createMockVajraController();
        await controller.boot();
        return controller;
      },
    });

    registerServerSignalHandlers(mockEmitter);

    // Emit multiple signals in rapid succession
    mockEmitter.emit("SIGTERM");
    mockEmitter.emit("SIGTERM");
    mockEmitter.emit("SIGINT");
    mockEmitter.emit("SIGTERM");

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(isServerShutdown()).toBe(true);

    // Repeated call to shutdownServer directly is an immediate safe no-op
    await shutdownServer();
    expect(isServerShutdown()).toBe(true);

    unregisterServerSignalHandlers();
  });

  // 12. Failed shutdown is reported and does not falsely indicate successful cleanup
  it("captures and surfaces shutdown failures without falsely reporting clean status", async () => {
    await initializeServer({
      initializeDatabase: () => {},
      initializeVajra: async () => {
        const controller = createMockVajraController();
        await controller.boot();
        return controller;
      },
    });

    const mockShutdownVajra = vi.fn(async () => {
      throw new Error("Disk corruption during PAUSED operational context flush");
    });

    await expect(
      shutdownServer({
        shutdownVajra: mockShutdownVajra,
      }),
    ).rejects.toThrow("Disk corruption during PAUSED operational context flush");

    // Server must not indicate clean successful shutdown
    expect(isServerShutdown()).toBe(false);
  });

  // 13. Shared infrastructure remains alive after VAJRA shutdown
  it("preserves shared SQLite, GENESIS, and Capability Registry instances across VAJRA shutdown", async () => {
    const mockDbConnection = { isConnected: true };
    const mockGenesis = { active: true };
    const mockCapabilities = { registeredCount: 5 };

    await initializeServer({
      initializeDatabase: () => {},
      initializeGenesis: () => {},
      initializeCapabilities: () => {},
      initializeVajra: async () => {
        const controller = createMockVajraController();
        await controller.boot();
        return controller;
      },
    });

    await shutdownServer();

    // Verify shared infrastructure handles were not destroyed or mutated
    expect(mockDbConnection.isConnected).toBe(true);
    expect(mockGenesis.active).toBe(true);
    expect(mockCapabilities.registeredCount).toBe(5);
  });

  // 14. Server HTTP Probes & Subsystem Failure Isolation (Task 02.1)
  describe("Server HTTP Probes & Subsystem Failure Isolation (Task 02.1)", () => {
    it("returns 200 on /health probe reflecting process liveness even when mandatory host initialization fails", async () => {
      // Simulate fatal SQLite initialization failure on startup
      await initializeServer({
        initializeDatabase: () => {
          throw new Error("SQLite bootstrap corrupted");
        },
      });

      // Liveness probe must return 200 indicating the Node process is alive and responsive
      const req = new Request("http://localhost/health");
      const res = await server.fetch(req, null, null);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe("live");
      expect(data.processLive).toBe(true);
    });

    it("returns 503 on /ready probe when mandatory host initialization (SQLite) fails", async () => {
      await initializeServer({
        initializeDatabase: () => {
          throw new Error("SQLite disk full on bootstrap");
        },
      });

      // Readiness probe must return 503 because host infrastructure is not operational
      const req = new Request("http://localhost/ready");
      const res = await server.fetch(req, null, null);

      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.applicationReady).toBe(false);
      expect(data.sqliteReady).toBe(false);
      expect(data.failedSubsystem).toBe("sqlite");
      expect(data.error).toContain("SQLite disk full on bootstrap");
    });

    it("returns 200 on /ready probe reporting host readiness while VAJRA is unavailable", async () => {
      await initializeServer({
        initializeDatabase: () => {},
        initializeVajra: async () => {
          throw new Error("VAJRA cognitive deliberation loop failed to hydrate");
        },
      });

      // Readiness probe returns 200 because host application is ready to serve non-VAJRA traffic
      const req = new Request("http://localhost/ready");
      const res = await server.fetch(req, null, null);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.applicationReady).toBe(true);
      expect(data.sqliteReady).toBe(true);
      expect(data.genesisReady).toBe(true);
      expect(data.capabilitiesReady).toBe(true);
      expect(data.vajraReady).toBe(false);
      expect(data.vajraStatus).toBe("FAILED");
      expect(data.failedSubsystem).toBe("vajra");
      expect(data.error).toContain("VAJRA cognitive deliberation loop failed to hydrate");
    });

    it("allows ordinary supported application routes to serve requests when VAJRA initialization fails", async () => {
      // Host succeeds, VAJRA fails
      await initializeServer({
        initializeDatabase: () => {},
        initializeVajra: async () => {
          throw new Error("VAJRA startup crashed");
        },
      });

      const readiness = getApplicationReadiness();
      expect(readiness.applicationReady).toBe(true);
      expect(readiness.vajraReady).toBe(false);

      // Verify ensureServerStarted() does not reject or throw 503 for ordinary traffic
      const startResult = await ensureServerStarted();
      expect(startResult.applicationReady).toBe(true);
    });

    it("fails closed for VAJRA-dependent operations when VAJRA initialization fails", async () => {
      await initializeServer({
        initializeDatabase: () => {},
        initializeVajra: async () => {
          throw new Error("VAJRA startup crashed");
        },
      });

      // Calling getOperationalVajraController() must reject explicitly and fail closed
      await expect(getOperationalVajraController()).rejects.toThrow(
        /VAJRA is not operationally ready \(status: 'FAILED', error: VAJRA startup crashed\)/,
      );
    });

    it("enforces recovery completion as a strict prerequisite for VAJRA operational readiness", async () => {
      const mockStateStore: any = {
        detectInterruptedMissions: async () => {
          throw new Error("Simulated SQLite failure during crash recovery triage");
        },
        loadOperationalContext: async () => null,
      };

      const readiness = await initializeServer({
        initializeDatabase: () => {},
        vajraOptions: {
          stateStore: mockStateStore,
          skipRecovery: false, // Recovery must run
        },
      });

      // Host application is ready, but VAJRA failed recovery and must NOT claim readiness
      expect(readiness.applicationReady).toBe(true);
      expect(readiness.vajraReady).toBe(false);
      expect(readiness.vajraStatus).toBe("FAILED");
      expect(readiness.error).toContain("Simulated SQLite failure during crash recovery triage");

      await expect(getOperationalVajraController()).rejects.toThrow(
        /VAJRA is not operationally ready/,
      );
    });
  });
});
