import { SDKContext } from "../core/sdk-context";
import { PermissionRequiredError } from "../core/sdk-errors";

/**
 * Event API – thin wrapper around runtime EventBus.
 */
export class EventAPI {
  constructor(private readonly context: SDKContext) {}

  async publish(eventName: string, payload?: any): Promise<void> {
    this.context.permissions.require("events.publish");
    try {
      await (this.context.events as any).publish(eventName, payload);
    } catch (e) {
      throw new PermissionRequiredError("events.publish");
    }
  }

  async subscribe(eventName: string, handler: (...args: any[]) => void): Promise<any> {
    this.context.permissions.require("events.subscribe");
    try {
      return (this.context.events as any).subscribe(eventName, handler);
    } catch (e) {
      throw new PermissionRequiredError("events.subscribe");
    }
  }
}
