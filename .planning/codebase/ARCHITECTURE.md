---
last_mapped_commit: b9959ee4850c7959b188140c2cbaec38f50c68fc
last_mapped_at: 2026-10-04
---
<!-- refreshed: 2026-10-04 -->

# Architecture

**Analysis Date:** 2026-10-04

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Client Presentation Sandbox                           │
├──────────────────────────┬──────────────────────────┬───────────────────────┤
│   App Shell & Nav        │   Route Controllers      │   UI Components       │
│  `src/app/shell/`        │  `src/routes/`           │  `src/app/ui/`        │
└────────────┬─────────────┴────────────┬─────────────┴───────────┬───────────┘
             │                          │                         │
             ▼                          ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 Reactive Client State & Service Layer                       │
│  `src/persistence/akira-store.ts` (useSyncExternalStore cache)             │
│  `src/akira-os/*/` (Domain services dispatching optimistic mutations)       │
└────────────┬────────────────────────────────────────────────────┬───────────┘
             │ (Read-only Provider)                               │ (Serialized RPC)
             ▼                                                    ▼
┌──────────────────────────┐               ┌──────────────────────────────────┐
│  GENESIS Cognitive Core  │               │   Server Function RPC Layer      │
│  `src/genesis/`          │               │  `createServerFn` boundaries     │
│  (Memory, Stories, AI)   │               └──────────────────┬───────────────┘
└────────────┬─────────────┘                                  │
             │                                                ▼
             │ (Operational State)         ┌──────────────────────────────────┐
             ▼                             │   Domain Repository Contracts    │
┌──────────────────────────┐               │  `src/contracts/*.ts`            │
│  VAJRA Executive Core    │               └──────────────────┬───────────────┘
│  `src/vajra/`            │                                  │
│  (Missions, Beliefs)     │                                  ▼
└────────────┬─────────────┘               ┌──────────────────────────────────┐
             │                             │  SQLite Persistence Repositories │
             ▼                             │  `src/persistence/repositories/` │
┌──────────────────────────────────────────┴──────────────────┬───────────────┘
│                     authoritative SQLite Storage            │
│                     `akira.db` (better-sqlite3 in WAL Mode) │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| **Workspace Shell** | Root visual glassmorphic canvas, layout modes (`fit`/`scroll`), topbar, command palette | `src/app/shell/Shell.tsx` |
| **Tool Registry** | Dynamic registration and permission filtering of workspace modules and dev tools | `src/akira-os/tools/registry.ts` |
| **Reactive Store** | Optimistic in-memory reactive state cache with selective subscriber notification | `src/persistence/akira-store.ts` |
| **Database Connection** | Thread-safe singleton connection manager for `better-sqlite3` with WAL PRAGMAs | `src/persistence/connection.ts` |
| **Database Initializer** | Executes DDL migrations, initializes triggers, and validates schema versioning | `src/persistence/initializer.ts` |
| **Workspace Provider** | Read-only bridge supplying workspace reality snapshots to the GENESIS cognitive engine | `src/contracts/workspace-provider.ts` |
| **GENESIS Context Engine** | Synthesizes current workspace context, user memories, and prompts for LLM providers | `src/genesis/context/` |
| **AI Provider Manager** | Multi-provider orchestration (Gemini, OpenRouter) with key management and streaming | `src/genesis/context/ai/provider-manager.ts` |
| **VAJRA Operational Store**| Persistent operational state, missions, beliefs, deliberative traces, and escalations | `src/persistence/vajra/sqlite-operational-state-store.ts` |
| **Event Bus & Publisher** | Central typed pub/sub bus broadcasting lifecycle, telemetry, and domain events | `src/instrumentation/event-bus.ts` |
| **Observability Telemetry**| Health registry, diagnostic ring buffer, and resource performance samplers | `src/observability/` |

## Pattern Overview

**Overall:** Local-First Reactive Desktop Architecture with Decoupled Server RPCs, Clean Repositories, and Twin Cognitive Engines (GENESIS & VAJRA).

**Key Characteristics:**
- **Zero Latency Optimistic Mutation:** UI immediately commits updates to client memory (`akira-store`), while asynchronously serializing changes to disk.
- **Strict Boundary Decoupling:** Client UI components and browser bundles are physically prevented from importing database drivers (`better-sqlite3`).
- **Autonomous Local SQLite:** Complete relational schema versioning (`schema_version = 3`) with automated triggers keeping FTS5 search and timeline audit tables synced.
- **Dual Cognitive Separation:** GENESIS remembers the human and their experiences; VAJRA remembers its own executive and operational decisions.

## Layers

**1. Presentation Layer (`src/app/`, `src/routes/`):**
- Purpose: Render user interface, manage route transitions, and capture user gestures.
- Location: `src/app/shell/`, `src/app/ui/`, `src/routes/`
- Contains: React components, TanStack Router controllers, Radix primitives, styling tokens.
- Depends on: Reactive Store (`akira-store`), Client Domain Services, Custom Hooks.
- Used by: End user via desktop viewport.

**2. State & Service Layer (`src/akira-os/`, `src/persistence/akira-store.ts`):**
- Purpose: Maintain optimistic application state, handle domain validation, and invoke server functions.
- Location: `src/akira-os/tasks/`, `src/akira-os/notes/`, `src/akira-os/vault/`, `src/persistence/akira-store.ts`
- Contains: Client domain services, store slice reducers, optimistic action handlers.
- Depends on: Server RPC layer (`createServerFn`), EventBus.
- Used by: Presentation layer components and hooks.

**3. RPC Server Function Layer (`createServerFn`):**
- Purpose: Bridge client requests to backend Node.js execution without exposing raw database drivers to the browser.
- Location: Defined alongside domain modules or dedicated `.server.ts` files.
- Contains: Parameter validators (`zod`), server authorization, repository resolution.
- Depends on: Repository Contracts and Concrete SQLite Repositories.
- Used by: Client Domain Services.

**4. Data Access Layer (`src/contracts/`, `src/persistence/`):**
- Purpose: Abstract and execute database queries against SQLite using `better-sqlite3`.
- Location: `src/contracts/`, `src/persistence/repositories/`, `src/persistence/connection.ts`
- Contains: Pure TypeScript interfaces, parameterized SQL queries, migration scripts.
- Depends on: `better-sqlite3`, Node.js `fs` and `path`.
- Used by: RPC Server Functions and Store Hydration routines.

**5. Cognitive & Executive Layer (`src/genesis/`, `src/vajra/`):**
- Purpose: Model cognitive context, autobiographical memory, user identity, and persistent executive decision-making.
- Location: `src/genesis/`, `src/vajra/`
- Contains: Memory graphs, story arcs, reflection algorithms, belief networks, mission execution states.
- Depends on: `WorkspaceProvider` (read-only), AI Provider Manager, EventBus, VAJRA Operational Store.
- Used by: AI Companion views (`src/routes/chat.tsx`, `src/routes/brain.tsx`, `src/routes/daily-mission.tsx`).

## Data Flow

### Primary Request Path (Workspace Mutation):

1. **User Action:** User marks a task complete or edits a note in `src/routes/tasks.tsx` (`src/routes/tasks.tsx:120`).
2. **Service Dispatch:** Route component calls `TaskService.updateTask(...)` (`src/akira-os/tasks/`).
3. **Optimistic Store Update:** Service updates in-memory `akira-store` instantly; UI re-renders synchronously via `useSyncExternalStore` (`src/persistence/akira-store.ts`).
4. **RPC Transmission:** Service dispatches asynchronous server function `persistUpdateTask` via `createServerFn`.
5. **Repository Execution:** Server function executes `SqliteTaskRepository.update(...)` (`src/persistence/repositories/SqliteTaskRepository.ts`).
6. **SQL & Trigger Execution:** `better-sqlite3` runs the parameterized SQL update on `akira.db`. An SQLite database trigger fires automatically, updating `timeline_events` and refreshing `fts_workspace` FTS5 index (`src/persistence/schema.sql`).
7. **Event Notification:** `EventBus.publish(...)` emits `TASK_UPDATED` event for instrumentation, analytics, and GENESIS narrative digestion (`src/instrumentation/event-bus.ts`).

### Secondary Flow (GENESIS Cognitive Context Recall & AI Streaming):

1. **User Prompt:** User inputs a thought or question in `src/routes/chat.tsx`.
2. **Context Resolution:** `ContextEngine` queries `WorkspaceProvider` to capture reality snapshots (active projects, pending daily mission, recent notes) (`src/genesis/context/`).
3. **Memory Retrieval:** `RecallEngine` evaluates user memory nodes in `MemoryGraph`, ranking relevance by recency, importance decay, and topic similarity (`src/genesis/recall/`).
4. **Prompt Assembly:** `PromptBuilder` merges system persona, workspace context, and memories into a structured prompt, stripping any internal database IDs (`src/genesis/context/ai/prompt-builder.ts`).
5. **Streaming AI Completion:** Selected AI provider (`Gemini` or `OpenRouter`) streams tokens back over SSE reader to update the UI chat bubble incrementally (`src/genesis/context/ai/providers/gemini-provider.ts`).

**State Management:**
- Primary client state lives in `akira-store` (`src/persistence/akira-store.ts`).
- Server-side persistence lives in SQLite database `akira.db` (`src/persistence/connection.ts`).
- Transient component state uses standard React hooks (`useState`, `useReducer`).
- Asynchronous data fetching is managed via TanStack Query.

## Key Abstractions

**Repository Contract:**
- Purpose: Abstracts SQL persistence operations behind pure TypeScript interfaces.
- Examples: `src/contracts/NoteRepository.ts`, `src/contracts/ProjectRepository.ts`, `src/contracts/TaskRepository.ts`.
- Pattern: Repository Pattern (separating domain contracts from database driver implementations).

**Reactive Store Slice:**
- Purpose: Encapsulates state, hydration, and optimistic update mutations for domain entities.
- Examples: `src/persistence/akira-store.ts`.
- Pattern: External Store Pattern (`useSyncExternalStore`).

**Read-Only Workspace Provider:**
- Purpose: Grants the cognitive companion access to workspace state while strictly isolating it from direct database mutation.
- Examples: `src/contracts/workspace-provider.ts`.
- Pattern: Adapter / Facade Pattern.

**Operational State Store:**
- Purpose: Manages persistent mission lifecycles, beliefs, deliberative traces, and human escalations for the executive authority.
- Examples: `src/persistence/vajra/sqlite-operational-state-store.ts`.
- Pattern: Two-Phase Dispatch Model (isolating DB transactions from asynchronous external executions).

## Entry Points

**Web & SSR Server Entry:**
- Location: `src/server.ts`
- Triggers: Node.js server initialization or TanStack Start request handling.
- Responsibilities: Wraps SSR handler with global error logging and server lifetime management.

**Client Application Entry:**
- Location: `src/start.ts`, `src/router.tsx`
- Triggers: Browser page load.
- Responsibilities: Initializes router instance, registers route hierarchy from `src/routeTree.gen.ts`, hydrates client plugins.

**Root Route Component:**
- Location: `src/routes/__root.tsx`
- Triggers: Mounted by TanStack Router as top-level wrapper.
- Responsibilities: Mounts React Query provider, Sonner toast container, runs `BootSequence`, hydrates `akira-store` from SQLite, starts presence engines.

## Architectural Constraints

- **Single-Threaded Database Driver:** `better-sqlite3` runs synchronously in the Node.js server process; long-running table locks or intensive loops must be avoided in SQLite queries.
- **Client-Server Isolation:** Frontend code must never import `better-sqlite3` or `src/persistence/connection.ts`. Static verification scripts (`scripts/validate-architecture.ts`) enforce this constraint.
- **No `process.exit` in `src/`:** Prohibited across all source code by ESLint `no-restricted-properties` rule (`eslint.config.js`). CLI entrypoints belong in `scripts/`.
- **Read-Only Cognitive Boundary:** GENESIS has no direct write handle to workspace entities (`projects`, `tasks`, `notes`).
- **Layout Constraint:** `Shell.tsx` owns all viewport measurements; child feature modules must use responsive Flexbox/Grid layouts without window resize listeners.

## Anti-Patterns

### Anti-Pattern: Direct Persistence Import in Client Components

- **What happens:** Importing database repositories, connections, or prepared statements in a React component (`import { getDatabaseConnection } from '@/persistence/connection'`).
- **Why it's wrong:** Breaks client-side bundling, triggers runtime browser crashes, and violates local-first client-server separation.
- **Do this instead:** Call the client domain service or `createServerFn` RPC endpoint (`src/akira-os/notes/NoteService.ts`).

### Anti-Pattern: Direct Mutation of Workspace State by GENESIS

- **What happens:** Allowing cognitive AI modules to directly insert or modify workspace tables.
- **Why it's wrong:** Compromises user agency and corrupts the authoritative workspace reality.
- **Do this instead:** Ingest workspace state through read-only `WorkspaceProvider` (`src/contracts/workspace-provider.ts`) and propose recommendations as initiatives or suggestions.

### Anti-Pattern: Hardcoding Viewport Measurements

- **What happens:** Attaching `window.addEventListener('resize')` or computing fixed pixel heights inside feature components.
- **Why it's wrong:** Conflicts with `Shell.tsx` container layouts and breaks responsiveness between `fit` and `scroll` modes.
- **Do this instead:** Rely on standard Tailwind layout utility classes (e.g., `flex-1`, `h-full`, `overflow-y-auto`).

## Error Handling

**Strategy:** Layered defensive error boundaries. Client actions fail gracefully with user-facing toast notifications (`sonner`); server errors are logged to the diagnostic in-memory ring buffer without crashing the Node process.

**Patterns:**
- Try/catch blocks in domain services revert optimistic store changes if RPC persistence fails.
- Database operations wrap multi-statement updates in explicit `db.transaction()` blocks.
- Unhandled rejections during server request lifecycle are intercepted by `src/server.ts` error handler.

## Cross-Cutting Concerns

**Logging & Telemetry:**
- Central in-memory diagnostics service (`src/observability/diagnostics/diagnostics-service.ts`).
- Typed in-process event bus (`src/instrumentation/event-bus.ts`).

**Validation:**
- Zod schemas validate RPC inputs, event bus payloads, and cognitive model data contracts (`src/instrumentation/event-types.ts`).

**Authentication & Security:**
- Single-user local-first architecture. All user data resides on local disk (`akira.db`). Model provider API keys are stored in the local SQLite `settings` table.

---

*Architecture analysis: 2026-10-04*
