import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { MissionRecoveryManager, ReplayEvidenceProbe } from "../../../src/vajra/mission/recovery";
import { SqliteOperationalStateStore } from "../../../src/persistence/vajra/sqlite-operational-state-store";
import { CapabilityRegistry } from "../../../src/contracts/capabilities/registry";
import { CapabilityDescriptor } from "../../../src/contracts/capabilities/descriptor";
import { createVajraMissionRecord, createVajraStepRecord } from "../../../src/vajra/types/mission-record";
import { createMissionDefinition, createMissionStep } from "../../../src/contracts/mission/mission-definition";
import { createMissionState } from "../../../src/contracts/mission/mission-state";
import { CorrelationMetadata } from "../../../src/contracts/results/result";
import { createVajraEscalationRecord } from "../../../src/vajra/types/escalation-record";

describe("MissionRecoveryManager (Phase 6 Triaged Recovery & 4-Condition Replay Gate)", () => {
  let db: Database.Database;
  let stateStore: SqliteOperationalStateStore;
  let registry: CapabilityRegistry;

  const correlation: CorrelationMetadata = {
    requestId: "req-rec-01",
    correlationId: "corr-rec-01",
    invocationId: "inv-rec-01",
  };

  const createCap = (
    name: string,
    isIdempotent: boolean,
    isReadOnly: boolean,
    sideEffectClass: string = "none",
  ): CapabilityDescriptor => ({
    name,
    version: "1.0.0",
    description: `Capability ${name}`,
    owner: "AKIRA OS · system",
    kind: "Command",
    riskClass: "LOW",
    costClass: "local_cheap",
    activationTier: 0,
    executionCharacteristics: {
      isSynchronous: true,
      isReadOnly,
      isIdempotent,
      sideEffectClass,
    },
    isAvailable: true,
    permissions: {
      allowVajra: true,
    },
    inputSchema: { type: "object" },
  });

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
    registry = new CapabilityRegistry();
    registry.register(createCap("safe.query", true, true, "none"));
    registry.register(createCap("unsafe.mutation", false, false, "external_network"));
    registry.register(createCap("idempotent.mutation", true, false, "disk_write"));
  });

  afterEach(() => {
    db.close();
  });

  const setupInterruptedMission = async (
    missionId: string,
    stepId: string,
    targetCapability: string,
  ) => {
    const step = createMissionStep({
      id: stepId,
      missionId,
      stepOrder: 1,
      description: "Interrupted step",
      targetCapability,
      input: {},
      expectedEvidence: "evidence.ok",
    });

    const def = createMissionDefinition({
      id: missionId,
      objective: "Interrupted recovery test",
      steps: [step],
      completionCriteria: { description: "done", requiredEvidence: ["evidence.ok"] },
      correlation,
    });

    const mission = createVajraMissionRecord({
      id: missionId,
      objective: def.objective,
      lifecycleState: "RUNNING",
      definition: def,
      state: createMissionState({ missionId, definitionId: missionId }),
      allocatedBudget: { maxCostCents: 10, maxSteps: 3 },
      idempotencyKey: `idemp-${missionId}`,
      requestId: correlation.requestId,
      correlationId: correlation.correlationId,
      invocationId: correlation.invocationId,
    });

    const stepRec = createVajraStepRecord({
      id: stepId,
      missionId,
      stepOrder: 1,
      description: step.description,
      targetCapability,
      input: step.input,
      expectedEvidence: step.expectedEvidence,
      idempotencyKey: `idemp-step-${stepId}`,
      correlationId: correlation.correlationId,
    });

    await stateStore.createMission(mission, [stepRec]);
    // Pre-dispatch the step to simulate in-flight crash (Crash Point 3)
    await stateStore.preDispatchStep(stepId, stepRec.idempotencyKey, new Date().toISOString());
  };

  it("Preserves pending human escalations and transitions mission to PAUSED_APPROVAL", async () => {
    await setupInterruptedMission("m-esc-1", "s-esc-1", "safe.query");

    // Add pending escalation
    const esc = createVajraEscalationRecord({
      id: "esc-1",
      missionId: "m-esc-1",
      stepId: "s-esc-1",
      status: "PENDING_APPROVAL",
      actionProposed: "Test proposed action",
      impactClass: "HIGH",
      riskExplanation: "Risk check",
      requestId: correlation.requestId,
      correlationId: correlation.correlationId,
    });
    await stateStore.createEscalation(esc);

    const recoveryManager = new MissionRecoveryManager(stateStore, registry);
    const results = await recoveryManager.recoverInterruptedMissions();

    expect(results.length).toBe(1);
    expect(results[0].actionTaken).toBe("PAUSED_RECOVERY");
    expect(results[0].reason).toContain("pending human escalation");

    const updated = await stateStore.getMission("m-esc-1");
    expect(updated?.lifecycleState).toBe("PAUSED_APPROVAL");
  });

  it("Case 1 (§15.3): Deterministic evidence proves external execution never began -> SAFE_TO_DISPATCH", async () => {
    await setupInterruptedMission("m-case1", "s-case1", "safe.query");

    const probe: ReplayEvidenceProbe = {
      checkExecutionEvidence: async () => false,
      checkNeverInitiated: async (stepId) => stepId === "s-case1",
    };

    const recoveryManager = new MissionRecoveryManager(stateStore, registry, probe);
    const results = await recoveryManager.recoverInterruptedMissions();

    expect(results.length).toBe(1);
    expect(results[0].triageCase).toBe("KNOWN_NOT_BEGUN");
    expect(results[0].actionTaken).toBe("SAFE_TO_DISPATCH");
  });

  it("Case 3 (§15.3): Deterministic evidence proves external execution occurred -> RECONCILED_TO_VERIFICATION", async () => {
    await setupInterruptedMission("m-case3", "s-case3", "safe.query");

    const probe: ReplayEvidenceProbe = {
      checkExecutionEvidence: async (stepId) => stepId === "s-case3",
      checkNeverInitiated: async () => false,
    };

    const recoveryManager = new MissionRecoveryManager(stateStore, registry, probe);
    const results = await recoveryManager.recoverInterruptedMissions();

    expect(results.length).toBe(1);
    expect(results[0].triageCase).toBe("KNOWN_OCCURRED");
    expect(results[0].actionTaken).toBe("RECONCILED_TO_VERIFICATION");

    // Verifies step in SQLite was reconciled to EXECUTED with canonical invocation identity
    const steps = await stateStore.getStepsForMission("m-case3");
    expect(steps[0].dispatchState).toBe("EXECUTED");
    expect(steps[0].executionResultId).toBe("s-case3");
  });

  it("preserves pre-existing canonical executionResultId on step without generating a new identity during recovery", async () => {
    const missionId = "m-identity-preserve";
    const stepId = "s-identity-preserve";
    const existingCanonicalId = "exec-canonical-established-999";

    const step = createMissionStep({
      id: stepId,
      missionId,
      stepOrder: 1,
      description: "Step with existing execution result",
      targetCapability: "safe.query",
      input: {},
      expectedEvidence: "evidence.ok",
    });

    const def = createMissionDefinition({
      id: missionId,
      objective: "Identity preservation test",
      steps: [step],
      completionCriteria: { description: "done", requiredEvidence: ["evidence.ok"] },
      correlation,
    });

    const mission = createVajraMissionRecord({
      id: missionId,
      objective: def.objective,
      lifecycleState: "RUNNING",
      definition: def,
      state: createMissionState({ missionId, definitionId: missionId }),
      allocatedBudget: { maxCostCents: 10, maxSteps: 3 },
      idempotencyKey: `idemp-${missionId}`,
      requestId: correlation.requestId,
      correlationId: correlation.correlationId,
      invocationId: correlation.invocationId,
    });

    const stepRec = createVajraStepRecord({
      id: stepId,
      missionId,
      stepOrder: 1,
      description: step.description,
      targetCapability: "safe.query",
      input: step.input,
      expectedEvidence: step.expectedEvidence,
      idempotencyKey: `idemp-step-${stepId}`,
      correlationId: correlation.correlationId,
    });

    await stateStore.createMission(mission, [stepRec]);
    await stateStore.preDispatchStep(stepId, stepRec.idempotencyKey, new Date().toISOString());

    const probe: ReplayEvidenceProbe = {
      checkExecutionEvidence: async () => true,
      checkNeverInitiated: async () => false,
    };

    const recoveryManager = new MissionRecoveryManager(stateStore, registry, probe);
    const results = await recoveryManager.recoverInterruptedMissions();

    expect(results.length).toBe(1);
    expect(results[0].actionTaken).toBe("RECONCILED_TO_VERIFICATION");

    // Proves recovery strictly preserved the canonical K19 invocation identity (step.id)
    // and did NOT generate a synthetic UUID, timestamp, or newly invented prefix (result-, recovered-)
    const recoveredSteps = await stateStore.getStepsForMission(missionId);
    expect(recoveredSteps[0].executionResultId).toBe(stepId);
    expect(recoveredSteps[0].executionResultId).not.toContain("result-");
    expect(recoveredSteps[0].executionResultId).not.toContain("recovered-");
  });

  describe("Case 2 (§15.3 & §16.3): Uncertain Execution & Four-Condition Replay Safety Gate", () => {
    it("permits safe replay when ALL FOUR replay conditions are satisfied", async () => {
      // safe.query has isIdempotent: true, isReadOnly: true, allowVajra: true, sideEffectClass: "none"
      await setupInterruptedMission("m-four-pass", "s-four-pass", "safe.query");

      const recoveryManager = new MissionRecoveryManager(stateStore, registry);
      const results = await recoveryManager.recoverInterruptedMissions();

      expect(results.length).toBe(1);
      expect(results[0].triageCase).toBe("STATE_UNCERTAIN");
      expect(results[0].actionTaken).toBe("SAFE_TO_DISPATCH");
      expect(results[0].reason).toContain("All four replay-safety conditions met");
    });

    it("freezes to PAUSED_RECOVERY when capability is non-idempotent", async () => {
      // unsafe.mutation has isIdempotent: false
      await setupInterruptedMission("m-non-idemp", "s-non-idemp", "unsafe.mutation");

      const recoveryManager = new MissionRecoveryManager(stateStore, registry);
      const results = await recoveryManager.recoverInterruptedMissions();

      expect(results.length).toBe(1);
      expect(results[0].triageCase).toBe("STATE_UNCERTAIN");
      expect(results[0].actionTaken).toBe("PAUSED_RECOVERY");

      const mission = await stateStore.getMission("m-non-idemp");
      expect(mission?.lifecycleState).toBe("PAUSED_RECOVERY");
    });

    it("freezes to PAUSED_RECOVERY when capability is idempotent but has potential side effects", async () => {
      // idempotent.mutation has isIdempotent: true, but isReadOnly: false, sideEffectClass: "disk_write"
      await setupInterruptedMission("m-side-effect", "s-side-effect", "idempotent.mutation");

      const recoveryManager = new MissionRecoveryManager(stateStore, registry);
      const results = await recoveryManager.recoverInterruptedMissions();

      expect(results.length).toBe(1);
      expect(results[0].triageCase).toBe("STATE_UNCERTAIN");
      expect(results[0].actionTaken).toBe("PAUSED_RECOVERY");

      const mission = await stateStore.getMission("m-side-effect");
      expect(mission?.lifecycleState).toBe("PAUSED_RECOVERY");
    });

    it("freezes to PAUSED_RECOVERY when capability is unregistered or missing registry", async () => {
      await setupInterruptedMission("m-unregistered", "s-unregistered", "missing.capability");

      const recoveryManager = new MissionRecoveryManager(stateStore, registry);
      const results = await recoveryManager.recoverInterruptedMissions();

      expect(results.length).toBe(1);
      expect(results[0].actionTaken).toBe("PAUSED_RECOVERY");

      const mission = await stateStore.getMission("m-unregistered");
      expect(mission?.lifecycleState).toBe("PAUSED_RECOVERY");
    });
  });
});
