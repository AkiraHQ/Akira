import { z } from "zod";

// Strict semver regex: e.g. 1.0.0, 2.1.0-alpha.1
export const SemverRegex =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

// Semver range regex: e.g. ^1.7, >=1.7.0, ~2.0, 1.0.0, ^1.5
export const SemverRangeRegex =
  /^([~^]|>=|<=|>|<)?\s*(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export const ManifestEventsSchema = z.strictObject({
  publishes: z.array(z.string().min(1, "Event name cannot be empty")).optional(),
  subscribes: z.array(z.string().min(1, "Event name cannot be empty")).optional(),
});

export const ModuleManifestSchema = z.strictObject({
  id: z.string().min(1, "Module ID cannot be empty"),
  name: z.string().min(1, "Module Name cannot be empty"),
  version: z.string().min(1, "Version cannot be empty"),
  sdkVersion: z.string().min(1, "SDK Version cannot be empty"),
  description: z.string().min(1, "Description cannot be empty"),
  author: z.string().min(1, "Author cannot be empty"),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  license: z.string().optional(),
  permissions: z.array(z.string().min(1, "Permission entry cannot be empty")).optional(),
  dependencies: z.array(z.string().min(1, "Dependency entry cannot be empty")).optional(),
  capabilities: z.array(z.string().min(1, "Capability entry cannot be empty")).optional(),
  routes: z.array(z.string().regex(/^\//, "Route must start with /")).optional(),
  events: ManifestEventsSchema.optional(),
  startup: z.string().optional(),
  shutdown: z.string().optional(),
  enabled: z.boolean().optional(),
  startupTimeout: z.number().int().positive().optional(),
  shutdownTimeout: z.number().int().positive().optional(),
  pauseTimeout: z.number().int().positive().optional(),
  resumeTimeout: z.number().int().positive().optional(),
});
