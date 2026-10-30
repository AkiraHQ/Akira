import * as fs from "fs";
import * as path from "path";
import { logger } from "../shared/infrastructure/logger";
import { PermissionManager } from "./permissions/permission-manager";
import { eventBus } from "../shared/infrastructure/event-bus";
import { ModuleState } from "./module-state";
import { ModuleContext, IRuntimeManager } from "./module-context";
import { IModuleInstance, ModuleInstance } from "./module-instance";
import { IModuleLoader, ModuleLoader } from "./module-loader";
import {
  ModuleManifest,
  ManifestLoader,
  ManifestValidator,
  MissingFieldError,
  ManifestValidationError,
} from "./manifest";
import { analyzeDependencies, DependencyError } from "./resolver";
import { LifecycleManager } from "./lifecycle";
import { CapabilityRegistry } from "./registry";

export interface RuntimeManagerOptions {
  loader?: IModuleLoader;
  modulesDir?: string;
  initialModules?: { id: string; path: string }[];
  configurations?: Record<string, Record<string, any>>;
}

export class RuntimeManager implements IRuntimeManager {
  public permissionManager: PermissionManager;
  public lifecycleManager: LifecycleManager;
  public capabilityRegistry: CapabilityRegistry;
  private loader: IModuleLoader;
  private modulesDir?: string;
  private isInitialized = false;

  private instances = new Map<string, IModuleInstance>();
  private modulePaths = new Map<string, string>();
  private discoveredModules: { id: string; path: string }[] = [];
  private discoveredManifests = new Map<string, any>();
  private moduleConfigurations = new Map<string, Record<string, any>>();

  constructor(options?: RuntimeManagerOptions) {
    this.loader = options?.loader || new ModuleLoader();
    this.modulesDir = options?.modulesDir;
    this.discoveredModules = options?.initialModules || [];
    this.lifecycleManager = new LifecycleManager(this.instances);
    this.permissionManager = new PermissionManager();
    this.capabilityRegistry = new CapabilityRegistry();

    if (options?.configurations) {
      for (const [id, config] of Object.entries(options.configurations)) {
        this.moduleConfigurations.set(id, config);
      }
    }
  }

  /**
   * Initializes the Platform Runtime.
   * Discovers modules, builds their dependency graph, sorts them topologically,
   * skips affected circular/missing dependency sub-graphs, and loads the remaining modules.
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn("RuntimeManager is already initialized.");
      return;
    }

    logger.info("Platform Runtime: Initializing Module Runtime with Dependency Resolver...");

    // 1. Discover modules
    await this.discoverModules();

    // 2. Pre-process manifests and filter out disabled/failed modules
    const activeManifests: ModuleManifest[] = [];
    const manifestMap = new Map<string, ModuleManifest>();

    for (const item of this.discoveredModules) {
      const id = item.id;
      const mPath = item.path;

      // Skip modules that already failed during parsing phase
      if (this.instances.get(id)?.state === ModuleState.FAILED) {
        continue;
      }

      try {
        let manifestObj = this.discoveredManifests.get(id);

        // Fallback for Sprint 1.1 legacy file discovery (mock a manifest)
        if (!manifestObj) {
          manifestObj = {
            id,
            name: id,
            version: "1.0.0",
            sdkVersion: "^1.0.0",
            description: "Auto-generated legacy fallback",
            author: "AKIRA",
            enabled: true,
          };
        }

        const manifest = ManifestValidator.validateSchema(manifestObj);

        // Check if disabled
        if (manifest.enabled === false) {
          logger.info(
            `Platform Runtime: Module "${id}" is disabled in manifest. Registering in UNLOADED state.`,
          );
          const context = this.createContextForModule(id);
          const definition = { name: manifest.name, version: manifest.version };
          const disabledInstance = new ModuleInstance(
            id,
            manifest.name,
            manifest.version,
            context,
            definition,
            manifest,
          );
          this.instances.set(id, disabledInstance);
          this.modulePaths.set(id, mPath);
          continue;
        }

        activeManifests.push(manifest);
        manifestMap.set(id, manifest);
      } catch (error: any) {
        logger.error(
          `Platform Runtime: Discovered module "${id}" failed schema validation: ${error.message}`,
        );
        this.registerFailedModule(id, mPath, error);
      }
    }

    // 3. Resolve dependencies and calculate startup orders
    const analysis = analyzeDependencies(activeManifests);

    // Register transitively skipped modules in FAILED state
    for (const item of analysis.skippedModules) {
      const path = this.discoveredModules.find((m) => m.id === item.id)?.path || "";
      logger.error(`Platform Runtime: Skipping module "${item.id}": ${item.reason}`);
      this.registerFailedModule(item.id, path, new DependencyError(item.reason));
    }

    // 4. Load remaining modules in topological order
    for (const id of analysis.startupOrder) {
      const path = this.discoveredModules.find((m) => m.id === id)?.path || "";
      const manifest = manifestMap.get(id);

      if (!manifest) continue;

      try {
        logger.info(
          `Platform Runtime: Auto-loading module "${id}" during dependency resolution sequence`,
        );
        await this.loadModuleInternal(id, path, manifest);
      } catch (error: any) {
        logger.error(
          `Platform Runtime: Dependency startup failed for module "${id}": ${error.message}`,
        );
        this.registerFailedModule(id, path, error);
      }
    }

    this.isInitialized = true;
    logger.info("Platform Runtime: Initialization complete.");
  }

  /**
   * Shuts down all active module instances gracefully and clears states.
   */
  public async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      logger.warn("RuntimeManager shutdown called but runtime is not initialized.");
      return;
    }

    logger.info("Platform Runtime: Shutting down all registered modules...");

    // Shut down modules in reverse loading order to respect implicit dependencies
    const moduleIds = Array.from(this.instances.keys()).reverse();
    for (const id of moduleIds) {
      try {
        await this.unloadModule(id);
      } catch (error: any) {
        logger.error(
          `Platform Runtime: Error during graceful shutdown of module "${id}": ${error.message}`,
        );
      }
    }

    this.instances.clear();
    this.modulePaths.clear();
    this.discoveredManifests.clear();
    this.capabilityRegistry.clear();
    this.isInitialized = false;
    logger.info("Platform Runtime: Shutdown complete.");
  }

  /**
   * Manually load, validate, and start a specific module.
   */
  public async loadModule(id: string, modulePath: string): Promise<IModuleInstance> {
    if (this.instances.has(id)) {
      throw new Error(`Module with ID "${id}" is already registered/loaded in the runtime`);
    }

    // Strip file:/// prefix to work on normal OS paths
    let normalizedPath = modulePath;
    if (normalizedPath.startsWith("file:///")) {
      normalizedPath = normalizedPath.substring(8);
    }
    normalizedPath = path.normalize(normalizedPath);

    // Resolve manifest from directory
    const fileStat = fs.existsSync(normalizedPath) ? fs.statSync(normalizedPath) : null;
    const searchDir = fileStat?.isDirectory() ? normalizedPath : path.dirname(normalizedPath);

    let manifestObj: any = null;
    const possibleManifests = [
      path.join(searchDir, "manifest.yaml"),
      path.join(searchDir, "manifest.yml"),
      path.join(searchDir, "manifest.json"),
    ];

    for (const mPath of possibleManifests) {
      if (fs.existsSync(mPath)) {
        manifestObj = await ManifestLoader.load(mPath);
        break;
      }
    }

    let manifest: ModuleManifest | undefined = undefined;
    if (manifestObj) {
      // Validate manifest (schema & duplicates against other running modules)
      const existingManifests = Array.from(this.instances.values())
        .filter((inst) => inst.state === ModuleState.RUNNING || inst.state === ModuleState.PAUSED)
        .map((inst) => inst.manifest);

      manifest = ManifestValidator.validate(manifestObj, existingManifests);

      if (manifest.enabled === false) {
        logger.info(
          "Platform Runtime: Module is disabled in manifest. Registering in UNLOADED state.",
        );
        const context = this.createContextForModule(id);
        const definition = { name: manifest.name, version: manifest.version };
        const disabledInstance = new ModuleInstance(
          id,
          manifest.name,
          manifest.version,
          context,
          definition,
          manifest,
        );
        this.instances.set(id, disabledInstance);
        this.modulePaths.set(id, modulePath);
        return disabledInstance;
      }
    }

    return this.loadModuleInternal(id, modulePath, manifest);
  }

  /**
   * Unload and clean up a registered module.
   */
  public async unloadModule(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      logger.warn(`Platform Runtime: Attempted to unload unregistered module "${id}"`);
      return;
    }

    logger.info(`Platform Runtime: Unloading module "${id}"`);
    try {
      await instance.shutdown();
    } finally {
      this.instances.delete(id);
      this.modulePaths.delete(id);
      this.discoveredManifests.delete(id);
    }
  }

  /**
   * Reload a loaded module, keeping context configurations.
   */
  public async reloadModule(id: string): Promise<IModuleInstance> {
    logger.info(`Platform Runtime: Reloading module "${id}"`);
    const path = this.modulePaths.get(id);
    if (!path) {
      throw new Error(`Cannot reload module "${id}": module path registration is missing`);
    }

    // 1. Unload current module gracefully
    await this.unloadModule(id);

    // 2. Load fresh
    return this.loadModule(id, path);
  }

  /**
   * Retrieves a loaded module instance by its ID.
   */
  public getModule(id: string): IModuleInstance | undefined {
    return this.instances.get(id);
  }

  /**
   * Returns a list of all currently tracked module instances.
   */
  public listModules(): IModuleInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Returns the current state of a module.
   */
  public getModuleState(id: string): ModuleState | undefined {
    return this.instances.get(id)?.state;
  }

  /**
   * Adds a module path configuration to the discovery list.
   */
  public registerDiscoveredModule(id: string, modulePath: string): void {
    const exists = this.discoveredModules.some((m) => m.id === id);
    if (!exists) {
      this.discoveredModules.push({ id, path: modulePath });
    }
  }

  /**
   * Performs automatic manifest-based discovery.
   */
  private async discoverModules(): Promise<void> {
    if (!this.modulesDir) {
      return;
    }

    try {
      // 1. Discover via manifest loader (directories with manifest files)
      const discovered = await ManifestLoader.discover(this.modulesDir);
      for (const item of discovered) {
        this.registerDiscoveredModule(item.id, item.moduleDir);
        if (item.manifest) {
          this.discoveredManifests.set(item.id, item.manifest);
        } else {
          // Unparseable/malformed manifest file found
          logger.error(
            `Platform Runtime: Module "${item.id}" manifest is malformed or failed to parse.`,
          );
          this.registerFailedModule(
            item.id,
            item.moduleDir,
            new ManifestValidationError("Malformed manifest file"),
          );
        }
      }

      // 2. Discover standalone JS/TS files (Sprint 1.1 backward compatibility)
      const resolvedDir = path.resolve(this.modulesDir);
      if (fs.existsSync(resolvedDir)) {
        const items = fs.readdirSync(resolvedDir);
        for (const item of items) {
          const fullPath = path.join(resolvedDir, item);
          const stat = fs.statSync(fullPath);
          if (
            stat.isFile() &&
            (item.endsWith(".ts") || item.endsWith(".js")) &&
            !item.endsWith(".d.ts")
          ) {
            const name = path.basename(item, path.extname(item));
            if (!this.discoveredManifests.has(name) && !this.instances.has(name)) {
              this.registerDiscoveredModule(name, fullPath);
            }
          }
        }
      }
    } catch (err: any) {
      logger.error(
        `Platform Runtime: Error scanning directory "${this.modulesDir}" for modules: ${err.message}`,
      );
    }
  }

  /**
   * Registers a failed module instance in FAILED state.
   */
  private registerFailedModule(id: string, path: string, error: any): void {
    const context = this.createContextForModule(id);
    const definition = { name: id, version: "0.0.0" };

    const failedInstance = new ModuleInstance(id, id, "0.0.0", context, definition);
    failedInstance.markFailed(error);

    this.instances.set(id, failedInstance);
    this.modulePaths.set(id, path);
  }

  /**
   * Loads the module and starts it up.
   */
  private async loadModuleInternal(
    id: string,
    modulePath: string,
    manifest?: ModuleManifest,
  ): Promise<IModuleInstance> {
    const context = this.createContextForModule(id);
    let instance: IModuleInstance;

    // Load module files
    try {
      instance = await this.loader.load(id, modulePath, context, manifest);
      this.instances.set(id, instance);
      this.modulePaths.set(id, modulePath);
    } catch (loadError: any) {
      logger.error(`Platform Runtime: Failed to load module "${id}" files: ${loadError.message}`);
      throw loadError;
    }

    // Startup module
    try {
      await instance.startup();
      return instance;
    } catch (startupError: any) {
      logger.error(`Platform Runtime: Module "${id}" failed to startup: ${startupError.message}`);
      try {
        await instance.shutdown();
      } catch (cleanupErr: any) {
        logger.error(
          `Platform Runtime: Failed to transition module "${id}" from FAILED to UNLOADED gracefully: ${cleanupErr.message}`,
        );
      }
      return instance;
    }
  }

  /**
   * Creates a ModuleContext to inject into a module.
   */
  private createContextForModule(id: string): ModuleContext {
    return {
      logger: {
        info: (msg, details) => logger.info(`[Module:${id}] ${msg}`, details),
        warn: (msg, details) => logger.warn(`[Module:${id}] ${msg}`, details),
        error: (msg, details) => logger.error(`[Module:${id}] ${msg}`, details),
      },
      eventBus: {
        publish: (eventType, payload) => eventBus.publish(eventType, payload),
        subscribe: (eventType, subscriber) => eventBus.subscribe(eventType, subscriber),
      },
      configuration: this.moduleConfigurations.get(id) || {},
      runtime: this,
    };
  }

  public resolveCapability<T = any>(capabilityId: string, versionRange?: string): T {
    return this.capabilityRegistry.resolve<T>(capabilityId, versionRange);
  }

  public resolveAllCapabilities<T = any>(capabilityId: string, versionRange?: string): T[] {
    return this.capabilityRegistry.resolveAll<T>(capabilityId, versionRange);
  }
}
