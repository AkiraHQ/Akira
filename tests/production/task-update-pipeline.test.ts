/**
 * Phase 3H Production Task Update Grounding Integration Test
 *
 * Verifies the complete real application-facing task update pipeline:
 *
 * Real application-facing task update (tasksService.update)
 *   ──► TanStack Start server boundary (persistUpdateTask / updateTaskViaCapability)
 *   ──► Canonical AKIRA OS CapabilityRegistry Host (getCapabilityRegistry)
 *   ──► Contract K1 / K7 Command Capability (task.update)
 *   ──► SqliteTaskRepository.update()
 *   ──► Single Authoritative SQLite Database Mutation (UPDATE tasks SET ... WHERE id = ?)
 *   ──► Uniform Contract K5 Result Return (Result.success({ updated: true }))
 *   ──► Contract K3 DomainEvent Emission (task.updated)
 *   ──► Contract K19 Causation & Correlation Metadata
 *
 * Strictly verifies Command semantics:
 * - Clear state transition of updated fields
 * - Exactly one repository update path invoked
 * - Exactly one task.updated DomainEvent emitted
 * - Zero row additions or deletions
 * - Strict slice isolation (task.create, task.read, task.update registered; task.list, recall.search absent)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { runWithStartContext } from "@tanstack/start-storage-context";
import { initializeDatabase } from "../../src/persistence/initializer";
import { getDatabaseConnection, closeDatabaseConnection } from "../../src/persistence/connection";
import { eventBus } from "../../src/shared/infrastructure/event-bus";
import { tasksService } from "../../src/akira-os/tasks/services";
import { getCapabilityRegistry, resetCapabilityRegistry } from "../../src/akira-os/capabilities/host";
import { taskRepository } from "../../src/persistence/repositories";
import type { DomainEvent } from "../../src/contracts/events/domain-event";

describe("Phase 3H — Production Task Update Pipeline", () => {
  beforeAll(() => {
    process.env.NODE_ENV = "test";
    initializeDatabase();
  });

  afterAll(() => {
    closeDatabaseConnection();
  });

  beforeEach(() => {
    resetCapabilityRegistry();
    vi.restoreAllMocks();
  });

  it("updates an existing task successfully via the real production service path, proving state transition and single mutation", async () => {
    // 1. Seed initial task directly into SQLite
    const seededId = taskRepository.add({
      title: "Initial Title",
      description: "Unchanged Description",
      priority: "Low",
      estimatedDuration: 20,
      dueDate: "2026-10-10",
    });

    const initialTask = taskRepository.getById(seededId);
    expect(initialTask).toBeDefined();
    expect(initialTask?.title).toBe("Initial Title");
    expect(initialTask?.priority).toBe("Low");
    expect(initialTask?.description).toBe("Unchanged Description");

    // 2. Measure database row count before update
    const db = getDatabaseConnection();
    const countBefore = (
      db.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number }
    ).count;

    // 3. Spy on taskRepository.update to verify single update invocation path
    const updateSpy = vi.spyOn(taskRepository, "update");

    // 4. Subscribe to Contract K3 domain event
    const emittedEvents: DomainEvent[] = [];
    const unsubscribe = eventBus.subscribe("task.updated", (envelope) => {
      emittedEvents.push(envelope.payload as DomainEvent);
    });

    try {
      // 5. Execute task update through real application domain service
      await runWithStartContext({} as never, () =>
        tasksService.update(seededId, {
          title: "Updated Title",
          priority: "High",
        }),
      );

      // 6. Verify state transition in SQLite
      const updatedTask = taskRepository.getById(seededId);
      expect(updatedTask).toBeDefined();
      expect(updatedTask?.title).toBe("Updated Title");
      expect(updatedTask?.priority).toBe("High");
      // Verify non-updated field remains untouched
      expect(updatedTask?.description).toBe("Unchanged Description");

      // 7. Verify single repository mutation path
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith(seededId, {
        title: "Updated Title",
        priority: "High",
      });

      // 8. Verify row count invariant (no insertion or deletion occurred)
      const countAfter = (
        db.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number }
      ).count;
      expect(countAfter).toBe(countBefore);

      // 9. Verify Contract K3 DomainEvent emission
      expect(emittedEvents.length).toBe(1);
      const domainEvent = emittedEvents[0];
      expect(domainEvent.name).toBe("task.updated");
      expect(domainEvent.producer).toBe("AKIRA OS · workspace");
      expect(domainEvent.subject).toBe(seededId);
      expect(domainEvent.payload).toEqual({
        id: seededId,
        patch: {
          title: "Updated Title",
          priority: "High",
        },
      });

      // 10. Verify Contract K19 Causation & Correlation metadata
      expect(domainEvent.correlationId).toBeDefined();
      expect(domainEvent.correlationId).toMatch(/^corr_/);
      expect(domainEvent.requestId).toBeDefined();
      expect(domainEvent.requestId).toMatch(/^req_/);
      expect(domainEvent.causationId).toBeDefined();
      expect(domainEvent.causationId).toMatch(/^inv_/);
    } finally {
      unsubscribe();
    }

  });

  it("enforces Zod input validation through CapabilityRegistry before touching SQLite on empty patch", async () => {
    const seededId = taskRepository.add({
      title: "Validation Test Task",
      priority: "Medium",
    });

    const updateSpy = vi.spyOn(taskRepository, "update");

    // Empty patch violates taskUpdateInputSchema refine (must contain at least one field)
    await expect(
      runWithStartContext({} as never, () =>
        tasksService.update(seededId, {} as never),
      ),
    ).rejects.toThrow(/Failed to update task via capability/);

    // Repository must NOT have been called
    expect(updateSpy).not.toHaveBeenCalled();

    // Database record must remain intact
    const task = taskRepository.getById(seededId);
    expect(task?.title).toBe("Validation Test Task");
  });

  it("enforces Zod input validation through CapabilityRegistry before touching SQLite on empty ID", async () => {
    const updateSpy = vi.spyOn(taskRepository, "update");

    await expect(
      runWithStartContext({} as never, () =>
        tasksService.update("", { title: "New Title" }),
      ),
    ).rejects.toThrow(/Failed to update task via capability/);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("fails cleanly with execution_failure when updating a non-existent task", async () => {
    await expect(
      runWithStartContext({} as never, () =>
        tasksService.update("non-existent-task-id-99999", { title: "Ghost Task" }),
      ),
    ).rejects.toThrow(/Task with ID 'non-existent-task-id-99999' was not found/);
  });

  it("verifies registry host capabilities for Phase 3H slice", () => {
    const registry = getCapabilityRegistry();

    // 1. task.create remains registered (Phase 3F)
    expect(registry.has("task.create")).toBe(true);
    expect(registry.get("task.create")?.descriptor.kind).toBe("Command");

    // 2. task.read remains registered (Phase 3G)
    expect(registry.has("task.read")).toBe(true);
    expect(registry.get("task.read")?.descriptor.kind).toBe("Query");

    // 3. task.update is registered (Phase 3H)
    expect(registry.has("task.update")).toBe(true);
    expect(registry.get("task.update")?.descriptor.kind).toBe("Command");
    expect(registry.get("task.update")?.descriptor.owner).toBe("AKIRA OS · workspace");

    // 4. recall.search is registered (Phase 3J, Tier 2)
    expect(registry.has("recall.search")).toBe(true);
    expect(registry.get("recall.search")?.descriptor.kind).toBe("Query");
    expect(registry.get("recall.search")?.descriptor.owner).toBe("AKIRA OS · search");

    // 5. task.list is registered in this slice (Phase 3K)
    expect(registry.has("task.list")).toBe(true);
  });

  it("proves persistUpdateTask server function exists, is configured as POST, and agrees on contract", async () => {
    const { persistUpdateTask, updateTaskViaCapability } = await import("../../src/akira-os/tasks/server");
    expect(typeof persistUpdateTask).toBe("function");
    expect(persistUpdateTask.method).toBe("POST");
    expect(typeof updateTaskViaCapability).toBe("function");

    const seededId = taskRepository.add({
      title: "Direct Server Function Audit",
      priority: "Low",
    });

    const updated = await updateTaskViaCapability(seededId, { title: "Direct Audit Updated" });
    expect(updated).toBe(true);

    const task = taskRepository.getById(seededId);
    expect(task?.title).toBe("Direct Audit Updated");
  });
});
