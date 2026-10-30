import { CorrelationMetadata } from "../../contracts/results/result";

/**
 * Stimulus kind classifying the origin and nature of an incoming cognitive stimulus.
 */
export type StimulusKind =
  | "human_prompt"          // Direct conversational input from the human user
  | "system_event"          // Platform or environment event from AKIRA OS
  | "subsystem_discovery"   // Discovery, insight, or pattern from GENESIS
  | "scheduled_timer"       // Timer or recurring tick (proactive wakeup)
  | "step_result";          // Completion signal of an executed capability step

/**
 * Pure data contract representing an external or internal stimulus entering the VAJRA brain.
 *
 * INVARIANTS:
 * - Every stimulus must carry immutable correlation metadata (Contract K19).
 * - Must be plain, JSON-serializable data without callbacks or execution handles.
 */
export interface CognitiveStimulus<TPayload = unknown> {
  readonly id: string;
  readonly kind: StimulusKind;
  readonly source: string;
  readonly payload: TPayload;
  readonly correlation: CorrelationMetadata;
  readonly timestamp: string; // ISO-8601 timestamp
}

/**
 * Pure factory helper to construct a frozen CognitiveStimulus.
 */
export function createStimulus<TPayload = unknown>(opts: {
  id: string;
  kind: StimulusKind;
  source: string;
  payload: TPayload;
  correlation: CorrelationMetadata;
  timestamp?: string;
}): CognitiveStimulus<TPayload> {
  return Object.freeze({
    id: opts.id,
    kind: opts.kind,
    source: opts.source,
    payload: opts.payload,
    correlation: Object.freeze({ ...opts.correlation }),
    timestamp: opts.timestamp ?? new Date().toISOString(),
  });
}
