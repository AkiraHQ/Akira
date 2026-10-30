import { Result, CorrelationMetadata } from "../../contracts/results/result";
import { IDecisionArbiter } from "../ports/decision";
import { ExecutiveAction, createExecutiveAction } from "../types/action";
import { ReasoningResult } from "../reasoning/types";
import { OperationalContext } from "../types/operational-context";
import { SelfModel } from "../self-model/self-model";
import { IOperationalStateStore } from "../ports/state-store";
import { createDeliberationTrace, DeliberationTrace } from "../types/trace";
import { DecisionEvaluator } from "./evaluator";
import { DecisionOptionFormulator } from "./option-formulator";
import { DisagreementHandler } from "./disagreement";
import { ApprovalManager } from "./approval-manager";
import {
  DecisionNecessityClass,
  DecisionOption,
  OptionEvaluationResult,
} from "./types";

/**
 * Core Implementation of VAJRA Decision Arbiter (Phase 5).
 *
 * Transforms epistemic reasoning results into authoritative, immutable ExecutiveActions
 * through multi-dimensional policy evaluation, human approval gating (K1), and guaranteed
 * persistent audit traces.
 *
 * Invariants:
 * - Phase 5 CANNOT execute capabilities, spawn processes, or actuate HANDS.
 * - Phase 5 CANNOT mutate or approve epistemic beliefs (Beliefs are read-only).
 * - Persistence failure halts action emission (Zero unpersisted authoritative actions).
 */
export class DecisionArbiter implements IDecisionArbiter {
  private idCounter = 0;

  constructor(
    private readonly stateStore: IOperationalStateStore,
    private readonly evaluator: DecisionEvaluator = new DecisionEvaluator(),
    private readonly optionFormulator: DecisionOptionFormulator = new DecisionOptionFormulator(),
    private readonly disagreementHandler: DisagreementHandler = new DisagreementHandler(),
    private readonly approvalManager?: ApprovalManager,
  ) {}

  async arbitrate(
    reasoning: ReasoningResult,
    context: OperationalContext,
    selfModel: SelfModel,
    correlation?: CorrelationMetadata,
  ): Promise<Result<ExecutiveAction, string>> {
    const corr: CorrelationMetadata = correlation ?? reasoning.correlation;
    const policy = selfModel.getPolicy();
    this.idCounter++;
    const turnSuffix = `${Date.now()}-${this.idCounter}`;

    // ========================================================================
    // 1. State Version Staleness Guard (Invariant K-P4-2)
    // ========================================================================
    if (context.version !== reasoning.contextVersion) {
      return Result.failure(
        `State version mismatch (reasoning context v${reasoning.contextVersion} vs active context v${context.version}). Deliberation stale.`,
        corr,
      );
    }

    // ========================================================================
    // 2. Classify Decision Necessity
    // ========================================================================
    const necessity = this.classifyNecessity(reasoning, context, policy);

    // ========================================================================
    // 3. Formulate Candidate Options
    // ========================================================================
    const candidateOptions = this.optionFormulator.formulateOptions(
      necessity,
      reasoning,
      context,
      selfModel,
      policy,
    );

    // ========================================================================
    // 4. Multi-Dimensional Option Evaluation
    // ========================================================================
    const evalResults: OptionEvaluationResult[] = candidateOptions.map((opt) =>
      this.evaluator.evaluateOption(opt, {
        policy,
        contextVersion: context.version,
        systemHealth: context.systemHealthStatus,
        selfModel,
        reasoning,
      }),
    );

    // ========================================================================
    // 5. Select Winning Option (or Safe Hold Fallback)
    // ========================================================================
    let chosenResult = evalResults.find((r) => !r.isDisqualified);
    let chosenOption: DecisionOption;

    if (!chosenResult) {
      // All candidate options disqualified -> fallback to safe hold (request clarification)
      chosenOption = Object.freeze({
        id: `opt-fallback-${turnSuffix}`,
        kind: "request_clarification",
        intent: "Request human guidance after candidate options were disqualified by policy or health gates.",
        estimatedCostCents: 0,
        estimatedSteps: 1,
        impactClass: "LOW",
        reversibility: "FULLY_REVERSIBLE",
        requiredEvidence: Object.freeze([]),
        rationale: "All proposed operational candidates were disqualified by hard safety or health gates.",
        payload: {
          disqualifiedReasons: evalResults.map(
            (r) => `${r.option.id}: ${r.disqualificationReason ?? "disqualified"}`,
          ),
        },
      });
      chosenResult = {
        option: chosenOption,
        isDisqualified: false,
        requiresApproval: false,
        confidence: 1.0,
        policyCompliant: true,
        evaluationNotes: Object.freeze(["Safe fallback chosen."]),
      };
    } else {
      chosenOption = chosenResult.option;
    }

    // ========================================================================
    // 6. Human Approval Gating (Contract K1)
    // ========================================================================
    let finalKind = chosenOption.kind;
    let approvalState: "NONE_REQUIRED" | "APPROVAL_REQUIRED" = "NONE_REQUIRED";
    let escalationId: string | undefined;

    if (
      chosenOption.kind === "reject_safety_violation" ||
      chosenOption.kind === "answer_conversation" ||
      chosenOption.kind === "wait_and_observe" ||
      chosenOption.kind === "request_clarification" ||
      chosenOption.kind === "request_verification"
    ) {
      approvalState = "NONE_REQUIRED";
      finalKind = chosenOption.kind;
    } else if (chosenResult.requiresApproval || chosenOption.kind === "escalate_to_human") {
      approvalState = "APPROVAL_REQUIRED";
      finalKind = "escalate_to_human";

      if (this.approvalManager) {
        try {
          const escRecord = await this.approvalManager.createApprovalGate({
            decisionId: `dec-${turnSuffix}`,
            actionId: `act-${turnSuffix}`,
            option: chosenOption,
            context,
            policy,
            rationale:
              chosenResult.approvalReason ||
              chosenOption.rationale ||
              "Human authorization required by policy envelope.",
            correlation: corr,
          });
          escalationId = escRecord.id;
        } catch (escErr: any) {
          // If creating escalation in persistence fails, halt immediately
          return Result.failure(
            `Failed to persist human escalation gate: ${escErr?.message ?? String(escErr)}`,
            corr,
          );
        }
      }
    }

    // ========================================================================
    // 7. Construct Canonical Immutable ExecutiveAction
    // ========================================================================
    const decisionId = `dec-${turnSuffix}`;
    const actionId = `act-${turnSuffix}`;
    const idempotencyKey = `idemp-${reasoning.stimulusId}-${context.version}-${actionId}`;

    const action = createExecutiveAction({
      id: actionId,
      decisionId,
      kind: finalKind,
      intent: chosenOption.intent,
      authorityLevel: 1,
      policyBasis: chosenResult.requiresApproval
        ? (chosenResult.approvalReason ?? "Policy escalation threshold met")
        : "Policy envelope constraints satisfied",
      policyVersion: policy.policyVersion ?? "1.0.0",
      evidenceBasis: chosenOption.requiredEvidence,
      riskClass: chosenOption.impactClass,
      impactClass: chosenOption.impactClass,
      reversibility: chosenOption.reversibility,
      requiredCapability: chosenOption.targetCapability,
      approvalState,
      escalationId,
      stateVersion: context.version,
      expiry: policy.approvalTtlMs
        ? new Date(Date.now() + policy.approvalTtlMs).toISOString()
        : undefined,
      idempotencyKey,
      rationale: chosenOption.rationale,
      confidence: chosenResult.confidence,
      policyCompliance: chosenResult.policyCompliant,
      payload: chosenOption.payload,
      correlation: corr,
    });

    // ========================================================================
    // 8. Construct Auditable DeliberationTrace
    // ========================================================================
    const deliberationTrace: DeliberationTrace = createDeliberationTrace({
      traceId: `trace-${decisionId}`,
      stimulusId: reasoning.stimulusId,
      correlation: corr,
      intentClass: necessity,
      selectedOption: JSON.stringify(action),
      consideredOptions: evalResults.map((r) => ({
        action: `${r.option.kind}:${r.option.intent}`,
        risk: r.option.impactClass,
        confidence: r.confidence,
        expectedCostCents: r.option.estimatedCostCents,
      })),
      rationale: action.rationale,
      evidenceReliedUpon: action.evidenceBasis ?? [],
      escalationRequired: action.approvalState === "APPROVAL_REQUIRED",
    });

    // ========================================================================
    // 9. STRICT PERSISTENCE GATE (Zero Unpersisted Actions Released)
    // ========================================================================
    try {
      await this.stateStore.appendAuditTrace(deliberationTrace);
    } catch (persistErr: any) {
      return Result.failure(
        `DECISION_PERSISTENCE_FAILED: Could not persist deliberation trace to SQLite (${persistErr?.message ?? String(persistErr)}). Action aborted.`,
        corr,
      );
    }

    return Result.success(action, corr);
  }

  /**
   * Deterministically classifies decision necessity from reasoning and health state.
   */
  private classifyNecessity(
    reasoning: ReasoningResult,
    context: OperationalContext,
    policy: any,
  ): DecisionNecessityClass {
    // 1. Critical Health
    if (context.systemHealthStatus === "CRITICAL") {
      return "WAIT_AND_OBSERVE";
    }

    // 2. Prohibited Directives / Safety Breaches
    if (
      reasoning.possibleConsequences.some((c) =>
        c.toLowerCase().includes("prohibited") || c.toLowerCase().includes("violation"),
      )
    ) {
      return "REJECT_SAFETY_VIOLATION";
    }

    // 3. Contradictions Present
    if (reasoning.contradictions.length > 0) {
      return "REQUEST_VERIFICATION";
    }

    // 4. Critical Uncertainty or Inconclusive Reasoning
    if (
      reasoning.uncertaintyLevel === "CRITICAL" ||
      reasoning.status === "INCONCLUSIVE"
    ) {
      return "REQUEST_CLARIFICATION";
    }

    // 5. Explicit Disagreement with User Directive
    if (reasoning.problemClass === "OBSERVATION_CONSISTENCY" && reasoning.unresolvedQuestions.length > 0) {
      return "DISAGREE_AND_COUNTERPROPOSE";
    }

    // 6. Informational problem classes default to conversational answer
    if (
      reasoning.problemClass === "SYNTHESIS_AND_SUMMARIZATION" ||
      reasoning.problemClass === "AMBIGUOUS_INTENT_INTERPRETATION"
    ) {
      return "ANSWER_CONVERSATION";
    }

    // 7. Mission Intent
    if (
      context.mode === "REQUEST_DRIVEN" &&
      context.currentFocus &&
      !context.currentFocus.toLowerCase().includes("awaiting") &&
      !context.currentFocus.toLowerCase().includes("idle") &&
      !context.currentFocus.toLowerCase().includes("question") &&
      !context.currentFocus.toLowerCase().includes("hello")
    ) {
      return "START_MISSION";
    }

    // 8. Informational Conversation
    return "ANSWER_CONVERSATION";
  }
}
