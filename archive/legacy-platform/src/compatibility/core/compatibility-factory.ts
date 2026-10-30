import { RuntimeAdapter } from "../interfaces/runtime-adapter";
import { WorkspaceAdapter } from "../adapters/workspace-adapter";
import { StorageAdapter } from "../adapters/storage-adapter";
import { TimelineAdapter } from "../adapters/timeline-adapter";
import { AnalyticsAdapter } from "../adapters/analytics-adapter";
import { MemoryAdapter } from "../adapters/memory-adapter";
import { SearchAdapter } from "../adapters/search-adapter";
import { NotificationAdapter } from "../adapters/notification-adapter";
import { EventAdapter } from "../adapters/event-adapter";
import { SDKContext } from "../../sdk/core/sdk-context";

/**
 * Build an SDKContext where each service is a compatibility adapter.
 * The SDK can continue to use the same interface; adapters delegate to the runtime.
 */
export function buildCompatibilityContext(runtimeAdapter: RuntimeAdapter): SDKContext {
  return {
    runtimeVersion: runtimeAdapter.runtimeVersion,
    workspace: new WorkspaceAdapter(runtimeAdapter) as any,
    storage: new StorageAdapter(runtimeAdapter) as any,
    timeline: new TimelineAdapter(runtimeAdapter) as any,
    analytics: new AnalyticsAdapter(runtimeAdapter) as any,
    memory: new MemoryAdapter(runtimeAdapter) as any,
    search: new SearchAdapter(runtimeAdapter) as any,
    notifications: new NotificationAdapter(runtimeAdapter) as any,
    events: new EventAdapter(runtimeAdapter) as any,
    permissions: (runtimeAdapter as any).permissions,
  };
}
