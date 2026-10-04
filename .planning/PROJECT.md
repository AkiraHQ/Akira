# AKIRA OS

## What This Is

AKIRA is a desktop-first, local-first AI companion focused on helping one person become a better version of themselves. It combines an offline-first workspace operating system (Projects, Tasks, Notes, Vault, Focus Sessions, Daily Missions) with twin cognitive architectures: GENESIS for autobiographical human memory and narrative reflection, and VAJRA for persistent autonomous executive operations.

## Core Value

Empower personal growth through an ultra-fast, local-first AI companion that preserves complete data privacy, maintains zero-latency state, and deeply understands the user's journey.

## Business Context

- **Customer**: Personal single-user desktop companion (self-improving individual).
- **Revenue model**: Local-first personal software; no remote subscriptions or cloud vendor lock-in.
- **Success metric**: Daily mission completion rate, focus session durability, and companion recall relevance.

## Requirements

### Validated

- ✓ **SHELL-01**: Unified glassmorphic desktop canvas with responsive fit/scroll layout modes (`ADR-001`).
- ✓ **REG-01**: Dynamic tool registry with permission and developer-mode visibility filters (`ADR-002`).
- ✓ **STATE-01**: Optimistic in-memory reactive state cache (`akira-store`) with zero-latency UI updates.
- ✓ **SQL-01**: Authoritative local SQLite storage (`better-sqlite3` in WAL mode) with automated FTS5 search and timeline triggers.
- ✓ **VAULT-01**: Local file vault with SHA-256 content deduplication and magic-byte MIME validation.
- ✓ **GENESIS-01**: Cognitive AI companion with read-only workspace adapter and autobiographical memory graph (`ADR-001` - `ADR-014`).
- ✓ **VAJRA-01**: Durable operational state layer tracking missions, steps, beliefs, deliberation traces, and verifications (`003_vajra_operational_state.sql`).
- ✓ **OBS-01**: In-process telemetry, health registry, diagnostic ring buffers, and bundle-reachability guarantees (`ADR-021`, `ADR-022`).

### Active

- [ ] **ANALYTICS-01**: User-facing analytics dashboard visualizing focus duration trends, task completion velocity, and workload distribution.
- [ ] **TITAN-01**: Persistent background task processor for non-blocking database optimizations, thumbnail generation, and automated backups.
- [ ] **MIGRATE-01**: Migration hub and database diagnostics interface for integrity checks and point-in-time snapshots.
- [ ] **VOICE-01**: Voice Brain Dump integration with continuous speech-to-text transcription converting stream audio into structured notes and tasks.
- [ ] **VAJRA-02**: Executive reasoning loops and decision deliberation engine.

### Out of Scope

- Cloud multi-tenant authentication — Single-user desktop architecture; no external cloud auth providers (Firebase, Supabase, Auth0).
- Remote database hosting — Core database must always remain local SQLite on device hard drive.
- Synchronous LLM blocking on UI thread — All AI completion passes stream asynchronously without locking the viewport.
- Heavy viewport math in feature modules — `Shell.tsx` owns layout; modules strictly use Flexbox/Grid.

## Context

- **Technical Environment**: React 19, TypeScript 5.8, Vite 8, TanStack Router & Start, SQLite (`better-sqlite3`), Tailwind CSS.
- **Cognitive Separation**: GENESIS remembers the human and their experiences; VAJRA remembers its own executive and operational decisions.
- **Development Philosophy**: Humans decide the product; AI writes the implementation. Preserve simplicity. Never overengineer.

## Constraints

- **Local-First Persistence**: All user data, notes, and tasks reside in local SQLite (`akira.db`).
- **Client-Server Seam**: UI components never import `better-sqlite3` or persistence database connections.
- **Process Integrity**: `process.exit` is strictly prohibited inside `src/` (enforced by ESLint).
- **Read-Only Cognitive Boundary**: GENESIS has no direct write handle to workspace entities (`projects`, `tasks`, `notes`).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| ADR-001 Workspace Canvas Shell | Centralize layout, navigation, and glassmorphic canvas in `Shell.tsx` | ✓ Good |
| ADR-002 Tool Registry | Dynamic registration with developer-mode overrides | ✓ Good |
| ADR-003 SSR & RPC Serialization | TanStack Start `createServerFn` bridges client and server without exposing DB | ✓ Good |
| ADR-004 Repository Pattern | Abstract database queries behind pure TypeScript interfaces | ✓ Good |
| ADR-006 Module Contract | Strict architectural rules for module isolation and state mutation | ✓ Good |
| GENESIS ADR-001 Memory/AI Separation | Adaptive memory engine decoupled from specific LLM providers | ✓ Good |
| GENESIS ADR-002 Story-First Memory | Structure autobiographical memories into narrative story arcs | ✓ Good |
| GENESIS ADR-003 Emergent Identity | Unsupervised discovery of companion personality traits from interactions | ✓ Good |
| GENESIS ADR-004 Context Builder | Decouple context resolution from prompt serialization | ✓ Good |
| VAJRA Operational State Isolation | Separate operational state (`vajra_*`) from user business tables | ✓ Good |
| Observability Bundle Reachability | Enforce auto-composition so telemetry is not tree-shaken | ✓ Good |

---
*Last updated: 2026-10-04 after doc ingest bootstrap*
