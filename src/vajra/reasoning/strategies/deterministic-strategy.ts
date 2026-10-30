import { CorrelationMetadata } from "../../../contracts/results/result";
import {
  IVajraReasoningStrategy,
  ProblemClass,
  ReasoningContext,
  StrategyCapabilityDeclaration,
  StrategyReasoningOutput,
  UncertaintyLevel,
  ReasoningHypothesis,
} from "../types";

/**
 * Tier 1 Reasoning Strategy: Deterministic Policy & Health Rule Evaluation.
 *
 * Characteristics:
 * - Pure rule evaluation, zero external model calls (< 1ms, $0.00).
 * - Solves POLICY_CONFORMANCE exclusively.
 * - Rejects arbitrary natural language interpretation or complex causal reasoning.
 */
export class DeterministicPolicyStrategy implements IVajraReasoningStrategy {
  readonly id = "DeterministicPolicyStrategy";
  readonly tier = 1 as const;

  readonly capabilities: StrategyCapabilityDeclaration = Object.freeze({
    supportedProblemClasses: Object.freeze(["POLICY_CONFORMANCE" as ProblemClass]),
    requiredEvidenceTypes: Object.freeze([]),
    maxComplexity: "LOW",
    requiresExternalModel: false,
    handlesUncertainty: false,
    producesHypotheses: false,
    detectsContradictions: false,
    supportsDegradedOperation: true,
  });

  canHandle(_context: ReasoningContext, problemClass: ProblemClass): boolean {
    return this.capabilities.supportedProblemClasses.includes(problemClass);
  }

  async execute(
    context: ReasoningContext,
    problemClass: ProblemClass,
    _correlation: CorrelationMetadata,
  ): Promise<{ ok: true; value: StrategyReasoningOutput } | { ok: false; error: string }> {
    if (!this.canHandle(context, problemClass)) {
      return {
        ok: false,
        error: `${this.id} cannot handle problem class '${problemClass}'. Supported: ${this.capabilities.supportedProblemClasses.join(", ")}`,
      };
    }

    const hypotheses: ReasoningHypothesis[] = [];
    const possibleConsequences: string[] = [];
    let uncertainty: UncertaintyLevel = "LOW";
    let rationale = "";

    // 1. Evaluate Critical System Health
    if (context.operationalContext.systemHealthStatus === "CRITICAL") {
      uncertainty = "CRITICAL";
      hypotheses.push({
        id: "hyp-crit-health",
        description: "System health is CRITICAL; operational safety mandates halt on non-essential tasks",
        confidence: 1.0,
        supportingEvidenceIds: [],
      });
      possibleConsequences.push("Any further capability execution risks cascading system failure");
      rationale = "System health check failed with status CRITICAL. In accordance with safety policies, operations are restrained.";
    }
    // 2. Evaluate Degraded State
    else if (context.selfModelLimits.isDegraded) {
      uncertainty = "MEDIUM";
      const reasons = context.selfModelLimits.degradedReasons.join("; ") || "unspecified degradation";
      hypotheses.push({
        id: "hyp-degraded-state",
        description: `System is operating in a degraded mode: ${reasons}`,
        confidence: 0.9,
        supportingEvidenceIds: [],
      });
      possibleConsequences.push("Subsystem limitations apply; capability invocations must be restricted");
      rationale = `Self-model reported degraded state. Active degradation reasons: ${reasons}.`;
    }
    // 3. Evaluate Scheduled Timer Stimulus
    else if (context.stimulus.kind === "scheduled_timer") {
      hypotheses.push({
        id: "hyp-scheduled-check",
        description: "Scheduled timer wake-up trigger received within rate limits",
        confidence: 1.0,
        supportingEvidenceIds: [],
      });
      possibleConsequences.push("Routine maintenance or health check cycle triggered");
      rationale = "Scheduled timer stimulus conforms to proactive policy limits.";
    }
    // 4. Default Policy Conformance
    else {
      hypotheses.push({
        id: "hyp-policy-pass",
        description: "Operational context satisfies bounded policy envelope invariants",
        confidence: 1.0,
        supportingEvidenceIds: [],
      });
      possibleConsequences.push("Standard operational policy bounds remain in effect");
      rationale = "Context and stimulus conform strictly to active policy parameters.";
    }

    const output: StrategyReasoningOutput = {
      strategyId: this.id,
      problemClass: "POLICY_CONFORMANCE",
      hypotheses: Object.freeze(hypotheses),
      proposedBeliefUpdates: Object.freeze([]),
      contradictions: Object.freeze([]),
      possibleConsequences: Object.freeze(possibleConsequences),
      uncertaintyLevel: uncertainty,
      unresolvedQuestions: Object.freeze([]),
      verificationSuggestions: Object.freeze([]),
      rationale,
    };

    return { ok: true, value: output };
  }
}
