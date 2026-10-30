import { Result, CorrelationMetadata } from "../../contracts/results/result";
import { IOperationalStateStore } from "../ports/state-store";
import { IReasoningEngine } from "../ports/reasoning";
import { DeliberationTrace, createDeliberationTrace } from "../types/trace";
import {
  ReasoningContext,
  ReasoningResult,
  ReasoningStatus,
  StrategyReasoningOutput,
  UncertaintyLevel,
  FallbackProvenance,
  ProblemClass,
} from "./types";
import { AdaptiveStrategyRouter } from "./router";

export interface ReasoningEngineDependencies {
  readonly router: AdaptiveStrategyRouter;
  readonly stateStore?: IOperationalStateStore;
}

/**
 * Authoritative VAJRA Adaptive Reasoning Engine (Phase 4).
 *
 * Responsibilities:
 * - Coordinates single-turn cognitive deliberation over ReasoningContext.
 * - Enforces capability-aware safe fallback semantics.
 * - Detects mid-turn state mutations and returns STALE_INVALIDATED with zero auto-retry loops.
 * - Records auditable DeliberationTrace via IOperationalStateStore.
 * - Gathers proposed epistemic belief updates without persisting them (Proposals only).
 * - Yields immutable ReasoningResult envelope containing zero executable actions.
 */
export class ReasoningEngine implements IReasoningEngine {
  private readonly router: AdaptiveStrategyRouter;
  private readonly stateStore?: IOperationalStateStore;

  constructor(deps: ReasoningEngineDependencies) {
    this.router = deps.router;
    this.stateStore = deps.stateStore;
  }

  async deliberate(
    context: ReasoningContext,
    correlation: CorrelationMetadata,
  ): Promise<Result<ReasoningResult, string>> {
    const traceId = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const problemClass: ProblemClass = this.router.classifyProblem(context);

    // 1. Select initial strategy
    const selection = this.router.selectStrategy(context, problemClass);

    let output: StrategyReasoningOutput | null = null;
    let status: ReasoningStatus = "SUCCESS";
    let fallbackProvenance: FallbackProvenance | null = null;
    let strategyUsed = "None";
    let strategyTier: 1 | 2 | 3 = 1;

    if (!selection) {
      // No registered strategy can handle this problem class
      status = "INCONCLUSIVE";
      strategyUsed = "Unresolved";
    } else {
      strategyUsed = selection.strategy.id;
      strategyTier = selection.strategy.tier;

      if (selection.strategy.tier !== selection.intendedTier) {
        status = "DEGRADED";
        fallbackProvenance = {
          intendedTier: selection.intendedTier,
          actualTier: selection.strategy.tier,
          fallbackReason: "CAPABILITY_UNSUPPORTED",
        };
      }

      // Execute selected strategy
      const execResult = await selection.strategy.execute(context, problemClass, correlation);

      if (execResult.ok) {
        output = execResult.value;
      } else {
        // Strategy execution failed -> attempt capability-aware fallback
        const fallback = this.router.findFallbackStrategy(
          context,
          problemClass,
          selection.strategy.tier,
        );

        if (fallback) {
          strategyUsed = fallback.strategy.id;
          strategyTier = fallback.fallbackTier;
          status = "DEGRADED";
          fallbackProvenance = {
            intendedTier: selection.intendedTier,
            actualTier: fallback.fallbackTier,
            fallbackReason: "MODEL_ERROR",
          };

          const fallbackExecResult = await fallback.strategy.execute(
            context,
            problemClass,
            correlation,
          );

          if (fallbackExecResult.ok) {
            output = fallbackExecResult.value;

            // Invariant K-P4-1 & Scenario 12: Fallback must never increase confidence beyond capability
            // Cap hypothesis confidence to 0.40 on fallback
            output = {
              ...output,
              hypotheses: Object.freeze(
                output.hypotheses.map(h =>
                  Object.freeze({
                    ...h,
                    confidence: Math.min(h.confidence, 0.4),
                  }),
                ),
              ),
            };
          } else {
            status = "INCONCLUSIVE";
          }
        } else {
          // No lower tier has capability to reason about this problem -> fail safely, not confidently
          status = "INCONCLUSIVE";
        }
      }
    }

    // 2. Concurrency & Staleness Verification (Invariant K-P4-2, K-P4-8)
    if (this.stateStore) {
      try {
        const currentOperationalContext = await this.stateStore.loadOperationalContext();
        if (
          currentOperationalContext &&
          currentOperationalContext.version !== context.contextVersion
        ) {
          status = "STALE_INVALIDATED";
        }
      } catch {
        // Continue if state store check fails
      }
    }

    // 3. Normalize outputs for INCONCLUSIVE or STALE_INVALIDATED states
    const finalHypotheses = output?.hypotheses ?? [];
    const finalProposedBeliefUpdates = output?.proposedBeliefUpdates ?? [];
    const finalContradictions = output?.contradictions ?? [];
    const finalPossibleConsequences = output?.possibleConsequences ?? [];
    let finalUncertainty: UncertaintyLevel = output?.uncertaintyLevel ?? "HIGH";
    const finalUnresolvedQuestions = [...(output?.unresolvedQuestions ?? [])];
    const finalVerificationSuggestions = [...(output?.verificationSuggestions ?? [])];
    let finalRationale = output?.rationale ?? "";

    if (status === "INCONCLUSIVE") {
      finalUncertainty = "CRITICAL";
      finalRationale = `Deliberation inconclusive: no available reasoning strategy possessed capability for problem class '${problemClass}'. Fail-safe triggered without false confidence.`;
      finalUnresolvedQuestions.push(
        `How can situation be resolved when no capable strategy is available for '${problemClass}'?`,
      );
    } else if (status === "STALE_INVALIDATED") {
      finalUncertainty = "CRITICAL";
      finalRationale = `State version advanced mid-deliberation (expected v${context.contextVersion}). Turn marked STALE_INVALIDATED. Control returned to caller immediately without autonomous retry loop.`;
    }

    // 4. Synthesize Auditable Deliberation Trace (Contract K19)
    const traceRationale = finalRationale || `Deliberation completed with status ${status}`;
    const deliberationTrace: DeliberationTrace = createDeliberationTrace({
      traceId,
      stimulusId: context.stimulus.id,
      correlation,
      intentClass: problemClass,
      selectedOption: `concluded:${status.toLowerCase()}`,
      consideredOptions: finalHypotheses.map(h => ({
        action: h.description,
        risk: finalUncertainty === "CRITICAL" ? "HIGH" : "LOW",
        confidence: h.confidence,
      })),
      rationale: traceRationale,
      evidenceReliedUpon: finalHypotheses.flatMap(h => h.supportingEvidenceIds),
      escalationRequired: finalUncertainty === "CRITICAL",
    });

    // 5. Persist Audit Trace to SQLite via IOperationalStateStore (Zero belief mutations)
    if (this.stateStore && status !== "STALE_INVALIDATED") {
      try {
        await this.stateStore.appendAuditTrace(deliberationTrace);
      } catch {
        // Resilient: trace persistence failure should not throw unhandled exception
      }
    }

    // 6. Compile Canonical ReasoningResult Envelope (Phase 5 handoff)
    const reasoningResult: ReasoningResult = Object.freeze({
      id: `res-${traceId}`,
      stimulusId: context.stimulus.id,
      correlation,
      contextVersion: context.contextVersion,
      problemClass,
      strategyUsed,
      strategyTier,
      status,
      hypotheses: Object.freeze(finalHypotheses),
      proposedBeliefUpdates: Object.freeze(finalProposedBeliefUpdates),
      contradictions: Object.freeze(finalContradictions),
      possibleConsequences: Object.freeze(finalPossibleConsequences),
      uncertaintyLevel: finalUncertainty,
      unresolvedQuestions: Object.freeze(finalUnresolvedQuestions),
      verificationSuggestions: Object.freeze(finalVerificationSuggestions),
      deliberationTrace,
      fallbackProvenance,
      coprocessorMetadata: output?.coprocessorMetadata,
      completedAt: new Date().toISOString(),
    });

    return Result.success(reasoningResult, correlation);
  }
}
