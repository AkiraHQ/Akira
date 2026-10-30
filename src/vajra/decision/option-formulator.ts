import { ReasoningResult } from "../reasoning/types";
import { OperationalContext } from "../types/operational-context";
import { SelfModel } from "../self-model/self-model";
import { PolicyEnvelope } from "../types/policy";
import { KnownCapabilityInfo } from "../types/self-model";
import { DecisionNecessityClass, DecisionOption } from "./types";

/**
 * Synthesizes candidate decision options based on classified necessity,
 * reasoning conclusions, self-model capabilities, and policy limits.
 *
 * Invariant: Phase 4 produces zero candidate actions. Phase 5 synthesizes them
 * deterministically and validates any optional external model proposals.
 */
export class DecisionOptionFormulator {
  /**
   * Deterministically formulates candidate options for a given necessity class.
   */
  formulateOptions(
    necessity: DecisionNecessityClass,
    reasoning: ReasoningResult,
    context: OperationalContext,
    selfModel: SelfModel,
    policy: PolicyEnvelope,
  ): readonly DecisionOption[] {
    const options: DecisionOption[] = [];
    const stimulusId = reasoning.stimulusId;

    switch (necessity) {
      case "NO_ACTION_REQUIRED":
      case "WAIT_AND_OBSERVE": {
        options.push(
          Object.freeze({
            id: `opt-${stimulusId}-wait`,
            kind: "wait_and_observe",
            intent: "Maintain current operational focus without active mutation.",
            estimatedCostCents: 0,
            estimatedSteps: 0,
            impactClass: "INFORMATIONAL" as any,
            reversibility: "FULLY_REVERSIBLE",
            requiredEvidence: Object.freeze([]),
            rationale:
              reasoning.deliberationTrace.rationale ||
              "State is nominal or external task is in flight; safe hold active.",
          }),
        );
        break;
      }

      case "ANSWER_CONVERSATION": {
        options.push(
          Object.freeze({
            id: `opt-${stimulusId}-reply`,
            kind: "answer_conversation",
            intent: "Provide immediate conversational response to user query.",
            estimatedCostCents: 0,
            estimatedSteps: 1,
            impactClass: "LOW",
            reversibility: "FULLY_REVERSIBLE",
            requiredEvidence: Object.freeze([]),
            rationale:
              reasoning.deliberationTrace.rationale ||
              "Informational query addressed without state mutation.",
          }),
        );
        break;
      }

      case "REQUEST_CLARIFICATION": {
        const questions = reasoning.unresolvedQuestions.length > 0
          ? reasoning.unresolvedQuestions
          : ["Could you clarify the desired operational scope?"];

        options.push(
          Object.freeze({
            id: `opt-${stimulusId}-clarify`,
            kind: "request_clarification",
            intent: "Request clarification on ambiguous parameters from the human.",
            estimatedCostCents: 0,
            estimatedSteps: 1,
            impactClass: "LOW",
            reversibility: "FULLY_REVERSIBLE",
            requiredEvidence: Object.freeze([]),
            rationale:
              "High epistemic uncertainty or ambiguous intent prevents safe autonomous execution.",
            payload: { unresolvedQuestions: questions },
          }),
        );
        break;
      }

      case "REQUEST_VERIFICATION": {
        const suggestions = reasoning.verificationSuggestions.length > 0
          ? reasoning.verificationSuggestions
          : ["Inspect recent environment observations"];

        options.push(
          Object.freeze({
            id: `opt-${stimulusId}-verify`,
            kind: "request_verification",
            intent: "Dispatch observation probe to resolve contradictory evidence.",
            estimatedCostCents: 0,
            estimatedSteps: 1,
            impactClass: "LOW",
            reversibility: "FULLY_REVERSIBLE",
            requiredEvidence: Object.freeze([]),
            rationale:
              "Contradiction detected in active premises; verification probe required before acting.",
            payload: { verificationSuggestions: suggestions },
          }),
        );
        break;
      }

      case "ESCALATE_TO_HUMAN": {
        options.push(
          Object.freeze({
            id: `opt-${stimulusId}-escalate`,
            kind: "escalate_to_human",
            intent: "Request explicit human authorization for high-impact operation.",
            estimatedCostCents: 0,
            estimatedSteps: 1,
            impactClass: "HIGH",
            reversibility: "IRREVERSIBLE",
            requiredEvidence: Object.freeze([]),
            rationale:
              "High-impact or irreversible action requires explicit human confirmation per Contract K1.",
          }),
        );
        break;
      }

      case "START_MISSION": {
        // Find best matching capability from SelfModel
        const availableCaps = selfModel.listCapabilities().filter((c: KnownCapabilityInfo) => c.isAvailable && c.allowVajra);
        const taskCreateCap = availableCaps.find((c: KnownCapabilityInfo) => c.name === "task.create");
        const defaultCap = taskCreateCap ? "task.create" : availableCaps[0]?.name;

        // Primary candidate: initiate multi-step mission
        options.push(
          Object.freeze({
            id: `opt-${stimulusId}-mission`,
            kind: "start_mission",
            intent: `Execute operational mission: ${context.currentFocus || "Accomplish user objective"}`,
            targetCapability: defaultCap,
            estimatedCostCents: 1,
            estimatedSteps: 2,
            impactClass: "LOW",
            reversibility: "PARTIALLY_REVERSIBLE",
            requiredEvidence: Object.freeze([]),
            rationale:
              "Epistemic premises verified and within policy envelope. Ready for Phase 6 mission planning.",
          }),
        );

        // Safe alternative: conversational explanation instead of immediate mission
        options.push(
          Object.freeze({
            id: `opt-${stimulusId}-alternative-explain`,
            kind: "answer_conversation",
            intent: "Explain proposed strategy to user before launching mission.",
            estimatedCostCents: 0,
            estimatedSteps: 1,
            impactClass: "LOW",
            reversibility: "FULLY_REVERSIBLE",
            requiredEvidence: Object.freeze([]),
            rationale: "Safe low-impact alternative presenting plan without mutation.",
          }),
        );
        break;
      }

      case "DISAGREE_AND_COUNTERPROPOSE": {
        options.push(
          Object.freeze({
            id: `opt-${stimulusId}-counter`,
            kind: "disagree_and_counter",
            intent: "Acknowledge user intent and offer verified counter-proposal.",
            estimatedCostCents: 0,
            estimatedSteps: 1,
            impactClass: "LOW",
            reversibility: "FULLY_REVERSIBLE",
            requiredEvidence: Object.freeze([]),
            rationale:
              "User directive contradicts verified observations or policy; protocol initiated.",
          }),
        );
        break;
      }

      case "REJECT_SAFETY_VIOLATION": {
        options.push(
          Object.freeze({
            id: `opt-${stimulusId}-reject`,
            kind: "reject_safety_violation",
            intent: "Refuse directive that violates absolute safety blast doors.",
            estimatedCostCents: 0,
            estimatedSteps: 1,
            impactClass: "HIGH",
            reversibility: "FULLY_REVERSIBLE",
            requiredEvidence: Object.freeze([]),
            rationale:
              "Directive violates non-negotiable architectural safety boundaries or prohibited capabilities.",
          }),
        );
        break;
      }
    }

    return Object.freeze(options);
  }

  /**
   * Sanitizes external model coprocessor proposals against the capability catalog and policy envelope.
   * Discards any option targeting unknown or prohibited capabilities.
   */
  sanitizeModelProposal(
    rawProposal: unknown,
    selfModel: SelfModel,
    policy: PolicyEnvelope,
  ): DecisionOption | null {
    if (!rawProposal || typeof rawProposal !== "object") {
      return null;
    }

    const p = rawProposal as Record<string, any>;
    if (!p.id || !p.kind || !p.intent) {
      return null;
    }

    // Capability existence check
    if (p.targetCapability) {
      const exists = selfModel.getCapability(p.targetCapability) !== undefined;
      if (!exists) {
        return null;
      }
      if (policy.prohibitedCapabilities.includes(p.targetCapability)) {
        return null;
      }
    }

    return Object.freeze({
      id: String(p.id),
      kind: p.kind,
      intent: String(p.intent),
      targetCapability: p.targetCapability ? String(p.targetCapability) : undefined,
      estimatedCostCents: typeof p.estimatedCostCents === "number" ? p.estimatedCostCents : 0,
      estimatedSteps: typeof p.estimatedSteps === "number" ? p.estimatedSteps : 1,
      impactClass: p.impactClass ?? "LOW",
      reversibility: p.reversibility ?? "PARTIALLY_REVERSIBLE",
      requiredEvidence: Array.isArray(p.requiredEvidence) ? Object.freeze([...p.requiredEvidence]) : Object.freeze([]),
      rationale: String(p.rationale ?? "Sanitized proposal from coprocessor"),
      payload: p.payload,
    });
  }
}
