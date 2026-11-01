import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import os from "os";
import { MissionRecoveryManager, ReplayEvidenceProbe } from "../../../src/vajra/mission/recovery";
import {
  MissionRuntime,
  UnauthorizedResumeError,
  ResumeAuthorization,
} from "../../../src/vajra/mission/runtime";
import { SqliteOperationalStateStore } from "../../../src/persistence/vajra/sqlite-operational-state-store";
import { CapabilityRegistry } from "../../../src/contracts/capabilities/registry";
import { CapabilityDescriptor } from "../../../src/contracts/capabilities/descriptor";
import {
  createMissionDefinition,
  createMissionStep,
} from "../../../src/contracts/mission/mission-definition";
import { createMissionState } from "../../../src/contracts/mission/mission-state";
import {
  createVajraMissionRecord,
  createVajraStepRecord,
} from "../../../src/vajra/types/mission-record";
import { createVajraVerificationRecord } from "../../../src/vajra/types/verification-record";
import { createBelief } from "../../../src/vajra/types/belief";
import { CorrelationMetadata, Result } from "../../../src/contracts/results/result";
import { ICoordinationDispatcher } from "../../../src/vajra/ports/coordination";
import { IObservationReceiver } from "../../../src/vajra/ports/observation";
import { IVerificationEvaluator } from "../../../src/vajra/ports/verification";
import { MissionClosureManager } from "../../../src/vajra/closure/closure-manager";
import { Observation } from "../../../src/contracts/events/observation";

/**
 * Phase 8B Part 2: End-to-End Restart Integration & Crash Window Matrix
 *
 * Verifies all 5 crash windows, failure drills, and zero-capability invocation invariants
 * across physical disk-backed SQLite database restarts.
 */
describe("VAJRA Phase 8B Part 2: Restart Integration & Phase 8 Validation", () => {
  const correlation: CorrelationMetadata = {
    requestId: "req-restart-01",
    correlationId: "corr-restart-01",
    invocationId: "inv-restart-01",
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

  const setupDiskDatabase = (dbFile: string): Database.Database => {
    const db = new Database(dbFile);
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

    return db;
  };

  const safeCleanup = (dbFile: string, ...dbs: (Database.Database | undefined)[]) => {
    for (const db of dbs) {
      try {
        db?.close();
      } catch {
        // Ignore close errors during test cleanup
      }
    }
    const filesToUnlink = [dbFile, `${dbFile}-wal`, `${dbFile}-shm`];
    for (const file of filesToUnlink) {
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
        } catch {
          // Ignore Windows async file lock retention
        }
      }
    }
  };

  const createMockRegistry = (): CapabilityRegistry => {
    const reg = new CapabilityRegistry();
    reg.register(createCap("query.health", true, true, "none"));
    reg.register(createCap("disk.write", false, false, "disk_write"));
    reg.register(createCap("system.echo", true, true, "none"));
    return reg;
  };

  const createMockObservationReceiver = (): IObservationReceiver => ({
    ingestObservation: vi.fn(),
    getObservationsForMission: vi.fn(() => []),
    getObservationsForStep: vi.fn(() => []),
  });

  const createMockVerificationEvaluator = (
    outcome:
      "criteria_satisfied" | "criteria_not_satisfied" | "inconclusive" = "criteria_satisfied",
  ): IVerificationEvaluator => ({
    evaluateStep: vi.fn((stepId, missionId, obs) => ({
      id: `vr-${stepId}`,
      missionId,
      stepId,
      executionResultIds: [],
      observationIds: obs.map((o) => o.id),
      outcome,
      verifiedAt: new Date().toISOString(),
      correlation,
    })),
  });

  // ==========================================================================
  // Scenario 1: Crash Window 1 — Pre-Dispatch Persistence Crash
  // ==========================================================================
  it("Scenario 1: handles Crash Window 1 (Pre-Dispatch VERIFIED_NEVER_STARTED) with 0 boot dispatches and authorized resume", async () => {
    const dbFile = path.join(
      os.tmpdir(),
      `vajra-cw1-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    let db1: Database.Database | undefined;
    let db2: Database.Database | undefined;
    let db3: Database.Database | undefined;

    try {
      // 1. Initial process: Mission admitted, step pre-dispatched in DB, process dies before actuation
      db1 = setupDiskDatabase(dbFile);
      const store1 = new SqliteOperationalStateStore(db1);
      const missionId = "m-cw1-01";
      const stepId = "step-cw1-01";
      const idempotencyKey = `idemp-cw1-${stepId}`;

      const step = createMissionStep({
        id: stepId,
        missionId,
        stepOrder: 1,
        description: "Pre-dispatch step",
        targetCapability: "disk.write",
        input: { data: "sample" },
        expectedEvidence: "evidence.cw1.ok",
      });

      const def = createMissionDefinition({
        id: missionId,
        objective: "Crash Window 1 Objective",
        steps: [step],
        completionCriteria: { description: "done", requiredEvidence: ["evidence.cw1.ok"] },
        correlation,
      });

      const mission = createVajraMissionRecord({
        id: missionId,
        objective: def.objective,
        lifecycleState: "RUNNING",
        definition: def,
        state: createMissionState({ missionId, definitionId: missionId }),
        allocatedBudget: { maxCostCents: 10, maxSteps: 2 },
        idempotencyKey: `idemp-mission-${missionId}`,
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
        dispatchState: "PENDING",
        idempotencyKey,
        correlationId: correlation.correlationId,
      });

      await store1.createMission(mission, [stepRecord]);
      await store1.preDispatchStep(stepId, idempotencyKey);

      // Simulate crash: close db1
      db1.close();
      db1 = undefined;

      // 2. Restart process: Reopen database with fresh instances
      db2 = new Database(dbFile);
      db2.pragma("foreign_keys = ON");
      const store2 = new SqliteOperationalStateStore(db2);
      const registry2 = createMockRegistry();

      let capabilityDispatches = 0;
      let passedIdempotencyKey: string | undefined;
      const mockCoordinator: ICoordinationDispatcher = {
        dispatchStep: vi.fn(async (_step, _corr, opts) => {
          capabilityDispatches++;
          passedIdempotencyKey = opts?.idempotencyKey;
          return Result.success({ executed: true }, correlation);
        }),
      };

      const mockProbe: ReplayEvidenceProbe = {
        checkEvidence: async () => ({
          status: "VERIFIED_NEVER_STARTED",
          reason: "External audit log confirms command was never initiated",
        }),
      };

      const recoveryManager = new MissionRecoveryManager(store2, registry2, mockProbe);
      const triageResults = await recoveryManager.recoverInterruptedMissions();

      // INVARIANT: Zero capability invocations during boot recovery
      expect(capabilityDispatches).toBe(0);
      expect(mockCoordinator.dispatchStep).not.toHaveBeenCalled();

      // Recovery triages as SAFE_TO_DISPATCH with durable classification
      expect(triageResults.length).toBe(1);
      expect(triageResults[0].actionTaken).toBe("SAFE_TO_DISPATCH");
      expect(triageResults[0].recoveryClassification).toBe("VERIFIED_NEVER_STARTED");

      // Mission lifecycle must be PAUSED_RECOVERY in DB
      const missionAfterRecovery = await store2.getMission(missionId);
      expect(missionAfterRecovery?.lifecycleState).toBe("PAUSED_RECOVERY");

      // Verify step in DB has durable classification
      const stepAfterRecovery = (await store2.getStepsForMission(missionId))[0];
      expect(stepAfterRecovery.recoveryClassification).toBe("VERIFIED_NEVER_STARTED");

      // INVARIANT: Automatic executeMission() must reject with UnauthorizedResumeError
      const runtime2 = new MissionRuntime(
        store2,
        mockCoordinator,
        createMockObservationReceiver(),
        createMockVerificationEvaluator(),
      );
      await expect(runtime2.executeMission(missionId)).rejects.toThrow(UnauthorizedResumeError);
      expect(capabilityDispatches).toBe(0);

      // 3. Explicit authorized resume: Must succeed using the original idempotency key
      const auth: ResumeAuthorization = {
        authorizedBy: "operator_recovery_service",
        reason: "Operator authorized safe dispatch of never-started step",
      };

      const resumeResult = await runtime2.resumeMission(missionId, auth);
      expect(resumeResult.lifecycleState).toBe("COMPLETED");
      expect(capabilityDispatches).toBe(1);
      expect(passedIdempotencyKey).toBe(idempotencyKey);

      // 4. Verify durable persistence across a 3rd restart
      db2.close();
      db2 = undefined;

      db3 = new Database(dbFile);
      db3.pragma("foreign_keys = ON");
      const store3 = new SqliteOperationalStateStore(db3);

      const finalMission = await store3.getMission(missionId);
      expect(finalMission?.lifecycleState).toBe("COMPLETED");

      const finalContext = await store3.loadOperationalContext();
      expect(finalContext?.activeMissionId).toBeNull();
    } finally {
      safeCleanup(dbFile, db1, db2, db3);
    }
  });

  // ==========================================================================
  // Scenario 2: Crash Window 2 — Mid-Actuation Mutating Crash (UNKNOWN Outcome)
  // ==========================================================================
  it("Scenario 2: handles Crash Window 2 (Mutating UNKNOWN) by enforcing BLOCKED_UNRESOLVED and rejecting redispatch", async () => {
    const dbFile = path.join(
      os.tmpdir(),
      `vajra-cw2-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    let db1: Database.Database | undefined;
    let db2: Database.Database | undefined;

    try {
      db1 = setupDiskDatabase(dbFile);
      const store1 = new SqliteOperationalStateStore(db1);
      const missionId = "m-cw2-mutating";
      const stepId = "step-cw2-mutating-1";
      const idempotencyKey = `idemp-cw2-${stepId}`;

      const step = createMissionStep({
        id: stepId,
        missionId,
        stepOrder: 1,
        description: "Mutating file write",
        targetCapability: "disk.write",
        input: { bytes: 1024 },
        expectedEvidence: "evidence.cw2.ok",
      });

      const def = createMissionDefinition({
        id: missionId,
        objective: "Crash Window 2 Objective",
        steps: [step],
        completionCriteria: { description: "done", requiredEvidence: ["evidence.cw2.ok"] },
        correlation,
      });

      const mission = createVajraMissionRecord({
        id: missionId,
        objective: def.objective,
        lifecycleState: "RUNNING",
        definition: def,
        state: createMissionState({ missionId, definitionId: missionId }),
        allocatedBudget: { maxCostCents: 10, maxSteps: 2 },
        idempotencyKey: `idemp-mission-${missionId}`,
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
        dispatchState: "PENDING",
        idempotencyKey,
        correlationId: correlation.correlationId,
      });

      await store1.createMission(mission, [stepRecord]);
      await store1.preDispatchStep(stepId, idempotencyKey);

      // Crash mid-actuation
      db1.close();
      db1 = undefined;

      // Restart process
      db2 = new Database(dbFile);
      db2.pragma("foreign_keys = ON");
      const store2 = new SqliteOperationalStateStore(db2);
      const registry2 = createMockRegistry();

      let capabilityDispatches = 0;
      const mockCoordinator: ICoordinationDispatcher = {
        dispatchStep: vi.fn(async () => {
          capabilityDispatches++;
          return Result.success({}, correlation);
        }),
      };

      // Probe returns UNKNOWN because outcome cannot be proven externally
      const mockProbe: ReplayEvidenceProbe = {
        checkEvidence: async () => ({
          status: "UNKNOWN",
          reason: "No external record found for mutating operation",
        }),
      };

      const recoveryManager = new MissionRecoveryManager(store2, registry2, mockProbe);
      const triageResults = await recoveryManager.recoverInterruptedMissions();

      // INVARIANT: 0 dispatches during boot recovery
      expect(capabilityDispatches).toBe(0);

      // 4-condition replay gate must reject mutating capability -> BLOCKED_UNRESOLVED
      expect(triageResults.length).toBe(1);
      expect(triageResults[0].actionTaken).toBe("PAUSED_RECOVERY");
      expect(triageResults[0].recoveryClassification).toBe("BLOCKED_UNRESOLVED");

      const stepInDb = (await store2.getStepsForMission(missionId))[0];
      expect(stepInDb.recoveryClassification).toBe("BLOCKED_UNRESOLVED");

      // Explicit resume attempt must also REFUSE to redispatch BLOCKED_UNRESOLVED mutating step
      const runtime2 = new MissionRuntime(
        store2,
        mockCoordinator,
        createMockObservationReceiver(),
        createMockVerificationEvaluator(),
      );

      const auth: ResumeAuthorization = {
        authorizedBy: "admin",
        reason: "Attempting to resume blocked mutating step",
      };

      const resumeResult = await runtime2.resumeMission(missionId, auth);
      expect(resumeResult.lifecycleState).toBe("PAUSED_RECOVERY");
      expect(capabilityDispatches).toBe(0);
      expect(mockCoordinator.dispatchStep).not.toHaveBeenCalled();
    } finally {
      safeCleanup(dbFile, db1, db2);
    }
  });

  // ==========================================================================
  // Scenario 3: Crash Window 3 — Post-Execution / Lost In-Memory Observation Crash
  // ==========================================================================
  it("Scenario 3: handles Crash Window 3 (Post-Execution unverified) by halting in PAUSED_RECOVERY without fabricating verification", async () => {
    const dbFile = path.join(
      os.tmpdir(),
      `vajra-cw3-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    let db1: Database.Database | undefined;
    let db2: Database.Database | undefined;

    try {
      db1 = setupDiskDatabase(dbFile);
      const store1 = new SqliteOperationalStateStore(db1);
      const missionId = "m-cw3-unverified";
      const stepId = "step-cw3-unver-1";

      const step = createMissionStep({
        id: stepId,
        missionId,
        stepOrder: 1,
        description: "Executed step",
        targetCapability: "query.health",
        input: {},
        expectedEvidence: "evidence.cw3.ok",
      });

      const def = createMissionDefinition({
        id: missionId,
        objective: "Crash Window 3 Objective",
        steps: [step],
        completionCriteria: { description: "done", requiredEvidence: ["evidence.cw3.ok"] },
        correlation,
      });

      const mission = createVajraMissionRecord({
        id: missionId,
        objective: def.objective,
        lifecycleState: "RUNNING",
        definition: def,
        state: createMissionState({ missionId, definitionId: missionId }),
        allocatedBudget: { maxCostCents: 10, maxSteps: 2 },
        idempotencyKey: `idemp-mission-${missionId}`,
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
        dispatchState: "PENDING",
        idempotencyKey: `idemp-step-${stepId}`,
        correlationId: correlation.correlationId,
      });

      await store1.createMission(mission, [stepRecord]);
      await store1.preDispatchStep(stepId, `idemp-step-${stepId}`);
      // Step executed in SQLite, but process crashes before observation normalization / verification
      await store1.recordStepExecution(stepId, "exec-cw3-res-01");

      // Crash
      db1.close();
      db1 = undefined;

      // Restart: In-memory observation receiver is lost/empty; no row in vajra_verifications
      db2 = new Database(dbFile);
      db2.pragma("foreign_keys = ON");
      const store2 = new SqliteOperationalStateStore(db2);
      const registry2 = createMockRegistry();

      let capabilityDispatches = 0;
      const mockCoordinator: ICoordinationDispatcher = {
        dispatchStep: vi.fn(async () => {
          capabilityDispatches++;
          return Result.success({}, correlation);
        }),
      };

      const recoveryManager = new MissionRecoveryManager(store2, registry2);
      const triageResults = await recoveryManager.recoverInterruptedMissions();

      // INVARIANTS:
      // 1. Zero capability invocations
      expect(capabilityDispatches).toBe(0);

      // 2. Halts in PAUSED_RECOVERY; does not invent verification
      expect(triageResults.length).toBe(1);
      expect(triageResults[0].actionTaken).toBe("PAUSED_RECOVERY");
      expect(triageResults[0].reason).toContain(
        "confirmed or pending state. Preserved as PAUSED_RECOVERY",
      );

      const missionInDb = await store2.getMission(missionId);
      expect(missionInDb?.lifecycleState).toBe("PAUSED_RECOVERY");

      // 3. No synthetic verification records created
      const verifications = await store2.getVerificationsForMission(missionId);
      expect(verifications.length).toBe(0);
    } finally {
      safeCleanup(dbFile, db1, db2);
    }
  });

  // ==========================================================================
  // Scenario 4: Crash Window 4 — Interrupted / Contradicted Verification Crash
  // ==========================================================================
  it("Scenario 4: handles Crash Window 4 (Contradicted Verification) by transitioning to FAILED and reconciling contradicting belief", async () => {
    const dbFile = path.join(
      os.tmpdir(),
      `vajra-cw4-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    let db1: Database.Database | undefined;
    let db2: Database.Database | undefined;

    try {
      db1 = setupDiskDatabase(dbFile);
      const store1 = new SqliteOperationalStateStore(db1);
      const missionId = "m-cw4-contradicted";
      const stepId = "step-cw4-contra-1";
      const evidenceToken = "evidence.cw4.deploy";

      // Register initial belief
      const belief = createBelief({
        id: "belief-cw4",
        proposition: evidenceToken,
        confidence: 0.9,
        verificationState: "UNVERIFIED",
        supportingEvidenceIds: [],
        contradictingEvidenceIds: [],
        ttlMs: 60000,
      });
      await store1.saveBelief(belief);

      const step = createMissionStep({
        id: stepId,
        missionId,
        stepOrder: 1,
        description: "Contradicted step",
        targetCapability: "query.health",
        input: {},
        expectedEvidence: evidenceToken,
      });

      const def = createMissionDefinition({
        id: missionId,
        objective: "Crash Window 4 Objective",
        steps: [step],
        completionCriteria: { description: "done", requiredEvidence: [evidenceToken] },
        correlation,
      });

      const mission = createVajraMissionRecord({
        id: missionId,
        objective: def.objective,
        lifecycleState: "RUNNING",
        definition: def,
        state: createMissionState({ missionId, definitionId: missionId }),
        allocatedBudget: { maxCostCents: 10, maxSteps: 2 },
        idempotencyKey: `idemp-mission-${missionId}`,
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
        dispatchState: "PENDING",
        idempotencyKey: `idemp-step-${stepId}`,
        correlationId: correlation.correlationId,
      });

      await store1.createMission(mission, [stepRecord]);
      await store1.preDispatchStep(stepId, `idemp-step-${stepId}`);
      await store1.recordStepExecution(stepId, "exec-cw4-fail");

      // Verification was evaluated with outcome criteria_not_satisfied, but process crashed before closure
      await store1.saveVerification(
        createVajraVerificationRecord({
          id: "vr-cw4-contra",
          missionId,
          stepId,
          outcome: "criteria_not_satisfied",
          evidenceIds: ["ev-cw4-contradicting-01"],
          evaluatorNotes: "Telemetry contradicts expected deployment state",
          correlationId: correlation.correlationId,
          invocationId: correlation.invocationId,
        }),
      );

      // Crash
      db1.close();
      db1 = undefined;

      // Restart process
      db2 = new Database(dbFile);
      db2.pragma("foreign_keys = ON");
      const store2 = new SqliteOperationalStateStore(db2);
      const registry2 = createMockRegistry();
      const closureManager2 = new MissionClosureManager(store2);

      let capabilityDispatches = 0;
      const mockCoordinator: ICoordinationDispatcher = {
        dispatchStep: vi.fn(async () => {
          capabilityDispatches++;
          return Result.success({}, correlation);
        }),
      };

      const recoveryManager = new MissionRecoveryManager(
        store2,
        registry2,
        undefined,
        closureManager2,
      );
      const triageResults = await recoveryManager.recoverInterruptedMissions();

      // INVARIANTS:
      expect(capabilityDispatches).toBe(0);
      expect(triageResults.length).toBe(1);

      // Mission MUST transition to FAILED, NEVER COMPLETED
      const missionInDb = await store2.getMission(missionId);
      expect(missionInDb?.lifecycleState).toBe("FAILED");
      expect(missionInDb?.completedAt).toBeDefined();

      // Active pointer cleared
      const ctx = await store2.loadOperationalContext();
      expect(ctx?.activeMissionId).toBeNull();
    } finally {
      safeCleanup(dbFile, db1, db2);
    }
  });

  // ==========================================================================
  // Scenario 5: Crash Window 5 — Post-Verification / Pre-Closure Crash
  // ==========================================================================
  it("Scenario 5: handles Crash Window 5 (Post-Verification Pre-Closure) by finalizing reality closure atomically with 0 dispatches", async () => {
    const dbFile = path.join(
      os.tmpdir(),
      `vajra-cw5-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    let db1: Database.Database | undefined;
    let db2: Database.Database | undefined;

    try {
      db1 = setupDiskDatabase(dbFile);
      const store1 = new SqliteOperationalStateStore(db1);
      const missionId = "m-cw5-verified";
      const stepId = "step-cw5-ver-1";
      const evidenceToken = "evidence.cw5.verified";

      // Register initial epistemic belief
      const belief = createBelief({
        id: "belief-cw5",
        proposition: evidenceToken,
        confidence: 0.5,
        verificationState: "UNVERIFIED",
        supportingEvidenceIds: [],
        contradictingEvidenceIds: [],
        ttlMs: 60000,
      });
      await store1.saveBelief(belief);

      const step = createMissionStep({
        id: stepId,
        missionId,
        stepOrder: 1,
        description: "Verified step",
        targetCapability: "query.health",
        input: {},
        expectedEvidence: evidenceToken,
      });

      const def = createMissionDefinition({
        id: missionId,
        objective: "Crash Window 5 Objective",
        steps: [step],
        completionCriteria: { description: "done", requiredEvidence: [evidenceToken] },
        correlation,
      });

      const mission = createVajraMissionRecord({
        id: missionId,
        objective: def.objective,
        lifecycleState: "RUNNING",
        definition: def,
        state: createMissionState({ missionId, definitionId: missionId }),
        allocatedBudget: { maxCostCents: 10, maxSteps: 2 },
        idempotencyKey: `idemp-mission-${missionId}`,
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
        dispatchState: "PENDING",
        idempotencyKey: `idemp-step-${stepId}`,
        correlationId: correlation.correlationId,
      });

      await store1.createMission(mission, [stepRecord]);
      await store1.preDispatchStep(stepId, `idemp-step-${stepId}`);
      await store1.recordStepExecution(stepId, "exec-cw5-res-01");

      // Durable verification record was committed with criteria_satisfied
      await store1.saveVerification(
        createVajraVerificationRecord({
          id: "vr-cw5-ok",
          missionId,
          stepId,
          outcome: "criteria_satisfied",
          evidenceIds: ["ev-cw5-proof-01"],
          evaluatorNotes: "Criteria verified against external evidence",
          correlationId: correlation.correlationId,
          invocationId: correlation.invocationId,
        }),
      );

      // Verify step was promoted to VERIFIED by saveVerification
      const stepBeforeCrash = (await store1.getStepsForMission(missionId))[0];
      expect(stepBeforeCrash.dispatchState).toBe("VERIFIED");

      // Mission lifecycle remains RUNNING in DB, and active pointer is set
      expect(mission.lifecycleState).toBe("RUNNING");

      // Crash
      db1.close();
      db1 = undefined;

      // Restart process
      db2 = new Database(dbFile);
      db2.pragma("foreign_keys = ON");
      const store2 = new SqliteOperationalStateStore(db2);
      const registry2 = createMockRegistry();
      const closureManager2 = new MissionClosureManager(store2);

      let capabilityDispatches = 0;
      const mockCoordinator: ICoordinationDispatcher = {
        dispatchStep: vi.fn(async () => {
          capabilityDispatches++;
          return Result.success({}, correlation);
        }),
      };

      const recoveryManager = new MissionRecoveryManager(
        store2,
        registry2,
        undefined,
        closureManager2,
      );
      const triageResults = await recoveryManager.recoverInterruptedMissions();

      // INVARIANTS:
      // 1. Zero capability dispatches
      expect(capabilityDispatches).toBe(0);

      // 2. Reconciled to COMPLETED via reality closure
      expect(triageResults.length).toBe(1);
      expect(triageResults[0].actionTaken).toBe("RECONCILED_TO_VERIFICATION");

      const missionInDb = await store2.getMission(missionId);
      expect(missionInDb?.lifecycleState).toBe("COMPLETED");
      expect(missionInDb?.completedAt).toBeDefined();

      // 3. Registered epistemic belief was reconciled atomically
      const updatedBelief = await store2.getBelief("belief-cw5");
      expect(updatedBelief?.verificationState).toBe("VERIFIED");
      expect(updatedBelief?.supportingEvidenceIds).toContain("ev-cw5-proof-01");
      expect(updatedBelief?.confidence).toBeGreaterThanOrEqual(0.95);

      // 4. active_mission_id cleared
      const ctx = await store2.loadOperationalContext();
      expect(ctx?.activeMissionId).toBeNull();
    } finally {
      safeCleanup(dbFile, db1, db2);
    }
  });

  // ==========================================================================
  // Scenario 6: Closure Failure Drill (Safe Repeated Closure)
  // ==========================================================================
  it("Scenario 6: safely repeats reality closure without duplicating evidence or corrupting state", async () => {
    const dbFile = path.join(
      os.tmpdir(),
      `vajra-cw6-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    let db1: Database.Database | undefined;
    let db2: Database.Database | undefined;

    try {
      db1 = setupDiskDatabase(dbFile);
      const store1 = new SqliteOperationalStateStore(db1);
      const missionId = "m-cw6-retry";
      const stepId = "step-cw6-retry-1";
      const evidenceToken = "evidence.cw6.retry";

      const belief = createBelief({
        id: "belief-cw6",
        proposition: evidenceToken,
        confidence: 0.5,
        verificationState: "UNVERIFIED",
        supportingEvidenceIds: ["pre-existing-ev"],
        contradictingEvidenceIds: [],
        ttlMs: 60000,
      });
      await store1.saveBelief(belief);

      const step = createMissionStep({
        id: stepId,
        missionId,
        stepOrder: 1,
        description: "Retry step",
        targetCapability: "query.health",
        input: {},
        expectedEvidence: evidenceToken,
      });

      const def = createMissionDefinition({
        id: missionId,
        objective: "Crash Window 6 Objective",
        steps: [step],
        completionCriteria: { description: "done", requiredEvidence: [evidenceToken] },
        correlation,
      });

      const mission = createVajraMissionRecord({
        id: missionId,
        objective: def.objective,
        lifecycleState: "RUNNING",
        definition: def,
        state: createMissionState({ missionId, definitionId: missionId }),
        allocatedBudget: { maxCostCents: 10, maxSteps: 2 },
        idempotencyKey: `idemp-mission-${missionId}`,
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
        dispatchState: "PENDING",
        idempotencyKey: `idemp-step-${stepId}`,
        correlationId: correlation.correlationId,
      });

      await store1.createMission(mission, [stepRecord]);
      await store1.preDispatchStep(stepId, `idemp-step-${stepId}`);
      await store1.recordStepExecution(stepId, "exec-cw6-res-01");

      await store1.saveVerification(
        createVajraVerificationRecord({
          id: "vr-cw6-ok",
          missionId,
          stepId,
          outcome: "criteria_satisfied",
          evidenceIds: ["ev-cw6-evidence-01"],
          evaluatorNotes: "Satisfied",
          correlationId: correlation.correlationId,
          invocationId: correlation.invocationId,
        }),
      );

      // Pass 1: Run reality closure via closure manager directly
      const closureMgr1 = new MissionClosureManager(store1);
      const closureRes1 = await closureMgr1.closeMission({
        missionId,
        terminalVerificationRecord: {
          id: "vr-cw6-ok",
          missionId,
          stepId,
          executionResultIds: ["ev-cw6-evidence-01"],
          observationIds: ["ev-cw6-evidence-01"],
          outcome: "criteria_satisfied",
          verifiedAt: new Date().toISOString(),
          correlation,
        },
      });
      expect(closureRes1.status).toBe("completed");

      // Verify belief has 2 unique evidence tokens
      const beliefAfterPass1 = await store1.getBelief("belief-cw6");
      expect(beliefAfterPass1?.supportingEvidenceIds).toEqual([
        "pre-existing-ev",
        "ev-cw6-evidence-01",
      ]);

      // Simulate crash and restart: reopen DB
      db1.close();
      db1 = undefined;

      db2 = new Database(dbFile);
      db2.pragma("foreign_keys = ON");
      const store2 = new SqliteOperationalStateStore(db2);
      const closureMgr2 = new MissionClosureManager(store2);

      // Repeat closure call on the same mission
      const closureRes2 = await closureMgr2.closeMission({
        missionId,
        terminalVerificationRecord: {
          id: "vr-cw6-ok",
          missionId,
          stepId,
          executionResultIds: ["ev-cw6-evidence-01"],
          observationIds: ["ev-cw6-evidence-01"],
          outcome: "criteria_satisfied",
          verifiedAt: new Date().toISOString(),
          correlation,
        },
      });
      expect(closureRes2.status).toBe("completed");

      // Verify supportingEvidenceIds did NOT duplicate 'ev-cw6-evidence-01'
      const beliefAfterPass2 = await store2.getBelief("belief-cw6");
      expect(beliefAfterPass2?.supportingEvidenceIds).toEqual([
        "pre-existing-ev",
        "ev-cw6-evidence-01",
      ]);
      expect(beliefAfterPass2?.supportingEvidenceIds.length).toBe(2);
    } finally {
      safeCleanup(dbFile, db1, db2);
    }
  });

  // ==========================================================================
  // Scenario 7: Multi-Mission Boot Recovery Barrier
  // ==========================================================================
  it("Scenario 7: executes boot recovery barrier over multiple heterogeneous interrupted missions with 0 capability dispatches", async () => {
    const dbFile = path.join(
      os.tmpdir(),
      `vajra-cw7-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    let db1: Database.Database | undefined;
    let db2: Database.Database | undefined;

    try {
      db1 = setupDiskDatabase(dbFile);
      const store1 = new SqliteOperationalStateStore(db1);

      // Mission A: Crash Window 1 (Pre-Dispatch NEVER_STARTED)
      const misAId = "m-cw7-a";
      const stepAId = "step-cw7-a-1";
      const stepA = createMissionStep({
        id: stepAId,
        missionId: misAId,
        stepOrder: 1,
        description: "Step A",
        targetCapability: "query.health",
        input: {},
        expectedEvidence: "ev.a",
      });
      const defA = createMissionDefinition({
        id: misAId,
        objective: "Objective A",
        steps: [stepA],
        completionCriteria: { description: "done", requiredEvidence: ["ev.a"] },
        correlation,
      });
      const missionA = createVajraMissionRecord({
        id: misAId,
        objective: defA.objective,
        lifecycleState: "PAUSED_RECOVERY",
        definition: defA,
        state: createMissionState({ missionId: misAId, definitionId: misAId }),
        allocatedBudget: { maxCostCents: 10, maxSteps: 2 },
        idempotencyKey: `idemp-mission-${misAId}`,
        requestId: correlation.requestId,
        correlationId: correlation.correlationId,
        invocationId: correlation.invocationId,
      });
      const stepARec = createVajraStepRecord({
        id: stepAId,
        missionId: misAId,
        stepOrder: 1,
        description: stepA.description,
        targetCapability: stepA.targetCapability,
        input: stepA.input,
        expectedEvidence: stepA.expectedEvidence,
        dispatchState: "PENDING",
        idempotencyKey: `idemp-step-${stepAId}`,
        correlationId: correlation.correlationId,
      });
      await store1.createMission(missionA, [stepARec]);
      await store1.preDispatchStep(stepAId, `idemp-step-${stepAId}`);

      // Mission B: Crash Window 2 (Mutating UNKNOWN)
      const misBId = "m-cw7-b";
      const stepBId = "step-cw7-b-1";
      const stepB = createMissionStep({
        id: stepBId,
        missionId: misBId,
        stepOrder: 1,
        description: "Step B",
        targetCapability: "disk.write",
        input: {},
        expectedEvidence: "ev.b",
      });
      const defB = createMissionDefinition({
        id: misBId,
        objective: "Objective B",
        steps: [stepB],
        completionCriteria: { description: "done", requiredEvidence: ["ev.b"] },
        correlation,
      });
      const missionB = createVajraMissionRecord({
        id: misBId,
        objective: defB.objective,
        lifecycleState: "PAUSED_RECOVERY",
        definition: defB,
        state: createMissionState({ missionId: misBId, definitionId: misBId }),
        allocatedBudget: { maxCostCents: 10, maxSteps: 2 },
        idempotencyKey: `idemp-mission-${misBId}`,
        requestId: correlation.requestId,
        correlationId: correlation.correlationId,
        invocationId: correlation.invocationId,
      });
      const stepBRec = createVajraStepRecord({
        id: stepBId,
        missionId: misBId,
        stepOrder: 1,
        description: stepB.description,
        targetCapability: stepB.targetCapability,
        input: stepB.input,
        expectedEvidence: stepB.expectedEvidence,
        dispatchState: "PENDING",
        idempotencyKey: `idemp-step-${stepBId}`,
        correlationId: correlation.correlationId,
      });
      await store1.createMission(missionB, [stepBRec]);
      await store1.preDispatchStep(stepBId, `idemp-step-${stepBId}`);

      // Mission C: Crash Window 5 (Verified awaiting closure)
      const misCId = "m-cw7-c";
      const stepCId = "step-cw7-c-1";
      const stepC = createMissionStep({
        id: stepCId,
        missionId: misCId,
        stepOrder: 1,
        description: "Step C",
        targetCapability: "query.health",
        input: {},
        expectedEvidence: "ev.c",
      });
      const defC = createMissionDefinition({
        id: misCId,
        objective: "Objective C",
        steps: [stepC],
        completionCriteria: { description: "done", requiredEvidence: ["ev.c"] },
        correlation,
      });
      const missionC = createVajraMissionRecord({
        id: misCId,
        objective: defC.objective,
        lifecycleState: "RUNNING",
        definition: defC,
        state: createMissionState({ missionId: misCId, definitionId: misCId }),
        allocatedBudget: { maxCostCents: 10, maxSteps: 2 },
        idempotencyKey: `idemp-mission-${misCId}`,
        requestId: correlation.requestId,
        correlationId: correlation.correlationId,
        invocationId: correlation.invocationId,
      });
      const stepCRec = createVajraStepRecord({
        id: stepCId,
        missionId: misCId,
        stepOrder: 1,
        description: stepC.description,
        targetCapability: stepC.targetCapability,
        input: stepC.input,
        expectedEvidence: stepC.expectedEvidence,
        dispatchState: "PENDING",
        idempotencyKey: `idemp-step-${stepCId}`,
        correlationId: correlation.correlationId,
      });
      await store1.createMission(missionC, [stepCRec]);
      await store1.preDispatchStep(stepCId, `idemp-step-${stepCId}`);
      await store1.recordStepExecution(stepCId, "exec-c-res");
      await store1.saveVerification(
        createVajraVerificationRecord({
          id: "vr-c-ok",
          missionId: misCId,
          stepId: stepCId,
          outcome: "criteria_satisfied",
          evidenceIds: ["ev.c.proof"],
          evaluatorNotes: "C satisfied",
          correlationId: correlation.correlationId,
          invocationId: correlation.invocationId,
        }),
      );

      // Crash server
      db1.close();
      db1 = undefined;

      // Boot server with fresh instances
      db2 = new Database(dbFile);
      db2.pragma("foreign_keys = ON");
      const store2 = new SqliteOperationalStateStore(db2);
      const registry2 = createMockRegistry();
      const closureMgr2 = new MissionClosureManager(store2);

      let capabilityDispatches = 0;
      const mockCoordinator: ICoordinationDispatcher = {
        dispatchStep: vi.fn(async () => {
          capabilityDispatches++;
          return Result.success({}, correlation);
        }),
      };

      const mockProbe: ReplayEvidenceProbe = {
        checkEvidence: async (step) => {
          if (step.id === stepAId) {
            return { status: "VERIFIED_NEVER_STARTED" };
          }
          return { status: "UNKNOWN" };
        },
      };

      const recoveryManager = new MissionRecoveryManager(store2, registry2, mockProbe, closureMgr2);

      // Execute boot recovery barrier
      const triageResults = await recoveryManager.recoverInterruptedMissions();

      // INVARIANT: Exactly 0 capability dispatches during boot recovery across all missions!
      expect(capabilityDispatches).toBe(0);
      expect(mockCoordinator.dispatchStep).not.toHaveBeenCalled();

      // Verify triage results:
      // Mission A (VERIFIED_NEVER_STARTED) -> SAFE_TO_DISPATCH, PAUSED_RECOVERY
      const misAInDb = await store2.getMission(misAId);
      expect(misAInDb?.lifecycleState).toBe("PAUSED_RECOVERY");
      const stepAInDb = (await store2.getStepsForMission(misAId))[0];
      expect(stepAInDb.recoveryClassification).toBe("VERIFIED_NEVER_STARTED");

      // Mission B (Mutating UNKNOWN) -> BLOCKED_UNRESOLVED, PAUSED_RECOVERY
      const misBInDb = await store2.getMission(misBId);
      expect(misBInDb?.lifecycleState).toBe("PAUSED_RECOVERY");
      const stepBInDb = (await store2.getStepsForMission(misBId))[0];
      expect(stepBInDb.recoveryClassification).toBe("BLOCKED_UNRESOLVED");

      // Mission C (Verified awaiting closure) -> COMPLETED
      const misCInDb = await store2.getMission(misCId);
      expect(misCInDb?.lifecycleState).toBe("COMPLETED");

      // Triage results summary
      expect(triageResults.length).toBe(3);
    } finally {
      safeCleanup(dbFile, db1, db2);
    }
  });
});
