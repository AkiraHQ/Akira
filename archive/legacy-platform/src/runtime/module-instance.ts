import { ModuleState, isValidTransition } from "./module-state";
import { ModuleContext } from "./module-context";
import { ModuleManifest } from "./manifest";
import { LifecycleManager } from "./lifecycle/lifecycle-manager";

export interface IModuleInstance {
  id: string;
  name: string;
  version: string;
  state: ModuleState;
  context: ModuleContext;
  manifest: ModuleManifest;
  /**
   * The module's lifecycle definition. LifecycleManager invokes
   * definition.startup/shutdown/pause/resume through this interface.
   */
  definition: ModuleDefinition;
  startup(): Promise<void>;
  shutdown(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  markFailed(error: any): void;
}

export interface ModuleDefinition {
  name: string;
  version: string;
  startup?: (context: ModuleContext) => Promise<void> | void;
  shutdown?: (context: ModuleContext) => Promise<void> | void;
  pause?: (context: ModuleContext) => Promise<void> | void;
  resume?: (context: ModuleContext) => Promise<void> | void;
}

export class ModuleInstance implements IModuleInstance {
  public id: string;
  public name: string;
  public version: string;
  public state: ModuleState = ModuleState.UNLOADED;
  public context: ModuleContext;
  public manifest: ModuleManifest;
  public definition: ModuleDefinition;

  constructor(
    id: string,
    name: string,
    version: string,
    context: ModuleContext,
    definition: ModuleDefinition,
    manifest?: ModuleManifest,
  ) {
    this.id = id;
    this.name = name;
    this.version = version;
    this.context = context;
    this.definition = definition;
    this.manifest = manifest || {
      id,
      name,
      version,
      sdkVersion: "^1.0.0",
      description: "Implicit module manifest",
      author: "AKIRA",
    };
  }

  /**
   * Transitions local state to LOADED.
   */
  public loaded(): void {
    this.state = ModuleState.LOADED;
  }

  /**
   * Synchronously transitions state to FAILED step-by-step.
   * Avoids async race conditions for quick failure marking.
   */
  public markFailed(error: any): void {
    if (this.state === ModuleState.UNLOADED) {
      this.state = ModuleState.LOADED;
    }
    if (this.state === ModuleState.LOADED) {
      this.state = ModuleState.INITIALIZED;
    }
    if (this.state === ModuleState.INITIALIZED) {
      this.state = ModuleState.FAILED;
    }
  }

  public async startup(): Promise<void> {
    const lifecycle = (this.context.runtime as any)?.lifecycleManager || new LifecycleManager();
    await lifecycle.start(this);
  }

  public async shutdown(): Promise<void> {
    const lifecycle = (this.context.runtime as any)?.lifecycleManager || new LifecycleManager();
    await lifecycle.stop(this);
  }

  public async pause(): Promise<void> {
    const lifecycle = (this.context.runtime as any)?.lifecycleManager || new LifecycleManager();
    await lifecycle.pause(this);
  }

  public async resume(): Promise<void> {
    const lifecycle = (this.context.runtime as any)?.lifecycleManager || new LifecycleManager();
    await lifecycle.resume(this);
  }
}
