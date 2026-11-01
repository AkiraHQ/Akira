import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import server from "../../src/server";
import {
  initializeServer,
  shutdownServer,
  getApplicationReadiness,
  ensureServerStarted,
  isMissionAdmissionReady,
  _resetServerLifecycleForTesting,
} from "../../src/server-lifecycle";
import {
  initializeVajraRuntime,
  getVajraReadiness,
  _resetCompositionStateForTesting,
} from "../../src/vajra/composition";
import { IHandsPort, UnavailableHandsAdapter } from "../../src/vajra/boundaries/hands-port";
import { SqliteOperationalStateStore } from "../../src/persistence/vajra/sqlite-operational-state-store";
import { MissionAdmissionGateway } from "../../src/vajra/mission/admission";
import { MissionRecoveryManager } from "../../src/vajra/mission/recovery";
import { MissionRuntime, ResumeAuthorization } from "../../src/vajra/mission/runtime";
import { Result } from "../../src/contracts/results/result";
import {
  createVajraMissionRecord,
  createVajraStepRecord,
} from "../../src/vajra/types/mission-record";
import {
  createMissionDefinition,
  createMissionStep,
} from "../../src/contracts/mission/mission-definition";
import { createMissionState } from "../../src/contracts/mission/mission-state";
import { createExecutiveAction } from "../../src/vajra/types/action";
import { CorrelationMetadata } from "../../src/contracts/results/result";
import { OperationalContext } from "../../src/vajra/types/operational-context";
import { CapabilityRegistry } from "../../src/contracts/capabilities/registry";
import { ApprovalManager } from "../../src/vajra/decision/approval-manager";
import { InMemoryGenesisAdapter } from "../../src/vajra/boundaries/genesis-port";
import { InMemoryAkiraOSAdapter } from "../../src/vajra/boundaries/akira-os-port";
import { InMemoryEscalationAdapter } from "../../src/vajra/boundaries/escalation-port";
import { SelfModel } from "../../src/vajra/self-model/self-model";
import { ExecutiveController } from "../../src/vajra/executive/controller";

describe("VAJRA Phase 8C — Readiness & Health", () => {
  let db: Database.Database;
  let stateStore: SqliteOperationalStateStore;

  const correlation: CorrelationMetadata = {
    requestId: "req-ready-01",
    correlationId: "corr-ready-01",
    invocationId: "inv-ready-01",
  };

  const validContext: OperationalContext = {
    currentFocus: "Readiness Testing",
    mode: "REQUEST_DRIVEN",
    activeMissionId: null,
    humanPresence: "FOCUSED_ACTIVE",
    systemHealthStatus: "NOMINAL",
    version: 1,
    updatedAt: new Date().toISOString(),
  };

  function createTestDb(): Database.Database {
    const memDb = new Database(":memory:");
    memDb.pragma("foreign_keys = ON");
    const schemaPath = path.join(process.cwd(), "src", "persistence", "schema.sql");
    memDb.exec(fs.readFileSync(schemaPath, "utf8"));
    memDb
      .prepare("INSERT INTO schema_version (version, applied_at) VALUES (1, ?)")
      .run(new Date().toISOString());

    const mig003 = path.join(
      process.cwd(),
      "src",
      "persistence",
      "migrations",
      "003_vajra_operational_state.sql",
    );
    memDb.exec(fs.readFileSync(mig003, "utf8"));
    memDb
      .prepare("INSERT INTO schema_version (version, applied_at) VALUES (3, ?)")
      .run(new Date().toISOString());

    const mig004 = path.join(
      process.cwd(),
      "src",
      "persistence",
      "migrations",
      "004_vajra_evidence_and_recovery_safety.sql",
    );
    memDb.exec(fs.readFileSync(mig004, "utf8"));
    memDb
      .prepare("INSERT INTO schema_version (version, applied_at) VALUES (4, ?)")
      .run(new Date().toISOString());

    return memDb;
  }

  beforeEach(() => {
    _resetServerLifecycleForTesting();
    db = createTestDb();
    stateStore = new SqliteOperationalStateStore(db);
  });

  afterEach(async () => {
    try {
      await shutdownServer();
    } catch {
      // Best-effort teardown
    }
    _resetServerLifecycleForTesting();
    if (db && db.open) {
      db.close();
    }
  });

  // 1. Dynamic Application Readiness After Startup
  it("getApplicationReadiness reflects live state post-boot rather than a frozen startup snapshot", async () => {
    await initializeServer({
      initializeDatabase: () => {},
      vajraOptions: { stateStore },
    });

    const initial = getApplicationReadiness();
    expect(initial.applicationReady).toBe(true);
    expect(initial.vajraReady).toBe(true);
    expect(initial.vajraStatus).toBe("DEGRADED"); // In default composition, hands is unavailable

    // Trigger server shutdown
    await shutdownServer();

    // Verify getApplicationReadiness reflects the STOPPED state dynamically
    const liveAfterShutdown = getApplicationReadiness();
    expect(liveAfterShutdown.vajraReady).toBe(false);
    expect(liveAfterShutdown.vajraStatus).toBe("STOPPED");
    expect(liveAfterShutdown.applicationReady).toBe(false);
  });

  // 2. Side-Effect Free Readiness Queries
  it("getVajraReadiness is strictly side-effect free: repeated calls do not mutate state store or context version", async () => {
    await initializeServer({
      initializeDatabase: () => {},
      vajraOptions: { stateStore },
    });

    const ctxBefore = await stateStore.loadOperationalContext();
    expect(ctxBefore).not.toBeNull();
    const versionBefore = ctxBefore!.version;

    // Call readiness repeatedly
    for (let i = 0; i < 5; i++) {
      const report = getVajraReadiness();
      expect(report.isOperational).toBe(true);
    }

    const ctxAfter = await stateStore.loadOperationalContext();
    expect(ctxAfter!.version).toBe(versionBefore);
    expect(ctxAfter!.updatedAt).toBe(ctxBefore!.updatedAt);
  });

  // 3. Cognitive Readiness Probe (/ready/vajra) Behavior Across States
  it("returns HTTP 200 on /ready/vajra when VAJRA is operational and ready to accept missions", async () => {
    await initializeServer({
      initializeDatabase: () => {},
      vajraOptions: { stateStore },
    });

    const req = new Request("http://localhost/ready/vajra");
    const res = await server.fetch(req, null, null);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Akira-Cognitive-Ready")).toBe("true");
    expect(res.headers.get("X-Akira-Cognitive-Status")).toBe("DEGRADED");

    const body = await res.json();
    expect(body.isOperational).toBe(true);
    expect(body.hasUnresolvedRecovery).toBe(false);
  });

  it("returns HTTP 503 on /ready/vajra when VAJRA failed initialization", async () => {
    await initializeServer({
      initializeDatabase: () => {},
      initializeVajra: async () => {
        throw new Error("Simulated initialization failure in VAJRA cognitive loop");
      },
    });

    const req = new Request("http://localhost/ready/vajra");
    const res = await server.fetch(req, null, null);

    expect(res.status).toBe(503);
    expect(res.headers.get("X-Akira-Cognitive-Ready")).toBe("false");
    expect(res.headers.get("X-Akira-Cognitive-Status")).toBe("FAILED");
  });

  it("returns HTTP 503 on /ready/vajra when server is shutting down or stopped", async () => {
    await initializeServer({
      initializeDatabase: () => {},
      vajraOptions: { stateStore },
    });

    await shutdownServer();

    const req = new Request("http://localhost/ready/vajra");
    const res = await server.fetch(req, null, null);

    expect(res.status).toBe(503);
    expect(res.headers.get("X-Akira-Cognitive-Ready")).toBe("false");
    expect(res.headers.get("X-Akira-Cognitive-Status")).toBe("STOPPED");
  });

  it("returns HTTP 503 on /ready/vajra when an unresolved recovery mission is active (PAUSED_RECOVERY)", async () => {
    // Seed an interrupted mission with an interrupted step in PAUSED_RECOVERY
    const stepDef = createMissionStep({
      id: "step-rec-01",
      description: "Echo step",
      targetCapability: "system.echo",
      input: { text: "hello" },
      expectedEvidence: "evidence.ok",
    });
    const step = createVajraStepRecord({
      id: "step-rec-01",
      missionId: "m-paused-rec",
      stepOrder: 0,
      description: "Echo step",
      targetCapability: "system.echo",
      input: { text: "hello" },
      expectedEvidence: "evidence.ok",
      idempotencyKey: "idemp-step-01",
      correlationId: correlation.correlationId,
      dispatchState: "DISPATCHED",
    });

    const def = createMissionDefinition({
      id: "m-paused-rec",
      objective: "Interrupted mission",
      steps: [stepDef],
      completionCriteria: { description: "done", requiredEvidence: ["ev-1"] },
      correlation,
    });
    const state = createMissionState({ missionId: def.id, definitionId: def.id });
    const mission = createVajraMissionRecord({
      id: def.id,
      objective: def.objective,
      lifecycleState: "PAUSED_RECOVERY",
      definition: def,
      state,
      allocatedBudget: { maxCostCents: 10, maxSteps: 3 },
      idempotencyKey: `idemp-${def.id}`,
      requestId: correlation.requestId,
      correlationId: correlation.correlationId,
      invocationId: correlation.invocationId,
    });
    await stateStore.createMission(mission, [step]);
    await stateStore.preDispatchStep("step-rec-01", "idemp-step-01", new Date().toISOString());
    await stateStore.saveOperationalContext({
      ...validContext,
      activeMissionId: mission.id,
      mode: "REQUEST_DRIVEN",
    });

    await initializeServer({
      initializeDatabase: () => {},
      vajraOptions: { stateStore },
    });

    expect(isMissionAdmissionReady()).toBe(false);

    const req = new Request("http://localhost/ready/vajra");
    const res = await server.fetch(req, null, null);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.hasUnresolvedRecovery).toBe(true);
  });

  it("returns HTTP 503 on /ready/vajra when system health is CRITICAL", async () => {
    await initializeServer({
      initializeDatabase: () => {},
      vajraOptions: { stateStore },
    });

    // Simulate critical system health in operational context
    const controller = await ensureServerStarted();
    expect(controller.vajraReady).toBe(true);

    const activeCtrl = (await import("../../src/server-lifecycle")).getOperationalVajraController;
    const ctrl = await activeCtrl();
    ctrl.getSelfModel().updateOperationalContext({ systemHealthStatus: "CRITICAL" });

    expect(isMissionAdmissionReady()).toBe(false);

    const req = new Request("http://localhost/ready/vajra");
    const res = await server.fetch(req, null, null);

    expect(res.status).toBe(503);
  });

  // 4. HANDS Unavailable While VAJRA Remains Cognitively & Admission-Ready
  it("does NOT return 503 solely because HANDS is unavailable; accepts AKIRA OS capabilities", async () => {
    const unavailableHands = new UnavailableHandsAdapter();
    expect(unavailableHands.isAvailable()).toBe(false);

    await initializeServer({
      initializeDatabase: () => {},
      vajraOptions: {
        stateStore,
        handsPort: unavailableHands,
      },
    });

    const report = getVajraReadiness();
    expect(report.status).toBe("DEGRADED");
    expect(report.subsystems.realExecution).toBe(false);
    expect(report.isOperational).toBe(true);

    // Physical execution is false, but mission admission is ready for AKIRA OS software capabilities
    expect(isMissionAdmissionReady()).toBe(true);

    const req = new Request("http://localhost/ready/vajra");
    const res = await server.fetch(req, null, null);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Akira-Cognitive-Status")).toBe("DEGRADED");
    expect(res.headers.get("X-Akira-Cognitive-Ready")).toBe("true");
  });

  // 5. Standard Readiness Probe Headers
  it("emits X-Akira-Cognitive-Status and X-Akira-Cognitive-Ready headers on /ready probe", async () => {
    await initializeServer({
      initializeDatabase: () => {},
      vajraOptions: { stateStore },
    });

    const req = new Request("http://localhost/ready");
    const res = await server.fetch(req, null, null);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Akira-Cognitive-Status")).toBe("DEGRADED");
    expect(res.headers.get("X-Akira-Cognitive-Ready")).toBe("true");

    const body = await res.json();
    expect(body.applicationReady).toBe(true);
    expect(body.isDegraded).toBe(true);
    expect(body.degradedReasons).toContain(
      "Physical sandbox execution (HANDS) is unavailable; capability execution is constrained to AKIRA OS.",
    );
  });

  // 6. Dynamic Reflection of HANDS State Changes Post-Boot
  it("dynamically reflects HANDS status changes in getVajraReadiness without restart", async () => {
    let handsOnline = true;
    const dynamicHandsPort: IHandsPort = {
      isAvailable: () => handsOnline,
      executeSandbox: async () => ({ ok: false, error: "not implemented" }),
    };

    await initializeServer({
      initializeDatabase: () => {},
      vajraOptions: {
        stateStore,
        handsPort: dynamicHandsPort,
      },
    });

    let report = getVajraReadiness();
    expect(report.subsystems.realExecution).toBe(true);
    expect(report.degradedReasons).not.toContain(
      "Physical sandbox execution (HANDS) is unavailable; capability execution is constrained to AKIRA OS.",
    );

    // Simulate HANDS dropping offline
    handsOnline = false;

    report = getVajraReadiness();
    expect(report.subsystems.realExecution).toBe(false);
    expect(report.degradedReasons).toContain(
      "Physical sandbox execution (HANDS) is unavailable; capability execution is constrained to AKIRA OS.",
    );
    expect(report.status).toBe("DEGRADED");

    // Dynamic recovery of HANDS
    handsOnline = true;
    report = getVajraReadiness();
    expect(report.subsystems.realExecution).toBe(true);
  });

  // 7. Gate 6 PAUSED_RECOVERY Admission Block and Preserved Flows
  it("enforces Gate 6 recovery lock when active mission is PAUSED_RECOVERY", async () => {
    const registry = new CapabilityRegistry();
    const gateway = new MissionAdmissionGateway(stateStore, registry);

    const def = createMissionDefinition({
      id: "m-rec-locked",
      objective: "Locked mission",
      steps: [],
      completionCriteria: { description: "done", requiredEvidence: ["ev-1"] },
      correlation,
    });
    const state = createMissionState({ missionId: def.id, definitionId: def.id });
    const mission = createVajraMissionRecord({
      id: def.id,
      objective: def.objective,
      lifecycleState: "PAUSED_RECOVERY",
      definition: def,
      state,
      allocatedBudget: { maxCostCents: 10, maxSteps: 3 },
      idempotencyKey: `idemp-${def.id}`,
      requestId: correlation.requestId,
      correlationId: correlation.correlationId,
      invocationId: correlation.invocationId,
    });
    await stateStore.createMission(mission, []);
    await stateStore.saveOperationalContext({
      ...validContext,
      activeMissionId: mission.id,
      mode: "REQUEST_DRIVEN", // Diverged mode does not bypass lock
    });

    const action = createExecutiveAction({
      id: "act-new",
      kind: "start_mission",
      intent: "Try starting new mission while recovery is paused",
      confidence: 1.0,
      policyCompliance: true,
      correlation,
    });

    const outcome = await gateway.admitAction(action, validContext);
    expect(outcome.status).toBe("CONCURRENCY_LOCKED");
    if (outcome.status === "CONCURRENCY_LOCKED") {
      expect(outcome.activeMissionId).toBe("m-rec-locked");
      expect(outcome.reason).toContain("paused in recovery");
    }
  });

  // 8. Phase 8B resumeMission Remains Functional
  it("preserves Phase 8B authorized resumeMission flow on PAUSED_RECOVERY mission", async () => {
    const recoveryManager = new MissionRecoveryManager(stateStore);

    const stepDef = createMissionStep({
      id: "step-rec-01",
      description: "Echo step",
      targetCapability: "system.echo",
      input: { text: "hello" },
      expectedEvidence: "evidence.ok",
    });
    const step = createVajraStepRecord({
      id: "step-rec-01",
      missionId: "m-rec-resume",
      stepOrder: 0,
      description: "Echo step",
      targetCapability: "system.echo",
      input: { text: "hello" },
      expectedEvidence: "evidence.ok",
      idempotencyKey: "idemp-step-01",
      correlationId: correlation.correlationId,
    });

    const def = createMissionDefinition({
      id: "m-rec-resume",
      objective: "Resume mission",
      steps: [stepDef],
      completionCriteria: { description: "done", requiredEvidence: ["evidence.ok"] },
      correlation,
    });
    const state = createMissionState({ missionId: def.id, definitionId: def.id });
    const mission = createVajraMissionRecord({
      id: def.id,
      objective: def.objective,
      lifecycleState: "PAUSED_RECOVERY",
      definition: def,
      state,
      allocatedBudget: { maxCostCents: 10, maxSteps: 3 },
      idempotencyKey: `idemp-${def.id}`,
      requestId: correlation.requestId,
      correlationId: correlation.correlationId,
      invocationId: correlation.invocationId,
    });
    await stateStore.createMission(mission, [step]);
    await stateStore.preDispatchStep("step-rec-01", "idemp-step-01", new Date().toISOString());
    await stateStore.updateStepRecoveryClassification("step-rec-01", "VERIFIED_NEVER_STARTED");
    await stateStore.saveOperationalContext({
      ...validContext,
      activeMissionId: mission.id,
    });

    const mockCoordinator: any = {
      dispatchStep: vi.fn(async () => Result.success({ ok: true }, correlation)),
    };
    const mockObs: any = {
      ingestObservation: vi.fn(),
      getObservationsForMission: vi.fn(() => []),
      getObservationsForStep: vi.fn(() => []),
    };
    const mockVerif: any = {
      evaluateStep: vi.fn((stepId, missionId, obs) => ({
        id: `vr-${stepId}`,
        missionId,
        stepId,
        executionResultIds: [],
        observationIds: obs.map((o: any) => o.id),
        outcome: "criteria_satisfied",
        verifiedAt: new Date().toISOString(),
        correlation,
      })),
    };

    const runtime = new MissionRuntime(stateStore, mockCoordinator, mockObs, mockVerif);

    // Explicit resume with ResumeAuthorization succeeds
    const resumeResult = await runtime.resumeMission("m-rec-resume", {
      authorizedBy: "operator-01",
      reason: "Manual resume authorized after crash inspection",
    });

    expect(resumeResult.lifecycleState).toBe("COMPLETED");
    expect(mockCoordinator.dispatchStep).toHaveBeenCalledTimes(1);

    // Mission is now completed in store
    const updated = await stateStore.getMission("m-rec-resume");
    expect(updated?.lifecycleState).toBe("COMPLETED");
  });
});
