process.env.AKIRA_DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initializeDatabase } from "../../src/persistence/initializer";

initializeDatabase();

import { taskRepository } from "../../src/persistence/repositories";
import { CapabilityRegistry } from "../../src/contracts/capabilities/registry";
import {
  registerTaskWriteCapabilities,
  taskCreateDescriptor,
  taskUpdateDescriptor,
} from "../../src/akira-os/tasks/capabilities/task-write";
import { CorrelationMetadata } from "../../src/contracts/results/result";
import { DomainEvent } from "../../src/contracts/events/domain-event";
import { eventBus } from "../../src/shared/infrastructure/event-bus";
import { CapabilityDescriptor } from "../../src/contracts/capabilities/descriptor";
import { z } from "zod";

describe("Task Write Command Capabilities Vertical Slice (task.create / task.update)", () => {
  let registry: CapabilityRegistry;

  const sampleCorrelation: CorrelationMetadata = {
    requestId: "req-command-999",
    correlationId: "corr-command-999",
    invocationId: "inv-command-999",
  };

  beforeEach(() => {
    registry = new CapabilityRegistry();
    registerTaskWriteCapabilities(registry);
  });

  it("registers task.create and task.update descriptors correctly as Command capabilities", () => {
    expect(registry.has("task.create")).toBe(true);
    expect(registry.has("task.update")).toBe(true);

    const createCap = registry.get("task.create");
    expect(createCap?.descriptor.name).toBe("task.create");
    expect(createCap?.descriptor.kind).toBe("Command");
    expect(createCap?.descriptor.owner).toBe("AKIRA OS · workspace");
    expect(createCap?.descriptor.permissions.allowExternalMcp).toBe(false);

    const updateCap = registry.get("task.update");
    expect(updateCap?.descriptor.name).toBe("task.update");
    expect(updateCap?.descriptor.kind).toBe("Command");
    expect(updateCap?.descriptor.owner).toBe("AKIRA OS · workspace");
    expect(updateCap?.descriptor.permissions.allowExternalMcp).toBe(false);
  });

  it("executes task.create, mutates SQLite, returns Result.success, and emits Contract K3 Event with K19 causation", async () => {
    const eventSpy = vi.fn();
    const unsubscribe = eventBus.subscribe("task.created", eventSpy);

    const res = await registry.invoke(
      "task.create",
      {
        title: "Implement Rule N1 Command Capability",
        description: "Task creation vertical slice",
        priority: "High",
        estimatedDuration: 45,
      },
      sampleCorrelation,
      { isInternal: true },
    );

    unsubscribe();

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value?.id).toBeDefined();
      expect(typeof res.value?.id).toBe("string");

      // Verify SQLite state mutation
      const createdTask = taskRepository.getById(res.value.id);
      expect(createdTask).not.toBeNull();
      expect(createdTask?.title).toBe("Implement Rule N1 Command Capability");
      expect(createdTask?.priority).toBe("High");
      expect(createdTask?.estimatedDuration).toBe(45);

      // Verify Contract K3 Domain Event emission
      expect(eventSpy).toHaveBeenCalledTimes(1);
      const eventBusEnvelope = eventSpy.mock.calls[0][0];
      expect(eventBusEnvelope.type).toBe("task.created");

      const emittedEvent: DomainEvent = eventBusEnvelope.payload;
      expect(emittedEvent.name).toBe("task.created");
      expect(emittedEvent.producer).toBe("AKIRA OS · workspace");
      expect(emittedEvent.subject).toBe(res.value.id);
      expect(emittedEvent.causationId).toBe(sampleCorrelation.invocationId);
      expect(emittedEvent.correlationId).toBe(sampleCorrelation.correlationId);
      expect(emittedEvent.requestId).toBe(sampleCorrelation.requestId);
    }
  });

  it("returns Result.failure with category 'invalid_request' when task.create input fails schema validation", async () => {
    // Empty title fails z.string().trim().min(1)
    const res = await registry.invoke(
      "task.create",
      { title: "   " },
      sampleCorrelation,
      { isInternal: true },
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.category).toBe("invalid_request");
      expect(res.error.message).toContain("Input validation failed");
      expect(res.correlation).toEqual(sampleCorrelation);
    }
  });

  it("executes task.update, mutates SQLite task, returns Result.success, and emits Contract K3 Event", async () => {
    // Add initial task
    const taskId = taskRepository.add({
      title: "Initial Task Title",
      priority: "Low",
    });

    const eventSpy = vi.fn();
    const unsubscribe = eventBus.subscribe("task.updated", eventSpy);

    const res = await registry.invoke(
      "task.update",
      {
        id: taskId,
        patch: {
          title: "Updated Task Title",
          priority: "High",
          done: true,
        },
      },
      sampleCorrelation,
      { isInternal: true },
    );

    unsubscribe();

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toEqual({ updated: true });

      // Verify SQLite state mutation
      const updatedTask = taskRepository.getById(taskId);
      expect(updatedTask?.title).toBe("Updated Task Title");
      expect(updatedTask?.priority).toBe("High");
      expect(updatedTask?.done).toBe(true);

      // Verify Contract K3 Domain Event emission
      expect(eventSpy).toHaveBeenCalledTimes(1);
      const eventBusEnvelope = eventSpy.mock.calls[0][0];
      expect(eventBusEnvelope.type).toBe("task.updated");

      const emittedEvent: DomainEvent = eventBusEnvelope.payload;
      expect(emittedEvent.name).toBe("task.updated");
      expect(emittedEvent.producer).toBe("AKIRA OS · workspace");
      expect(emittedEvent.subject).toBe(taskId);
      expect(emittedEvent.causationId).toBe(sampleCorrelation.invocationId);
      expect(emittedEvent.correlationId).toBe(sampleCorrelation.correlationId);
      expect(emittedEvent.requestId).toBe(sampleCorrelation.requestId);
    }
  });

  it("returns Result.failure with category 'execution_failure' when task.update targets non-existent task ID", async () => {
    const res = await registry.invoke(
      "task.update",
      {
        id: "non-existent-task-id",
        patch: { title: "New Title" },
      },
      sampleCorrelation,
      { isInternal: true },
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.category).toBe("execution_failure");
      expect(res.error.message).toContain("Task with ID 'non-existent-task-id' was not found");
      expect(res.correlation).toEqual(sampleCorrelation);
    }
  });

  it("returns Result.failure with category 'invalid_request' when task.update patch is empty", async () => {
    const taskId = taskRepository.add({ title: "Base Task" });

    // Empty patch object fails refine
    const res = await registry.invoke(
      "task.update",
      { id: taskId, patch: {} },
      sampleCorrelation,
      { isInternal: true },
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.category).toBe("invalid_request");
      expect(res.error.message).toContain("Input validation failed");
      expect(res.correlation).toEqual(sampleCorrelation);
    }
  });

  it("enforces Rule N1 Condition 5: rejects direct internal Command capabilities targeted at HANDS or GENESIS", async () => {
    const handsCommandDescriptor: CapabilityDescriptor = {
      name: "hands.executeTool",
      version: "1.0.0",
      owner: "HANDS · executor",
      kind: "Command",
      inputSchema: z.object({ tool: z.string() }),
      permissions: { allowInternal: true, allowVajra: true },
      activationTier: 1,
      isAvailable: true,
      costClass: "external_tool",
      executionCharacteristics: { isSynchronous: false, isIdempotent: false, isReadOnly: false },
    };

    registry.register(handsCommandDescriptor, () => ({}));

    // Direct internal invocation to HANDS Command capability
    const res = await registry.invoke(
      "hands.executeTool",
      { tool: "terminal" },
      sampleCorrelation,
      { isInternal: true },
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.category).toBe("command_rejection");
      expect(res.error.message).toContain("Rule N1 boundary");
      expect(res.correlation).toEqual(sampleCorrelation);
    }
  });

  it("enforces Decision D4: rejects external MCP write attempts with category 'command_rejection'", async () => {
    // Attempting task.create from external MCP caller ({ isExternalMcp: true })
    const res = await registry.invoke(
      "task.create",
      { title: "MCP Unauthorized Write" },
      sampleCorrelation,
      { isExternalMcp: true },
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.category).toBe("command_rejection");
      expect(res.error.message).toContain("disallowed by permissions");
      expect(res.correlation).toEqual(sampleCorrelation);
    }
  });
});
