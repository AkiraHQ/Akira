// Client-side prevention guard
if (typeof window !== "undefined") {
  throw new Error("persistence/initializer.ts must only be loaded on the server side.");
}

import fs from "fs";
import path from "path";
import { getDatabaseConnection } from "./connection";
import { conversationRepository, sessionRepository } from "./repositories";

/**
 * Bootstraps the SQLite database.
 * If the database tables are not initialized, it reads and runs schema.sql,
 * then records version 1 in the schema_version table.
 */
export const initializeDatabase = (): void => {
  const db = getDatabaseConnection();

  // Validate database tables by checking for schema_version
  const tableCheck = db
    .prepare(
      `
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name='schema_version'
  `,
    )
    .get();

  if (!tableCheck) {
    // Database schema does not exist, run bootstrap schema DDL
    const schemaPath = path.join(process.cwd(), "src", "persistence", "schema.sql");
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Critical: SQLite schema DDL not found at ${schemaPath}`);
    }

    const ddlContent = fs.readFileSync(schemaPath, "utf8");

    // Execute DDL within an explicit transaction to ensure atomicity
    db.transaction(() => {
      db.exec(ddlContent);

      // Seed the initial database version 1
      const versionStmt = db.prepare(`
        INSERT INTO schema_version (version, applied_at)
        VALUES (?, ?)
      `);
      versionStmt.run(1, new Date().toISOString());
    })();

    console.log("SQLite Database initialized successfully with schema version 1.");
  } else {
    console.log("SQLite Database connection verified. Schema is already present.");
  }

  // Dynamic Migration: Ensure timeline_events table is created if it does not exist
  const timelineTableCheck = db
    .prepare(
      `
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='timeline_events'
    `,
    )
    .get();

  if (!timelineTableCheck) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS timeline_events (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          project_id TEXT,
          payload TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          payload_version INTEGER DEFAULT 1,
          seq INTEGER,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_timeline_timestamp ON timeline_events (timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_timeline_seq ON timeline_events (seq);
        CREATE INDEX IF NOT EXISTS idx_timeline_timestamp_seq ON timeline_events (timestamp DESC, seq DESC);
        CREATE INDEX IF NOT EXISTS idx_timeline_project_event ON timeline_events (project_id, event_type);
      `);
    })();
    console.log("SQLite Database migration completed: timeline_events table created.");
  }

  // Dynamic Migration: give timeline_events an explicit ordering sequence.
  //
  // `timestamp` is an ISO string with millisecond resolution, so events recorded
  // inside the same millisecond tie on it. The tiebreaker used to be `id`, which
  // is a random UUID, making the order of tied events arbitrary. `seq` restores
  // the order events were actually recorded in, and (timestamp, seq) becomes the
  // total order the Timeline sorts and paginates by.
  // Task list order, added after the fact.
  //
  // The task list is drag-reorderable (`routes/tasks.tsx`) and has no sort
  // control, so manual order is the only ordering the user has. It used to live
  // only in the store's array: `reorderTasks` rearranged memory, nothing was
  // written, and `getAll()` read `ORDER BY created_at ASC` -- so the reorder was
  // visible until reload and then gone.
  const taskColumns = db.prepare(`PRAGMA table_info(tasks)`).all() as {
    name: string;
  }[];

  if (!taskColumns.some((column) => column.name === "position")) {
    db.transaction(() => {
      db.exec(`ALTER TABLE tasks ADD COLUMN position INTEGER`);

      // Backfill from rowid for the same reason the timeline backfill does:
      // it is monotonic and it is the only surviving record of insertion order,
      // so existing rows keep a stable relative order instead of collapsing to
      // NULL and sorting arbitrarily.
      db.exec(`UPDATE tasks SET position = rowid WHERE position IS NULL`);
    })();
  }

  // Outside the guard, and deliberately not in `schema.sql`.
  //
  // The bootstrap runs `schema.sql` whenever `schema_version` is missing, and
  // its `CREATE TABLE IF NOT EXISTS tasks` silently skips a table that already
  // exists without the column -- so an index declared there referenced a column
  // that was not there yet and aborted the whole bootstrap with
  // `no such column: position`. Here the column is guaranteed by the block
  // above, on both the fresh and the migrated path, and `IF NOT EXISTS` makes
  // it idempotent.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_position ON tasks (position)`);

  const timelineColumns = db.prepare(`PRAGMA table_info(timeline_events)`).all() as {
    name: string;
  }[];

  if (!timelineColumns.some((column) => column.name === "seq")) {
    db.transaction(() => {
      db.exec(`ALTER TABLE timeline_events ADD COLUMN seq INTEGER`);

      // Backfill existing rows from rowid. It is the only record of historical
      // insertion order still available, and it is monotonic, so pre-migration
      // rows keep a stable relative order instead of collapsing to NULL.
      db.exec(`UPDATE timeline_events SET seq = rowid WHERE seq IS NULL`);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_timeline_seq ON timeline_events (seq);
        CREATE INDEX IF NOT EXISTS idx_timeline_timestamp_seq ON timeline_events (timestamp DESC, seq DESC);
      `);

      // The vault audit triggers insert timeline rows directly, bypassing the
      // repository. They were created with CREATE TRIGGER IF NOT EXISTS, so an
      // existing database keeps the old seq-less definition unless it is dropped
      // first. Recreate them so trigger-written rows also carry a sequence.
      db.exec(`DROP TRIGGER IF EXISTS trg_vault_files_insert_audit`);
      db.exec(`DROP TRIGGER IF EXISTS trg_vault_files_delete_audit`);
      db.exec(`
        CREATE TRIGGER trg_vault_files_insert_audit
        AFTER INSERT ON vault_files
        BEGIN
          INSERT INTO timeline_events (id, event_type, project_id, payload, timestamp, payload_version, seq)
          VALUES (
            lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))),
            'file.created',
            NULL,
            json_object('id', new.id, 'displayName', new.display_name, 'sizeBytes', new.size_bytes, 'mimeType', new.mime_type),
            STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'),
            1,
            (SELECT IFNULL(MAX(seq), 0) + 1 FROM timeline_events)
          );
        END;

        CREATE TRIGGER trg_vault_files_delete_audit
        AFTER DELETE ON vault_files
        BEGIN
          INSERT INTO timeline_events (id, event_type, project_id, payload, timestamp, payload_version, seq)
          VALUES (
            lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))),
            'file.deleted',
            NULL,
            json_object('id', old.id, 'displayName', old.display_name, 'hash', old.hash),
            STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'),
            1,
            (SELECT IFNULL(MAX(seq), 0) + 1 FROM timeline_events)
          );
        END;
      `);
    })();
    console.log("SQLite Database migration completed: timeline_events.seq added.");
  }

  // Dynamic Migration: Ensure search_history and fts_workspace tables and triggers are created if they do not exist
  const searchHistoryCheck = db
    .prepare(
      `
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='search_history'
    `,
    )
    .get();

  if (!searchHistoryCheck) {
    db.transaction(() => {
      db.exec(`
        -- Search History Table
        CREATE TABLE IF NOT EXISTS search_history (
          id TEXT PRIMARY KEY,
          query TEXT NOT NULL UNIQUE ON CONFLICT REPLACE,
          searched_at TEXT NOT NULL,
          result_count INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_search_history_searched_at ON search_history (searched_at DESC);

        -- FTS5 Search Index Table
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_workspace USING fts5(
          entity_id,
          entity_type,
          title,
          content,
          updated_at UNINDEXED,
          tokenize = 'porter unicode61'
        );

        -- Triggers for projects
        CREATE TRIGGER IF NOT EXISTS trg_projects_insert AFTER INSERT ON projects BEGIN
          INSERT INTO fts_workspace(entity_id, entity_type, title, content, updated_at)
          VALUES (new.id, 'project', new.name, new.tag || ' ' || COALESCE(new.description, ''), new.updated_at);
        END;

        CREATE TRIGGER IF NOT EXISTS trg_projects_update AFTER UPDATE ON projects BEGIN
          UPDATE fts_workspace
          SET title = new.name,
              content = new.tag || ' ' || COALESCE(new.description, ''),
              updated_at = new.updated_at
          WHERE entity_id = new.id AND entity_type = 'project';
        END;

        CREATE TRIGGER IF NOT EXISTS trg_projects_delete AFTER DELETE ON projects BEGIN
          DELETE FROM fts_workspace WHERE entity_id = old.id AND entity_type = 'project';
          DELETE FROM fts_workspace WHERE entity_type = 'session' AND entity_id IN (SELECT id FROM sessions WHERE project_id = old.id);
        END;

        -- Triggers for tasks
        CREATE TRIGGER IF NOT EXISTS trg_tasks_insert AFTER INSERT ON tasks BEGIN
          INSERT INTO fts_workspace(entity_id, entity_type, title, content, updated_at)
          VALUES (new.id, 'task', new.title, COALESCE(new.description, ''), new.updated_at);
        END;

        CREATE TRIGGER IF NOT EXISTS trg_tasks_update AFTER UPDATE ON tasks BEGIN
          UPDATE fts_workspace
          SET title = new.title,
              content = COALESCE(new.description, ''),
              updated_at = new.updated_at
          WHERE entity_id = new.id AND entity_type = 'task';
        END;

        CREATE TRIGGER IF NOT EXISTS trg_tasks_delete AFTER DELETE ON tasks BEGIN
          DELETE FROM fts_workspace WHERE entity_id = old.id AND entity_type = 'task';
        END;

        -- Triggers for notes
        CREATE TRIGGER IF NOT EXISTS trg_notes_insert AFTER INSERT ON notes BEGIN
          INSERT INTO fts_workspace(entity_id, entity_type, title, content, updated_at)
          VALUES (
            new.id,
            'note',
            new.title,
            new.content || ' ' || replace(replace(replace(replace(COALESCE(new.tags, ''), '[', ''), ']', ''), '"', ''), ',', ' '),
            new.updated_at
          );
        END;

        CREATE TRIGGER IF NOT EXISTS trg_notes_update AFTER UPDATE ON notes BEGIN
          UPDATE fts_workspace
          SET title = new.title,
              content = new.content || ' ' || replace(replace(replace(replace(COALESCE(new.tags, ''), '[', ''), ']', ''), '"', ''), ',', ' '),
              updated_at = new.updated_at
          WHERE entity_id = new.id AND entity_type = 'note';
        END;

        CREATE TRIGGER IF NOT EXISTS trg_notes_delete AFTER DELETE ON notes BEGIN
          DELETE FROM fts_workspace WHERE entity_id = old.id AND entity_type = 'note';
        END;

        -- Triggers for sessions
        CREATE TRIGGER IF NOT EXISTS trg_sessions_insert AFTER INSERT ON sessions BEGIN
          INSERT INTO fts_workspace(entity_id, entity_type, title, content, updated_at)
          VALUES (new.id, 'session', new.task, COALESCE(new.notes, ''), new.updated_at);
        END;

        CREATE TRIGGER IF NOT EXISTS trg_sessions_update AFTER UPDATE ON sessions BEGIN
          UPDATE fts_workspace
          SET title = new.task,
              content = COALESCE(new.notes, ''),
              updated_at = new.updated_at
          WHERE entity_id = new.id AND entity_type = 'session';
        END;

        CREATE TRIGGER IF NOT EXISTS trg_sessions_delete AFTER DELETE ON sessions BEGIN
          DELETE FROM fts_workspace WHERE entity_id = old.id AND entity_type = 'session';
        END;

        -- Triggers for timeline_events
        CREATE TRIGGER IF NOT EXISTS trg_timeline_events_insert AFTER INSERT ON timeline_events BEGIN
          INSERT INTO fts_workspace(entity_id, entity_type, title, content, updated_at)
          VALUES (
            new.id,
            'timeline',
            new.event_type,
            COALESCE(json_extract(new.payload, '$.title'), json_extract(new.payload, '$.task'), json_extract(new.payload, '$.name'), ''),
            new.timestamp
          );
        END;

        CREATE TRIGGER IF NOT EXISTS trg_timeline_events_update AFTER UPDATE ON timeline_events BEGIN
          UPDATE fts_workspace
          SET title = new.event_type,
              content = COALESCE(json_extract(new.payload, '$.title'), json_extract(new.payload, '$.task'), json_extract(new.payload, '$.name'), ''),
              updated_at = new.timestamp
          WHERE entity_id = new.id AND entity_type = 'timeline';
        END;

        CREATE TRIGGER IF NOT EXISTS trg_timeline_events_delete AFTER DELETE ON timeline_events BEGIN
          DELETE FROM fts_workspace WHERE entity_id = old.id AND entity_type = 'timeline';
        END;
      `);
    })();
    console.log("SQLite Database migration completed: search_history & fts_workspace created.");
  }

  // Dynamic Migration: Ensure File Vault tables, indexes, and triggers exist if not present
  const vaultTableCheck = db
    .prepare(
      `
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='vault_files'
    `,
    )
    .get();

  if (!vaultTableCheck) {
    db.transaction(() => {
      db.exec(`
        -- Table: vault_folders
        CREATE TABLE IF NOT EXISTS vault_folders (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          parent_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (parent_id) REFERENCES vault_folders(id) ON DELETE CASCADE
        );

        -- Table: vault_files
        CREATE TABLE IF NOT EXISTS vault_files (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          original_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          extension TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          hash TEXT NOT NULL,
          storage_path TEXT NOT NULL,
          folder_id TEXT,
          status TEXT NOT NULL,
          favorite INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          last_opened_at TEXT,
          CHECK (favorite IN (0, 1)),
          CHECK (size_bytes >= 0),
          CHECK (status IN ('Uploading', 'Ready', 'Failed')),
          FOREIGN KEY (folder_id) REFERENCES vault_folders(id) ON DELETE SET NULL
        );

        -- Table: vault_tags
        CREATE TABLE IF NOT EXISTS vault_tags (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL
        );

        -- Table: vault_file_tags
        CREATE TABLE IF NOT EXISTS vault_file_tags (
          file_id TEXT NOT NULL,
          tag_id TEXT NOT NULL,
          PRIMARY KEY (file_id, tag_id),
          FOREIGN KEY (file_id) REFERENCES vault_files(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES vault_tags(id) ON DELETE CASCADE
        );

        -- Table: vault_file_links
        CREATE TABLE IF NOT EXISTS vault_file_links (
          id TEXT PRIMARY KEY,
          file_id TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(file_id, entity_type, entity_id),
          CHECK (entity_type IN ('project', 'task', 'note', 'session')),
          FOREIGN KEY (file_id) REFERENCES vault_files(id) ON DELETE CASCADE
        );

        -- Indexes for Folder Browsing and Deduplication
        CREATE INDEX IF NOT EXISTS idx_vault_files_hash ON vault_files (hash);
        CREATE INDEX IF NOT EXISTS idx_vault_files_folder_id ON vault_files (folder_id);
        CREATE INDEX IF NOT EXISTS idx_vault_files_created_at ON vault_files (created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_vault_files_updated_at ON vault_files (updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_vault_files_deleted_at ON vault_files (deleted_at);
        CREATE INDEX IF NOT EXISTS idx_vault_files_favorite ON vault_files (favorite);
        CREATE INDEX IF NOT EXISTS idx_vault_files_mime_type ON vault_files (mime_type);
        CREATE INDEX IF NOT EXISTS idx_vault_folders_parent_id ON vault_folders (parent_id);

        -- Triggers for folder timestamp updates
        CREATE TRIGGER IF NOT EXISTS trg_vault_folders_updated_at 
        AFTER UPDATE ON vault_folders
        BEGIN
          UPDATE vault_folders 
          SET updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = new.id AND updated_at = old.updated_at;
        END;

        -- Triggers for file timestamp updates
        CREATE TRIGGER IF NOT EXISTS trg_vault_files_updated_at 
        AFTER UPDATE ON vault_files
        BEGIN
          UPDATE vault_files 
          SET updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = new.id AND updated_at = old.updated_at;
        END;

        -- Trigger for Tag Garbage Collection (Tag cleanup when unused)
        CREATE TRIGGER IF NOT EXISTS trg_vault_file_tags_cleanup 
        AFTER DELETE ON vault_file_tags
        BEGIN
          DELETE FROM vault_tags
          WHERE id = old.tag_id AND NOT EXISTS (
            SELECT 1 FROM vault_file_tags WHERE tag_id = old.tag_id
          );
        END;

        -- Triggers for Polymorphic Cleanup (Orphan links prevention)
        CREATE TRIGGER IF NOT EXISTS trg_vault_links_cleanup_projects 
        AFTER DELETE ON projects
        BEGIN
          DELETE FROM vault_file_links WHERE entity_type = 'project' AND entity_id = old.id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_vault_links_cleanup_tasks 
        AFTER DELETE ON tasks
        BEGIN
          DELETE FROM vault_file_links WHERE entity_type = 'task' AND entity_id = old.id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_vault_links_cleanup_notes 
        AFTER DELETE ON notes
        BEGIN
          DELETE FROM vault_file_links WHERE entity_type = 'note' AND entity_id = old.id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_vault_links_cleanup_sessions 
        AFTER DELETE ON sessions
        BEGIN
          DELETE FROM vault_file_links WHERE entity_type = 'session' AND entity_id = old.id;
        END;
      `);
    })();
    console.log("SQLite Database migration completed: File Vault tables created.");
  }

  // Dynamic Migration: sessions outlive their project. The original table
  // cascaded a project delete onto its sessions, while the store kept them --
  // so session history was visible until the next restart and then gone.
  // SQLite cannot alter a foreign key, so the table is rebuilt: `project_id`
  // becomes nullable with ON DELETE SET NULL, and `project_deleted_at` carries
  // the retention metadata. Last in this function so every trigger that
  // targets `sessions` already exists; they are dropped with the table and
  // replayed verbatim from sqlite_master.
  const sessionColumns = db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[];
  if (!sessionColumns.some((column) => column.name === "project_deleted_at")) {
    const dependents = db
      .prepare(
        `SELECT sql FROM sqlite_master
         WHERE tbl_name = 'sessions' AND type IN ('index', 'trigger') AND sql IS NOT NULL`,
      )
      .all() as { sql: string }[];

    // Must be set outside a transaction; the rebuild would otherwise fire the
    // old CASCADE/SET NULL actions against the rows being copied.
    db.pragma("foreign_keys = OFF");
    // `trg_projects_delete` -- a trigger on *projects* -- names `sessions`.
    // Between the DROP and the RENAME that table does not exist, and a modern
    // RENAME re-validates every trigger in the schema, so it fails with "no
    // such table: main.sessions" on every real database. Legacy mode renames
    // without that check; the trigger resolves by name again once it is done.
    db.pragma("legacy_alter_table = ON");
    try {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE sessions_new (
            id TEXT PRIMARY KEY,
            project_id TEXT,
            task TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT NOT NULL,
            duration INTEGER NOT NULL,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            project_deleted_at TEXT,
            CHECK (duration >= 0),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
          );
          INSERT INTO sessions_new
            (id, project_id, task, started_at, ended_at, duration, notes, created_at, updated_at)
            SELECT id, project_id, task, started_at, ended_at, duration, notes, created_at, updated_at
            FROM sessions;
          DROP TABLE sessions;
          ALTER TABLE sessions_new RENAME TO sessions;
        `);
        for (const { sql } of dependents) db.exec(sql);

        const violations = db.pragma("foreign_key_check(sessions)") as unknown[];
        if (violations.length > 0) {
          throw new Error(`sessions rebuild left ${violations.length} foreign key violations`);
        }
      })();
    } finally {
      db.pragma("legacy_alter_table = OFF");
      db.pragma("foreign_keys = ON");
    }
    console.log("SQLite Database migration completed: sessions survive project deletion.");
  }

  // Retention sweep, last of all.
  //
  // It has to follow the sessions rebuild directly above it, because before
  // that rebuild the table has no `project_deleted_at` for the sweep to test.
  // Keeping both in this function is what makes that ordering local and
  // visible, instead of a coupling between two files that nothing enforces.
  //
  // Here rather than in `getInitialState` because this runs once per process,
  // at server boot (`server.ts`), whereas `getInitialState` is an RPC handler
  // that answers every hydration -- a delete sweep does not belong on a read
  // path, and running it per request buys nothing: retention is measured in
  // days, so a boundary crossed mid-process is collected at the next start.
  sessionRepository.purgeExpired();

  // Conversations as first-class rows. Defined here alone rather than also in
  // schema.sql: this block is idempotent and runs on fresh and existing
  // databases alike, so there is one definition to keep correct. It must
  // follow the search migration above, which creates `fts_workspace`.
  //
  // `position` is the message's place in the conversation. Timestamps alone
  // cannot order it: a conversation restored into the store is re-added
  // within one millisecond, so ties are ordinary.
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      position INTEGER NOT NULL,
      CHECK (role IN ('user', 'akira')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created
      ON chat_messages (conversation_id, created_at);

    CREATE TRIGGER IF NOT EXISTS trg_chat_messages_insert AFTER INSERT ON chat_messages BEGIN
      INSERT INTO fts_workspace(entity_id, entity_type, title, content, updated_at)
      VALUES (new.id, 'message', new.role, new.text, new.created_at);
    END;

    CREATE TRIGGER IF NOT EXISTS trg_chat_messages_update AFTER UPDATE ON chat_messages BEGIN
      UPDATE fts_workspace
      SET title = new.role, content = new.text, updated_at = new.created_at
      WHERE entity_id = new.id AND entity_type = 'message';
    END;

    CREATE TRIGGER IF NOT EXISTS trg_chat_messages_delete AFTER DELETE ON chat_messages BEGIN
      DELETE FROM fts_workspace WHERE entity_id = old.id AND entity_type = 'message';
    END;
  `);

  // Backfill the search index. The search migration created `fts_workspace`
  // and its triggers but indexed nothing that already existed, so every row
  // older than that migration was unsearchable -- measured on a real database
  // at 2 of 16 rows indexed. Each insert mirrors its entity's insert trigger,
  // and skips rows already indexed, so this is a no-op once caught up.
  db.exec(`
    INSERT INTO fts_workspace(entity_id, entity_type, title, content, updated_at)
      SELECT id, 'project', name, tag || ' ' || COALESCE(description, ''), updated_at FROM projects
      WHERE id NOT IN (SELECT entity_id FROM fts_workspace WHERE entity_type = 'project');
    INSERT INTO fts_workspace(entity_id, entity_type, title, content, updated_at)
      SELECT id, 'task', title, COALESCE(description, ''), updated_at FROM tasks
      WHERE id NOT IN (SELECT entity_id FROM fts_workspace WHERE entity_type = 'task');
    INSERT INTO fts_workspace(entity_id, entity_type, title, content, updated_at)
      SELECT id, 'note', title,
        content || ' ' || replace(replace(replace(replace(COALESCE(tags, ''), '[', ''), ']', ''), '"', ''), ',', ' '),
        updated_at FROM notes
      WHERE id NOT IN (SELECT entity_id FROM fts_workspace WHERE entity_type = 'note');
    INSERT INTO fts_workspace(entity_id, entity_type, title, content, updated_at)
      SELECT id, 'session', task, COALESCE(notes, ''), updated_at FROM sessions
      WHERE id NOT IN (SELECT entity_id FROM fts_workspace WHERE entity_type = 'session');
    INSERT INTO fts_workspace(entity_id, entity_type, title, content, updated_at)
      SELECT id, 'timeline', event_type,
        COALESCE(json_extract(payload, '$.title'), json_extract(payload, '$.task'), json_extract(payload, '$.name'), ''),
        timestamp FROM timeline_events
      WHERE id NOT IN (SELECT entity_id FROM fts_workspace WHERE entity_type = 'timeline');
  `);

  // --- Migration 003: VAJRA Operational State ---
  const versionRow = db
    .prepare("SELECT MAX(version) as current_version FROM schema_version")
    .get() as { current_version: number } | undefined;

  const currentVersion = versionRow?.current_version ?? 0;

  if (currentVersion < 3) {
    const migrationPath = path.join(
      process.cwd(),
      "src",
      "persistence",
      "migrations",
      "003_vajra_operational_state.sql",
    );

    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Critical: VAJRA migration file missing at ${migrationPath}`);
    }

    const ddlContent = fs.readFileSync(migrationPath, "utf8");

    db.transaction(() => {
      // 1. Execute DDL for all 7 tables and 19 indexes
      db.exec(ddlContent);

      // 2. Seed initial singleton operational state row
      db.prepare(`
        INSERT OR IGNORE INTO vajra_operational_state (
          id, current_focus, operational_mode, human_presence, system_health_status, version, updated_at
        ) VALUES ('singleton', 'Awaiting human directive', 'REQUEST_DRIVEN', 'FOCUSED_ACTIVE', 'NOMINAL', 1, ?)
      `).run(new Date().toISOString());

      // 3. Increment schema_version to 3
      db.prepare(`
        INSERT INTO schema_version (version, applied_at)
        VALUES (3, ?)
      `).run(new Date().toISOString());
    })();

    console.log("SQLite Database migration completed: schema version 3 (VAJRA Operational State).");
  }

  // Mirror the chat archive into the tables. On the first start after this
  // migration that imports the existing archive; on every later start it is
  // a no-op unless the two have drifted, which it repairs.
  conversationRepository.syncFromArchive();
};
