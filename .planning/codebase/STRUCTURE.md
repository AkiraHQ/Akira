---
last_mapped_commit: b9959ee4850c7959b188140c2cbaec38f50c68fc
last_mapped_at: 2026-10-04
---
# Codebase Structure

**Analysis Date:** 2026-10-04

## Directory Layout

```text
AKIRA/
├── .github/                     # GitHub Actions CI/CD workflows and issue templates
├── docs/                        # Architecture Decision Records (ADRs) and subsystem specs
│   ├── adr/                     # Platform Architecture Decision Records (ADR-001 - ADR-022)
│   ├── AKIRA-OS/                # AKIRA OS architecture, observability, and security specifications
│   ├── GENESIS/                 # Cognitive AI companion architecture and design documents
│   └── Vajra/                   # VAJRA executive brain architecture and phase specifications
├── scripts/                     # Build, architecture validation, and verification CLI entry points
├── src/                         # Primary application TypeScript source code
│   ├── akira-os/                # Domain modules: tasks, notes, projects, sessions, vault, tools
│   ├── analytics/               # Analytics calculation engine, metrics aggregation, and dashboards
│   ├── app/                     # UI application shell, layout wrappers, and design primitives
│   │   ├── shell/               # Global Shell, Sidebar, Topbar, CommandPalette, and navigation
│   │   └── ui/                  # shadcn/ui and Radix UI accessible styled component primitives
│   ├── contracts/               # Pure TypeScript interfaces and abstract repository contracts
│   ├── genesis/                 # Cognitive companion AI: memory, recall, identity, reflection, reasoning
│   ├── hooks/                   # Reusable React hooks for UI and reactive data access
│   ├── instrumentation/         # Strongly-typed EventBus, publishers, subscribers, and event schemas
│   ├── lib/                     # Shared utility helpers and string/class formatters
│   ├── observability/           # Telemetry platform: health checks, metrics, tracing, diagnostics
│   ├── persistence/             # SQLite connection, DDL migrations, repositories, and reactive store
│   │   ├── migrations/          # Versioned SQL migration scripts (001, 002, 003)
│   │   ├── repositories/        # Concrete SQLite repository implementations (better-sqlite3)
│   │   └── vajra/               # SQLite operational state persistence for VAJRA executive layers
│   ├── routes/                  # TanStack Router file-based page controllers
│   ├── shared/                  # Common domain models, constants, and shared interfaces
│   ├── vajra/                   # Executive cognitive brain: missions, beliefs, deliberative traces
│   ├── workers/                 # Background Web Worker scripts (thumbnail generation)
│   ├── router.tsx               # Client router instantiation and hydration config
│   ├── routeTree.gen.ts         # Generated route tree (auto-managed by TanStack Router)
│   ├── server.ts                # Server runtime entrypoint and SSR error wrapper
│   ├── start.ts                 # Client application bootstrapping entrypoint
│   └── styles.css               # Global Tailwind CSS definitions, gradients, and custom animations
├── tests/                       # Vitest unit, integration, and performance benchmarking suites
│   ├── capabilities/            # Capability integration test suites
│   ├── contracts/               # Repository and event bus contract conformance tests
│   ├── production/              # Production journey and E2E simulation tests
│   ├── support/                 # Test helpers, temporary DB setups, and A/B perf testing harnesses
│   └── vajra/                   # VAJRA operational state and migration verification tests
├── .prettierrc                  # Prettier code formatting rules
├── ARCHITECTURE.md              # Root architectural blueprint
├── CLAUDE.md                    # Working agreement, invariants, and verification instructions
├── CODE_STYLE.md                # Code style, naming rules, and React component patterns
├── DIRECTORY_STRUCTURE.md       # Directory ownership and import boundaries reference
├── eslint.config.js             # ESLint flat config with process.exit and import rules
├── package.json                 # Project dependencies, build targets, and script definitions
├── tsconfig.json                # TypeScript compiler configuration with @/* path aliases
├── vite.config.ts               # Vite bundler, SSR configuration, and plugin pipeline
├── vitest.config.ts             # Global test runner configuration
└── vitest.bench.config.ts       # Isolated benchmark runner configuration
```

## Directory Purposes

**`src/akira-os/`:**
- Purpose: Core user-facing workspace domain modules.
- Contains: Tasks, Notes, Vault file management, Sessions (focus timers), Projects, Search, and Tool Registry.
- Key files: `src/akira-os/tools/registry.ts`, `src/akira-os/tasks/`, `src/akira-os/vault/VaultStorageService.ts`.

**`src/app/`:**
- Purpose: Application chrome, shell canvas, and visual components.
- Contains: Glassmorphic App Shell (`Shell.tsx`), Sidebar (`Sidebar.tsx`), Command Palette (`CommandPalette.tsx`), and UI primitive components (`src/app/ui/`).
- Key files: `src/app/shell/Shell.tsx`, `src/app/shell/CommandPalette.tsx`, `src/app/ui/button.tsx`.

**`src/contracts/`:**
- Purpose: Pure TypeScript contract definitions with zero runtime dependencies.
- Contains: Abstract repository interfaces, provider contracts, and data transfer types.
- Key files: `src/contracts/TaskRepository.ts`, `src/contracts/NoteRepository.ts`, `src/contracts/workspace-provider.ts`.

**`src/genesis/`:**
- Purpose: Cognitive companion intelligence engine.
- Contains: Autobiographical memory graphs, story arc builders, reflection engines, identity models, context synthesizers, and AI model providers.
- Key files: `src/genesis/context/ai/provider-manager.ts`, `src/genesis/identity/services/IdentityService.ts`, `src/genesis/memory/`.

**`src/persistence/`:**
- Purpose: Authoritative SQLite storage and in-memory reactive caching.
- Contains: SQLite connection manager (`connection.ts`), schema initializer (`initializer.ts`), DDL migrations (`migrations/`), concrete repository implementations (`repositories/`), and client state store (`akira-store.ts`).
- Key files: `src/persistence/connection.ts`, `src/persistence/initializer.ts`, `src/persistence/akira-store.ts`.

**`src/routes/`:**
- Purpose: File-based routing controllers managed by TanStack Router.
- Contains: Root layout (`__root.tsx`), dashboard (`index.tsx`), and feature pages (`projects.tsx`, `tasks.tsx`, `notes.tsx`, `vault.tsx`, `chat.tsx`, `brain.tsx`, `settings.tsx`).
- Key files: `src/routes/__root.tsx`, `src/routes/index.tsx`, `src/routes/settings.tsx`.

**`src/vajra/`:**
- Purpose: Autonomous executive cognitive brain.
- Contains: Self-model, authority boundaries, mission step dispatchers, belief verification networks, and escalation managers.
- Key files: `src/vajra/index.ts`, `src/vajra/executive/`, `src/vajra/mission/`.

**`src/observability/`:**
- Purpose: In-process diagnostic telemetry, health tracking, and performance sampling.
- Contains: Health registry, metrics store, distributed tracing, and resource monitors.
- Key files: `src/observability/auto-compose.ts`, `src/observability/health/health-registry.ts`.

## Key File Locations

**Entry Points:**
- `src/server.ts`: Server-side SSR entry and unhandled error boundary.
- `src/start.ts`: Client-side hydration bootstrapper.
- `src/router.tsx`: TanStack Router configuration and initialization.
- `src/routes/__root.tsx`: Top-level React tree mounting providers and running boot sequences.

**Configuration:**
- `vite.config.ts`: Vite bundler and TanStack Start plugins.
- `tsconfig.json`: TypeScript compiler options and `@/*` path mapping.
- `eslint.config.js`: ESLint rules, Prettier formatting, and restricted properties.
- `components.json`: shadcn/ui configuration.
- `bunfig.toml`: Bun runtime flags.

**Core Persistence & Repositories:**
- `src/persistence/connection.ts`: SQLite singleton instance.
- `src/persistence/initializer.ts`: Database migration orchestrator.
- `src/persistence/akira-store.ts`: Reactive client state store.
- `src/persistence/schema.sql`: Authoritative baseline database schema.

**Testing:**
- `vitest.config.ts`: Default test suite configuration.
- `vitest.bench.config.ts`: Dedicated benchmarking runner configuration.
- `tests/support/perf-ab.ts`: Rigorous A/B micro-benchmarking harness.

## Naming Conventions

**Files:**
- React Components: PascalCase (e.g., `Shell.tsx`, `Sidebar.tsx`, `FeaturePanel.tsx`).
- Services & Classes: PascalCase (e.g., `TaskService.ts`, `VaultStorageService.ts`).
- Repository Contracts: PascalCase (e.g., `NoteRepository.ts`, `ProjectRepository.ts`).
- General Utilities: kebab-case (e.g., `event-bus.ts`, `store-init.ts`, `resource-sampler.ts`).
- Routes: kebab-case matching URL paths (e.g., `daily-mission.tsx`, `brain-dump.tsx`, `projects.$id.tsx`).

**Code Symbols:**
- Variables, Functions, Methods: camelCase (e.g., `createTask`, `activeProviderName`).
- Types, Interfaces, Enums: PascalCase (e.g., `WorkspaceProvider`, `MissionLifecycleState`).
- Constants & Static Keys: UPPER_SNAKE_CASE (e.g., `DEFAULT_PAGE_SIZE`, `MAX_RECALL_NODES`).
- React Hooks: camelCase starting with `use` (e.g., `useAkira`, `useAIProviderManager`).

## Where to Add New Code

**New Feature or Domain Module:**
- Module Implementation: Create directory under `src/akira-os/<feature-name>/`.
- Client Domain Service: `src/akira-os/<feature-name>/<Feature>Service.ts`.
- Repository Interface: `src/contracts/<Feature>Repository.ts`.
- SQLite Repository: `src/persistence/repositories/Sqlite<Feature>Repository.ts`.
- Route Controller: `src/routes/<feature-name>.tsx`.
- Register in Tool Registry: Add entry to `src/akira-os/tools/registry.ts`.
- Unit/Integration Tests: Co-locate in `src/akira-os/<feature-name>/<feature>.test.ts` or add to `tests/`.

**New UI Component:**
- Reusable UI Primitive: Add to `src/app/ui/<component-name>.tsx`.
- Feature-Specific Subcomponent: Add to `src/akira-os/<feature-name>/components/` or `src/app/<feature>/`.

**New Database Table / Migration:**
- DDL Script: Add versioned SQL file to `src/persistence/migrations/` (e.g., `004_<name>.sql`).
- Update Initializer: Add migration step in `src/persistence/migration-impl.ts` and advance `schema_version`.
- Migration Test: Add migration test in `tests/` verifying schema up/down transitions.

**Utilities & Shared Helpers:**
- General Helpers: Place in `src/lib/` or `src/shared/`.

## Special Directories

**`.planning/`:**
- Purpose: Ground truth planning directory for GSD workflows.
- Contains: Codebase maps (`.planning/codebase/`), roadmaps, requirements, and state.
- Generated: Partially by GSD workflows; Committed: Yes.

**`docs/adr/`:**
- Purpose: Architecture Decision Records documenting all major platform architectural choices.
- Generated: No; Committed: Yes.

**`graphify-out/`:**
- Purpose: Local graphify knowledge graph indices and subgraphs.
- Generated: Yes (`graphify update .`); Committed: Yes.

---

*Structure analysis: 2026-10-04*
