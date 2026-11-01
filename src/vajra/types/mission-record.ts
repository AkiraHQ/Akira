import { MissionDefinition } from "../../contracts/mission/mission-definition";
import { MissionState } from "../../contracts/mission/mission-state";

/**
 * Lifecycle states of an operational mission managed by VAJRA.
 */
export type MissionLifecycleState =
  | "CREATED"
  | "RUNNING"
  | "PAUSED_APPROVAL"
  | "PAUSED_RECOVERY"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

/**
 * Dispatch and execution states of a discrete mission step.
 */
export type StepDispatchState =
  "PENDING" | "DISPATCHED" | "EXECUTED" | "VERIFIED" | "FAILED" | "SKIPPED";

/**
 * Durable classification assigned to an interrupted mission step during recovery (Phase 8B Part 1).
 */
export type StepRecoveryClassification =
  | "VERIFIED_NEVER_STARTED" // Proven never started; safe to dispatch upon authorized resume
  | "REPLAY_PERMITTED" // Outcome unknown, but 4 replay predicates strictly satisfied
  | "BLOCKED_UNRESOLVED"; // Outcome unknown and replay disallowed or side-effects uncertain

/**
 * Explicit budget allocation granted to a mission.
 */
export interface AllocatedBudget {
  readonly maxCostCents: number;
  readonly maxSteps: number;
  readonly maxDurationMs?: number;
}

/**
 * Durable record of an operational mission in VAJRA.
 */
export interface VajraMissionRecord {
  readonly id: string;
  readonly objective: string;
  readonly lifecycleState: MissionLifecycleState;
  readonly definition: MissionDefinition;
  readonly state: MissionState;
  readonly currentStepOrder: number;
  readonly allocatedBudget: AllocatedBudget;
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly invocationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string | null;
}

/**
 * Durable record of an individual capability dispatch step in a mission.
 */
export interface VajraStepRecord<TInput = unknown> {
  readonly id: string;
  readonly missionId: string;
  readonly stepOrder: number;
  readonly description: string;
  readonly targetCapability: string;
  readonly input: TInput;
  readonly expectedEvidence: string;
  readonly dispatchState: StepDispatchState;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly executionResultId?: string | null;
  readonly executionError?: unknown | null;
  readonly dispatchedAt?: string | null;
  readonly executedAt?: string | null;
  readonly verifiedAt?: string | null;
  readonly evidenceHash?: string | null;
  readonly recoveryClassification?: StepRecoveryClassification | null;
}

/**
 * Pure factory helper to construct a validated, immutable VajraMissionRecord.
 */
export function createVajraMissionRecord(opts: {
  id: string;
  objective: string;
  lifecycleState?: MissionLifecycleState;
  definition: MissionDefinition;
  state: MissionState;
  currentStepOrder?: number;
  allocatedBudget: AllocatedBudget;
  idempotencyKey: string;
  requestId: string;
  correlationId: string;
  invocationId: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
}): VajraMissionRecord {
  const now = new Date().toISOString();
  return Object.freeze({
    id: opts.id,
    objective: opts.objective,
    lifecycleState: opts.lifecycleState ?? "CREATED",
    definition: Object.freeze({ ...opts.definition }),
    state: Object.freeze({ ...opts.state }),
    currentStepOrder: opts.currentStepOrder ?? 0,
    allocatedBudget: Object.freeze({ ...opts.allocatedBudget }),
    idempotencyKey: opts.idempotencyKey,
    requestId: opts.requestId,
    correlationId: opts.correlationId,
    invocationId: opts.invocationId,
    createdAt: opts.createdAt ?? now,
    updatedAt: opts.updatedAt ?? now,
    completedAt: opts.completedAt ?? null,
  });
}

/**
 * Pure factory helper to construct a validated, immutable VajraStepRecord.
 */
export function createVajraStepRecord<TInput = unknown>(opts: {
  id: string;
  missionId: string;
  stepOrder: number;
  description: string;
  targetCapability: string;
  input: TInput;
  expectedEvidence: string;
  dispatchState?: StepDispatchState;
  idempotencyKey: string;
  correlationId: string;
  executionResultId?: string | null;
  executionError?: unknown | null;
  dispatchedAt?: string | null;
  executedAt?: string | null;
  verifiedAt?: string | null;
  evidenceHash?: string | null;
  recoveryClassification?: StepRecoveryClassification | null;
}): VajraStepRecord<TInput> {
  return Object.freeze({
    id: opts.id,
    missionId: opts.missionId,
    stepOrder: opts.stepOrder,
    description: opts.description,
    targetCapability: opts.targetCapability,
    input: opts.input,
    expectedEvidence: opts.expectedEvidence,
    dispatchState: opts.dispatchState ?? "PENDING",
    idempotencyKey: opts.idempotencyKey,
    correlationId: opts.correlationId,
    executionResultId: opts.executionResultId ?? null,
    executionError: opts.executionError ?? null,
    dispatchedAt: opts.dispatchedAt ?? null,
    executedAt: opts.executedAt ?? null,
    verifiedAt: opts.verifiedAt ?? null,
    evidenceHash: opts.evidenceHash ?? null,
    recoveryClassification: opts.recoveryClassification ?? null,
  });
}
