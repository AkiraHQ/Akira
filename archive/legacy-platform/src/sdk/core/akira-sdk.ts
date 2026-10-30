import { SDKContext } from "./sdk-context";
import { WorkspaceAPI } from "../workspace/workspace-api";
import { StorageAPI } from "../storage/storage-api";
import { TimelineAPI } from "../timeline/timeline-api";
import { AnalyticsAPI } from "../analytics/analytics-api";
import { MemoryAPI } from "../memory/memory-api";
import { SearchAPI } from "../search/search-api";
import { NotificationAPI } from "../notifications/notification-api";
import { EventAPI } from "../events/event-api";
import { SDKVersionMismatchError } from "./sdk-errors";
import { SDK_VERSION } from "./sdk-version";

/**
 * Public SDK entry point.
 * Modules import this class and instantiate it with a runtime‑provided SDKContext.
 */
export class AkiraSDK {
  private readonly _workspace: WorkspaceAPI;
  private readonly _storage: StorageAPI;
  private readonly _timeline: TimelineAPI;
  private readonly _analytics: AnalyticsAPI;
  private readonly _memory: MemoryAPI;
  private readonly _search: SearchAPI;
  private readonly _notifications: NotificationAPI;
  private readonly _events: EventAPI;

  constructor(private readonly context: SDKContext) {
    // version compatibility check
    if (context.runtimeVersion && context.runtimeVersion !== SDK_VERSION) {
      throw new SDKVersionMismatchError(
        `Runtime version ${context.runtimeVersion} is incompatible with SDK version ${SDK_VERSION}`,
      );
    }
    // instantiate thin wrappers
    this._workspace = new WorkspaceAPI(context);
    this._storage = new StorageAPI(context);
    this._timeline = new TimelineAPI(context);
    this._analytics = new AnalyticsAPI(context);
    this._memory = new MemoryAPI(context);
    this._search = new SearchAPI(context);
    this._notifications = new NotificationAPI(context);
    this._events = new EventAPI(context);
  }

  // public getters – only the listed properties are exposed
  get workspace(): WorkspaceAPI {
    return this._workspace;
  }
  get storage(): StorageAPI {
    return this._storage;
  }
  get timeline(): TimelineAPI {
    return this._timeline;
  }
  get analytics(): AnalyticsAPI {
    return this._analytics;
  }
  get memory(): MemoryAPI {
    return this._memory;
  }
  get search(): SearchAPI {
    return this._search;
  }
  get notifications(): NotificationAPI {
    return this._notifications;
  }
  get events(): EventAPI {
    return this._events;
  }
}
