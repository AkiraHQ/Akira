/**
 * Impact classification for potential actions.
 */
export type ImpactClass = "LOW" | "MEDIUM" | "HIGH";

/**
 * Reversibility classification for potential actions.
 */
export type ReversibilityClass =
  | "FULLY_REVERSIBLE"      // Can be completely undone without residue (e.g. read, cache write)
  | "PARTIALLY_REVERSIBLE"  // Can be compensated, but side effects remain (e.g. modified task status)
  | "IRREVERSIBLE";         // Cannot be undone (e.g. external network send, database drop, force push)

/**
 * Bounded Operational Policy Envelope.
 * Defines the limits within which VAJRA may deliberate and coordinate actions autonomously.
 */
export interface PolicyEnvelope {
  /** Maximum autonomous cost in USD cents allowed per autonomous execution (e.g. 10 cents) */
  readonly maxAutonomousCostCents: number;

  /** Maximum sequential operational steps allowed before requiring human check-in */
  readonly maxAutonomousSteps: number;

  /** Maximum proactive autonomous wakeups per hour when user is idle */
  readonly maxAutonomousRatePerHour: number;

  /** Explicit catalog of capabilities prohibited from autonomous dispatch */
  readonly prohibitedCapabilities: readonly string[];

  /** Impact class threshold that triggers mandatory human escalation */
  readonly irreversibleActionThreshold: ImpactClass;

  /** Optional minimum epistemic confidence required for autonomous action (default: 0.85) */
  readonly minAutonomousConfidence?: number;

  /** Optional approval timeout in milliseconds before expiration (default: 86400000 / 24h) */
  readonly approvalTtlMs?: number;

  /** Optional version or fingerprint of the policy envelope (default: "1.0.0") */
  readonly policyVersion?: string;
}

/**
 * Default safe policy envelope for desktop operation.
 */
export const DEFAULT_POLICY_ENVELOPE: PolicyEnvelope = Object.freeze({
  maxAutonomousCostCents: 10,
  maxAutonomousSteps: 3,
  maxAutonomousRatePerHour: 5,
  prohibitedCapabilities: Object.freeze([
    "system.db.wipe",
    "git.force_push",
    "os.disk.format",
    "system.credentials.export",
  ]),
  irreversibleActionThreshold: "HIGH",
  minAutonomousConfidence: 0.85,
  approvalTtlMs: 86_400_000,
  policyVersion: "1.0.0",
});
