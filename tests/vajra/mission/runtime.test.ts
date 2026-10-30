import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { MissionRuntime } from "../../../src/vajra/mission/runtime";
import { SqliteOperationalStateStore } from "../../../src/persistence/vajra/sqlite-operational-state-store";
import { ICoordinationDispatcher } from "../../../src/vajra/ports/coordination";
import { IObservationReceiver } from "../../../src/vajra/ports/observation";
import { IVerificationEvaluator } from "../../../src/vajra/ports/verification";
import { createMissionDefinition, createMissionStep } from "../../../src/contracts/mission/mission-definition";
import { createMissionState } from "../../../src/contracts/mission/mission-state";
import { createVajraMissionRecord, createVajraStepRecord } from "../../../src/vajra/types/mission-record";
import { CorrelationMetadata, Result } from "../../../src/contracts/results/result";
import { Observation } from "../../../src/contracts/events/observation";
import { VerificationRecord } from "../../../src/contracts/capabilities/verification";
import { MissionRuntimeEvent } from "../../../src/vajra/mission/types";

describe("MissionRuntime (Phase 6 Orchestration, Lifecycle & Verification)", () => {
  let db: Database.Database;
  let stateStore: SqliteOperationalStateStore;

  const correlation: CorrelationMetadata = {
    requestId: "req-rnt-01",
    correlationId: "corr-rnt-01",
    invocationId: "inv-rnt-01",
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

  const setupMission = async (
    missionId: string,
    stepsCount: number,
    confirmationRequired: boolean = false,
  ) => {
    const steps = Array.from({ length: stepsCount }, (_, i) =>
      createMissionStep({
        id: `step-${missionId}-${i + 1}`,
        missionId,
        stepOrder: i + 1,
        description: `Step ${i + 1}`,
        targetCapability: "system.echo",
        input: { msg: `test-${i + 1}` },
        expectedEvidence: `evidence.${i + 1}.ok`,
      }),
    );

    const def = createMissionDefinition({
      id: missionId,
      objective: `Execute mission ${missionId}`,
      steps,
      constraints: { maxSteps: stepsCount, confirmationRequired },
      completionCriteria: {
        description: "All steps done",
        requiredEvidence: steps.map((s) => s.expectedEvidence),
      },
      correlation,
    });

    const mission = createVajraMissionRecord({
      id: missionId,
      objective: def.objective,
      lifecycleState: "CREATED",
      definition: def,
      state: createMissionState({ missionId, definitionId: missionId }),
      allocatedBudget: { maxCostCents: 10, maxSteps: stepsCount },
      idempotencyKey: `idemp-${missionId}`,
      requestId: correlation.requestId,
      correlationId: correlation.correlationId,
      invocationId: correlation.invocationId,
    });

    const stepRecords = steps.map((s) =>
      createVajraStepRecord({
        id: s.id,
        missionId,
        stepOrder: s.stepOrder,
        description: s.description,
        targetCapability: s.targetCapability,
        input: s.input,
        expectedEvidence: s.expectedEvidence,
        idempotencyKey: `idemp-step-${s.id}`,
        correlationId: correlation.correlationId,
      }),
    );

    await stateStore.createMission(mission, stepRecords);
    return { def, mission, stepRecords };
  };

  it("executes multi-step mission end-to-end and emits lifecycle events in order", async () => {
    const { def } = await setupMission("m-multi-1", 2);

    const mockCoordinator: ICoordinationDispatcher = {
      dispatchStep: vi.fn(async (step) => {
        return Result.success({ output: `done-${step.id}` }, correlation);
      }),
    };

    const runtime = new MissionRuntime(stateStore, mockCoordinator);
    const events: MissionRuntimeEvent[] = [];
    runtime.onEvent((evt) => events.push(evt));

    const result = await runtime.executeMission(def.id);
    expect(result.lifecycleState).toBe("COMPLETED");

    // Verify events sequence
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toEqual([
      "MISSION_STARTED",
      "STEP_PRE_DISPATCHED",
      "STEP_EXECUTED",
      "STEP_VERIFIED",
      "STEP_PRE_DISPATCHED",
      "STEP_EXECUTED",
      "STEP_VERIFIED",
      "MISSION_COMPLETED",
    ]);

    // Verify all steps in SQLite are marked EXECUTED
    const stepsInDb = await stateStore.getStepsForMission(def.id);
    expect(stepsInDb.every((s) => s.dispatchState === "EXECUTED")).toBe(true);
  });

  it("enforces single running mission lock in SQLite", async () => {
    const { def: def1 } = await setupMission("m-lock-1", 1);
    const { def: def2 } = await setupMission("m-lock-2", 1);

    // Set first mission to RUNNING
    await stateStore.updateMissionLifecycle(def1.id, "RUNNING");

    const mockCoordinator: ICoordinationDispatcher = {
      dispatchStep: vi.fn(async () => Result.success({}, correlation)),
    };
    const runtime = new MissionRuntime(stateStore, mockCoordinator);

    // Attempting to run second mission concurrently triggers SQLite unique index constraint
    await expect(runtime.executeMission(def2.id)).rejects.toThrow();
  });

  it("ingests Contract K4 Observation and evaluates Contract K6 Verification", async () => {
    const { def } = await setupMission("m-verify-1", 1);

    const mockCoordinator: ICoordinationDispatcher = {
      dispatchStep: vi.fn(async () => Result.success({ payload: "test-data" }, correlation)),
    };

    let ingestedObservation: Observation | null = null;
    const mockObsReceiver: IObservationReceiver = {
      ingestObservation: vi.fn((obs) => {
        ingestedObservation = obs;
      }),
      getObservationsForMission: vi.fn(() => []),
      getObservationsForStep: vi.fn(() => []),
    };

    const mockVerification: IVerificationEvaluator = {
      evaluateStep: vi.fn((stepId, missionId, obs) => {
        const record: VerificationRecord = {
          id: `vr-${stepId}`,
          missionId,
          stepId,
          executionResultIds: [],
          observationIds: obs.map((o) => o.id),
          outcome: "criteria_satisfied",
          verifiedAt: new Date().toISOString(),
          correlation,
        };
        return record;
      }),
    };

    const runtime = new MissionRuntime(stateStore, mockCoordinator, mockObsReceiver, mockVerification);
    const result = await runtime.executeMission(def.id);

    expect(result.lifecycleState).toBe("COMPLETED");
    expect(ingestedObservation).toBeDefined();
    // Invariant: Observation producer, payload, and confidence conform to Contract K4
    expect(ingestedObservation?.producer).toBe("capability.system.echo");
    expect(ingestedObservation?.payload).toEqual({ payload: "test-data" });
    // Invariant: Unstated producer confidence is never given an arbitrary numerical baseline
    expect(ingestedObservation?.confidence).toBeUndefined();
  });

  it("preserves producer-supplied confidence exactly on Contract K4 Observation", async () => {
    const { def } = await setupMission("m-verify-producer-conf", 1);

    const mockCoordinator: ICoordinationDispatcher = {
      dispatchStep: vi.fn(async () =>
        Result.success({ payload: "grounded-data", confidence: 0.93 }, correlation),
      ),
    };

    let ingestedObservation: Observation | null = null;
    const mockObsReceiver: IObservationReceiver = {
      ingestObservation: vi.fn((obs) => {
        ingestedObservation = obs;
      }),
      getObservationsForMission: vi.fn(() => []),
      getObservationsForStep: vi.fn(() => []),
    };

    const mockVerification: IVerificationEvaluator = {
      evaluateStep: vi.fn((stepId, missionId, obs) => ({
        id: `vr-${stepId}`,
        missionId,
        stepId,
        executionResultIds: [],
        observationIds: obs.map((o) => o.id),
        outcome: "criteria_satisfied",
        verifiedAt: new Date().toISOString(),
        correlation,
      })),
    };

    const runtime = new MissionRuntime(stateStore, mockCoordinator, mockObsReceiver, mockVerification);
    const result = await runtime.executeMission(def.id);

    expect(result.lifecycleState).toBe("COMPLETED");
    expect(ingestedObservation).toBeDefined();
    expect(ingestedObservation?.confidence).toBe(0.93);
  });

  it("fails mission when verification criteria is not satisfied (Contract K6)", async () => {
    const { def } = await setupMission("m-verify-fail", 1);

    const mockCoordinator: ICoordinationDispatcher = {
      dispatchStep: vi.fn(async () => Result.success({ data: "invalid" }, correlation)),
    };

    const mockObsReceiver: IObservationReceiver = {
      ingestObservation: vi.fn(),
      getObservationsForMission: vi.fn(() => []),
      getObservationsForStep: vi.fn(() => []),
    };

    const mockVerification: IVerificationEvaluator = {
      evaluateStep: vi.fn((stepId, missionId, obs) => ({
        id: `vr-fail-${stepId}`,
        missionId,
        stepId,
        executionResultIds: [],
        observationIds: obs.map((o) => o.id),
        outcome: "criteria_not_satisfied", // Contradiction or failure
        verifiedAt: new Date().toISOString(),
        correlation,
      })),
    };

    const runtime = new MissionRuntime(stateStore, mockCoordinator, mockObsReceiver, mockVerification);
    const result = await runtime.executeMission(def.id);

    expect(result.lifecycleState).toBe("FAILED");
  });

  it("pauses mission at step 2 when confirmationRequired is true", async () => {
    const { def } = await setupMission("m-confirm-1", 2, true);

    const mockCoordinator: ICoordinationDispatcher = {
      dispatchStep: vi.fn(async () => Result.success({}, correlation)),
    };

    const runtime = new MissionRuntime(stateStore, mockCoordinator);
    const result = await runtime.executeMission(def.id);

    // Pauses before executing step 2
    expect(result.lifecycleState).toBe("PAUSED_APPROVAL");

    const steps = await stateStore.getStepsForMission(def.id);
    expect(steps[0].dispatchState).toBe("EXECUTED");
    expect(steps[1].dispatchState).toBe("PENDING");
  });

  it("handles manual pause and cancellation", async () => {
    const { def } = await setupMission("m-pause-cancel", 2);

    const mockCoordinator: ICoordinationDispatcher = {
      dispatchStep: vi.fn(async () => Result.success({}, correlation)),
    };

    const runtime = new MissionRuntime(stateStore, mockCoordinator);

    // Pause mission
    await runtime.pauseMission(def.id, "User requested pause");
    let mission = await stateStore.getMission(def.id);
    expect(mission?.lifecycleState).toBe("PAUSED_APPROVAL");

    // Cancel mission
    await runtime.cancelMission(def.id, "User cancelled");
    mission = await stateStore.getMission(def.id);
    expect(mission?.lifecycleState).toBe("CANCELLED");

    // Re-executing cancelled mission returns cancelled record immediately without running
    const resAfterCancel = await runtime.executeMission(def.id);
    expect(resAfterCancel.lifecycleState).toBe("CANCELLED");
    expect(mockCoordinator.dispatchStep).not.toHaveBeenCalled();
  });
});
