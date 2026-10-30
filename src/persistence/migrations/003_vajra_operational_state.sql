-- Migration: 003_vajra_operational_state.sql
-- Goal: Establish VAJRA Durable Operational State schema (Phase 3 Revision 1)
-- Tables: 7 | Columns: 80 | Foreign Keys: 6 | CHECK Constraints: 12 | Explicit Indexes: 19

-- ==========================================
-- 1. Operational Context (Singleton Row)
-- ==========================================
CREATE TABLE IF NOT EXISTS vajra_operational_state (
  id TEXT PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  current_focus TEXT NOT NULL,
  operational_mode TEXT NOT NULL CHECK (operational_mode IN ('REQUEST_DRIVEN', 'PROACTIVE_MONITOR', 'RECOVERY', 'PAUSED')),
  active_mission_id TEXT,
  human_presence TEXT NOT NULL CHECK (human_presence IN ('FOCUSED_ACTIVE', 'IDLE', 'AWAY')),
  system_health_status TEXT NOT NULL CHECK (system_health_status IN ('NOMINAL', 'DEGRADED', 'CRITICAL')),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (active_mission_id) REFERENCES vajra_missions(id) ON DELETE SET NULL
);

-- ==========================================
-- 2. Missions Ledger
-- ==========================================
CREATE TABLE IF NOT EXISTS vajra_missions (
  id TEXT PRIMARY KEY,
  objective TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('CREATED', 'RUNNING', 'PAUSED_APPROVAL', 'PAUSED_RECOVERY', 'COMPLETED', 'FAILED', 'CANCELLED')),
  definition_json TEXT NOT NULL,
  state_json TEXT NOT NULL,
  current_step_order INTEGER NOT NULL DEFAULT 0,
  allocated_budget_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  invocation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_vajra_missions_state ON vajra_missions (lifecycle_state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_vajra_missions_correlation ON vajra_missions (correlation_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vajra_missions_idempotency ON vajra_missions (idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vajra_single_running_mission ON vajra_missions (lifecycle_state) WHERE lifecycle_state = 'RUNNING';

-- ==========================================
-- 3. Mission Steps
-- ==========================================
CREATE TABLE IF NOT EXISTS vajra_mission_steps (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  description TEXT NOT NULL,
  target_capability TEXT NOT NULL,
  input_json TEXT NOT NULL,
  expected_evidence TEXT NOT NULL,
  dispatch_state TEXT NOT NULL CHECK (dispatch_state IN ('PENDING', 'DISPATCHED', 'EXECUTED', 'VERIFIED', 'FAILED', 'SKIPPED')),
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  execution_result_id TEXT,
  execution_error_json TEXT,
  dispatched_at TEXT,
  executed_at TEXT,
  verified_at TEXT,
  FOREIGN KEY (mission_id) REFERENCES vajra_missions(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vajra_steps_mission_order ON vajra_mission_steps (mission_id, step_order);
CREATE INDEX IF NOT EXISTS idx_vajra_steps_state ON vajra_mission_steps (dispatch_state);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vajra_steps_idempotency ON vajra_mission_steps (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_vajra_steps_correlation ON vajra_mission_steps (correlation_id);

-- ==========================================
-- 4. Epistemic Beliefs
-- ==========================================
CREATE TABLE IF NOT EXISTS vajra_beliefs (
  id TEXT PRIMARY KEY,
  proposition TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  verification_state TEXT NOT NULL CHECK (verification_state IN ('UNVERIFIED', 'VERIFIED', 'CONTRADICTED', 'STALE')),
  supporting_evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  contradicting_evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  last_evaluated_at TEXT NOT NULL,
  ttl_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vajra_beliefs_state ON vajra_beliefs (verification_state);
CREATE INDEX IF NOT EXISTS idx_vajra_beliefs_eval ON vajra_beliefs (last_evaluated_at DESC);

-- ==========================================
-- 5. Human Escalations
-- ==========================================
CREATE TABLE IF NOT EXISTS vajra_escalations (
  id TEXT PRIMARY KEY,
  mission_id TEXT,
  step_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED')),
  action_proposed TEXT NOT NULL,
  impact_class TEXT NOT NULL CHECK (impact_class IN ('LOW', 'MEDIUM', 'HIGH')),
  risk_explanation TEXT NOT NULL,
  resolution_comment TEXT,
  request_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (mission_id) REFERENCES vajra_missions(id) ON DELETE SET NULL,
  FOREIGN KEY (step_id) REFERENCES vajra_mission_steps(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_vajra_escalations_status ON vajra_escalations (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vajra_escalations_mission ON vajra_escalations (mission_id);
CREATE INDEX IF NOT EXISTS idx_vajra_escalations_correlation ON vajra_escalations (correlation_id);

-- ==========================================
-- 6. Deliberation Traces (Audit Log)
-- ==========================================
CREATE TABLE IF NOT EXISTS vajra_deliberation_traces (
  trace_id TEXT PRIMARY KEY,
  stimulus_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  invocation_id TEXT NOT NULL,
  causation_id TEXT,
  intent_class TEXT NOT NULL,
  selected_option TEXT NOT NULL,
  rationale TEXT NOT NULL,
  considered_options_json TEXT NOT NULL,
  evidence_relied_upon_json TEXT NOT NULL,
  escalation_required INTEGER NOT NULL CHECK (escalation_required IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vajra_traces_correlation ON vajra_deliberation_traces (correlation_id);
CREATE INDEX IF NOT EXISTS idx_vajra_traces_stimulus ON vajra_deliberation_traces (stimulus_id);
CREATE INDEX IF NOT EXISTS idx_vajra_traces_created ON vajra_deliberation_traces (created_at DESC);

-- ==========================================
-- 7. Verification Judgments
-- ==========================================
CREATE TABLE IF NOT EXISTS vajra_verifications (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('criteria_satisfied', 'criteria_not_satisfied', 'inconclusive')),
  evidence_ids_json TEXT NOT NULL,
  evaluator_notes TEXT,
  correlation_id TEXT NOT NULL,
  invocation_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (mission_id) REFERENCES vajra_missions(id) ON DELETE CASCADE,
  FOREIGN KEY (step_id) REFERENCES vajra_mission_steps(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vajra_verifications_step ON vajra_verifications (step_id);
CREATE INDEX IF NOT EXISTS idx_vajra_verifications_mission ON vajra_verifications (mission_id);
CREATE INDEX IF NOT EXISTS idx_vajra_verifications_correlation ON vajra_verifications (correlation_id);
