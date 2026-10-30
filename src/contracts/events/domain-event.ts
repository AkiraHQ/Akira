import { CorrelationMetadata } from "../results/result";

/**
 * Contract K3 Domain Event Interface per Target Architecture §9.1 / Foundation Contracts §2.3 (K3).
 * Represents an immutable notification that a domain state change occurred in an owning subsystem.
 */
export interface DomainEvent<TPayload = unknown> {
  /** Unique event identifier */
  id: string;
  /** Event identifier name (e.g. 'task.created', 'task.updated') */
  name: string;
  /** Owning subsystem that produced the event (e.g. 'AKIRA OS · workspace') */
  producer: string;
  /** Subject entity ID that was created/modified */
  subject: string;
  /** Event payload containing modified entity details */
  payload: TPayload;
  /** ISO-8601 timestamp of occurrence */
  createdAt: string;
  /** Causation ID linking event directly to the Command invocation that caused it (K19) */
  causationId: string;
  /** Correlation ID carrying end-to-end request correlation (K19) */
  correlationId: string;
  /** Request ID carrying originating request context (K19) */
  requestId: string;
}

/**
 * Factory helper to construct a Contract K3 DomainEvent from correlation metadata.
 */
export function createDomainEvent<TPayload>(
  name: string,
  producer: string,
  subject: string,
  payload: TPayload,
  correlation: CorrelationMetadata,
): DomainEvent<TPayload> {
  const eventId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);

  return {
    id: eventId,
    name,
    producer,
    subject,
    payload,
    createdAt: new Date().toISOString(),
    causationId: correlation.invocationId,
    correlationId: correlation.correlationId,
    requestId: correlation.requestId,
  };
}
