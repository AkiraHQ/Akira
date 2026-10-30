import { createServerFn } from "@tanstack/react-start";
import type { Task } from "../../../shared/types/store-types";

export const persistAddTask = createServerFn({ method: "POST" })
  .validator(
    (input: {
      title: string;
      description?: string;
      priority?: "Low" | "Medium" | "High";
      estimatedDuration?: number;
      dueDate?: string | null;
      projectId?: string | null;
    }) => input,
  )
  .handler(async ({ data: input }) => {
    const { getCapabilityRegistry } = await import("../../capabilities/host");
    const registry = getCapabilityRegistry();

    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);

    const correlation = {
      requestId: `req_${id}`,
      correlationId: `corr_${id}`,
      invocationId: `inv_${id}`,
    };

    // Invoked as internal human-initiated workspace command under accepted Rule N1.
    // Conditions verified:
    // 1. Explicit user instruction: User submitted the task dialog in the UI.
    // 2. No cross-owner coordination: Self-contained workspace write.
    // 3. Outside any Mission: Ad-hoc workspace task, not part of a VAJRA mission plan.
    // 4. Permitted by capability permissions: allowInternal === true.
    // 5. Not HANDS or GENESIS: Target owner is AKIRA OS · workspace.
    const result = await registry.invoke<
      {
        title: string;
        description?: string;
        priority?: "Low" | "Medium" | "High";
        estimatedDuration?: number;
        dueDate?: string | null;
        projectId?: string | null;
      },
      { id: string }
    >(
      "task.create",
      input,
      correlation,
      { isInternal: true, isVajra: false },
    );

    if (!result.ok) {
      throw new Error(`Failed to create task via capability: ${result.error.message}`);
    }

    return result.value.id;
  });

export async function updateTaskViaCapability(
  id: string,
  patch: Partial<Task>,
): Promise<boolean> {
  const { getCapabilityRegistry } = await import("../../capabilities/host");
  const registry = getCapabilityRegistry();

  const corrId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);

  const correlation = {
    requestId: `req_${corrId}`,
    correlationId: `corr_${corrId}`,
    invocationId: `inv_${corrId}`,
  };

  // Invoked as internal human-initiated workspace command under accepted Rule N1.
  // Conditions verified:
  // 1. Explicit user instruction: User submitted the task edit dialog in the UI.
  // 2. No cross-owner coordination: Self-contained workspace write.
  // 3. Outside any Mission: Ad-hoc workspace task, not part of a VAJRA mission plan.
  // 4. Permitted by capability permissions: allowInternal === true.
  // 5. Not HANDS or GENESIS: Target owner is AKIRA OS · workspace.
  const result = await registry.invoke<
    { id: string; patch: Partial<Task> },
    { updated: boolean }
  >(
    "task.update",
    { id, patch },
    correlation,
    { isInternal: true, isVajra: false },
  );

  if (!result.ok) {
    throw new Error(`Failed to update task via capability: ${result.error.message}`);
  }

  return result.value.updated;
}

export const persistUpdateTask = createServerFn({ method: "POST" })
  .validator((input: { id: string; patch: Partial<Task> }) => input)
  .handler(async ({ data: { id, patch } }): Promise<void> => {
    await updateTaskViaCapability(id, patch);
  });


export const persistDeleteTask = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const { taskRepository } = await import("../../../persistence/repositories");
    taskRepository.delete(id);
  });

export const persistReorderTasks = createServerFn({ method: "POST" })
  .validator((ids: string[]) => ids)
  .handler(async ({ data: ids }) => {
    const { taskRepository } = await import("../../../persistence/repositories");
    taskRepository.setOrder(ids);
  });

export async function readTaskViaCapability(id: string): Promise<Task | null> {
  const { getCapabilityRegistry } = await import("../../capabilities/host");
  const registry = getCapabilityRegistry();

  const corrId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);

  const correlation = {
    requestId: `req_${corrId}`,
    correlationId: `corr_${corrId}`,
    invocationId: `inv_${corrId}`,
  };

  const result = await registry.invoke<{ id: string }, Task | null>(
    "task.read",
    { id },
    correlation,
    { isInternal: true, isVajra: false },
  );

  if (!result.ok) {
    throw new Error(`Failed to read task via capability: ${result.error.message}`);
  }

  return result.value;
}

export const persistGetTask = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }): Promise<Task | null> => {
    return readTaskViaCapability(id);
  });

export async function listTasksViaCapability(): Promise<Task[]> {
  const { getCapabilityRegistry } = await import("../../capabilities/host");
  const registry = getCapabilityRegistry();

  const corrId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);

  const correlation = {
    requestId: `req_${corrId}`,
    correlationId: `corr_${corrId}`,
    invocationId: `inv_${corrId}`,
  };

  const result = await registry.invoke<{}, Task[]>(
    "task.list",
    {},
    correlation,
    { isInternal: true, isVajra: false },
  );

  if (!result.ok) {
    throw new Error(`Failed to list tasks via capability: ${result.error.message}`);
  }

  return result.value;
}

export const persistListTasks = createServerFn({ method: "GET" })
  .handler(async (): Promise<Task[]> => {
    return listTasksViaCapability();
  });



