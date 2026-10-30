import { describe, it, expect, beforeEach } from "vitest";
import { ReasoningContextBuilder } from "../../../src/vajra/reasoning/context-builder";
import { SelfModel } from "../../../src/vajra/self-model/self-model";
import { InMemoryGenesisAdapter } from "../../../src/vajra/boundaries/genesis-port";
import { createStimulus } from "../../../src/vajra/types/stimulus";
import { createBelief } from "../../../src/vajra/types/belief";
import { createObservation } from "../../../src/contracts/events/observation";

describe("ReasoningContextBuilder", () => {
  let selfModel: SelfModel;
  let genesisPort: InMemoryGenesisAdapter;
  let builder: ReasoningContextBuilder;

  beforeEach(() => {
    selfModel = new SelfModel();
    genesisPort = new InMemoryGenesisAdapter();
    builder = new ReasoningContextBuilder(selfModel, genesisPort);
  });

  it("builds a deterministically sorted context snapshot", async () => {
    // Register capabilities out of order
    selfModel.registerCapability({
      name: "zebra_capability",
      kind: "Query",
      owner: "AKIRA_OS",
      isAvailable: true,
      allowVajra: true,
      limitations: { isReadOnly: true, isIdempotent: true, costClass: "FREE", activationTier: 1, requiresApproval: false },
    });
    selfModel.registerCapability({
      name: "alpha_capability",
      kind: "Command",
      owner: "AKIRA_OS",
      isAvailable: true,
      allowVajra: true,
      limitations: { isReadOnly: false, isIdempotent: false, costClass: "STANDARD", activationTier: 2, requiresApproval: true },
    });

    const b2 = createBelief({ id: "b-02", proposition: "build compiles cleanly", confidence: 0.9 });
    const b1 = createBelief({ id: "b-01", proposition: "project clean build", confidence: 0.8 });

    const obs2 = createObservation({
      producer: "HANDS",
      subject: "terminal",
      payload: "compilation success",
      confidence: 1.0,
      provenance: "terminal capture",
      correlation: { requestId: "r-1", correlationId: "c-1", invocationId: "i-1" },
    });
    const obs1 = createObservation({
      producer: "GENESIS",
      subject: "memory",
      payload: "clean build was verified",
      confidence: 1.0,
      provenance: "memory replay",
      correlation: { requestId: "r-1", correlationId: "c-1", invocationId: "i-1" },
    });

    const stimulus = createStimulus({
      id: "stim-build",
      kind: "human_prompt",
      source: "chat",
      payload: "run project clean build",
      correlation: { requestId: "r-1", correlationId: "c-1", invocationId: "i-1" },
    });

    const context = await builder.buildContext(
      stimulus,
      stimulus.correlation,
      [b2, b1],
      [obs2, obs1],
    );

    // Capabilities sorted alphabetically
    expect(context.availableCapabilities[0].name).toBe("alpha_capability");
    expect(context.availableCapabilities[1].name).toBe("zebra_capability");

    // Beliefs sorted by ID
    expect(context.relevantBeliefs[0].id).toBe("b-01");
    expect(context.relevantBeliefs[1].id).toBe("b-02");

    // Observations sorted by ID
    expect(context.recentObservations[0].id.localeCompare(context.recentObservations[1].id)).toBeLessThanOrEqual(0);

    // Context version captured
    expect(context.contextVersion).toBe(selfModel.getOperationalContext().version);
  });

  // Scenario 8: GENESIS retrieval remains behind IGenesisPort with provenance preserved
  it("Scenario 8: retrieves memories via IGenesisPort and preserves provenance", async () => {
    genesisPort.setMemories([
      { id: "mem-01", content: "Architecture reports preference", relevance: 0.95 },
      { id: "mem-02", content: "Quarterly reports archive", relevance: 0.85 },
    ]);

    const stimulus = createStimulus({
      id: "stim-report",
      kind: "human_prompt",
      source: "chat",
      payload: "reports",
      correlation: { requestId: "r-1", correlationId: "c-1", invocationId: "i-1" },
    });

    const context = await builder.buildContext(stimulus, stimulus.correlation);

    expect(context.genesisContext).toBeDefined();
    expect(context.genesisContext?.memories.length).toBe(2);
    expect(context.genesisContext?.memories[0].id).toBe("mem-01");
    expect(context.genesisContext?.identityTraits.preferredTone).toBe("concise");
  });

  it("enforces resource budget and prunes low-relevance memories when payload exceeds budget", async () => {
    const tightBuilder = new ReasoningContextBuilder(selfModel, genesisPort, undefined, {
      maxPayloadBytes: 800, // artificially small budget to trigger pruning
    });

    genesisPort.setMemories([
      { id: "mem-01", content: "Very long memory entry content that consumes lots of space in the JSON payload AAAAAAAAAAAAAAAAAAAAAA", relevance: 0.9 },
      { id: "mem-02", content: "Another very long memory entry content BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", relevance: 0.8 },
      { id: "mem-03", content: "Third memory entry content CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC", relevance: 0.7 },
      { id: "mem-04", content: "Fourth memory entry content DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD", relevance: 0.6 },
    ]);

    const stimulus = createStimulus({
      id: "stim-tight",
      kind: "human_prompt",
      source: "chat",
      payload: "test budget",
      correlation: { requestId: "r-1", correlationId: "c-1", invocationId: "i-1" },
    });

    const context = await tightBuilder.buildContext(stimulus, stimulus.correlation);

    // Should have pruned memories down to max 2
    expect(context.genesisContext?.memories.length).toBeLessThanOrEqual(2);
  });
});
