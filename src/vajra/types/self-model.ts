import { PolicyEnvelope } from "./policy";
import { OperationalContext } from "./operational-context";

/**
 * Structural Identity of VAJRA within the AKIRA architecture.
 */
export interface StructuralIdentity {
  readonly name: "VAJRA";
  readonly role: "Central Cognitive Authority";
  readonly authorityLevel: 1;
  readonly coreInvariant: "I am the central brain; I cannot execute commands directly.";
  readonly hierarchy: readonly ["Human", "VAJRA", "SpecializedDomains", "Reality"];
}

/**
 * Authority level in the AKIRA system:
 * Level 0: Human (Supreme authority, overrides, goals)
 * Level 1: VAJRA (Global deliberation, coordination, planning, verification)
 * Level 2: Specialized Domains (GENESIS, AKIRA OS, HANDS)
 */
export type AuthorityLevel = 0 | 1 | 2;

/**
 * Explicit authority boundary descriptor.
 */
export interface AuthorityBoundary {
  readonly level: AuthorityLevel;
  readonly entity: "Human" | "VAJRA" | "SpecializedDomains";
  readonly permissions: readonly string[];
  readonly prohibitions: readonly string[];
}

/**
 * Subsystem identifiers known to VAJRA.
 */
export type SubsystemId = "GENESIS" | "AKIRA_OS" | "HANDS";

/**
 * Real-time operational and health status of a specialized subsystem.
 */
export interface SubsystemStatus {
  readonly subsystem: SubsystemId;
  readonly isOnline: boolean;
  readonly lastHeartbeatAt: string;
  readonly circuitBreakerTripped: boolean;
  readonly errorCount: number;
  readonly degradationReason?: string;
}

/**
 * Execution limitations and cost characteristics of a known capability.
 */
export interface CapabilityLimitation {
  readonly isReadOnly: boolean;
  readonly isIdempotent: boolean;
  readonly costClass: string;
  readonly activationTier: number;
  readonly requiresApproval: boolean;
  readonly rateLimitPerMinute?: number;
}

/**
 * Representation of a capability known to VAJRA's Self-Model.
 */
export interface KnownCapabilityInfo {
  readonly name: string;
  readonly kind: "Query" | "Command";
  readonly owner: string;
  readonly isAvailable: boolean;
  readonly allowVajra: boolean;
  readonly limitations: CapabilityLimitation;
}

/**
 * Immutable snapshot of the full Self-Model.
 */
export interface SelfModelSnapshot {
  readonly identity: StructuralIdentity;
  readonly authorityBoundaries: readonly AuthorityBoundary[];
  readonly subsystems: Readonly<Record<SubsystemId, SubsystemStatus>>;
  readonly capabilities: readonly KnownCapabilityInfo[];
  readonly policy: PolicyEnvelope;
  readonly operationalContext: OperationalContext;
  readonly knownUnknowns: readonly string[];
  readonly isDegraded: boolean;
  readonly degradedReasons: readonly string[];
  readonly timestamp: string;
}
