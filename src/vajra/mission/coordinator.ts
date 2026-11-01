import { ICoordinationDispatcher } from "../ports/coordination";
import { IAkiraOSPort } from "../boundaries/akira-os-port";
import { MissionStep } from "../../contracts/mission/mission-definition";
import { Result, CorrelationMetadata, CapabilityFailure } from "../../contracts/results/result";

/**
 * Coordination Dispatcher mediating capability resolution and execution
 * through the canonical IAkiraOSPort boundary.
 *
 * Invariants:
 * - Direct shell execution, child processes, or filesystem writes are strictly prohibited.
 * - All invocations pass through IAkiraOSPort, which enforces caller context { isVajra: true }.
 * - CorrelationMetadata (Contract K19) is strictly propagated.
 */
export class CoordinationDispatcher implements ICoordinationDispatcher {
  constructor(private readonly akiraOSPort: IAkiraOSPort) {}

  async dispatchStep<TInput = unknown, TOutput = unknown>(
    step: MissionStep<TInput>,
    correlation: CorrelationMetadata,
    options?: { idempotencyKey?: string },
  ): Promise<Result<TOutput, CapabilityFailure>> {
    const stepCorrelation: CorrelationMetadata = {
      ...correlation,
      invocationId: step.id,
    };

    return this.akiraOSPort.executeCapability<TInput, TOutput>(
      step.targetCapability,
      step.input,
      stepCorrelation,
      { isVajra: true, idempotencyKey: options?.idempotencyKey },
    );
  }
}
