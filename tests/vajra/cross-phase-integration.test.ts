import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { z } from "zod";

import { ExecutiveController } from "../../src/vajra/executive/controller";
import { SelfModel } from "../../src/vajra/self-model/self-model";
import { InMemoryGenesisAdapter } from "../../src/vajra/boundaries/genesis-port";
import { InMemoryEscalationAdapter } from "../../src/vajra/boundaries/escalation-port";
import { IAkiraOSPort } from "../../src/vajra/boundaries/akira-os-port";
import { SqliteOperationalStateStore } from "../../src/persistence/vajra/sqlite-operational-state-store";
import { CapabilityRegistry } from "../../src/contracts/capabilities/registry";
import { CapabilityDescriptor } from "../../src/contracts/capabilities/descriptor";
import { CoordinationDispatcher } from "../../src/vajra/mission/coordinator";
import { MissionAdmissionGateway } from "../../src/vajra/mission/admission";
import { PlanningEngine } from "../../src/vajra/mission/planner";
import { MissionRuntime } from "../../src/vajra/mission/runtime";
import { ObservationReceiver } from "../../src/vajra/observation/receiver";
import { VerificationEvaluator } from "../../src/vajra/verification/evaluator";
import { MissionClosureManager } from "../../src/vajra/closure/closure-manager";
import { DecisionArbiter } from "../../src/vajra/decision/arbiter";
import { ApprovalManager } from "../../src/vajra/decision/approval-manager";
import { DecisionEvaluator } from "../../src/vajra/decision/evaluator";
import { DecisionOptionFormulator } from "../../src/vajra/decision/option-formulator";
import { DisagreementHandler } from "../../src/vajra/decision/disagreement";
import { IReasoningEngine } from "../../src/vajra/ports/reasoning";
import { ReasoningContext, ReasoningResult } from "../../src/vajra/reasoning/types";
import { createStimulus } from "../../src/vajra/types/stimulus";
import { createBelief } from "../../src/vajra/types/belief";
import { Result, CorrelationMetadata } from "../../src/contracts/results/result";
import { EventBus } from "../../src/instrumentation/event-bus";
import { GenesisRealityAdapter } from "../../src/genesis/events/reality-adapter";
import { eventService } from "../../src/genesis/events/event-service";
import { MemoryEvent } from "../../src/shared/types/event-types";

describe("VAJRA Cross-Phase Integration Proof (Phases 5 → 6 → 7 → GENESIS)", () => {
  let db: Database.Database;
  let stateStore: SqliteOperationalStateStore;
  let selfModel: SelfModel;
  let registry: CapabilityRegistry;
  let akiraOSPort: IAkiraOSPort;
  let genesisPort: InMemoryGenesisAdapter;
  let escalationPort: InMemoryEscalationAdapter;
  let eventBus: EventBus;
  let realityAdapter: GenesisRealityAdapter;
  let recordedMemories: MemoryEvent[];
  let stopMemoryCapture: () => void;

  let capabilityInvocationCount = 0;
  let capturedInvocationCorrelation: CorrelationMetadata | null = null;
  let capturedInvocationInput: unknown = null;

  beforeEach(async () => {
    capabilityInvocationCount = 0;
    capturedInvocationCorrelation = null;
    capturedInvocationInput = null;

    // 1. Setup in-memory SQLite database with canonical schemas
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

    // 2. Setup CapabilityRegistry and Grounded Capability
    registry = new CapabilityRegistry();
    const taskDescriptor: CapabilityDescriptor = {
      name: "task.create",
      kind: "Command",
      version: "1.0.0",
      owner: "AKIRA OS · tasks",
      description: "Create an operational task",
      executionCharacteristics: {
        isSynchronous: true,
        isReadOnly: false,
        isIdempotent: true,
      },
      activationTier: 0,
      costClass: "local_cheap",
      isAvailable: true,
      permissions: {
        allowVajra: true,
        allowInternal: true,
      },
      inputSchema: z.object({ title: z.string().optional() }).passthrough(),
    };

    registry.register(taskDescriptor, (input, correlation) => {
      capabilityInvocationCount++;
      capturedInvocationInput = input;
      capturedInvocationCorrelation = correlation;
      return {
        id: "task-real-101",
        title: (input as any)?.title ?? "Operational task",
        ok: true,
        token: "evidence.task.create.ok",
        confidence: 0.9,
      };
    });

    akiraOSPort = {
      executeCapability: async <TIn, TOut>(name: string, input: TIn, correlation: CorrelationMetadata) => {
        const res = await registry.invoke(name, input, correlation, { isVajra: true });
        if (!res.ok) {
          return Result.failure(res.error, correlation);
        }
        return Result.success(res.value as TOut, correlation);
      },
      listAvailableCapabilities: () => registry.list(),
      isCapabilityAvailable: (name) => registry.has(name),
    };

    // 3. Setup SelfModel
    selfModel = new SelfModel();
    selfModel.registerCapability({
      name: "task.create",
      kind: "Command",
      version: "1.0.0",
      owner: "AKIRA OS · tasks",
      description: "Create an operational task",
      costClass: "local_cheap",
      activationTier: 0,
      isAvailable: true,
      allowVajra: true,
    });
    selfModel.updateOperationalContext({
      currentFocus: "Accomplish user objective",
      mode: "REQUEST_DRIVEN",
      systemHealthStatus: "NOMINAL",
      version: 1,
    });
    await stateStore.saveOperationalContext(selfModel.getOperationalContext());

    genesisPort = new InMemoryGenesisAdapter();
    escalationPort = new InMemoryEscalationAdapter();

    // 4. Setup EventBus and GENESIS RealityAdapter
    eventBus = new EventBus();
    realityAdapter = new GenesisRealityAdapter();
    realityAdapter.attach(eventBus);

    recordedMemories = [];
    stopMemoryCapture = eventService.onRecord((mem) => {
      recordedMemories.push(mem);
    });
  });

  afterEach(() => {
    stopMemoryCapture();
    realityAdapter.detach();
    db.close();
  });

  it("executes complete cognitive-execution loop end-to-end with full provenance", async () => {
    // Seed initial epistemic belief to verify reconciliation
    const initialBelief = createBelief({
      id: "belief-task-ready",
      proposition: "evidence.task.create.ok",
      confidence: 0.5,
      verificationState: "UNVERIFIED",
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
    });
    await stateStore.saveBelief(initialBelief);

    // Wire Phase 4: Mock ReasoningEngine that emits POLICY_CONFORMANCE deliberation
    const mockReasoningEngine: IReasoningEngine = {
      deliberate: async (context: ReasoningContext, correlation: CorrelationMetadata) => {
        const result: ReasoningResult = {
          id: `res-reason-${correlation.requestId}`,
          stimulusId: context.stimulus.id,
          correlation,
          contextVersion: context.operationalContext.version,
          problemClass: "POLICY_CONFORMANCE",
          strategyUsed: "DeterministicPolicyStrategy",
          strategyTier: 1,
          status: "SUCCESS",
          hypotheses: [
            {
              id: "hyp-01",
              description: "Action conforms to active policy envelope",
              confidence: 0.95,
              supportingEvidenceIds: [],
            },
          ],
          proposedBeliefUpdates: [],
          contradictions: [],
          possibleConsequences: ["Action is safe to proceed"],
          uncertaintyLevel: "LOW",
          unresolvedQuestions: [],
          verificationSuggestions: [],
          deliberationTrace: {
            traceId: `trace-${correlation.requestId}`,
            stimulusId: context.stimulus.id,
            correlation,
            intentClass: "POLICY_CONFORMANCE",
            selectedOption: "concluded:success",
            consideredOptions: [],
            rationale: "Deterministic policy check confirmed nominal",
            evidenceReliedUpon: [],
            escalationRequired: false,
            timestamp: new Date().toISOString(),
          },
        };
        return Result.success(result, correlation);
      },
    };

    // Wire Phase 5: Decision Arbiter
    const approvalManager = new ApprovalManager(stateStore);
    const decisionArbiter = new DecisionArbiter(
      stateStore,
      new DecisionEvaluator(),
      new DecisionOptionFormulator(),
      new DisagreementHandler(),
      approvalManager,
    );

    // Wire Phase 6: Admission, Planning, Coordinator, Runtime
    const admissionGateway = new MissionAdmissionGateway(stateStore, registry, approvalManager);
    const planningEngine = new PlanningEngine(registry, undefined, stateStore);
    const coordinator = new CoordinationDispatcher(akiraOSPort);

    // Wire Phase 7: Observation Receiver, Verification Evaluator, Closure Manager
    const observationReceiver = new ObservationReceiver();
    const verificationEvaluator = new VerificationEvaluator(stateStore);
    const closureManager = new MissionClosureManager(stateStore, {
      publish: (event) => eventBus.publish(event),
    });

    const missionRuntime = new MissionRuntime(
      stateStore,
      coordinator,
      observationReceiver,
      verificationEvaluator,
      closureManager,
    );

    // Wire Executive Controller with complete cognitive pipeline
    const controller = new ExecutiveController({
      selfModel,
      genesisPort,
      akiraOSPort,
      escalationPort,
      stateStore,
      reasoningEngine: mockReasoningEngine,
      decisionArbiter,
      admissionGateway,
      planningEngine,
      missionRuntime,
      closureManager,
    });

    // Boot Controller
    const bootResult = await controller.boot();
    expect(bootResult.ok).toBe(true);

    // Construct Incoming Cognitive Stimulus
    const stimulusCorrelation: CorrelationMetadata = {
      requestId: "req-e2e-100",
      correlationId: "corr-e2e-100",
      invocationId: "inv-stim-100",
      causationId: "user-intent-100",
    };

    const stimulus = createStimulus({
      id: "stim-user-goal",
      kind: "human_prompt",
      source: "chat",
      payload: { text: "Create task for project Akira" },
      correlation: stimulusCorrelation,
    });

    // ========================================================================
    // EXECUTE BOUNDED TURN
    // ========================================================================
    const turnResult = await controller.receiveStimulus(stimulus);

    // 1. Verify Decision (Phase 5)
    expect(turnResult.ok).toBe(true);
    const action = (turnResult as any).value;
    expect(action).toBeDefined();
    expect(action.kind).toBe("start_mission");
    expect(action.decisionId).toBeDefined();
    expect(action.id).toBeDefined();
    expect(action.requiredCapability).toBe("task.create");
    expect(action.correlation.requestId).toBe("req-e2e-100");
    expect(action.correlation.correlationId).toBe("corr-e2e-100");

    // 2. Verify Capability Execution (AKIRA OS boundary)
    expect(capabilityInvocationCount).toBe(1);
    expect(capturedInvocationCorrelation).toBeDefined();
    expect(capturedInvocationCorrelation?.correlationId).toBe("corr-e2e-100");

    // 3. Verify Mission Record & Lifecycle (Phase 6)
    const missionId = action.correlation.requestId; // Planner uses requestId as missionId
    const mission = await stateStore.getMission(missionId);
    expect(mission).toBeDefined();
    expect(mission?.lifecycleState).toBe("COMPLETED");
    expect(mission?.completedAt).toBeDefined();

    // Verify Active Mission was cleared from singleton operational state
    const opContext = await stateStore.loadOperationalContext();
    expect(opContext?.activeMissionId).toBeNull();

    // Verify Steps in SQLite
    const steps = await stateStore.getStepsForMission(missionId);
    expect(steps.length).toBe(1);
    const step = steps[0];
    expect(step.dispatchState).toBe("VERIFIED");
    expect(step.targetCapability).toBe("task.create");
    // Invariant K-P7-16: Execution identity matches canonical K19 step.id / invocationId (no synthetic prefix, no Date.now())
    expect(step.executionResultId).toBe(step.id);

    // 4. Verify Observation (Phase 7)
    const stepObservations = observationReceiver.getObservationsForStep(step.id);
    expect(stepObservations.length).toBe(1);
    const obs = stepObservations[0];
    expect(obs.subject).toBe(step.id);
    expect(obs.producer).toBe("capability.task.create");
    expect(obs.correlation.executionId).toBe(step.id);
    expect(obs.confidence).toBe(0.9); // Grounded from producer payload

    // 5. Verify Verification Record (Phase 7)
    const verifications = await stateStore.getVerificationsForMission(missionId);
    expect(verifications.length).toBe(1);
    const vr = verifications[0];
    expect(vr.outcome).toBe("criteria_satisfied");
    expect(vr.stepId).toBe(step.id);
    expect(vr.evidenceIds).toContain(obs.id);

    // 6. Verify Terminal MissionResult (Contract K6)
    const lastResult = missionRuntime.getLastMissionResult();
    expect(lastResult).toBeDefined();
    expect(lastResult?.status).toBe("completed");
    expect(lastResult?.missionId).toBe(missionId);
    expect(lastResult?.verificationRecordId).toBe(vr.id);

    // 7. Verify Belief Reconciliation in SQLite
    const updatedBelief = await stateStore.getBelief("belief-task-ready");
    expect(updatedBelief).toBeDefined();
    expect(updatedBelief?.verificationState).toBe("VERIFIED");
    expect(updatedBelief?.supportingEvidenceIds).toContain(obs.id);

    // 8. Verify EventBus Emission & GENESIS Reality Adapter Translation
    expect(recordedMemories.length).toBe(1);
    const memory = recordedMemories[0];
    expect(memory.eventType).toBe("mission_completed");
    expect(memory.title).toBe("Mission Completed: Execute operational mission: Accomplish user objective");
    expect(memory.description).toContain('Completed operational mission: "Execute operational mission: Accomplish user objective"');
    expect(memory.description).toContain("Status: completed.");
    expect(memory.description).not.toContain("undefined");
    expect(memory.description).not.toContain("Daily Tasks");

    // 9. Verify Complete K19 Lineage Chain:
    // decisionId -> actionId -> missionId -> stepId -> invocationId -> executionResultId -> obs.id -> vr.id -> missionResult -> event
    expect(action.decisionId).toBeDefined();
    expect(action.id).toBeDefined();
    expect(mission?.id).toBe(action.correlation.requestId);
    expect(step.missionId).toBe(mission?.id);
    expect(step.executionResultId).toBe(step.id);
    expect(obs.correlation.executionId).toBe(step.id);
    expect(vr.evidenceIds).toContain(obs.id);
    expect(lastResult?.verificationRecordId).toBe(vr.id);
    expect(memory.metadata.platformEvent).toBeDefined();
    expect((memory.metadata.platformEvent as any).correlationId).toBe(stimulusCorrelation.correlationId);
  });
});
