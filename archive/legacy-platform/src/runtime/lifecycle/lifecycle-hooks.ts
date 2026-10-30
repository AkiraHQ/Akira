import { IModuleInstance } from "../module-instance";

export interface LifecycleHooks {
  onInitialize?: (instance: IModuleInstance) => Promise<void> | void;
  onStart?: (instance: IModuleInstance) => Promise<void> | void;
  onPause?: (instance: IModuleInstance) => Promise<void> | void;
  onResume?: (instance: IModuleInstance) => Promise<void> | void;
  onStop?: (instance: IModuleInstance) => Promise<void> | void;
  onShutdown?: (instance: IModuleInstance) => Promise<void> | void;
}
