import { describe, it, expect } from "vitest";
import { DecisionOptionFormulator } from "../../../src/vajra/decision/option-formulator";
import { DEFAULT_POLICY_ENVELOPE } from "../../../src/vajra/types/policy";
import { createInitialOperationalContext } from "../../../src/vajra/types/operational-context";
import {
  createMockReasoningResult,
  createMockSelfModel,
} from "./fixtures";

describe("DecisionOptionFormulator (Phase 5 §9)", () => {
  const formulator = new DecisionOptionFormulator();
  const selfModel = createMockSelfModel();
  const context = createInitialOperationalContext();
  const policy = DEFAULT_POLICY_ENVELOPE;

  it("Formulates deterministic candidates for START_MISSION", () => {
    const reasoning = createMockReasoningResult();
    const options = formulator.formulateOptions("START_MISSION", reasoning, context, selfModel, policy);

    expect(options.length).toBeGreaterThanOrEqual(1);
    const primary = options.find((o) => o.kind === "start_mission");
    expect(primary).toBeDefined();
    expect(primary?.targetCapability).toBe("task.create");
  });

  it("Formulates deterministic candidates for REQUEST_CLARIFICATION", () => {
    const reasoning = createMockReasoningResult({
      unresolvedQuestions: ["Which project should be updated?"],
    });
    const options = formulator.formulateOptions("REQUEST_CLARIFICATION", reasoning, context, selfModel, policy);

    const clarifyOption = options.find((o) => o.kind === "request_clarification");
    expect(clarifyOption).toBeDefined();
    expect((clarifyOption?.payload as any)?.unresolvedQuestions).toContain("Which project should be updated?");
  });

  it("Formulates deterministic candidates for REQUEST_VERIFICATION", () => {
    const reasoning = createMockReasoningResult({
      verificationSuggestions: ["Inspect local filesystem cache"],
    });
    const options = formulator.formulateOptions("REQUEST_VERIFICATION", reasoning, context, selfModel, policy);

    const verifyOption = options.find((o) => o.kind === "request_verification");
    expect(verifyOption).toBeDefined();
    expect((verifyOption?.payload as any)?.verificationSuggestions).toContain("Inspect local filesystem cache");
  });

  describe("OptionSanitizer for External Model Proposals", () => {
    it("Discards model proposal targeting non-existent capability", () => {
      const proposal = {
        id: "prop-01",
        kind: "start_mission",
        intent: "Do something outside capability set",
        targetCapability: "imaginary.tool",
      };

      const sanitized = formulator.sanitizeModelProposal(proposal, selfModel, policy);
      expect(sanitized).toBeNull();
    });

    it("Discards model proposal targeting prohibited capability", () => {
      const proposal = {
        id: "prop-02",
        kind: "start_mission",
        intent: "Wipe everything",
        targetCapability: "system.db.wipe",
      };

      const sanitized = formulator.sanitizeModelProposal(proposal, selfModel, policy);
      expect(sanitized).toBeNull();
    });

    it("Accepts and sanitizes valid model proposal", () => {
      const proposal = {
        id: "prop-03",
        kind: "start_mission",
        intent: "Create task from proposal",
        targetCapability: "task.create",
        estimatedCostCents: 2,
        estimatedSteps: 2,
        impactClass: "LOW",
        reversibility: "PARTIALLY_REVERSIBLE",
      };

      const sanitized = formulator.sanitizeModelProposal(proposal, selfModel, policy);
      expect(sanitized).not.toBeNull();
      expect(sanitized?.targetCapability).toBe("task.create");
      expect(sanitized?.intent).toBe("Create task from proposal");
    });
  });
});
