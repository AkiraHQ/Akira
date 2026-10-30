/**
 * CompatibilityContext holds the active RuntimeAdapter and metadata.
 */
export class CompatibilityContext {
  constructor(public readonly runtimeAdapter: RuntimeAdapter) {}
}

// Import the interface (relative path)
import { RuntimeAdapter } from "../interfaces/runtime-adapter";
