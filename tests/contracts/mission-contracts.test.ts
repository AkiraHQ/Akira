/**
 * Phase 3E Contract Tests: Mission Definition, Mission Step, and Mission State
 *
 * Verifications required by adversarial review:
 *  1. Contract construction (MissionDefinition, MissionStep, MissionState)
 *  2. Immutability where applicable (Object.isFrozen, nested arrays)
 *  3. K19 correlation propagation (correlation carries missionId, goalId?, requestId, correlationId)
 *  4. No executable methods in declarative contracts (plain data, zero functions)
 *  5. No DAG dependency fields (no dependsOn, predecessors, successors)
 *  6. No execution-state fields in step or state (no status, retryCount, currentStepIndex, progress)
 *  7. Mission can exist without Goal (goalId is optional per TA §6 DECISION)
 *  8. Mission does not require Project (projectId is absent, preserving O3)
 *  9. MissionStep remains distinct from workspace Task (structural differentiation, TA §6)
 * 10. MissionState is strictly a passive evidence envelope (references IDs, no state transitions)
 */

import { describe, it, expect } from "vitest";
import {
  MissionDefinition,
  MissionStep,
  MissionConstraint,
  CompletionCriteria,
  createMissionDefinition,
  createMissionStep,
} from "../../src/contracts/mission/mission-definition";
import {
  MissionState,
  createMissionState,
} from "../../src/contracts/mission/mission-state";
import {
  createMissionResult,
  MissionResult,
} from "../../src/contracts/capabilities/verification";
import { CorrelationMetadata } from "../../src/contracts/results/result";

// ---------------------------------------------------------------------------
// Shared Test Fixtures
// ---------------------------------------------------------------------------

const baseCorrelation: CorrelationMetadata = {
  requestId: "req-mission-test-001",
  correlationId: "corr-mission-test-001",
  invocationId: "inv-mission-test-001",
};

const sampleCriteria: CompletionCriteria = {
  description: "Task created in workspace and confirmation event received",
  requiredEvidence: ["ExecutionResult:task.create", "Observation:workspace.task.present"],
  expectedOutcomeSchema: { type: "object", properties: { taskId: { type: "string" } } },
};

const sampleConstraints: MissionConstraint = {
  timeoutMs: 30000,
  deadline: "2026-10-04T12:00:00.000Z",
  maxSteps: 5,
  confirmationRequired: false,
  sideEffectLimits: ["workspace_write_only"],
};

// ---------------------------------------------------------------------------
// 1. Contract Construction
// ---------------------------------------------------------------------------

describe("Mission Contracts — Construction", () => {
  it("constructs a valid MissionStep with all required declarative fields", () => {
    const step = createMissionStep({
      missionId: "mission-test-101",
      stepOrder: 1,
      description: "Create target task in workspace",
      targetCapability: "task.create",
      input: { title: "Refactor engine", priority: "High" },
      expectedEvidence: "ExecutionResult containing new task ID",
    });

    expect(step.id).toBeDefined();
    expect(typeof step.id).toBe("string");
    expect(step.missionId).toBe("mission-test-101");
    expect(step.stepOrder).toBe(1);
    expect(step.description).toBe("Create target task in workspace");
    expect(step.targetCapability).toBe("task.create");
    expect(step.input).toEqual({ title: "Refactor engine", priority: "High" });
    expect(step.expectedEvidence).toBe("ExecutionResult containing new task ID");
  });

  it("constructs a valid MissionDefinition with steps, constraints, and criteria", () => {
    const step1 = createMissionStep({
      missionId: "mission-test-102",
      stepOrder: 1,
      description: "Query existing task",
      targetCapability: "task.read",
      input: { id: "task-001" },
      expectedEvidence: "Task details or not found",
    });

    const mission = createMissionDefinition({
      id: "mission-test-102",
      objective: "Verify and update task",
      steps: [step1],
      constraints: sampleConstraints,
      completionCriteria: sampleCriteria,
      correlation: baseCorrelation,
    });

    expect(mission.id).toBe("mission-test-102");
    expect(mission.objective).toBe("Verify and update task");
    expect(mission.steps.length).toBe(1);
    expect(mission.steps[0]).toEqual(step1);
    expect(mission.constraints).toEqual(sampleConstraints);
    expect(mission.completionCriteria.description).toBe(sampleCriteria.description);
  });

  it("constructs a valid passive MissionState referencing evidence IDs and definition", () => {
    const state = createMissionState({
      missionId: "mission-test-103",
      definitionId: "mission-def-103",
      executionResultIds: ["res-001", "res-002"],
      observationIds: ["obs-001"],
      verificationRecordIds: ["verif-001"],
    });

    expect(state.missionId).toBe("mission-test-103");
    expect(state.definitionId).toBe("mission-def-103");
    expect(state.executionResultIds).toEqual(["res-001", "res-002"]);
    expect(state.observationIds).toEqual(["obs-001"]);
    expect(state.verificationRecordIds).toEqual(["verif-001"]);
    expect(state.terminalResult).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Immutability
// ---------------------------------------------------------------------------

describe("Mission Contracts — Immutability", () => {
  it("freezes MissionStep instances", () => {
    const step = createMissionStep({
      missionId: "mission-freeze",
      stepOrder: 1,
      description: "Step freeze test",
      targetCapability: "task.read",
      input: {},
      expectedEvidence: "none",
    });

    expect(Object.isFrozen(step)).toBe(true);
    expect(() => {
      // @ts-expect-error mutating frozen property
      step.description = "Mutated";
    }).toThrow();
  });

  it("freezes MissionDefinition instances and nested step/constraint arrays", () => {
    const step = createMissionStep({
      missionId: "mission-freeze-def",
      stepOrder: 1,
      description: "Step 1",
      targetCapability: "task.read",
      input: {},
      expectedEvidence: "none",
    });

    const def = createMissionDefinition({
      id: "mission-freeze-def",
      objective: "Freeze test",
      steps: [step],
      constraints: sampleConstraints,
      completionCriteria: sampleCriteria,
      correlation: baseCorrelation,
    });

    expect(Object.isFrozen(def)).toBe(true);
    expect(Object.isFrozen(def.steps)).toBe(true);
    expect(Object.isFrozen(def.constraints)).toBe(true);
    expect(Object.isFrozen(def.completionCriteria)).toBe(true);
    expect(Object.isFrozen(def.correlation)).toBe(true);
  });

  it("freezes MissionState and its evidence ID arrays", () => {
    const state = createMissionState({
      missionId: "m-freeze-state",
      definitionId: "d-freeze-state",
      executionResultIds: ["r1"],
      observationIds: ["o1"],
      verificationRecordIds: ["v1"],
    });

    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.executionResultIds)).toBe(true);
    expect(Object.isFrozen(state.observationIds)).toBe(true);
    expect(Object.isFrozen(state.verificationRecordIds)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. K19 Correlation Propagation
// ---------------------------------------------------------------------------

describe("Mission Contracts — K19 Correlation Propagation", () => {
  it("propagates requestId, correlationId, invocationId, missionId, and optional goalId", () => {
    const defWithGoal = createMissionDefinition({
      id: "mission-k19-001",
      objective: "Pursue durable goal",
      steps: [],
      constraints: {},
      completionCriteria: sampleCriteria,
      goalId: "goal-hardware-build-42",
      correlation: baseCorrelation,
    });

    expect(defWithGoal.correlation.requestId).toBe("req-mission-test-001");
    expect(defWithGoal.correlation.correlationId).toBe("corr-mission-test-001");
    expect(defWithGoal.correlation.invocationId).toBe("inv-mission-test-001");
    expect(defWithGoal.correlation.missionId).toBe("mission-k19-001");
    expect(defWithGoal.correlation.goalId).toBe("goal-hardware-build-42");
  });
});

// ---------------------------------------------------------------------------
// 4. No Executable Methods in Declarative Contracts
// ---------------------------------------------------------------------------

describe("Mission Contracts — No Executable Methods", () => {
  it("verifies MissionDefinition contains only plain data properties", () => {
    const def = createMissionDefinition({
      objective: "Data purity test",
      steps: [],
      constraints: sampleConstraints,
      completionCriteria: sampleCriteria,
      correlation: baseCorrelation,
    });

    for (const [key, val] of Object.entries(def)) {
      expect(typeof val, `Property '${key}' must not be a function`).not.toBe("function");
    }
  });

  it("verifies CompletionCriteria contains only declarative data, no verify() methods", () => {
    for (const [key, val] of Object.entries(sampleCriteria)) {
      expect(typeof val, `Criteria property '${key}' must not be a function`).not.toBe("function");
    }
    expect("verify" in sampleCriteria).toBe(false);
    expect("evaluate" in sampleCriteria).toBe(false);
  });

  it("verifies MissionConstraint contains only parameters, no policy evaluation functions", () => {
    for (const [key, val] of Object.entries(sampleConstraints)) {
      expect(typeof val, `Constraint property '${key}' must not be a function`).not.toBe("function");
    }
    expect("evaluate" in sampleConstraints).toBe(false);
    expect("check" in sampleConstraints).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. No DAG Dependency Fields
// ---------------------------------------------------------------------------

describe("Mission Contracts — No DAG Dependency Fields", () => {
  it("ensures MissionStep does not contain dependsOn, predecessors, or successors", () => {
    const step = createMissionStep({
      missionId: "m-dag-test",
      stepOrder: 1,
      description: "DAG purity test",
      targetCapability: "task.read",
      input: {},
      expectedEvidence: "evidence",
    });

    expect("dependsOn" in step).toBe(false);
    expect("predecessorTaskId" in step).toBe(false);
    expect("successorTaskId" in step).toBe(false);
    expect("predecessors" in step).toBe(false);
    expect("successors" in step).toBe(false);
    expect("dependencyType" in step).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. No Execution-State Fields
// ---------------------------------------------------------------------------

describe("Mission Contracts — No Execution-State Fields", () => {
  it("ensures MissionStep does not contain execution status or retry counters", () => {
    const step = createMissionStep({
      missionId: "m-status-test",
      stepOrder: 1,
      description: "Status purity test",
      targetCapability: "task.create",
      input: {},
      expectedEvidence: "evidence",
    });

    expect("status" in step).toBe(false);
    expect("retryCount" in step).toBe(false);
    expect("backoffMs" in step).toBe(false);
    expect("callback" in step).toBe(false);
  });

  it("ensures MissionState does not contain lifecycle enums or currentStepIndex cursors", () => {
    const state = createMissionState({
      missionId: "m-cursor-test",
      definitionId: "d-cursor-test",
    });

    expect("status" in state).toBe(false);
    expect("currentStepIndex" in state).toBe(false);
    expect("activeStep" in state).toBe(false);
    expect("progress" in state).toBe(false);
    expect("retries" in state).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Mission Can Exist Without Goal
// ---------------------------------------------------------------------------

describe("Mission Contracts — Goal is Optional (TA §6 DECISION)", () => {
  it("constructs a valid MissionDefinition when goalId is undefined", () => {
    const standaloneMission = createMissionDefinition({
      objective: "Find the datasheet for IC LM317",
      steps: [],
      constraints: {},
      completionCriteria: sampleCriteria,
      correlation: baseCorrelation,
    });

    expect(standaloneMission.goalId).toBeUndefined();
    expect(standaloneMission.correlation.goalId).toBeUndefined();
    expect(standaloneMission.id).toBeDefined();
    expect(standaloneMission.objective).toBe("Find the datasheet for IC LM317");
  });
});

// ---------------------------------------------------------------------------
// 8. Mission Does Not Require Project (O3 Preservation)
// ---------------------------------------------------------------------------

describe("Mission Contracts — Project is Not Required (O3 Preservation)", () => {
  it("verifies MissionDefinition has no mandatory projectId property", () => {
    const mission = createMissionDefinition({
      objective: "System diagnostic sweep",
      steps: [],
      constraints: {},
      completionCriteria: sampleCriteria,
      correlation: baseCorrelation,
    });

    expect("projectId" in mission).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. MissionStep Distinct From Workspace Task (TA §6 Invariant)
// ---------------------------------------------------------------------------

describe("Mission Contracts — MissionStep Distinct From Workspace Task", () => {
  it("ensures MissionStep field structure is disjoint from workspace Task structure", () => {
    const step = createMissionStep({
      missionId: "m-diff-test",
      stepOrder: 1,
      description: "Planned capability invocation",
      targetCapability: "task.create",
      input: { title: "Workspace Item" },
      expectedEvidence: "Result with taskId",
    });

    // MissionStep specific fields
    expect(step.missionId).toBeDefined();
    expect(step.stepOrder).toBe(1);
    expect(step.targetCapability).toBe("task.create");
    expect(step.expectedEvidence).toBeDefined();

    // Workspace Task specific fields MUST NOT exist on MissionStep
    expect("done" in step).toBe(false);
    expect("completed" in step).toBe(false);
    expect("priority" in step).toBe(false);
    expect("projectId" in step).toBe(false);
    expect("timeSpentMinutes" in step).toBe(false);
    expect("dueDate" in step).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. MissionState as Passive Evidence Envelope
// ---------------------------------------------------------------------------

describe("Mission Contracts — MissionState Passive Evidence Envelope", () => {
  it("acts as a passive container linking definition, evidence IDs, and terminal result", () => {
    const terminalResult: MissionResult<{ summary: string }> = createMissionResult({
      missionId: "m-envelope-test",
      status: "completed",
      verificationRecordId: "verif-record-999",
      outcome: { summary: "Mission accomplished" },
      correlation: {
        ...baseCorrelation,
        missionId: "m-envelope-test",
        verificationRecordId: "verif-record-999",
      },
    });

    const state = createMissionState({
      missionId: "m-envelope-test",
      definitionId: "def-envelope-test",
      executionResultIds: ["k5-result-1", "k5-result-2"],
      observationIds: ["k4-obs-1"],
      verificationRecordIds: ["verif-record-999"],
      terminalResult,
    });

    expect(state.missionId).toBe("m-envelope-test");
    expect(state.definitionId).toBe("def-envelope-test");
    expect(state.executionResultIds.length).toBe(2);
    expect(state.observationIds.length).toBe(1);
    expect(state.verificationRecordIds.length).toBe(1);
    expect(state.terminalResult).toBeDefined();
    expect(state.terminalResult?.status).toBe("completed");
    expect(state.terminalResult?.outcome).toEqual({ summary: "Mission accomplished" });
  });

  it("defaults empty evidence arrays gracefully", () => {
    const emptyState = createMissionState({
      missionId: "m-empty-test",
      definitionId: "def-empty-test",
    });

    expect(emptyState.executionResultIds).toEqual([]);
    expect(emptyState.observationIds).toEqual([]);
    expect(emptyState.verificationRecordIds).toEqual([]);
    expect(emptyState.terminalResult).toBeUndefined();
  });
});
