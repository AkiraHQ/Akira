import { describe, it, expect, vi } from "vitest";
import {
  LifecycleManager,
  ModuleInstance,
  ModuleState,
  LifecycleTransitionError,
  LifecycleTimeoutError,
  LifecycleHookError,
  RestartError,
  StrictPolicy,
  ContinueOnFailurePolicy,
  LifecycleEvents,
} from "../src/runtime";
import { eventBus } from "../src/shared/infrastructure/event-bus";

describe("Platform Runtime - Lifecycle Manager", () => {
  // Helper to create mock context
  function createMockContext(id: string): any {
    return {
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      eventBus: {
        publish: vi.fn(),
        subscribe: vi.fn(),
      },
      configuration: {},
      runtime: {},
    };
  }

  // Helper to create a module instance
  function createInstance(
    id: string,
    definition: {
      startup?: any;
      shutdown?: any;
      pause?: any;
      resume?: any;
    } = {},
    manifest: any = {},
  ): ModuleInstance {
    const context = createMockContext(id);
    const mockManifest = {
      id,
      name: id.toUpperCase(),
      version: "1.0.0",
      sdkVersion: "^1.0.0",
      description: "Test manifest",
      author: "Test Author",
      dependencies: manifest.dependencies || [],
      startupTimeout: manifest.startupTimeout,
      shutdownTimeout: manifest.shutdownTimeout,
    };
    const inst = new ModuleInstance(
      id,
      id.toUpperCase(),
      "1.0.0",
      context,
      {
        name: id.toUpperCase(),
        version: "1.0.0",
        ...definition,
      },
      mockManifest,
    );
    return inst;
  }

  describe("Transitions & Hooks", () => {
    it("should successfully execute full happy path transition flow (LOADED -> INITIALIZED -> RUNNING)", async () => {
      const startupSpy = vi.fn();
      const inst = createInstance("mod1", { startup: startupSpy });
      const manager = new LifecycleManager();
      manager.registerModule(inst);

      expect(inst.state).toBe(ModuleState.UNLOADED);

      // Transition UNLOADED -> LOADED
      await manager.transition(inst, ModuleState.LOADED);
      expect(inst.state).toBe(ModuleState.LOADED);

      // Transition LOADED -> INITIALIZED
      await manager.initialize(inst);
      expect(inst.state).toBe(ModuleState.INITIALIZED);

      // Transition INITIALIZED -> RUNNING
      await manager.start(inst);
      expect(inst.state).toBe(ModuleState.RUNNING);
      expect(startupSpy).toHaveBeenCalledTimes(1);
    });

    it("should throw LifecycleTransitionError for illegal transitions", async () => {
      const inst = createInstance("mod1");
      const manager = new LifecycleManager();

      // Illegal: UNLOADED -> RUNNING directly
      await expect(manager.transition(inst, ModuleState.RUNNING)).rejects.toThrow(
        LifecycleTransitionError,
      );
    });

    it("should support pausing and resuming running modules", async () => {
      const pauseSpy = vi.fn();
      const resumeSpy = vi.fn();
      const inst = createInstance("mod1", { pause: pauseSpy, resume: resumeSpy });
      const manager = new LifecycleManager();

      await manager.transition(inst, ModuleState.LOADED);
      await manager.initialize(inst);
      await manager.start(inst);

      // Pause: RUNNING -> PAUSED
      await manager.pause(inst);
      expect(inst.state).toBe(ModuleState.PAUSED);
      expect(pauseSpy).toHaveBeenCalledTimes(1);

      // Resume: PAUSED -> RUNNING
      await manager.resume(inst);
      expect(inst.state).toBe(ModuleState.RUNNING);
      expect(resumeSpy).toHaveBeenCalledTimes(1);
    });

    it("should support graceful stops (RUNNING -> STOPPED -> UNLOADED)", async () => {
      const shutdownSpy = vi.fn();
      const inst = createInstance("mod1", { shutdown: shutdownSpy });
      const manager = new LifecycleManager();

      await manager.transition(inst, ModuleState.LOADED);
      await manager.initialize(inst);
      await manager.start(inst);

      await manager.stop(inst);
      expect(inst.state).toBe(ModuleState.UNLOADED);
      expect(shutdownSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("Timeouts", () => {
    it("should mark module FAILED and throw LifecycleHookError when startup timeout is exceeded", async () => {
      // Startup hook that takes 100ms
      const slowStartup = () => new Promise<void>((resolve) => setTimeout(resolve, 100));
      const inst = createInstance("slowMod", { startup: slowStartup }, { startupTimeout: 10 });
      const manager = new LifecycleManager();

      await manager.transition(inst, ModuleState.LOADED);
      await manager.initialize(inst);

      // Try start: should timeout in 10ms
      await expect(manager.start(inst)).rejects.toThrow(LifecycleHookError);
      expect(inst.state).toBe(ModuleState.UNLOADED); // Auto-cleanup failed module to UNLOADED state
    });
  });

  describe("Isolation & Observers", () => {
    it("should isolate failures in global observer hooks without crashing transitions", async () => {
      const inst = createInstance("mod");
      const manager = new LifecycleManager();

      const faultyObserver = {
        onInitialize: () => {
          throw new Error("Faulty observer hook");
        },
      };

      manager.registerHooks(faultyObserver);
      manager.registerModule(inst);

      await manager.transition(inst, ModuleState.LOADED);

      // Should initialize successfully despite observer failure
      await expect(manager.initialize(inst)).resolves.not.toThrow();
      expect(inst.state).toBe(ModuleState.INITIALIZED);
    });
  });

  describe("Restart & Rollback", () => {
    it("should restart a running module successfully", async () => {
      const startupSpy = vi.fn();
      const shutdownSpy = vi.fn();
      const inst = createInstance("restartMod", { startup: startupSpy, shutdown: shutdownSpy });
      const manager = new LifecycleManager();

      await manager.transition(inst, ModuleState.LOADED);
      await manager.initialize(inst);
      await manager.start(inst);

      await manager.restart(inst);

      expect(inst.state).toBe(ModuleState.RUNNING);
      expect(startupSpy).toHaveBeenCalledTimes(2);
      expect(shutdownSpy).toHaveBeenCalledTimes(1);
    });

    it("should execute rollback on started modules in reverse order", async () => {
      const stopOrder: string[] = [];
      const m1 = createInstance("m1", {
        shutdown: () => {
          stopOrder.push("m1");
        },
      });
      const m2 = createInstance("m2", {
        shutdown: () => {
          stopOrder.push("m2");
        },
      });

      const manager = new LifecycleManager();
      manager.registerModule(m1);
      manager.registerModule(m2);

      await manager.start(m1);
      await manager.start(m2);

      await manager.rollback([m1, m2]);

      expect(m1.state).toBe(ModuleState.UNLOADED);
      expect(m2.state).toBe(ModuleState.UNLOADED);
      expect(stopOrder).toEqual(["m2", "m1"]);
    });
  });

  describe("Failure Isolation Policies", () => {
    it("should skip dependent modules and continue independent ones under ContinueOnFailurePolicy", async () => {
      // modA fails to start
      const faultyStartup = () => {
        throw new Error("Startup crash");
      };

      const modA = createInstance("A", { startup: faultyStartup });
      const modB = createInstance("B", {}, { dependencies: ["A"] }); // B depends on A (should skip)
      const modC = createInstance("C", {}); // C is independent (should start)

      const manager = new LifecycleManager();
      manager.registerModule(modA);
      manager.registerModule(modB);
      manager.registerModule(modC);

      const bootList = ["A", "B", "C"];
      const started = await manager.startModules(bootList);

      expect(started).toEqual(["C"]); // Only C starts
      expect(modA.state).toBe(ModuleState.UNLOADED); // Fails and cleans up
      expect(modB.state).toBe(ModuleState.UNLOADED); // Skipped and cleans up
      expect(modC.state).toBe(ModuleState.RUNNING); // Boots successfully
    });

    it("should rollback previously started modules and abort under StrictPolicy", async () => {
      const stopOrder: string[] = [];
      const modA = createInstance("A", {
        shutdown: () => {
          stopOrder.push("A");
        },
      });
      const modB = createInstance("B", {
        startup: () => {
          throw new Error("Abort");
        },
      });

      const manager = new LifecycleManager();
      manager.setPolicy(new StrictPolicy());
      manager.registerModule(modA);
      manager.registerModule(modB);

      await expect(manager.startModules(["A", "B"])).rejects.toThrow();

      expect(modA.state).toBe(ModuleState.UNLOADED); // Rolled back
      expect(stopOrder).toEqual(["A"]);
    });
  });

  describe("Events", () => {
    it("should publish events through the event bus for key state transitions", async () => {
      const eventSpy = vi.fn();
      eventBus.subscribe(LifecycleEvents.MODULE_STARTED, eventSpy);
      eventBus.subscribe(LifecycleEvents.MODULE_LOADED, eventSpy);

      const inst = createInstance("eventMod");
      const manager = new LifecycleManager();

      await manager.transition(inst, ModuleState.LOADED);
      await manager.initialize(inst);
      await manager.start(inst);

      expect(eventSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("Large Scale Tests", () => {
    it("should support transitionMany on a large module set (100 modules) in bulk O(N)", async () => {
      const manager = new LifecycleManager();
      const instances: ModuleInstance[] = [];

      for (let i = 0; i < 100; i++) {
        const inst = createInstance(`bulk-${i}`);
        manager.registerModule(inst);
        instances.push(inst);
      }

      await manager.transitionMany(instances, ModuleState.LOADED);
      for (const inst of instances) {
        expect(inst.state).toBe(ModuleState.LOADED);
      }
    });
  });
});
