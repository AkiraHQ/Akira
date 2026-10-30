import { SDKContext } from "../core/sdk-context";
import { PermissionRequiredError } from "../core/sdk-errors";

/**
 * Search API – thin wrapper over runtime SearchService.
 */
export class SearchAPI {
  constructor(private readonly context: SDKContext) {}

  async query(...args: any[]): Promise<any> {
    this.context.permissions.require("search.query");
    try {
      return await (this.context.search as any).query(...args);
    } catch (e) {
      throw new PermissionRequiredError("search.query");
    }
  }
}
