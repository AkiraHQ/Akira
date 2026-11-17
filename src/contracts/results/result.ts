/**
 * Failure Categories per Contract K18.
 */
export type FailureCategory =
  | "invalid_request" // Input schema validation failed
  | "capability_unavailable" // Capability is not registered or inactive
  | "command_rejection" // Permissions or authorization check failed
  | "execution_failure" // Subsystem handler execution failed (e.g. storage error)
  | "timeout"; // Constraint deadline passed

/**
 * Capability Failure Details per Contract K18.
 */
export interface CapabilityFailure {
  category: FailureCategory;
  message: string;
  details?: unknown;
}

/**
 * Correlation & Traceability Identifiers per Contract K19.
 */
export interface CorrelationMetadata {
  requestId: string;
  correlationId: string;
  invocationId: string;
  causationId?: string;
}

/**
 * Uniform Execution Result Envelope per Contract K5 / K7 / K18.
 */
export type Result<T, E = CapabilityFailure> =
  | { ok: true; value: T; correlation: CorrelationMetadata }
  | { ok: false; error: E; correlation: CorrelationMetadata };

/**
 * Result Helper Constructors.
 */
export const Result = {
  success<T>(value: T, correlation: CorrelationMetadata): Result<T, never> {
    return {
      ok: true,
      value,
      correlation,
    };
  },
  failure<E = CapabilityFailure>(error: E, correlation: CorrelationMetadata): Result<never, E> {
    return {
      ok: false,
      error,
      correlation,
    };
  },
};
