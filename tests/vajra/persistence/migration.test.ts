import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { SqliteOperationalStateStore } from "../../../src/persistence/vajra/sqlite-operational-state-store";

describe("VAJRA Migration 003 — Structural & Schema Invariant Tests", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    // Bootstrap v1 schema
    const schemaPath = path.join(process.cwd(), "src", "persistence", "schema.sql");
    const schemaContent = fs.readFileSync(schemaPath, "utf8");
    db.exec(schemaContent);
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (1, ?)").run(
      new Date().toISOString(),
    );
  });

  afterEach(() => {
    db.close();
  });

  it("applies migration 003 DDL and advances schema_version to 3", () => {
    const migrationPath = path.join(
      process.cwd(),
      "src",
      "persistence",
      "migrations",
      "003_vajra_operational_state.sql",
    );
    const ddl = fs.readFileSync(migrationPath, "utf8");

    db.transaction(() => {
      db.exec(ddl);
      db.prepare(
        `
        INSERT OR IGNORE INTO vajra_operational_state (
          id, current_focus, operational_mode, human_presence, system_health_status, version, updated_at
        ) VALUES ('singleton', 'Awaiting human directive', 'REQUEST_DRIVEN', 'FOCUSED_ACTIVE', 'NOMINAL', 1, ?)
      `,
      ).run(new Date().toISOString());
      db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (3, ?)").run(
        new Date().toISOString(),
      );
    })();

    const versionRow = db
      .prepare("SELECT MAX(version) as max_version FROM schema_version")
      .get() as { max_version: number };
    expect(versionRow.max_version).toBe(3);
  });

  it("creates all 7 required VAJRA tables", () => {
    const migrationPath = path.join(
      process.cwd(),
      "src",
      "persistence",
      "migrations",
      "003_vajra_operational_state.sql",
    );
    db.exec(fs.readFileSync(migrationPath, "utf8"));

    const expectedTables = [
      "vajra_operational_state",
      "vajra_missions",
      "vajra_mission_steps",
      "vajra_beliefs",
      "vajra_escalations",
      "vajra_deliberation_traces",
      "vajra_verifications",
    ];

    for (const table of expectedTables) {
      const found = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table);
      expect(found, `Table ${table} should exist`).toBeDefined();
    }
  });

  it("verifies the exact column count of 80 across all 7 tables", () => {
    const migrationPath = path.join(
      process.cwd(),
      "src",
      "persistence",
      "migrations",
      "003_vajra_operational_state.sql",
    );
    db.exec(fs.readFileSync(migrationPath, "utf8"));

    const tableColumnExpectations: Record<string, number> = {
      vajra_operational_state: 8,
      vajra_missions: 14,
      vajra_mission_steps: 15,
      vajra_beliefs: 9,
      vajra_escalations: 12,
      vajra_deliberation_traces: 13,
      vajra_verifications: 9,
    };

    let totalColumns = 0;
    for (const [table, expectedCount] of Object.entries(tableColumnExpectations)) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all();
      expect(cols.length, `Table ${table} should have ${expectedCount} columns`).toBe(
        expectedCount,
      );
      totalColumns += cols.length;
    }

    expect(totalColumns).toBe(80);
  });

  it("verifies all 6 foreign key constraints are established", () => {
    const migrationPath = path.join(
      process.cwd(),
      "src",
      "persistence",
      "migrations",
      "003_vajra_operational_state.sql",
    );
    db.exec(fs.readFileSync(migrationPath, "utf8"));

    // Check FKs on vajra_operational_state
    const stateFks = db.prepare("PRAGMA foreign_key_list(vajra_operational_state)").all() as any[];
    expect(
      stateFks.some((f) => f.table === "vajra_missions" && f.from === "active_mission_id"),
    ).toBe(true);

    // Check FKs on vajra_mission_steps
    const stepFks = db.prepare("PRAGMA foreign_key_list(vajra_mission_steps)").all() as any[];
    expect(stepFks.some((f) => f.table === "vajra_missions" && f.from === "mission_id")).toBe(true);

    // Check FKs on vajra_escalations
    const escFks = db.prepare("PRAGMA foreign_key_list(vajra_escalations)").all() as any[];
    expect(escFks.some((f) => f.table === "vajra_missions" && f.from === "mission_id")).toBe(true);
    expect(escFks.some((f) => f.table === "vajra_mission_steps" && f.from === "step_id")).toBe(
      true,
    );

    // Check FKs on vajra_verifications
    const verFks = db.prepare("PRAGMA foreign_key_list(vajra_verifications)").all() as any[];
    expect(verFks.some((f) => f.table === "vajra_missions" && f.from === "mission_id")).toBe(true);
    expect(verFks.some((f) => f.table === "vajra_mission_steps" && f.from === "step_id")).toBe(
      true,
    );

    const totalFkCount = stateFks.length + stepFks.length + escFks.length + verFks.length;
    expect(totalFkCount).toBe(6);
  });

  it("verifies all 19 explicit indexes exist", () => {
    const migrationPath = path.join(
      process.cwd(),
      "src",
      "persistence",
      "migrations",
      "003_vajra_operational_state.sql",
    );
    db.exec(fs.readFileSync(migrationPath, "utf8"));

    const expectedIndexes = [
      "idx_vajra_missions_state",
      "idx_vajra_missions_correlation",
      "idx_vajra_missions_idempotency",
      "idx_vajra_single_running_mission",
      "idx_vajra_steps_mission_order",
      "idx_vajra_steps_state",
      "idx_vajra_steps_idempotency",
      "idx_vajra_steps_correlation",
      "idx_vajra_beliefs_state",
      "idx_vajra_beliefs_eval",
      "idx_vajra_escalations_status",
      "idx_vajra_escalations_mission",
      "idx_vajra_escalations_correlation",
      "idx_vajra_traces_correlation",
      "idx_vajra_traces_stimulus",
      "idx_vajra_traces_created",
      "idx_vajra_verifications_step",
      "idx_vajra_verifications_mission",
      "idx_vajra_verifications_correlation",
    ];

    for (const indexName of expectedIndexes) {
      const idx = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
        .get(indexName);
      expect(idx, `Index ${indexName} should exist`).toBeDefined();
    }

    expect(expectedIndexes.length).toBe(19);
  });

  it("enforces CHECK constraints across entities", () => {
    const migrationPath = path.join(
      process.cwd(),
      "src",
      "persistence",
      "migrations",
      "003_vajra_operational_state.sql",
    );
    db.exec(fs.readFileSync(migrationPath, "utf8"));

    // 1. Operational State: id must be singleton
    expect(() => {
      db.prepare(
        `
        INSERT INTO vajra_operational_state (id, current_focus, operational_mode, human_presence, system_health_status, version, updated_at)
        VALUES ('not-singleton', 'focus', 'REQUEST_DRIVEN', 'FOCUSED_ACTIVE', 'NOMINAL', 1, '2026-10-04T00:00:00Z')
      `,
      ).run();
    }).toThrow();

    // 2. Operational State: invalid mode
    expect(() => {
      db.prepare(
        `
        INSERT INTO vajra_operational_state (id, current_focus, operational_mode, human_presence, system_health_status, version, updated_at)
        VALUES ('singleton', 'focus', 'INVALID_MODE', 'FOCUSED_ACTIVE', 'NOMINAL', 1, '2026-10-04T00:00:00Z')
      `,
      ).run();
    }).toThrow();

    // 3. Missions: invalid lifecycle_state
    expect(() => {
      db.prepare(
        `
        INSERT INTO vajra_missions (id, objective, lifecycle_state, definition_json, state_json, current_step_order, allocated_budget_json, idempotency_key, request_id, correlation_id, invocation_id, created_at, updated_at)
        VALUES ('m-1', 'obj', 'INVALID_STATE', '{}', '{}', 0, '{}', 'k-1', 'req-1', 'corr-1', 'inv-1', '2026-10-04T00:00:00Z', '2026-10-04T00:00:00Z')
      `,
      ).run();
    }).toThrow();

    // 4. Beliefs: confidence must be in [0.0, 1.0]
    expect(() => {
      db.prepare(
        `
        INSERT INTO vajra_beliefs (id, proposition, confidence, verification_state, supporting_evidence_ids_json, contradicting_evidence_ids_json, last_evaluated_at, created_at)
        VALUES ('b-1', 'prop', 1.5, 'UNVERIFIED', '[]', '[]', '2026-10-04T00:00:00Z', '2026-10-04T00:00:00Z')
      `,
      ).run();
    }).toThrow();

    expect(() => {
      db.prepare(
        `
        INSERT INTO vajra_beliefs (id, proposition, confidence, verification_state, supporting_evidence_ids_json, contradicting_evidence_ids_json, last_evaluated_at, created_at)
        VALUES ('b-2', 'prop', -0.1, 'UNVERIFIED', '[]', '[]', '2026-10-04T00:00:00Z', '2026-10-04T00:00:00Z')
      `,
      ).run();
    }).toThrow();

    // 5. Verifications: invalid outcome
    expect(() => {
      db.prepare(
        `
        INSERT INTO vajra_verifications (id, mission_id, step_id, outcome, evidence_ids_json, correlation_id, invocation_id, recorded_at)
        VALUES ('v-1', 'm-1', 's-1', 'INVALID_OUTCOME', '[]', 'c-1', 'i-1', '2026-10-04T00:00:00Z')
      `,
      ).run();
    }).toThrow();
  });

  it("rolls back the migration transaction atomically if an error occurs", () => {
    expect(() => {
      db.transaction(() => {
        db.exec("CREATE TABLE vajra_test_temp (id TEXT PRIMARY KEY)");
        // Throw an error mid-transaction
        throw new Error("Simulated migration failure");
      })();
    }).toThrow("Simulated migration failure");

    const tempTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vajra_test_temp'")
      .get();
    expect(tempTable).toBeUndefined();
  });
});

describe("VAJRA Migration 004 — Evidence Hash & Recovery Safety Invariant Tests", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    // Bootstrap v1 schema
    const schemaPath = path.join(process.cwd(), "src", "persistence", "schema.sql");
    db.exec(fs.readFileSync(schemaPath, "utf8"));
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (1, ?)").run(
      new Date().toISOString(),
    );

    // Bootstrap v3 schema (migration 003)
    const mig3Path = path.join(
      process.cwd(),
      "src",
      "persistence",
      "migrations",
      "003_vajra_operational_state.sql",
    );
    db.exec(fs.readFileSync(mig3Path, "utf8"));
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (3, ?)").run(
      new Date().toISOString(),
    );
  });

  afterEach(() => {
    db.close();
  });

  it("applies migration 004 DDL adding evidence_hash, recovery_classification and index", () => {
    // Verify before migration
    const initialCols = db.prepare("PRAGMA table_info(vajra_mission_steps)").all() as {
      name: string;
    }[];
    expect(initialCols.some((c) => c.name === "evidence_hash")).toBe(false);
    expect(initialCols.some((c) => c.name === "recovery_classification")).toBe(false);

    // Apply migration 004
    const mig4Path = path.join(
      process.cwd(),
      "src",
      "persistence",
      "migrations",
      "004_vajra_evidence_and_recovery_safety.sql",
    );
    const ddl = fs.readFileSync(mig4Path, "utf8");
    db.exec(ddl);

    const afterCols = db.prepare("PRAGMA table_info(vajra_mission_steps)").all() as {
      name: string;
    }[];
    expect(afterCols.some((c) => c.name === "evidence_hash")).toBe(true);
    expect(afterCols.some((c) => c.name === "recovery_classification")).toBe(true);

    const indexRow = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_vajra_steps_recovery_classification'",
      )
      .get();
    expect(indexRow).toBeDefined();
  });

  it("safely handles repeated migration 004 execution using the initializer's idempotent guards", () => {
    // Helper executing the exact idempotent migration logic from src/persistence/initializer.ts
    const runInitializerMigration004 = (database: Database.Database) => {
      const versionRow = database
        .prepare("SELECT MAX(version) as current_version FROM schema_version")
        .get() as { current_version: number } | undefined;
      const currentVersion = versionRow?.current_version ?? 0;

      if (currentVersion < 4) {
        database.transaction(() => {
          const stepColumns = database.prepare("PRAGMA table_info(vajra_mission_steps)").all() as {
            name: string;
          }[];
          const hasEvidenceHash = stepColumns.some((c) => c.name === "evidence_hash");
          const hasRecoveryClassification = stepColumns.some(
            (c) => c.name === "recovery_classification",
          );

          if (!hasEvidenceHash) {
            database.exec("ALTER TABLE vajra_mission_steps ADD COLUMN evidence_hash TEXT;");
          }
          if (!hasRecoveryClassification) {
            database.exec(
              "ALTER TABLE vajra_mission_steps ADD COLUMN recovery_classification TEXT;",
            );
          }
          database.exec(
            "CREATE INDEX IF NOT EXISTS idx_vajra_steps_recovery_classification ON vajra_mission_steps (recovery_classification);",
          );

          database
            .prepare("INSERT INTO schema_version (version, applied_at) VALUES (4, ?)")
            .run(new Date().toISOString());
        })();
      }
    };

    // Run 1: Applies migration to v4
    expect(() => runInitializerMigration004(db)).not.toThrow();
    const versionAfterRun1 = db
      .prepare("SELECT MAX(version) as current_version FROM schema_version")
      .get() as { current_version: number };
    expect(versionAfterRun1.current_version).toBe(4);

    // Run 2: Re-executing on database already at version 4 is safe and idempotent
    expect(() => runInitializerMigration004(db)).not.toThrow();
    const versionAfterRun2 = db
      .prepare("SELECT MAX(version) as current_version FROM schema_version")
      .get() as { current_version: number };
    expect(versionAfterRun2.current_version).toBe(4);

    // Verify columns exist once and table is valid
    const cols = db.prepare("PRAGMA table_info(vajra_mission_steps)").all() as { name: string }[];
    expect(cols.filter((c) => c.name === "evidence_hash").length).toBe(1);
    expect(cols.filter((c) => c.name === "recovery_classification").length).toBe(1);
  });

  it("ensures SqliteOperationalStateStore compatibility initialization is completely idempotent across multiple instances", () => {
    // Repeated instantiation of SqliteOperationalStateStore on the same database
    expect(() => new SqliteOperationalStateStore(db)).not.toThrow();
    expect(() => new SqliteOperationalStateStore(db)).not.toThrow();
    expect(() => new SqliteOperationalStateStore(db)).not.toThrow();

    const cols = db.prepare("PRAGMA table_info(vajra_mission_steps)").all() as { name: string }[];
    expect(cols.filter((c) => c.name === "evidence_hash").length).toBe(1);
    expect(cols.filter((c) => c.name === "recovery_classification").length).toBe(1);
  });
});
