import type { Task } from "../../../shared/types/store-types";
import {
  persistAddTask,
  persistUpdateTask,
  persistDeleteTask,
  persistReorderTasks,
  persistGetTask,
  persistListTasks,
} from "../server";

export const tasksService = {
  async list(): Promise<Task[]> {
    if (typeof window === "undefined") {
      const { listTasksViaCapability } = await import("../server");
      return listTasksViaCapability();
    }
    return persistListTasks();
  },
  async getById(id: string): Promise<Task | null> {
    if (typeof window === "undefined") {
      const { readTaskViaCapability } = await import("../server");
      return readTaskViaCapability(id);
    }
    return persistGetTask({ data: id });
  },
  async add(input: {
    title: string;
    description?: string;
    priority?: "Low" | "Medium" | "High";
    estimatedDuration?: number;
    dueDate?: string | null;
    projectId?: string | null;
  }): Promise<string> {
    return persistAddTask({ data: input });
  },
  async update(id: string, patch: Partial<Task>): Promise<void> {
    if (typeof window === "undefined") {
      const { updateTaskViaCapability } = await import("../server");
      await updateTaskViaCapability(id, patch);
      return;
    }
    await persistUpdateTask({ data: { id, patch } });
  },

  async delete(id: string): Promise<void> {
    await persistDeleteTask({ data: id });
  },
  async reorder(ids: string[]): Promise<void> {
    await persistReorderTasks({ data: ids });
  },
};
