process.env.AKIRA_DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initializeDatabase } from "../../src/persistence/initializer";
import { getDatabaseConnection } from "../../src/persistence/connection";
import { conversationRepository, taskRepository } from "../../src/persistence/repositories";
import {
  getCapabilityRegistry,
  resetCapabilityRegistry,
} from "../../src/akira-os/capabilities/host";
import { historicalRecall } from "../../src/akira-os/conversations/services";
import { eventBus } from "../../src/shared/infrastructure/event-bus";
import type { ChatConversation } from "../../src/shared/types/store-types";

// Ensure in-memory database is initialized
initializeDatabase();

describe("Phase 3J — Production Historical Recall Pipeline (First Cross-Domain Capability)", () => {
  beforeEach(() => {
    resetCapabilityRegistry();
    const db = getDatabaseConnection();
    db.prepare("DELETE FROM chat_messages").run();
    db.prepare("DELETE FROM conversations").run();
    db.prepare("DELETE FROM tasks").run();
    db.prepare("DELETE FROM timeline_events").run();
  });

  afterEach(() => {
    resetCapabilityRegistry();
    vi.restoreAllMocks();
  });

  it("Test 1 — End-to-end historical recall execution via canonical CapabilityRegistry host into SQLite", async () => {
    // 1. Seed conversation data into SQLite
    const seededConversation: ChatConversation = {
      id: "conv-sensor-test",
      title: "IoT Sensor Hardware Discussion",
      createdAt: "2026-07-15T10:00:00.000Z",
      updatedAt: "2026-07-15T10:30:00.000Z",
      messages: [
        {
          id: "msg-bme280",
          role: "user",
          text: "For FieldSense we settled on the BME280 sensor for high-precision telemetry.",
          createdAt: "2026-07-15T10:05:00.000Z",
        },
        {
          id: "msg-akira-ack",
          role: "akira",
          text: "Acknowledged. The BME280 provides temperature, humidity, and barometric pressure.",
          createdAt: "2026-07-15T10:06:00.000Z",
        },
      ],
    };
    conversationRepository.save([seededConversation]);

    // 2. Spy on the canonical CapabilityRegistry's invoke method
    const registry = getCapabilityRegistry();
    const invokeSpy = vi.spyOn(registry, "invoke");

    // 3. Invoke real production-facing entry point
    const evidence = await historicalRecall.search({
      terms: ["BME280"],
      limit: 5,
    });

    // 4. Verify canonical registry was the executor
    expect(invokeSpy).toHaveBeenCalledTimes(1);
    expect(invokeSpy).toHaveBeenCalledWith(
      "recall.search",
      expect.objectContaining({
        terms: ["BME280"],
        limit: 5,
      }),
      expect.objectContaining({
        requestId: expect.stringMatching(/^req_/),
        correlationId: expect.stringMatching(/^corr_/),
        invocationId: expect.stringMatching(/^inv_/),
      }),
      expect.objectContaining({ isInternal: true, isVajra: false }),
    );

    // 5. Verify returned evidence (both messages contain the term BME280)
    expect(Array.isArray(evidence)).toBe(true);
    expect(evidence.length).toBe(2);
    expect(evidence.some((e) => e.messageId === "msg-bme280")).toBe(true);
    expect(evidence.some((e) => e.messageId === "msg-akira-ack")).toBe(true);
    expect(evidence[0].conversationId).toBe("conv-sensor-test");
  });

  it("Test 2 — Rule N2 Tier-2 On-Demand Activation occurs upon permitted invocation", async () => {
    // 1. Fresh registry state: Tier-2 recall.search begins in 'inactive' state per Contract K9/K22
    resetCapabilityRegistry();
    const registry = getCapabilityRegistry();
    expect(registry.has("recall.search")).toBe(true);
    expect(registry.getActivationState("recall.search")).toBe("inactive");

    // 2. Seed a message
    conversationRepository.save([
      {
        id: "conv-activation",
        title: "Activation Protocol",
        createdAt: "2026-10-01T12:00:00.000Z",
        updatedAt: "2026-10-01T12:00:00.000Z",
        messages: [
          {
            id: "msg-act-1",
            role: "user",
            text: "Testing Tier 2 activation on demand.",
            createdAt: "2026-10-01T12:00:00.000Z",
          },
        ],
      },
    ]);

    // 3. Execute via production service
    const results = await historicalRecall.search({
      terms: ["activation"],
      limit: 5,
    });

    // 4. Verify activation state transitioned to 'activated' per Rule N2
    expect(registry.getActivationState("recall.search")).toBe("activated");
    expect(results.length).toBe(1);
    expect(results[0].text).toContain("Tier 2 activation");
  });

  it("Test 3 — Empty search result returns clean empty array without error", async () => {
    conversationRepository.save([
      {
        id: "conv-empty-match",
        title: "Existing Conversation",
        createdAt: "2026-10-01T12:00:00.000Z",
        updatedAt: "2026-10-01T12:00:00.000Z",
        messages: [
          {
            id: "msg-other",
            role: "user",
            text: "Discussing quantum physics and gravity.",
            createdAt: "2026-10-01T12:00:00.000Z",
          },
        ],
      },
    ]);

    const results = await historicalRecall.search({
      terms: ["nonexistent_keyword_xyz123"],
      limit: 5,
    });

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  it("Test 4 — Enforces Zod input validation through CapabilityRegistry before querying repository", async () => {
    const repoSpy = vi.spyOn(conversationRepository, "searchMessages");

    // A. Empty terms array violates inputSchema min(1)
    await expect(
      historicalRecall.search({ terms: [], limit: 5 }),
    ).rejects.toThrow(/Failed to search historical recall via capability/);

    // B. Term with empty string violates term schema min(1)
    await expect(
      historicalRecall.search({ terms: [""], limit: 5 }),
    ).rejects.toThrow(/Failed to search historical recall via capability/);

    // Repository must NOT have been called on validation failure
    expect(repoSpy).not.toHaveBeenCalled();
  });

  it("Test 5 — Excludes messages belonging to active conversation (excludeConversationId)", async () => {
    // Seed two conversations containing the same term
    conversationRepository.save([
      {
        id: "conv-past",
        title: "Past Meeting",
        createdAt: "2026-08-01T10:00:00.000Z",
        updatedAt: "2026-08-01T10:00:00.000Z",
        messages: [
          {
            id: "msg-past",
            role: "user",
            text: "Remember we chose PostgreSQL for database storage.",
            createdAt: "2026-08-01T10:00:00.000Z",
          },
        ],
      },
      {
        id: "conv-current",
        title: "Current Turn",
        createdAt: "2026-10-04T10:00:00.000Z",
        updatedAt: "2026-10-04T10:00:00.000Z",
        messages: [
          {
            id: "msg-current",
            role: "user",
            text: "What about PostgreSQL storage?",
            createdAt: "2026-10-04T10:00:00.000Z",
          },
        ],
      },
    ]);

    // Search excluding current conversation
    const results = await historicalRecall.search({
      terms: ["PostgreSQL"],
      limit: 5,
      excludeConversationId: "conv-current",
    });

    // Only past conversation evidence must be returned
    expect(results.length).toBe(1);
    expect(results[0].conversationId).toBe("conv-past");
    expect(results[0].messageId).toBe("msg-past");
  });

  it("Test 6 — Query Side-Effect Invariant: zero mutations and zero DomainEvents emitted", async () => {
    const db = getDatabaseConnection();

    // Seed state
    conversationRepository.save([
      {
        id: "conv-side-effect",
        title: "Side Effect Invariant",
        createdAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
        messages: [
          {
            id: "msg-se-1",
            role: "user",
            text: "Immutable query verification.",
            createdAt: "2026-09-01T10:00:00.000Z",
          },
        ],
      },
    ]);

    // Snapshot database table row counts before query
    const countMessagesBefore = (db.prepare("SELECT COUNT(*) as c FROM chat_messages").get() as { c: number }).c;
    const countConvsBefore = (db.prepare("SELECT COUNT(*) as c FROM conversations").get() as { c: number }).c;
    const countTasksBefore = (db.prepare("SELECT COUNT(*) as c FROM tasks").get() as { c: number }).c;
    const countEventsBefore = (db.prepare("SELECT COUNT(*) as c FROM timeline_events").get() as { c: number }).c;

    // Spy on Contract K3 eventBus
    const eventBusSpy = vi.spyOn(eventBus, "publish");

    // Execute query
    const results = await historicalRecall.search({
      terms: ["Immutable"],
      limit: 5,
    });
    expect(results.length).toBe(1);

    // Verify row counts are 100% unchanged
    const countMessagesAfter = (db.prepare("SELECT COUNT(*) as c FROM chat_messages").get() as { c: number }).c;
    const countConvsAfter = (db.prepare("SELECT COUNT(*) as c FROM conversations").get() as { c: number }).c;
    const countTasksAfter = (db.prepare("SELECT COUNT(*) as c FROM tasks").get() as { c: number }).c;
    const countEventsAfter = (db.prepare("SELECT COUNT(*) as c FROM timeline_events").get() as { c: number }).c;

    expect(countMessagesAfter).toBe(countMessagesBefore);
    expect(countConvsAfter).toBe(countConvsBefore);
    expect(countTasksAfter).toBe(countTasksBefore);
    expect(countEventsAfter).toBe(countEventsBefore);

    // Contract K3 Query Invariant: Queries MUST NOT emit domain events
    expect(eventBusSpy).not.toHaveBeenCalled();
  });

  it("Test 7 — Verifies host capability registrations for Phase 3J slice", () => {
    const registry = getCapabilityRegistry();

    // 1. task.create (Command, Phase 3F)
    expect(registry.has("task.create")).toBe(true);
    expect(registry.get("task.create")?.descriptor.kind).toBe("Command");

    // 2. task.read (Query, Phase 3G)
    expect(registry.has("task.read")).toBe(true);
    expect(registry.get("task.read")?.descriptor.kind).toBe("Query");

    // 3. task.update (Command, Phase 3H)
    expect(registry.has("task.update")).toBe(true);
    expect(registry.get("task.update")?.descriptor.kind).toBe("Command");

    // 4. recall.search (Query, Phase 3J)
    expect(registry.has("recall.search")).toBe(true);
    expect(registry.get("recall.search")?.descriptor.kind).toBe("Query");
    expect(registry.get("recall.search")?.descriptor.owner).toBe("AKIRA OS · search");
    expect(registry.get("recall.search")?.descriptor.activationTier).toBe(2);

    // 5. task.list is registered (Phase 3K)
    expect(registry.has("task.list")).toBe(true);

    // 6. Unintegrated capabilities remain unregistered
    expect(registry.has("project.read")).toBe(false);
    expect(registry.has("project.list")).toBe(false);
  });

  it("Test 8 — Proves querySearchMessages server function exists, is configured as POST, and agrees on contract", async () => {
    const { querySearchMessages, searchRecallViaCapability } = await import(
      "../../src/akira-os/conversations/server"
    );

    expect(typeof querySearchMessages).toBe("function");
    expect(querySearchMessages.method).toBe("POST");
    expect(typeof searchRecallViaCapability).toBe("function");

    // Seed conversation
    conversationRepository.save([
      {
        id: "conv-server-fn",
        title: "Server Function Test",
        createdAt: "2026-10-02T10:00:00.000Z",
        updatedAt: "2026-10-02T10:00:00.000Z",
        messages: [
          {
            id: "msg-sfn-1",
            role: "user",
            text: "Testing server function directly.",
            createdAt: "2026-10-02T10:00:00.000Z",
          },
        ],
      },
    ]);

    const result = await searchRecallViaCapability({
      terms: ["directly"],
      limit: 10,
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0].text).toContain("directly");
  });
});
