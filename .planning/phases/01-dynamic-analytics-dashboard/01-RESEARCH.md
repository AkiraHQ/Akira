# Phase 1: Dynamic Analytics Dashboard - Research

**Researched:** 2026-10-05  
**Domain:** TanStack Start / React 19 / Recharts / SQLite Event-Sourced Analytics  
**Confidence:** HIGH  

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Activate the Analytics tool in the dynamic tool registry (`src/akira-os/tools/registry.ts`) under route `/tools/analytics` by changing `status` to `"ready"` and `enabled` to `true`. Implement the route controller at `src/routes/tools.analytics.tsx`. — **Reversibility:** reversible — standard route and registry entry.
- **D-02:** Build a comprehensive 4-part dashboard layout:
  1. **Top KPI Stat Cards**: Total Focus Time, Current Streak, Productivity/Quality Score, and Completed Tasks.
  2. **Daily Focus Trends**: Bar chart (`BarChart` from Recharts) showing daily focus session duration.
  3. **Project Workload Split**: Donut chart (`PieChart` with inner radius) displaying time distribution across active projects.
  4. **Task Velocity Trend**: Area chart (`AreaChart` with gradient fill) tracking task completion counts over time.
  — **Reversibility:** reversible — pure presentation component layout using existing UI primitives.
- **D-03:** Provide a clean segmented button control with preset filter ranges: `Today`, `Last 7 Days` (default selection), `Last 30 Days`, and `All Time`. Aggregations filter through `AnalyticsQueryOptions` parameters passed to `dashboardService.getDashboard()`. — **Reversibility:** reversible.
- **D-04:** Implement hybrid reactive sync:
  - The dashboard subscribes to `EventBus` events (`SESSION_COMPLETED`, `TASK_UPDATED`) to invalidate TanStack Query cache and trigger instant real-time re-renders upon background or timer updates.
  - Include an explicit "Refresh" button with a spinning animation in the dashboard header for manual on-demand re-sync.
  — **Reversibility:** reversible.

### the agent's Discretion
- Styling uses standard glassmorphic design tokens from `src/styles.css` (`.glass-panel`, `.text-gradient-akira`, `.glass-card`, `.glass-card-hover`, `.btn-glow`) and Radix UI colors.
- Tooltips on Recharts utilize custom themed tooltips (`ChartTooltip` & `ChartTooltipContent` in `src/app/ui/chart.tsx`) conforming to dark mode aesthetics.

### Deferred Ideas (OUT OF SCOPE)
- Export analytics reports as PDF/CSV (reserved for future release).
- Custom calendar date range picker (`react-day-picker`) (deferred in favor of quick preset tabs).
</user_constraints>

<architectural_responsibility_map>
## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Analytics Computation & Event Log Aggregation | Frontend Server (Node/Nitro) | Database/Storage (`akira.db`) | `dashboardService` requires `SqliteEventRepository` and `better-sqlite3`. Native C/C++ bindings cannot run in client web browsers. |
| Server-Client RPC Bridge | Frontend Server (TanStack Start RPC) | Browser/Client | `createServerFn` creates a typed RPC contract that strips server code on client builds, exposing `getDashboardData` cleanly via HTTP. |
| Dashboard Presentation & Chart Visualization | Browser/Client (React 19) | — | Interactive KPI cards, SVG/Canvas Recharts components, hover tooltips, and timeframe tab switching live entirely on the client. |
| Reactive Real-time Sync | Browser/Client (EventBus) | Browser/Client (TanStack Query) | Subscribes in-browser to `globalEventBus` (`session.ended`, `task.updated`), issuing `queryClient.invalidateQueries` without polling. |
| Tool Registry Navigation | Browser/Client (`akira-os/tools`) | TanStack Router | Registry entry marks route `/tools/analytics` as `status: "ready"` and `enabled: true`, surfaced by `/tools` and navigation hubs. |
</architectural_responsibility_map>

<research_summary>
## Summary

Phase 1 surfaces the existing SQLite event-sourced analytics engine (`src/analytics/`) as an interactive, real-time analytics dashboard at `/tools/analytics`. The backend calculation subsystem—including `dashboardService.getDashboard()` [VERIFIED: `src/analytics/dashboard/dashboard-service.ts:18-23`], `DashboardBuilder` [VERIFIED: `src/analytics/dashboard/dashboard-builder.ts:14-110`], `QueryService` [VERIFIED: `src/analytics/service/query-service.ts:26-291`], and six domain calculators—is already implemented and passes all test suites. 

The primary task is constructing the presentation layer and RPC data bridge. The React client cannot directly import `dashboardService` because it references `better-sqlite3` and the local filesystem database [VERIFIED: `src/persistence/connection.ts:8-25`]. To maintain strict client-server decoupling without bundle errors, a TanStack Start `createServerFn` (`getDashboardDataRpc`) must act as the RPC boundary. On the client, a custom hook wraps `@tanstack/react-query` to manage cached dashboard states, timeframe query options, manual re-sync, and reactive cache invalidation via `globalEventBus` [VERIFIED: `src/instrumentation/event-bus.ts:32-137`].

The UI design contract (`01-UI-SPEC.md`) specifies a 4-part layout inside `<Shell layoutMode="scroll">`: (1) Top KPI summary ribbon with violet glow hero metric, (2) Daily focus duration bar chart, (3) Project workload donut chart, and (4) Task completion velocity area chart with linear gradient fill. All charts will be built using the project's existing Recharts wrapper (`ChartContainer` in `src/app/ui/chart.tsx`) and the established design tokens in `src/styles.css`.

**Primary recommendation:** Implement `getDashboardDataRpc` with TanStack Start `createServerFn` in `src/analytics/dashboard/server/index.ts`, activate `/tools/analytics` in `src/akira-os/tools/registry.ts`, and construct modular visualization widgets in `src/components/analytics/` orchestrated by `src/routes/tools.analytics.tsx`.
</research_summary>

<standard_stack>
## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@tanstack/react-start` | ^1.168.26 | Server Functions (`createServerFn`) | Official full-stack framework in repo; cleanly separates server SQLite code from browser client bundles [VERIFIED: `package.json:52`]. |
| `@tanstack/react-router` | ^1.170.16 | File-based Route Controller (`createFileRoute`) | Primary router powering AKIRA shell and tool sub-routes [VERIFIED: `package.json:51`]. |
| `@tanstack/react-query` | ^5.101.1 | Client Data Fetching & Caching | Provides `useQuery`, `useQueryClient`, `staleTime`, and fine-grained cache invalidation for reactive sync [VERIFIED: `package.json:50`]. |
| `recharts` | ^2.15.4 | SVG Chart Rendering (`BarChart`, `PieChart`, `AreaChart`) | Established chart library wrapped by `ChartContainer` in `src/app/ui/chart.tsx` [VERIFIED: `package.json:68`]. |
| `better-sqlite3` | ^12.11.1 | Embedded Database Engine | High-performance synchronous SQLite driver used by event repositories and analytics tables [VERIFIED: `package.json:55`]. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lucide-react` | ^0.575.0 | UI Icons (`BarChart3`, `RotateCw`, `Clock`, `Flame`, `Zap`, `CheckCircle2`) | Iconography for KPI stat cards, headers, empty states, and refresh button [VERIFIED: `package.json:62`]. |
| `date-fns` | ^4.1.0 | Date formatting | Formatting tick marks, tooltip timestamps, and timeframe labels [VERIFIED: `package.json:59`]. |
| `zod` | ^3.24.2 | Route Search Validation | Validating search params (`range`) in `createFileRoute` [VERIFIED: `package.json:75`]. |
| `sonner` | ^2.0.7 | Toast Notifications | Providing non-intrusive feedback on manual refresh errors or sync events [VERIFIED: `package.json:69`]. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `createServerFn` | Client direct import of `dashboardService` | **FATAL**: Direct client import pulls `better-sqlite3` into Vite browser bundle, causing build crash: `Module "fs" / "better-sqlite3" has been externalized for browser compatibility`. |
| `createServerFn` | Custom Express/FastAPI endpoint | Over-engineering: TanStack Start RPC handles type safety, serialization, and endpoint registration automatically. |
| Preset Segmented Tabs | Full date range picker (`react-day-picker`) | Deferred by context: Presets (`Today`, `Last 7 Days`, `Last 30 Days`, `All Time`) cover 99% of desktop workflows with zero UI clutter. |

**Installation:**
No new dependencies are needed. All packages are already installed and declared in `package.json`.
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### System Architecture Diagram

```mermaid
flowchart TD
    subgraph Client ["Browser / Client Runtime"]
        Route["Route Controller: src/routes/tools.analytics.tsx"]
        Hook["useDashboardQuery() Hook\n(@tanstack/react-query)"]
        UI_KPIRibbon["Top KPI Summary Ribbon\n(4 Glassmorphic Cards)"]
        UI_FocusBar["Daily Focus Duration\n(Recharts BarChart)"]
        UI_ProjectDonut["Project Workload Split\n(Recharts PieChart / Donut)"]
        UI_TaskVelocity["Task Completion Velocity\n(Recharts AreaChart + Gradient)"]
        EventBusSub["EventBus Subscriber\n(id: 'analytics-dashboard-sync')"]
    end

    subgraph RPC ["TanStack Start RPC Boundary"]
        ServerFn["getDashboardDataRpc\n(createServerFn at /_serverFn/...)"]
    end

    subgraph Server ["Server Runtime (Node.js / Nitro)"]
        DashService["DashboardService.getDashboard(options)\nsrc/analytics/dashboard/dashboard-service.ts"]
        DashBuilder["DashboardBuilder.build(options)\nsrc/analytics/dashboard/dashboard-builder.ts"]
        QuerySvc["QueryService.executeQuery(...)\nsrc/analytics/service/query-service.ts"]
        Calculators["Domain Calculators\n(Productivity, Activity, Projects, Sessions)"]
        EventStore["SqliteEventRepository / better-sqlite3\nakira.db"]
    end

    subgraph DomainEvents ["In-Memory Event Bus"]
        GlobalBus["globalEventBus\nsrc/instrumentation/event-bus.ts"]
        AppMutations["Workspace Mutations\n(session.ended, task.completed, task.updated)"]
    end

    %% User Interaction Flow
    Route --> Hook
    Hook -->|Fetch / Re-sync| ServerFn
    ServerFn -->|Invoke Server Logic| DashService
    DashService --> DashBuilder
    DashBuilder --> QuerySvc
    QuerySvc --> Calculators
    QuerySvc --> EventStore
    ServerFn -.->|Return DashboardDTO| Hook

    %% UI Rendering Flow
    Hook -->|DashboardDTO| UI_KPIRibbon
    Hook -->|DashboardDTO| UI_FocusBar
    Hook -->|DashboardDTO| UI_ProjectDonut
    Hook -->|DashboardDTO| UI_TaskVelocity

    %% Reactive Invalidation Flow
    AppMutations -->|publish()| GlobalBus
    GlobalBus -->|onEvent()| EventBusSub
    EventBusSub -->|invalidateQueries(['analytics-dashboard'])| Hook
```

### Recommended Project Structure

```
src/
├── akira-os/
│   └── tools/
│       └── registry.ts                     # [MODIFIED] Activate analytics tool (status: "ready", enabled: true)
├── analytics/
│   ├── dashboard/
│   │   ├── dashboard-dto.ts                # [EXISTING] DashboardDTO contract
│   │   ├── dashboard-service.ts            # [EXISTING] Core dashboard service facade
│   │   ├── dashboard-builder.ts            # [EXISTING] Metric compilation & widget builder
│   │   ├── server/
│   │   │   └── index.ts                    # [NEW] createServerFn RPC endpoint (getDashboardDataRpc)
│   │   └── services/
│   │       └── index.ts                    # [NEW] Client-safe service bridge for invoking getDashboardDataRpc
│   └── service/
│       ├── filters.ts                      # [EXISTING] AnalyticsQueryOptions, PredefinedDateRange
│       └── validation.ts                   # [MODIFIED] Add "allTime" support to validateAndResolveQuery
├── components/
│   └── analytics/                          # [NEW] Modular dashboard UI components
│       ├── AnalyticsDashboard.tsx          # Main dashboard coordinator component
│       ├── TimeframeFilter.tsx             # Segmented button controls (Today, Last 7d, Last 30d, All Time)
│       ├── KpiSummaryRibbon.tsx            # Top 4 KPI metric cards (Focus Time, Streak, Quality, Tasks)
│       ├── FocusDurationBarChart.tsx       # Daily focus duration bar chart
│       ├── ProjectWorkloadDonutChart.tsx   # Project time distribution donut chart with custom legend
│       ├── TaskVelocityAreaChart.tsx       # Task completion velocity area chart with gradient fill
│       ├── AnalyticsLoadingSkeleton.tsx    # Card and chart pulse skeletons
│       ├── AnalyticsEmptyState.tsx         # Zero-data empty state container
│       └── useDashboardQuery.ts            # Custom hook wrapping TanStack Query + EventBus sync
└── routes/
    └── tools.analytics.tsx                 # [NEW] TanStack Router route controller at /tools/analytics
```

---

### Pattern 1: TanStack Start RPC Boundary for SQLite Analytics

**What:** Encapsulate SQLite data access within a TanStack Start `createServerFn`.  
**When to use:** Whenever browser components need access to `dashboardService` or any code backed by `better-sqlite3`.  
**Implementation Details:**
- Defined in `src/analytics/dashboard/server/index.ts`:
  ```typescript
  // [VERIFIED: Pattern based on src/akira-os/timeline/server/index.ts:1-29]
  import { createServerFn } from "@tanstack/react-start";
  import { AnalyticsQueryOptions } from "../../service/filters";
  import type { DashboardDTO } from "../dashboard-dto";

  export const getDashboardDataRpc = createServerFn({ method: "GET" })
    .validator((opts?: AnalyticsQueryOptions) => opts)
    .handler(async ({ data: opts }): Promise<DashboardDTO> => {
      // Dynamic import ensures zero server modules bleed into client build
      const { dashboardService } = await import("../dashboard-service");
      return dashboardService.getDashboard(opts);
    });
  ```
- Defined in `src/analytics/dashboard/services/index.ts`:
  ```typescript
  import { getDashboardDataRpc } from "../server";
  import { AnalyticsQueryOptions } from "../../service/filters";
  import type { DashboardDTO } from "../dashboard-dto";

  export const dashboardClientService = {
    async getDashboard(options?: AnalyticsQueryOptions, signal?: AbortSignal): Promise<DashboardDTO> {
      return getDashboardDataRpc({ data: options, signal });
    },
  };
  ```

---

### Pattern 2: Recharts Themed Visualizations via ChartContainer

**What:** Use the existing `ChartContainer` wrapper (`src/app/ui/chart.tsx`) [VERIFIED: `src/app/ui/chart.tsx:35-61`] configured with design tokens from `src/styles.css` [VERIFIED: `src/styles.css:49-53, 91-95`].  
**When to use:** All dashboard charts to ensure responsive scaling, theme injection, and unified tooltip styling.  

**Color Token Mapping:**
- Primary Hero / Focus Bars: `--chart-1` (`oklch(0.68 0.22 295)` - Akira Violet Glow) [VERIFIED: `src/styles.css:91`]
- Task Velocity Area / Stroke: `--chart-2` (`oklch(0.7 0.18 250)` - Electric Blue) [VERIFIED: `src/styles.css:92`]
- Workload Slice 3: `--chart-3` (`oklch(0.85 0.12 200)` - Cyan Glow) [VERIFIED: `src/styles.css:93`]
- Workload Slice 4: `--chart-4` (`oklch(0.6 0.18 320)` - Magenta) [VERIFIED: `src/styles.css:94`]
- Workload Slice 5: `--chart-5` (`oklch(0.75 0.15 220)` - Sky Blue) [VERIFIED: `src/styles.css:95`]

**Bar Chart Pattern (Daily Focus Duration):**
```tsx
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartConfig } from "@/app/ui/chart";

const focusConfig = {
  duration: { label: "Focus Minutes", color: "var(--chart-1)" },
} satisfies ChartConfig;

<ChartContainer config={focusConfig} className="h-64 w-full">
  <BarChart data={focusData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(1 0 0 / 0.08)" />
    <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
    <YAxis tickLine={false} axisLine={false} tickMargin={8} />
    <ChartTooltip content={<ChartTooltipContent />} />
    <Bar dataKey="duration" fill="var(--color-duration)" radius={[6, 6, 0, 0]} />
  </BarChart>
</ChartContainer>
```

**Donut Chart Pattern (Project Workload Split):**
```tsx
import { PieChart, Pie, Cell } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartConfig } from "@/app/ui/chart";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

<ChartContainer config={projectConfig} className="h-64 w-full">
  <PieChart>
    <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
    <Pie
      data={projectData}
      dataKey="value"
      nameKey="name"
      innerRadius={65}
      outerRadius={90}
      paddingAngle={4}
    >
      {projectData.map((_, index) => (
        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="transparent" />
      ))}
    </Pie>
  </PieChart>
</ChartContainer>
```

**Area Chart Pattern (Task Completion Velocity):**
```tsx
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartConfig } from "@/app/ui/chart";

const velocityConfig = {
  tasks: { label: "Completed Tasks", color: "var(--chart-2)" },
} satisfies ChartConfig;

<ChartContainer config={velocityConfig} className="h-64 w-full">
  <AreaChart data={velocityData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
    <defs>
      <linearGradient id="velocityGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.4} />
        <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0.0} />
      </linearGradient>
    </defs>
    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(1 0 0 / 0.08)" />
    <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
    <YAxis tickLine={false} axisLine={false} tickMargin={8} />
    <ChartTooltip content={<ChartTooltipContent />} />
    <Area
      type="monotone"
      dataKey="tasks"
      stroke="var(--chart-2)"
      strokeWidth={2}
      fillOpacity={1}
      fill="url(#velocityGradient)"
    />
  </AreaChart>
</ChartContainer>
```

---

### Pattern 3: EventBus Reactive Invalidation with TanStack Query

**What:** Hook into `globalEventBus` [VERIFIED: `src/instrumentation/event-bus.ts:137`] inside a React `useEffect` to trigger `queryClient.invalidateQueries` whenever workspace activity occurs.  
**When to use:** Mount of `AnalyticsDashboard` component.  
**Target Events:**
- `Events.SESSION_ENDED` (`"session.ended"`) [VERIFIED: `src/contracts/events.ts:16`] & `"session.completed"`
- `Events.TASK_UPDATED` (`"task.updated"`) [VERIFIED: `src/contracts/events.ts:8`]
- `Events.TASK_COMPLETED` (`"task.completed"`) [VERIFIED: `src/contracts/events.ts:7`]

**Implementation:**
```typescript
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { globalEventBus } from "@/instrumentation/event-bus";
import { Events } from "@/contracts/events";
import type { AkiraEvent } from "@/instrumentation/event-types";

export function useDashboardQuery(timeframe: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const subscriber = {
      id: "analytics-dashboard-reactive-sync",
      onEvent: (event: AkiraEvent) => {
        const matchesSession =
          event.type === Events.SESSION_ENDED ||
          event.type === "session.completed" ||
          event.type === "session.stopped";
        const matchesTask =
          event.type === Events.TASK_UPDATED ||
          event.type === Events.TASK_COMPLETED;

        if (matchesSession || matchesTask) {
          queryClient.invalidateQueries({ queryKey: ["analytics-dashboard"] });
        }
      },
    };

    globalEventBus.subscribe(subscriber);
    return () => {
      globalEventBus.unsubscribe(subscriber);
    };
  }, [queryClient]);
}
```

---

### Anti-Patterns to Avoid
- **Anti-Pattern 1: Direct SQLite Imports in Client Components:** Never import `getDatabaseConnection()`, `SqliteEventRepository`, or `dashboardService` directly into `.tsx` route or component files. This breaks the Vite client bundle with Node.js module errors.
- **Anti-Pattern 2: Manual Polling via setInterval:** Never poll the analytics API on a timer. The application already features an in-process `globalEventBus`. Use event subscription for instant updates with zero idle overhead.
- **Anti-Pattern 3: Hardcoded Timezone Adjustments:** Never compute date boundaries using raw UTC without timezone offsets. Use `validateAndResolveQuery` which adjusts local midnight boundaries using client offset minutes [VERIFIED: `src/analytics/service/validation.ts:42-71`].
- **Anti-Pattern 4: Mutating State or Repository from Dashboard:** Analytics is strictly read-only relative to the Event Store and business state [VERIFIED: `docs/adr/ADR-011-analytics-architecture.md:19-21`].
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Client-Server RPC bridge | Custom `fetch('/api/analytics')` routes & handlers | `@tanstack/react-start` `createServerFn` | Built into project, handles serialization, input validation, and automatic endpoint binding with type safety. |
| Client Caching & Invalidation | Custom React state with `useEffect` fetches | `@tanstack/react-query` (`useQuery`, `useQueryClient`) | Automatically manages `staleTime`, background re-fetching, error recovery, and query deduplication [VERIFIED: `package.json:50`]. |
| Responsive SVG Charting | Custom Canvas/SVG math or raw D3 paths | `recharts` + `ChartContainer` wrapper | `ChartContainer` in `src/app/ui/chart.tsx` [VERIFIED: lines 35-61] already handles aspect ratio, resize observers, dark mode CSS variables, and tooltip positioning. |
| Glassmorphic Containers | Custom inline styles or arbitrary CSS blur rules | `.glass-panel`, `.glass-card`, `.glass-card-hover` | Standardized tokens in `src/styles.css` [VERIFIED: lines 139-168] guarantee exact design system compliance. |
| Timezone Boundary Resolution | Custom Date arithmetic string manipulations | `validateAndResolveQuery` | Already tested and compliant with ADR-012/ADR-013 in `src/analytics/service/validation.ts` [VERIFIED: lines 15-72]. |

**Key insight:** The calculation engine, query validation, event bus, chart containers, and design system are already complete in the codebase. Building custom solutions would introduce regressions and redundant maintenance.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Native SQLite Module Bleeding into Client Bundle
**What goes wrong:** Vite compilation fails with `Error: Failed to resolve import "better-sqlite3" from "src/analytics/..."`.  
**Why it happens:** A client component or hook directly imports `dashboard-service.ts`, which imports `analytics-service.ts`, which imports `query-service.ts`, which imports `better-sqlite3`.  
**How to avoid:** Enforce strict architectural separation. The client route ONLY imports `dashboardClientService` from `src/analytics/dashboard/services/index.ts`. The server function in `src/analytics/dashboard/server/index.ts` uses dynamic `await import("../dashboard-service")` inside `.handler()`.  
**Warning signs:** Vite dev server output throwing browser polyfill errors or Rollup complaining about `node:path`, `node:fs`, or `better-sqlite3`.

### Pitfall 2: "All Time" Predefined Range Validation Failure
**What goes wrong:** Clicking the "All Time" tab throws a validation error: `Validation Error: Query must specify startDate and endDate, or a predefined range`.  
**Why it happens:** In `src/analytics/service/filters.ts:9`, `PredefinedDateRange` only includes `"today" | "yesterday" | "last7Days" | "last30Days" | "custom"`. `"allTime"` is missing from `validateAndResolveQuery`.  
**How to avoid:** Update `PredefinedDateRange` in `src/analytics/service/filters.ts` to include `"allTime"`, and update `validateAndResolveQuery` in `src/analytics/service/validation.ts` to map `"allTime"` to `startDate = new Date(0).toISOString()` and `endDate = localEnd`.  
**Warning signs:** Error alerts appearing when selecting the "All Time" segmented tab.

### Pitfall 3: Recharts Tooltip Inversion / White Flashes in Dark Theme
**What goes wrong:** Recharts default tooltips display with bright white backgrounds and black text, breaking the dark cyberpunk glassmorphism theme.  
**Why it happens:** Using default `<Tooltip />` from `recharts` without the custom `ChartTooltipContent` component.  
**How to avoid:** Always use `<ChartTooltip content={<ChartTooltipContent />} />` from `@/app/ui/chart` [VERIFIED: `src/app/ui/chart.tsx:95-239`].  
**Warning signs:** Tooltip boxes appearing with stark white borders or misaligned typography.

### Pitfall 4: Memory Leak from Uncleaned EventBus Listeners
**What goes wrong:** Multiple subscriptions accumulate on `globalEventBus`, causing duplicate query invalidations and degraded performance.  
**Why it happens:** Failing to return `globalEventBus.unsubscribe(subscriber)` in the `useEffect` cleanup return function.  
**How to avoid:** Ensure every `useEffect` creating an event bus subscription returns a proper cleanup function calling `globalEventBus.unsubscribe`.  
**Warning signs:** Console logging multiple duplicate deliveries for a single event in `reportDelivery`.

### Pitfall 5: Sub-Zero / Inverted Date Bounds
**What goes wrong:** `validateAndResolveQuery` throws `Validation Error: End date cannot be before start date`.  
**Why it happens:** Timezone offset calculation inverting UTC bounds across midnight.  
**How to avoid:** Pass browser timezone offset in minutes via `filters.timezone: -new Date().getTimezoneOffset()` so the server validator computes exact local days.  
**Warning signs:** 400 validation errors thrown during late-night or early-morning dashboard views.
</common_pitfalls>

<code_examples>
## Code Examples

### 1. Server RPC Function (`src/analytics/dashboard/server/index.ts`)
```typescript
// Verified pattern based on src/akira-os/timeline/server/index.ts:1-29
import { createServerFn } from "@tanstack/react-start";
import { AnalyticsQueryOptions } from "../../service/filters";
import type { DashboardDTO } from "../dashboard-dto";

export const getDashboardDataRpc = createServerFn({ method: "GET" })
  .validator((opts?: AnalyticsQueryOptions) => opts)
  .handler(async ({ data: opts }): Promise<DashboardDTO> => {
    const start = performance.now();
    const { dashboardService } = await import("../dashboard-service");
    const result = dashboardService.getDashboard(opts);
    const duration = performance.now() - start;
    console.log(`[Observability] Analytics dashboard compiled in ${duration.toFixed(2)}ms`);
    return result;
  });
```

### 2. Client Service Bridge (`src/analytics/dashboard/services/index.ts`)
```typescript
// Verified pattern based on src/akira-os/timeline/services/index.ts:1-30
import { getDashboardDataRpc } from "../server";
import { AnalyticsQueryOptions } from "../../service/filters";
import type { DashboardDTO } from "../dashboard-dto";

export const dashboardClientService = {
  async getDashboard(options?: AnalyticsQueryOptions, signal?: AbortSignal): Promise<DashboardDTO> {
    return getDashboardDataRpc({ data: options, signal });
  },
};
```

### 3. Route Search Validator & Controller (`src/routes/tools.analytics.tsx`)
```tsx
// Verified pattern based on src/routes/tools.vault.tsx:1-37 and src/routes/timeline.tsx:25-46
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Shell } from "@/app/shell/Shell";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";

const analyticsSearchSchema = z.object({
  range: z.enum(["today", "last7Days", "last30Days", "allTime"]).default("last7Days").catch("last7Days"),
});

export const Route = createFileRoute("/tools/analytics")({
  validateSearch: (search) => analyticsSearchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Analytics Dashboard — AKIRA" },
      { name: "description", content: "Focus session duration trends, task velocity, and project distributions." },
    ],
  }),
  component: AnalyticsPageRoute,
});

function AnalyticsPageRoute() {
  const { range } = Route.useSearch();
  return (
    <Shell layoutMode="scroll">
      <AnalyticsDashboard initialRange={range} />
    </Shell>
  );
}

export default AnalyticsPageRoute;
```

### 4. Updating Tool Registry (`src/akira-os/tools/registry.ts`)
```typescript
// [VERIFIED: src/akira-os/tools/registry.ts:38-48]
// Activate Analytics tool:
{
  id: "analytics",
  name: "Analytics",
  description: "Visualize focus sessions, task completion, and growth trends over time.",
  icon: BarChart3,
  route: "/tools/analytics",
  category: "Productivity",
  status: "ready", // Changed from "coming-soon"
  enabled: true,    // Changed from false
  order: 2,
},
```
</code_examples>

<validation_architecture>
## Validation Architecture

The validation architecture covers end-to-end verification across compilation, RPC data integrity, UI state rendering, and reactive synchronization.

### 1. Verification Commands
- **Unit & Integration Tests:**  
  `npx vitest run src/analytics` — Verifies calculators, repositories, and builders.
- **RPC & Query Bridge Tests:**  
  `npx vitest run src/analytics/dashboard/` — Verifies `getDashboardDataRpc` and query filtering.
- **Type Checking:**  
  `npm run type-check` (`tsc --noEmit`) — Validates strict TypeScript compilation and route schema bindings [VERIFIED: `package.json:16`].
- **Linter:**  
  `npm run lint` (`eslint .`) — Enforces project conventions (no `process.exit`, proper imports) [VERIFIED: `package.json:13`].
- **Complete Suite:**  
  `npm run verify` — Runs lint, type-check, vitest run, and observability check [VERIFIED: `package.json:19`].

### 2. Automated Test Matrix

| Layer | Test File | Target Scenarios |
|-------|-----------|------------------|
| Server RPC | `src/analytics/dashboard/server/dashboard-rpc.test.ts` | 1. `getDashboardDataRpc` returns valid `DashboardDTO` with summary, productivity, activity, projects, and sessions.<br>2. Verifies filtering for ranges: `today`, `last7Days`, `last30Days`, and `allTime`.<br>3. Returns zeroed default DTO when event store is empty without throwing.<br>4. Rejects invalid dates where `endDate < startDate`. |
| Client Hook | `src/components/analytics/useDashboardQuery.test.ts` | 1. Subscribes to `globalEventBus` on mount.<br>2. Calls `queryClient.invalidateQueries` when `session.ended` is published.<br>3. Calls `queryClient.invalidateQueries` when `task.updated` is published.<br>4. Unsubscribes from `globalEventBus` on unmount. |
| UI States | `src/components/analytics/AnalyticsDashboard.test.tsx` | 1. Loading state renders skeleton pulse placeholders.<br>2. Empty state renders "No Focus Sessions Recorded" with action guidance when zero data.<br>3. Error state renders alert banner with retry button.<br>4. Populated state renders all 4 KPI cards and 3 Recharts canvases. |
| Tool Registry | `src/akira-os/tools/registry.test.ts` | 1. Verifies `analytics` entry in `toolsRegistry` has `status: "ready"` and `enabled: true`.<br>2. Verifies `getVisibleTools` includes `/tools/analytics`. |

### 3. Manual Interactive Verification Checklist
1. **Navigation:** Navigate to `/tools` -> click the "Analytics" card -> confirm route switches to `/tools/analytics`.
2. **Preset Tabs:** Click `Today`, `Last 7 Days`, `Last 30 Days`, and `All Time` -> verify charts update seamlessly and query parameters sync.
3. **Manual Refresh:** Click "Refresh Analytics Data" in header -> observe spin animation on `RotateCw` icon -> confirm data re-syncs.
4. **Reactive Sync:** Open developer tools or secondary tab -> complete a task in `/tasks` or trigger a focus session in `/sessions` -> confirm dashboard automatically updates without page reload.
5. **Empty State:** Switch to fresh/empty database state -> confirm friendly empty state card renders with copy: *"Start a focus timer or complete a mission task to populate productivity metrics, velocity trends, and project workload breakdowns."*
</validation_architecture>

<sota_updates>
## State of the Art (2024-2026)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express / Next.js `/api/analytics` endpoints | TanStack Start `createServerFn` | 2024 (TanStack Start v1) | Type-safe RPC with zero manual boilerplate; automatic client-server code splitting. |
| REST Polling (`setInterval`) | Event-driven cache invalidation via in-process `EventBus` | Standard Reactive Pattern | Eliminates background database query churn while providing instant UI updates. |
| Monolithic custom chart canvases | Shadcn/Recharts `ChartContainer` wrapper with CSS variables | 2024 (Shadcn Chart Primitive) | Declarative color tokens (`--chart-1` through `--chart-5`), unified tooltips, and responsive layout. |
| Client-side date parsing with Moment.js | Timezone offset minute math with UTC Date bounds | ADR-012 / ADR-013 | Zero heavy bundle overhead; deterministic server-side aggregation. |

**Deprecated/outdated in AKIRA:**
- Direct SQLite imports in UI routes: Prohibited by system architecture. All database access must cross `createServerFn`.
- Hardcoded dark theme overrides in Recharts: Superseded by `ChartContainer` and `ChartTooltipContent` which bind to `@theme inline` variables.
</sota_updates>

<open_questions>
## Open Questions (RESOLVED)

1. **Supporting `"allTime"` in `validateAndResolveQuery`:**
   - RESOLVED: Extend `PredefinedDateRange` with `"allTime"` in `src/analytics/service/filters.ts` and add the boundary case (`startDate: new Date(0).toISOString()`, `endDate: localEnd`) to `validateAndResolveQuery` in `src/analytics/service/validation.ts`.
   - *What we know:* `01-CONTEXT.md` decision D-03 explicitly mandates an `"All Time"` preset range. In `src/analytics/service/filters.ts:9`, `PredefinedDateRange` currently defines `"today" | "yesterday" | "last7Days" | "last30Days" | "custom"`.

2. **Formatting Session Duration in Top KPI Card:**
   - RESOLVED: Format duration cleanly as `Xh Ym` (e.g. `12h 45m`) when duration $\ge 3600$, or `Xm` (e.g. `45m`) when $< 3600$, using tabular font numerals.
   - *What we know:* `summary.sessionDuration` is provided in seconds [VERIFIED: `src/analytics/service/dto.ts:5`].
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- `src/analytics/dashboard/dashboard-service.ts` — Main dashboard entry point returning `DashboardDTO` [VERIFIED: lines 6-25]
- `src/analytics/dashboard/dashboard-dto.ts` — Data contracts for summary, productivity, activity, projects, and sessions [VERIFIED: lines 1-42]
- `src/analytics/dashboard/dashboard-builder.ts` — Metric compilation and widget projection [VERIFIED: lines 1-112]
- `src/analytics/service/query-service.ts` — Query filtering and event compiler execution [VERIFIED: lines 1-292]
- `src/analytics/service/validation.ts` — Predefined date range resolution and timezone validation [VERIFIED: lines 1-111]
- `src/akira-os/tools/registry.ts` — Tool registration metadata and status flags [VERIFIED: lines 1-139]
- `src/app/ui/chart.tsx` — Shadcn Recharts wrapper with `ChartContainer`, `ChartTooltip`, and `ChartLegend` [VERIFIED: lines 1-332]
- `src/instrumentation/event-bus.ts` — `globalEventBus` singleton, subscription API, and delivery isolation [VERIFIED: lines 1-138]
- `src/contracts/events.ts` — Platform domain event constants [VERIFIED: lines 1-118]
- `src/styles.css` — Design system tokens (`--chart-1` to `--chart-5`, `.glass-panel`, `.btn-glow`) [VERIFIED: lines 1-315]
- `docs/adr/ADR-011-analytics-architecture.md`, `ADR-012`, `ADR-013` — Analytics architecture, core metrics, and query layer design records

### Secondary (MEDIUM confidence)
- `src/routes/timeline.tsx` — Reference route demonstrating TanStack Query with virtualization and search schema [VERIFIED: lines 1-120]
- `src/akira-os/timeline/server/index.ts` — Reference implementation of `createServerFn` for data querying [VERIFIED: lines 1-30]
- `src/routes/tools.vault.tsx` — Reference implementation of a sub-tool route inside `<Shell layoutMode="fit">` [VERIFIED: lines 1-37]
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: TanStack Start RPC + TanStack Query + Recharts + SQLite Event Store
- Ecosystem: React 19, Vite, shadcn/ui primitives, lucide-react
- Patterns: RPC code-splitting, Reactive event bus cache invalidation, themed Recharts charts, segmented timeframe tabs
- Pitfalls: Native node module leakage in client builds, date boundary validation, Recharts dark theme styling

**Confidence breakdown:**
- Standard stack: HIGH — All libraries are already installed and used in the codebase
- Architecture: HIGH — Directly conforms to existing patterns in `timeline` and `vault`
- Pitfalls: HIGH — Identified exact failure modes regarding `better-sqlite3` and `validateAndResolveQuery`
- Code examples: HIGH — Verified against live codebase files

**Research date:** 2026-10-05  
**Valid until:** 2026-11-05 (Stable architecture)
</metadata>

---

*Phase: 01-dynamic-analytics-dashboard*  
*Research completed: 2026-10-05*  
*Ready for planning: yes*
