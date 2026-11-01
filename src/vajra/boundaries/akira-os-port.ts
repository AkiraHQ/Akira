import { CapabilityDescriptor } from "../../contracts/capabilities/descriptor";
import { CapabilityRegistry } from "../../contracts/capabilities/registry";
import { Result, CorrelationMetadata, CapabilityFailure } from "../../contracts/results/result";
import { getCapabilityRegistry } from "../../akira-os/capabilities/host";

/**
 * Typed port interface mediating capability discovery and invocation via AKIRA OS.
 *
 * INVARIANTS:
 * - VAJRA always calls capabilities through this port.
 * - Invocations always pass { isVajra: true } in the caller context to ensure Rule N1 / N2 validation.
 * - CorrelationMetadata (Contract K19) is strictly propagated.
 */
export interface IAkiraOSPort {
  listAvailableCapabilities(): readonly CapabilityDescriptor[];

  executeCapability<TInput = unknown, TOutput = unknown>(
    name: string,
    input: TInput,
    correlation: CorrelationMetadata,
    context?: { isVajra?: boolean; idempotencyKey?: string },
  ): Promise<Result<TOutput, CapabilityFailure>>;
}

/**
 * Live adapter connecting to the canonical AKIRA OS CapabilityRegistry host.
 */
export class LiveAkiraOSAdapter implements IAkiraOSPort {
  private registry: CapabilityRegistry;

  constructor(registry?: CapabilityRegistry) {
    this.registry = registry ?? getCapabilityRegistry();
  }

  listAvailableCapabilities(): readonly CapabilityDescriptor[] {
    return Object.freeze(this.registry.list());
  }

  async executeCapability<TInput = unknown, TOutput = unknown>(
    name: string,
    input: TInput,
    correlation: CorrelationMetadata,
    context?: { isVajra?: boolean; idempotencyKey?: string },
  ): Promise<Result<TOutput, CapabilityFailure>> {
    // Invariant: VAJRA always explicitly declares isVajra: true in caller context
    return this.registry.invoke<TInput, TOutput>(name, input, correlation, {
      isVajra: context?.isVajra ?? true,
      idempotencyKey: context?.idempotencyKey,
    });
  }
}

/**
 * In-memory adapter with an isolated CapabilityRegistry for testing.
 */
export class InMemoryAkiraOSAdapter implements IAkiraOSPort {
  private registry: CapabilityRegistry;

  constructor(customRegistry?: CapabilityRegistry) {
    this.registry = customRegistry ?? new CapabilityRegistry();
  }

  getRegistry(): CapabilityRegistry {
    return this.registry;
  }

  listAvailableCapabilities(): readonly CapabilityDescriptor[] {
    return Object.freeze(this.registry.list());
  }

  async executeCapability<TInput = unknown, TOutput = unknown>(
    name: string,
    input: TInput,
    correlation: CorrelationMetadata,
    context?: { isVajra?: boolean; idempotencyKey?: string },
  ): Promise<Result<TOutput, CapabilityFailure>> {
    return this.registry.invoke<TInput, TOutput>(name, input, correlation, {
      isVajra: context?.isVajra ?? true,
      idempotencyKey: context?.idempotencyKey,
    });
  }
}
