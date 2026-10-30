import { describe, it, expect } from "vitest";
import {
  MockModelCoprocessorAdapter,
  AiProviderCoprocessorAdapter,
} from "../../../src/vajra/boundaries/model-coprocessor-port";
import { ModelReasoningPayloadSchema, ModelReasoningPayload } from "../../../src/vajra/reasoning/types";
import { AIProvider } from "../../../src/genesis/context/ai/provider-interface";

describe("Model Coprocessor Boundary", () => {
  const correlation = { requestId: "r-1", correlationId: "c-1", invocationId: "i-1" };

  it("successfully parses and validates structured JSON response via Zod", async () => {
    const mock = new MockModelCoprocessorAdapter();
    mock.setResponseGenerator<ModelReasoningPayload>(() => ({
      interpretedSituation: "User requested automated release verification",
      hypotheses: [
        {
          id: "hyp-release-01",
          description: "All test suites passing and git status clean",
          confidence: 0.95,
          supportingEvidenceIds: ["obs-git", "obs-tests"],
        },
      ],
      possibleConsequences: ["Ready for commit tag"],
      uncertaintyLevel: "LOW",
      unresolvedQuestions: [],
      verificationSuggestions: ["Run final linter pass"],
      rationale: "Prerequisites verified deterministically.",
    }));

    const result = await mock.invokeStructuredCoprocessor({
      systemPrompt: "You are the reasoning coprocessor",
      structuredContext: { test: true },
      outputSchema: ModelReasoningPayloadSchema,
      temperature: 0.2,
      maxTokens: 1000,
      timeoutMs: 3000,
      correlation,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.parsed.interpretedSituation).toBe("User requested automated release verification");
      expect(result.value.parsed.hypotheses.length).toBe(1);
      expect(result.value.costCents).toBeGreaterThanOrEqual(0);
    }
  });

  it("rejects malformed responses failing Zod validation", async () => {
    const mock = new MockModelCoprocessorAdapter();
    mock.setResponseGenerator(() => ({
      // Missing interpretedSituation and hypotheses
      invalidProperty: "hello",
    }));

    const result = await mock.invokeStructuredCoprocessor({
      systemPrompt: "You are the reasoning coprocessor",
      structuredContext: { test: true },
      outputSchema: ModelReasoningPayloadSchema,
      temperature: 0.2,
      maxTokens: 1000,
      timeoutMs: 3000,
      correlation,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Mock validation error");
    }
  });

  it("enforces timeout and fails gracefully when deadline exceeded", async () => {
    const mock = new MockModelCoprocessorAdapter();
    mock.setShouldTimeout(true);

    const result = await mock.invokeStructuredCoprocessor({
      systemPrompt: "You are the reasoning coprocessor",
      structuredContext: { test: true },
      outputSchema: ModelReasoningPayloadSchema,
      temperature: 0.2,
      maxTokens: 1000,
      timeoutMs: 100,
      correlation,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("timed out");
    }
  });

  // Scenario 9: LLM cannot select its own strategy tier or alter authority
  it("Scenario 9: AiProviderCoprocessorAdapter strips markdown and strictly validates against schema", async () => {
    const fakeProvider: AIProvider = {
      name: "fake-llm",
      async generateContent() {
        return {
          responseId: "resp-1",
          provider: "fake-llm",
          model: "fake-v1",
          // Simulating LLM attempting to declare itself as authority or include extra executable fields
          content: "```json\n" + JSON.stringify({
            interpretedSituation: "Ambiguous user query",
            hypotheses: [
              {
                id: "h-1",
                description: "User wants to format drive",
                confidence: 0.5,
                supportingEvidenceIds: [],
              },
            ],
            possibleConsequences: ["Potential data loss"],
            uncertaintyLevel: "HIGH",
            unresolvedQuestions: ["Which drive?"],
            verificationSuggestions: ["Confirm with human"],
            rationale: "Requires clarification",
            // Attempted injection of tier selection or execution command
            selectedTier: 1,
            executeCommand: "rm -rf /",
          }) + "\n```",
          finishReason: "stop",
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          timestamp: new Date().toISOString(),
        };
      },
    };

    const adapter = new AiProviderCoprocessorAdapter(fakeProvider);
    const result = await adapter.invokeStructuredCoprocessor({
      systemPrompt: "System instruction",
      structuredContext: {},
      outputSchema: ModelReasoningPayloadSchema,
      temperature: 0.1,
      maxTokens: 500,
      timeoutMs: 2000,
      correlation,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Invariant: Injected properties are stripped or not recognized by the typed contract
      expect((result.value.parsed as any).selectedTier).toBeUndefined();
      expect((result.value.parsed as any).executeCommand).toBeUndefined();
      expect(result.value.parsed.interpretedSituation).toBe("Ambiguous user query");
    }
  });
});
