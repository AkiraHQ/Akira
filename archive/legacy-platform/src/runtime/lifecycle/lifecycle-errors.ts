export class LifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class LifecycleTransitionError extends LifecycleError {
  constructor(
    public moduleId: string,
    public from: string,
    public to: string,
  ) {
    super(
      `Invalid lifecycle transition for module "${moduleId}": cannot transition from ${from} to ${to}`,
    );
  }
}

export class LifecycleTimeoutError extends LifecycleError {
  constructor(message: string) {
    super(message);
  }
}

export class LifecycleHookError extends LifecycleError {
  constructor(
    public moduleId: string,
    public hookName: string,
    public error: any,
  ) {
    super(
      `Failure executing hook "${hookName}" on module "${moduleId}": ${error.message || error}`,
    );
  }
}

export class RestartError extends LifecycleError {
  constructor(
    public moduleId: string,
    message: string,
  ) {
    super(`Failed to restart module "${moduleId}": ${message}`);
  }
}

export class RollbackError extends LifecycleError {
  constructor(message: string) {
    super(`Rollback execution failed: ${message}`);
  }
}
