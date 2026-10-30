import { PolicyEnvelope } from "../types/policy";
import { ReasoningResult } from "../reasoning/types";
import { SelfModel } from "../self-model/self-model";
import {
  DecisionOption,
  OptionEvaluationResult,
  EvaluationDisqualificationReason,
} from "./types";

/**
 * Context required for evaluating a decision option.
 */
export interface EvaluationContext {
  readonly policy: PolicyEnvelope;
  readonly contextVersion: number;
  readonly systemHealth: "NOMINAL" | "DEGRADED" | "CRITICAL";
  readonly selfModel: SelfModel;
  readonly reasoning: ReasoningResult;
}

/**
 * Evaluates candidate decision options across the four canonical categories:
 * Hard Gates, Policy Constraints, Evaluation Factors, and Informational Metadata.
 *
 * Invariant: Never collapses evaluation into a single scalar score.
 */
export class DecisionEvaluator {
  evaluateOption(
    option: DecisionOption,
    ctx: EvaluationContext,
  ): OptionEvaluationResult {
    const notes: string[] = [];
    let isDisqualified = false;
    let disqualificationReason: EvaluationDisqualificationReason | undefined;
    let requiresApproval = false;
    let approvalReason: string | undefined;

    // ========================================================================
    // 1. HARD GATES (Binary Disqualifiers)
    // ========================================================================

    // Gate 1A: Prohibited Capabilities / Blast Doors
    if (option.targetCapability) {
      if (ctx.policy.prohibitedCapabilities.includes(option.targetCapability)) {
        isDisqualified = true;
        disqualificationReason = "PROHIBITED_CAPABILITY";
        notes.push(
          `Target capability '${option.targetCapability}' is explicitly prohibited by policy envelope.`,
        );
      }
    }

    // Gate 1B: System Health Override (CRITICAL halts operational mutations)
    if (ctx.systemHealth === "CRITICAL" && !isDisqualified) {
      const allowedInCritical =
        option.kind === "answer_conversation" ||
        option.kind === "wait_and_observe" ||
        option.kind === "request_clarification";
      if (!allowedInCritical) {
        isDisqualified = true;
        disqualificationReason = "CRITICAL_HEALTH_HALT";
        notes.push(
          "System health is CRITICAL. Operational state mutations and missions are halted.",
        );
      }
    }

    // Gate 1C: Contradicted Premise Disqualification
    if (!isDisqualified && option.requiredEvidence.length > 0) {
      const activeContradictions = ctx.reasoning.contradictions;
      for (const reqEvidence of option.requiredEvidence) {
        const isContradicted = activeContradictions.some(
          (c) =>
            c.conflictingEvidenceIds.includes(reqEvidence) ||
            c.proposition.toLowerCase().includes(reqEvidence.toLowerCase()),
        );
        if (isContradicted) {
          isDisqualified = true;
          disqualificationReason = "CONTRADICTED_PREMISE";
          notes.push(
            `Option relies on evidence or premise '${reqEvidence}' that has active contradictions.`,
          );
          break;
        }
      }
    }

    // Gate 1D: Capability Availability & Permissions (AKIRA OS Boundary)
    if (!isDisqualified && option.targetCapability) {
      const capInfo = ctx.selfModel.getCapability(option.targetCapability);

      if (!capInfo || !capInfo.isAvailable) {
        isDisqualified = true;
        disqualificationReason = "CAPABILITY_UNAVAILABLE";
        notes.push(
          `Target capability '${option.targetCapability}' is missing or offline in AKIRA OS.`,
        );
      } else if (!capInfo.allowVajra) {
        isDisqualified = true;
        disqualificationReason = "CAPABILITY_DISALLOWS_VAJRA";
        notes.push(
          `Target capability '${option.targetCapability}' does not permit VAJRA caller context.`,
        );
      }
    }

    // ========================================================================
    // 2. POLICY CONSTRAINTS (Deterministic Limits)
    // ========================================================================

    // Constraint 2A: Cost Envelope
    if (option.estimatedCostCents > ctx.policy.maxAutonomousCostCents) {
      requiresApproval = true;
      approvalReason = `Estimated cost (${option.estimatedCostCents}¢) exceeds autonomous spend cap (${ctx.policy.maxAutonomousCostCents}¢).`;
      notes.push(approvalReason);
    }

    // Constraint 2B: Step Limit
    if (option.estimatedSteps > ctx.policy.maxAutonomousSteps) {
      requiresApproval = true;
      const stepMsg = `Estimated step count (${option.estimatedSteps}) exceeds max autonomous steps (${ctx.policy.maxAutonomousSteps}).`;
      approvalReason = approvalReason ? `${approvalReason}; ${stepMsg}` : stepMsg;
      notes.push(stepMsg);
    }

    // Constraint 2C: Impact & Reversibility Mandatory Escalation (Contract K1)
    if (
      option.kind === "reject_safety_violation" ||
      option.kind === "answer_conversation" ||
      option.kind === "wait_and_observe" ||
      option.kind === "request_clarification" ||
      option.kind === "request_verification"
    ) {
      requiresApproval = false;
      approvalReason = undefined;
    } else if (option.impactClass === "HIGH") {
      requiresApproval = true;
      const highMsg = "High-impact actions require explicit human confirmation.";
      approvalReason = approvalReason ? `${approvalReason}; ${highMsg}` : highMsg;
      notes.push(highMsg);
    } else if (
      option.reversibility === "IRREVERSIBLE" &&
      option.impactClass !== "LOW"
    ) {
      requiresApproval = true;
      const irrMsg = "Medium-impact irreversible actions require human approval.";
      approvalReason = approvalReason ? `${approvalReason}; ${irrMsg}` : irrMsg;
      notes.push(irrMsg);
    }

    // ========================================================================
    // 3. EVALUATION FACTORS (Epistemic Confidence & Gating)
    // ========================================================================

    const minConfidence = ctx.policy.minAutonomousConfidence ?? 0.85;
    // Base confidence from reasoning hypotheses or default to nominal
    let confidence = 0.90;
    if (ctx.reasoning.hypotheses.length > 0) {
      confidence = Math.max(...ctx.reasoning.hypotheses.map((h) => h.confidence));
    }
    if (ctx.reasoning.uncertaintyLevel === "HIGH") {
      confidence = Math.min(confidence, 0.70);
    } else if (ctx.reasoning.uncertaintyLevel === "CRITICAL") {
      confidence = Math.min(confidence, 0.40);
    }

    if (
      confidence < minConfidence &&
      (option.kind === "start_mission" || option.kind === "execute_mission")
    ) {
      requiresApproval = true;
      const confMsg = `Epistemic confidence (${confidence.toFixed(2)}) is below policy threshold (${minConfidence.toFixed(2)}).`;
      approvalReason = approvalReason ? `${approvalReason}; ${confMsg}` : confMsg;
      notes.push(confMsg);
    }

    const policyCompliant = !isDisqualified && (!requiresApproval || option.kind === "escalate_to_human");

    return Object.freeze({
      option,
      isDisqualified,
      disqualificationReason,
      requiresApproval,
      approvalReason,
      confidence,
      policyCompliant,
      evaluationNotes: Object.freeze(notes),
    });
  }
}
