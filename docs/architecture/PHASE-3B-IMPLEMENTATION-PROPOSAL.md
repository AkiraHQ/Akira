# Phase 3B Implementation Proposal: Capability Foundation Expansion & Tier 2 Activation

**Document Status:** Approved Architecture Proposal  
**Phase:** Phase 3B — Capability Foundation Expansion & Tier 2 Activation Slice  
**Baseline Commit:** Phase 3A Verified Baseline @ `genesis/foundation-stabilization`  
**Governing Documents:**
- [AKIRA-TARGET-ARCHITECTURE.md](AKIRA-TARGET-ARCHITECTURE.md) (Frozen Target Architecture)
- [AKIRA-FOUNDATION-CONTRACTS.md](AKIRA-FOUNDATION-CONTRACTS.md) (Frozen Foundation Contracts)
- [AKIRA-N1-DECISION.md](AKIRA-N1-DECISION.md) (Rule N1: Bounded direct internal Commands)
- [AKIRA-N2-DECISION.md](AKIRA-N2-DECISION.md) (Rule N2: Non-VAJRA Tier-2 On-Demand Activation)
- [AKIRA-N3-DECISION.md](AKIRA-N3-DECISION.md) (Rule N3: GENESIS Command-Freedom)
- [AKIRA-TIER2-ACTIVATION-CLARIFICATION.md](AKIRA-TIER2-ACTIVATION-CLARIFICATION.md) (Tier-2 Activation Clarification)
- [PHASE-3A-IMPLEMENTATION-PROPOSAL.md](PHASE-3A-IMPLEMENTATION-PROPOSAL.md) (Phase 3A Approved Proposal)

---

## 1. Objective

Phase 3A successfully established the foundational capability primitives (`CapabilityDescriptor`, `CapabilityRegistry` host, and `Result<T, E>` envelope) and implemented the first Tier 1 vertical slice (`project.read` and `project.list`).

The objective of Phase 3B is to extend this foundation into the next smallest, valid implementation slice by fulfilling two essential architectural goals without altering frozen contracts, introducing new authorities, or modifying existing persistence layers:

1. **Tier 1 Capability Surface Expansion:** Register Tier 1 workspace read capabilities (`task.read` and `task.list`) owned by `AKIRA OS · workspace`, adapting the existing server-isolated `SqliteTaskRepository`.
2. **Tier 2 Capability & Rule N2 Activation Exercise:** Register AKIRA's first Tier 2 capability (`recall.search`) owned by `AKIRA OS · search`, enhancing the `CapabilityRegistry` host to natively track fine-grained **Capability Lifecycle** states (`Defined` → `Registered` → `Available` → `Activated` → `Deactivated` per Contract K9 / K22) and proving **Rule N2 on-demand activation** for non-VAJRA callers.

---

## 2. Architectural Analysis & Core Findings

### 2.1 Registry Sufficiency vs. Separate Lifecycle Mechanism (Inspection Point 6)
- **Current Registry Behavior (Phase 3A):** The Phase 3A `CapabilityRegistry` host (`src/contracts/capabilities/registry.ts`) serves as a static registry map storing descriptors and execution handlers. It determines availability via a static `descriptor.isAvailable` boolean and does not maintain dynamic lifecycle state transitions.
- **Contract Requirement (Contract K8, K9, K14, K22):** Contract K8 designates AKIRA OS as the sole authority for capability registration and activation. Contract K9 defines the explicit state machine (`Defined` → `Registered` → `Available` → `Activated` → `Invoked` → `Deactivated`). Contract K14 mandates that capability activation decisions are resource/lifecycle operations, not mission decisions.
- **Finding & Decision:** Introducing a separate, external capability lifecycle manager would violate **Engineering Invariant 2.4 (Single Authority of Truth)** and introduce split-brain capability state. The `CapabilityRegistry` host itself is the authoritative AKIRA OS platform plane host and must be enhanced to manage capability lifecycle state transitions and execute Rule N2 on-demand activation hooks internally.

### 2.2 Rule N2 Execution Mechanics (Inspection Point 7)
- **Contract Rule:** Per `AKIRA-N2-DECISION.md` (Rule N2), when an authorized non-VAJRA caller invokes a registered Tier 2 capability (`recall.search`) that is currently inactive (`activationState: "available"`):
  1. The invocation acts as a valid requirement under TA §8.
  2. The `CapabilityRegistry` host triggers the capability's on-demand activation routine, transitioning its state from `Available` to `Activated`.
  3. The capability handler is executed, returning a uniform `Result<T, E>` envelope.
  4. If activation fails or AKIRA OS declines due to resource constraints, `Result.failure({ category: "capability_unavailable", ... })` is returned.
  5. AKIRA OS retains the authority to deactivate the capability back to `Available` after execution.

### 2.3 Necessity of VAJRA (Inspection Point 8)
- **Finding:** Implementing VAJRA is **NOT** required for Phase 3B.
- **Architectural Proof:**
  - **Decision D5:** Explicitly establishes that read Queries reach owning capabilities directly without VAJRA mediation.
  - **Rule N2:** Explicitly permits non-VAJRA callers to invoke read queries on Tier 2 capabilities and trigger AKIRA OS on-demand activation.
  - **Contract K10:** Explicitly states: *"A request that does not become a Mission is not routed by this flow."*
  - Therefore, introducing VAJRA for Phase 3B would violate the minimal-diff engineering principle and add unnecessary complexity without contractual basis.

---

## 3. Target Contract Mapping

| Frozen Contract | Conceptual Specification | Phase 3B TypeScript Implementation Mapping |
| :--- | :--- | :--- |
| **K7 (Descriptor)** | Complete metadata: Name, Version, Owner, Kind, Schemas, Permissions, Tier, Availability, Cost, Characteristics, Observability, Failure Semantics. | `src/contracts/capabilities/descriptor.ts`<br>`interface CapabilityDescriptor<TInput, TOutput>` |
| **K8 (Ownership)** | Subsystem owns semantics/execution; AKIRA OS owns registration & activation (D2); VAJRA owns selection & routing (D6). | Registration host: `src/contracts/capabilities/registry.ts`<br>Owners: `AKIRA OS · workspace`, `AKIRA OS · search` |
| **K9 / K22 (Lifecycle & Selective Activation)** | Explicit state machine: `Defined` → `Registered` → `Available` → `Activated` → `Invoked` → `Deactivated`. | `CapabilityLifecycleState = "registered" \| "available" \| "activated" \| "deactivated"` managed inside `CapabilityRegistry`. |
| **K14 (AKIRA OS Contract)** | AKIRA OS performs activation/deactivation. Activation is a resource/lifecycle decision. | `registry.activate(name)` & `registry.deactivate(name)` within `CapabilityRegistry`. |
| **K17 / Rule N2** | Non-VAJRA invocation of inactive Tier 2 capability triggers AKIRA OS on-demand activation. | Auto-activation check inside `registry.invoke()` for Tier 2 capabilities. |
| **K19 (Correlation)** | Identifiers: `requestId`, `correlationId`, `invocationId`, `causationId`. | Carried in `Result` envelope metadata. |

---

## 4. Current Implementation Seam

Phase 3B adapts existing server-isolated persistence repositories without modifying backend database schemas, SQL statements, or service contracts:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 3B TARGET SEAM: Tier 1 & Tier 2 Capability Invocation Paths                       │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ Authorized Non-VAJRA Caller (Internal Service, Test Harness, or MCP Read Query)         │
│   │                                                                                     │
│   ▼                                                                                     │
│ Capability Registry Host (AKIRA OS Platform Plane)                                      │
│   ├── Tier 1 Invocations: task.read / task.list                                         │
│   │     └─► Executes immediately (Warm at boot) ─► SqliteTaskRepository                 │
│   │                                                                                     │
│   └── Tier 2 Invocations: recall.search                                                 │
│         ├─► Checks state: if "available" (inactive), executes Rule N2 On-Demand Activation │
│         ├─► Transitions state: "available" ──► "activated"                             │
│         └─► Delegates to SqliteConversationRepository.search() / HistoricalRecall     │
│                                                                                         │
│   ▼                                                                                     │
│ Uniform Result<T, E> Envelope (Success / Capability Failure)                            │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Proposed Capabilities (Vertical Slice)

Phase 3B introduces three capabilities across two subsystems:

### 5.1 `task.read`
- **Identifier:** `task.read`
- **Version:** `1.0.0`
- **Kind:** `Query` (Contract K2)
- **Owner:** `AKIRA OS · workspace` (Contract K8)
- **Input Schema:** Zod Schema `{ id: z.string().min(1) }`
- **Output Payload:** `Task | null`
- **Activation Tier:** Tier 1 (Warm at boot)
- **Permissions:** `{ allowInternal: true, allowVajra: true, allowExternalMcp: true }`
- **Cost Class:** `local_cheap`
- **Execution Characteristics:** Synchronous, Idempotent, Read-only.

### 5.2 `task.list`
- **Identifier:** `task.list`
- **Version:** `1.0.0`
- **Kind:** `Query` (Contract K2)
- **Owner:** `AKIRA OS · workspace` (Contract K8)
- **Input Schema:** Zod Schema `{}` (empty object)
- **Output Payload:** `Task[]`
- **Activation Tier:** Tier 1 (Warm at boot)
- **Permissions:** `{ allowInternal: true, allowVajra: true, allowExternalMcp: true }`
- **Cost Class:** `local_cheap`
- **Execution Characteristics:** Synchronous, Idempotent, Read-only.

### 5.3 `recall.search`
- **Identifier:** `recall.search`
- **Version:** `1.0.0`
- **Kind:** `Query` (Contract K2)
- **Owner:** `AKIRA OS · search` (Contract K8)
- **Input Schema:** Zod Schema `{ terms: z.array(z.string().min(1)).min(1), limit: z.number().int().positive().default(10), excludeConversationId: z.string().optional() }`
- **Output Payload:** `HistoricalEvidence[]`
- **Activation Tier:** Tier 2 (On-demand activation per Contract K22 / Rule N2)
- **Permissions:** `{ allowInternal: true, allowVajra: true, allowExternalMcp: true }`
- **Cost Class:** `local_cheap`
- **Execution Characteristics:** Synchronous, Idempotent, Read-only.

---

## 6. Ownership & Subsystem Allocation

Per **Contract K8**:
- **`task.read` & `task.list`:** Owned semantically and operationally by `AKIRA OS · workspace`.
- **`recall.search`:** Owned semantically and operationally by `AKIRA OS · search`.
- **Registry & Activation Host:** Owned by `AKIRA OS` Platform Plane (`src/contracts/capabilities/registry.ts`).

---

## 7. Activation Tiers & Lifecycle Behavior

Per **Contract K9** and **Contract K22**:
- **Tier 1 Capabilities (`task.read`, `task.list`):** Registered during AKIRA OS runtime boot, initialized in `Activated` state (`activationState: "activated"`), and remaining warm throughout process lifetime.
- **Tier 2 Capability (`recall.search`):** Registered during runtime initialization in `Available` state (`activationState: "available"`). Upon invocation:
  1. `CapabilityRegistry` checks if state is `Available`.
  2. Executes activation handler (initializing search provider reference / index handle).
  3. Transitions state to `Activated`.
  4. Invokes execution handler and returns Result envelope.
  5. Exposes `deactivate("recall.search")` to transition state back to `Available`.

---

## 8. Exact Files Expected to Change

When Phase 3B implementation proceeds, edits will be strictly limited to the following additive files:

### Existing Files Modified:
1. `src/contracts/capabilities/registry.ts` — Enhanced with Contract K9 lifecycle state tracking (`activationState`), explicit `activate()` / `deactivate()` methods, and Rule N2 Tier 2 auto-activation during invocation.

### New Files Created:
1. `src/akira-os/tasks/capabilities/task-read.ts` — Descriptors and execution handlers for `task.read` and `task.list`.
2. `src/akira-os/search/capabilities/recall-search.ts` — Descriptor, activation hook, and execution handler for Tier 2 `recall.search`.
3. `tests/capabilities/task-read-capability.test.ts` — Unit & integration tests for task read capabilities.
4. `tests/capabilities/tier2-activation-capability.test.ts` — Unit & integration tests for Tier 2 lifecycle transitions and Rule N2 on-demand activation.

Zero existing persistence files, UI components, or GENESIS cognitive modules will be deleted or modified.

---

## 9. Protected Files & Subsystems

Per **Engineering Handoff §12**, the following components are strictly protected and must NOT be modified:

1. `src/persistence/repositories/SqliteTaskRepository.ts` & `SqliteConversationRepository.ts`
2. `src/persistence/akira-store.ts` (`reorderTasks`)
3. `src/genesis/events/reality-adapter.ts`
4. `src/genesis/context/habits/service.ts`
5. `tests/production-journey.test.ts`
6. `docs/architecture/AKIRA-TARGET-ARCHITECTURE.md`
7. `docs/architecture/AKIRA-FOUNDATION-CONTRACTS.md`
8. `docs/architecture/AKIRA-N1-DECISION.md`
9. `docs/architecture/AKIRA-N2-DECISION.md`
10. `docs/architecture/AKIRA-N3-DECISION.md`

---

## 10. Test Plan

Phase 3B will require 100% pass rate across two new test suites and existing system verification:

1. **`tests/capabilities/task-read-capability.test.ts`**:
   - `task.read`: Returns `Result.success(Task)` for valid ID.
   - `task.read`: Returns `Result.success(null)` for non-existent ID.
   - `task.read`: Returns `Result.failure('invalid_request')` for malformed input.
   - `task.list`: Returns `Result.success(Task[])` containing all workspace tasks.
2. **`tests/capabilities/tier2-activation-capability.test.ts`**:
   - Registers Tier 2 `recall.search` in `Available` (inactive) state.
   - Invokes `recall.search` via a non-VAJRA caller: verifies state transitions from `Available` → `Activated` (Rule N2).
   - Verifies search results returned in uniform `Result.success(HistoricalEvidence[])`.
   - Deactivates `recall.search`: verifies state transitions back to `Available`.
   - Simulates activation failure: verifies `Result.failure({ category: 'capability_unavailable', ... })`.
3. **Full System Regression Suite**:
   - `npm run test:run` (All vitest unit tests passing).
   - `npm run validate:architecture` (All architectural assertions passing).
   - `npx vitest run tests/production-journey.test.ts` (Canary journey passing).

---

## 11. Acceptance Criteria

Implementation of Phase 3B will be complete when:

1. `src/contracts/capabilities/registry.ts` supports Contract K9 lifecycle states (`activationState`) and Rule N2 on-demand activation.
2. `task.read` and `task.list` are registered under `AKIRA OS · workspace` and execute against `SqliteTaskRepository`.
3. `recall.search` is registered under `AKIRA OS · search` as a Tier 2 capability and successfully executes Rule N2 on-demand activation.
4. 100% pass rate on `tests/capabilities/task-read-capability.test.ts` and `tests/capabilities/tier2-activation-capability.test.ts`.
5. Zero regressions across `npm run test:run` and `tests/production-journey.test.ts`.
6. Zero modifications to protected infrastructure files.

---

## 12. Rollback Strategy

Because Phase 3B is strictly additive:
1. Reverting the additions to `src/contracts/capabilities/registry.ts` and deleting the new files under `src/akira-os/tasks/capabilities/` and `src/akira-os/search/capabilities/` restores the system to the exact Phase 3A verified baseline.
2. No database migrations, persistence schema changes, or UI state changes are performed.

---

## 13. Unresolved Architectural Decisions (O-Questions Checklist)

| Open Question | Status | Impact on Phase 3B Proposal |
| :--- | :--- | :--- |
| **O1: Authoritative Runtime Placement** | UNRESOLVED | **Non-blocking.** Local server execution operates cleanly. |
| **O2: Workspace Write Authority** | UNRESOLVED | **Non-blocking.** Phase 3B introduces read Query capabilities (`task.read`, `task.list`, `recall.search`). |
| **O3: Goal & Mission Schema** | UNRESOLVED | **Non-blocking.** Task and historical recall reads do not touch Goal or Mission entities. |
| **O4: Identity Consolidation** | UNRESOLVED | **Non-blocking.** Does not touch GENESIS identity stores. |
| **O6: Reset Semantics** | UNRESOLVED | **Non-blocking.** Does not alter capability lifecycle contracts. |
| **O10: Registry Physical Location** | UNRESOLVED | **Non-blocking.** Physical placement in `src/contracts/capabilities/` complies with FC §4 (K8). |

**Verdict:** Zero unresolved architectural decisions block the Phase 3B implementation proposal.
