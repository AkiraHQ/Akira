import { RuntimeAdapter } from "../interfaces/runtime-adapter";

/**
 * NotificationAdapter – thin wrapper delegating to runtime notification service.
 */
export class NotificationAdapter {
  constructor(private readonly runtimeAdapter: RuntimeAdapter) {}

  async send(...args: any[]): Promise<any> {
    return await (this.runtimeAdapter.notifications as any).send(...args);
  }
}
