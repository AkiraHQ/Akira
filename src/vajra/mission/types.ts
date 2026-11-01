import { z } from "zod";
import { ExecutiveAction } from "../types/action";
import { CorrelationMetadata } from "../../contracts/results/result";
import { MissionDefinition, MissionStep } from "../../contracts/mission/mission-definition";
import type {
  MissionLifecycleState,
  StepDispatchState,
  StepRecoveryClassification,
} from "../types/mission-record";

export type { StepRecoveryClassification };

/**
 * Deterministic outcomes produced by the Mission Admission Gateway.
 */
export type MissionAdmissionOutcome =
  | {
      status: "ADMITTED";
      action: ExecutiveAction;
      correlation: CorrelationMetadata;
      idempotencyKey: string;
    }
  | { status: "PAUSED_APPROVAL"; escalationId: string; reason: string }
  | { status: "REJECTED"; reason: string }
  | { status: "STALE"; reason: string }
  | { status: "EXPIRED"; reason: string }
  | { status: "CAPABILITY_UNAVAILABLE"; missingCapability: string; reason: string }
  | { status: "CONCURRENCY_LOCKED"; activeMissionId: string; reason: string }
  | { status: "DUPLICATE_ADMISSION"; existingMissionId: string; reason: string }
  | { status: "HEALTH_DEGRADED"; reason: string };

/**
 * Zod schema for validating untrusted model planner proposals.
 * Blast door: Model proposals must conform strictly before any execution consideration.
 */
export const PlanProposalStepSchema = z.object({
  description: z.string().min(1, "Step description cannot be empty"),
  targetCapability: z.string().min(1, "Target capability cannot be empty"),
  input: z.unknown(),
  expectedEvidence: z.string().min(1, "Expected evidence cannot be empty"),
});

export type PlanProposalStep = z.infer<typeof PlanProposalStepSchema>;

export const PlanProposalSchema = z.object({
  objective: z.string().min(1, "Objective cannot be empty"),
  steps: z.array(PlanProposalStepSchema).min(1, "Plan must contain at least one step"),
});

export type PlanProposal = z.infer<typeof PlanProposalSchema>;

/**
 * Failure classifications for operational step execution.
 */
export type FailureClass =
  | "RECOVERABLE_TRANSIENT" // Transient connection hiccup or SQLite busy lock on pure read
  | "NON_RECOVERABLE_HARD" // Schema validation failure, command rejection, unknown capability
  | "REQUIRES_HUMAN_GATE"; // Non-idempotent failure, budget exhaustion, uncertain timeout

/**
 * The three distinct reality cases evaluated during boot crash recovery.
 */
export type RecoveryTriageCase =
  | "KNOWN_NOT_BEGUN" // Process died before external call initiated -> safe to dispatch normally
  | "STATE_UNCERTAIN" // Interrupted in-flight or timeout -> mandatory four-condition replay gate
  | "KNOWN_OCCURRED"; // Evidence present in environment -> reconcile to verification without re-dispatch

/**
 * Normalized evidence outcome states produced by an evidence probe (Phase 8B Part 1).
 */
export type EvidenceOutcomeStatus =
  | "VERIFIED_OCCURRED" // Verifiable proof external actuation completed
  | "VERIFIED_NEVER_STARTED" // Verifiable proof external actuation never initiated
  | "UNKNOWN"; // Outcome missing, timed out, ambiguous, unverified, or error

/**
 * Structured evidence evaluation result returned by ReplayEvidenceProbe.
 */
export interface EvidenceProbeResult {
  readonly status: EvidenceOutcomeStatus;
  readonly canonicalExecutionId?: string;
  readonly externalTimestamp?: string;
  readonly evidenceHash?: string;
  readonly reason?: string;
  readonly details?: unknown;
}

/**
 * Event emitted during mission runtime state progression.
 */
export interface MissionRuntimeEvent {
  readonly missionId: string;
  readonly type:
    | "MISSION_STARTED"
    | "STEP_PRE_DISPATCHED"
    | "STEP_EXECUTED"
    | "STEP_VERIFIED"
    | "STEP_FAILED"
    | "MISSION_PAUSED_APPROVAL"
    | "MISSION_PAUSED_RECOVERY"
    | "MISSION_COMPLETED"
    | "MISSION_FAILED"
    | "MISSION_CANCELLED";
  readonly stepOrder?: number;
  readonly stepId?: string;
  readonly timestamp: string;
  readonly payload?: unknown;
}
