import { Capability } from "./capability";
import { CapabilitySelector, PrioritySelector } from "./capability-selector";
import { eventBus } from "../../shared/infrastructure/event-bus";
import { CapabilityEvents } from "./capability-events";
import {
  DuplicateCapabilityRegistrationError,
  CapabilityNotFoundError,
  InvalidCapabilityPriorityError,
  CapabilityVersionMismatchError,
  InvalidCapabilityMetadataError,
} from "./capability-errors";

export class CapabilityRegistry {
  // Map of capabilityId -> List of registered providers
  private capabilitiesMap = new Map<string, Capability[]>();
  // Map of (capabilityId + ":" + providerModule) -> bound service instance
  private bindingsMap = new Map<string, any>();

  private selector: CapabilitySelector = new PrioritySelector();
  private isReady = false;

  public setReady(ready: boolean): void {
    this.isReady = ready;
  }

  public setSelector(selector: CapabilitySelector): void {
    this.selector = selector;
  }

  /**
   * Registers a capability and binds its service implementation instance.
   * Runs strict metadata validation.
   */
  public register(capability: Capability, instance?: any): void {
    this.validateCapability(capability);

    const existing = this.capabilitiesMap.get(capability.id) || [];
    const isDup = existing.some((c) => c.providerModule === capability.providerModule);

    if (isDup) {
      throw new DuplicateCapabilityRegistrationError(capability.id, capability.providerModule);
    }

    // Add to mapping list
    existing.push(capability);
    this.capabilitiesMap.set(capability.id, existing);

    // Bind implementation
    const bindingKey = `${capability.id}:${capability.providerModule}`;
    this.bindingsMap.set(bindingKey, instance);

    eventBus.publish(CapabilityEvents.REGISTERED, {
      id: capability.id,
      providerModule: capability.providerModule,
    });
  }

  /**
   * Unregisters a capability provided by a specific module.
   */
  public unregister(capabilityId: string, providerModule: string): void {
    const existing = this.capabilitiesMap.get(capabilityId) || [];
    const filtered = existing.filter((c) => c.providerModule !== providerModule);

    if (existing.length === filtered.length) {
      return; // Not found, return silently
    }

    if (filtered.length === 0) {
      this.capabilitiesMap.delete(capabilityId);
    } else {
      this.capabilitiesMap.set(capabilityId, filtered);
    }

    const bindingKey = `${capabilityId}:${providerModule}`;
    this.bindingsMap.delete(bindingKey);

    eventBus.publish(CapabilityEvents.REMOVED, {
      id: capabilityId,
      providerModule,
    });
  }

  /**
   * Returns the selected capability metadata block using current selector strategies.
   */
  public find(capabilityId: string): Capability | null {
    const list = this.capabilitiesMap.get(capabilityId) || [];
    const active = list.filter((c) => c.status === "active");
    return this.selector.select(active);
  }

  /**
   * Returns all active and inactive capability metadata registered under this ID.
   */
  public findAll(capabilityId: string): Capability[] {
    return this.capabilitiesMap.get(capabilityId) || [];
  }

  /**
   * Checks if the registry contains at least one active provider for a capability.
   */
  public has(capabilityId: string): boolean {
    const active = (this.capabilitiesMap.get(capabilityId) || []).filter(
      (c) => c.status === "active",
    );
    return active.length > 0;
  }

  /**
   * Resolves a capability to its highest priority bound instance.
   * Optionally matches against a SemVer range requirement.
   */
  public resolve<T = any>(capabilityId: string, versionRange?: string): T {
    const list = this.capabilitiesMap.get(capabilityId) || [];
    const active = list.filter((c) => c.status === "active");

    if (active.length === 0) {
      throw new CapabilityNotFoundError(capabilityId);
    }

    // Filter by version range if requested
    const matching = active.filter((c) => this.satisfiesVersion(c.version, versionRange));

    if (matching.length === 0) {
      // Find the best unmatched to throw detailed version error
      const best = this.selector.select(active)!;
      throw new CapabilityVersionMismatchError(capabilityId, versionRange || "*", best.version);
    }

    const selected = this.selector.select(matching);
    if (!selected) {
      throw new CapabilityNotFoundError(capabilityId);
    }

    const bindingKey = `${selected.id}:${selected.providerModule}`;
    const instance = this.bindingsMap.get(bindingKey);

    eventBus.publish(CapabilityEvents.RESOLVED, {
      id: capabilityId,
      providerModule: selected.providerModule,
      version: selected.version,
    });

    return instance;
  }

  /**
   * Resolves all active providers for a capability, returning their service instances.
   */
  public resolveAll<T = any>(capabilityId: string, versionRange?: string): T[] {
    const list = this.capabilitiesMap.get(capabilityId) || [];
    const active = list.filter((c) => c.status === "active");
    const matching = active.filter((c) => this.satisfiesVersion(c.version, versionRange));

    // Sort matching using priority selector order to return them in prioritized order
    const sorted = [...matching].sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.providerModule.localeCompare(b.providerModule);
    });

    return sorted.map((c) => {
      const bindingKey = `${c.id}:${c.providerModule}`;
      return this.bindingsMap.get(bindingKey);
    });
  }

  /**
   * Lists all capability metadata objects registered in the system.
   */
  public list(): Capability[] {
    const result: Capability[] = [];
    for (const list of this.capabilitiesMap.values()) {
      result.push(...list);
    }
    return result;
  }

  /**
   * Returns a list of module IDs that provide the capability.
   */
  public getProviders(capabilityId: string): string[] {
    const list = this.capabilitiesMap.get(capabilityId) || [];
    return list.map((c) => c.providerModule);
  }

  /**
   * Returns a list of capability metadata provided by a specific module.
   */
  public getCapabilities(moduleId: string): Capability[] {
    const result: Capability[] = [];
    for (const list of this.capabilitiesMap.values()) {
      for (const cap of list) {
        if (cap.providerModule === moduleId) {
          result.push(cap);
        }
      }
    }
    return result;
  }

  /**
   * Clears all capability mappings and bound services.
   */
  public clear(): void {
    this.capabilitiesMap.clear();
    this.bindingsMap.clear();
    this.isReady = false;
  }

  private validateCapability(capability: Capability): void {
    if (!capability.id || typeof capability.id !== "string" || capability.id.trim() === "") {
      throw new InvalidCapabilityMetadataError("", "Capability ID must be a non-empty string");
    }
    if (
      !capability.providerModule ||
      typeof capability.providerModule !== "string" ||
      capability.providerModule.trim() === ""
    ) {
      throw new InvalidCapabilityMetadataError(
        capability.id,
        "Provider module ID must be a non-empty string",
      );
    }
    if (
      typeof capability.priority !== "number" ||
      isNaN(capability.priority) ||
      capability.priority < 0
    ) {
      throw new InvalidCapabilityPriorityError(capability.id, capability.priority);
    }
    if (
      !capability.version ||
      typeof capability.version !== "string" ||
      capability.version.trim() === ""
    ) {
      throw new InvalidCapabilityMetadataError(
        capability.id,
        "Capability version must be a non-empty string",
      );
    }
  }

  private satisfiesVersion(version: string, range?: string): boolean {
    if (!range || range === "*") return true;

    const cleanRange = range.replace(/^[~^]/, "").trim();
    const rangeParts = cleanRange.split(".").map(Number);
    const verParts = version.split(".").map(Number);

    const rMajor = rangeParts[0] || 0;
    const rMinor = rangeParts[1] || 0;
    const rPatch = rangeParts[2] || 0;

    const vMajor = verParts[0] || 0;
    const vMinor = verParts[1] || 0;
    const vPatch = verParts[2] || 0;

    if (range.startsWith("^")) {
      return vMajor === rMajor && (vMinor > rMinor || (vMinor === rMinor && vPatch >= rPatch));
    } else if (range.startsWith("~")) {
      return vMajor === rMajor && vMinor === rMinor && vPatch >= rPatch;
    }

    return version === cleanRange;
  }
}
