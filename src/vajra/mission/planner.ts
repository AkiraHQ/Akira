import { IPlanningEngine } from "../ports/planning";
import { Result, CorrelationMetadata } from "../../contracts/results/result";
import {
  MissionDefinition,
  MissionConstraint,
  createMissionDefinition,
  createMissionStep,
  MissionStep,
} from "../../contracts/mission/mission-definition";
import { CapabilityRegistry } from "../../contracts/capabilities/registry";
import { IModelCoprocessorPort } from "../boundaries/model-coprocessor-port";
import { IOperationalStateStore } from "../ports/state-store";
import { PlanProposalSchema, PlanProposal } from "./types";

/**
 * Planning Engine implementing IPlanningEngine per Contract K10.
 * Compiles admitted operational intent into strictly ordered, linear MissionStep sequences.
 * Enforces strict blast doors against untrusted model proposals and runaway replanning.
 */
export class PlanningEngine implements IPlanningEngine {
  constructor(
    private readonly capabilityRegistry: CapabilityRegistry,
    private readonly coprocessor?: IModelCoprocessorPort,
    private readonly stateStore?: IOperationalStateStore,
  ) {}

  async createPlan(
    objective: string,
    constraints: MissionConstraint,
    correlation: CorrelationMetadata,
    templateStep?: { targetCapability: string; input: unknown; expectedEvidence?: string },
  ): Promise<Result<MissionDefinition, string>> {
    const missionId = correlation.requestId || `mission-${Date.now()}`;
    const maxSteps = constraints.maxSteps ?? 5;

    // Pathway A: Deterministic Rule-Based Planner (Primary for templated / single-capability actions)
    if (templateStep) {
      if (!this.capabilityRegistry.has(templateStep.targetCapability)) {
        return Result.failure(
          `PLANNING_FAILED: Required capability '${templateStep.targetCapability}' is not registered.`,
          correlation,
        );
      }
      const entry = this.capabilityRegistry.get(templateStep.targetCapability);
      if (!entry || !entry.descriptor.isAvailable) {
        return Result.failure(
          `PLANNING_FAILED: Capability '${templateStep.targetCapability}' is unavailable.`,
          correlation,
        );
      }
      if (entry.descriptor.permissions.allowVajra === false) {
        return Result.failure(
          `PLANNING_FAILED: Capability '${templateStep.targetCapability}' disallows VAJRA invocation.`,
          correlation,
        );
      }
      const parsedInput = entry.descriptor.inputSchema.safeParse(templateStep.input);
      if (!parsedInput.success) {
        return Result.failure(
          `PLANNING_FAILED: Input schema validation failed for '${templateStep.targetCapability}'.`,
          correlation,
        );
      }

      const step: MissionStep = createMissionStep({
        missionId,
        stepOrder: 1,
        description: `Execute ${templateStep.targetCapability}`,
        targetCapability: templateStep.targetCapability,
        input: parsedInput.data,
        expectedEvidence: templateStep.expectedEvidence ?? `evidence.${templateStep.targetCapability}.ok`,
      });

      const definition = createMissionDefinition({
        id: missionId,
        objective,
        steps: [step],
        constraints: {
          maxSteps: 1,
          timeoutMs: constraints.timeoutMs ?? 30_000,
          confirmationRequired: constraints.confirmationRequired ?? false,
          sideEffectLimits: constraints.sideEffectLimits,
        },
        completionCriteria: {
          description: `Execution of ${templateStep.targetCapability} completed successfully with verified evidence.`,
          requiredEvidence: [step.expectedEvidence],
        },
        correlation,
      });

      return Result.success(definition, correlation);
    }

    // Pathway B: Model-Assisted Planner via IModelCoprocessorPort
    if (this.coprocessor) {
      const coprocessorResult = await this.coprocessor.invokeStructuredCoprocessor<PlanProposal>({
        systemPrompt: [
          "You are the VAJRA Mission Planning Engine.",
          "Decompose the user objective into an ordered, linear array of discrete capability execution steps.",
          "INVARIANTS: No DAG dependencies, no circular loops, maximum steps strictly enforced.",
        ].join(" "),
        structuredContext: {
          objective,
          constraints,
          availableCapabilities: this.capabilityRegistry.list().map((c) => ({
            name: c.name,
            kind: c.kind,
            isReadOnly: c.executionCharacteristics.isReadOnly,
          })),
        },
        outputSchema: PlanProposalSchema,
        temperature: 0.1,
        maxTokens: 1024,
        timeoutMs: 15_000,
        correlation,
      });

      if (!coprocessorResult.ok) {
        // BLAST DOOR: Failure strictly returns PLANNING_FAILED (zero synthetic safe-hold fallback)
        return Result.failure(
          `PLANNING_FAILED: Model coprocessor failed to formulate plan: ${coprocessorResult.error}`,
          correlation,
        );
      }

      const proposal = coprocessorResult.value.parsed;

      // BLAST DOOR: Enforce Step Count Ceiling
      if (proposal.steps.length < 1 || proposal.steps.length > maxSteps) {
        return Result.failure(
          `PLANNING_FAILED: Proposed step count (${proposal.steps.length}) violates constraint bounds [1, ${maxSteps}].`,
          correlation,
        );
      }

      // BLAST DOOR: Validate Every Step against Capability Registry
      const validatedSteps: MissionStep[] = [];
      for (let i = 0; i < proposal.steps.length; i++) {
        const stepProposal = proposal.steps[i];
        const stepOrder = i + 1;

        if (!this.capabilityRegistry.has(stepProposal.targetCapability)) {
          return Result.failure(
            `PLANNING_FAILED: Proposed capability '${stepProposal.targetCapability}' at step ${stepOrder} is not registered.`,
            correlation,
          );
        }

        const entry = this.capabilityRegistry.get(stepProposal.targetCapability);
        if (!entry || !entry.descriptor.isAvailable) {
          return Result.failure(
            `PLANNING_FAILED: Capability '${stepProposal.targetCapability}' at step ${stepOrder} is unavailable.`,
            correlation,
          );
        }

        if (entry.descriptor.permissions.allowVajra === false) {
          return Result.failure(
            `PLANNING_FAILED: Capability '${stepProposal.targetCapability}' at step ${stepOrder} disallows VAJRA.`,
            correlation,
          );
        }

        const parseResult = entry.descriptor.inputSchema.safeParse(stepProposal.input);
        if (!parseResult.success) {
          return Result.failure(
            `PLANNING_FAILED: Invalid input for capability '${stepProposal.targetCapability}' at step ${stepOrder}.`,
            correlation,
          );
        }

        validatedSteps.push(
          createMissionStep({
            missionId,
            stepOrder,
            description: stepProposal.description,
            targetCapability: stepProposal.targetCapability,
            input: parseResult.data,
            expectedEvidence: stepProposal.expectedEvidence,
          }),
        );
      }

      const definition = createMissionDefinition({
        id: missionId,
        objective,
        steps: validatedSteps,
        constraints: {
          maxSteps,
          timeoutMs: constraints.timeoutMs ?? 60_000,
          confirmationRequired: constraints.confirmationRequired ?? false,
          sideEffectLimits: constraints.sideEffectLimits,
        },
        completionCriteria: {
          description: `All ${validatedSteps.length} planned steps executed and verified.`,
          requiredEvidence: validatedSteps.map((s) => s.expectedEvidence),
        },
        correlation,
      });

      return Result.success(definition, correlation);
    }

    // If neither templateStep nor coprocessor is present:
    return Result.failure(
      "PLANNING_FAILED: Neither action template nor model coprocessor available for plan decomposition.",
      correlation,
    );
  }

  private readonly replanCounts = new Map<string, number>();

  async replan(
    failedMissionId: string,
    failedStepOrder: number,
    _newEvidenceIds: readonly string[],
    correlation: CorrelationMetadata,
    alternativeStep?: { targetCapability: string; input: unknown; expectedEvidence?: string },
  ): Promise<Result<MissionDefinition, string>> {
    if (!this.stateStore) {
      return Result.failure(
        "REPLAN_REJECTED: StateStore unavailable for mission inspection.",
        correlation,
      );
    }

    const mission = await this.stateStore.getMission(failedMissionId);
    if (!mission) {
      return Result.failure(
        `REPLAN_REJECTED: Mission '${failedMissionId}' not found.`,
        correlation,
      );
    }

    const steps = await this.stateStore.getStepsForMission(failedMissionId);
    const completedSteps = steps.filter((s) => s.stepOrder < failedStepOrder);

    // Replanning Authority Boundary (§7.4):
    // Autonomous replanning loops are strictly prohibited (max 1 replan attempt per mission).
    const existingReplanStep = steps.some((s) => s.description.startsWith("Replanned step:"));
    const replanAttempts = this.replanCounts.get(failedMissionId) ?? 0;
    if (existingReplanStep || replanAttempts >= 1) {
      return Result.failure(
        `REPLAN_REJECTED: Maximum 1 replan attempt per mission exceeded for '${failedMissionId}'.`,
        correlation,
      );
    }

    // Replanning Authority Boundary (§7.4):
    // Immutable Anchors: objective, constraints, confirmation requirements cannot be mutated.
    if (!alternativeStep) {
      return Result.failure(
        `REPLAN_REJECTED: No safe alternative capability exists for failed step order ${failedStepOrder}.`,
        correlation,
      );
    }

    if (!this.capabilityRegistry.has(alternativeStep.targetCapability)) {
      return Result.failure(
        `REPLAN_REJECTED: Alternative capability '${alternativeStep.targetCapability}' is not registered.`,
        correlation,
      );
    }

    const entry = this.capabilityRegistry.get(alternativeStep.targetCapability);
    if (!entry || !entry.descriptor.isAvailable || entry.descriptor.permissions.allowVajra === false) {
      return Result.failure(
        `REPLAN_REJECTED: Alternative capability '${alternativeStep.targetCapability}' is unavailable or disallowed.`,
        correlation,
      );
    }

    const parsedInput = entry.descriptor.inputSchema.safeParse(alternativeStep.input);
    if (!parsedInput.success) {
      return Result.failure(
        `REPLAN_REJECTED: Input schema validation failed for alternative capability '${alternativeStep.targetCapability}'.`,
        correlation,
      );
    }

    const newStep: MissionStep = createMissionStep({
      missionId: failedMissionId,
      stepOrder: failedStepOrder,
      description: `Replanned step: ${alternativeStep.targetCapability}`,
      targetCapability: alternativeStep.targetCapability,
      input: parsedInput.data,
      expectedEvidence: alternativeStep.expectedEvidence ?? `evidence.${alternativeStep.targetCapability}.ok`,
    });

    const previousStepInstances: MissionStep[] = completedSteps.map((s) =>
      createMissionStep({
        id: s.id,
        missionId: s.missionId,
        stepOrder: s.stepOrder,
        description: s.description,
        targetCapability: s.targetCapability,
        input: s.input,
        expectedEvidence: s.expectedEvidence,
      }),
    );

    const updatedSteps = [...previousStepInstances, newStep];

    const replannedDefinition = createMissionDefinition({
      id: failedMissionId,
      objective: mission.objective, // Immutable Anchor preserved
      steps: updatedSteps,
      constraints: mission.definition.constraints, // Immutable Anchor preserved
      completionCriteria: {
        description: `Replanned mission criteria for '${mission.objective}'`,
        requiredEvidence: updatedSteps.map((s) => s.expectedEvidence),
      },
      goalId: mission.definition.goalId,
      correlation,
    });

    this.replanCounts.set(failedMissionId, replanAttempts + 1);
    return Result.success(replannedDefinition, correlation);
  }
}
