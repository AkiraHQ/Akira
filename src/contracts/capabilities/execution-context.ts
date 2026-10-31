import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Execution Context tracked across capability execution boundaries.
 * Used to securely carry execution provenance (such as whether an invocation
 * originated from the authoritative VAJRA cognitive runtime) into downstream
 * domain services, repositories, and event publishers.
 */
export interface CapabilityExecutionContext {
  readonly isVajra: boolean;
  readonly invocationId?: string;
  readonly capabilityName?: string;
}

export const capabilityExecutionContext = new AsyncLocalStorage<CapabilityExecutionContext>();
