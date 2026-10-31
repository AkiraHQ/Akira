import { EventSubscriber } from "../../../instrumentation/subscriber";
import { EventBus, globalEventBus } from "../../../instrumentation/event-bus";
import { AkiraEvent } from "../../../instrumentation/event-types";
import { CorrelationMetadata } from "../../../contracts/results/result";
import { createStimulus, CognitiveStimulus } from "../../types/stimulus";
import {
  ALLOWED_PLATFORM_EVENT_TYPES,
  AllowedPlatformEventType,
  IIngressAdapter,
  IVajraStimulusIngressCoordinator,
  SystemEventPayload,
} from "../types";

export const PLATFORM_EVENT_ADAPTER_ID = "vajra-platform-ingress";

export class PlatformEventIngressAdapter implements EventSubscriber, IIngressAdapter {
  readonly id = PLATFORM_EVENT_ADAPTER_ID;
  readonly name = "platform-event-ingress";

  private bus: EventBus | null = null;
  private readonly allowedTypes = new Set<string>(ALLOWED_PLATFORM_EVENT_TYPES);
  private readonly processedEventIds = new Set<string>();
  private readonly eventIdOrder: string[] = [];
  private readonly eventLimit = 3000;

  constructor(
    private readonly coordinator: IVajraStimulusIngressCoordinator,
    private readonly eventBusResolver?: () => EventBus,
  ) {}

  isAttached(): boolean {
    return this.bus !== null;
  }

  attach(bus: EventBus = this.eventBusResolver ? this.eventBusResolver() : globalEventBus): void {
    if (this.bus === bus) {
      return;
    }
    if (this.bus) {
      this.detach();
    }

    bus.subscribe(this);
    this.bus = bus;
  }

  detach(): void {
    if (!this.bus) {
      return;
    }

    try {
      this.bus.unsubscribe(this);
    } catch (err) {
      console.warn("[PlatformEventIngressAdapter] Error during unsubscribe:", err);
    }

    this.bus = null;
    this.processedEventIds.clear();
    this.eventIdOrder.length = 0;
  }

  async onEvent(event: AkiraEvent): Promise<void> {
    if (!this.bus) {
      return;
    }

    if (!event || typeof event !== "object" || !event.type) {
      return;
    }

    // 1. Strict Allowlist Verification
    if (!this.allowedTypes.has(event.type)) {
      return;
    }

    // 2. Suppress VAJRA-Originated Events to Prevent Feedback Loops
    // Only publisher-authenticated provenance marker indicates VAJRA-originated execution.
    // Caller-supplied source strings or unauthenticated metadata are never trusted.
    if ((event.metadata as any)?.isVajra === true) {
      return;
    }

    // 3. Deduplicate by event.id
    if (!event.id || this.processedEventIds.has(event.id)) {
      return;
    }

    this.recordEventId(event.id);

    // 4. Preserve Causation and Correlation
    const uid =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);

    const correlation: CorrelationMetadata = {
      requestId: `req-evt-${event.id}`,
      correlationId: event.correlationId ?? `corr-evt-${event.id}`,
      invocationId: `inv-evt-${uid}`,
      causationId: event.id,
    };

    // 5. Construct Normalized CognitiveStimulus (kind: "system_event")
    const payload: SystemEventPayload = Object.freeze({
      eventId: event.id,
      eventType: event.type,
      source: event.source || "platform.bus",
      entityId: event.entityId,
      actor: event.actor,
      data: event.payload,
    });

    const stimulus: CognitiveStimulus<SystemEventPayload> = createStimulus({
      id: `stim-evt-${event.id}`,
      kind: "system_event",
      source: "akira.platform_bus",
      payload,
      correlation,
      timestamp: event.timestamp,
    });

    // 6. Forward to Ingress Coordinator
    try {
      await this.coordinator.submitStimulus(stimulus);
    } catch (err) {
      console.warn(
        `[PlatformEventIngressAdapter] Failed to submit platform stimulus '${stimulus.id}':`,
        err,
      );
    }
  }

  private recordEventId(id: string): void {
    this.processedEventIds.add(id);
    this.eventIdOrder.push(id);

    if (this.eventIdOrder.length > this.eventLimit) {
      const oldest = this.eventIdOrder.shift();
      if (oldest) {
        this.processedEventIds.delete(oldest);
      }
    }
  }
}
