import { describe, it, expect } from "vitest";
import { ApprovalManager } from "../../../src/vajra/decision/approval-manager";
import { DecisionOption } from "../../../src/vajra/decision/types";
import { DEFAULT_POLICY_ENVELOPE, PolicyEnvelope } from "../../../src/vajra/types/policy";
import { createInitialOperationalContext } from "../../../src/vajra/types/operational-context";
import { InMemoryEscalationAdapter } from "../../../src/vajra/boundaries/escalation-port";
import {
  createMockCorrelation,
  createMockStateStore,
} from "./fixtures";

describe("ApprovalManager (Phase 5 §14)", () => {
  const option: DecisionOption = {
    id: "opt-upgrade",
    kind: "start_mission",
    intent: "Deploy schema migration",
    targetCapability: "task.create",
    estimatedCostCents: 5,
    estimatedSteps: 2,
    impactClass: "HIGH",
    reversibility: "IRREVERSIBLE",
    requiredEvidence: [],
    rationale: "Requires human authorization",
  };

  it("Creates durable escalation in state store and dispatches notification", async () => {
    const { store, data } = createMockStateStore();
    const escalationPort = new InMemoryEscalationAdapter();
    const manager = new ApprovalManager(store, escalationPort);
    const context = createInitialOperationalContext();
    const correlation = createMockCorrelation("esc-test");

    const record = await manager.createApprovalGate({
      decisionId: "dec-01",
      actionId: "act-01",
      option,
      context,
      policy: DEFAULT_POLICY_ENVELOPE,
      rationale: "High-impact migration",
      correlation,
    });

    expect(record.status).toBe("PENDING_APPROVAL");
    expect(data.escalations.has(record.id)).toBe(true);
    expect(escalationPort.getPendingRequests().length).toBe(1);
    expect(escalationPort.getPendingRequests()[0].id).toBe(record.id);
  });

  it("Validates approved escalation when context version matches", async () => {
    const { store } = createMockStateStore();
    const manager = new ApprovalManager(store);
    const context = createInitialOperationalContext();
    const correlation = createMockCorrelation("esc-approved");

    const record = await manager.createApprovalGate({
      decisionId: "dec-02",
      actionId: "act-02",
      option,
      context,
      policy: DEFAULT_POLICY_ENVELOPE,
      rationale: "Approved test",
      correlation,
    });

    // Simulate human approval
    await store.resolveEscalation(record.id, "APPROVED", "Approved by admin");

    const validation = await manager.validateApproval(record.id, context, DEFAULT_POLICY_ENVELOPE);
    expect(validation.valid).toBe(true);
    expect(validation.status).toBe("APPROVED");
  });

  it("Invalidates approval when context version advances mid-turn (STALE)", async () => {
    const { store, data } = createMockStateStore();
    const manager = new ApprovalManager(store);
    const context = createInitialOperationalContext(); // version: 1
    const correlation = createMockCorrelation("esc-stale");

    const record = await manager.createApprovalGate({
      decisionId: "dec-03",
      actionId: "act-03",
      option,
      context,
      policy: DEFAULT_POLICY_ENVELOPE,
      rationale: "Stale test",
      correlation,
    });

    // Advance context version to 2
    const advancedContext = { ...context, version: 2 };

    const validation = await manager.validateApproval(record.id, advancedContext, DEFAULT_POLICY_ENVELOPE);
    expect(validation.valid).toBe(false);
    expect(validation.status).toBe("STALE");
    expect(validation.reason).toContain("State version advanced mid-turn");

    // Escalation is cancelled in state store
    const updated = data.escalations.get(record.id);
    expect(updated?.status).toBe("CANCELLED");
  });

  it("Invalidates approval when policy version changes (STALE)", async () => {
    const { store } = createMockStateStore();
    const manager = new ApprovalManager(store);
    const context = createInitialOperationalContext();
    const correlation = createMockCorrelation("esc-policy-stale");

    const record = await manager.createApprovalGate({
      decisionId: "dec-04",
      actionId: "act-04",
      option,
      context,
      policy: { ...DEFAULT_POLICY_ENVELOPE, policyVersion: "1.0.0" },
      rationale: "Policy stale test",
      correlation,
    });

    // Modified policy version
    const updatedPolicy: PolicyEnvelope = {
      ...DEFAULT_POLICY_ENVELOPE,
      policyVersion: "2.0.0",
    };

    const validation = await manager.validateApproval(record.id, context, updatedPolicy);
    expect(validation.valid).toBe(false);
    expect(validation.status).toBe("STALE");
    expect(validation.reason).toContain("Policy envelope modified");
  });

  it("Marks approval EXPIRED when TTL is exceeded", async () => {
    const { store, data } = createMockStateStore();
    const manager = new ApprovalManager(store);
    const context = createInitialOperationalContext();
    const correlation = createMockCorrelation("esc-expired");

    // Policy with expired TTL (negative TTL)
    const expiredPolicy: PolicyEnvelope = {
      ...DEFAULT_POLICY_ENVELOPE,
      approvalTtlMs: -1000,
    };

    const record = await manager.createApprovalGate({
      decisionId: "dec-05",
      actionId: "act-05",
      option,
      context,
      policy: expiredPolicy,
      rationale: "Expired test",
      correlation,
    });

    const validation = await manager.validateApproval(record.id, context, expiredPolicy);
    expect(validation.valid).toBe(false);
    expect(validation.status).toBe("EXPIRED");

    const updated = data.escalations.get(record.id);
    expect(updated?.status).toBe("EXPIRED");
  });
});
