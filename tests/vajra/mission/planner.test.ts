import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { PlanningEngine } from "../../../src/vajra/mission/planner";
import { CapabilityRegistry } from "../../../src/contracts/capabilities/registry";
import { CapabilityDescriptor } from "../../../src/contracts/capabilities/descriptor";
import { IModelCoprocessorPort, ModelCoprocessorRequest, ModelCoprocessorResponse } from "../../../src/vajra/boundaries/model-coprocessor-port";
import { SqliteOperationalStateStore } from "../../../src/persistence/vajra/sqlite-operational-state-store";
import { CorrelationMetadata, Result } from "../../../src/contracts/results/result";
import { createVajraMissionRecord, createVajraStepRecord } from "../../../src/vajra/types/mission-record";
import { createMissionDefinition, createMissionStep } from "../../../src/contracts/mission/mission-definition";
import { createMissionState } from "../../../src/contracts/mission/mission-state";
import { PlanProposal } from "../../../src/vajra/mission/types";

describe("PlanningEngine (Phase 6 Planning & Replan Safety)", () => {
  let db: Database.Database;
  let stateStore: SqliteOperationalStateStore;
  let capabilityRegistry: CapabilityRegistry;

  const correlation: CorrelationMetadata = {
    requestId: "req-plan-01",
    correlationId: "corr-plan-01",
    invocationId: "inv-plan-01",
  };

  const createTestCapability = (
    name: string,
    schema: z.ZodTypeAny = z.object({ message: z.string() }),
    allowVajra: boolean = true,
    isAvailable: boolean = true,
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
      isReadOnly: false,
      isIdempotent: true,
    },
    isAvailable,
    permissions: {
      allowVajra,
    },
    inputSchema: schema,
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

    stateStore = new SqliteOperationalStateStore(db);
    capabilityRegistry = new CapabilityRegistry();
    capabilityRegistry.register(createTestCapability("system.echo"));
    capabilityRegistry.register(createTestCapability("workspace.format"));
  });

  afterEach(() => {
    db.close();
  });

  describe("Pathway A: Deterministic Rule-Based Planner", () => {
    it("successfully compiles a valid template step into a declarative MissionDefinition", async () => {
      const planner = new PlanningEngine(capabilityRegistry, undefined, stateStore);
      const planResult = await planner.createPlan(
        "Echo a greeting",
        { maxSteps: 3, timeoutMs: 10_000 },
        correlation,
        {
          targetCapability: "system.echo",
          input: { message: "Hello AKIRA" },
          expectedEvidence: "evidence.echo.ok",
        },
      );

      expect(planResult.ok).toBe(true);
      if (planResult.ok) {
        expect(planResult.value.objective).toBe("Echo a greeting");
        expect(planResult.value.steps.length).toBe(1);
        expect(planResult.value.steps[0].targetCapability).toBe("system.echo");
        expect(planResult.value.steps[0].input).toEqual({ message: "Hello AKIRA" });
        expect(planResult.value.steps[0].expectedEvidence).toBe("evidence.echo.ok");
        expect(planResult.value.constraints.maxSteps).toBe(1);
      }
    });

    it("rejects unregistered capability with PLANNING_FAILED", async () => {
      const planner = new PlanningEngine(capabilityRegistry, undefined, stateStore);
      const planResult = await planner.createPlan(
        "Perform unknown capability",
        {},
        correlation,
        {
          targetCapability: "nonexistent.capability",
          input: {},
        },
      );

      expect(planResult.ok).toBe(false);
      if (!planResult.ok) {
        expect(planResult.error).toContain("PLANNING_FAILED");
        expect(planResult.error).toContain("not registered");
      }
    });

    it("rejects capability schema violation with PLANNING_FAILED", async () => {
      const planner = new PlanningEngine(capabilityRegistry, undefined, stateStore);
      const planResult = await planner.createPlan(
        "Invalid payload",
        {},
        correlation,
        {
          targetCapability: "system.echo",
          input: { message: 12345 }, // schema expects string
        },
      );

      expect(planResult.ok).toBe(false);
      if (!planResult.ok) {
        expect(planResult.error).toContain("PLANNING_FAILED");
        expect(planResult.error).toContain("Input schema validation failed");
      }
    });
  });

  describe("Pathway B: Model-Assisted Planner & Safe-Hold Elimination", () => {
    it("successfully parses and validates untrusted multi-step model proposals", async () => {
      const mockCoprocessor: IModelCoprocessorPort = {
        invokeStructuredCoprocessor: async <T>(_req: ModelCoprocessorRequest<T>) => {
          const proposal: PlanProposal = {
            objective: "Format and echo project files",
            steps: [
              {
                description: "Format workspace files",
                targetCapability: "workspace.format",
                input: { message: "format" },
                expectedEvidence: "evidence.format.done",
              },
              {
                description: "Echo completion status",
                targetCapability: "system.echo",
                input: { message: "all done" },
                expectedEvidence: "evidence.echo.done",
              },
            ],
          };
          return Result.success({ parsed: proposal as unknown as T, rawOutput: "{}" }, correlation);
        },
      };

      const planner = new PlanningEngine(capabilityRegistry, mockCoprocessor, stateStore);
      const planResult = await planner.createPlan(
        "Format and echo project files",
        { maxSteps: 5 },
        correlation,
      );

      expect(planResult.ok).toBe(true);
      if (planResult.ok) {
        expect(planResult.value.steps.length).toBe(2);
        expect(planResult.value.steps[0].targetCapability).toBe("workspace.format");
        expect(planResult.value.steps[1].targetCapability).toBe("system.echo");
      }
    });

    it("strictly returns PLANNING_FAILED when proposed step count exceeds maxSteps ceiling", async () => {
      const mockCoprocessor: IModelCoprocessorPort = {
        invokeStructuredCoprocessor: async <T>() => {
          const proposal: PlanProposal = {
            objective: "Too many steps",
            steps: [
              { description: "s1", targetCapability: "system.echo", input: { message: "1" }, expectedEvidence: "e1" },
              { description: "s2", targetCapability: "system.echo", input: { message: "2" }, expectedEvidence: "e2" },
              { description: "s3", targetCapability: "system.echo", input: { message: "3" }, expectedEvidence: "e3" },
            ],
          };
          return Result.success({ parsed: proposal as unknown as T, rawOutput: "{}" }, correlation);
        },
      };

      const planner = new PlanningEngine(capabilityRegistry, mockCoprocessor, stateStore);
      const planResult = await planner.createPlan(
        "Too many steps",
        { maxSteps: 2 }, // Ceiling is 2, proposal has 3
        correlation,
      );

      expect(planResult.ok).toBe(false);
      if (!planResult.ok) {
        expect(planResult.error).toContain("PLANNING_FAILED");
        expect(planResult.error).toContain("violates constraint bounds");
      }
    });

    it("Revision 1.1 Gate: Model failure strictly returns PLANNING_FAILED (zero synthetic safe-hold fallback)", async () => {
      const failingCoprocessor: IModelCoprocessorPort = {
        invokeStructuredCoprocessor: async () => {
          return Result.failure("Upstream model timeout after 15000ms", correlation);
        },
      };

      const planner = new PlanningEngine(capabilityRegistry, failingCoprocessor, stateStore);
      const planResult = await planner.createPlan(
        "Autonomous complex plan",
        { maxSteps: 5 },
        correlation,
      );

      // Must be a definitive failure: no synthetic mission, no safe hold, no invented no-op plan
      expect(planResult.ok).toBe(false);
      if (!planResult.ok) {
        expect(planResult.error).toContain("PLANNING_FAILED");
        expect(planResult.error).toContain("Model coprocessor failed");
      }
    });
  });

  describe("Replan Safety & Invariant Preservation", () => {
    it("preserves immutable anchors and replaces failed step during replan", async () => {
      const step1 = createMissionStep({
        id: "step-1",
        missionId: "m-replan-01",
        stepOrder: 1,
        description: "Initial format step",
        targetCapability: "workspace.format",
        input: { message: "format" },
        expectedEvidence: "evidence.format.done",
      });

      const def = createMissionDefinition({
        id: "m-replan-01",
        objective: "Immutable Mission Objective",
        steps: [step1],
        constraints: { maxSteps: 3, timeoutMs: 30_000 },
        completionCriteria: { description: "Format files", requiredEvidence: ["evidence.format.done"] },
        goalId: "goal-orig-123",
        correlation,
      });

      const rec = createVajraMissionRecord({
        id: def.id,
        objective: def.objective,
        lifecycleState: "RUNNING",
        definition: def,
        state: createMissionState({ missionId: def.id, definitionId: def.id }),
        currentStepOrder: 1,
        allocatedBudget: { maxCostCents: 10, maxSteps: 3 },
        idempotencyKey: "idemp-replan-01",
        requestId: correlation.requestId,
        correlationId: correlation.correlationId,
        invocationId: correlation.invocationId,
      });
      await stateStore.createMission(rec, []);

      const planner = new PlanningEngine(capabilityRegistry, undefined, stateStore);
      const replanResult = await planner.replan(
        "m-replan-01",
        1,
        ["evidence.format.failed"],
        correlation,
        {
          targetCapability: "system.echo",
          input: { message: "fallback alternative" },
          expectedEvidence: "evidence.echo.ok",
        },
      );

      expect(replanResult.ok).toBe(true);
      if (replanResult.ok) {
        const replannedDef = replanResult.value;
        // Invariant: Objective remains identical
        expect(replannedDef.objective).toBe(def.objective);
        // Invariant: GoalId remains identical
        expect(replannedDef.goalId).toBe("goal-orig-123");
        // Invariant: Constraints remain identical
        expect(replannedDef.constraints.maxSteps).toBe(3);
        // Replacement: Step replaced with alternative capability
        expect(replannedDef.steps[0].targetCapability).toBe("system.echo");
        expect(replannedDef.steps[0].expectedEvidence).toBe("evidence.echo.ok");
      }
    });

    it("strictly rejects second replan (enforcing max 1 replan ceiling)", async () => {
      const step1 = createMissionStep({
        id: "step-1",
        missionId: "m-replan-02",
        stepOrder: 1,
        description: "Initial step",
        targetCapability: "system.echo",
        input: { message: "test" },
        expectedEvidence: "evidence.echo.ok",
      });

      const def = createMissionDefinition({
        id: "m-replan-02",
        objective: "Strict replan limit",
        steps: [step1],
        completionCriteria: { description: "done", requiredEvidence: ["evidence.echo.ok"] },
        correlation,
      });

      const rec = createVajraMissionRecord({
        id: def.id,
        objective: def.objective,
        lifecycleState: "RUNNING",
        definition: def,
        state: createMissionState({ missionId: def.id, definitionId: def.id }),
        currentStepOrder: 1,
        allocatedBudget: { maxCostCents: 10, maxSteps: 3 },
        idempotencyKey: "idemp-replan-02",
        requestId: correlation.requestId,
        correlationId: correlation.correlationId,
        invocationId: correlation.invocationId,
      });
      await stateStore.createMission(rec, []);

      const planner = new PlanningEngine(capabilityRegistry, undefined, stateStore);
      // First replan succeeds
      const firstReplan = await planner.replan(
        "m-replan-02",
        1,
        [],
        correlation,
        { targetCapability: "system.echo", input: { message: "replan 1" } },
      );
      expect(firstReplan.ok).toBe(true);

      // Attempt second replan on same mission -> Must be rejected by replan budget guard
      const secondReplan = await planner.replan(
        "m-replan-02",
        1,
        [],
        correlation,
        { targetCapability: "system.echo", input: { message: "replan 2" } },
      );
      expect(secondReplan.ok).toBe(false);
      if (!secondReplan.ok) {
        expect(secondReplan.error).toContain("REPLAN_REJECTED");
        expect(secondReplan.error).toContain("Maximum 1 replan");
      }
    });
  });
});
