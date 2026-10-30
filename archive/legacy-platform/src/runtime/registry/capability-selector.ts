import { Capability } from "./capability";

export interface CapabilitySelector {
  select(capabilities: Capability[]): Capability | null;
}

export class PrioritySelector implements CapabilitySelector {
  /**
   * Selects the capability with the highest priority score.
   * Resolves ties deterministically using provider module IDs alphabetically.
   */
  public select(capabilities: Capability[]): Capability | null {
    if (capabilities.length === 0) return null;

    const sorted = [...capabilities].sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.providerModule.localeCompare(b.providerModule);
    });

    return sorted[0];
  }
}
