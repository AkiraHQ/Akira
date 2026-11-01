import { CapabilityDescriptor } from "./descriptor";
import { Result, CorrelationMetadata, CapabilityFailure } from "../results/result";
import { capabilityExecutionContext } from "./execution-context";

/**
 * Capability Execution Handler Function.
 */
export type CapabilityHandler<TInput = any, TOutput = any> = (
  input: TInput,
  correlation: CorrelationMetadata,
) => Promise<TOutput> | TOutput;

/**
 * Capability Lifecycle Hooks per Contract K9.
 */
export interface CapabilityLifecycleHooks {
  onActivate?: () => Promise<void> | void;
  onDeactivate?: () => Promise<void> | void;
}

/**
 * Caller Context metadata for permission checking per Contract K7 / Rule N1 / Rule N2.
 */
export interface CapabilityCallerContext {
  isVajra?: boolean;
  isInternal?: boolean;
  isExternalMcp?: boolean;
  idempotencyKey?: string;
}

export type ActivationState = "activated" | "inactive";

export interface RegisteredCapability<TInput = any, TOutput = any> {
  descriptor: CapabilityDescriptor<TInput, TOutput>;
  handler: CapabilityHandler<TInput, TOutput>;
  activationState: ActivationState;
  hooks?: CapabilityLifecycleHooks;
  /** Set by AKIRA OS to simulate resource-management declination (Rule N2) */
  declineActivation?: boolean;
}

/**
 * AKIRA OS Capability Registry Host per Contract K8 / Contract K14 / Decision D2.
 * Tracks registered capabilities, validates availability, manages Contract K9/K22 lifecycle states,
 * and enforces Rule N2 on-demand activation and Rule N3 GENESIS Command-freedom.
 */
export class CapabilityRegistry {
  private capabilities = new Map<string, RegisteredCapability>();

  /**
   * Register a capability descriptor, handler, and optional lifecycle hooks.
   * Tier 0/1 capabilities default to 'activated' (warm at boot).
   * Tier 2 capabilities default to 'inactive' (on-demand per Contract K22).
   */
  register<TInput, TOutput>(
    descriptor: CapabilityDescriptor<TInput, TOutput>,
    handler: CapabilityHandler<TInput, TOutput>,
    hooks?: CapabilityLifecycleHooks,
  ): void {
    if (!descriptor.name || descriptor.name.trim() === "") {
      throw new Error("Capability registration failed: descriptor name cannot be empty.");
    }

    if (this.capabilities.has(descriptor.name)) {
      throw new Error(
        `Capability registration failed: capability '${descriptor.name}' is already registered.`,
      );
    }

    // Rule N3 Enforcement: GENESIS exposes ONLY Query capabilities (no Commands to GENESIS or from GENESIS)
    if (descriptor.owner.toLowerCase().includes("genesis") && descriptor.kind === "Command") {
      throw new Error(
        `Rule N3 Violation: GENESIS capability '${descriptor.name}' cannot be a Command capability. GENESIS exposes only Queries.`,
      );
    }

    // Default activation state: Tier 0/1 are warm ('activated'), Tier 2 are on-demand ('inactive')
    const initialActivationState: ActivationState =
      descriptor.activationTier === 2 ? "inactive" : "activated";

    this.capabilities.set(descriptor.name, {
      descriptor,
      handler,
      activationState: initialActivationState,
      hooks,
    });
  }

  /**
   * Check if a capability is registered.
   */
  has(name: string): boolean {
    return this.capabilities.has(name);
  }

  /**
   * Get a registered capability entry by name.
   */
  get(name: string): RegisteredCapability | undefined {
    return this.capabilities.get(name);
  }

  /**
   * Get current activation state of a registered capability ('activated', 'inactive', or 'unregistered').
   */
  getActivationState(name: string): ActivationState | "unregistered" {
    const entry = this.capabilities.get(name);
    if (!entry) return "unregistered";
    return entry.activationState;
  }

  /**
   * Explicitly set declineActivation flag for AKIRA OS resource management tests.
   */
  setDeclineActivation(name: string, decline: boolean): void {
    const entry = this.capabilities.get(name);
    if (entry) {
      entry.declineActivation = decline;
    }
  }

  /**
   * Activate an inactive capability per Contract K9 / Contract K14 / Rule N2.
   * Returns true if activated successfully, false if unregistered, unavailable, or declined by OS.
   */
  async activate(name: string): Promise<boolean> {
    const entry = this.capabilities.get(name);

    if (!entry || !entry.descriptor.isAvailable) {
      return false;
    }

    if (entry.activationState === "activated") {
      return true;
    }

    // OS Declination / Resource Management check (Rule N2)
    if (entry.declineActivation) {
      return false;
    }

    try {
      if (entry.hooks?.onActivate) {
        await entry.hooks.onActivate();
      }
      entry.activationState = "activated";
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Deactivate an active capability back to 'inactive' state per Contract K9 / K14.
   */
  async deactivate(name: string): Promise<boolean> {
    const entry = this.capabilities.get(name);

    if (!entry) {
      return false;
    }

    if (entry.activationState === "inactive") {
      return true;
    }

    try {
      if (entry.hooks?.onDeactivate) {
        await entry.hooks.onDeactivate();
      }
      entry.activationState = "inactive";
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all registered capability descriptors.
   */
  list(): CapabilityDescriptor[] {
    return Array.from(this.capabilities.values()).map((entry) => entry.descriptor);
  }

  /**
   * Unregister a capability.
   */
  unregister(name: string): boolean {
    return this.capabilities.delete(name);
  }

  /**
   * Invoke a capability by name with permission verification, Rule N2 Tier 2 auto-activation,
   * Zod input validation, and uniform Result wrapping.
   */
  async invoke<TInput = unknown, TOutput = unknown>(
    name: string,
    input: TInput,
    correlation: CorrelationMetadata,
    callerContext?: CapabilityCallerContext,
  ): Promise<Result<TOutput, CapabilityFailure>> {
    const entry = this.capabilities.get(name);

    // 1. Registration check: unregistered capabilities cannot be invoked or activated
    if (!entry) {
      return Result.failure<CapabilityFailure>(
        {
          category: "capability_unavailable",
          message: `Capability '${name}' is not registered.`,
        },
        correlation,
      );
    }

    // 2. Availability check: unavailable capabilities cannot be invoked or activated on demand
    if (!entry.descriptor.isAvailable) {
      return Result.failure<CapabilityFailure>(
        {
          category: "capability_unavailable",
          message: `Capability '${name}' is currently unavailable.`,
        },
        correlation,
      );
    }

    // 3. Permission / Authorization check BEFORE activation (Rule N2 Constraint)
    // Default caller context is internal non-VAJRA caller
    const ctx: CapabilityCallerContext = callerContext || { isInternal: true };
    let isPermitted = true;

    if (ctx.isInternal && entry.descriptor.permissions.allowInternal === false) {
      isPermitted = false;
    }
    if (ctx.isExternalMcp && entry.descriptor.permissions.allowExternalMcp !== true) {
      isPermitted = false;
    }
    if (ctx.isVajra && entry.descriptor.permissions.allowVajra === false) {
      isPermitted = false;
    }

    // Rule N1 Condition 5 Enforcement: Direct internal Commands to HANDS or GENESIS are not permitted
    if (
      ctx.isInternal &&
      entry.descriptor.kind === "Command" &&
      (entry.descriptor.owner.toLowerCase().includes("hands") ||
        entry.descriptor.owner.toLowerCase().includes("genesis"))
    ) {
      isPermitted = false;
    }

    if (!isPermitted) {
      return Result.failure<CapabilityFailure>(
        {
          category: "command_rejection",
          message: `Invocation disallowed by permissions or Rule N1 boundary for capability '${name}'.`,
        },
        correlation,
      );
    }

    // 4. Rule N2 On-Demand Activation for inactive Tier 2 capabilities
    if (entry.activationState === "inactive") {
      const activated = await this.activate(name);
      if (!activated) {
        return Result.failure<CapabilityFailure>(
          {
            category: "capability_unavailable",
            message: `AKIRA OS declined or failed on-demand activation for capability '${name}'.`,
          },
          correlation,
        );
      }
    }

    // 5. Input Validation using Descriptor's Zod Schema
    const parseResult = entry.descriptor.inputSchema.safeParse(input);
    if (!parseResult.success) {
      return Result.failure<CapabilityFailure>(
        {
          category: "invalid_request",
          message: `Input validation failed for capability '${name}'.`,
          details: parseResult.error.format(),
        },
        correlation,
      );
    }

    // 6. Execute Capability Handler inside scoped capabilityExecutionContext
    const execContext = {
      isVajra: ctx.isVajra === true,
      invocationId: correlation.invocationId,
      capabilityName: name,
      idempotencyKey: ctx.idempotencyKey,
    };

    return capabilityExecutionContext.run(execContext, async () => {
      try {
        const output = await entry.handler(parseResult.data, correlation);
        return Result.success<TOutput>(output, correlation);
      } catch (err: any) {
        return Result.failure<CapabilityFailure>(
          {
            category: "execution_failure",
            message: err?.message || `Execution error in capability '${name}'.`,
            details: err,
          },
          correlation,
        );
      }
    });
  }
}
