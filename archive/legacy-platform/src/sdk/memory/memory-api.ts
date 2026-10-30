import { SDKContext } from "../core/sdk-context";
import { PermissionRequiredError } from "../core/sdk-errors";

/**
 * Memory API – thin wrapper around runtime MemoryService.
 */
export class MemoryAPI {
  constructor(private readonly context: SDKContext) {}

  async read(key: string): Promise<any> {
    this.context.permissions.require("memory.read");
    try {
      return await (this.context.memory as any).read(key);
    } catch (e) {
      throw new PermissionRequiredError("memory.read");
    }
  }

  async write(key: string, value: any): Promise<void> {
    this.context.permissions.require("memory.write");
    try {
      await (this.context.memory as any).write(key, value);
    } catch (e) {
      throw new PermissionRequiredError("memory.write");
    }
  }
}
