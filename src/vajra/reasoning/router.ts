import {
  IVajraReasoningStrategy,
  ProblemClass,
  ReasoningContext,
} from "./types";

export interface StrategySelection {
  readonly strategy: IVajraReasoningStrategy;
  readonly intendedTier: 1 | 2 | 3;
}

export interface FallbackSelection {
  readonly strategy: IVajraReasoningStrategy;
  readonly fallbackTier: 1 | 2 | 3;
}

/**
 * Deterministic Strategy Router for the Adaptive Reasoning Engine.
 *
 * Responsibilities:
 * 1. Evaluates problem complexity and context to classify the problem into a ProblemClass.
 * 2. Matches problem class against registered strategy capability declarations.
 * 3. Enforces capability-aware safe fallback semantics (Revision 1 §10.2).
 *    Principle: "Fail safely, not confidently."
 */
export class AdaptiveStrategyRouter {
  private strategies: Map<1 | 2 | 3, IVajraReasoningStrategy> = new Map();

  registerStrategy(strategy: IVajraReasoningStrategy): void {
    this.strategies.set(strategy.tier, strategy);
  }

  getStrategy(tier: 1 | 2 | 3): IVajraReasoningStrategy | undefined {
    return this.strategies.get(tier);
  }

  /**
   * Deterministically classifies the reasoning problem based on operational context,
   * stimulus properties, and epistemic beliefs.
   */
  classifyProblem(context: ReasoningContext): ProblemClass {
    // 1. Critical health, degraded state, or scheduled pings mandate POLICY_CONFORMANCE
    if (context.operationalContext.systemHealthStatus === "CRITICAL") {
      return "POLICY_CONFORMANCE";
    }
    if (context.selfModelLimits.isDegraded) {
      return "POLICY_CONFORMANCE";
    }
    if (context.stimulus.kind === "scheduled_timer") {
      return "POLICY_CONFORMANCE";
    }

    // 2. Active contradictions or inconsistent observations mandate OBSERVATION_CONSISTENCY
    const hasContradiction = context.relevantBeliefs.some(
      b => b.verificationState === "CONTRADICTED" || b.contradictingEvidenceIds.length > 0,
    );
    if (hasContradiction) {
      return "OBSERVATION_CONSISTENCY";
    }

    // 3. User messages with semantic ambiguity or known unknowns require semantic interpretation
    if (context.stimulus.kind === "human_prompt") {
      const payloadStr = typeof context.stimulus.payload === "string"
        ? context.stimulus.payload
        : JSON.stringify(context.stimulus.payload ?? "");

      // If prompt has significant unknowns or length, classify as semantic interpretation
      if (context.selfModelLimits.knownUnknowns.length > 0 || payloadStr.length > 30) {
        return "AMBIGUOUS_INTENT_INTERPRETATION";
      }
    }

    // 4. Active mission step execution with hypotheses requires causal generation
    if (context.activeMission) {
      return "CAUSAL_HYPOTHESIS_GENERATION";
    }

    // Default fail-safe classification
    return "POLICY_CONFORMANCE";
  }

  /**
   * Selects the intended reasoning strategy based on problem class.
   */
  selectStrategy(context: ReasoningContext, problemClass: ProblemClass): StrategySelection | null {
    let targetTier: 1 | 2 | 3;

    switch (problemClass) {
      case "POLICY_CONFORMANCE":
        targetTier = 1;
        break;
      case "OBSERVATION_CONSISTENCY":
        targetTier = 2;
        break;
      case "AMBIGUOUS_INTENT_INTERPRETATION":
      case "CAUSAL_HYPOTHESIS_GENERATION":
      case "SYNTHESIS_AND_SUMMARIZATION":
        targetTier = 3;
        break;
      default:
        targetTier = 1;
    }

    const candidate = this.strategies.get(targetTier);
    if (candidate && candidate.canHandle(context, problemClass)) {
      return { strategy: candidate, intendedTier: targetTier };
    }

    // If intended tier is missing or cannot handle, attempt safe fallback immediately
    const fallback = this.findFallbackStrategy(context, problemClass, targetTier);
    if (fallback) {
      return { strategy: fallback.strategy, intendedTier: targetTier };
    }

    return null;
  }

  /**
   * Capability-Aware Safe Fallback (Revision 1 §10.2).
   *
   * Rules:
   * 1. Tier 3 failure -> check Tier 2. If Tier 2 declares capability for problemClass, select Tier 2.
   *    If Tier 2 is incapable, check Tier 1.
   * 2. Tier 2 failure -> check Tier 1. If Tier 1 declares capability, select Tier 1.
   * 3. If no lower strategy declares capability for problemClass, return null (INCONCLUSIVE).
   *    Tier 1 is NEVER a universal fallback.
   */
  findFallbackStrategy(
    context: ReasoningContext,
    problemClass: ProblemClass,
    failedTier: 1 | 2 | 3,
  ): FallbackSelection | null {
    if (failedTier === 3) {
      // Check Tier 2 capability first
      const tier2 = this.strategies.get(2);
      if (tier2 && tier2.canHandle(context, problemClass)) {
        return { strategy: tier2, fallbackTier: 2 };
      }

      // Check Tier 1 capability
      const tier1 = this.strategies.get(1);
      if (tier1 && tier1.canHandle(context, problemClass)) {
        return { strategy: tier1, fallbackTier: 1 };
      }

      // Neither lower tier can validly reason about this problem
      return null;
    }

    if (failedTier === 2) {
      // Check Tier 1 capability
      const tier1 = this.strategies.get(1);
      if (tier1 && tier1.canHandle(context, problemClass)) {
        return { strategy: tier1, fallbackTier: 1 };
      }

      // Tier 1 cannot validly reason about this problem
      return null;
    }

    // Tier 1 has no lower tier
    return null;
  }
}
