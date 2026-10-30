/**
 * Verification state of an epistemic belief held by VAJRA.
 */
export type VerificationState =
  | "UNVERIFIED"    // Hypothesis or assumption without decisive evidence
  | "VERIFIED"      // Backed by consistent, verified observations
  | "CONTRADICTED"  // Contradicted by incoming observations (requires reconciliation)
  | "STALE";        // Validated previously, but expired or superseded by time

/**
 * Epistemic Belief held within VAJRA's internal cognitive model.
 *
 * Per Target Architecture §13:
 * Belief = <Proposition P, Confidence c in [0, 1], Evidence E, Provenance S, Timestamp t>
 *
 * INVARIANTS:
 * - confidence must be a finite number strictly within [0.0, 1.0].
 * - If contradictingEvidenceIds is non-empty and unaddressed, verificationState cannot be "VERIFIED".
 */
export interface EpistemicBelief {
  readonly id: string;
  readonly proposition: string;
  readonly confidence: number;
  readonly verificationState: VerificationState;
  readonly supportingEvidenceIds: readonly string[];   // References Contract K4 Observation IDs
  readonly contradictingEvidenceIds: readonly string[]; // References Contract K4 Observation IDs
  readonly lastEvaluatedAt: string;                    // ISO-8601 timestamp
  readonly ttlMs?: number;                             // Optional time-to-live before transitioning to STALE
}

/**
 * Pure factory helper to construct a validated, immutable EpistemicBelief.
 */
export function createBelief(opts: {
  id: string;
  proposition: string;
  confidence: number;
  verificationState?: VerificationState;
  supportingEvidenceIds?: readonly string[];
  contradictingEvidenceIds?: readonly string[];
  lastEvaluatedAt?: string;
  ttlMs?: number;
}): EpistemicBelief {
  if (
    typeof opts.confidence !== "number" ||
    Number.isNaN(opts.confidence) ||
    opts.confidence < 0.0 ||
    opts.confidence > 1.0
  ) {
    throw new RangeError(
      `EpistemicBelief confidence must be a finite number in [0.0, 1.0]. Received: ${opts.confidence}`,
    );
  }

  const contradicting = Object.freeze([...(opts.contradictingEvidenceIds ?? [])]);
  let state = opts.verificationState ?? "UNVERIFIED";

  // Invariant: cannot be VERIFIED if contradictory evidence is present
  if (contradicting.length > 0 && state === "VERIFIED") {
    state = "CONTRADICTED";
  }

  return Object.freeze({
    id: opts.id,
    proposition: opts.proposition,
    confidence: opts.confidence,
    verificationState: state,
    supportingEvidenceIds: Object.freeze([...(opts.supportingEvidenceIds ?? [])]),
    contradictingEvidenceIds: contradicting,
    lastEvaluatedAt: opts.lastEvaluatedAt ?? new Date().toISOString(),
    ttlMs: opts.ttlMs,
  });
}
