import Database from "better-sqlite3";
import { getDatabaseConnection } from "../connection";
import { IOperationalStateStore, InterruptedRecoveryState } from "../../vajra/ports/state-store";
import {
  OperationalContext,
  createInitialOperationalContext,
} from "../../vajra/types/operational-context";
import { EpistemicBelief } from "../../vajra/types/belief";
import { DeliberationTrace } from "../../vajra/types/trace";
import {
  VajraMissionRecord,
  VajraStepRecord,
  MissionLifecycleState,
  StepRecoveryClassification,
} from "../../vajra/types/mission-record";
import { VajraEscalationRecord, EscalationStatus } from "../../vajra/types/escalation-record";
import { VajraVerificationRecord } from "../../vajra/types/verification-record";
import { ProvenanceRecord } from "../../vajra/types/provenance";
import {
  OperationalStateRow,
  MissionRow,
  MissionStepRow,
  BeliefRow,
  EscalationRow,
  DeliberationTraceRow,
  VerificationRow,
  ProvenanceRow,
  mapRowToOperationalContext,
  mapOperationalContextToRow,
  mapRowToMission,
  mapMissionToRow,
  mapRowToStep,
  mapStepToRow,
  mapRowToBelief,
  mapBeliefToRow,
  mapRowToEscalation,
  mapEscalationToRow,
  mapRowToTrace,
  mapTraceToRow,
  mapRowToVerification,
  mapVerificationToRow,
  mapRowToProvenance,
} from "./mappers";

/**
 * SQLite implementation of IOperationalStateStore.
 *
 * Implements durable operational state persistence, optimistic concurrency control,
 * two-phase dispatch, idempotency checking, and crash recovery detection.
 *
 * INVARIANT: Never wrap asynchronous capability invocation or network calls in SQLite transactions.
 */
export class SqliteOperationalStateStore implements IOperationalStateStore {
  private db: Database.Database;

  constructor(dbConnection?: Database.Database) {
    this.db = dbConnection ?? getDatabaseConnection();
    this.ensureSchemaCompatibility();
  }

  private ensureSchemaCompatibility(): void {
    try {
      const tableCheck = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vajra_mission_steps'")
        .get();
      if (tableCheck) {
        const columns = this.db.prepare("PRAGMA table_info(vajra_mission_steps)").all() as {
          name: string;
        }[];
        const colNames = new Set(columns.map((c) => c.name));
        if (!colNames.has("evidence_hash")) {
          this.db.exec("ALTER TABLE vajra_mission_steps ADD COLUMN evidence_hash TEXT;");
        }
        if (!colNames.has("recovery_classification")) {
          this.db.exec("ALTER TABLE vajra_mission_steps ADD COLUMN recovery_classification TEXT;");
          this.db.exec(
            "CREATE INDEX IF NOT EXISTS idx_vajra_steps_recovery_classification ON vajra_mission_steps (recovery_classification);",
          );
        }
      }
    } catch {
      // Invariant: Do not throw during constructor compatibility check if db is not ready
    }
  }

  // ==========================================================================
  // Operational Context (Singleton)
  // ==========================================================================

  async saveOperationalContext(ctx: OperationalContext): Promise<void> {
    const row = mapOperationalContextToRow(ctx);

    const updateStmt = this.db.prepare(`
      UPDATE vajra_operational_state
      SET current_focus = ?,
          operational_mode = ?,
          active_mission_id = ?,
          human_presence = ?,
          system_health_status = ?,
          version = version + 1,
          updated_at = ?
      WHERE id = 'singleton' AND version = ?
    `);

    const result = updateStmt.run(
      row.current_focus,
      row.operational_mode,
      row.active_mission_id,
      row.human_presence,
      row.system_health_status,
      row.updated_at,
      row.version,
    );

    if (result.changes === 0) {
      // Check if singleton row exists
      const existing = this.db
        .prepare("SELECT version FROM vajra_operational_state WHERE id = 'singleton'")
        .get() as { version: number } | undefined;

      if (!existing) {
        // Insert initial row
        this.db
          .prepare(
            `
          INSERT INTO vajra_operational_state (
            id, current_focus, operational_mode, active_mission_id, human_presence, system_health_status, version, updated_at
          ) VALUES ('singleton', ?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            row.current_focus,
            row.operational_mode,
            row.active_mission_id,
            row.human_presence,
            row.system_health_status,
            row.version,
            row.updated_at,
          );
        return;
      }

      throw new Error(
        `Optimistic concurrency conflict on OperationalContext. Expected version ${row.version}, database is at version ${existing.version}.`,
      );
    }
  }

  async loadOperationalContext(): Promise<OperationalContext | null> {
    const row = this.db
      .prepare("SELECT * FROM vajra_operational_state WHERE id = 'singleton'")
      .get() as OperationalStateRow | undefined;

    if (!row) {
      return null;
    }

    return mapRowToOperationalContext(row);
  }

  // ==========================================================================
  // Epistemic Beliefs
  // ==========================================================================

  async saveBelief(belief: EpistemicBelief): Promise<void> {
    const row = mapBeliefToRow(belief);
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO vajra_beliefs (
        id, proposition, confidence, verification_state,
        supporting_evidence_ids_json, contradicting_evidence_ids_json,
        last_evaluated_at, ttl_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      row.id,
      row.proposition,
      row.confidence,
      row.verification_state,
      row.supporting_evidence_ids_json,
      row.contradicting_evidence_ids_json,
      row.last_evaluated_at,
      row.ttl_ms,
      row.created_at,
    );
  }

  async loadBeliefs(): Promise<readonly EpistemicBelief[]> {
    const rows = this.db
      .prepare("SELECT * FROM vajra_beliefs ORDER BY created_at DESC")
      .all() as BeliefRow[];

    return rows.map(mapRowToBelief);
  }

  async getBelief(id: string): Promise<EpistemicBelief | null> {
    const row = this.db.prepare("SELECT * FROM vajra_beliefs WHERE id = ?").get(id) as
      BeliefRow | undefined;

    return row ? mapRowToBelief(row) : null;
  }

  async deleteBelief(id: string): Promise<void> {
    this.db.prepare("DELETE FROM vajra_beliefs WHERE id = ?").run(id);
  }

  // ==========================================================================
  // Deliberation Traces (Audit Log)
  // ==========================================================================

  async appendAuditTrace(trace: DeliberationTrace): Promise<void> {
    const row = mapTraceToRow(trace);
    const stmt = this.db.prepare(`
      INSERT INTO vajra_deliberation_traces (
        trace_id, stimulus_id, request_id, correlation_id, invocation_id, causation_id,
        intent_class, selected_option, rationale, considered_options_json,
        evidence_relied_upon_json, escalation_required, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      row.trace_id,
      row.stimulus_id,
      row.request_id,
      row.correlation_id,
      row.invocation_id,
      row.causation_id,
      row.intent_class,
      row.selected_option,
      row.rationale,
      row.considered_options_json,
      row.evidence_relied_upon_json,
      row.escalation_required,
      row.created_at,
    );
  }

  async queryAuditTraces(limit: number = 100): Promise<readonly DeliberationTrace[]> {
    const rows = this.db
      .prepare("SELECT * FROM vajra_deliberation_traces ORDER BY created_at DESC LIMIT ?")
      .all(limit) as DeliberationTraceRow[];

    return rows.map(mapRowToTrace);
  }

  async queryAuditTracesByCorrelation(
    correlationId: string,
  ): Promise<readonly DeliberationTrace[]> {
    const rows = this.db
      .prepare(
        "SELECT * FROM vajra_deliberation_traces WHERE correlation_id = ? ORDER BY created_at ASC",
      )
      .all(correlationId) as DeliberationTraceRow[];

    return rows.map(mapRowToTrace);
  }

  async queryAuditTracesByStimulus(stimulusId: string): Promise<readonly DeliberationTrace[]> {
    const rows = this.db
      .prepare(
        "SELECT * FROM vajra_deliberation_traces WHERE stimulus_id = ? ORDER BY created_at ASC",
      )
      .all(stimulusId) as DeliberationTraceRow[];

    return rows.map(mapRowToTrace);
  }

  // ==========================================================================
  // Missions Ledger
  // ==========================================================================

  async createMission(
    mission: VajraMissionRecord,
    steps: readonly VajraStepRecord[],
  ): Promise<void> {
    const missionRow = mapMissionToRow(mission);
    const stepRows = steps.map(mapStepToRow);

    this.db.transaction(() => {
      // 1. Insert mission row
      const insertMission = this.db.prepare(`
        INSERT INTO vajra_missions (
          id, objective, lifecycle_state, definition_json, state_json,
          current_step_order, allocated_budget_json, idempotency_key,
          request_id, correlation_id, invocation_id, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertMission.run(
        missionRow.id,
        missionRow.objective,
        missionRow.lifecycle_state,
        missionRow.definition_json,
        missionRow.state_json,
        missionRow.current_step_order,
        missionRow.allocated_budget_json,
        missionRow.idempotency_key,
        missionRow.request_id,
        missionRow.correlation_id,
        missionRow.invocation_id,
        missionRow.created_at,
        missionRow.updated_at,
        missionRow.completed_at,
      );

      // 2. Insert all planned steps
      const insertStep = this.db.prepare(`
        INSERT INTO vajra_mission_steps (
          id, mission_id, step_order, description, target_capability,
          input_json, expected_evidence, dispatch_state, idempotency_key,
          correlation_id, execution_result_id, execution_error_json,
          dispatched_at, executed_at, verified_at, evidence_hash, recovery_classification
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const stepRow of stepRows) {
        insertStep.run(
          stepRow.id,
          stepRow.mission_id,
          stepRow.step_order,
          stepRow.description,
          stepRow.target_capability,
          stepRow.input_json,
          stepRow.expected_evidence,
          stepRow.dispatch_state,
          stepRow.idempotency_key,
          stepRow.correlation_id,
          stepRow.execution_result_id,
          stepRow.execution_error_json,
          stepRow.dispatched_at,
          stepRow.executed_at,
          stepRow.verified_at,
          stepRow.evidence_hash ?? null,
          stepRow.recovery_classification ?? null,
        );
      }

      // 3. If RUNNING, update active_mission_id in operational state
      if (mission.lifecycleState === "RUNNING") {
        this.db
          .prepare(
            `
          UPDATE vajra_operational_state
          SET active_mission_id = ?, updated_at = ?
          WHERE id = 'singleton'
        `,
          )
          .run(mission.id, new Date().toISOString());
      }
    })();
  }

  async getMission(id: string): Promise<VajraMissionRecord | null> {
    const row = this.db.prepare("SELECT * FROM vajra_missions WHERE id = ?").get(id) as
      MissionRow | undefined;

    return row ? mapRowToMission(row) : null;
  }

  async getActiveMission(): Promise<VajraMissionRecord | null> {
    const row = this.db
      .prepare(
        `
        SELECT m.*
        FROM vajra_missions m
        JOIN vajra_operational_state s ON s.active_mission_id = m.id
        WHERE s.id = 'singleton'
      `,
      )
      .get() as MissionRow | undefined;

    if (row) {
      return mapRowToMission(row);
    }

    // Fallback: lookup single running mission
    const runningRow = this.db
      .prepare("SELECT * FROM vajra_missions WHERE lifecycle_state = 'RUNNING' LIMIT 1")
      .get() as MissionRow | undefined;

    return runningRow ? mapRowToMission(runningRow) : null;
  }

  async updateMissionLifecycle(
    id: string,
    lifecycleState: MissionLifecycleState,
    completedAt?: string | null,
  ): Promise<void> {
    const now = new Date().toISOString();

    this.db.transaction(() => {
      this.db
        .prepare(
          `
        UPDATE vajra_missions
        SET lifecycle_state = ?,
            updated_at = ?,
            completed_at = COALESCE(?, completed_at)
        WHERE id = ?
      `,
        )
        .run(lifecycleState, now, completedAt ?? null, id);

      if (lifecycleState === "RUNNING") {
        this.db
          .prepare(
            `
          UPDATE vajra_operational_state
          SET active_mission_id = ?, updated_at = ?
          WHERE id = 'singleton'
        `,
          )
          .run(id, now);
      } else if (
        lifecycleState === "COMPLETED" ||
        lifecycleState === "FAILED" ||
        lifecycleState === "CANCELLED" ||
        lifecycleState === "PAUSED_RECOVERY" ||
        lifecycleState === "PAUSED_APPROVAL"
      ) {
        // Clear active_mission_id if it was this mission
        this.db
          .prepare(
            `
          UPDATE vajra_operational_state
          SET active_mission_id = NULL, updated_at = ?
          WHERE id = 'singleton' AND active_mission_id = ?
        `,
          )
          .run(now, id);
      }
    })();
  }

  /**
   * Atomically finalizes mission reality closure:
   * - Persists reconciled epistemic beliefs
   * - Clears active_mission_id if matching this missionId
   * - Updates mission lifecycle state and completed_at
   * All executed within a single database transaction.
   */
  async completeMissionRealityClosure(
    missionId: string,
    targetLifecycle: MissionLifecycleState,
    completedAt: string | null,
    updatedBeliefs: readonly EpistemicBelief[] = [],
  ): Promise<void> {
    const now = new Date().toISOString();

    this.db.transaction(() => {
      // 1. Persist updated beliefs
      for (const belief of updatedBeliefs) {
        const row = mapBeliefToRow(belief);
        this.db
          .prepare(
            `
          INSERT OR REPLACE INTO vajra_beliefs (
            id, proposition, confidence, verification_state,
            supporting_evidence_ids_json, contradicting_evidence_ids_json,
            last_evaluated_at, ttl_ms, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            row.id,
            row.proposition,
            row.confidence,
            row.verification_state,
            row.supporting_evidence_ids_json,
            row.contradicting_evidence_ids_json,
            row.last_evaluated_at,
            row.ttl_ms,
            row.created_at,
          );
      }

      // 2. Clear active_mission_id if it was this mission
      this.db
        .prepare(
          `
        UPDATE vajra_operational_state
        SET active_mission_id = NULL, updated_at = ?
        WHERE id = 'singleton' AND active_mission_id = ?
      `,
        )
        .run(now, missionId);

      // 3. Update mission lifecycle state
      this.db
        .prepare(
          `
        UPDATE vajra_missions
        SET lifecycle_state = ?,
            updated_at = ?,
            completed_at = COALESCE(?, completed_at)
        WHERE id = ?
      `,
        )
        .run(targetLifecycle, now, completedAt ?? null, missionId);
    })();
  }

  // ==========================================================================
  // Mission Steps & Two-Phase Dispatch
  // ==========================================================================

  async getStep(id: string): Promise<VajraStepRecord | null> {
    const row = this.db.prepare("SELECT * FROM vajra_mission_steps WHERE id = ?").get(id) as
      MissionStepRow | undefined;

    return row ? mapRowToStep(row) : null;
  }

  async getStepsForMission(missionId: string): Promise<readonly VajraStepRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM vajra_mission_steps WHERE mission_id = ? ORDER BY step_order ASC")
      .all(missionId) as MissionStepRow[];

    return rows.map(mapRowToStep);
  }

  /**
   * Phase 1 of Two-Phase Dispatch:
   * Marks step as DISPATCHED and records dispatched_at before capability execution.
   * Commits atomically and finishes BEFORE any external invocation starts.
   */
  async preDispatchStep(
    stepId: string,
    idempotencyKey: string,
    dispatchedAt?: string,
  ): Promise<void> {
    const timestamp = dispatchedAt ?? new Date().toISOString();

    const update = this.db.prepare(`
      UPDATE vajra_mission_steps
      SET dispatch_state = 'DISPATCHED',
          idempotency_key = ?,
          dispatched_at = ?
      WHERE id = ?
    `);

    const res = update.run(idempotencyKey, timestamp, stepId);
    if (res.changes === 0) {
      throw new Error(`Step '${stepId}' not found for pre-dispatch.`);
    }
  }

  /**
   * Phase 3 of Two-Phase Dispatch:
   * Marks step as EXECUTED and records the capability execution result ID, timestamp, and optional evidence hash.
   */
  async recordStepExecution(
    stepId: string,
    executionResultId: string,
    executedAt?: string,
    evidenceHash?: string,
  ): Promise<void> {
    const timestamp = executedAt ?? new Date().toISOString();

    const update = this.db.prepare(`
      UPDATE vajra_mission_steps
      SET dispatch_state = 'EXECUTED',
          execution_result_id = ?,
          executed_at = ?,
          evidence_hash = COALESCE(?, evidence_hash)
      WHERE id = ?
    `);

    const res = update.run(executionResultId, timestamp, evidenceHash ?? null, stepId);
    if (res.changes === 0) {
      throw new Error(`Step '${stepId}' not found for execution recording.`);
    }
  }

  /**
   * Updates the durable recovery classification for an interrupted step (Phase 8B Part 1).
   */
  async updateStepRecoveryClassification(
    stepId: string,
    classification: StepRecoveryClassification,
  ): Promise<void> {
    const update = this.db.prepare(`
      UPDATE vajra_mission_steps
      SET recovery_classification = ?
      WHERE id = ?
    `);

    const res = update.run(classification, stepId);
    if (res.changes === 0) {
      throw new Error(`Step '${stepId}' not found for recovery classification update.`);
    }
  }

  /**
   * Phase 3 (Failure path) of Two-Phase Dispatch:
   * Marks step as FAILED and records the execution error JSON.
   */
  async failStep(stepId: string, error: unknown, executedAt?: string): Promise<void> {
    const timestamp = executedAt ?? new Date().toISOString();
    const errorJson = JSON.stringify(error ?? { message: "Unknown error" });

    const update = this.db.prepare(`
      UPDATE vajra_mission_steps
      SET dispatch_state = 'FAILED',
          execution_error_json = ?,
          executed_at = ?
      WHERE id = ?
    `);

    const res = update.run(errorJson, timestamp, stepId);
    if (res.changes === 0) {
      throw new Error(`Step '${stepId}' not found for failure recording.`);
    }
  }

  // ==========================================================================
  // Escalations (Human Gates)
  // ==========================================================================

  async createEscalation(escalation: VajraEscalationRecord): Promise<void> {
    const row = mapEscalationToRow(escalation);

    this.db
      .prepare(
        `
      INSERT INTO vajra_escalations (
        id, mission_id, step_id, status, action_proposed,
        impact_class, risk_explanation, resolution_comment,
        request_id, correlation_id, created_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        action_proposed = excluded.action_proposed,
        impact_class = excluded.impact_class,
        risk_explanation = excluded.risk_explanation,
        request_id = excluded.request_id,
        correlation_id = excluded.correlation_id
    `,
      )
      .run(
        row.id,
        row.mission_id,
        row.step_id,
        row.status,
        row.action_proposed,
        row.impact_class,
        row.risk_explanation,
        row.resolution_comment,
        row.request_id,
        row.correlation_id,
        row.created_at,
        row.resolved_at,
      );
  }

  async getEscalation(id: string): Promise<VajraEscalationRecord | null> {
    const row = this.db.prepare("SELECT * FROM vajra_escalations WHERE id = ?").get(id) as
      EscalationRow | undefined;

    return row ? mapRowToEscalation(row) : null;
  }

  async resolveEscalation(
    id: string,
    status: EscalationStatus,
    resolutionComment?: string | null,
    resolvedAt?: string,
  ): Promise<void> {
    const timestamp = resolvedAt ?? new Date().toISOString();

    const update = this.db.prepare(`
      UPDATE vajra_escalations
      SET status = ?,
          resolution_comment = COALESCE(?, resolution_comment),
          resolved_at = ?
      WHERE id = ?
    `);

    const res = update.run(status, resolutionComment ?? null, timestamp, id);
    if (res.changes === 0) {
      throw new Error(`Escalation '${id}' not found for resolution.`);
    }
  }

  async getPendingEscalations(): Promise<readonly VajraEscalationRecord[]> {
    const rows = this.db
      .prepare(
        "SELECT * FROM vajra_escalations WHERE status = 'PENDING_APPROVAL' ORDER BY created_at ASC, rowid ASC",
      )
      .all() as EscalationRow[];

    return rows.map(mapRowToEscalation);
  }

  // ==========================================================================
  // Verification Records
  // ==========================================================================

  async saveVerification(verification: VajraVerificationRecord): Promise<void> {
    const row = mapVerificationToRow(verification);

    this.db.transaction(() => {
      this.db
        .prepare(
          `
        INSERT INTO vajra_verifications (
          id, mission_id, step_id, outcome, evidence_ids_json,
          evaluator_notes, correlation_id, invocation_id, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          row.id,
          row.mission_id,
          row.step_id,
          row.outcome,
          row.evidence_ids_json,
          row.evaluator_notes,
          row.correlation_id,
          row.invocation_id,
          row.recorded_at,
        );

      if (verification.outcome === "criteria_satisfied") {
        this.db
          .prepare(
            `
          UPDATE vajra_mission_steps
          SET dispatch_state = 'VERIFIED',
              verified_at = ?
          WHERE id = ?
        `,
          )
          .run(row.recorded_at, row.step_id);
      }
    })();
  }

  async getVerificationsForStep(stepId: string): Promise<readonly VajraVerificationRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM vajra_verifications WHERE step_id = ? ORDER BY recorded_at ASC")
      .all(stepId) as VerificationRow[];

    return rows.map(mapRowToVerification);
  }

  async getVerificationsForMission(missionId: string): Promise<readonly VajraVerificationRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM vajra_verifications WHERE mission_id = ? ORDER BY recorded_at ASC")
      .all(missionId) as VerificationRow[];

    return rows.map(mapRowToVerification);
  }

  // ==========================================================================
  // Unified Provenance Reconstruction (K19)
  // ==========================================================================

  async getExecutionProvenance(correlationId: string): Promise<readonly ProvenanceRecord[]> {
    const query = `
      SELECT 'deliberation' as stage, trace_id as id, rationale as description, created_at as timestamp 
      FROM vajra_deliberation_traces WHERE correlation_id = ?
      UNION ALL
      SELECT 'mission' as stage, id, objective as description, created_at as timestamp 
      FROM vajra_missions WHERE correlation_id = ?
      UNION ALL
      SELECT 'step' as stage, id, description, dispatched_at as timestamp 
      FROM vajra_mission_steps WHERE correlation_id = ? AND dispatched_at IS NOT NULL
      UNION ALL
      SELECT 'escalation' as stage, id, risk_explanation as description, created_at as timestamp 
      FROM vajra_escalations WHERE correlation_id = ?
      UNION ALL
      SELECT 'verification' as stage, id, outcome as description, recorded_at as timestamp 
      FROM vajra_verifications WHERE correlation_id = ?
      ORDER BY timestamp ASC;
    `;

    const rows = this.db
      .prepare(query)
      .all(
        correlationId,
        correlationId,
        correlationId,
        correlationId,
        correlationId,
      ) as ProvenanceRow[];

    return rows.map(mapRowToProvenance);
  }

  // ==========================================================================
  // Crash Recovery & Interruption Detection
  // ==========================================================================

  /**
   * Phase 3 Recovery Detection:
   * Inspects database for in-flight or interrupted work without running autonomous retry loops.
   */
  async detectInterruptedMissions(): Promise<readonly InterruptedRecoveryState[]> {
    const activeMissions = this.db
      .prepare(
        `
        SELECT * FROM vajra_missions
        WHERE lifecycle_state IN ('RUNNING', 'PAUSED_RECOVERY', 'PAUSED_APPROVAL')
        ORDER BY updated_at DESC
      `,
      )
      .all() as MissionRow[];

    const results: InterruptedRecoveryState[] = [];

    for (const mRow of activeMissions) {
      const mission = mapRowToMission(mRow);

      // Detect steps left in DISPATCHED without execution result
      const stepRows = this.db
        .prepare(
          `
          SELECT * FROM vajra_mission_steps
          WHERE mission_id = ? AND dispatch_state = 'DISPATCHED' AND execution_result_id IS NULL
          ORDER BY step_order ASC
        `,
        )
        .all(mission.id) as MissionStepRow[];

      const interruptedSteps = stepRows.map(mapRowToStep);

      // Detect pending escalations
      const escRows = this.db
        .prepare(
          `
          SELECT * FROM vajra_escalations
          WHERE mission_id = ? AND status = 'PENDING_APPROVAL'
          ORDER BY created_at ASC
        `,
        )
        .all(mission.id) as EscalationRow[];

      const pendingEscalations = escRows.map(mapRowToEscalation);

      results.push(
        Object.freeze({
          mission,
          interruptedSteps: Object.freeze(interruptedSteps),
          pendingEscalations: Object.freeze(pendingEscalations),
        }),
      );
    }

    return Object.freeze(results);
  }
}
