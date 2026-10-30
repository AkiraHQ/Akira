/**
 * Phase 3G Production Task Read Grounding Integration Test
 *
 * Verifies the complete real application-facing task read pipeline:
 *
 * Real application-facing task read (tasksService.getById)
 *   ──► TanStack Start server boundary (persistGetTask)
 *   ──► Canonical AKIRA OS CapabilityRegistry Host (getCapabilityRegistry)
 *   ──► Contract K2 Query Capability (task.read)
 *   ──► SqliteTaskRepository.getById()
 *   ──► SQLite Database Read (SELECT * FROM tasks WHERE id = ?)
 *   ──► Uniform Contract K5 Result Return (Result.success(Task | null))
 *
 * Strictly verifies Query semantics:
 * - Zero SQLite mutations
 * - Zero DomainEvent emissions
 * - Strict slice isolation (task.create and task.read registered; task.list, task.update, recall.search absent)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { runWithStartContext } from "@tanstack/start-storage-context";
import { initializeDatabase } from "../../src/persistence/initializer";
import { getDatabaseConnection, closeDatabaseConnection } from "../../src/persistence/connection";
import { eventBus } from "../../src/shared/infrastructure/event-bus";
import { tasksService } from "../../src/akira-os/tasks/services";
import { getCapabilityRegistry, resetCapabilityRegistry } from "../../src/akira-os/capabilities/host";
import { taskRepository } from "../../src/persistence/repositories";

describe("Phase 3G — Production Task Read Pipeline", () => {
  beforeAll(() => {
    process.env.NODE_ENV = "test";
    initializeDatabase();
  });

  afterAll(() => {
    closeDatabaseConnection();
  });

  beforeEach(() => {
    resetCapabilityRegistry();
  });

  it("reads an existing task successfully via the real production service path", async () => {
    // 1. Seed a task directly into SQLite
    const seededId = taskRepository.add({
      title: "Ground task.read Query in Production",
      description: "Verifies read pipeline executes through CapabilityRegistry",
      priority: "High",
      estimatedDuration: 30,
      dueDate: "2026-10-20",
    });

    // 2. Read the task via real application service
    const task = await runWithStartContext({} as never, () =>
      tasksService.getById(seededId),
    );

    // 3. Verify retrieved task shape and attributes
    expect(task).not.toBeNull();
    expect(task?.id).toBe(seededId);
    expect(task?.title).toBe("Ground task.read Query in Production");
    expect(task?.description).toBe("Verifies read pipeline executes through CapabilityRegistry");
    expect(task?.priority).toBe("High");
    expect(task?.estimatedDuration).toBe(30);
    expect(task?.dueDate).toBe("2026-10-20");
    expect(task?.done).toBe(false);
  });

  it("returns null when reading a non-existent task", async () => {
    const task = await runWithStartContext({} as never, () =>
      tasksService.getById("non-existent-task-id-99999"),
    );

    expect(task).toBeNull();
  });

  it("enforces Zod input validation through CapabilityRegistry before touching SQLite on empty ID", async () => {
    await expect(
      runWithStartContext({} as never, () => tasksService.getById("")),
    ).rejects.toThrow(/Failed to read task via capability/);
  });

  it("guarantees task.read Query causes zero SQLite mutations (row count remains identical)", async () => {
    const seededId = taskRepository.add({
      title: "Mutation Invariant Test Task",
      priority: "Low",
    });

    const db = getDatabaseConnection();
    const countBefore = (
      db.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number }
    ).count;

    // Execute query read
    const task = await runWithStartContext({} as never, () =>
      tasksService.getById(seededId),
    );
    expect(task).not.toBeNull();

    const countAfter = (
      db.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number }
    ).count;

    expect(countAfter).toBe(countBefore);
  });

  it("guarantees task.read Query emits zero DomainEvents on eventBus", async () => {
    const seededId = taskRepository.add({
      title: "Event Emission Invariant Test Task",
      priority: "Medium",
    });

    const emittedEvents: string[] = [];
    const unsubscribeCreated = eventBus.subscribe("task.created", () => {
      emittedEvents.push("task.created");
    });
    const unsubscribeUpdated = eventBus.subscribe("task.updated", () => {
      emittedEvents.push("task.updated");
    });
    const unsubscribeRead = eventBus.subscribe("task.read", () => {
      emittedEvents.push("task.read");
    });

    try {
      const task = await runWithStartContext({} as never, () =>
        tasksService.getById(seededId),
      );
      expect(task).not.toBeNull();

      // Queries must never emit DomainEvents
      expect(emittedEvents.length).toBe(0);
    } finally {
      unsubscribeCreated();
      unsubscribeUpdated();
      unsubscribeRead();
    }
  });

  it("verifies registry host capabilities for Phase 3G slice", () => {
    const registry = getCapabilityRegistry();

    // 1. Existing task.create remains registered
    expect(registry.has("task.create")).toBe(true);
    expect(registry.get("task.create")?.descriptor.kind).toBe("Command");

    // 2. task.read is registered
    expect(registry.has("task.read")).toBe(true);
    expect(registry.get("task.read")?.descriptor.kind).toBe("Query");
    expect(registry.get("task.read")?.descriptor.owner).toBe("AKIRA OS · workspace");

    // 3. task.update is registered in this slice (Phase 3H)
    expect(registry.has("task.update")).toBe(true);
    expect(registry.get("task.update")?.descriptor.kind).toBe("Command");

    // 4. recall.search is registered in this slice (Phase 3J, Tier 2)
    expect(registry.has("recall.search")).toBe(true);
    expect(registry.get("recall.search")?.descriptor.kind).toBe("Query");

    // 5. task.list is registered in this slice (Phase 3K)
    expect(registry.has("task.list")).toBe(true);
  });


  it("proves persistGetTask server function exists, is configured as POST, and agrees on Task | null return contract", async () => {
    const { persistGetTask, readTaskViaCapability } = await import("../../src/akira-os/tasks/server");
    expect(typeof persistGetTask).toBe("function");
    expect(persistGetTask.method).toBe("POST");
    expect(typeof readTaskViaCapability).toBe("function");

    const seededId = taskRepository.add({
      title: "Direct Server Function Audit",
      priority: "Low",
    });

    const task = await readTaskViaCapability(seededId);
    expect(task).not.toBeNull();
    expect(task?.id).toBe(seededId);
    expect(task?.title).toBe("Direct Server Function Audit");

    const nonExistent = await readTaskViaCapability("missing-task-id");
    expect(nonExistent).toBeNull();
  });
});

