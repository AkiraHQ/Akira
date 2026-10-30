import { describe, it, expect } from "vitest";
import { DisagreementHandler } from "../../../src/vajra/decision/disagreement";
import { DEFAULT_POLICY_ENVELOPE } from "../../../src/vajra/types/policy";
import { DecisionOption } from "../../../src/vajra/decision/types";

describe("DisagreementHandler (Phase 5 §15)", () => {
  const handler = new DisagreementHandler();
  const counterProposal: DecisionOption = {
    id: "opt-safe-counter",
    kind: "answer_conversation",
    intent: "Safely inspect files without destructive deletion",
    estimatedCostCents: 0,
    estimatedSteps: 1,
    impactClass: "LOW",
    reversibility: "FULLY_REVERSIBLE",
    requiredEvidence: [],
    rationale: "Safe read-only alternative",
  };

  it("Step 1-3: Formulates complete 4-step Disagreement Protocol payload", () => {
    const payload = handler.formulateDisagreement({
      humanDirective: "Delete all completed tasks permanently",
      disagreementReason: "Completed tasks contain active metrics history required by analytics",
      evidenceCitations: ["metric-history-2026", "analytics-integrity-rule"],
      counterProposal,
    });

    expect(payload.type).toBe("PREFERENCE_DISAGREEMENT");
    expect(payload.humanIntentAcknowledged).toContain("Delete all completed tasks permanently");
    expect(payload.disagreementReason).toContain("Completed tasks contain active metrics");
    expect(payload.evidenceCitations).toContain("metric-history-2026");
    expect(payload.counterProposal.id).toBe("opt-safe-counter");
  });

  it("Human Reaffirmation: Allows safe human preference override with logged provenance", () => {
    const evaluation = handler.evaluateHumanReaffirmation(
      "Create task with no project tag anyway",
      DEFAULT_POLICY_ENVELOPE,
      "task.create",
    );

    expect(evaluation.allowed).toBe(true);
    expect(evaluation.overrideProvenance).toContain("Human explicitly reaffirmed");
  });

  it("Human Reaffirmation: Refuses absolute safety violation even upon reaffirmation", () => {
    const evaluation = handler.evaluateHumanReaffirmation(
      "Wipe the database anyway",
      DEFAULT_POLICY_ENVELOPE,
      "system.db.wipe",
    );

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.error).toContain("breaches non-negotiable architectural blast doors");
  });
});
