/**
 * Base class for all SDK errors.
 */
export class SDKError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SDKError";
  }
}

/**
 * Thrown when a required permission is missing.
 */
export class PermissionRequiredError extends SDKError {
  constructor(permission: string) {
    super(`Permission required: ${permission}`);
    this.name = "PermissionRequiredError";
  }
}

/**
 * Thrown when the SDK version does not match the Runtime version.
 */
export class SDKVersionMismatchError extends SDKError {
  constructor(message: string) {
    super(message);
    this.name = "SDKVersionMismatchError";
  }
}

/**
 * Thrown when a feature is not supported by the current SDK version.
 */
export class UnsupportedFeatureError extends SDKError {
  constructor(feature: string) {
    super(`Unsupported feature: ${feature}`);
    this.name = "UnsupportedFeatureError";
  }
}
