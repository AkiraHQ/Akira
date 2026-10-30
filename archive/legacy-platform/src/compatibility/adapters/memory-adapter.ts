import { RuntimeAdapter } from "../interfaces/runtime-adapter";

/**
 * MemoryAdapter – thin wrapper delegating to runtime memory service.
 */
export class MemoryAdapter {
  constructor(private readonly runtimeAdapter: RuntimeAdapter) {}

  async read(key: string): Promise<any> {
    return await (this.runtimeAdapter.memory as any).read(key);
  }

  async write(key: string, value: any): Promise<void> {
    await (this.runtimeAdapter.memory as any).write(key, value);
  }
}
