import { describe, it, expect } from "vitest";
import { DecisionArbiter } from "../../../src/vajra/decision/arbiter";
import { createInitialOperationalContext } from "../../../src/vajra/types/operational-context";
import { ApprovalManager } from "../../../src/vajra/decision/approval-manager";
import {
  createMockReasoningResult,
  createMockSelfModel,
  createMockStateStore,
} from "./fixtures";

describe("DecisionArbiter End-to-End Arbitration (Phase 5 §7 & §17)", () => {
  it("Emits an authoritative, immutable ExecutiveAction with full decision provenance", async () => {
    const { store, data } = createMockStateStore();
    const arbiter = new DecisionArbiter(store);
    const selfModel = createMockSelfModel();
    const context = createInitialOperationalContext();
    const reasoning = createMockReasoningResult();

    const result = await arbiter.arbitrate(reasoning, context, selfModel);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    const action = result.value;

    // Verify Decision Provenance
    expect(action.id).toBeDefined();
    expect(action.decisionId).toBeDefined();
    expect(action.authorityLevel).toBe(1);
    expect(action.policyBasis).toBeDefined();
    expect(action.policyVersion).toBe("1.0.0");
    expect(action.stateVersion).toBe(context.version);
    expect(action.idempotencyKey).toBeDefined();
    expect(action.decidedAt).toBeDefined();

    // Verify Immutability
    expect(Object.isFrozen(action)).toBe(true);
    expect(Object.isFrozen(action.correlation)).toBe(true);

    // Verify Auditable DeliberationTrace committed to SQLite
    expect(data.traces.length).toBe(1);
    const trace = data.traces[0];
    expect(trace.traceId).toContain(action.decisionId!);
    expect(trace.selectedOption).toContain(action.id);
  });

  it("Gates high-impact actions through human approval and records escalation", async () => {
    const { store, data } = createMockStateStore();
    const approvalManager = new ApprovalManager(store);
    const arbiter = new DecisionArbiter(store, undefined, undefined, undefined, approvalManager);
    const selfModel = createMockSelfModel({
      maxAutonomousCostCents: 0, // Force approval
    });
    const context = {
      ...createInitialOperationalContext(),
      currentFocus: "Perform paid API task",
    };
    const reasoning = createMockReasoningResult();

    const result = await arbiter.arbitrate(reasoning, context, selfModel);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    const action = result.value;

    expect(action.kind).toBe("escalate_to_human");
    expect(action.approvalState).toBe("APPROVAL_REQUIRED");
    expect(action.escalationId).toBeDefined();
    expect(data.escalations.has(action.escalationId!)).toBe(true);
  });

  it("Immediately halts when state version is stale (contextVersion mismatch)", async () => {
    const { store } = createMockStateStore();
    const arbiter = new DecisionArbiter(store);
    const selfModel = createMockSelfModel();
    const context = { ...createInitialOperationalContext(), version: 5 };
    const reasoning = createMockReasoningResult({ contextVersion: 1 }); // mismatch

    const result = await arbiter.arbitrate(reasoning, context, selfModel);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error).toContain("State version mismatch");
  });

  it("CRITICAL INVARIANT: Proves DecisionArbiter never mutates or persists epistemic beliefs", async () => {
    const { store, data } = createMockStateStore();
    const arbiter = new DecisionArbiter(store);
    const selfModel = createMockSelfModel();
    const context = createInitialOperationalContext();

    const reasoning = createMockReasoningResult({
      proposedBeliefUpdates: [
        {
          beliefId: "belief-01",
          proposition: "System is ready",
          currentConfidence: 0.5,
          proposedConfidence: 0.95,
          proposedVerificationState: "VERIFIED",
          rationale: "Evidence confirmed",
          supportingEvidenceIds: ["obs-01"],
        },
      ],
    });

    const result = await arbiter.arbitrate(reasoning, context, selfModel);
    expect(result.ok).toBe(true);

    // saveBelief MUST NOT have been called
    expect(data.savedBeliefCalls).toBe(0);
  });
});
