import { describe, it, expect } from "vitest";
import { DecisionArbiter } from "../../../src/vajra/decision/arbiter";
import { createInitialOperationalContext } from "../../../src/vajra/types/operational-context";
import { ApprovalManager } from "../../../src/vajra/decision/approval-manager";
import {
  createMockReasoningResult,
  createMockSelfModel,
  createMockStateStore,
} from "./fixtures";

describe("Strict Persistence Gate & Failure Semantics (Phase 5 §19)", () => {
  it("HALTS decision emission when appendAuditTrace fails (Zero unpersisted actions released)", async () => {
    const { store } = createMockStateStore();
    // Simulate SQLite disk error on trace persistence
    store.appendAuditTrace = async () => {
      throw new Error("SQLITE_IOERR: disk I/O error");
    };

    const arbiter = new DecisionArbiter(store);
    const selfModel = createMockSelfModel();
    const context = createInitialOperationalContext();
    const reasoning = createMockReasoningResult();

    const result = await arbiter.arbitrate(reasoning, context, selfModel);

    // Turn must fail immediately without releasing an unpersisted action
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error).toContain("DECISION_PERSISTENCE_FAILED");
    expect(result.error).toContain("SQLITE_IOERR");
  });

  it("HALTS decision emission when createEscalation fails for an escalated action", async () => {
    const { store } = createMockStateStore();
    // Simulate database error when persisting human escalation
    store.createEscalation = async () => {
      throw new Error("SQLITE_CORRUPT: database disk image is malformed");
    };

    const approvalManager = new ApprovalManager(store);
    const arbiter = new DecisionArbiter(store, undefined, undefined, undefined, approvalManager);
    const selfModel = createMockSelfModel({
      maxAutonomousCostCents: 0, // Force escalation due to spend limit
    });
    const context = {
      ...createInitialOperationalContext(),
      currentFocus: "High impact mission",
    };
    const reasoning = createMockReasoningResult();

    const result = await arbiter.arbitrate(reasoning, context, selfModel);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error).toContain("Failed to persist human escalation gate");
  });
});
