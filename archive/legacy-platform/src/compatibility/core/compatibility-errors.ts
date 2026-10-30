export class CompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompatibilityError";
  }
}

export class RuntimeCompatibilityError extends CompatibilityError {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeCompatibilityError";
  }
}

export class UnsupportedRuntimeError extends CompatibilityError {
  constructor(feature: string) {
    super(`Unsupported runtime feature: ${feature}`);
    this.name = "UnsupportedRuntimeError";
  }
}

export class MissingAdapterError extends CompatibilityError {
  constructor(adapterName: string) {
    super(`Missing adapter: ${adapterName}`);
    this.name = "MissingAdapterError";
  }
}

export class VersionMismatchError extends CompatibilityError {
  constructor(message: string) {
    super(message);
    this.name = "VersionMismatchError";
  }
}
