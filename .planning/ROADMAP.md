# Roadmap: AKIRA OS

## Overview

AKIRA OS is advancing from its completed local-first workspace foundation (Projects, Tasks, Notes, Vault, Focus Sessions, GENESIS Memory Graph, and VAJRA Operational State) toward full operational and companion autonomy. This roadmap establishes upcoming milestones: building a dynamic user-facing analytics dashboard, deploying the TITAN background worker processor, establishing client database migration and backup tools, introducing continuous Voice Brain Dump ingestion, and activating VAJRA's executive reasoning loops.

## Phases

- [ ] **Phase 1: Dynamic Analytics Dashboard** - Connect analytics engine to interactive UI charts visualizing focus trends, task velocity, and project workloads.
- [ ] **Phase 2: TITAN Background Processor** - Build an in-process persistent background queue worker for automated backups, WAL checkpoints, and vacuuming.
- [ ] **Phase 3: Migration Hub & Diagnostics** - Implement a settings-integrated management interface for database snapshots, restores, and integrity diagnostics.
- [ ] **Phase 4: Voice Brain Dump Integration** - Integrate speech-to-text audio streaming that converts spoken thoughts into structured workspace items.
- [ ] **Phase 5: VAJRA Executive Reasoning** - Implement executive deliberation loops and two-phase dispatch for autonomous mission evaluation.

## Phase Details

### Phase 1: Dynamic Analytics Dashboard
**Goal**: Provide rich visual analytics for focus sessions, daily mission completion rates, and project workloads using the existing analytics engine and Recharts.
**Depends on**: Nothing (foundation ready in `src/analytics/`)
**Requirements**: ANLYT-01, ANLYT-02, ANLYT-03
**Success Criteria** (what must be TRUE):
  1. User can view interactive focus session charts filtered by day, week, and month without UI lag.
  2. Task completion velocity and project workload breakdowns render accurately from SQLite session data.
  3. Focus quality score and streak continuity metrics display prominently on the dashboard.
**Plans**: 2 plans

Plans:
- [ ] 01-01: Connect analytics query service to UI state hooks and data aggregation layers.
- [ ] 01-02: Build responsive Recharts visual dashboard in the workspace shell with glassmorphic styling.

### Phase 2: TITAN Background Processor
**Goal**: Establish an in-process asynchronous task worker queue executing scheduled and background maintenance operations without blocking the main event loop.
**Depends on**: Phase 1
**Requirements**: TITAN-01, TITAN-02, TITAN-03
**Success Criteria** (what must be TRUE):
  1. Background worker queue processes tasks asynchronously without degrading main UI responsiveness.
  2. Scheduled SQLite WAL checkpoints and database optimizations run automatically on interval.
  3. Automated point-in-time database snapshot backups are safely generated to disk.
**Plans**: 2 plans

Plans:
- [ ] 02-01: Implement persistent in-process task queue and scheduler service.
- [ ] 02-02: Implement SQLite WAL maintenance, vacuum, and backup worker jobs.

### Phase 3: Migration Hub & Diagnostics
**Goal**: Expose an intuitive user interface for database health inspection, manual and automated backup restoration, and schema verification.
**Depends on**: Phase 2
**Requirements**: MIGR-01, MIGR-02
**Success Criteria** (what must be TRUE):
  1. User can view database health metrics and trigger schema integrity diagnostics from Settings.
  2. Point-in-time database snapshots can be created, exported, and restored safely with rollback protections.
**Plans**: 2 plans

Plans:
- [ ] 03-01: Create server RPCs for database snapshot export, restore, and schema diagnostic validation.
- [ ] 03-02: Implement Migration Hub view in Settings with status indicators and restore workflows.

### Phase 4: Voice Brain Dump Integration
**Goal**: Enable continuous voice audio recording and speech-to-text processing that translates stream audio into structured notes, tasks, and ideas.
**Depends on**: Phase 1
**Requirements**: VOIC-01, VOIC-02
**Success Criteria** (what must be TRUE):
  1. User can initiate and stop voice recording directly inside the Brain Dump interface.
  2. Voice input is transcribed into clean text and parsed into candidate workspace items.
**Plans**: 2 plans

Plans:
- [ ] 04-01: Build audio recording capture hooks and speech transcription pipeline.
- [ ] 04-02: Implement entity extraction parsing transcribed voice streams into structured tasks and notes.

### Phase 5: VAJRA Executive Reasoning
**Goal**: Activate the executive deliberation engine on top of Phase 3 durable operational state, allowing VAJRA to reason about missions, evaluate evidence, and dispatch capabilities.
**Depends on**: Phase 2
**Requirements**: VJRA-01, VJRA-02
**Success Criteria** (what must be TRUE):
  1. Executive loop deliberates on mission objectives against active beliefs with full trace recording.
  2. Two-phase dispatch executes capability actions while recording verifiable deliberation traces in SQLite.
**Plans**: 2 plans

Plans:
- [ ] 05-01: Implement deliberative reasoning loop evaluating objectives against belief networks.
- [ ] 05-02: Wire executive capability dispatch with operational state audit logging.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Dynamic Analytics Dashboard | 0/2 | Not started | - |
| 2. TITAN Background Processor | 0/2 | Not started | - |
| 3. Migration Hub & Diagnostics | 0/2 | Not started | - |
| 4. Voice Brain Dump Integration | 0/2 | Not started | - |
| 5. VAJRA Executive Reasoning | 0/2 | Not started | - |

---
*Roadmap defined: 2026-10-04*
*Last updated: 2026-10-04 after doc ingest bootstrap*
