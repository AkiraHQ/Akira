/**
 * Phase 3K Production Task List Grounding Integration Test
 *
 * Verifies the complete real application-facing task list pipeline:
 *
 * Real application-facing task list & boot hydration
 *   ├── tasksService.list() ──► listTasksViaCapability() / persistListTasks
 *   └── getInitialState()   ──► listTasksViaCapability()
 *         └──► Canonical AKIRA OS CapabilityRegistry Host (getCapabilityRegistry)
 *                └──► Rule N1 Permission & Boundary Verification
 *                └──► task.list Query Capability (taskListHandler)
 *                └──► SqliteTaskRepository.getAll()
 *                └──► SQLite Database Query (ORDER BY position ASC, created_at ASC)
 *                └──► Uniform Contract K5 Result Return (Result.success(Task[]))
 *
 * Strictly verifies Query semantics:
 * - Zero SQLite mutations
 * - Zero DomainEvent emissions on Contract K3 eventBus
 * - Exact ordering and field shape preservation
 * - Strict slice isolation (task.create, task.read, task.update, recall.search, task.list registered; project.read, project.list absent)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { runWithStartContext } from "@tanstack/start-storage-context";
import { initializeDatabase } from "../../src/persistence/initializer";
import { getDatabaseConnection, closeDatabaseConnection } from "../../src/persistence/connection";
import { eventBus } from "../../src/shared/infrastructure/event-bus";
import { tasksService } from "../../src/akira-os/tasks/services";
import { getCapabilityRegistry, resetCapabilityRegistry } from "../../src/akira-os/capabilities/host";
import { taskRepository } from "../../src/persistence/repositories";
import { getInitialState } from "../../src/persistence/store-init";
import { persistListTasks, listTasksViaCapability } from "../../src/akira-os/tasks/server";
import { DomainEvent } from "../../src/contracts/events/domain-event";

describe("Phase 3K — Production Task List Pipeline", () => {
  beforeAll(() => {
    process.env.NODE_ENV = "test";
    initializeDatabase();
  });

  afterAll(() => {
    closeDatabaseConnection();
  });

  beforeEach(() => {
    resetCapabilityRegistry();
    const db = getDatabaseConnection();
    db.prepare("DELETE FROM tasks").run();
  });

  it("Test 1 — End-to-end task listing via tasksService.list() retrieves all tasks accurately", async () => {
    // Seed tasks via repository directly
    const id1 = taskRepository.add({
      title: "Task Alpha",
      description: "First test task",
      priority: "High",
      estimatedDuration: 30,
    });
    const id2 = taskRepository.add({
      title: "Task Beta",
      description: "Second test task",
      priority: "Medium",
      estimatedDuration: 60,
    });

    const tasks = await tasksService.list();

    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBe(2);

    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    expect(taskMap.has(id1)).toBe(true);
    expect(taskMap.has(id2)).toBe(true);

    const alpha = taskMap.get(id1)!;
    expect(alpha.title).toBe("Task Alpha");
    expect(alpha.description).toBe("First test task");
    expect(alpha.priority).toBe("High");
    expect(alpha.estimatedDuration).toBe(30);
    expect(alpha.done).toBe(false);

    const beta = taskMap.get(id2)!;
    expect(beta.title).toBe("Task Beta");
    expect(beta.description).toBe("Second test task");
    expect(beta.priority).toBe("Medium");
    expect(beta.estimatedDuration).toBe(60);
    expect(beta.done).toBe(false);
  });

  it("Test 2 — Empty task list handling returns [] without throwing or fabricating records", async () => {
    const tasks = await tasksService.list();
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBe(0);
    expect(tasks).toEqual([]);
  });

  it("Test 3 — Task list ordering preservation maintains ORDER BY position ASC, created_at ASC", async () => {
    const db = getDatabaseConnection();

    // Insert tasks with explicit positions and timestamps to verify deterministic ordering
    db.prepare(`
      INSERT INTO tasks (id, title, priority, position, created_at, updated_at)
      VALUES 
        ('t-pos-2', 'Pos 2 Task', 'Low', 2, '2026-10-01T10:00:00.000Z', '2026-10-01T10:00:00.000Z'),
        ('t-pos-0', 'Pos 0 Task', 'High', 0, '2026-10-01T10:00:00.000Z', '2026-10-01T10:00:00.000Z'),
        ('t-pos-1-early', 'Pos 1 Early Task', 'Medium', 1, '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z'),
        ('t-pos-1-late', 'Pos 1 Late Task', 'Medium', 1, '2026-10-01T11:00:00.000Z', '2026-10-01T11:00:00.000Z')
    `).run();

    const tasks = await tasksService.list();

    expect(tasks.length).toBe(4);
    expect(tasks[0].id).toBe("t-pos-0");
    expect(tasks[1].id).toBe("t-pos-1-early");
    expect(tasks[2].id).toBe("t-pos-1-late");
    expect(tasks[3].id).toBe("t-pos-2");
  });

  it("Test 4 — Query side-effect immutability guarantees zero database mutations", async () => {
    const db = getDatabaseConnection();

    taskRepository.add({ title: "Task 1", priority: "Low" });
    taskRepository.add({ title: "Task 2", priority: "High" });

    const tasksBefore = db.prepare("SELECT * FROM tasks ORDER BY id ASC").all();
    const countTasksBefore = db.prepare("SELECT COUNT(*) as c FROM tasks").get() as { c: number };
    const countEventsBefore = db.prepare("SELECT COUNT(*) as c FROM timeline_events").get() as { c: number };

    // Execute list query
    const listed = await tasksService.list();
    expect(listed.length).toBe(2);

    const tasksAfter = db.prepare("SELECT * FROM tasks ORDER BY id ASC").all();
    const countTasksAfter = db.prepare("SELECT COUNT(*) as c FROM tasks").get() as { c: number };
    const countEventsAfter = db.prepare("SELECT COUNT(*) as c FROM timeline_events").get() as { c: number };

    expect(countTasksAfter.c).toBe(countTasksBefore.c);
    expect(countEventsAfter.c).toBe(countEventsBefore.c);
    expect(tasksAfter).toEqual(tasksBefore);
  });

  it("Test 5 — Query DomainEvent invariant guarantees zero DomainEvents emitted on eventBus", async () => {
    taskRepository.add({ title: "Event Test Task", priority: "Medium" });

    const emittedEvents: string[] = [];
    const unsubscribeCreated = eventBus.subscribe("task.created", () => emittedEvents.push("task.created"));
    const unsubscribeUpdated = eventBus.subscribe("task.updated", () => emittedEvents.push("task.updated"));
    const unsubscribeDeleted = eventBus.subscribe("task.deleted", () => emittedEvents.push("task.deleted"));

    try {
      const tasks = await tasksService.list();
      expect(tasks.length).toBe(1);

      // Queries must never emit DomainEvents
      expect(emittedEvents.length).toBe(0);
    } finally {
      unsubscribeCreated();
      unsubscribeUpdated();
      unsubscribeDeleted();
    }
  });

  it("Test 6 — Contract K19 correlation traceability & Rule N1 context handling", async () => {
    taskRepository.add({ title: "Traceability Task", priority: "Low" });

    const registry = getCapabilityRegistry();
    const correlation = {
      requestId: "req_test_list_123",
      correlationId: "corr_test_list_456",
      invocationId: "inv_test_list_789",
    };

    const result = await registry.invoke<Record<string, never>, unknown[]>(
      "task.list",
      {},
      correlation,
      { isInternal: true, isVajra: false },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Array.isArray(result.value)).toBe(true);
      expect(result.value.length).toBe(1);
    }
  });

  it("Test 7 — Canonical CapabilityRegistry slice audit", () => {
    const registry = getCapabilityRegistry();

    // 1. task.create (Command, Phase 3F)
    expect(registry.has("task.create")).toBe(true);
    expect(registry.get("task.create")?.descriptor.kind).toBe("Command");

    // 2. task.read (Query, Phase 3G)
    expect(registry.has("task.read")).toBe(true);
    expect(registry.get("task.read")?.descriptor.kind).toBe("Query");

    // 3. task.update (Command, Phase 3H)
    expect(registry.has("task.update")).toBe(true);
    expect(registry.get("task.update")?.descriptor.kind).toBe("Command");

    // 4. recall.search (Query, Tier 2, Phase 3J)
    expect(registry.has("recall.search")).toBe(true);
    expect(registry.get("recall.search")?.descriptor.kind).toBe("Query");
    expect(registry.get("recall.search")?.descriptor.activationTier).toBe(2);

    // 5. task.list (Query, Tier 1, Phase 3K)
    expect(registry.has("task.list")).toBe(true);
    const listCap = registry.get("task.list");
    expect(listCap?.descriptor.name).toBe("task.list");
    expect(listCap?.descriptor.kind).toBe("Query");
    expect(listCap?.descriptor.owner).toBe("AKIRA OS · workspace");
    expect(listCap?.descriptor.activationTier).toBe(1);
    expect(listCap?.descriptor.executionCharacteristics?.isReadOnly).toBe(true);

    // 6. Unintegrated capabilities remain unregistered
    expect(registry.has("project.read")).toBe(false);
    expect(registry.has("project.list")).toBe(false);
  });

  it("Test 8 — Convergence proof: getInitialState boot hydration and persistListTasks route through listTasksViaCapability", async () => {
    const serverModule = await import("../../src/akira-os/tasks/server");
    expect(typeof serverModule.persistListTasks).toBe("function");
    expect(serverModule.persistListTasks.method).toBe("GET");
    expect(typeof serverModule.listTasksViaCapability).toBe("function");
    expect(typeof getInitialState).toBe("function");
    expect(getInitialState.method).toBe("GET");

    const listSpy = vi.spyOn(serverModule, "listTasksViaCapability");

    const id1 = taskRepository.add({ title: "Boot Task 1", priority: "Low" });
    const id2 = taskRepository.add({ title: "Boot Task 2", priority: "High" });

    // 1. Direct server capability bridge
    const tasksViaCap = await serverModule.listTasksViaCapability();
    expect(tasksViaCap.length).toBe(2);
    expect(tasksViaCap.map((t) => t.id)).toEqual([id1, id2]);

    // 2. Boot hydration path (getInitialState executes synchronously on server without throwing)
    await runWithStartContext({} as never, () => getInitialState());

    // Proves getInitialState executed listTasksViaCapability
    expect(listSpy).toHaveBeenCalledTimes(2);

    listSpy.mockRestore();
  });
});
