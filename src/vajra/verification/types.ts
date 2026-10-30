import { VerificationOutcome } from "../../contracts/capabilities/verification";

/**
 * Execution and environment context provided to the verification evaluator.
 */
export interface VerificationContext {
  /** Timestamp when the evaluated step was dispatched (for pre-dispatch guard) */
  readonly stepDispatchedAt?: string;
  /** Maximum validity window in milliseconds from observationTime (default: 60,000ms) */
  readonly ttlMs?: number;
  /** Context version at dispatch time, if tracked */
  readonly initialContextVersion?: number;
  /** Current context version at evaluation time, if tracked */
  readonly currentContextVersion?: number;
  /** Whether the underlying capability reported definitive failure proving negative outcome */
  readonly isDefinitiveNegative?: boolean;
  /** If capability execution failed with indeterminate outcome (timeout, transport error, etc.) */
  readonly isIndeterminateFailure?: boolean;
  /**
   * Untrusted semantic proposal from an external model coprocessor.
   * INVARIANT (K-P7-13): Treated strictly as untrusted proposal, never an authoritative judgement.
   */
  readonly untrustedModelProposal?: {
    readonly candidateJudgement: "satisfied" | "not_satisfied";
    readonly confidence: number;
    readonly explanation?: string;
  };
}

/**
 * Result of evaluating one gate in the deterministic verification pipeline.
 */
export interface VerificationGateResult {
  readonly passed: boolean;
  readonly outcome?: VerificationOutcome;
  readonly failureReason?: string;
  readonly evidenceIdsUsed?: readonly string[];
}
