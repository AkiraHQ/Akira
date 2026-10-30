import { SDKContext } from "../core/sdk-context";
import { PermissionRequiredError } from "../core/sdk-errors";

/**
 * Workspace API – thin wrapper around the runtime WorkspaceService.
 */
export class WorkspaceAPI {
  constructor(private readonly context: SDKContext) {}

  /** Read operation */
  async read(...args: any[]): Promise<any> {
    this.context.permissions.require("workspace.read");
    try {
      return await (this.context.workspace as any).read(...args);
    } catch (e) {
      throw new PermissionRequiredError("workspace.read");
    }
  }

  /** Write operation */
  async write(...args: any[]): Promise<any> {
    this.context.permissions.require("workspace.write");
    try {
      return await (this.context.workspace as any).write(...args);
    } catch (e) {
      throw new PermissionRequiredError("workspace.write");
    }
  }
}
