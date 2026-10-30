import { SDKContext } from "../core/sdk-context";
import { PermissionRequiredError } from "../core/sdk-errors";

/**
 * Permission API – thin wrapper exposing the permission manager.
 * This class is not intended for direct use by modules; the SDK internally
 * invokes `context.permissions.require` before delegating to services.
 */
export class PermissionAPI {
  constructor(private readonly context: SDKContext) {}

  require(permission: string): void {
    try {
      this.context.permissions.require(permission);
    } catch (e) {
      throw new PermissionRequiredError(permission);
    }
  }
}
