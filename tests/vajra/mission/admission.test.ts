import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { MissionAdmissionGateway } from "../../../src/vajra/mission/admission";
import { SqliteOperationalStateStore } from "../../../src/persistence/vajra/sqlite-operational-state-store";
import { CapabilityRegistry } from "../../../src/contracts/capabilities/registry";
import { CapabilityDescriptor } from "../../../src/contracts/capabilities/descriptor";
import { ApprovalManager } from "../../../src/vajra/decision/approval-manager";
import { createExecutiveAction, ExecutiveAction } from "../../../src/vajra/types/action";
import { CorrelationMetadata } from "../../../src/contracts/results/result";
import { OperationalContext } from "../../../src/vajra/types/operational-context";
import { createVajraMissionRecord } from "../../../src/vajra/types/mission-record";
import { createMissionDefinition } from "../../../src/contracts/mission/mission-definition";
import { createMissionState } from "../../../src/contracts/mission/mission-state";

describe("MissionAdmissionGateway (Phase 6 Admission Gating)", () => {
  let db: Database.Database;
  let stateStore: SqliteOperationalStateStore;
  let capabilityRegistry: CapabilityRegistry;
  let approvalManager: ApprovalManager;
  let gateway: MissionAdmissionGateway;

  const correlation: CorrelationMetadata = {
    requestId: "req-adm-1",
    correlationId: "corr-adm-1",
    invocationId: "inv-adm-1",
  };

  const validContext: OperationalContext = {
    currentFocus: "Test Mission Admission",
    mode: "REQUEST_DRIVEN",
    activeMissionId: null,
    humanPresence: "FOCUSED_ACTIVE",
    systemHealthStatus: "NOMINAL",
    version: 1,
    updatedAt: new Date().toISOString(),
  };

  const createTestCapability = (name: string, allowVajra: boolean = true, isAvailable: boolean = true): CapabilityDescriptor => ({
    name,
    version: "1.0.0",
    description: `Test capability ${name}`,
    owner: "AKIRA OS · system",
    kind: "Command",
    riskClass: "LOW",
    costClass: "local_cheap",
    activationTier: 0,
    executionCharacteristics: {
      isSynchronous: true,
      isReadOnly: false,
      isIdempotent: true,
    },
    isAvailable,
    permissions: {
      allowVajra,
    },
    inputSchema: { type: "object" },
  });

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    // Apply base schema
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

    stateStore = new SqliteOperationalStateStore(db);
    capabilityRegistry = new CapabilityRegistry();
    capabilityRegistry.register(createTestCapability("system.echo"));
    approvalManager = new ApprovalManager(stateStore);
    gateway = new MissionAdmissionGateway(stateStore, capabilityRegistry, approvalManager);
  });

  afterEach(() => {
    db.close();
  });

  const createBaseAction = (overrides?: Partial<Parameters<typeof createExecutiveAction>[0]>): ExecutiveAction => {
    return createExecutiveAction({
      id: "act-adm-01",
      kind: "start_mission",
      intent: "Run test mission",
      rationale: "Automated test objective",
      confidence: 0.95,
      policyCompliance: true,
      correlation,
      stateVersion: 1,
      ...overrides,
    });
  };

  it("Gate 1: Rejects actions whose kind is not canonical 'start_mission'", async () => {
    const action = createBaseAction({
      kind: "answer_conversation",
    });

    const outcome = await gateway.admitAction(action, validContext);
    expect(outcome.status).toBe("REJECTED");
    expect(outcome.reason).toContain("start_mission");
  });

  it("Gate 2: Rejects actions failing structural integrity", async () => {
    // Missing correlation
    const malformedCorrelationAction = {
      ...createBaseAction(),
      correlation: {} as unknown as CorrelationMetadata,
    };
    const resCorr = await gateway.admitAction(malformedCorrelationAction as unknown as ExecutiveAction, validContext);
    expect(resCorr.status).toBe("REJECTED");
    expect(resCorr.reason).toContain("CorrelationMetadata");

    // Non-compliant policy
    const nonCompliantAction = createBaseAction({
      policyCompliance: false,
    });
    const resPolicy = await gateway.admitAction(nonCompliantAction, validContext);
    expect(resPolicy.status).toBe("REJECTED");
    expect(resPolicy.reason).toContain("not policy compliant");
  });

  it("Gate 3: Pauses or rejects based on human approval state", async () => {
    // APPROVAL_REQUIRED without escalationId -> REJECTED
    const actionMissingEscId = createBaseAction({
      approvalState: "APPROVAL_REQUIRED",
    });
    const resNoEsc = await gateway.admitAction(actionMissingEscId, validContext);
    expect(resNoEsc.status).toBe("REJECTED");
    expect(resNoEsc.reason).toContain("escalationId");

    // WAITING_FOR_HUMAN with escalation pending -> PAUSED_APPROVAL
    const escRecord = await approvalManager.createApprovalGate({
      decisionId: "dec-01",
      actionId: "act-adm-01",
      option: {
        id: "opt-1",
        intent: "High-risk operation",
        targetCapability: "system.echo",
        confidence: 0.9,
        riskScore: 0.8,
        reversible: false,
        requiresApproval: true,
      },
      context: validContext,
      policy: {
        maxAutonomousCostCents: 10,
        maxAutonomousSteps: 3,
        maxAutonomousRatePerHour: 5,
        prohibitedCapabilities: [],
        irreversibleActionThreshold: "HIGH",
        policyVersion: "1.0.0",
      },
      rationale: "Requires human review",
      correlation,
    });

    const actionPendingApproval = createBaseAction({
      approvalState: "WAITING_FOR_HUMAN",
      escalationId: escRecord.id,
    });
    const resPending = await gateway.admitAction(actionPendingApproval, validContext);
    expect(resPending.status).toBe("PAUSED_APPROVAL");

    // Rejected by human in SQLite
    await stateStore.resolveEscalation(escRecord.id, "REJECTED", "Operator denied");
    const resRejected = await gateway.admitAction(actionPendingApproval, validContext);
    expect(resRejected.status).toBe("REJECTED");

    // Human approved
    await stateStore.resolveEscalation(escRecord.id, "APPROVED", "Operator approved");
    const resApproved = await gateway.admitAction(actionPendingApproval, validContext);
    expect(resApproved.status).toBe("ADMITTED");
  });

  it("Gate 4: Rejects when state version drifts (staleness guard)", async () => {
    const staleAction = createBaseAction({
      stateVersion: 1,
    });
    const advancedContext: OperationalContext = {
      ...validContext,
      version: 2,
    };

    const outcome = await gateway.admitAction(staleAction, advancedContext);
    expect(outcome.status).toBe("STALE");
    expect(outcome.reason).toContain("version drift");
  });

  it("Gate 5: Rejects when operational context reports CRITICAL system health", async () => {
    const action = createBaseAction();
    const criticalContext: OperationalContext = {
      ...validContext,
      systemHealthStatus: "CRITICAL",
    };

    const outcome = await gateway.admitAction(action, criticalContext);
    expect(outcome.status).toBe("HEALTH_DEGRADED");
    expect(outcome.reason).toContain("CRITICAL");
  });

  it("Gate 6: Rejects with CONCURRENCY_LOCKED when another mission is currently RUNNING", async () => {
    const def = createMissionDefinition({
      id: "active-mission-01",
      objective: "Already running mission",
      steps: [],
      completionCriteria: { description: "done", requiredEvidence: ["ev-1"] },
      correlation,
    });
    const state = createMissionState({
      missionId: def.id,
      definitionId: def.id,
    });
    const activeMission = createVajraMissionRecord({
      id: def.id,
      objective: def.objective,
      lifecycleState: "RUNNING",
      definition: def,
      state,
      allocatedBudget: { maxCostCents: 10, maxSteps: 3 },
      idempotencyKey: `idemp-${def.id}`,
      requestId: correlation.requestId,
      correlationId: correlation.correlationId,
      invocationId: correlation.invocationId,
    });
    await stateStore.createMission(activeMission, []);

    const action = createBaseAction({ id: "new-mission-02" });
    const outcome = await gateway.admitAction(action, validContext);
    expect(outcome.status).toBe("CONCURRENCY_LOCKED");
    if (outcome.status === "CONCURRENCY_LOCKED") {
      expect(outcome.activeMissionId).toBe("active-mission-01");
    }
  });

  it("Gate 6: Rejects with CONCURRENCY_LOCKED when active mission is in PAUSED_RECOVERY even if mode is REQUEST_DRIVEN", async () => {
    const def = createMissionDefinition({
      id: "paused-recovery-mission-01",
      objective: "Interrupted mission awaiting recovery",
      steps: [],
      completionCriteria: { description: "done", requiredEvidence: ["ev-1"] },
      correlation,
    });
    const state = createMissionState({
      missionId: def.id,
      definitionId: def.id,
    });
    const pausedMission = createVajraMissionRecord({
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
    await stateStore.createMission(pausedMission, []);
    await stateStore.saveOperationalContext({
      ...validContext,
      activeMissionId: pausedMission.id,
    });

    // Context mode is REQUEST_DRIVEN (diverged from recovery)
    const requestDrivenContext: OperationalContext = {
      ...validContext,
      mode: "REQUEST_DRIVEN",
      activeMissionId: pausedMission.id,
    };

    const action = createBaseAction({ id: "new-mission-03" });
    const outcome = await gateway.admitAction(action, requestDrivenContext);
    expect(outcome.status).toBe("CONCURRENCY_LOCKED");
    if (outcome.status === "CONCURRENCY_LOCKED") {
      expect(outcome.activeMissionId).toBe("paused-recovery-mission-01");
      expect(outcome.reason).toContain("paused in recovery");
    }
  });

  it("Gate 6: Does not block admission with recovery lock when active mission is in PAUSED_APPROVAL", async () => {
    const def = createMissionDefinition({
      id: "paused-approval-mission-01",
      objective: "Mission awaiting approval",
      steps: [],
      completionCriteria: { description: "done", requiredEvidence: ["ev-1"] },
      correlation,
    });
    const state = createMissionState({
      missionId: def.id,
      definitionId: def.id,
    });
    const pausedApprovalMission = createVajraMissionRecord({
      id: def.id,
      objective: def.objective,
      lifecycleState: "PAUSED_APPROVAL",
      definition: def,
      state,
      allocatedBudget: { maxCostCents: 10, maxSteps: 3 },
      idempotencyKey: `idemp-${def.id}`,
      requestId: correlation.requestId,
      correlationId: correlation.correlationId,
      invocationId: correlation.invocationId,
    });
    await stateStore.createMission(pausedApprovalMission, []);
    await stateStore.saveOperationalContext({
      ...validContext,
      activeMissionId: pausedApprovalMission.id,
      version: 2, // version incremented after previous save
    });

    const action = createBaseAction({ id: "new-mission-04" });
    const outcome = await gateway.admitAction(action, validContext);
    // Should NOT be CONCURRENCY_LOCKED by recovery lock
    expect(outcome.status).not.toBe("CONCURRENCY_LOCKED");
    expect(outcome.status).toBe("ADMITTED");
  });

  it("Gate 7: Pre-flight capability checks enforce registration and permissions", async () => {
    // Missing capability
    const actionMissingCap = createBaseAction({
      requiredCapability: "nonexistent.capability",
    });
    const resMissing = await gateway.admitAction(actionMissingCap, validContext);
    expect(resMissing.status).toBe("CAPABILITY_UNAVAILABLE");

    // Disallowed for VAJRA
    capabilityRegistry.register(createTestCapability("forbidden.capability", false, true));
    const actionForbidden = createBaseAction({
      requiredCapability: "forbidden.capability",
    });
    const resForbidden = await gateway.admitAction(actionForbidden, validContext);
    expect(resForbidden.status).toBe("CAPABILITY_UNAVAILABLE");
    expect(resForbidden.reason).toContain("disallows VAJRA invocation");

    // Unavailable capability
    capabilityRegistry.register(createTestCapability("down.capability", true, false));
    const actionDown = createBaseAction({
      requiredCapability: "down.capability",
    });
    const resDown = await gateway.admitAction(actionDown, validContext);
    expect(resDown.status).toBe("CAPABILITY_UNAVAILABLE");
    expect(resDown.reason).toContain("currently unavailable");
  });

  it("Gate 8: Idempotency de-duplication prevents duplicate admissions", async () => {
    const action = createBaseAction({ id: "unique-mission-123" });

    // First admission succeeds
    const firstOutcome = await gateway.admitAction(action, validContext);
    expect(firstOutcome.status).toBe("ADMITTED");
    if (firstOutcome.status === "ADMITTED") {
      expect(firstOutcome.action.id).toBe("unique-mission-123");
      expect(firstOutcome.idempotencyKey).toBeDefined();
    }

    // Simulate creation of this mission in store
    const def = createMissionDefinition({
      id: action.id,
      objective: action.intent ?? "test",
      steps: [],
      completionCriteria: { description: "done", requiredEvidence: ["ev-1"] },
      correlation,
    });
    const rec = createVajraMissionRecord({
      id: action.id,
      objective: def.objective,
      lifecycleState: "COMPLETED",
      definition: def,
      state: createMissionState({ missionId: def.id, definitionId: def.id }),
      allocatedBudget: { maxCostCents: 10, maxSteps: 3 },
      idempotencyKey: `idemp-${action.id}`,
      requestId: correlation.requestId,
      correlationId: correlation.correlationId,
      invocationId: correlation.invocationId,
    });
    await stateStore.createMission(rec, []);

    // Second admission with same id is de-duplicated
    const secondOutcome = await gateway.admitAction(action, validContext);
    expect(secondOutcome.status).toBe("DUPLICATE_ADMISSION");
  });
});
