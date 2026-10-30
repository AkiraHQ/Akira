/**
 * GENESIS Reality Adapter — P2 (dormant) verification.
 *
 * The adapter exists to carry real AKIRA OS events into GENESIS, but P2 stops
 * short of switching it on. Everything below therefore attaches it explicitly
 * and detaches it again, and one test asserts that merely importing it changes
 * nothing.
 *
 * The integration proof at the end deliberately does NOT hand GENESIS a
 * hand-built MemoryEvent. It calls the real store API, lets the existing
 * producer publish onto the real `globalEventBus`, and checks what comes out
 * the far end of the cognitive pipeline.
 */
process.env.AKIRA_DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const { GenesisRealityAdapter, genesisRealityAdapter, REALITY_ADAPTER_ID } =
  await import("../src/genesis/events/reality-adapter");
const { SUPPORTED_PLATFORM_EVENT_TYPES, translatePlatformEvent } =
  await import("../src/genesis/events/event-translation");
const { EventBus, globalEventBus } = await import("../src/instrumentation/event-bus");
const { eventService } = await import("../src/genesis/events/event-service");
const { Events } = await import("../src/contracts/events");
const { publish } = await import("../src/instrumentation");

// Composes the cognitive processors, exactly as the application does.
const genesis = await import("../src/genesis/index");
const { akira } = await import("../src/persistence/akira-store");

import type { AkiraEvent } from "../src/instrumentation/event-types";
import type { MemoryEvent } from "../src/shared/types/event-types";

let seq = 0;
function makeEvent(type: string, payload: unknown, id?: string): AkiraEvent {
  seq += 1;
  return {
    id: id ?? `evt-${seq}`,
    type,
    timestamp: new Date().toISOString(),
    source: "test-producer",
    payload,
    version: 1,
  };
}

/** Captures everything GENESIS records, through the public API. */
function captureRecorded(): { events: MemoryEvent[]; stop: () => void } {
  const events: MemoryEvent[] = [];
  const stop = eventService.onRecord((e) => {
    events.push(e);
  });
  return { events, stop };
}

describe("reality adapter — translation", () => {
  let adapter: InstanceType<typeof GenesisRealityAdapter>;
  let bus: InstanceType<typeof EventBus>;
  let recorded: ReturnType<typeof captureRecorded>;

  beforeEach(() => {
    adapter = new GenesisRealityAdapter();
    bus = new EventBus();
    adapter.attach(bus);
    recorded = captureRecorded();
  });

  afterEach(() => {
    recorded.stop();
    adapter.detach();
  });

  it("translates a completed task, preserving the project relationship", () => {
    bus.publish(
      makeEvent(Events.TASK_COMPLETED, {
        id: "task-1",
        title: "Ship the adapter",
        projectId: "proj-1",
      }),
    );

    expect(recorded.events).toHaveLength(1);
    const memory = recorded.events[0];
    expect(memory.eventType).toBe("task_completed");
    expect(memory.title).toBe("Task Completed");
    expect(memory.description).toBe('Completed task: "Ship the adapter"');
    expect(memory.relatedProjectId).toBe("proj-1");
    expect(memory.relatedNoteId).toBeNull();
  });

  it("carries the payload and platform provenance through as metadata", () => {
    const event = makeEvent(Events.TASK_COMPLETED, {
      id: "task-2",
      title: "Metadata check",
      projectId: "proj-2",
    });
    bus.publish(event);

    const metadata = recorded.events[0].metadata as Record<string, unknown>;
    // Payload spread at top level: the shape existing candidate rules read.
    expect(metadata.title).toBe("Metadata check");
    expect(metadata.projectId).toBe("proj-2");

    // Provenance namespaced so it cannot collide with a payload key.
    expect(metadata.platformEvent).toEqual({
      id: event.id,
      type: Events.TASK_COMPLETED,
      source: "test-producer",
      timestamp: event.timestamp,
      correlationId: null,
    });
  });

  it("translates each supported project and note event", () => {
    bus.publish(makeEvent(Events.PROJECT_CREATED, { id: "p1", name: "Recovery" }));
    bus.publish(makeEvent(Events.PROJECT_UPDATED, { id: "p1", name: "Recovery" }));
    bus.publish(makeEvent(Events.PROJECT_CONTINUED, { id: "p1", name: "Recovery" }));
    bus.publish(makeEvent(Events.NOTE_CREATED, { id: "n1", title: "Idea", projectId: "p1" }));
    bus.publish(makeEvent(Events.NOTE_EDITED, { id: "n1", title: "Idea", projectId: "p1" }));
    bus.publish(makeEvent(Events.MISSION_COMPLETED, { totalTasks: 3 }));

    expect(recorded.events.map((e) => e.eventType)).toEqual([
      "project_created",
      "project_updated",
      "project_continued",
      "note_created",
      "note_edited",
      "mission_completed",
    ]);

    const note = recorded.events[3];
    expect(note.relatedNoteId).toBe("n1");
    expect(note.relatedProjectId).toBe("p1");
    expect(note.description).toBe('Captured thought: "Idea"');

    expect(recorded.events[5].description).toBe("Finished all 3 tasks for today!");
  });

  it("translates an authoritative VAJRA operational mission completed event with real fields", () => {
    bus.publish(
      makeEvent(Events.MISSION_COMPLETED, {
        missionId: "mission-test-42",
        status: "completed",
        verificationRecordId: "vr-test-42",
        outcome: {
          objective: "Deploy verification bridge",
          stepsCount: 2,
          completedAt: new Date().toISOString(),
        },
      }),
    );

    expect(recorded.events).toHaveLength(1);
    const memory = recorded.events[0];
    expect(memory.eventType).toBe("mission_completed");
    expect(memory.title).toBe("Mission Completed: Deploy verification bridge");
    expect(memory.description).toBe(
      'Completed operational mission: "Deploy verification bridge". Status: completed.',
    );
    expect(memory.description).not.toContain("undefined");
    expect(memory.description).not.toContain("Daily Tasks");
  });

  it("falls back to the untitled note wording when a note has no title", () => {
    bus.publish(makeEvent(Events.NOTE_CREATED, { id: "n2", projectId: null }));
    expect(recorded.events[0].description).toBe("Captured raw thought");
  });

  it("ignores platform events GENESIS has no interpretation for", () => {
    bus.publish(makeEvent(Events.TASK_CREATED, { id: "t", title: "x" }));
    bus.publish(makeEvent(Events.SESSION_STARTED, { id: "s" }));
    bus.publish(makeEvent(Events.VAULT_FILE_UPLOADED, { id: "f" }));
    bus.publish(makeEvent(Events.SETTINGS_UPDATED, {}));

    expect(recorded.events).toHaveLength(0);

    const metrics = adapter.getMetrics();
    expect(metrics.received).toBe(4);
    expect(metrics.translated).toBe(0);
    expect(metrics.ignored).toBe(4);

    // Ignoring must be observable, not silent — this is what tells a later
    // phase which types still need a candidate rule.
    expect(metrics.ignoredTypes).toEqual({
      [Events.TASK_CREATED]: 1,
      [Events.SESSION_STARTED]: 1,
      [Events.VAULT_FILE_UPLOADED]: 1,
      [Events.SETTINGS_UPDATED]: 1,
    });
  });

  it("exposes an allowlist that matches what it can actually translate", () => {
    expect([...SUPPORTED_PLATFORM_EVENT_TYPES].sort()).toEqual(
      [
        Events.PROJECT_CREATED,
        Events.PROJECT_UPDATED,
        Events.PROJECT_CONTINUED,
        Events.TASK_COMPLETED,
        Events.MISSION_COMPLETED,
        Events.NOTE_CREATED,
        Events.NOTE_EDITED,
        // Deletion reaches GENESIS as a fact of its own. Without a translator
        // these were dropped here and the understanding of a deleted project
        // went on calling it current work.
        Events.PROJECT_DELETED,
        Events.NOTE_DELETED,
      ].sort(),
    );

    // The table is the allowlist: every advertised type must translate.
    for (const type of SUPPORTED_PLATFORM_EVENT_TYPES) {
      expect(GenesisRealityAdapter.supportedTypes).toContain(type);
    }
  });
});

describe("reality adapter — idempotency", () => {
  let adapter: InstanceType<typeof GenesisRealityAdapter>;
  let bus: InstanceType<typeof EventBus>;
  let recorded: ReturnType<typeof captureRecorded>;

  beforeEach(() => {
    adapter = new GenesisRealityAdapter();
    bus = new EventBus();
    adapter.attach(bus);
    recorded = captureRecorded();
  });

  afterEach(() => {
    recorded.stop();
    adapter.detach();
  });

  it("processes a repeated AkiraEvent.id exactly once", () => {
    const event = makeEvent(Events.TASK_COMPLETED, {
      id: "task-dup",
      title: "Only once",
      projectId: "proj-dup",
    });

    bus.publish(event);
    bus.publish(event);
    bus.publish(event);

    expect(recorded.events).toHaveLength(1);
    const metrics = adapter.getMetrics();
    expect(metrics.received).toBe(3);
    expect(metrics.translated).toBe(1);
    expect(metrics.duplicatesSuppressed).toBe(2);
  });

  it("treats distinct ids carrying identical content as distinct events", () => {
    const payload = { id: "task-x", title: "Twice legitimately", projectId: "proj-x" };
    bus.publish(makeEvent(Events.TASK_COMPLETED, payload, "id-a"));
    bus.publish(makeEvent(Events.TASK_COMPLETED, payload, "id-b"));

    expect(recorded.events).toHaveLength(2);
    expect(adapter.getMetrics().duplicatesSuppressed).toBe(0);
  });

  it("bounds duplicate-suppression memory and forgets the oldest id first", () => {
    const small = new GenesisRealityAdapter(2);
    const localBus = new EventBus();
    small.attach(localBus);

    localBus.publish(makeEvent(Events.MISSION_COMPLETED, { totalTasks: 1 }, "old"));
    localBus.publish(makeEvent(Events.MISSION_COMPLETED, { totalTasks: 2 }, "mid"));
    localBus.publish(makeEvent(Events.MISSION_COMPLETED, { totalTasks: 3 }, "new"));

    // "old" was evicted, so it is processed again rather than suppressed.
    localBus.publish(makeEvent(Events.MISSION_COMPLETED, { totalTasks: 1 }, "old"));
    // "new" is still remembered.
    localBus.publish(makeEvent(Events.MISSION_COMPLETED, { totalTasks: 3 }, "new"));

    const metrics = small.getMetrics();
    expect(metrics.translated).toBe(4);
    expect(metrics.duplicatesSuppressed).toBe(1);
    small.detach();
  });
});

describe("reality adapter — failure isolation", () => {
  it("never throws out of onEvent, even bypassing the bus", () => {
    // Delivered directly rather than through the bus on purpose. EventBus wraps
    // every subscriber in its own try/catch, so publishing through it would
    // prove the bus is safe, not the adapter. The adapter's own contract is
    // that onEvent absorbs its faults, and only a direct call tests that.
    const adapter = new GenesisRealityAdapter();
    const malformed = makeEvent(Events.PROJECT_CREATED, null, "direct-bad");

    expect(() => adapter.onEvent(malformed)).not.toThrow();
    expect(adapter.getMetrics().failed).toBe(1);
    expect(adapter.getMetrics().lastError?.eventId).toBe("direct-bad");
  });

  it("absorbs its own translation failure without disturbing peer subscribers", () => {
    const bus = new EventBus();
    const adapter = new GenesisRealityAdapter();

    const peerSaw: string[] = [];
    bus.subscribe({ id: "peer-persistence", onEvent: (e) => void peerSaw.push(e.id) });
    adapter.attach(bus);
    const peerAfter: string[] = [];
    bus.subscribe({ id: "peer-timeline", onEvent: (e) => void peerAfter.push(e.id) });

    // A supported type whose payload is malformed: the project translator
    // dereferences payload.name, so a null payload throws inside the adapter.
    const bad = makeEvent(Events.PROJECT_CREATED, null, "bad-1");
    expect(() => bus.publish(bad)).not.toThrow();

    // Both peers — registered before and after the adapter — still received it.
    expect(peerSaw).toEqual(["bad-1"]);
    expect(peerAfter).toEqual(["bad-1"]);

    const metrics = adapter.getMetrics();
    expect(metrics.failed).toBe(1);
    expect(metrics.translated).toBe(0);
    expect(metrics.lastError?.eventId).toBe("bad-1");
    expect(metrics.lastError?.eventType).toBe(Events.PROJECT_CREATED);

    adapter.detach();
  });

  it("keeps working after a failure", () => {
    const bus = new EventBus();
    const adapter = new GenesisRealityAdapter();
    adapter.attach(bus);
    const recorded = captureRecorded();

    bus.publish(makeEvent(Events.PROJECT_CREATED, null, "bad-2"));
    bus.publish(
      makeEvent(Events.TASK_COMPLETED, { id: "t", title: "After failure", projectId: "p" }, "ok-1"),
    );

    expect(adapter.getMetrics().failed).toBe(1);
    expect(recorded.events.map((e) => e.eventType)).toEqual(["task_completed"]);

    recorded.stop();
    adapter.detach();
  });

  it("is unaffected by a peer subscriber that throws", () => {
    const bus = new EventBus();
    const adapter = new GenesisRealityAdapter();

    bus.subscribe({
      id: "hostile-peer",
      onEvent: () => {
        throw new Error("peer exploded");
      },
    });
    adapter.attach(bus);
    const recorded = captureRecorded();

    expect(() =>
      bus.publish(
        makeEvent(Events.TASK_COMPLETED, { id: "t", title: "Resilient", projectId: "p" }, "ok-2"),
      ),
    ).not.toThrow();

    expect(recorded.events).toHaveLength(1);
    expect(adapter.getMetrics().translated).toBe(1);

    recorded.stop();
    adapter.detach();
  });
});

describe("reality adapter — loop prevention", () => {
  it("publishes nothing back onto the platform bus while processing", () => {
    const bus = new EventBus();
    const adapter = new GenesisRealityAdapter();

    const busTraffic: string[] = [];
    bus.subscribe({ id: "traffic-monitor", onEvent: (e) => void busTraffic.push(e.type) });
    adapter.attach(bus);

    // Watch the real singleton too: an accidental import-and-publish inside the
    // cognitive cascade would surface here even though we drove a local bus.
    const globalTraffic: string[] = [];
    const globalMonitor = {
      id: "global-traffic-monitor",
      onEvent: (e: AkiraEvent) => void globalTraffic.push(e.type),
    };
    globalEventBus.subscribe(globalMonitor);

    bus.publish(
      makeEvent(Events.TASK_COMPLETED, { id: "t-loop", title: "Loop check", projectId: "p-loop" }),
    );

    // Exactly the one event we published: the full cascade
    // (candidate -> memory -> story -> importance -> understanding) added none.
    expect(busTraffic).toEqual([Events.TASK_COMPLETED]);
    expect(globalTraffic).toEqual([]);

    globalEventBus.unsubscribe(globalMonitor);
    adapter.detach();
  });
});

describe("reality adapter — attachment lifecycle", () => {
  it("has a stable identity", () => {
    expect(new GenesisRealityAdapter().id).toBe(REALITY_ADAPTER_ID);
    expect(REALITY_ADAPTER_ID).toBe("genesis-reality-adapter");
  });

  it("attaches, detaches, and reports its state", () => {
    const bus = new EventBus();
    const adapter = new GenesisRealityAdapter();

    expect(adapter.isAttached()).toBe(false);
    expect(bus.hasSubscriber(adapter)).toBe(false);

    adapter.attach(bus);
    expect(adapter.isAttached()).toBe(true);
    expect(bus.hasSubscriber(adapter)).toBe(true);

    adapter.detach();
    expect(adapter.isAttached()).toBe(false);
    expect(bus.hasSubscriber(adapter)).toBe(false);
  });

  it("stops receiving events once detached", () => {
    const bus = new EventBus();
    const adapter = new GenesisRealityAdapter();
    adapter.attach(bus);
    adapter.detach();

    bus.publish(makeEvent(Events.MISSION_COMPLETED, { totalTasks: 1 }));
    expect(adapter.getMetrics().received).toBe(0);
  });

  it("does not double-subscribe when attached repeatedly", () => {
    const bus = new EventBus();
    const adapter = new GenesisRealityAdapter();
    const recorded = captureRecorded();

    adapter.attach(bus);
    adapter.attach(bus);
    adapter.attach(bus);

    bus.publish(
      makeEvent(Events.TASK_COMPLETED, { id: "t", title: "Once", projectId: "p" }, "single"),
    );

    // One delivery, not three.
    expect(adapter.getMetrics().received).toBe(1);
    expect(recorded.events).toHaveLength(1);

    recorded.stop();
    adapter.detach();
  });

  it("moves cleanly between buses", () => {
    const first = new EventBus();
    const second = new EventBus();
    const adapter = new GenesisRealityAdapter();

    adapter.attach(first);
    adapter.attach(second);

    expect(first.hasSubscriber(adapter)).toBe(false);
    expect(second.hasSubscriber(adapter)).toBe(true);

    first.publish(makeEvent(Events.MISSION_COMPLETED, { totalTasks: 1 }));
    expect(adapter.getMetrics().received).toBe(0);

    adapter.detach();
  });

  it("tolerates detach when never attached", () => {
    expect(() => new GenesisRealityAdapter().detach()).not.toThrow();
  });
});

describe("reality adapter — production wiring", () => {
  // P2 asserted the inverse of every case below: the adapter was deliberately
  // dormant then, and the cutover deliberately activates it. These are the
  // replacement assertions, not weakened ones — they now pin that production
  // actually opens the boundary.
  it("is attached simply by importing GENESIS", () => {
    expect(genesisRealityAdapter.isAttached()).toBe(true);
    expect(globalEventBus.hasSubscriber(genesisRealityAdapter)).toBe(true);
  });

  it("is named in the GENESIS production composition", () => {
    const names = genesis.GENESIS_COGNITIVE_PROCESSORS.map((p) => p.name);
    expect(names).toContain("realityAdapter");
  });

  it("observes a real OS action without any test wiring", () => {
    const recorded = captureRecorded();
    const before = genesisRealityAdapter.getMetrics().received;

    akira.addTask("Cutover-phase task");

    expect(genesisRealityAdapter.getMetrics().received).toBeGreaterThan(before);
    recorded.stop();
  });
});

// ---------------------------------------------------------------------------
// Integration: a real AKIRA OS action, through the real publish path.
// No hand-built MemoryEvent anywhere in this block.
// ---------------------------------------------------------------------------

describe("reality adapter — real OS action integration", () => {
  let adapter: InstanceType<typeof GenesisRealityAdapter>;

  beforeEach(() => {
    adapter = new GenesisRealityAdapter();
    // Explicit attachment to the real singleton. P2 stays dormant precisely
    // because this line lives in a test rather than in composition.
    adapter.attach(globalEventBus);
  });

  afterEach(() => {
    adapter.detach();
  });

  it("carries a real task completion from the store into GENESIS cognition", () => {
    const projectId = `proj-integration-${Date.now()}`;
    const before = {
      candidates: genesis.candidateService.getCandidates().length,
      memories: genesis.memoryService.getMemories().length,
      stories: genesis.storyService.getStories().length,
    };

    // 1. A real AKIRA OS action. Nothing about the event is constructed here —
    //    akira-store's own producer publishes it.
    akira.addTaskDetails({ title: "Wire the reality adapter", projectId });
    const state = akira.getState();
    const task = state.tasks.find((t) => t.title === "Wire the reality adapter");
    expect(task, "the store action must have created the task").toBeDefined();

    akira.toggleTask(task!.id);

    // 2. The adapter saw the platform event and translated it.
    const metrics = adapter.getMetrics();
    expect(metrics.translated).toBeGreaterThan(0);

    // 3. GENESIS formed a candidate from it.
    const candidates = genesis.candidateService.getCandidates();
    expect(candidates.length).toBeGreaterThan(before.candidates);
    expect(candidates[0].reason).toBe("Goal Progress");

    // 4. The candidate was validated and promoted to a memory.
    const memories = genesis.memoryService.getMemories();
    expect(memories.length).toBeGreaterThan(before.memories);
    const memory = memories[memories.length - 1];
    expect(memory.relatedProjectId).toBe(projectId);

    // 5. Story clustering picked it up.
    const story = genesis.storyService
      .getStories()
      .find((s) => s.summary.includes(`ID: ${projectId}`));
    expect(story, "a Project Arc story must exist for the project").toBeDefined();
    expect(story!.relatedMemoryIds).toContain(memory.id);

    // 6. Importance scored it.
    expect(genesis.importanceService.getImportance(memory.id)).toBeDefined();

    // 7. Understanding advanced.
    expect(genesis.understandingEngine.getUnderstandings().length).toBeGreaterThan(0);
  });

  it("reaches GENESIS through instrumentation publish(), not the legacy bus", () => {
    const recorded = captureRecorded();

    // publish() is the production entry point every producer calls.
    publish({
      type: Events.PROJECT_CREATED,
      source: "integration-test",
      payload: { id: "proj-direct", name: "Direct publish" },
      version: 1,
    });

    expect(recorded.events.map((e) => e.eventType)).toContain("project_created");
    expect(adapter.getMetrics().translated).toBeGreaterThan(0);

    recorded.stop();
  });
});

describe("legacy GENESIS intake — removed by the cutover", () => {
  // The S1 defect was that GENESIS subscribed "*" on the legacy bus while every
  // workspace event was published on the instrumentation bus. That subscription
  // is gone; the reality adapter is the sole intake. These cases pin the removal
  // so it cannot quietly return and start double-processing.
  it("no longer records anything published on the legacy bus", async () => {
    const { eventBus } = await import("../src/shared/infrastructure/event-bus");
    const recorded = captureRecorded();

    eventBus.publish(Events.PRESENCE_UPDATED, {
      context: {
        returnState: "returning",
        timePeriod: "evening",
        recentProjectReference: "proj-legacy",
      },
    });

    // The legacy bus no longer forwards anything to the platform bus -- the
    // bridge is gone -- so a legacy publish reaches neither the platform bus nor
    // GENESIS. presence matched no candidate rule when it did arrive, so
    // presence onto the platform bus is P5.
    expect(recorded.events).toHaveLength(0);
    recorded.stop();
  });

  it("exposes no initialize() that could re-open the legacy subscription", () => {
    expect((eventService as unknown as Record<string, unknown>).initialize).toBeUndefined();
  });

  it("still records through its own public API", () => {
    // record()/onRecord() are unchanged for all 77 internal GENESIS callers.
    const recorded = captureRecorded();
    eventService.record("note_created", "Direct", "Direct call", null, "note-1", {});
    expect(recorded.events.map((e) => e.eventType)).toContain("note_created");
    recorded.stop();
  });
});

describe("shared translation table", () => {
  it("is the single definition the reality adapter translates through", () => {
    // One table, one translation path. A second copy of these strings is how
    // note.updated drifted away from its consumers before P1.
    const translated = translatePlatformEvent(Events.TASK_COMPLETED, {
      id: "t",
      title: "Shared",
      projectId: "p",
    });

    expect(translated).toEqual({
      eventType: "task_completed",
      title: "Task Completed",
      description: 'Completed task: "Shared"',
      relatedProjectId: "p",
      relatedNoteId: null,
    });

    expect(translatePlatformEvent("totally.unknown", {})).toBeNull();
  });
});
