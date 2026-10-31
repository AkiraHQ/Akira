import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { MissionRecoveryManager, ReplayEvidenceProbe } from "../../../src/vajra/mission/recovery";
import { SqliteOperationalStateStore } from "../../../src/persistence/vajra/sqlite-operational-state-store";
import { CapabilityRegistry } from "../../../src/contracts/capabilities/registry";
import { CapabilityDescriptor } from "../../../src/contracts/capabilities/descriptor";
import {
  createVajraMissionRecord,
  createVajraStepRecord,
} from "../../../src/vajra/types/mission-record";
import {
  createMissionDefinition,
  createMissionStep,
} from "../../../src/contracts/mission/mission-definition";
import { createMissionState } from "../../../src/contracts/mission/mission-state";
import { CorrelationMetadata } from "../../../src/contracts/results/result";
import { createVajraEscalationRecord } from "../../../src/vajra/types/escalation-record";
import { MissionAdmissionGateway } from "../../../src/vajra/mission/admission";
import { createExecutiveAction } from "../../../src/vajra/types/action";

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

    db.prepare(
      `
      INSERT INTO vajra_operational_state (
        id, current_focus, operational_mode, active_mission_id, human_presence, system_health_status, version, updated_at
      ) VALUES ('singleton', 'Default focus', 'REQUEST_DRIVEN', NULL, 'FOCUSED_ACTIVE', 'NOMINAL', 1, ?)
    `,
    ).run(new Date().toISOString());

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

    // Classification is not execution: mission is paused and its active pointer
    // is cleared, while the durable step record remains available for explicit resume.
    expect((await stateStore.getMission("m-case1"))?.lifecycleState).toBe("PAUSED_RECOVERY");
    expect(await stateStore.getActiveMission()).toBeNull();
    expect((await stateStore.getStepsForMission("m-case1"))[0].dispatchState).toBe("DISPATCHED");

    const admission = new MissionAdmissionGateway(stateStore, registry);
    const nextAction = createExecutiveAction({
      id: "mission-after-recovery",
      kind: "start_mission",
      rationale: "Continue after recovery",
      confidence: 0.9,
      policyCompliance: true,
      correlation,
      requiredCapability: "safe.query",
    });
    expect((await admission.admitAction(nextAction)).status).toBe("ADMITTED");
  });

  it("keeps reconciled EXECUTED progress on a subsequent recovery and never redispatches", async () => {
    await setupInterruptedMission("m-repeat-recovery", "s-repeat-recovery", "safe.query");
    let evidenceChecks = 0;
    const probe: ReplayEvidenceProbe = {
      checkExecutionEvidence: async () => {
        evidenceChecks += 1;
        return true;
      },
      checkNeverInitiated: async () => false,
    };
    const recoveryManager = new MissionRecoveryManager(stateStore, registry, probe);

    const first = await recoveryManager.recoverInterruptedMissions();
    expect(first[0].actionTaken).toBe("RECONCILED_TO_VERIFICATION");
    expect((await stateStore.getStepsForMission("m-repeat-recovery"))[0].dispatchState).toBe(
      "EXECUTED",
    );

    // Simulate another process restart. No DISPATCHED step remains, so recovery
    // must preserve existing progress rather than terminally fail the mission.
    const second = await recoveryManager.recoverInterruptedMissions();
    expect(second[0].actionTaken).toBe("PAUSED_RECOVERY");
    expect((await stateStore.getMission("m-repeat-recovery"))?.lifecycleState).toBe(
      "PAUSED_RECOVERY",
    );
    const steps = await stateStore.getStepsForMission("m-repeat-recovery");
    expect(steps[0].dispatchState).toBe("EXECUTED");
    expect(steps[0].executionResultId).toBe("s-repeat-recovery");
    expect(evidenceChecks).toBe(1);
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

  // =========================================================================
  // AUD-01: SAFE_TO_DISPATCH Recovery Lockout Resolution
  // =========================================================================
  describe("AUD-01: SAFE_TO_DISPATCH recovery lockout resolution", () => {
    it("transitions SAFE_TO_DISPATCH mission to PAUSED_RECOVERY and clears active_mission_id (Case 1)", async () => {
      await setupInterruptedMission("m-aud01-c1", "s-aud01-c1", "safe.query");

      // Verify before recovery: mission was RUNNING and active_mission_id was set
      const rowBefore = db
        .prepare("SELECT active_mission_id FROM vajra_operational_state WHERE id = 'singleton'")
        .get() as { active_mission_id: string | null };
      expect(rowBefore.active_mission_id).toBe("m-aud01-c1");

      const probe: ReplayEvidenceProbe = {
        checkExecutionEvidence: async () => false,
        checkNeverInitiated: async (stepId) => stepId === "s-aud01-c1",
      };

      const recoveryManager = new MissionRecoveryManager(stateStore, registry, probe);
      const results = await recoveryManager.recoverInterruptedMissions();

      expect(results.length).toBe(1);
      expect(results[0].actionTaken).toBe("SAFE_TO_DISPATCH");

      // Mission transitioned to PAUSED_RECOVERY
      const recoveredMission = await stateStore.getMission("m-aud01-c1");
      expect(recoveredMission?.lifecycleState).toBe("PAUSED_RECOVERY");

      // active_mission_id cleared in singleton operational state
      const rowAfter = db
        .prepare("SELECT active_mission_id FROM vajra_operational_state WHERE id = 'singleton'")
        .get() as { active_mission_id: string | null };
      expect(rowAfter.active_mission_id).toBeNull();

      // Gate 6 in MissionAdmissionGateway allows future mission admission
      const admissionGateway = new MissionAdmissionGateway(stateStore, registry);
      const newAction = createExecutiveAction({
        id: "new-action-aud01",
        kind: "start_mission",
        confidence: 0.95,
        policyCompliance: true,
        correlation,
      });

      const outcome = await admissionGateway.admitAction(newAction);
      expect(outcome.status).not.toBe("CONCURRENCY_LOCKED");
    });

    it("transitions SAFE_TO_DISPATCH mission to PAUSED_RECOVERY and clears active_mission_id (Case 2)", async () => {
      // safe.query satisfies all 4 replay conditions
      await setupInterruptedMission("m-aud01-c2", "s-aud01-c2", "safe.query");

      const rowBefore = db
        .prepare("SELECT active_mission_id FROM vajra_operational_state WHERE id = 'singleton'")
        .get() as { active_mission_id: string | null };
      expect(rowBefore.active_mission_id).toBe("m-aud01-c2");

      const recoveryManager = new MissionRecoveryManager(stateStore, registry);
      const results = await recoveryManager.recoverInterruptedMissions();

      expect(results.length).toBe(1);
      expect(results[0].actionTaken).toBe("SAFE_TO_DISPATCH");

      const recoveredMission = await stateStore.getMission("m-aud01-c2");
      expect(recoveredMission?.lifecycleState).toBe("PAUSED_RECOVERY");

      const rowAfter = db
        .prepare("SELECT active_mission_id FROM vajra_operational_state WHERE id = 'singleton'")
        .get() as { active_mission_id: string | null };
      expect(rowAfter.active_mission_id).toBeNull();

      // Gate 6 does not lock out subsequent admissions
      const admissionGateway = new MissionAdmissionGateway(stateStore, registry);
      const newAction = createExecutiveAction({
        id: "new-action-aud01-c2",
        kind: "start_mission",
        confidence: 0.95,
        policyCompliance: true,
        correlation,
      });

      const outcome = await admissionGateway.admitAction(newAction);
      expect(outcome.status).not.toBe("CONCURRENCY_LOCKED");
    });

    it("transitions Case 3 RECONCILED_TO_VERIFICATION mission to PAUSED_RECOVERY and clears active_mission_id", async () => {
      await setupInterruptedMission("m-aud01-c3", "s-aud01-c3", "safe.query");

      const probe: ReplayEvidenceProbe = {
        checkExecutionEvidence: async (stepId) => stepId === "s-aud01-c3",
        checkNeverInitiated: async () => false,
      };

      const recoveryManager = new MissionRecoveryManager(stateStore, registry, probe);
      const results = await recoveryManager.recoverInterruptedMissions();

      expect(results.length).toBe(1);
      expect(results[0].actionTaken).toBe("RECONCILED_TO_VERIFICATION");

      const recoveredMission = await stateStore.getMission("m-aud01-c3");
      expect(recoveredMission?.lifecycleState).toBe("PAUSED_RECOVERY");

      const rowAfter = db
        .prepare("SELECT active_mission_id FROM vajra_operational_state WHERE id = 'singleton'")
        .get() as { active_mission_id: string | null };
      expect(rowAfter.active_mission_id).toBeNull();
    });
  });

  // =========================================================================
  // AUD-02: Repeated Crash Recovery Idempotence
  // =========================================================================
  describe("AUD-02: Repeated crash recovery idempotence", () => {
    it("preserves partially reconciled mission across multiple restarts without marking FAILED", async () => {
      const missionId = "m-aud02-multi";
      const step1Id = "s-aud02-1";
      const step2Id = "s-aud02-2";

      const step1 = createMissionStep({
        id: step1Id,
        missionId,
        stepOrder: 1,
        description: "Step 1 executed before restart",
        targetCapability: "safe.query",
        input: {},
        expectedEvidence: "evidence.ok",
      });

      const step2 = createMissionStep({
        id: step2Id,
        missionId,
        stepOrder: 2,
        description: "Step 2 pending",
        targetCapability: "safe.query",
        input: {},
        expectedEvidence: "evidence.ok",
      });

      const def = createMissionDefinition({
        id: missionId,
        objective: "Multi-step repeated recovery test",
        steps: [step1, step2],
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

      const step1Rec = createVajraStepRecord({
        id: step1Id,
        missionId,
        stepOrder: 1,
        description: step1.description,
        targetCapability: "safe.query",
        input: step1.input,
        expectedEvidence: step1.expectedEvidence,
        idempotencyKey: `idemp-step-${step1Id}`,
        correlationId: correlation.correlationId,
      });

      const step2Rec = createVajraStepRecord({
        id: step2Id,
        missionId,
        stepOrder: 2,
        description: step2.description,
        targetCapability: "safe.query",
        input: step2.input,
        expectedEvidence: step2.expectedEvidence,
        idempotencyKey: `idemp-step-${step2Id}`,
        correlationId: correlation.correlationId,
      });

      await stateStore.createMission(mission, [step1Rec, step2Rec]);
      // Step 1 was in-flight (DISPATCHED) during initial crash
      await stateStore.preDispatchStep(step1Id, step1Rec.idempotencyKey, new Date().toISOString());

      // Pass 1: Initial recovery runs. Evidence probe finds Step 1 execution occurred.
      const probe: ReplayEvidenceProbe = {
        checkExecutionEvidence: async (id) => id === step1Id,
        checkNeverInitiated: async () => false,
      };

      const recoveryManager = new MissionRecoveryManager(stateStore, registry, probe);
      const pass1Results = await recoveryManager.recoverInterruptedMissions();

      expect(pass1Results.length).toBe(1);
      expect(pass1Results[0].actionTaken).toBe("RECONCILED_TO_VERIFICATION");

      // Verify state after Pass 1: Step 1 is EXECUTED, Step 2 is PENDING, mission is PAUSED_RECOVERY
      const stepsAfterPass1 = await stateStore.getStepsForMission(missionId);
      expect(stepsAfterPass1[0].dispatchState).toBe("EXECUTED");
      expect(stepsAfterPass1[0].executionResultId).toBe(step1Id);
      expect(stepsAfterPass1[1].dispatchState).toBe("PENDING");

      const missionAfterPass1 = await stateStore.getMission(missionId);
      expect(missionAfterPass1?.lifecycleState).toBe("PAUSED_RECOVERY");

      // Pass 2: Server restarts again! interruptedSteps is now empty because step 1 is EXECUTED and step 2 is PENDING.
      // Must NOT mark the valid mission FAILED!
      const pass2Results = await recoveryManager.recoverInterruptedMissions();
      expect(pass2Results.length).toBe(1);
      expect(pass2Results[0].actionTaken).toBe("PAUSED_RECOVERY");

      const missionAfterPass2 = await stateStore.getMission(missionId);
      expect(missionAfterPass2?.lifecycleState).toBe("PAUSED_RECOVERY");
      expect(missionAfterPass2?.lifecycleState).not.toBe("FAILED");

      // Verify steps were preserved intact without modification or repeated side effects
      const stepsAfterPass2 = await stateStore.getStepsForMission(missionId);
      expect(stepsAfterPass2[0].dispatchState).toBe("EXECUTED");
      expect(stepsAfterPass2[0].executionResultId).toBe(step1Id);
      expect(stepsAfterPass2[1].dispatchState).toBe("PENDING");

      // Pass 3: Idempotent across subsequent restarts
      const pass3Results = await recoveryManager.recoverInterruptedMissions();
      expect(pass3Results.length).toBe(1);
      expect(pass3Results[0].actionTaken).toBe("PAUSED_RECOVERY");

      const missionAfterPass3 = await stateStore.getMission(missionId);
      expect(missionAfterPass3?.lifecycleState).toBe("PAUSED_RECOVERY");
    });

    it("reconciles to COMPLETED cleanly when all steps were already completed or verified", async () => {
      const missionId = "m-aud02-all-done";
      const stepId = "s-aud02-done-1";

      const step = createMissionStep({
        id: stepId,
        missionId,
        stepOrder: 1,
        description: "Verified step",
        targetCapability: "safe.query",
        input: {},
        expectedEvidence: "evidence.ok",
      });

      const def = createMissionDefinition({
        id: missionId,
        objective: "Completed steps test",
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
        dispatchState: "VERIFIED",
        idempotencyKey: `idemp-step-${stepId}`,
        correlationId: correlation.correlationId,
      });

      await stateStore.createMission(mission, [stepRec]);

      const recoveryManager = new MissionRecoveryManager(stateStore, registry);
      const results = await recoveryManager.recoverInterruptedMissions();

      expect(results.length).toBe(1);
      expect(results[0].actionTaken).toBe("RECONCILED_TO_VERIFICATION");

      const updated = await stateStore.getMission(missionId);
      expect(updated?.lifecycleState).toBe("COMPLETED");
    });

    it("marks truly dangling in-flight missions with 0 steps as FAILED", async () => {
      const missionId = "m-aud02-dangling";

      const def = createMissionDefinition({
        id: missionId,
        objective: "Dangling mission test",
        steps: [],
        completionCriteria: { description: "done", requiredEvidence: [] },
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

      await stateStore.createMission(mission, []);

      const recoveryManager = new MissionRecoveryManager(stateStore, registry);
      const results = await recoveryManager.recoverInterruptedMissions();

      expect(results.length).toBe(1);
      expect(results[0].actionTaken).toBe("PAUSED_RECOVERY");
      expect(results[0].reason).toContain("Marked FAILED");

      const updated = await stateStore.getMission(missionId);
      expect(updated?.lifecycleState).toBe("FAILED");
    });
  });
});
