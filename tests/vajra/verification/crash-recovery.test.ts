import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { VerificationEvaluator } from "../../../src/vajra/verification/evaluator";
import { ObservationReceiver } from "../../../src/vajra/observation/receiver";
import { MissionClosureManager } from "../../../src/vajra/closure/closure-manager";
import { SqliteOperationalStateStore } from "../../../src/persistence/vajra/sqlite-operational-state-store";
import {
  CompletionCriteria,
  createMissionDefinition,
  createMissionStep,
} from "../../../src/contracts/mission/mission-definition";
import { createMissionState } from "../../../src/contracts/mission/mission-state";
import {
  createVajraMissionRecord,
  createVajraStepRecord,
} from "../../../src/vajra/types/mission-record";
import { CorrelationMetadata } from "../../../src/contracts/results/result";

describe("Verification Crash Recovery & Resilience Matrix (Phase 7 - Invariants K-P7-15, K-P7-16)", () => {
  let db: Database.Database;
  let stateStore: SqliteOperationalStateStore;
  let receiver: ObservationReceiver;
  let evaluator: VerificationEvaluator;
  let closureManager: MissionClosureManager;

  const correlation: CorrelationMetadata = {
    requestId: "req-recovery-01",
    correlationId: "corr-recovery-01",
    invocationId: "inv-recovery-01",
  };

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    const schemaPath = path.join(process.cwd(), "src", "persistence", "schema.sql");
    db.exec(fs.readFileSync(schemaPath, "utf8"));
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (1, ?)").run(
      new Date().toISOString(),
    );

    const migPath = path.join(
      process.cwd(),
      "src",
      "persistence",
      "migrations",
      "003_vajra_operational_state.sql",
    );
    db.exec(fs.readFileSync(migPath, "utf8"));
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (3, ?)").run(
      new Date().toISOString(),
    );

    stateStore = new SqliteOperationalStateStore(db);
    receiver = new ObservationReceiver();
    evaluator = new VerificationEvaluator(stateStore);
    closureManager = new MissionClosureManager(stateStore);
  });

  afterEach(() => {
    db.close();
  });

  const setupMissionWithExecutedStep = async (
    missionId: string,
    stepId: string,
    executionResultId: string,
  ) => {
    const step = createMissionStep({
      id: stepId,
      missionId,
      stepOrder: 1,
      description: "Recoverable step",
      targetCapability: "capability.data.sync",
      input: {},
      expectedEvidence: "evidence.sync.completed",
    });

    const def = createMissionDefinition({
      id: missionId,
      objective: "Data sync mission",
      steps: [step],
      constraints: { maxSteps: 1, confirmationRequired: false },
      completionCriteria: {
        description: "Data synchronized",
        requiredEvidence: ["evidence.sync.completed"],
      },
      correlation,
    });

    const mission = createVajraMissionRecord({
      id: missionId,
      objective: def.objective,
      lifecycleState: "RUNNING",
      definition: def,
      state: createMissionState({ missionId, definitionId: missionId }),
      allocatedBudget: { maxCostCents: 10, maxSteps: 1 },
      idempotencyKey: `idemp-${missionId}`,
      requestId: correlation.requestId,
      correlationId: correlation.correlationId,
      invocationId: correlation.invocationId,
    });

    const stepRecord = createVajraStepRecord({
      id: stepId,
      missionId,
      stepOrder: 1,
      description: step.description,
      targetCapability: step.targetCapability,
      input: step.input,
      expectedEvidence: step.expectedEvidence,
      dispatchState: "EXECUTED",
      idempotencyKey: `idemp-${stepId}`,
      correlationId: correlation.correlationId,
      executionResultId,
      executedAt: new Date().toISOString(),
    });

    await stateStore.createMission(mission, [stepRecord]);
    return { def, mission, stepRecord };
  };

  it("Crash Point A (Payload Recoverable): Reconstructs observation using canonical executionId without re-execution", async () => {
    const executionResultId = "exec-canonical-sync-99";
    const { def } = await setupMissionWithExecutedStep(
      "mission-rec-1",
      "step-rec-1",
      executionResultId,
    );

    // Subsystem query retrieves the actual output payload
    const retrievedPayload = {
      ok: true,
      evidenceToken: "evidence.sync.completed",
      syncedItems: 100,
    };

    // Reconstruct observation using canonical identity (zero Date.now() generation)
    const reconstructedObs = receiver.normalizeExecutionResult({
      stepId: "step-rec-1",
      missionId: "mission-rec-1",
      targetCapability: "capability.data.sync",
      executionResultId,
      payload: retrievedPayload,
      correlation: {
        requestId: correlation.requestId,
        correlationId: correlation.correlationId,
        invocationId: correlation.invocationId,
        executionId: executionResultId,
      },
    });

    expect(reconstructedObs.correlation.executionId).toBe(executionResultId);

    // Verification succeeds without external re-execution
    const record = await evaluator.evaluateStepAsync(
      "step-rec-1",
      "mission-rec-1",
      [reconstructedObs],
      def.completionCriteria,
    );

    expect(record.outcome).toBe("criteria_satisfied");
    expect(record.executionResultIds).toContain(executionResultId);
  });

  it("Crash Point A (Payload Unrecoverable): Yields inconclusive and enters PAUSED_RECOVERY without fabricating evidence", async () => {
    const executionResultId = "exec-lost-sync-00";
    const { def, mission } = await setupMissionWithExecutedStep(
      "mission-rec-2",
      "step-rec-2",
      executionResultId,
    );

    // Process crashed; only executionResultId is in DB, but payload is unrecoverable.
    // Invariant (K-P7-15): Zero evidence fabrication. If payload is unrecoverable, evidence is unavailable.
    const record = await evaluator.evaluateStepAsync(
      "step-rec-2",
      "mission-rec-2",
      [], // No recoverable observations
      def.completionCriteria,
      { isIndeterminateFailure: true },
    );

    expect(record.outcome).toBe("inconclusive");
    expect(record.rationale).toContain("indeterminate outcome");

    // Mission transitions to PAUSED_RECOVERY
    const closureResult = await closureManager.closeMission({
      missionId: mission.id,
      terminalVerificationRecord: record,
    });

    expect(closureResult.status).toBe("not_completed");
    const updatedMission = await stateStore.getMission(mission.id);
    expect(updatedMission?.lifecycleState).toBe("PAUSED_RECOVERY");
  });

  it("Crash Point B (Lost Transient Telemetry): Unrecoverable transient probe yields inconclusive without fabrication", async () => {
    const { def, mission } = await setupMissionWithExecutedStep(
      "mission-rec-3",
      "step-rec-3",
      "exec-probe-lost",
    );

    // In-memory telemetry lost on crash; DB cannot reconstruct non-persisted telemetry.
    const record = await evaluator.evaluateStepAsync(
      "step-rec-3",
      "mission-rec-3",
      [], // Empty observation pool
      def.completionCriteria,
    );

    expect(record.outcome).toBe("inconclusive");
    expect(record.rationale).toContain("No observations provided for evaluation");

    const closureResult = await closureManager.closeMission({
      missionId: mission.id,
      terminalVerificationRecord: record,
    });

    expect(closureResult.status).toBe("not_completed");
    const updated = await stateStore.getMission(mission.id);
    expect(updated?.lifecycleState).toBe("PAUSED_RECOVERY");
  });

  it("Crash Point C (Verification Saved, Mission RUNNING): Resumes closure directly from durable VerificationRecord", async () => {
    const { def, mission } = await setupMissionWithExecutedStep(
      "mission-rec-4",
      "step-rec-4",
      "exec-4",
    );

    // Pre-crash: step verification succeeded and was saved to SQLite
    const obs = receiver.normalizeExecutionResult({
      stepId: "step-rec-4",
      missionId: "mission-rec-4",
      targetCapability: "capability.data.sync",
      executionResultId: "exec-4",
      payload: { ok: true, evidenceToken: "evidence.sync.completed" },
      correlation: {
        requestId: correlation.requestId,
        correlationId: correlation.correlationId,
        invocationId: correlation.invocationId,
        executionId: "exec-4",
      },
    });

    const savedRecord = await evaluator.evaluateStepAsync(
      "step-rec-4",
      "mission-rec-4",
      [obs],
      def.completionCriteria,
    );
    expect(savedRecord.outcome).toBe("criteria_satisfied");

    // Process crashed before MissionClosureManager was called.
    // On reboot: DB has verification record in vajra_verifications, but mission is still RUNNING.
    const durableVerifications = await stateStore.getVerificationsForStep("step-rec-4");
    expect(durableVerifications).toHaveLength(1);
    expect(durableVerifications[0].outcome).toBe("criteria_satisfied");

    // Boot recovery action: inspects verification record and executes closure without re-dispatch
    const closureResult = await closureManager.closeMission({
      missionId: mission.id,
      terminalVerificationRecord: savedRecord,
    });

    expect(closureResult.status).toBe("completed");
    const updatedMission = await stateStore.getMission(mission.id);
    expect(updatedMission?.lifecycleState).toBe("COMPLETED");
  });
});
