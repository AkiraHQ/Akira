process.env.AKIRA_DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initializeDatabase } from "../../src/persistence/initializer";

initializeDatabase();

import { conversationRepository } from "../../src/persistence/repositories";
import { CapabilityRegistry } from "../../src/contracts/capabilities/registry";
import {
  registerRecallSearchCapability,
  recallSearchDescriptor,
} from "../../src/akira-os/search/capabilities/recall-search";
import { CorrelationMetadata } from "../../src/contracts/results/result";
import { CapabilityDescriptor } from "../../src/contracts/capabilities/descriptor";
import { z } from "zod";

describe("Tier-2 Capability Lifecycle & Rule N2 On-Demand Activation Semantics", () => {
  let registry: CapabilityRegistry;

  const sampleCorrelation: CorrelationMetadata = {
    requestId: "req-tier2-123",
    correlationId: "corr-tier2-123",
    invocationId: "inv-tier2-123",
  };

  beforeEach(() => {
    registry = new CapabilityRegistry();
  });

  it("registers Tier-2 capability initially in 'inactive' activation state per Contract K9/K22", () => {
    registerRecallSearchCapability(registry);

    expect(registry.has("recall.search")).toBe(true);
    expect(registry.getActivationState("recall.search")).toBe("inactive");

    const entry = registry.get("recall.search");
    expect(entry?.descriptor.activationTier).toBe(2);
    expect(entry?.descriptor.owner).toBe("AKIRA OS · search");
  });

  it("activates an inactive Tier-2 capability on permitted non-VAJRA invocation (Rule N2 path)", async () => {
    const onActivateHook = vi.fn();
    const onDeactivateHook = vi.fn();

    registerRecallSearchCapability(registry, {
      onActivate: onActivateHook,
      onDeactivate: onDeactivateHook,
    });

    // Save a chat message to search against
    conversationRepository.save([
      {
        id: "conv-1",
        title: "Architecture Discussion",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [
          {
            id: "msg-1",
            role: "user",
            text: "How does Tier 2 activation work under Rule N2?",
            createdAt: new Date().toISOString(),
          },
        ],
      },
    ]);

    expect(registry.getActivationState("recall.search")).toBe("inactive");
    expect(onActivateHook).not.toHaveBeenCalled();

    // Permitted non-VAJRA invocation
    const res = await registry.invoke(
      "recall.search",
      { terms: ["Rule", "activation"], limit: 5 },
      sampleCorrelation,
      { isInternal: true },
    );

    // Verify Rule N2 On-Demand Activation occurred
    expect(onActivateHook).toHaveBeenCalledTimes(1);
    expect(registry.getActivationState("recall.search")).toBe("activated");

    // Verify successful execution result
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Array.isArray(res.value)).toBe(true);
      expect(res.value.length).toBeGreaterThan(0);
      expect(res.value[0].text).toContain("Tier 2 activation");
      expect(res.correlation).toEqual(sampleCorrelation);
    }
  });

  it("permits AKIRA OS to decline or defer activation returning category 'capability_unavailable' (Rule N2 declination)", async () => {
    const onActivateHook = vi.fn();
    registerRecallSearchCapability(registry, { onActivate: onActivateHook });

    // Set OS declination flag to simulate resource constraints
    registry.setDeclineActivation("recall.search", true);

    expect(registry.getActivationState("recall.search")).toBe("inactive");

    const res = await registry.invoke(
      "recall.search",
      { terms: ["search"], limit: 5 },
      sampleCorrelation,
      { isInternal: true },
    );

    // Activation must be declined, state remains inactive, handler NOT called
    expect(onActivateHook).not.toHaveBeenCalled();
    expect(registry.getActivationState("recall.search")).toBe("inactive");

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.category).toBe("capability_unavailable");
      expect(res.error.message).toContain("declined");
      expect(res.correlation).toEqual(sampleCorrelation);
    }
  });

  it("does NOT activate an inactive Tier-2 capability if invocation is disallowed by permissions (Rule N2 constraint)", async () => {
    const onActivateHook = vi.fn();

    // Create a Tier 2 capability with allowExternalMcp: false
    const restrictedDescriptor: CapabilityDescriptor<{ query: string }, string> = {
      name: "restricted.tier2",
      version: "1.0.0",
      owner: "AKIRA OS · internal",
      kind: "Query",
      inputSchema: z.object({ query: z.string() }),
      permissions: {
        allowInternal: true,
        allowVajra: false,
        allowExternalMcp: false, // Disallowed for MCP callers
      },
      activationTier: 2,
      isAvailable: true,
      costClass: "local_cheap",
      executionCharacteristics: { isSynchronous: true, isIdempotent: true, isReadOnly: true },
    };

    registry.register(restrictedDescriptor, (input) => input.query, {
      onActivate: onActivateHook,
    });

    expect(registry.getActivationState("restricted.tier2")).toBe("inactive");

    // Disallowed invocation attempt from external MCP caller
    const res = await registry.invoke(
      "restricted.tier2",
      { query: "secret" },
      sampleCorrelation,
      { isExternalMcp: true },
    );

    // Permission check MUST reject BEFORE activation attempt
    expect(onActivateHook).not.toHaveBeenCalled();
    expect(registry.getActivationState("restricted.tier2")).toBe("inactive");

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.category).toBe("command_rejection");
      expect(res.error.message).toContain("disallowed by permissions");
    }
  });

  it("does NOT activate an inactive Tier-2 capability if capability is marked unavailable (Rule N2 constraint)", async () => {
    const onActivateHook = vi.fn();

    const unavailableDescriptor: CapabilityDescriptor<{ query: string }, string> = {
      name: "unavailable.tier2",
      version: "1.0.0",
      owner: "AKIRA OS · search",
      kind: "Query",
      inputSchema: z.object({ query: z.string() }),
      permissions: { allowInternal: true },
      activationTier: 2,
      isAvailable: false, // Currently unavailable
      costClass: "local_cheap",
      executionCharacteristics: { isSynchronous: true, isIdempotent: true, isReadOnly: true },
    };

    registry.register(unavailableDescriptor, (input) => input.query, {
      onActivate: onActivateHook,
    });

    expect(registry.getActivationState("unavailable.tier2")).toBe("inactive");

    const res = await registry.invoke(
      "unavailable.tier2",
      { query: "test" },
      sampleCorrelation,
      { isInternal: true },
    );

    // Unavailable capability MUST NOT activate on demand
    expect(onActivateHook).not.toHaveBeenCalled();
    expect(registry.getActivationState("unavailable.tier2")).toBe("inactive");

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.category).toBe("capability_unavailable");
    }
  });

  it("deactivates an active Tier-2 capability back to 'inactive' state per Contract K9", async () => {
    const onActivateHook = vi.fn();
    const onDeactivateHook = vi.fn();

    registerRecallSearchCapability(registry, {
      onActivate: onActivateHook,
      onDeactivate: onDeactivateHook,
    });

    // Activate via invocation
    await registry.invoke(
      "recall.search",
      { terms: ["test"], limit: 1 },
      sampleCorrelation,
      { isInternal: true },
    );

    expect(registry.getActivationState("recall.search")).toBe("activated");

    // Deactivate explicitly
    const deactivated = await registry.deactivate("recall.search");

    expect(deactivated).toBe(true);
    expect(onDeactivateHook).toHaveBeenCalledTimes(1);
    expect(registry.getActivationState("recall.search")).toBe("inactive");
  });
});
