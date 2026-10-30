import { describe, it, expect } from "vitest";
import { LiveAkiraOSAdapter, InMemoryAkiraOSAdapter } from "../../src/vajra/boundaries/akira-os-port";
import { LiveGenesisAdapter, InMemoryGenesisAdapter } from "../../src/vajra/boundaries/genesis-port";
import { StubHandsAdapter } from "../../src/vajra/boundaries/hands-port";
import { InMemoryEscalationAdapter } from "../../src/vajra/boundaries/escalation-port";
import { CapabilityRegistry } from "../../src/contracts/capabilities/registry";
import { CapabilityDescriptor } from "../../src/contracts/capabilities/descriptor";
import { CorrelationMetadata } from "../../src/contracts/results/result";
import { z } from "zod";

describe("VAJRA Subsystem Boundaries & Adapters", () => {
  const correlation: CorrelationMetadata = {
    requestId: "req-bound-1",
    correlationId: "corr-bound-1",
    invocationId: "inv-bound-1",
  };

  describe("AKIRA OS Port & Adapters", () => {
    it("InMemoryAkiraOSAdapter lists capabilities and executes with isVajra: true", async () => {
      const customRegistry = new CapabilityRegistry();
      const descriptor: CapabilityDescriptor<{ count: number }, { doubled: number }> = {
        name: "math.double",
        kind: "Query",
        version: "1.0.0",
        owner: "AKIRA_OS",
        description: "Doubles a number",
        inputSchema: z.object({ count: z.number() }),
        outputSchema: z.object({ doubled: z.number() }),
        permissions: { allowVajra: true },
        executionCharacteristics: { isSynchronous: true, isReadOnly: true, isIdempotent: true },
        activationTier: 1,
        costClass: "local_cheap",
        isAvailable: true,
      };

      customRegistry.register(descriptor, (input) => ({ doubled: input.count * 2 }));
      const adapter = new InMemoryAkiraOSAdapter(customRegistry);

      expect(adapter.listAvailableCapabilities()).toHaveLength(1);
      expect(adapter.listAvailableCapabilities()[0].name).toBe("math.double");

      const result = await adapter.executeCapability("math.double", { count: 21 }, correlation);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ doubled: 42 });
      }
    });

    it("LiveAkiraOSAdapter connects to canonical registry without errors", () => {
      const liveAdapter = new LiveAkiraOSAdapter();
      const capabilities = liveAdapter.listAvailableCapabilities();
      expect(Array.isArray(capabilities)).toBe(true);
      // Canonical registry hosts task and search capabilities
      const names = capabilities.map((c) => c.name);
      expect(names).toContain("task.read");
      expect(names).toContain("task.create");
    });
  });

  describe("GENESIS Port & Adapters", () => {
    it("InMemoryGenesisAdapter stores, recalls memories, and retrieves traits", async () => {
      const adapter = new InMemoryGenesisAdapter();
      adapter.setMemories([
        { id: "m-1", content: "User likes TypeScript and clean architecture", relevance: 0.9 },
        { id: "m-2", content: "User is building AKIRA companion", relevance: 0.8 },
      ]);
      adapter.setTraits({
        technicalBackground: "staff_engineer",
        preferredTone: "concise",
        traits: { focus: "distributed_systems" },
      });

      const recallRes = await adapter.recallMemories("TypeScript", correlation);
      expect(recallRes.ok).toBe(true);
      if (recallRes.ok) {
        expect(recallRes.value.memories).toHaveLength(1);
        expect(recallRes.value.memories[0].content).toContain("TypeScript");
      }

      const traitsRes = await adapter.getIdentityTraits(correlation);
      expect(traitsRes.ok).toBe(true);
      if (traitsRes.ok) {
        expect(traitsRes.value.technicalBackground).toBe("staff_engineer");
      }
    });

    it("LiveGenesisAdapter handles missing services gracefully", async () => {
      const liveAdapter = new LiveGenesisAdapter();
      const recallRes = await liveAdapter.recallMemories("Anything", correlation);
      expect(recallRes.ok).toBe(true);
      if (recallRes.ok) {
        expect(recallRes.value.memories).toHaveLength(0);
      }

      const traitsRes = await liveAdapter.getIdentityTraits(correlation);
      expect(traitsRes.ok).toBe(true);
    });
  });

  describe("HANDS Port & Stub Adapter", () => {
    it("StubHandsAdapter rejects execution and reports unavailable", async () => {
      const hands = new StubHandsAdapter();
      expect(hands.isAvailable()).toBe(false);

      const res = await hands.executeSandbox("echo", ["hello"], correlation);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("HANDS execution engine is not active in Phase 2");
      }
    });
  });

  describe("Escalation Port & In-Memory Adapter", () => {
    it("records escalation requests and respects autoApprove setting", async () => {
      const escalation = new InMemoryEscalationAdapter();

      // Default: reject
      const res1 = await escalation.requestApproval({
        id: "esc-1",
        action: "delete_database",
        impactClass: "HIGH",
        riskExplanation: "Irreversible data loss",
        correlation,
      });
      expect(res1.approved).toBe(false);
      expect(escalation.getPendingRequests()).toHaveLength(1);

      // Enable autoApprove
      escalation.setAutoApprove(true);
      const res2 = await escalation.requestApproval({
        id: "esc-2",
        action: "rotate_keys",
        impactClass: "MEDIUM",
        riskExplanation: "Key rotation",
        correlation,
      });
      expect(res2.approved).toBe(true);
      expect(escalation.getPendingRequests()).toHaveLength(2);

      // Notifications
      escalation.notify("Attention needed", "warning");
      expect(escalation.getNotifications()).toHaveLength(1);
      expect(escalation.getNotifications()[0].level).toBe("warning");
    });
  });
});
