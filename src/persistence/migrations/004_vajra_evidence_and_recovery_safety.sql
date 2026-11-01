-- Migration: 004_vajra_evidence_and_recovery_safety.sql
-- Goal: Establish durable evidence hash and recovery classification columns on vajra_mission_steps (Phase 8B Part 1)

ALTER TABLE vajra_mission_steps ADD COLUMN evidence_hash TEXT;
ALTER TABLE vajra_mission_steps ADD COLUMN recovery_classification TEXT;

CREATE INDEX IF NOT EXISTS idx_vajra_steps_recovery_classification ON vajra_mission_steps (recovery_classification);
