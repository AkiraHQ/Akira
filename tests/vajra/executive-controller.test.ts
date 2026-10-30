import { describe, it, expect } from "vitest";
import { ExecutiveController } from "../../src/vajra/executive/controller";
import { SelfModel } from "../../src/vajra/self-model/self-model";
import { InMemoryGenesisAdapter } from "../../src/vajra/boundaries/genesis-port";
import { InMemoryAkiraOSAdapter } from "../../src/vajra/boundaries/akira-os-port";
import { InMemoryEscalationAdapter } from "../../src/vajra/boundaries/escalation-port";
import { createStimulus } from "../../src/vajra/types/stimulus";
import { CorrelationMetadata } from "../../src/contracts/results/result";
import { CapabilityDescriptor } from "../../src/contracts/capabilities/descriptor";

describe("VAJRA Executive Controller (Phase 2 Lifecycle Shell)", () => {
  function createTestHarness() {
    const selfModel = new SelfModel();
    const genesisPort = new InMemoryGenesisAdapter();
    const akiraOSPort = new InMemoryAkiraOSAdapter();
    const escalationPort = new InMemoryEscalationAdapter();

    const dummyDescriptor: CapabilityDescriptor = {
      name: "task.list",
      kind: "Query",
      version: "1.0.0",
      owner: "AKIRA_OS",
      description: "List tasks",
      inputSchema: {} as any,
      outputSchema: {} as any,
      permissions: { allowVajra: true },
      executionCharacteristics: { isSynchronous: true, isReadOnly: true, isIdempotent: true },
      activationTier: 1,
      costClass: "local_cheap",
      isAvailable: true,
    };

    akiraOSPort.getRegistry().register(dummyDescriptor, () => []);

    const controller = new ExecutiveController({
      selfModel,
      genesisPort,
      akiraOSPort,
      escalationPort,
    });

    return { controller, selfModel, genesisPort, akiraOSPort, escalationPort };
  }

  it("starts in UNINITIALIZED state and boots cleanly into RUNNING", async () => {
    const { controller, selfModel } = createTestHarness();
    expect(controller.getState()).toBe("UNINITIALIZED");

    const bootResult = await controller.boot();
    expect(bootResult.ok).toBe(true);
    expect(controller.getState()).toBe("RUNNING");

    // Capabilities discovered and registered
    expect(selfModel.getCapability("task.list")).toBeDefined();

    // Operational context set
    const ctx = controller.getOperationalContext();
    expect(ctx.mode).toBe("REQUEST_DRIVEN");
    expect(ctx.systemHealthStatus).toBe("NOMINAL");
  });

  it("prevents double boot", async () => {
    const { controller } = createTestHarness();
    await controller.boot();

    const secondBoot = await controller.boot();
    expect(secondBoot.ok).toBe(false);
    if (!secondBoot.ok) {
      expect(secondBoot.error).toContain("already in state 'RUNNING'");
    }
  });

  it("shuts down cleanly from RUNNING to STOPPED", async () => {
    const { controller } = createTestHarness();
    await controller.boot();

    const shutdownResult = await controller.shutdown();
    expect(shutdownResult.ok).toBe(true);
    expect(controller.getState()).toBe("STOPPED");
    expect(controller.getOperationalContext().mode).toBe("PAUSED");
  });

  it("rejects stimuli when not running", async () => {
    const { controller } = createTestHarness();
    const correlation: CorrelationMetadata = {
      requestId: "req-stim-1",
      correlationId: "corr-stim-1",
      invocationId: "inv-stim-1",
    };

    const stimulus = createStimulus({
      id: "stim-1",
      kind: "human_prompt",
      source: "chat",
      payload: { text: "Hello Akira" },
      correlation,
    });

    const result = await controller.receiveStimulus(stimulus);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not in RUNNING state");
    }
  });

  it("receives and acknowledges stimulus when running", async () => {
    const { controller } = createTestHarness();
    await controller.boot();

    const correlation: CorrelationMetadata = {
      requestId: "req-stim-2",
      correlationId: "corr-stim-2",
      invocationId: "inv-stim-2",
    };

    const stimulus = createStimulus({
      id: "stim-2",
      kind: "human_prompt",
      source: "chat",
      payload: { text: "Review workspace tasks" },
      correlation,
    });

    const result = await controller.receiveStimulus(stimulus);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("wait_and_observe");
      expect(result.value.policyCompliance).toBe(true);
      expect(result.value.rationale).toContain("Phase 2 lifecycle shell");
      expect(result.value.correlation.requestId).toBe("req-stim-2");
    }
  });

  it("enforces proactive rate limit on scheduled_timer stimuli", async () => {
    const { controller, selfModel } = createTestHarness();
    // Configure rate limit to 2 per hour
    selfModel.updatePolicy({ maxAutonomousRatePerHour: 2 });
    await controller.boot();

    const correlation: CorrelationMetadata = {
      requestId: "req-timer",
      correlationId: "corr-timer",
      invocationId: "inv-timer",
    };

    const s1 = createStimulus({
      id: "timer-1",
      kind: "scheduled_timer",
      source: "cron",
      payload: {},
      correlation,
    });

    const s2 = createStimulus({
      id: "timer-2",
      kind: "scheduled_timer",
      source: "cron",
      payload: {},
      correlation,
    });

    const s3 = createStimulus({
      id: "timer-3",
      kind: "scheduled_timer",
      source: "cron",
      payload: {},
      correlation,
    });

    const res1 = await controller.receiveStimulus(s1);
    expect(res1.ok).toBe(true);

    const res2 = await controller.receiveStimulus(s2);
    expect(res2.ok).toBe(true);

    const res3 = await controller.receiveStimulus(s3);
    // 3rd scheduled timer exceeds the rate limit of 2/hr
    expect(res3.ok).toBe(false);
    if (!res3.ok) {
      expect(res3.error).toContain("Rate limit exceeded");
    }
  });

  it("updates operational focus and responds to GENESIS discoveries", async () => {
    const { controller, genesisPort } = createTestHarness();
    await controller.boot();

    controller.setOperationalFocus("Refining database schemas");
    expect(controller.getOperationalContext().currentFocus).toBe("Refining database schemas");

    // GENESIS emits discovery
    genesisPort.emitDiscovery({ pattern: "User studying systems architecture" });
    expect(controller.getOperationalContext().currentFocus).toContain(
      "User studying systems architecture",
    );
  });
});
