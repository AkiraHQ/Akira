export type PermissionGroup =
  | "Workspace"
  | "Timeline"
  | "Analytics"
  | "Storage"
  | "Memory"
  | "Notifications"
  | "Voice"
  | "Search"
  | "System";

export type PermissionScope = "Read" | "Write" | "Execute" | "Manage" | "Admin";

export type RiskLevel = "Low" | "Medium" | "High" | "Critical";

export interface PermissionDescriptor {
  /** Immutable identifier, e.g. "workspace.read" */
  id: string;
  /** Human readable name */
  name: string;
  /** Short description of the permission */
  description: string;
  /** Logical grouping */
  group: PermissionGroup;
  /** Scope of the permission */
  scope: PermissionScope;
  /** Risk assessment */
  riskLevel: RiskLevel;
  /** Whether the permission is granted by default (should be false for default‑deny). */
  defaultGrant: boolean;
  /** Optional free‑form metadata */
  metadata?: Record<string, unknown>;
}
