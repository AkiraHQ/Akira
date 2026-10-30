import { CorrelationMetadata } from "../results/result";

/**
 * Declarative operational constraints per Target Architecture §5.2 / Foundation Contracts K1 / K13.
 * Represents execution bounds (deadlines, step limits, confirmation gates, side-effect classes).
 *
 * MUST NOT act as an authorization or policy engine.
 */
export interface MissionConstraint {
  readonly timeoutMs?: number;
  readonly deadline?: string; // ISO-8601 timestamp
  readonly maxSteps?: number;
  readonly confirmationRequired?: boolean;
  readonly sideEffectLimits?: readonly string[];
}

/**
 * Declarative completion criteria per Target Architecture §5.1 / §5.5 / Foundation Contracts K6 / K10.
 * Specifies what constitutes successful completion.
 *
 * MUST NOT contain executable verification functions. Verification belongs exclusively
 * to VAJRA evaluating recorded evidence (Decision D7, Contract K6).
 */
export interface CompletionCriteria {
  readonly description: string;
  readonly requiredEvidence: readonly string[];
  readonly expectedOutcomeSchema?: unknown;
}

/**
 * Declarative planned operational step per Target Architecture §6 / Foundation Contracts K10 / K19.
 * Represents an individual planned capability invocation.
 *
 * INVARIANTS:
 * - Workspace tasks are NOT mission steps (TA §6). A MissionStep is VAJRA's internal operational unit.
 * - MUST NOT contain DAG dependencies (dependsOn, predecessors, successors).
 * - MUST NOT contain execution status enums (Pending, InProgress, Blocked).
 * - MUST NOT contain retry counters, backoff policies, or execution callbacks.
 */
export interface MissionStep<TInput = unknown> {
  readonly id: string;
  readonly missionId: string;
  readonly stepOrder: number;
  readonly description: string;
  readonly targetCapability: string;
  readonly input: TInput;
  readonly expectedEvidence: string;
}

/**
 * Declarative Mission Definition per Target Architecture §5–§6 / Foundation Contracts K10 / K12 / K19.
 * Represents an operational unit of work through which AKIRA attempts to achieve an objective.
 *
 * INVARIANTS:
 * - Goal is OPTIONAL: a bounded request can become a Mission directly without a Goal (TA §6 DECISION).
 * - Project is NOT required: Missions do not mandate a workspace projectId (Open Decision O3).
 * - Transport/Turn agnostic: Does not require chat turn structures (Open Decision O7).
 */
export interface MissionDefinition {
  readonly id: string;
  readonly objective: string;
  readonly steps: readonly MissionStep[];
  readonly constraints: MissionConstraint;
  readonly completionCriteria: CompletionCriteria;
  readonly goalId?: string;
  readonly correlation: CorrelationMetadata & {
    readonly missionId: string;
    readonly goalId?: string;
  };
}

/**
 * Pure factory to construct a declarative MissionStep.
 */
export function createMissionStep<TInput = unknown>(opts: {
  id?: string;
  missionId: string;
  stepOrder: number;
  description: string;
  targetCapability: string;
  input: TInput;
  expectedEvidence: string;
}): MissionStep<TInput> {
  const id =
    opts.id ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36));

  return Object.freeze({
    id,
    missionId: opts.missionId,
    stepOrder: opts.stepOrder,
    description: opts.description,
    targetCapability: opts.targetCapability,
    input: opts.input,
    expectedEvidence: opts.expectedEvidence,
  });
}

/**
 * Pure factory to construct a declarative MissionDefinition.
 */
export function createMissionDefinition(opts: {
  id?: string;
  objective: string;
  steps: readonly MissionStep[];
  constraints?: MissionConstraint;
  completionCriteria: CompletionCriteria;
  goalId?: string;
  correlation: CorrelationMetadata;
}): MissionDefinition {
  const id =
    opts.id ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36));

  return Object.freeze({
    id,
    objective: opts.objective,
    steps: Object.freeze([...opts.steps]),
    constraints: Object.freeze({ ...(opts.constraints ?? {}) }),
    completionCriteria: Object.freeze({
      description: opts.completionCriteria.description,
      requiredEvidence: Object.freeze([...opts.completionCriteria.requiredEvidence]),
      expectedOutcomeSchema: opts.completionCriteria.expectedOutcomeSchema,
    }),
    goalId: opts.goalId,
    correlation: Object.freeze({
      ...opts.correlation,
      missionId: id,
      goalId: opts.goalId,
    }),
  });
}
