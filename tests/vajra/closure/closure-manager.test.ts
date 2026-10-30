import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { MissionClosureManager } from "../../../src/vajra/closure/closure-manager";
import { SqliteOperationalStateStore } from "../../../src/persistence/vajra/sqlite-operational-state-store";
import { EventBus } from "../../../src/instrumentation/event-bus";
import { EventSubscriber } from "../../../src/instrumentation/subscriber";
import { AkiraEvent } from "../../../src/instrumentation/event-types";
import { createVerificationRecord } from "../../../src/contracts/capabilities/verification";
import {
  createMissionDefinition,
  createMissionStep,
} from "../../../src/contracts/mission/mission-definition";
import { createMissionState } from "../../../src/contracts/mission/mission-state";
import {
  createVajraMissionRecord,
  createVajraStepRecord,
} from "../../../src/vajra/types/mission-record";
import { createInitialOperationalContext } from "../../../src/vajra/types/operational-context";
import { createBelief } from "../../../src/vajra/types/belief";
import { CorrelationMetadata } from "../../../src/contracts/results/result";

describe("MissionClosureManager (Phase 7 - Reality Closure, Belief Reconciliation & EventBus)", () => {
  let db: Database.Database;
  let stateStore: SqliteOperationalStateStore;
  let eventBus: EventBus;
  let closureManager: MissionClosureManager;

  const correlation: CorrelationMetadata = {
    requestId: "req-closure-01",
    correlationId: "corr-closure-01",
    invocationId: "inv-closure-01",
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
    eventBus = new EventBus();
    closureManager = new MissionClosureManager(stateStore, eventBus);
  });

  afterEach(() => {
    db.close();
  });

  const setupMission = async (missionId: string) => {
    const step = createMissionStep({
      id: `step-${missionId}`,
      missionId,
      stepOrder: 1,
      description: "Test step",
      targetCapability: "capability.deploy",
      input: {},
      expectedEvidence: "evidence.deployment.verified",
    });

    const def = createMissionDefinition({
      id: missionId,
      objective: "Deploy application",
      goalId: "goal-deploy-01",
      steps: [step],
      constraints: { maxSteps: 1, confirmationRequired: false },
      completionCriteria: {
        description: "Deployment verified",
        requiredEvidence: ["evidence.deployment.verified"],
      },
      correlation,
    });

    const mission = createVajraMissionRecord({
      id: missionId,
      objective: def.objective,
      lifecycleState: "RUNNING",
      definition: def,
      state: createMissionState({ missionId, definitionId: missionId }),
      allocatedBudget: { maxCostCents: 50, maxSteps: 1 },
      idempotencyKey: `idemp-${missionId}`,
      requestId: correlation.requestId,
      correlationId: correlation.correlationId,
      invocationId: correlation.invocationId,
    });

    const stepRecord = createVajraStepRecord({
      id: step.id,
      missionId,
      stepOrder: 1,
      description: step.description,
      targetCapability: step.targetCapability,
      input: step.input,
      expectedEvidence: step.expectedEvidence,
      idempotencyKey: `idemp-${step.id}`,
      correlationId: correlation.correlationId,
    });

    await stateStore.createMission(mission, [stepRecord]);

    // Set active mission in operational context
    const ctx = createInitialOperationalContext();
    await stateStore.saveOperationalContext({
      ...ctx,
      activeMissionId: missionId,
      version: 1,
    });
    return { def, mission, stepRecord };
  };

  it("completes mission, updates lifecycle to COMPLETED, clears activeMissionId, and creates MissionResult", async () => {
    const { mission } = await setupMission("mission-close-1");

    const terminalVerification = createVerificationRecord({
      missionId: mission.id,
      stepId: `step-${mission.id}`,
      executionResultIds: ["exec-deploy-1"],
      observationIds: ["obs-deploy-1"],
      outcome: "criteria_satisfied",
      rationale: "Deployment health check confirmed 200 OK",
      correlation: {
        requestId: correlation.requestId,
        correlationId: correlation.correlationId,
        causationId: correlation.invocationId,
        invocationId: correlation.invocationId,
        missionId: mission.id,
        stepId: `step-${mission.id}`,
      },
    });

    const result = await closureManager.closeMission({
      missionId: mission.id,
      terminalVerificationRecord: terminalVerification,
    });

    expect(result.status).toBe("completed");
    expect(result.missionResult.status).toBe("completed");
    expect(result.missionResult.verificationRecordId).toBe(terminalVerification.id);
    expect(result.missionResult.goalId).toBe("goal-deploy-01");

    // Verify SQLite mission lifecycle state updated to COMPLETED
    const updatedMission = await stateStore.getMission(mission.id);
    expect(updatedMission?.lifecycleState).toBe("COMPLETED");
    expect(updatedMission?.completedAt).toBeDefined();

    // Verify activeMissionId cleared in vajra_operational_state
    const updatedCtx = await stateStore.loadOperationalContext();
    expect(updatedCtx?.activeMissionId).toBeNull();
  });

  it("reconciles registered vajra_beliefs: promotes to VERIFIED only when uncontradicted", async () => {
    const { mission } = await setupMission("mission-close-2");

    // Pre-register an UNVERIFIED belief regarding deployment
    const deploymentBelief = createBelief({
      id: "belief-deployment-status",
      proposition: "System deployment verified: evidence.deployment.verified",
      confidence: 0.5,
      verificationState: "UNVERIFIED",
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
    });
    await stateStore.saveBelief(deploymentBelief);

    const terminalVerification = createVerificationRecord({
      missionId: mission.id,
      stepId: `step-${mission.id}`,
      executionResultIds: ["exec-2"],
      observationIds: ["obs-deploy-verified-1"],
      outcome: "criteria_satisfied",
      rationale: "Criteria verified",
      correlation: {
        requestId: correlation.requestId,
        correlationId: correlation.correlationId,
        causationId: correlation.invocationId,
        invocationId: correlation.invocationId,
        missionId: mission.id,
        stepId: `step-${mission.id}`,
      },
    });

    const closureResult = await closureManager.closeMission({
      missionId: mission.id,
      terminalVerificationRecord: terminalVerification,
    });

    expect(closureResult.reconciledBeliefs).toHaveLength(1);
    expect(closureResult.reconciledBeliefs[0].newState).toBe("VERIFIED");

    const updatedBelief = await stateStore.getBelief("belief-deployment-status");
    expect(updatedBelief?.verificationState).toBe("VERIFIED");
    expect(updatedBelief?.supportingEvidenceIds).toContain("obs-deploy-verified-1");
  });

  it("enforces non-contradiction invariant: belief with existing contradiction is NEVER promoted to VERIFIED", async () => {
    const { mission } = await setupMission("mission-close-3");

    // Belief with prior contradicting evidence
    const conflictedBelief = createBelief({
      id: "belief-conflicted",
      proposition: "Service healthy: evidence.deployment.verified",
      confidence: 0.3,
      verificationState: "CONTRADICTED",
      supportingEvidenceIds: [],
      contradictingEvidenceIds: ["obs-prior-failure"],
    });
    await stateStore.saveBelief(conflictedBelief);

    const terminalVerification = createVerificationRecord({
      missionId: mission.id,
      stepId: `step-${mission.id}`,
      executionResultIds: ["exec-3"],
      observationIds: ["obs-new-success"],
      outcome: "criteria_satisfied",
      rationale: "Latest probe succeeded",
      correlation: {
        requestId: correlation.requestId,
        correlationId: correlation.correlationId,
        causationId: correlation.invocationId,
        invocationId: correlation.invocationId,
        missionId: mission.id,
        stepId: `step-${mission.id}`,
      },
    });

    const closureResult = await closureManager.closeMission({
      missionId: mission.id,
      terminalVerificationRecord: terminalVerification,
    });

    // Invariant: belief was NOT promoted to VERIFIED because contradiction is present
    const updatedBelief = await stateStore.getBelief("belief-conflicted");
    expect(updatedBelief?.verificationState).toBe("CONTRADICTED");
    expect(closureResult.reconciledBeliefs).toHaveLength(0);
  });

  it("publishes mission.completed event to EventBus for decoupled GENESIS intake", async () => {
    const { mission } = await setupMission("mission-close-4");

    const eventsReceived: AkiraEvent[] = [];
    const subscriber: EventSubscriber = {
      id: "genesis-reality-adapter-mock",
      onEvent: (event: AkiraEvent) => {
        eventsReceived.push(event);
      },
    };
    eventBus.subscribe(subscriber);

    const terminalVerification = createVerificationRecord({
      missionId: mission.id,
      stepId: `step-${mission.id}`,
      executionResultIds: ["exec-4"],
      observationIds: ["obs-4"],
      outcome: "criteria_satisfied",
      rationale: "All good",
      correlation: {
        requestId: correlation.requestId,
        correlationId: correlation.correlationId,
        causationId: correlation.invocationId,
        invocationId: correlation.invocationId,
        missionId: mission.id,
        stepId: `step-${mission.id}`,
      },
    });

    const closureResult = await closureManager.closeMission({
      missionId: mission.id,
      terminalVerificationRecord: terminalVerification,
    });

    expect(closureResult.eventPublished).toBe(true);
    expect(eventsReceived).toHaveLength(1);
    expect(eventsReceived[0].type).toBe("mission.completed");
    expect(eventsReceived[0].source).toBe("VAJRA · mission_closure");
    expect(eventsReceived[0].entityId).toBe(mission.id);
  });

  it("transitions mission to PAUSED_RECOVERY on inconclusive outcome", async () => {
    const { mission } = await setupMission("mission-close-5");

    const inconclusiveVerification = createVerificationRecord({
      missionId: mission.id,
      stepId: `step-${mission.id}`,
      executionResultIds: ["exec-5"],
      observationIds: [],
      outcome: "inconclusive",
      rationale: "Indeterminate outcome",
      correlation: {
        requestId: correlation.requestId,
        correlationId: correlation.correlationId,
        causationId: correlation.invocationId,
        invocationId: correlation.invocationId,
        missionId: mission.id,
        stepId: `step-${mission.id}`,
      },
    });

    const result = await closureManager.closeMission({
      missionId: mission.id,
      terminalVerificationRecord: inconclusiveVerification,
    });

    expect(result.status).toBe("not_completed");
    const updatedMission = await stateStore.getMission(mission.id);
    expect(updatedMission?.lifecycleState).toBe("PAUSED_RECOVERY");
  });
});
