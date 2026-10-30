import { describe, it, expect } from "vitest";
import { DeterministicPolicyStrategy } from "../../../src/vajra/reasoning/strategies/deterministic-strategy";
import { ReasoningContext } from "../../../src/vajra/reasoning/types";
import { DEFAULT_POLICY_ENVELOPE } from "../../../src/vajra/types/policy";

function createMockContext(overrides?: Partial<ReasoningContext>): ReasoningContext {
  return {
    stimulus: {
      id: "stim-01",
      kind: "human_prompt",
      payload: "test",
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

describe("DeterministicPolicyStrategy (Tier 1)", () => {
  const strategy = new DeterministicPolicyStrategy();
  const correlation = { requestId: "req-1", correlationId: "corr-1", invocationId: "inv-1" };

  it("declares capability for POLICY_CONFORMANCE only", () => {
    expect(strategy.tier).toBe(1);
    expect(strategy.capabilities.supportedProblemClasses).toEqual(["POLICY_CONFORMANCE"]);
    expect(strategy.capabilities.requiresExternalModel).toBe(false);
  });

  it("rejects unsupported problem classes such as AMBIGUOUS_INTENT_INTERPRETATION", async () => {
    const ctx = createMockContext();
    expect(strategy.canHandle(ctx, "AMBIGUOUS_INTENT_INTERPRETATION")).toBe(false);

    const result = await strategy.execute(ctx, "AMBIGUOUS_INTENT_INTERPRETATION", correlation);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("cannot handle problem class");
    }
  });

  it("evaluates CRITICAL health into high uncertainty and halt hypothesis", async () => {
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

    const result = await strategy.execute(ctx, "POLICY_CONFORMANCE", correlation);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.uncertaintyLevel).toBe("CRITICAL");
      expect(result.value.hypotheses.some(h => h.id === "hyp-crit-health")).toBe(true);
    }
  });

  it("evaluates degraded self-model state into warning hypothesis", async () => {
    const ctx = createMockContext({
      selfModelLimits: {
        isDegraded: true,
        degradedReasons: ["Network link down"],
        knownUnknowns: [],
        policyEnvelope: DEFAULT_POLICY_ENVELOPE,
      },
    });

    const result = await strategy.execute(ctx, "POLICY_CONFORMANCE", correlation);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.uncertaintyLevel).toBe("MEDIUM");
      expect(result.value.hypotheses.some(h => h.id === "hyp-degraded-state")).toBe(true);
    }
  });

  it("produces zero candidate actions or executable actions", async () => {
    const ctx = createMockContext();
    const result = await strategy.execute(ctx, "POLICY_CONFORMANCE", correlation);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.value as any).candidateActions).toBeUndefined();
      expect((result.value as any).selectedOption).toBeUndefined();
    }
  });
});
