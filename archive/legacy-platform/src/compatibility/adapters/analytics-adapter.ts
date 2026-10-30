import { RuntimeAdapter } from "../interfaces/runtime-adapter";

/**
 * AnalyticsAdapter – thin wrapper delegating to runtime analytics service.
 */
export class AnalyticsAdapter {
  constructor(private readonly runtimeAdapter: RuntimeAdapter) {}

  async track(eventName: string, payload?: any): Promise<void> {
    await (this.runtimeAdapter.analytics as any).track(eventName, payload);
  }
}
