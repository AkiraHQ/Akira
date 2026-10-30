import { Observation } from "../../contracts/events/observation";

/**
 * Filter criteria for querying the in-memory observation pool.
 */
export interface ObservationFilter {
  readonly missionId?: string;
  readonly stepId?: string;
  readonly producer?: string;
  readonly subject?: string;
  readonly minObservationTime?: string;
  readonly maxObservationTime?: string;
  readonly includeRecommendations?: boolean;
}

/**
 * Input arguments for normalizing an execution result into an Observation.
 */
export interface NormalizeExecutionOptions<T = unknown> {
  readonly stepId: string;
  readonly missionId: string;
  readonly targetCapability: string;
  readonly executionResultId: string;
  readonly payload: T;
  readonly correlation: {
    readonly requestId: string;
    readonly correlationId: string;
    readonly causationId?: string;
    readonly invocationId: string;
    readonly executionId?: string;
    readonly missionId?: string;
    readonly stepId?: string;
    readonly [key: string]: unknown;
  };
  /** Explicit producer-supplied confidence score in [0.0, 1.0], if provided */
  readonly producerConfidence?: number;
  /** Human-readable explanation of how the evidence was derived */
  readonly provenance?: string;
  /** Optional recommendation flag */
  readonly isRecommendation?: boolean;
}

/**
 * Inspection statistics of the active observation receiver pool.
 */
export interface ObservationPoolStats {
  readonly totalObservations: number;
  readonly totalMissionsTracked: number;
  readonly totalStepsTracked: number;
}
