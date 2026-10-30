import { describe, it, expect, vi } from "vitest";
import { CoordinationDispatcher } from "../../../src/vajra/mission/coordinator";
import { IAkiraOSPort } from "../../../src/vajra/boundaries/akira-os-port";
import { createMissionStep } from "../../../src/contracts/mission/mission-definition";
import { CorrelationMetadata, Result, CapabilityFailure } from "../../../src/contracts/results/result";

describe("CoordinationDispatcher (Phase 6 IAkiraOSPort Boundary)", () => {
  const correlation: CorrelationMetadata = {
    requestId: "req-coord-01",
    correlationId: "corr-coord-01",
    invocationId: "inv-coord-01",
  };

  it("dispatches step to IAkiraOSPort with invocationId rebound to step.id (Contract K19)", async () => {
    let capturedCapability = "";
    let capturedInput: unknown = null;
    let capturedCorrelation: CorrelationMetadata | null = null;

    const mockAkiraOSPort: IAkiraOSPort = {
      executeCapability: vi.fn(async <TInput, TOutput>(
        capabilityName: string,
        input: TInput,
        corr: CorrelationMetadata,
      ) => {
        capturedCapability = capabilityName;
        capturedInput = input;
        capturedCorrelation = corr;
        return Result.success({ executed: true } as unknown as TOutput, corr);
      }),
    };

    const coordinator = new CoordinationDispatcher(mockAkiraOSPort);
    const step = createMissionStep({
      id: "step-uuid-1234",
      missionId: "mission-uuid-999",
      stepOrder: 1,
      description: "Format workspace files",
      targetCapability: "workspace.format",
      input: { path: "src/index.ts" },
      expectedEvidence: "evidence.format.ok",
    });

    const result = await coordinator.dispatchStep(step, correlation);

    expect(result.ok).toBe(true);
    expect(capturedCapability).toBe("workspace.format");
    expect(capturedInput).toEqual({ path: "src/index.ts" });
    expect(capturedCorrelation).toBeDefined();
    // Invariant: Invocation ID is rebound to the discrete step ID for granular traceability
    expect(capturedCorrelation?.invocationId).toBe("step-uuid-1234");
    expect(capturedCorrelation?.requestId).toBe("req-coord-01");
    expect(capturedCorrelation?.correlationId).toBe("corr-coord-01");
  });

  it("transparently propagates capability execution failures", async () => {
    const failure: CapabilityFailure = {
      category: "timeout",
      message: "Operation exceeded 30000ms deadline",
    };

    const mockAkiraOSPort: IAkiraOSPort = {
      executeCapability: vi.fn(async (_cap, _inp, corr) => {
        return Result.failure(failure, corr);
      }),
    };

    const coordinator = new CoordinationDispatcher(mockAkiraOSPort);
    const step = createMissionStep({
      id: "step-fail-1",
      missionId: "m-1",
      stepOrder: 1,
      description: "Slow operation",
      targetCapability: "external.network",
      input: {},
      expectedEvidence: "evidence.done",
    });

    const result = await coordinator.dispatchStep(step, correlation);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("timeout");
      expect(result.error.message).toContain("Operation exceeded");
    }
  });
});
