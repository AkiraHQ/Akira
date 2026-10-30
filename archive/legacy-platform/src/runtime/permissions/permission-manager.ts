// src/runtime/permissions/permission-manager.ts
import { PermissionCatalog } from "./permission-catalog";
import { PermissionNotFoundError } from "./permission-errors";
import { PermissionDescriptor } from "./permission";

/**
 * Minimal PermissionManager used by RuntimeManager.
 * It loads the static PermissionCatalog and provides a `require` method
 * that validates a permission identifier at runtime.
 *
 * This class satisfies the imports in `src/runtime/runtime-manager.ts`
 * and follows the project's simple‑first principle (no over‑engineering).
 */
export class PermissionManager {
  private readonly catalog: Map<string, PermissionDescriptor> = new Map();

  constructor() {
    for (const perm of PermissionCatalog) {
      this.catalog.set(perm.id, perm);
    }
  }

  /**
   * Check if a permission exists in the catalog.
   */
  public has(permissionId: string): boolean {
    return this.catalog.has(permissionId);
  }

  /**
   * Retrieve a permission descriptor or undefined if not present.
   */
  public get(permissionId: string): PermissionDescriptor | undefined {
    return this.catalog.get(permissionId);
  }

  /**
   * Ensure a permission exists; throws PermissionNotFoundError if missing.
   * Returns the PermissionDescriptor for further use.
   */
  public require(permissionId: string): PermissionDescriptor {
    const perm = this.catalog.get(permissionId);
    if (!perm) {
      throw new PermissionNotFoundError(permissionId);
    }
    return perm;
  }
}
