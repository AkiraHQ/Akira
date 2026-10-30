import { RuntimeAdapter } from "../interfaces/runtime-adapter";

/**
 * WorkspaceAdapter – thin wrapper delegating to the runtime's workspace implementation.
 * No permission checks; those remain in the SDK.
 */
export class WorkspaceAdapter {
  constructor(private readonly runtimeAdapter: RuntimeAdapter) {}

  async read(...args: any[]): Promise<any> {
    return await (this.runtimeAdapter.workspace as any).read(...args);
  }

  async write(...args: any[]): Promise<any> {
    return await (this.runtimeAdapter.workspace as any).write(...args);
  }
}
