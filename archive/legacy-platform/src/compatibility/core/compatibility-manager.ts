import { CompatibilityContext } from "./compatibility-context";
import { RuntimeAdapter } from "../interfaces/runtime-adapter";
import {
  CompatibilityError,
  MissingAdapterError,
  VersionMismatchError,
  UnsupportedRuntimeError,
} from "./compatibility-errors";
import { checkCompatibility } from "../validation/compatibility-checker";

/**
 * CompatibilityManager is responsible for:
 *  - Registering service adapters (if needed by future extensions).
 *  - Validating runtime compatibility.
 *  - Exposing a CompatibilityContext for the SDK.
 *
 * It does **not** contain any business logic; it only orchestrates wiring and validation.
 */
export class CompatibilityManager {
  private adapters: Map<string, any> = new Map();
  private _context: CompatibilityContext | null = null;

  /** Register a concrete adapter by name. */
  registerAdapter(name: string, adapter: any): void {
    if (!name || !adapter) {
      throw new CompatibilityError("Adapter name and instance must be provided");
    }
    this.adapters.set(name, adapter);
  }

  /** Retrieve a registered adapter. */
  getAdapter<T>(name: string): T {
    const adapter = this.adapters.get(name);
    if (!adapter) {
      throw new MissingAdapterError(name);
    }
    return adapter as T;
  }

  /** Remove an adapter registration. */
  removeAdapter(name: string): void {
    this.adapters.delete(name);
  }

  /** List all registered adapter names. */
  listAdapters(): string[] {
    return Array.from(this.adapters.keys());
  }

  /** Initialize the manager with a RuntimeAdapter supplied by the Runtime. */
  initialize(runtimeAdapter: RuntimeAdapter): void {
    // Ensure required adapters are present on the runtimeAdapter.
    const required = [
      "workspace",
      "storage",
      "timeline",
      "analytics",
      "memory",
      "search",
      "notifications",
      "events",
    ];
    for (const name of required) {
      if (!(runtimeAdapter as any)[name]) {
        throw new MissingAdapterError(name);
      }
    }

    // Perform version compatibility validation.
    try {
      checkCompatibility(runtimeAdapter.runtimeVersion);
    } catch (e) {
      if (e instanceof CompatibilityError) {
        throw e;
      }
      throw new VersionMismatchError(String(e));
    }

    // Store context for SDK consumption.
    this._context = new CompatibilityContext(runtimeAdapter);
  }

  /** Expose the CompatibilityContext after initialization. */
  get context(): CompatibilityContext {
    if (!this._context) {
      throw new CompatibilityError("CompatibilityManager not initialized");
    }
    return this._context;
  }
}
