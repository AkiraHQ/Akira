---
last_mapped_commit: b9959ee4850c7959b188140c2cbaec38f50c68fc
last_mapped_at: 2026-10-04
---
# Testing Patterns

**Analysis Date:** 2026-10-04

## Test Framework

**Runner:**
- Vitest 4.1.10 (`vitest.config.ts`).
- Benchmark Runner: Vitest Bench with dedicated config (`vitest.bench.config.ts`).

**Assertion Library:**
- Vitest standard BDD assertions (`describe`, `it`, `expect`, `vi`, `beforeAll`, `beforeEach`, `afterAll`).

**Run Commands:**

```bash
npm test                                       # Run tests in active watch mode
npm run verify                                 # Full CI pipeline: lint + type-check + vitest run + verify:observability
npx vitest run --reporter=dot                  # Run all tests once with dot reporter (reveals hidden stderr)
npx vitest bench --config vitest.bench.config.ts # Run dedicated performance benchmarks
npm run validate:architecture                  # Validate architectural boundary constraints
npm run verify:observability                   # Verify production bundle reachability for observability
```

## Test File Organization

**Location:**
- Dual strategy:
  1. **Co-located Module Tests:** Placed adjacent to domain code for fast unit feedback (e.g., `src/akira-os/vault/vault.test.ts`, `src/persistence/vault-db.test.ts`).
  2. **Top-Level Integration Suites:** Organized under `tests/` for multi-module integration, contract conformance, journey tests, and benchmarks (e.g., `tests/contracts/`, `tests/production/`, `tests/vajra/`).

**Naming:**
- Unit & Integration Tests: `*.test.ts` or `*.test.tsx`.
- Micro-benchmarks: `*.bench.ts`.

**Structure:**

```text
tests/
├── capabilities/            # Feature capability verification
├── contracts/               # Repository and event bus interface compliance tests
├── production/              # Journey and realistic workload simulations
├── support/                 # Test utilities, temp DB helpers, and perf-ab.ts harness
├── vajra/                   # Operational state, migration, and executive tests
└── *.test.ts                # Deep cognitive and subsystem integration test files
```

## Test Structure

**Suite Organization:**

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import path from "path";
import fs from "fs";
import { getDatabaseConnection, closeDatabaseConnection } from "@/persistence/connection";
import { initializeDatabase } from "@/persistence/initializer";

describe("Vault Storage Service", () => {
  const testDbPath = path.resolve(__dirname, "temp_e2e_akira.db");

  beforeAll(() => {
    process.env.AKIRA_DATABASE_PATH = testDbPath;
    initializeDatabase();
  });

  beforeEach(() => {
    const db = getDatabaseConnection();
    db.prepare("DELETE FROM vault_files").run();
    db.prepare("DELETE FROM vault_folders").run();
  });

  afterAll(() => {
    closeDatabaseConnection();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it("should enforce SHA-256 deduplication on duplicate file uploads", async () => {
    // Test logic here
    expect(true).toBe(true);
  });
});
```

## Mocking

**Database Mocking & Isolation:**
- Rather than in-memory mocking libraries, SQLite tests redirect the connection to a temporary disk database (`temp_e2e_akira.db`) via `process.env.AKIRA_DATABASE_PATH`.
- This executes actual `better-sqlite3` statements against the real schema, verifying foreign keys, CHECK constraints, and triggers under real database behavior.

**UI & State Mocking:**
- `akira-store` supports testing via `akira.initializeState(mockState)`.
- Client route testing wraps views in `@tanstack/react-router` using `createMemoryHistory()`.

**What to Mock:**
- External AI model network responses (`Gemini` / `OpenRouter` HTTP fetch calls).
- Browser-specific objects when executing in Node test runners.

**What NOT to Mock:**
- SQLite database statements: Run queries against real temporary SQLite instances.
- Zod schema validation: Always execute actual parsing logic.

## Fixtures and Factories

**Test Data:**
- Factory builders construct domain objects conforming to interfaces in `src/contracts/`.
- Seed data scripts in `src/persistence/seed.ts` provide initial fixture states.

**Location:**
- `tests/support/`: Contains `perf-ab.ts` and test isolation helpers.

## Coverage

**Requirements:**
- High test coverage across persistence, migrations, and cognitive engines.
- Invariant: Core migrations and cognitive algorithms must pass without swallowed errors.

**View Coverage:**

```bash
npx vitest run --coverage
```

## Test Types

**Unit Tests:**
- Validate discrete algorithms (e.g., memory importance decay, string sanitizers, intent classification).

**Integration Tests:**
- Verify SQLite queries, transaction rollbacks, trigger cascades, and event bus pub/sub delivery.

**Micro-benchmarks:**
- Executed via `tests/**/*.bench.ts` using `vitest.bench.config.ts`.
- Tests use `interleavedAB()` from `tests/support/perf-ab.ts` to ensure repeatable, timing-invariant metrics.

## Common Patterns

**Async Testing:**

```typescript
it("should complete asynchronous event dispatching", async () => {
  const result = await asyncServiceCall();
  expect(result.status).toBe("success");
});
```

**Database Constraint Error Verification:**

```typescript
it("should reject invalid CHECK constraint values", () => {
  const db = getDatabaseConnection();
  expect(() => {
    db.prepare("INSERT INTO tasks (id, title, priority) VALUES (?, ?, ?)").run("t-1", "Task", "InvalidPriority");
  }).toThrow(/CHECK constraint failed/);
});
```

**Reporter Caveat:**
- Under Vitest's default reporter, `stderr` emitted during passing tests is suppressed.
- When modifying database or persistence code, run `npx vitest run --reporter=dot` to surface any suppressed `FOREIGN KEY constraint failed` messages.

---

*Testing analysis: 2026-10-04*
