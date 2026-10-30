import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  DependencyResolver,
  MissingDependencyError,
  CircularDependencyError,
  DuplicateDependencyError,
  SelfDependencyError,
  InvalidDependencyError,
  analyzeDependencies,
  RuntimeManager,
  ModuleState,
} from "../src/runtime";

describe("Platform Runtime - Dependency Resolver", () => {
  const tempDir = path.resolve(__dirname, "temp_resolver_modules");

  beforeAll(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Helper to construct mock manifests
  function createManifest(id: string, dependencies: string[] = []): any {
    return {
      id,
      name: id.toUpperCase(),
      version: "1.0.0",
      sdkVersion: "^1.0.0",
      description: "Test manifest for dependency graph",
      author: "Test",
      dependencies,
      enabled: true,
    };
  }

  describe("Graph Construction and Validation", () => {
    it("should successfully build a simple dependency chain and determine startup/shutdown order", () => {
      const manifests = [
        createManifest("db", []),
        createManifest("service", ["db"]),
        createManifest("controller", ["service"]),
      ];

      const resolver = new DependencyResolver(manifests);
      const plan = resolver.resolve();

      expect(plan.isValid).toBe(true);
      expect(plan.startupOrder).toEqual(["db", "service", "controller"]);
      expect(plan.shutdownOrder).toEqual(["controller", "service", "db"]);
    });

    it("should detect self dependencies and throw SelfDependencyError", () => {
      const manifests = [createManifest("self-loop", ["self-loop"])];
      const resolver = new DependencyResolver(manifests);

      expect(() => resolver.buildGraph()).toThrow(SelfDependencyError);
    });

    it("should detect duplicate dependencies declared within the same manifest and throw DuplicateDependencyError", () => {
      const manifests = [createManifest("dup-declared", ["db", "db"])];
      const resolver = new DependencyResolver(manifests);

      expect(() => resolver.buildGraph()).toThrow(DuplicateDependencyError);
    });

    it("should detect empty/invalid dependency names and throw InvalidDependencyError", () => {
      const manifests = [createManifest("invalid-dep", [""])];
      const resolver = new DependencyResolver(manifests);

      expect(() => resolver.buildGraph()).toThrow(InvalidDependencyError);
    });

    it("should detect missing dependencies and return invalid plan", () => {
      const manifests = [createManifest("app", ["database"])];
      const resolver = new DependencyResolver(manifests);
      const plan = resolver.resolve();

      expect(plan.isValid).toBe(false);
      expect(plan.missingDependencies).toEqual([{ moduleId: "app", missingId: "database" }]);
      expect(() => resolver.validate()).toThrow(MissingDependencyError);
    });

    it("should detect circular dependencies and return cycle path list", () => {
      const manifests = [
        createManifest("A", ["B"]),
        createManifest("B", ["C"]),
        createManifest("C", ["A"]),
      ];

      const resolver = new DependencyResolver(manifests);
      const plan = resolver.resolve();

      expect(plan.isValid).toBe(false);
      expect(plan.circularDependencies).toEqual(["A", "B", "C", "A"]);
      expect(() => resolver.validate()).toThrow(CircularDependencyError);
    });

    it("should remain strictly deterministic regardless of input list order", () => {
      const m1 = createManifest("A", []);
      const m2 = createManifest("B", ["A"]);
      const m3 = createManifest("C", ["A"]);
      const m4 = createManifest("D", ["B", "C"]);

      const list1 = [m1, m2, m3, m4];
      const list2 = [m4, m3, m2, m1];
      const list3 = [m2, m4, m1, m3];

      const order1 = new DependencyResolver(list1).resolve().startupOrder;
      const order2 = new DependencyResolver(list2).resolve().startupOrder;
      const order3 = new DependencyResolver(list3).resolve().startupOrder;

      expect(order1).toEqual(order2);
      expect(order1).toEqual(order3);
    });

    it("should resolve a complex multiple dependency tree", () => {
      const manifests = [
        createManifest("core", []),
        createManifest("logger", []),
        createManifest("db", ["core", "logger"]),
        createManifest("auth", ["db"]),
        createManifest("billing", ["auth"]),
        createManifest("gateway", ["core"]),
      ];

      const resolver = new DependencyResolver(manifests);
      const plan = resolver.resolve();

      expect(plan.isValid).toBe(true);
      // Valid topological sort: core and logger are first, gateway follows core, db follows core/logger
      expect(plan.startupOrder.indexOf("core")).toBeLessThan(plan.startupOrder.indexOf("db"));
      expect(plan.startupOrder.indexOf("logger")).toBeLessThan(plan.startupOrder.indexOf("db"));
      expect(plan.startupOrder.indexOf("db")).toBeLessThan(plan.startupOrder.indexOf("auth"));
      expect(plan.startupOrder.indexOf("auth")).toBeLessThan(plan.startupOrder.indexOf("billing"));
      expect(plan.startupOrder.indexOf("core")).toBeLessThan(plan.startupOrder.indexOf("gateway"));
    });

    it("should scale and resolve large graphs (100+ modules) efficiently", () => {
      const manifests: any[] = [];
      // Create 100 modules where module N depends on module N-1
      manifests.push(createManifest("m-0", []));
      for (let i = 1; i < 100; i++) {
        manifests.push(createManifest(`m-${i}`, [`m-${i - 1}`]));
      }

      const resolver = new DependencyResolver(manifests);
      const plan = resolver.resolve();

      expect(plan.isValid).toBe(true);
      expect(plan.startupOrder).toHaveLength(100);
      expect(plan.startupOrder[0]).toBe("m-0");
      expect(plan.startupOrder[99]).toBe("m-99");
    });
  });

  describe("Transitive Skipping & Fault Tolerance (Runtime Integration)", () => {
    it("should skip only affected modules transitively on dependency failures, loading valid independent modules", () => {
      // Set up a complex manifest set containing:
      // - Safe path: base -> client (independent, should load)
      // - Broken path: missing_db -> service (service depends on missing_db, service should be skipped)
      // - Circular path: c1 -> c2 -> c1 (c1, c2 should be skipped)
      const manifests = [
        createManifest("base", []),
        createManifest("client", ["base"]),

        createManifest("service", ["missing_db"]),

        createManifest("c1", ["c2"]),
        createManifest("c2", ["c1"]),
      ];

      const analysis = analyzeDependencies(manifests);

      expect(analysis.loadableManifests).toHaveLength(2);
      expect(analysis.startupOrder).toEqual(["base", "client"]);

      const skippedIds = analysis.skippedModules.map((s) => s.id);
      expect(skippedIds).toContain("service");
      expect(skippedIds).toContain("c1");
      expect(skippedIds).toContain("c2");

      const serviceSkip = analysis.skippedModules.find((s) => s.id === "service");
      expect(serviceSkip?.reason).toContain('Missing dependency: "missing_db"');
    });

    it("should boot the RuntimeManager successfully loading only valid independent modules when folder contains dependency errors", async () => {
      // Setup folders inside tempDir representing modules:
      // - base (valid)
      // - client (depends on base, valid)
      // - broker (depends on missing-service, invalid)
      const baseDir = path.join(tempDir, "base");
      const clientDir = path.join(tempDir, "client");
      const brokerDir = path.join(tempDir, "broker");

      fs.mkdirSync(baseDir, { recursive: true });
      fs.mkdirSync(clientDir, { recursive: true });
      fs.mkdirSync(brokerDir, { recursive: true });

      fs.writeFileSync(path.join(baseDir, "manifest.json"), JSON.stringify(createManifest("base")));
      fs.writeFileSync(
        path.join(baseDir, "index.js"),
        "export default { name: 'base', version: '1.0.0' };",
      );

      fs.writeFileSync(
        path.join(clientDir, "manifest.json"),
        JSON.stringify(createManifest("client", ["base"])),
      );
      fs.writeFileSync(
        path.join(clientDir, "index.js"),
        "export default { name: 'client', version: '1.0.0' };",
      );

      fs.writeFileSync(
        path.join(brokerDir, "manifest.json"),
        JSON.stringify(createManifest("broker", ["missing-service"])),
      );
      fs.writeFileSync(
        path.join(brokerDir, "index.js"),
        "export default { name: 'broker', version: '1.0.0' };",
      );

      const manager = new RuntimeManager({
        modulesDir: tempDir,
      });

      await manager.initialize();

      // base and client should load and run successfully
      expect(manager.getModuleState("base")).toBe(ModuleState.RUNNING);
      expect(manager.getModuleState("client")).toBe(ModuleState.RUNNING);

      // broker should be in FAILED state because of missing-service
      expect(manager.getModuleState("broker")).toBe(ModuleState.FAILED);

      await manager.shutdown();
    });
  });
});
