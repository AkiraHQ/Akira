/**
 * Generic runtime adapter exposing service-specific adapters.
 * Implementations provide concrete adapters that delegate to a specific
 * Runtime implementation.
 */
export interface RuntimeAdapter {
  workspace: WorkspaceAdapter;
  storage: StorageAdapter;
  timeline: TimelineAdapter;
  analytics: AnalyticsAdapter;
  memory: MemoryAdapter;
  search: SearchAdapter;
  notifications: NotificationAdapter;
  events: EventAdapter;
  runtimeVersion: string;
}

// Adapter type placeholders – concrete adapters are defined under src/compatibility/adapters
export type WorkspaceAdapter = any;
export type StorageAdapter = any;
export type TimelineAdapter = any;
export type AnalyticsAdapter = any;
export type MemoryAdapter = any;
export type SearchAdapter = any;
export type NotificationAdapter = any;
export type EventAdapter = any;
