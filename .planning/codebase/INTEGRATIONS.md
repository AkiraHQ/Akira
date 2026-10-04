---
last_mapped_commit: b9959ee4850c7959b188140c2cbaec38f50c68fc
last_mapped_at: 2026-10-04
---
# External Integrations

**Analysis Date:** 2026-10-04

## APIs & External Services

**Cognitive AI Providers:**
- Google Gemini - Powers companion generative intelligence, intent resolution, context synthesis, and proactive initiative suggestions (`src/genesis/context/ai/providers/gemini-provider.ts`).
  - SDK/Client: Direct fetch / HTTP REST API with Server-Sent Events (SSE) streaming reader.
  - Model: Google Gemini Flash 2.5 (`gemini-2.5-flash`).
  - Auth: API key stored locally in SQLite `settings` table, retrieved via `aiProviderManager.getApiKey("Gemini")`.
- OpenRouter - Aggregated cognitive model provider enabling user-selected reasoning models (e.g., Nvidia Nemotron, DeepSeek, Anthropic, Meta Llama) (`src/genesis/context/ai/providers/openrouter-provider.ts`).
  - SDK/Client: Standard REST client targeting OpenRouter API endpoint (`https://openrouter.ai/api/v1/chat/completions`) with streaming support.
  - Auth: API key stored locally in SQLite `settings` table, retrieved via `aiProviderManager.getApiKey("OpenRouter")`.
- Future Providers: OpenAI and direct Anthropic endpoints are planned and architecturally reserved in `src/routes/settings.tsx`.

## Data Storage

**Databases:**
- SQLite (`better-sqlite3` 12.11.1) - The primary authoritative storage engine for all workspace data and operational state (`src/persistence/connection.ts`).
  - Connection: Local disk path `akira.db` in workspace root, redirected via `process.env.AKIRA_DATABASE_PATH` for test suites (`tests/`, `src/persistence/`).
  - PRAGMAs: `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`, `auto_vacuum = INCREMENTAL`.
  - Schema Version: Version 3 (`schema_version = 3`).
  - Schema Tables:
    - Business tables: `projects`, `tasks`, `notes`, `sessions`, `settings`, `timeline_events`, `conversations`, `vault_files`, `vault_folders`, `vault_tags`.
    - Search Virtual Table: `fts_workspace` (SQLite FTS5 virtual table indexing projects, tasks, and notes with automated sync triggers).
    - Operational tables (VAJRA Phase 3): `vajra_operational_state`, `vajra_missions`, `vajra_mission_steps`, `vajra_beliefs`, `vajra_escalations`, `vajra_deliberation_traces`, `vajra_verifications`.

**File Storage:**
- Local Filesystem Vault (`src/akira-os/vault/`):
  - Local disk directory storage for user files, attachments, and thumbnails.
  - SHA-256 hash deduplication ensures files with identical byte content are stored once.
  - Magic-byte MIME type validation verifies file integrity on upload.
  - Worker thread processing for image thumbnails (`src/workers/thumbnail-worker.ts`).

**Caching:**
- In-Memory Reactive Cache: `akira-store` (`src/persistence/akira-store.ts`) provides zero-latency client state reads using `useSyncExternalStore`.
- React Query Cache: Query deduplication and hydration in React components (`src/routes/__root.tsx`).
- Graph Memory Cache: In-memory adjacency and story indices inside GENESIS cognitive services (`src/genesis/memory/`, `src/genesis/relationship/`).

## Authentication & Identity

**Auth Provider:**
- Custom / Local-first single-user architecture.
- No external authentication provider (Auth0, Firebase, Supabase, Cognito are intentionally absent).
- Access control relies on local machine operating system permissions and physical device security.
- Companion Identity: Emergent cognitive self-model (`src/genesis/identity/`) tracking personality facets, values, habits, preferences, and goals entirely in memory and SQLite.

## Monitoring & Observability

**Error Tracking:**
- Local In-Memory Diagnostic & Error Pipeline (`src/observability/errors/`, `src/observability/diagnostics/`):
  - Errors are captured into an in-memory ring buffer for inspection via the developer Brain Inspector (`src/routes/brain.tsx`).
  - No external crash telemetry (e.g., Sentry, Bugsnag) is used, keeping all diagnostic traces private and on-device.

**Logs & Telemetry:**
- In-process event bus (`src/instrumentation/event-bus.ts`, `src/instrumentation/publisher.ts`) publishes typed lifecycle and domain events.
- SQLite Database Triggers automatically log mutating user events into `timeline_events` table for auditability.
- Resource sampling (`src/observability/resources/resource-sampler.ts`) samples memory heap and event loop lag.
- Observability auto-composition (`src/observability/auto-compose.ts`) ensures telemetry is reachable and not tree-shaken from production builds.

## CI/CD & Deployment

**Hosting:**
- Primary: Desktop-first local execution.
- Secondary: Web deployable using TanStack Start and Nitro with Cloudflare or Node.js target presets (`vite.config.ts`).

**CI Pipeline:**
- GitHub Actions (`.github/workflows/`) runs the complete verification suite on pull requests and commits:
  - Linting: `npm run lint`
  - Type checking: `npm run type-check`
  - Unit & Integration Tests: `vitest run`
  - Observability Reachability: `npm run verify:observability`
  - Architecture Validation: `npm run validate:architecture`

## Environment Configuration

**Required env vars:**
- None required for standard offline operation. The app runs out-of-the-box with default local SQLite storage.

**Optional env vars:**
- `AKIRA_DATABASE_PATH` - Override path for the SQLite database file (used heavily in automated testing and isolation suites).

**Secrets location:**
- Model provider API keys (Gemini, OpenRouter) are stored in the user's local `akira.db` SQLite database (`settings` table via `SqliteSettingsRepository.ts`), entered via the Settings view (`src/routes/settings.tsx`).
- No `.env` files are tracked in version control (`.gitignore` protects all `.env*` files).

## Webhooks & Callbacks

**Incoming:**
- None. AKIRA OS is an offline-first desktop environment without exposed public HTTP webhook listeners.

**Outgoing:**
- None. Outgoing network traffic is strictly limited to user-requested AI completion calls (`Google Gemini` and `OpenRouter` APIs) over HTTPS.

---

*Integration audit: 2026-10-04*
