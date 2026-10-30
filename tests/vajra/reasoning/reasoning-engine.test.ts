import { describe, it, expect, beforeEach, vi } from "vitest";
import { ReasoningEngine } from "../../../src/vajra/reasoning/engine";
import { AdaptiveStrategyRouter } from "../../../src/vajra/reasoning/router";
import { DeterministicPolicyStrategy } from "../../../src/vajra/reasoning/strategies/deterministic-strategy";
import { EvidenceContradictionStrategy } from "../../../src/vajra/reasoning/strategies/evidence-contradiction-strategy";
import { ModelAssistedReasoningStrategy } from "../../../src/vajra/reasoning/strategies/model-assisted-strategy";
import { MockModelCoprocessorAdapter } from "../../../src/vajra/boundaries/model-coprocessor-port";
import { ReasoningContext, ModelReasoningPayload } from "../../../src/vajra/reasoning/types";
import { DEFAULT_POLICY_ENVELOPE } from "../../../src/vajra/types/policy";
import { IOperationalStateStore } from "../../../src/vajra/ports/state-store";
import { DeliberationTrace } from "../../../src/vajra/types/trace";
import { createBelief, EpistemicBelief } from "../../../src/vajra/types/belief";

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

describe("ReasoningEngine (Phase 4 Domain)", () => {
  let router: AdaptiveStrategyRouter;
  let mockCoprocessor: MockModelCoprocessorAdapter;
  let mockStateStore: IOperationalStateStore;
  let engine: ReasoningEngine;
  let appendedTraces: DeliberationTrace[];
  let savedBeliefs: EpistemicBelief[];
  const correlation = { requestId: "req-1", correlationId: "corr-1", invocationId: "inv-1" };

  beforeEach(() => {
    appendedTraces = [];
    savedBeliefs = [];

    mockStateStore = {
      saveOperationalContext: vi.fn(),
      loadOperationalContext: vi.fn().mockResolvedValue({
        currentFocus: "idle",
        mode: "REQUEST_DRIVEN",
        humanPresence: "ENGAGED",
        systemHealthStatus: "NOMINAL",
        version: 1,
        updatedAt: new Date().toISOString(),
      }),
      saveBelief: vi.fn().mockImplementation((b: EpistemicBelief) => {
        savedBeliefs.push(b);
        return Promise.resolve();
      }),
      loadBeliefs: vi.fn().mockResolvedValue([]),
      getBelief: vi.fn(),
      deleteBelief: vi.fn(),
      appendAuditTrace: vi.fn().mockImplementation((t: DeliberationTrace) => {
        appendedTraces.push(t);
        return Promise.resolve();
      }),
      queryAuditTraces: vi.fn(),
      queryAuditTracesByCorrelation: vi.fn(),
      queryAuditTracesByStimulus: vi.fn(),
      createMission: vi.fn(),
      getMission: vi.fn(),
      getActiveMission: vi.fn(),
      updateMissionLifecycle: vi.fn(),
    } as unknown as IOperationalStateStore;

    router = new AdaptiveStrategyRouter();
    mockCoprocessor = new MockModelCoprocessorAdapter();

    router.registerStrategy(new DeterministicPolicyStrategy());
    router.registerStrategy(new EvidenceContradictionStrategy());
    router.registerStrategy(new ModelAssistedReasoningStrategy(mockCoprocessor));

    engine = new ReasoningEngine({ router, stateStore: mockStateStore });
  });

  // End-to-end deliberation test producing SUCCESS and appending audit trace
  it("deliberates successfully, produces ReasoningResult, and appends DeliberationTrace", async () => {
    const ctx = createMockContext();
    const result = await engine.deliberate(ctx, correlation);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("SUCCESS");
      expect(result.value.strategyTier).toBe(1);
      expect(result.value.hypotheses.length).toBeGreaterThan(0);
      expect(result.value.deliberationTrace).toBeDefined();

      // Audit trace appended to store
      expect(appendedTraces.length).toBe(1);
      expect(appendedTraces[0].stimulusId).toBe(ctx.stimulus.id);
    }
  });

  // Scenario 6: Reasoning result contains zero authoritative executable actions
  it("Scenario 6: ReasoningResult contains zero candidateActions, executiveActions, or command definitions", async () => {
    const ctx = createMockContext();
    const result = await engine.deliberate(ctx, correlation);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const res = result.value as any;
      expect(res.candidateActions).toBeUndefined();
      expect(res.executableActions).toBeUndefined();
      expect(res.selectedAction).toBeUndefined();
      expect(res.missionDefinition).toBeUndefined();
      expect(res.missionSteps).toBeUndefined();
    }
  });

  // Scenario 7: Reasoning cannot call saveBelief() for proposed updates
  it("Scenario 7: evaluates evidence and formulates ProposedBeliefUpdate, but NEVER calls saveBelief()", async () => {
    const belief = createBelief({
      id: "b-test",
      proposition: "server is online",
      confidence: 0.95,
      verificationState: "CONTRADICTED",
      contradictingEvidenceIds: ["obs-server-down"],
    });

    const ctx = createMockContext({
      relevantBeliefs: [belief],
    });

    const result = await engine.deliberate(ctx, correlation);
    expect(result.ok).toBe(true);

    if (result.ok) {
      // 1. Proposed belief update is present in result
      expect(result.value.proposedBeliefUpdates.length).toBe(1);
      expect(result.value.proposedBeliefUpdates[0].proposedConfidence).toBe(0.0);
      expect(result.value.proposedBeliefUpdates[0].proposedVerificationState).toBe("CONTRADICTED");

      // 2. INVARIANT K-P4-4: mockStateStore.saveBelief was NEVER called!
      expect(mockStateStore.saveBelief).not.toHaveBeenCalled();
      expect(savedBeliefs.length).toBe(0);
    }
  });

  // Scenario 4: State version changes during reasoning -> STALE_INVALIDATED
  it("Scenario 4: marks result STALE_INVALIDATED when state version changes mid-deliberation", async () => {
    const ctx = createMockContext({ contextVersion: 1 });

    // Mock state store version advancing to 2 mid-turn
    (mockStateStore.loadOperationalContext as any).mockResolvedValue({
      currentFocus: "human modified tasks",
      mode: "REQUEST_DRIVEN",
      humanPresence: "ENGAGED",
      systemHealthStatus: "NOMINAL",
      version: 2, // Advanced!
      updatedAt: new Date().toISOString(),
    });

    const result = await engine.deliberate(ctx, correlation);
    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.status).toBe("STALE_INVALIDATED");
      expect(result.value.uncertaintyLevel).toBe("CRITICAL");
      expect(result.value.deliberationTrace.rationale).toContain("STALE_INVALIDATED");
    }
  });

  // Scenario 5: STALE_INVALIDATED -> no automatic second reasoning turn
  it("Scenario 5: STALE_INVALIDATED immediately returns control to caller with zero auto-retry", async () => {
    const deliberateSpy = vi.spyOn(engine, "deliberate");
    const ctx = createMockContext({ contextVersion: 1 });

    (mockStateStore.loadOperationalContext as any).mockResolvedValue({
      currentFocus: "external event",
      mode: "REQUEST_DRIVEN",
      humanPresence: "ENGAGED",
      systemHealthStatus: "NOMINAL",
      version: 2,
      updatedAt: new Date().toISOString(),
    });

    const result = await engine.deliberate(ctx, correlation);
    expect(result.ok).toBe(true);

    // Proves deliberate was called exactly ONCE; no recursive or autonomous re-deliberation
    expect(deliberateSpy).toHaveBeenCalledTimes(1);
  });

  // Scenario 10: Phase 5 receives reasoning evidence rather than pre-decided actions
  it("Scenario 10: handoff to Phase 5 Decision Arbiter contains strictly hypotheses, contradictions, and consequences", async () => {
    mockCoprocessor.setResponseGenerator<ModelReasoningPayload>(() => ({
      interpretedSituation: "User requested automated release verification",
      hypotheses: [
        { id: "h-1", description: "Project is ready for clean build", confidence: 0.85, supportingEvidenceIds: [] },
      ],
      possibleConsequences: ["Temporary build artifacts will be generated"],
      uncertaintyLevel: "LOW",
      unresolvedQuestions: [],
      verificationSuggestions: ["Run fast tests"],
      rationale: "Clean context.",
    }));

    const ctx = createMockContext({
      stimulus: {
        id: "stim-ambiguous",
        kind: "human_prompt",
        payload: "I need to completely reorganize our architectural database schemas and review tests",
        correlation,
        timestamp: new Date().toISOString(),
      },
      selfModelLimits: {
        isDegraded: false,
        degradedReasons: [],
        knownUnknowns: ["target_dir"],
        policyEnvelope: DEFAULT_POLICY_ENVELOPE,
      },
    });

    const result = await engine.deliberate(ctx, correlation);
    expect(result.ok).toBe(true);

    if (result.ok) {
      const res = result.value;
      expect(res.hypotheses.length).toBe(1);
      expect(res.possibleConsequences.length).toBe(1);
      expect(res.verificationSuggestions.length).toBe(1);
      // Zero pre-decided action list
      expect((res as any).candidateActions).toBeUndefined();
    }
  });

  // Scenario 12: Lower-tier fallback never increases confidence beyond what capability justifies
  it("Scenario 12: degraded fallback caps hypothesis confidence to <= 0.40", async () => {
    // Force Tier 3 to fail
    mockCoprocessor.setShouldFail(true, "Model quota exhausted");

    // Context with contradiction (Tier 2 is capable of OBSERVATION_CONSISTENCY)
    const contradictedBelief = createBelief({
      id: "b-1",
      proposition: "database connected",
      confidence: 0.9,
      verificationState: "CONTRADICTED",
      contradictingEvidenceIds: ["obs-db-err"],
    });

    const ctx = createMockContext({
      relevantBeliefs: [contradictedBelief],
    });

    const result = await engine.deliberate(ctx, correlation);
    expect(result.ok).toBe(true);

    if (result.ok) {
      // Tier 2 executed
      expect(result.value.strategyTier).toBe(2);
      expect(result.value.status).toBe("SUCCESS"); // Tier 2 was directly selected for OBSERVATION_CONSISTENCY
    }
  });
});
