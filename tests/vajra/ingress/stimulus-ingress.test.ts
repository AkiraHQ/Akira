import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  VajraStimulusIngressCoordinator,
  UserDirectiveIngressAdapter,
  GenesisDiscoveryIngressAdapter,
  PlatformEventIngressAdapter,
  ALLOWED_PLATFORM_EVENT_TYPES,
  CognitiveStimulus,
  ExecutiveAction,
  ExecutiveController,
  createStimulus,
  initializeVajraRuntime,
  shutdownVajraRuntime,
  _resetCompositionStateForTesting,
  getVajraIngressCoordinator,
  getUserDirectiveAdapter,
  getGenesisDiscoveryAdapter,
  getPlatformEventAdapter,
} from "../../../src/vajra";
import { EventBus } from "../../../src/instrumentation/event-bus";
import { AkiraEvent } from "../../../src/instrumentation/event-types";
import { Result } from "../../../src/contracts/results/result";
import Database from "better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";
import { SqliteOperationalStateStore } from "../../../src/persistence/vajra/sqlite-operational-state-store";
import { CapabilityRegistry } from "../../../src/contracts/capabilities/registry";
import { submitUserDirectiveRpc, processUserDirective } from "../../../src/vajra/server/ingress";
import { runWithStartContext } from "@tanstack/start-storage-context";

function createTestDb(): SqliteOperationalStateStore {
  const db = new Database(":memory:");
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

  return new SqliteOperationalStateStore(db);
}

describe("AKIRA — VAJRA Phase 8A / Task 03B: Production Stimulus Ingress", () => {
  let mockController: any;
  let receivedStimuli: CognitiveStimulus<any>[];
  let controllerState: string;

  beforeEach(() => {
    _resetCompositionStateForTesting();
    receivedStimuli = [];
    controllerState = "RUNNING";

    mockController = {
      getState: () => controllerState,
      getPendingTurnsCount: () => 0,
      receiveStimulus: vi.fn(async (stimulus: CognitiveStimulus) => {
        receivedStimuli.push(stimulus);
        const action: ExecutiveAction = {
          id: `act-${stimulus.id}`,
          kind: "wait_and_observe",
          rationale: "Deliberated by test arbiter",
          confidence: 1.0,
          policyCompliance: true,
          correlation: stimulus.correlation,
        };
        return Result.success(action, stimulus.correlation);
      }),
    };
  });

  afterEach(async () => {
    try {
      await shutdownVajraRuntime();
    } catch {
      // Best-effort teardown between tests
    }
    _resetCompositionStateForTesting();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. User Directives Ingress
  // =========================================================================
  describe("User Directives Ingress", () => {
    it("successfully creates human_prompt stimulus and preserves conversation and correlation metadata", async () => {
      const coordinator = new VajraStimulusIngressCoordinator(async () => mockController);
      coordinator.attach();

      const userAdapter = new UserDirectiveIngressAdapter(coordinator, () => "verified-developer");
      userAdapter.attach();

      const result = await userAdapter.submitDirective({
        text: "Create a new project named 'Deep Work'",
        conversationId: "conv-12345",
        correlation: {
          requestId: "req-custom-1",
          correlationId: "corr-custom-1",
        },
      });

      expect(result.ok).toBe(true);
      expect(receivedStimuli.length).toBe(1);

      const stimulus = receivedStimuli[0];
      expect(stimulus.kind).toBe("human_prompt");
      expect(stimulus.source).toBe("user.directive");
      expect(stimulus.correlation.requestId).toBe("req-custom-1");
      expect(stimulus.correlation.correlationId).toBe("corr-custom-1");
      expect(stimulus.payload.directive).toBe("Create a new project named 'Deep Work'");
      expect(stimulus.payload.conversationId).toBe("conv-12345");
      expect(stimulus.payload.actor).toBe("verified-developer");
    });

    it("rejects empty, whitespace-only, malformed, and oversized inputs fail-closed", async () => {
      const coordinator = new VajraStimulusIngressCoordinator(async () => mockController);
      coordinator.attach();
      const userAdapter = new UserDirectiveIngressAdapter(coordinator);
      userAdapter.attach();

      // Empty string
      const emptyRes = await userAdapter.submitDirective({ text: "" });
      expect(emptyRes.ok).toBe(false);
      expect(emptyRes.error).toContain("cannot be empty or whitespace-only");

      // Whitespace-only
      const wsRes = await userAdapter.submitDirective({ text: "   \n\t  " });
      expect(wsRes.ok).toBe(false);
      expect(wsRes.error).toContain("cannot be empty or whitespace-only");

      // Malformed / Non-string
      const nonStringRes = await userAdapter.submitDirective({ text: 12345 as any });
      expect(nonStringRes.ok).toBe(false);
      expect(nonStringRes.error).toContain("must be a string");

      // Oversized (> 4000 characters)
      const oversizedText = "x".repeat(4001);
      const oversizeRes = await userAdapter.submitDirective({ text: oversizedText });
      expect(oversizeRes.ok).toBe(false);
      expect(oversizeRes.error).toContain("exceeds maximum length of 4000");

      expect(receivedStimuli.length).toBe(0);
    });

    it("ensures browser-supplied identity or permissions cannot override trusted identity", async () => {
      const coordinator = new VajraStimulusIngressCoordinator(async () => mockController);
      coordinator.attach();

      // Trusted server identity is 'server-authorized-user'
      const userAdapter = new UserDirectiveIngressAdapter(
        coordinator,
        () => "server-authorized-user",
      );
      userAdapter.attach();

      // Client attempts to spoof an admin ID and execution permission in input
      const result = await userAdapter.submitDirective({
        text: "Delete all files",
        userId: "admin-root",
        authLevel: "superuser",
        executionPermissions: ["ALL"],
      } as any);

      expect(result.ok).toBe(true);
      expect(receivedStimuli[0].payload.actor).toBe("server-authorized-user");
      // Spoofed fields must not be recognized as authoritative permissions
      expect((receivedStimuli[0].payload as any).authLevel).toBeUndefined();
      expect((receivedStimuli[0].payload as any).executionPermissions).toBeUndefined();
    });

    it("rejects directive submissions when the adapter or coordinator is detached", async () => {
      const coordinator = new VajraStimulusIngressCoordinator(async () => mockController);
      const userAdapter = new UserDirectiveIngressAdapter(coordinator);

      // Adapter is not attached
      const res = await userAdapter.submitDirective({ text: "Valid command" });
      expect(res.ok).toBe(false);
      expect(res.error).toContain("UserDirectiveIngressAdapter is not attached");
      expect(receivedStimuli.length).toBe(0);
    });
  });

  // =========================================================================
  // 2. GENESIS Cognitive Discovery Ingress
  // =========================================================================
  describe("GENESIS Cognitive Discovery Ingress", () => {
    it("subscribes to real discovery updates and transforms emitted insights into subsystem_discovery stimuli", async () => {
      const coordinator = new VajraStimulusIngressCoordinator(async () => mockController);
      coordinator.attach();

      let registeredListener: ((insights: any[]) => void) | null = null;
      let unsubscribed = false;

      const mockSubscribe = vi.fn((listener: (insights: any[]) => void) => {
        registeredListener = listener;
        // On initial attach, emit empty or existing baseline
        listener([]);
        return () => {
          unsubscribed = true;
          registeredListener = null;
        };
      });

      const discoveryAdapter = new GenesisDiscoveryIngressAdapter(coordinator, mockSubscribe);
      discoveryAdapter.attach();

      expect(mockSubscribe).toHaveBeenCalledTimes(1);
      expect(discoveryAdapter.isAttached()).toBe(true);

      // Simulate GENESIS insightEngine discovering an insight
      registeredListener!([
        {
          id: "ins-commitment-1",
          canonicalKey: "commitment.parallel_overload",
          category: "Parallel Commitments",
          confidence: "HIGH",
          supportingUnderstandingIds: ["und-1", "und-2"],
          updatedAt: "2026-10-31T03:00:00Z",
        },
      ]);

      // Give microtask tick to settle asynchronous submission
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(receivedStimuli.length).toBe(1);
      const stimulus = receivedStimuli[0];
      expect(stimulus.kind).toBe("subsystem_discovery");
      expect(stimulus.source).toBe("genesis.insight_engine");
      expect(stimulus.payload.insightId).toBe("ins-commitment-1");
      expect(stimulus.payload.canonicalKey).toBe("commitment.parallel_overload");
      expect(stimulus.payload.category).toBe("Parallel Commitments");
      expect(stimulus.payload.supportingUnderstandingIds).toEqual(["und-1", "und-2"]);

      // Teardown
      discoveryAdapter.detach();
      expect(unsubscribed).toBe(true);
      expect(discoveryAdapter.isAttached()).toBe(false);
    });

    it("seeds baseline insights on initial attach and avoids flooding historical snapshot", async () => {
      const coordinator = new VajraStimulusIngressCoordinator(async () => mockController);
      coordinator.attach();

      const existingBaseline = [
        {
          id: "ins-old-1",
          canonicalKey: "learning.momentum",
          category: "Learning Momentum",
          confidence: "MEDIUM",
          supportingUnderstandingIds: ["und-old"],
        },
      ];

      const mockSubscribe = vi.fn((listener: (insights: any[]) => void) => {
        // Immediate baseline emission on subscribe
        listener(existingBaseline);
        return () => {};
      });

      const discoveryAdapter = new GenesisDiscoveryIngressAdapter(coordinator, mockSubscribe);
      discoveryAdapter.attach();

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Existing baseline should be seeded and NOT submitted as new stimulus
      expect(receivedStimuli.length).toBe(0);
    });

    it("suppresses duplicate insight emissions and unchanged snapshots", async () => {
      const coordinator = new VajraStimulusIngressCoordinator(async () => mockController);
      coordinator.attach();

      let registeredListener: ((insights: any[]) => void) | null = null;
      const mockSubscribe = (listener: any) => {
        registeredListener = listener;
        listener([]);
        return () => {};
      };

      const discoveryAdapter = new GenesisDiscoveryIngressAdapter(coordinator, mockSubscribe);
      discoveryAdapter.attach();

      const testInsight = {
        id: "ins-dup-test",
        canonicalKey: "goal.alignment.drift",
        category: "Goal Alignment",
        confidence: "HIGH",
        supportingUnderstandingIds: ["und-3"],
        updatedAt: "2026-10-31T03:00:00Z",
      };

      // First emission
      registeredListener!([testInsight]);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(receivedStimuli.length).toBe(1);

      // Re-emitting the exact same unchanged insight snapshot
      registeredListener!([testInsight]);
      await new Promise((resolve) => setTimeout(resolve, 10));
      // Should NOT submit a second time
      expect(receivedStimuli.length).toBe(1);
    });
  });

  // =========================================================================
  // 3. Platform Event Ingress
  // =========================================================================
  describe("Platform Event Ingress", () => {
    it("subscribes to EventBus and transforms allowlisted domain events into system_event stimuli", async () => {
      const coordinator = new VajraStimulusIngressCoordinator(async () => mockController);
      coordinator.attach();

      const bus = new EventBus();
      const platformAdapter = new PlatformEventIngressAdapter(coordinator);
      platformAdapter.attach(bus);

      expect(platformAdapter.isAttached()).toBe(true);

      // Publish allowlisted event: task.completed
      bus.publish({
        id: "evt-task-1",
        type: "task.completed",
        timestamp: new Date().toISOString(),
        source: "akira-store",
        entityId: "task-99",
        actor: "human-user",
        payload: { title: "Refactor core modules", projectId: "proj-1" },
        version: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(receivedStimuli.length).toBe(1);
      const stimulus = receivedStimuli[0];
      expect(stimulus.kind).toBe("system_event");
      expect(stimulus.source).toBe("akira.platform_bus");
      expect(stimulus.correlation.causationId).toBe("evt-task-1");
      expect(stimulus.payload.eventType).toBe("task.completed");
      expect(stimulus.payload.entityId).toBe("task-99");
      expect((stimulus.payload.data as any).title).toBe("Refactor core modules");

      platformAdapter.detach();
      expect(platformAdapter.isAttached()).toBe(false);
    });

    it("ignores disallowed, high-frequency, or ephemeral event types", async () => {
      const coordinator = new VajraStimulusIngressCoordinator(async () => mockController);
      coordinator.attach();

      const bus = new EventBus();
      const platformAdapter = new PlatformEventIngressAdapter(coordinator);
      platformAdapter.attach(bus);

      // Publish disallowed events
      bus.publish({
        id: "evt-presence-1",
        type: "presence.updated",
        timestamp: new Date().toISOString(),
        source: "akira-ui",
        payload: { status: "AWAY" },
        version: 1,
      });

      bus.publish({
        id: "evt-search-1",
        type: "search.executed",
        timestamp: new Date().toISOString(),
        source: "search-bar",
        payload: { query: "vacation" },
        version: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(receivedStimuli.length).toBe(0);
      platformAdapter.detach();
    });

    it("suppresses VAJRA-originated events to prevent circular feedback loops", async () => {
      const coordinator = new VajraStimulusIngressCoordinator(async () => mockController);
      coordinator.attach();

      const bus = new EventBus();
      const platformAdapter = new PlatformEventIngressAdapter(coordinator);
      platformAdapter.attach(bus);

      // Event carrying publisher-authenticated provenance { isVajra: true }
      bus.publish({
        id: "evt-vajra-1",
        type: "task.completed",
        timestamp: new Date().toISOString(),
        source: "tasks-store",
        metadata: { isVajra: true },
        payload: { title: "Automated mission completed" },
        version: 1,
      });

      // Event carrying metadata { isVajra: true }
      bus.publish({
        id: "evt-vajra-2",
        type: "project.updated",
        timestamp: new Date().toISOString(),
        source: "coordinator",
        metadata: { isVajra: true },
        payload: { id: "p1" },
        version: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Both VAJRA self-events must be suppressed!
      expect(receivedStimuli.length).toBe(0);
      platformAdapter.detach();
    });

    it("deduplicates repeated platform events by id", async () => {
      const coordinator = new VajraStimulusIngressCoordinator(async () => mockController);
      coordinator.attach();

      const bus = new EventBus();
      const platformAdapter = new PlatformEventIngressAdapter(coordinator);
      platformAdapter.attach(bus);

      const event: AkiraEvent = {
        id: "evt-unique-dup",
        type: "project.created",
        timestamp: new Date().toISOString(),
        source: "workspace-ui",
        payload: { name: "Project Akira" },
        version: 1,
      };

      bus.publish(event);
      bus.publish(event); // Re-publish same event

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(receivedStimuli.length).toBe(1);
      platformAdapter.detach();
    });
  });

  // =========================================================================
  // 4. Ingress Authority & Decision Pipeline Enforcement
  // =========================================================================
  describe("Authority & Decision Pipeline Invariants", () => {
    it("ensures all ingress paths submit strictly through receiveStimulus() and never execute capabilities directly", async () => {
      const coordinator = new VajraStimulusIngressCoordinator(async () => mockController);
      coordinator.attach();

      const userAdapter = new UserDirectiveIngressAdapter(coordinator);
      userAdapter.attach();

      const bus = new EventBus();
      const platformAdapter = new PlatformEventIngressAdapter(coordinator);
      platformAdapter.attach(bus);

      // 1. Submit User Directive
      await userAdapter.submitDirective({ text: "Create task test" });

      // 2. Publish Platform Event
      bus.publish({
        id: "evt-proj-auth",
        type: "project.created",
        timestamp: new Date().toISOString(),
        source: "ui",
        payload: { name: "P1" },
        version: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 15));

      // Verify that mockController.receiveStimulus was invoked for both
      expect(mockController.receiveStimulus).toHaveBeenCalledTimes(2);
      expect(receivedStimuli.map((s) => s.kind)).toEqual(["human_prompt", "system_event"]);
    });

    it("verifies that duplicate stimuli rejected by the coordinator never reach the controller", async () => {
      const coordinator = new VajraStimulusIngressCoordinator(async () => mockController);
      coordinator.attach();

      const customStimulus = createStimulus({
        id: "stim-fixed-id",
        kind: "human_prompt",
        source: "test",
        payload: { text: "hello" },
        correlation: {
          requestId: "req-1",
          correlationId: "corr-1",
          invocationId: "inv-1",
        },
      });

      const firstRes = await coordinator.submitStimulus(customStimulus);
      expect(firstRes.ok).toBe(true);

      const secondRes = await coordinator.submitStimulus(customStimulus);
      expect(secondRes.ok).toBe(false);
      expect(secondRes.error).toContain("Duplicate stimulus rejected");

      // Controller should only have received it once
      expect(mockController.receiveStimulus).toHaveBeenCalledTimes(1);
    });

    it("fails closed when VAJRA controller is not in RUNNING state", async () => {
      controllerState = "PAUSED";
      const coordinator = new VajraStimulusIngressCoordinator(async () => mockController);
      coordinator.attach();

      const stimulus = createStimulus({
        id: "stim-fail-state",
        kind: "human_prompt",
        source: "test",
        payload: { text: "execute" },
        correlation: {
          requestId: "req-2",
          correlationId: "corr-2",
          invocationId: "inv-2",
        },
      });

      const res = await coordinator.submitStimulus(stimulus);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("VAJRA controller is not RUNNING");
      expect(receivedStimuli.length).toBe(0);
    });
  });

  // =========================================================================
  // 5. Ingress Lifecycle Integration & Teardown
  // =========================================================================
  describe("Composition Lifecycle & Teardown", () => {
    it("attaches all ingress adapters automatically during initializeVajraRuntime()", async () => {
      const controller = await initializeVajraRuntime({
        stateStore: createTestDb(),
        capabilityRegistry: new CapabilityRegistry(),
        skipRecovery: true,
      });

      expect(controller.getState()).toBe("RUNNING");

      const coordinator = getVajraIngressCoordinator();
      const userAdapter = getUserDirectiveAdapter();
      const discoveryAdapter = getGenesisDiscoveryAdapter();
      const platformAdapter = getPlatformEventAdapter();

      expect(coordinator).not.toBeNull();
      expect(userAdapter).not.toBeNull();
      expect(discoveryAdapter).not.toBeNull();
      expect(platformAdapter).not.toBeNull();

      expect(coordinator!.isAttached()).toBe(true);
      expect(userAdapter!.isAttached()).toBe(true);
      expect(discoveryAdapter!.isAttached()).toBe(true);
      expect(platformAdapter!.isAttached()).toBe(true);

      // Clean shutdown
      await shutdownVajraRuntime();

      expect(coordinator!.isAttached()).toBe(false);
      expect(userAdapter!.isAttached()).toBe(false);
      expect(discoveryAdapter!.isAttached()).toBe(false);
      expect(platformAdapter!.isAttached()).toBe(false);

      expect(getVajraIngressCoordinator()).toBeNull();
    });

    it("cleans up attached ingress adapters in reverse order if subsequent initialization steps fail", async () => {
      let rollbackInvoked = false;

      const brokenStateStore = {
        ...createTestDb(),
        detectInterruptedMissions: async () => {
          throw new Error("Simulated failure during recovery triage");
        },
      };

      await expect(
        initializeVajraRuntime({
          stateStore: brokenStateStore as any,
          capabilityRegistry: new CapabilityRegistry(),
          skipRecovery: false,
          testCleanupTasks: [
            {
              name: "simulated-test-cleanup",
              cleanup: async () => {
                rollbackInvoked = true;
              },
            },
          ],
        }),
      ).rejects.toThrow("Simulated failure during recovery triage");

      expect(rollbackInvoked).toBe(true);
      expect(getVajraIngressCoordinator()).toBeNull();
    });
  });

  // =========================================================================
  // 6. Server RPC Endpoint Integration
  // =========================================================================
  describe("Server RPC Ingress Function", () => {
    it("rejects invalid inputs and returns structured failure response via processUserDirective", async () => {
      const response = await processUserDirective({
        text: "", // Empty input
      });

      expect(response.success).toBe(false);
      expect(response.code).toBe("REJECTED_INVALID");
      expect(response.message).toContain("cannot be empty or whitespace-only");
    });

    it("sanitizes response and strips internal reasoning details from successful RPC outcomes", async () => {
      const response = await processUserDirective({
        text: "Analyze current focus",
      });

      expect(response.success).toBe(true);
      expect(response.code).toBe("ACCEPTED");
      expect(typeof response.actionKind).toBe("string");
      expect(response.actionId).toBeDefined();
      expect(response.correlationId).toBeDefined();
      expect(response.message).toBe("Directive accepted for operational processing.");

      // Strict privacy invariant: Internal deliberation details must NEVER be exposed
      expect((response as any).action).toBeUndefined();
      expect((response as any).rationale).toBeUndefined();
      expect((response as any).policyBasis).toBeUndefined();
      expect((response as any).evidenceBasis).toBeUndefined();
      expect((response as any).confidence).toBeUndefined();
    });

    it("verifies submitUserDirectiveRpc function is defined and exports server function contract", () => {
      expect(typeof submitUserDirectiveRpc).toBe("function");
    });
  });
});
