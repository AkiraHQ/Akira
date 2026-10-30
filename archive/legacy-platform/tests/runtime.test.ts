import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { RuntimeManager } from "../src/runtime/runtime-manager";
import { ModuleState } from "../src/runtime/module-state";
import { ModuleInstance } from "../src/runtime/module-instance";

describe("Platform Runtime - Module Runtime Core", () => {
  const tempDir = path.resolve(__dirname, "temp_test_modules");
  let validModulePath: string;
  let failingModulePath: string;
  let invalidModulePath: string;

  beforeAll(() => {
    // Create temporary directory for test modules
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // 1. Valid Module
    validModulePath = path.join(tempDir, "valid-module.js");
    fs.writeFileSync(
      validModulePath,
      `
      export default {
        name: "valid-module",
        version: "1.0.0",
        startup(context) {
          context.logger.info("valid-module startup called");
          context.eventBus.publish("valid.startup", { status: "ok" });
        },
        shutdown(context) {
          context.logger.info("valid-module shutdown called");
        },
        pause(context) {
          context.logger.info("valid-module paused");
        },
        resume(context) {
          context.logger.info("valid-module resumed");
        }
      };
      `,
    );

    // 2. Startup-Failing Module
    failingModulePath = path.join(tempDir, "failing-module.js");
    fs.writeFileSync(
      failingModulePath,
      `
      export default {
        name: "failing-module",
        version: "2.1.0",
        startup(context) {
          throw new Error("Deliberate startup error");
        }
      };
      `,
    );

    // 3. Invalid Definition Module (missing version)
    invalidModulePath = path.join(tempDir, "invalid-module.js");
    fs.writeFileSync(
      invalidModulePath,
      `
      export default {
        name: "invalid-module"
      };
      `,
    );
  });

  afterAll(() => {
    // Clean up temporary test files
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Helper to convert Windows absolute path to importable file URL
  function getImportPath(absolutePath: string): string {
    return `file:///${absolutePath.replace(/\\/g, "/")}`;
  }

  describe("RuntimeManager & Lifecycle Flow", () => {
    it("should initialize successfully with no modules discovered", async () => {
      const manager = new RuntimeManager();
      await manager.initialize();
      expect(manager.listModules()).toHaveLength(0);
      await manager.shutdown();
    });

    it("should discover and load modules automatically from a configured directory", async () => {
      const manager = new RuntimeManager({
        modulesDir: tempDir,
      });

      await manager.initialize();

      // It should auto-discover the modules since they are in tempDir:
      // valid-module, failing-module, invalid-module.
      // - valid-module should load and start successfully (RUNNING)
      // - failing-module should load but fail to start (state: UNLOADED / FAILED)
      // - invalid-module should fail load entirely.
      // The runtime must stay operational.

      const validInstance = manager.getModule("valid-module");
      expect(validInstance).toBeDefined();
      expect(validInstance?.state).toBe(ModuleState.RUNNING);

      // The manager should survive the failures:
      const failingInstance = manager.getModule("failing-module");
      expect(failingInstance?.state).toBe(ModuleState.UNLOADED); // startup failed -> transitioned FAILED -> UNLOADED

      await manager.shutdown();
    });

    it("should successfully load, start, pause, resume, and unload a module manually", async () => {
      const manager = new RuntimeManager();

      // Load and Start (UNLOADED -> LOADED -> INITIALIZED -> RUNNING)
      const instance = await manager.loadModule("test-valid", getImportPath(validModulePath));
      expect(instance).toBeDefined();
      expect(instance.id).toBe("test-valid");
      expect(instance.name).toBe("valid-module");
      expect(instance.version).toBe("1.0.0");
      expect(instance.state).toBe(ModuleState.RUNNING);

      // Pause (RUNNING -> PAUSED)
      await instance.pause();
      expect(instance.state).toBe(ModuleState.PAUSED);
      expect(manager.getModuleState("test-valid")).toBe(ModuleState.PAUSED);

      // Resume (PAUSED -> RUNNING)
      await instance.resume();
      expect(instance.state).toBe(ModuleState.RUNNING);

      // Unload / Shutdown (RUNNING -> STOPPED -> UNLOADED)
      await manager.unloadModule("test-valid");
      expect(manager.getModule("test-valid")).toBeUndefined();
    });

    it("should correctly handle startup failures and transition state to UNLOADED through FAILED", async () => {
      const manager = new RuntimeManager();

      // Try to load a module that throws in startup
      const instance = await manager.loadModule("test-failing", getImportPath(failingModulePath));

      // It should transition INITIALIZED -> FAILED -> UNLOADED on startup error.
      // The loadModule should return the instance which has ended up in UNLOADED state.
      expect(instance).toBeDefined();
      expect(instance.state).toBe(ModuleState.UNLOADED);
      expect(manager.getModule("test-failing")).toBeDefined();
      expect(manager.getModuleState("test-failing")).toBe(ModuleState.UNLOADED);

      await manager.unloadModule("test-failing");
    });

    it("should fail to load a module with an invalid definition", async () => {
      const manager = new RuntimeManager();

      // Loading invalid-module (missing version) should reject immediately during load()
      await expect(
        manager.loadModule("test-invalid", getImportPath(invalidModulePath)),
      ).rejects.toThrow();

      expect(manager.getModule("test-invalid")).toBeUndefined();
    });

    it("should reject invalid lifecycle transitions", async () => {
      const manager = new RuntimeManager();
      const instance = await manager.loadModule("test-transition", getImportPath(validModulePath));

      // Currently RUNNING. Calling resume directly should fail (RUNNING -> RUNNING is invalid).
      await expect(instance.resume()).rejects.toThrow();

      // Transition to PAUSED
      await instance.pause();

      // Currently PAUSED. Calling startup directly should fail (PAUSED -> INITIALIZED is invalid).
      await expect(instance.startup()).rejects.toThrow();

      await manager.unloadModule("test-transition");
    });

    it("should reload a module gracefully", async () => {
      const manager = new RuntimeManager();
      await manager.loadModule("test-reload", getImportPath(validModulePath));

      expect(manager.getModuleState("test-reload")).toBe(ModuleState.RUNNING);

      const newInstance = await manager.reloadModule("test-reload");
      expect(newInstance.state).toBe(ModuleState.RUNNING);
      expect(manager.getModule("test-reload")).toBe(newInstance);

      await manager.unloadModule("test-reload");
    });

    it("should load multiple modules concurrently without conflicts", async () => {
      const manager = new RuntimeManager();

      const [m1, m2] = await Promise.all([
        manager.loadModule("mod1", getImportPath(validModulePath)),
        manager.loadModule("mod2", getImportPath(validModulePath)),
      ]);

      expect(m1.state).toBe(ModuleState.RUNNING);
      expect(m2.state).toBe(ModuleState.RUNNING);

      const list = manager.listModules();
      expect(list).toHaveLength(2);
      expect(list.map((m) => m.id)).toContain("mod1");
      expect(list.map((m) => m.id)).toContain("mod2");

      await manager.shutdown();
    });
  });
});
