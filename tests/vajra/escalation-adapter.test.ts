import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import {
  LiveEscalationAdapter,
  EscalationRequest,
} from "../../src/vajra/boundaries/escalation-port";
import { SqliteOperationalStateStore } from "../../src/persistence/vajra/sqlite-operational-state-store";
import { EventBus } from "../../src/instrumentation/event-bus";
import { AkiraEvent } from "../../src/instrumentation/event-types";

describe("LiveEscalationAdapter (Phase 8A / Part A)", () => {
  let db: Database.Database;
  let stateStore: SqliteOperationalStateStore;
  let eventBus: EventBus;
  let adapter: LiveEscalationAdapter;
  let capturedEvents: AkiraEvent[];

  beforeEach(() => {
    // 1. Initialize in-memory SQLite database
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    // Apply baseline schema
    const schemaPath = path.join(process.cwd(), "src", "persistence", "schema.sql");
    db.exec(fs.readFileSync(schemaPath, "utf8"));
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (1, ?)").run(
      new Date().toISOString(),
    );

    // Apply Phase 3 migration with vajra_escalations table
    const migPath = path.join(
      process.cwd(),
      "src",
      "persistence",
      "migrations",
      "003_vajra_operational_state.sql",
    );
    db.exec(fs.readFileSync(migPath, "utf8"));
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (3, ?)").run(
      new Date().toISOString(),
    );

    stateStore = new SqliteOperationalStateStore(db);

    // 2. Setup isolated EventBus
    eventBus = new EventBus();
    capturedEvents = [];
    eventBus.subscribe({
      id: "test-escalation-subscriber",
      onEvent: (event) => {
        capturedEvents.push(event);
      },
    });

    // 3. Initialize LiveEscalationAdapter
    adapter = new LiveEscalationAdapter({ stateStore, eventPublisher: eventBus });
  });

  afterEach(() => {
    db.close();
  });

  it("persists a new escalation request into vajra_escalations with PENDING_APPROVAL", async () => {
    const request: EscalationRequest = {
      id: "esc-test-101",
      action: "reboot_machine",
      impactClass: "HIGH",
      riskExplanation: "Potential operational interruption",
      correlation: {
        requestId: "req-101",
        correlationId: "corr-101",
        invocationId: "inv-101",
      },
    };

    const response = await adapter.requestApproval(request);
    expect(response.approved).toBe(false);
    expect(response.humanComment).toContain("Pending human approval");

    // Verify row in database
    const record = await adapter.getEscalation("esc-test-101");
    expect(record).not.toBeNull();
    expect(record?.id).toBe("esc-test-101");
    expect(record?.status).toBe("PENDING_APPROVAL");
    expect(record?.actionProposed).toBe("reboot_machine");
    expect(record?.impactClass).toBe("HIGH");
    expect(record?.riskExplanation).toBe("Potential operational interruption");
    expect(record?.requestId).toBe("req-101");
    expect(record?.correlationId).toBe("corr-101");
    expect(record?.createdAt).toBeDefined();
    expect(record?.resolvedAt).toBeNull();

    // Verify event bus publication
    const requestedEvents = capturedEvents.filter((e) => e.type === "vajra.escalation.requested");
    expect(requestedEvents).toHaveLength(1);
    expect(requestedEvents[0].correlationId).toBe("corr-101");
    expect((requestedEvents[0].payload as any).id).toBe("esc-test-101");
  });

  it("returns existing APPROVED resolution if already approved in database", async () => {
    const request: EscalationRequest = {
      id: "esc-pre-approved",
      action: "delete_temp_files",
      impactClass: "LOW",
      riskExplanation: "Safe cleanup operation",
      correlation: {
        requestId: "req-pre",
        correlationId: "corr-pre",
        invocationId: "inv-pre",
      },
    };

    // First request creates it as pending
    await adapter.requestApproval(request);

    // Resolve as approved
    await adapter.resolve("esc-pre-approved", true, "Authorized by lead operator");

    // Second request detects approval
    const secondResponse = await adapter.requestApproval(request);
    expect(secondResponse.approved).toBe(true);
    expect(secondResponse.humanComment).toBe("Authorized by lead operator");
    expect(secondResponse.resolvedAt).toBeDefined();
  });

  it("returns existing REJECTED resolution if already rejected in database", async () => {
    const request: EscalationRequest = {
      id: "esc-pre-rejected",
      action: "wipe_database",
      impactClass: "HIGH",
      riskExplanation: "Destructive action",
      correlation: {
        requestId: "req-rej",
        correlationId: "corr-rej",
        invocationId: "inv-rej",
      },
    };

    await adapter.requestApproval(request);
    await adapter.resolve("esc-pre-rejected", false, "Disallowed in production");

    const response = await adapter.requestApproval(request);
    expect(response.approved).toBe(false);
    expect(response.humanComment).toBe("Disallowed in production");
  });

  it("supports getPendingEscalations() and filters out resolved records", async () => {
    await adapter.requestApproval({
      id: "esc-p1",
      action: "act-1",
      impactClass: "LOW",
      riskExplanation: "risk-1",
      correlation: { requestId: "r1", correlationId: "c1", invocationId: "i1" },
    });
    await adapter.requestApproval({
      id: "esc-p2",
      action: "act-2",
      impactClass: "MEDIUM",
      riskExplanation: "risk-2",
      correlation: { requestId: "r2", correlationId: "c2", invocationId: "i2" },
    });

    let pending = await adapter.getPendingEscalations();
    expect(pending).toHaveLength(2);
    expect(pending[0].id).toBe("esc-p1");
    expect(pending[1].id).toBe("esc-p2");

    // Resolve one
    await adapter.resolve("esc-p1", true, "OK");

    pending = await adapter.getPendingEscalations();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe("esc-p2");
  });

  it("publishes transient notifications across event bus and logs", () => {
    adapter.notify("High CPU load detected", "warning");
    adapter.notify("Operation initiated normally", "info");

    const notifications = capturedEvents.filter((e) => e.type === "vajra.escalation.notification");
    expect(notifications).toHaveLength(2);
    expect(notifications[0].transient).toBe(true);
    expect((notifications[0].payload as any).level).toBe("warning");
    expect((notifications[0].payload as any).message).toBe("High CPU load detected");
    expect((notifications[1].payload as any).level).toBe("info");
  });

  it("throws explicitly and fails closed when persistence fails", async () => {
    // Force persistence failure by closing database
    db.close();

    const request: EscalationRequest = {
      id: "esc-fail",
      action: "unsafe_action",
      impactClass: "HIGH",
      riskExplanation: "Should fail gracefully",
      correlation: { requestId: "rf", correlationId: "cf", invocationId: "if" },
    };

    await expect(adapter.requestApproval(request)).rejects.toThrow(
      /Failed to persist escalation request/i,
    );
  });
});
