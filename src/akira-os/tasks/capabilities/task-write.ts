import { z } from "zod";
import { CapabilityDescriptor } from "../../../contracts/capabilities/descriptor";
import { CapabilityRegistry } from "../../../contracts/capabilities/registry";
import { createDomainEvent } from "../../../contracts/events/domain-event";
import { eventBus } from "../../../shared/infrastructure/event-bus";
import { CorrelationMetadata } from "../../../contracts/results/result";
import type { Task } from "../../../shared/types/store-types";

/**
 * Input Schema for task.create Command capability.
 */
export const taskCreateInputSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1, "Task title cannot be empty"),
  description: z.string().optional(),
  priority: z.enum(["Low", "Medium", "High"]).optional().default("Medium"),
  estimatedDuration: z.number().int().positive().optional().default(30),
  dueDate: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
});

export type TaskCreateInput = z.infer<typeof taskCreateInputSchema>;
export type TaskCreateOutput = { id: string };

/**
 * Descriptor for task.create Command capability per Contract K1 / Contract K7 / Rule N1.
 * Owner: AKIRA OS · workspace
 * Activation Tier: Tier 1 (Warm at boot)
 */
export const taskCreateDescriptor: CapabilityDescriptor<
  TaskCreateInput,
  TaskCreateOutput
> = {
  name: "task.create",
  version: "1.0.0",
  owner: "AKIRA OS · workspace",
  kind: "Command",
  inputSchema: taskCreateInputSchema as unknown as z.ZodType<TaskCreateInput>,
  permissions: {
    allowInternal: true,
    allowVajra: true,
    allowExternalMcp: false, // Decision D4: MCP v0 is read-only
  },
  activationTier: 1,
  isAvailable: true,
  costClass: "local_cheap",
  executionCharacteristics: {
    isSynchronous: true,
    isIdempotent: false,
    isReadOnly: false,
    sideEffectClass: "state_mutation",
  },
  observability: {
    emitsEvents: ["task.created"],
  },
};

/**
 * Handler for task.create capability.
 * Adapts existing SqliteTaskRepository.add() and emits Contract K3 DomainEvent with K19 causation metadata.
 */
export async function taskCreateHandler(
  input: TaskCreateInput,
  correlation: CorrelationMetadata,
): Promise<TaskCreateOutput> {
  const { taskRepository } = await import("../../../persistence/repositories");
  const taskId = taskRepository.add(input);

  const domainEvent = createDomainEvent(
    "task.created",
    "AKIRA OS · workspace",
    taskId,
    { id: taskId, title: input.title, projectId: input.projectId || null },
    correlation,
  );

  eventBus.publish("task.created", domainEvent);

  return { id: taskId };
}

/**
 * Input Schema for task.update Command capability.
 */
export const taskUpdateInputSchema = z.object({
  id: z.string().min(1, "Task ID must be a non-empty string"),
  patch: z
    .object({
      title: z.string().trim().min(1).optional(),
      description: z.string().optional(),
      priority: z.enum(["Low", "Medium", "High"]).optional(),
      estimatedDuration: z.number().int().positive().optional(),
      dueDate: z.string().nullable().optional(),
      done: z.boolean().optional(),
      completed: z.boolean().optional(),
      projectId: z.string().nullable().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, "Patch must contain at least one field to update"),
});

export type TaskUpdateInput = z.infer<typeof taskUpdateInputSchema>;
export type TaskUpdateOutput = { updated: boolean };

/**
 * Descriptor for task.update Command capability per Contract K1 / Contract K7 / Rule N1.
 * Owner: AKIRA OS · workspace
 * Activation Tier: Tier 1 (Warm at boot)
 */
export const taskUpdateDescriptor: CapabilityDescriptor<
  TaskUpdateInput,
  TaskUpdateOutput
> = {
  name: "task.update",
  version: "1.0.0",
  owner: "AKIRA OS · workspace",
  kind: "Command",
  inputSchema: taskUpdateInputSchema as unknown as z.ZodType<TaskUpdateInput>,
  permissions: {
    allowInternal: true,
    allowVajra: true,
    allowExternalMcp: false, // Decision D4: MCP v0 is read-only
  },
  activationTier: 1,
  isAvailable: true,
  costClass: "local_cheap",
  executionCharacteristics: {
    isSynchronous: true,
    isIdempotent: true,
    isReadOnly: false,
    sideEffectClass: "state_mutation",
  },
  observability: {
    emitsEvents: ["task.updated"],
  },
};

/**
 * Handler for task.update capability.
 * Adapts existing SqliteTaskRepository.update() and emits Contract K3 DomainEvent with K19 causation metadata.
 */
export async function taskUpdateHandler(
  input: TaskUpdateInput,
  correlation: CorrelationMetadata,
): Promise<TaskUpdateOutput> {
  const { taskRepository } = await import("../../../persistence/repositories");

  const existingTask = taskRepository.getById(input.id);
  if (!existingTask) {
    throw new Error(`Task with ID '${input.id}' was not found.`);
  }

  taskRepository.update(input.id, input.patch);

  const domainEvent = createDomainEvent(
    "task.updated",
    "AKIRA OS · workspace",
    input.id,
    { id: input.id, patch: input.patch },
    correlation,
  );

  eventBus.publish("task.updated", domainEvent);

  return { updated: true };
}

/**
 * Helper to register task write Command capabilities in the AKIRA OS Capability Registry.
 */
export function registerTaskWriteCapabilities(registry: CapabilityRegistry): void {
  registry.register(taskCreateDescriptor, taskCreateHandler);
  registry.register(taskUpdateDescriptor, taskUpdateHandler);
}
