# Phase 01: Dynamic Analytics Dashboard - Context

**Gathered:** 2026-10-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Connect the existing analytics calculation engine (`src/analytics/`) to a rich, user-facing visual dashboard accessible at `/tools/analytics`. The dashboard visualizes focus session duration trends, task completion velocity, project workload distributions, and continuity metrics (streaks, focus quality score) inside the glassmorphic desktop workspace shell.

</domain>

<decisions>
## Implementation Decisions

### Navigation & Routing
- **D-01:** Activate the Analytics tool in the dynamic tool registry (`src/akira-os/tools/registry.ts`) under route `/tools/analytics` by changing `status` to `"ready"` and `enabled` to `true`. Implement the route controller at `src/routes/tools.analytics.tsx`. — **Reversibility:** reversible — standard route and registry entry.

### Visualizations & Layout
- **D-02:** Build a comprehensive 4-part dashboard layout:
  1. **Top KPI Stat Cards**: Total Focus Time, Current Streak, Productivity/Quality Score, and Completed Tasks.
  2. **Daily Focus Trends**: Bar chart (`BarChart` from Recharts) showing daily focus session duration.
  3. **Project Workload Split**: Donut chart (`PieChart` with inner radius) displaying time distribution across active projects.
  4. **Task Velocity Trend**: Area chart (`AreaChart` with gradient fill) tracking task completion counts over time.
  — **Reversibility:** reversible — pure presentation component layout using existing UI primitives.

### Timeframe Filtering & Aggregation
- **D-03:** Provide a clean segmented button control with preset filter ranges: `Today`, `Last 7 Days` (default selection), `Last 30 Days`, and `All Time`. Aggregations filter through `AnalyticsQueryOptions` parameters passed to `dashboardService.getDashboard()`. — **Reversibility:** reversible.

### Data Freshness & Sync
- **D-04:** Implement hybrid reactive sync:
  - The dashboard subscribes to `EventBus` events (`SESSION_COMPLETED`, `TASK_UPDATED`) to invalidate TanStack Query cache and trigger instant real-time re-renders upon background or timer updates.
  - Include an explicit "Refresh" button with a spinning animation in the dashboard header for manual on-demand re-sync.
  — **Reversibility:** reversible.

### Builder Discretion
- Styling uses standard glassmorphic design tokens from `src/styles.css` (`.glass-panel`, `.text-gradient-akira`) and Radix UI colors.
- Tooltips on Recharts utilize custom themed tooltips conforming to dark mode aesthetics.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Analytics Subsystem Architecture & Queries
- `src/analytics/dashboard/dashboard-service.ts` — Main dashboard entry point returning `DashboardDTO`
- `src/analytics/dashboard/dashboard-dto.ts` — Data structure definitions for summary, productivity, activity, projects, and sessions
- `src/analytics/service/query-service.ts` — Query execution and filtering logic
- `docs/adr/ADR-011-analytics-architecture.md` — Analytics architecture design record
- `docs/adr/ADR-012-core-metrics-framework.md` — Metric calculation specifications
- `docs/adr/ADR-013-analytics-query-layer.md` — Query layer and caching policies

### Workspace Shell & Tool Registry
- `src/app/shell/Shell.tsx` — Glassmorphic layout wrapper (`fit` vs `scroll` modes)
- `src/akira-os/tools/registry.ts` — Dynamic registry where `analytics` tool is activated
- `docs/adr/ADR-001-workspace-shell.md` — Shell design constraints and navigation integration
- `docs/adr/ADR-002-tool-registry.md` — Tool registration and permission filtering

### UI Primitives & Charting
- `src/app/ui/chart.tsx` — Recharts wrapper and responsive container configurations
- `src/app/ui/card.tsx` — Standard glassmorphic card containers

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/analytics/dashboard/dashboard-service.ts`: Already implements complete aggregation logic via `dashboardService.getDashboard(options)`.
- `src/app/ui/chart.tsx`: Configured with ChartContainer, ChartTooltip, ChartLegend using Tailwind color variables.
- `src/instrumentation/event-bus.ts`: EventBus singleton ready for subscribing to lifecycle and domain events.

### Established Patterns
- Client-Server RPC boundary: React route cannot directly import SQLite repositories; a TanStack Start `createServerFn` (e.g., `fetchDashboardData`) must bridge the client component to `dashboardService.getDashboard()`.
- Route layout: Routes mount child content inside `<Shell title="Analytics" mode="scroll">`.

### Integration Points
- `src/routes/tools.analytics.tsx`: New route file picked up automatically by TanStack Router plugin.
- `src/akira-os/tools/registry.ts`: Update tool status to activate in both Sidebar and `/tools` index.

</code_context>

<specifics>
## Specific Ideas
- Clean desktop aesthetic with glow effects matching the Akira cyberpunk/glassmorphic theme.
- Responsive grid layout: KPI cards in a 4-column row on top, two main charts in the middle grid, workload donut and detailed breakdown below.

</specifics>

<deferred>
## Deferred Ideas
- Export analytics reports as PDF/CSV (reserved for future release).
- Custom calendar date range picker (`react-day-picker`) (deferred in favor of quick preset tabs).

</deferred>

---

*Phase: 01-dynamic-analytics-dashboard*
*Context gathered: 2026-10-05*
