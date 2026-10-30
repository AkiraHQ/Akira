export class CapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DuplicateCapabilityRegistrationError extends CapabilityError {
  constructor(
    public capabilityId: string,
    public moduleId: string,
  ) {
    super(`Capability "${capabilityId}" is already registered by module "${moduleId}"`);
  }
}

export class CapabilityNotFoundError extends CapabilityError {
  constructor(
    public capabilityId: string,
    details?: string,
  ) {
    super(
      `Capability "${capabilityId}" could not be resolved${details ? `: ${details}` : " (no active providers found)"}`,
    );
  }
}

export class InvalidCapabilityPriorityError extends CapabilityError {
  constructor(
    public capabilityId: string,
    public priority: any,
  ) {
    super(
      `Invalid priority "${priority}" for capability "${capabilityId}": must be a positive integer`,
    );
  }
}

export class CapabilityVersionMismatchError extends CapabilityError {
  constructor(
    public capabilityId: string,
    public expected: string,
    public actual: string,
  ) {
    super(
      `Version mismatch for capability "${capabilityId}": expected "${expected}", got "${actual}"`,
    );
  }
}

export class InvalidCapabilityMetadataError extends CapabilityError {
  constructor(
    public capabilityId: string,
    message: string,
  ) {
    super(`Invalid metadata for capability "${capabilityId}": ${message}`);
  }
}
