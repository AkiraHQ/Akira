# Phase 3C Implementation Proposal: First Command Capability & Rule N1 Vertical Slice

**Document Status:** Approved Architecture Proposal  
**Phase:** Phase 3C — Command Capabilities & Rule N1 Direct Execution Slice  
**Baseline Commit:** Phase 3B Verified Baseline @ `genesis/foundation-stabilization`  
**Governing Documents:**
- [AKIRA-TARGET-ARCHITECTURE.md](AKIRA-TARGET-ARCHITECTURE.md) (Frozen Target Architecture)
- [AKIRA-FOUNDATION-CONTRACTS.md](AKIRA-FOUNDATION-CONTRACTS.md) (Frozen Foundation Contracts)
- [AKIRA-N1-DECISION.md](AKIRA-N1-DECISION.md) (Rule N1: Bounded direct internal Commands)
- [AKIRA-N2-DECISION.md](AKIRA-N2-DECISION.md) (Rule N2: Non-VAJRA Tier-2 On-Demand Activation)
- [AKIRA-N3-DECISION.md](AKIRA-N3-DECISION.md) (Rule N3: GENESIS Command-Freedom)
- [PHASE-3A-IMPLEMENTATION-PROPOSAL.md](PHASE-3A-IMPLEMENTATION-PROPOSAL.md) (Phase 3A Approved Proposal)
- [PHASE-3B-IMPLEMENTATION-PROPOSAL.md](PHASE-3B-IMPLEMENTATION-PROPOSAL.md) (Phase 3B Approved Proposal)

---

## 1. Objective

Phase 3A established the foundational capability primitives (`CapabilityDescriptor`, `CapabilityRegistry` host, `Result<T, E>`) and Tier 1 Query capabilities (`project.read`, `project.list`). Phase 3B expanded Tier 1 Queries (`task.read`, `task.list`) and established Tier 2 capability lifecycle and Rule N2 on-demand activation (`recall.search`).

The objective of Phase 3C is to advance AKIRA from a read-only Query system to a **state-modifying Command system** by introducing the system's first **Command Capabilities** (`task.create` and `task.update`) governed strictly by **Contract K1** and **Accepted Rule N1**.

Specifically, Phase 3C will:
1. Define the formal TypeScript contracts for Command descriptors and execution semantics under Contract K1.
2. Establish the first production-grade **Command capabilities** (`task.create` and `task.update`) owned by `AKIRA OS · workspace`.
3. Prove **Rule N1 (Bounded Direct Internal Commands)** for single-owner workspace mutations without VAJRA mediation.
4. Adapt the existing, server-isolated `SqliteTaskRepository` to handle Command execution and emit formal **Contract K3 Events** (`task.created`, `task.updated`) carrying correlation and causation metadata (K19).
5. Prove input schema validation, single-owner state mutation, Rule N1 boundary enforcement, event emission, and uniform Result wrapping through automated unit and integration tests.

---

## 2. Evaluation of Candidate Architectural Directions

To select the optimal next slice, five candidate architectural directions were evaluated against the frozen Target Architecture and current repository state:

| Candidate Direction | Evaluation & Architectural Impact | Recommendation Status |
| :--- | :--- | :--- |
| **1. Further Query Capability Expansion** (`note.read`, `session.read`) | **Low Architectural Progress.** Phase 3A and Phase 3B already established and verified Query capability contracts across Tier 1 and Tier 2. Adding more Queries adds coverage but tests zero new architectural primitives. | **DEFERRED** (Sufficient Query foundation exists) |
| **2. First Command Capability & Rule N1 Slice** (`task.create`, `task.update`) | **HIGH ARCHITECTURAL PROGRESS.** Advances AKIRA from read-only Queries to state-modifying Commands (K1). Exercises Rule N1 (bounded direct Commands), single-owner mutation isolation, and connects Command execution to Contract K3 Event emission. | **RECOMMENDED FOR PHASE 3C** |
| **3. Event / Observation Contract Foundation** | **Premature as Standalone Slice.** Contracts K3 (Event) and K4 (Observation) define notification and evidence primitives. However, introducing Event foundation standalone without formal Command capabilities leaves events unanchored to capability invocation. Phase 3C naturally anchors Event emission to Command execution. | **INTEGRATED INTO PHASE 3C** (Emits K3 Events on Command execution) |
| **4. Runtime / Lifecycle Boundary Expansion** | **Redundant.** Phase 3B already integrated fine-grained Capability Lifecycle management (Contract K9/K22) directly into the `CapabilityRegistry` host. | **DEFERRED** (Phase 3B lifecycle host is sufficient) |
| **5. VAJRA Contract Surface** | **Premature.** VAJRA orchestration requires Goal/Mission schemas (O3), mission state persistence, and multi-owner planning. Implementing VAJRA now would violate the minimal-slice requirement and introduce unneeded complexity before single-owner Commands are proven. | **DEFERRED** (Requires proven K1 & K3 primitives first) |

---

## 3. Architectural Reason for Recommended Slice

1. **Completes the Core Interaction Primitives (Contract K1 & K2):** Phase 3A/3B proved Query capabilities ("Tell me something"). Phase 3C proves Command capabilities ("Do this"). Without Command capabilities, AKIRA has no formal mechanism for domain state mutation.
2. **Exercises Rule N1 in Production Code:** Accepted Decision N1 permits internal callers to issue direct single-owner Commands without VAJRA under 5 strict conditions:
   - Condition 1: Explicit user instruction.
   - Condition 2: Single-owner scope (no cross-owner coordination).
   - Condition 3: Outside any Mission.
   - Condition 4: Permitted by descriptor `permissions`.
   - Condition 5: Target is neither HANDS nor GENESIS.
   `task.create` and `task.update` strictly satisfy all 5 conditions.
3. **Establishes Event Causation Traceability (Contract K3 & K19):** Executing a Command capability mutates domain state and emits a Contract K3 Event (`task.created` or `task.updated`) carrying the Command's `invocationId` as its `causationId`. This links mutations to event streams cleanly.

---

## 4. Target Contract Mapping

| Frozen Contract | Conceptual Specification | Target TypeScript Mapping |
| :--- | :--- | :--- |
| **K1 (Command Contract)** | "Do this." Addressed to exactly one owner. Changes domain state; synchronous or asynchronous; ends in terminal Result (K5) and emits Event (K3). | `src/akira-os/tasks/capabilities/task-write.ts`<br>`kind: 'Command'`, `executionCharacteristics: { isSynchronous: true, isIdempotent: false, isReadOnly: false }` |
| **K3 (Event Contract)** | "Something happened." Published by state owner upon mutation. Carries Event ID, subject, timestamp, causation (`invocationId`), correlation metadata. | `src/contracts/events/domain-event.ts`<br>`interface DomainEvent<T>` emitted via `eventBus` on Command success. |
| **K7 (Descriptor)** | Complete metadata: Name, Version, Owner, Kind, Input/Output Schemas, Permissions, Tier, Cost, Characteristics, Observability. | `src/contracts/capabilities/descriptor.ts` |
| **K8 (Ownership)** | `AKIRA OS · workspace` owns task domain semantics and execution (`SqliteTaskRepository`). | `owner: 'AKIRA OS · workspace'` |
| **K17 / Rule N1** | Direct internal single-owner Command authority boundary. | `registry.invoke(name, input, correlation, { isInternal: true })` enforcing 5 Rule N1 conditions. |
| **K19 (Correlation)** | Identifiers: `requestId`, `correlationId`, `invocationId`, `causationId`. | Carried in Result envelope and Domain Event payload. |

---

## 5. Current Implementation Seam

Currently, task creation and updates in AKIRA bypass formal capability boundaries:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ CURRENT PATH: Direct RPC & Local Store Mutation                                         │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ UI Component / Client Service (tasksService)                                            │
│   │                                                                                     │
│   ▼                                                                                     │
│ persistAddTask / persistUpdateTask (createServerFn RPC)                                 │
│   │                                                                                     │
│   ▼                                                                                     │
│ SqliteTaskRepository.add() / update() (Direct SQLite call)                              │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### The Adaptation Seam for Phase 3C

The adaptation seam connects the new Command capability handlers directly to `SqliteTaskRepository` (`src/persistence/repositories/SqliteTaskRepository.ts`) and the existing Event Bus:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 3C TARGET SEAM: Encapsulated Command Capabilities                                 │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ Authorized Internal Caller (UI user action under Rule N1)                               │
│   │                                                                                     │
│   ▼                                                                                     │
│ Capability Registry Host (AKIRA OS Platform Plane)                                      │
│   │  • Enforces Rule N1 boundary conditions                                             │
│   │  • Validates input schema via Zod                                                   │
│   │                                                                                     │
│   ▼                                                                                     │
│ Capability Handler: task.create / task.update                                           │
│   ├── Delegates execution to SqliteTaskRepository.add() / update()                      │
│   ├── Emits Contract K3 Domain Event (task.created / task.updated) with causationId    │
│   └── Wraps outcome in uniform Result<T, E> envelope                                    │
│                                                                                         │
│   ▼                                                                                     │
│ SqliteTaskRepository (Preserved Infrastructure) & Event Bus                             │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Proposed Capabilities (Vertical Slice)

Phase 3C introduces two Command capabilities owned by `AKIRA OS · workspace`:

### 6.1 `task.create`
- **Identifier:** `task.create`
- **Version:** `1.0.0`
- **Kind:** `Command` (Contract K1)
- **Owner:** `AKIRA OS · workspace` (Contract K8)
- **Input Schema:** Zod Schema:
  ```typescript
  z.object({
    id: z.string().optional(),
    title: z.string().min(1, "Task title cannot be empty"),
    description: z.string().optional(),
    priority: z.enum(["Low", "Medium", "High"]).optional().default("Medium"),
    estimatedDuration: z.number().int().positive().optional().default(30),
    dueDate: z.string().nullable().optional(),
    projectId: z.string().nullable().optional(),
  })
  ```
- **Output Payload:** `{ id: string }`
- **Activation Tier:** Tier 1 (Warm at boot)
- **Permissions:** `{ allowInternal: true, allowVajra: true, allowExternalMcp: false }` (MCP v0 read-only per D4)
- **Cost Class:** `local_cheap`
- **Execution Characteristics:** Synchronous, Non-idempotent, Mutating, Reversible, Emits Events.
- **Emitted Observation / Event:** `task.created`

### 6.2 `task.update`
- **Identifier:** `task.update`
- **Version:** `1.0.0`
- **Kind:** `Command` (Contract K1)
- **Owner:** `AKIRA OS · workspace` (Contract K8)
- **Input Schema:** Zod Schema:
  ```typescript
  z.object({
    id: z.string().min(1, "Task ID must be a non-empty string"),
    patch: z.object({
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      priority: z.enum(["Low", "Medium", "High"]).optional(),
      estimatedDuration: z.number().int().positive().optional(),
      dueDate: z.string().nullable().optional(),
      done: z.boolean().optional(),
      completed: z.boolean().optional(),
      projectId: z.string().nullable().optional(),
    }).refine((p) => Object.keys(p).length > 0, "Patch must contain at least one field to update"),
  })
  ```
- **Output Payload:** `{ updated: boolean }`
- **Activation Tier:** Tier 1 (Warm at boot)
- **Permissions:** `{ allowInternal: true, allowVajra: true, allowExternalMcp: false }`
- **Cost Class:** `local_cheap`
- **Execution Characteristics:** Synchronous, Idempotent, Mutating, Reversible, Emits Events.
- **Emitted Observation / Event:** `task.updated`

---

## 7. Ownership & Subsystem Allocation

Per **Contract K8**:
- **Semantic & Execution Owner:** `AKIRA OS · workspace` (owns Task entity definition and SQLite storage).
- **Registration Host:** `AKIRA OS` Platform Plane (`src/contracts/capabilities/registry.ts`).
- **Invocation Authority:** Direct internal caller under Rule N1 (or VAJRA for future mission routing).

---

## 8. Invocation Flow & Rule N1 Rule Enforcement

```
Caller -> registry.invoke("task.create", input, correlation, { isInternal: true })
  │
  ├── 1. Registration & Availability Check
  ├── 2. Permissions Check (allowInternal === true)
  ├── 3. Rule N1 Boundary Verification:
  │      - Is target GENESIS or HANDS? -> No (workspace owner)
  │      - Is request from internal caller? -> Yes
  ├── 4. Input Schema Validation (Zod safeParse)
  ├── 5. Handler Execution:
  │      - Calls SqliteTaskRepository.add(input)
  │      - Publishes DomainEvent ("task.created") with causationId = correlation.invocationId
  └── 6. Returns Result.success({ id: taskId }, correlation)
```

---

## 9. Lifecycle Implications

Per **Contract K9** and **Contract K22**:
- **Activation Tier:** Tier 1 (Warm platform capability; registered and activated during AKIRA OS runtime boot).
- **Lifecycle Sequence:** `Defined` → `Registered` → `Available` → `Activated` → `Invoked` → `Result` + `Event`.
- **Side Effects:** Mutates task record in SQLite storage; publishes `task.created` / `task.updated` domain event to event bus.

---

## 10. Exact Files Expected to Change

Phase 3C implementation will add minimal additive files under `src/contracts/events/` and `src/akira-os/tasks/capabilities/`:

### New Files Created:
1. `src/contracts/events/domain-event.ts` — Definition of Contract K3 `DomainEvent<T>` interface and helper factory (`createDomainEvent`).
2. `src/akira-os/tasks/capabilities/task-write.ts` — Descriptors, input schemas, and execution handlers for `task.create` and `task.update`.
3. `tests/capabilities/task-write-capability.test.ts` — Unit & integration tests for task write capabilities, Rule N1 enforcement, and K3 Event emission.

### Existing Files Modified:
1. `src/contracts/capabilities/registry.ts` — Minor addition to enforce Rule N1 condition 5 (rejecting Command capabilities targeted at GENESIS or HANDS when invoked directly).

Zero existing persistence files, database drivers, or UI components will be deleted or modified.

---

## 11. Protected Files & Subsystems

Per **Engineering Handoff §12**, the following components are strictly protected and must NOT be modified:

1. `src/persistence/repositories/SqliteTaskRepository.ts`
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

## 12. Required Tests

The following test suite must be implemented and achieve 100% pass rate:

1. **`tests/capabilities/task-write-capability.test.ts`**:
   - `task.create`: Creates a new task in SQLite, returning `Result.success({ id })`.
   - `task.create`: Emits `task.created` Contract K3 Event with `causationId === correlation.invocationId`.
   - `task.create`: Returns `Result.failure('invalid_request')` when title is empty.
   - `task.update`: Updates existing task fields in SQLite, returning `Result.success({ updated: true })`.
   - `task.update`: Emits `task.updated` Contract K3 Event.
   - `task.update`: Returns `Result.failure('invalid_request')` when patch is empty or task ID is missing.
   - **Rule N1 Enforcement:** Rejects Command capability invocations aimed at GENESIS or HANDS directly.
   - **Permission Enforcement:** Rejects MCP write attempts with `command_rejection` (D4 read-only rule).
2. **System Regression Suite**:
   - `npm run test:run` (100% pass across all vitest files).
   - `npm run validate:architecture` (363 architectural assertions passing).
   - `npx vitest run tests/production-journey.test.ts` (Canary journey passing).

---

## 13. Acceptance Criteria

Implementation of Phase 3C will be deemed complete if and only if:

1. `task.create` and `task.update` Command capabilities are registered under `AKIRA OS · workspace`.
2. Invoking `task.create` / `task.update` executes SQLite persistence changes and returns uniform `Result<T, E>`.
3. Successful Command execution publishes a valid Contract K3 `DomainEvent` with correct correlation/causation metadata.
4. MCP external write attempts are rejected with `command_rejection` per Decision D4.
5. Direct Commands to GENESIS or HANDS are rejected under Rule N1.
6. 100% pass rate on `tests/capabilities/task-write-capability.test.ts`.
7. Zero regressions across `npm run test:run`, `npm run validate:architecture`, and `tests/production-journey.test.ts`.
8. Zero modifications to protected infrastructure files.

---

## 14. Rollback Strategy

Because Phase 3C is strictly additive:
1. Reverting `src/contracts/capabilities/registry.ts` and deleting `src/contracts/events/domain-event.ts`, `src/akira-os/tasks/capabilities/task-write.ts`, and `tests/capabilities/task-write-capability.test.ts` restores the repository to the exact Phase 3B baseline.
2. No database migrations, schema alterations, or UI controller changes are performed.

---

## 15. Unresolved Architectural Decisions (O-Questions Checklist)

| Open Question | Status | Impact on Phase 3C Implementation |
| :--- | :--- | :--- |
| **O1: Authoritative Runtime Placement** | UNRESOLVED | **Non-blocking.** Local server execution operates cleanly. |
| **O2: Workspace Write Authority** | UNRESOLVED | **Non-blocking.** Rule N1 decision explicitly permits local server repository adaptation. |
| **O3: Goal & Mission Schema** | UNRESOLVED | **Non-blocking.** Task writes do not touch Goal or Mission entities. |
| **O4: Identity Consolidation** | UNRESOLVED | **Non-blocking.** Task writes do not touch GENESIS identity stores. |
| **O6: Reset Semantics** | UNRESOLVED | **Non-blocking.** Does not alter Command capability descriptors. |
| **O10: Registry Physical Location** | UNRESOLVED | **Non-blocking.** Placement in `src/contracts/capabilities/` complies with FC §4 (K8). |

**Verdict:** Zero unresolved architectural decisions block the Phase 3C proposal.

---

## 16. Why Other Candidate Directions Should Wait

1. **Why Query Expansion should wait:** Query semantics are fully proven across Tier 1 and Tier 2. Adding more read capabilities produces zero new architectural progress.
2. **Why Standalone Event Foundation should wait:** Events without Commands are unanchored notifications. Integrating Event emission into Command execution proves the complete K1 → K3 → K19 execution pipeline in one slice.
3. **Why Runtime Boundary Expansion should wait:** The Capability Registry host already manages fine-grained lifecycle states (K9/K22). Additional process-level boundaries add overhead without immediate domain value.
4. **Why VAJRA Contract Surface should wait:** VAJRA orchestration requires proven Command (K1) and Event (K3) primitives. Implementing VAJRA before single-owner Commands are proven would build orchestration on top of missing execution primitives.
