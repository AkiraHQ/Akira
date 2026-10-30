# VAJRA PHASE 4 — ADAPTIVE REASONING ENGINE
## ARCHITECTURE & IMPLEMENTATION DESIGN DOCUMENT (REVISION 1)

**Status:** DESIGN REVISED — AWAITING HUMAN APPROVAL FOR IMPLEMENTATION  
**Author:** Antigravity / DeepMind Team  
**Date:** October 4, 2026  
**Revision:** 1 (Architectural Corrections & Blast Door Hardening)  
**Target Architecture:** [`docs/Vajra/VAJRA-BRAIN-ARCHITECTURE.md`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/docs/Vajra/VAJRA-BRAIN-ARCHITECTURE.md)  
**Preceding Phases:** Phase 1 (Legacy Retirement), Phase 2 (Core Domain), Phase 3 (Durable Operational State)  
**Succeeding Phases:** Phase 5 (Decision Arbiter), Phase 6 (Mission Runtime), Phase 7 (Full System Integration)  

---

## 1. Executive Summary

Phase 4 establishes the **Adaptive Reasoning Engine** owned by **VAJRA**, the central cognitive authority of AKIRA.

Previous phases established the essential structural and persistence foundations:
- **Phase 1:** Retired legacy platform systems into `archive/legacy-platform/` with zero dead code.
- **Phase 2:** Established the core VAJRA domain, Self-Model, ExecutiveController lifecycle shell, and port boundaries.
- **Phase 3:** Established durable operational persistence across SQLite migrations (`schema_version = 3`), Two-Phase Dispatch transaction isolation, and K19 correlation provenance.

The overarching mission of AKIRA is:
> **"Build a desktop-first AI companion focused on helping one person become a better version of themselves."**

The authoritative system hierarchy is strictly immutable:
$$\text{Human} \longrightarrow \text{VAJRA} \longrightarrow \{\text{GENESIS}, \text{AKIRA OS}, \text{HANDS}\} \longrightarrow \text{Reality}$$

Within this cognitive hierarchy, the cognitive cycle executes as:
$$\text{Understand} \longrightarrow \mathbf{Reason} \longrightarrow \text{Decide} \longrightarrow \text{Plan} \longrightarrow \text{Coordinate} \longrightarrow \text{Observe} \longrightarrow \text{Verify} \longrightarrow \text{Learn / Update State} \longrightarrow \text{Decide Again}$$

Phase 4 is strictly bounded to the **UNDERSTAND $\longrightarrow$ REASON** transition:
- **What Phase 4 Answers:**
  - *"What appears to be happening?"*
  - *"What evidence supports or contradicts it?"*
  - *"What explanations and hypotheses are plausible?"*
  - *"What remains uncertain or unknown?"*
  - *"What possible consequences might follow?"*
- **What Phase 4 Does NOT Answer:**
  - *"What should VAJRA actually do?"* (Reserved exclusively for **Phase 5 Decision Arbiter**).
- Phase 4 transforms an ingested stimulus, operational context snapshot, epistemic beliefs, and verified observations into a structured, validated, and auditable **`ReasoningResult`**.
- It evaluates premises, flags contradictions, formulates explanatory hypotheses, assesses possible consequences, proposes epistemic updates, and quantifies uncertainty.
- It leverages an adaptive multi-tier strategy routing model (from local deterministic rules to evidence consistency audits to cloud model coprocessors) governed by **capability-aware safe fallback semantics**.

---

## 2. Phase 4 Revision 1 — Architectural Corrections Summary

Revision 1 incorporates ten critical architectural corrections mandated by the design review to guarantee absolute separation of concerns and maintain cognitive blast doors:

| # | Architectural Defect in Initial Design | Revision 1 Architectural Correction | Authoritative Section |
|---|---|---|:---:|
| **1** | **Unsafe Universal Fallback:** Tier 3 model failures fell back directly to Tier 1 deterministic rules, risking false resolution of complex reasoning problems. | **Capability-Aware Safe Fallback:** Strategies declare explicit problem-class capabilities. If Tier 3 fails, Tier 2 is selected only if capable; if incapable, the engine yields `INCONCLUSIVE` or `DEGRADED`. Tier 1 is never a universal fallback. *"Fail safely, not confidently."* | §10, §11, §16 |
| **2** | **Autonomous Re-deliberation Loop:** If state version advanced mid-deliberation, the engine autonomously discarded and re-executed a new reasoning turn, violating the "No Autonomous Loops" blast door. | **Staleness Invalidation Without Loops:** If `contextVersion` mismatch is detected at turn completion, the engine marks the result `STALE_INVALIDATED` and returns control immediately to the caller. Zero autonomous retry loops. | §16, §19 |
| **3** | **Decision Semantics in Reasoning:** Initial design contained `candidateActions`, `ArbitrationCandidate`, and `selectedOption`, encroaching on Phase 5 authority. | **Pure Epistemic Artifacts:** Phase 4 produces strictly hypotheses, interpretations, evidence assessments, contradictions, possible consequences, unresolved questions, and verification suggestions. Zero candidate actions or action rankings. | §6, §11, §14, §15, §21 |
| **4** | **Ambiguous Belief Mutation Authority:** Reasoning engine proposed belief updates and executive controller committed them without a clear authority boundary. | **Decoupled Epistemic Lifecycle:** Reasoning evaluates evidence and produces `ProposedBeliefUpdate` records. Reasoning never mutates or calls `saveBelief()`. Only the State Authority / Phase 5 Decision Arbiter approves transitions for persistence. | §9, §18 |
| **5** | **Hardcoded Memory Retrieval Architecture:** Specified "Maximum 5 historical memories", creating an architectural bottleneck and conflating retrieval with context budgeting. | **GENESIS-Owned Context Retrieval:** VAJRA issues a structured contextual request; GENESIS owns relevance ranking and memory retrieval. Token and count limits are treated strictly as caller-side resource budgets. | §8, §17 |
| **6** | **Unclear Model Routing Authority:** Did not explicitly prohibit the LLM from influencing routing or authority. | **Deterministic Routing Authority:** VAJRA's deterministic router exclusively decides whether model assistance is invoked. External models are untrusted coprocessors and never determine strategy tiers, authority, or execution. | §10, §12, §13 |
| **7** | **Coarse Reasoning Statuses:** Statuses did not cleanly distinguish degraded execution from invalidity or inability to reason. | **Precise 4-State Lifecycle:** Explicitly defines `SUCCESS`, `DEGRADED`, `INCONCLUSIVE`, and `STALE_INVALIDATED` with strict operational semantics. | §15, §16 |
| **8** | **Boolean Strategy Interface:** Strategies implemented only `canHandle(context): boolean`, obscuring problem-solving capabilities. | **Rich Capability Contract:** Strategies declare `StrategyCapabilityDeclaration` specifying supported problem classes, evidence requirements, complexity caps, and uncertainty handling. | §11 |
| **9** | **Action-Centric Deliberation Trace:** Trace example included `selectedOption: "run_test_suite"`. | **Auditable Reasoning Summary:** Trace records interpreted situation, premises considered, hypotheses evaluated, contradictions, unresolved questions, and possible consequences. Zero pre-decided action logs. | §14 |
| **10** | **Pre-Decided Phase 5 Handoff:** Phase 5 interface accepted `candidateActions`. | **Pure Reasoning Handoff:** Phase 5 Decision Arbiter consumes `ReasoningResult` envelope. Phase 5 independently generates decision options, enforces policy envelopes, and selects `ExecutiveAction`. | §21 |

---

## 3. Repository Archaeology

A comprehensive architectural inspection of the existing codebase was conducted across `src/genesis/`, `src/vajra/`, `src/contracts/`, `src/persistence/`, `src/akira-os/`, and `tests/`.

### 3.1 Existing Reasoning Artifacts in `src/genesis/reasoning/`
- **Location:** `src/genesis/reasoning/` (`engine.ts`, `registry.ts`, `types.ts`, `assembly.ts`, `strategies/`)
- **Nature:** Contains a synchronous `ReasoningEngine` that consumes `ReflectionResult` (from episodic memory insights in `src/genesis/insights/`) and executes pluggable strategies: `DeductiveReasoningStrategy`, `ImplicationReasoningStrategy`, and `SynthesisReasoningStrategy`.
- **Finding:** This system is **Memory Reflection Reasoning** specific to GENESIS. It deduces user habits, recurrence patterns, and life implications from episodic timeline events and captured notes. It does not reason about operational missions, system capabilities, terminal execution, or policy compliance.
- **Architectural Decision:** **PRESERVE IN GENESIS**. This code performs memory reflection for GENESIS. It must NOT be moved into VAJRA, nor should VAJRA's operational reasoning engine depend on `ReflectionResult`.

### 3.2 Existing AI Provider & Model Infrastructure in `src/genesis/context/ai/`
- **Location:** `src/genesis/context/ai/` (`provider-manager.ts`, `provider-registry.ts`, `context-engine.ts`, `providers/gemini-provider.ts`, `providers/openrouter-provider.ts`)
- **Nature:** Implements an `AIProvider` interface (`generateContent`, `generateContentStream`), concrete API clients for Google Gemini (`gemini-2.5-flash`) and OpenRouter, response normalization (`StandardAIResponse`), and credential storage in SQLite settings.
- **Finding:** Currently, `src/routes/chat.tsx` directly calls `contextEngine.generateContentStream`, mixing prompt compilation, memory retrieval, markdown serialization, and streaming tokens into a monolithic path.
- **Architectural Decision:** **REUSE HTTP TRANSPORT VIA A NEW BOUNDARY ADAPTER**. The raw API network transports (Gemini, OpenRouter) and key configurations are solid and reusable. However, VAJRA must NOT import `contextEngine` or unstructured prompt builders. VAJRA requires a dedicated boundary port `IModelCoprocessorPort` that dispatches structured JSON schemas, enforces token limits, and validates model output through strict Zod schemas.

### 3.3 Existing Phase 2 VAJRA Core Domain & Ports
- **Location:** `src/vajra/ports/reasoning.ts`, `src/vajra/ports/understanding.ts`, `src/vajra/types/`
- **Finding:** Phase 2 established a placeholder port:
  ```typescript
  export interface IReasoningEngine {
    deliberate(premises: readonly EpistemicBelief[], correlation: CorrelationMetadata): Promise<Result<ReasoningOutcome, string>>;
  }
  ```
  with `ReasoningHypothesis` and `ReasoningOutcome`.
- **Architectural Decision:** **MIGRATE & EVOLVE**. The minimal Phase 2 signature must be expanded into the canonical Phase 4 `ReasoningEngine`, consuming the rich `ReasoningContext` and producing the complete `ReasoningResult` envelope required by Phase 5.

### 3.4 Existing Phase 3 Persistence Infrastructure
- **Location:** `src/persistence/vajra/`, `src/persistence/migrations/003_vajra_operational_state.sql`
- **Finding:** Phase 3 established persistent tables for `vajra_beliefs` (9 columns, confidence $[0, 1]$, verification states) and `vajra_deliberation_traces` (13 columns, K19 correlation, considered options JSON, evidence JSON, rationale).
- **Architectural Decision:** **PRESERVE & UTILIZE**. Phase 4 requires **zero new database tables or schema migrations**. All durable reasoning audit records and epistemic beliefs map directly into the existing Phase 3 schema through `IOperationalStateStore`.

---

## 4. Current Reasoning Landscape

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       CURRENT COGNITIVE LANDSCAPE                                      │
├──────────────────────────────────────────┬─────────────────────────────────────────────────────────────┤
│ **GENESIS Memory Reflection**            │ **VAJRA Operational Deliberation**                          │
│ (src/genesis/reasoning/)                 │ (src/vajra/reasoning/ - Established in Phase 4)             │
├──────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
│ • Subject: The Human                     │ • Subject: The System & Operational Mission                 │
│ • Domain: Habits, reflections, goals     │ • Domain: Capabilities, premises, uncertainties, policies   │
│ • Input: ReflectionResult (notes/events) │ • Input: ReasoningContext (stimulus, beliefs, observations) │
│ • Execution: Synchronous rule engine     │ • Execution: Adaptive multi-tier (rules + model coprocessor)│
│ • Output: ReasoningCollection (insights) │ • Output: ReasoningResult (hypotheses, gaps, contradictions)│
│ • Ownership: GENESIS                     │ • Ownership: VAJRA                                          │
└──────────────────────────────────────────┴─────────────────────────────────────────────────────────────┘
```

---

## 5. Reuse / Migrate / Preserve / Retire / Rebuild Matrix

| Component / File Path | Current Status | Classification | Architectural Rationale & Destination |
|---|---|:---:|---|
| `src/genesis/reasoning/*` | Active in GENESIS | **PRESERVE** | Remains in GENESIS for memory reflection. Must NOT be merged into VAJRA. |
| `src/genesis/understanding/*` | Active in GENESIS | **PRESERVE** | Identity and episodic understanding graph. Queried read-only via `IGenesisPort`. |
| `src/genesis/context/ai/providers/*` | Active API clients | **REUSE (ADAPTER)** | Network transport for Gemini/OpenRouter reused by new VAJRA `IModelCoprocessorPort` adapter. |
| `src/genesis/context/ai/context-engine.ts` | Legacy chat pipeline | **RETIRE (FOR VAJRA)** | Monolithic prompt bundling must never be imported by VAJRA. (Chat migration deferred to Phase 7). |
| `src/vajra/ports/reasoning.ts` | Phase 2 stub contract | **MIGRATE** | Evolve `IReasoningEngine` from minimal stub to comprehensive Phase 4 contract. |
| `src/vajra/types/belief.ts` | Phase 2 domain contract | **PRESERVE** | Authoritative definition of `EpistemicBelief` and `VerificationState`. |
| `src/vajra/types/trace.ts` | Phase 2 domain contract | **PRESERVE & EXTEND**| Authoritative definition of `DeliberationTrace`. |
| `src/persistence/vajra/*` | Phase 3 adapter | **PRESERVE** | `IOperationalStateStore` provides persistence for beliefs and deliberation traces. Zero schema changes. |
| `src/vajra/reasoning/*` | Does not exist | **REBUILD (NEW)** | Brand-new, clean domain implementation of VAJRA Adaptive Reasoning Engine. |

---

## 6. Phase 4 Scope & Responsibilities

### 6.1 What the Adaptive Reasoning Engine Owns:
1. **Reasoning Context Assembly:** Formulates an immutable, filtered, resource-budgeted snapshot of operational state, relevant beliefs, verified observations, and constraints for deliberation.
2. **Belief & Evidence Evaluation:** Evaluates active premises against verified observations (Contract K4) to determine validity and detect contradictions.
3. **Contradiction Detection:** Explicitly flags conflicting observations or premises, preventing premature convergence or unsafe actions.
4. **Hypothesis Formulation:** Generates explanatory hypotheses and causal projections for the situation.
5. **Possible Consequences Projection:** Explores potential operational or state outcomes of formulated hypotheses.
6. **Uncertainty Quantification:** Assesses epistemic confidence, categorizing uncertainty into discrete levels (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
7. **Information Gap & Verification Identification:** Flags unresolved questions and suggests specific verification checks to resolve uncertainty.
8. **Proposed Epistemic Updates:** Produces `ProposedBeliefUpdate` records representing suggested belief transitions (without mutating state).
9. **Capability-Aware Adaptive Strategy Selection:** Deterministically routes deliberation across discrete reasoning tiers based on declared capabilities and enforces safe fallbacks.
10. **Model Coprocessor Mediation:** Manages prompt packaging, schema enforcement, timeout handling, token budgeting, and Zod output validation when invoking LLM coprocessors.
11. **Structured Deliberation Trace Generation:** Synthesizes an auditable `DeliberationTrace` explaining *why* hypotheses were formed and what evidence was relied upon.
12. **Reasoning Result Production:** Compiles the complete `ReasoningResult` envelope for handoff to the Decision Arbiter (Phase 5).

---

## 7. Non-Goals & Strict Exclusions

To preserve cognitive blast doors and prevent architectural boundary violations:
- **NO Final Decision Making:** Phase 4 must NOT select an `ExecutiveAction` (e.g. "Answer", "Execute Mission", "Escalate to Human"). That is the sole authority of the Decision Arbiter (Phase 5).
- **NO Candidate Action Lists:** Phase 4 must NOT construct executable action proposals, action rankings, or pre-decided task structures.
- **NO Mission Planning or Decomposition:** Phase 4 must NOT generate `MissionDefinition` or `MissionStep` objects (Phase 6 Planning Engine).
- **NO Capability Invocation or Execution:** Phase 4 must NOT dispatch capability calls, spawn shell processes, or actuate HANDS.
- **NO Direct SQLite Mutations:** Phase 4 domain code must NEVER import `better-sqlite3` or write SQL.
- **NO Direct Belief State Persistence:** Phase 4 must NOT call `IOperationalStateStore.saveBelief()`. Epistemic changes are proposals only; state mutation authority resides with Phase 5 / State Authority.
- **NO Autonomous Loops or Re-deliberation:** Phase 4 executes single-turn deliberation only. If context becomes stale, it returns `STALE_INVALIDATED` to the caller without auto-restarting.
- **NO Chat UI Wiring:** `src/routes/chat.tsx` remains untouched until Phase 7.
- **NO Self-Modifying Code:** Adaptation is strictly parametric heuristic weighting; code is never generated to alter VAJRA's source files.

---

## 8. Canonical Reasoning Context Architecture

The Reasoning Engine operates over a clean, normalized, resource-bounded snapshot rather than an unconstrained memory dump.

### 8.1 ReasoningContext Schema
```typescript
export interface ReasoningContext {
  readonly stimulus: CognitiveStimulus;
  readonly operationalContext: OperationalContext;
  readonly activeMission?: VajraMissionRecord | null;
  readonly relevantBeliefs: readonly EpistemicBelief[];
  readonly recentObservations: readonly Observation[];
  readonly availableCapabilities: readonly KnownCapabilityInfo[];
  readonly genesisContext?: Readonly<{
    memories: readonly HistoricalMemoryItem[];
    identityTraits: UserIdentityTraits;
  }>;
  readonly selfModelLimits: Readonly<{
    isDegraded: boolean;
    degradedReasons: readonly string[];
    knownUnknowns: readonly string[];
    policyEnvelope: PolicyEnvelope;
  }>;
  readonly contextVersion: number;
  readonly assembledAt: string;
}
```

### 8.2 Selection, Relevance & Sizing Rules
1. **Deterministic Ordering:** All arrays in `ReasoningContext` (beliefs, observations, capabilities, memories) are sorted deterministically by their primary identifiers to guarantee idempotent hashing and reproducible traces.
2. **Relevance Filtering:**
   - *Beliefs:* Include beliefs whose propositions match keywords in the stimulus or active mission objective, plus all beliefs currently in state `CONTRADICTED`.
   - *Observations:* Restrict to observations recorded within the last 15 minutes, or those referenced in active mission state.
3. **GENESIS Memory Retrieval Boundary:**
   - VAJRA requests context based on the operational reasoning need via `IGenesisPort.recallMemories(query)`.
   - **GENESIS owns memory retrieval and relevance ranking.** VAJRA does not implement a secondary memory search engine.
   - Provenance is preserved for every retrieved memory (`provenance: "genesis:memory:<id>"`).
4. **Hard Resource & Token Budget:**
   - Total serialized context payload must not exceed **8,000 tokens** (approx. 32 KB UTF-8).
   - If exceeded, low-relevance historical memories are pruned first according to GENESIS relevance scores, followed by historical observations older than 5 minutes. Active operational context and policy limits are **never** pruned.
   - Resource limits (e.g. max memory count) are caller-side constraints, **not** architectural definitions of memory retrieval.

---

## 9. Belief, Evidence, and Epistemic Lifecycle

Phase 4 utilizes the epistemic model defined in Architecture §13 and persisted in Phase 3 (`vajra_beliefs`):
$$\text{Belief} = \langle \text{Proposition } P, \text{Confidence } c \in [0, 1], \text{Evidence } \mathcal{E}, \text{Provenance } \mathcal{S}, \text{Timestamp } t \rangle$$

### 9.1 Epistemic State Machine
```
   Hypothesis (c in [0.1, 0.5))
       │
       ▼ (Substantiated by Observation K4)
   Substantiated (c in [0.5, 0.85))
       │
       ▼ (Validated by Deterministic Verification K6)
   Validated (c in [0.85, 1.0])
       │
       ▼ (Contradicted by Incompatible Observation)
   Contradicted (c -> 0.0)
```

### 9.2 Strict Separation of Epistemic Operations
To maintain authority blast doors, the epistemic lifecycle explicitly separates five distinct operations:

```
  1. Observation of Contradiction / Evidence (Contract K4)
         │
         ▼
  2. Reasoning Conclusion (Phase 4 Evaluation)
         │
         ▼
  3. ProposedBeliefUpdate (Produced in ReasoningResult)
         │
         ▼
  4. Approved Belief Transition (Phase 5 / State Authority Review)
         │
         ▼
  5. Persisted Belief State (IOperationalStateStore.saveBelief)
```

1. **Reasoning Proposes, Never Commits:** Phase 4 evaluates evidence and formulates `ProposedBeliefUpdate` records within `ReasoningResult`. Phase 4 **never** calls `IOperationalStateStore.saveBelief()`.
2. **Authority for Approval:** The **Phase 5 Decision Arbiter** (or Operational State Authority) reviews proposed updates against operational policy and system authority before approving state transitions.
3. **Contradiction Escalation:** If an incoming observation conflicts with an active belief:
   - The conflict is recorded as a `ContradictionRecord` in `ReasoningResult`.
   - The engine proposes a belief demotion ($c \to 0.0$, state `CONTRADICTED`).
   - Uncertainty is escalated to `CRITICAL`.
   - The engine produces verification suggestions rather than assuming the premise holds.
4. **Stale Evidence Demotion:** Beliefs carrying a `ttlMs` where `Date.now() - lastEvaluatedAt > ttlMs` are flagged as `STALE`. Reasoning will not use stale beliefs as verified premises for critical conclusions.

---

## 10. Adaptive Strategy Model & Capability-Aware Fallback

"Adaptive" in VAJRA is defined as **controlled, deterministic adaptation of reasoning depth and mechanism based on declared strategy capabilities, problem complexity, uncertainty, and policy constraints**.

### 10.1 The Three Reasoning Tiers

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 REASONING TIER MATRIX                                  │
├──────┬─────────────────────────────────┬───────────────────┬───────────┬───────────────┤
│ Tier │ Strategy Name                   │ Mechanism         │ Latency   │ Token Cost    │
├──────┼─────────────────────────────────┼───────────────────┼───────────┼───────────────┤
│  1   │ DeterministicPolicyStrategy     │ Pure Rules / AST  │ < 1ms     │ $0.00         │
│  2   │ EvidenceContradictionStrategy   │ Formal Logic      │ < 5ms     │ $0.00         │
│  3   │ ModelAssistedReasoningStrategy  │ LLM Coprocessor   │ 500-3000ms│ Bounded ($0.01│
└──────┴─────────────────────────────────┴───────────────────┴───────────┴───────────────┘
```

- **Tier 1 (`DeterministicPolicyStrategy`):** Fast rule evaluation, policy conformance checks, rate limit verification, and critical health overrides. *Limitation:* Does not interpret natural language or formulate complex causal hypotheses.
- **Tier 2 (`EvidenceContradictionStrategy`):** Evaluates consistency between verified observations and active beliefs; identifies epistemic contradictions. *Limitation:* Does not resolve open-ended semantic ambiguity.
- **Tier 3 (`ModelAssistedReasoningStrategy`):** Leverages an external LLM coprocessor via `IModelCoprocessorPort` with strict Zod output schemas to interpret ambiguous intent and synthesize hypotheses. *Limitation:* Untrusted probabilistic output; subject to network latency, timeouts, and spend budgets.

### 10.2 Capability-Aware Safe Fallback Semantics
A higher-capability strategy failure must **NEVER** fall back to a weaker strategy unless the weaker strategy explicitly declares that it can validly handle the problem.

> **Core Principle: "Fail safely, not confidently."**  
> Failure of an intelligent strategy must not manufacture false confidence through a weaker strategy.

```
                            Tier 3 (Model) Invocation
                                       │
                         ┌─────────────┴─────────────┐
                         ▼                           ▼
                     [ Success ]                 [ Failure ]
                         │               (Timeout / Schema / Net)
                         │                           │
                         │                           ▼
                         │               Can Tier 2 Validly Reason
                         │                   About Problem Class?
                         │                           │
                         │                   ├── YES ──► Tier 2 Execution
                         │                   │           (Status: DEGRADED)
                         │                   │
                         │                   └── NO  ──► Can Tier 1 Validly Handle
                         │                                 Problem Class?
                         │                                       │
                         │                                 ├── YES ──► Tier 1 Execution
                         │                                 │           (Status: DEGRADED)
                         │                                 │
                         │                                 └── NO  ──► Status: INCONCLUSIVE
                         │                                             (No false confidence)
                         │                                             Uncertainty: HIGH/CRITICAL
                         ▼                                             │
                  ReasoningResult ◄────────────────────────────────────┘
```

#### Fallback Rules:
1. **Tier 3 Failure $\longrightarrow$ Tier 2 Evaluation:** If Tier 3 fails (network error, timeout, or Zod validation failure), the router checks `tier2Strategy.canHandleProblem(problemClass)`.
   - If Tier 2 is capable: Tier 2 executes. The result is marked `status: "DEGRADED"`, with fallback provenance recorded.
   - If Tier 2 is incapable: The router checks Tier 1.
2. **Tier 2 Failure / Incapability $\longrightarrow$ Tier 1 Evaluation:** The router checks `tier1Strategy.canHandleProblem(problemClass)`.
   - If Tier 1 is capable: Tier 1 executes with `status: "DEGRADED"`.
   - If Tier 1 is incapable: The engine **refuses to fake a result**. It immediately yields `status: "INCONCLUSIVE"`, sets `uncertaintyLevel: "HIGH"` or `"CRITICAL"`, records `unresolvedQuestions`, and returns.
3. **No Confidence Escalation:** A degraded fallback result can never report higher confidence than the degraded strategy's capability allows (capped at $0.40$ for fallback results).

---

## 11. Strategy Capability Contracts

Every reasoning strategy implements a rich capability contract declaring what classes of problems it can solve:

```typescript
export type ProblemClass =
  | "POLICY_CONFORMANCE"
  | "OBSERVATION_CONSISTENCY"
  | "AMBIGUOUS_INTENT_INTERPRETATION"
  | "CAUSAL_HYPOTHESIS_GENERATION"
  | "SYNTHESIS_AND_SUMMARIZATION";

export interface StrategyCapabilityDeclaration {
  readonly supportedProblemClasses: readonly ProblemClass[];
  readonly requiredEvidenceTypes: readonly string[];
  readonly maxComplexity: "LOW" | "MEDIUM" | "HIGH";
  readonly requiresExternalModel: boolean;
  readonly handlesUncertainty: boolean;
  readonly producesHypotheses: boolean;
  readonly detectsContradictions: boolean;
  readonly supportsDegradedOperation: boolean;
}

export interface IVajraReasoningStrategy {
  readonly id: string;
  readonly tier: 1 | 2 | 3;
  readonly capabilities: StrategyCapabilityDeclaration;
  canHandle(context: ReasoningContext, problemClass: ProblemClass): boolean;
  execute(
    context: ReasoningContext,
    problemClass: ProblemClass,
    correlation: CorrelationMetadata,
  ): Promise<Result<StrategyReasoningOutput, string>>;
}
```

### 11.1 Pure Reasoning Output Contract (`StrategyReasoningOutput`)
The strategy output contract contains **strictly reasoning artifacts**, with zero decision or action semantics:

```typescript
export interface StrategyReasoningOutput {
  readonly strategyId: string;
  readonly problemClass: ProblemClass;
  readonly hypotheses: readonly ReasoningHypothesis[];
  readonly proposedBeliefUpdates: readonly ProposedBeliefUpdate[];
  readonly contradictions: readonly ContradictionRecord[];
  readonly possibleConsequences: readonly string[];
  readonly uncertaintyLevel: UncertaintyLevel;
  readonly unresolvedQuestions: readonly string[];
  readonly verificationSuggestions: readonly string[];
  readonly rationale: string;
  readonly coprocessorMetadata?: ModelCoprocessorMetadata;
}
```

---

## 12. Model Coprocessor Architecture

VAJRA remains completely independent of underlying LLM APIs (Gemini, OpenRouter, Anthropic, local Ollama).

### 12.1 The `IModelCoprocessorPort` Boundary
```typescript
export interface ModelCoprocessorRequest<TResponse> {
  readonly systemPrompt: string;
  readonly structuredContext: unknown;
  readonly outputSchema: z.ZodSchema<TResponse>;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly correlation: CorrelationMetadata;
}

export interface ModelCoprocessorResponse<TResponse> {
  readonly parsed: TResponse;
  readonly rawText: string;
  readonly model: string;
  readonly provider: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costCents: number;
  readonly latencyMs: number;
}

export interface IModelCoprocessorPort {
  invokeStructuredCoprocessor<TResponse>(
    request: ModelCoprocessorRequest<TResponse>,
  ): Promise<Result<ModelCoprocessorResponse<TResponse>, string>>;
}
```

### 12.2 Coprocessor Invariants:
1. **Model Outputs Are Untrusted Evidence:** Model responses are strictly external evidence signals (Contract K4). They are **never** authoritative commands.
2. **Deterministic Routing Authority:** VAJRA's deterministic router decides whether model assistance is invoked. The model **never** determines its own tier, its own authority, whether tools execute, or whether human approval is required.
3. **No Free-Text Output:** The coprocessor port mandates a Zod output schema. The model must return valid JSON matching the schema; raw unstructured strings are rejected.
4. **Timeout Enforcement:** Requests carry a mandatory timeout (default: 5,000ms). If exceeded, the request aborts via `AbortSignal` and triggers capability-aware fallback.
5. **Token & Spend Limits:** Enforces `maxTokens` (default: 1,500 tokens). Autonomous calls respect the Policy Envelope spend cap (`maxAutonomousCostCents`).
6. **Zero Execution Authority:** The coprocessor cannot execute tools, alter databases, or spawn processes.

---

## 13. Deterministic Authority vs. Probabilistic Intelligence

To guarantee system stability, the boundary between deterministic code and probabilistic models is absolute:

| Feature / Subsystem | Deterministic (TypeScript / SQLite) | Probabilistic (LLM Coprocessor) |
|---|:---:|:---:|
| **Authority & Policy Enforcement** | ✅ Full Authority | ❌ Zero Authority |
| **Strategy Tier Selection** | ✅ Full Authority | ❌ Zero Influence |
| **State Transitions & Database Writes** | ✅ Enforced via ACID | ❌ Zero Direct Access |
| **Capability Invocation & HANDS Control** | ✅ Gated by AKIRA OS | ❌ Zero Direct Control |
| **Hypothesis Generation & Semantic Extraction** | 👁️ Evaluator | ✅ Untrusted Generator |
| **Natural Language Understanding & Synthesis** | 👁️ Validator | ✅ Untrusted Generator |
| **Output Schema Compliance** | ✅ Enforced via Zod | ⚠️ Must Comply or Fail |
| **Audit Trails & Deliberation Logs** | ✅ Immutable Ledger | ❌ Ephemeral Output |

---

## 14. Deliberation Trace Model

In Phase 3, the `vajra_deliberation_traces` table was established with 13 columns. Phase 4 populates this table without altering its schema:

```json
{
  "traceId": "trace-91823-abc",
  "stimulusId": "stim-msg-101",
  "requestId": "req-turn-04",
  "correlationId": "corr-conv-001",
  "invocationId": "inv-delib-55",
  "causationId": "stim-msg-101",
  "intentClass": "ambiguous_user_intent",
  "interpretedSituation": "User requested project build verification. Source files modified 2 minutes ago. Node environment confirmed v20.10.0.",
  "rationale": "High confidence in interpreted build intent. Epistemic premises satisfied. No contradictions observed.",
  "hypothesesEvaluated": [
    { "id": "hyp-01", "description": "User desires clean verification build before commit", "confidence": 0.88 },
    { "id": "hyp-02", "description": "User is troubleshooting a compilation failure", "confidence": 0.25 }
  ],
  "evidenceReliedUpon": [
    "belief-node-v20",
    "obs-git-status-modified"
  ],
  "contradictionsDetected": [],
  "possibleConsequences": [
    "Build execution will consume 15s CPU and generate temporary dist artifacts"
  ],
  "unresolvedQuestions": [],
  "verificationSuggestions": [
    "Check vitest configuration before full test run"
  ],
  "strategyUsed": "ModelAssistedReasoningStrategy",
  "strategyTier": 3,
  "fallbackProvenance": null,
  "escalationRequired": false,
  "timestamp": "2026-10-04T16:45:00.000Z"
}
```

- **Trace Storage Invariant:** Deliberation traces record structured reasoning interpretations, evaluated hypotheses, evidence citations, contradictions, and unresolved questions.
- **Strictly Auditable Summary:** Traces **NEVER** store pre-decided action logs, and **NEVER** store unbounded hidden chain-of-thought scratchpads.

---

## 15. Canonical Reasoning Result Contract (`ReasoningResult`)

The output of Phase 4 is an immutable, structured envelope ready for consumption by the Decision Arbiter (Phase 5):

```typescript
export type UncertaintyLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ReasoningStatus =
  | "SUCCESS"           // Strategy produced valid result within declared capability
  | "DEGRADED"          // Fallback strategy produced valid result within reduced capability
  | "INCONCLUSIVE"      // No capable strategy could sufficiently support reasoning
  | "STALE_INVALIDATED";// State version changed mid-deliberation; result invalidated

export interface ReasoningHypothesis {
  readonly id: string;
  readonly description: string;
  readonly confidence: number;
  readonly supportingEvidenceIds: readonly string[];
}

export interface ProposedBeliefUpdate {
  readonly beliefId: string;
  readonly proposition: string;
  readonly currentConfidence: number;
  readonly proposedConfidence: number;
  readonly proposedVerificationState: VerificationState;
  readonly rationale: string;
  readonly supportingEvidenceIds: readonly string[];
}

export interface ContradictionRecord {
  readonly proposition: string;
  readonly conflictingEvidenceIds: readonly string[];
  readonly explanation: string;
  readonly severity: "WARNING" | "CRITICAL";
}

export interface FallbackProvenance {
  readonly intendedTier: 1 | 2 | 3;
  readonly actualTier: 1 | 2 | 3;
  readonly fallbackReason: "MODEL_TIMEOUT" | "MODEL_ERROR" | "SCHEMA_INVALID" | "CAPABILITY_UNSUPPORTED";
}

export interface ReasoningResult {
  readonly id: string;
  readonly stimulusId: string;
  readonly correlation: CorrelationMetadata;
  readonly contextVersion: number;
  readonly problemClass: ProblemClass;
  readonly strategyUsed: string;
  readonly strategyTier: 1 | 2 | 3;
  readonly status: ReasoningStatus;
  readonly hypotheses: readonly ReasoningHypothesis[];
  readonly proposedBeliefUpdates: readonly ProposedBeliefUpdate[];
  readonly contradictions: readonly ContradictionRecord[];
  readonly possibleConsequences: readonly string[];
  readonly uncertaintyLevel: UncertaintyLevel;
  readonly unresolvedQuestions: readonly string[];
  readonly verificationSuggestions: readonly string[];
  readonly deliberationTrace: DeliberationTrace;
  readonly fallbackProvenance?: FallbackProvenance | null;
  readonly coprocessorMetadata?: ModelCoprocessorMetadata;
  readonly completedAt: string;
}
```

---

## 16. Failure Semantics & Fail-Safe Invariants

| Failure Mode | Direct Consequence | Immediate Fail-Safe Action |
|---|---|---|
| **Model API Unavailable (Network / Key)** | Tier 3 Coprocessor fails | Check Tier 2 capability. If capable, run Tier 2 (`DEGRADED`). If incapable, yield `INCONCLUSIVE`. Record fallback provenance. |
| **Model Request Timeout (> 5,000ms)** | Coprocessor hangs | Abort via `AbortSignal`. Evaluate Tier 2/1 capability. If incapable, yield `INCONCLUSIVE` with uncertainty `HIGH`. |
| **Malformed JSON / Zod Schema Failure** | Model returns invalid schema | Reject model output completely. Evaluate fallback capability. If incapable, yield `INCONCLUSIVE`. |
| **Critical Contradiction Detected** | Incompatible observations | Set uncertainty to `CRITICAL`. Formulate contradiction record. Yield `INCONCLUSIVE` or flagged `DEGRADED` result. |
| **Missing / Insufficient Evidence** | Hypotheses confidence $< 0.40$ | Set uncertainty to `HIGH`. Formulate `unresolvedQuestions` and `verificationSuggestions`. |
| **Stale Context Detected (Version Mismatch)** | State version changed mid-turn | Set status to `STALE_INVALIDATED`. **Return control to caller immediately. NO automatic re-deliberation.** |

---

## 17. GENESIS Boundary

The boundary between VAJRA and GENESIS remains clean, unidirectional, and contract-governed:
- **What VAJRA requests:** VAJRA issues structured contextual queries (`IGenesisPort.recallMemories(query)`) and identity requests (`IGenesisPort.getIdentityTraits()`).
- **GENESIS Owns Memory Retrieval:** GENESIS determines memory relevance using its own retrieval algorithms, embeddings, and recency scoring.
- **Resource Budgets:** VAJRA applies caller-side resource budgets (e.g. max token limit, max items) to protect the reasoning context size. These are resource constraints, **not** memory architecture.
- **Provenance Preservation:** Every memory item incorporated into context carries `provenance: "genesis:memory:<id>"`.
- **Memory Integrity:** VAJRA never mutates GENESIS memory tables or overrides memory scoring.
- **Reflection Isolation:** GENESIS's episodic reasoning engine (`src/genesis/reasoning/`) continues to operate independently on memory reflections without interference from VAJRA.

---

## 18. Persistence Boundary

Phase 4 introduces **zero schema changes** and **zero new database tables**:
- Reasoning outputs requiring durability are persisted via the existing `IOperationalStateStore`:
  1. `appendAuditTrace(trace)`: commits the `DeliberationTrace` to `vajra_deliberation_traces`.
- **Belief Updates Are Proposals Only:** Phase 4 domain code **never** calls `IOperationalStateStore.saveBelief()`. Proposed updates are returned in `ReasoningResult.proposedBeliefUpdates` for review and approval by Phase 5 / State Authority.
- Ephemeral reasoning context, prompt tokens, and raw model payloads are **never persisted** to disk, preventing database bloat.

---

## 19. Concurrency, Consistency & Invalidation Lifecycle

Phase 4 strictly enforces the **Single-Turn Non-Autonomous Deliberation Lifecycle**:

```
      Reasoning Begins
             │
             ▼
      Capture contextVersion = N
             │
             ▼
      Reasoning Executes (Tier 1, 2, or 3)
             │
             ▼
      State Version Becomes N + 1 (Concurrent External Event)
             │
             ▼
      Reasoning Completes
             │
             ▼
      Version Mismatch Detected (N !== N + 1)
             │
             ▼
      Result Status = STALE_INVALIDATED
             │
             ▼
      Return Control to Caller (Executive Controller)
             │
             ▼
      NO Automatic Re-deliberation Loop
```

1. **Turn Serialization:** Reasoning turns are queued cooperatively via `CooperativeTurnScheduler` in the Executive Controller.
2. **Snapshot Versioning:** `ReasoningContext` captures the integer `version` from `vajra_operational_state`.
3. **Mid-Reasoning Mutation Detection:** When reasoning completes, the engine verifies whether `stateStore.loadOperationalContext().version === ctx.contextVersion`.
4. **Immediate Invalidation:** If a concurrent write incremented the version (e.g. human edited a task or an observation arrived), the result is marked `STALE_INVALIDATED`.
5. **No Autonomous Loops:** Phase 4 **NEVER** restarts itself or triggers a second reasoning turn. The caller (Executive Controller) decides whether another turn is warranted.

---

## 20. Security & Trust Model

LLM outputs are strictly classified as **Untrusted External Data**:
1. **Prompt Injection Defense:** Human prompts and external observation texts are passed as strongly typed JSON variables inside structured context payloads; they are never concatenated directly into system instructions.
2. **Schema Sanitization:** All model responses are validated through strict Zod schemas with `.strip()` or `.strict()`, eliminating injected or unauthorized properties.
3. **No Dynamic Execution:** Model responses cannot contain executable code, lambda functions, or direct shell instructions.
4. **Authority Boundary Enforcement:** A model response proposing a high-impact hypothesis cannot bypass the Policy Envelope or human confirmation gates.

---

## 21. Phase 5 Decision-Arbiter Handoff Contract

The boundary between Phase 4 (Reasoning) and Phase 5 (Decision) is absolute:

$$\underbrace{\text{Phase 4: "What is happening? What do we know? How certain are we?"}}_{\mathbf{ReasoningResult}} \quad \longrightarrow \quad \underbrace{\text{Phase 5: "What should VAJRA do?"}}_{\mathbf{ExecutiveAction}}$$

### 21.1 Clean Contract Separation
- **Phase 4 Hands Off:**
  ```typescript
  export interface ReasoningResult {
    readonly problemClass: ProblemClass;
    readonly status: ReasoningStatus;
    readonly hypotheses: readonly ReasoningHypothesis[];
    readonly proposedBeliefUpdates: readonly ProposedBeliefUpdate[];
    readonly contradictions: readonly ContradictionRecord[];
    readonly possibleConsequences: readonly string[];
    readonly uncertaintyLevel: UncertaintyLevel;
    readonly unresolvedQuestions: readonly string[];
    readonly verificationSuggestions: readonly string[];
    readonly deliberationTrace: DeliberationTrace;
  }
  ```
- **Phase 5 Consumes & Arbitrates:**
  The future Decision Arbiter (`IDecisionArbiter.arbitrate(reasoningResult, policyEnvelope, correlation)`) independently:
  1. Evaluates whether a decision is required or if the situation is inconclusive.
  2. Generates candidate decision options based on hypotheses and system capabilities.
  3. Evaluates decision options against the `PolicyEnvelope` (safety, spend, blast radius).
  4. Determines whether uncertainty or high risk mandates asking the human a clarifying question (K1 human confirmation).
  5. Approves epistemic belief transitions and issues the authoritative `ExecutiveAction`.

---

## 22. Exact File-Level Implementation Plan

When approved for implementation, Phase 4 will introduce or modify the following files:

| File Path | Type | Owner | Responsibility & Notes |
|---|---|---|---|
| `src/vajra/reasoning/types.ts` | Types & Schemas | VAJRA Reasoning | Defines `ProblemClass`, `StrategyCapabilityDeclaration`, `ReasoningContext`, `ReasoningResult`, `ReasoningStatus`, `ProposedBeliefUpdate`, `UncertaintyLevel`, and Zod schemas. |
| `src/vajra/reasoning/context-builder.ts` | Context Service | VAJRA Reasoning | Assembles filtered, resource-budgeted, deterministically ordered `ReasoningContext` snapshots via `IGenesisPort` and state store. |
| `src/vajra/reasoning/router.ts` | Strategy Router | VAJRA Reasoning | Evaluates problem classes and capability declarations; selects strategy tiers; executes capability-aware fallbacks. |
| `src/vajra/reasoning/strategies/deterministic-strategy.ts` | Strategy (Tier 1) | VAJRA Reasoning | Declares capabilities for `POLICY_CONFORMANCE`. Evaluates rules and health states with zero model calls ($< 1\text{ms}$). |
| `src/vajra/reasoning/strategies/evidence-contradiction-strategy.ts` | Strategy (Tier 2) | VAJRA Reasoning | Declares capabilities for `OBSERVATION_CONSISTENCY`. Identifies contradictions and audits premise consistency ($< 5\text{ms}$). |
| `src/vajra/reasoning/strategies/model-assisted-strategy.ts` | Strategy (Tier 3) | VAJRA Reasoning | Declares capabilities for `AMBIGUOUS_INTENT_INTERPRETATION` and `CAUSAL_HYPOTHESIS_GENERATION`. Invokes coprocessor with Zod validation. |
| `src/vajra/reasoning/engine.ts` | Core Engine | VAJRA Reasoning | Implements `IReasoningEngine`; manages single-turn execution, version checking, trace logging, and result production. Zero auto-loops. |
| `src/vajra/boundaries/model-coprocessor-port.ts` | Boundary Port | VAJRA Boundaries | Defines `IModelCoprocessorPort`, request/response envelopes, and Gemini/OpenRouter adapters. |
| `src/vajra/ports/reasoning.ts` | Port Contract | VAJRA Ports | **(Modified)** Updates `IReasoningEngine` to consume `ReasoningContext` and return `ReasoningResult`. |
| `src/vajra/reasoning/index.ts` | Barrel Export | VAJRA Reasoning | Clean public exports for the reasoning subsystem. |

---

## 23. Test Architecture & Verification Matrix

Phase 4 will be verified by a dedicated test suite in `tests/vajra/reasoning/`:

| Test File | Test Scenarios Covered |
|---|---|
| `context-builder.test.ts` | • Snapshot assembly from operational context, beliefs, and observations.<br>• Deterministic sorting by ID/timestamp.<br>• Token budget enforcement and pruning of low-relevance memories.<br>• GENESIS retrieval delegation via `IGenesisPort`. |
| `router.test.ts` | • Selects Tier 1 for `POLICY_CONFORMANCE`.<br>• Selects Tier 2 for `OBSERVATION_CONSISTENCY`.<br>• Selects Tier 3 for `AMBIGUOUS_INTENT_INTERPRETATION`.<br>• Capability-aware fallback: Tier 3 failure with Tier 2 capable $\longrightarrow$ Tier 2 used (`DEGRADED`).<br>• Capability-aware fallback: Tier 3 failure with Tier 2 incapable $\longrightarrow$ `INCONCLUSIVE` (no fake Tier 1 success).<br>• Tier 2 failure with Tier 1 incapable $\longrightarrow$ `INCONCLUSIVE`. |
| `deterministic-strategy.test.ts` | • Immediate rule resolution without model invocation ($< 1\text{ms}$).<br>• Declares explicit capability for `POLICY_CONFORMANCE` only.<br>• Rejects unhandled problem classes. |
| `evidence-contradiction-strategy.test.ts` | • Detects conflicting observations.<br>• Formulates `ContradictionRecord` and proposes belief demotion ($c \to 0.0$).<br>• Flags uncertainty as `CRITICAL`. Produces epistemic evidence, not operational decisions. |
| `model-coprocessor.test.ts` | • Dispatches structured JSON schema request.<br>• Validates model response via Zod.<br>• Rejects malformed JSON and triggers clean fallback.<br>• Respects timeout and aborts via `AbortSignal`.<br>• Proves coprocessor cannot select its own strategy tier. |
| `reasoning-engine.test.ts` | • End-to-end deliberation producing complete `ReasoningResult`.<br>• Result contains zero executable actions.<br>• Reasoning cannot call `saveBelief()` directly.<br>• Stale context detection: version change mid-turn $\longrightarrow$ `STALE_INVALIDATED`.<br>• Proves `STALE_INVALIDATED` triggers no automatic second reasoning turn.<br>• Fallback never increases confidence beyond what capability justifies. |
| `boundary-invariants.test.ts` | • AST validation: `src/vajra/reasoning/` contains zero imports of `better-sqlite3`, repositories, filesystem, or HANDS.<br>• Proves reasoning engine produces zero final decisions or mission execution calls. |

---

## 24. Verification Gates (Post-Implementation Requirements)

Prior to Phase 4 acceptance:
- [ ] `npm run type-check`: 0 errors.
- [ ] `npx vitest run tests/vajra`: 100% passing across all VAJRA test suites.
- [ ] `npx tsx scripts/validate-architecture.ts`: All 363+ assertions pass with 0 failures.
- [ ] `npx vitest run`: 100% passing across all 147+ repository test files (1,479+ tests).
- [ ] `npm run build`: Clean production build.
- [ ] `graphify update .`: AST extraction refreshed.

---

## 25. Authority Invariants

```
                                AUTHORITY BLAST DOORS
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. The Reasoning Engine CANNOT make operational decisions (Reserved for Phase 5).     │
│ 2. The Reasoning Engine CANNOT construct executable action proposals or plans.         │
│ 3. The Reasoning Engine CANNOT execute capabilities, spawn processes, or actuate HANDS.│
│ 4. The Reasoning Engine CANNOT directly connect to SQLite or run raw SQL.              │
│ 5. The Reasoning Engine CANNOT directly persist belief updates (Proposals only).       │
│ 6. The Reasoning Engine CANNOT autonomously re-deliberate on stale invalidation.       │
│ 7. Model coprocessor outputs are untrusted evidence, NEVER authoritative commands.     │
│ 8. All external model interaction is gated by strict Zod schema validation.            │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Explicit Phase 4 Cognitive Invariants:
- **K-P4-1:** A failed higher-capability strategy cannot be replaced by a weaker strategy unless the weaker strategy explicitly declares that it can validly handle the problem.
- **K-P4-2:** Phase 4 never autonomously re-deliberates.
- **K-P4-3:** Phase 4 cannot create authoritative executable actions.
- **K-P4-4:** Reasoning may propose belief updates but cannot persist them.
- **K-P4-5:** GENESIS owns memory retrieval; VAJRA owns operational reasoning.
- **K-P4-6:** The model coprocessor is never an authority source.
- **K-P4-7:** Every reasoning result has explicit provenance and correlation.
- **K-P4-8:** A stale reasoning result cannot be consumed as current reasoning.

---

## 26. Open Architectural Questions

1. **Question Q-P4-1: Default Model Tier for Local Desktop Operation**  
   *Context:* When offline or API keys are missing, should VAJRA attempt local Ollama classification or yield `INCONCLUSIVE`?  
   *Resolution / Recommendation:* If the user configures a local Ollama endpoint in settings, register it as a local Tier 3 coprocessor provider. If no model provider is available, check Tier 2/1 capabilities; if incapable, yield `INCONCLUSIVE` rather than faking resolution.
2. **Question Q-P4-2: Coprocessor Cost Tracking Ledger**  
   *Context:* Should token usage in model reasoning be aggregated in `vajra_operational_state` or tracked per deliberation trace?  
   *Resolution / Recommendation:* Track token usage and estimated cents directly inside `DeliberationTrace` metadata, and verify cumulative spend against `PolicyEnvelope.maxAutonomousCostCents`.
3. **Question Q-P4-3: Approval Authority for Proposed Belief Updates**  
   *Context:* Does the Phase 5 Decision Arbiter approve all proposed belief transitions, or should non-operational beliefs (purely factual observations) be auto-approved by the State Authority?  
   *Resolution / Recommendation:* The Phase 5 Decision Arbiter owns arbitration of operational beliefs. Pure factual verifications confirmed by deterministic test results (e.g. Node version check) can be approved directly by the Executive Controller upon deterministic verification completion.

---

## 27. Final Recommendation

Proceed with Phase 4 implementation following the exact file-level plan, capability contracts, and test architecture upon explicit human review and approval.

---

### Revision 1 Approval Status

Status:  
DESIGN REVISED — AWAITING HUMAN APPROVAL FOR IMPLEMENTATION.

DESIGN ONLY — NO CODE IMPLEMENTED.  
AWAITING EXPLICIT HUMAN APPROVAL.
