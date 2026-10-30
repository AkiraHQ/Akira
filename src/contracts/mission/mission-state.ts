import { MissionResult } from "../capabilities/verification";

/**
 * Passive Mission Evidence & State Envelope per Target Architecture §6 / Foundation Contracts K6 / K10 / K19.
 *
 * CRITICAL ARCHITECTURAL CONSTRAINTS:
 * - MUST NOT contain lifecycle status enums (e.g. "Created", "Running", "Paused", "Blocked") (§20.3 OPEN).
 * - MUST NOT contain execution cursors (e.g. currentStepIndex) or scheduler state.
 * - MUST NOT contain retry state, progress percentage, or backoff counters.
 * - Represents a passive, immutable snapshot referencing a mission definition, accumulated evidence IDs
 *   (Execution Result IDs K5, Observation IDs K4), verification records (K6), and optional terminal MissionResult.
 */
export interface MissionState<TOutcome = unknown> {
  readonly missionId: string;
  readonly definitionId: string;
  readonly executionResultIds: readonly string[];
  readonly observationIds: readonly string[];
  readonly verificationRecordIds: readonly string[];
  readonly terminalResult?: MissionResult<TOutcome>;
}

/**
 * Pure factory helper to construct a passive MissionState envelope.
 */
export function createMissionState<TOutcome = unknown>(opts: {
  missionId: string;
  definitionId: string;
  executionResultIds?: readonly string[];
  observationIds?: readonly string[];
  verificationRecordIds?: readonly string[];
  terminalResult?: MissionResult<TOutcome>;
}): MissionState<TOutcome> {
  return Object.freeze({
    missionId: opts.missionId,
    definitionId: opts.definitionId,
    executionResultIds: Object.freeze([...(opts.executionResultIds ?? [])]),
    observationIds: Object.freeze([...(opts.observationIds ?? [])]),
    verificationRecordIds: Object.freeze([...(opts.verificationRecordIds ?? [])]),
    terminalResult: opts.terminalResult,
  });
}
