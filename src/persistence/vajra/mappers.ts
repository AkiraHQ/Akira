import { z } from "zod";
import {
  OperationalContext,
  OperationalMode,
  HumanPresence,
  SystemHealthStatus,
} from "../../vajra/types/operational-context";
import { EpistemicBelief, VerificationState, createBelief } from "../../vajra/types/belief";
import { DeliberationTrace, createDeliberationTrace } from "../../vajra/types/trace";
import {
  VajraMissionRecord,
  VajraStepRecord,
  MissionLifecycleState,
  StepDispatchState,
  createVajraMissionRecord,
  createVajraStepRecord,
} from "../../vajra/types/mission-record";
import {
  VajraEscalationRecord,
  EscalationStatus,
  createVajraEscalationRecord,
} from "../../vajra/types/escalation-record";
import {
  VajraVerificationRecord,
  VerificationOutcome,
  createVajraVerificationRecord,
} from "../../vajra/types/verification-record";
import { ProvenanceRecord, ProvenanceStage } from "../../vajra/types/provenance";
import { ImpactClass } from "../../vajra/types/policy";

// ============================================================================
// Raw SQLite Row Types
// ============================================================================

export interface OperationalStateRow {
  id: string;
  current_focus: string;
  operational_mode: string;
  active_mission_id: string | null;
  human_presence: string;
  system_health_status: string;
  version: number;
  updated_at: string;
}

export interface MissionRow {
  id: string;
  objective: string;
  lifecycle_state: string;
  definition_json: string;
  state_json: string;
  current_step_order: number;
  allocated_budget_json: string;
  idempotency_key: string;
  request_id: string;
  correlation_id: string;
  invocation_id: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface MissionStepRow {
  id: string;
  mission_id: string;
  step_order: number;
  description: string;
  target_capability: string;
  input_json: string;
  expected_evidence: string;
  dispatch_state: string;
  idempotency_key: string;
  correlation_id: string;
  execution_result_id: string | null;
  execution_error_json: string | null;
  dispatched_at: string | null;
  executed_at: string | null;
  verified_at: string | null;
  evidence_hash?: string | null;
  recovery_classification?: string | null;
}

export interface BeliefRow {
  id: string;
  proposition: string;
  confidence: number;
  verification_state: string;
  supporting_evidence_ids_json: string;
  contradicting_evidence_ids_json: string;
  last_evaluated_at: string;
  ttl_ms: number | null;
  created_at: string;
}

export interface EscalationRow {
  id: string;
  mission_id: string | null;
  step_id: string | null;
  status: string;
  action_proposed: string;
  impact_class: string;
  risk_explanation: string;
  resolution_comment: string | null;
  request_id: string;
  correlation_id: string;
  created_at: string;
  resolved_at: string | null;
}

export interface DeliberationTraceRow {
  trace_id: string;
  stimulus_id: string;
  request_id: string;
  correlation_id: string;
  invocation_id: string;
  causation_id: string | null;
  intent_class: string;
  selected_option: string;
  rationale: string;
  considered_options_json: string;
  evidence_relied_upon_json: string;
  escalation_required: number;
  created_at: string;
}

export interface VerificationRow {
  id: string;
  mission_id: string;
  step_id: string;
  outcome: string;
  evidence_ids_json: string;
  evaluator_notes: string | null;
  correlation_id: string;
  invocation_id: string;
  recorded_at: string;
}

export interface ProvenanceRow {
  stage: string;
  id: string;
  description: string;
  timestamp: string;
}

// ============================================================================
// Zod Validation Schemas
// ============================================================================

export const OperationalContextSchema = z.object({
  currentFocus: z.string(),
  mode: z.enum(["REQUEST_DRIVEN", "PROACTIVE_MONITOR", "RECOVERY", "PAUSED"]),
  activeMissionId: z.string().nullable(),
  humanPresence: z.enum(["FOCUSED_ACTIVE", "IDLE", "AWAY"]),
  systemHealthStatus: z.enum(["NOMINAL", "DEGRADED", "CRITICAL"]),
  version: z.number().int().min(1),
  updatedAt: z.string(),
});

export const AllocatedBudgetSchema = z.object({
  maxCostCents: z.number().nonnegative(),
  maxSteps: z.number().int().positive(),
  maxDurationMs: z.number().positive().optional(),
});

export const StringArraySchema = z.array(z.string());

// ============================================================================
// Operational Context Mappers
// ============================================================================

export function mapRowToOperationalContext(row: OperationalStateRow): OperationalContext {
  const parsed = OperationalContextSchema.parse({
    currentFocus: row.current_focus,
    mode: row.operational_mode as OperationalMode,
    activeMissionId: row.active_mission_id,
    humanPresence: row.human_presence as HumanPresence,
    systemHealthStatus: row.system_health_status as SystemHealthStatus,
    version: row.version,
    updatedAt: row.updated_at,
  });

  return Object.freeze(parsed);
}

export function mapOperationalContextToRow(ctx: OperationalContext): OperationalStateRow {
  return {
    id: "singleton",
    current_focus: ctx.currentFocus,
    operational_mode: ctx.mode,
    active_mission_id: ctx.activeMissionId,
    human_presence: ctx.humanPresence,
    system_health_status: ctx.systemHealthStatus,
    version: ctx.version,
    updated_at: ctx.updatedAt,
  };
}

// ============================================================================
// Missions Mappers
// ============================================================================

export function mapRowToMission(row: MissionRow): VajraMissionRecord {
  const definition = JSON.parse(row.definition_json);
  const state = JSON.parse(row.state_json);
  const allocatedBudget = AllocatedBudgetSchema.parse(JSON.parse(row.allocated_budget_json));

  return createVajraMissionRecord({
    id: row.id,
    objective: row.objective,
    lifecycleState: row.lifecycle_state as MissionLifecycleState,
    definition,
    state,
    currentStepOrder: row.current_step_order,
    allocatedBudget,
    idempotencyKey: row.idempotency_key,
    requestId: row.request_id,
    correlationId: row.correlation_id,
    invocationId: row.invocation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  });
}

export function mapMissionToRow(mission: VajraMissionRecord): MissionRow {
  return {
    id: mission.id,
    objective: mission.objective,
    lifecycle_state: mission.lifecycleState,
    definition_json: JSON.stringify(mission.definition),
    state_json: JSON.stringify(mission.state),
    current_step_order: mission.currentStepOrder,
    allocated_budget_json: JSON.stringify(mission.allocatedBudget),
    idempotency_key: mission.idempotencyKey,
    request_id: mission.requestId,
    correlation_id: mission.correlationId,
    invocation_id: mission.invocationId,
    created_at: mission.createdAt,
    updated_at: mission.updatedAt,
    completed_at: mission.completedAt ?? null,
  };
}

// ============================================================================
// Mission Steps Mappers
// ============================================================================

export function mapRowToStep(row: MissionStepRow): VajraStepRecord {
  const input = JSON.parse(row.input_json);
  const executionError = row.execution_error_json ? JSON.parse(row.execution_error_json) : null;

  return createVajraStepRecord({
    id: row.id,
    missionId: row.mission_id,
    stepOrder: row.step_order,
    description: row.description,
    targetCapability: row.target_capability,
    input,
    expectedEvidence: row.expected_evidence,
    dispatchState: row.dispatch_state as StepDispatchState,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    executionResultId: row.execution_result_id,
    executionError,
    dispatchedAt: row.dispatched_at,
    executedAt: row.executed_at,
    verifiedAt: row.verified_at,
    evidenceHash: row.evidence_hash ?? null,
    recoveryClassification: (row.recovery_classification as any) ?? null,
  });
}

export function mapStepToRow(step: VajraStepRecord): MissionStepRow {
  return {
    id: step.id,
    mission_id: step.missionId,
    step_order: step.stepOrder,
    description: step.description,
    target_capability: step.targetCapability,
    input_json: JSON.stringify(step.input),
    expected_evidence: step.expectedEvidence,
    dispatch_state: step.dispatchState,
    idempotency_key: step.idempotencyKey,
    correlation_id: step.correlationId,
    execution_result_id: step.executionResultId ?? null,
    execution_error_json: step.executionError ? JSON.stringify(step.executionError) : null,
    dispatched_at: step.dispatchedAt ?? null,
    executed_at: step.executedAt ?? null,
    verified_at: step.verifiedAt ?? null,
    evidence_hash: step.evidenceHash ?? null,
    recovery_classification: step.recoveryClassification ?? null,
  };
}

// ============================================================================
// Epistemic Beliefs Mappers
// ============================================================================

export function mapRowToBelief(row: BeliefRow): EpistemicBelief {
  const supporting = StringArraySchema.parse(JSON.parse(row.supporting_evidence_ids_json));
  const contradicting = StringArraySchema.parse(JSON.parse(row.contradicting_evidence_ids_json));

  return createBelief({
    id: row.id,
    proposition: row.proposition,
    confidence: row.confidence,
    verificationState: row.verification_state as VerificationState,
    supportingEvidenceIds: supporting,
    contradictingEvidenceIds: contradicting,
    lastEvaluatedAt: row.last_evaluated_at,
    ttlMs: row.ttl_ms ?? undefined,
  });
}

export function mapBeliefToRow(belief: EpistemicBelief): BeliefRow {
  return {
    id: belief.id,
    proposition: belief.proposition,
    confidence: belief.confidence,
    verification_state: belief.verificationState,
    supporting_evidence_ids_json: JSON.stringify(belief.supportingEvidenceIds),
    contradicting_evidence_ids_json: JSON.stringify(belief.contradictingEvidenceIds),
    last_evaluated_at: belief.lastEvaluatedAt,
    ttl_ms: belief.ttlMs ?? null,
    created_at: belief.lastEvaluatedAt,
  };
}

// ============================================================================
// Escalations Mappers
// ============================================================================

export function mapRowToEscalation(row: EscalationRow): VajraEscalationRecord {
  return createVajraEscalationRecord({
    id: row.id,
    missionId: row.mission_id,
    stepId: row.step_id,
    status: row.status as EscalationStatus,
    actionProposed: row.action_proposed,
    impactClass: row.impact_class as ImpactClass,
    riskExplanation: row.risk_explanation,
    resolutionComment: row.resolution_comment,
    requestId: row.request_id,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  });
}

export function mapEscalationToRow(esc: VajraEscalationRecord): EscalationRow {
  return {
    id: esc.id,
    mission_id: esc.missionId ?? null,
    step_id: esc.stepId ?? null,
    status: esc.status,
    action_proposed: esc.actionProposed,
    impact_class: esc.impactClass,
    risk_explanation: esc.riskExplanation,
    resolution_comment: esc.resolutionComment ?? null,
    request_id: esc.requestId,
    correlation_id: esc.correlationId,
    created_at: esc.createdAt,
    resolved_at: esc.resolvedAt ?? null,
  };
}

// ============================================================================
// Deliberation Traces Mappers
// ============================================================================

export function mapRowToTrace(row: DeliberationTraceRow): DeliberationTrace {
  const consideredOptions = JSON.parse(row.considered_options_json);
  const evidenceReliedUpon = StringArraySchema.parse(JSON.parse(row.evidence_relied_upon_json));

  return createDeliberationTrace({
    traceId: row.trace_id,
    stimulusId: row.stimulus_id,
    correlation: {
      requestId: row.request_id,
      correlationId: row.correlation_id,
      invocationId: row.invocation_id,
      causationId: row.causation_id ?? undefined,
    },
    intentClass: row.intent_class,
    consideredOptions,
    selectedOption: row.selected_option,
    rationale: row.rationale,
    evidenceReliedUpon,
    escalationRequired: row.escalation_required === 1,
    timestamp: row.created_at,
  });
}

export function mapTraceToRow(trace: DeliberationTrace): DeliberationTraceRow {
  return {
    trace_id: trace.traceId,
    stimulus_id: trace.stimulusId,
    request_id: trace.correlation.requestId,
    correlation_id: trace.correlation.correlationId,
    invocation_id: trace.correlation.invocationId,
    causation_id: trace.correlation.causationId ?? null,
    intent_class: trace.intentClass,
    selected_option: trace.selectedOption,
    rationale: trace.rationale,
    considered_options_json: JSON.stringify(trace.consideredOptions),
    evidence_relied_upon_json: JSON.stringify(trace.evidenceReliedUpon),
    escalation_required: trace.escalationRequired ? 1 : 0,
    created_at: trace.timestamp,
  };
}

// ============================================================================
// Verification Records Mappers
// ============================================================================

export function mapRowToVerification(row: VerificationRow): VajraVerificationRecord {
  const evidenceIds = StringArraySchema.parse(JSON.parse(row.evidence_ids_json));

  return createVajraVerificationRecord({
    id: row.id,
    missionId: row.mission_id,
    stepId: row.step_id,
    outcome: row.outcome as VerificationOutcome,
    evidenceIds,
    evaluatorNotes: row.evaluator_notes,
    correlationId: row.correlation_id,
    invocationId: row.invocation_id,
    recordedAt: row.recorded_at,
  });
}

export function mapVerificationToRow(ver: VajraVerificationRecord): VerificationRow {
  return {
    id: ver.id,
    mission_id: ver.missionId,
    step_id: ver.stepId,
    outcome: ver.outcome,
    evidence_ids_json: JSON.stringify(ver.evidenceIds),
    evaluator_notes: ver.evaluatorNotes ?? null,
    correlation_id: ver.correlationId,
    invocation_id: ver.invocationId,
    recorded_at: ver.recordedAt,
  };
}

// ============================================================================
// Provenance Mappers
// ============================================================================

export function mapRowToProvenance(row: ProvenanceRow): ProvenanceRecord {
  return Object.freeze({
    stage: row.stage as ProvenanceStage,
    id: row.id,
    description: row.description,
    timestamp: row.timestamp,
  });
}
