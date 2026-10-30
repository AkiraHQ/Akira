import { CognitiveStimulus } from "../types/stimulus";
import { Result } from "../../contracts/results/result";

export type IntentClass =
  | "informational_query"   // Simple query requiring no state changes
  | "operational_command"   // Multi-step task or workspace mutation
  | "clarification"         // Response to previous query or escalation
  | "ambiguous";            // Unclear intent requiring clarification

export interface ParsedIntent {
  readonly intentClass: IntentClass;
  readonly primaryObjective: string;
  readonly extractedConstraints: readonly string[];
  readonly confidence: number;
}

/**
 * Architectural Port for the Understanding Engine (to be implemented in future phases).
 *
 * Ingests incoming stimuli and classifies intent, scope, and constraints.
 */
export interface IUnderstandingEngine {
  understand(stimulus: CognitiveStimulus): Promise<Result<ParsedIntent, string>>;
}
