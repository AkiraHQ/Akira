import { Result, CorrelationMetadata, CapabilityFailure } from "../../contracts/results/result";
import { MissionStep } from "../../contracts/mission/mission-definition";

/**
 * Architectural Port for the Coordination Dispatcher (to be implemented in future phases).
 *
 * Translates planned steps into capability calls via the canonical CapabilityRegistry.
 */
export interface ICoordinationDispatcher {
  dispatchStep<TInput = unknown, TOutput = unknown>(
    step: MissionStep<TInput>,
    correlation: CorrelationMetadata,
    options?: { idempotencyKey?: string },
  ): Promise<Result<TOutput, CapabilityFailure>>;
}
