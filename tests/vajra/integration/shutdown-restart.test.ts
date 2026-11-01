import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import os from "os";
import { z } from "zod";

import {
  initializeVajraRuntime,
  shutdownVajraRuntime,
  getVajraReadiness,
  getVajraIngressCoordinator,
  getUserDirectiveAdapter,
  DisabledModelCoprocessorAdapter,
  _resetCompositionStateForTesting,
} from "../../../src/vajra/composition";
import {
  initializeServer,
  shutdownServer,
  _resetServerLifecycleForTesting,
} from "../../../src/server-lifecycle";
import { SqliteOperationalStateStore } from "../../../src/persistence/vajra/sqlite-operational-state-store";
import { CapabilityRegistry } from "../../../src/contracts/capabilities/registry";
import { CapabilityDescriptor } from "../../../src/contracts/capabilities/descriptor";
import { InMemoryGenesisAdapter } from "../../../src/vajra/boundaries/genesis-port";
import { InMemoryEscalationAdapter } from "../../../src/vajra/boundaries/escalation-port";
import { LiveAkiraOSAdapter } from "../../../src/vajra/boundaries/akira-os-port";
import { UnavailableHandsAdapter } from "../../../src/vajra/boundaries/hands-port";
import { MissionRuntime, ResumeAuthorization } from "../../../src/vajra/mission/runtime";
import { MissionAdmissionGateway } from "../../../src/vajra/mission/admission";
import { createStimulus } from "../../../src/vajra/types/stimulus";
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
import { CoordinationDispatcher } from "../../../src/vajra/mission/coordinator";
import { ObservationReceiver } from "../../../src/vajra/observation/receiver";
import { VerificationEvaluator } from "../../../src/vajra/verification/evaluator";
import { MissionClosureManager } from "../../../src/vajra/closure/closure-manager";
import { EventBus } from "../../../src/instrumentation/event-bus";
import { CorrelationMetadata } from "../../../src/contracts/results/result";

/**
 * VAJRA Phase 8D: End-to-End Shutdown, Restart & Production Integration Test Suite
 *
 * Verifies:
 * 1. Full application lifecycle (startup -> real ingress -> mission execution -> reality closure -> shutdown).
 * 2. Cooperative shutdown during active multi-step mission (step completion, pausing before next step).
 * 3. Durable state survival across disk-backed SQLite restarts.
 * 4. Recovery and ingress ordering verification (ingress unavailable until recovery and boot complete).
 * 5. Readiness and admission behavior while recovery is unresolved, followed by authorized resume.
 * 6. Sudden crash recovery drill without graceful shutdown.
 * 7. Concurrent and idempotent lifecycle invocations.
 */
describe("VAJRA Phase 8D — Shutdown & Integration Testing", () => {
  let tempDir: string;
  let dbPath: string;
  let activeDbs: Database.Database[] = [];

  const correlation: CorrelationMetadata = {
    requestId: "req-phase8d-01",
    correlationId: "corr-phase8d-01",
    invocationId: "inv-phase8d-01",
  };

  const createCap = (
    name: string,
    isIdempotent: boolean,
    isReadOnly: boolean,
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
      sideEffectClass: isReadOnly ? "none" : "disk_write",
    },
    isAvailable: true,
    permissions: {
      allowVajra: true,
      allowInternal: true,
    },
    inputSchema: z.object({ value: z.string().optional() }).passthrough(),
  });

  const setupDiskDatabase = (filePath: string): Database.Database => {
    const db = new Database(filePath);
    db.pragma("foreign_keys = ON");
    activeDbs.push(db);

    const schemaPath = path.join(process.cwd(), "src", "persistence", "schema.sql");
    db.exec(fs.readFileSync(schemaPath, "utf8"));
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (1, ?)").run(
      new Date().toISOString(),
    );

    const mig003Path = path.join(
      process.cwd(),
      "src",
      "persistence",
      "migrations",
      "003_vajra_operational_state.sql",
    );
    db.exec(fs.readFileSync(mig003Path, "utf8"));
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (3, ?)").run(
      new Date().toISOString(),
    );

    const mig004Path = path.join(
      process.cwd(),
      "src",
      "persistence",
      "migrations",
      "004_vajra_evidence_and_recovery_safety.sql",
    );
    db.exec(fs.readFileSync(mig004Path, "utf8"));
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (4, ?)").run(
      new Date().toISOString(),
    );

    db.prepare(
      `
      INSERT INTO vajra_operational_state (
        id, current_focus, operational_mode, active_mission_id, human_presence, system_health_status, version, updated_at
      ) VALUES ('singleton', 'Execute operational task', 'REQUEST_DRIVEN', NULL, 'FOCUSED_ACTIVE', 'NOMINAL', 1, ?)
    `,
    ).run(new Date().toISOString());

    return db;
  };

  beforeEach(() => {
    _resetCompositionStateForTesting();
    _resetServerLifecycleForTesting();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vajra-phase8d-"));
    dbPath = path.join(tempDir, "vajra-test.sqlite");
    activeDbs = [];
  });

  afterEach(async () => {
    try {
      await shutdownVajraRuntime({ force: true });
    } catch {
      // Best-effort cleanup
    }
    try {
      await shutdownServer({ force: true });
    } catch {
      // Best-effort cleanup
    }
    _resetCompositionStateForTesting();
    _resetServerLifecycleForTesting();

    for (const db of activeDbs) {
      try {
        db.close();
      } catch {
        // Ignore close errors
      }
    }
    activeDbs = [];

    const filesToClean = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
    for (const f of filesToClean) {
      if (fs.existsSync(f)) {
        try {
          fs.unlinkSync(f);
        } catch {
          // Ignore Windows file retention locks
        }
      }
    }
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Best-effort directory cleanup
      }
    }
  });

  // ==========================================================================
  // Scenario 1: Full Application Lifecycle E2E
  // Startup -> Ingress Stimulus -> Deliberation -> Two-Phase Execution -> Reality Closure -> Teardown
  // ==========================================================================
  it("Scenario 1: executes complete happy-path lifecycle from stimulus ingress to reality closure and clean shutdown", async () => {
    const rawDb = setupDiskDatabase(dbPath);
    const stateStore = new SqliteOperationalStateStore(rawDb);
    const registry = new CapabilityRegistry();

    let executedValue: string | null = null;
    registry.register(createCap("task.create", true, false), (input: any) => {
      executedValue = input?.value ?? "task created";
      return { message: executedValue, success: true, evidenceToken: "evidence.task.create.ok" };
    });

    const akiraOSPort = new LiveAkiraOSAdapter(registry);
    const genesisPort = new InMemoryGenesisAdapter();
    const escalationPort = new InMemoryEscalationAdapter({ stateStore });

    // 1. Initialize production VAJRA composition root
    const controller = await initializeVajraRuntime({
      stateStore,
      capabilityRegistry: registry,
      akiraOSPort,
      genesisPort,
      escalationPort,
      coprocessorPort: new DisabledModelCoprocessorAdapter(),
      handsPort: new UnavailableHandsAdapter(),
    });

    expect(controller.getState()).toBe("RUNNING");
    const readinessBefore = getVajraReadiness();
    expect(readinessBefore.isOperational).toBe(true);
    expect(readinessBefore.hasUnresolvedRecovery).toBe(false);

    // 2. Stimulus Ingress via UserDirectiveAdapter
    const userAdapter = getUserDirectiveAdapter();
    expect(userAdapter).not.toBeNull();

    const stimulus = createStimulus({
      id: "stim-user-01",
      kind: "user_directive",
      source: "user",
      payload: {
        directive: "Create task",
        targetCapability: "task.create",
        input: { value: "VAJRA 8D Operational Test" },
      },
      correlation,
    });

    const result = await controller.receiveStimulus(stimulus);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    // 3. Verify Capability Execution & Reality Closure
    expect(executedValue).not.toBeNull();

    const missions = rawDb.prepare("SELECT * FROM vajra_missions").all() as any[];
    expect(missions.length).toBe(1);
    expect(missions[0].lifecycle_state).toBe("COMPLETED");
    expect(missions[0].completed_at).not.toBeNull();

    const steps = rawDb.prepare("SELECT * FROM vajra_mission_steps").all() as any[];
    expect(steps.length).toBeGreaterThan(0);
    expect(steps[0].dispatch_state).toBe("VERIFIED");

    const verifications = rawDb.prepare("SELECT * FROM vajra_verifications").all() as any[];
    expect(verifications.length).toBeGreaterThan(0);
    expect(verifications[0].outcome).toBe("criteria_satisfied");

    // Context active_mission_id must be cleared on completion
    const opContext = rawDb
      .prepare("SELECT * FROM vajra_operational_state WHERE id = 'singleton'")
      .get() as any;
    expect(opContext.active_mission_id).toBeNull();

    // 4. Clean Symmetrical Teardown
    await shutdownVajraRuntime();
    expect(controller.getState()).toBe("STOPPED");
    expect(getVajraReadiness().isOperational).toBe(false);

    // Durable SQLite records remain intact across shutdown
    const postShutdownMissions = rawDb.prepare("SELECT * FROM vajra_missions").all() as any[];
    expect(postShutdownMissions.length).toBe(1);
    expect(postShutdownMissions[0].lifecycle_state).toBe("COMPLETED");
  });

  // ==========================================================================
  // Scenario 2: Cooperative Graceful Shutdown During Active Multi-Step Mission
  // ==========================================================================
  it("Scenario 2: cooperatively finishes in-flight step and cleanly pauses before next step during graceful shutdown", async () => {
    const rawDb = setupDiskDatabase(dbPath);
    const stateStore = new SqliteOperationalStateStore(rawDb);
    const registry = new CapabilityRegistry();

    const executedSteps: string[] = [];

    registry.register(createCap("step.fast_01", true, false), () => {
      executedSteps.push("step.fast_01");
      return { step: 1, done: true, evidenceToken: "evidence.ok" };
    });

    registry.register(createCap("step.gated_02", true, false), () => {
      executedSteps.push("step.gated_02");
      return { step: 2, done: true, evidenceToken: "evidence.ok" };
    });

    registry.register(createCap("step.gated_03", true, false), () => {
      executedSteps.push("step.gated_03");
      return { step: 3, done: true, evidenceToken: "evidence.ok" };
    });

    const akiraOSPort = new LiveAkiraOSAdapter(registry);
    const coordinator = new CoordinationDispatcher(akiraOSPort);
    const observationReceiver = new ObservationReceiver();
    const verificationEvaluator = new VerificationEvaluator(stateStore);
    const closureManager = new MissionClosureManager(stateStore, new EventBus());
    const missionRuntime = new MissionRuntime(
      stateStore,
      coordinator,
      observationReceiver,
      verificationEvaluator,
      closureManager,
    );

    // Create 3-step mission definition
    const step1 = createMissionStep({
      id: "step-1",
      description: "Fast step 1",
      targetCapability: "step.fast_01",
      input: {},
      expectedEvidence: "evidence.ok",
    });
    const step2 = createMissionStep({
      id: "step-2",
      description: "Gated step 2",
      targetCapability: "step.gated_02",
      input: {},
      expectedEvidence: "evidence.ok",
    });
    const step3 = createMissionStep({
      id: "step-3",
      description: "Gated step 3",
      targetCapability: "step.gated_03",
      input: {},
      expectedEvidence: "evidence.ok",
    });

    const def = createMissionDefinition({
      id: "m-multistep-shutdown",
      objective: "Multi-step mission interrupted by shutdown",
      steps: [step1, step2, step3],
      completionCriteria: { description: "all done", requiredEvidence: ["evidence.ok"] },
      correlation,
    });

    const missionRecord = createVajraMissionRecord({
      id: def.id,
      objective: def.objective,
      lifecycleState: "CREATED",
      definition: def,
      state: createMissionState({ missionId: def.id, definitionId: def.id }),
      allocatedBudget: { maxCostCents: 10, maxSteps: 3 },
      idempotencyKey: "idemp-multistep",
      requestId: correlation.requestId,
      correlationId: correlation.correlationId,
      invocationId: correlation.invocationId,
    });

    const stepRecords = [
      createVajraStepRecord({
        id: "step-1",
        missionId: def.id,
        stepOrder: 0,
        description: "Step 1",
        targetCapability: "step.fast_01",
        input: {},
        expectedEvidence: "evidence.ok",
        idempotencyKey: "idemp-step-1",
        correlationId: correlation.correlationId,
      }),
      createVajraStepRecord({
        id: "step-2",
        missionId: def.id,
        stepOrder: 1,
        description: "Step 2",
        targetCapability: "step.gated_02",
        input: {},
        expectedEvidence: "evidence.ok",
        idempotencyKey: "idemp-step-2",
        correlationId: correlation.correlationId,
      }),
      createVajraStepRecord({
        id: "step-3",
        missionId: def.id,
        stepOrder: 2,
        description: "Step 3",
        targetCapability: "step.gated_03",
        input: {},
        expectedEvidence: "evidence.ok",
        idempotencyKey: "idemp-step-3",
        correlationId: correlation.correlationId,
      }),
    ];

    await stateStore.createMission(missionRecord, stepRecords);
    await stateStore.saveOperationalContext({
      currentFocus: "Multi-step mission",
      mode: "REQUEST_DRIVEN",
      activeMissionId: def.id,
      humanPresence: "FOCUSED_ACTIVE",
      systemHealthStatus: "NOMINAL",
      version: 1,
      updatedAt: new Date().toISOString(),
    });

    // Listen for step 1 verification to request graceful shutdown before step 2 dispatches
    missionRuntime.onEvent((event) => {
      if (event.type === "STEP_VERIFIED" && (event as any).stepOrder === 0) {
        // Trigger cooperative shutdown immediately after step 1 verification
        void missionRuntime.requestShutdown({ timeoutMs: 3000 });
      }
    });

    // Execute mission loop
    const executionResult = await missionRuntime.executeMission(def.id);

    // Invariant: Mission stopped cleanly in PAUSED_RECOVERY
    expect(executionResult.lifecycleState).toBe("PAUSED_RECOVERY");
    expect(executedSteps).toEqual(["step.fast_01"]); // Step 2 & 3 were never dispatched

    // Verify durable state in SQLite
    const persisted = await stateStore.getMission(def.id);
    expect(persisted?.lifecycleState).toBe("PAUSED_RECOVERY");

    const stepsInDb = await stateStore.getStepsForMission(def.id);
    expect(stepsInDb[0].dispatchState).toBe("VERIFIED");
    expect(stepsInDb[1].dispatchState).toBe("PENDING");
    expect(stepsInDb[2].dispatchState).toBe("PENDING");
  });

  // ==========================================================================
  // Scenario 3: Restart & Recovery Ordering Across Disk Restarts
  // Boot recovery audits state -> Gates admission -> Authorized resume finishes mission
  // ==========================================================================
  it("Scenario 3: restarts from persisted state, gates new admissions, and successfully finishes via authorized resume", async () => {
    // Phase A: Create interrupted state in SQLite
    const rawDb1 = setupDiskDatabase(dbPath);
    const stateStore1 = new SqliteOperationalStateStore(rawDb1);

    const step1 = createMissionStep({
      id: "step-rec-1",
      description: "Step 1 (already verified)",
      targetCapability: "system.echo",
      input: { text: "part 1" },
      expectedEvidence: "evidence.ok",
    });
    const step2 = createMissionStep({
      id: "step-rec-2",
      description: "Step 2 (pending)",
      targetCapability: "system.echo",
      input: { text: "part 2" },
      expectedEvidence: "evidence.ok",
    });

    const def = createMissionDefinition({
      id: "m-disk-recovery",
      objective: "Persisted recovery mission",
      steps: [step1, step2],
      completionCriteria: { description: "done", requiredEvidence: ["evidence.ok"] },
      correlation,
    });

    const mission = createVajraMissionRecord({
      id: def.id,
      objective: def.objective,
      lifecycleState: "PAUSED_RECOVERY",
      definition: def,
      state: createMissionState({ missionId: def.id, definitionId: def.id }),
      allocatedBudget: { maxCostCents: 10, maxSteps: 2 },
      idempotencyKey: "idemp-disk-rec",
      requestId: correlation.requestId,
      correlationId: correlation.correlationId,
      invocationId: correlation.invocationId,
    });

    const stepRecords = [
      createVajraStepRecord({
        id: "step-rec-1",
        missionId: def.id,
        stepOrder: 0,
        description: "Step 1",
        targetCapability: "system.echo",
        input: { text: "part 1" },
        expectedEvidence: "evidence.ok",
        idempotencyKey: "idemp-s1",
        correlationId: correlation.correlationId,
      }),
      createVajraStepRecord({
        id: "step-rec-2",
        missionId: def.id,
        stepOrder: 1,
        description: "Step 2",
        targetCapability: "system.echo",
        input: { text: "part 2" },
        expectedEvidence: "evidence.ok",
        idempotencyKey: "idemp-s2",
        correlationId: correlation.correlationId,
      }),
    ];

    await stateStore1.createMission(mission, stepRecords);
    await stateStore1.preDispatchStep("step-rec-1", "idemp-s1", new Date().toISOString());
    await stateStore1.recordStepExecution("step-rec-1", "res-step-1", new Date().toISOString());
    await stateStore1.saveVerification(
      createVajraVerificationRecord({
        id: "verif-s1",
        missionId: def.id,
        stepId: "step-rec-1",
        evaluationId: "eval-s1",
        outcome: "criteria_satisfied",
        evidenceIds: ["res-step-1"],
        evaluatorNotes: "Step 1 verified before shutdown",
        correlationId: correlation.correlationId,
        invocationId: correlation.invocationId,
        recordedAt: new Date().toISOString(),
      }),
    );
    await stateStore1.saveOperationalContext({
      currentFocus: "Interrupted mission in recovery",
      mode: "RECOVERY",
      activeMissionId: def.id,
      humanPresence: "FOCUSED_ACTIVE",
      systemHealthStatus: "NOMINAL",
      version: 1,
      updatedAt: new Date().toISOString(),
    });

    // Close database 1 to simulate process termination
    rawDb1.close();
    _resetCompositionStateForTesting();

    // Phase B: Simulate Server Restart with fresh connection to the same SQLite file
    const rawDb2 = new Database(dbPath);
    activeDbs.push(rawDb2);
    const stateStore2 = new SqliteOperationalStateStore(rawDb2);
    const registry2 = new CapabilityRegistry();

    let step2Executed = false;
    registry2.register(createCap("system.echo", true, true), (input: any) => {
      if (input?.text === "part 2") {
        step2Executed = true;
      }
      return { ok: true, evidenceToken: "evidence.ok" };
    });

    const akiraOSPort2 = new LiveAkiraOSAdapter(registry2);
    const genesisPort2 = new InMemoryGenesisAdapter();
    const escalationPort2 = new InMemoryEscalationAdapter({ stateStore: stateStore2 });

    const controller2 = await initializeVajraRuntime({
      stateStore: stateStore2,
      capabilityRegistry: registry2,
      akiraOSPort: akiraOSPort2,
      genesisPort: genesisPort2,
      escalationPort: escalationPort2,
      coprocessorPort: new DisabledModelCoprocessorAdapter(),
      handsPort: new UnavailableHandsAdapter(),
    });

    // Invariant 1: Controller boots with mode RECOVERY and preserves activeMissionId
    expect(controller2.getState()).toBe("RUNNING");
    expect(controller2.getOperationalContext().mode).toBe("RECOVERY");
    expect(controller2.getOperationalContext().activeMissionId).toBe("m-disk-recovery");

    // Invariant 2: Readiness reflects unresolved recovery
    const readiness = getVajraReadiness();
    expect(readiness.isOperational).toBe(true);
    expect(readiness.hasUnresolvedRecovery).toBe(true);

    // Invariant 3: Gate 6 blocks new missions while recovery is unresolved
    const gateway = new MissionAdmissionGateway(stateStore2, registry2);
    const blockedOutcome = await gateway.admitAction(
      {
        id: "act-new",
        kind: "start_mission",
        intent: "Attempt new mission while recovery unresolved",
        confidence: 1.0,
        policyCompliance: true,
        correlation,
      },
      controller2.getOperationalContext(),
    );
    expect(blockedOutcome.status).toBe("CONCURRENCY_LOCKED");

    // Invariant 4: Explicit authorized resume executes remainder and finalizes closure
    const coordinator2 = new CoordinationDispatcher(akiraOSPort2);
    const obs2 = new ObservationReceiver();
    const verif2 = new VerificationEvaluator(stateStore2);
    const closure2 = new MissionClosureManager(stateStore2, new EventBus());
    const runtime2 = new MissionRuntime(stateStore2, coordinator2, obs2, verif2, closure2);

    const auth: ResumeAuthorization = {
      authorizedBy: "operator-phase8d",
      reason: "Explicit post-restart recovery authorization",
    };

    const resumeResult = await runtime2.resumeMission("m-disk-recovery", auth);
    expect(resumeResult.lifecycleState).toBe("COMPLETED");
    expect(step2Executed).toBe(true);

    // Active mission pointer is cleared from durable operational state
    const postResumeContext = await stateStore2.loadOperationalContext();
    expect(postResumeContext?.activeMissionId).toBeNull();

    // Invariant 5: Gate 6 now unlocks
    const unlockedOutcome = await gateway.admitAction(
      {
        id: "act-new-2",
        kind: "start_mission",
        intent: "New mission after recovery resolved",
        confidence: 1.0,
        policyCompliance: true,
        correlation,
      },
      controller2.getOperationalContext(),
    );
    expect(unlockedOutcome.status).toBe("ADMITTED");
  });

  // ==========================================================================
  // Scenario 4: Sudden Crash Simulation with In-Flight Mutating Step
  // Step left in DISPATCHED without result -> Boot recovery safely triages to PAUSED_RECOVERY
  // ==========================================================================
  it("Scenario 4: safely triages interrupted mutating step left in DISPATCHED after sudden crash without capability replay", async () => {
    const rawDb = setupDiskDatabase(dbPath);
    const stateStore = new SqliteOperationalStateStore(rawDb);
    const registry = new CapabilityRegistry();

    let capabilityInvocations = 0;
    registry.register(
      createCap("disk.write", false, false), // Mutating, non-idempotent
      () => {
        capabilityInvocations++;
        return { written: true };
      },
    );

    const stepDef = createMissionStep({
      id: "step-crash-mutating",
      description: "Mutating step interrupted by power loss",
      targetCapability: "disk.write",
      input: { data: "payload" },
      expectedEvidence: "evidence.ok",
    });

    const def = createMissionDefinition({
      id: "m-crash-mutating",
      objective: "Crash during mutating step",
      steps: [stepDef],
      completionCriteria: { description: "done", requiredEvidence: ["evidence.ok"] },
      correlation,
    });

    const mission = createVajraMissionRecord({
      id: def.id,
      objective: def.objective,
      lifecycleState: "RUNNING", // Left running when process halted
      definition: def,
      state: createMissionState({ missionId: def.id, definitionId: def.id }),
      allocatedBudget: { maxCostCents: 10, maxSteps: 1 },
      idempotencyKey: "idemp-crash",
      requestId: correlation.requestId,
      correlationId: correlation.correlationId,
      invocationId: correlation.invocationId,
    });

    const step = createVajraStepRecord({
      id: "step-crash-mutating",
      missionId: def.id,
      stepOrder: 0,
      description: "Mutating step",
      targetCapability: "disk.write",
      input: { data: "payload" },
      expectedEvidence: "evidence.ok",
      idempotencyKey: "idemp-s-crash",
      correlationId: correlation.correlationId,
    });

    await stateStore.createMission(mission, [step]);
    // Pre-dispatch was recorded in DB before the crash
    await stateStore.preDispatchStep(
      "step-crash-mutating",
      "idemp-s-crash",
      new Date().toISOString(),
    );
    await stateStore.saveOperationalContext({
      currentFocus: "Writing disk data",
      mode: "REQUEST_DRIVEN",
      activeMissionId: def.id,
      humanPresence: "FOCUSED_ACTIVE",
      systemHealthStatus: "NOMINAL",
      version: 1,
      updatedAt: new Date().toISOString(),
    });

    // Close and restart runtime
    rawDb.close();
    _resetCompositionStateForTesting();

    const restartDb = new Database(dbPath);
    activeDbs.push(restartDb);
    const restartStore = new SqliteOperationalStateStore(restartDb);

    await initializeVajraRuntime({
      stateStore: restartStore,
      capabilityRegistry: registry,
      akiraOSPort: new LiveAkiraOSAdapter(registry),
      genesisPort: new InMemoryGenesisAdapter(),
      escalationPort: new InMemoryEscalationAdapter({ stateStore: restartStore }),
      coprocessorPort: new DisabledModelCoprocessorAdapter(),
      handsPort: new UnavailableHandsAdapter(),
    });

    // Invariant: Boot recovery triaged mutating uncertain step to BLOCKED_UNRESOLVED and mission to PAUSED_RECOVERY
    const recoveredMission = await restartStore.getMission("m-crash-mutating");
    expect(recoveredMission?.lifecycleState).toBe("PAUSED_RECOVERY");

    const recoveredStep = await restartStore.getStep("step-crash-mutating");
    expect(recoveredStep?.recoveryClassification).toBe("BLOCKED_UNRESOLVED");

    // Zero capability invocations allowed during boot recovery
    expect(capabilityInvocations).toBe(0);
  });

  // ==========================================================================
  // Scenario 5: Concurrent and Idempotent Lifecycle Invocations
  // ==========================================================================
  it("Scenario 5: coalesces concurrent initializeServer and shutdownServer calls onto shared singletons without state corruption", async () => {
    let dbInitCount = 0;
    const mockInitDb = vi.fn(() => {
      dbInitCount++;
    });
    const mockInitVajra = vi.fn(async () => {
      return {
        getState: () => "RUNNING",
        getOperationalContext: () => ({ mode: "REQUEST_DRIVEN" }),
        getSelfModel: () => ({ listCapabilities: () => [] }),
      } as any;
    });

    // 1. Concurrent startup calls
    const [r1, r2, r3] = await Promise.all([
      initializeServer({ initializeDatabase: mockInitDb, initializeVajra: mockInitVajra }),
      initializeServer({ initializeDatabase: mockInitDb, initializeVajra: mockInitVajra }),
      initializeServer({ initializeDatabase: mockInitDb, initializeVajra: mockInitVajra }),
    ]);

    expect(dbInitCount).toBe(1);
    expect(r1.applicationReady).toBe(true);
    expect(r2).toBe(r1);
    expect(r3).toBe(r1);

    // 2. Concurrent shutdown calls
    let vajraShutdownCount = 0;
    const mockShutdownVajra = vi.fn(async () => {
      vajraShutdownCount++;
    });

    await Promise.all([
      shutdownServer({ shutdownVajra: mockShutdownVajra }),
      shutdownServer({ shutdownVajra: mockShutdownVajra }),
      shutdownServer({ shutdownVajra: mockShutdownVajra }),
    ]);

    expect(vajraShutdownCount).toBe(1);

    // 3. Repeated shutdown after completion is a no-op
    await shutdownServer({ shutdownVajra: mockShutdownVajra });
    expect(vajraShutdownCount).toBe(1);
  });

  // ==========================================================================
  // Scenario 6: Ingress Isolation Until Recovery and Controller Boot Complete
  // ==========================================================================
  it("Scenario 6: keeps ingress adapters strictly unattached until crash recovery and controller boot have resolved", async () => {
    expect(getVajraIngressCoordinator()).toBeNull();
    expect(getUserDirectiveAdapter()).toBeNull();

    const rawDb = setupDiskDatabase(dbPath);
    const stateStore = new SqliteOperationalStateStore(rawDb);
    const registry = new CapabilityRegistry();

    // Hook detectInterruptedMissions to check that ingress adapters are still null during recovery
    let ingressNullDuringRecovery = false;
    const originalDetect = stateStore.detectInterruptedMissions.bind(stateStore);
    stateStore.detectInterruptedMissions = async () => {
      ingressNullDuringRecovery =
        getVajraIngressCoordinator() === null && getUserDirectiveAdapter() === null;
      return originalDetect();
    };

    await initializeVajraRuntime({
      stateStore,
      capabilityRegistry: registry,
      akiraOSPort: new LiveAkiraOSAdapter(registry),
      genesisPort: new InMemoryGenesisAdapter(),
      escalationPort: new InMemoryEscalationAdapter({ stateStore }),
      coprocessorPort: new DisabledModelCoprocessorAdapter(),
      handsPort: new UnavailableHandsAdapter(),
    });

    // Ingress was verified unattached during recovery execution
    expect(ingressNullDuringRecovery).toBe(true);

    // Ingress is attached and available only after runtime is fully operational
    expect(getVajraIngressCoordinator()).not.toBeNull();
    expect(getUserDirectiveAdapter()).not.toBeNull();
  });
});
