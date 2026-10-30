import { describe, it, expect } from "vitest";
import { DecisionEvaluator } from "../../../src/vajra/decision/evaluator";
import { DecisionOption } from "../../../src/vajra/decision/types";
import { DEFAULT_POLICY_ENVELOPE } from "../../../src/vajra/types/policy";
import {
  createMockReasoningResult,
  createMockSelfModel,
} from "./fixtures";

describe("DecisionEvaluator (Phase 5 §10 & §11)", () => {
  const evaluator = new DecisionEvaluator();
  const selfModel = createMockSelfModel();

  it("Hard Gate: Disqualifies options using prohibited capabilities", () => {
    const option: DecisionOption = {
      id: "opt-wipe",
      kind: "start_mission",
      intent: "Wipe database",
      targetCapability: "system.db.wipe",
      estimatedCostCents: 0,
      estimatedSteps: 1,
      impactClass: "HIGH",
      reversibility: "IRREVERSIBLE",
      requiredEvidence: [],
      rationale: "Testing prohibited cap",
    };

    const evalResult = evaluator.evaluateOption(option, {
      policy: DEFAULT_POLICY_ENVELOPE,
      contextVersion: 1,
      systemHealth: "NOMINAL",
      selfModel,
      reasoning: createMockReasoningResult(),
    });

    expect(evalResult.isDisqualified).toBe(true);
    expect(evalResult.disqualificationReason).toBe("PROHIBITED_CAPABILITY");
  });

  it("Hard Gate: Disqualifies options when system health is CRITICAL", () => {
    const option: DecisionOption = {
      id: "opt-mutate",
      kind: "start_mission",
      intent: "Create task",
      targetCapability: "task.create",
      estimatedCostCents: 1,
      estimatedSteps: 1,
      impactClass: "LOW",
      reversibility: "PARTIALLY_REVERSIBLE",
      requiredEvidence: [],
      rationale: "Testing health gate",
    };

    const evalResult = evaluator.evaluateOption(option, {
      policy: DEFAULT_POLICY_ENVELOPE,
      contextVersion: 1,
      systemHealth: "CRITICAL",
      selfModel,
      reasoning: createMockReasoningResult(),
    });

    expect(evalResult.isDisqualified).toBe(true);
    expect(evalResult.disqualificationReason).toBe("CRITICAL_HEALTH_HALT");
  });

  it("Hard Gate: Disqualifies options whose required evidence has active contradictions", () => {
    const option: DecisionOption = {
      id: "opt-contradicted",
      kind: "start_mission",
      intent: "Use contradicted premise",
      targetCapability: "task.create",
      estimatedCostCents: 1,
      estimatedSteps: 1,
      impactClass: "LOW",
      reversibility: "PARTIALLY_REVERSIBLE",
      requiredEvidence: ["evidence-invalid"],
      rationale: "Testing contradiction gate",
    };

    const reasoning = createMockReasoningResult({
      contradictions: [
        {
          proposition: "evidence-invalid is true",
          conflictingEvidenceIds: ["evidence-invalid"],
          explanation: "Evidence was contradicted by new observation",
          severity: "CRITICAL",
        },
      ],
    });

    const evalResult = evaluator.evaluateOption(option, {
      policy: DEFAULT_POLICY_ENVELOPE,
      contextVersion: 1,
      systemHealth: "NOMINAL",
      selfModel,
      reasoning,
    });

    expect(evalResult.isDisqualified).toBe(true);
    expect(evalResult.disqualificationReason).toBe("CONTRADICTED_PREMISE");
  });

  it("Hard Gate: Disqualifies option when target capability is missing from AKIRA OS", () => {
    const option: DecisionOption = {
      id: "opt-missing",
      kind: "start_mission",
      intent: "Use unknown capability",
      targetCapability: "non.existent.capability",
      estimatedCostCents: 1,
      estimatedSteps: 1,
      impactClass: "LOW",
      reversibility: "PARTIALLY_REVERSIBLE",
      requiredEvidence: [],
      rationale: "Testing capability missing",
    };

    const evalResult = evaluator.evaluateOption(option, {
      policy: DEFAULT_POLICY_ENVELOPE,
      contextVersion: 1,
      systemHealth: "NOMINAL",
      selfModel,
      reasoning: createMockReasoningResult(),
    });

    expect(evalResult.isDisqualified).toBe(true);
    expect(evalResult.disqualificationReason).toBe("CAPABILITY_UNAVAILABLE");
  });

  it("Hard Gate: Disqualifies option when capability disallows VAJRA caller context", () => {
    const option: DecisionOption = {
      id: "opt-restricted",
      kind: "start_mission",
      intent: "Use restricted capability",
      targetCapability: "system.internal.raw",
      estimatedCostCents: 1,
      estimatedSteps: 1,
      impactClass: "LOW",
      reversibility: "PARTIALLY_REVERSIBLE",
      requiredEvidence: [],
      rationale: "Testing permissions",
    };

    const evalResult = evaluator.evaluateOption(option, {
      policy: DEFAULT_POLICY_ENVELOPE,
      contextVersion: 1,
      systemHealth: "NOMINAL",
      selfModel,
      reasoning: createMockReasoningResult(),
    });

    expect(evalResult.isDisqualified).toBe(true);
    expect(evalResult.disqualificationReason).toBe("CAPABILITY_DISALLOWS_VAJRA");
  });

  it("Policy Constraint: Flags requiresApproval when cost exceeds maxAutonomousCostCents", () => {
    const option: DecisionOption = {
      id: "opt-expensive",
      kind: "start_mission",
      intent: "Expensive mission",
      targetCapability: "task.create",
      estimatedCostCents: 50, // exceeds default 10c
      estimatedSteps: 1,
      impactClass: "LOW",
      reversibility: "PARTIALLY_REVERSIBLE",
      requiredEvidence: [],
      rationale: "Testing spend cap",
    };

    const evalResult = evaluator.evaluateOption(option, {
      policy: DEFAULT_POLICY_ENVELOPE,
      contextVersion: 1,
      systemHealth: "NOMINAL",
      selfModel,
      reasoning: createMockReasoningResult(),
    });

    expect(evalResult.isDisqualified).toBe(false);
    expect(evalResult.requiresApproval).toBe(true);
    expect(evalResult.approvalReason).toContain("exceeds autonomous spend cap");
  });

  it("Policy Constraint: Flags requiresApproval when steps exceed maxAutonomousSteps", () => {
    const option: DecisionOption = {
      id: "opt-long",
      kind: "start_mission",
      intent: "Long mission",
      targetCapability: "task.create",
      estimatedCostCents: 5,
      estimatedSteps: 10, // exceeds default 3 steps
      impactClass: "LOW",
      reversibility: "PARTIALLY_REVERSIBLE",
      requiredEvidence: [],
      rationale: "Testing step limit",
    };

    const evalResult = evaluator.evaluateOption(option, {
      policy: DEFAULT_POLICY_ENVELOPE,
      contextVersion: 1,
      systemHealth: "NOMINAL",
      selfModel,
      reasoning: createMockReasoningResult(),
    });

    expect(evalResult.isDisqualified).toBe(false);
    expect(evalResult.requiresApproval).toBe(true);
    expect(evalResult.approvalReason).toContain("exceeds max autonomous steps");
  });

  it("Policy Constraint: Flags requiresApproval for HIGH impact actions", () => {
    const option: DecisionOption = {
      id: "opt-high-impact",
      kind: "start_mission",
      intent: "High impact mission",
      targetCapability: "task.create",
      estimatedCostCents: 1,
      estimatedSteps: 1,
      impactClass: "HIGH",
      reversibility: "PARTIALLY_REVERSIBLE",
      requiredEvidence: [],
      rationale: "Testing high impact",
    };

    const evalResult = evaluator.evaluateOption(option, {
      policy: DEFAULT_POLICY_ENVELOPE,
      contextVersion: 1,
      systemHealth: "NOMINAL",
      selfModel,
      reasoning: createMockReasoningResult(),
    });

    expect(evalResult.requiresApproval).toBe(true);
  });

  it("Evaluation Factors: Flags requiresApproval when epistemic confidence is below threshold", () => {
    const option: DecisionOption = {
      id: "opt-low-conf",
      kind: "start_mission",
      intent: "Uncertain mission",
      targetCapability: "task.create",
      estimatedCostCents: 1,
      estimatedSteps: 1,
      impactClass: "LOW",
      reversibility: "PARTIALLY_REVERSIBLE",
      requiredEvidence: [],
      rationale: "Testing confidence threshold",
    };

    const reasoning = createMockReasoningResult({
      hypotheses: [
        {
          id: "hyp-low",
          description: "Low confidence hypothesis",
          confidence: 0.65, // below 0.85
          supportingEvidenceIds: [],
        },
      ],
    });

    const evalResult = evaluator.evaluateOption(option, {
      policy: DEFAULT_POLICY_ENVELOPE,
      contextVersion: 1,
      systemHealth: "NOMINAL",
      selfModel,
      reasoning,
    });

    expect(evalResult.requiresApproval).toBe(true);
    expect(evalResult.approvalReason).toContain("below policy threshold");
  });
});
