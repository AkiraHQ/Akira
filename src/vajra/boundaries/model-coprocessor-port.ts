import { z } from "zod";
import { Result, CorrelationMetadata } from "../../contracts/results/result";
import { AIProvider } from "../../genesis/context/ai/provider-interface";

export interface ModelCoprocessorRequest<TResponse> {
  readonly systemPrompt: string;
  readonly structuredContext: unknown;
  readonly outputSchema: z.ZodSchema<TResponse>;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly correlation: CorrelationMetadata;
}

export interface ModelCoprocessorResponse<TResponse> {
  readonly parsed: TResponse;
  readonly rawText: string;
  readonly model: string;
  readonly provider: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costCents: number;
  readonly latencyMs: number;
}

/**
 * Architectural Port for external Model Coprocessor invocation.
 *
 * Invariant: Model responses are untrusted external evidence (Contract K4).
 * All responses are strictly gated by Zod schema validation.
 */
export interface IModelCoprocessorPort {
  invokeStructuredCoprocessor<TResponse>(
    request: ModelCoprocessorRequest<TResponse>,
  ): Promise<Result<ModelCoprocessorResponse<TResponse>, string>>;
}

/**
 * Adapter bridging VAJRA's IModelCoprocessorPort to an underlying AIProvider (Gemini/OpenRouter).
 */
export class AiProviderCoprocessorAdapter implements IModelCoprocessorPort {
  constructor(
    private readonly provider: AIProvider,
    private readonly defaultModel: string = "gemini-2.5-flash",
  ) {}

  async invokeStructuredCoprocessor<TResponse>(
    request: ModelCoprocessorRequest<TResponse>,
  ): Promise<Result<ModelCoprocessorResponse<TResponse>, string>> {
    const startTime = Date.now();

    const promptPayload = [
      request.systemPrompt,
      "",
      "IMPORTANT: You must respond ONLY with a single valid JSON object strictly conforming to the requested structure. Do not include markdown code block wrappers (```json), commentary, or surrounding text.",
      "",
      "--- STRUCTURED OPERATIONAL CONTEXT ---",
      JSON.stringify(request.structuredContext, null, 2),
    ].join("\n");

    try {
      // Enforce timeout strictly
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Model coprocessor request timed out after ${request.timeoutMs}ms`));
        }, request.timeoutMs);
        if (typeof timer.unref === "function") {
          timer.unref();
        }
      });

      const providerPromise = this.provider.generateContent({
        prompt: promptPayload,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
      });

      const response = await Promise.race([providerPromise, timeoutPromise]);
      const latencyMs = Date.now() - startTime;

      let cleanedText = response.content.trim();
      if (cleanedText.startsWith("```json")) {
        cleanedText = cleanedText.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
      } else if (cleanedText.startsWith("```")) {
        cleanedText = cleanedText.replace(/^```\s*/, "").replace(/\s*```$/, "").trim();
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(cleanedText);
      } catch (jsonErr: any) {
        return Result.failure(
          `Model output was not valid JSON: ${jsonErr?.message ?? String(jsonErr)}`,
          request.correlation,
        );
      }

      const parseResult = request.outputSchema.safeParse(parsedJson);
      if (!parseResult.success) {
        return Result.failure(
          `Model JSON output failed Zod schema validation: ${parseResult.error.message}`,
          request.correlation,
        );
      }

      const promptTokens = response.usage?.promptTokens ?? 0;
      const completionTokens = response.usage?.completionTokens ?? 0;
      // Rough cost estimation: 0.1 cents per 1k input tokens, 0.4 cents per 1k output tokens
      const estimatedCostCents = Number(
        ((promptTokens * 0.0001) + (completionTokens * 0.0004)).toFixed(4),
      );

      const coprocessorResponse: ModelCoprocessorResponse<TResponse> = {
        parsed: parseResult.data,
        rawText: response.content,
        model: response.model || this.defaultModel,
        provider: response.provider || this.provider.name,
        promptTokens,
        completionTokens,
        costCents: estimatedCostCents,
        latencyMs,
      };

      return Result.success(coprocessorResponse, request.correlation);
    } catch (err: any) {
      return Result.failure(
        `Model coprocessor invocation failed: ${err?.message ?? String(err)}`,
        request.correlation,
      );
    }
  }
}

/**
 * In-memory Mock Coprocessor Adapter for deterministic testing.
 */
export class MockModelCoprocessorAdapter implements IModelCoprocessorPort {
  private mockResponseGenerator?: (req: ModelCoprocessorRequest<any>) => any;
  private shouldTimeout: boolean = false;
  private shouldFail: boolean = false;
  private failureMessage: string = "Mock model coprocessor error";

  setResponseGenerator<T>(generator: (req: ModelCoprocessorRequest<T>) => T): void {
    this.mockResponseGenerator = generator;
  }

  setShouldTimeout(timeout: boolean): void {
    this.shouldTimeout = timeout;
  }

  setShouldFail(fail: boolean, message?: string): void {
    this.shouldFail = fail;
    if (message) this.failureMessage = message;
  }

  async invokeStructuredCoprocessor<TResponse>(
    request: ModelCoprocessorRequest<TResponse>,
  ): Promise<Result<ModelCoprocessorResponse<TResponse>, string>> {
    if (this.shouldTimeout) {
      return Result.failure(
        `Model coprocessor request timed out after ${request.timeoutMs}ms`,
        request.correlation,
      );
    }

    if (this.shouldFail) {
      return Result.failure(this.failureMessage, request.correlation);
    }

    if (!this.mockResponseGenerator) {
      return Result.failure("No mock response generator configured", request.correlation);
    }

    try {
      const generated = this.mockResponseGenerator(request);
      const parsed = request.outputSchema.parse(generated);

      return Result.success(
        {
          parsed,
          rawText: JSON.stringify(generated),
          model: "mock-gemini-flash",
          provider: "mock-provider",
          promptTokens: 120,
          completionTokens: 80,
          costCents: 0.05,
          latencyMs: 15,
        },
        request.correlation,
      );
    } catch (err: any) {
      return Result.failure(
        `Mock validation error: ${err?.message ?? String(err)}`,
        request.correlation,
      );
    }
  }
}
