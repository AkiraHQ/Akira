/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { executeMigration } from "../src/persistence/migration-impl";
import { initializeDatabase } from "../src/persistence/initializer";
import { getDatabaseConnection, closeDatabaseConnection } from "../src/persistence/connection";

const TEMP_DB_PATH = path.join(process.cwd(), "src", "persistence", "temp_test_phase2.db");

let passCount = 0;
let failCount = 0;
const failures: { scenario: string; message: string }[] = [];

function setupTestDb() {
  cleanupTestDb();
  process.env.AKIRA_DATABASE_PATH = TEMP_DB_PATH;
  initializeDatabase();
  return getDatabaseConnection();
}

function cleanupTestDb() {
  closeDatabaseConnection();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEMP_DB_PATH + suffix;
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch (err) {
        // ignore error
      }
    }
  }
}

let currentScenario = "";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    failCount++;
    failures.push({ scenario: currentScenario, message });
  } else {
    console.log(`  [PASS] ${message}`);
    passCount++;
  }
}

const realisticPayload = {
  projects: [
    {
      id: "proj-001",
      name: "AKIRA Core",
      tag: "Work",
      description: "Main project",
      progress: 65,
      color: "from-blue-500 to-purple-600",
      nextTask: "Deploy v1.1",
      notes: "Ship it",
      timeSpentMinutes: 480,
      lastWorked: "2026-07-15T18:00:00Z",
      createdAt: "2026-06-01T08:00:00Z",
      icon: "cpu",
    },
    {
      id: "proj-002",
      name: "Fitness",
      tag: "Personal",
      description: "Health goals",
      progress: 30,
      color: "from-green-400 to-emerald-600",
      nextTask: "Run 10k",
      notes: "",
      timeSpentMinutes: 120,
      lastWorked: "2026-07-14T07:00:00Z",
      createdAt: "2026-06-15T10:00:00Z",
      icon: "dumbbell",
    },
  ],
  tasks: [
    {
      id: "task-001",
      title: "Write validators",
      description: "E2E tests",
      priority: "High",
      estimatedDuration: 60,
      dueDate: "2026-07-16T18:00:00Z",
      done: false,
      completed: false,
      projectId: "proj-001",
      createdAt: "2026-07-15T09:00:00Z",
      updatedAt: "2026-07-15T09:30:00Z",
    },
    {
      id: "task-002",
      title: "Schema review",
      description: null,
      priority: "Medium",
      estimatedDuration: 30,
      dueDate: null,
      done: true,
      completed: true,
      projectId: "proj-001",
      createdAt: "2026-07-14T08:00:00Z",
      updatedAt: "2026-07-14T12:00:00Z",
    },
    {
      id: "task-003",
      title: "Morning run",
      description: "5k easy pace",
      priority: "Low",
      estimatedDuration: 45,
      dueDate: "2026-07-16T06:00:00Z",
      done: false,
      completed: false,
      projectId: "proj-002",
      createdAt: "2026-07-15T06:00:00Z",
      updatedAt: "2026-07-15T06:00:00Z",
    },
  ],
  notes: [
    {
      id: "note-001",
      title: "Architecture Notes",
      content: "SQLite chosen for durability.",
      tags: ["architecture", "sqlite"],
      createdAt: "2026-07-10T10:00:00Z",
      updatedAt: "2026-07-10T10:05:00Z",
      pinned: true,
      favorite: false,
      projectId: "proj-001",
    },
    {
      id: "note-002",
      title: "Gym Log",
      content: "Bench 185lbs x 5.",
      tags: ["fitness"],
      createdAt: "2026-07-14T17:00:00Z",
      updatedAt: "2026-07-14T17:00:00Z",
      pinned: false,
      favorite: true,
      projectId: "proj-002",
    },
  ],
  sessions: [
    {
      id: "sess-001",
      projectId: "proj-001",
      task: "Schema design",
      startedAt: "2026-07-14T09:00:00Z",
      endedAt: "2026-07-14T11:00:00Z",
      duration: 120,
      notes: "Designed all tables",
    },
    {
      id: "sess-002",
      projectId: "proj-002",
      task: "Evening jog",
      startedAt: "2026-07-14T18:00:00Z",
      endedAt: "2026-07-14T18:45:00Z",
      duration: 45,
      notes: null,
    },
  ],
  profile: { name: "Lovshik", role: "Builder", motto: "Ship daily" },
  activeSession: {
    projectId: "proj-001",
    task: "Write validators",
    startedAt: "2026-07-16T00:00:00Z",
  },
  lastProjectId: "proj-001",
  chat: [
    { id: "msg-001", role: "user", text: "Let's build this", createdAt: "2026-07-15T11:00:00Z" },
    {
      id: "msg-002",
      role: "akira",
      text: "Ready when you are.",
      createdAt: "2026-07-15T11:00:05Z",
    },
  ],
  streaks: [
    { id: "strk-001", label: "Coding", icon: "cpu", days: 12, pct: 100, color: "from-blue-500" },
    {
      id: "strk-002",
      label: "Exercise",
      icon: "dumbbell",
      days: 3,
      pct: 60,
      color: "from-green-400",
    },
  ],
};

async function runTests() {
  console.log("=== PHASE 2: EXTENDED MIGRATION VALIDATION TESTS ===\n");

  // ===== Scenario 7: SQLite Persistence After Restart =====
  currentScenario = "Scenario 7: SQLite Persistence After Restart";
  console.log(`\n${currentScenario}`);
  try {
    const db = setupTestDb();
    executeMigration(db, JSON.stringify(realisticPayload));

    // Close connection (simulate app shutdown)
    closeDatabaseConnection();

    // Re-open connection (simulate app restart)
    const db2 = getDatabaseConnection();

    // Verify all data persists
    const projects = db2.prepare("SELECT * FROM projects").all() as any[];
    assert(projects.length === 2, "Projects persist after restart (count=2)");
    assert(
      projects.some((p: any) => p.name === "AKIRA Core"),
      "AKIRA Core project persists",
    );
    assert(
      projects.some((p: any) => p.name === "Fitness"),
      "Fitness project persists",
    );

    const tasks = db2.prepare("SELECT * FROM tasks").all() as any[];
    assert(tasks.length === 3, "Tasks persist after restart (count=3)");

    const notes = db2.prepare("SELECT * FROM notes").all() as any[];
    assert(notes.length === 2, "Notes persist after restart (count=2)");

    const sessions = db2.prepare("SELECT * FROM sessions").all() as any[];
    assert(sessions.length === 2, "Sessions persist after restart (count=2)");

    const settings = db2.prepare("SELECT * FROM settings").all() as any[];
    assert(
      settings.length === 5,
      "Settings persist after restart (count=5: profile, active_session, last_project_id, chat, streaks)",
    );

    // Verify migration does NOT re-run
    const res = executeMigration(db2, JSON.stringify(realisticPayload));
    assert(res.success === true, "Re-run returns success: true");
    assert(res.status === "already_completed", "Re-run returns status: 'already_completed'");

    // Verify no duplicates after re-run attempt
    const projectsAfter = db2.prepare("SELECT COUNT(*) as cnt FROM projects").get() as {
      cnt: number;
    };
    assert(projectsAfter.cnt === 2, "No duplicate projects after restart + re-run attempt");
  } catch (err: any) {
    console.error(`${currentScenario} crashed:`, err);
    failCount++;
    failures.push({ scenario: currentScenario, message: `CRASH: ${err.message}` });
  } finally {
    cleanupTestDb();
  }

  // ===== Scenario 8: CRUD Persistence Verification =====
  currentScenario = "Scenario 8: CRUD Persistence Verification";
  console.log(`\n${currentScenario}`);
  try {
    const db = setupTestDb();
    executeMigration(db, JSON.stringify(realisticPayload));

    // Test INSERT (Create)
    db.prepare(
      `
      INSERT INTO projects (id, name, tag, description, progress, color, next_task, notes, time_spent_minutes, last_worked, created_at, updated_at, icon)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      "proj-new",
      "New Post-Migration Project",
      "Work",
      "Created after migration",
      0,
      "from-red-500",
      null,
      null,
      0,
      null,
      new Date().toISOString(),
      new Date().toISOString(),
      "rocket",
    );

    const newProj = db.prepare("SELECT * FROM projects WHERE id = ?").get("proj-new") as any;
    assert(newProj !== undefined, "INSERT: New project created successfully");
    assert(newProj.name === "New Post-Migration Project", "INSERT: Project name correct");

    // Test UPDATE (Update)
    db.prepare("UPDATE projects SET progress = ?, name = ?, updated_at = ? WHERE id = ?").run(
      80,
      "AKIRA Core v2",
      new Date().toISOString(),
      "proj-001",
    );
    const updated = db.prepare("SELECT * FROM projects WHERE id = ?").get("proj-001") as any;
    assert(updated.progress === 80, "UPDATE: Project progress updated to 80");
    assert(updated.name === "AKIRA Core v2", "UPDATE: Project name updated");

    // Test DELETE
    db.prepare("DELETE FROM tasks WHERE id = ?").run("task-002");
    const deletedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get("task-002");
    assert(deletedTask === undefined, "DELETE: Task removed successfully");

    // Verify foreign key cascade (sessions should cascade on project delete)
    const sessCountBefore = (
      db.prepare("SELECT COUNT(*) as cnt FROM sessions WHERE project_id = ?").get("proj-002") as any
    ).cnt;
    assert(sessCountBefore === 1, "CASCADE pre-check: 1 session linked to proj-002");
    db.prepare("DELETE FROM projects WHERE id = ?").run("proj-002");
    const sessCountAfter = (
      db.prepare("SELECT COUNT(*) as cnt FROM sessions WHERE project_id = ?").get("proj-002") as any
    ).cnt;
    assert(sessCountAfter === 0, "CASCADE: Sessions deleted when parent project deleted");

    // Verify tasks get SET NULL on project delete
    const orphanTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get("task-003") as any;
    assert(orphanTask !== undefined, "SET NULL: Task still exists after project delete");
    assert(
      orphanTask.project_id === null,
      "SET NULL: Task project_id set to null after project delete",
    );

    // Verify notes get SET NULL on project delete
    const orphanNote = db.prepare("SELECT * FROM notes WHERE id = ?").get("note-002") as any;
    assert(orphanNote !== undefined, "SET NULL: Note still exists after project delete");
    assert(
      orphanNote.project_id === null,
      "SET NULL: Note project_id set to null after project delete",
    );
  } catch (err: any) {
    console.error(`${currentScenario} crashed:`, err);
    failCount++;
    failures.push({ scenario: currentScenario, message: `CRASH: ${err.message}` });
  } finally {
    cleanupTestDb();
  }

  // ===== Scenario 9: Runtime Cutover Verification =====
  currentScenario = "Scenario 9: Runtime Cutover Verification";
  console.log(`\n${currentScenario}`);
  try {
    const db = setupTestDb();

    // Verify persist(), load(), and STORAGE_KEY are completely removed
    const storeSource = fs.readFileSync(
      path.join(process.cwd(), "src", "persistence", "akira-store.ts"),
      "utf8",
    );
    // The cutover this scenario checks is localStorage -> SQLite-via-services.
    // `STORAGE_KEY`, `load()` and `persist()` were the three parts of the old
    // browser-storage implementation, and asserting their names were gone was a
    // fair proxy for it at the time.
    //
    // It stopped being one. `persist()` exists again and is a different
    // function: it write-throughs to the repository services and, since the
    // foreign-key race, chains those writes so a task cannot reach SQLite
    // before the project it belongs to. The check failed on a name while the
    // architecture it protects was satisfied -- and it would have kept failing
    // however the persistence layer was written, because "persist" is the
    // obvious name for the thing this store is supposed to do.
    //
    // So the assertion is now the invariant rather than the vocabulary: the
    // store must not read or write browser storage. `STORAGE_KEY` stays as part
    // of that, since it is a name only the old implementation had.
    assert(
      !storeSource.includes("localStorage") && !storeSource.includes("sessionStorage"),
      "akira-store.ts persists through services, not browser storage",
    );
    assert(
      !storeSource.includes("STORAGE_KEY"),
      "STORAGE_KEY is completely removed from akira-store.ts",
    );
    assert(
      storeSource.includes("let state: AkiraState = seed();") ||
        storeSource.includes("let state = seed();"),
      "akira-store.ts directly initializes state with seed()",
    );

    // Verify CRUD operations dispatch to services
    assert(
      storeSource.includes('import("../akira-os/projects")'),
      "addProject dispatches to projectsService",
    );
    assert(
      storeSource.includes('import("../akira-os/tasks")'),
      "task operations dispatch to tasksService",
    );
    assert(
      storeSource.includes('import("../akira-os/notes")'),
      "note operations dispatch to notesService",
    );
    assert(
      storeSource.includes('import("../akira-os/sessions")'),
      "session operations dispatch to sessionsService",
    );
    assert(
      storeSource.includes('import("../akira-os/settings")'),
      "settings operations dispatch to settingsService",
    );
  } catch (err: any) {
    console.error(`${currentScenario} crashed:`, err);
    failCount++;
    failures.push({ scenario: currentScenario, message: `CRASH: ${err.message}` });
  } finally {
    cleanupTestDb();
  }

  // ===== Scenario 10: Repository & Server Boundary Verification =====
  currentScenario = "Scenario 10: Repository & Server Boundary Verification";
  console.log(`\n${currentScenario}`);
  try {
    // Verify all repositories have server-side guards
    const repoDir = path.join(process.cwd(), "src", "persistence", "repositories");
    // Repositories only. `timeline-fallback-durability.test.ts` lives in this
    // directory and is a vitest file, not a repository -- it has no browser
    // guard because it never runs in a browser, and requiring one of it made
    // this scenario permanently red for a file the rule was never about.
    const repoFiles = fs
      .readdirSync(repoDir)
      .filter((f) => f.endsWith(".ts") && f !== "index.ts" && !f.endsWith(".test.ts"));

    for (const file of repoFiles) {
      const content = fs.readFileSync(path.join(repoDir, file), "utf8");
      assert(
        content.includes('typeof window !== "undefined"'),
        `${file}: Has server-side guard (typeof window check)`,
      );
    }

    // Verify connection.ts and initializer.ts also have guards
    const connSource = fs.readFileSync(
      path.join(process.cwd(), "src", "persistence", "connection.ts"),
      "utf8",
    );
    assert(
      connSource.includes('typeof window !== "undefined"'),
      "connection.ts: Has server-side guard",
    );

    const initSource = fs.readFileSync(
      path.join(process.cwd(), "src", "persistence", "initializer.ts"),
      "utf8",
    );
    assert(
      initSource.includes('typeof window !== "undefined"'),
      "initializer.ts: Has server-side guard",
    );

    // Scan all ts/tsx files in src/ for createServerFn and verify they are only inside server/ or persistence/
    const srcDir = path.join(process.cwd(), "src");
    const allTsFiles: string[] = [];

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") {
          walk(fullPath);
        } else if (/\.(ts|tsx)$/.test(entry)) {
          allTsFiles.push(fullPath);
        }
      }
    }
    walk(srcDir);

    const allowedFiles = new Set([
      "validate_migration.ts",
      "validate_migration_phase2.ts", // test files
    ]);

    for (const file of allTsFiles) {
      const basename = path.basename(file);
      if (allowedFiles.has(basename)) continue;

      const content = fs.readFileSync(file, "utf8");
      if (content.includes("createServerFn")) {
        const normalizedPath = file.replace(/\\/g, "/");
        const isServerOrPersistence =
          normalizedPath.includes("/server/") || normalizedPath.includes("/persistence/");
        assert(
          isServerOrPersistence,
          `Server Function location check: ${path.relative(srcDir, file)} is safely encapsulated in a server/ or persistence/ directory`,
        );
      }
    }

    // Verify renderer/client files (components, hooks, routes, app/ui) never import Node-only libraries or sqlite
    const rendererFiles = allTsFiles.filter((file) => {
      const rel = path.relative(srcDir, file).replace(/\\/g, "/");
      if (rel.includes(".test.") || rel.includes(".spec.")) return false;
      return (
        rel.startsWith("components/") ||
        rel.startsWith("hooks/") ||
        rel.startsWith("routes/") ||
        rel.startsWith("app/ui/")
      );
    });

    const forbiddenImports = ["fs", "path", "util", "better-sqlite3", "sqlite3"];
    const forbiddenRegex = new RegExp(
      `(import\\s+.*\\s+from\\s+["'](${forbiddenImports.join("|")})["']|import\\s+["'](${forbiddenImports.join("|")})["']|require\\s*\\(\\s*["'](${forbiddenImports.join("|")})["']\\s*\\))`,
    );

    for (const file of rendererFiles) {
      const content = fs.readFileSync(file, "utf8");
      const match = content.match(forbiddenRegex);
      assert(
        !match,
        `Renderer safety check: ${path.relative(srcDir, file)} does not import Node-only dependencies (found: ${match?.[0] || "none"})`,
      );
    }

    // Verify components, hooks, routes never directly import database repositories
    for (const file of rendererFiles) {
      const content = fs.readFileSync(file, "utf8");
      const hasRepoImport =
        /import\s+.*\s+from\s+["'].*persistence\/repositories.*["']/.test(content) ||
        /import\s+.*\s+from\s+["'].*Sqlite.*Repository.*["']/.test(content);
      assert(
        !hasRepoImport,
        `Repository import safety: ${path.relative(srcDir, file)} does not import database repositories`,
      );
    }
  } catch (err: any) {
    console.error(`${currentScenario} crashed:`, err);
    failCount++;
    failures.push({ scenario: currentScenario, message: `CRASH: ${err.message}` });
  }

  // ===== Scenario 11: LocalStorage Dependency Audit =====
  currentScenario = "Scenario 11: LocalStorage Dependency Audit";
  console.log(`\n${currentScenario}`);
  try {
    const srcDir = path.join(process.cwd(), "src");
    const allTsFiles: string[] = [];

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") {
          walk(fullPath);
        } else if (/\.(ts|tsx)$/.test(entry)) {
          allTsFiles.push(fullPath);
        }
      }
    }
    walk(srcDir);

    const allowedFiles = new Set([
      "validate_migration.ts",
      "validate_migration_phase2.ts", // test files
    ]);

    const allowedPatterns: Record<string, string[]> = {
      "__root.tsx": ["akira:state:v1", "akira:state:v1:migrated", "akira:dev_mode"], // migration coordinator & dev mode
      "settings.tsx": ["akira:dev_mode"], // dev mode toggle
      "chat.tsx": ["akira:migrations", "akira:state:v1"], // chat history migration
      "Sidebar.tsx": ["akira:dev_mode"], // dev mode display
      "tools.index.tsx": ["akira:dev_mode"], // dev tools page
      "shared/infrastructure/logger/index.ts": ["akira:dev_mode"], // dev mode logger
      "logger.ts": ["akira:dev_mode"], // alt logger
      "Thumbnail.tsx": ["akira:thumbnail:", "cacheKey"], // image thumbnail cache
    };

    const violations: string[] = [];
    for (const file of allTsFiles) {
      const basename = path.basename(file);
      if (allowedFiles.has(basename)) continue;

      const content = fs.readFileSync(file, "utf8");
      const lines = content.split("\n");
      const relPath = path.relative(srcDir, file).replace(/\\/g, "/");

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("localStorage")) {
          // Check allowed patterns by basename or exact relative path
          const allowed = allowedPatterns[basename] || allowedPatterns[relPath];
          if (allowed) {
            const isAllowed = allowed.some((key) => lines[i].includes(key));
            if (isAllowed) continue;
          }
          // Check if the line is a comment
          const trimmed = lines[i].trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*"))
            continue;

          violations.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
        }
      }
    }

    if (violations.length === 0) {
      assert(true, "No unauthorized localStorage usage found in application code");
    } else {
      console.log("  localStorage violations found:");
      for (const v of violations) {
        console.log(`    - ${v}`);
      }
      assert(
        false,
        `Found ${violations.length} unauthorized localStorage reference(s) in application code`,
      );
    }

    // Verify akira-store.ts has NO remaining localStorage read/write for application data
    const storeSource = fs.readFileSync(
      path.join(process.cwd(), "src", "persistence", "akira-store.ts"),
      "utf8",
    );
    const storeLocalStorageMatches = (
      storeSource.match(/localStorage\.(getItem|setItem|removeItem)/g) || []
    ).length;
    assert(
      storeLocalStorageMatches === 0,
      "akira-store.ts: Zero localStorage read/write calls for application data",
    );
  } catch (err: any) {
    console.error(`${currentScenario} crashed:`, err);
    failCount++;
    failures.push({ scenario: currentScenario, message: `CRASH: ${err.message}` });
  }

  // ===== Scenario 12: Performance Validation =====
  currentScenario = "Scenario 12: Performance Validation";
  console.log(`\n${currentScenario}`);
  try {
    const db = setupTestDb();

    // Time the migration
    const startTime = performance.now();
    executeMigration(db, JSON.stringify(realisticPayload));
    const migrationTime = performance.now() - startTime;

    console.log(`  Migration execution time: ${migrationTime.toFixed(2)}ms`);
    assert(
      migrationTime < 1000,
      `Migration completes in under 1 second (actual: ${migrationTime.toFixed(2)}ms)`,
    );
    assert(
      migrationTime < 100,
      `Migration completes in under 100ms (actual: ${migrationTime.toFixed(2)}ms)`,
    );

    // Time query operations
    const queryStart = performance.now();
    db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all();
    db.prepare("SELECT * FROM tasks ORDER BY updated_at DESC").all();
    db.prepare("SELECT * FROM notes ORDER BY updated_at DESC").all();
    db.prepare("SELECT * FROM sessions ORDER BY started_at DESC").all();
    db.prepare("SELECT * FROM settings").all();
    const queryTime = performance.now() - queryStart;

    console.log(`  Full state query time: ${queryTime.toFixed(2)}ms`);
    assert(
      queryTime < 100,
      `Full state hydration query under 100ms (actual: ${queryTime.toFixed(2)}ms)`,
    );

    // WAL mode verification
    const journalMode = db.pragma("journal_mode") as any;
    assert(
      journalMode[0]?.journal_mode === "wal",
      `Journal mode is WAL (actual: ${journalMode[0]?.journal_mode})`,
    );

    // Foreign keys enabled
    const fkStatus = db.pragma("foreign_keys") as any;
    assert(fkStatus[0]?.foreign_keys === 1, "Foreign keys are enabled");
  } catch (err: any) {
    console.error(`${currentScenario} crashed:`, err);
    failCount++;
    failures.push({ scenario: currentScenario, message: `CRASH: ${err.message}` });
  } finally {
    cleanupTestDb();
  }

  // ===== Scenario 13: Edge Case — Empty Object Payload =====
  currentScenario = "Scenario 13: Empty Object Payload ({})";
  console.log(`\n${currentScenario}`);
  try {
    const db = setupTestDb();
    const res = executeMigration(db, JSON.stringify({}));
    assert(res.success === true, "Empty object payload migrates successfully");
    assert(res.status === "migrated", "Status is 'migrated'");

    const projCount = (db.prepare("SELECT COUNT(*) as cnt FROM projects").get() as any).cnt;
    assert(projCount === 0, "No projects inserted");

    const settingsCount = (db.prepare("SELECT COUNT(*) as cnt FROM settings").get() as any).cnt;
    assert(settingsCount === 0, "No settings inserted");

    const hist = db
      .prepare("SELECT * FROM migration_history WHERE migration_name = ?")
      .get("legacy_localstorage_migration") as any;
    assert(hist.status === "completed", "Migration marked completed even for empty payload");
  } catch (err: any) {
    console.error(`${currentScenario} crashed:`, err);
    failCount++;
    failures.push({ scenario: currentScenario, message: `CRASH: ${err.message}` });
  } finally {
    cleanupTestDb();
  }

  // ===== Scenario 14: Edge Case — Empty String Payload =====
  currentScenario = "Scenario 14: Empty String Payload ('')";
  console.log(`\n${currentScenario}`);
  try {
    const db = setupTestDb();
    const res = executeMigration(db, "");
    assert(res.success === false, "Empty string returns success: false");
    assert(res.status === "failed", "Empty string returns status: 'failed'");
  } catch (err: any) {
    console.error(`${currentScenario} crashed:`, err);
    failCount++;
    failures.push({ scenario: currentScenario, message: `CRASH: ${err.message}` });
  } finally {
    cleanupTestDb();
  }

  // ===== Scenario 15: Edge Case — null/undefined Fields =====
  currentScenario = "Scenario 15: Null/Undefined Optional Fields";
  console.log(`\n${currentScenario}`);
  try {
    const db = setupTestDb();
    const payload = {
      projects: [
        {
          id: "proj-null",
          name: "Null Test Project",
          tag: "Test",
          description: null,
          progress: null,
          color: null,
          nextTask: null,
          notes: null,
          timeSpentMinutes: null,
          lastWorked: null,
          createdAt: null,
          icon: null,
        },
      ],
      tasks: [
        {
          id: "task-null",
          title: "Null fields task",
          description: null,
          priority: null,
          estimatedDuration: null,
          dueDate: null,
          done: null,
          completed: null,
          projectId: "proj-null",
          createdAt: null,
          updatedAt: null,
        },
      ],
    };
    const res = executeMigration(db, JSON.stringify(payload));
    assert(res.success === true, "Null fields handled gracefully");
    assert(res.status === "migrated", "Status is 'migrated'");

    const proj = db.prepare("SELECT * FROM projects WHERE id = ?").get("proj-null") as any;
    assert(proj !== undefined, "Project with null fields inserted");
    // Verify defaults applied
    assert(proj.progress === 0, "Null progress defaults to 0");
    assert(proj.color === "from-blue-500 to-purple-600", "Null color gets default");
    assert(proj.icon === "folder", "Null icon defaults to 'folder'");
    assert(proj.time_spent_minutes === 0, "Null timeSpentMinutes defaults to 0");

    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get("task-null") as any;
    assert(task !== undefined, "Task with null fields inserted");
    assert(task.priority === "Medium", "Null priority defaults to 'Medium'");
    assert(task.done === 0, "Null done defaults to 0");
    assert(task.completed === 0, "Null completed defaults to 0");
  } catch (err: any) {
    console.error(`${currentScenario} crashed:`, err);
    failCount++;
    failures.push({ scenario: currentScenario, message: `CRASH: ${err.message}` });
  } finally {
    cleanupTestDb();
  }

  // ===== Scenario 16: Edge Case — Array Field Type Validation =====
  currentScenario = "Scenario 16: Array Field Type Validation";
  console.log(`\n${currentScenario}`);
  try {
    const db = setupTestDb();
    // projects is a string instead of array
    const res = executeMigration(db, JSON.stringify({ projects: "not-an-array" }));
    assert(res.success === false, "Non-array 'projects' field returns failure");
    assert(
      res.error === "Field 'projects' must be an array",
      "Error message correct for type validation",
    );
  } catch (err: any) {
    console.error(`${currentScenario} crashed:`, err);
    failCount++;
    failures.push({ scenario: currentScenario, message: `CRASH: ${err.message}` });
  } finally {
    cleanupTestDb();
  }

  // ===== Scenario 17: Edge Case — Schema Version Mismatch =====
  currentScenario = "Scenario 17: Schema Version Mismatch";
  console.log(`\n${currentScenario}`);
  try {
    const db = setupTestDb();
    // Tamper with schema_version
    db.prepare("UPDATE schema_version SET version = 99 WHERE version = 1").run();

    const res = executeMigration(db, JSON.stringify(realisticPayload));
    assert(res.success === false, "Schema version mismatch returns failure");
    assert(res.status === "failed", "Status is 'failed'");
    assert(
      !!(
        res.error?.includes("schema version mismatch") || res.error?.includes("Expected version 1")
      ),
      "Error message mentions schema version mismatch",
    );
  } catch (err: any) {
    console.error(`${currentScenario} crashed:`, err);
    failCount++;
    failures.push({ scenario: currentScenario, message: `CRASH: ${err.message}` });
  } finally {
    cleanupTestDb();
  }

  // ===== Scenario 18: Edge Case — Failed Migration Can Be Retried =====
  currentScenario = "Scenario 18: Failed Migration Retry";
  console.log(`\n${currentScenario}`);
  try {
    const db = setupTestDb();

    // First: trigger a failure (corrupted payload structure)
    const res1 = executeMigration(
      db,
      JSON.stringify({
        projects: [{ id: "proj-x", name: "X" }], // Valid project
        tasks: [{ id: "task-x" }], // Invalid: missing title
      }),
    );
    assert(res1.success === false, "First attempt fails (invalid task)");
    assert(res1.status === "failed", "First attempt status: failed");

    // Second: retry with valid payload — should migration_history allow re-attempt?
    const res2 = executeMigration(db, JSON.stringify(realisticPayload));
    // Per the idempotency check: it only skips if status === "completed"
    // A "failed" status should allow re-attempt
    assert(res2.success === true, "Retry after failure succeeds");
    assert(res2.status === "migrated", "Retry status: migrated");

    // Verify data actually inserted
    const projCount = (db.prepare("SELECT COUNT(*) as cnt FROM projects").get() as any).cnt;
    assert(projCount === 2, "Retry inserted correct project count");
  } catch (err: any) {
    console.error(`${currentScenario} crashed:`, err);
    failCount++;
    failures.push({ scenario: currentScenario, message: `CRASH: ${err.message}` });
  } finally {
    cleanupTestDb();
  }

  // ===== Scenario 19: Schema Constraint Validation =====
  currentScenario = "Scenario 19: Schema Constraint Validation";
  console.log(`\n${currentScenario}`);
  try {
    const db = setupTestDb();
    executeMigration(db, JSON.stringify(realisticPayload));

    // Test progress CHECK constraint (0-100)
    let constraintError = false;
    try {
      db.prepare("UPDATE projects SET progress = 150 WHERE id = ?").run("proj-001");
    } catch (err: any) {
      constraintError = true;
    }
    assert(constraintError, "CHECK constraint: progress > 100 is rejected");

    // Test negative progress
    constraintError = false;
    try {
      db.prepare("UPDATE projects SET progress = -5 WHERE id = ?").run("proj-001");
    } catch (err: any) {
      constraintError = true;
    }
    assert(constraintError, "CHECK constraint: progress < 0 is rejected");

    // Test invalid priority
    constraintError = false;
    try {
      db.prepare(
        "INSERT INTO tasks (id, title, priority, done, completed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        "task-bad-priority",
        "Bad Priority",
        "Urgent",
        0,
        0,
        new Date().toISOString(),
        new Date().toISOString(),
      );
    } catch (err: any) {
      constraintError = true;
    }
    assert(constraintError, "CHECK constraint: Invalid priority value rejected");

    // Test negative time_spent_minutes
    constraintError = false;
    try {
      db.prepare("UPDATE projects SET time_spent_minutes = -10 WHERE id = ?").run("proj-001");
    } catch (err: any) {
      constraintError = true;
    }
    assert(constraintError, "CHECK constraint: Negative time_spent_minutes rejected");
  } catch (err: any) {
    console.error(`${currentScenario} crashed:`, err);
    failCount++;
    failures.push({ scenario: currentScenario, message: `CRASH: ${err.message}` });
  } finally {
    cleanupTestDb();
  }

  // ===== Scenario 20: Index Verification =====
  currentScenario = "Scenario 20: Index Verification";
  console.log(`\n${currentScenario}`);
  try {
    const db = setupTestDb();

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);

    const expectedIndexes = [
      "idx_projects_created_at",
      "idx_projects_updated_at",
      "idx_tasks_project_id",
      "idx_tasks_done_completed",
      "idx_tasks_due_date",
      "idx_tasks_updated_at",
      "idx_notes_project_id",
      "idx_notes_pinned_favorite",
      "idx_notes_updated_at",
      "idx_sessions_project_id",
      "idx_sessions_started_at",
    ];

    for (const idx of expectedIndexes) {
      assert(indexNames.includes(idx), `Index '${idx}' exists`);
    }
  } catch (err: any) {
    console.error(`${currentScenario} crashed:`, err);
    failCount++;
    failures.push({ scenario: currentScenario, message: `CRASH: ${err.message}` });
  } finally {
    cleanupTestDb();
  }

  // ===== Scenario 21: Migration Coordinator Logic (Source Analysis) =====
  currentScenario = "Scenario 21: Migration Coordinator (Root Route) Verification";
  console.log(`\n${currentScenario}`);
  try {
    const rootSource = fs.readFileSync(
      path.join(process.cwd(), "src", "routes", "__root.tsx"),
      "utf8",
    );

    // Verify the coordinator:
    // 1. Reads akira:state:v1
    assert(
      rootSource.includes('localStorage.getItem("akira:state:v1")'),
      "Coordinator reads 'akira:state:v1' from localStorage",
    );

    // 2. Calls migrateLegacyState server function
    assert(rootSource.includes("migrateLegacyState"), "Coordinator calls migrateLegacyState");

    // 3. On success: backs up to akira:state:v1:migrated
    assert(
      rootSource.includes('localStorage.setItem("akira:state:v1:migrated"'),
      "Coordinator backs up to 'akira:state:v1:migrated'",
    );

    // 4. On success: removes original key
    assert(
      rootSource.includes('localStorage.removeItem("akira:state:v1")'),
      "Coordinator removes original 'akira:state:v1'",
    );

    // 5. Shows success toast
    assert(rootSource.includes("toast.success"), "Coordinator shows success toast on migration");

    // 6. Shows error toast on failure
    assert(rootSource.includes("toast.error"), "Coordinator shows error toast on failure");

    // 7. Hydrates store from SQLite after migration
    assert(
      rootSource.includes("getInitialState"),
      "Coordinator hydrates store from SQLite via getInitialState",
    );
    assert(
      rootSource.includes("akira.initializeState"),
      "Coordinator calls akira.initializeState with SQLite data",
    );

    // 8. Verify migration runs BEFORE hydration (order matters)
    const migrationIdx = rootSource.indexOf("migrateLegacyState");
    const hydrationIdx = rootSource.indexOf("getInitialState");
    assert(
      migrationIdx < hydrationIdx,
      "Migration executes BEFORE state hydration (correct order)",
    );
  } catch (err: any) {
    console.error(`${currentScenario} crashed:`, err);
    failCount++;
    failures.push({ scenario: currentScenario, message: `CRASH: ${err.message}` });
  }

  // ===== Scenario 22: Instrumentation Architecture Validation =====
  currentScenario = "Scenario 22: Instrumentation Architecture Validation";
  console.log(`\n${currentScenario}`);
  try {
    // 1. Check no repository imports in instrumentation publishers/root index
    const publisherSource = fs.readFileSync(
      path.join(process.cwd(), "src", "instrumentation", "publisher.ts"),
      "utf8",
    );
    const indexSource = fs.readFileSync(
      path.join(process.cwd(), "src", "instrumentation", "index.ts"),
      "utf8",
    );
    assert(
      !publisherSource.includes("repositories") && !publisherSource.includes("better-sqlite3"),
      "Publisher must not import repositories or better-sqlite3 directly",
    );
    assert(
      !indexSource.includes("repositories") && !indexSource.includes("better-sqlite3"),
      "Instrumentation root index must not import repositories or better-sqlite3 directly",
    );

    // 2. Check subscribers implement the EventSubscriber contract
    const timelineSubSource = fs.readFileSync(
      path.join(process.cwd(), "src", "instrumentation", "subscribers", "timeline-subscriber.ts"),
      "utf8",
    );
    const persistenceSubSource = fs.readFileSync(
      path.join(
        process.cwd(),
        "src",
        "instrumentation",
        "event-store",
        "persistence-subscriber.ts",
      ),
      "utf8",
    );
    assert(
      timelineSubSource.includes("implements EventSubscriber"),
      "TimelineSubscriber must implement EventSubscriber",
    );
    assert(
      persistenceSubSource.includes("implements EventSubscriber"),
      "PersistenceSubscriber must implement EventSubscriber",
    );

    // 3. Check Event Store remains append-only
    const eventRepoSource = fs.readFileSync(
      path.join(
        process.cwd(),
        "src",
        "instrumentation",
        "event-store",
        "sqlite-event-repository.ts",
      ),
      "utf8",
    );
    const eventRepoInterface = fs.readFileSync(
      path.join(process.cwd(), "src", "instrumentation", "event-store", "event-repository.ts"),
      "utf8",
    );

    assert(
      !eventRepoInterface.includes("delete") && !eventRepoInterface.includes("update"),
      "Event Repository interface must be append-only",
    );
    assert(
      !eventRepoSource.includes("DELETE FROM") && !eventRepoSource.includes("UPDATE "),
      "SqliteEventRepository implementation must not contain DELETE or UPDATE statements",
    );

    // 4. Check no direct Event Bus imports outside instrumentation
    const srcDir = path.join(process.cwd(), "src");
    const errors: string[] = [];

    function scanImports(dir: string) {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        if (fs.statSync(fullPath).isDirectory()) {
          // Skip internal folders and routes
          if (item === "instrumentation" || item === "tests" || item === "routes") continue;
          // The observability layer's job is to watch the bus. `composition.ts`
          // wires the observer and `event-bus-observer.ts` implements it
          // against the bus's own types -- both are the integration point this
          // rule exists to funnel everything else through, not exceptions to it.
          if (item === "observability") continue;
          scanImports(fullPath);
        } else if (
          (item.endsWith(".ts") || item.endsWith(".tsx")) &&
          !item.endsWith(".test.ts") &&
          !item.endsWith(".test.tsx")
        ) {
          // Test files are excluded the way test directories already were. The
          // scan skipped a folder called `tests` but not a file called
          // `vault.test.ts`, so where a test happened to sit decided whether it
          // was a violation.
          const content = fs.readFileSync(fullPath, "utf8");
          if (content.includes("instrumentation/event-bus") && !BUS_ADAPTERS.has(fullPath)) {
            errors.push(fullPath);
          }
        }
      }
    }
    // The two files whose purpose is to sit on the bus. Named individually
    // rather than by folder, so a third one is a deliberate decision and not an
    // accident of where someone put a file.
    //
    // `reality-adapter` is the platform -> GENESIS bridge; it exists to consume
    // bus events. `contracts/presence-channel` is the seam GENESIS subscribes
    // to presence through: the bus has no topic channel, so three services were
    // each subscribing to everything and filtering for PRESENCE_UPDATED
    // themselves, which is what put domain code on an infrastructure module.
    // `platform-event-adapter` is the platform -> VAJRA bridge (Phase 8A stimulus ingress).
    const BUS_ADAPTERS = new Set([
      path.join(srcDir, "genesis", "events", "reality-adapter.ts"),
      path.join(srcDir, "contracts", "presence-channel.ts"),
      path.join(srcDir, "vajra", "ingress", "adapters", "platform-event-adapter.ts"),
    ]);

    scanImports(srcDir);
    assert(
      errors.length === 0,
      `No direct Event Bus imports outside instrumentation. Found: ${errors.join(", ")}`,
    );

    // 5. Check no direct Timeline database writes in business modules
    const writeErrors: string[] = [];
    function scanTimelineWrites(dir: string) {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        if (fs.statSync(fullPath).isDirectory()) {
          if (
            item === "timeline" ||
            item === "persistence" ||
            item === "instrumentation" ||
            item === "tests" ||
            item === "vault"
          )
            continue;
          scanTimelineWrites(fullPath);
        } else if (
          (item.endsWith(".ts") || item.endsWith(".tsx")) &&
          !item.endsWith(".test.ts") &&
          !item.endsWith(".test.tsx")
        ) {
          // Test files excluded the way test directories already were, for the
          // same reason as the Event Bus scan above: a test writing timeline SQL
          // is not a business module reaching past the boundary.
          const content = fs.readFileSync(fullPath, "utf8");
          if (
            content.includes("timeline_events") &&
            (content.includes("INSERT") || content.includes("UPDATE") || content.includes("DELETE"))
          ) {
            writeErrors.push(fullPath);
          }
        }
      }
    }
    scanTimelineWrites(srcDir);
    assert(
      writeErrors.length === 0,
      `No direct timeline database writes in business modules. Found: ${writeErrors.join(", ")}`,
    );

    // 6. Check business modules use the public publish() API
    const akiraStoreContent = fs.readFileSync(
      path.join(process.cwd(), "src", "persistence", "akira-store.ts"),
      "utf8",
    );
    const vaultFolderContent = fs.readFileSync(
      path.join(process.cwd(), "src", "akira-os", "vault", "VaultFolderService.ts"),
      "utf8",
    );
    const vaultStorageContent = fs.readFileSync(
      path.join(process.cwd(), "src", "akira-os", "vault", "VaultStorageService.ts"),
      "utf8",
    );
    const searchContent = fs.readFileSync(
      path.join(process.cwd(), "src", "akira-os", "search", "services", "index.ts"),
      "utf8",
    );

    assert(akiraStoreContent.includes("publish("), "akira-store.ts must use publish() API");
    assert(vaultFolderContent.includes("publish("), "VaultFolderService must use publish() API");
    assert(vaultStorageContent.includes("publish("), "VaultStorageService must use publish() API");
    assert(searchContent.includes("publish("), "Search service must use publish() API");
  } catch (err: any) {
    console.error(`${currentScenario} crashed:`, err);
    failCount++;
    failures.push({ scenario: currentScenario, message: `CRASH: ${err.message}` });
  }

  // ===== Scenario 23: Analytics Subsystem Architecture Validation =====
  currentScenario = "Scenario 23: Analytics Subsystem Architecture Validation";
  console.log(`\n${currentScenario}`);
  try {
    const analyticsDir = path.join(process.cwd(), "src", "analytics");

    // 1. Verify AnalyticsService contains no SQL prepared statements or execution
    const serviceFile = fs.readFileSync(
      path.join(analyticsDir, "service", "analytics-service.ts"),
      "utf8",
    );
    assert(
      !serviceFile.includes(".prepare(") &&
        !serviceFile.includes(".exec(") &&
        !serviceFile.includes("SELECT ") &&
        !serviceFile.includes("INSERT ") &&
        !serviceFile.includes("UPDATE "),
      "AnalyticsService must perform no SQL operations directly",
    );

    // 2. Verify DashboardBuilder performs no calculation logic
    const builderFile = fs.readFileSync(
      path.join(analyticsDir, "dashboard", "dashboard-builder.ts"),
      "utf8",
    );
    assert(
      !builderFile.includes("ActivityCalculator") &&
        !builderFile.includes("ProductivityCalculator") &&
        !builderFile.includes("new ClockService()"),
      "DashboardBuilder must delegate calculations to AnalyticsService and not run raw calculator instances",
    );

    // 3. Verify QueryService is the owner of repository operations
    const queryServiceFile = fs.readFileSync(
      path.join(analyticsDir, "service", "query-service.ts"),
      "utf8",
    );
    assert(
      queryServiceFile.includes("this.analyticsRepository") ||
        queryServiceFile.includes("this.eventRepository"),
      "QueryService must own the access to database repositories",
    );

    // 4. Verify DTOs are lightweight types and do not contain persistence mappings
    const dtoFile = fs.readFileSync(path.join(analyticsDir, "service", "dto.ts"), "utf8");
    const dashDtoFile = fs.readFileSync(
      path.join(analyticsDir, "dashboard", "dashboard-dto.ts"),
      "utf8",
    );
    assert(
      !dtoFile.includes("Database") &&
        !dtoFile.includes("better-sqlite3") &&
        !dtoFile.includes("INSERT "),
      "Service DTOs must contain no persistence mappings",
    );
    assert(
      !dashDtoFile.includes("Database") &&
        !dashDtoFile.includes("better-sqlite3") &&
        !dashDtoFile.includes("INSERT "),
      "Dashboard DTOs must contain no persistence mappings",
    );

    // 5. Verify Metric calculators remain independent
    const calculatorsFile = fs.readFileSync(
      path.join(analyticsDir, "metrics", "calculators.ts"),
      "utf8",
    );
    assert(
      !calculatorsFile.includes("../service") && !calculatorsFile.includes("../dashboard"),
      "Metric calculators must remain decoupled from higher-level services",
    );

    // 6. Verify Business modules do not import Analytics internals
    const akiraOSDir = path.join(process.cwd(), "src", "akira-os");
    const internalImportErrors: string[] = [];
    if (fs.existsSync(akiraOSDir)) {
      const scanBusinessImports = (dir: string) => {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          if (fs.statSync(fullPath).isDirectory()) {
            scanBusinessImports(fullPath);
          } else if (item.endsWith(".ts") || item.endsWith(".tsx")) {
            const content = fs.readFileSync(fullPath, "utf8");
            // Matched on the path segment, not on a literal "src/..." prefix.
            //
            // These read `content.includes("src/analytics/engine")` and so on.
            // Nothing in this repository writes an import that way -- they are
            // relative (`../analytics/analytics-api`) or aliased (`@/analytics/...`)
            // -- so the literal appeared nowhere in `src/` and the check could
            // not fire for any violation, real or planted. It passed because of
            // how imports are spelled, not because the boundary held.
            //
            // `analytics/analytics-api` is the public entry point and is
            // deliberately not in this list.
            if (
              /["'@./]analytics\/(engine|repository|metrics|service|dashboard|validation)(?![A-Za-z0-9-])/.test(
                content,
              )
            ) {
              internalImportErrors.push(fullPath);
            }
          }
        }
      };
      scanBusinessImports(akiraOSDir);
    }
    assert(
      internalImportErrors.length === 0,
      `Business modules must not import internal analytics folders directly. Violations: ${internalImportErrors.join(", ")}`,
    );

    // 7. Verify SqliteAnalyticsRepository boundary limits
    const repoSource = fs.readFileSync(
      path.join(analyticsDir, "repository", "SqliteAnalyticsRepository.ts"),
      "utf8",
    );
    assert(
      repoSource.includes("daily_metrics") &&
        repoSource.includes("project_metrics") &&
        repoSource.includes("analytics_state"),
      "SqliteAnalyticsRepository must manage daily, project, and state tables",
    );
    assert(
      !repoSource.includes("INSERT INTO events") && !repoSource.includes("DELETE FROM events"),
      "SqliteAnalyticsRepository must not write or delete from the Events table",
    );
  } catch (err: any) {
    console.error(`${currentScenario} crashed:`, err);
    failCount++;
    failures.push({ scenario: currentScenario, message: `CRASH: ${err.message}` });
  }

  // ===== FINAL REPORT =====
  console.log("\n" + "=".repeat(60));
  console.log("PHASE 2: EXTENDED MIGRATION VALIDATION — FINAL REPORT");
  console.log("=".repeat(60));
  console.log(`Total assertions: ${passCount + failCount}`);
  console.log(`Passed: ${passCount}`);
  console.log(`Failed: ${failCount}`);

  if (failures.length > 0) {
    console.log("\nFailure Details:");
    for (const f of failures) {
      console.log(`  ❌ [${f.scenario}] ${f.message}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  if (failCount === 0) {
    console.log("✅ ALL PHASE 2 TESTS PASSED");
  } else {
    console.log("⚠️ SOME TESTS FAILED — REVIEW REQUIRED");
  }
  console.log("=".repeat(60));

  process.exit(failCount > 0 ? 1 : 0);
}

runTests();
