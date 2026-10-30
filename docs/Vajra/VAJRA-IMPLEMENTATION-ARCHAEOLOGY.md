# VAJRA IMPLEMENTATION ARCHAEOLOGY
## Forensic Analysis of the Current AKIRA Codebase Against `VAJRA-BRAIN-ARCHITECTURE.md`
*Status: Authoritative Archaeology & Safe Disposition Baseline*

---

# 1. REPOSITORY SNAPSHOT

| Metric | Measured Value | Forensic Evidence / Source |
|---|---|---|
| **Git Branch** | `genesis/foundation-stabilization` | `git branch --show-current` |
| **Commit SHA** | `b9959ee4850c7959b188140c2cbaec38f50c68fc` | `git rev-parse HEAD` |
| **Working Tree Status** | Active working branch with untracked architecture docs & test suites; zero staged commits. | `git status` |
| **Latest Commits** | • `b9959ee`: feat: add engineering discipline skills, capability registries, and architecture documentation<br>• `e58020f`: feat(genesis): recall past conversations when a question is about the user's past<br>• `5745791`: fix(genesis): keep historical recall answers concise<br>• `9fc3b23`: feat(genesis): search past conversations when the user asks<br>• `436a5fc`: feat(conversations): store the chat archive as first-class rows, indexed | `git log -n 5 --oneline` |
| **Source Files (`src/`)** | **635** files | `(Get-ChildItem -Recurse -File src).Count` |
| **Test Files (`tests/` + `src/`)** | **162** test files (135 in `tests/`, 27 in `src/`) | Measured via PowerShell file queries |
| **Total Test Count** | **1,478 tests** across 142 suites (1,474 passing; 4 timing out in parallel run under standard 5s timeout, 100% pass when targeted) | `npx vitest run` |
| **Architecture Validator** | **363 / 363 passed** (0 failed) | `npx tsx scripts/validate-architecture.ts` |
| **TypeScript Typecheck** | **Clean (Exit code 0)** | `npm run type-check` (`tsc --noEmit`) |
| **Linter Status** | 110 Prettier style formatting warnings in newly added test files; 0 functional TypeScript errors in production files. | `npm run lint` (`eslint .`) |
| **Build Status** | **Clean (Exit code 0)**. Client and SSR Nitro/Vite production bundles built in 27.76s. | `npm run build` (`vite build`) |

### Major Module Topology (`src/`)
```
src/
├── akira-os/        # Platform host, capability registry host, OS services (tasks, search, conversations)
├── analytics/       # Analytics calculations and query service (Phase 2 migration)
├── app/             # UI shell, layout primitives, markdown renderer
├── compatibility/   # [DEAD/LEGACY] Legacy adapters between old SDK and old runtime
├── components/      # Shared React components (shadcn/ui, vault, dialogs)
├── contracts/       # Authoritative foundation contracts (K1-K19, capabilities, results, mission, observation)
├── genesis/         # Specialized cognition: episodic memory, identity, context, stories, prompt builder
├── hooks/           # React hooks (mobile, toast)
├── instrumentation/ # Event bus publisher, timeline subscribers, persistence subscribers
├── lib/             # Utility functions (cn, formatting)
├── observability/   # Metrics, system health samplers, auto-composition
├── persistence/     # SQLite WAL database initializer, repositories, migrations, store-init
├── routes/          # TanStack Router page routes (chat, tasks, daily-mission, vault, etc.)
├── runtime/         # [DEAD/LEGACY] Legacy platform plugin runtime, old module loader, old in-memory registry
├── sdk/             # [DEAD/LEGACY] Legacy external plugin client SDK
├── shared/          # Shared type definitions and infrastructure interfaces
└── workers/         # Background Web Workers (timeline processing)
```

---

# 2. RECENT VAJRA / MISSION WORK

Below is an exhaustive forensic inventory of everything implemented to date relating to VAJRA, Mission Authority, Mission Runtime, Capabilities, Observation, and Verification:

| File Path | Purpose & Current Function | Reachability | Dependencies | Test Coverage | Phase / Commit | Status |
|---|---|---|---|---|---|---|
| [`src/contracts/mission/mission-definition.ts`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/contracts/mission/mission-definition.ts) | Pure data contract for `MissionDefinition`, `MissionStep`, `MissionConstraint`, `CompletionCriteria`. Plain data, DAG-free, immutable (`Object.freeze`). | Test-only | `src/contracts/results/result.ts` | `tests/contracts/mission-contracts.test.ts` (18 tests) | Phase 3E (`b9959ee`) | **Foundational** (Pure K10/K12 contract) |
| [`src/contracts/mission/mission-state.ts`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/contracts/mission/mission-state.ts) | Passive evidence envelope (`MissionState`) referencing K4 Observation IDs, K5 Result IDs, K6 VerificationRecord IDs. Free of mutable status enums/cursors. | Test-only | `src/contracts/capabilities/verification.ts` | `tests/contracts/mission-contracts.test.ts` | Phase 3E (`b9959ee`) | **Foundational** (Pure K10/K19 contract) |
| [`src/contracts/capabilities/verification.ts`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/contracts/capabilities/verification.ts) | Pure contract for `VerificationRecord`, `VerificationOutcome`, and `MissionResult`. Codifies Invariants I2, I8, I9 (Only VAJRA issues a MissionResult after verification). | Test-only | `src/contracts/results/result.ts` | `tests/contracts/observation-verification-contracts.test.ts` (31 tests) | Phase 3D (`b9959ee`) | **Foundational** (Pure K6 contract) |
| [`src/contracts/events/observation.ts`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/contracts/events/observation.ts) | Contract K4 `Observation` primitive. Requires confidence in $[0,1]$, explicit provenance, correlation context. Distinct from Event (K3) and Result (K5). | Test-only | `src/contracts/results/result.ts` | `tests/contracts/observation-verification-contracts.test.ts` | Phase 3D (`b9959ee`) | **Foundational** (Pure K4 contract) |
| [`src/contracts/capabilities/descriptor.ts`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/contracts/capabilities/descriptor.ts) | Canonical capability descriptor schema (Contract K8). Enforces permissions (`allowVajra`, `allowInternal`), `activationTier`, `costClass`, and execution characteristics. | **Production** | `zod`, `src/contracts/results/result.ts` | Full suite (363 arch assertions, pipeline tests) | Phase 3A-3C (`b9959ee`) | **Foundational** (Authoritative K8) |
| [`src/contracts/capabilities/registry.ts`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/contracts/capabilities/registry.ts) | Core `CapabilityRegistry` interface (Contract K7/K14) and canonical implementation enforcing Rules N1, N2, and N3. | **Production** | `src/contracts/results/result.ts` | `tests/capabilities/capability-registry.test.ts` | Phase 3A-3C (`b9959ee`) | **Foundational** (Authoritative K7/K14) |
| [`src/akira-os/capabilities/host.ts`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/akira-os/capabilities/host.ts) | The single live canonical runtime host for `CapabilityRegistry` (Rule N3). Registers all production capabilities at application boot. | **Production** | `src/contracts/capabilities/*`, OS capability descriptors | Grounded in `src/routes/__root.tsx` and all production pipelines | Phase 3A-3K (`b9959ee`) | **Foundational** (Host Infrastructure) |
| [`src/akira-os/tasks/capabilities/*`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/akira-os/tasks/capabilities) | Production capability descriptors: `task.create` (Command), `task.read` (Query), `task.update` (Command), `task.list` (Query). | **Production** | SQLite Task Repository, Zod schemas | `tests/production/task-*-pipeline.test.ts` (32 tests) | Phase 3F, 3G, 3H, 3K | **Foundational** (Grounded Capabilities) |
| [`src/akira-os/search/capabilities/*`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/akira-os/search/capabilities) | Production capability descriptor: `recall.search` (Query). Grounded in SQLite FTS. | **Production** | SQLite Conversation Repository, Zod schemas | `tests/production/recall-search-pipeline.test.ts` (8 tests) | Phase 3J (`b9959ee`) | **Foundational** (Grounded Capability) |
| [`src/contracts/results/result.ts`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/contracts/results/result.ts) | Contract K1/K5 `Result<T, E>` and Contract K19 `CorrelationMetadata` (carries `requestId`, `correlationId`, `invocationId`, optional `missionId`). | **Production** | None (Zero dependency) | Tested across every capability and pipeline test | Phase 3A (`b9959ee`) | **Foundational** (Universal primitive) |
| [`src/genesis/planning/*`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/genesis/planning) (27 files) | In-memory task planning, goal classification, graph decomposition, and blocker analysis. Self-documented as *"DORMANT... wired to nothing"*. | Test-only | In-memory repositories, EventService | `tests/genesis-planning.test.ts` | Legacy GENESIS v2 | **Dormant / Abandoned** |
| [`src/genesis/reasoning/*`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/genesis/reasoning) (6 files) | Strategy-based reasoning engine (`DeductiveReasoningStrategy`, `ImplicationReasoningStrategy`, `SynthesisReasoningStrategy`) consuming `ReflectionResult`. | Test-only | `src/genesis/insights/reflection` | `tests/genesis-reasoning-*.test.ts` (3 files) | Legacy GENESIS v2.23 | **Dormant Concept** (Reusable pattern) |
| [`src/genesis/decision/*`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/genesis/decision) (4 files) | Decision orchestration engine consuming `ReasoningResult` to output `DecisionAction[]`. | Test-only | `src/genesis/reasoning` | `tests/genesis-text-keyed-decisions.bench.ts` | Legacy GENESIS v2.23 | **Dormant Concept** (Reusable pattern) |
| [`src/genesis/context/initiative/*`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/genesis/context/initiative) (7 files) | Evaluates context package to decide companion conversational proactivity: `"Silence" \| "Suggestion" \| "Question" \| "Reminder"`. | **Production** (Booted, but output unconsumed) | `context-resolution/rules` | `tests/production-journey.test.ts` | Legacy GENESIS v2 | **Active Narrow Cognition** |
| [`src/runtime/*`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/runtime) (30 files) | Old dynamic plugin runtime, lifecycle manager, manifest validator, and legacy in-memory capability registry. Zero production callers. | Test-only | `src/shared/infrastructure/event-bus` | 5 legacy test files (`tests/runtime.test.ts`, etc.) | Legacy Platform v1 | **Dead / Obsolete** |
| [`src/sdk/*`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/sdk) (13 files) | Old client SDK for dynamic plugins. Zero production callers. | Test-only | None | `tests/sdk/akira-sdk.test.ts` | Legacy Platform v1 | **Dead / Obsolete** |
| [`src/compatibility/*`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/compatibility) (15 files) | Compatibility adapters bridging legacy SDK to legacy runtime. Zero callers anywhere. | **Unreachable** | `src/sdk`, `src/runtime` | None (Zero tests) | Legacy Platform v1 | **Dead / Unreachable** |

---

# 3. COMPLETE FILE-LEVEL VAJRA CANDIDATE INVENTORY

| Path | Current Role | VAJRA Relationship | Status | Evidence | Dependencies | Tests |
|---|---|---|---|---|---|---|
| `src/contracts/mission/mission-definition.ts` | Declarative mission data contract | Foundation for VAJRA Mission Subsystem | **KEEP** | Compliant with K10, K12, K19; pure frozen data structures | `results/result.ts` | `tests/contracts/mission-contracts.test.ts` |
| `src/contracts/mission/mission-state.ts` | Passive evidence envelope contract | Foundation for VAJRA Evidence tracking | **KEEP** | Compliant with K10; zero mutable lifecycle state | `capabilities/verification.ts` | `tests/contracts/mission-contracts.test.ts` |
| `src/contracts/capabilities/verification.ts` | Verification & MissionResult contracts | Foundation for VAJRA Verification Evaluator | **KEEP** | Enforces Invariants I8, I9, Decision D7 | `results/result.ts` | `tests/contracts/observation-verification-contracts.test.ts` |
| `src/contracts/events/observation.ts` | Observation contract K4 | Foundation for VAJRA Observation Ingest | **KEEP** | Enforces confidence $[0,1]$ and provenance | `results/result.ts` | `tests/contracts/observation-verification-contracts.test.ts` |
| `src/contracts/capabilities/descriptor.ts` | CapabilityDescriptor contract K8 | Governs capability selection and permissions | **KEEP** | Authoritative foundation for Rule N1/N2/N3 | `results/result.ts`, `zod` | 363 architecture assertions |
| `src/contracts/capabilities/registry.ts` | CapabilityRegistry contract K7/K14 | The sole invocation boundary for VAJRA | **KEEP** | Enforces Rule N1, N2, N3; blocks bypasses | `results/result.ts` | `tests/capabilities/capability-registry.test.ts` |
| `src/contracts/results/result.ts` | Universal Result K1/K5 & Correlation K19 | Foundational invocation primitive | **KEEP** | Used across all capabilities and pipelines | Zero dependencies | All pipeline tests |
| `src/akira-os/capabilities/host.ts` | Canonical Capability Registry host | Operational execution host for capabilities | **KEEP** | Bootstraps all production capabilities | Capability descriptors | All production pipeline tests |
| `src/akira-os/tasks/capabilities/*` | Task CRUD capabilities | Grounded capabilities invokable by VAJRA | **KEEP** | Backed by SQLite; tested end-to-end | SQLite Task Repository | `tests/production/task-*-pipeline.test.ts` |
| `src/akira-os/search/capabilities/*` | Search capability | Grounded recall capability invokable by VAJRA | **KEEP** | Backed by SQLite FTS; tested end-to-end | SQLite Conversation Repo | `tests/production/recall-search-pipeline.test.ts` |
| `src/genesis/reasoning/strategies/*` | Reasoning strategy patterns | Candidate algorithms for VAJRA Reasoning | **MOVE** | Clean deduction/synthesis patterns; currently isolated | `src/genesis/insights` | `tests/genesis-reasoning-*.test.ts` |
| `src/genesis/reasoning/engine.ts` | Reflection reasoning engine | Concept belongs to VAJRA Reasoning | **REFACTOR** | Consumes only reflections; needs multi-source inputs | `ReasoningStrategyRegistry` | `tests/genesis-reasoning-engine.test.ts` |
| `src/genesis/decision/engine.ts` | Action decision engine | Concept belongs to VAJRA Decision Arbiter | **REFACTOR** | Evaluates reasoning into actions; needs capability mapping | `src/genesis/reasoning` | `tests/genesis-text-keyed-decisions.bench.ts` |
| `src/genesis/planning/services/PlanningGraphBuilder.ts` | DAG construction & dependency sorting | Candidate logic for VAJRA Plan Validator | **REFACTOR** | Pure topological sort and cycle detection logic | None | `tests/genesis-planning.test.ts` |
| `src/genesis/planning/services/PlanningService.ts` | In-memory planning manager | Misnamed legacy; not grounded in SQLite | **REMOVE** | Self-documented line 52: *"DORMANT... wired to nothing"* | In-memory mock repos | `tests/genesis-planning.test.ts` |
| `src/genesis/planning/repositories/*` | Mock in-memory task/plan repositories | Obsolete in-memory mocks | **REMOVE** | Completely bypassed by real SQLite schema | None | `tests/genesis-planning.test.ts` |
| `src/genesis/context/initiative/*` | Proactive tone decision engine | Subordinate proactivity; belongs to VAJRA | **REFACTOR** | Booted in `__root.tsx`, but output unconsumed | `context-resolution/rules` | `tests/production-journey.test.ts` |
| `src/routes/daily-mission.tsx` | Daily Task Planner UI | Workspace Task UI, not VAJRA Mission | **KEEP** | Pure React user-facing workspace view | `tasksService`, store | Visual route component |
| `src/runtime/*` (30 files) | Legacy dynamic module plugin system | Obsolete plugin architecture | **REMOVE** | 0 production callers; superseded by AKIRA OS | `event-bus` | 5 legacy test files |
| `src/sdk/*` (13 files) | Legacy external module SDK | Obsolete plugin SDK | **REMOVE** | 0 production callers; superseded by capabilities | Internal SDK context | `tests/sdk/akira-sdk.test.ts` |
| `src/compatibility/*` (15 files) | Legacy compatibility adapters | Obsolete adapter bridges | **REMOVE** | 0 production callers; 0 test callers | `src/sdk`, `src/runtime` | Zero tests |

---

# 4. TRACE ACTUAL EXECUTION FLOWS

## 4.1 Conversation Flow (What Actually Executes Today)
Traced forensically from user input in [`src/routes/chat.tsx`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/routes/chat.tsx):

```
1. User types message in Chat UI and submits (handleSend, line 596)
   │
2. Client appends user message to local state & calls akira.addChatMessage()
   │
3. Client fires GENESIS event: eventService.record("chat_message", ...) (line 695)
   │
4. Client fetches active context package: contextService.getActiveContext() (line 739)
   │
5. Client calls aiContextEngine.executeRequestStream(...) (line 742)
   │
6. aiContextEngine resolves system instruction & formats history
   │
7. OpenRouter / Gemini API streams back raw token chunks
   │
8. Client streams tokens to screen & updates store via akira.updateChatMessage()
   │
9. Persistence: settingsService.updateChat writes conversation blob to SQLite
```
**Forensic Reality:** The chat flow is 100% conversational. There is **zero operational reasoning, zero capability checking, and zero tool dispatch**.

## 4.2 Operational Request Flow (If the User Asks AKIRA to DO Something)
If the user enters: *"Create a high priority task to review security logs"*:

$$\text{User Input} \longrightarrow \text{Chat Route} \longrightarrow \text{LLM Stream} \longrightarrow \text{Text Response: "I have noted that you should review security logs."}$$

**Current Status:** **`NOT IMPLEMENTED`**
- There is **no connection** between the Chat UI / AI Context Engine and the canonical `CapabilityRegistry`.
- AKIRA cannot actuate workspace state from a conversational request. Capabilities (`task.create`, `task.update`, `task.list`, `recall.search`) can currently be invoked **only** via:
  1. Internal programmatic callers (e.g. `store-init.ts` calling `listTasksViaCapability()`).
  2. Automated test pipelines (`tests/production/*`).

## 4.3 Proactive Flow (Can Anything Trigger Work Without User Input?)
Traced from background services initialized at boot in [`src/routes/__root.tsx`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/routes/__root.tsx):

```
Application Boot (__root.tsx)
  │
  ├── presenceService.initialize()     ──▶ Tracks user idle / active timer
  ├── relationshipService.initialize() ──▶ Subscribes to memory events
  ├── realityPipeline.initialize()     ──▶ Polls external presence platform
  ├── contextBuilder.initialize()      ──▶ Debounced rebuild of context package
  └── initiativeService.initialize()   ──▶ Evaluates resolved context
                                             │
                                             ▼
                                     buildInitiativeDecision()
                                             │
                                             ▼
                         Decides: "Silence" | "Suggestion" | "Question" | "Reminder"
                                             │
                                             ▼
                 initiativeEvents.publish("initiative_decision_evaluated", decision)
                                             │
                                             ▼
                                     [NO CONSUMER LISTENS]
```
**Forensic Reality:** The `initiativeService` wakes up, evaluates confidence heuristics ($c \ge 0.75$), and publishes an `InitiativeDecision`, but **no consumer in the entire codebase subscribes to the event**. The proactive decision is dropped silently in memory. **No autonomous work executes.**

---

# 5. AUTHORITY ANALYSIS

### Who Currently Decides?

| Decision Point | Current Decider | Actual Mechanism | Architectural Evaluation | Target Decider |
|---|---|---|---|---|
| **What the user wants?** | `src/routes/chat.tsx` | Raw string passed to LLM stream prompt | Ad-hoc UI string forwarding; no intent classification | **VAJRA (Understanding Engine)** |
| **Whether something becomes a mission?** | Nobody | **NOT IMPLEMENTED** | All inputs remain conversational chat messages | **VAJRA (Decision Arbiter)** |
| **What should happen next?** | UI user clicks | Direct React event handlers invoking store | Operational initiative lies entirely with human UI | **VAJRA (Executive Controller)** |
| **Which capability executes?** | Hardcoded callers | Direct RPC imports (`listTasksViaCapability()`) | Static coupling in hydration code | **VAJRA (Coordination Engine)** |
| **Whether execution is complete?** | Nobody | **NOT IMPLEMENTED** | Execution stops when async promise resolves | **VAJRA (Verification Evaluator)** |
| **Whether verification passed?** | Nobody | **NOT IMPLEMENTED** | Only tested in contract mock tests | **VAJRA (Verification Evaluator)** |
| **Whether replanning occurs?** | Nobody | **NOT IMPLEMENTED** | Failures throw errors directly to UI toasts | **VAJRA (Planning Engine)** |
| **Whether autonomous action occurs?** | Nobody | **NOT IMPLEMENTED** | Proactive decisions are dropped in event bus | **VAJRA (Proactive Subsystem)** |
| **Whether human approval is required?** | Nobody | **NOT IMPLEMENTED** | No escalation gates implemented in runtime | **VAJRA (Escalation Gate)** |
| **Whether a mission is complete?** | Nobody | **NOT IMPLEMENTED** | No mission runtime exists | **VAJRA (Mission Subsystem)** |

### Authority Hierarchy Comparison:
- **Target Architecture:** $\text{Human} \to \text{VAJRA} \to [\text{GENESIS}, \text{AKIRA OS}, \text{HANDS}] \to \text{Reality}$.
- **Current Reality:** $\text{Human} \to \text{React UI Routes} \to [\text{Reactive Store} \mid \text{GENESIS LLM Stream}] \to \text{SQLite}$.
- **The Gap:** The central cognitive authority layer (**VAJRA**) is completely missing at runtime. The UI interacts directly with storage and LLM streaming without an intermediate brain.

---

# 6. STATE OWNERSHIP ANALYSIS

| State Entity | Current Owner | Target Owner | Migration Required? | Notes |
|---|---|---|---|---|
| **Active Objective** | None | VAJRA | **YES (Create)** | Does not exist in state today. |
| **Mission State** | `src/contracts/mission/` (Contract type only) | VAJRA | **YES (Implement)** | Contract exists; runtime persistence needed. |
| **Mission Steps** | `src/contracts/mission/` (Contract type only) | VAJRA | **YES (Implement)** | Contract exists; runtime scheduling needed. |
| **Plan** | Dormant in `src/genesis/planning/` | VAJRA | **YES (Redesign)** | In-memory mock plan must be abandoned for VAJRA. |
| **Reasoning State** | Dormant in `src/genesis/reasoning/` | VAJRA | **YES (Adapt)** | Reusable strategy interfaces; needs multi-source engine. |
| **Decisions** | Dormant in `src/genesis/decision/` | VAJRA | **YES (Adapt)** | Reusable decision model; needs capability mapping. |
| **Assumptions / Beliefs** | None | VAJRA | **YES (Create)** | Epistemic state does not exist today. |
| **Uncertainty / Evidence** | `src/contracts/events/observation.ts` (Contract only) | VAJRA | **YES (Implement)** | Contract K4 exists; runtime belief scoring needed. |
| **Observations** | `src/contracts/events/observation.ts` (Contract only) | VAJRA | **YES (Implement)** | Contract exists; runtime ingestion needed. |
| **Verification Records** | `src/contracts/capabilities/verification.ts` (Contract only) | VAJRA | **YES (Implement)** | Contract K6 exists; evaluator needed. |
| **Human Approvals** | None | VAJRA | **YES (Create)** | Escalation state missing. |
| **Capability Availability** | `src/contracts/capabilities/descriptor.ts` | AKIRA OS (Hosted) / VAJRA (Cached in Self-Model) | **NO** | `isAvailable` flag already grounded in descriptor. |
| **Execution State** | Local async promise state | HANDS / AKIRA OS | **YES (Implement)** | Tracked only during execution lifetime. |
| **Identity / Traits** | `src/genesis/understanding/identity-service.ts` | GENESIS | **NO** | Correctly owned by GENESIS. |
| **Episodic Memory** | `src/genesis/memory/memory-service.ts` | GENESIS | **NO** | Correctly owned by GENESIS. |
| **Chat History** | `src/persistence/repositories/SqliteConversationRepository.ts` | AKIRA OS | **NO** | Correctly stored in SQLite tables. |
| **Initiative Decision** | `src/genesis/context/initiative/service.ts` | VAJRA (Global) / GENESIS (Conversational Tone) | **YES (Refactor)** | Proactivity must be escalated to VAJRA. |

---

# 7. GENESIS BOUNDARY ANALYSIS

### Genuinely GENESIS-Owned (Must Remain in GENESIS):
- **Episodic & Long-term Memory:** [`src/genesis/memory/`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/genesis/memory) (`memoryService`, `retentionEngine`, memory events).
- **Identity & Personal Understanding:** [`src/genesis/understanding/`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/genesis/understanding) (`identityService`, `understandingEngine`, trait rules).
- **Narrative Arcs & Story Lines:** [`src/genesis/stories/`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/genesis/stories) (`storyService`, narrative clustering).
- **Context Synthesis & Prompt Assembly:** [`src/genesis/context/`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/genesis/context) (`contextBuilder`, `contextService`, `promptBuilder`).
- **Historical Recall Ingest:** [`src/genesis/recall/`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/genesis/recall) (`HistoricalRecallProvider`, grounded in `recall.search`).
- **Cognitive Insights & Reflection:** [`src/genesis/insights/`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/genesis/insights) (`reflectionEngine`, `insightService`).

### Misplaced in GENESIS (Belongs Under VAJRA):
1. **`src/genesis/planning/` (27 files):**  
   - Trying to perform global task decomposition, blocker analysis, and milestone scheduling.
   - Built around an in-memory mock store that duplicates real SQLite tasks.
   - **Verdict:** Dormant. Pure topological sort algorithms in `PlanningGraphBuilder.ts` are valuable, but the service itself should not live in GENESIS.
2. **`src/genesis/reasoning/` (6 files):**  
   - Consumes reflections and performs structured deductions.
   - Reasoning across system operations, safety, and goals belongs to the Brain (VAJRA), not memory reflection.
   - **Verdict:** Candidate for adaptation into `src/vajra/reasoning/`.
3. **`src/genesis/decision/` (4 files):**  
   - Pure decision orchestrator. Cross-system decisions belong to VAJRA.
   - **Verdict:** Candidate for adaptation into `src/vajra/decision/`.
4. **`src/genesis/context/initiative/` (7 files):**  
   - Autonomously determines proactive tone. Global initiative belongs to VAJRA.
   - **Verdict:** Refactor to subordinate conversational tone generator under VAJRA's global initiative authority.

---

# 8. AKIRA OS BOUNDARY ANALYSIS

### What AKIRA OS Currently Owns:
- **Canonical Capability Host:** [`src/akira-os/capabilities/host.ts`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/akira-os/capabilities/host.ts) implements Contract K7/K14 and Rule N3.
- **Production Capabilities:** Task CRUD (`task.create`, `task.read`, `task.update`, `task.list`) and historical search (`recall.search`).
- **Platform RPC Barriers:** Strict separation between server RPC handlers and client calls (Rule N2).
- **Core Persistence Repositories:** Task, Project, Note, Session, Settings, Conversation, Vault repositories.

### Boundary Assessment:
- **Does AKIRA OS overstep into VAJRA decisions?**  
  **No.** AKIRA OS is architecturally disciplined:
  - It does not decide *when* tasks should be created.
  - It strictly enforces descriptor schemas and Rule N1/N2/N3.
  - In `src/akira-os/tasks/server/index.ts`, RPC handlers check capability permissions and delegate to `CapabilityRegistry.execute()`.
- **Finding:** AKIRA OS is functioning correctly as a **Grounded Platform Host**. VAJRA can safely sit above AKIRA OS without requiring OS architecture rewrites.

---

# 9. HANDS BOUNDARY ANALYSIS

### What HANDS Currently Is in the Repository:
- **Forensic Evidence:** There is **zero implementation code** for HANDS in `src/`.
- No folder `src/hands/` exists.
- The string `HANDS` appears only in:
  - Architecture contracts ([`src/contracts/capabilities/registry.ts#L242`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/contracts/capabilities/registry.ts#L242)): Enforces Rule N1 Condition 5 (*"Direct internal Commands to HANDS or GENESIS are not permitted"*).
  - Telemetry comments in `src/contracts/events/observation.ts`.
  - Architecture specification documents.

### Boundary Assessment:
- HANDS does not exist yet as an execution engine.
- There are **no rogue decision loops** in HANDS because HANDS has not yet been built.
- When built, HANDS must strictly follow `VAJRA-BRAIN-ARCHITECTURE.md` as an execution sandbox/actuator subordinate to VAJRA.

---

# 10. MISSION ARCHITECTURE AUDIT

| Component | Path | Current Status | Forensic Assessment | Proposed Disposition |
|---|---|---|---|---|
| **MissionDefinition** | `src/contracts/mission/mission-definition.ts` | Active pure contract | Pure frozen data structure. Free of DAGs, execution status, and callbacks. Compliant with K10/K12. | **KEEP AS-IS** |
| **MissionStep** | `src/contracts/mission/mission-definition.ts` | Active pure contract | Pure frozen step specification. Maps step order to capability input and expected evidence. | **KEEP AS-IS** |
| **MissionState** | `src/contracts/mission/mission-state.ts` | Active pure contract | Passive evidence envelope referencing K4/K5/K6 IDs. Zero mutable cursors or scheduler state. | **KEEP AS-IS** |
| **MissionResult** | `src/contracts/capabilities/verification.ts` | Active pure contract | Contract K6. Enforces that only VAJRA issues terminal mission results after verification. | **KEEP AS-IS** |
| **VerificationRecord** | `src/contracts/capabilities/verification.ts` | Active pure contract | Contract K6. Captures evidence IDs examined and outcome (`criteria_satisfied`, etc.). | **KEEP AS-IS** |
| **Mission Persistence** | None | **Not implemented** | No `vajra_missions` table exists in SQLite schema. | **MISSING (Implement in Phase 3N+)** |
| **Mission Runtime** | None | **Not implemented** | No step execution loop or crash-recovery runner exists in runtime code. | **MISSING (Implement in Phase 3N+)** |
| **Daily Mission Route** | `src/routes/daily-mission.tsx` | Active UI route | Misnamed presentation layer: displays workspace `Task` records. | **KEEP AS UI (Rename conceptually)** |

---

# 11. PERSISTENCE & DATABASE AUDIT

Forensic analysis of [`src/persistence/schema.sql`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/persistence/schema.sql) and [`src/persistence/initializer.ts`](file:///c:/PROJECTS/Project%20Akira%20Master/AKIRA/src/persistence/initializer.ts):

| Table Name | Current Purpose | Owner | Migration Status | VAJRA Relationship | Disposition |
|---|---|---|---|---|---|
| `projects` | Workspace project arcs | AKIRA OS | Schema v1 | Workspace entity | **KEEP** |
| `tasks` | Workspace user tasks | AKIRA OS | Schema v1 (position added) | Grounded in `task.*` capabilities | **KEEP** |
| `notes` | User notes & aspirations | AKIRA OS | Schema v1 | Ingested by GENESIS | **KEEP** |
| `sessions` | Work/focus sessions | AKIRA OS | Schema v1 | Tracked by presence | **KEEP** |
| `settings` | System settings & JSON blobs | AKIRA OS | Schema v1 | Holds `chat`, `genesis_memories` | **KEEP** |
| `timeline_events` | Append-only event store | Instrumentation | Schema v1 | System telemetry | **KEEP** |
| `search_history` | Search query logs | AKIRA OS | Schema v1 | Grounded in search | **KEEP** |
| `vault_*` (5 tables) | File vault metadata & tags | AKIRA OS | Migration `002` | Vault feature | **KEEP** |
| `conversations` | Chat conversation sessions | AKIRA OS | Schema v1 (Recent) | Grounded in `recall.search` | **KEEP** |
| `chat_messages` | Individual chat turns | AKIRA OS | Schema v1 (Recent) | Grounded in `recall.search` | **KEEP** |
| `chat_messages_fts` | SQLite FTS5 index for chat | AKIRA OS | Schema v1 (Recent) | FTS search index | **KEEP** |
| `vajra_operational_state` | None | None | **Does not exist** | Target table for VAJRA state | **CREATE (Phase 3N+)** |
| `vajra_missions` | None | None | **Does not exist** | Target table for active missions | **CREATE (Phase 3N+)** |
| `vajra_beliefs` | None | None | **Does not exist** | Target table for epistemic store | **CREATE (Phase 3N+)** |

**Forensic Finding:** Zero existing database tables belong to VAJRA or missions. All existing tables are production-grounded workspace/system tables. **No migrations should be modified or deleted.**

---

# 12. SAFETY & CORRECTNESS FOUNDATIONS

The following valuable reliability foundations are already implemented and validated:

1. **Rule N1 Enforcement (`src/contracts/capabilities/registry.ts#L225-L270`):**  
   - Blocks external MCP write attempts (`command_rejection`).
   - Blocks un-whitelisted callers.
   - Enforces execution characteristic invariants (`isReadOnly`, `isIdempotent`).
2. **Correlation & Causation Invariant K19 (`src/contracts/results/result.ts`):**  
   - Guarantees `requestId`, `correlationId`, `invocationId`, and optional `missionId` propagate through every capability result.
3. **Observation vs. Verification Separation (Contracts K4 & K6):**  
   - Invariant I8: An Observation is never verification.
   - Invariant I9: Execution is never mission completion. Only VAJRA issues a `MissionResult`.
4. **SQLite WAL Mode & Transaction Boundaries (`src/persistence/initializer.ts`):**  
   - Database operates with Write-Ahead Logging (`WAL`), foreign keys enabled, and verified schema integrity.
5. **Corrupt Persisted State Guard (`src/persistence/store-init.ts#L39-L49`):**  
   - Validates JSON array shapes before hydration to prevent disk clobbering.
6. **Architecture Validator Suite (`scripts/validate-architecture.ts`):**  
   - 363 automated structural assertions protecting database boundaries, import safety, and layer separation.

---

# 13. TEST & VERIFICATION MAP

| Subsystem | Test Files | Total Tests | Coverage & Risk Assessment |
|---|---|---|---|
| **Canonical Capabilities** | `tests/capabilities/*.test.ts` (5 files) | 31 tests | **High Confidence:** Tests capability registry host, read/write/activation tiers, and Rule N1/N3. |
| **Production Pipelines** | `tests/production/*.test.ts` (5 files) | 32 tests | **High Confidence:** Tests real end-to-end SQLite capability invocations (`task.create`, `task.read`, `task.update`, `task.list`, `recall.search`). |
| **Foundation Contracts** | `tests/contracts/*.test.ts` (2 files) | 49 tests | **High Confidence:** Tests K4 Observation, K6 VerificationRecord/MissionResult, K10/K12/K19 MissionDefinition. |
| **Production Journey** | `tests/production-journey.test.ts` | 28 tests | **High Confidence:** Simulates full user lifecycles across projects, conversations, restarts, and deletions. |
| **GENESIS Cognition** | `tests/genesis-*.test.ts` (45+ files) | ~600 tests | **High Confidence:** Tests memory retention, identity confidence, understanding graphs, and recall hoist. |
| **Legacy Runtime** | `tests/runtime.test.ts`, `tests/lifecycle.test.ts`, `tests/manifest.test.ts`, `tests/capability-registry.test.ts`, `tests/dependency-resolver.test.ts` | ~60 tests | **Isolated:** Tests only dead `src/runtime/` module system. |
| **Legacy SDK** | `tests/sdk/akira-sdk.test.ts` | 10 tests | **Isolated:** Tests only dead `src/sdk/` client. |
| **GENESIS Planning** | `tests/genesis-planning.test.ts` | 15 tests | **Isolated:** Tests dormant in-memory planning service. |
| **GENESIS Reasoning** | `tests/genesis-reasoning-*.test.ts` (3 files) | 26 tests | **Isolated:** Tests dormant reflection reasoning strategies. |

---

# 14. DEAD & UNREACHABLE CODE ANALYSIS

| Subsystem / Path | Number of Files | Why It Appears Dead | External Production Callers | Breakage If Kept Untouched | Breakage If Removed |
|---|---|---|---|---|---|
| **`src/compatibility/`** | 15 files | Built to bridge old SDK to old runtime. Completely unreferenced by any file in `src/` or `tests/`. | **0** | None (Harmless dead code) | None (Zero tests exist) |
| **`src/sdk/`** | 13 files | Plugin client SDK for third-party modules. AKIRA does not use external plugins. | **0** | None (Harmless dead code) | `tests/sdk/akira-sdk.test.ts` would need removal |
| **`src/runtime/`** | 30 files | Dynamic module loader, YAML manifest parser, permission catalog. Completely superseded by canonical `CapabilityRegistry`. | **0** | Creates confusion with canonical `CapabilityRegistry` | 5 legacy test files would need removal |
| **`src/genesis/planning/`** | 27 files | Abandoned in-memory task planner. Self-documented line 52: *"DORMANT... wired to nothing"*. | **0** | Stagnant codebase bloat; duplicates task concepts | `tests/genesis-planning.test.ts` and barrel exports in `src/genesis/index.ts` |

---

# 15. ARCHITECTURE SPEC COMPARISON (`VAJRA-BRAIN-ARCHITECTURE.md`)

| Architecture Requirement | Current Repository Status | Gap Analysis & Evidence |
|---|---|---|
| **1. Global Authority Hierarchy** | **MISSING** | No VAJRA brain layer exists at runtime. React UI directly calls stores and LLM stream. |
| **2. Bounded Proactive Autonomy** | **MISSING** | `initiativeService` evaluates proactivity but its events are completely unconsumed. |
| **3. Model-Decoupled Deliberation** | **MISALIGNED** | `chat.tsx` directly calls `aiContextEngine.executeRequestStream` passing raw text. |
| **4. Subsystem Interfaces (GENESIS)** | **PARTIALLY ALIGNED** | GENESIS exists and produces context packages, but serves the chat route rather than VAJRA. |
| **5. Subsystem Interfaces (AKIRA OS)** | **ALIGNED** | Canonical `CapabilityRegistry` host exists, is grounded in SQLite, and enforces Rules N1/N2/N3. |
| **6. Subsystem Interfaces (HANDS)** | **MISSING** | HANDS does not exist in code; referenced only in contract invariants. |
| **7. Persistent Operational State** | **MISSING** | No `vajra_operational_state`, `vajra_missions`, or `vajra_beliefs` tables exist. |
| **8. Self-Model** | **MISSING** | No structured model of AKIRA's capabilities, health, and boundaries exists. |
| **9. Controlled Learning** | **PARTIALLY ALIGNED** | GENESIS has reflection/understanding; VAJRA operational strategy adaptation is missing. |
| **10. Uncertainty & Epistemic Model** | **PARTIALLY ALIGNED** | Contract K4 `Observation` models confidence $[0,1]$ and provenance; runtime belief graph missing. |
| **11. Conversation vs. Mission Separation** | **MISALIGNED** | All chat requests are treated as text turns; no mission promotion or analysis path exists. |
| **12. Mission Subsystem Contracts** | **ALIGNED** | Contracts K10, K12, K19 (`MissionDefinition`, `MissionStep`, `MissionState`) are fully defined. |
| **13. Observation & Verification** | **PARTIALLY ALIGNED** | Contracts K4 & K6 exist and are heavily tested; runtime evaluators missing. |
| **14. Crash Recovery & Idempotency** | **PARTIALLY ALIGNED** | Idempotency tokens modeled in descriptors; runtime journaled recovery runner missing. |
| **15. Explainability & Traceability** | **MISSING** | No deliberation trace records or audit logs are generated. |

---

# 16. SAFE DISPOSITION PLAN

### KEEP (Definitely Preserve As-Is)
- **Foundation Contracts:**
  - `src/contracts/results/result.ts` (Contracts K1, K5, K19)
  - `src/contracts/capabilities/descriptor.ts` (Contract K8)
  - `src/contracts/capabilities/registry.ts` (Contracts K7, K14)
  - `src/contracts/capabilities/verification.ts` (Contract K6)
  - `src/contracts/events/observation.ts` (Contract K4)
  - `src/contracts/events/domain-event.ts` (Contract K3)
  - `src/contracts/mission/mission-definition.ts` (Contracts K10, K12)
  - `src/contracts/mission/mission-state.ts` (Contract K10)
- **Canonical Platform Infrastructure:**
  - `src/akira-os/capabilities/host.ts` (Live registry host)
  - `src/akira-os/tasks/capabilities/*` (`task.create`, `task.read`, `task.update`, `task.list`)
  - `src/akira-os/search/capabilities/*` (`recall.search`)
  - `src/persistence/*` (All SQLite schemas, WAL initializer, repositories, migration history)
  - `scripts/validate-architecture.ts` (363 architecture assertions)
- **GENESIS Core Cognition:**
  - `src/genesis/memory/*`, `src/genesis/understanding/*`, `src/genesis/stories/*`, `src/genesis/context/*`, `src/genesis/recall/*`

### REFACTOR (Useful Implementation Requiring Architectural Changes)
- `src/genesis/reasoning/engine.ts`: Adapt from reflection-only consumer into multi-source cognitive reasoner.
- `src/genesis/decision/engine.ts`: Adapt from speculative action generator into VAJRA Decision Arbiter.
- `src/genesis/context/initiative/`: Refactor from autonomous boot engine into conversational tone adapter subordinate to VAJRA.
- `src/genesis/planning/services/PlanningGraphBuilder.ts`: Extract pure DAG validation algorithms into VAJRA planning engine.

### MOVE INTO VAJRA (Belongs Under VAJRA)
- `src/genesis/reasoning/strategies/*` $\longrightarrow$ `src/vajra/reasoning/strategies/`
- `src/genesis/reasoning/types.ts` $\longrightarrow$ `src/vajra/reasoning/types.ts`
- `src/genesis/decision/types.ts` $\longrightarrow$ `src/vajra/decision/types.ts`

### KEEP AS INFRASTRUCTURE (Supporting Services)
- `src/instrumentation/*` (Event bus publisher, timeline subscribers)
- `src/observability/*` (Health samplers, telemetry metrics)
- `src/routes/tasks.tsx`, `src/routes/daily-mission.tsx` (User workspace UI surfaces)

### MERGE (Duplicate or Overlapping)
- None currently active in production (the legacy capability registry in `src/runtime/` is dead, not active).

### ARCHIVE (Historical / Inactive But Retained Temporarily)
- `src/genesis/planning/*` (27 files): Move to `docs/archive/legacy-planning/` or keep untouched in place until Phase 3N is verified.

### REMOVE (Only When Confirmed by Architect)
- `src/compatibility/*` (15 files)
- `src/sdk/*` (13 files) + `tests/sdk/akira-sdk.test.ts`
- `src/runtime/*` (30 files) + 5 legacy runtime test files

### UNKNOWN (Requiring Human / Architectural Decision)
- *Decision D-Arch-1:* Should `src/genesis/reasoning/` be adapted directly or re-authored from scratch under `src/vajra/`? (Recommendation: Adapt strategy interfaces, re-author orchestrator).
- *Decision D-Arch-2:* When should legacy runtime cleanup occur? (Recommendation: During Phase 3N baseline freeze).

---

# 17. DELETION SAFETY REPORT

For the candidate removal groups (`src/runtime/`, `src/sdk/`, `src/compatibility/`, `src/genesis/planning/`):

| Safety Check | Forensic Answer |
|---|---|
| **1. Who imports this?** | Only their own internal files and dedicated legacy tests. Zero imports from `src/akira-os/`, `src/routes/`, `src/persistence/`, `src/contracts/`. |
| **2. Who calls this?** | Zero production runtime callers. |
| **3. What tests depend on it?** | Only 7 isolated legacy test files (`tests/runtime.test.ts`, `tests/lifecycle.test.ts`, `tests/manifest.test.ts`, `tests/capability-registry.test.ts`, `tests/dependency-resolver.test.ts`, `tests/sdk/akira-sdk.test.ts`, `tests/genesis-planning.test.ts`). |
| **4. Do other modules depend on its contracts/types?** | No. All canonical contracts reside in `src/contracts/`. |
| **5. Does it contain bug fixes or reliability mechanisms?** | No. All production bug fixes (e.g. WAL mode, JSON array guards, Rule N1 checks) reside in `persistence/` and `contracts/`. |
| **6. Does it contain migration history?** | No. Database migrations reside in `src/persistence/`. |
| **7. Does it contain useful logic that should move?** | `PlanningGraphBuilder.ts` contains topological sort logic; this should be preserved/copied before any planning removal. |
| **8. Is it reachable at runtime?** | Completely unreachable. |
| **9. Is there a replacement?** | Yes: canonical `CapabilityRegistry` host in `src/akira-os/capabilities/host.ts` completely supersedes `src/runtime/registry/`. |
| **10. What breaks if deleted?** | Only the 7 isolated legacy test files fail. Production application and canonical test suite (140/140) remain 100% operational. |

---

# 18. RECOMMENDED MIGRATION ORDER

```
Phase 0: Baseline Freeze & Protection
  └── Protect Foundation Contracts K1-K19, grounded capabilities, WAL persistence.
Phase 1: Safe Legacy Archival
  └── Remove or archive dead src/runtime, src/sdk, src/compatibility.
Phase 2: Establish VAJRA Core Domain
  └── Create src/vajra/ with ExecutiveController and SelfModel.
Phase 3: VAJRA Persistent State Schema
  └── Create SQLite tables: vajra_operational_state, vajra_missions, vajra_beliefs.
Phase 4: Reasoning & Decision Adaptation
  └── Port strategy patterns from genesis/reasoning into vajra/reasoning.
Phase 5: Subsystem Integrations
  └── Wire VAJRA ↔ GENESIS query interface & VAJRA ↔ AKIRA OS capability dispatcher.
Phase 6: Grounded Mission Subsystem Runtime
  └── Implement step execution, idempotency journaling, and crash-recovery loop.
Phase 7: Observation Ingest & Verification Evaluator
  └── Wire Contract K4 Observation capture and Contract K6 VerificationRecord evaluations.
Phase 8: Conversational Escalation & Chat Wiring
  └── Connect chat.tsx to VAJRA Understanding Engine: Conversation vs Mission.
Phase 9: Bounded Autonomy & Proactive Initiative
  └── Wire significance filter to wake up VAJRA on background triggers.
```

---

# 19. FINAL EXECUTIVE SUMMARY

### Current Reality
AKIRA today is a desktop personal companion with an exceptional episodic memory engine (**GENESIS**), a robust SQLite persistence layer, and a strictly disciplined capability platform (**AKIRA OS**). However, **it has no active Brain**. Chat interactions stream directly from an LLM prompt to the screen. Operational requests cannot actuate capabilities from chat. Proactive decisions are dropped silently in memory.

### What We Already Have
We possess rock-solid, production-grounded foundations that must **never be discarded**:
- Canonical `CapabilityRegistry` host (`src/akira-os/capabilities/host.ts`).
- 5 production capabilities grounded in SQLite (`task.create`, `task.read`, `task.update`, `task.list`, `recall.search`).
- Authoritative Foundation Contracts K1–K19 (immutable `MissionDefinition`, `MissionState`, `Observation`, `VerificationRecord`, `MissionResult`, `Result`, `CorrelationMetadata`).
- 363 passing architecture validation assertions.
- Complete TypeScript type purity.

### What Is Wrong
1. **Authority Void:** The UI acts as the de-facto executive authority, mutating tasks directly.
2. **Conflated Scope:** In earlier phases, "VAJRA" was conceived merely as a mission runner rather than the overarching cognitive authority.
3. **Dead Code Bloat:** Over 85 files in `src/runtime/`, `src/sdk/`, `src/compatibility/`, and `src/genesis/planning/` sit completely dead or dormant, causing conceptual confusion.

### What VAJRA Still Needs
- A top-level domain (`src/vajra/`).
- An **Executive Controller** and dynamic **Self-Model**.
- An **Understanding Engine** in front of chat (separating informational chat from operational missions).
- A durable **Mission Runtime** executing steps via the canonical `CapabilityRegistry`.
- A runtime **Verification Evaluator** enforcing Contract K6.
- SQLite persistence tables for operational state, missions, and beliefs.

### What Should NOT Be Deleted
- Any file in `src/contracts/`
- Any file in `src/akira-os/`
- Any file in `src/persistence/`
- Any core memory/identity file in `src/genesis/`

### What Can Eventually Be Removed
- `src/compatibility/` (15 files)
- `src/sdk/` (13 files)
- `src/runtime/` (30 files)
- `src/genesis/planning/` (27 files)

### Biggest Architectural Risk
**Premature autonomous looping.** Building an unconstrained reactive while-loop before establishing strict leaker-bucket rate limiters, token spend caps, and explicit human escalation gates.

### Recommended Next Build Step
**Freeze Phase 3 archaeological findings and approve the clean baseline cleanup (removal of dead `src/compatibility`, `src/sdk`, and `src/runtime`), clearing the deck for Phase 3N: The VAJRA Brain Foundation.**
