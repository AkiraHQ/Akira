import { describe, it, expect } from "vitest";
import { EvidenceContradictionStrategy } from "../../../src/vajra/reasoning/strategies/evidence-contradiction-strategy";
import { ReasoningContext } from "../../../src/vajra/reasoning/types";
import { DEFAULT_POLICY_ENVELOPE } from "../../../src/vajra/types/policy";
import { createBelief } from "../../../src/vajra/types/belief";
import { createObservation } from "../../../src/contracts/events/observation";

function createMockContext(overrides?: Partial<ReasoningContext>): ReasoningContext {
  return {
    stimulus: {
      id: "stim-01",
      kind: "human_prompt",
      payload: "check consistency",
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

describe("EvidenceContradictionStrategy (Tier 2)", () => {
  const strategy = new EvidenceContradictionStrategy();
  const correlation = { requestId: "req-1", correlationId: "corr-1", invocationId: "inv-1" };

  it("declares capability for OBSERVATION_CONSISTENCY and POLICY_CONFORMANCE", () => {
    expect(strategy.tier).toBe(2);
    expect(strategy.capabilities.supportedProblemClasses).toContain("OBSERVATION_CONSISTENCY");
    expect(strategy.capabilities.detectsContradictions).toBe(true);
  });

  // Scenario 11: Contradiction detection produces epistemic evidence, not an automatic operational decision
  it("Scenario 11: produces epistemic evidence (ContradictionRecord, ProposedBeliefUpdate) without deciding or executing", async () => {
    const belief = createBelief({
      id: "b-node-version",
      proposition: "node version is 20+",
      confidence: 0.9,
    });

    const contradictionObs = createObservation({
      producer: "HANDS · shell",
      subject: "node_runtime",
      payload: "error: node version mismatch detected (found v18.12.0)",
      confidence: 1.0,
      provenance: "node -v command output",
      correlation: { requestId: "req-1", correlationId: "corr-1", invocationId: "inv-obs-1" },
    });

    const ctx = createMockContext({
      relevantBeliefs: [belief],
      recentObservations: [contradictionObs],
    });

    const result = await strategy.execute(ctx, "OBSERVATION_CONSISTENCY", correlation);
    expect(result.ok).toBe(true);

    if (result.ok) {
      const output = result.value;

      // 1. Contradiction flagged
      expect(output.contradictions.length).toBe(1);
      expect(output.contradictions[0].proposition).toBe("node version is 20+");
      expect(output.contradictions[0].severity).toBe("CRITICAL");

      // 2. Proposed belief update (c -> 0.0, CONTRADICTED)
      expect(output.proposedBeliefUpdates.length).toBe(1);
      expect(output.proposedBeliefUpdates[0].proposedConfidence).toBe(0.0);
      expect(output.proposedBeliefUpdates[0].proposedVerificationState).toBe("CONTRADICTED");

      // 3. Uncertainty escalated
      expect(output.uncertaintyLevel).toBe("CRITICAL");

      // 4. Verification suggestion generated
      expect(output.verificationSuggestions.length).toBeGreaterThan(0);

      // 5. Invariant: Produces epistemic evidence, NOT operational decisions or actions
      expect((output as any).candidateActions).toBeUndefined();
      expect((output as any).selectedAction).toBeUndefined();
      expect((output as any).executiveAction).toBeUndefined();
    }
  });

  it("yields LOW uncertainty and consistent hypothesis when no contradictions exist", async () => {
    const belief = createBelief({
      id: "b-clean-git",
      proposition: "git tree is clean",
      confidence: 0.9,
    });

    const consistentObs = createObservation({
      producer: "HANDS · git",
      subject: "git_status",
      payload: "working tree clean, nothing to commit",
      confidence: 1.0,
      provenance: "git status output",
      correlation: { requestId: "req-1", correlationId: "corr-1", invocationId: "inv-obs-2" },
    });

    const ctx = createMockContext({
      relevantBeliefs: [belief],
      recentObservations: [consistentObs],
    });

    const result = await strategy.execute(ctx, "OBSERVATION_CONSISTENCY", correlation);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.contradictions.length).toBe(0);
      expect(result.value.uncertaintyLevel).toBe("LOW");
      expect(result.value.hypotheses.some(h => h.id === "hyp-epistemic-consistent")).toBe(true);
    }
  });
});
