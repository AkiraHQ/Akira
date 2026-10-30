export enum ModuleState {
  UNLOADED = "UNLOADED",
  LOADED = "LOADED",
  INITIALIZED = "INITIALIZED",
  RUNNING = "RUNNING",
  PAUSED = "PAUSED",
  STOPPED = "STOPPED",
  FAILED = "FAILED",
}

/**
 * Validates whether a state transition from `from` to `to` is permitted.
 * Lifecycle Rules:
 *   UNLOADED -> LOADED -> INITIALIZED -> RUNNING -> PAUSED -> RUNNING -> STOPPED -> UNLOADED
 *   If startup fails:
 *   INITIALIZED -> FAILED -> UNLOADED
 */
export function isValidTransition(from: ModuleState, to: ModuleState): boolean {
  const allowedTransitions: Record<ModuleState, ModuleState[]> = {
    [ModuleState.UNLOADED]: [ModuleState.LOADED],
    [ModuleState.LOADED]: [ModuleState.INITIALIZED],
    [ModuleState.INITIALIZED]: [ModuleState.RUNNING, ModuleState.FAILED],
    [ModuleState.RUNNING]: [ModuleState.PAUSED, ModuleState.STOPPED],
    [ModuleState.PAUSED]: [ModuleState.RUNNING, ModuleState.STOPPED],
    [ModuleState.STOPPED]: [ModuleState.UNLOADED],
    [ModuleState.FAILED]: [ModuleState.UNLOADED],
  };

  return allowedTransitions[from]?.includes(to) ?? false;
}
