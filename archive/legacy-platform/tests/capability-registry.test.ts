import { describe, it, expect, vi } from "vitest";
import {
  CapabilityRegistry,
  Capability,
  DuplicateCapabilityRegistrationError,
  CapabilityNotFoundError,
  InvalidCapabilityPriorityError,
  CapabilityVersionMismatchError,
  InvalidCapabilityMetadataError,
  RuntimeManager,
  ModuleState,
  CapabilityEvents,
  ModuleInstance,
} from "../src/runtime";
import { eventBus } from "../src/shared/infrastructure/event-bus";

describe("Platform Runtime - Capability Registry", () => {
  const createMockCapability = (
    id: string,
    providerModule: string,
    priority: number = 100,
    version: string = "1.0.0",
    tags: string[] = [],
  ): Capability => ({
    id,
    name: id.toUpperCase(),
    description: `Test capability ${id}`,
    version,
    providerModule,
    priority,
    tags,
    status: "active",
  });

  describe("Capability Registration & Validation", () => {
    it("should successfully register, lookup, and unregister a capability provider", () => {
      const registry = new CapabilityRegistry();
      const cap = createMockCapability("search", "search-mod");
      const serviceInstance = { search: () => ["result"] };

      registry.register(cap, serviceInstance);

      expect(registry.has("search")).toBe(true);
      expect(registry.find("search")).toEqual(cap);
      expect(registry.getProviders("search")).toEqual(["search-mod"]);
      expect(registry.resolve("search")).toBe(serviceInstance);

      // Unregister
      registry.unregister("search", "search-mod");
      expect(registry.has("search")).toBe(false);
      expect(registry.find("search")).toBeNull();
      expect(() => registry.resolve("search")).toThrow(CapabilityNotFoundError);
    });

    it("should throw DuplicateCapabilityRegistrationError when same module registers same capability ID twice", () => {
      const registry = new CapabilityRegistry();
      const cap1 = createMockCapability("stats", "stats-mod");
      const cap2 = createMockCapability("stats", "stats-mod");

      registry.register(cap1);
      expect(() => registry.register(cap2)).toThrow(DuplicateCapabilityRegistrationError);
    });

    it("should throw InvalidCapabilityPriorityError when priority is negative or invalid", () => {
      const registry = new CapabilityRegistry();
      const cap = createMockCapability("search", "search-mod", -5);

      expect(() => registry.register(cap)).toThrow(InvalidCapabilityPriorityError);
    });

    it("should throw InvalidCapabilityMetadataError when ID or version is empty", () => {
      const registry = new CapabilityRegistry();
      const capNoId = {
        id: "",
        name: "test",
        description: "d",
        version: "1.0.0",
        providerModule: "m",
        priority: 100,
        tags: [],
        status: "active" as const,
      };
      expect(() => registry.register(capNoId)).toThrow(InvalidCapabilityMetadataError);
    });
  });

  describe("Provider Selection & Prioritization", () => {
    it("should resolve the provider with the highest priority when multiple exist", () => {
      const registry = new CapabilityRegistry();

      const providerLow = createMockCapability("database", "sqlite-mod", 50);
      const serviceLow = { type: "sqlite" };

      const providerHigh = createMockCapability("database", "postgres-mod", 150);
      const serviceHigh = { type: "postgres" };

      registry.register(providerLow, serviceLow);
      registry.register(providerHigh, serviceHigh);

      expect(registry.resolve("database")).toBe(serviceHigh);

      // Verify resolveAll returns them in prioritized order
      const allResolved = registry.resolveAll("database");
      expect(allResolved).toEqual([serviceHigh, serviceLow]);
    });

    it("should resolve ties deterministically using provider module ID sorting", () => {
      const registry = new CapabilityRegistry();

      const providerA = createMockCapability("logger", "a-logger", 100);
      const serviceA = { name: "A" };

      const providerB = createMockCapability("logger", "b-logger", 100);
      const serviceB = { name: "B" };

      registry.register(providerB, serviceB);
      registry.register(providerA, serviceA);

      // Deterministic choice should be 'a-logger' because of alphabetical sorting on tie
      const selected = registry.find("logger");
      expect(selected?.providerModule).toBe("a-logger");
      expect(registry.resolve("logger")).toBe(serviceA);
    });
  });

  describe("Lookups & Filtering", () => {
    it("should filter lookups by module ID and list all registered capabilities", () => {
      const registry = new CapabilityRegistry();
      const cap1 = createMockCapability("search", "mod-a");
      const cap2 = createMockCapability("stats", "mod-a");
      const cap3 = createMockCapability("billing", "mod-b");

      registry.register(cap1);
      registry.register(cap2);
      registry.register(cap3);

      expect(registry.getCapabilities("mod-a")).toEqual([cap1, cap2]);
      expect(registry.list()).toEqual([cap1, cap2, cap3]);
    });
  });

  describe("Semantic Version Bound Resolution", () => {
    it("should resolve capability instances matching the specified semver range check", () => {
      const registry = new CapabilityRegistry();

      const capOld = createMockCapability("engine", "engine-v1", 100, "1.2.0");
      const serviceOld = { ver: "1.2.0" };

      const capNew = createMockCapability("engine", "engine-v2", 100, "2.1.0");
      const serviceNew = { ver: "2.1.0" };

      registry.register(capOld, serviceOld);
      registry.register(capNew, serviceNew);

      // Matches ^1.0.0 -> should resolve engine-vold
      expect(registry.resolve("engine", "^1.0.0")).toBe(serviceOld);

      // Matches ^2.0.0 -> should resolve engine-vnew
      expect(registry.resolve("engine", "^2.0.0")).toBe(serviceNew);

      // Unmatched version range -> throws CapabilityVersionMismatchError
      expect(() => registry.resolve("engine", "^3.0.0")).toThrow(CapabilityVersionMismatchError);
    });
  });

  describe("Lifecycle Integration", () => {
    it("should automatically register capabilities on startup and unregister them on shutdown in RuntimeManager", async () => {
      const manager = new RuntimeManager();

      const storageModuleDefinition = {
        name: "storage-provider",
        version: "1.0.0",
        startup: () => {},
      };

      const mockManifest = {
        id: "storage-module",
        name: "Storage Module",
        version: "1.0.0",
        sdkVersion: "^1.0.0",
        description: "Provides storage capacity",
        author: "AKIRA",
        capabilities: ["storage", "caching"],
        enabled: true,
      };

      // Manually construct instance with manifest configuration loaded
      const context = (manager as any).createContextForModule("storage-module");
      const inst = new ModuleInstance(
        "storage-module",
        "Storage Module",
        "1.0.0",
        context,
        storageModuleDefinition,
        mockManifest,
      );

      // Register with manager maps
      manager.registerDiscoveredModule("storage-module", "mock/path");
      (manager as any).instances.set("storage-module", inst);
      manager.lifecycleManager.registerModule(inst);

      // Start it up via lifecycle manager
      await manager.lifecycleManager.start(inst);

      expect(inst.state).toBe(ModuleState.RUNNING);

      // Capabilities should be registered automatically!
      expect(manager.capabilityRegistry.has("storage")).toBe(true);
      expect(manager.capabilityRegistry.has("caching")).toBe(true);
      expect(manager.capabilityRegistry.getProviders("storage")).toContain("storage-module");

      // Shutdown module
      await manager.unloadModule("storage-module");

      // Capabilities should be removed automatically!
      expect(manager.capabilityRegistry.has("storage")).toBe(false);
      expect(manager.capabilityRegistry.has("caching")).toBe(false);
    });
  });

  describe("Events", () => {
    it("should publish events through the event bus for capability registration and removal", () => {
      const eventSpy = vi.fn();
      eventBus.subscribe(CapabilityEvents.REGISTERED, eventSpy);
      eventBus.subscribe(CapabilityEvents.REMOVED, eventSpy);

      const registry = new CapabilityRegistry();
      const cap = createMockCapability("db", "db-mod");

      registry.register(cap);
      registry.unregister("db", "db-mod");

      expect(eventSpy).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * Registration and resolution do not scan the registry.
   *
   * This was two wall-clock thresholds -- 1000 registrations under 50 ms, one
   * resolve under 5 ms. Both passed alone and flaked under full-suite load,
   * which is what an absolute threshold does on a shared machine: it measures
   * the machine, and `tests/support/perf-ab.ts` records that absolute latency
   * here is not trustworthy to better than about 3x. The second was not
   * measuring anything either -- `Date.now()` has millisecond resolution and a
   * single Map lookup is orders of magnitude below it, so it read zero whatever
   * the implementation did, and would have kept reading zero if `resolve` had
   * been rewritten as a linear scan.
   *
   * The property actually meant is structural, so it is asserted structurally.
   * ADR-020 specifies a registry keyed by capability id, with priority ranking
   * and an alphabetical tie-break "among providers of that capability" -- so
   * both operations may touch the providers of the id they are given, and must
   * never touch anyone else. Counting reads of the capability objects states
   * exactly that, is exact rather than statistical, and cannot flake under
   * load.
   */
  describe("Registration and resolution do not scan", () => {
    /**
     * A capability that records every property read of it.
     *
     * The registry only ever reaches a capability through its properties --
     * `status`, `priority`, `providerModule`, `version` -- so a read is the
     * finest-grained evidence available that an operation touched it at all,
     * and needs no change to the registry to obtain. Reading `target.id` inside
     * the trap goes direct to the target, so it does not count itself.
     */
    const watched = (cap: Capability, reads: Map<string, number>): Capability =>
      new Proxy(cap, {
        get(target, prop, receiver) {
          if (typeof prop === "string") {
            reads.set(target.id, (reads.get(target.id) ?? 0) + 1);
          }
          return Reflect.get(target, prop, receiver);
        },
      });

    /** A registry of `size` capabilities, each under its own id. */
    const populate = (size: number) => {
      const reads = new Map<string, number>();
      const registry = new CapabilityRegistry();
      for (let i = 0; i < size; i++) {
        registry.register(watched(createMockCapability(`cap-${i}`, `provider-${i}`, i), reads), {
          instanceIndex: i,
        });
      }
      return { registry, reads };
    };

    it("resolve touches only the providers of the id it was given", () => {
      const { registry, reads } = populate(1000);

      reads.clear();
      const res = registry.resolve("cap-500");

      expect(res.instanceIndex).toBe(500);
      // The behaviour is unchanged; what follows is about how it was reached.
      expect(reads.get("cap-500")).toBeGreaterThan(0);
      expect(
        [...reads.keys()].filter((id) => id !== "cap-500"),
        "resolve read capabilities other than the one it was asked for",
      ).toEqual([]);
    });

    it("registering touches only the providers already under that id", () => {
      const { registry, reads } = populate(1000);

      reads.clear();
      registry.register(watched(createMockCapability("cap-new", "provider-new", 1), reads), {
        instanceIndex: -1,
      });

      expect(
        [...reads.keys()].filter((id) => id !== "cap-new"),
        "registering read capabilities unrelated to the one being registered",
      ).toEqual([]);
    });

    it("costs the same in a large registry as in a small one", () => {
      // The scaling statement. A tenfold registry must cost the same, not ten
      // times as much -- and because these are exact counts rather than
      // timings, "the same" can be asserted as equality.
      const measure = (size: number) => {
        const { registry, reads } = populate(size);

        reads.clear();
        registry.register(watched(createMockCapability("cap-new", "provider-new", 1), reads), {
          instanceIndex: -1,
        });
        const toRegister = [...reads.values()].reduce((a, b) => a + b, 0);

        reads.clear();
        registry.resolve(`cap-${Math.floor(size / 2)}`);
        const toResolve = [...reads.values()].reduce((a, b) => a + b, 0);

        return { toRegister, toResolve };
      };

      const small = measure(100);
      const large = measure(1000);

      expect(large.toRegister, "registration cost grew with registry size").toBe(small.toRegister);
      expect(large.toResolve, "resolution cost grew with registry size").toBe(small.toResolve);
    });
  });
});
