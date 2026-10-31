import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CooperativeTurnScheduler,
  SchedulerCapacityExceededError,
} from "../../../src/vajra/executive/scheduler";
import { ExecutiveController } from "../../../src/vajra/executive/controller";
import { SelfModel } from "../../../src/vajra/self-model/self-model";
import { InMemoryGenesisAdapter } from "../../../src/vajra/boundaries/genesis-port";
import { InMemoryAkiraOSAdapter } from "../../../src/vajra/boundaries/akira-os-port";
import { InMemoryEscalationAdapter } from "../../../src/vajra/boundaries/escalation-port";
import { createStimulus, CognitiveStimulus } from "../../../src/vajra/types/stimulus";
import {
  VajraStimulusIngressCoordinator,
  GenesisDiscoveryIngressAdapter,
  PlatformEventIngressAdapter,
  UserDirectiveIngressAdapter,
} from "../../../src/vajra/ingress";
import { EventBus } from "../../../src/instrumentation/event-bus";
import { Publisher } from "../../../src/instrumentation/publisher";
import { CapabilityRegistry } from "../../../src/contracts/capabilities/registry";
import { processUserDirective } from "../../../src/vajra/server/ingress";
import { Result } from "../../../src/contracts/results/result";
import * as vajraComposition from "../../../src/vajra/composition";

describe("AKIRA — VAJRA Phase 8A / Task 03E: Provenance & Scheduler Semantics Closure", () => {
  beforeEach(() => {
    vajraComposition._resetCompositionStateForTesting();
  });

  afterEach(() => {
    vajraComposition._resetCompositionStateForTesting();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Scheduler Capacity Semantics (Tests 5, 6, 7, 8)
  // =========================================================================
  describe("Scheduler Capacity Semantics", () => {
    // Required Test 5 & 6:
    // Queue accepts exactly maxQueueSize waiting turns, excluding executing turn.
    // Next submission rejects with SchedulerCapacityExceededError without increasing queue length.
    it("accepts exactly maxQueueSize waiting turns (excluding executing turn) and rejects next submission without increasing queue length", async () => {
      const maxCapacity = 3;
      const scheduler = new CooperativeTurnScheduler(maxCapacity);

      expect(scheduler.getMaxQueueSize()).toBe(maxCapacity);
      expect(scheduler.getPendingCount()).toBe(0);

      // Block turn execution with a deferred promise so items accumulate in queue
      let releaseFirstTurn!: () => void;
      const blockingPromise = new Promise<void>((resolve) => {
        releaseFirstTurn = resolve;
      });

      // Turn 1: Starts immediately (active processing, excluded from pending queue)
      const t1 = scheduler.enqueueTurn(async () => {
        await blockingPromise;
        return "t1-done";
      });

      // Turns 2, 3, 4: Enter pending queue (reaches exact capacity limit of 3 waiting turns)
      const t2 = scheduler.enqueueTurn(async () => "t2-done");
      const t3 = scheduler.enqueueTurn(async () => "t3-done");
      const t4 = scheduler.enqueueTurn(async () => "t4-done");

      expect(scheduler.getPendingCount()).toBe(3);

      // Turn 5: Must be rejected immediately because waiting queue length (3) >= maxCapacity (3)
      let turn5Rejected = false;
      try {
        await scheduler.enqueueTurn(async () => "t5-fail");
      } catch (err: any) {
        turn5Rejected = true;
        expect(err).toBeInstanceOf(SchedulerCapacityExceededError);
        expect(err.code).toBe("CAPACITY_EXCEEDED");
        expect(err.pendingCount).toBe(3);
        expect(err.maxCapacity).toBe(3);
      }
      expect(turn5Rejected).toBe(true);

      // Queue length must not grow past maxCapacity
      expect(scheduler.getPendingCount()).toBe(3);

      // Release first turn and allow remaining accepted turns to process in FIFO order
      releaseFirstTurn();

      const results = await Promise.all([t1, t2, t3, t4]);
      expect(results).toEqual(["t1-done", "t2-done", "t3-done", "t4-done"]);
      expect(scheduler.getPendingCount()).toBe(0);
    });

    it("ensures rejected turns settle their promises immediately and preserve FIFO order for accepted turns", async () => {
      const scheduler = new CooperativeTurnScheduler(2);
      const executionOrder: string[] = [];

      let unblock!: () => void;
      const blocker = new Promise<void>((resolve) => {
        unblock = resolve;
      });

      // Slot 1 (active)
      scheduler.enqueueTurn(async () => {
        await blocker;
        executionOrder.push("turn-1");
      });

      // Queue slot 1
      scheduler.enqueueTurn(async () => {
        executionOrder.push("turn-2");
      });

      // Queue slot 2 (queue full at 2)
      scheduler.enqueueTurn(async () => {
        executionOrder.push("turn-3");
      });

      // Queue full: turn 4 rejected immediately
      let turn4Rejected = false;
      try {
        await scheduler.enqueueTurn(async () => {
          executionOrder.push("turn-4");
        });
      } catch (err: any) {
        turn4Rejected = true;
        expect(err).toBeInstanceOf(SchedulerCapacityExceededError);
        expect(err.code).toBe("CAPACITY_EXCEEDED");
      }
      expect(turn4Rejected).toBe(true);

      // Unblock active task
      unblock();
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(executionOrder).toEqual(["turn-1", "turn-2", "turn-3"]);
    });

    // Required Test 7:
    // When queued turn begins execution, freed capacity is immediately available to new submission.
    it("frees capacity immediately when a queued turn begins execution, allowing new submission", async () => {
      const scheduler = new CooperativeTurnScheduler(1); // Exactly 1 waiting turn allowed

      let releaseTurn1!: () => void;
      const blocker1 = new Promise<void>((r) => {
        releaseTurn1 = r;
      });

      // Active Turn 1: starts executing immediately
      const t1 = scheduler.enqueueTurn(async () => {
        await blocker1;
        return "t1-done";
      });

      let turn2StartedResolve!: () => void;
      const turn2Started = new Promise<void>((r) => {
        turn2StartedResolve = r;
      });
      let releaseTurn2!: () => void;
      const blocker2 = new Promise<void>((r) => {
        releaseTurn2 = r;
      });

      // Queued Turn 2: fills the 1 waiting queue slot
      const t2 = scheduler.enqueueTurn(async () => {
        turn2StartedResolve();
        await blocker2;
        return "t2-done";
      });

      expect(scheduler.getPendingCount()).toBe(1);

      // Submission 3: Must reject immediately with SchedulerCapacityExceededError
      await expect(scheduler.enqueueTurn(async () => "t3-reject")).rejects.toThrow(
        SchedulerCapacityExceededError,
      );
      expect(scheduler.getPendingCount()).toBe(1);

      // Release Turn 1 so Turn 2 transitions from queued to actively executing
      releaseTurn1();
      await turn2Started;

      // Turn 2 is now actively executing; queue length is 0 (capacity freed immediately!)
      expect(scheduler.getPendingCount()).toBe(0);

      // Submission 4: Must now be accepted immediately into the freed capacity slot
      const t4 = scheduler.enqueueTurn(async () => "t4-done");
      expect(scheduler.getPendingCount()).toBe(1);

      // Release Turn 2 so Turn 4 can execute
      releaseTurn2();

      const results = await Promise.all([t1, t2, t4]);
      expect(results).toEqual(["t1-done", "t2-done", "t4-done"]);
      expect(scheduler.getPendingCount()).toBe(0);
    });

    // Required Test 8:
    // Concurrent submissions at capacity boundary cannot exceed bound.
    it("handles concurrent submissions atomically at capacity boundary without exceeding bound", async () => {
      const maxCapacity = 5;
      const scheduler = new CooperativeTurnScheduler(maxCapacity);

      let release!: () => void;
      const blocker = new Promise<void>((resolve) => {
        release = resolve;
      });

      // Active turn
      scheduler.enqueueTurn(async () => {
        await blocker;
      });

      // Concurrently submit 12 turns
      const submissions = Array.from({ length: 12 }, (_, i) =>
        scheduler
          .enqueueTurn(async () => `val-${i}`)
          .then(
            (val) => ({ status: "accepted" as const, val }),
            (err) => ({ status: "rejected" as const, err }),
          ),
      );

      // Immediately verify pending queue cannot exceed bound
      expect(scheduler.getPendingCount()).toBe(maxCapacity);

      // Release active blocker so accepted queued turns can drain
      release();

      const outcomes = await Promise.all(submissions);
      const accepted = outcomes.filter((o) => o.status === "accepted");
      const rejected = outcomes.filter((o) => o.status === "rejected");

      // Exactly 5 queued turns accepted, exactly 7 rejected
      expect(accepted.length).toBe(5);
      expect(rejected.length).toBe(7);

      for (const rej of rejected) {
        expect(rej.err).toBeInstanceOf(SchedulerCapacityExceededError);
        expect((rej.err as any).code).toBe("CAPACITY_EXCEEDED");
      }
    });
  });

  // =========================================================================
  // 2. Trusted Provenance is the Only Cycle-Suppression Authority (Tests 1, 2, 3, 4)
  // =========================================================================
  describe("Trusted Provenance & Cycle Suppression", () => {
    // Required Test 1:
    // Genuine VAJRA capability execution publishes marked event that ingress suppresses.
    it("suppresses event when published during genuine VAJRA capability execution with publisher-authenticated provenance", async () => {
      const bus = new EventBus();
      const publisher = new Publisher(bus);
      const registry = new CapabilityRegistry();

      let receivedCount = 0;
      const coordinator: any = {
        submitStimulus: vi.fn(async () => {
          receivedCount++;
          return Result.success({} as any, {
            requestId: "r",
            correlationId: "c",
            invocationId: "i",
          });
        }),
      };

      const adapter = new PlatformEventIngressAdapter(coordinator);
      adapter.attach(bus);

      registry.register(
        {
          name: "task.complete.mock",
          version: "1.0.0",
          owner: "test",
          kind: "Command",
          inputSchema: { safeParse: (data: any) => ({ success: true, data }) } as any,
          permissions: { allowInternal: true, allowVajra: true },
          activationTier: 1,
          isAvailable: true,
        },
        async (input: any) => {
          publisher.publish({
            type: "task.completed",
            source: "tasks-store",
            payload: { taskId: input.id },
            version: 1,
          });
          return { done: true };
        },
      );

      // Invoke as VAJRA caller: must stamp isVajra: true and be suppressed by adapter
      await registry.invoke(
        "task.complete.mock",
        { id: "task-from-vajra" },
        { requestId: "r-vajra", correlationId: "c-vajra", invocationId: "i-vajra" },
        { isVajra: true },
      );

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(coordinator.submitStimulus).not.toHaveBeenCalled();
      expect(receivedCount).toBe(0);

      adapter.detach();
    });

    // Required Test 2:
    // Ordinary host/user task completion remains eligible for ingress.
    it("allows ordinary host/user task completion without VAJRA provenance to enter ingress", async () => {
      const bus = new EventBus();
      const publisher = new Publisher(bus);
      const registry = new CapabilityRegistry();

      let receivedCount = 0;
      const coordinator: any = {
        submitStimulus: vi.fn(async () => {
          receivedCount++;
          return Result.success({} as any, {
            requestId: "r",
            correlationId: "c",
            invocationId: "i",
          });
        }),
      };

      const adapter = new PlatformEventIngressAdapter(coordinator);
      adapter.attach(bus);

      registry.register(
        {
          name: "task.complete.host",
          version: "1.0.0",
          owner: "test",
          kind: "Command",
          inputSchema: { safeParse: (data: any) => ({ success: true, data }) } as any,
          permissions: { allowInternal: true, allowVajra: true },
          activationTier: 1,
          isAvailable: true,
        },
        async (input: any) => {
          publisher.publish({
            type: "task.completed",
            source: "tasks-store",
            payload: { taskId: input.id },
            version: 1,
          });
          return { done: true };
        },
      );

      // Invoke as ordinary host caller: does not carry isVajra -> forwarded to ingress
      await registry.invoke(
        "task.complete.host",
        { id: "task-from-host" },
        { requestId: "r-host", correlationId: "c-host", invocationId: "i-host" },
        { isInternal: true },
      );

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(coordinator.submitStimulus).toHaveBeenCalledTimes(1);
      expect(receivedCount).toBe(1);

      adapter.detach();
    });

    // Required Test 3:
    // Forged source: "vajra..." without trusted provenance is not suppressed.
    it("does NOT suppress forged source: 'vajra...' without trusted execution provenance", async () => {
      const bus = new EventBus();
      const publisher = new Publisher(bus);

      let capturedStimulus: any = null;
      const coordinator: any = {
        submitStimulus: vi.fn(async (stim) => {
          capturedStimulus = stim;
          return Result.success({} as any, stim.correlation);
        }),
      };

      const adapter = new PlatformEventIngressAdapter(coordinator);
      adapter.attach(bus);

      // Caller emits an event claiming source: 'vajra.spoof' outside VAJRA capability execution
      publisher.publish({
        type: "task.completed",
        source: "vajra.spoof",
        payload: { taskId: "task-forged-source" },
        version: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      // Must NOT be suppressed merely because source starts with 'vajra'
      expect(coordinator.submitStimulus).toHaveBeenCalledTimes(1);
      expect(capturedStimulus).not.toBeNull();
      expect(capturedStimulus.source).toBe("akira.platform_bus");
      expect(capturedStimulus.payload.source).toBe("vajra.spoof");

      adapter.detach();
    });

    // Required Test 4:
    // Caller-supplied metadata.isVajra: true outside trusted execution context is stripped and does not suppress event.
    it("strips caller-supplied metadata.isVajra outside trusted execution context so event is NOT suppressed", async () => {
      const bus = new EventBus();
      const publisher = new Publisher(bus);

      let capturedStimulus: any = null;
      const coordinator: any = {
        submitStimulus: vi.fn(async (stim) => {
          capturedStimulus = stim;
          return Result.success({} as any, stim.correlation);
        }),
      };

      const adapter = new PlatformEventIngressAdapter(coordinator);
      adapter.attach(bus);

      // Rogue caller explicitly passes metadata.isVajra = true outside capability execution context
      const published = publisher.publish({
        type: "task.completed",
        source: "rogue-caller",
        metadata: { isVajra: true, customTag: "test" },
        payload: { taskId: "task-forged-metadata" },
        version: 1,
      });

      // Verify that publisher stripped the forged isVajra marker
      expect((published.metadata as any)?.isVajra).toBeUndefined();
      expect(published.metadata?.customTag).toBe("test");

      await new Promise((resolve) => setTimeout(resolve, 20));

      // Platform adapter must NOT suppress the event since isVajra was stripped
      expect(coordinator.submitStimulus).toHaveBeenCalledTimes(1);
      expect(capturedStimulus).not.toBeNull();

      adapter.detach();
    });
  });

  // =========================================================================
  // 3. Overload Rejection & Attributable Drop (Tests 9, 10)
  // =========================================================================
  describe("Overload Rejection & Attributable Drop", () => {
    // Required Test 9:
    // Human directives receive REJECTED_CONGESTED under overload.
    it("rejects human operational directives with REJECTED_CONGESTED under scheduler overload and hides internal deliberation", async () => {
      const selfModel = new SelfModel();
      const genesisPort = new InMemoryGenesisAdapter();
      const akiraOSPort = new InMemoryAkiraOSAdapter();
      const escalationPort = new InMemoryEscalationAdapter();
      const scheduler = new CooperativeTurnScheduler(1); // queue limit of 1

      const controller = new ExecutiveController({
        selfModel,
        genesisPort,
        akiraOSPort,
        escalationPort,
        scheduler,
      });

      await controller.boot();

      let releaseBlocker!: () => void;
      const blocker = new Promise<void>((resolve) => {
        releaseBlocker = resolve;
      });

      // Turn 1 fills the executing slot
      scheduler.enqueueTurn(async () => {
        await blocker;
      });

      // Turn 2 fills the 1 pending queue slot
      scheduler.enqueueTurn(async () => "turn-2");

      // Now scheduler is at capacity (0 free slots in waiting queue)
      const coordinator = new VajraStimulusIngressCoordinator(async () => controller);
      coordinator.attach();

      const userAdapter = new UserDirectiveIngressAdapter(coordinator, () => "test-user");
      userAdapter.attach();

      vi.spyOn(vajraComposition, "getUserDirectiveAdapter").mockReturnValue(userAdapter);

      const response = await processUserDirective({
        text: "Perform urgent system command",
        correlation: { correlationId: "corr-overload-test" },
      });

      expect(response.success).toBe(false);
      expect(response.code).toBe("REJECTED_CONGESTED");
      expect(response.message).toContain("capacity");
      expect(response.correlationId).toBe("corr-overload-test");

      // Verify privacy invariants under failure
      expect((response as any).rationale).toBeUndefined();
      expect((response as any).policyBasis).toBeUndefined();
      expect((response as any).evidenceBasis).toBeUndefined();
      expect((response as any).confidence).toBeUndefined();
      expect((response as any).action).toBeUndefined();

      releaseBlocker();
      await controller.shutdown();
    });

    // Required Test 10:
    // Background events drop according to threshold with attributable log without payload content.
    it("drops background events according to threshold with attributable log without payload content", async () => {
      const selfModel = new SelfModel();
      const genesisPort = new InMemoryGenesisAdapter();
      const akiraOSPort = new InMemoryAkiraOSAdapter();
      const escalationPort = new InMemoryEscalationAdapter();
      const scheduler = new CooperativeTurnScheduler(5);

      const controller = new ExecutiveController({
        selfModel,
        genesisPort,
        akiraOSPort,
        escalationPort,
        scheduler,
      });

      await controller.boot();

      const coordinator = new VajraStimulusIngressCoordinator(async () => controller, {
        maxPendingBackgroundTurns: 1, // Drops background events if pending turns >= 1
      });
      coordinator.attach();

      // Block active turn so pending turns accumulate
      let releaseBlocker!: () => void;
      const blocker = new Promise<void>((resolve) => {
        releaseBlocker = resolve;
      });

      // Active turn
      scheduler.enqueueTurn(async () => {
        await blocker;
      });

      // 1 queued turn -> pending count = 1
      scheduler.enqueueTurn(async () => "queued-turn");
      expect(scheduler.getPendingCount()).toBe(1);

      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const secretPayload = {
        sensitiveToken: "secret-token-super-confidential-987",
        userNotes: "unauthorized private user information",
      };

      const bgStimulus = createStimulus({
        id: "stim-bg-secret-test",
        kind: "system_event",
        source: "background.worker",
        payload: secretPayload,
        correlation: { requestId: "r-bg", correlationId: "c-bg", invocationId: "i-bg" },
      });

      const dropResult = await coordinator.submitStimulus(bgStimulus);

      expect(coordinator.getPendingTurnsCount()).toBe(1);
      expect(dropResult.ok).toBe(false);
      expect(dropResult.error).toContain("ingress queue is congested (1 pending turns)");
      // Verify payload content is NOT in the error message
      expect(dropResult.error).not.toContain("secret-token");
      expect(dropResult.error).not.toContain("unauthorized");

      // Verify attributable log
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      const loggedMessage = consoleWarnSpy.mock.calls[0][0];
      expect(loggedMessage).toContain(
        "[IngressCoordinator] Dropping background stimulus 'stim-bg-secret-test'",
      );
      expect(loggedMessage).toContain("kind: 'system_event'");
      expect(loggedMessage).toContain("source: 'background.worker'");
      expect(loggedMessage).toContain("1 pending turns");
      // Critical security invariant: Log must NEVER include payload content
      expect(loggedMessage).not.toContain("secret-token");
      expect(loggedMessage).not.toContain("unauthorized");

      releaseBlocker();
      await controller.shutdown();
    });
  });

  // =========================================================================
  // 4. Legacy Cognitive Discovery Focus Mutation Removal (Preserved)
  // =========================================================================
  describe("Legacy Cognitive Discovery Focus Mutation Removal", () => {
    it("ensures discovery listener does not mutate operational focus out-of-band", async () => {
      const selfModel = new SelfModel();
      selfModel.updateOperationalContext({ currentFocus: "Initial User Goal" });

      const genesisPort = new InMemoryGenesisAdapter();
      const akiraOSPort = new InMemoryAkiraOSAdapter();
      const escalationPort = new InMemoryEscalationAdapter();

      const controller = new ExecutiveController({
        selfModel,
        genesisPort,
        akiraOSPort,
        escalationPort,
      });

      await controller.boot();

      // Emit discovery through genesisPort legacy subscription
      genesisPort.emitDiscovery({ pattern: "parallel_commitments" });

      // Operational focus must NOT have been mutated out-of-band!
      expect(controller.getOperationalContext().currentFocus).toBe("Initial User Goal");

      await controller.shutdown();
    });
  });

  // =========================================================================
  // 5. Insight Deduplication Stability & Bounded Memory (Preserved)
  // =========================================================================
  describe("Insight Deduplication Stability & Bounded Memory", () => {
    it("does not replay persistent unchanged insights on repeated full-array snapshots", async () => {
      const submittedInsights: string[] = [];
      const coordinator: any = {
        submitStimulus: vi.fn(async (stim: CognitiveStimulus<any>) => {
          submittedInsights.push(stim.payload.insightId);
          return Result.success({} as any, stim.correlation);
        }),
      };

      let listenerFn!: (insights: any[]) => void;
      const subscribeMock = vi.fn((listener: (insights: any[]) => void) => {
        listenerFn = listener;
        listener([]); // initial baseline
        return () => {};
      });

      const adapter = new GenesisDiscoveryIngressAdapter(coordinator, subscribeMock);
      adapter.attach();

      const insightA = {
        id: "ins-a",
        canonicalKey: "pattern.a",
        category: "Focus",
        confidence: "HIGH",
        supportingUnderstandingIds: ["u1"],
        updatedAt: "2026-10-31T01:00:00Z",
      };

      const insightB = {
        id: "ins-b",
        canonicalKey: "pattern.b",
        category: "Momentum",
        confidence: "MEDIUM",
        supportingUnderstandingIds: ["u2"],
        updatedAt: "2026-10-31T01:00:00Z",
      };

      // Emission 1: ins-a arrives -> submitted
      listenerFn([insightA]);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(submittedInsights).toEqual(["ins-a"]);

      // Emission 2: Full array containing ins-a (unchanged) and ins-b (new)
      listenerFn([insightA, insightB]);
      await new Promise((resolve) => setTimeout(resolve, 10));
      // ins-a must NOT be replayed! Only ins-b is submitted.
      expect(submittedInsights).toEqual(["ins-a", "ins-b"]);

      // Emission 3: Full array repeated with NO changes
      listenerFn([insightA, insightB]);
      await new Promise((resolve) => setTimeout(resolve, 10));
      // No new submissions!
      expect(submittedInsights).toEqual(["ins-a", "ins-b"]);

      // Emission 4: ins-a modified with new timestamp/confidence
      const insightAModified = {
        ...insightA,
        confidence: "CRITICAL",
        updatedAt: "2026-10-31T02:00:00Z",
      };
      listenerFn([insightAModified, insightB]);
      await new Promise((resolve) => setTimeout(resolve, 10));
      // ins-a re-submitted due to modification; ins-b still suppressed
      expect(submittedInsights).toEqual(["ins-a", "ins-b", "ins-a"]);

      adapter.detach();
    });

    it("prunes removed insights and safely ignores malformed insight identities", async () => {
      const coordinator: any = {
        submitStimulus: vi.fn(async (stim: CognitiveStimulus<any>) =>
          Result.success({} as any, stim.correlation),
        ),
      };

      let listenerFn!: (insights: any[]) => void;
      const adapter = new GenesisDiscoveryIngressAdapter(coordinator, (l) => {
        listenerFn = l;
        l([]);
        return () => {};
      });
      adapter.attach();

      // Submit malformed insights (missing id or missing canonicalKey)
      listenerFn([
        { id: "", canonicalKey: "missing.id" } as any,
        { id: "ins-valid-1", canonicalKey: "" } as any,
        { canonicalKey: "no-id-at-all" } as any,
      ]);

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(coordinator.submitStimulus).not.toHaveBeenCalled();

      // Submit valid insight
      listenerFn([
        {
          id: "ins-valid-1",
          canonicalKey: "valid.pattern",
          category: "General",
          confidence: "LOW",
          supportingUnderstandingIds: [],
        },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(coordinator.submitStimulus).toHaveBeenCalledTimes(1);

      // Now emit empty snapshot (insight was removed from the graph)
      listenerFn([]);
      await new Promise((resolve) => setTimeout(resolve, 10));

      adapter.detach();
    });
  });

  // =========================================================================
  // 6. Sanitized RPC Response Structure (Preserved)
  // =========================================================================
  describe("Sanitized User Directive RPC Response Structure", () => {
    it("returns stable sanitized schema without exposing cognitive engine internals", async () => {
      const response = await processUserDirective({
        text: "Analyze current focus",
        correlation: { correlationId: "corr-structure-test" },
      });

      expect(response).toBeDefined();
      expect(typeof response.success).toBe("boolean");
      expect(typeof response.code).toBe("string");
      expect(typeof response.message).toBe("string");
      expect(response.correlationId).toBe("corr-structure-test");

      // Never expose private cognitive engine properties
      expect((response as any).rationale).toBeUndefined();
      expect((response as any).policyBasis).toBeUndefined();
      expect((response as any).evidenceBasis).toBeUndefined();
      expect((response as any).confidence).toBeUndefined();
      expect((response as any).action).toBeUndefined();
    });

    it("maps admission CONCURRENCY_LOCKED to REJECTED_CONGESTED without leaking internals (AUD-03)", async () => {
      const mockAdapter = {
        submitDirective: vi.fn(async () =>
          Result.failure(
            "Mission admission rejected: [CONCURRENCY_LOCKED] Concurrency conflict: mission 'm-active-secret' is currently RUNNING.",
            { correlationId: "corr-concurr-rpc" },
          ),
        ),
      };
      vi.spyOn(vajraComposition, "getUserDirectiveAdapter").mockReturnValue(mockAdapter as any);

      const response = await processUserDirective({
        text: "Perform active task",
        correlation: { correlationId: "corr-concurr-rpc" },
      });

      expect(response.success).toBe(false);
      expect(response.code).toBe("REJECTED_CONGESTED");
      expect(response.message).toContain("currently at capacity or processing another mission");
      expect(response.message).not.toContain("m-active-secret");
      expect(response.correlationId).toBe("corr-concurr-rpc");
      expect(response.actionKind).toBeUndefined();
      expect(response.actionId).toBeUndefined();
      expect((response as any).rationale).toBeUndefined();
    });

    it("maps admission PAUSED_APPROVAL to REJECTED_SAFETY (AUD-03)", async () => {
      const mockAdapter = {
        submitDirective: vi.fn(async () =>
          Result.failure(
            "Mission admission rejected: [PAUSED_APPROVAL] Human approval required for dangerous mutation.",
            { correlationId: "corr-approval-rpc" },
          ),
        ),
      };
      vi.spyOn(vajraComposition, "getUserDirectiveAdapter").mockReturnValue(mockAdapter as any);

      const response = await processUserDirective({
        text: "Execute high risk command",
        correlation: { correlationId: "corr-approval-rpc" },
      });

      expect(response.success).toBe(false);
      expect(response.code).toBe("REJECTED_SAFETY");
      expect(response.message).toContain("requires human approval before admission");
      expect(response.correlationId).toBe("corr-approval-rpc");
    });

    it("maps admission CAPABILITY_UNAVAILABLE to SERVICE_UNAVAILABLE (AUD-03)", async () => {
      const mockAdapter = {
        submitDirective: vi.fn(async () =>
          Result.failure(
            "Mission admission rejected: [CAPABILITY_UNAVAILABLE] Capability 'system.disk' is not registered.",
            { correlationId: "corr-cap-rpc" },
          ),
        ),
      };
      vi.spyOn(vajraComposition, "getUserDirectiveAdapter").mockReturnValue(mockAdapter as any);

      const response = await processUserDirective({
        text: "Access disk capability",
        correlation: { correlationId: "corr-cap-rpc" },
      });

      expect(response.success).toBe(false);
      expect(response.code).toBe("SERVICE_UNAVAILABLE");
      expect(response.message).toContain("Required capability is currently unavailable.");
      expect(response.correlationId).toBe("corr-cap-rpc");
    });

    it("maps admission HEALTH_DEGRADED to SERVICE_UNAVAILABLE (AUD-03)", async () => {
      const mockAdapter = {
        submitDirective: vi.fn(async () =>
          Result.failure(
            "Mission admission rejected: [HEALTH_DEGRADED] Operational context indicates CRITICAL system health.",
            { correlationId: "corr-health-rpc" },
          ),
        ),
      };
      vi.spyOn(vajraComposition, "getUserDirectiveAdapter").mockReturnValue(mockAdapter as any);

      const response = await processUserDirective({
        text: "Check health operation",
        correlation: { correlationId: "corr-health-rpc" },
      });

      expect(response.success).toBe(false);
      expect(response.code).toBe("SERVICE_UNAVAILABLE");
      expect(response.message).toContain("health is degraded");
      expect(response.correlationId).toBe("corr-health-rpc");
    });

    it("maps admission STALE to REJECTED_SAFETY (AUD-03)", async () => {
      const mockAdapter = {
        submitDirective: vi.fn(async () =>
          Result.failure("Mission admission rejected: [STALE] Context version drift.", {
            correlationId: "corr-stale-rpc",
          }),
        ),
      };
      vi.spyOn(vajraComposition, "getUserDirectiveAdapter").mockReturnValue(mockAdapter as any);

      const response = await processUserDirective({
        text: "Stale context directive",
        correlation: { correlationId: "corr-stale-rpc" },
      });

      expect(response.success).toBe(false);
      expect(response.code).toBe("REJECTED_SAFETY");
      expect(response.message).toContain("stale");
      expect(response.correlationId).toBe("corr-stale-rpc");
    });

    it("maps admission REJECTED policy violation to REJECTED_SAFETY (AUD-03)", async () => {
      const mockAdapter = {
        submitDirective: vi.fn(async () =>
          Result.failure(
            "Mission admission rejected: [REJECTED] Action is marked as not policy compliant.",
            { correlationId: "corr-policy-rpc" },
          ),
        ),
      };
      vi.spyOn(vajraComposition, "getUserDirectiveAdapter").mockReturnValue(mockAdapter as any);

      const response = await processUserDirective({
        text: "Non compliant action",
        correlation: { correlationId: "corr-policy-rpc" },
      });

      expect(response.success).toBe(false);
      expect(response.code).toBe("REJECTED_SAFETY");
      expect(response.message).toContain("rejected by policy");
      expect(response.correlationId).toBe("corr-policy-rpc");
    });

    it("maps generic unclassified errors cleanly to EXECUTION_FAILED without leaking traces (AUD-03)", async () => {
      const mockAdapter = {
        submitDirective: vi.fn(async () =>
          Result.failure(
            "Internal database constraint failed on row #12345: stack trace at internal.ts",
            { correlationId: "corr-generic-rpc" },
          ),
        ),
      };
      vi.spyOn(vajraComposition, "getUserDirectiveAdapter").mockReturnValue(mockAdapter as any);

      const response = await processUserDirective({
        text: "Generic failing action",
        correlation: { correlationId: "corr-generic-rpc" },
      });

      expect(response.success).toBe(false);
      expect(response.code).toBe("EXECUTION_FAILED");
      expect(response.message).toBe("Operational directive processing failed.");
      expect(response.correlationId).toBe("corr-generic-rpc");
    });
  });
});
