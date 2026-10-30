import { RuntimeAdapter } from "../interfaces/runtime-adapter";

/**
 * SearchAdapter – thin wrapper delegating to runtime search service.
 */
export class SearchAdapter {
  constructor(private readonly runtimeAdapter: RuntimeAdapter) {}

  async query(...args: any[]): Promise<any> {
    return await (this.runtimeAdapter.search as any).query(...args);
  }
}
