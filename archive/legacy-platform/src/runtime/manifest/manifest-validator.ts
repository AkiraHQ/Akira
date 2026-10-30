import { ModuleManifest } from "./manifest";
import { ModuleManifestSchema, SemverRegex, SemverRangeRegex } from "./manifest-schema";
import {
  ManifestValidationError,
  MissingFieldError,
  InvalidVersionError,
  DuplicateModuleError,
  DuplicateCapabilityError,
  DuplicateRouteError,
  UnknownPropertyError,
} from "./manifest-errors";

export class ManifestValidator {
  /**
   * Performs structural and schema validation on a raw manifest object.
   * Maps Zod errors to specific custom typed manifest error classes.
   */
  public static validateSchema(manifestObj: any): ModuleManifest {
    if (!manifestObj || typeof manifestObj !== "object") {
      throw new ManifestValidationError("Manifest must be a non-null object");
    }

    const result = ModuleManifestSchema.safeParse(manifestObj);

    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue.path.join(".");

      // 1. Check for unknown properties (strict object violation)
      if (issue.code === "unrecognized_keys") {
        const unrecognizedKey = (issue as any).keys[0];
        throw new UnknownPropertyError(unrecognizedKey);
      }

      // 2. Check for missing required fields (undefined input)
      if (issue.code === "invalid_type" && issue.received === "undefined") {
        throw new MissingFieldError(path);
      }

      // 3. Check for empty string required fields (min length violation)
      if (
        issue.code === "too_small" &&
        ["id", "name", "version", "sdkVersion", "description", "author"].includes(path)
      ) {
        throw new MissingFieldError(path);
      }

      // 4. Check for invalid versions or sdkVersion ranges
      if (path === "version" || path === "sdkVersion") {
        const val = (manifestObj as any)[path] || "";
        throw new InvalidVersionError(path, val, `${path}: ${issue.message}`);
      }

      // 5. Generic Validation Error for other structural failures (e.g. invalid event definitions)
      throw new ManifestValidationError(`${path}: ${issue.message}`);
    }

    const manifest = result.data as ModuleManifest;

    // Explicit double check on semver and range strings
    if (!SemverRegex.test(manifest.version)) {
      throw new InvalidVersionError("version", manifest.version);
    }
    if (!SemverRangeRegex.test(manifest.sdkVersion)) {
      throw new InvalidVersionError("sdkVersion", manifest.sdkVersion);
    }

    // Validate event name definitions inside events
    if (manifest.events) {
      if (manifest.events.publishes) {
        for (const name of manifest.events.publishes) {
          if (!name || typeof name !== "string" || name.trim() === "") {
            throw new ManifestValidationError(
              "events.publishes: event name must be a non-empty string",
            );
          }
        }
      }
      if (manifest.events.subscribes) {
        for (const name of manifest.events.subscribes) {
          if (!name || typeof name !== "string" || name.trim() === "") {
            throw new ManifestValidationError(
              "events.subscribes: event name must be a non-empty string",
            );
          }
        }
      }
    }

    return manifest;
  }

  /**
   * Validates a module's manifest against all currently registered manifests in the runtime,
   * checking for ID collisions, duplicate capability registrations, and duplicate route mappings.
   */
  public static validateDuplicates(
    manifest: ModuleManifest,
    existingManifests: ModuleManifest[],
  ): void {
    for (const existing of existingManifests) {
      if (existing.id === manifest.id) {
        throw new DuplicateModuleError(manifest.id);
      }

      // Check capabilities duplicates
      if (manifest.capabilities && existing.capabilities) {
        for (const cap of manifest.capabilities) {
          if (existing.capabilities.includes(cap)) {
            throw new DuplicateCapabilityError(cap, existing.id);
          }
        }
      }

      // Check routes duplicates
      if (manifest.routes && existing.routes) {
        for (const route of manifest.routes) {
          if (existing.routes.includes(route)) {
            throw new DuplicateRouteError(route, existing.id);
          }
        }
      }
    }
  }

  /**
   * Combined schema and duplicate validation for a manifest.
   */
  public static validate(
    manifestObj: any,
    existingManifests: ModuleManifest[] = [],
  ): ModuleManifest {
    const manifest = this.validateSchema(manifestObj);
    this.validateDuplicates(manifest, existingManifests);
    return manifest;
  }
}
