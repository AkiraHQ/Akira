import { ModuleState } from "./module-state";
import { IModuleInstance } from "./module-instance";

export interface IModuleLogger {
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}

export interface IModuleEventBus {
  publish<T = any>(eventType: string, payload: T): void;
  subscribe<T = any>(eventType: string, subscriber: (event: any) => void): () => void;
}

export interface IRuntimeManager {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  loadModule(id: string, modulePath: string): Promise<IModuleInstance>;
  unloadModule(id: string): Promise<void>;
  reloadModule(id: string): Promise<IModuleInstance>;
  getModule(id: string): IModuleInstance | undefined;
  listModules(): IModuleInstance[];
  getModuleState(id: string): ModuleState | undefined;
  resolveCapability<T = any>(capabilityId: string, versionRange?: string): T;
  resolveAllCapabilities<T = any>(capabilityId: string, versionRange?: string): T[];
}

export interface ModuleContext {
  logger: IModuleLogger;
  eventBus: IModuleEventBus;
  configuration: Record<string, any>;
  runtime: IRuntimeManager;
}
