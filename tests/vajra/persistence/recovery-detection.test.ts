import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { SqliteOperationalStateStore } from "../../../src/persistence/vajra/sqlite-operational-state-store";
import { ExecutiveController } from "../../../src/vajra/executive/controller";
import { SelfModel } from "../../../src/vajra/self-model/self-model";
import { IGenesisPort } from "../../../src/vajra/boundaries/genesis-port";
import { IAkiraOSPort } from "../../../src/vajra/boundaries/akira-os-port";
import { IEscalationPort } from "../../../src/vajra/boundaries/escalation-port";
import {
  createVajraMissionRecord,
  createVajraStepRecord,
} from "../../../src/vajra/types/mission-record";
import { createVajraEscalationRecord } from "../../../src/vajra/types/escalation-record";
import { createDeliberationTrace } from "../../../src/vajra/types/trace";
import { createVajraVerificationRecord } from "../../../src/vajra/types/verification-record";
import { createMissionDefinition } from "../../../src/contracts/mission/mission-definition";
import { createMissionState } from "../../../src/contracts/mission/mission-state";

describe("Crash Recovery & Interruption Detection Tests", () => {
  let db: Database.Database;
  let store: SqliteOperationalStateStore;

  const mockGenesisPort: IGenesisPort = {
    subscribeToCognitiveDiscoveries: () => () => {},
    publishSelfModelUpdate: () => {},
  };

  const mockAkiraOSPort: IAkiraOSPort = {
    listAvailableCapabilities: () => [],
    getCapability: () => undefined,
    executeCapability: async () => {
      throw new Error("Must not be invoked during recovery detection");
    },
  };

  const mockEscalationPort: IEscalationPort = {
    requestHumanAuthorization: async () => {
      throw new Error("Must not be invoked during recovery detection");
    },
    subscribeToEscalationResolutions: () => () => {},
  };

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
    db.prepare(`
      INSERT OR IGNORE INTO vajra_operational_state (
        id, current_focus, operational_mode, human_presence, system_health_status, version, updated_at
      ) VALUES ('singleton', 'Awaiting human directive', 'REQUEST_DRIVEN', 'FOCUSED_ACTIVE', 'NOMINAL', 1, ?)
    `).run(new Date().toISOString());
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (3, ?)").run(
      new Date().toISOString(),
    );

    store = new SqliteOperationalStateStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("detects interrupted steps left in DISPATCHED state without execution results", async () => {
    const def = createMissionDefinition({
      objective: "Sync git repository",
      steps: [],
      completionCriteria: { description: "done", requiredEvidence: [] },
      correlation: { requestId: "r-rec", correlationId: "c-rec", invocationId: "i-rec" },
    });
    const st = createMissionState({ missionId: "m-rec", definitionId: "d-rec" });

    const mission = createVajraMissionRecord({
      id: "m-rec",
      objective: "Sync git repository",
      lifecycleState: "RUNNING",
      definition: def,
      state: st,
      allocatedBudget: { maxCostCents: 10, maxSteps: 2 },
      idempotencyKey: "k-m-rec",
      requestId: "r-rec",
      correlationId: "c-rec",
      invocationId: "i-rec",
    });

    const step1 = createVajraStepRecord({
      id: "s-rec-1",
      missionId: "m-rec",
      stepOrder: 1,
      description: "Pull latest git commits",
      targetCapability: "git.pull",
      input: { branch: "main" },
      expectedEvidence: "git_sha",
      dispatchState: "PENDING",
      idempotencyKey: "k-s-rec-1",
      correlationId: "c-rec",
    });

    await store.createMission(mission, [step1]);
    await store.preDispatchStep("s-rec-1", "k-s-rec-1");

    // Process crashed mid-step! Step is in DISPATCHED.
    const recoveryStates = await store.detectInterruptedMissions();
    expect(recoveryStates.length).toBe(1);
    expect(recoveryStates[0].mission.id).toBe("m-rec");
    expect(recoveryStates[0].interruptedSteps.length).toBe(1);
    expect(recoveryStates[0].interruptedSteps[0].targetCapability).toBe("git.pull");
  });

  it("hydrates interrupted state on ExecutiveController.boot() without executing loops", async () => {
    const def = createMissionDefinition({
      objective: "Reboot recovery test",
      steps: [],
      completionCriteria: { description: "done", requiredEvidence: [] },
      correlation: { requestId: "r-boot", correlationId: "c-boot", invocationId: "i-boot" },
    });
    const st = createMissionState({ missionId: "m-boot", definitionId: "d-boot" });

    const mission = createVajraMissionRecord({
      id: "m-boot",
      objective: "Reboot recovery test",
      lifecycleState: "RUNNING",
      definition: def,
      state: st,
      allocatedBudget: { maxCostCents: 10, maxSteps: 1 },
      idempotencyKey: "k-m-boot",
      requestId: "r-boot",
      correlationId: "c-boot",
      invocationId: "i-boot",
    });

    const step = createVajraStepRecord({
      id: "s-boot-1",
      missionId: "m-boot",
      stepOrder: 1,
      description: "Compile source",
      targetCapability: "build.compile",
      input: {},
      expectedEvidence: "build_output",
      dispatchState: "PENDING",
      idempotencyKey: "k-s-boot-1",
      correlationId: "c-boot",
    });

    await store.createMission(mission, [step]);
    await store.preDispatchStep("s-boot-1", "k-s-boot-1");

    // Boot new controller instance
    const selfModel = new SelfModel();
    const controller = new ExecutiveController({
      selfModel,
      genesisPort: mockGenesisPort,
      akiraOSPort: mockAkiraOSPort,
      escalationPort: mockEscalationPort,
      stateStore: store,
    });

    const bootResult = await controller.boot();
    expect(bootResult.ok).toBe(true);

    // Assert controller transitioned to RECOVERY mode and paused the mission
    const ctx = controller.getOperationalContext();
    expect(ctx.mode).toBe("RECOVERY");
    expect(ctx.currentFocus).toContain("Interrupted operation detected: step 1 (build.compile)");

    const missionAfter = await store.getMission("m-boot");
    expect(missionAfter?.lifecycleState).toBe("PAUSED_RECOVERY");

    // Invariant: ZERO capability calls were made
    // (mockAkiraOSPort would throw if called)
  });

  it("hydrates pending escalations into PAUSED_APPROVAL state on boot", async () => {
    const def = createMissionDefinition({
      objective: "Approval recovery test",
      steps: [],
      completionCriteria: { description: "done", requiredEvidence: [] },
      correlation: { requestId: "r-esc", correlationId: "c-esc", invocationId: "i-esc" },
    });
    const st = createMissionState({ missionId: "m-esc", definitionId: "d-esc" });

    const mission = createVajraMissionRecord({
      id: "m-esc",
      objective: "Approval recovery test",
      lifecycleState: "RUNNING",
      definition: def,
      state: st,
      allocatedBudget: { maxCostCents: 10, maxSteps: 1 },
      idempotencyKey: "k-m-esc",
      requestId: "r-esc",
      correlationId: "c-esc",
      invocationId: "i-esc",
    });

    await store.createMission(mission, []);

    const esc = createVajraEscalationRecord({
      id: "esc-boot-1",
      missionId: "m-esc",
      actionProposed: "Wipe test cache",
      impactClass: "HIGH",
      riskExplanation: "Data will be deleted",
      status: "PENDING_APPROVAL",
      requestId: "r-esc",
      correlationId: "c-esc",
    });

    await store.createEscalation(esc);

    const selfModel = new SelfModel();
    const controller = new ExecutiveController({
      selfModel,
      genesisPort: mockGenesisPort,
      akiraOSPort: mockAkiraOSPort,
      escalationPort: mockEscalationPort,
      stateStore: store,
    });

    await controller.boot();

    const ctx = controller.getOperationalContext();
    expect(ctx.mode).toBe("PAUSED");
    expect(ctx.currentFocus).toContain("Pending human approval required for mission m-esc");

    const missionAfter = await store.getMission("m-esc");
    expect(missionAfter?.lifecycleState).toBe("PAUSED_APPROVAL");
  });

  it("reconstructs complete K19 execution provenance in chronological order", async () => {
    const corrId = "corr-unified-provenance-001";

    // 1. Trace stage
    await store.appendAuditTrace(
      createDeliberationTrace({
        traceId: "tr-prov-1",
        stimulusId: "stim-prov",
        correlation: { requestId: "req-1", correlationId: corrId, invocationId: "inv-1" },
        intentClass: "user_intent",
        consideredOptions: [],
        selectedOption: "create_mission",
        rationale: "User requested system update",
        evidenceReliedUpon: [],
        escalationRequired: false,
        timestamp: "2026-10-04T10:00:00.000Z",
      }),
    );

    // 2. Mission stage
    const def = createMissionDefinition({
      objective: "Provenance mission",
      steps: [],
      completionCriteria: { description: "done", requiredEvidence: [] },
      correlation: { requestId: "req-1", correlationId: corrId, invocationId: "inv-1" },
    });
    const st = createMissionState({ missionId: "m-prov-1", definitionId: "d-prov-1" });

    const mission = createVajraMissionRecord({
      id: "m-prov-1",
      objective: "Execute update",
      lifecycleState: "RUNNING",
      definition: def,
      state: st,
      allocatedBudget: { maxCostCents: 10, maxSteps: 1 },
      idempotencyKey: "k-prov-m",
      requestId: "req-1",
      correlationId: corrId,
      invocationId: "inv-1",
      createdAt: "2026-10-04T10:01:00.000Z",
      updatedAt: "2026-10-04T10:01:00.000Z",
    });

    const step = createVajraStepRecord({
      id: "s-prov-1",
      missionId: "m-prov-1",
      stepOrder: 1,
      description: "Download package",
      targetCapability: "pkg.download",
      input: {},
      expectedEvidence: "pkg_hash",
      dispatchState: "PENDING",
      idempotencyKey: "k-prov-s",
      correlationId: corrId,
    });

    await store.createMission(mission, [step]);

    // 3. Step stage
    await store.preDispatchStep("s-prov-1", "k-prov-s", "2026-10-04T10:02:00.000Z");
    await store.recordStepExecution("s-prov-1", "res-pkg-1", "2026-10-04T10:02:30.000Z");

    // 4. Verification stage
    await store.saveVerification(
      createVajraVerificationRecord({
        id: "ver-prov-1",
        missionId: "m-prov-1",
        stepId: "s-prov-1",
        outcome: "criteria_satisfied",
        evidenceIds: ["obs-hash-match"],
        evaluatorNotes: "Hash validated",
        correlationId: corrId,
        invocationId: "inv-ver-1",
        recordedAt: "2026-10-04T10:03:00.000Z",
      }),
    );

    // Query unified provenance
    const trail = await store.getExecutionProvenance(corrId);
    expect(trail.length).toBe(4);
    expect(trail[0].stage).toBe("deliberation");
    expect(trail[0].description).toBe("User requested system update");
    expect(trail[1].stage).toBe("mission");
    expect(trail[1].description).toBe("Execute update");
    expect(trail[2].stage).toBe("step");
    expect(trail[2].description).toBe("Download package");
    expect(trail[3].stage).toBe("verification");
    expect(trail[3].description).toBe("criteria_satisfied");
  });
});
