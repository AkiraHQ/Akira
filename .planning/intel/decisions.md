# Synthesized Decisions

## Architecture Decision Record: ADR-001 Workspace Canvas Shell
- source: docs/adr/ADR-001-workspace-shell.md
- status: locked (Accepted)
- decision: Create a global parent canvas shell (`Shell.tsx`) inside the framework layer (`src/app/shell/`). Individual routes mount as nested children inside the shell's `<main>` layout container. The Shell manages the sidebar navigation, top bar header, background glow elements, responsive behaviors, and command palettes centrally.
- scope: workspace, shell

## Architecture Decision Record: ADR-002 Dynamic Tool Registry
- source: docs/adr/ADR-002-tool-registry.md
- status: locked (Accepted)
- decision: Implement a centralized `toolsRegistry` in `src/akira-os/tools/registry.ts`. All tools register a schema mapping their paths, categories, ready states, and visibility restrictions. The sidebar queries this registry to build navigation links dynamically.
- scope: tool, registry

## Architecture Decision Record: ADR-003 SSR & RPC Serialization
- source: docs/adr/ADR-003-rpc-architecture.md
- status: locked (Accepted)
- decision: Use TanStack Start's `createServerFn` to build a serialization layer. All database mutations and queries run as server functions. The browser client calls these functions as standardized HTTP POST/GET requests. We enforce dynamic repository imports inside these handlers to prevent server-side imports from leaking into client files. ```typescript export const persistAddNote = createServerFn({ method: "POST" })   .validator((input: AddNoteInput) => input)   .handler(async ({ data: input }) => {     // Dynamic import isolates native DB packages     const { noteRepository } = await import("../../persistence/repositories");     return noteRepository.add(input);   }); ```
- scope: rpc, architecture

## Architecture Decision Record: ADR-004 Repository Pattern
- source: docs/adr/ADR-004-repository-pattern.md
- status: locked (Accepted)
- decision: Implement the Repository Pattern. We define abstract repository interfaces (e.g. `NoteRepository.ts`) inside `src/contracts/repositories/` to represent data tables, and create concrete SQL implementations (e.g. `SqliteNoteRepository.ts`) inside `src/persistence/repositories/`. Server functions interact only with these interface classes.
- scope: repository, pattern

## Architecture Decision Record: ADR-005 Container Layout
- source: docs/adr/ADR-005-container-layout.md
- status: locked (Accepted)
- decision: Support two distinct layout modes in the global `Shell` component via the `layoutMode` prop: 1.  **Scroll Mode (`layoutMode="scroll"`)**: The container height adjusts to its contents, and the main browser window handles scrolling. 2.  **Fit Mode (`layoutMode="fit"`)**: Clips the main view container to the viewport height (`h-[calc(100vh-11rem)]`) and disables browser-level scrolling, allowing individual child components to manage their own scroll states.
- scope: container, layout

## Architecture Decision Record: ADR-006 Module Contract
- source: docs/adr/ADR-006-module-contract.md
- status: locked (Accepted)
- decision: Enforce a standard layout for all modules in `src/akira-os/`: ``` components/  -> UI elements only hooks/       -> React hooks (useSyncExternalStore selectors) services/    -> Client-side entry points server/      -> Server functions (TanStack Start RPCs) repositories/-> SQLite operations only types/       -> TypeScript interfaces tests/       -> Vitest test suites index.ts     -> Public barrel export ``` We also enforce strict rules: UI files cannot import repository modules, and database operations must run server-side.
- scope: module, contract

## ADR-008: Event-Driven Timeline
- source: docs/adr/ADR-008-event-driven-timeline.md
- status: locked (Accepted)
- decision: We decouple the Timeline completely from all business modules by migrating it to be a pure, reactive subscriber on the newly introduced Instrumentation Event Bus. Key details: 1. Business modules publish strongly-typed events to the Event Bus. 2. We implement a dedicated `TimelineSubscriber` (`EventSubscriber` contract) that observes the event stream. 3. The subscriber handles mapping supported events to timeline records and writes them to SQLite via the `TimelineRepository`. 4. We completely remove obsolete timeline-logging database triggers (`trg_vault_files_insert_audit`, `trg_vault_files_delete_audit`) from the SQLite initialization schema.
- scope: event, driven, timeline

## ADR-009: Module Event Integration
- source: docs/adr/ADR-009-module-event-integration.md
- status: locked (Accepted)
- decision: We migrate all targeted business modules (Projects, Tasks, Notes, Sessions, Settings, Search, and Vault) to use the unified Instrumentation `publish` API: 1. **Direct Integration**: Replace legacy `eventBus.publish` calls with the direct client-safe `publish()` function from `src/instrumentation`. 2. **Server-Side RPC Bridging**: To avoid leakage of server-only database drivers (`better-sqlite3` and repository modules) to the client bundle, the client-side `publish()` function performs local validation and then broadcasts asynchronously via a server function RPC (`persistPublishEvent`) to save to SQLite on the server. 3. **Fact-Based Ordering**: Events are published only after persistence operations successfully complete in their respective repositories. 4. **Lightweight Payloads**: Payloads are restricted to lightweight JSON-serializable structures containing only essential domain data rather than full DB objects. 5. **Correlation ID preservation**: Modules maintain correlation context during sequential workflows (like starting and completing sessions).
- scope: module, event, integration

## ADR-010: Instrumentation Reliability
- source: docs/adr/ADR-010-instrumentation-reliability.md
- status: locked (Accepted)
- decision: We enforce the following stability and performance principles across the entire Event Subsystem:
- scope: instrumentation, reliability

## ADR-011: Analytics Architecture
- source: docs/adr/ADR-011-analytics-architecture.md
- status: locked (Accepted)
- decision: We enforce the following architectural patterns and constraints for the Analytics subsystem:
- scope: analytics, architecture

## ADR-012: Core Metrics Framework
- source: docs/adr/ADR-012-core-metrics-framework.md
- status: locked (Accepted)
- decision: We enforce the following architectural patterns for the Core Metrics framework:
- scope: core, metrics, framework

## ADR-013: Analytics Query Layer
- source: docs/adr/ADR-013-analytics-query-layer.md
- status: locked (Accepted)
- decision: We enforce the following architectural patterns for the Analytics Query Layer:
- scope: analytics, query, layer

## ADR-015: Analytics Subsystem Reliability & Self-Recovery
- source: docs/adr/ADR-015-analytics-reliability.md
- status: locked (Accepted)
- decision: We implement a three-tiered Reliability Framework inside `src/analytics/validation/`: 1.  **Historical Rebuild Manager (`RebuildManager`)**:     *   Exposes `.rebuildAll()` and `.rebuildIncremental()`.     *   Wipes derived metrics and re-aggregates events.     *   Persists progress metadata (`lastProcessedEventId`, `lastProcessedTimestamp`, `lastSuccessfulRebuild`, `schemaVersion`) inside a dedicated `analytics_state` table to enable resuming interrupted runs and doing incremental aggregations.     *   Wraps event parsing in fault-tolerant exception handlers. If the primary `EventRepository` fails to deserialize any event because of JSON corruption, the loader falls back to raw database row streams, isolating parse errors to the individual corrupted row. 2.  **Consistency Checker (`ConsistencyChecker`)**:     *   Exposes `.checkConsistency()`.     *   Scans raw events and computes expected metrics in-memory, comparing them directly against columns in `daily_metrics` and `project_metrics`.     *   Identifies mismatches (e.g. task count discrepancies, session duration mismatches, orphaned project metrics) and returns structured diagnostic reports. 3.  **Structural Diagnostics (`AnalyticsValidator` & `DiagnosticsService`)**:     *   Exposes `.validateDatabase()` and `.validateDashboardDTO()`.     *   Performs database integrity checks (table columns, negative values, out-of-bounds metrics) and validates runtime dashboard payloads.     *   Aggregates health status into `HEALTHY`, `DEGRADED` (for value mismatches), or `UNHEALTHY` (for structural database errors).
- scope: analytics, reliability

## ADR-016: Platform Runtime Module Core
- source: docs/adr/ADR-016-platform-runtime.md
- status: locked (Accepted)
- decision: We will establish a centralized **Platform Runtime Core** to orchestrate module execution.  Key decisions: 1. **Modules as Managed Runtime Objects**: Every module is represented at runtime by a `ModuleInstance` wrapper. A module is no longer simply static code; it has an active lifecycle state, unique runtime configurations, and dedicated resource boundaries. 2. **Centralized Lifecycle Management**: All transitions (loading, starting, pausing, resuming, stopping, and unloading) are managed by `RuntimeManager` and validated against a deterministic state transition matrix. This prevents race conditions and dangling resources. 3. **Dependency Injection via Context**: Modules are isolated from global platform references. Shared platform resources (like logger, eventBus, and configuration settings) are explicitly injected through a lightweight `ModuleContext` object during startup. 4. **Resilient Initialization (Fault Isolation)**: If a module fails to load or throw an exception during its startup routine, it is marked as `FAILED` (and cleaned up to `UNLOADED`). The runtime catches the failure, logs detailed diagnostics, and continues booting other modules. A single module failure must never block the platform.
- scope: platform, runtime

## ADR-017: Module Manifest System
- source: docs/adr/ADR-017-module-manifest.md
- status: locked (Accepted)
- decision: We will enforce a standardized **Module Manifest System** for all AKIRA OS modules. Key decisions: 1. **Self-Describing Declarations**: Modules must package a `manifest.yaml` or `manifest.json` file in their root folder declaring metadata, routes, capability claims, events, and entry-points. 2. **Pre-Load Parsing & Validation**: The `RuntimeManager` will discover, read, and validate the manifest file *before* dynamic import executes. If validation fails (e.g. invalid version, duplicate routes, unknown keys), the module is rejected and marked `FAILED` immediately, without importing any source files. 3. **Strict Validation Schemas**: Use strict Zod schemas matching exact properties, rejecting unrecognized options to prevent silent bugs, typos, and schema creep. 4. **Platform Registry Checks**: Manifest validation checks against duplicate module IDs, duplicate capability claims, and duplicate route mappings across all running instances to guarantee resource safety. 5. **No External Parsers**: The manifest system will utilize native JSON parsing and a custom, lightweight, zero-dependency YAML parser. This ensures fast platform boot speeds and conforms to the core principle of minimizing unnecessary external dependencies.
- scope: module, manifest

## ADR-018: Dependency Resolution Engine
- source: docs/adr/ADR-018-dependency-resolution.md
- status: locked (Accepted)
- decision: We will implement an in-memory **Dependency Resolution Engine** inside the Platform Runtime. Key decisions: 1. **Directed Acyclic Graph (DAG) Representation**: We will represent module relations as a graph of nodes and directed edges, separating this mathematical structure from the `RuntimeManager`. 2. **Depth-First Search (DFS) for Sorting and Cycles**: We will use a DFS traversal algorithm with dual-marking (temporary and permanent marks) to perform topological sorting and cycle detection in linear $O(V + E)$ complexity. 3. **Explicit Cycle Tracing**: If a cycle is detected, the resolver will capture the recursion stack to produce a detailed path (e.g. `Trading -> Portfolio -> Trading`) for developer diagnostics, rather than raising a generic "cycle found" error. 4. **Deterministic Ordering**: We will enforce alphabetical pre-sorting on all module ID inputs before sorting the graph to ensure that the startup sequence is 100% deterministic, regardless of filesystem read variations. 5. **Transitive Skipping (Fault Isolation)**: If a module fails validation (missing or circular dependency), the resolver will transitively propagate the failure, skipping all affected dependents, while letting the remaining independent modules load and boot safely.
- scope: dependency, resolution

## ADR-019: Centralized Lifecycle Manager
- source: docs/adr/ADR-019-lifecycle-manager.md
- status: locked (Accepted)
- decision: We will introduce a dedicated `LifecycleManager` to execute all module state changes. Key decisions: 1. **Centralized Ownership**: `LifecycleManager` is the single authority responsible for mutating `ModuleState`. No other class may directly alter state variables. `RuntimeManager` orchestrates high-level system flows, delegating all state executions to the `LifecycleManager`. 2. **Transition Validation**: Every state change must run through a validation check. Attempting an illegal transition (e.g. `UNLOADED -> RUNNING`) throws a typed `LifecycleTransitionError`. 3. **Graceful Rollback**: If a startup sequence of multiple modules fails midway, the manager triggers a rollback, stopping and unloading only the modules started *during that specific boot sequence* in reverse order, leaving previously active modules unaffected. 4. **Time-bounded Execution (Timeouts)**: Transitions execute within configurable timeout limits to prevent hung modules from locking up the platform. If a timeout is exceeded, the module is marked `FAILED` and cleans up to `UNLOADED`. 5. **Event Emission**: All successful and failed transitions are published through the central `EventBus` to support diagnostics, metric collection, and real-time logging. 6. **Failure Policy Abstraction**: Support pluggable startup policies (`StrictPolicy`, `ContinueOnFailurePolicy`) allowing developers to customize how the boot engine handles module failures.
- scope: lifecycle, manager

## ADR 020 – Capability Registry
- source: docs/adr/ADR-020-capability-registry.md
- status: locked (Accepted)
- decision: Introduce a **Capability Registry** service that: 1. Stores capability metadata extracted from module manifests. 2. Allows modules to register/unregister capabilities on lifecycle events. 3. Resolves a capability request to a concrete provider instance based on priority and optional SemVer constraints. 4. Emits registration/removal events through the shared `eventBus` for observers.
- scope: capability, registry

## ADR-021: Observability Platform Architecture
- source: docs/adr/ADR-021-observability-platform.md
- status: locked (Accepted)
- decision: We establish the **AKIRA OS Observability Platform**, a decoupled, passive telemetry engine structured into four distinct horizontal layers: ``` ┌─────────────────────────────────────────────────────────┐ │                    Instrumentation                      │  (Telemetry APIs, Decorators, Facades) └───────────────────────────┬─────────────────────────────┘                             │ (Async Buffering)                             ▼ ┌─────────────────────────────────────────────────────────┐ │                       Collection                        │  (Aggregators, Ring Buffers, Processors) └───────────────────────────┬─────────────────────────────┘                             │ (Structured Batches)                             ▼ ┌─────────────────────────────────────────────────────────┐ │                         Storage                         │  (SQLite, Append-Only Files, Exporters) └───────────────────────────┬─────────────────────────────┘                             │ (Indexed Read Queries)                             ▼ ┌─────────────────────────────────────────────────────────┐ │                      Presentation                       │  (Console, Local Dashboards, File Dumps) └─────────────────────────────────────────────────────────┘ ``` The system will enforce the following architectural patterns: 1. **Unidirectional Dependency Flow**: Code dependencies flow downwards: `Instrumentation` -> `Collection` -> `Storage` -> `Presentation`. No layer can call upwards, and non-observability subsystems may only depend on the public interfaces of `Instrumentation`. 2. **Immutable Unified Telemetry Model**: All telemetry entities (Logs, Metrics, Spans, Audit logs, Diagnostics, Health metrics, Resource snapshots) inherit from a base `Telemetry` record with structured correlation parameters (Trace ID, Span ID, correlation ID). 3. **Asynchronous Non-Blocking Processing**: The API immediately returns after capturing telemetry. Telemetry payloads are offloaded to an asynchronous ring buffer. Failure to record, serialize, or export telemetry will never crash or interrupt business execution (Fail-Safe, Fail-Silent design). 4. **Platform Independence**: Telemetry generation relies purely on standard ECMAScript constructs. Platform-specific adapters (Node.js APIs, SQLite databases) are isolated within the `Storage` and `Collection` layers.
- scope: observability, platform

## ADR-022: Completing the Observability Platform
- source: docs/adr/ADR-022-observability-completion.md
- status: locked (Accepted)
- decision: ADR-022: Completing the Observability Platform architectural document.
- scope: observability, completion

## ADR-001: Separation of Memory and AI Models
- source: docs/GENESIS/architecture/decisions/ADR-001-memory-and-ai-separation.md
- status: locked (Accepted)
- decision: The **Adaptive Memory Engine** must never communicate directly with AI models. The system must operate through a strictly decoupled, unidirectional cognitive pipeline: ``` [ Adaptive Memory Engine ] (Persistent Storage)           │           ▼    [ Recall Engine ]       (Relevance Selector)           │           ▼   [ Context Builder ]      (Understanding Assembler)           │           ▼  [ AI Context Engine ]     (API/Prompt Translator)           │           ▼    [ Reasoning Model ]     (Stateless Inference Core) ```
- scope: memory, and, separation

## ADR-002: Story-First Memory Architecture
- source: docs/GENESIS/architecture/decisions/ADR-002-story-first-memory.md
- status: locked (Accepted)
- decision: AKIRA will organize long-term user understanding using **Stories** rather than isolated, flat memories. Stories serve as the primary narrative structure of the Adaptive Memory Engine, acting as dynamic, associative grouping anchors that represent meaningful user journeys.
- scope: story, first, memory

## ADR-003: Emergent Identity Discovery
- source: docs/GENESIS/architecture/decisions/ADR-003-emergent-identity.md
- status: locked (Accepted)
- decision: The **Identity Layer** of AKIRA will never be manually configured. Instead, the user's identity (traits, work styles, learning styles, values, and strengths) must emerge and be discovered continuously from long-term patterns across Events, Memories, Stories, and physical behaviors.
- scope: emergent, identity

## ADR-004: Decoupled Context Builder
- source: docs/GENESIS/architecture/decisions/ADR-004-context-builder.md
- status: locked (Accepted)
- decision: All system, user, and memory telemetry must be assembled into a logical, unified **Context Package** by the **Context Builder** before reaching any downstream reasoning model.
- scope: context, builder

## ADR-005: Companion Core Behavioral Model
- source: docs/GENESIS/architecture/decisions/ADR-005-companion-philosophy.md
- status: locked (Accepted)
- decision: AKIRA will behave as a **trustworthy growth companion** rather than an engagement-driven chatbot. The companion's character, personality, and tone will be strictly governed by the **Companion Core Philosophy**, optimizing for user growth and real-world execution.
- scope: companion, philosophy

## ADR-006: Deterministic Presence Subsystem
- source: docs/GENESIS/architecture/decisions/ADR-006-presence-engine.md
- status: locked (Accepted)
- decision: We will construct the Presence Engine as a deterministic rules-based subsystem, executing local mathematical and calendar-based checks, and completely bypass runtime cognitive inference cycles.
- scope: presence, engine

## ADR-007: Ephemeral Session-Scoped Companion State Layer
- source: docs/GENESIS/architecture/decisions/ADR-007-companion-state-engine.md
- status: locked (Accepted)
- decision: We will implement the Companion State Engine as an ephemeral, session-scoped runtime layer (Alternative C). ---
- scope: companion, state, engine

## ADR-008: Dedicated Goal Subsystem
- source: docs/GENESIS/architecture/decisions/ADR-008-goal-engine.md
- status: locked (Accepted)
- decision: We will implement the Goal Engine as a dedicated architectural subsystem (Alternative D). ---
- scope: goal, engine

## ADR-009: Dedicated Knowledge Subsystem
- source: docs/GENESIS/architecture/decisions/ADR-009-knowledge-engine.md
- status: locked (Accepted)
- decision: We will implement the Knowledge Engine as a dedicated architectural subsystem (Alternative C). ---
- scope: knowledge, engine

## ADR-010: Dedicated Relationship Subsystem
- source: docs/GENESIS/architecture/decisions/ADR-010-relationship-engine.md
- status: locked (Accepted)
- decision: We will implement the Relationship Engine as a dedicated architectural subsystem (Alternative C). ---
- scope: relationship, engine

## ADR-011: Evidence-Based Habit Subsystem
- source: docs/GENESIS/architecture/decisions/ADR-011-habit-intelligence.md
- status: locked (Accepted)
- decision: We will implement the Habit Intelligence Engine as a dedicated, evidence-based pattern observation subsystem (Alternative C). ---
- scope: habit, intelligence

## ADR-012: Dedicated Retrospective Reflection Subsystem
- source: docs/GENESIS/architecture/decisions/ADR-012-reflection-engine.md
- status: locked (Accepted)
- decision: We will implement the Reflection Engine as a dedicated retrospective subsystem (Alternative C). ---
- scope: reflection, engine

## ADR-013: Dedicated Context Resolution Subsystem
- source: docs/GENESIS/architecture/decisions/ADR-013-context-resolution-engine.md
- status: locked (Accepted)
- decision: We will implement the Context Resolution Engine as a dedicated centralized orchestration subsystem (Alternative C). ---
- scope: context, resolution, engine

## ADR-014: Dedicated Initiative Subsystem and Silence-by-Default Design
- source: docs/GENESIS/architecture/decisions/ADR-014-initiative-engine.md
- status: locked (Accepted)
- decision: We will implement the Initiative Engine as a dedicated centralized subsystem with a "Silence-by-Default" design (Alternative C). ---
- scope: initiative, engine

