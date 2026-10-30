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

describe("Verification Conflicts & Staleness (Phase 7 - Invariants K-P7-5, K-P7-6, K-P7-14)", () => {
  let db: Database.Database;
  let stateStore: SqliteOperationalStateStore;
  let evaluator: VerificationEvaluator;

  const correlation: CorrelationMetadata = {
    requestId: "req-conflict-01",
    correlationId: "corr-conflict-01",
    invocationId: "inv-conflict-01",
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
      targetCapability: "capability.file.write",
      input: { path: "target.txt" },
      expectedEvidence: "evidence.file.written",
    });

    const def = createMissionDefinition({
      id: missionId,
      objective: `Write file ${missionId}`,
      steps: [step],
      constraints: { maxSteps: 1, confirmationRequired: false },
      completionCriteria: {
        description: "File write completed",
        requiredEvidence: ["evidence.file.written"],
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

  it("yields criteria_not_satisfied when an authoritative probe demonstrates the target state does not exist", async () => {
    await setupMission("mission-conf-1", "step-conf-1");

    // Success reported by file write capability
    const capabilityObs = createObservation({
      producer: "capability.file.write",
      subject: "step-conf-1",
      payload: { ok: true, evidenceToken: "evidence.file.written" },
      confidence: 0.95,
      provenance: "Write command exit code 0",
      correlation: {
        requestId: correlation.requestId,
        correlationId: correlation.correlationId,
        invocationId: correlation.invocationId,
        missionId: "mission-conf-1",
        stepId: "step-conf-1",
        executionId: "exec-write-1",
      },
    });

    // But direct filesystem probe confirms target file does not exist
    const probeObs = createObservation({
      producer: "probe.fs.exists",
      subject: "step-conf-1",
      payload: { exists: false, path: "target.txt" },
      confidence: 0.99,
      provenance: "Direct stat on file system returned ENOENT",
      correlation: {
        requestId: correlation.requestId,
        correlationId: correlation.correlationId,
        invocationId: correlation.invocationId,
        missionId: "mission-conf-1",
        stepId: "step-conf-1",
      },
    });

    const criteria: CompletionCriteria = {
      description: "File write completed",
      requiredEvidence: ["evidence.file.written"],
    };

    const record = await evaluator.evaluateStepAsync(
      "step-conf-1",
      "mission-conf-1",
      [capabilityObs, probeObs],
      criteria,
    );

    // Contradiction detected: verified negative evidence blocks criteria_satisfied
    expect(record.outcome).toBe("criteria_not_satisfied");
    expect(record.rationale).toContain("Contradictory evidence detected");
    expect(record.rationale).toContain("probe.fs.exists");
  });

  it("detects context version drift between dispatch and evaluation, yielding inconclusive", async () => {
    await setupMission("mission-conf-2", "step-conf-2");

    const obs = createObservation({
      producer: "capability.file.write",
      subject: "step-conf-2",
      payload: { ok: true, evidenceToken: "evidence.file.written" },
      confidence: 0.95,
      provenance: "Execution result",
      correlation: {
        requestId: correlation.requestId,
        correlationId: correlation.correlationId,
        invocationId: correlation.invocationId,
        missionId: "mission-conf-2",
        stepId: "step-conf-2",
      },
    });

    const criteria: CompletionCriteria = {
      description: "File write completed",
      requiredEvidence: ["evidence.file.written"],
    };

    // Step was dispatched at context version 1, but by evaluation time context is at version 2 (concurrent mutation)
    const record = await evaluator.evaluateStepAsync(
      "step-conf-2",
      "mission-conf-2",
      [obs],
      criteria,
      {
        initialContextVersion: 1,
        currentContextVersion: 2,
      },
    );

    expect(record.outcome).toBe("inconclusive");
    expect(record.rationale).toContain(
      "Context version drifted between dispatch (v1) and verification (v2)",
    );
  });

  it("rejects expired observations exceeding validity TTL, yielding inconclusive", async () => {
    await setupMission("mission-conf-3", "step-conf-3");

    // Observation timestamped 2 minutes ago
    const expiredTime = new Date(Date.now() - 120_000).toISOString();
    const expiredObs = {
      ...createObservation({
        producer: "capability.file.write",
        subject: "step-conf-3",
        payload: { ok: true, evidenceToken: "evidence.file.written" },
        confidence: 0.95,
        provenance: "Old execution",
        correlation: {
          requestId: correlation.requestId,
          correlationId: correlation.correlationId,
          invocationId: correlation.invocationId,
          missionId: "mission-conf-3",
          stepId: "step-conf-3",
        },
      }),
      observationTime: expiredTime,
    };

    const criteria: CompletionCriteria = {
      description: "File write completed",
      requiredEvidence: ["evidence.file.written"],
    };

    // Evaluate with 60,000ms TTL
    const record = await evaluator.evaluateStepAsync(
      "step-conf-3",
      "mission-conf-3",
      [expiredObs],
      criteria,
      { ttlMs: 60_000 },
    );

    expect(record.outcome).toBe("inconclusive");
    expect(record.rationale).toContain("expired (TTL: 60000ms)");
  });

  it("enforces blast door: zero numerical confidence averaging or Bayesian heuristics", async () => {
    await setupMission("mission-conf-4", "step-conf-4");

    const obs1 = createObservation({
      producer: "telemetry.a",
      subject: "step-conf-4",
      payload: { ok: true, evidenceToken: "evidence.file.written" },
      confidence: 0.6,
      provenance: "Telemetry A",
      correlation: {
        requestId: correlation.requestId,
        correlationId: correlation.correlationId,
        invocationId: correlation.invocationId,
        missionId: "mission-conf-4",
        stepId: "step-conf-4",
      },
    });

    const obs2 = createObservation({
      producer: "telemetry.b",
      subject: "step-conf-4",
      payload: { ok: true, evidenceToken: "evidence.file.written" },
      confidence: 0.7,
      provenance: "Telemetry B",
      correlation: {
        requestId: correlation.requestId,
        correlationId: correlation.correlationId,
        invocationId: correlation.invocationId,
        missionId: "mission-conf-4",
        stepId: "step-conf-4",
      },
    });

    const criteria: CompletionCriteria = {
      description: "Evidence verified",
      requiredEvidence: ["evidence.file.written"],
    };

    const record = await evaluator.evaluateStepAsync(
      "step-conf-4",
      "mission-conf-4",
      [obs1, obs2],
      criteria,
    );

    // Criteria are satisfied deterministically through uncontradicted matching evidence,
    // NOT through a synthesized average confidence (e.g. (0.6 + 0.7)/2 = 0.65).
    expect(record.outcome).toBe("criteria_satisfied");
    expect(record.observationIds).toHaveLength(2);
    expect(record.rationale).toContain("deterministically verified");
  });
});
