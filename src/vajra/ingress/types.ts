import { CorrelationMetadata } from "../../contracts/results/result";
import { CognitiveStimulus, StimulusKind } from "../types/stimulus";
import { ExecutiveAction } from "../types/action";
import { Result } from "../../contracts/results/result";

/**
 * Payload carried by a user operational directive stimulus (kind: "human_prompt").
 */
export interface HumanPromptPayload {
  readonly directive: string;
  readonly conversationId?: string;
  readonly actor: string; // Authenticated / trusted server identity
  readonly clientTimestamp?: string;
}

/**
 * Payload carried by a GENESIS cognitive discovery stimulus (kind: "subsystem_discovery").
 */
export interface DiscoveryPayload {
  readonly insightId: string;
  readonly canonicalKey: string;
  readonly category: string;
  readonly confidence: string | number;
  readonly supportingUnderstandingIds: readonly string[];
}

/**
 * Payload carried by an AKIRA platform domain event stimulus (kind: "system_event").
 */
export interface SystemEventPayload {
  readonly eventId: string;
  readonly eventType: string;
  readonly source: string;
  readonly entityId?: string;
  readonly actor?: string;
  readonly data: unknown;
}

/**
 * Configuration options for the Ingress Coordinator.
 */
export interface IngressCoordinatorOptions {
  /**
   * Maximum entries retained in the deduplication cache. Defaults to 5000.
   */
  readonly seenCacheLimit?: number;

  /**
   * Maximum allowed pending turns before background events are dropped.
   * Human directives are never dropped. Defaults to 50.
   */
  readonly maxPendingBackgroundTurns?: number;
}

/**
 * Common interface for a stimulus ingress adapter.
 */
export interface IIngressAdapter {
  readonly name: string;
  isAttached(): boolean;
  attach(): void;
  detach(): void;
}

/**
 * Public port for submitting stimuli to VAJRA.
 */
export interface IVajraStimulusIngressCoordinator {
  submitStimulus<TPayload = unknown>(
    stimulus: CognitiveStimulus<TPayload>,
  ): Promise<Result<ExecutiveAction, string>>;
  getPendingTurnsCount(): number;
  isCongested(): boolean;
  attach(): void;
  detach(): void;
}

/**
 * Strict allowlist of platform domain events permitted to enter VAJRA as system_event stimuli.
 */
export const ALLOWED_PLATFORM_EVENT_TYPES = Object.freeze([
  "task.completed",
  "project.created",
  "project.updated",
  "session.ended",
] as const);

export type AllowedPlatformEventType = (typeof ALLOWED_PLATFORM_EVENT_TYPES)[number];
