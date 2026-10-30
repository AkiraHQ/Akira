import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { SqliteOperationalStateStore } from "../../../src/persistence/vajra/sqlite-operational-state-store";
import { createInitialOperationalContext } from "../../../src/vajra/types/operational-context";
import { createBelief } from "../../../src/vajra/types/belief";
import { createDeliberationTrace } from "../../../src/vajra/types/trace";
import {
  createVajraMissionRecord,
  createVajraStepRecord,
} from "../../../src/vajra/types/mission-record";
import { createVajraEscalationRecord } from "../../../src/vajra/types/escalation-record";
import { createVajraVerificationRecord } from "../../../src/vajra/types/verification-record";
import { createMissionDefinition } from "../../../src/contracts/mission/mission-definition";
import { createMissionState } from "../../../src/contracts/mission/mission-state";

describe("SqliteOperationalStateStore — CRUD & Operations", () => {
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

  describe("OperationalContext persistence & Optimistic Locking", () => {
    it("saves and reloads initial operational context", async () => {
      const initial = createInitialOperationalContext();
      await store.saveOperationalContext(initial);

      const loaded = await store.loadOperationalContext();
      expect(loaded).not.toBeNull();
      expect(loaded?.currentFocus).toBe("Awaiting human directive");
      expect(loaded?.mode).toBe("REQUEST_DRIVEN");
      expect(loaded?.version).toBe(1);
    });

    it("increments version counter on successful update", async () => {
      const initial = createInitialOperationalContext();
      await store.saveOperationalContext(initial);

      const loaded1 = await store.loadOperationalContext();
      expect(loaded1?.version).toBe(1);

      // Update with version 1
      await store.saveOperationalContext({
        ...loaded1!,
        currentFocus: "Evaluating next turn",
      });

      const loaded2 = await store.loadOperationalContext();
      expect(loaded2?.version).toBe(2);
      expect(loaded2?.currentFocus).toBe("Evaluating next turn");
    });

    it("throws optimistic concurrency conflict if expected version does not match", async () => {
      const initial = createInitialOperationalContext();
      await store.saveOperationalContext(initial);

      // Attempt to save with stale version 99
      await expect(
        store.saveOperationalContext({
          ...initial,
          version: 99,
          currentFocus: "Conflicting write",
        }),
      ).rejects.toThrow(/Optimistic concurrency conflict/);
    });
  });

  describe("Epistemic Beliefs persistence", () => {
    it("saves, loads, and queries beliefs", async () => {
      const belief1 = createBelief({
        id: "b-node-version",
        proposition: "Node runtime is v20+",
        confidence: 0.95,
        verificationState: "VERIFIED",
        supportingEvidenceIds: ["obs-version-cmd"],
      });

      await store.saveBelief(belief1);

      const fetched = await store.getBelief("b-node-version");
      expect(fetched).not.toBeNull();
      expect(fetched?.proposition).toBe("Node runtime is v20+");
      expect(fetched?.confidence).toBe(0.95);
      expect(fetched?.verificationState).toBe("VERIFIED");
      expect(fetched?.supportingEvidenceIds).toEqual(["obs-version-cmd"]);

      const all = await store.loadBeliefs();
      expect(all.length).toBe(1);

      await store.deleteBelief("b-node-version");
      const deleted = await store.getBelief("b-node-version");
      expect(deleted).toBeNull();
    });
  });

  describe("Deliberation Traces audit logging", () => {
    it("appends and queries deliberation traces by correlation and stimulus", async () => {
      const trace = createDeliberationTrace({
        traceId: "tr-001",
        stimulusId: "stim-001",
        correlation: {
          requestId: "req-001",
          correlationId: "corr-100",
          invocationId: "inv-001",
        },
        intentClass: "user_command",
        consideredOptions: [
          { action: "run_step", risk: "LOW", confidence: 0.9 },
          { action: "ask_user", risk: "LOW", confidence: 0.5 },
        ],
        selectedOption: "run_step",
        rationale: "Clear command within safe policy envelope",
        evidenceReliedUpon: ["belief-1"],
        escalationRequired: false,
      });

      await store.appendAuditTrace(trace);

      const byCorr = await store.queryAuditTracesByCorrelation("corr-100");
      expect(byCorr.length).toBe(1);
      expect(byCorr[0].traceId).toBe("tr-001");
      expect(byCorr[0].selectedOption).toBe("run_step");
      expect(byCorr[0].consideredOptions.length).toBe(2);

      const byStim = await store.queryAuditTracesByStimulus("stim-001");
      expect(byStim.length).toBe(1);

      const recent = await store.queryAuditTraces(10);
      expect(recent.length).toBe(1);
    });
  });

  describe("Missions & Steps persistence", () => {
    it("creates mission with steps in an atomic transaction", async () => {
      const def = createMissionDefinition({
        id: "m-def-1",
        objective: "Inspect system health",
        steps: [],
        completionCriteria: {
          description: "Health checks pass",
          requiredEvidence: ["obs-health"],
        },
        correlation: {
          requestId: "req-1",
          correlationId: "corr-1",
          invocationId: "inv-1",
        },
      });

      const missionState = createMissionState({
        missionId: "m-100",
        definitionId: "m-def-1",
      });

      const mission = createVajraMissionRecord({
        id: "m-100",
        objective: "Inspect system health",
        lifecycleState: "CREATED",
        definition: def,
        state: missionState,
        allocatedBudget: { maxCostCents: 50, maxSteps: 3 },
        idempotencyKey: "idem-m-100",
        requestId: "req-1",
        correlationId: "corr-1",
        invocationId: "inv-1",
      });

      const step1 = createVajraStepRecord({
        id: "s-1",
        missionId: "m-100",
        stepOrder: 1,
        description: "Check Node version",
        targetCapability: "system.info",
        input: { check: "node" },
        expectedEvidence: "node_version",
        idempotencyKey: "idem-s-1",
        correlationId: "corr-1",
      });

      await store.createMission(mission, [step1]);

      const loadedMission = await store.getMission("m-100");
      expect(loadedMission).not.toBeNull();
      expect(loadedMission?.objective).toBe("Inspect system health");
      expect(loadedMission?.lifecycleState).toBe("CREATED");

      const loadedSteps = await store.getStepsForMission("m-100");
      expect(loadedSteps.length).toBe(1);
      expect(loadedSteps[0].targetCapability).toBe("system.info");
      expect(loadedSteps[0].dispatchState).toBe("PENDING");
    });

    it("enforces Phase 3 Single Running Mission Concurrency Policy", async () => {
      const def = createMissionDefinition({
        objective: "Run mission",
        steps: [],
        completionCriteria: { description: "done", requiredEvidence: [] },
        correlation: { requestId: "r", correlationId: "c", invocationId: "i" },
      });
      const st = createMissionState({ missionId: "m-1", definitionId: "d-1" });

      const m1 = createVajraMissionRecord({
        id: "m-1",
        objective: "First mission",
        lifecycleState: "RUNNING",
        definition: def,
        state: st,
        allocatedBudget: { maxCostCents: 10, maxSteps: 1 },
        idempotencyKey: "k-1",
        requestId: "r-1",
        correlationId: "c-1",
        invocationId: "i-1",
      });

      const m2 = createVajraMissionRecord({
        id: "m-2",
        objective: "Second mission concurrently",
        lifecycleState: "RUNNING",
        definition: def,
        state: st,
        allocatedBudget: { maxCostCents: 10, maxSteps: 1 },
        idempotencyKey: "k-2",
        requestId: "r-2",
        correlationId: "c-2",
        invocationId: "i-2",
      });

      // Saving m1 as RUNNING succeeds
      await store.createMission(m1, []);

      // Saving m2 as RUNNING fails due to idx_vajra_single_running_mission unique index
      await expect(store.createMission(m2, [])).rejects.toThrow();

      // But saving m2 as PAUSED_APPROVAL succeeds
      const m2Paused = createVajraMissionRecord({
        ...m2,
        lifecycleState: "PAUSED_APPROVAL",
      });
      await store.createMission(m2Paused, []);
      const loadedM2 = await store.getMission("m-2");
      expect(loadedM2?.lifecycleState).toBe("PAUSED_APPROVAL");
    });
  });

  describe("Escalations & Verifications", () => {
    it("persists escalation and resolves it cleanly", async () => {
      const esc = createVajraEscalationRecord({
        id: "esc-01",
        actionProposed: "Delete build cache",
        impactClass: "MEDIUM",
        riskExplanation: "Will require rebuild of artifacts",
        requestId: "req-esc",
        correlationId: "corr-esc",
      });

      await store.createEscalation(esc);

      const pending = await store.getPendingEscalations();
      expect(pending.length).toBe(1);
      expect(pending[0].id).toBe("esc-01");

      await store.resolveEscalation(
        "esc-01",
        "APPROVED",
        "User confirmed via modal",
      );

      const resolved = await store.getEscalation("esc-01");
      expect(resolved?.status).toBe("APPROVED");
      expect(resolved?.resolutionComment).toBe("User confirmed via modal");
      expect(resolved?.resolvedAt).toBeDefined();

      const pendingAfter = await store.getPendingEscalations();
      expect(pendingAfter.length).toBe(0);
    });

    it("saves verification and transitions step state to VERIFIED upon satisfaction", async () => {
      // First create mission and step
      const def = createMissionDefinition({
        objective: "Verify tests",
        steps: [],
        completionCriteria: { description: "done", requiredEvidence: [] },
        correlation: { requestId: "r", correlationId: "c", invocationId: "i" },
      });
      const st = createMissionState({ missionId: "m-v", definitionId: "d-v" });

      const mission = createVajraMissionRecord({
        id: "m-v",
        objective: "Verify tests",
        lifecycleState: "RUNNING",
        definition: def,
        state: st,
        allocatedBudget: { maxCostCents: 10, maxSteps: 1 },
        idempotencyKey: "k-v",
        requestId: "r-v",
        correlationId: "c-v",
        invocationId: "i-v",
      });

      const step = createVajraStepRecord({
        id: "s-v",
        missionId: "m-v",
        stepOrder: 1,
        description: "Run test suite",
        targetCapability: "test.run",
        input: {},
        expectedEvidence: "test_report",
        dispatchState: "EXECUTED",
        idempotencyKey: "k-s-v",
        correlationId: "c-v",
      });

      await store.createMission(mission, [step]);

      const ver = createVajraVerificationRecord({
        id: "ver-01",
        missionId: "m-v",
        stepId: "s-v",
        outcome: "criteria_satisfied",
        evidenceIds: ["obs-test-pass"],
        evaluatorNotes: "All 5 tests passed",
        correlationId: "c-v",
        invocationId: "i-v",
      });

      await store.saveVerification(ver);

      const stepAfter = await store.getStep("s-v");
      expect(stepAfter?.dispatchState).toBe("VERIFIED");
      expect(stepAfter?.verifiedAt).toBeDefined();

      const vers = await store.getVerificationsForStep("s-v");
      expect(vers.length).toBe(1);
      expect(vers[0].outcome).toBe("criteria_satisfied");
    });
  });
});
