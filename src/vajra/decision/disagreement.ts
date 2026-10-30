import { PolicyEnvelope } from "../types/policy";
import { DecisionOption, DisagreementPayload, DisagreementType } from "./types";

/**
 * Manages the 4-step Disagreement Protocol when human directives conflict
 * with verified reality, active evidence, or policy constraints.
 *
 * Core Axioms:
 * 1. VAJRA does NOT silently disobey.
 * 2. VAJRA does NOT blindly execute destructive commands.
 */
export class DisagreementHandler {
  /**
   * Formulates the canonical 4-step Disagreement payload.
   */
  formulateDisagreement(opts: {
    humanDirective: string;
    disagreementReason: string;
    evidenceCitations: readonly string[];
    counterProposal: DecisionOption;
    alternativeOptions?: readonly DecisionOption[];
    isSafetyViolation?: boolean;
  }): DisagreementPayload {
    const type: DisagreementType = opts.isSafetyViolation
      ? "SAFETY_VIOLATION_DISAGREEMENT"
      : "PREFERENCE_DISAGREEMENT";

    return Object.freeze({
      type,
      humanIntentAcknowledged: `Acknowledged intent: "${opts.humanDirective.trim()}"`,
      disagreementReason: opts.disagreementReason,
      evidenceCitations: Object.freeze([...opts.evidenceCitations]),
      counterProposal: Object.freeze({ ...opts.counterProposal }),
      alternativeOptions: opts.alternativeOptions
        ? Object.freeze(opts.alternativeOptions.map(o => Object.freeze({ ...o })))
        : undefined,
    });
  }

  /**
   * Evaluates a human reaffirmation ("Do X anyway") following disagreement.
   *
   * Invariant: Human preference overrides are permitted for sub-optimal plans,
   * but CANNOT override absolute architectural safety blast doors.
   */
  evaluateHumanReaffirmation(
    reaffirmedDirective: string,
    policy: PolicyEnvelope,
    targetCapability?: string,
  ): { allowed: boolean; overrideProvenance?: string; error?: string } {
    const lower = reaffirmedDirective.toLowerCase();

    // Check non-negotiable blast doors
    const isProhibitedCapability = targetCapability && policy.prohibitedCapabilities.includes(targetCapability);
    const hasBlastDoorPattern =
      lower.includes("wipe") ||
      lower.includes("format disk") ||
      lower.includes("force push") ||
      (lower.includes("drop") && lower.includes("table")) ||
      lower.includes("export credentials");

    if (isProhibitedCapability || hasBlastDoorPattern) {
      return {
        allowed: false,
        error:
          "Directive breaches non-negotiable architectural blast doors. Human override is prohibited per Level 1 safety invariants.",
      };
    }

    // Safe human preference override
    return {
      allowed: true,
      overrideProvenance: `Human explicitly reaffirmed directive ("${reaffirmedDirective}"). Executed with logged human override provenance.`,
    };
  }
}
