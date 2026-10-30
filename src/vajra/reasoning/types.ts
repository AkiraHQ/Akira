import { z } from "zod";
import { CorrelationMetadata } from "../../contracts/results/result";
import { CognitiveStimulus } from "../types/stimulus";
import { OperationalContext } from "../types/operational-context";
import { VajraMissionRecord } from "../types/mission-record";
import { EpistemicBelief, VerificationState } from "../types/belief";
import { Observation } from "../../contracts/events/observation";
import { KnownCapabilityInfo } from "../types/self-model";
import { PolicyEnvelope } from "../types/policy";
import { HistoricalMemoryItem, UserIdentityTraits } from "../boundaries/genesis-port";
import { DeliberationTrace } from "../types/trace";

// ============================================================================
// Problem Classification & Uncertainty
// ============================================================================

export type ProblemClass =
  | "POLICY_CONFORMANCE"
  | "OBSERVATION_CONSISTENCY"
  | "AMBIGUOUS_INTENT_INTERPRETATION"
  | "CAUSAL_HYPOTHESIS_GENERATION"
  | "SYNTHESIS_AND_SUMMARIZATION";

export type UncertaintyLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ReasoningStatus =
  | "SUCCESS"           // Strategy produced valid result within declared capability
  | "DEGRADED"          // Fallback strategy produced valid result within reduced capability
  | "INCONCLUSIVE"      // No capable strategy could sufficiently support reasoning
  | "STALE_INVALIDATED";// State version changed mid-deliberation; result invalidated

// ============================================================================
// Strategy Capability Declaration
// ============================================================================

export interface StrategyCapabilityDeclaration {
  readonly supportedProblemClasses: readonly ProblemClass[];
  readonly requiredEvidenceTypes: readonly string[];
  readonly maxComplexity: "LOW" | "MEDIUM" | "HIGH";
  readonly requiresExternalModel: boolean;
  readonly handlesUncertainty: boolean;
  readonly producesHypotheses: boolean;
  readonly detectsContradictions: boolean;
  readonly supportsDegradedOperation: boolean;
}

// ============================================================================
// Canonical Reasoning Context (§8)
// ============================================================================

export interface ReasoningContext {
  readonly stimulus: CognitiveStimulus;
  readonly operationalContext: OperationalContext;
  readonly activeMission?: VajraMissionRecord | null;
  readonly relevantBeliefs: readonly EpistemicBelief[];
  readonly recentObservations: readonly Observation[];
  readonly availableCapabilities: readonly KnownCapabilityInfo[];
  readonly genesisContext?: Readonly<{
    memories: readonly HistoricalMemoryItem[];
    identityTraits: UserIdentityTraits;
  }>;
  readonly selfModelLimits: Readonly<{
    isDegraded: boolean;
    degradedReasons: readonly string[];
    knownUnknowns: readonly string[];
    policyEnvelope: PolicyEnvelope;
  }>;
  readonly contextVersion: number;
  readonly assembledAt: string;
}

// ============================================================================
// Epistemic Artifacts & Inferences (§11, §15)
// ============================================================================

export interface ReasoningHypothesis {
  readonly id: string;
  readonly description: string;
  readonly confidence: number;
  readonly supportingEvidenceIds: readonly string[];
}

export interface ProposedBeliefUpdate {
  readonly beliefId: string;
  readonly proposition: string;
  readonly currentConfidence: number;
  readonly proposedConfidence: number;
  readonly proposedVerificationState: VerificationState;
  readonly rationale: string;
  readonly supportingEvidenceIds: readonly string[];
}

export interface ContradictionRecord {
  readonly proposition: string;
  readonly conflictingEvidenceIds: readonly string[];
  readonly explanation: string;
  readonly severity: "WARNING" | "CRITICAL";
}

export interface FallbackProvenance {
  readonly intendedTier: 1 | 2 | 3;
  readonly actualTier: 1 | 2 | 3;
  readonly fallbackReason:
    | "MODEL_TIMEOUT"
    | "MODEL_ERROR"
    | "SCHEMA_INVALID"
    | "CAPABILITY_UNSUPPORTED";
}

export interface ModelCoprocessorMetadata {
  readonly model: string;
  readonly provider: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costCents: number;
  readonly latencyMs: number;
}

// ============================================================================
// Strategy Execution Output & Interface
// ============================================================================

export interface StrategyReasoningOutput {
  readonly strategyId: string;
  readonly problemClass: ProblemClass;
  readonly hypotheses: readonly ReasoningHypothesis[];
  readonly proposedBeliefUpdates: readonly ProposedBeliefUpdate[];
  readonly contradictions: readonly ContradictionRecord[];
  readonly possibleConsequences: readonly string[];
  readonly uncertaintyLevel: UncertaintyLevel;
  readonly unresolvedQuestions: readonly string[];
  readonly verificationSuggestions: readonly string[];
  readonly rationale: string;
  readonly coprocessorMetadata?: ModelCoprocessorMetadata;
}

export interface IVajraReasoningStrategy {
  readonly id: string;
  readonly tier: 1 | 2 | 3;
  readonly capabilities: StrategyCapabilityDeclaration;
  canHandle(context: ReasoningContext, problemClass: ProblemClass): boolean;
  execute(
    context: ReasoningContext,
    problemClass: ProblemClass,
    correlation: CorrelationMetadata,
  ): Promise<{ ok: true; value: StrategyReasoningOutput } | { ok: false; error: string }>;
}

// ============================================================================
// Canonical Reasoning Result (§15)
// ============================================================================

export interface ReasoningResult {
  readonly id: string;
  readonly stimulusId: string;
  readonly correlation: CorrelationMetadata;
  readonly contextVersion: number;
  readonly problemClass: ProblemClass;
  readonly strategyUsed: string;
  readonly strategyTier: 1 | 2 | 3;
  readonly status: ReasoningStatus;
  readonly hypotheses: readonly ReasoningHypothesis[];
  readonly proposedBeliefUpdates: readonly ProposedBeliefUpdate[];
  readonly contradictions: readonly ContradictionRecord[];
  readonly possibleConsequences: readonly string[];
  readonly uncertaintyLevel: UncertaintyLevel;
  readonly unresolvedQuestions: readonly string[];
  readonly verificationSuggestions: readonly string[];
  readonly deliberationTrace: DeliberationTrace;
  readonly fallbackProvenance?: FallbackProvenance | null;
  readonly coprocessorMetadata?: ModelCoprocessorMetadata;
  readonly completedAt: string;
}

// ============================================================================
// Zod Validation Schemas for Structured Reasoning
// ============================================================================

export interface ModelReasoningPayload {
  interpretedSituation: string;
  hypotheses: Array<{
    id: string;
    description: string;
    confidence: number;
    supportingEvidenceIds: string[];
  }>;
  possibleConsequences: string[];
  uncertaintyLevel: UncertaintyLevel;
  unresolvedQuestions: string[];
  verificationSuggestions: string[];
  rationale: string;
}

export const ModelReasoningPayloadSchema: z.ZodType<ModelReasoningPayload> = z.object({
  interpretedSituation: z.string().min(1),
  hypotheses: z.array(
    z.object({
      id: z.string().min(1),
      description: z.string().min(1),
      confidence: z.number().min(0).max(1),
      supportingEvidenceIds: z.array(z.string()),
    }),
  ).min(1),
  possibleConsequences: z.array(z.string()),
  uncertaintyLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  unresolvedQuestions: z.array(z.string()),
  verificationSuggestions: z.array(z.string()),
  rationale: z.string().min(1),
});
