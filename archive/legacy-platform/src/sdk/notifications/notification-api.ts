import { SDKContext } from "../core/sdk-context";
import { PermissionRequiredError } from "../core/sdk-errors";

/**
 * Notification API – thin wrapper over runtime NotificationService.
 */
export class NotificationAPI {
  constructor(private readonly context: SDKContext) {}

  async send(...args: any[]): Promise<any> {
    this.context.permissions.require("notifications.send");
    try {
      return await (this.context.notifications as any).send(...args);
    } catch (e) {
      throw new PermissionRequiredError("notifications.send");
    }
  }
}
