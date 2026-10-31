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
 * Production adapter explicitly enforcing that HANDS sandbox execution is unavailable.
 *
 * Invariants:
 * 1. isAvailable() returns false unconditionally.
 * 2. executeSandbox() returns a strict failure Result (never simulates execution, never produces success-shaped evidence).
 * 3. Physical side effects and child processes are disallowed.
 */
export class UnavailableHandsAdapter implements IHandsPort {
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
      "HANDS execution engine is not active in Phase 2 (unavailable in Phase 8A). Physical sandbox execution is disallowed; all actions must be mediated through AKIRA OS capabilities.",
      correlation,
    );
  }
}

/**
 * Backwards-compatible alias for UnavailableHandsAdapter.
 */
export class StubHandsAdapter extends UnavailableHandsAdapter {}
