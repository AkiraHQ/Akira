import { CorrelationMetadata } from "../../contracts/results/result";
import { ImpactClass } from "./policy";

/**
 * An alternative option evaluated during deliberation.
 */
export interface DeliberationOption {
  readonly action: string;
  readonly risk: ImpactClass;
  readonly confidence: number;
  readonly expectedCostCents?: number;
}

/**
 * Deterministic, human-readable audit trace explaining a cognitive decision.
 * Allows the human to ask "Why did you do that?" and receive exact historical evidence.
 */
export interface DeliberationTrace {
  readonly traceId: string;
  readonly stimulusId: string;
  readonly correlation: CorrelationMetadata;
  readonly intentClass: string;
  readonly consideredOptions: readonly DeliberationOption[];
  readonly selectedOption: string;
  readonly rationale: string;
  readonly evidenceReliedUpon: readonly string[]; // Observation IDs or belief propositions
  readonly escalationRequired: boolean;
  readonly timestamp: string;
}

/**
 * Factory helper to construct a frozen DeliberationTrace.
 */
export function createDeliberationTrace(opts: {
  traceId: string;
  stimulusId: string;
  correlation: CorrelationMetadata;
  intentClass: string;
  consideredOptions: readonly DeliberationOption[];
  selectedOption: string;
  rationale: string;
  evidenceReliedUpon: readonly string[];
  escalationRequired: boolean;
  timestamp?: string;
}): DeliberationTrace {
  return Object.freeze({
    traceId: opts.traceId,
    stimulusId: opts.stimulusId,
    correlation: Object.freeze({ ...opts.correlation }),
    intentClass: opts.intentClass,
    consideredOptions: Object.freeze(opts.consideredOptions.map((o) => Object.freeze({ ...o }))),
    selectedOption: opts.selectedOption,
    rationale: opts.rationale,
    evidenceReliedUpon: Object.freeze([...opts.evidenceReliedUpon]),
    escalationRequired: opts.escalationRequired,
    timestamp: opts.timestamp ?? new Date().toISOString(),
  });
}
