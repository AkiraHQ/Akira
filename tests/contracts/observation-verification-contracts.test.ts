/**
 * Phase 3D Contract Tests: K4 Observation and K6 VerificationRecord / MissionResult
 *
 * Tests verify:
 *  1. Required fields are present and correctly typed (K4, K6, K19)
 *  2. Observation is DISTINCT from Event (K3) and Result (K5)
 *  3. VerificationRecord is DISTINCT from Execution Result (K5)
 *  4. MissionResult semantics (I9: only VAJRA after verification)
 *  5. confidence [0,1] is enforced and required on every Observation
 *  6. provenance is present and required on every Observation
 *  7. K19 correlation/causation fields are propagated correctly
 *  8. Immutability of produced instances (Object.freeze)
 *  9. createVerificationRecord produces correct evidence reference lists
 * 10. createMissionResult status discriminant ("completed" / "not_completed")
 */

import { describe, it, expect } from "vitest";
import {
  Observation,
  createObservation,
} from "../../src/contracts/events/observation";
import {
  VerificationOutcome,
  VerificationRecord,
  MissionResult,
  createVerificationRecord,
  createMissionResult,
} from "../../src/contracts/capabilities/verification";
import { DomainEvent, createDomainEvent } from "../../src/contracts/events/domain-event";
import { CorrelationMetadata, Result } from "../../src/contracts/results/result";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const baseCorrelation: CorrelationMetadata = {
  requestId: "req-3d-test-001",
  correlationId: "corr-3d-test-001",
  invocationId: "inv-3d-test-001",
};

const missionCorrelation: CorrelationMetadata & { missionId: string } = {
  requestId: "req-3d-test-001",
  correlationId: "corr-3d-test-001",
  invocationId: "inv-3d-test-001",
  missionId: "mission-alpha-001",
};

// ---------------------------------------------------------------------------
// K4 — Observation Contract Tests
// ---------------------------------------------------------------------------

describe("Contract K4 — Observation", () => {
  describe("createObservation() — required fields", () => {
    it("produces an Observation with all K4-required fields present", () => {
      const obs = createObservation({
        producer: "GENESIS · Memory",
        subject: "user-session-42",
        payload: { evidence: "user mentioned 'hardware project' 3 times" },
        confidence: 0.85,
        provenance: "GENESIS memory replay across last 5 sessions",
        correlation: baseCorrelation,
      });

      // Required K4 identity
      expect(obs.id).toBeDefined();
      expect(typeof obs.id).toBe("string");
      expect(obs.id.length).toBeGreaterThan(0);

      // Required K4 fields
      expect(obs.producer).toBe("GENESIS · Memory");
      expect(obs.subject).toBe("user-session-42");
      expect(obs.observationTime).toBeDefined();
      expect(() => new Date(obs.observationTime)).not.toThrow();

      // Payload
      expect(obs.payload).toEqual({
        evidence: "user mentioned 'hardware project' 3 times",
      });

      // Required: confidence (K4 / TA §9.1)
      expect(typeof obs.confidence).toBe("number");
      expect(obs.confidence).toBe(0.85);

      // Required: provenance (K4 / TA §9.1)
      expect(typeof obs.provenance).toBe("string");
      expect(obs.provenance).toBe("GENESIS memory replay across last 5 sessions");
    });

    it("propagates K19 correlation fields (correlationId, requestId, causationId)", () => {
      const obs = createObservation({
        producer: "AKIRA OS · runtime",
        subject: "capability:recall.search",
        payload: { available: true },
        confidence: 1.0,
        provenance: "AKIRA OS capability availability check",
        correlation: baseCorrelation,
      });

      // K19 correlation fields
      expect(obs.correlation.correlationId).toBe("corr-3d-test-001");
      expect(obs.correlation.requestId).toBe("req-3d-test-001");
      expect(obs.correlation.invocationId).toBe("inv-3d-test-001");

      // causationId = invocationId (same pattern as K3 DomainEvent causation)
      expect(obs.causationId).toBe("inv-3d-test-001");
    });

    it("carries optional K19 mission / step / execution context", () => {
      const obs = createObservation({
        producer: "HANDS · executor",
        subject: "execution:exec-session-77",
        payload: { stdout: "Build succeeded", exitCode: 0 },
        confidence: 0.99,
        provenance: "HANDS terminal output capture",
        correlation: {
          ...baseCorrelation,
          missionId: "mission-build-001",
          stepId: "step-compile-001",
          executionId: "exec-session-77",
        },
      });

      expect(obs.correlation.missionId).toBe("mission-build-001");
      expect(obs.correlation.stepId).toBe("step-compile-001");
      expect(obs.correlation.executionId).toBe("exec-session-77");
    });

    it("isRecommendation defaults to false when not supplied", () => {
      const obs = createObservation({
        producer: "GENESIS · Understanding",
        subject: "current-intent",
        payload: { category: "workspace_query" },
        confidence: 0.7,
        provenance: "Understanding engine classification",
        correlation: baseCorrelation,
      });

      expect(obs.isRecommendation).toBe(false);
    });

    it("flags isRecommendation=true for a recommendation observation (K4)", () => {
      // K4: "A recommendation is an Observation whose payload proposes an option,
      //      with a rationale and confidence. It is never a Command."
      const obs = createObservation({
        producer: "GENESIS · Insights",
        subject: "mission:current",
        payload: {
          option: "recall.search",
          rationale: "User asked about a past conversation",
        },
        confidence: 0.78,
        provenance: "GENESIS insight engine",
        correlation: baseCorrelation,
        isRecommendation: true,
      });

      expect(obs.isRecommendation).toBe(true);
    });
  });

  describe("confidence validation", () => {
    it("accepts confidence = 0.0 (minimum)", () => {
      const obs = createObservation({
        producer: "AKIRA OS · health",
        subject: "subsystem:offline",
        payload: {},
        confidence: 0.0,
        provenance: "health check",
        correlation: baseCorrelation,
      });
      expect(obs.confidence).toBe(0.0);
    });

    it("accepts confidence = 1.0 (maximum)", () => {
      const obs = createObservation({
        producer: "AKIRA OS · health",
        subject: "subsystem:healthy",
        payload: {},
        confidence: 1.0,
        provenance: "health check",
        correlation: baseCorrelation,
      });
      expect(obs.confidence).toBe(1.0);
    });

    it("preserves undefined confidence when unstated by producer (no synthetic baseline invented)", () => {
      const obs = createObservation({
        producer: "AKIRA OS · health",
        subject: "subsystem:unstated",
        payload: {},
        provenance: "health check",
        correlation: baseCorrelation,
      });
      expect(obs.confidence).toBeUndefined();
    });

    it("throws RangeError for confidence < 0", () => {
      expect(() =>
        createObservation({
          producer: "test",
          subject: "test",
          payload: {},
          confidence: -0.1,
          provenance: "test",
          correlation: baseCorrelation,
        }),
      ).toThrow(RangeError);
    });

    it("throws RangeError for confidence > 1", () => {
      expect(() =>
        createObservation({
          producer: "test",
          subject: "test",
          payload: {},
          confidence: 1.01,
          provenance: "test",
          correlation: baseCorrelation,
        }),
      ).toThrow(RangeError);
    });
  });

  describe("Observation is DISTINCT from DomainEvent (K3)", () => {
    it("DomainEvent has name/createdAt fields that Observation does not", () => {
      const obs = createObservation({
        producer: "GENESIS · Memory",
        subject: "task-123",
        payload: { seen: true },
        confidence: 0.9,
        provenance: "memory scan",
        correlation: baseCorrelation,
      });

      const evt = createDomainEvent(
        "task.created",
        "AKIRA OS · workspace",
        "task-123",
        { id: "task-123" },
        baseCorrelation,
      );

      // Observation-specific required fields
      expect((obs as Observation).confidence).toBeDefined();
      expect((obs as Observation).provenance).toBeDefined();
      expect((obs as Observation).observationTime).toBeDefined();

      // Event-specific fields (not on Observation)
      expect((evt as DomainEvent).name).toBe("task.created");
      expect((evt as DomainEvent).createdAt).toBeDefined();
      expect((obs as unknown as DomainEvent).name).toBeUndefined();

      // Both carry K19 correlationId
      expect(obs.correlation.correlationId).toBe(evt.correlationId);
    });

    it("Observation does not carry an event name — it cannot masquerade as an Event", () => {
      const obs = createObservation({
        producer: "GENESIS · Memory",
        subject: "task-456",
        payload: {},
        confidence: 0.5,
        provenance: "scan",
        correlation: baseCorrelation,
      });

      // TypeScript type guard: Observation has no `name` field
      expect("name" in obs).toBe(false);
    });

    it("Observation is NOT a Result — it has no ok/error envelope", () => {
      const obs = createObservation({
        producer: "AKIRA OS · workspace",
        subject: "project-007",
        payload: { found: true },
        confidence: 0.95,
        provenance: "project query",
        correlation: baseCorrelation,
      });

      // K5 Result has `ok` discriminant; Observation does not
      expect("ok" in obs).toBe(false);
      expect("error" in obs).toBe(false);
      expect("value" in obs).toBe(false);
    });
  });

  describe("immutability", () => {
    it("Observation is frozen (immutable once emitted, per K20 all primitives contract)", () => {
      const obs = createObservation({
        producer: "test",
        subject: "test",
        payload: {},
        confidence: 0.5,
        provenance: "test",
        correlation: baseCorrelation,
      });

      expect(Object.isFrozen(obs)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// K6 — VerificationRecord Contract Tests
// ---------------------------------------------------------------------------

describe("Contract K6 — VerificationRecord", () => {
  describe("createVerificationRecord() — required fields", () => {
    it("produces a VerificationRecord with all required fields", () => {
      const record = createVerificationRecord({
        missionId: "mission-alpha-001",
        executionResultIds: ["result-exec-001", "result-exec-002"],
        observationIds: ["obs-001", "obs-002", "obs-003"],
        outcome: "criteria_satisfied",
        rationale: "All three build steps returned succeeded; output matches expected pattern.",
        correlation: missionCorrelation,
      });

      expect(record.id).toBeDefined();
      expect(typeof record.id).toBe("string");
      expect(record.missionId).toBe("mission-alpha-001");
      expect(record.executionResultIds).toEqual(["result-exec-001", "result-exec-002"]);
      expect(record.observationIds).toEqual(["obs-001", "obs-002", "obs-003"]);
      expect(record.outcome).toBe("criteria_satisfied");
      expect(record.rationale).toBeDefined();
      expect(record.verifiedAt).toBeDefined();
      expect(() => new Date(record.verifiedAt)).not.toThrow();
    });

    it("preserves optional stepId when provided", () => {
      const record = createVerificationRecord({
        missionId: "mission-beta-002",
        stepId: "step-compile-001",
        executionResultIds: ["result-compile"],
        observationIds: [],
        outcome: "criteria_not_satisfied",
        rationale: "Compilation failed; exit code 1.",
        correlation: { ...missionCorrelation, stepId: "step-compile-001" },
      });

      expect(record.stepId).toBe("step-compile-001");
    });

    it("accepts all three VerificationOutcome values", () => {
      const outcomes: VerificationOutcome[] = [
        "criteria_satisfied",
        "criteria_not_satisfied",
        "inconclusive",
      ];

      for (const outcome of outcomes) {
        const record = createVerificationRecord({
          missionId: "mission-test",
          executionResultIds: [],
          observationIds: [],
          outcome,
          rationale: `Outcome: ${outcome}`,
          correlation: missionCorrelation,
        });
        expect(record.outcome).toBe(outcome);
      }
    });

    it("carries K19 correlation with missionId", () => {
      const record = createVerificationRecord({
        missionId: "mission-alpha-001",
        executionResultIds: [],
        observationIds: [],
        outcome: "criteria_satisfied",
        rationale: "ok",
        correlation: missionCorrelation,
      });

      expect(record.correlation.correlationId).toBe("corr-3d-test-001");
      expect(record.correlation.missionId).toBe("mission-alpha-001");
    });
  });

  describe("VerificationRecord is DISTINCT from Execution Result (K5)", () => {
    it("VerificationRecord has no ok/error envelope — it is not a Result<T>", () => {
      const record = createVerificationRecord({
        missionId: "mission-alpha-001",
        executionResultIds: ["result-001"],
        observationIds: [],
        outcome: "criteria_satisfied",
        rationale: "criteria met",
        correlation: missionCorrelation,
      });

      // K5 Result<T> discriminant is absent
      expect("ok" in record).toBe(false);
      expect("value" in record).toBe(false);
      expect("error" in record).toBe(false);
    });

    it("VerificationRecord references ExecutionResult IDs — it does not contain result payloads", () => {
      // Execution Results (K5) are referenced by ID, not embedded.
      // K6: "MissionResult is based on the evidence (Execution Results and Observations)
      //      listed in its verification record"
      const executionResultId = "result-exec-007";
      const record = createVerificationRecord({
        missionId: "mission-alpha-001",
        executionResultIds: [executionResultId],
        observationIds: [],
        outcome: "criteria_satisfied",
        rationale: "build complete",
        correlation: missionCorrelation,
      });

      expect(record.executionResultIds).toContain(executionResultId);
      // The record references the ID — it does NOT embed the Result payload
      expect(record.executionResultIds[0]).toBe(executionResultId);
    });

    it("K4 Invariant I8 — Observation IDs are evidence only; they are NOT verification", () => {
      // An Observation alone must not be mistaken for verification.
      // The VerificationRecord explicitly separates Observation references from the outcome.
      const obsId = "obs-from-genesis-007";
      const record = createVerificationRecord({
        missionId: "mission-alpha-001",
        executionResultIds: [],
        observationIds: [obsId],
        outcome: "inconclusive", // even with an observation, outcome requires explicit judgement
        rationale: "Evidence exists but criteria indeterminate",
        correlation: missionCorrelation,
      });

      expect(record.observationIds).toContain(obsId);
      // The outcome is the verification judgement — the observation ID is merely referenced
      expect(record.outcome).toBe("inconclusive");
    });
  });

  describe("immutability", () => {
    it("VerificationRecord is frozen", () => {
      const record = createVerificationRecord({
        missionId: "mission-freeze-test",
        executionResultIds: [],
        observationIds: [],
        outcome: "criteria_satisfied",
        rationale: "ok",
        correlation: missionCorrelation,
      });

      expect(Object.isFrozen(record)).toBe(true);
    });

    it("evidence ID arrays are frozen (immutable slices)", () => {
      const record = createVerificationRecord({
        missionId: "mission-freeze-test",
        executionResultIds: ["r1"],
        observationIds: ["o1"],
        outcome: "criteria_satisfied",
        rationale: "ok",
        correlation: missionCorrelation,
      });

      expect(Object.isFrozen(record.executionResultIds)).toBe(true);
      expect(Object.isFrozen(record.observationIds)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// K6 — MissionResult Contract Tests
// ---------------------------------------------------------------------------

describe("Contract K6 — MissionResult", () => {
  describe("createMissionResult() — required fields", () => {
    it("produces a MissionResult with all required fields for a completed mission", () => {
      const result = createMissionResult({
        missionId: "mission-alpha-001",
        status: "completed",
        verificationRecordId: "verif-record-001",
        outcome: { summary: "Build deployed successfully" },
        correlation: {
          ...missionCorrelation,
          verificationRecordId: "verif-record-001",
        },
      });

      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe("string");
      expect(result.missionId).toBe("mission-alpha-001");
      expect(result.status).toBe("completed");
      expect(result.verificationRecordId).toBe("verif-record-001");
      expect(result.outcome).toEqual({ summary: "Build deployed successfully" });
      expect(result.producedAt).toBeDefined();
      expect(() => new Date(result.producedAt)).not.toThrow();
    });

    it("produces a MissionResult with status 'not_completed' for a failed mission", () => {
      // I9: A mission that does not complete is recorded by VAJRA and is NOT
      //     a successful MissionResult.
      const result = createMissionResult({
        missionId: "mission-beta-002",
        status: "not_completed",
        verificationRecordId: "verif-record-002",
        outcome: { failureReason: "Compilation failed after 3 retries" },
        correlation: {
          ...missionCorrelation,
          missionId: "mission-beta-002",
          verificationRecordId: "verif-record-002",
        },
      });

      expect(result.status).toBe("not_completed");
      expect(result.missionId).toBe("mission-beta-002");
      expect(result.verificationRecordId).toBe("verif-record-002");
    });

    it("carries optional goalId when mission serves a Goal (K19)", () => {
      const result = createMissionResult({
        missionId: "mission-goal-linked-001",
        goalId: "goal-build-firmware-001",
        status: "completed",
        verificationRecordId: "verif-record-003",
        outcome: { artifact: "firmware.bin" },
        correlation: {
          ...missionCorrelation,
          missionId: "mission-goal-linked-001",
          goalId: "goal-build-firmware-001",
          verificationRecordId: "verif-record-003",
        },
      });

      expect(result.goalId).toBe("goal-build-firmware-001");
    });

    it("goalId is absent when mission has no Goal (TA §6 — a Mission need not have a Goal)", () => {
      const result = createMissionResult({
        missionId: "mission-goalless-001",
        status: "completed",
        verificationRecordId: "verif-record-004",
        outcome: { found: "IC datasheet" },
        correlation: {
          ...missionCorrelation,
          missionId: "mission-goalless-001",
          verificationRecordId: "verif-record-004",
        },
      });

      expect(result.goalId).toBeUndefined();
    });

    it("carries K19 correlation including verificationRecordId and missionId", () => {
      const result = createMissionResult({
        missionId: "mission-alpha-001",
        status: "completed",
        verificationRecordId: "verif-record-001",
        outcome: {},
        correlation: {
          ...missionCorrelation,
          verificationRecordId: "verif-record-001",
        },
      });

      expect(result.correlation.correlationId).toBe("corr-3d-test-001");
      expect(result.correlation.missionId).toBe("mission-alpha-001");
      expect(result.correlation.verificationRecordId).toBe("verif-record-001");
    });
  });

  describe("Invariant I9 — MissionResult is DISTINCT from Execution Result", () => {
    it("MissionResult has no ok/error discriminant — it is NOT a K5 Result<T>", () => {
      const missionResult = createMissionResult({
        missionId: "mission-alpha-001",
        status: "completed",
        verificationRecordId: "verif-001",
        outcome: {},
        correlation: {
          ...missionCorrelation,
          verificationRecordId: "verif-001",
        },
      });

      // K5 Result discriminant is absent
      expect("ok" in missionResult).toBe(false);
      expect("error" in missionResult).toBe(false);
      expect("value" in missionResult).toBe(false);
    });

    it("A 'not_completed' MissionResult is not a success (I9)", () => {
      const failed = createMissionResult({
        missionId: "mission-fail-001",
        status: "not_completed",
        verificationRecordId: "verif-fail-001",
        outcome: { reason: "timed out" },
        correlation: {
          ...missionCorrelation,
          missionId: "mission-fail-001",
          verificationRecordId: "verif-fail-001",
        },
      });

      // Not a success; status discriminant makes this unambiguous
      expect(failed.status).toBe("not_completed");
      expect(failed.status === "completed").toBe(false);
    });
  });

  describe("end-to-end K10 evidence chain", () => {
    it("VerificationRecord references Observation ID and ExecutionResult ID; MissionResult references VerificationRecord ID", () => {
      // Simulates the conceptual K10 flow:
      //   Execution (K5 Result id) + Observation (K4 id) → VerificationRecord id → MissionResult verificationRecordId
      const executionResultId = "result-exec-final";
      const obsId = "obs-genesis-final";

      const verif = createVerificationRecord({
        missionId: "mission-chain-001",
        executionResultIds: [executionResultId],
        observationIds: [obsId],
        outcome: "criteria_satisfied",
        rationale: "All criteria met",
        correlation: { ...missionCorrelation, missionId: "mission-chain-001" },
      });

      const missionResult = createMissionResult({
        missionId: "mission-chain-001",
        status: "completed",
        verificationRecordId: verif.id,
        outcome: { done: true },
        correlation: {
          ...missionCorrelation,
          missionId: "mission-chain-001",
          verificationRecordId: verif.id,
        },
      });

      // Trace the chain
      expect(verif.executionResultIds).toContain(executionResultId);
      expect(verif.observationIds).toContain(obsId);
      expect(missionResult.verificationRecordId).toBe(verif.id);
      expect(missionResult.correlation.verificationRecordId).toBe(verif.id);

      // K19 correlation flows through
      expect(verif.correlation.correlationId).toBe(
        missionResult.correlation.correlationId,
      );
    });
  });

  describe("immutability", () => {
    it("MissionResult is frozen", () => {
      const result = createMissionResult({
        missionId: "mission-freeze",
        status: "completed",
        verificationRecordId: "verif-freeze",
        outcome: {},
        correlation: {
          ...missionCorrelation,
          missionId: "mission-freeze",
          verificationRecordId: "verif-freeze",
        },
      });

      expect(Object.isFrozen(result)).toBe(true);
    });
  });
});
