import { CapabilityDescriptor } from "../../contracts/capabilities/descriptor";
import {
  DEFAULT_POLICY_ENVELOPE,
  PolicyEnvelope,
  ImpactClass,
  ReversibilityClass,
} from "../types/policy";
import {
  OperationalContext,
  createInitialOperationalContext,
} from "../types/operational-context";
import {
  StructuralIdentity,
  AuthorityBoundary,
  SubsystemId,
  SubsystemStatus,
  CapabilityLimitation,
  KnownCapabilityInfo,
  SelfModelSnapshot,
} from "../types/self-model";

const DEFAULT_STRUCTURAL_IDENTITY: StructuralIdentity = Object.freeze({
  name: "VAJRA",
  role: "Central Cognitive Authority",
  authorityLevel: 1,
  coreInvariant: "I am the central brain; I cannot execute commands directly.",
  hierarchy: Object.freeze(["Human", "VAJRA", "SpecializedDomains", "Reality"] as const),
});

const DEFAULT_AUTHORITY_BOUNDARIES: readonly AuthorityBoundary[] = Object.freeze([
  Object.freeze({
    level: 0,
    entity: "Human",
    permissions: Object.freeze([
      "Set and modify global objectives",
      "Veto or override any proposed strategy",
      "Authorize high-impact, irreversible mutations",
      "Inspect full audit logs and deliberation traces",
    ]),
    prohibitions: Object.freeze([]),
  }),
  Object.freeze({
    level: 1,
    entity: "VAJRA",
    permissions: Object.freeze([
      "Global intent understanding and deliberation",
      "Strategic planning and step decomposition",
      "Capability dispatch via AKIRA OS CapabilityRegistry",
      "Observation ingestion and verification judgment",
      "Bounded autonomous action within policy envelope",
    ]),
    prohibitions: Object.freeze([
      "Direct file or filesystem mutation",
      "Direct SQLite database connection or schema mutation",
      "Direct subprocess spawning or OS execution",
      "Direct actuation or control of HANDS",
      "Overriding validated human constraints or directives",
    ]),
  }),
  Object.freeze({
    level: 2,
    entity: "SpecializedDomains",
    permissions: Object.freeze([
      "GENESIS: Autonomous memory formation, association ranking, and context synthesis",
      "AKIRA OS: Canonical capability hosting, SQLite transaction boundaries, schema validation",
      "HANDS: Process sandboxing, timeout kills, and pipe buffering",
    ]),
    prohibitions: Object.freeze([
      "GENESIS: Initiating operational missions or dispatching side-effect Commands",
      "AKIRA OS: Autonomously selecting or pursuing user operational goals",
      "HANDS: Initiating tasks without explicit VAJRA coordination token",
    ]),
  }),
]);

/**
 * Dynamic Self-Model of VAJRA.
 *
 * Represents AKIRA's structural identity, capability availability, limitations,
 * subsystem availability, authority boundaries, policy constraints, operational context,
 * known unknowns, and degraded states.
 *
 * INVARIANT: VAJRA owns authority and cognitive control, not physical execution.
 */
export class SelfModel {
  private identity: StructuralIdentity = DEFAULT_STRUCTURAL_IDENTITY;
  private authorityBoundaries: readonly AuthorityBoundary[] = DEFAULT_AUTHORITY_BOUNDARIES;
  private policy: PolicyEnvelope;
  private operationalContext: OperationalContext;
  private subsystems: Map<SubsystemId, SubsystemStatus> = new Map();
  private capabilities: Map<string, KnownCapabilityInfo> = new Map();
  private knownUnknowns: Set<string> = new Set();
  private degradedReasons: Set<string> = new Set();

  constructor(initialPolicy?: Partial<PolicyEnvelope>) {
    this.policy = Object.freeze({
      ...DEFAULT_POLICY_ENVELOPE,
      ...(initialPolicy ?? {}),
      prohibitedCapabilities: Object.freeze([
        ...(initialPolicy?.prohibitedCapabilities ?? DEFAULT_POLICY_ENVELOPE.prohibitedCapabilities),
      ]),
    });
    this.operationalContext = createInitialOperationalContext();
    this.initializeSubsystems();
  }

  private initializeSubsystems(): void {
    const now = new Date().toISOString();
    const defaults: SubsystemId[] = ["GENESIS", "AKIRA_OS", "HANDS"];
    for (const id of defaults) {
      this.subsystems.set(id, {
        subsystem: id,
        isOnline: true,
        lastHeartbeatAt: now,
        circuitBreakerTripped: false,
        errorCount: 0,
      });
    }
  }

  // --- Identity & Authority ---

  getIdentity(): StructuralIdentity {
    return this.identity;
  }

  getAuthorityBoundaries(): readonly AuthorityBoundary[] {
    return this.authorityBoundaries;
  }

  // --- Policy Envelope ---

  getPolicy(): PolicyEnvelope {
    return this.policy;
  }

  updatePolicy(patch: Partial<PolicyEnvelope>): void {
    this.policy = Object.freeze({
      ...this.policy,
      ...patch,
      prohibitedCapabilities: patch.prohibitedCapabilities
        ? Object.freeze([...patch.prohibitedCapabilities])
        : this.policy.prohibitedCapabilities,
    });
  }

  // --- Operational Context ---

  getOperationalContext(): OperationalContext {
    return this.operationalContext;
  }

  updateOperationalContext(patch: Partial<OperationalContext>): void {
    this.operationalContext = Object.freeze({
      ...this.operationalContext,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }

  // --- Capability Catalog & Limitations ---

  registerCapability(
    descriptor: CapabilityDescriptor<any, any>,
    limitationsPatch?: Partial<CapabilityLimitation>,
  ): void {
    const isReadOnly = descriptor.kind === "Query" || descriptor.executionCharacteristics?.isReadOnly === true;
    const isIdempotent = descriptor.executionCharacteristics?.isIdempotent === true;
    const allowVajra = descriptor.permissions?.allowVajra === true;
    const isAvailable = descriptor.isAvailable !== false;

    const limitations: CapabilityLimitation = Object.freeze({
      isReadOnly,
      isIdempotent,
      costClass: descriptor.costClass ?? "local_cheap",
      activationTier: descriptor.activationTier ?? 1,
      requiresApproval: !isReadOnly && descriptor.costClass === "external_tool",
      ...limitationsPatch,
    });

    const info: KnownCapabilityInfo = Object.freeze({
      name: descriptor.name,
      kind: descriptor.kind,
      owner: descriptor.owner,
      isAvailable,
      allowVajra,
      limitations,
    });

    this.capabilities.set(descriptor.name, info);
  }

  markCapabilityUnavailable(name: string, reason: string): void {
    const existing = this.capabilities.get(name);
    if (existing) {
      this.capabilities.set(
        name,
        Object.freeze({
          ...existing,
          isAvailable: false,
        }),
      );
      this.degradedReasons.add(`Capability '${name}' unavailable: ${reason}`);
    }
  }

  markCapabilityAvailable(name: string): void {
    const existing = this.capabilities.get(name);
    if (existing) {
      this.capabilities.set(
        name,
        Object.freeze({
          ...existing,
          isAvailable: true,
        }),
      );
      // Remove any matching degraded reason
      for (const reason of this.degradedReasons) {
        if (reason.startsWith(`Capability '${name}' unavailable`)) {
          this.degradedReasons.delete(reason);
        }
      }
    }
  }

  getCapability(name: string): KnownCapabilityInfo | undefined {
    return this.capabilities.get(name);
  }

  listCapabilities(): readonly KnownCapabilityInfo[] {
    return Array.from(this.capabilities.values());
  }

  isCapabilityCallableByVajra(name: string): boolean {
    const cap = this.capabilities.get(name);
    if (!cap) return false;
    return cap.isAvailable && cap.allowVajra;
  }

  // --- Subsystem Availability & Circuit Breakers ---

  updateSubsystemStatus(subsystem: SubsystemId, patch: Partial<SubsystemStatus>): void {
    const current = this.subsystems.get(subsystem);
    if (!current) return;

    const updated: SubsystemStatus = Object.freeze({
      ...current,
      ...patch,
      lastHeartbeatAt: patch.lastHeartbeatAt ?? new Date().toISOString(),
    });

    this.subsystems.set(subsystem, updated);

    if (updated.circuitBreakerTripped || !updated.isOnline) {
      this.degradedReasons.add(
        `Subsystem ${subsystem} ${updated.circuitBreakerTripped ? "circuit breaker tripped" : "is offline"}`,
      );
    } else {
      for (const reason of this.degradedReasons) {
        if (reason.startsWith(`Subsystem ${subsystem}`)) {
          this.degradedReasons.delete(reason);
        }
      }
    }
  }

  getSubsystemStatus(subsystem: SubsystemId): SubsystemStatus {
    const status = this.subsystems.get(subsystem);
    if (!status) {
      throw new Error(`Unknown subsystem: ${subsystem}`);
    }
    return status;
  }

  tripSubsystemCircuitBreaker(subsystem: SubsystemId, reason: string): void {
    this.updateSubsystemStatus(subsystem, {
      circuitBreakerTripped: true,
      degradationReason: reason,
    });
  }

  resetSubsystemCircuitBreaker(subsystem: SubsystemId): void {
    const current = this.subsystems.get(subsystem);
    if (!current) return;
    this.updateSubsystemStatus(subsystem, {
      circuitBreakerTripped: false,
      degradationReason: undefined,
      errorCount: 0,
    });
  }

  // --- Epistemic Known Unknowns ---

  addKnownUnknown(assumption: string): void {
    if (assumption && assumption.trim().length > 0) {
      this.knownUnknowns.add(assumption.trim());
    }
  }

  resolveKnownUnknown(assumption: string): void {
    this.knownUnknowns.delete(assumption.trim());
  }

  getKnownUnknowns(): readonly string[] {
    return Array.from(this.knownUnknowns);
  }

  // --- Degraded States & Autonomous Evaluation ---

  isDegraded(): boolean {
    if (this.degradedReasons.size > 0) return true;
    for (const sub of this.subsystems.values()) {
      if (!sub.isOnline || sub.circuitBreakerTripped) return true;
    }
    return this.operationalContext.systemHealthStatus !== "NOMINAL";
  }

  getDegradedReasons(): readonly string[] {
    return Array.from(this.degradedReasons);
  }

  /**
   * Evaluates whether an intended action is permissible under the autonomous policy envelope.
   */
  canExecuteAutonomousAction(opts: {
    impact: ImpactClass;
    reversibility: ReversibilityClass;
    capabilityName?: string;
    estimatedCostCents?: number;
  }): { allowed: boolean; reason?: string } {
    if (opts.capabilityName && this.policy.prohibitedCapabilities.includes(opts.capabilityName)) {
      return {
        allowed: false,
        reason: `Capability '${opts.capabilityName}' is explicitly prohibited from autonomous execution.`,
      };
    }

    if (opts.impact === "HIGH" && opts.reversibility === "IRREVERSIBLE") {
      return {
        allowed: false,
        reason: "High-impact irreversible actions require explicit human escalation.",
      };
    }

    if (
      opts.estimatedCostCents !== undefined &&
      opts.estimatedCostCents > this.policy.maxAutonomousCostCents
    ) {
      return {
        allowed: false,
        reason: `Estimated cost (${opts.estimatedCostCents}¢) exceeds autonomous spend limit (${this.policy.maxAutonomousCostCents}¢).`,
      };
    }

    return { allowed: true };
  }

  // --- Snapshot Serialization ---

  getSnapshot(): SelfModelSnapshot {
    const subRecord: Record<SubsystemId, SubsystemStatus> = {
      GENESIS: this.getSubsystemStatus("GENESIS"),
      AKIRA_OS: this.getSubsystemStatus("AKIRA_OS"),
      HANDS: this.getSubsystemStatus("HANDS"),
    };

    return Object.freeze({
      identity: this.identity,
      authorityBoundaries: this.authorityBoundaries,
      subsystems: Object.freeze(subRecord),
      capabilities: Object.freeze(this.listCapabilities()),
      policy: this.policy,
      operationalContext: this.operationalContext,
      knownUnknowns: Object.freeze(this.getKnownUnknowns()),
      isDegraded: this.isDegraded(),
      degradedReasons: Object.freeze(this.getDegradedReasons()),
      timestamp: new Date().toISOString(),
    });
  }
}
