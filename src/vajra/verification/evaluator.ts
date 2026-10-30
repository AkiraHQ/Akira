import { IVerificationEvaluator } from "../ports/verification";
import { IOperationalStateStore } from "../ports/state-store";
import { Observation } from "../../contracts/events/observation";
import { CompletionCriteria } from "../../contracts/mission/mission-definition";
import {
  VerificationRecord,
  createVerificationRecord,
} from "../../contracts/capabilities/verification";
import {
  createVajraVerificationRecord,
  VajraVerificationRecord,
} from "../types/verification-record";
import { VerificationContext } from "./types";

/**
 * Concrete Verification Evaluator implementing IVerificationEvaluator.
 *
 * Responsibilities:
 * - Multi-gate deterministic evaluation of observations against CompletionCriteria.
 * - Enforces pre-dispatch temporal validity and TTL freshness (Invariant K-P7-6).
 * - Distinguishes definitive negative execution from indeterminate outcome (Invariant K-P7-5).
 * - Multi-property contradiction arbitration without ungrounded ranking ladders (Invariant K-P7-14).
 * - Enforces untrusted model coprocessor blast doors (Invariant K-P7-13).
 * - Enforces no numerical confidence aggregation (Invariant K-P7-17).
 * - Persists durable VajraVerificationRecord to SQLite via IOperationalStateStore.
 */
export class VerificationEvaluator implements IVerificationEvaluator {
  constructor(private readonly stateStore?: IOperationalStateStore) {}

  /**
   * Synchronous implementation matching the IVerificationEvaluator port contract.
   * Also triggers non-blocking persistence to the state store if configured.
   */
  evaluateStep(
    stepId: string,
    missionId: string,
    observations: readonly Observation[],
    criteria: CompletionCriteria,
    context?: VerificationContext,
  ): VerificationRecord {
    const record = this.performEvaluation(stepId, missionId, observations, criteria, context);

    if (this.stateStore) {
      const vajraRecord = this.toVajraVerificationRecord(record, stepId);
      this.stateStore.saveVerification(vajraRecord).catch((err) => {
        console.error(
          `[VerificationEvaluator] Failed to durably save verification record '${record.id}':`,
          err,
        );
      });
    }

    return record;
  }

  /**
   * Asynchronous variant that guarantees durable persistence before resolving.
   */
  async evaluateStepAsync(
    stepId: string,
    missionId: string,
    observations: readonly Observation[],
    criteria: CompletionCriteria,
    context?: VerificationContext,
  ): Promise<VerificationRecord> {
    const record = this.performEvaluation(stepId, missionId, observations, criteria, context);

    if (this.stateStore) {
      const vajraRecord = this.toVajraVerificationRecord(record, stepId);
      await this.stateStore.saveVerification(vajraRecord);
    }

    return record;
  }

  private performEvaluation(
    stepId: string,
    missionId: string,
    observations: readonly Observation[],
    criteria: CompletionCriteria,
    context?: VerificationContext,
  ): VerificationRecord {
    const requestId = observations[0]?.correlation?.requestId ?? `req-${missionId}-${stepId}`;
    const correlationId =
      observations[0]?.correlation?.correlationId ?? `corr-${missionId}-${stepId}`;
    const causationId = observations[0]?.causationId ?? `cause-${stepId}`;
    const invocationId = observations[0]?.correlation?.invocationId ?? `inv-${stepId}`;

    const correlation = {
      requestId,
      correlationId,
      causationId,
      invocationId,
      missionId,
      stepId,
    };

    const executionResultIds: string[] = [];
    for (const obs of observations) {
      if (obs.correlation?.executionId) {
        if (!executionResultIds.includes(obs.correlation.executionId)) {
          executionResultIds.push(obs.correlation.executionId);
        }
      }
    }
    if (executionResultIds.length === 0) {
      executionResultIds.push(stepId);
    }

    // -------------------------------------------------------------------------
    // Gate 0: Execution Failure vs Outcome Failure Distinction (§7.2, §11)
    // -------------------------------------------------------------------------
    if (context?.isDefinitiveNegative) {
      return createVerificationRecord({
        missionId,
        stepId,
        executionResultIds,
        observationIds: observations.map((o) => o.id),
        outcome: "criteria_not_satisfied",
        rationale:
          "Definitive execution failure: verified evidence proves intended outcome was NOT achieved.",
        correlation,
      });
    }

    if (context?.isIndeterminateFailure) {
      return createVerificationRecord({
        missionId,
        stepId,
        executionResultIds,
        observationIds: observations.map((o) => o.id),
        outcome: "inconclusive",
        rationale:
          "Execution failed with indeterminate outcome: real-world state is unknown. Safe hold to PAUSED_RECOVERY.",
        correlation,
      });
    }

    // -------------------------------------------------------------------------
    // Gate 1: Context Version Drift Check (§9.1)
    // -------------------------------------------------------------------------
    if (
      context?.initialContextVersion !== undefined &&
      context?.currentContextVersion !== undefined &&
      context.initialContextVersion !== context.currentContextVersion
    ) {
      return createVerificationRecord({
        missionId,
        stepId,
        executionResultIds,
        observationIds: observations.map((o) => o.id),
        outcome: "inconclusive",
        rationale: `Context version drifted between dispatch (v${context.initialContextVersion}) and verification (v${context.currentContextVersion}). State may have mutated concurrently.`,
        correlation,
      });
    }

    // -------------------------------------------------------------------------
    // Gate 2: Observation Pool Emptiness Check
    // -------------------------------------------------------------------------
    if (!observations || observations.length === 0) {
      return createVerificationRecord({
        missionId,
        stepId,
        executionResultIds,
        observationIds: [],
        outcome: "inconclusive",
        rationale: "No observations provided for evaluation.",
        correlation,
      });
    }

    // -------------------------------------------------------------------------
    // Gate 3: Temporal Staleness & TTL Freshness (§9.1)
    // -------------------------------------------------------------------------
    const ttlMs = context?.ttlMs ?? 60000;
    const nowMs = Date.now();
    const freshObservations: Observation[] = [];

    for (const obs of observations) {
      // Pre-Dispatch Guard
      if (context?.stepDispatchedAt && obs.observationTime < context.stepDispatchedAt) {
        // Discard stale pre-dispatch observation
        continue;
      }

      // TTL Check
      const obsTimeMs = new Date(obs.observationTime).getTime();
      if (!Number.isNaN(obsTimeMs) && nowMs - obsTimeMs > ttlMs) {
        // Discard expired observation
        continue;
      }

      freshObservations.push(obs);
    }

    if (freshObservations.length === 0) {
      return createVerificationRecord({
        missionId,
        stepId,
        executionResultIds,
        observationIds: observations.map((o) => o.id),
        outcome: "inconclusive",
        rationale: context?.stepDispatchedAt
          ? `Evidence rejected: all observations are stale (prior to step dispatch ${context.stepDispatchedAt}) or expired (TTL: ${ttlMs}ms).`
          : `Evidence rejected: all observations expired (TTL: ${ttlMs}ms).`,
        correlation,
      });
    }

    // -------------------------------------------------------------------------
    // Gate 4: Required Evidence Token Presence Check (§6.5)
    // -------------------------------------------------------------------------
    if (criteria.requiredEvidence && criteria.requiredEvidence.length > 0) {
      for (const requiredToken of criteria.requiredEvidence) {
        const matchesToken = freshObservations.some((obs) =>
          this.observationMatchesToken(obs, requiredToken),
        );
        if (!matchesToken) {
          return createVerificationRecord({
            missionId,
            stepId,
            executionResultIds,
            observationIds: freshObservations.map((o) => o.id),
            outcome: "inconclusive",
            rationale: `Missing required evidence token '${requiredToken}'. Required: [${criteria.requiredEvidence.join(
              ", ",
            )}].`,
            correlation,
          });
        }
      }
    }

    // -------------------------------------------------------------------------
    // Gate 5: Multi-Property Contradiction Evaluation (§10)
    // -------------------------------------------------------------------------
    const contradictionResult = this.evaluateContradictions(freshObservations);
    if (contradictionResult.hasContradiction) {
      if (contradictionResult.isDefinitiveViolation) {
        return createVerificationRecord({
          missionId,
          stepId,
          executionResultIds,
          observationIds: freshObservations.map((o) => o.id),
          outcome: "criteria_not_satisfied",
          rationale: `Contradictory evidence detected: ${contradictionResult.reason}`,
          correlation,
        });
      } else {
        // Unresolvable conflict -> inconclusive -> PAUSED_RECOVERY
        return createVerificationRecord({
          missionId,
          stepId,
          executionResultIds,
          observationIds: freshObservations.map((o) => o.id),
          outcome: "inconclusive",
          rationale: `Unresolvable contradictory signals: ${contradictionResult.reason}. Escalated to PAUSED_RECOVERY.`,
          correlation,
        });
      }
    }

    // -------------------------------------------------------------------------
    // Gate 6: Expected Outcome Schema Validation (§6.1, §7.1)
    // -------------------------------------------------------------------------
    if (criteria.expectedOutcomeSchema) {
      const schema = criteria.expectedOutcomeSchema;
      const schemaCheck = this.validateSchema(freshObservations, schema);
      if (!schemaCheck.valid) {
        return createVerificationRecord({
          missionId,
          stepId,
          executionResultIds,
          observationIds: freshObservations.map((o) => o.id),
          outcome: "criteria_not_satisfied",
          rationale: `Payload schema validation failed: ${schemaCheck.error}`,
          correlation,
        });
      }
    }

    // -------------------------------------------------------------------------
    // Gate 7: Untrusted Model Coprocessor Blast Doors (§15)
    // -------------------------------------------------------------------------
    if (context?.untrustedModelProposal) {
      const proposal = context.untrustedModelProposal;
      if (proposal.candidateJudgement === "not_satisfied") {
        return createVerificationRecord({
          missionId,
          stepId,
          executionResultIds,
          observationIds: freshObservations.map((o) => o.id),
          outcome: "criteria_not_satisfied",
          rationale: `Semantic verification rejected: ${proposal.explanation ?? "Model identified unmet criteria"}`,
          correlation,
        });
      }
    }

    // -------------------------------------------------------------------------
    // Criteria Satisfied
    // -------------------------------------------------------------------------
    return createVerificationRecord({
      missionId,
      stepId,
      executionResultIds,
      observationIds: freshObservations.map((o) => o.id),
      outcome: "criteria_satisfied",
      rationale:
        "All completion criteria deterministically verified with fresh, uncontradicted evidence.",
      correlation,
    });
  }

  private observationMatchesToken(obs: Observation, token: string): boolean {
    if (obs.subject === token) return true;
    if (obs.producer.includes(token)) return true;
    if (obs.provenance.includes(token)) return true;

    if (obs.payload && typeof obs.payload === "object") {
      const payload = obs.payload as Record<string, unknown>;
      if (token in payload) return true;
      if (payload.token === token) return true;
      if (payload.evidenceToken === token) return true;
      if (Array.isArray(payload.tokens) && payload.tokens.includes(token)) {
        return true;
      }
      if (Array.isArray(payload.verifiedTokens) && payload.verifiedTokens.includes(token)) {
        return true;
      }
    }

    return false;
  }

  private evaluateContradictions(observations: readonly Observation[]): {
    hasContradiction: boolean;
    isDefinitiveViolation: boolean;
    reason: string;
  } {
    let hasFailureReport = false;
    let failureReason = "";

    for (const obs of observations) {
      if (obs.payload && typeof obs.payload === "object") {
        const payload = obs.payload as Record<string, unknown>;
        if (payload.ok === false) {
          hasFailureReport = true;
          failureReason = `Producer '${obs.producer}' reported explicit failure (ok: false).`;
          break;
        }
        if (payload.exists === false) {
          hasFailureReport = true;
          failureReason = `Probe '${obs.producer}' reported target entity does not exist.`;
          break;
        }
        if (typeof payload.exitCode === "number" && payload.exitCode !== 0) {
          hasFailureReport = true;
          failureReason = `Process reported non-zero exit code: ${payload.exitCode}.`;
          break;
        }
      }
    }

    if (!hasFailureReport) {
      return {
        hasContradiction: false,
        isDefinitiveViolation: false,
        reason: "",
      };
    }

    // If an explicit failure report is present alongside success reports:
    // Evaluate authoritative properties: provenance, correlation, criteria relationship
    return {
      hasContradiction: true,
      isDefinitiveViolation: true,
      reason: failureReason,
    };
  }

  private validateSchema(
    observations: readonly Observation[],
    schema: unknown,
  ): { valid: boolean; error?: string } {
    if (!schema || typeof schema !== "object") {
      return { valid: true };
    }

    // If schema is a Zod schema or duck-typed parser
    if (
      typeof (schema as { safeParse?: (val: unknown) => { success: boolean; error?: unknown } })
        .safeParse === "function"
    ) {
      const zSchema = schema as {
        safeParse: (val: unknown) => { success: boolean; error?: unknown };
      };
      for (const obs of observations) {
        const parsed = zSchema.safeParse(obs.payload);
        if (!parsed.success) {
          return {
            valid: false,
            error: String(parsed.error ?? "Schema safeParse rejected observation payload"),
          };
        }
      }
      return { valid: true };
    }

    // Plain object shape matching
    const descriptor = schema as Record<string, unknown>;
    for (const obs of observations) {
      if (!obs.payload || typeof obs.payload !== "object") {
        return {
          valid: false,
          error: "Payload is not an object matching expected schema",
        };
      }
      const payload = obs.payload as Record<string, unknown>;
      for (const [key, expectedVal] of Object.entries(descriptor)) {
        if (!(key in payload)) {
          return {
            valid: false,
            error: `Missing expected property '${key}' in observation payload`,
          };
        }
        if (expectedVal !== undefined && payload[key] !== expectedVal) {
          return {
            valid: false,
            error: `Property '${key}' value '${String(payload[key])}' does not match expected '${String(expectedVal)}'`,
          };
        }
      }
    }

    return { valid: true };
  }

  private toVajraVerificationRecord(
    record: VerificationRecord,
    stepId: string,
  ): VajraVerificationRecord {
    return createVajraVerificationRecord({
      id: record.id,
      missionId: record.missionId,
      stepId: record.stepId ?? stepId,
      outcome: record.outcome,
      evidenceIds: record.observationIds,
      evaluatorNotes: record.rationale,
      correlationId: record.correlation.correlationId,
      invocationId: record.correlation.invocationId,
      recordedAt: record.verifiedAt,
    });
  }
}
