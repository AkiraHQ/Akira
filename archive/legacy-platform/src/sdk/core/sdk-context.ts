/**
 * Internal context injected by the Runtime.
 * Contains concrete service implementations that the SDK wrappers delegate to.
 */
export interface SDKContext {
  // runtime version string for compatibility checks (e.g., "1.0.0")
  runtimeVersion?: string;

  // Services – use only the interface types, never concrete classes.
  workspace: WorkspaceService;
  storage: StorageService;
  timeline: TimelineService;
  analytics: AnalyticsService;
  memory: MemoryService;
  search: SearchService;
  notifications: NotificationService;
  events: EventBus;
  permissions: PermissionManager;
}

// Service interface placeholders – these will be imported from the runtime package.
// They are intentionally kept as `any` here to avoid a direct runtime dependency.
// The Runtime will provide concrete objects that satisfy these shapes.
// Service interface placeholders – these will be imported from the runtime package.
// They are intentionally kept as `unknown` here to avoid a direct runtime dependency.
// The Runtime will provide concrete objects that satisfy these shapes.
export type WorkspaceService = unknown;
export type StorageService = unknown;
export type TimelineService = unknown;
export type AnalyticsService = unknown;
export type MemoryService = unknown;
export type SearchService = unknown;
export type NotificationService = unknown;
export type EventBus = unknown;
/**
 * Minimal permission-check contract the SDK actually depends on.
 *
 * Kept deliberately narrow: every SDK API calls `require(permissionId)` and ignores
 * the return value. The runtime's PermissionManager
 * (src/runtime/permissions/permission-manager.ts) satisfies this shape.
 *
 * NOTE: the other service types above remain `unknown`. Giving them real contracts is
 * SDK design work, not build repair — see docs/audits (DEP-006).
 */
export interface PermissionManager {
  require(permissionId: string): void;
}
