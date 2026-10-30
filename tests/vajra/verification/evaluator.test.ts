import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { VerificationEvaluator } from "../../../src/vajra/verification/evaluator";
import { SqliteOperationalStateStore } from "../../../src/persistence/vajra/sqlite-operational-state-store";
import { createObservation } from "../../../src/contracts/events/observation";
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

describe("VerificationEvaluator (Phase 7 - Contract K6, Invariants I8 & I9)", () => {
  let db: Database.Database;
  let stateStore: SqliteOperationalStateStore;
  let evaluator: VerificationEvaluator;

  const correlation: CorrelationMetadata = {
    requestId: "req-eval-01",
    correlationId: "corr-eval-01",
    invocationId: "inv-eval-01",
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
    evaluator = new VerificationEvaluator(stateStore);
  });

  afterEach(() => {
    db.close();
  });

  const setupMission = async (missionId: string, stepId: string) => {
    const step = createMissionStep({
      id: stepId,
      missionId,
      stepOrder: 1,
      description: `Step ${stepId}`,
      targetCapability: "capability.test",
      input: {},
      expectedEvidence: "evidence.test.ok",
    });

    const def = createMissionDefinition({
      id: missionId,
      objective: `Objective for ${missionId}`,
      steps: [step],
      constraints: { maxSteps: 1, confirmationRequired: false },
      completionCriteria: {
        description: "Test completion",
        requiredEvidence: ["evidence.test.ok"],
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
      idempotencyKey: `idemp-${stepId}`,
      correlationId: correlation.correlationId,
    });

    await stateStore.createMission(mission, [stepRecord]);
    return { def, mission, stepRecord };
  };

  it("produces criteria_satisfied when observations deterministically satisfy criteria", async () => {
    await setupMission("mission-201", "step-201");

    const obs = createObservation({
      producer: "capability.workspace.format",
      subject: "step-201",
      payload: { ok: true, formatted: true },
      confidence: 0.95,
      provenance: "Format execution result",
      correlation: {
        requestId: "req-201",
        correlationId: "corr-201",
        invocationId: "inv-201",
        missionId: "mission-201",
        stepId: "step-201",
        executionId: "exec-201",
      },
    });

    const criteria: CompletionCriteria = {
      description: "Code is formatted",
      requiredEvidence: ["formatted"],
    };

    const record = await evaluator.evaluateStepAsync("step-201", "mission-201", [obs], criteria);

    expect(record.outcome).toBe("criteria_satisfied");
    expect(record.missionId).toBe("mission-201");
    expect(record.stepId).toBe("step-201");
    expect(record.observationIds).toContain(obs.id);
    expect(record.executionResultIds).toContain("exec-201");

    // Must be durably saved in SQLite vajra_verifications table
    const stored = await stateStore.getVerificationsForStep("step-201");
    expect(stored).toHaveLength(1);
    expect(stored[0].outcome).toBe("criteria_satisfied");
    expect(stored[0].id).toBe(record.id);
  });

  it("yields inconclusive when required evidence token is missing", async () => {
    await setupMission("mission-202", "step-202");

    const obs = createObservation({
      producer: "capability.test.run",
      subject: "step-202",
      payload: { unrelatedKey: true },
      confidence: 0.9,
      provenance: "Test runner",
      correlation: {
        requestId: "req-202",
        correlationId: "corr-202",
        invocationId: "inv-202",
        missionId: "mission-202",
        stepId: "step-202",
      },
    });

    const criteria: CompletionCriteria = {
      description: "Must provide test coverage evidence",
      requiredEvidence: ["evidence.test.coverage.ok"],
    };

    const record = await evaluator.evaluateStepAsync("step-202", "mission-202", [obs], criteria);

    expect(record.outcome).toBe("inconclusive");
    expect(record.rationale).toContain(
      "Missing required evidence token 'evidence.test.coverage.ok'",
    );

    const stored = await stateStore.getVerificationsForStep("step-202");
    expect(stored).toHaveLength(1);
    expect(stored[0].outcome).toBe("inconclusive");
  });

  it("yields criteria_not_satisfied when execution definitively fails with negative proof", async () => {
    await setupMission("mission-203", "step-203");

    const obs = createObservation({
      producer: "capability.file.write",
      subject: "step-203",
      payload: { error: "disk_full", ok: false },
      confidence: 1.0,
      provenance: "Disk write handler",
      correlation: {
        requestId: "req-203",
        correlationId: "corr-203",
        invocationId: "inv-203",
        missionId: "mission-203",
        stepId: "step-203",
      },
    });

    const criteria: CompletionCriteria = {
      description: "File is written",
    };

    const record = await evaluator.evaluateStepAsync("step-203", "mission-203", [obs], criteria, {
      isDefinitiveNegative: true,
    });

    expect(record.outcome).toBe("criteria_not_satisfied");
    expect(record.rationale).toContain("Definitive execution failure");
  });

  it("yields inconclusive on indeterminate execution failure (never converts unknown into false negative)", async () => {
    await setupMission("mission-204", "step-204");

    const criteria: CompletionCriteria = {
      description: "Network webhook fired",
    };

    const record = await evaluator.evaluateStepAsync("step-204", "mission-204", [], criteria, {
      isIndeterminateFailure: true,
    });

    // Blast door: transport/timeout failure does not prove real-world outcome failed
    expect(record.outcome).toBe("inconclusive");
    expect(record.rationale).toContain("indeterminate outcome");
    expect(record.rationale).toContain("PAUSED_RECOVERY");
  });

  it("enforces pre-dispatch temporal guard: rejects stale observations preceding dispatch timestamp", async () => {
    await setupMission("mission-205", "step-205");

    const dispatchTime = "2026-10-04T12:00:00.000Z";
    const priorObservationTime = "2026-10-04T11:59:59.000Z";

    // Observation timestamped before step dispatch
    const staleObs = {
      ...createObservation({
        producer: "capability.git.status",
        subject: "step-205",
        payload: { clean: true },
        confidence: 0.9,
        provenance: "Previous status check",
        correlation: {
          requestId: "req-205",
          correlationId: "corr-205",
          invocationId: "inv-205",
          missionId: "mission-205",
          stepId: "step-205",
        },
      }),
      observationTime: priorObservationTime,
    };

    const criteria: CompletionCriteria = {
      description: "Working tree is clean",
      requiredEvidence: ["clean"],
    };

    const record = await evaluator.evaluateStepAsync(
      "step-205",
      "mission-205",
      [staleObs],
      criteria,
      { stepDispatchedAt: dispatchTime },
    );

    expect(record.outcome).toBe("inconclusive");
    expect(record.rationale).toContain("stale (prior to step dispatch");
  });

  it("enforces model proposal blast door: untrusted model candidate cannot independently create satisfaction", async () => {
    await setupMission("mission-206", "step-206");

    const criteria: CompletionCriteria = {
      description: "Summary accurately reflects notes",
    };

    const obs = createObservation({
      producer: "capability.summary.generate",
      subject: "step-206",
      payload: { text: "Generated summary" },
      confidence: 0.8,
      provenance: "Model generation",
      correlation: {
        requestId: "req-206",
        correlationId: "corr-206",
        invocationId: "inv-206",
        missionId: "mission-206",
        stepId: "step-206",
      },
    });

    // Untrusted model proposal flags that summary failed semantic accuracy
    const record = await evaluator.evaluateStepAsync("step-206", "mission-206", [obs], criteria, {
      untrustedModelProposal: {
        candidateJudgement: "not_satisfied",
        confidence: 0.9,
        explanation: "Omitted critical action items",
      },
    });

    expect(record.outcome).toBe("criteria_not_satisfied");
    expect(record.rationale).toContain(
      "Semantic verification rejected: Omitted critical action items",
    );
  });

  it("validates payload against expectedOutcomeSchema descriptor", async () => {
    await setupMission("mission-207", "step-207");

    const obs = createObservation({
      producer: "capability.calculator",
      subject: "step-207",
      payload: { count: 42, status: "ok" },
      confidence: 1.0,
      provenance: "Calculation",
      correlation: {
        requestId: "req-207",
        correlationId: "corr-207",
        invocationId: "inv-207",
        missionId: "mission-207",
        stepId: "step-207",
      },
    });

    const matchingCriteria: CompletionCriteria = {
      description: "Count is 42",
      expectedOutcomeSchema: { count: 42, status: "ok" },
    };

    const recordPass = await evaluator.evaluateStepAsync(
      "step-207",
      "mission-207",
      [obs],
      matchingCriteria,
    );
    expect(recordPass.outcome).toBe("criteria_satisfied");

    const mismatchCriteria: CompletionCriteria = {
      description: "Count is 99",
      expectedOutcomeSchema: { count: 99 },
    };

    const recordFail = await evaluator.evaluateStepAsync(
      "step-207",
      "mission-207",
      [obs],
      mismatchCriteria,
    );
    expect(recordFail.outcome).toBe("criteria_not_satisfied");
    expect(recordFail.rationale).toContain("does not match expected '99'");
  });
});
