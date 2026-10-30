import { RuntimeAdapter } from "../interfaces/runtime-adapter";

/**
 * EventAdapter – thin wrapper delegating to the runtime event bus.
 *
 * The method surface is fixed by two existing contracts:
 *  - `SDK EventAPI` (src/sdk/events/event-api.ts) calls `publish` / `subscribe`
 *    on the `events` service it receives through the SDKContext.
 *  - `IModuleEventBus` (src/runtime/module-context.ts) declares the same pair.
 */
export class EventAdapter {
  constructor(private readonly runtimeAdapter: RuntimeAdapter) {}

  async publish(eventName: string, payload?: any): Promise<void> {
    await (this.runtimeAdapter.events as any).publish(eventName, payload);
  }

  async subscribe(eventName: string, handler: (...args: any[]) => void): Promise<any> {
    return await (this.runtimeAdapter.events as any).subscribe(eventName, handler);
  }
}
