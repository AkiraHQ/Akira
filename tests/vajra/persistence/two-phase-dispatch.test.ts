import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { SqliteOperationalStateStore } from "../../../src/persistence/vajra/sqlite-operational-state-store";
import {
  createVajraMissionRecord,
  createVajraStepRecord,
} from "../../../src/vajra/types/mission-record";
import { createMissionDefinition } from "../../../src/contracts/mission/mission-definition";
import { createMissionState } from "../../../src/contracts/mission/mission-state";

describe("Two-Phase Dispatch Protocol Tests", () => {
  let db: Database.Database;
  let store: SqliteOperationalStateStore;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    // Apply bootstrap schema
    const schemaPath = path.join(process.cwd(), "src", "persistence", "schema.sql");
    db.exec(fs.readFileSync(schemaPath, "utf8"));
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (1, ?)").run(
      new Date().toISOString(),
    );

    // Apply migration 003
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

    store = new SqliteOperationalStateStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("executes the full Two-Phase Dispatch protocol without holding a transaction during execution", async () => {
    const def = createMissionDefinition({
      objective: "Read workspace file",
      steps: [],
      completionCriteria: { description: "file read", requiredEvidence: ["obs-file"] },
      correlation: { requestId: "r-tpd", correlationId: "c-tpd", invocationId: "i-tpd" },
    });
    const st = createMissionState({ missionId: "m-tpd", definitionId: "d-tpd" });

    const mission = createVajraMissionRecord({
      id: "m-tpd",
      objective: "Read workspace file",
      lifecycleState: "RUNNING",
      definition: def,
      state: st,
      allocatedBudget: { maxCostCents: 10, maxSteps: 1 },
      idempotencyKey: "k-m-tpd",
      requestId: "r-tpd",
      correlationId: "c-tpd",
      invocationId: "i-tpd",
    });

    const step = createVajraStepRecord({
      id: "s-tpd-1",
      missionId: "m-tpd",
      stepOrder: 1,
      description: "Read package.json",
      targetCapability: "fs.read",
      input: { path: "package.json" },
      expectedEvidence: "file_content",
      dispatchState: "PENDING",
      idempotencyKey: "k-s-tpd-1",
      correlationId: "c-tpd",
    });

    await store.createMission(mission, [step]);

    // --- PHASE 1: Pre-Dispatch (Database Transaction) ---
    await store.preDispatchStep("s-tpd-1", "k-s-tpd-1");

    const preDispatched = await store.getStep("s-tpd-1");
    expect(preDispatched?.dispatchState).toBe("DISPATCHED");
    expect(preDispatched?.dispatchedAt).toBeDefined();
    expect(preDispatched?.executionResultId).toBeNull();

    // Verify DB is NOT in a transaction after preDispatchStep returns
    expect(db.inTransaction).toBe(false);

    // --- PHASE 2: External Capability Execution (OUTSIDE SQLite Transaction) ---
    // Assert invariant: SQLite must NOT be in a transaction while capability runs
    const fakeExternalExecution = async () => {
      // Invariant check
      expect(db.inTransaction).toBe(false);
      // Simulate async capability invocation delay
      await new Promise((r) => setTimeout(r, 10));
      return { resultId: "res-001-success" };
    };

    const executionResult = await fakeExternalExecution();
    expect(db.inTransaction).toBe(false);

    // --- PHASE 3: Post-Execution (Database Transaction) ---
    await store.recordStepExecution("s-tpd-1", executionResult.resultId);

    const executed = await store.getStep("s-tpd-1");
    expect(executed?.dispatchState).toBe("EXECUTED");
    expect(executed?.executionResultId).toBe("res-001-success");
    expect(executed?.executedAt).toBeDefined();
    expect(db.inTransaction).toBe(false);
  });

  it("handles capability failure in Phase 3 without losing audit state", async () => {
    const def = createMissionDefinition({
      objective: "Failing step",
      steps: [],
      completionCriteria: { description: "done", requiredEvidence: [] },
      correlation: { requestId: "r-fail", correlationId: "c-fail", invocationId: "i-fail" },
    });
    const st = createMissionState({ missionId: "m-fail", definitionId: "d-fail" });

    const mission = createVajraMissionRecord({
      id: "m-fail",
      objective: "Failing step",
      lifecycleState: "RUNNING",
      definition: def,
      state: st,
      allocatedBudget: { maxCostCents: 10, maxSteps: 1 },
      idempotencyKey: "k-m-fail",
      requestId: "r-fail",
      correlationId: "c-fail",
      invocationId: "i-fail",
    });

    const step = createVajraStepRecord({
      id: "s-fail-1",
      missionId: "m-fail",
      stepOrder: 1,
      description: "Fail step",
      targetCapability: "network.fetch",
      input: { url: "https://invalid.test" },
      expectedEvidence: "response",
      dispatchState: "PENDING",
      idempotencyKey: "k-s-fail-1",
      correlationId: "c-fail",
    });

    await store.createMission(mission, [step]);

    // Pre-dispatch
    await store.preDispatchStep("s-fail-1", "k-s-fail-1");

    // Simulated async failure outside transaction
    expect(db.inTransaction).toBe(false);
    const failurePayload = { error: "Network timeout", code: "ETIMEDOUT" };

    // Post-execution failure
    await store.failStep("s-fail-1", failurePayload);

    const failedStep = await store.getStep("s-fail-1");
    expect(failedStep?.dispatchState).toBe("FAILED");
    expect(failedStep?.executionError).toEqual(failurePayload);
    expect(failedStep?.executedAt).toBeDefined();
  });

  it("preserves DISPATCHED state across crash simulation when interrupted before Phase 3", async () => {
    const def = createMissionDefinition({
      objective: "Crash step",
      steps: [],
      completionCriteria: { description: "done", requiredEvidence: [] },
      correlation: { requestId: "r-crash", correlationId: "c-crash", invocationId: "i-crash" },
    });
    const st = createMissionState({ missionId: "m-crash", definitionId: "d-crash" });

    const mission = createVajraMissionRecord({
      id: "m-crash",
      objective: "Crash step",
      lifecycleState: "RUNNING",
      definition: def,
      state: st,
      allocatedBudget: { maxCostCents: 10, maxSteps: 1 },
      idempotencyKey: "k-m-crash",
      requestId: "r-crash",
      correlationId: "c-crash",
      invocationId: "i-crash",
    });

    const step = createVajraStepRecord({
      id: "s-crash-1",
      missionId: "m-crash",
      stepOrder: 1,
      description: "Interrupted step",
      targetCapability: "shell.run",
      input: { cmd: "long-process" },
      expectedEvidence: "exit_code",
      dispatchState: "PENDING",
      idempotencyKey: "k-s-crash-1",
      correlationId: "c-crash",
    });

    await store.createMission(mission, [step]);

    // Step pre-dispatched
    await store.preDispatchStep("s-crash-1", "k-s-crash-1");

    // Simulated process exit / crash happens here:
    // (no Phase 3 post-dispatch call was made)

    // Upon restart, querying step shows DISPATCHED with null executionResultId
    const interruptedStep = await store.getStep("s-crash-1");
    expect(interruptedStep?.dispatchState).toBe("DISPATCHED");
    expect(interruptedStep?.executionResultId).toBeNull();
  });
});
