import { RuntimeAdapter } from "../interfaces/runtime-adapter";

/**
 * StorageAdapter – thin wrapper delegating to runtime storage service.
 */
export class StorageAdapter {
  constructor(private readonly runtimeAdapter: RuntimeAdapter) {}

  async get(key: string): Promise<any> {
    return await (this.runtimeAdapter.storage as any).get(key);
  }

  async set(key: string, value: any): Promise<void> {
    await (this.runtimeAdapter.storage as any).set(key, value);
  }

  async delete(key: string): Promise<void> {
    await (this.runtimeAdapter.storage as any).delete(key);
  }
}
