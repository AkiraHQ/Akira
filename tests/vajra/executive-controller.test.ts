import { describe, it, expect } from "vitest";
import { ExecutiveController } from "../../src/vajra/executive/controller";
import { SelfModel } from "../../src/vajra/self-model/self-model";
import { InMemoryGenesisAdapter } from "../../src/vajra/boundaries/genesis-port";
import { InMemoryAkiraOSAdapter } from "../../src/vajra/boundaries/akira-os-port";
import { InMemoryEscalationAdapter } from "../../src/vajra/boundaries/escalation-port";
import { createStimulus } from "../../src/vajra/types/stimulus";
import { CorrelationMetadata, Result } from "../../src/contracts/results/result";
import { CapabilityDescriptor } from "../../src/contracts/capabilities/descriptor";
import { createExecutiveAction } from "../../src/vajra/types/action";

describe("VAJRA Executive Controller (Phase 2 Lifecycle Shell)", () => {
  function createTestHarness(overrides?: { stateStore?: any; genesisPort?: any }) {
    const selfModel = new SelfModel();
    const genesisPort = overrides?.genesisPort ?? new InMemoryGenesisAdapter();
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
      stateStore: overrides?.stateStore,
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

  it("updates operational focus and ensures GENESIS discoveries do not mutate focus out-of-band (Task 03D)", async () => {
    const { controller, genesisPort } = createTestHarness();
    await controller.boot();

    controller.setOperationalFocus("Refining database schemas");
    expect(controller.getOperationalContext().currentFocus).toBe("Refining database schemas");

    // GENESIS emits discovery on legacy port
    genesisPort.emitDiscovery({ pattern: "User studying systems architecture" });
    // Invariant Task 03D: Out-of-band discovery callback must NOT mutate operational focus outside the scheduler
    expect(controller.getOperationalContext().currentFocus).toBe("Refining database schemas");
  });

  describe("Durable shutdown and error propagation (Task 01.2)", () => {
    it("persists PAUSED operational mode to stateStore on successful shutdown", async () => {
      let savedContext: any = null;
      const mockStateStore: any = {
        saveOperationalContext: async (ctx: any) => {
          savedContext = ctx;
        },
        loadOperationalContext: async () => savedContext,
        detectInterruptedMissions: async () => [],
      };

      const { controller } = createTestHarness({ stateStore: mockStateStore });
      await controller.boot();
      expect(savedContext.mode).toBe("REQUEST_DRIVEN");

      const shutdownRes = await controller.shutdown();
      expect(shutdownRes.ok).toBe(true);
      expect(savedContext.mode).toBe("PAUSED");
      expect(controller.getState()).toBe("STOPPED");
      expect(controller.hasActiveGenesisSubscription()).toBe(false);
    });

    it("surfaces persistence failure to caller and marks failure status", async () => {
      const mockStateStore: any = {
        saveOperationalContext: async (ctx: any) => {
          if (ctx.mode === "PAUSED") {
            throw new Error("Disk I/O error writing operational context to SQLite");
          }
        },
        loadOperationalContext: async () => null,
        detectInterruptedMissions: async () => [],
      };

      const { controller } = createTestHarness({ stateStore: mockStateStore });
      await controller.boot();

      const shutdownRes = await controller.shutdown();
      expect(shutdownRes.ok).toBe(false);
      if (!shutdownRes.ok) {
        expect(shutdownRes.error).toContain("Operational context persistence failed");
        expect(shutdownRes.error).toContain("Disk I/O error writing operational context");
      }
      expect(controller.getState()).toBe("STOPPED");
    });

    it("ensures cleanup still runs when operational context persistence fails", async () => {
      let unsubscriptionRan = false;
      const genesisPort = new InMemoryGenesisAdapter();
      genesisPort.subscribeToCognitiveDiscoveries = () => {
        return () => {
          unsubscriptionRan = true;
        };
      };

      const mockStateStore: any = {
        saveOperationalContext: async (ctx: any) => {
          if (ctx.mode === "PAUSED") {
            throw new Error("Persistence failed");
          }
        },
        loadOperationalContext: async () => null,
        detectInterruptedMissions: async () => [],
      };

      const { controller } = createTestHarness({ stateStore: mockStateStore, genesisPort });
      await controller.boot();

      const shutdownRes = await controller.shutdown();
      expect(shutdownRes.ok).toBe(false);
      // Even though persistence threw, unsubscription still ran!
      expect(unsubscriptionRan).toBe(true);
      expect(controller.hasActiveGenesisSubscription()).toBe(false);
    });

    it("preserves multiple shutdown failures without silent overwrites", async () => {
      const genesisPort = new InMemoryGenesisAdapter();
      genesisPort.subscribeToCognitiveDiscoveries = () => {
        return () => {
          throw new Error("GENESIS network unsubscription timed out");
        };
      };

      const mockStateStore: any = {
        saveOperationalContext: async (ctx: any) => {
          if (ctx.mode === "PAUSED") {
            throw new Error("SQLite disk full");
          }
        },
        loadOperationalContext: async () => null,
        detectInterruptedMissions: async () => [],
      };

      const { controller } = createTestHarness({ stateStore: mockStateStore, genesisPort });
      await controller.boot();

      const shutdownRes = await controller.shutdown();
      expect(shutdownRes.ok).toBe(false);
      if (!shutdownRes.ok) {
        expect(shutdownRes.error).toContain("Shutdown completed with 2 failure(s)");
        expect(shutdownRes.error).toContain(
          "GENESIS unsubscription failed: GENESIS network unsubscription timed out",
        );
        expect(shutdownRes.error).toContain(
          "Operational context persistence failed: SQLite disk full",
        );
      }
      // Since unsubscription threw, subscription handle was retained
      expect(controller.hasActiveGenesisSubscription()).toBe(true);
    });

    it("ensures repeated shutdown does not duplicate cleanup or fail", async () => {
      let unsubCount = 0;
      let saveCount = 0;

      const genesisPort = new InMemoryGenesisAdapter();
      genesisPort.subscribeToCognitiveDiscoveries = () => {
        return () => {
          unsubCount++;
        };
      };

      const mockStateStore: any = {
        saveOperationalContext: async () => {
          saveCount++;
        },
        loadOperationalContext: async () => null,
        detectInterruptedMissions: async () => [],
      };

      const { controller } = createTestHarness({ stateStore: mockStateStore, genesisPort });
      await controller.boot();
      expect(unsubCount).toBe(0);
      expect(saveCount).toBe(1); // Boot save

      // First shutdown
      const firstRes = await controller.shutdown();
      expect(firstRes.ok).toBe(true);
      expect(unsubCount).toBe(1);
      expect(saveCount).toBe(2); // Shutdown save

      // Second shutdown: idempotent, must not duplicate cleanup
      const secondRes = await controller.shutdown();
      expect(secondRes.ok).toBe(true);
      expect(unsubCount).toBe(1); // Still 1
      expect(saveCount).toBe(2); // Still 2
    });
  });

  describe("Shutdown Retry and Reconciliation Consistency (Task 01.3)", () => {
    it("ensures a stopped controller with pending cleanup is not reported as fully reconciled (isTeardownReconciled() === false)", async () => {
      const genesisPort = new InMemoryGenesisAdapter();
      genesisPort.subscribeToCognitiveDiscoveries = () => {
        return () => {
          throw new Error("GENESIS network unsubscription timed out");
        };
      };

      const { controller } = createTestHarness({ genesisPort });
      await controller.boot();

      const shutdownRes = await controller.shutdown();
      expect(shutdownRes.ok).toBe(false);
      expect(controller.getState()).toBe("STOPPED");
      expect(controller.hasActiveGenesisSubscription()).toBe(true);
      expect(controller.isTeardownReconciled()).toBe(false);
    });

    it("genuinely retries failed unsubscription on subsequent shutdown once resolved", async () => {
      let unsubCalls = 0;
      let unsubShouldFail = true;

      const genesisPort = new InMemoryGenesisAdapter();
      genesisPort.subscribeToCognitiveDiscoveries = () => {
        return () => {
          unsubCalls++;
          if (unsubShouldFail) {
            throw new Error("Temporary unsubscription network error");
          }
        };
      };

      const { controller } = createTestHarness({ genesisPort });
      await controller.boot();

      // First shutdown attempt: fails during unsubscription
      const firstRes = await controller.shutdown();
      expect(firstRes.ok).toBe(false);
      expect(unsubCalls).toBe(1);
      expect(controller.getState()).toBe("STOPPED");
      expect(controller.hasActiveGenesisSubscription()).toBe(true);
      expect(controller.isTeardownReconciled()).toBe(false);

      // Resolve underlying failure
      unsubShouldFail = false;

      // Second shutdown attempt: must retry unsubscription despite controller being STOPPED
      const secondRes = await controller.shutdown();
      expect(secondRes.ok).toBe(true);
      expect(unsubCalls).toBe(2);
      expect(controller.getState()).toBe("STOPPED");
      expect(controller.hasActiveGenesisSubscription()).toBe(false);
      expect(controller.isTeardownReconciled()).toBe(true);
    });

    it("genuinely retries failed PAUSED operational context persistence on subsequent shutdown once resolved", async () => {
      let persistCalls = 0;
      let persistShouldFail = true;

      const mockStateStore: any = {
        saveOperationalContext: async (ctx: any) => {
          if (ctx.mode === "PAUSED") {
            persistCalls++;
            if (persistShouldFail) {
              throw new Error("Temporary SQLite write lock contention");
            }
          }
        },
        loadOperationalContext: async () => null,
        detectInterruptedMissions: async () => [],
      };

      const { controller } = createTestHarness({ stateStore: mockStateStore });
      await controller.boot();

      // First shutdown attempt: fails during PAUSED persistence
      const firstRes = await controller.shutdown();
      expect(firstRes.ok).toBe(false);
      expect(persistCalls).toBe(1);
      expect(controller.getState()).toBe("STOPPED");
      expect(controller.isTeardownReconciled()).toBe(false);

      // Resolve write lock contention
      persistShouldFail = false;

      // Second shutdown attempt: must genuinely retry persistence
      const secondRes = await controller.shutdown();
      expect(secondRes.ok).toBe(true);
      expect(persistCalls).toBe(2);
      expect(controller.getState()).toBe("STOPPED");
      expect(controller.isTeardownReconciled()).toBe(true);
    });

    it("reconciles independent failures (unsubscription and persistence) separately and progressively", async () => {
      let unsubCalls = 0;
      let unsubShouldFail = true;
      let persistCalls = 0;
      let persistShouldFail = true;

      const genesisPort = new InMemoryGenesisAdapter();
      genesisPort.subscribeToCognitiveDiscoveries = () => {
        return () => {
          unsubCalls++;
          if (unsubShouldFail) {
            throw new Error("GENESIS unsubscription failed");
          }
        };
      };

      const mockStateStore: any = {
        saveOperationalContext: async (ctx: any) => {
          if (ctx.mode === "PAUSED") {
            persistCalls++;
            if (persistShouldFail) {
              throw new Error("SQLite disk error");
            }
          }
        },
        loadOperationalContext: async () => null,
        detectInterruptedMissions: async () => [],
      };

      const { controller } = createTestHarness({ stateStore: mockStateStore, genesisPort });
      await controller.boot();

      // First shutdown: both fail
      const firstRes = await controller.shutdown();
      expect(firstRes.ok).toBe(false);
      expect(unsubCalls).toBe(1);
      expect(persistCalls).toBe(1);
      expect(controller.hasActiveGenesisSubscription()).toBe(true);
      expect(controller.isTeardownReconciled()).toBe(false);

      // Resolve unsubscription only
      unsubShouldFail = false;

      // Second shutdown: unsubscription succeeds, persistence still fails
      const secondRes = await controller.shutdown();
      expect(secondRes.ok).toBe(false);
      expect(unsubCalls).toBe(2);
      expect(persistCalls).toBe(2);
      expect(controller.hasActiveGenesisSubscription()).toBe(false);
      expect(controller.isTeardownReconciled()).toBe(false);

      // Resolve persistence
      persistShouldFail = false;

      // Third shutdown: unsubscription is already cleared (not called again), persistence retried and succeeds
      const thirdRes = await controller.shutdown();
      expect(thirdRes.ok).toBe(true);
      expect(unsubCalls).toBe(2); // Still 2, no double-unsubscription
      expect(persistCalls).toBe(3);
      expect(controller.hasActiveGenesisSubscription()).toBe(false);
      expect(controller.isTeardownReconciled()).toBe(true);
    });

    it("repeated successful shutdown remains idempotent without duplicate cleanup", async () => {
      let unsubCalls = 0;
      let persistCalls = 0;

      const genesisPort = new InMemoryGenesisAdapter();
      genesisPort.subscribeToCognitiveDiscoveries = () => {
        return () => {
          unsubCalls++;
        };
      };

      const mockStateStore: any = {
        saveOperationalContext: async (ctx: any) => {
          if (ctx.mode === "PAUSED") {
            persistCalls++;
          }
        },
        loadOperationalContext: async () => null,
        detectInterruptedMissions: async () => [],
      };

      const { controller } = createTestHarness({ stateStore: mockStateStore, genesisPort });
      await controller.boot();

      const firstRes = await controller.shutdown();
      expect(firstRes.ok).toBe(true);
      expect(unsubCalls).toBe(1);
      expect(persistCalls).toBe(1);
      expect(controller.isTeardownReconciled()).toBe(true);

      // Subsequent shutdown calls when already reconciled are immediate no-ops
      const secondRes = await controller.shutdown();
      expect(secondRes.ok).toBe(true);
      expect(unsubCalls).toBe(1);
      expect(persistCalls).toBe(1);

      const thirdRes = await controller.shutdown();
      expect(thirdRes.ok).toBe(true);
      expect(unsubCalls).toBe(1);
      expect(persistCalls).toBe(1);
    });
  });

  // =========================================================================
  // AUD-03: Propagate Admission Rejection Correctly
  // =========================================================================
  describe("AUD-03: Propagate admission rejection correctly in ExecutiveController.receiveStimulus()", () => {
    function setupAdmissionTestHarness(mockAdmissionOutcome: any) {
      const selfModel = new SelfModel();
      const genesisPort = new InMemoryGenesisAdapter();
      const akiraOSPort = new InMemoryAkiraOSAdapter();
      const escalationPort = new InMemoryEscalationAdapter();

      const action = createExecutiveAction({
        id: "act-aud03-test",
        kind: "start_mission",
        confidence: 0.9,
        policyCompliance: true,
        correlation: {
          requestId: "req-aud03",
          correlationId: "corr-aud03",
          invocationId: "inv-aud03",
        },
      });

      const mockReasoningEngine: any = {
        deliberate: async () => Result.success([action]),
      };

      const mockDecisionArbiter: any = {
        arbitrate: async () => Result.success(action),
      };

      const mockAdmissionGateway: any = {
        admitAction: async () => mockAdmissionOutcome,
      };

      const mockPlanningEngine: any = {
        createPlan: async () => Result.success({ id: "plan-1", objective: "obj", steps: [] }),
      };

      const mockMissionRuntime: any = {
        executeMission: async () => ({ id: "m-1", lifecycleState: "COMPLETED" }),
      };

      const mockStateStore: any = {
        saveOperationalContext: async () => {},
        loadOperationalContext: async () => null,
        detectInterruptedMissions: async () => [],
        createMission: async () => {},
        getActiveMission: async () => null,
        loadBeliefs: async () => [],
      };

      const controller = new ExecutiveController({
        selfModel,
        genesisPort,
        akiraOSPort,
        escalationPort,
        reasoningEngine: mockReasoningEngine,
        decisionArbiter: mockDecisionArbiter,
        admissionGateway: mockAdmissionGateway,
        planningEngine: mockPlanningEngine,
        missionRuntime: mockMissionRuntime,
        stateStore: mockStateStore,
      });

      return { controller };
    }

    it("returns Result.failure when admission is rejected with CONCURRENCY_LOCKED", async () => {
      const { controller } = setupAdmissionTestHarness({
        status: "CONCURRENCY_LOCKED",
        activeMissionId: "m-other-running",
        reason: "Concurrency conflict: mission 'm-other-running' is currently RUNNING.",
      });

      await controller.boot();

      const stimulus = createStimulus({
        id: "stim-aud03-concurrency",
        kind: "human_prompt",
        source: "chat",
        payload: { text: "Run mission" },
        correlation: {
          requestId: "req-aud03-1",
          correlationId: "corr-aud03-1",
          invocationId: "inv-aud03-1",
        },
      });

      const result = await controller.receiveStimulus(stimulus);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("MISSION_NOT_ACCEPTED:CONCURRENCY_LOCKED");
        expect(result.error).toContain("Another mission is currently running.");
      }
    });

    it("returns Result.failure when admission is rejected with CAPABILITY_UNAVAILABLE", async () => {
      const { controller } = setupAdmissionTestHarness({
        status: "CAPABILITY_UNAVAILABLE",
        missingCapability: "disk.format",
        reason: "Required capability 'disk.format' is not registered.",
      });

      await controller.boot();

      const stimulus = createStimulus({
        id: "stim-aud03-cap",
        kind: "human_prompt",
        source: "chat",
        payload: { text: "Format disk" },
        correlation: {
          requestId: "req-aud03-2",
          correlationId: "corr-aud03-2",
          invocationId: "inv-aud03-2",
        },
      });

      const result = await controller.receiveStimulus(stimulus);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("MISSION_NOT_ACCEPTED:CAPABILITY_UNAVAILABLE");
        expect(result.error).toContain("A required capability is currently unavailable.");
      }
    });

    it("returns Result.failure when admission requires PAUSED_APPROVAL", async () => {
      const { controller } = setupAdmissionTestHarness({
        status: "PAUSED_APPROVAL",
        escalationId: "esc-123",
        reason: "Operational action requires explicit human authorization.",
      });

      await controller.boot();

      const stimulus = createStimulus({
        id: "stim-aud03-approval",
        kind: "human_prompt",
        source: "chat",
        payload: { text: "Deploy cluster" },
        correlation: {
          requestId: "req-aud03-3",
          correlationId: "corr-aud03-3",
          invocationId: "inv-aud03-3",
        },
      });

      const result = await controller.receiveStimulus(stimulus);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("MISSION_NOT_ACCEPTED:PAUSED_APPROVAL");
        expect(result.error).toContain(
          "Human approval is required before this mission can proceed.",
        );
      }
    });

    it("reports rejected mission admission as failure with a sanitized status, not acceptance", async () => {
      const selfModel = new SelfModel();
      const genesisPort = new InMemoryGenesisAdapter();
      const akiraOSPort = new InMemoryAkiraOSAdapter();
      const escalationPort = new InMemoryEscalationAdapter();
      const correlation: CorrelationMetadata = {
        requestId: "req-admission-rejected",
        correlationId: "corr-admission-rejected",
        invocationId: "inv-admission-rejected",
      };
      const action = createExecutiveAction({
        id: "mission-rejected",
        kind: "start_mission",
        intent: "Perform operation",
        rationale: "Private deliberation should not escape",
        confidence: 0.9,
        policyCompliance: true,
        correlation,
      });
      const stateStore = {
        loadOperationalContext: async () => null,
        detectInterruptedMissions: async () => [],
        getActiveMission: async () => null,
        loadBeliefs: async () => [],
      } as any;

      const controller = new ExecutiveController({
        selfModel,
        genesisPort,
        akiraOSPort,
        escalationPort,
        stateStore,
        reasoningEngine: {
          deliberate: async () => Result.success([action]),
        } as any,
        decisionArbiter: {
          arbitrate: async () => Result.success(action),
        } as any,
        admissionGateway: {
          admitAction: async () => ({
            status: "CONCURRENCY_LOCKED",
            activeMissionId: "m-existing",
            reason: "Sensitive internal rule violated",
          }),
        } as any,
        planningEngine: {
          createPlan: async () => Result.failure("planner should not be called"),
        } as any,
        missionRuntime: {
          executeMission: async () => {
            throw new Error("runtime should not be called");
          },
        } as any,
      });

      await controller.boot();
      const result = await controller.receiveStimulus(
        createStimulus({
          id: "stim-rejected",
          kind: "human_prompt",
          source: "chat",
          payload: { text: "Run mission" },
          correlation,
        }),
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain("MISSION_NOT_ACCEPTED:CONCURRENCY_LOCKED");
      expect(result.error).toContain("Another mission is currently running.");
      expect(result.error).not.toContain("Private deliberation should not escape");
      expect(result.error).not.toContain("Sensitive internal rule violated");
    });
  });
});
