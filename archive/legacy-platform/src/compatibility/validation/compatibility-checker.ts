import { COMPATIBILITY_SDK_VERSION } from "../core/compatibility-version";
import { VersionMismatchError, UnsupportedRuntimeError } from "../core/compatibility-errors";

/**
 * Simple semantic version compatibility check.
 * - Major version must match.
 * - Minor version of runtime must be >= SDK minor (backwards compatible).
 * - Patch is ignored.
 */
export function checkCompatibility(runtimeVersion: string): void {
  const parse = (v: string) => {
    const [major, minor, patch] = v.split(".").map(Number);
    return { major: major ?? 0, minor: minor ?? 0, patch: patch ?? 0 };
  };

  const sdk = parse(COMPATIBILITY_SDK_VERSION);
  const runtime = parse(runtimeVersion);

  if (runtime.major !== sdk.major) {
    throw new VersionMismatchError(
      `Incompatible major versions: SDK ${sdk.major} vs Runtime ${runtime.major}`,
    );
  }

  if (runtime.minor < sdk.minor) {
    throw new VersionMismatchError(
      `Runtime minor version ${runtime.minor} is older than SDK minor ${sdk.minor}`,
    );
  }

  // If runtime indicates unsupported features (placeholder), we could check a list.
  // For now we assume all features supported.
}
