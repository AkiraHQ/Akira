import { AkiraEvent, EventInput } from "./event-types";
import { EventBus, globalEventBus } from "./event-bus";
import { defaultMiddlewarePipeline } from "./middleware";
import { capabilityExecutionContext } from "../contracts/capabilities/execution-context";

// Dynamically reference the server function on the client
let persistPublishEventRpc: any = null;

if (typeof window !== "undefined") {
  import("./server/index")
    .then((mod) => {
      persistPublishEventRpc = mod.persistPublishEvent;
    })
    .catch(() => {});
}

export class Publisher {
  constructor(
    private eventBus: EventBus = globalEventBus,
    private middleware = defaultMiddlewarePipeline,
  ) {}

  publish(event: EventInput): AkiraEvent {
    // 0. Enforce trusted execution provenance from active CapabilityExecutionContext
    const execContext = capabilityExecutionContext.getStore();

    if (execContext?.isVajra === true) {
      event.metadata = {
        ...(event.metadata || {}),
        isVajra: true,
      };
    } else if (event.metadata && "isVajra" in event.metadata) {
      // Untrusted caller without VAJRA execution context attempted to supply isVajra: strip it
      const sanitized = { ...event.metadata };
      delete (sanitized as any).isVajra;
      event.metadata = sanitized;
    }

    // 1. Run raw event inputs through our composable middleware pipeline
    const processedEvent = this.middleware(event) as AkiraEvent;

    // 2. Publish the fully validated event to the event bus
    this.eventBus.publish(processedEvent);

    return processedEvent;
  }
}

// Default instance for application-wide direct imports
const defaultPublisher = new Publisher();

/**
 * Simplest possible client API for publishing instrumentation events.
 * E.g., import { publish } from "src/instrumentation"
 */
export const publish = (event: EventInput): AkiraEvent => {
  if (typeof window !== "undefined") {
    // 1. Run local client pipeline so we have a synchronous ID and timestamp locally
    const clientProcessed = defaultPublisher.publish(event);

    // 2. Send the processed event to the server RPC for SQLite storage.
    //
    // Transient events stop here. The server round trip exists to persist, and
    // PersistenceSubscriber would discard a transient event on arrival, so
    // shipping it would burn a request per event to reach a guaranteed no-op.
    // That matters because the first transient producer, presence, fires on
    // every store change plus a decay timer.
    //
    // The consequence worth knowing: a transient event is client-local. It
    // reaches every subscriber on the client bus and no server-side subscriber.
    // Nothing server-side consumes one today.
    if (clientProcessed.transient) {
      return clientProcessed;
    }

    if (persistPublishEventRpc) {
      persistPublishEventRpc({ data: clientProcessed }).catch((err: any) => {
        console.error("[Publisher] Failed to persist event on server:", err);
      });
    } else {
      import("./server/index")
        .then((mod) => {
          mod.persistPublishEvent({ data: clientProcessed }).catch((err: any) => {
            console.error("[Publisher] Failed to persist event on server via fallback:", err);
          });
        })
        .catch(() => {});
    }

    return clientProcessed;
  } else {
    // We are on the server: run synchronous publisher
    return defaultPublisher.publish(event);
  }
};
