---
phase: "01"
slug: "dynamic-analytics-dashboard"
status: draft
nyquist_compliant: true
wave_0_complete: true
created: "2026-10-05"
---

# Phase 01 — Validation Strategy: Dynamic Analytics Dashboard

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.10 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/analytics` |
| **Full suite command** | `npm run type-check && npx vitest run src/analytics` |
| **Estimated runtime** | ~8 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/analytics`
- **After every plan wave:** Run `npm run type-check && npx vitest run src/analytics`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | ANLYT-01 | — | RPC input validation prevents invalid date injection; excludes better-sqlite3 from client bundle | unit/rpc | `npx vitest run src/analytics/dashboard/server/dashboard-rpc.test.ts` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | ANLYT-01 | — | Hook invalidates TanStack Query cache safely on EventBus notifications | unit/hook | `npx vitest run src/components/analytics/useDashboardQuery.test.ts` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | ANLYT-01 | — | Registry correctly exposes `/tools/analytics` as ready and enabled | unit | `npx vitest run src/akira-os/tools/registry.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 2 | ANLYT-02 | — | Visual widgets render empty, loading, error, and populated states correctly | component | `npx vitest run src/components/analytics/AnalyticsDashboard.test.tsx` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 2 | ANLYT-03 | — | Recharts chart wrappers and route compile cleanly without type or lint errors | static | `npm run type-check && npm run lint` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/analytics/dashboard/server/dashboard-rpc.test.ts` — test stubs for `getDashboardDataRpc` and date bounds
- [ ] `src/components/analytics/useDashboardQuery.test.ts` — test stubs for TanStack Query and EventBus invalidation
- [ ] `src/akira-os/tools/registry.test.ts` — test stubs for tool registry activation
- [ ] `src/components/analytics/AnalyticsDashboard.test.tsx` — test stubs for dashboard UI states

*Existing infrastructure covers all phase requirements (Vitest is installed and configured).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Chart Glassmorphic Aesthetics | ANLYT-02 | Visual gradient rendering and glassmorphic panel styling cannot be fully verified via jsdom unit tests | Open `/tools/analytics` in browser; verify violet/blue glowing bars and donut chart slices render with correct theme tokens |
| Interactive Timeframe Switching | ANLYT-01 | Visual animation and tab transition feedback | Click through `Today`, `Last 7 Days`, `Last 30 Days`, `All Time`; verify active tab pill animates smoothly |
| Header Refresh Spin | ANLYT-03 | CSS animation inspection | Click "Refresh Analytics Data"; verify icon executes smooth spin animation during refetch |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-10-05
