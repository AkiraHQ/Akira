# VAJRA Phase 7 Implementation Design: Observation, Verification & Reality-State Closure

**Document Version:** 1.0.0-REVISION-2  
**Author:** Antigravity / DeepMind Pair Programming  
**Status:** DESIGN ONLY — REVISION 2 — AWAITING EXPLICIT HUMAN APPROVAL  
**Target Milestone:** Genesis Phase 7 (VAJRA Operational Reality-State Closure)  
**Corpus / Context:** `c:\PROJECTS\Project Akira Master\AKIRA`  

---

## 1. Executive Summary

VAJRA Phase 6 established the deterministic bridge from Executive Decision to Capability Execution:

$$\text{ExecutiveAction} \longrightarrow \text{Admission} \longrightarrow \text{Planning} \longrightarrow \text{Two-Phase Dispatch} \longrightarrow \text{Capability Execution} \longrightarrow \text{Execution Result}$$

However, capability execution alone does not answer what actually transpired in reality. An execution returning `{ ok: true }` proves merely that a software function returned without an uncaught exception; it does **not** prove that the intended real-world side effect persisted, that external systems accepted the mutation, or that cognitive assumptions held true.

**VAJRA Phase 7** closes the operational loop:

$$\text{Execution Result} \longrightarrow \text{Observation} \longrightarrow \text{Evidence Assessment} \longrightarrow \text{Verification} \longrightarrow \text{Mission Outcome} \longrightarrow \text{Reality-State Closure}$$

Phase 7 establishes the deterministic cognitive authority responsible for answering:
> **After Phase 6 executes an operation, what actually happened, how trustworthy is the evidence, did the intended outcome occur, and what authoritative state may VAJRA update as a result?**

### Key Design Pillars
1. **The Six-Stage Epistemic Separation:**
   $$\text{Execution Result (K5)} \ne \text{Observation (K4)} \ne \text{Evidence} \ne \text{Verification (K6)} \ne \text{Mission Completion (K6/K10)} \ne \text{Belief / Memory Update}$$
2. **First-Principles Authority Model:** Verification evaluates reality against previously established completion criteria. It is **not** a second decision arbiter, does not modify mission intent, and cannot create autonomous loops.
3. **Execution Success $\ne$ Epistemic Certainty:** Producer confidence ($\in [0, 1]$) is derived from canonical producer semantics without arbitrary numerical heuristics. Execution success alone **never** promotes a belief, guarantees criteria satisfaction, or implies epistemic certainty. Crucially, execution failure does not automatically prove reality failed.
4. **Reproducible Verification Judgements:** Every verification outcome is recorded in durable SQLite (`vajra_verifications`) referencing discrete `executionResultIds` and `observationIds`, reconstructing exactly *why* a mission succeeded or failed without hidden chain-of-thought.
5. **Strict Epistemic & Memory Boundaries:** Internal epistemic beliefs (`vajra_beliefs`) are reconciled strictly via verified evidence grounded in existing `saveBelief()` contracts, never via raw observations. VAJRA **never** mutates GENESIS memory stores directly; memory handoff is decoupled through the canonical instrumentation `EventBus` and GENESIS `RealityAdapter`.
6. **Zero Database Migrations:** Persists exclusively to the existing Phase 3 schema (`003_vajra_operational_state.sql`), utilizing existing tables `vajra_verifications`, `vajra_beliefs`, `vajra_missions`, `vajra_mission_steps`, and `vajra_operational_state`.

---

## 2. Phase 7 Objective & Scope

### 2.1 Primary Objectives
1. **Normalize Observations (`IObservationReceiver`):** Transform capability execution results, telemetry probes, and background signals into canonical Contract K4 `Observation` envelopes with explicit producer identity, subject, normalized confidence $\in [0, 1]$ as supplied by the producer (evaluated conservatively without invented heuristics), causal provenance, and K19 correlation.
2. **Evaluate Evidence & Verification (`IVerificationEvaluator`):** Deterministically compare accumulated observations against declarative `CompletionCriteria` (Contract K6), yielding a durable `VerificationRecord` (`criteria_satisfied`, `criteria_not_satisfied`, or `inconclusive`).
3. **Govern Mission Completion Authority:** Guarantee that **only VAJRA** can declare mission completion, and **only after verification** satisfies all completion criteria (Invariants I2 and I9).
4. **Close Reality State & Reconcile Beliefs:** Update `vajra_operational_state`, update passive `MissionState`, reconcile internal `vajra_beliefs` strictly against verified evidence via supported `saveBelief()` transitions, and emit decoupled domain events to notify GENESIS cognition.
5. **Handle Staleness, Contradictions, and Recovery:** Deterministically evaluate stale evidence and conflicting observations across authoritative evidence properties (without ungrounded ranking hierarchies), freezing uncertain, unresolvable, or lost-evidence operations to `PAUSED_RECOVERY` rather than manufacturing artificial certainty or universal durability claims.

### 2.2 Boundary Matrix

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                    PHASE 6 DOMAIN                                      │
│  Decision ──► Admission ──► Planning ──► Dispatch ──► Capability Execution (K5 Result)  │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                 Handoff: Result<T, E>
                                            │
┌───────────────────────────────────────────▼────────────────────────────────────────────┐
│                                    PHASE 7 DOMAIN                                      │
│                                                                                        │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │ 1. Observation Intake (IObservationReceiver)                                   │   │
│   │    - Result Normalization ──► K4 Observation (Confidence, Provenance, K19)     │   │
│   │    - Deduplication & Freshness Filtering                                       │   │
│   └───────────────────────────────────────┬────────────────────────────────────────┘   │
│                                           │                                            │
│   ┌───────────────────────────────────────▼────────────────────────────────────────┐   │
│   │ 2. Evidence Assessment & Verification (IVerificationEvaluator)                 │   │
│   │    - Compare Observations against CompletionCriteria                           │   │
│   │    - Detect Contradictions / Staleness / Missing Evidence                      │   │
│   │    - Persist K6 VerificationRecord in SQLite (vajra_verifications)             │   │
│   └───────────────────────────────────────┬────────────────────────────────────────┘   │
│                                           │                                            │
│   ┌───────────────────────────────────────▼────────────────────────────────────────┐   │
│   │ 3. Mission Completion & Reality Closure (MissionClosureManager)                │   │
│   │    - Synthesize K6 MissionResult & Update Passive MissionState                 │   │
│   │    - Transition vajra_missions ──► COMPLETED / FAILED / PAUSED_RECOVERY        │   │
│   │    - Update vajra_operational_state (Clear active_mission_id)                  │   │
│   │    - Reconcile vajra_beliefs (VERIFIED / CONTRADICTED / STALE)                 │   │
│   │    - Emit mission_completed Event ──► EventBus ──► GENESIS RealityAdapter      │   │
│   └────────────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Repository Archaeology & Fact Base

Every design assertion in Phase 7 is grounded in verified repository contracts:

### 3.1 Observation Contract (Contract K4)
- **Path:** `src/contracts/events/observation.ts`
- **Fields:** `id`, `producer`, `subject`, `observationTime`, `correlation` (with `missionId`, `stepId`, `executionId`), `causationId`, `payload`, `confidence` ($\in [0, 1]$), `provenance`, `isRecommendation`.
- **Core Invariant I8:** *"An Observation is never verification (D7)."*
- **Producer Rule:** Any capability or subsystem can emit an Observation; reporting state changes nothing in the observed system.

### 3.2 Capability Result Contract (Contract K5 / K18)
- **Path:** `src/contracts/results/result.ts`
- **Shape:** `Result<T, CapabilityFailure> = { ok: true; value: T; correlation: CorrelationMetadata } | { ok: false; error: CapabilityFailure; correlation: CorrelationMetadata }`.
- **Failure Categories:** `invalid_request`, `capability_unavailable`, `command_rejection`, `execution_failure`, `timeout`.
- **Epistemic Meaning:** Indicates subsystem execution success or failure; does not prove high-level criteria fulfillment.
- **Result Durability Architecture:** In the repository runtime (`src/vajra/mission/runtime.ts`), a successful `Result<T>` payload is held in memory during execution handoff. In the SQLite schema (`vajra_mission_steps`), only the reference string `execution_result_id` is durably stored; there is **no database table** storing full successful `Result.value` blobs. (Failures store `execution_error_json` via `failStep`). Therefore, after a process restart, `execution_result_id` alone does **not** imply that the complete K5 result payload is durably retrievable from SQLite. Observation reconstruction depends on whether the complete result is retrievable from the subsystem or environment; if unavailable, evidence is marked indeterminate.

### 3.3 Verification & Mission Outcome Contract (Contract K6)
- **Path:** `src/contracts/capabilities/verification.ts`
- **`VerificationRecord`:**
  - `id`, `missionId`, `stepId?`, `executionResultIds: readonly string[]`, `observationIds: readonly string[]`, `outcome: "criteria_satisfied" | "criteria_not_satisfied" | "inconclusive"`, `rationale: string`, `verifiedAt: string`, `correlation`.
- **`MissionResult<TOutcome>`:**
  - `id`, `missionId`, `goalId?`, `status: "completed" | "not_completed"`, `verificationRecordId: string`, `outcome: TOutcome`, `producedAt: string`, `correlation`.
- **Core Invariants:**
  - **I9:** *"Execution is never mission completion. Only VAJRA issues a MissionResult, and only after verification (D7; TA §5.5)."*
  - **I2:** *"VAJRA is the only cross-system orchestration authority. Only VAJRA creates a MissionResult. Capability owners, AKIRA OS and GENESIS never do."*

### 3.4 Mission Definition & State Contracts (Contract K10)
- **Paths:** `src/contracts/mission/mission-definition.ts`, `src/contracts/mission/mission-state.ts`
- **`CompletionCriteria`:** `{ description: string; requiredEvidence: readonly string[]; expectedOutcomeSchema?: unknown; }`.
- **`MissionState`:** Passive envelope containing `executionResultIds`, `observationIds`, `verificationRecordIds`, and `terminalResult`. Contains **no** lifecycle status enums or cursors.

### 3.5 SQLite Operational State Schema (Phase 3 Baseline)
- **Path:** `src/persistence/migrations/003_vajra_operational_state.sql`
- **Existing Tables:**
  1. `vajra_operational_state`: Singleton tracking `operational_mode`, `active_mission_id`, `version`, `updated_at`.
  2. `vajra_missions`: Mission ledger with partial unique index `idx_vajra_single_running_mission` on `lifecycle_state = 'RUNNING'`.
  3. `vajra_mission_steps`: Step execution tracking with `dispatch_state`, `execution_result_id` (reference ID string), `execution_error_json` (error details on failure), `dispatched_at`, `executed_at`, `verified_at`. (Zero database storage for successful `Result.value` blobs).
  4. `vajra_verifications`: Verification records with `id`, `mission_id`, `step_id`, `outcome`, `evidence_ids_json`, `evaluator_notes`, `recorded_at`.
  5. `vajra_beliefs`: Internal epistemic beliefs with `id`, `proposition`, `confidence REAL CHECK(confidence >= 0.0 AND confidence <= 1.0)`, `verification_state TEXT CHECK(verification_state IN ('UNVERIFIED', 'VERIFIED', 'CONTRADICTED', 'STALE'))`, `supporting_evidence_ids_json TEXT DEFAULT '[]'`, `contradicting_evidence_ids_json TEXT DEFAULT '[]'`, `last_evaluated_at`, `ttl_ms`, `created_at`.
  6. `vajra_escalations`: Human approval records.
  7. `vajra_deliberation_traces`: Audit traces.
- **Port Interface & Invariants:** `IOperationalStateStore` in `src/vajra/ports/state-store.ts` exposes `saveVerification()`, `getVerificationsForStep()`, `getVerificationsForMission()`, `saveBelief()`, `loadBeliefs()`, and `getBelief()`. Implemented via `SqliteOperationalStateStore` (`INSERT OR REPLACE INTO vajra_beliefs`). The domain contract `EpistemicBelief` enforces strict invariants: `confidence` must be in $[0.0, 1.0]$, and `verificationState` can **never** be `'VERIFIED'` if `contradictingEvidenceIds.length > 0`. Phase 7 does not mutate beliefs via raw observation; only verified evidence can drive reconciliation.

### 3.6 GENESIS Cognition Boundary
- **Path:** `src/genesis/events/reality-adapter.ts`
- **Mechanism:** Subscribes to platform `AkiraEvent`s on `globalEventBus`, translates them to `MemoryEvent`s, and invokes `eventService.record()`.
- **Invariant:** One-way by construction. GENESIS observes platform reality; VAJRA never directly manipulates GENESIS tables or memory trees.

---

## 4. The Phase 6 → Phase 7 Boundary

A clean architectural handover prevents duplication and maintains blast doors.

| Responsibility | Phase 6 (Execution Engine) | Phase 7 (Reality Closure Engine) |
| :--- | :---: | :---: |
| **Admission & Planning** | Owns completely | Non-participating |
| **Two-Phase Dispatch** | Owns execution outside DB | Non-participating |
| **Raw Result Capture** | Records `executionResultId` in `vajra_mission_steps` | Consumes `executionResultId` |
| **Observation Normalization** | Calls `observationReceiver.ingestObservation()` | Implements `IObservationReceiver` |
| **Verification Evaluation** | Calls `verificationEvaluator.evaluateStep()` | Implements `IVerificationEvaluator` |
| **Verification Persistence** | Non-participating | Writes to `vajra_verifications` |
| **Step Verification State** | Updates step dispatch to `VERIFIED` | Validates evidence & criteria |
| **Mission Result Synthesis** | Non-participating | Constructs Contract K6 `MissionResult` |
| **Mission Completion** | Advances loop while verified | Marks `COMPLETED` and passive `MissionState` |
| **Operational Context Update** | Sets `active_mission_id` on start | Clears `active_mission_id` on terminal state |
| **Belief Reconciliation** | Non-participating | Updates `vajra_beliefs` based on evidence |
| **GENESIS Event Handoff** | Non-participating | Publishes `mission_completed` on `EventBus` |

### Architectural Decision: Preservation of Phase 6 Invocations
Phase 6 `runtime.ts` already invokes `this.observationReceiver.ingestObservation()` and `this.verificationEvaluator.evaluateStep()`. Phase 7 does **not** move these invocation points; instead, Phase 7 supplies the concrete domain implementations for these interfaces and introduces `MissionClosureManager` to perform terminal state closure once the execution loop finishes.

---

## 5. Observation Architecture

### 5.1 Observation Pipeline
The `ObservationReceiver` implements `IObservationReceiver` (`src/vajra/ports/observation.ts`):

```
Execution Result / Telemetry / Probe
               │
               ▼
   ObservationReceiver.ingestObservation()
               │
   ┌───────────┴──────────────────────────────┐
   │ 1. Deduplication Gate (ID & K19)         │
   │ 2. Schema & Confidence Normalization     │
   │ 3. Temporal Validity Stamping            │
   │ 4. In-Memory Session Indexing            │
   └───────────┬──────────────────────────────┘
               ▼
   Indexed Observation Pool (by missionId & stepId)
```

**Session Scope & Payload Volatility:** The indexed observation pool is an in-memory session data structure. Neither raw observation payloads nor successful capability `Result.value` blobs are durably stored in SQLite (the database schema stores only `execution_result_id` reference strings in `vajra_mission_steps` and `evidence_ids_json` arrays in `vajra_verifications`). Observations exist in volatile memory for active step/mission verification. Following a crash, observation reconstruction is conditional on whether the complete K5 result payload is retrievable from the environment or subsystem; if unavailable, the evidence is indeterminate.

### 5.2 Authoritative Producer Confidence Model
Contract K4 dictates that `confidence` represents the *producer's* certainty in the observed evidence, represented as a normalized float $\in [0, 1]$. To avoid epistemic speculation, Phase 7 derives confidence strictly from canonical producer and provenance semantics:

1. **Preservation of Producer-Supplied Confidence:** If an executing capability or telemetry provider supplies an explicit confidence score in its execution envelope or payload, Phase 7 preserves that producer certainty verbatim within the normalized $[0, 1]$ interval.
2. **Conservative Evaluation of Unjustified Confidence:** If an execution result or observation producer does not supply explicit confidence semantics, Phase 7 does **not** invent arbitrary numerical heuristics (such as hardcoded tier tables). The verification evaluator treats unjustified or unstated confidence conservatively; unknown confidence is never artificially inflated or assumed high.
3. **No Synthesis of Epistemic Policy:** Phase 7 does not introduce new epistemic ranking policies or speculative numerical formulas into the codebase. All confidence values remain grounded directly in observable producer metadata.
4. **Blast Door Invariant:** Execution success alone (`ok: true`) **never** implies epistemic certainty. A capability returning `{ ok: true }` merely proves that local invocation completed without throwing an unhandled exception. It cannot generate an observation with synthetic certainty ($1.0$) unless backed by explicit, verified evidence.

### 5.3 Observation Normalization Specification
When Phase 6 passes an execution result to `ObservationReceiver.normalizeExecutionResult(step, result, correlation)`:
```typescript
// Reuse canonical Phase 6 / K19 execution or invocation identity; ZERO wall-clock Date.now() generation
const canonicalExecutionId =
  correlation.executionId ?? step.executionResultId ?? correlation.invocationId;

const observation: Observation = createObservation({
  producer: `capability.${step.targetCapability}`,
  subject: step.id,
  payload: result.value,
  // Preserves producer-supplied confidence or applies conservative baseline; zero invented heuristics
  confidence: extractProducerConfidence(result),
  provenance: `Execution result from capability '${step.targetCapability}' (invocation: ${step.id})`,
  correlation: {
    ...correlation,
    missionId: step.missionId,
    stepId: step.id,
    executionId: canonicalExecutionId,
  },
});
```

**Zero Wall-Clock Identity Generation Invariant:** Phase 7 must not manufacture a new execution identity from wall-clock time (`Date.now()`). It strictly reuses the existing canonical Phase 6 / Contract K19 execution or invocation identity already bound to the execution result and correlation envelope:
$$\text{Same Phase 6 Execution} \longrightarrow \text{Same Canonical Execution Identity} \longrightarrow \text{Same Identity After Recovery}$$
This guarantees that observation reconstruction during crash recovery produces identical, deduplicated Contract K19 identifiers without identity drift.

---

## 6. Evidence Model & Taxonomy

Phase 7 evaluates evidence across five explicit categories:

```
                              EVIDENCE POOL
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         ▼                          ▼                          ▼
  DIRECT EVIDENCE           INDIRECT PROBES           CORROBORATING
  Capability Result         Post-Execution Query      Secondary Telemetry
  (Payload & Exit Code)     (Read state from disk/DB) (Metrics / Event Log)
         │                          │                          │
         └──────────────────────────┼──────────────────────────┘
                                    │
                     EVALUATION AGAINST CRITERIA
                                    │
                   ┌────────────────┴────────────────┐
                   ▼                                 ▼
         CONTRADICTORY EVIDENCE               MISSING EVIDENCE
         State contradicts criteria           Required key absent
         (Trigger: REJECT / FAIL)             (Trigger: INCONCLUSIVE)
```

### 6.1 Direct Evidence
Evidence produced immediately by the executing capability. Contained in the `Observation.payload`. Validated against `CompletionCriteria.expectedOutcomeSchema` (via Zod or shape matching).

### 6.2 Indirect / Probing Evidence
Evidence gathered by secondary query capabilities (e.g., executing a read query following a state-mutating command). A secondary probe provides an additional observation for evaluation, but is not inherently infallible or universally superior to self-reports; its evidentiary authority depends strictly on its provenance, freshness, correlation, and direct relationship to the completion criteria.

### 6.3 Corroborating Evidence
Independent evidence originating from a distinct producer supporting the same proposition (e.g., capability returns success AND filesystem modification timestamp advanced). Independent corroborating evidence may strengthen deterministic satisfaction of a completion criterion when its relationship to the criterion is explicitly grounded, but Phase 7 does not numerically aggregate observation confidence values (strictly prohibiting confidence averaging, Bayesian updates, or arbitrary weighting formulas).

### 6.4 Contradictory Evidence
Observations indicating that the expected outcome did not occur (e.g., capability returned success, but subsequent probe shows target file does not exist, or process exit code is non-zero).
- **Rule:** The presence of unaddressed contradictory evidence strictly prohibits `criteria_satisfied`.

### 6.5 Missing Evidence
When `CompletionCriteria.requiredEvidence` specifies evidence tokens (e.g., `["evidence.workspace.format.ok"]`) and no ingested observation matches the required token.

---

## 7. Verification Engine Architecture

### 7.1 Deterministic Evaluation Pipeline
The `VerificationEvaluator` implements `IVerificationEvaluator` (`src/vajra/ports/verification.ts`):

```typescript
export interface IVerificationEvaluator {
  evaluateStep(
    stepId: string,
    missionId: string,
    observations: readonly Observation[],
    criteria: CompletionCriteria,
  ): Promise<VerificationRecord>;
}
```

```
Observations + CompletionCriteria
               │
               ▼
 ┌───────────────────────────────────────────────┐
 │ Gate 1: Evidence Presence Check               │
 │ Does observations pool contain required keys? │
 └─────────────────────┬─────────────────────────┘
                       │ Yes
 ┌─────────────────────▼─────────────────────────┐
 │ Gate 2: Temporal Staleness Check              │
 │ Were observations made after step dispatch?   │
 └─────────────────────┬─────────────────────────┘
                       │ Fresh
 ┌─────────────────────▼─────────────────────────┐
 │ Gate 3: Contradiction Detection               │
 │ Are there conflicting signals in the pool?    │
 └─────────────────────┬─────────────────────────┘
                       │ None
 ┌─────────────────────▼─────────────────────────┐
 │ Gate 4: Payload Schema Validation             │
 │ Does payload satisfy expectedOutcomeSchema?   │
 └─────────────────────┬─────────────────────────┘
                       │ Valid
                       ▼
          CRITERIA SATISFIED (K6)
```

### 7.2 Canonical Outcome Semantics (Contract K6)

| Outcome | Meaning | Trigger Conditions | Next Action |
| :--- | :--- | :--- | :--- |
| **`criteria_satisfied`** | Real-world state deterministically satisfies completion criteria. | Required evidence present, payloads valid, zero unaddressed contradictory evidence, evidence fresh and correlated. | Advance to next step or complete mission. |
| **`criteria_not_satisfied`** | Definitive evidence proves that the intended real-world outcome was NOT achieved. | Verified contradictory observation confirms target state not reached, payload schema definitively violated, or capability returned hard failure with definitive proof of negative state. | Mark step `FAILED`. Transition mission to `FAILED` or trigger bounded replan. |
| **`inconclusive`** | Evidence is missing, indeterminate, contradictory without resolution, or execution failed with unknown real-world outcome. | Capability timeout, missing required evidence token, unresolvable conflicting observations, stale evidence, or execution failure where resulting real-world state is unknown. | Mark step `FAILED`. Transition mission to `PAUSED_RECOVERY`. **Never silently succeed. Never convert unknown outcome into false negative.** |

**Execution Failure vs Outcome Failure Distinction:** A failed execution attempt does **not necessarily prove that the real-world desired outcome failed**; it may mean the outcome is unknown, partially applied, or indeterminate.
- If execution failed with **definitive evidence that the desired state was not achieved** $\longrightarrow \mathbf{criteria\_not\_satisfied}$.
- If execution failed (e.g. transport timeout, connection drop, unconfirmed mutation) but the resulting real-world state is **unknown or indeterminate** $\longrightarrow \mathbf{inconclusive} \longrightarrow \mathbf{PAUSED\_RECOVERY}$.
Transport or tool failure must never masquerade as epistemic knowledge about reality.

### 7.3 Reproducibility & Audit Trails
Every execution of `evaluateStep` constructs a Contract K6 `VerificationRecord`:
```typescript
const record: VerificationRecord = createVerificationRecord({
  missionId,
  stepId,
  executionResultIds: [executionId],
  observationIds: observations.map((o) => o.id),
  outcome,
  rationale,
  correlation: { ...correlation, missionId, stepId },
});
```
This is immediately persisted to SQLite via `stateStore.saveVerification(vajraVerificationRecord)`.
- **Zero Hidden Chain-of-Thought:** The rationale contains only structured causal deductions (e.g., `"Verified evidence token 'evidence.format.ok' from capability.workspace.format; payload matched schema"`).

---

## 8. Mission Completion Authority

### 8.1 The Completion Gating Barrier
To preserve Invariants I2 and I9:
- **Execution success alone cannot complete a mission.**
- **A capability owner can never complete a mission.**
- **GENESIS can never complete a mission.**
- **Only VAJRA can issue a `MissionResult`, and only after verification.**

```
Step 1: EXECUTED ──► VERIFIED (criteria_satisfied)
Step 2: EXECUTED ──► VERIFIED (criteria_satisfied)
                     │
                     ▼
       All Mission Steps Verified?
                     │ Yes
                     ▼
  Full Mission CompletionCriteria Checked
                     │ Satisfied
                     ▼
      createMissionResult(status: "completed")
                     │
                     ▼
   updateMissionLifecycle(missionId, "COMPLETED")
```

### 8.2 Mission Result Construction
When all steps verify successfully, `MissionClosureManager` generates:
```typescript
const missionResult: MissionResult = createMissionResult({
  missionId: mission.id,
  goalId: mission.definition.goalId,
  status: "completed",
  verificationRecordId: terminalVerificationRecord.id,
  outcome: {
    stepsCompleted: steps.length,
    completedAt: new Date().toISOString(),
    verifiedEvidenceTokens: mission.definition.completionCriteria.requiredEvidence,
  },
  correlation: {
    ...mission.correlation,
    missionId: mission.id,
    goalId: mission.definition.goalId,
    verificationRecordId: terminalVerificationRecord.id,
  },
});
```

---

## 9. Staleness, Freshness & Temporal Validity

### 9.1 Temporal Validity Rules
Evidence collected outside the active execution window is epistemically dangerous:
1. **The Pre-Dispatch Guard:** Any observation where $\text{observationTime} < \text{dispatchedAt}$ is classified as **STALE** and discarded from step verification. A prior observation cannot prove the success of a subsequent action.
2. **Freshness TTL:** Observations carry a maximum validity window (default: 60,000ms from `observationTime`). If verification occurs after the TTL expires (e.g. process was suspended), the evidence is marked **EXPIRED**.
3. **Context Version Staleness:** If `operationalContext.version` advances between step dispatch and verification evaluation (indicating that world state was mutated concurrently by another process or user intervention), the evidence is classified as **CONTEXT_DRIFTED**.

### 9.2 Staleness Outcome
If the primary evidence is classified as stale:
$$\text{Stale Evidence} \longrightarrow \text{Outcome: } \mathbf{inconclusive} \longrightarrow \text{State: } \mathbf{PAUSED\_RECOVERY}$$
Stale evidence **never** defaults to success.

---

## 10. Conflicting Evidence Resolution

### 10.1 Conflict Scenarios
A conflict occurs when two or more observations regarding the same subject contradict each other (e.g., `capability.file.write` reports `{ ok: true }`, but `probe.file.verify` reports `{ exists: false }`).

### 10.2 Multi-Property Deterministic Conflict Evaluation

Conflict resolution must never rely on an ungrounded, universal epistemic hierarchy (such as assuming read probes unconditionally outrank self-reports or later timestamps unconditionally override earlier observations). A read probe is **not** automatically authoritative merely because it is a read probe (e.g., a query probe may suffer from file locking, race conditions, incorrect path targeting, or stale client-side caches).

Instead, the verification engine evaluates conflicting signals by analyzing only canonical, authoritative evidence properties:

```
                           CONFLICT ARBITRATION
                                     │
      ┌──────────────────────────────┼──────────────────────────────┐
      ▼                              ▼                              ▼
PROVENANCE & AUTHORITY      TEMPORAL VALIDITY & FRESHNESS     CORRELATION & CRITERIA
Authoritative owner vs      Observation timestamp relative    Exact K19 correlation and
peripheral observer         to dispatch & validity TTL        direct criterion measurement
      │                              │                              │
      └──────────────────────────────┼──────────────────────────────┘
                                     │
                                     ▼
                      Can available evidence resolve
                       contradiction deterministically?
                                     │
                        ┌────────────┴────────────┐
                        ▼                         ▼
                       Yes                        No
                        │                         │
                        ▼                         ▼
              Apply Resolved Outcome         INCONCLUSIVE
                                                  │
                                                  ▼
                                           PAUSED_RECOVERY
                                           (Escalation / Review)
```

1. **Authoritative Evidence Properties:**
   - **Provenance & Source Authority:** Does the producer have definitive domain authority over the subject (e.g., the SQLite engine itself reporting transaction commit vs a background metric service)?
   - **Temporal Validity & Freshness:** Was the observation recorded strictly after step dispatch? Is the observation within its validity TTL?
   - **Consistency & Corroboration:** Are there multiple independent, consistent observations corroborating one signal over the other?
   - **Correlation & Causation:** Does the observation directly correlate via Contract K19 identifiers (`invocationId`, `stepId`, `missionId`) to the specific execution, or could it represent concurrent background noise?
   - **Direct Relationship to Completion Criteria:** Does the evidence directly observe the condition defined in `CompletionCriteria`, or only an indirect proxy?
2. **Residual Uncertainty Rule:** If available evidence cannot deterministically resolve the contradiction across these authoritative properties:
   $$\text{CONTRADICTORY / UNRESOLVED} \longrightarrow \mathbf{INCONCLUSIVE} \longrightarrow \mathbf{PAUSED\_RECOVERY} \text{ / escalation}$$
   - The rationale records both conflicting observation IDs and reasons for indeterminacy.
   - **Zero Epistemic Guessing:** VAJRA never averages conflicting confidences, never takes a "best guess", and never invents an arbitrary priority ladder.

---

## 11. Failure, Recovery & Triage Semantics

| Trigger Event | Phase 7 Evaluation | Resulting State | Recovery Action | Allowed to Replay? |
| :--- | :--- | :--- | :--- | :---: |
| **Capability Timeout** | No observation received / deadline exceeded | `inconclusive` | Mission $\to$ `PAUSED_RECOVERY` | Only if 4 replay conditions met |
| **Execution Failure (Definitive Negative State)** | Definitive proof that target state was NOT achieved | `criteria_not_satisfied` | Mission $\to$ `FAILED` | Evaluate bounded replan (max 1) |
| **Execution Failure (Indeterminate Outcome)** | Execution failed but resulting real-world state is unknown | `inconclusive` | Mission $\to$ `PAUSED_RECOVERY` | Safe recovery / triage (no false negative) |
| **Missing Evidence Token** | Required evidence token absent from observations | `inconclusive` | Mission $\to$ `PAUSED_RECOVERY` | Await recovery or human review |
| **Contradictory Evidence (Definitive Violation)** | Verified evidence proves criteria breached | `criteria_not_satisfied` | Mission $\to$ `FAILED` | Evaluate bounded replan (max 1) |
| **Contradictory Evidence (Unresolvable Conflict)** | Conflicting signals with indeterminate authority | `inconclusive` | Mission $\to$ `PAUSED_RECOVERY` | Await human escalation |
| **Stale / Expired Evidence** | Evidence timestamp prior to dispatch or TTL expired | `inconclusive` | Mission $\to$ `PAUSED_RECOVERY` | Safe recovery / fresh query |
| **Persistence Failure** | SQLite write fails during verification save | `CRITICAL_ERROR` | Halt loop; retain in-memory trace | Retry DB write; no external re-execution |
| **Crash during Verification** | Step `EXECUTED`, no verification record in DB | Boot Recovery Case 3 | Re-evaluate verification from DB | **No external re-execution** |

**Crucial Blast Door:** Phase 7 verification failures **never** trigger automatic execution loops. Re-execution is governed strictly by Phase 6's four-condition replay safety gate and max 1 replan limit. Tool or transport failure is never converted into an assumption about real-world state.

---

## 12. Persistence Mapping & Zero-Migration Proof

### 12.1 Schema Mapping Table
Phase 7 requires zero database migrations. All state is persisted to the tables created in `003_vajra_operational_state.sql`:

| Phase 7 Domain Entity | SQLite Table | Columns Utilized | Existing State Store Method |
| :--- | :--- | :--- | :--- |
| **Verification Record** | `vajra_verifications` | `id`, `mission_id`, `step_id`, `outcome`, `evidence_ids_json`, `evaluator_notes`, `correlation_id`, `invocation_id`, `recorded_at` | `stateStore.saveVerification()` |
| **Mission Outcome** | `vajra_missions` | `lifecycle_state`, `completed_at`, `updated_at`, `state_json` | `stateStore.updateMissionLifecycle()` |
| **Step Verification** | `vajra_mission_steps` | `dispatch_state = 'VERIFIED'`, `verified_at` | Handled via step update / completion |
| **Epistemic Belief** | `vajra_beliefs` | `verification_state`, `supporting_evidence_ids_json`, `contradicting_evidence_ids_json`, `last_evaluated_at`, `confidence` | `stateStore.saveBelief()` |
| **Operational Context** | `vajra_operational_state` | `active_mission_id = NULL`, `operational_mode`, `updated_at`, `version` | `stateStore.saveOperationalContext()` |

### 12.2 Proof of Zero Migration
1. `vajra_verifications` already contains an explicit CHECK constraint: `outcome IN ('criteria_satisfied', 'criteria_not_satisfied', 'inconclusive')`. This matches Contract K6 `VerificationOutcome` identically.
2. `vajra_beliefs` already supports `verification_state IN ('UNVERIFIED', 'VERIFIED', 'CONTRADICTED', 'STALE')` with JSON arrays for evidence IDs.
3. `vajra_operational_state` already allows `active_mission_id` to be set to `NULL` on mission completion.
**Conclusion:** Zero schema migrations are necessary. The database is 100% ready for Phase 7.

---

## 13. Epistemic Beliefs & GENESIS Memory Boundary

### 13.1 Authoritative Epistemic Belief Reconciliation (`vajra_beliefs`)

VAJRA maintains internal operational beliefs regarding system readiness and platform invariants. Phase 7 governs how verified reality evidence interacts with these beliefs while strictly respecting epistemic ownership boundaries.

#### 1. Repository Contract Archaeology & Invariants
- **Persistence Method:** `IOperationalStateStore.saveBelief(belief: EpistemicBelief): Promise<void>` in `src/vajra/ports/state-store.ts`, implemented by `SqliteOperationalStateStore` (`INSERT OR REPLACE INTO vajra_beliefs`).
- **Domain Invariant (from `src/vajra/types/belief.ts`):**
  - `confidence` must be a finite float in $[0.0, 1.0]$.
  - `verification_state` is constrained to `'UNVERIFIED' | 'VERIFIED' | 'CONTRADICTED' | 'STALE'`.
  - **Non-contradiction Invariant:** If `contradictingEvidenceIds.length > 0`, `verificationState` **can never be `'VERIFIED'`**; it must transition to `'CONTRADICTED'`.
  - Supporting and contradicting evidence IDs must reference valid Contract K4 Observation IDs.

#### 2. Epistemic Authority & Ownership Boundaries
- **Raw Observations Never Promote Beliefs:** A raw observation or execution result has zero authority over beliefs (Invariant I8).
- **Only Verified Evidence Drives Reconciliation:** Belief state updates occur strictly as a downstream result of deterministic verification recorded in a `VerificationRecord`.
- **No Generative Belief Fabrication:** Phase 7 is the Observation & Verification engine, not a generative cognitive reasoning agent. Phase 7 never invents arbitrary new propositions, nor does it unilaterally synthesize speculative beliefs.
- **Structured Epistemic Handoff:** Higher-level cognitive beliefs (user traits, domain facts, episodic memory) are never mutated directly by Phase 7; they are communicated via decoupled domain events on `EventBus` to GENESIS cognition.

#### 3. Precise Allowed State Transitions
For pre-existing operational beliefs already tracked in `vajra_beliefs` whose registered propositions directly correspond to verified mission completion criteria tokens:

| Current State | Verified Mission Outcome | New State | Evidence Update | Invariant Check |
| :--- | :--- | :---: | :--- | :--- |
| `UNVERIFIED` / `STALE` | `criteria_satisfied` | **`VERIFIED`** | Append verified observation IDs to `supportingEvidenceIds`. | Allowed **only** if `contradictingEvidenceIds.length === 0`. |
| `VERIFIED` / `UNVERIFIED` | `criteria_not_satisfied` (with verified contradiction) | **`CONTRADICTED`** | Append contradictory observation IDs to `contradictingEvidenceIds`. | Mandatory: non-empty contradiction strictly prohibits `VERIFIED`. |
| Any | `inconclusive` | **Unchanged / `STALE`** | Zero observation IDs added to `supportingEvidenceIds`. | **Never promotes to `VERIFIED`**. If TTL expired, transitions to `STALE`. |
| `VERIFIED` | TTL expired ($\Delta t > \text{ttlMs}$) | **`STALE`** | Retains existing evidence IDs; flags expiration. | Requires fresh mission verification to re-verify. |

All transitions construct an immutable `EpistemicBelief` via `createBelief()` and persist via `stateStore.saveBelief()`. Phase 7 introduces zero schema changes and respects existing epistemic ownership.

### 13.2 GENESIS Memory Boundary (Decoupled Reality Handoff)
VAJRA does not own user identity or episodic narrative memory; GENESIS does.
- **Forbidden:** VAJRA calling `saveMemory()`, modifying GENESIS identity graphs, or writing directly to GENESIS repositories.
- **Canonical Mechanism:** On mission completion, `MissionClosureManager` publishes a domain event to `EventBus`:
  ```typescript
  globalEventBus.publish({
    id: `evt-mission-completed-${mission.id}`,
    type: "mission.completed",
    timestamp: new Date().toISOString(),
    source: "VAJRA · mission_closure",
    entityId: mission.id,
    correlationId: mission.correlationId,
    payload: {
      missionId: mission.id,
      objective: mission.objective,
      status: "completed",
      outcome: missionResult.outcome,
      verifiedEvidence: mission.definition.completionCriteria.requiredEvidence,
    },
    version: 1,
    transient: false,
  });
  ```
- **GENESIS Intake:** GENESIS's `RealityAdapter` (`src/genesis/events/reality-adapter.ts`) subscribes to the bus, translates the event into a `MemoryEvent`, and allows GENESIS cognitive processors (`candidateService`, `understandingEngine`) to independently decide whether to form memories, update user traits, or generate reflections.

---

## 14. Bounded Learning Boundary

If Phase 7 produces insights for future operations:
1. **Scope Limit:** Phase 7 only produces **performance calibration statistics** (e.g., recorded latency of capability $C$, reliability score of producer $P$).
2. **Immutability of Policies:** Phase 7 cannot modify policy rules, cannot alter safety thresholds, and cannot expand autonomous cost limits.
3. **Anti-Self-Writing Blast Door:** Phase 7 contains zero dynamic code evaluation, zero file writing outside SQLite, and zero autonomous mutation of its own verification criteria.

---

## 15. Model Role in Phase 7

1. **Default Rule (Deterministic Primacy):** Verification is **deterministic by default**. Criteria satisfaction is evaluated via deterministic schema matchers, regex pattern assertions, process exit codes, and explicit evidence token equality.
2. **Strictly Constrained Semantic Interpretation:** If a mission completion criterion requires evaluating unstructured human language (e.g., verifying whether an LLM-generated summary accurately reflects source notes), the verification engine may invoke `IModelCoprocessorPort.evaluateHypothesis()` strictly as an **untrusted semantic coprocessor**.
3. **Explicit Verification Sequence:**
   ```text
   Evidence
      ↓
   Model semantic interpretation (untrusted proposal)
      ↓
   Schema validation (Zod schema checking)
      ↓
   Deterministic evaluator / authoritative evidence rules
      ↓
   Verified outcome OR INCONCLUSIVE
   ```
4. **Untrusted Proposal Status & Blast Doors:**
   - Model output is treated strictly as an **untrusted candidate proposal**, never as an authoritative judgement.
   - Model output **never independently satisfies a completion criterion**.
   - The deterministic evaluator independently checks the proposal against schema constraints, known contradictory observations, and temporal validity rules before accepting the interpretation.
   - The model must not:
     - create authoritative verification records,
     - override contradictory evidence,
     - establish criteria satisfaction solely through its self-reported confidence score,
     - promote its own interpretation into an authoritative epistemic belief,
     - bypass deterministic completion criteria.
5. **Non-Silent Failure / Zero Synthetic Fallback:** If model coprocessor interpretation fails, times out, or produces un-parseable output, verification deterministically yields `inconclusive` $\longrightarrow \mathbf{PAUSED\_RECOVERY}$. There is strictly zero synthetic safe-hold fallback or invented success. The deterministic evaluator remains the sole decision authority on criterion satisfaction.

---

## 16. Crash Recovery & Resilience Matrix

### 16.1 Evidence Durability Taxonomy & Repository Reality
Crash recovery in Phase 7 distinguishes between two distinct classes of evidence based on the repository's actual persistence model:
1. **Durable Reference vs In-Memory Payload:** The SQLite database stores only the string identifier `execution_result_id` in `vajra_mission_steps`. The full `Result<T>` payload is held in volatile memory during execution handoff; zero database tables exist to store successful payload blobs.
2. **Conditional Reconstruction Rule:** Because only the ID is stored in SQLite, capability-derived observations are **not** unconditionally recoverable from the database alone. Reconstruction is possible if and only if the complete K5 result payload can be recovered (e.g., via an authoritative environment probe or subsystem query). If the complete payload cannot be recovered, the evidence is classified as unavailable.

```text
Execution Result ID exists in SQLite
                 ↓
   Complete K5 result recoverable?
                 │
                 ├── YES ──► Deterministically reconstruct observation
                 │           (reusing canonical executionId)
                 │
                 └── NO  ──► Evidence unavailable
                                   ↓
                              INCONCLUSIVE
                                   ↓
                             PAUSED_RECOVERY
```

**Crash Recovery Non-Fabrication Invariant:** If an observation cannot be reconstructed following a crash:
- Phase 7 will **never** fabricate, synthesize, or infer the missing evidence.
- Phase 7 will **never** silently treat missing evidence as proof that the operation failed.
- The verification evaluator must mark the judgement as **`inconclusive`**.
- The mission deterministically transitions into **`PAUSED_RECOVERY`** for operator review or planned probe re-dispatch.

### 16.2 Crash Recovery Matrix

```
Crash Point A: Capability executed ──► Process Crash ──► DB has EXECUTED, no in-memory Observation
Crash Point B: In-memory observation lost ──► Process Crash ──► DB has no VerificationRecord
Crash Point C: VerificationRecord saved ──► Process Crash ──► vajra_missions still RUNNING
Crash Point D: Mission COMPLETED ──► Process Crash ──► EventBus publish lost
```

| Crash Point | Durable State on Boot | Boot Recovery Action (Phase 6 / 7) | Re-executes Externally? |
| :--- | :--- | :--- | :---: |
| **Point A (Payload Recoverable)** | Step is `EXECUTED` with `execution_result_id`; complete result retrievable. | Reconstructs observation using canonical execution identity; proceeds to verification. | **NO** |
| **Point A (Payload Unrecoverable)** | Step is `EXECUTED` with `execution_result_id`; complete result cannot be fetched. | Complete evidence unavailable. Yields **`inconclusive`**, transitioning mission to **`PAUSED_RECOVERY`**. | **NO** |
| **Point B (Transient Telemetry Lost)** | In-memory transient telemetry/probe lost; cannot be reconstructed from DB. | Does not fabricate evidence. Verification evaluator yields **`inconclusive`**, transitioning mission to **`PAUSED_RECOVERY`**. | **NO** |
| **Point C** | `vajra_verifications` has record; mission is `RUNNING`. | Recovery inspects verification record. If `criteria_satisfied`, calls `MissionClosureManager` to complete mission. If `criteria_not_satisfied` $\to$ `FAILED`. If `inconclusive` $\to$ `PAUSED_RECOVERY`. | **NO** |
| **Point D** | Mission is `COMPLETED`; event not published. | Mission is already terminal. Re-emits `mission.completed` to EventBus idempotently. | **NO** |

**Zero Re-Execution Invariant:** Under no circumstance does crash recovery during Phase 7 re-execute an external capability. Zero database migrations are introduced; missing or unrecoverable evidence is handled safely via `inconclusive` $\to$ `PAUSED_RECOVERY`. Phase 7 makes zero unsupported claims of universal durability.

---

## 17. Idempotency & Deduplication Semantics

1. **Observation Deduplication:** Every Observation has a deterministic ID or UUID, with its `executionId` anchored directly to the canonical Phase 6 / Contract K19 execution or invocation identity (never re-stamped with wall-clock timestamps). `ObservationReceiver` maintains an LRU set of observed IDs. Ingesting the same Observation ID twice is a silent no-op.
2. **Verification Idempotency:** Evaluating the same step evidence multiple times produces an identical `VerificationRecord` outcome. Re-verifying a completed step returns the existing verification record. If execution evidence is unrecoverable on restart, verification deterministically yields `inconclusive` rather than synthesizing replacement records.
3. **Mission Completion Idempotency:** Transitioning a mission to `COMPLETED` when it is already `COMPLETED` is a safe no-op that returns the existing record.
4. **Event Bus Deduplication:** `RealityAdapter` tracks processed event IDs with a bounded ring buffer (5,000 entries), preventing duplicate memory candidate generation on event replays.

---

## 18. Authority Matrix

| Component | Authoritative For | Must NOT Own |
| :--- | :--- | :--- |
| **Human Operator** | Ultimate intent, policy definition, manual approval overrides | Low-level evidence collation |
| **Phase 5 Arbiter** | Selecting cognitive options, authorizing mission start | Evaluating real-world verification evidence |
| **Phase 6 Runtime** | Two-phase dispatch loop, capability invocation | Declaring verification truth or mission completion |
| **Phase 7 Observation Receiver** | Ingesting and indexing observations, preserving producer-supplied confidence | Evaluating completion criteria |
| **Phase 7 Verification Evaluator** | Deterministically judging evidence against criteria, issuing VerificationRecord | Executing capabilities or mutating operational context |
| **Model Coprocessor** | Providing untrusted candidate proposals for semantic interpretation | Independently satisfying criteria, issuing verification, mutating beliefs |
| **Phase 7 Closure Manager** | Synthesizing MissionResult, transitioning mission lifecycle, reconciling registered beliefs via `saveBelief()` | Fabricating ungrounded beliefs, direct mutation of GENESIS memory |
| **GENESIS Cognition** | Episodic memory formation, reflection, narrative arcs, identity | Operational verification, mission completion |
| **AKIRA OS (HANDS)** | Executing physical tools, providing raw execution results | Verification judgements |
| **SQLite State Store** | Durable persistence of records and transactions | Cognitive decision making |

---

## 19. Architectural Invariants (Contract K-P7)

The following invariants must be enforced by Phase 7 and verified via static AST and integration tests:

- **K-P7-1 (Epistemic Separation):** Capability execution result $\ne$ Observation $\ne$ Evidence $\ne$ Verification $\ne$ Mission Completion.
- **K-P7-2 (Invariant I8 Enforcement):** An Observation is evidence only; an Observation alone can never satisfy verification criteria without evaluator judgement.
- **K-P7-3 (Invariant I9 Enforcement):** Execution success alone cannot complete a mission. Only VAJRA can issue a `MissionResult`, and only after verification confirms criteria satisfaction.
- **K-P7-4 (Invariant I2 Enforcement):** Only VAJRA creates a `MissionResult`. Capability owners, AKIRA OS, and GENESIS are strictly prohibited from issuing mission results.
- **K-P7-5 (Zero Epistemic Guessing):** If evidence is missing, conflicting, indeterminate, or if an execution failed with unknown real-world state, the verification outcome must strictly be `inconclusive`, transitioning the mission to `PAUSED_RECOVERY`. `inconclusive` must never silently become success, and unknown state must not be converted into false negatives.
- **K-P7-6 (Pre-Dispatch Temporal Guard):** Observations collected prior to step dispatch timestamp cannot satisfy step completion criteria.
- **K-P7-7 (Grounded Belief Reconciliation):** Raw capability results or observations cannot directly mutate `vajra_beliefs`. Belief updates require verified evidence, must respect existing `saveBelief()` contracts, and can **never** set `verification_state = 'VERIFIED'` if `contradictingEvidenceIds.length > 0`.
- **K-P7-8 (GENESIS Blast Door):** Phase 7 must never directly import or mutate GENESIS memory repositories. Decoupled handoff must occur exclusively via the platform `EventBus`.
- **K-P7-9 (Zero Direct Capability Execution):** Phase 7 must never invoke `executeCapability` or call `IAkiraOSPort`.
- **K-P7-10 (Zero Database Migrations):** Phase 7 must operate exclusively within the Phase 3 SQLite schema.
- **K-P7-11 (Zero Code Execution Blast Door):** Zero `child_process`, zero `exec`, zero dynamic `eval`, zero direct file system writes outside SQLite.
- **K-P7-12 (Correlation & Provenance Mandate):** Every `VerificationRecord` and `MissionResult` must carry Contract K19 correlation metadata and complete causal provenance.
- **K-P7-13 (Model Proposal Blast Door):** Model output is strictly an untrusted candidate proposal; it can never independently satisfy a completion criterion, override contradictory evidence, or establish authoritative verification.
- **K-P7-14 (No Universal Read-Probe Hierarchy):** Evidence conflict arbitration evaluates only canonical properties (provenance, temporal freshness, consistency, correlation, criteria relevance); read probes do not universally outrank self-reports without authoritative grounding.
- **K-P7-15 (Evidence Durability & Conditional Recovery):** The SQLite database stores only reference string `execution_result_id`, not full K5 `Result.value` blobs. If the complete capability result cannot be recovered after process restart, Phase 7 will never fabricate evidence; verification deterministically yields `inconclusive` $\longrightarrow \mathbf{PAUSED\_RECOVERY}$.
- **K-P7-16 (Canonical Identity Stability & No Wall-Clock IDs):** Observation normalization and reconstruction must strictly reuse the canonical Phase 6 / Contract K19 execution or invocation identity (`correlation.executionId ?? step.executionResultId ?? correlation.invocationId`). Generating synthetic execution identities from wall-clock time (`Date.now()`) is strictly prohibited.
- **K-P7-17 (No Numerical Confidence Aggregation):** Independent corroborating evidence may strengthen deterministic criteria satisfaction when its relationship to the criteria is explicitly grounded, but Phase 7 strictly prohibits numerical confidence aggregation, Bayesian updating, confidence averaging, or arbitrary scoring formulas.

---

## 20. Implementation File Plan

Phase 7 implementation will introduce **minimal, targeted files** under `src/vajra/`:

```
src/vajra/
├── observation/
│   ├── index.ts                # Public exports for observation module
│   ├── types.ts                # Observation indexing, filtering, query types
│   └── receiver.ts             # ObservationReceiver implementing IObservationReceiver
├── verification/
│   ├── index.ts                # Public exports for verification module
│   ├── types.ts                # Verification evaluation context & rule types
│   └── evaluator.ts            # VerificationEvaluator implementing IVerificationEvaluator
└── closure/
    ├── index.ts                # Public exports for closure module
    ├── types.ts                # Reality closure outcomes and belief updates
    └── closure-manager.ts      # MissionClosureManager (Result synthesis, belief update, EventBus)
```

### Component Details

#### 1. `src/vajra/observation/receiver.ts`
- **Implements:** `IObservationReceiver` (`src/vajra/ports/observation.ts`).
- **Dependencies:** `createObservation`, `Observation`, `CorrelationMetadata`.
- **Responsibilities:**
  - Ingests observations.
  - Normalizes raw `Result<T>` from Phase 6 into Contract K4 `Observation`.
  - Indexes observations in memory by `missionId` and `stepId`.
  - Provides query filters by freshness and producer.

#### 2. `src/vajra/verification/evaluator.ts`
- **Implements:** `IVerificationEvaluator` (`src/vajra/ports/verification.ts`).
- **Dependencies:** `IOperationalStateStore`, `createVerificationRecord`, `VerificationRecord`, `CompletionCriteria`.
- **Responsibilities:**
  - Compares observation pool against `CompletionCriteria`.
  - Enforces pre-dispatch temporal freshness.
  - Detects contradictions and missing evidence.
  - Generates immutable `VerificationRecord`.
  - Durably persists record via `stateStore.saveVerification()`.

#### 3. `src/vajra/closure/closure-manager.ts`
- **Dependencies:** `IOperationalStateStore`, `EventBus`, `createMissionResult`, `MissionResult`, `createMissionState`.
- **Responsibilities:**
  - Evaluates full mission criteria once all steps are verified.
  - Generates Contract K6 `MissionResult`.
  - Transitions `vajra_missions` to `COMPLETED` (or terminal state).
  - Clears `active_mission_id` in `vajra_operational_state`.
  - Reconciles `vajra_beliefs` in SQLite.
  - Emits `mission.completed` to `globalEventBus`.

---

## 21. Test Strategy & Test Suite Matrix

To ensure complete verification, Phase 7 will establish 6 dedicated test suites under `tests/vajra/`:

| Test Suite | Scope & Behaviors Asserted |
| :--- | :--- |
| **`tests/vajra/observation/receiver.test.ts`** | - Ingestion and indexing by mission/step ID.<br>- Deduplication of duplicate observation IDs.<br>- Preservation of producer-supplied confidence in $[0, 1]$.<br>- Conservative evaluation of unstated/unjustified confidence without arbitrary heuristics.<br>- Preservation of canonical Phase 6 / Contract K19 execution identity (rejection of wall-clock `Date.now()` generation).<br>- Rejection of confidence $<0$ or $>1$.<br>- Correlation K19 and provenance preservation. |
| **`tests/vajra/verification/evaluator.test.ts`** | - Deterministic evaluation producing `criteria_satisfied`.<br>- Missing required evidence producing `inconclusive`.<br>- Execution failure with definitive negative evidence producing `criteria_not_satisfied`.<br>- Execution failure with indeterminate outcome producing `inconclusive` (never false negative).<br>- Model semantic interpretation treated strictly as untrusted proposal (never independently satisfying criteria).<br>- Pre-dispatch timestamp guard rejecting stale observations.<br>- Durable persistence to `vajra_verifications` in SQLite.<br>- Non-silent failure: `inconclusive` never produces success. |
| **`tests/vajra/closure/closure-manager.test.ts`** | - MissionResult creation upon all steps verified.<br>- Atomic lifecycle transition to `COMPLETED` in SQLite.<br>- Clearing `active_mission_id` in `vajra_operational_state`.<br>- Grounded reconciliation of registered `vajra_beliefs` via `saveBelief()` (promotion to `VERIFIED` only when uncontradicted; contradiction to `CONTRADICTED`).<br>- Publishing `mission.completed` event to `EventBus`. |
| **`tests/vajra/verification/conflicts-and-staleness.test.ts`** | - Multi-property conflict evaluation (provenance, temporal freshness, correlation, criteria relevance).<br>- Asserting read probe does not universally outrank self-report without authoritative grounding.<br>- Handling unresolvable contradictions $\to$ `inconclusive` $\to$ `PAUSED_RECOVERY`.<br>- Handling context version drift mid-verification. |
| **`tests/vajra/verification/crash-recovery.test.ts`** | - Crash Points A–D resilience verification.<br>- Verification when complete K5 result payload is retrievable $\to$ reconstructs observation using canonical execution identity.<br>- Verification when only `execution_result_id` exists in DB but complete result is unrecoverable $\to$ yields `inconclusive` $\to$ `PAUSED_RECOVERY` without fabrication.<br>- Handling lost transient telemetry without fabrication $\to$ `inconclusive` $\to$ `PAUSED_RECOVERY`.<br>- Zero re-execution of external capabilities during recovery. |
| **`tests/vajra/verification/boundary-invariants.test.ts`** | - Static AST checks: zero `child_process`, zero direct file system writes.<br>- Zero direct calls to `IAkiraOSPort.executeCapability`.<br>- Zero direct imports of GENESIS internal memory repositories.<br>- Zero raw SQL queries; all state mediated via `IOperationalStateStore`.<br>- Zero `process.exit` in source files. |

---

## 22. Verification Gates

Before Phase 7 implementation can be considered complete, it must satisfy all authoritative project verification gates:

```powershell
# 1. Zero TypeScript Compiler Errors
npm run type-check

# 2. Complete VAJRA Subsystem Test Suite
npx vitest run tests/vajra

# 3. Static Architecture Invariant Validation (363+ assertions)
npx tsx scripts/validate-architecture.ts

# 4. Entire Repository Vitest Suite (169+ suites, 1590+ tests)
npx vitest run

# 5. Production Vite Build Verification
npm run build

# 6. Synchronize Knowledge Graph (AST-only)
graphify update .
```

---

## 23. Explicit Non-Goals

Phase 7 strictly excludes the following scopes:
- **No Autonomous Execution Loops:** Phase 7 does not re-plan or re-dispatch missions. If verification fails, it transitions to `FAILED` or `PAUSED_RECOVERY` and yields control.
- **No Direct Capability Actuation:** Phase 7 does not execute capabilities or touch `IAkiraOSPort`.
- **No Direct Memory Ownership:** Phase 7 does not write directly to GENESIS memory or identity stores.
- **No Dynamic Policy Writing:** Phase 7 cannot write or modify security rules or policy envelopes.
- **No Schema Migrations:** Phase 7 introduces zero SQLite migrations.
- **No Synthetic Safe-Hold Fallbacks:** Verification never synthesizes a fake success to avoid pausing.

---

## 24. Open Architectural Questions & Resolutions

### Question 1: Should Observations be durably persisted to SQLite?
- **Analysis:** Contract K4 specifies: *"Changes state? No — reporting changes nothing in the observed system."* Contract K15 notes that whether observations are durably persisted is open. `vajra_verifications` stores `evidence_ids_json`, linking the IDs of observations used in each judgement.
- **Resolution:** In Phase 7, Observations are held in an in-memory session ring-buffer per mission, and their IDs are durably stored in `vajra_verifications`. The SQLite database stores only the string identifier `execution_result_id` in `vajra_mission_steps`; it does **not** store full `Result.value` blobs. If the complete capability result can be retrieved from the underlying subsystem or verified via an authoritative probe on boot, the observation is deterministically reconstructed using its canonical execution ID. If the complete result cannot be recovered, Phase 7 makes no unsupported durability claims: evidence is marked unavailable, deterministically yielding `inconclusive` $\longrightarrow$ `PAUSED_RECOVERY`. This maintains zero database migrations without making false durability assumptions or fabricating missing data.

### Question 2: How does Verification handle multi-step missions where Step 1 output feeds into Step 2?
- **Analysis:** In linear multi-step missions, Step 1 produces evidence that Step 2 may require as input or context.
- **Resolution:** Step 1's `VerificationRecord` guarantees that Step 1 succeeded before Step 2 is dispatched. The observation payload from Step 1 is available in the indexed session pool for the runtime coordinator to bind to Step 2 input if declared in the plan.

### Question 3: Should `evaluateStep` support asynchronous verification probes?
- **Analysis:** Some completion criteria require a secondary query capability (e.g. `fs.exists` probe) to confirm state.
- **Resolution:** In Phase 7, `IVerificationEvaluator.evaluateStep` evaluates all observations present in the intake pool. If a plan requires an explicit verification probe, Phase 6's planner generates that probe as a discrete planned `MissionStep` (e.g. Step 1: Write, Step 2: Verify). Phase 7 evaluates the resulting observations. Phase 7 itself never dispatches capabilities.

---

## 25. Final Recommendation & Sign-Off

The architecture presented in this document completes the operational loop of the VAJRA executive subsystem:
- Preserves foundation contracts (K4, K5, K6, K10, K19).
- Enforces strict epistemic blast doors (Execution $\ne$ Observation $\ne$ Verification $\ne$ Completion).
- Maintains decoupled boundaries with GENESIS and AKIRA OS.
- Requires zero schema migrations and introduces zero performance regressions.

---

**DESIGN ONLY — NO CODE IMPLEMENTED. REVISION 2 COMPLETE. AWAITING EXPLICIT HUMAN APPROVAL.**
