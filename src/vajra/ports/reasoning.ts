import { Result, CorrelationMetadata } from "../../contracts/results/result";
import { ReasoningContext, ReasoningResult } from "../reasoning/types";

/**
 * Architectural Port for the VAJRA Reasoning Engine (Phase 4).
 *
 * Consumes an immutable, resource-bounded ReasoningContext and produces an auditable ReasoningResult.
 *
 * Invariants:
 * - Operates strictly in the UNDERSTAND -> REASON stage.
 * - Does not make final operational decisions (Phase 5).
 * - Does not execute actions or spawn processes.
 */
export interface IReasoningEngine {
  deliberate(
    context: ReasoningContext,
    correlation: CorrelationMetadata,
  ): Promise<Result<ReasoningResult, string>>;
}
