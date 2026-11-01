interface MigrationResponse {
  success: boolean;
  status: "already_completed" | "migrated" | "failed";
  error?: string;
}

export function executeMigration(db: any, rawData: string): MigrationResponse {
  const now = new Date().toISOString();
  const MIGRATION_NAME = "legacy_localstorage_migration";

  // 1. Idempotency Check: Verify if migration already succeeded
  const historyCheck = db
    .prepare("SELECT status FROM migration_history WHERE migration_name = ?")
    .get(MIGRATION_NAME) as { status: string } | undefined;

  if (historyCheck && historyCheck.status === "completed") {
    return { success: true, status: "already_completed" };
  }

  // 2. Parse & Validate Payload

  let payload: any;
  try {
    payload = JSON.parse(rawData);
  } catch (e) {
    return { success: false, status: "failed", error: "Invalid JSON format" };
  }

  if (!payload || typeof payload !== "object") {
    return { success: false, status: "failed", error: "Payload must be a JSON object" };
  }

  const arrays = ["projects", "tasks", "notes", "sessions", "chat", "streaks"];
  for (const field of arrays) {
    if (payload[field] !== undefined && !Array.isArray(payload[field])) {
      return { success: false, status: "failed", error: `Field '${field}' must be an array` };
    }
  }

  // Record start of migration in history
  db.prepare(
    `
    INSERT OR REPLACE INTO migration_history (migration_name, status, started_at, completed_at, error_message)
    VALUES (?, 'running', ?, NULL, NULL)
  `,
  ).run(MIGRATION_NAME, now);

  try {
    // 3. Schema Version Verification
    const versionRow = db
      .prepare("SELECT MAX(version) as current_version FROM schema_version")
      .get() as { current_version: number } | undefined;

    if (!versionRow || versionRow.current_version < 1 || versionRow.current_version > 4) {
      throw new Error(
        `Database schema version mismatch. Expected version 1 to 4, found: ${versionRow?.current_version}`,
      );
    }

    // 4. Transactional Import Execution
    db.transaction(() => {
      // Migrate projects
      if (payload.projects) {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO projects (
            id, name, tag, description, progress, color, next_task, notes, time_spent_minutes, last_worked, created_at, updated_at, icon
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const p of payload.projects) {
          if (!p.id || !p.name) throw new Error("Invalid project element in payload");
          stmt.run(
            p.id,
            p.name,
            p.tag || "",
            p.description || null,
            p.progress || 0,
            p.color || "from-blue-500 to-purple-600",
            p.nextTask || null,
            p.notes || null,
            p.timeSpentMinutes || 0,
            p.lastWorked || null,
            p.createdAt || now,
            p.updatedAt || now,
            p.icon || "folder",
          );
        }
      }

      // Migrate tasks
      if (payload.tasks) {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO tasks (
            id, title, description, priority, estimated_duration, due_date, done, completed, project_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const t of payload.tasks) {
          if (!t.id || !t.title) throw new Error("Invalid task element in payload");
          stmt.run(
            t.id,
            t.title,
            t.description || null,
            t.priority || "Medium",
            t.estimatedDuration || 0,
            t.dueDate || null,
            t.done ? 1 : 0,
            t.completed ? 1 : 0,
            t.projectId || null,
            t.createdAt || now,
            t.updatedAt || now,
          );
        }
      }

      // Migrate notes
      if (payload.notes) {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO notes (
            id, title, content, tags, created_at, updated_at, pinned, favorite, project_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const n of payload.notes) {
          if (!n.id || !n.content) throw new Error("Invalid note element in payload");
          stmt.run(
            n.id,
            n.title || "",
            n.content,
            JSON.stringify(n.tags || []),
            n.createdAt || now,
            n.updatedAt || now,
            n.pinned ? 1 : 0,
            n.favorite ? 1 : 0,
            n.projectId || null,
          );
        }
      }

      // Migrate sessions
      if (payload.sessions) {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO sessions (
            id, project_id, task, started_at, ended_at, duration, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const s of payload.sessions) {
          if (!s.id || !s.projectId || !s.task) throw new Error("Invalid session element");
          stmt.run(
            s.id,
            s.projectId,
            s.task,
            s.startedAt,
            s.endedAt,
            s.duration,
            s.notes || null,
            s.createdAt || s.startedAt,
            s.updatedAt || s.endedAt,
          );
        }
      }

      // Migrate settings key-values
      const settingStmt = db.prepare(`
        INSERT OR REPLACE INTO settings (key, value, updated_at)
        VALUES (?, ?, ?)
      `);

      if (payload.profile) {
        settingStmt.run("profile", JSON.stringify(payload.profile), now);
      }
      if (payload.activeSession) {
        settingStmt.run("active_session", JSON.stringify(payload.activeSession), now);
      }
      if (payload.lastProjectId) {
        settingStmt.run("last_project_id", JSON.stringify(payload.lastProjectId), now);
      }
      if (payload.chat) {
        settingStmt.run("chat", JSON.stringify(payload.chat), now);
      }
      if (payload.streaks) {
        settingStmt.run("streaks", JSON.stringify(payload.streaks), now);
      }
    })();

    // Commit completion status
    db.prepare(
      `
      UPDATE migration_history
      SET status = 'completed', completed_at = ?
      WHERE migration_name = ?
    `,
    ).run(new Date().toISOString(), MIGRATION_NAME);

    return { success: true, status: "migrated" };
  } catch (error) {
    console.error("Migration failed, rolling back:", error);
    const err = error as Error;

    // Record failure status in history
    db.prepare(
      `
      UPDATE migration_history
      SET status = 'failed', error_message = ?
      WHERE migration_name = ?
    `,
    ).run(err.message || String(error), MIGRATION_NAME);

    return { success: false, status: "failed", error: err.message || String(error) };
  }
}
