export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ManifestValidationError extends ManifestError {
  constructor(message: string) {
    super(message);
  }
}

export class MissingFieldError extends ManifestValidationError {
  constructor(public field: string) {
    super(`Missing required manifest field: "${field}"`);
  }
}

export class InvalidVersionError extends ManifestValidationError {
  constructor(
    public field: string,
    public value: string,
    message?: string,
  ) {
    super(
      message ||
        `Invalid version format for field "${field}": "${value}". Must follow semantic version rules.`,
    );
  }
}

export class DuplicateModuleError extends ManifestValidationError {
  constructor(public id: string) {
    super(`Duplicate module detected: A module with ID "${id}" is already registered.`);
  }
}

export class DuplicateCapabilityError extends ManifestValidationError {
  constructor(
    public capability: string,
    public owningModule: string,
  ) {
    super(
      `Duplicate capability detected: Capability "${capability}" is already claimed by module "${owningModule}".`,
    );
  }
}

export class DuplicateRouteError extends ManifestValidationError {
  constructor(
    public route: string,
    public owningModule: string,
  ) {
    super(
      `Duplicate route detected: Route "${route}" is already claimed by module "${owningModule}".`,
    );
  }
}

export class UnknownPropertyError extends ManifestValidationError {
  constructor(public property: string) {
    super(`Unknown manifest property detected: "${property}"`);
  }
}
