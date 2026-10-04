# Requirements: AKIRA OS

**Defined:** 2026-10-04
**Core Value:** Empower personal growth through an ultra-fast, local-first AI companion that preserves complete data privacy, maintains zero-latency state, and deeply understands the user's journey.

## v1 Requirements

Requirements for active roadmap milestones.

### Analytics & Insights

- [ ] **ANLYT-01**: User can view focus session duration trends over day, week, and month via interactive charts.
- [ ] **ANLYT-02**: User can view task completion velocity and workload distribution across active projects.
- [ ] **ANLYT-03**: System computes focus quality score and streak continuity from recorded session data.

### TITAN Background Processor

- [ ] **TITAN-01**: Unified in-process background worker queue for non-blocking asynchronous jobs.
- [ ] **TITAN-02**: Background worker automatically runs scheduled SQLite WAL checkpointing and database vacuuming.
- [ ] **TITAN-03**: Background worker performs automated local snapshot backups of `akira.db` to configured backup directory.

### Migration Hub & Diagnostics

- [ ] **MIGR-01**: User can create, inspect, and restore point-in-time database snapshot backups via the settings interface.
- [ ] **MIGR-02**: System provides interactive diagnostic health checks validating SQLite schema integrity and FTS5 search index parity.

### Voice Brain Dump

- [ ] **VOIC-01**: User can record continuous voice audio directly from the Brain Dump interface.
- [ ] **VOIC-02**: Audio stream is transcribed into text and parsed into candidate tasks, notes, or focus items.

### VAJRA Executive Reasoning

- [ ] **VJRA-01**: Executive decision deliberation loop evaluates mission objectives against active beliefs.
- [ ] **VJRA-02**: Two-phase dispatch executes capability actions while recording verifiable deliberation traces.

## v2 Requirements

Deferred to future releases.

### Autonomous Sandboxing (FORGE)

- **FORG-01**: Isolated sandbox script runner allowing companion to execute verified shell scripts with user permission.
- **FORG-02**: Automated workspace file management guided by approved mission plans.

### Local On-Device LLM (GENESIS Core)

- **ONDEV-01**: Run local quantized ONNX / GGUF models directly on device hardware without internet connectivity.
- **ONDEV-02**: Hybrid routing between local offline models and cloud inference models based on connectivity.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-user cloud sync | Contradicts local-first single-user desktop privacy architecture |
| Remote SaaS database | All storage strictly resides in local SQLite `akira.db` |
| Direct DB imports in UI | Violates client-server decoupled boundary and breaks web bundling |
| Blocking LLM calls | All AI completions must stream asynchronously without viewport stutter |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ANLYT-01 | Phase 1: Analytics Dashboard | Pending |
| ANLYT-02 | Phase 1: Analytics Dashboard | Pending |
| ANLYT-03 | Phase 1: Analytics Dashboard | Pending |
| TITAN-01 | Phase 2: TITAN Background Processor | Pending |
| TITAN-02 | Phase 2: TITAN Background Processor | Pending |
| TITAN-03 | Phase 2: TITAN Background Processor | Pending |
| MIGR-01 | Phase 3: Migration Hub & Diagnostics | Pending |
| MIGR-02 | Phase 3: Migration Hub & Diagnostics | Pending |
| VOIC-01 | Phase 4: Voice Brain Dump Integration | Pending |
| VOIC-02 | Phase 4: Voice Brain Dump Integration | Pending |
| VJRA-01 | Phase 5: VAJRA Executive Reasoning | Pending |
| VJRA-02 | Phase 5: VAJRA Executive Reasoning | Pending |

**Coverage:**
- v1 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0 ✓

---
*Requirements defined: 2026-10-04*
*Last updated: 2026-10-04 after doc ingest bootstrap*
