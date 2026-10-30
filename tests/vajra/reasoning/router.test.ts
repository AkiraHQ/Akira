import { describe, it, expect, beforeEach } from "vitest";
import { AdaptiveStrategyRouter } from "../../../src/vajra/reasoning/router";
import { DeterministicPolicyStrategy } from "../../../src/vajra/reasoning/strategies/deterministic-strategy";
import { EvidenceContradictionStrategy } from "../../../src/vajra/reasoning/strategies/evidence-contradiction-strategy";
import { ModelAssistedReasoningStrategy } from "../../../src/vajra/reasoning/strategies/model-assisted-strategy";
import { MockModelCoprocessorAdapter } from "../../../src/vajra/boundaries/model-coprocessor-port";
import { ReasoningContext, ProblemClass } from "../../../src/vajra/reasoning/types";
import { DEFAULT_POLICY_ENVELOPE } from "../../../src/vajra/types/policy";
import { createBelief } from "../../../src/vajra/types/belief";

function createMockContext(overrides?: Partial<ReasoningContext>): ReasoningContext {
  return {
    stimulus: {
      id: "stim-01",
      kind: "human_prompt",
      payload: "check project status",
      correlation: { requestId: "req-1", correlationId: "corr-1", invocationId: "inv-1" },
      timestamp: new Date().toISOString(),
    },
    operationalContext: {
      currentFocus: "idle",
      mode: "REQUEST_DRIVEN",
      humanPresence: "ENGAGED",
      systemHealthStatus: "NOMINAL",
      version: 1,
      updatedAt: new Date().toISOString(),
    },
    activeMission: null,
    relevantBeliefs: [],
    recentObservations: [],
    availableCapabilities: [],
    selfModelLimits: {
      isDegraded: false,
      degradedReasons: [],
      knownUnknowns: [],
      policyEnvelope: DEFAULT_POLICY_ENVELOPE,
    },
    contextVersion: 1,
    assembledAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("AdaptiveStrategyRouter", () => {
  let router: AdaptiveStrategyRouter;
  let mockCoprocessor: MockModelCoprocessorAdapter;

  beforeEach(() => {
    router = new AdaptiveStrategyRouter();
    mockCoprocessor = new MockModelCoprocessorAdapter();

    router.registerStrategy(new DeterministicPolicyStrategy());
    router.registerStrategy(new EvidenceContradictionStrategy());
    router.registerStrategy(new ModelAssistedReasoningStrategy(mockCoprocessor));
  });

  it("selects Tier 1 for POLICY_CONFORMANCE (health CRITICAL or simple stimulus)", () => {
    const ctx = createMockContext({
      operationalContext: {
        currentFocus: "idle",
        mode: "REQUEST_DRIVEN",
        humanPresence: "ENGAGED",
        systemHealthStatus: "CRITICAL",
        version: 1,
        updatedAt: new Date().toISOString(),
      },
    });

    const problemClass = router.classifyProblem(ctx);
    expect(problemClass).toBe("POLICY_CONFORMANCE");

    const selection = router.selectStrategy(ctx, problemClass);
    expect(selection).not.toBeNull();
    expect(selection?.strategy.tier).toBe(1);
    expect(selection?.intendedTier).toBe(1);
  });

  it("selects Tier 2 for OBSERVATION_CONSISTENCY when contradictions exist", () => {
    const contradictedBelief = createBelief({
      id: "b-1",
      proposition: "tests are passing",
      confidence: 0.9,
      verificationState: "CONTRADICTED",
      contradictingEvidenceIds: ["obs-failed"],
    });

    const ctx = createMockContext({
      relevantBeliefs: [contradictedBelief],
    });

    const problemClass = router.classifyProblem(ctx);
    expect(problemClass).toBe("OBSERVATION_CONSISTENCY");

    const selection = router.selectStrategy(ctx, problemClass);
    expect(selection).not.toBeNull();
    expect(selection?.strategy.tier).toBe(2);
    expect(selection?.intendedTier).toBe(2);
  });

  it("selects Tier 3 for AMBIGUOUS_INTENT_INTERPRETATION", () => {
    const ctx = createMockContext({
      stimulus: {
        id: "stim-ambiguous",
        kind: "human_prompt",
        payload: "I need to completely reorganize our architectural database schemas and review tests",
        correlation: { requestId: "req-1", correlationId: "corr-1", invocationId: "inv-1" },
        timestamp: new Date().toISOString(),
      },
      selfModelLimits: {
        isDegraded: false,
        degradedReasons: [],
        knownUnknowns: ["user_intent_scope", "target_database"],
        policyEnvelope: DEFAULT_POLICY_ENVELOPE,
      },
    });

    const problemClass = router.classifyProblem(ctx);
    expect(problemClass).toBe("AMBIGUOUS_INTENT_INTERPRETATION");

    const selection = router.selectStrategy(ctx, problemClass);
    expect(selection).not.toBeNull();
    expect(selection?.strategy.tier).toBe(3);
    expect(selection?.intendedTier).toBe(3);
  });

  // Scenario 1: Tier 3 unavailable + Tier 2 capable -> Tier 2 used (DEGRADED)
  it("Scenario 1: falls back to Tier 2 when Tier 3 fails and Tier 2 is capable", () => {
    const ctx = createMockContext();
    // OBSERVATION_CONSISTENCY can be handled by Tier 2
    const fallback = router.findFallbackStrategy(ctx, "OBSERVATION_CONSISTENCY", 3);
    expect(fallback).not.toBeNull();
    expect(fallback?.fallbackTier).toBe(2);
    expect(fallback?.strategy.id).toBe("EvidenceContradictionStrategy");
  });

  // Scenario 2: Tier 3 unavailable + Tier 2 incapable -> INCONCLUSIVE (never fake Tier 1 success)
  it("Scenario 2: returns null (INCONCLUSIVE) when Tier 3 fails and neither Tier 2 nor Tier 1 is capable of AMBIGUOUS_INTENT_INTERPRETATION", () => {
    const ctx = createMockContext();
    const fallback = router.findFallbackStrategy(ctx, "AMBIGUOUS_INTENT_INTERPRETATION", 3);

    // Neither EvidenceContradictionStrategy nor DeterministicPolicyStrategy declares AMBIGUOUS_INTENT_INTERPRETATION
    expect(fallback).toBeNull();
  });

  // Scenario 3: Tier 2 unavailable + Tier 1 incapable -> INCONCLUSIVE
  it("Scenario 3: returns null (INCONCLUSIVE) when Tier 2 fails and Tier 1 is incapable of OBSERVATION_CONSISTENCY", () => {
    const ctx = createMockContext();
    const fallback = router.findFallbackStrategy(ctx, "OBSERVATION_CONSISTENCY", 2);

    // DeterministicPolicyStrategy only handles POLICY_CONFORMANCE
    expect(fallback).toBeNull();
  });
});
