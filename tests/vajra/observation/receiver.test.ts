import { describe, it, expect, beforeEach } from "vitest";
import { ObservationReceiver } from "../../../src/vajra/observation/receiver";
import { createObservation } from "../../../src/contracts/events/observation";

describe("ObservationReceiver (Phase 7 - Contract K4 & K19)", () => {
  let receiver: ObservationReceiver;

  beforeEach(() => {
    receiver = new ObservationReceiver();
  });

  it("ingests and indexes observations by missionId and stepId", () => {
    const obs = createObservation({
      producer: "capability.workspace.format",
      subject: "step-101",
      payload: { ok: true, formattedFiles: 3 },
      confidence: 0.95,
      provenance: "Execution result from workspace.format",
      correlation: {
        requestId: "req-1",
        correlationId: "corr-1",
        causationId: "inv-101",
        invocationId: "inv-101",
        missionId: "mission-999",
        stepId: "step-101",
        executionId: "exec-101-canonical",
      },
    });

    receiver.ingestObservation(obs);

    const missionObs = receiver.getObservationsForMission("mission-999");
    expect(missionObs).toHaveLength(1);
    expect(missionObs[0].id).toBe(obs.id);

    const stepObs = receiver.getObservationsForStep("step-101");
    expect(stepObs).toHaveLength(1);
    expect(stepObs[0].id).toBe(obs.id);

    const stats = receiver.getStats();
    expect(stats.totalObservations).toBe(1);
    expect(stats.totalMissionsTracked).toBe(1);
    expect(stats.totalStepsTracked).toBe(1);
  });

  it("enforces idempotent deduplication on duplicate observation IDs", () => {
    const obs = createObservation({
      producer: "capability.fs.read",
      subject: "step-102",
      payload: { exists: true },
      confidence: 0.9,
      provenance: "Probe query",
      correlation: {
        requestId: "req-2",
        correlationId: "corr-2",
        invocationId: "inv-102",
        missionId: "mission-999",
        stepId: "step-102",
      },
    });

    receiver.ingestObservation(obs);
    receiver.ingestObservation(obs); // duplicate

    const stepObs = receiver.getObservationsForStep("step-102");
    expect(stepObs).toHaveLength(1);
    expect(receiver.getStats().totalObservations).toBe(1);
  });

  it("normalizes execution results using canonical Phase 6 execution identity (zero wall-clock Date.now() generation)", () => {
    const canonicalExecutionId = "exec-canonical-phase6-id-12345";

    const normalized = receiver.normalizeExecutionResult({
      stepId: "step-103",
      missionId: "mission-999",
      targetCapability: "git.commit",
      executionResultId: canonicalExecutionId,
      payload: { commitHash: "abcdef123456" },
      producerConfidence: 0.98,
      correlation: {
        requestId: "req-3",
        correlationId: "corr-3",
        causationId: "inv-103",
        invocationId: "inv-103",
        executionId: canonicalExecutionId,
      },
    });

    expect(normalized.correlation.executionId).toBe(canonicalExecutionId);
    expect(normalized.producer).toBe("capability.git.commit");
    expect(normalized.confidence).toBe(0.98);
    expect(normalized.provenance).toContain("git.commit");

    // Must be automatically ingested into pool
    const stepObs = receiver.getObservationsForStep("step-103");
    expect(stepObs).toHaveLength(1);
    expect(stepObs[0].id).toBe(normalized.id);
  });

  it("preserves undefined confidence when producer confidence is unstated (zero invented heuristics)", () => {
    const normalized = receiver.normalizeExecutionResult({
      stepId: "step-104",
      missionId: "mission-999",
      targetCapability: "telemetry.sample",
      executionResultId: "exec-104",
      payload: { latencyMs: 42 },
      // producerConfidence omitted
      correlation: {
        requestId: "req-4",
        correlationId: "corr-4",
        invocationId: "inv-104",
      },
    });

    // Unstated producer confidence is preserved as undefined (never an invented baseline like 0.8)
    expect(normalized.confidence).toBeUndefined();
  });

  it("preserves producer-supplied confidence exactly without aggregation", () => {
    const normalized = receiver.normalizeExecutionResult({
      stepId: "step-104b",
      missionId: "mission-999",
      targetCapability: "telemetry.sample",
      executionResultId: "exec-104b",
      payload: { latencyMs: 42 },
      producerConfidence: 0.73,
      correlation: {
        requestId: "req-4b",
        correlationId: "corr-4b",
        invocationId: "inv-104b",
      },
    });

    expect(normalized.confidence).toBe(0.73);
  });

  it("throws RangeError if invalid confidence (< 0 or > 1) is passed", () => {
    expect(() => {
      receiver.normalizeExecutionResult({
        stepId: "step-105",
        missionId: "mission-999",
        targetCapability: "broken.cap",
        executionResultId: "exec-105",
        payload: {},
        producerConfidence: 1.5,
        correlation: {
          requestId: "req-5",
          correlationId: "corr-5",
          invocationId: "inv-105",
        },
      });
    }).toThrow(RangeError);

    expect(() => {
      receiver.normalizeExecutionResult({
        stepId: "step-106",
        missionId: "mission-999",
        targetCapability: "broken.cap",
        executionResultId: "exec-106",
        payload: {},
        producerConfidence: -0.1,
        correlation: {
          requestId: "req-6",
          correlationId: "corr-6",
          invocationId: "inv-106",
        },
      });
    }).toThrow(RangeError);
  });

  it("supports flexible querying with queryObservations()", () => {
    receiver.normalizeExecutionResult({
      stepId: "step-107",
      missionId: "mission-A",
      targetCapability: "cap.alpha",
      executionResultId: "exec-107",
      payload: { data: 1 },
      correlation: {
        requestId: "req-7",
        correlationId: "corr-7",
        invocationId: "inv-107",
      },
    });

    receiver.normalizeExecutionResult({
      stepId: "step-108",
      missionId: "mission-B",
      targetCapability: "cap.beta",
      executionResultId: "exec-108",
      payload: { data: 2 },
      correlation: {
        requestId: "req-8",
        correlationId: "corr-8",
        invocationId: "inv-108",
      },
    });

    const missionAOnly = receiver.queryObservations({ missionId: "mission-A" });
    expect(missionAOnly).toHaveLength(1);
    expect(missionAOnly[0].producer).toBe("capability.cap.alpha");

    const capBetaOnly = receiver.queryObservations({ producer: "capability.cap.beta" });
    expect(capBetaOnly).toHaveLength(1);
    expect(capBetaOnly[0].correlation.missionId).toBe("mission-B");
  });

  it("clears mission observations and full session state correctly", () => {
    receiver.normalizeExecutionResult({
      stepId: "step-109",
      missionId: "mission-to-clear",
      targetCapability: "cap.test",
      executionResultId: "exec-109",
      payload: {},
      correlation: {
        requestId: "req-9",
        correlationId: "corr-9",
        invocationId: "inv-109",
      },
    });

    expect(receiver.getObservationsForMission("mission-to-clear")).toHaveLength(1);
    receiver.clearMission("mission-to-clear");
    expect(receiver.getObservationsForMission("mission-to-clear")).toHaveLength(0);

    receiver.normalizeExecutionResult({
      stepId: "step-110",
      missionId: "mission-all",
      targetCapability: "cap.test",
      executionResultId: "exec-110",
      payload: {},
      correlation: {
        requestId: "req-10",
        correlationId: "corr-10",
        invocationId: "inv-110",
      },
    });

    expect(receiver.getStats().totalObservations).toBe(1);
    receiver.clearSession();
    expect(receiver.getStats().totalObservations).toBe(0);
  });
});
