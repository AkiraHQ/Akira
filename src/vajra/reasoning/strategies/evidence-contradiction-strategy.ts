import { CorrelationMetadata } from "../../../contracts/results/result";
import {
  IVajraReasoningStrategy,
  ProblemClass,
  ReasoningContext,
  StrategyCapabilityDeclaration,
  StrategyReasoningOutput,
  ContradictionRecord,
  ProposedBeliefUpdate,
  ReasoningHypothesis,
  UncertaintyLevel,
} from "../types";

/**
 * Tier 2 Reasoning Strategy: Evidence Consistency & Contradiction Audit.
 *
 * Characteristics:
 * - Deterministic formal propositional check (< 5ms, $0.00).
 * - Solves OBSERVATION_CONSISTENCY and POLICY_CONFORMANCE.
 * - Flags epistemic contradictions, proposes belief demotions, and escalates uncertainty.
 * - Invariant: Produces epistemic evidence only; never makes operational decisions.
 */
export class EvidenceContradictionStrategy implements IVajraReasoningStrategy {
  readonly id = "EvidenceContradictionStrategy";
  readonly tier = 2 as const;

  readonly capabilities: StrategyCapabilityDeclaration = Object.freeze({
    supportedProblemClasses: Object.freeze([
      "OBSERVATION_CONSISTENCY" as ProblemClass,
      "POLICY_CONFORMANCE" as ProblemClass,
    ]),
    requiredEvidenceTypes: Object.freeze(["observation", "belief"]),
    maxComplexity: "MEDIUM",
    requiresExternalModel: false,
    handlesUncertainty: true,
    producesHypotheses: true,
    detectsContradictions: true,
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

    const contradictions: ContradictionRecord[] = [];
    const proposedUpdates: ProposedBeliefUpdate[] = [];
    const hypotheses: ReasoningHypothesis[] = [];
    const possibleConsequences: string[] = [];
    const verificationSuggestions: string[] = [];
    const unresolvedQuestions: string[] = [];

    // 1. Audit active beliefs against recent observations
    for (const belief of context.relevantBeliefs) {
      // Direct contradiction marker on belief
      if (belief.verificationState === "CONTRADICTED" || belief.contradictingEvidenceIds.length > 0) {
        contradictions.push({
          proposition: belief.proposition,
          conflictingEvidenceIds: belief.contradictingEvidenceIds,
          explanation: `Belief '${belief.proposition}' is marked CONTRADICTED by evidence: ${belief.contradictingEvidenceIds.join(", ")}`,
          severity: "CRITICAL",
        });

        proposedUpdates.push({
          beliefId: belief.id,
          proposition: belief.proposition,
          currentConfidence: belief.confidence,
          proposedConfidence: 0.0,
          proposedVerificationState: "CONTRADICTED",
          rationale: `Epistemic inconsistency verified against observations: ${belief.contradictingEvidenceIds.join(", ")}`,
          supportingEvidenceIds: belief.supportingEvidenceIds,
        });

        verificationSuggestions.push(
          `Execute deterministic verification probe to re-evaluate proposition: '${belief.proposition}'`,
        );
      }

      // Check for opposing observations matching the proposition subject
      for (const obs of context.recentObservations) {
        const payloadText = typeof obs.payload === "string" ? obs.payload : JSON.stringify(obs.payload);
        const lowerProp = belief.proposition.toLowerCase();
        const lowerPayload = payloadText.toLowerCase();

        // Detect explicit contradiction markers in telemetry
        const indicatesFailure =
          lowerPayload.includes("failed") ||
          lowerPayload.includes("error") ||
          lowerPayload.includes("mismatch") ||
          lowerPayload.includes("contradiction");

        const propTokens = lowerProp.split(/[^a-z0-9]+/).filter(t => t.length > 2);
        const subjectTokens = obs.subject.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);
        const payloadTokens = lowerPayload.split(/[^a-z0-9]+/).filter(t => t.length > 2);

        const matchesSubject = subjectTokens.some(t => propTokens.includes(t));
        const matchesPayload = propTokens.some(t => payloadTokens.includes(t));

        if (indicatesFailure && (matchesSubject || matchesPayload)) {
          const alreadyTracked = contradictions.some(c => c.proposition === belief.proposition);
          if (!alreadyTracked) {
            contradictions.push({
              proposition: belief.proposition,
              conflictingEvidenceIds: [obs.id],
              explanation: `Observation '${obs.id}' from '${obs.producer}' reports contradictory telemetry: ${payloadText}`,
              severity: "CRITICAL",
            });

            proposedUpdates.push({
              beliefId: belief.id,
              proposition: belief.proposition,
              currentConfidence: belief.confidence,
              proposedConfidence: 0.0,
              proposedVerificationState: "CONTRADICTED",
              rationale: `Direct observation contradiction from producer '${obs.producer}' (Obs ID: ${obs.id})`,
              supportingEvidenceIds: belief.supportingEvidenceIds,
            });

            verificationSuggestions.push(
              `Conduct verification test on subject '${obs.subject}' to reconcile conflicting evidence`,
            );
          }
        }
      }
    }

    let uncertainty: UncertaintyLevel;
    let rationale: string;

    if (contradictions.length > 0) {
      uncertainty = "CRITICAL";
      hypotheses.push({
        id: "hyp-epistemic-contradiction",
        description: `Detected ${contradictions.length} epistemic contradiction(s) between active premises and observed telemetry`,
        confidence: 0.95,
        supportingEvidenceIds: contradictions.flatMap(c => c.conflictingEvidenceIds),
      });
      possibleConsequences.push(
        "Proceeding under current assumptions will cause operational error or state corruption",
      );
      unresolvedQuestions.push(
        `Why do premises conflict with observed telemetry for: ${contradictions.map(c => c.proposition).join(", ")}?`,
      );
      rationale = `Critical evidence contradiction detected across ${contradictions.length} proposition(s). Uncertainty escalated to CRITICAL.`;
    } else {
      uncertainty = "LOW";
      hypotheses.push({
        id: "hyp-epistemic-consistent",
        description: "All active premises and verified observations are internally consistent",
        confidence: 0.9,
        supportingEvidenceIds: context.recentObservations.map(o => o.id),
      });
      possibleConsequences.push("Epistemic foundation is sound for next operational stage");
      rationale = `Evaluated ${context.relevantBeliefs.length} belief(s) against ${context.recentObservations.length} observation(s); zero contradictions detected.`;
    }

    const output: StrategyReasoningOutput = {
      strategyId: this.id,
      problemClass: problemClass,
      hypotheses: Object.freeze(hypotheses),
      proposedBeliefUpdates: Object.freeze(proposedUpdates),
      contradictions: Object.freeze(contradictions),
      possibleConsequences: Object.freeze(possibleConsequences),
      uncertaintyLevel: uncertainty,
      unresolvedQuestions: Object.freeze(unresolvedQuestions),
      verificationSuggestions: Object.freeze(verificationSuggestions),
      rationale,
    };

    return { ok: true, value: output };
  }
}
