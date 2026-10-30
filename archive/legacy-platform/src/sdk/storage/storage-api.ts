import { SDKContext } from "../core/sdk-context";
import { PermissionRequiredError } from "../core/sdk-errors";

/**
 * Storage API – thin wrapper over runtime StorageService.
 */
export class StorageAPI {
  constructor(private readonly context: SDKContext) {}

  async get(key: string): Promise<any> {
    this.context.permissions.require("storage.read");
    try {
      return await (this.context.storage as any).get(key);
    } catch (e) {
      throw new PermissionRequiredError("storage.read");
    }
  }

  async set(key: string, value: any): Promise<void> {
    this.context.permissions.require("storage.write");
    try {
      await (this.context.storage as any).set(key, value);
    } catch (e) {
      throw new PermissionRequiredError("storage.write");
    }
  }

  async delete(key: string): Promise<void> {
    this.context.permissions.require("storage.delete");
    try {
      await (this.context.storage as any).delete(key);
    } catch (e) {
      throw new PermissionRequiredError("storage.delete");
    }
  }
}
