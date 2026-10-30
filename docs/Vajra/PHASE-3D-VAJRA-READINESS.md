# Phase 3D — VAJRA Readiness & Orchestration Boundary Analysis

**Status:** PROPOSED (Analysis / Architecture Slice Definition)  
**Author:** Antigravity  
**Date:** October 3, 2026  
**Target Document:** `docs/architecture/PHASE-3D-VAJRA-READINESS.md`  

---

## 1. Executive Summary

Phase 3A (Query capability foundation), Phase 3B (Tier-2 activation & search capability), and Phase 3C (Command capabilities `task.create`/`task.update`, Contract K3 Domain Events, Contract K19 correlation/causation metadata, and Rule N1 / Decision D4 enforcement) are complete, fully integrated, and verified green.

This document conducts a rigorous readiness assessment to determine whether AKIRA's current implementation has the minimum architectural primitives required to begin implementing **VAJRA** (the authoritative mission coordinator), and identifies the exact smallest missing prerequisite slice.

> [!IMPORTANT]
> **Key Finding:** VAJRA implementation must **NOT** begin immediately in Phase 3D. While Query capabilities (K2), Command capabilities (K1), Domain Events (K3), Execution Results (K5), and Correlation Metadata (K19) are proven, **Contract K4 (Observation)** and **Contract K6 (Mission Verification Evidence & Result)** do not yet exist in contract space. Attempting to build VAJRA before establishing Contract K4 and K6 would force VAJRA to invent non-standard evidence formats, collapsing Observation into Event/Result and violating Decision D7 and Rule N3.
> 
> Therefore, the recommended Phase 3D implementation slice is strictly limited to establishing the **Contract K4 (Observation)** and **Contract K6 (Verification Evidence & Mission Result)** contract primitives in `src/contracts/events/` and `src/contracts/capabilities/`.

---

## 2. Current → Target Mapping

| Architectural Plane | Current State (Post-Phase 3C) | Target State (Frozen Architecture) | Status / Seam |
| :--- | :--- | :--- | :--- |
| **Communication Primitives** | Contracts K1 (Command), K2 (Query), K3 (Domain Event), K5 (Execution Result), K19 (Correlation) implemented | Five communication primitives: Command (K1), Query (K2), Event (K3), Observation (K4), Result (K5/K6) | **GAP:** Contract K4 (Observation) and Contract K6 (Mission Result) are missing from `src/contracts/`. |
| **Capability Foundation** | `CapabilityRegistry` with Tier 0/1/2 selective activation (D2), descriptors (K7), ownership boundaries (K8) | Operational Capability Registry with VAJRA selection & routing policy (D6) | **READY (Foundation):** Registry exists; selection policy layer needed. |
| **Command Execution** | Bounded internal direct Commands (`task.create`, `task.update`) enforcing Rule N1 & Decision D4 | Cross-system Commands issued by VAJRA or bounded N1 callers | **READY:** Direct Command execution and event emission validated. |
| **Event Emission** | `eventBus.publish` emitting Contract K3 `DomainEvent` with `causationId === correlation.invocationId` | Producers emit Domain Events (K3); cognitive interpretation emits Observations (K4) | **PARTIAL:** K3 Domain Events implemented; K4 Observation emission not contract-defined. |
| **Mission Authority (VAJRA)** | Zero mission state, zero orchestration loop, zero mission entities | Authoritative mission coordinator owning Goal/Mission lifecycle, routing, verification, escalation | **UNBUILT:** Must not be built until K4/K6 contract foundation exists. |

---

## 3. VAJRA Responsibility Matrix

The frozen architecture (`AKIRA-TARGET-ARCHITECTURE.md` §5–§6, `AKIRA-FOUNDATION-CONTRACTS.md` K10) assigns 11 core responsibilities to VAJRA. Each is evaluated below:

| # | VAJRA Responsibility | Classification | Justification & Architectural Seam |
| :-: | :--- | :--- | :--- |
| **1** | **Goal Ownership** | `ARCHITECTURE DECISION REQUIRED` | Open Decision **O3** (Goal schema, states, and relation to Project/Task) is unresolved. TA §6 explicitly specifies that a Goal is optional for Missions. Must remain deferred. |
| **2** | **Mission Ownership** | `ARCHITECTURE DECISION REQUIRED` | Open Decision **§20.3** (Mission schema and state enum) is open. Requires Contract K6 Mission Result and Mission state envelope. |
| **3** | **Mission Lifecycle** | `FOUNDATION MISSING` | State transition concepts exist conceptually (Created -> Active -> Verifying -> Completed/Failed), but contract primitives for Mission state tracking do not exist. |
| **4** | **Capability Selection / Routing** | `READY` | Existing `CapabilityRegistry` (Phase 3A–3C) provides descriptor metadata (K7), activation tiers (K9), and ownership boundaries (K8). VAJRA selection policy can build directly on this. |
| **5** | **Planning** | `NOT YET REQUIRED` | Deconstructing intent into execution steps is VAJRA's PLAN step. Legacy `genesis/planning/*` is explicitly NOT revived (TA §4, §19). Deep planning should remain deferred. |
| **6** | **Coordination** | `READY` | Contract K1 (Command), Contract K2 (Query), Contract K5 (Execution Result), and K19 (Correlation) are fully implemented and verified. |
| **7** | **Constraints** | `NOT YET REQUIRED` | Input contract validation exists via Zod schemas in K7 descriptors. Complex mission-level constraint checking is deferred. |
| **8** | **Completion Criteria** | `FOUNDATION MISSING` | Execution ≠ Completion (D7). Completion criteria evaluation requires a formal contract representation of criteria and verification evidence. |
| **9** | **Observation Handling** | `FOUNDATION MISSING` | Observation (Contract K4) carries evidence, state, confidence, and provenance. Currently, no `Observation<TPayload>` interface exists in `src/contracts/`. |
| **10** | **Verification** | `FOUNDATION MISSING` | Verification belongs strictly to VAJRA (TA §5.5). Requires Contract K4 (Observation) and Contract K6 (Verification Record / Mission Result) before verification logic can be written. |
| **11** | **Escalation** | `NOT YET REQUIRED` | Escalation requires an active Mission loop and human-in-the-loop interaction channels. Must remain deferred. |

---

## 4. Legacy Code Audit & Prohibition Matrix

Several legacy modules in the codebase resemble orchestration, planning, or mission management. In accordance with TA §4, §7.3, §19, and Engineering Discipline, these **must NOT be revived, moved, or grown into VAJRA**:

| Legacy Module / Code Artifact | Current Location | Superficially Resembles | Explicit Architectural Disposition & Rule |
| :--- | :--- | :--- | :--- |
| `PlanningService`, `GoalDecompositionService`, `PlanRepository`, `TaskRepository` | `src/genesis/planning/*` | Mission Planning & Goal Decomposition | **DO NOT REVIVE / DO NOT MOVE.** TA §4 & §19 explicitly state these dormant in-memory planning singletons inside GENESIS are not moved or revived; they are subject to later redesign under VAJRA. |
| `initiativeService` | `src/genesis/context/initiative/*` | Proactive Initiative & Decision | **DO NOT REVIVE.** TA §3.2 & TA §5.2 dictate that Initiative is owned by VAJRA, and the inert `initiativeService` in GENESIS is NOT moved; it will be redesigned under VAJRA. |
| `CapabilityRegistry` (Legacy) | `src/runtime/registry/CapabilityRegistry.ts` | Capability Provider Selection | **DO NOT REVIVE.** TA §7.3 specifies P0 #45 is LATER and NOT revived. The Phase 3A `src/contracts/capabilities/registry.ts` is the sole authoritative registry. |
| `MissionFormDialog()`, `/daily-mission` | `src/routes/tasks.tsx` | Mission UI & Task Creation | **DO NOT MERGE.** TA §6 clarifies: "Workspace tasks are not mission steps. A Task is a user-managed item owned by AKIRA OS. A mission step is VAJRA's operational unit." |
| `MISSION_COMPLETED` Event Trigger | `src/persistence/akira-store.ts:534` | Mission Completion Event | **DO NOT TREAT AS VAJRA MISSION COMPLETION.** Fires when all workspace tasks hit `done = true`. TA §6 & O3 note this legacy trigger will be renamed/replaced when real Missions exist. |

---

## 5. Defensive Guardrails: Preventing VAJRA Anti-Patterns

To ensure VAJRA does not violate frozen boundaries during future development, the following 6 hard defenses are established:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            VAJRA HARD DEFENSES                              │
├──────────────────┬──────────────────────────────────────────────────────────┤
│ Anti-Pattern     │ Enforced Architectural Boundary                          │
├──────────────────┼──────────────────────────────────────────────────────────┤
│ 1. Not GENESIS #2│ NO user models, prompt generation, memory, or cognitive │
│                  │ identity inside VAJRA. Queries GENESIS for context.     │
├──────────────────┼──────────────────────────────────────────────────────────┤
│ 2. Not OS #2     │ NO database management, SQLite tables, UI routing, or    │
│                  │ capability registration/activation authority.            │
├──────────────────┼──────────────────────────────────────────────────────────┤
│ 3. Not Exec Layer│ NO domain logic or tool execution inside VAJRA. Routes   │
│                  │ Commands to capability owners.                           │
├──────────────────┼──────────────────────────────────────────────────────────┤
│ 4. Not Persistence│ NO direct database calls (`better-sqlite3`). Persists   │
│                  │ state exclusively via OS platform capabilities.          │
├──────────────────┼──────────────────────────────────────────────────────────┤
│ 5. Not Provider  │ NO LLM provider management, API key handling, or network │
│                  │ transport. Model transport is a platform service (O9).   │
├──────────────────┼──────────────────────────────────────────────────────────┤
│ 6. Not HANDS     │ NO direct shell execution, browser automation, or tool   │
│                  │ actions. Issues authorized Commands to HANDS capabilities│
└──────────────────┴──────────────────────────────────────────────────────────┘
```

---

## 6. Recommended Smallest Implementation Slice (Phase 3D)

### **Objective**
Implement the **Contract K4 (Observation)** and **Contract K6 (Mission Verification Evidence & Result)** contract primitives in contract space (`src/contracts/`), completing all 5 communication primitives defined in Contract K1–K6.

### **Architectural Reason**
In the frozen architecture (TA §5.5, K4, K6, K10), VAJRA's control loop (`UNDERSTAND -> PLAN -> SELECT -> COORDINATE -> VERIFY`) relies on receiving Observations (evidence with `confidence` and `provenance`) and executing Verification (judging Execution Results + Observations against completion criteria). Currently:
- Contract K1 (Command), K2 (Query), K3 (Domain Event), K5 (Execution Result), K19 (Correlation) exist in `src/contracts/`.
- **Contract K4 (Observation) and Contract K6 (Verification Evidence & Mission Result) DO NOT EXIST.**

Implementing K4 and K6 contract definitions without any VAJRA runtime orchestration provides the exact missing prerequisite required before VAJRA can be designed.

### **Contracts Exercised**
- **Contract K4 (Observation):** `Observation<TPayload>` interface with `observationId`, `producer`, `subject`, `observationTime`, `correlation`, `payload`, `confidence`, `provenance`.
- **Contract K6 (Verification Evidence):** `VerificationRecord` interface and `MissionResult<TPayload>` envelope carrying evidence lists (Execution Results + Observations) and verification outcome.
- **Contract K19 (Correlation & Traceability):** Ensuring Observations and Verification Records propagate `correlationId` and `causationId`.

### **Proposed Code Artifacts**
1. `src/contracts/events/observation.ts`:
   - `Observation<TPayload>` interface definition conforming to K4.
   - `createObservation()` helper factory.
2. `src/contracts/capabilities/verification.ts`:
   - `VerificationRecord` interface definition conforming to K6 & TA §5.5.
   - `MissionResult<TPayload>` envelope definition.

### **Ownership & Activation Tier**
- **Ownership:** `contracts/` (neutral contract repository, TA §22.4).
- **Activation Tier:** Tier 0 (Contract definitions available system-wide at boot).

---

## 7. Expected File Changes & Protected Components

### Expected Files to Create / Modify
- `src/contracts/events/observation.ts` *(NEW)*
- `src/contracts/capabilities/verification.ts` *(NEW)*
- `tests/contracts/observation-verification-contracts.test.ts` *(NEW)*

### Protected Files (MUST NOT BE MODIFIED)
- `src/persistence/akira-store.ts`
- `src/persistence/db/`
- `src/genesis/` (all cognitive engines & legacy planning)
- `docs/architecture/AKIRA-TARGET-ARCHITECTURE.md` (frozen)
- `docs/architecture/AKIRA-FOUNDATION-CONTRACTS.md` (frozen)

---

## 8. Required Tests & Acceptance Criteria

### Required Tests
1. **Observation Contract Validation Test:** Verify `createObservation()` generates valid Contract K4 observations with immutable fields, timestamp, `confidence`, `provenance`, and K19 correlation metadata.
2. **Verification Record Contract Test:** Verify `VerificationRecord` correctly references `ExecutionResult` (K5) and `Observation` (K4) IDs as evidence without auto-completing missions.
3. **Architecture Boundary Verification:** `npm run validate:architecture` must pass 100%.
4. **Full Regression Suite:** `npx vitest run tests/capabilities/` and `npx vitest run tests/production-journey.test.ts` must remain 100% green.

### Acceptance Criteria
- All 5 communication primitives (K1 Command, K2 Query, K3 Event, K4 Observation, K5/K6 Result) exist as formal TypeScript contracts in `src/contracts/`.
- Zero source changes outside `src/contracts/`.
- Zero modifications to protected files.
- `npx tsc --noEmit` reports 0 errors.

---

## 9. Unresolved Architectural Decisions (O1–O12 Dependencies)

The following open decisions remain unresolved and explicitly block subsequent steps:
- **O3 (Goal schema & relation to Project/Task):** Prevents implementing Goal entities or Goal ownership.
- **O7 (Conversation turn owner):** Prevents turn orchestration from being assigned to VAJRA or GENESIS.
- **O9 (Model transport placement):** Prevents model provider routing from being attached to VAJRA.
- **§20.3 (Mission schema and state enum):** Prevents implementing concrete Mission persistence schemas.

---

## 10. Explicit Recommendation: Should VAJRA Implementation Begin After Phase 3D?

> [!CAUTION]
> **NO. VAJRA implementation should NOT begin immediately after Phase 3D.**
> 
> Completing Phase 3D establishes the **Contract K4 (Observation)** and **Contract K6 (Verification Evidence)** primitives. However, before a VAJRA runtime orchestration loop is instantiated, **Phase 3E** must first establish the **Mission Contract & Lifecycle Primitive (K6/K10)** to define the Mission state envelope and transition boundaries.
> 
> Only after both the observation/verification primitives (Phase 3D) and the mission lifecycle primitives (Phase 3E) are in place can VAJRA be introduced safely without risking premature, unvalidated orchestration.
