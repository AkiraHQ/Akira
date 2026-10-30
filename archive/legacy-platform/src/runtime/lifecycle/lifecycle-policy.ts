import { IModuleInstance } from "../module-instance";

export interface LifecyclePolicy {
  name: string;
  onStartupFailure(
    instance: IModuleInstance,
    error: any,
    remainingModules: string[],
  ): Promise<string[]>;
}

export class StrictPolicy implements LifecyclePolicy {
  public name = "Strict";
  public async onStartupFailure(
    instance: IModuleInstance,
    error: any,
    remainingModules: string[],
  ): Promise<string[]> {
    throw error; // Fail immediately, aborting the boot sequence
  }
}

export class FailFastPolicy implements LifecyclePolicy {
  public name = "FailFast";
  public async onStartupFailure(
    instance: IModuleInstance,
    error: any,
    remainingModules: string[],
  ): Promise<string[]> {
    throw error; // Fail fast, aborting the boot sequence
  }
}

export class ContinueOnFailurePolicy implements LifecyclePolicy {
  public name = "ContinueOnFailure";
  public async onStartupFailure(
    instance: IModuleInstance,
    error: any,
    remainingModules: string[],
  ): Promise<string[]> {
    // Continue running, let LifecycleManager isolate and prune dependents
    return remainingModules;
  }
}
