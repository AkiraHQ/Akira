# AKIRA — PHASE 0 BASELINE FREEZE & PROTECTION SPECIFICATION
*Status: Authoritative Frozen Baseline*
*Date: 2026-10-04*
*Author: Senior Systems Architect (Antigravity)*

---

## 1. Baseline Metadata & Metrics

| Metric | Frozen Baseline Value | Verification Evidence |
|---|---|---|
| **Git Branch** | `genesis/foundation-stabilization` | `git branch --show-current` |
| **Commit SHA** | `b9959ee4850c7959b188140c2cbaec38f50c68fc` | `git rev-parse HEAD` |
| **Working Tree Status** | Clean working state with architecture documents in `docs/architecture/` | `git status` |
| **Source Files (`src/`)** | **635** files | Measured via PowerShell file count |
| **Test Suites** | **142** test suites (162 test files across `tests/` and `src/`) | Measured via Vitest runner |
| **Canonical Test Count** | **140 / 140 passed (100%)** | `tests/production/*`, `tests/capabilities/*`, `tests/contracts/*`, `tests/production-journey.test.ts` |
| **Architecture Assertions** | **363 / 363 passed (100%)** | `npx tsx scripts/validate-architecture.ts` |
| **TypeScript Compilation** | **Clean (Exit Code 0)** | `tsc --noEmit` |
| **Production Build** | **Clean (Exit Code 0)** | `vite build` (Built in 27.76s: Client bundle + SSR Nitro server) |
| **Linter Status** | 110 Prettier formatting warnings in recently added production tests; 0 functional TypeScript errors in production files | `eslint .` |

---

## 2. Protected Foundation Inventory (INVIOLABLE)

The following components are protected under Rule N1, N2, N3, and Foundation Contracts K1–K19. Under no circumstances may any phase delete or modify these files for "cleanup":

1. **Canonical Capability Registry Host:**
   - `src/akira-os/capabilities/host.ts` (Rule N3 canonical singleton)
2. **Grounded Production Capabilities:**
   - `task.create` (`src/akira-os/tasks/capabilities/task-create-descriptor.ts`)
   - `task.read` (`src/akira-os/tasks/capabilities/task-read-descriptor.ts`)
   - `task.update` (`src/akira-os/tasks/capabilities/task-update-descriptor.ts`)
   - `task.list` (`src/akira-os/tasks/capabilities/task-list-descriptor.ts`)
   - `recall.search` (`src/akira-os/search/capabilities/recall-search-descriptor.ts`)
3. **Foundation Contracts (K1–K19):**
   - `src/contracts/results/result.ts` (Contracts K1, K5, K19)
   - `src/contracts/capabilities/descriptor.ts` (Contract K8)
   - `src/contracts/capabilities/registry.ts` (Contracts K7, K14)
   - `src/contracts/capabilities/verification.ts` (Contract K6)
   - `src/contracts/events/observation.ts` (Contract K4)
   - `src/contracts/events/domain-event.ts` (Contract K3)
   - `src/contracts/mission/mission-definition.ts` (Contracts K10, K12)
   - `src/contracts/mission/mission-state.ts` (Contract K10)
4. **Persistence & Database Infrastructure:**
   - SQLite WAL mode, schema version 1, and foreign key integrity (`src/persistence/initializer.ts`)
   - Repositories in `src/persistence/repositories/`
   - Store initialization guard (`src/persistence/store-init.ts`)
5. **GENESIS Core Memory & Cognition:**
   - `src/genesis/memory/*` (Episodic memory, retention engine)
   - `src/genesis/understanding/*` (Identity service, traits)
   - `src/genesis/stories/*` (Narrative arcs)
   - `src/genesis/context/*` (Context builder, prompt builder)
   - `src/genesis/recall/*` (Historical recall provider)
6. **Architecture Validator:**
   - `scripts/validate-architecture.ts` (363 structural assertions)

---

## 3. Exact Files Targeted for Phase 1 Archival

Phase 1 archives the dead platform layers to `archive/legacy-platform/` (preserving 100% git history and recoverability without irreversible deletion):

### A. Legacy Platform Runtime (`src/runtime/` — 30 files)
- `src/runtime/index.ts`
- `src/runtime/module-context.ts`
- `src/runtime/module-instance.ts`
- `src/runtime/module-loader.ts`
- `src/runtime/module-state.ts`
- `src/runtime/runtime-manager.ts`
- `src/runtime/lifecycle/*` (6 files: `index.ts`, `lifecycle-errors.ts`, `lifecycle-events.ts`, `lifecycle-hooks.ts`, `lifecycle-manager.ts`, `lifecycle-policy.ts`, `lifecycle-timeout.ts`)
- `src/runtime/manifest/*` (6 files: `index.ts`, `manifest-errors.ts`, `manifest-loader.ts`, `manifest-schema.ts`, `manifest-validator.ts`, `manifest.ts`)
- `src/runtime/permissions/*` (4 files: `permission-catalog.ts`, `permission-errors.ts`, `permission-manager.ts`, `permission.ts`)
- `src/runtime/registry/*` (7 files: `capability-binding.ts`, `capability-errors.ts`, `capability-events.ts`, `capability-provider.ts`, `capability-registry.ts`, `capability-selector.ts`, `capability.ts`, `index.ts`)
- `src/runtime/resolver/*` (6 files: `dependency-errors.ts`, `dependency-graph.ts`, `dependency-node.ts`, `dependency-resolver.ts`, `dependency-utils.ts`, `index.ts`)

### B. Legacy Plugin SDK (`src/sdk/` — 13 files)
- `src/sdk/index.ts`
- `src/sdk/core/*` (4 files: `akira-sdk.ts`, `sdk-context.ts`, `sdk-errors.ts`, `sdk-version.ts`)
- `src/sdk/analytics/analytics-api.ts`
- `src/sdk/events/event-api.ts`
- `src/sdk/memory/memory-api.ts`
- `src/sdk/notifications/notification-api.ts`
- `src/sdk/permissions/permission-api.ts`
- `src/sdk/search/search-api.ts`
- `src/sdk/storage/storage-api.ts`
- `src/sdk/timeline/timeline-api.ts`
- `src/sdk/workspace/workspace-api.ts`

### C. Legacy Compatibility Layer (`src/compatibility/` — 15 files)
- `src/compatibility/index.ts`
- `src/compatibility/core/*` (5 files: `compatibility-context.ts`, `compatibility-errors.ts`, `compatibility-factory.ts`, `compatibility-manager.ts`, `compatibility-version.ts`)
- `src/compatibility/interfaces/runtime-adapter.ts`
- `src/compatibility/validation/compatibility-checker.ts`
- `src/compatibility/adapters/*` (8 files: `analytics-adapter.ts`, `event-adapter.ts`, `memory-adapter.ts`, `notification-adapter.ts`, `search-adapter.ts`, `storage-adapter.ts`, `timeline-adapter.ts`, `workspace-adapter.ts`)

### D. Isolated Legacy Tests (6 files)
- `tests/runtime.test.ts`
- `tests/lifecycle.test.ts`
- `tests/manifest.test.ts`
- `tests/capability-registry.test.ts` (Legacy in-memory registry test; canonical test is `tests/capabilities/capability-registry.test.ts`)
- `tests/dependency-resolver.test.ts`
- `tests/sdk/akira-sdk.test.ts`

---

## 4. Exact Files Being Preserved / Adapted in Later Phases

1. **Reasoning Strategies (Target for Phase 4 Adaptation):**
   - `src/genesis/reasoning/strategies/DeductiveReasoningStrategy.ts`
   - `src/genesis/reasoning/strategies/ImplicationReasoningStrategy.ts`
   - `src/genesis/reasoning/strategies/SynthesisReasoningStrategy.ts`
   - `src/genesis/reasoning/types.ts`
2. **Planning Validation Algorithms (To be preserved before planning retirement):**
   - `src/genesis/planning/services/PlanningValidationService.ts` (specifically `checkCycleWithNewDependency` cycle detection)
   - `src/genesis/planning/services/PlanningGraphBuilder.ts` (topological graph construction)

---

## 5. Expected Test Changes Caused Only by Legacy Archival

- **Legacy Test Deactivation:** 6 isolated test suites (~70 legacy tests) move to `archive/legacy-platform/tests/` and are excluded from active vitest runs.
- **Canonical Test Suite:** All 140 canonical tests across production pipelines, capability contracts, and journey tests remain **100% passing**.
- **Architecture Validator:** All 363 assertions remain **100% passing**.
- **TypeScript:** `tsc --noEmit` remains **100% clean**.
- **Vite Build:** `vite build` remains **100% clean**.
