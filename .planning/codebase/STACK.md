---
last_mapped_commit: b9959ee4850c7959b188140c2cbaec38f50c68fc
last_mapped_at: 2026-10-04
---
# Technology Stack

**Analysis Date:** 2026-10-04

## Languages

**Primary:**
- TypeScript 5.8.3 - All application UI, routing, server functions, persistence, GENESIS cognitive architecture, and VAJRA executive layers (`tsconfig.json`, `src/`).

**Secondary:**
- JavaScript (ES2022 / ESNext modules) - Build and lint configuration scripts (`eslint.config.js`, `scripts/`).
- SQL (SQLite dialect) - Database migrations, schema definitions, and prepared statements (`src/persistence/schema.sql`, `src/persistence/migrations/`).

## Runtime

**Environment:**
- Node.js 22.x LTS (ESM mode: `"type": "module"` in `package.json`) for server functions, SQLite bindings, and CLI tooling.
- Modern Evergreen Browser environment supporting DOM, DOM.Iterable, and Web APIs (`tsconfig.json`).
- Bun runtime compatibility layer enabled via `bunfig.toml`.

**Package Manager:**
- npm (lockfile `package-lock.json` present and authoritative).
- Bun compatible (`bunfig.toml` configured).

## Frameworks

**Core:**
- React 19.2.0 - Core declarative user interface library (`src/app/`, `src/routes/`).
- TanStack Router 1.170.16 - Fully type-safe client routing and route loaders (`src/router.tsx`, `src/routeTree.gen.ts`, `src/routes/`).
- TanStack Start 1.168.26 - Full-stack framework coordinating SSR, client hydration, and server RPC functions (`src/start.ts`, `src/server.ts`).
- TanStack React Query 5.101.1 - Async state management and cached data querying (`src/routes/__root.tsx`).
- TanStack Virtual 3.14.6 - High-performance list virtualization for large event logs and timeline streams.
- Tailwind CSS 4.2.1 (`@tailwindcss/vite`) with `tw-animate-css` - Modern utility-first CSS styling and glassmorphic token design (`src/styles.css`).
- Radix UI Primitives (`@radix-ui/*`) & shadcn/ui - Accessible unstyled component primitives (`src/app/ui/`).

**Testing:**
- Vitest 4.1.10 - Fast native unit, integration, and performance benchmarking runner (`vitest.config.ts`, `vitest.bench.config.ts`, `tests/`).
- `@vitest/coverage-v8` 4.1.10 - Native V8 code coverage analyzer.
- tsx - Direct TypeScript execution for verification and migration scripts (`scripts/`).

**Build/Dev:**
- Vite 8.0.16 (`vite`, `@vitejs/plugin-react` 5.2.0, `@lovable.dev/vite-tanstack-config` 2.6.2) - High-speed local dev server and production packager (`vite.config.ts`).
- Nitro 3.0.260603-beta - Server engine embedded within TanStack Start (`vite.config.ts`).
- TypeScript Compiler (`tsc`) 5.8.3 - Static type checking (`npm run type-check`).
- ESLint 9.32.0 (`typescript-eslint` 8.56.1, `eslint-plugin-react-hooks`) - Static analysis enforcing architectural rules such as `process.exit` restrictions (`eslint.config.js`).
- Prettier 3.7.3 - Code style and indentation formatting (`.prettierrc`).

## Key Dependencies

**Critical:**
- `better-sqlite3` 12.11.1 - Synchronous, ultra-fast SQLite driver backing all local-first relational and operational tables (`src/persistence/connection.ts`).
- `@tanstack/react-router` 1.170.16 & `@tanstack/react-start` 1.168.26 - Foundation for routes, loaders, layout management, and `createServerFn` RPC boundaries.
- `zod` 3.24.2 - Strict schema definitions and validation for inputs, event bus messages, and persistent models (`src/instrumentation/`, `src/contracts/`).
- `react-hook-form` 7.71.2 & `@hookform/resolvers` 5.2.2 - Form validation and controlled user input handling (`src/app/ui/form.tsx`).
- `lucide-react` 0.575.0 - Comprehensive UI iconography (`src/app/ui/`, `src/routes/`).

**Infrastructure:**
- `clsx` 2.1.1, `tailwind-merge` 3.5.0, `class-variance-authority` 0.7.1 - Class concatenation and variant styling abstractions (`src/lib/utils.ts`).
- `cmdk` 1.1.1 - Accessible, instant keyboard-driven Command Palette (`src/app/shell/CommandPalette.tsx`).
- `sonner` 2.0.7 - Toast notification messaging system (`src/app/ui/sonner.tsx`).
- `recharts` 2.15.4 - Data visualization charting library for focus duration, task metrics, and analytics.
- `date-fns` 4.1.0 - Date parsing, formatting, and arithmetic utilities (`src/akira-os/sessions/`).

## Configuration

**Environment:**
- No mandatory `.env` required for baseline offline operation. Local SQLite database path defaults to `akira.db` in project root or can be redirected via `process.env.AKIRA_DATABASE_PATH` for tests (`src/persistence/connection.ts`).
- AI model provider keys (Google Gemini, OpenRouter) and active models are persisted into the local SQLite database via `aiProviderManager` and `SqliteSettingsRepository.ts` rather than plaintext environment files.

**Build:**
- `vite.config.ts` - Configures `@lovable.dev/vite-tanstack-config`, custom SSR entrypoint `src/server.ts`, and disables import protection for unified client-server builds.
- `tsconfig.json` - ES2022 target, `Bundler` module resolution, `@/*` path alias mapping to `./src/*`, strict mode enabled.
- `eslint.config.js` - Flat config enforcing React hooks, Prettier integration, and strict prohibition of `process.exit` in `src/`.
- `components.json` - shadcn/ui configuration defining component output paths and Tailwind CSS integration.

## Platform Requirements

**Development:**
- Cross-platform: Windows, macOS, Linux with Node.js >= 20.x or Bun installed.
- C/C++ compiler toolchain (or prebuilt node-gyp binaries) for `better-sqlite3` native addon compilation.

**Production:**
- Desktop-first, local-first target: Distributed as an autonomous local desktop app / client service.
- Local filesystem access required for SQLite WAL mode operations (`akira.db`, `akira.db-wal`, `akira.db-shm`) and local file storage vault (`src/akira-os/vault/`).

---

*Stack analysis: 2026-10-04*
