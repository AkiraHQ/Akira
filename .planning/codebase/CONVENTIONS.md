---
last_mapped_commit: b9959ee4850c7959b188140c2cbaec38f50c68fc
last_mapped_at: 2026-10-04
---
# Coding Conventions

**Analysis Date:** 2026-10-04

## Naming Patterns

**Files:**
- React Components: PascalCase (e.g., `src/app/shell/Shell.tsx`, `src/app/ui/button.tsx`).
- Domain Services: PascalCase (e.g., `src/akira-os/vault/VaultStorageService.ts`, `src/genesis/identity/services/IdentityService.ts`).
- Repository Contracts & Classes: PascalCase (e.g., `src/contracts/NoteRepository.ts`, `src/persistence/repositories/SqliteNoteRepository.ts`).
- Utilities & Infrastructure Modules: kebab-case (e.g., `src/persistence/connection.ts`, `src/instrumentation/event-bus.ts`).
- Route Controllers: kebab-case matching URL paths (e.g., `src/routes/daily-mission.tsx`, `src/routes/projects.$id.tsx`).

**Functions:**
- camelCase with explicit verb prefix (e.g., `getDatabaseConnection()`, `initializeDatabase()`, `parseUserIntent()`).

**Variables:**
- camelCase (e.g., `activeProvider`, `apiKeyInput`, `isHydrated`).
- Constants & Enums: UPPER_SNAKE_CASE (e.g., `DEFAULT_PAGE_SIZE`, `MAX_RETRIES`).

**Types & Interfaces:**
- PascalCase (e.g., `WorkspaceProvider`, `MissionLifecycleState`, `NoteInput`).
- Rule: Use `interface` for contracts, services, and structural shapes; use `type` for unions, intersections, and primitives.

## Code Style

**Formatting:**
- Prettier 3.7.3 configured via `.prettierrc`.
- Key settings:
  - `"semi": true`
  - `"tabWidth": 2`
  - `"singleQuote": false`
  - `"trailingComma": "all"`
  - `"endOfLine": "lf"` (Strict LF line endings to avoid CRLF Git diff inflation)

**Linting:**
- ESLint 9.32.0 flat config in `eslint.config.js`.
- Key rules:
  - `no-restricted-properties`: `process.exit` is strictly prohibited inside `src/` (allowed only in `scripts/` CLI entrypoints).
  - `no-restricted-imports`: Disallows Next.js `server-only`; TanStack Start requires `*.server.ts` or `@tanstack/react-start/server-only`.
  - `react-hooks/rules-of-hooks`: Enforces correct React hook placement.
  - TypeScript strict typing enabled via `tsconfig.json`.

## Import Organization

**Order:**
1. React core packages (`import { useState, useEffect } from "react";`).
2. Third-party vendor packages (`@tanstack/react-router`, `lucide-react`, `zod`).
3. Internal alias imports using `@/` (`import { Shell } from "@/app/shell/Shell";`).
4. Local relative sibling/parent files (`import { TaskRow } from "./TaskRow";`).
5. Stylesheet assets (`import "@/styles.css";`).

**Path Aliases:**
- The `@/*` path alias maps directly to `src/*` (`tsconfig.json`).
- Invariant: Deep relative path traversals (e.g., `../../app/shell/Shell`) are prohibited in favor of `@/*`.

## Error Handling

**Patterns:**
- **Optimistic State Reversion:** Client services catch failed server RPC mutations and revert optimistic state in `akira-store` while triggering a user notification via Sonner toast (`toast.error(...)`).
- **Database Transactions:** SQLite multi-step operations execute inside `db.transaction()` blocks to guarantee atomicity and rollback on failure (`src/persistence/initializer.ts`).
- **Defensive Error Boundaries:** Server-side request handlers catch unhandled rejections in `src/server.ts` without terminating the process.
- **Diagnostic Telemetry:** Errors in background routines report to `DiagnosticsService.reportError(...)` instead of throwing unhandled exceptions.

## Logging

**Framework:**
- In-process diagnostic service (`src/observability/diagnostics/diagnostics-service.ts`) and typed event bus (`src/instrumentation/event-bus.ts`).

**Patterns:**
- Raw `console.log` is avoided in production application code.
- Operational metrics, lifecycle state changes, and audit trails publish via `EventBus.publish(eventType, payload)`.
- Critical system faults record via `diagnosticsService.reportError(source, error)`.

## Comments

**When to Comment:**
- Document complex domain logic, mathematical decay formulations (e.g., memory importance decay in `src/genesis/memory/`), and SQLite concurrency/locking rationale.
- Maintain existing comments and docstrings across refactors.

**JSDoc/TSDoc:**
- Used on public interfaces, repository contracts (`src/contracts/`), and exported service methods to explain parameters, invariants, and return values.

## Function Design

**Size:**
- Single responsibility; extract complex UI branches into dedicated subcomponents.

**Parameters:**
- Functions with more than two parameters should accept a structured parameter object (e.g., `{ data, options }`).

**Return Values:**
- Explicit return types are required for all public services, repository methods, and contract APIs (e.g., `async add(input: NoteInput): Promise<string>`).

## Module Design

**Exports:**
- Named exports are preferred across components, utilities, and services. Default exports are reserved for TanStack Router file-based route definitions (`export default function RouteComponent()`).

**Barrel Files:**
- Clean public facades provided via `index.ts` files (e.g., `src/genesis/index.ts`, `src/observability/index.ts`, `src/persistence/repositories/index.ts`). Internal module files should not create circular cross-barrel dependencies.

---

*Convention analysis: 2026-10-04*
