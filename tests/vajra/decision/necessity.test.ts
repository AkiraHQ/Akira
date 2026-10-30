import { describe, it, expect } from "vitest";
import { DecisionArbiter } from "../../../src/vajra/decision/arbiter";
import { createInitialOperationalContext } from "../../../src/vajra/types/operational-context";
import {
  createMockReasoningResult,
  createMockSelfModel,
  createMockStateStore,
} from "./fixtures";

describe("Decision Necessity Classification (Phase 5 §8)", () => {
  it("Scenario 1: Classifies ANSWER_CONVERSATION for informational human query", async () => {
    const { store } = createMockStateStore();
    const arbiter = new DecisionArbiter(store);
    const selfModel = createMockSelfModel();
    const context = createInitialOperationalContext();

    const reasoning = createMockReasoningResult({
      problemClass: "SYNTHESIS_AND_SUMMARIZATION",
      status: "SUCCESS",
    });

    const result = await arbiter.arbitrate(reasoning, context, selfModel);
    expect(result.ok).toBe(true);
    expect(result.value.kind).toBe("answer_conversation");
  });

  it("Scenario 2: Classifies START_MISSION when operational mode is REQUEST_DRIVEN with active task focus", async () => {
    const { store } = createMockStateStore();
    const arbiter = new DecisionArbiter(store);
    const selfModel = createMockSelfModel();
    const context = {
      ...createInitialOperationalContext(),
      currentFocus: "Reorganize weekly backlog tasks",
    };

    const reasoning = createMockReasoningResult({
      problemClass: "POLICY_CONFORMANCE",
      status: "SUCCESS",
    });

    const result = await arbiter.arbitrate(reasoning, context, selfModel);
    expect(result.ok).toBe(true);
    expect(result.value.kind).toBe("start_mission");
  });

  it("Scenario 3: Classifies WAIT_AND_OBSERVE when system health is CRITICAL", async () => {
    const { store } = createMockStateStore();
    const arbiter = new DecisionArbiter(store);
    const selfModel = createMockSelfModel();
    const context = {
      ...createInitialOperationalContext(),
      systemHealthStatus: "CRITICAL" as const,
      currentFocus: "Reorganize backlog",
    };

    const reasoning = createMockReasoningResult();
    const result = await arbiter.arbitrate(reasoning, context, selfModel);

    expect(result.ok).toBe(true);
    expect(result.value.kind).toBe("wait_and_observe");
  });

  it("Scenario 4: Classifies REQUEST_VERIFICATION when contradictions are present", async () => {
    const { store } = createMockStateStore();
    const arbiter = new DecisionArbiter(store);
    const selfModel = createMockSelfModel();
    const context = createInitialOperationalContext();

    const reasoning = createMockReasoningResult({
      contradictions: [
        {
          proposition: "Database exists",
          conflictingEvidenceIds: ["obs-404"],
          explanation: "File not found",
          severity: "CRITICAL",
        },
      ],
      verificationSuggestions: ["Run file check probe"],
    });

    const result = await arbiter.arbitrate(reasoning, context, selfModel);
    expect(result.ok).toBe(true);
    expect(result.value.kind).toBe("request_verification");
  });

  it("Scenario 5: Classifies REQUEST_CLARIFICATION when reasoning is INCONCLUSIVE or CRITICAL uncertainty", async () => {
    const { store } = createMockStateStore();
    const arbiter = new DecisionArbiter(store);
    const selfModel = createMockSelfModel();
    const context = createInitialOperationalContext();

    const reasoning = createMockReasoningResult({
      status: "INCONCLUSIVE",
      uncertaintyLevel: "CRITICAL",
      unresolvedQuestions: ["What target file should be processed?"],
    });

    const result = await arbiter.arbitrate(reasoning, context, selfModel);
    expect(result.ok).toBe(true);
    expect(result.value.kind).toBe("request_clarification");
    expect(result.value.payload).toHaveProperty("unresolvedQuestions");
  });

  it("Scenario 6: Classifies REJECT_SAFETY_VIOLATION for prohibited directives", async () => {
    const { store } = createMockStateStore();
    const arbiter = new DecisionArbiter(store);
    const selfModel = createMockSelfModel();
    const context = createInitialOperationalContext();

    const reasoning = createMockReasoningResult({
      possibleConsequences: ["Directive requests prohibited database wipe"],
    });

    const result = await arbiter.arbitrate(reasoning, context, selfModel);
    expect(result.ok).toBe(true);
    expect(result.value.kind).toBe("reject_safety_violation");
  });
});
