import { IModuleInstance, ModuleInstance } from "../module-instance";
import { ModuleState, isValidTransition } from "../module-state";
import { eventBus } from "../../shared/infrastructure/event-bus";
import { logger } from "../../shared/infrastructure/logger";
import { LifecycleEvents } from "./lifecycle-events";
import { LifecycleTransitionError, LifecycleHookError, RestartError } from "./lifecycle-errors";
import { withTimeout } from "./lifecycle-timeout";
import { LifecyclePolicy, ContinueOnFailurePolicy } from "./lifecycle-policy";
import { LifecycleHooks } from "./lifecycle-hooks";
import { DependencyError } from "../resolver/dependency-errors";

export class LifecycleManager {
  private instances = new Map<string, IModuleInstance>();
  private hooksList: LifecycleHooks[] = [];
  private policy: LifecyclePolicy = new ContinueOnFailurePolicy();

  public startupTimeout = 5000;
  public shutdownTimeout = 5000;

  constructor(instances?: Map<string, IModuleInstance>, policy?: LifecyclePolicy) {
    if (instances) {
      this.instances = instances;
    }
    if (policy) {
      this.policy = policy;
    }
  }

  public registerModule(instance: IModuleInstance): void {
    this.instances.set(instance.id, instance);
  }

  public registerHooks(hooks: LifecycleHooks): void {
    this.hooksList.push(hooks);
  }

  public setPolicy(policy: LifecyclePolicy): void {
    this.policy = policy;
  }

  public getState(id: string): ModuleState | undefined {
    return this.instances.get(id)?.state;
  }

  /**
   * Initializes a single module instance (LOADED -> INITIALIZED).
   */
  public async initialize(instance: IModuleInstance): Promise<void> {
    await this.transition(instance, ModuleState.INITIALIZED);
  }

  /**
   * Starts a single module instance, stepping up from UNLOADED/LOADED if necessary.
   */
  public async start(instance: IModuleInstance): Promise<void> {
    if (instance.state === ModuleState.UNLOADED) {
      await this.transition(instance, ModuleState.LOADED);
    }
    if (instance.state === ModuleState.LOADED) {
      await this.initialize(instance);
    }
    if (instance.state !== ModuleState.INITIALIZED) {
      throw new LifecycleTransitionError(instance.id, instance.state, ModuleState.RUNNING);
    }
    await this.transition(instance, ModuleState.RUNNING);
  }

  /**
   * Stops a single module instance gracefully (RUNNING/PAUSED -> STOPPED -> UNLOADED).
   */
  public async stop(instance: IModuleInstance): Promise<void> {
    if (instance.state === ModuleState.UNLOADED) {
      return;
    }
    if (instance.state === ModuleState.FAILED) {
      await this.transition(instance, ModuleState.UNLOADED);
      return;
    }
    await this.transition(instance, ModuleState.STOPPED);
    await this.transition(instance, ModuleState.UNLOADED);
  }

  /**
   * Pauses a running module instance (RUNNING -> PAUSED).
   */
  public async pause(instance: IModuleInstance): Promise<void> {
    await this.transition(instance, ModuleState.PAUSED);
  }

  /**
   * Resumes a paused module instance (PAUSED -> RUNNING).
   */
  public async resume(instance: IModuleInstance): Promise<void> {
    await this.transition(instance, ModuleState.RUNNING);
  }

  /**
   * Restarts a module instance (STOP -> UNLOAD -> LOAD -> INITIALIZE -> RUN).
   */
  public async restart(instance: IModuleInstance): Promise<void> {
    logger.info(`LifecycleManager: Restarting module "${instance.id}"`);
    try {
      await this.stop(instance);
      await this.transition(instance, ModuleState.LOADED);
      await this.initialize(instance);
      await this.start(instance);
    } catch (error: any) {
      logger.error(
        `LifecycleManager: Restart failed for module "${instance.id}": ${error.message}`,
      );
      throw new RestartError(instance.id, error.message);
    }
  }

  /**
   * Rolls back a list of started modules in reverse order.
   */
  public async rollback(startedInstances: IModuleInstance[]): Promise<void> {
    logger.info("LifecycleManager: Starting rollback sequence...");
    const reverseStarted = [...startedInstances].reverse();
    for (const instance of reverseStarted) {
      try {
        logger.info(`LifecycleManager: Rolling back module "${instance.id}"`);
        await this.stop(instance);
      } catch (err: any) {
        logger.error(
          `LifecycleManager: Failed to roll back module "${instance.id}": ${err.message}`,
        );
      }
    }
  }

  /**
   * Executes startup sequence for a list of module IDs.
   * Isolates failures and skips dependents if policy allows.
   */
  public async startModules(ids: string[]): Promise<string[]> {
    const started: string[] = [];
    let remaining = [...ids];

    while (remaining.length > 0) {
      const id = remaining.shift()!;
      const instance = this.instances.get(id);

      if (!instance) {
        logger.error(`LifecycleManager: Tried to start unregistered module "${id}"`);
        continue;
      }

      try {
        await this.start(instance);
        started.push(id);
      } catch (error: any) {
        logger.error(`LifecycleManager: Module "${id}" failed to start: ${error.message}`);

        try {
          remaining = await this.policy.onStartupFailure(instance, error, remaining);
        } catch (policyError) {
          logger.error("LifecycleManager: Policy aborted boot. Triggering rollback...");
          const startedInstances = started.map((sid) => this.instances.get(sid)!).filter(Boolean);
          await this.rollback(startedInstances);
          throw policyError;
        }

        // Filter out dependents of the failed module from the remaining startup queue
        const skipResult = this.skipDependents(id, remaining);
        remaining = skipResult.remaining;
        for (const skippedId of skipResult.skipped) {
          logger.warn(
            `LifecycleManager: Skipping dependent module "${skippedId}" due to failure of "${id}"`,
          );
          const skippedInst = this.instances.get(skippedId);
          if (skippedInst) {
            skippedInst.markFailed(new DependencyError(`Dependency "${id}" failed to start`));
            try {
              await this.transition(skippedInst, ModuleState.UNLOADED);
            } catch {
              // ignore cleanup transition failures
            }
          }
        }
      }
    }

    return started;
  }

  /**
   * Performs transition for a single module instance, enforcing rules and invoking hooks.
   */
  public async transition(instance: IModuleInstance, targetState: ModuleState): Promise<void> {
    const currentState = instance.state;
    if (!isValidTransition(currentState, targetState)) {
      throw new LifecycleTransitionError(instance.id, currentState, targetState);
    }

    try {
      if (targetState === ModuleState.LOADED) {
        instance.state = ModuleState.LOADED;
        eventBus.publish(LifecycleEvents.MODULE_LOADED, { id: instance.id });
      } else if (targetState === ModuleState.INITIALIZED) {
        await this.runGlobalHook("onInitialize", instance);
        instance.state = ModuleState.INITIALIZED;
      } else if (targetState === ModuleState.RUNNING) {
        if (currentState === ModuleState.INITIALIZED) {
          await this.runGlobalHook("onStart", instance);
          await withTimeout(
            async () => {
              if (instance.definition.startup) {
                await instance.definition.startup(instance.context);
              }
            },
            instance.manifest.startupTimeout || this.startupTimeout,
            `Module "${instance.id}" startup timed out`,
          );
          instance.state = ModuleState.RUNNING;
          const registry = (instance.context.runtime as any)?.capabilityRegistry;
          if (registry && instance.manifest.capabilities) {
            for (const capId of instance.manifest.capabilities) {
              try {
                registry.register(
                  {
                    id: capId,
                    name: capId,
                    description: `Auto-registered capability provided by module ${instance.id}`,
                    version: instance.version,
                    providerModule: instance.id,
                    priority: 100,
                    tags: [],
                    status: "active",
                  },
                  instance.definition,
                );
              } catch (regErr: any) {
                logger.error(
                  `LifecycleManager: Failed to auto-register capability "${capId}" for module "${instance.id}": ${regErr.message}`,
                );
              }
            }
          }
          eventBus.publish(LifecycleEvents.MODULE_STARTED, { id: instance.id });
        } else if (currentState === ModuleState.PAUSED) {
          await this.runGlobalHook("onResume", instance);
          await withTimeout(
            async () => {
              if (instance.definition.resume) {
                await instance.definition.resume(instance.context);
              }
            },
            instance.manifest.resumeTimeout || this.startupTimeout,
            `Module "${instance.id}" resume timed out`,
          );
          instance.state = ModuleState.RUNNING;
          eventBus.publish(LifecycleEvents.MODULE_RESUMED, { id: instance.id });
        }
      } else if (targetState === ModuleState.PAUSED) {
        await this.runGlobalHook("onPause", instance);
        await withTimeout(
          async () => {
            if (instance.definition.pause) {
              await instance.definition.pause(instance.context);
            }
          },
          instance.manifest.pauseTimeout || this.startupTimeout,
          `Module "${instance.id}" pause timed out`,
        );
        instance.state = ModuleState.PAUSED;
        eventBus.publish(LifecycleEvents.MODULE_PAUSED, { id: instance.id });
      } else if (targetState === ModuleState.STOPPED) {
        await this.runGlobalHook("onStop", instance);
        await withTimeout(
          async () => {
            if (instance.definition.shutdown) {
              await instance.definition.shutdown(instance.context);
            }
          },
          instance.manifest.shutdownTimeout || this.shutdownTimeout,
          `Module "${instance.id}" stop timed out`,
        );
        instance.state = ModuleState.STOPPED;
        eventBus.publish(LifecycleEvents.MODULE_STOPPED, { id: instance.id });
      } else if (targetState === ModuleState.UNLOADED) {
        await this.runGlobalHook("onShutdown", instance);
        instance.state = ModuleState.UNLOADED;
        const registry = (instance.context.runtime as any)?.capabilityRegistry;
        if (registry && instance.manifest.capabilities) {
          for (const capId of instance.manifest.capabilities) {
            registry.unregister(capId, instance.id);
          }
        }
        eventBus.publish(LifecycleEvents.MODULE_UNLOADED, { id: instance.id });
      } else if (targetState === ModuleState.FAILED) {
        instance.state = ModuleState.FAILED;
        eventBus.publish(LifecycleEvents.MODULE_FAILED, { id: instance.id });
      }
    } catch (error: any) {
      const isStartupError =
        targetState === ModuleState.RUNNING && currentState === ModuleState.INITIALIZED;
      if (isStartupError) {
        instance.state = ModuleState.FAILED;
        eventBus.publish(LifecycleEvents.MODULE_FAILED, {
          id: instance.id,
          error: error.message || error,
        });
        try {
          await this.transition(instance, ModuleState.UNLOADED);
        } catch {
          // ignore cleanup transition failures
        }
      }
      throw new LifecycleHookError(instance.id, targetState, error);
    }
  }

  /**
   * Processes transitions in bulk.
   */
  public async transitionMany(
    instances: IModuleInstance[],
    targetState: ModuleState,
  ): Promise<void> {
    for (const instance of instances) {
      await this.transition(instance, targetState);
    }
  }

  private async runGlobalHook(
    hookName: keyof LifecycleHooks,
    instance: IModuleInstance,
  ): Promise<void> {
    for (const hooks of this.hooksList) {
      const hookFn = hooks[hookName];
      if (hookFn) {
        try {
          await hookFn(instance);
        } catch (err: any) {
          logger.error(
            `LifecycleManager: Hook "${hookName}" failed on module "${instance.id}": ${err.message}`,
            err,
          );
        }
      }
    }
  }

  private skipDependents(
    failedId: string,
    remainingIds: string[],
  ): { remaining: string[]; skipped: string[] } {
    const skipped = new Set<string>();
    skipped.add(failedId);

    let newlySkipped = true;
    while (newlySkipped) {
      newlySkipped = false;
      for (const id of remainingIds) {
        if (skipped.has(id)) continue;

        const instance = this.instances.get(id);
        const dependencies = instance?.manifest.dependencies || [];
        for (const depId of dependencies) {
          if (skipped.has(depId)) {
            skipped.add(id);
            newlySkipped = true;
            break;
          }
        }
      }
    }

    skipped.delete(failedId);

    const remaining = remainingIds.filter((id) => !skipped.has(id));
    return { remaining, skipped: Array.from(skipped) };
  }
}
