process.env.AKIRA_DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { describe, it, expect, beforeEach } from "vitest";
import { initializeDatabase } from "../../src/persistence/initializer";

initializeDatabase();

import { taskRepository } from "../../src/persistence/repositories";
import { CapabilityRegistry } from "../../src/contracts/capabilities/registry";
import {
  registerTaskCapabilities,
  taskReadDescriptor,
  taskListDescriptor,
} from "../../src/akira-os/tasks/capabilities/task-read";
import { CorrelationMetadata } from "../../src/contracts/results/result";

describe("Task Read Capabilities Vertical Slice (task.read / task.list)", () => {
  let registry: CapabilityRegistry;

  const sampleCorrelation: CorrelationMetadata = {
    requestId: "req-task-123",
    correlationId: "corr-task-123",
    invocationId: "inv-task-123",
  };

  beforeEach(() => {
    registry = new CapabilityRegistry();
    registerTaskCapabilities(registry);
  });

  it("registers task.read and task.list descriptors correctly", () => {
    expect(registry.has("task.read")).toBe(true);
    expect(registry.has("task.list")).toBe(true);

    const readCap = registry.get("task.read");
    expect(readCap?.descriptor.name).toBe("task.read");
    expect(readCap?.descriptor.kind).toBe("Query");
    expect(readCap?.descriptor.owner).toBe("AKIRA OS · workspace");
    expect(readCap?.descriptor.activationTier).toBe(1);

    const listCap = registry.get("task.list");
    expect(listCap?.descriptor.name).toBe("task.list");
    expect(listCap?.descriptor.kind).toBe("Query");
    expect(listCap?.descriptor.owner).toBe("AKIRA OS · workspace");
    expect(listCap?.descriptor.activationTier).toBe(1);
  });

  it("executes task.read and returns Result.success(task) when task exists", async () => {
    const taskId = taskRepository.add({
      title: "Refactor Capability Registry",
      description: "Implement Tier 2 activation semantics",
      priority: "High",
    });

    const res = await registry.invoke("task.read", { id: taskId }, sampleCorrelation);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).not.toBeNull();
      expect(res.value?.id).toBe(taskId);
      expect(res.value?.title).toBe("Refactor Capability Registry");
      expect(res.value?.priority).toBe("High");
      expect(res.correlation).toEqual(sampleCorrelation);
    }
  });

  it("executes task.read and returns Result.success(null) when task does not exist", async () => {
    const res = await registry.invoke(
      "task.read",
      { id: "non-existent-task-uuid" },
      sampleCorrelation,
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toBeNull();
      expect(res.correlation).toEqual(sampleCorrelation);
    }
  });

  it("returns Result.failure with category 'invalid_request' when task.read input is invalid", async () => {
    // Empty string fails input schema validation z.string().min(1)
    const res = await registry.invoke("task.read", { id: "" }, sampleCorrelation);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.category).toBe("invalid_request");
      expect(res.error.message).toContain("Input validation failed");
      expect(res.correlation).toEqual(sampleCorrelation);
    }
  });

  it("executes task.list and returns Result.success(Task[]) containing all workspace tasks", async () => {
    const t1 = taskRepository.add({ title: "Task 1 Baseline" });
    const t2 = taskRepository.add({ title: "Task 2 Baseline" });

    const res = await registry.invoke("task.list", {}, sampleCorrelation);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Array.isArray(res.value)).toBe(true);
      const ids = res.value.map((t) => t.id);
      expect(ids).toContain(t1);
      expect(ids).toContain(t2);
      expect(res.correlation).toEqual(sampleCorrelation);
    }
  });
});
