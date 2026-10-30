import { describe, it, expect } from "vitest";
import { createBelief } from "../../src/vajra/types/belief";
import { createStimulus } from "../../src/vajra/types/stimulus";
import { createExecutiveAction } from "../../src/vajra/types/action";
import { createDeliberationTrace } from "../../src/vajra/types/trace";
import { createInitialOperationalContext } from "../../src/vajra/types/operational-context";
import { CorrelationMetadata } from "../../src/contracts/results/result";

describe("VAJRA Pure Domain Contracts & Models", () => {
  const correlation: CorrelationMetadata = {
    requestId: "req-contract-1",
    correlationId: "corr-contract-1",
    invocationId: "inv-contract-1",
  };

  describe("EpistemicBelief (Target Architecture §13)", () => {
    it("creates a valid EpistemicBelief within confidence bounds [0, 1]", () => {
      const belief = createBelief({
        id: "b-1",
        proposition: "AKIRA OS SQLite runs in WAL mode",
        confidence: 0.95,
        verificationState: "VERIFIED",
        supportingEvidenceIds: ["obs-wal-1", "obs-wal-2"],
      });

      expect(belief.id).toBe("b-1");
      expect(belief.confidence).toBe(0.95);
      expect(belief.verificationState).toBe("VERIFIED");
      expect(belief.supportingEvidenceIds).toHaveLength(2);
      expect(Object.isFrozen(belief)).toBe(true);
    });

    it("rejects invalid confidence values outside [0, 1]", () => {
      expect(() =>
        createBelief({
          id: "b-inv-1",
          proposition: "Invalid high confidence",
          confidence: 1.5,
        }),
      ).toThrow(RangeError);

      expect(() =>
        createBelief({
          id: "b-inv-2",
          proposition: "Negative confidence",
          confidence: -0.1,
        }),
      ).toThrow(RangeError);

      expect(() =>
        createBelief({
          id: "b-inv-3",
          proposition: "NaN confidence",
          confidence: NaN,
        }),
      ).toThrow(RangeError);
    });

    it("transitions state to CONTRADICTED if contradictory evidence is present", () => {
      const belief = createBelief({
        id: "b-conflict",
        proposition: "File exists on disk",
        confidence: 0.5,
        verificationState: "VERIFIED",
        contradictingEvidenceIds: ["obs-file-missing"],
      });

      // Invariant: cannot remain VERIFIED when contradictory evidence exists
      expect(belief.verificationState).toBe("CONTRADICTED");
      expect(belief.contradictingEvidenceIds).toContain("obs-file-missing");
    });
  });

  describe("CognitiveStimulus & ExecutiveAction", () => {
    it("creates immutable stimulus preserving correlation metadata", () => {
      const stimulus = createStimulus({
        id: "stim-c1",
        kind: "human_prompt",
        source: "desktop_chat",
        payload: { prompt: "Analyze performance" },
        correlation,
      });

      expect(stimulus.id).toBe("stim-c1");
      expect(stimulus.kind).toBe("human_prompt");
      expect(stimulus.correlation.requestId).toBe("req-contract-1");
      expect(Object.isFrozen(stimulus)).toBe(true);
    });

    it("creates validated ExecutiveAction", () => {
      const action = createExecutiveAction({
        id: "act-c1",
        kind: "answer_conversation",
        rationale: "Direct informational query",
        confidence: 0.98,
        policyCompliance: true,
        correlation,
      });

      expect(action.id).toBe("act-c1");
      expect(action.kind).toBe("answer_conversation");
      expect(action.confidence).toBe(0.98);
      expect(Object.isFrozen(action)).toBe(true);
    });

    it("rejects ExecutiveAction with invalid confidence", () => {
      expect(() =>
        createExecutiveAction({
          id: "act-err",
          kind: "answer_conversation",
          rationale: "Err",
          confidence: 2.0,
          policyCompliance: true,
          correlation,
        }),
      ).toThrow(RangeError);
    });
  });

  describe("DeliberationTrace (Deterministic Explainability)", () => {
    it("constructs a frozen audit trace", () => {
      const trace = createDeliberationTrace({
        traceId: "trace-001",
        stimulusId: "stim-001",
        correlation,
        intentClass: "operational_command",
        consideredOptions: [
          { action: "run_immediately", risk: "HIGH", confidence: 0.7 },
          { action: "ask_confirmation", risk: "LOW", confidence: 0.95 },
        ],
        selectedOption: "ask_confirmation",
        rationale: "High impact operation requires confirmation.",
        evidenceReliedUpon: ["obs-policy-threshold"],
        escalationRequired: true,
      });

      expect(trace.traceId).toBe("trace-001");
      expect(trace.consideredOptions).toHaveLength(2);
      expect(trace.escalationRequired).toBe(true);
      expect(Object.isFrozen(trace)).toBe(true);
      expect(Object.isFrozen(trace.consideredOptions)).toBe(true);
    });
  });

  describe("OperationalContext Defaults", () => {
    it("initializes with safe default context", () => {
      const ctx = createInitialOperationalContext();
      expect(ctx.mode).toBe("REQUEST_DRIVEN");
      expect(ctx.systemHealthStatus).toBe("NOMINAL");
      expect(ctx.activeMissionId).toBeNull();
      expect(ctx.humanPresence).toBe("FOCUSED_ACTIVE");
      expect(Object.isFrozen(ctx)).toBe(true);
    });
  });
});
