import { RuntimeAdapter } from "../interfaces/runtime-adapter";

/**
 * TimelineAdapter – thin wrapper delegating to runtime timeline service.
 */
export class TimelineAdapter {
  constructor(private readonly runtimeAdapter: RuntimeAdapter) {}

  async append(event: any): Promise<void> {
    await (this.runtimeAdapter.timeline as any).append(event);
  }

  async query(...args: any[]): Promise<any> {
    return await (this.runtimeAdapter.timeline as any).query(...args);
  }
}
