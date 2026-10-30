# Phase 3E — Mission Contract & VAJRA Architecture Study

**Status:** ARCHITECTURE STUDY (Non-Code Architectural Analysis)  
**Author:** Antigravity  
**Date:** October 3, 2026  
**Target Document:** `docs/architecture/PHASE-3E-MISSION-VAJRA-ARCHITECTURE-STUDY.md`  

---

## 1. Executive Conclusion

Phase 3A, 3B, 3C, and 3D are complete and verified across 90 unit/integration tests, zero TypeScript errors, 363 architecture boundary assertions, and 28 production journey tests. The proven foundation now contains:
- **Contract K1:** Command
- **Contract K2:** Query
- **Contract K3:** Domain Event
- **Contract K4:** Observation
- **Contract K5:** Execution Result
- **Contract K6:** VerificationRecord & MissionResult
- **Contract K7:** Capability Descriptor
- **Contract K8:** Capability Ownership Split
- **Contract K9:** Capability Lifecycle (Tier 0, Tier 1, Tier 2 with Rule N2 on-demand activation)
- **Contract K19:** Correlation & Causation Traceability (`requestId`, `correlationId`, `invocationId`, `causationId`)
- **Accepted Decision Records:** N1 (direct internal commands), N2 (Tier-2 activation), N3 (GENESIS command-freedom), D4 (MCP v0 read-only).

### The Primary Finding of Phase 3E
**A Mission is an operational unit of work, not a cognitive entity, not a workspace task, and not a conversational turn.**

While all five foundational communication primitives (K1–K6) and capability lifecycle controls (K7–K9) exist in contract space, **AKIRA currently has zero architectural primitives for Mission representation or VAJRA orchestration.** Neither Mission nor VAJRA can or should be implemented immediately.

Before any orchestrator or runtime loop is constructed, AKIRA must establish a pure contract-level specification for:
1. What a `Mission` looks like (identity, objective, constraints, criteria);
2. What a `MissionStep` looks like (planned unit of invocation);
3. How `MissionState` tracks step execution, observations, and verification.

Attempting to implement VAJRA or a Mission execution runtime today would violate the 9-stage engineering discipline by forcing the runtime to invent uncontracted state machines, conflate workspace tasks with mission steps, and bypass unresolved architectural decisions (specifically **O3**, **O7**, **O8**, and **§20.3**).

---

## 2. Mission Definition Precisely

Based strictly on the frozen specifications (`AKIRA-TARGET-ARCHITECTURE.md` §5–§6, `AKIRA-FOUNDATION-CONTRACTS.md` K6, K10, K12):

| Question | Frozen Architectural Specification | Status |
| :--- | :--- | :--- |
| **What is a Mission?** | An operational unit of work through which AKIRA attempts to achieve an objective. It is bounded: it has an explicit start, planned steps, a terminal state, and completion criteria. (TA §6 DECISION) | **DECIDED** |
| **What creates a Mission?** | VAJRA is the sole creator of Missions (TA §6, K10 step 3, K12). Triggers include user requests, external events, or cognitive observations. | **DECIDED** |
| **What does a Mission own?** | Its operational objective, execution constraints, mission steps, capability requirements, recorded evidence references, verification judgements, and mission-level outcome. | **DECIDED** |
| **What does it not own?** | User tasks in the workspace, cognitive identity/memory, database storage, capability implementation, terminal/browser processes, model providers, UI state. | **DECIDED** |
| **Can a Mission exist without a Goal?** | **YES.** A bounded user request (e.g. "Find the datasheet for this IC") can become a Mission directly without creating any durable Goal. (TA §6 DECISION) | **DECIDED** |
| **Can one Goal have multiple Missions?** | **YES.** A durable Goal may be pursued by zero or more successive Missions over time. (TA §6 DECISION) | **DECIDED** |
| **What is the relationship between Mission and Task?** | **Workspace tasks are NOT mission steps.** A Task is a user-managed workspace item owned by AKIRA OS. A mission step is VAJRA's internal operational unit. A mission may create or read tasks through capabilities, but the entities are strictly separate. (TA §6 TARGET) | **DECIDED** |
| **What is the relationship between Mission and Mission Step?** | A Mission decomposes its plan into bounded, sequential or conditional operational steps (`MissionStep`). Each step defines required capabilities and expected evidence. | **DECIDED** |
| **What is the relationship between Mission and capability invocation?** | A Mission Step is executed by routing a Command (K1) or Query (K2) to exactly one capability owner. Capability execution yields an Execution Result (K5) and optional Observations (K4). | **DECIDED** |
| **What information must Mission state contain?** | `missionId`, optional `goalId`, objective, constraints, step list with statuses, required capabilities, recorded evidence IDs (K5 Results, K4 Observations), verification records, terminal `MissionResult`, and K19 correlation fields. | **DECIDED (Concepts) / OPEN (§20.3 exact schema)** |
| **What constitutes Mission completion?** | Successful completion occurs **ONLY** when VAJRA verifies that the mission's completion criteria are satisfied based on recorded evidence. Execution ≠ Completion (D7, K6). | **DECIDED** |
| **What constitutes Mission failure?** | When execution fails, completion criteria are unsatisfied, contradictory evidence emerges, or deadlines expire. Recorded as a `not_completed` MissionResult. (K6, K18) | **DECIDED** |
| **What constitutes cancellation?** | How an in-flight Mission is cancelled at the mission level is undesigned. (TA §22.3, K12) | **OPEN** |
| **What constitutes escalation?** | A request for a human decision when verification fails, an unresolvable ambiguity arises, or high-impact actions require confirmation. (K12, K18) | **DECIDED** |

---

## 3. Goal vs Mission

The frozen architecture strictly enforces four fundamental non-identities:
1. **Goal ≠ Mission**
2. **Task ≠ Mission Step**
3. **Execution ≠ Completion**
4. **New Chat ≠ Reset**

### Minimum Conceptual Relationship Tree

```
User Request / External Trigger / Event / Human Decision
                          │
                          ▼ (VAJRA: UNDERSTAND)
       Goal (durable desired outcome; optional, survives many missions)
         │
         └── pursued by zero or more
               │
               ▼
             Mission (bounded operational unit of work; has terminal state)
               │
               ├── Mission Step 1 ──► Capability Invocation (Command / Query)
               │                           │
               │                           └── Execution Result (K5)
               │
               ├── Mission Step 2 ──► Capability Invocation (Command / Query)
               │                           │
               │                           └── Execution Result (K5)
               │
               ├── Observation(s) (K4 evidence emitted during execution / runtime)
               │
               ├── Verification (VAJRA judges Results + Observations against criteria)
               │       │
               │       └── VerificationRecord (K6 evidence judgement)
               │
               └── MissionResult (K6 terminal verified outcome)
```

### Prohibited Assumptions
- **Do NOT assume every request becomes a Goal:** Durable Goals are optional; most requests are bounded operational tasks or direct queries.
- **Do NOT assume every request becomes a Mission:** Read Queries (e.g. MCP v0 reads, simple UI views) execute directly through capability contracts without creating a Mission (D5).
- **Do NOT assume every conversation turn is a Mission:** Whether a chat turn is a lightweight mission or a non-mission request remains **OPEN (O7)**.
- **Do NOT assume workspace Tasks become Mission Steps:** Workspace tasks belong to the user and AKIRA OS; Mission Steps belong to VAJRA's orchestration plan.

---

## 4. VAJRA Authority Boundary

VAJRA is the **authoritative mission coordinator** of AKIRA (Target Architecture §5.1). It is an orchestration layer, **not** an execution engine.

### VAJRA Primary Control Loop
```
UNDERSTAND ──► PLAN ──► SELECT ──► COORDINATE ──► VERIFY
```
1. **UNDERSTAND:** Establish operational meaning, constraints, and objective (draws on GENESIS via cognitive Queries; does not keep its own model of the user).
2. **PLAN:** Determine operational steps, required capabilities, and completion criteria.
3. **SELECT:** Choose capabilities from the catalogue (K7).
4. **COORDINATE:** Issue Commands and Queries; collect Results and Observations.
5. **VERIFY:** Judge collected evidence against completion criteria; update mission state.

### What VAJRA Must NOT Own (Hard Invariants)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                       VAJRA PROHIBITED BOUNDARIES                            │
├───────────────────────┬──────────────────────────────────────────────────────┤
│ Prohibited Area       │ Owning Subsystem & Architectural Rule                │
├───────────────────────┼──────────────────────────────────────────────────────┤
│ Raw Memory & Identity │ GENESIS owns memory stream and cognitive identity.   │
│                       │ VAJRA never models the user directly.                │
├───────────────────────┼──────────────────────────────────────────────────────┤
│ Cognition & Insight   │ GENESIS owns understanding, recall, and insights.    │
│                       │ VAJRA queries GENESIS; it does not generate insights.│
├───────────────────────┼──────────────────────────────────────────────────────┤
│ SQLite & Storage      │ AKIRA OS platform plane owns persistence (K15).      │
│                       │ VAJRA never opens SQLite connections or runs SQL.    │
├───────────────────────┼──────────────────────────────────────────────────────┤
│ Workspace Persistence │ AKIRA OS · workspace owns tasks, projects, notes.    │
│                       │ VAJRA mutates workspace only via capability Commands.│
├───────────────────────┼──────────────────────────────────────────────────────┤
│ Capability Execution  │ Capability owners execute work. VAJRA coordinates.   │
├───────────────────────┼──────────────────────────────────────────────────────┤
│ Terminal / OS Actions │ HANDS owns execution adapters. VAJRA never spawns    │
│                       │ processes, opens shells, or automates browsers.      │
├───────────────────────┼──────────────────────────────────────────────────────┤
│ Model Transport       │ Platform infrastructure owns AI provider transport   │
│                       │ (O9). VAJRA never manages API keys or HTTP streams.  │
├───────────────────────┼──────────────────────────────────────────────────────┤
│ UI Presentation       │ App routes own UI state and rendering.               │
└───────────────────────┴──────────────────────────────────────────────────────┘
```

### Potential Authority Collisions
1. **VAJRA vs GENESIS:** Collision occurs if VAJRA attempts to parse user psychological profile or synthesize memory directly, bypassing GENESIS Query capabilities.
2. **VAJRA vs AKIRA OS Runtime:** Collision occurs if VAJRA attempts to initialize subsystem internals or activate capabilities directly, rather than stating a capability requirement to AKIRA OS (violates Decision D2).
3. **VAJRA vs AKIRA OS Persistence:** Collision occurs if VAJRA creates a private database table without going through the AKIRA OS storage provider.
4. **VAJRA vs HANDS:** Collision occurs if VAJRA runs node child processes, shell commands, or tool adapters internally instead of dispatching authorized Commands to HANDS (violates K13).
5. **VAJRA vs UI Routes:** Collision occurs if `routes/chat.tsx` or `routes/tasks.tsx` continues to implement bespoke coordination, prompt generation, or mission completion checks.

---

## 5. Mission Lifecycle

The conceptual lifecycle of a Mission maps through distinct stages, each with strict ownership, inputs, outputs, and governing contracts:

```
Creation ──► Planning ──► Selection ──► Execution ──► Observation ──► Verification ──► Outcome
```

| Lifecycle Stage | Owner | Input | Output | Governing Contract | Specified State Transition | Unresolved Question |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Creation** | VAJRA | User request, trigger, event | Initial un-executed Mission instance | K10 step 1 & 3; K12; TA §6 | `Created` (concept) | How triggers arrive; whether chat turns create missions (**O7**). |
| **2. Understanding & Planning** | VAJRA (informed by GENESIS) | Mission objective + GENESIS Query Results | Mission plan: steps, constraints, completion criteria | K10 step 2 & 4; K11; K12 | `Planned` (concept) | Mission plan schema and step representation (**§20.3**). |
| **3. Capability Selection** | VAJRA (selects) ➔ AKIRA OS (activates) | Plan's required capabilities | Capability requirement stated to AKIRA OS; capability activated | K8; K9; K10 step 5–7; K14; D2; Rule N2 | `Activated` (K9) | Selection policy algorithm and routing table interface. |
| **4. Execution / Coordination** | VAJRA (routes) ➔ Capability Owner (runs) | Authorized Command (K1) or Query (K2) with K19 correlation | Execution Result (K5) | K1; K2; K5; K10 step 8–9; K13; K19; Rule N1 | Step status: `Running` ➔ `Succeeded` / `Failed` | Asynchronous command acknowledgement vs completion polling. |
| **5. Observation Handling** | Capability Owner (emits) ➔ VAJRA (collects) | Execution telemetry, environment state, cognitive recommendations | Recorded `Observation<TPayload>` instances (K4) | K4; K10 step 10; D7; K19 | Fire-and-observe (no state change in observed system) | In-memory buffering vs durable event log (**O11**). |
| **6. Verification** | VAJRA | Completion criteria + recorded evidence (K5 IDs + K4 IDs) | `VerificationRecord` (K6) | K6; K10 step 11; D7; K18; K19 | `criteria_satisfied` / `criteria_not_satisfied` / `inconclusive` | Automated criteria evaluator syntax (code vs LLM judge). |
| **7. Mission Outcome** | VAJRA | VerificationRecord outcome | Next step, replan, escalation, or terminal `MissionResult` (K6) | K6; K10 step 12–13; K12; K18 | `completed` / `not_completed` | Full mission lifecycle state enum (**§20.3 OPEN**); cancellation (**§22.3 OPEN**). |

---

## 6. Verification Model

Phase 3D implemented the contract foundation for verification:
```
Command (K1)
   │
   ▼
Execution Result (K5) ──┐
                         ├─► VerificationRecord (K6) ──► MissionResult (K6)
Observation(s) (K4) ────┘         (VAJRA judgement)         (terminal outcome)
```

### The Invariant: Successful Execution ≠ Verified Mission Completion
1. **Execution Result (K5):** Reports only whether a specific Command or Query executed normally within the subsystem that handled it (e.g. `task.update` returned `{ updated: true }`).
2. **Observation (K4):** Reports evidence about system reality with `confidence` and `provenance` (e.g. `Observation: file exists on disk`, confidence 1.0). **Invariant I8:** An Observation is never verification.
3. **VerificationRecord (K6):** Represents VAJRA's authoritative evaluation. It holds arrays of `executionResultIds` and `observationIds`, weighing that evidence against the mission's completion criteria.
4. **MissionResult (K6):** Emitted **ONLY** by VAJRA after verification. Status is either:
   - `completed`: Completion criteria were verified as satisfied.
   - `not_completed`: Mission failed, timed out, or criteria were unsatisfied.

> [!NOTE]
> **Persistence of Verification:** Per Contract K15 (§22.3), whether and how `VerificationRecord` instances are persisted in durable storage is **OPEN**. They currently exist as immutable in-memory contract structures.

---

## 7. GENESIS ↔ VAJRA Boundary

| Dimension | GENESIS | VAJRA |
| :--- | :--- | :--- |
| **Core Role** | Knows, understands, recalls, reflects, derives cognitive state. | Decides, coordinates, plans, routes, verifies mission progress. |
| **Action Authority** | Informs and recommends. Emits Observations and Query Results. | Commands cross-system work. Verifies completion. |
| **Command Issuance** | **NEVER** issues Commands to other subsystems. (TA §3.1, §5.4, Invariant I1) | Issues Commands to capability owners. (K1, K12) |
| **Command Acceptance** | **NEVER** accepts Commands from other subsystems or external callers. (Rule N3) | Accepts requests and human decisions; does not expose commands. |
| **Capability Exposure** | Exposes **Query capabilities ONLY** (`memory.search`, `identity.read`, `recall.search`, etc.). | Exposes mission queries; coordinates other capabilities. |

### Enforcing Rule N3
- Rule N3 guarantees that GENESIS memory cannot be commanded or forced from the outside.
- VAJRA cannot command GENESIS to "remember X" or "alter identity Y".
- GENESIS observes domain Events and updates its cognitive state under its own semantic authority.

### Existing Code Collisions (Must Be Neutralized)
1. `src/genesis/planning/*`: Built inside GENESIS, attempting to do task planning and dependency resolution. Must NOT be moved into VAJRA or revived (TA §4, §19).
2. `src/genesis/context/initiative/*`: Built inside GENESIS context, attempting to decide proactive actions. Initiative belongs to VAJRA (TA §5.2); the existing implementation must be redesigned under VAJRA, not moved.
3. `src/genesis/decision/*` & `src/genesis/reasoning/*`: Pure orchestration structures placed inside GENESIS. Operational decisions belong to VAJRA.
4. `src/genesis/context/ai/context-engine.ts`: Contains operational routing logic (e.g. `genesisCovers()`, `detectHistoricalSearch()`). These operational selections belong to VAJRA (TA §4.1).

---

## 8. AKIRA OS ↔ VAJRA Boundary

```
┌─────────────────────────────────────────────────────────────┐
│                       VAJRA                                 │
│  Orchestration Authority: Goals, Missions, Routing, Verify  │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
    Capability Requirement (D2)     Domain Commands / Queries
               │                              │
               ▼                              ▼
┌──────────────────────────────┐┌─────────────────────────────┐
│  AKIRA OS (Platform Plane)   ││   AKIRA OS (Domain Plane)   │
│  Registration, Activation,   ││   Workspace: Tasks, Projects│
│  Persistence, Health         ││   Conversations, Timeline   │
└──────────────────────────────┘└─────────────────────────────┘
```

### Boundary Principles (Decision D2, Contract K14)
1. **Registration & Activation Authority:** AKIRA OS owns capability registration and activation. VAJRA states a capability requirement; AKIRA OS activates the capability (Tier 2). VAJRA never initializes capability internals.
2. **Selection & Routing Authority:** VAJRA owns capability selection and routing (Decision D6). AKIRA OS never selects capabilities for a mission.
3. **Persistence Isolation:** AKIRA OS platform plane is the storage provider. VAJRA owns the semantics and lifecycle of its data, but writes through storage infrastructure provided by the OS.
4. **Workspace Peer Relationship:** AKIRA OS workspace (`project.read`, `task.create`) is a peer capability provider. VAJRA invokes workspace capabilities like any other owner's.

---

## 9. VAJRA ↔ HANDS Boundary

HANDS is the **controlled execution layer** for external-world actions (Target Architecture §11, Contract K13).

### Boundary Rules
- **VAJRA decides; HANDS executes.** HANDS never chooses an objective, creates a mission, selects capabilities, or verifies completion.
- **Commands to HANDS come ONLY from VAJRA.** (Contract K13, Invariant I4). GENESIS, AKIRA OS, and MCP v0 never issue Commands to HANDS.
- **Execution ≠ Completion:** HANDS returns an Execution Result (`succeeded`, `failed`, `timed_out`, `cancelled`, `partial`) and emits Observations. Succeeded execution does not mean mission completion; VAJRA must verify.

### What Mission Orchestration Needs to Know About HANDS
1. HANDS capability descriptors (e.g. `hands.executeTool`).
2. Supported constraint parameters (timeouts, deadlines, confirmation gates).
3. Status categories returned by HANDS execution.
4. Cancellation command semantics for stopping in-flight executions.

*Note: Concrete terminal, browser, or tool integrations are internal to HANDS and are completely out of scope for Mission contracts.*

---

## 10. O1–O12 Decision Audit

Re-evaluating the 12 open decisions from Target Architecture §20 against Phase 3A–3D and future Mission/VAJRA work:

| Decision ID | Summary | Blocks Mission Contract? | Blocks VAJRA Runtime? | Can We Proceed Safely? | Evidence Required to Resolve |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **O1** | Runtime placement (browser vs server vs desktop) | **NO** | **YES** | Safe for contracts. Unsafe for persistent orchestrator. | Decision on desktop packaging (Electron/Tauri) vs client/server process model. |
| **O2** | Server authoritative for workspace writes? | **NO** | **YES** | Safe for contracts. Unsafe if VAJRA writes from server while browser is authority. | Verification of server-side mutation sync and event delivery channel. |
| **O3** | Goal schema, states, & relation to Project/Task | **NO** | **PARTIAL** | Safe for Missions (Missions do not require Goals). Blocks Goal implementation. | Formal product decision on Goal schema and relation to workspace Project/Task entities. |
| **O4** | Identity durable vs derived; store merge | **NO** | **NO** | Completely independent of Mission/VAJRA. | Consolidation of `emergent` and `foundation` identity stores in GENESIS. |
| **O5** | *Closed by D4* (MCP v0 read-only) | — | — | — | Closed. |
| **O6** | Destructive Reset semantics | **NO** | **NO** | Safe. New Chat ≠ Reset is DECIDED (D3). | Product definition of wipe scope across workspace, memory, and missions. |
| **O7** | Conversation-turn owner; is a turn a Mission? | **NO** | **YES** | Safe for explicit missions. Blocks conversational turn routing. | Decision on whether turn orchestration is a lightweight Mission or a separate pipeline. |
| **O7r** | Disposition of legacy `src/runtime/` | **NO** | **NO** | Safe. P0 KILL/LATER dispositions stand. | Cleanup pass archiving legacy runtime files. |
| **O8 / O8a** | Exact persistence boundary & derived cognition | **NO** | **YES** | Safe for in-memory contracts. Blocks Mission database storage. | Schema migration design for mission state tables and write-isolation mechanism. |
| **O9** | Model transport placement | **NO** | **YES** | Safe for contracts. Blocks autonomous planning loops requiring LLM calls. | Placement decision: AKIRA OS platform service vs dedicated gateway. |
| **O10** | Capability Registry location, MCP v0 stage | **NO** | **NO** | Safe. Contracts live in `src/contracts/`; registry in `src/contracts/capabilities/`. | Formal acceptance of registry implementation location. |
| **O11** | Durable domain event log necessity | **NO** | **NO** | Safe. Current `eventBus` delivery is sufficient for in-memory contracts. | Decision on whether mission audit requires an append-only SQLite event log. |
| **O12** | External auth mechanism & timing | **NO** | **NO** | Safe. MCP write path is closed; internal callers use caller context. | Auth specification for local IPC/HTTP gateway. |

---

## 11. Legacy Code Audit

Inventory and classification of existing code that superficially resembles planning, reasoning, decision, initiative, or missions:

| Code Component | Location | Classification | Concrete Repository Evidence & Architectural Disposition |
| :--- | :--- | :--- | :--- |
| **`PlanningService` & graph builder** | `src/genesis/planning/services/*` | **Legacy / Do Not Revive** | In-memory graph builder, task/milestone repositories in GENESIS. P0 #90 KILL. TA §4, §19 explicitly prohibit moving or reviving this code. |
| **`InMemoryPlanRepository`, `TaskRepository`** | `src/genesis/planning/repositories/*` | **Legacy / Do Not Revive** | Conflates workspace tasks with planning nodes. Incompatible with SQLite task persistence. |
| **`DecisionEngine` & strategies** | `src/genesis/decision/*` | **Legacy / Do Not Revive** | Strategy aggregator in GENESIS. P0 #92 KILL. Operational decisions belong to VAJRA, not GENESIS. |
| **`ReasoningEngine` & strategies** | `src/genesis/reasoning/*` | **Legacy / Do Not Revive** | Strategy aggregator in GENESIS. P0 #91 KILL. |
| **`InitiativeService`** | `src/genesis/context/initiative/*` | **Redesign Required** | Currently inert, always returns "Silence". TA §3.2 & §5.2 dictate Initiative belongs to VAJRA; must be redesigned under VAJRA, not moved. |
| **`RuntimeManager`** | `src/runtime/runtime-manager.ts` | **Legacy / Do Not Revive** | Legacy micro-runtime manager. P0 #42 KILL. |
| **`CapabilityRegistry` (legacy)** | `src/runtime/registry/` | **Legacy / Do Not Revive** | Module-priority provider selector. P0 #45 LATER / NOT REVIVED. Superseded by `src/contracts/capabilities/registry.ts`. |
| **`LifecycleManager`** | `src/runtime/lifecycle/` | **Redesign Required / Pattern Donor** | P0 #43 LATER. Concepts may inform future AKIRA OS lifecycle, but code is not active. |
| **`DailyMissionPage` & `MissionFormDialog`** | `src/routes/tasks.tsx` | **Unrelated (Workspace UI)** | Merely a UI presentation view over workspace `Task` entities. Calls `akira.addTaskDetails`. Not related to VAJRA Missions. |
| **`Events.MISSION_COMPLETED`** | `src/persistence/akira-store.ts:537` | **Legacy (Rename / Retire Later)** | Triggers when all workspace tasks hit `done = true`. TA §6 & O3 note this will be renamed or retired when real Missions exist. |

---

## 12. Architectural Risks

1. **Premature Orchestration Risk:** Attempting to build VAJRA before Mission contracts exist will lead to hardcoding ad-hoc execution loops inside routes or background scripts.
2. **Task/Mission Conflation Risk:** Developers or agents confusing SQLite workspace `Task` items with internal `MissionStep` objects, polluting user task lists with internal agent execution artifacts.
3. **Cognitive Contamination Risk:** Allowing VAJRA to build internal cognitive representations of the user, recreating a shadow GENESIS.
4. **Persistence Bypassing Risk:** Giving VAJRA direct SQLite access to create mission tables before the single-writer architecture (O8) is established.
5. **Divergent State Machines:** Inventing status enums (`paused`, `waiting_human`, `retrying`) before the frozen contracts specify them (§20.3).

---

## 13. Missing Contracts

To prepare AKIRA for Mission and VAJRA architecture, the following contract-level primitives are missing:

1. **`MissionDescriptor` / `MissionDefinition`:**
   - Formal specification of what constitutes a Mission definition: `missionId`, `objective`, `constraints`, `completionCriteria`, optional `goalId`, and correlation fields.
2. **`MissionStep`:**
   - Formal specification of an operational step: `stepId`, `missionId`, `targetCapability`, `input`, `expectedEvidence`, and step status.
3. **`MissionState` Envelope:**
   - Formal in-memory envelope tracking mission progress: active step, completed steps, accumulated evidence IDs (`executionResultIds`, `observationIds`), verification history, and terminal status.

---

## 14. Recommended Smallest Implementation Slice (Phase 3E Next Step)

### Recommendation: Pure Mission & Mission Step Contract Slice
Implement the foundational contract types in a neutral contract directory:
- **`src/contracts/mission/mission.ts`**
  - `MissionDefinition` interface
  - `MissionState` interface
  - `MissionStep` interface
  - `MissionConstraint` interface
  - `CompletionCriteria` interface
  - Pure factory helpers (`createMissionDefinition`, `createMissionStep`)

### Why This Slice?
1. **Zero Runtime Disruption:** Does not instantiate VAJRA, does not touch SQLite, does not touch `eventBus`, and does not alter Phase 3A–3D implementations.
2. **Closes the Contract Foundation:** Couples directly with K4 (`Observation`) and K6 (`VerificationRecord`, `MissionResult`) to complete the formal data structures needed for orchestration.
3. **Prevents Premature Architecture:** Allows full type-checking and contract testing without requiring resolution of O1 (runtime placement), O8 (database schemas), or O7 (turn ownership).
4. **Preserves Frozen Architecture:** Leaves all open enums and database persistence questions marked OPEN, specifying only the structural invariants required by Contract K10.

---

## 15. Explicit Non-Goals

During this phase and the subsequent contract slice, the following are strictly prohibited:
- **NO** implementation of the VAJRA primary loop (`UNDERSTAND -> PLAN -> SELECT -> COORDINATE -> VERIFY`).
- **NO** Mission execution engine, background worker, or scheduler.
- **NO** SQLite schema migrations or tables for Missions.
- **NO** modifications to `routes/chat.tsx`, `routes/tasks.tsx`, or `akira-store.ts`.
- **NO** revival or relocation of `genesis/planning`, `genesis/reasoning`, or `genesis/decision`.
- **NO** implementation of HANDS tools or external process adapters.
- **NO** MCP server additions or mutations.

---

## 16. Human Decisions Required

The human architectural lead must resolve the following questions before VAJRA runtime implementation can begin:
1. **O3 Resolution:** What is the concrete schema of a Goal, and does a Project reference a Goal or vice-versa?
2. **O7 Resolution:** Is an ordinary conversational turn a lightweight Mission, or does a separate turn orchestrator handle chat turns?
3. **O1 / O8 Resolution:** Where does the authoritative runtime live (browser, desktop, server), and how are Mission state tables structured in SQLite?
4. **§20.3 Resolution:** What are the exact status enums for Mission lifecycle transitions?
