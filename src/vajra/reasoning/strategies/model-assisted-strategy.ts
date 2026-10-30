import { CorrelationMetadata } from "../../../contracts/results/result";
import { IModelCoprocessorPort } from "../../boundaries/model-coprocessor-port";
import {
  IVajraReasoningStrategy,
  ProblemClass,
  ReasoningContext,
  StrategyCapabilityDeclaration,
  StrategyReasoningOutput,
  ModelReasoningPayloadSchema,
  ModelReasoningPayload,
} from "../types";

/**
 * Tier 3 Reasoning Strategy: Model-Assisted Semantic Reasoning.
 *
 * Characteristics:
 * - Invokes external model coprocessor via IModelCoprocessorPort (Gemini / OpenRouter / local).
 * - Solves AMBIGUOUS_INTENT_INTERPRETATION, CAUSAL_HYPOTHESIS_GENERATION, and SYNTHESIS_AND_SUMMARIZATION.
 * - Gated by strict Zod schema validation (ModelReasoningPayloadSchema).
 * - Invariant: Model responses are untrusted external evidence; coprocessor never decides or executes.
 */
export class ModelAssistedReasoningStrategy implements IVajraReasoningStrategy {
  readonly id = "ModelAssistedReasoningStrategy";
  readonly tier = 3 as const;

  readonly capabilities: StrategyCapabilityDeclaration = Object.freeze({
    supportedProblemClasses: Object.freeze([
      "AMBIGUOUS_INTENT_INTERPRETATION" as ProblemClass,
      "CAUSAL_HYPOTHESIS_GENERATION" as ProblemClass,
      "SYNTHESIS_AND_SUMMARIZATION" as ProblemClass,
    ]),
    requiredEvidenceTypes: Object.freeze(["stimulus", "context"]),
    maxComplexity: "HIGH",
    requiresExternalModel: true,
    handlesUncertainty: true,
    producesHypotheses: true,
    detectsContradictions: false,
    supportsDegradedOperation: false,
  });

  constructor(
    private readonly coprocessorPort: IModelCoprocessorPort,
    private readonly defaultTimeoutMs: number = 5000,
  ) {}

  canHandle(_context: ReasoningContext, problemClass: ProblemClass): boolean {
    return this.capabilities.supportedProblemClasses.includes(problemClass);
  }

  async execute(
    context: ReasoningContext,
    problemClass: ProblemClass,
    correlation: CorrelationMetadata,
  ): Promise<{ ok: true; value: StrategyReasoningOutput } | { ok: false; error: string }> {
    if (!this.canHandle(context, problemClass)) {
      return {
        ok: false,
        error: `${this.id} cannot handle problem class '${problemClass}'. Supported: ${this.capabilities.supportedProblemClasses.join(", ")}`,
      };
    }

    const systemPrompt = [
      "You are the specialized epistemic coprocessor for the VAJRA brain.",
      "Your sole responsibility is to analyze the operational situation, interpret intent, synthesize plausible hypotheses, and identify information gaps or uncertainties.",
      "",
      "CRITICAL ARCHITECTURAL CONSTRAINTS:",
      "1. You are NOT an action executor. Do NOT propose executable tool commands or concrete system actions.",
      "2. Formulate hypotheses: 'What appears to be happening?', 'What explanations are plausible?', 'What consequences might follow?'.",
      "3. Highlight uncertainties and unresolved questions.",
      "4. You must conform strictly to the required JSON schema.",
    ].join("\n");

    const structuredContext = {
      problemClass,
      stimulus: {
        id: context.stimulus.id,
        kind: context.stimulus.kind,
        payload: context.stimulus.payload,
      },
      operationalContext: {
        focus: context.operationalContext.currentFocus,
        mode: context.operationalContext.mode,
        health: context.operationalContext.systemHealthStatus,
      },
      relevantBeliefs: context.relevantBeliefs.map(b => ({
        id: b.id,
        proposition: b.proposition,
        confidence: b.confidence,
        state: b.verificationState,
      })),
      recentObservations: context.recentObservations.slice(0, 10).map(o => ({
        id: o.id,
        producer: o.producer,
        subject: o.subject,
        confidence: o.confidence,
      })),
      genesisMemories: context.genesisContext?.memories.slice(0, 5).map(m => ({
        id: m.id,
        content: m.content,
        relevance: m.relevance,
      })),
      knownUnknowns: context.selfModelLimits.knownUnknowns,
    };

    const coprocessorResult = await this.coprocessorPort.invokeStructuredCoprocessor<ModelReasoningPayload>({
      systemPrompt,
      structuredContext,
      outputSchema: ModelReasoningPayloadSchema,
      temperature: 0.2,
      maxTokens: 1500,
      timeoutMs: this.defaultTimeoutMs,
      correlation,
    });

    if (!coprocessorResult.ok) {
      return {
        ok: false,
        error: `Model coprocessor failed: ${coprocessorResult.error}`,
      };
    }

    const payload = coprocessorResult.value.parsed;

    const output: StrategyReasoningOutput = {
      strategyId: this.id,
      problemClass,
      hypotheses: Object.freeze(
        payload.hypotheses.map(h =>
          Object.freeze({
            id: h.id,
            description: h.description,
            confidence: h.confidence,
            supportingEvidenceIds: Object.freeze([...h.supportingEvidenceIds]),
          }),
        ),
      ),
      proposedBeliefUpdates: Object.freeze([]),
      contradictions: Object.freeze([]),
      possibleConsequences: Object.freeze([...payload.possibleConsequences]),
      uncertaintyLevel: payload.uncertaintyLevel,
      unresolvedQuestions: Object.freeze([...payload.unresolvedQuestions]),
      verificationSuggestions: Object.freeze([...payload.verificationSuggestions]),
      rationale: `${payload.interpretedSituation}. ${payload.rationale}`,
      coprocessorMetadata: {
        model: coprocessorResult.value.model,
        provider: coprocessorResult.value.provider,
        promptTokens: coprocessorResult.value.promptTokens,
        completionTokens: coprocessorResult.value.completionTokens,
        costCents: coprocessorResult.value.costCents,
        latencyMs: coprocessorResult.value.latencyMs,
      },
    };

    return { ok: true, value: output };
  }
}
