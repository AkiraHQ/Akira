---
last_mapped_commit: b9959ee4850c7959b188140c2cbaec38f50c68fc
last_mapped_at: 2026-10-04
---
# Codebase Concerns

**Analysis Date:** 2026-10-04

## Tech Debt

**Monolithic View Controllers:**
- Issue: Several key route and state files have grown into massive monolithic modules containing layout, state subscriptions, business orchestration, and styling.
- Files:
  - `src/routes/brain.tsx` (106 KB)
  - `src/routes/chat.tsx` (64 KB)
  - `src/persistence/akira-store.ts` (47 KB)
  - `src/routes/settings.tsx` (31 KB)
- Impact: High cognitive load when editing, increased risk of regressions, and slow type-checking for these specific files.
- Fix approach: Extract domain subcomponents from `brain.tsx` and `chat.tsx`; slice `akira-store.ts` into modular domain state slices (tasks, notes, sessions, vault).

**Cross-Platform Line Ending Drift (Windows CRLF):**
- Issue: Standard Windows Git checkout (`core.autocrlf = true`) converts line endings to CRLF, triggering thousands of Prettier lint errors (`prettier/prettier: Delete ␍`).
- Files: `.prettierrc`, `.gitattributes`, repository-wide source files.
- Impact: Conceals real lint errors under thousands of line-ending warnings.
- Fix approach: Strictly enforce `"endOfLine": "lf"` in `.prettierrc` and maintain `.gitattributes` text normalization.

## Known Bugs

**Vitest Default Reporter Stderr Suppression:**
- Symptoms: When running tests with default reporter, passing tests suppress stderr, hiding evidence of failed database operations (e.g., `FOREIGN KEY constraint failed`). Tests can appear green despite failed internal writes.
- Files: `tests/genesis-persistence.test.ts`, `src/persistence/`.
- Trigger: Running standard `vitest run` without the dot reporter.
- Workaround: Always run persistence tests using `npx vitest run --reporter=dot`.

## Security Considerations

**Unencrypted Model Provider API Keys:**
- Risk: Google Gemini and OpenRouter API keys are stored in plaintext within the local SQLite `settings` table on the user's local disk.
- Files: `src/persistence/repositories/SqliteSettingsRepository.ts`, `src/genesis/context/ai/provider-manager.ts`.
- Current mitigation: Relies on operating system user-level filesystem permissions; `.env*` files are strictly gitignored.
- Recommendations: Incorporate OS-native secure keystore storage (Windows DPAPI, macOS Keychain) or encrypt values at rest with a user-supplied master passphrase.

**Local Vault File Upload Boundaries:**
- Risk: Malicious file types or executable payloads stored in the user's vault directory.
- Files: `src/akira-os/vault/VaultStorageService.ts`.
- Current mitigation: SHA-256 deduplication and MIME magic-byte validation ensure files match declared content types.
- Recommendations: Block execution permissions on files stored within vault subdirectories.

## Performance Bottlenecks

**Synchronous SQLite Node.js Event Loop Blocking:**
- Problem: `better-sqlite3` operations run synchronously on the Node.js main thread.
- Files: `src/persistence/connection.ts`, `src/persistence/repositories/`.
- Cause: Synchronous C++ SQLite bindings. Heavy queries (e.g., universal full-text search over massive datasets or complex multi-join analytics) can introduce micro-stutters to server functions.
- Improvement path: Ensure queries utilize SQLite indices (FTS5 index, covering indexes), and offload long-running analytical operations to worker threads.

**Cognitive Memory Graph Traversal Scaling:**
- Problem: As autobiographical memory nodes, relationship edges, and reflection logs accumulate, memory graph traversal and ranking could become CPU intensive.
- Files: `src/genesis/memory/`, `src/genesis/relationship/`.
- Cause: In-memory evaluation of recency, decay, and similarity across all historical candidate memories.
- Improvement path: Enforce strict memory retention policies (`src/genesis/retention/policy.ts`) and offload cold memory pruning to background workers.

## Fragile Areas

**Observability Production Bundle Tree-Shaking Seam:**
- Files: `src/observability/auto-compose.ts`, `scripts/verify-observability-reachability.ts`, `package.json` (`sideEffects`).
- Why fragile: Vite production bundler aggressively strips unused exports. If `sideEffects` configuration in `package.json` or module reachability in `src/observability/auto-compose.ts` is broken, telemetry is silently removed from the production bundle.
- Safe modification: Any modification to observability exports must pass `npm run verify:observability`.
- Test coverage: Guarded by dedicated static analysis script `scripts/verify-observability-reachability.ts`.

**SQLite Schema Version & Migration Protocol:**
- Files: `src/persistence/initializer.ts`, `src/persistence/migrations/`.
- Why fragile: Schema versioning is strict (`schema_version = 3`). Adding tables or changing constraints without a sequential migration file causes runtime startup crashes.
- Safe modification: Always add sequential migration files (e.g., `004_*.sql`) and run migration integration tests.

## Scaling Limits

**Total In-Memory Client State Hydration:**
- Current capacity: Excellent performance for thousands of tasks, notes, sessions, and vault files.
- Limit: Memory usage grows linearly with total entities stored because the entire database is hydrated into `akira-store` during initial application boot.
- Scaling path: Transition from complete in-memory hydration to virtualized/paginated store queries for historical records (e.g., completed tasks from previous months, archived notes).

## Dependencies at Risk

**`better-sqlite3` Native Addon:**
- Risk: Native C++ binary dependency requiring compilation via node-gyp if prebuilt binaries are unavailable for the target platform.
- Impact: Node.js major version upgrades or cross-compilation for packaging (Electron, Tauri) can require native rebuild toolchains.
- Migration plan: Maintain prebuilt binary workflows or consider WASM-based SQLite (`@sqlite.org/sqlite-wasm`) if web-only packaging is needed.

**Nitro Beta Framework (`3.0.260603-beta`):**
- Risk: Pre-release beta software bundled with TanStack Start.
- Impact: Potential upstream breaking changes during framework updates.
- Migration plan: Pin package version and upgrade in lockstep with TanStack Start stable releases.

## Missing Critical Features

**TITAN Background Processor:**
- Problem: Background tasks (sync schedules, cold memory pruning, database backups, image thumbnailing) currently lack a unified persistent task queue worker.
- Blocks: Non-blocking maintenance jobs without running during user interactions (`ROADMAP.md` §2.2).

**Dynamic Analytics Dashboard:**
- Problem: Analytics calculation engine exists in `src/analytics/`, but visual dashboard view remains marked as planned (`ROADMAP.md` §2.1).
- Blocks: Rich visualization of focus duration trends and task completion metrics.

## Test Coverage Gaps

**Real-world SSE Streaming UI Interruption Testing:**
- What's not tested: How the chat UI handles mid-stream network dropouts or token malformations during live AI completions (`src/routes/chat.tsx`).
- Files: `src/routes/chat.tsx`, `src/genesis/context/ai/providers/`.
- Risk: UI chat bubble freezing in a perpetual "generating" state upon abnormal stream closure.
- Priority: Medium.

---

*Concerns audit: 2026-10-04*
