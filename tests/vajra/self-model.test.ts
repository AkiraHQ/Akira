import { describe, it, expect } from "vitest";
import { SelfModel } from "../../src/vajra/self-model/self-model";
import { CapabilityDescriptor } from "../../src/contracts/capabilities/descriptor";

describe("VAJRA Self-Model Subsystem", () => {
  it("initializes with structural identity and default safe policy", () => {
    const selfModel = new SelfModel();
    const identity = selfModel.getIdentity();

    expect(identity.name).toBe("VAJRA");
    expect(identity.authorityLevel).toBe(1);
    expect(identity.coreInvariant).toBe("I am the central brain; I cannot execute commands directly.");

    const policy = selfModel.getPolicy();
    expect(policy.maxAutonomousSteps).toBe(3);
    expect(policy.maxAutonomousCostCents).toBe(10);
    expect(policy.prohibitedCapabilities).toContain("git.force_push");
    expect(policy.prohibitedCapabilities).toContain("system.db.wipe");
  });

  it("updates and preserves policy envelope patches", () => {
    const selfModel = new SelfModel();
    selfModel.updatePolicy({ maxAutonomousSteps: 5, maxAutonomousCostCents: 25 });

    const updated = selfModel.getPolicy();
    expect(updated.maxAutonomousSteps).toBe(5);
    expect(updated.maxAutonomousCostCents).toBe(25);
    // Preserves default prohibited list if unpatched
    expect(updated.prohibitedCapabilities).toContain("git.force_push");
  });

  it("registers capabilities and tracks availability and limitations", () => {
    const selfModel = new SelfModel();

    const descriptor: CapabilityDescriptor = {
      name: "task.create",
      kind: "Command",
      version: "1.0.0",
      owner: "AKIRA_OS",
      description: "Creates task",
      inputSchema: {} as any,
      outputSchema: {} as any,
      permissions: { allowVajra: true },
      executionCharacteristics: { isSynchronous: true, isReadOnly: false, isIdempotent: true },
      activationTier: 1,
      costClass: "local_cheap",
      isAvailable: true,
    };

    selfModel.registerCapability(descriptor);

    const cap = selfModel.getCapability("task.create");
    expect(cap).toBeDefined();
    expect(cap?.kind).toBe("Command");
    expect(cap?.allowVajra).toBe(true);
    expect(cap?.isAvailable).toBe(true);
    expect(cap?.limitations.isIdempotent).toBe(true);
    expect(cap?.limitations.isReadOnly).toBe(false);

    expect(selfModel.isCapabilityCallableByVajra("task.create")).toBe(true);

    // Mark unavailable
    selfModel.markCapabilityUnavailable("task.create", "Disk write failed");
    expect(selfModel.isCapabilityCallableByVajra("task.create")).toBe(false);
    expect(selfModel.isDegraded()).toBe(true);
    expect(selfModel.getDegradedReasons()).toContain(
      "Capability 'task.create' unavailable: Disk write failed",
    );

    // Restore availability
    selfModel.markCapabilityAvailable("task.create");
    expect(selfModel.isCapabilityCallableByVajra("task.create")).toBe(true);
    expect(selfModel.isDegraded()).toBe(false);
  });

  it("tracks subsystem health, circuit breakers, and degraded reasons", () => {
    const selfModel = new SelfModel();

    expect(selfModel.isDegraded()).toBe(false);

    selfModel.tripSubsystemCircuitBreaker("AKIRA_OS", "SQLite disk I/O lock timeout");
    expect(selfModel.isDegraded()).toBe(true);

    const osStatus = selfModel.getSubsystemStatus("AKIRA_OS");
    expect(osStatus.circuitBreakerTripped).toBe(true);
    expect(osStatus.degradationReason).toBe("SQLite disk I/O lock timeout");

    // Reset circuit breaker
    selfModel.resetSubsystemCircuitBreaker("AKIRA_OS");
    expect(selfModel.getSubsystemStatus("AKIRA_OS").circuitBreakerTripped).toBe(false);
    expect(selfModel.isDegraded()).toBe(false);
  });

  it("tracks and resolves known unknowns (epistemic assumptions)", () => {
    const selfModel = new SelfModel();

    selfModel.addKnownUnknown("Is the user working on a laptop on battery?");
    selfModel.addKnownUnknown("Is the network connection metered?");

    expect(selfModel.getKnownUnknowns()).toHaveLength(2);
    expect(selfModel.getKnownUnknowns()).toContain("Is the user working on a laptop on battery?");

    selfModel.resolveKnownUnknown("Is the network connection metered?");
    expect(selfModel.getKnownUnknowns()).toHaveLength(1);
    expect(selfModel.getKnownUnknowns()).not.toContain("Is the network connection metered?");
  });

  it("evaluates autonomous actions against the policy envelope", () => {
    const selfModel = new SelfModel();

    // 1. Safe, low-risk, fully reversible action
    const safeCheck = selfModel.canExecuteAutonomousAction({
      impact: "LOW",
      reversibility: "FULLY_REVERSIBLE",
      capabilityName: "task.read",
      estimatedCostCents: 0,
    });
    expect(safeCheck.allowed).toBe(true);

    // 2. Prohibited capability
    const prohibitedCheck = selfModel.canExecuteAutonomousAction({
      impact: "LOW",
      reversibility: "FULLY_REVERSIBLE",
      capabilityName: "git.force_push",
    });
    expect(prohibitedCheck.allowed).toBe(false);
    expect(prohibitedCheck.reason).toContain("explicitly prohibited");

    // 3. High-impact irreversible action
    const irreversibleCheck = selfModel.canExecuteAutonomousAction({
      impact: "HIGH",
      reversibility: "IRREVERSIBLE",
      capabilityName: "task.delete",
    });
    expect(irreversibleCheck.allowed).toBe(false);
    expect(irreversibleCheck.reason).toContain("High-impact irreversible actions require explicit human escalation");

    // 4. Exceeds budget
    const expensiveCheck = selfModel.canExecuteAutonomousAction({
      impact: "MEDIUM",
      reversibility: "PARTIALLY_REVERSIBLE",
      estimatedCostCents: 50,
    });
    expect(expensiveCheck.allowed).toBe(false);
    expect(expensiveCheck.reason).toContain("exceeds autonomous spend limit");
  });

  it("generates a complete, immutable snapshot of the self-model", () => {
    const selfModel = new SelfModel();
    selfModel.addKnownUnknown("Unconfirmed node version");

    const snapshot = selfModel.getSnapshot();
    expect(snapshot.identity.name).toBe("VAJRA");
    expect(snapshot.subsystems.GENESIS.isOnline).toBe(true);
    expect(snapshot.subsystems.AKIRA_OS.isOnline).toBe(true);
    expect(snapshot.knownUnknowns).toContain("Unconfirmed node version");
    expect(snapshot.timestamp).toBeDefined();
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});
