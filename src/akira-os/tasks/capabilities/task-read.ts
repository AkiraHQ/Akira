import { z } from "zod";
import { CapabilityDescriptor } from "../../../contracts/capabilities/descriptor";
import { CapabilityRegistry } from "../../../contracts/capabilities/registry";
import type { Task } from "../../../shared/types/store-types";

/**
 * Input Schema for task.read capability.
 */
export const taskReadInputSchema = z.object({
  id: z.string().min(1, "Task ID must be a non-empty string"),
});

export type TaskReadInput = z.infer<typeof taskReadInputSchema>;

/**
 * Descriptor for task.read Query capability per Contract K7 / K2.
 * Owner: AKIRA OS · workspace
 * Activation Tier: Tier 1 (Warm at boot)
 */
export const taskReadDescriptor: CapabilityDescriptor<TaskReadInput, Task | null> = {
  name: "task.read",
  version: "1.0.0",
  owner: "AKIRA OS · workspace",
  kind: "Query",
  inputSchema: taskReadInputSchema,
  permissions: {
    allowInternal: true,
    allowVajra: true,
    allowExternalMcp: true,
  },
  activationTier: 1,
  isAvailable: true,
  costClass: "local_cheap",
  executionCharacteristics: {
    isSynchronous: true,
    isIdempotent: true,
    isReadOnly: true,
  },
};

/**
 * Handler for task.read capability.
 * Adapts existing SqliteTaskRepository without modifying repository internals.
 */
export async function taskReadHandler(
  input: TaskReadInput,
): Promise<Task | null> {
  const { taskRepository } = await import("../../../persistence/repositories");
  const task = taskRepository.getById(input.id);
  return task ?? null;
}

/**
 * Input Schema for task.list capability.
 */
export const taskListInputSchema = z.object({});

export type TaskListInput = z.infer<typeof taskListInputSchema>;

/**
 * Descriptor for task.list Query capability per Contract K7 / K2.
 * Owner: AKIRA OS · workspace
 * Activation Tier: Tier 1 (Warm at boot)
 */
export const taskListDescriptor: CapabilityDescriptor<TaskListInput, Task[]> = {
  name: "task.list",
  version: "1.0.0",
  owner: "AKIRA OS · workspace",
  kind: "Query",
  inputSchema: taskListInputSchema,
  permissions: {
    allowInternal: true,
    allowVajra: true,
    allowExternalMcp: true,
  },
  activationTier: 1,
  isAvailable: true,
  costClass: "local_cheap",
  executionCharacteristics: {
    isSynchronous: true,
    isIdempotent: true,
    isReadOnly: true,
  },
};

/**
 * Handler for task.list capability.
 * Adapts existing SqliteTaskRepository without modifying repository internals.
 */
export async function taskListHandler(): Promise<Task[]> {
  const { taskRepository } = await import("../../../persistence/repositories");
  return taskRepository.getAll();
}

/**
 * Helper to register task read capabilities in the AKIRA OS Capability Registry.
 */
export function registerTaskCapabilities(registry: CapabilityRegistry): void {
  registry.register(taskReadDescriptor, taskReadHandler);
  registry.register(taskListDescriptor, taskListHandler);
}
