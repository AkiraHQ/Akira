export class DependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class MissingDependencyError extends DependencyError {
  constructor(
    public moduleId: string,
    public missingId: string,
  ) {
    super(`Module "${moduleId}" has a missing dependency: "${missingId}"`);
  }
}

export class CircularDependencyError extends DependencyError {
  constructor(public cyclePath: string[]) {
    super(`Circular dependency detected: ${cyclePath.join(" -> ")}`);
  }
}

export class DuplicateDependencyError extends DependencyError {
  constructor(
    public moduleId: string,
    public duplicateId: string,
  ) {
    super(`Module "${moduleId}" declares duplicate dependency: "${duplicateId}"`);
  }
}

export class SelfDependencyError extends DependencyError {
  constructor(public moduleId: string) {
    super(`Module "${moduleId}" cannot depend on itself`);
  }
}

export class InvalidDependencyError extends DependencyError {
  constructor(
    public moduleId: string,
    public dependencyId: string,
    details: string,
  ) {
    super(`Module "${moduleId}" has invalid dependency identifier "${dependencyId}": ${details}`);
  }
}
