import { SDKContext } from "../core/sdk-context";
import { PermissionRequiredError } from "../core/sdk-errors";

/**
 * Timeline API – thin wrapper around runtime TimelineService.
 */
export class TimelineAPI {
  constructor(private readonly context: SDKContext) {}

  async append(event: any): Promise<void> {
    this.context.permissions.require("timeline.append");
    try {
      await (this.context.timeline as any).append(event);
    } catch (e) {
      throw new PermissionRequiredError("timeline.append");
    }
  }

  async query(...args: any[]): Promise<any> {
    this.context.permissions.require("timeline.query");
    try {
      return await (this.context.timeline as any).query(...args);
    } catch (e) {
      throw new PermissionRequiredError("timeline.query");
    }
  }
}
