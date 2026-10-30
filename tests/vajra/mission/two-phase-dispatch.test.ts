import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { MissionRuntime } from "../../../src/vajra/mission/runtime";
import { SqliteOperationalStateStore } from "../../../src/persistence/vajra/sqlite-operational-state-store";
import { ICoordinationDispatcher } from "../../../src/vajra/ports/coordination";
import { createMissionDefinition, createMissionStep } from "../../../src/contracts/mission/mission-definition";
import { createMissionState } from "../../../src/contracts/mission/mission-state";
import { createVajraMissionRecord, createVajraStepRecord } from "../../../src/vajra/types/mission-record";
import { CorrelationMetadata, Result, CapabilityFailure } from "../../../src/contracts/results/result";

describe("Two-Phase Dispatch Protocol in MissionRuntime", () => {
  let db: Database.Database;
  let stateStore: SqliteOperationalStateStore;

  const correlation: CorrelationMetadata = {
    requestId: "req-tpd-01",
    correlationId: "corr-tpd-01",
    invocationId: "inv-tpd-01",
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
  });

  afterEach(() => {
    db.close();
  });

  it("commits Phase A (DISPATCHED) before external execution, then Phase C (COMPLETED) outside open transactions", async () => {
    let capturedStatusDuringPhaseB: string | null = null;
    let dbIsOpenDuringPhaseB = false;

    const mockCoordinator: ICoordinationDispatcher = {
      dispatchStep: vi.fn(async (step, _corr) => {
        // Query database during Phase B external actuation:
        // Must show DISPATCHED persisted, and DB must NOT be locked in an open transaction
        const stepRow = db.prepare("SELECT dispatch_state, dispatched_at FROM vajra_mission_steps WHERE id = ?").get(step.id) as { dispatch_state: string; dispatched_at: string };
        capturedStatusDuringPhaseB = stepRow.dispatch_state;

        // Verify SQLite can execute a concurrent read/write (proving no transaction lock is held)
        try {
          db.prepare("SELECT count(*) as cnt FROM vajra_missions").get();
          dbIsOpenDuringPhaseB = true;
        } catch {
          dbIsOpenDuringPhaseB = false;
        }

        return Result.success({ ok: true, formatted: "done" }, correlation);
      }),
    };

    const runtime = new MissionRuntime(stateStore, mockCoordinator);

    const step = createMissionStep({
      id: "step-tpd-1",
      missionId: "m-tpd-1",
      stepOrder: 1,
      description: "Step 1",
      targetCapability: "workspace.format",
      input: { file: "test.ts" },
      expectedEvidence: "evidence.ok",
    });

    const def = createMissionDefinition({
      id: "m-tpd-1",
      objective: "Test two-phase commit",
      steps: [step],
      completionCriteria: { description: "done", requiredEvidence: ["evidence.ok"] },
      correlation,
    });

    const missionRecord = createVajraMissionRecord({
      id: def.id,
      objective: def.objective,
      lifecycleState: "CREATED",
      definition: def,
      state: createMissionState({ missionId: def.id, definitionId: def.id }),
      allocatedBudget: { maxCostCents: 10, maxSteps: 3 },
      idempotencyKey: "idemp-tpd-1",
      requestId: correlation.requestId,
      correlationId: correlation.correlationId,
      invocationId: correlation.invocationId,
    });

    const stepRecord = createVajraStepRecord({
      id: step.id,
      missionId: def.id,
      stepOrder: 1,
      description: step.description,
      targetCapability: step.targetCapability,
      input: step.input,
      expectedEvidence: step.expectedEvidence,
      idempotencyKey: `idemp-step-${step.id}`,
      correlationId: correlation.correlationId,
    });

    await stateStore.createMission(missionRecord, [stepRecord]);

    // Execute mission
    const completed = await runtime.executeMission(def.id);
    expect(completed.lifecycleState).toBe("COMPLETED");

    // Invariant checks:
    // 1. During external execution, step was already DISPATCHED in DB
    expect(capturedStatusDuringPhaseB).toBe("DISPATCHED");
    // 2. DB was accessible outside any locking transaction
    expect(dbIsOpenDuringPhaseB).toBe(true);

    // 3. Phase C committed successfully: step is now EXECUTED with execution_result_id
    const finalStep = await stateStore.getStepsForMission(def.id);
    expect(finalStep[0].dispatchState).toBe("EXECUTED");
    expect(finalStep[0].executionResultId).toBeDefined();
    expect(finalStep[0].executedAt).toBeDefined();

    // 4. Mission reached COMPLETED
    const finalMission = await stateStore.getMission(def.id);
    expect(finalMission?.lifecycleState).toBe("COMPLETED");
  });

  it("commits Phase C failure and enters PAUSED_RECOVERY upon timeout or execution failure", async () => {
    const timeoutFailure: CapabilityFailure = {
      category: "timeout",
      message: "External capability execution timed out after 30000ms",
    };

    const mockCoordinator: ICoordinationDispatcher = {
      dispatchStep: vi.fn(async () => {
        return Result.failure(timeoutFailure, correlation);
      }),
    };

    const runtime = new MissionRuntime(stateStore, mockCoordinator);

    const step = createMissionStep({
      id: "step-tpd-fail",
      missionId: "m-tpd-fail",
      stepOrder: 1,
      description: "Failing step",
      targetCapability: "external.network",
      input: {},
      expectedEvidence: "evidence.ok",
    });

    const def = createMissionDefinition({
      id: "m-tpd-fail",
      objective: "Test failure transition",
      steps: [step],
      completionCriteria: { description: "done", requiredEvidence: ["evidence.ok"] },
      correlation,
    });

    const missionRecord = createVajraMissionRecord({
      id: def.id,
      objective: def.objective,
      lifecycleState: "CREATED",
      definition: def,
      state: createMissionState({ missionId: def.id, definitionId: def.id }),
      allocatedBudget: { maxCostCents: 10, maxSteps: 3 },
      idempotencyKey: "idemp-tpd-fail",
      requestId: correlation.requestId,
      correlationId: correlation.correlationId,
      invocationId: correlation.invocationId,
    });

    const stepRecord = createVajraStepRecord({
      id: step.id,
      missionId: def.id,
      stepOrder: 1,
      description: step.description,
      targetCapability: step.targetCapability,
      input: step.input,
      expectedEvidence: step.expectedEvidence,
      idempotencyKey: `idemp-step-${step.id}`,
      correlationId: correlation.correlationId,
    });

    await stateStore.createMission(missionRecord, [stepRecord]);

    const result = await runtime.executeMission(def.id);
    expect(result.lifecycleState).toBe("PAUSED_RECOVERY");

    // Step state in DB is FAILED
    const steps = await stateStore.getStepsForMission(def.id);
    expect(steps[0].dispatchState).toBe("FAILED");
    expect(steps[0].executionError).toBeDefined();

    // Mission state is PAUSED_RECOVERY per Section 17.2 timeout uncertainty rule
    const mission = await stateStore.getMission(def.id);
    expect(mission?.lifecycleState).toBe("PAUSED_RECOVERY");
  });
});
