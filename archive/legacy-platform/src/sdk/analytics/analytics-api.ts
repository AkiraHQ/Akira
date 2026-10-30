import { SDKContext } from "../core/sdk-context";
import { PermissionRequiredError } from "../core/sdk-errors";

/**
 * Analytics API – thin wrapper around runtime AnalyticsService.
 */
export class AnalyticsAPI {
  constructor(private readonly context: SDKContext) {}

  async track(eventName: string, payload?: any): Promise<void> {
    this.context.permissions.require("analytics.track");
    try {
      await (this.context.analytics as any).track(eventName, payload);
    } catch (e) {
      throw new PermissionRequiredError("analytics.track");
    }
  }
}
