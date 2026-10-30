import { Result, CorrelationMetadata } from "../../contracts/results/result";

/**
 * Forward port interface for HANDS execution engine.
 *
 * INVARIANTS:
 * - VAJRA never controls HANDS directly or bypasses OS isolation.
 * - In Phase 2, HANDS is not implemented.
 */
export interface IHandsPort {
  isAvailable(): boolean;

  executeSandbox<T = unknown>(
    command: string,
    args: readonly string[],
    correlation: CorrelationMetadata,
    timeoutMs?: number,
  ): Promise<Result<T, string>>;
}

/**
 * Stub adapter enforcing that HANDS cannot be called or directly controlled in Phase 2.
 */
export class StubHandsAdapter implements IHandsPort {
  isAvailable(): boolean {
    return false;
  }

  async executeSandbox<T = unknown>(
    _command: string,
    _args: readonly string[],
    correlation: CorrelationMetadata,
    _timeoutMs?: number,
  ): Promise<Result<T, string>> {
    return Result.failure(
      "HANDS execution engine is not active in Phase 2. Physical execution is disallowed.",
      correlation,
    );
  }
}
