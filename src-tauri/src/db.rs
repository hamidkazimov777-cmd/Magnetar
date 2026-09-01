//! Local SQLite store — the provider-neutral canonical transcript. This is the
//! source of truth for sessions/messages so a conversation survives app
//! restarts and switching between different providers/APIs.

use once_cell::sync::OnceCell;
use rusqlite::Connection;
use std::sync::Mutex;

static DB: OnceCell<Mutex<Connection>> = OnceCell::new();

/// Schema version recorded in `PRAGMA user_version`. Bump this and add a step
/// in `migrate` whenever the schema changes — never append to the old
/// best-effort `ALTER TABLE` list.
const SCHEMA_VERSION: i64 = 4;

pub fn init(app_dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(app_dir).map_err(|e| e.to_string())?;
    let _ = APP_DIR.set(app_dir.to_path_buf());
    let path = app_dir.join("magnetar.sqlite");
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        -- WAL's companion: fewer fsyncs per commit, still crash-safe.
        PRAGMA synchronous = NORMAL;
        -- Wait instead of failing with SQLITE_BUSY under contention.
        PRAGMA busy_timeout = 5000;
        -- Referential integrity for any REFERENCES the schema adds later.
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS sessions (
            id               TEXT PRIMARY KEY,
            title            TEXT NOT NULL DEFAULT 'New chat',
            connection_id    TEXT,
            model            TEXT,
            summary          TEXT,
            summary_up_to_id TEXT,
            created_at       INTEGER NOT NULL,
            updated_at       INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
            id         TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role       TEXT NOT NULL,
            content    TEXT NOT NULL,
            model      TEXT,
            attachments TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

        CREATE TABLE IF NOT EXISTS projects (
            id                 TEXT PRIMARY KEY,
            name               TEXT NOT NULL,
            description        TEXT,
            tech_stack         TEXT,
            architecture_notes TEXT,
            coding_standards   TEXT,
            decisions          TEXT,
            active_goals       TEXT,
            roadmap            TEXT,
            risks              TEXT,
            path               TEXT,
            last_state         TEXT,
            created_at         INTEGER NOT NULL,
            updated_at         INTEGER NOT NULL,
            deleted_at         INTEGER
        );

        CREATE TABLE IF NOT EXISTS knowledge_nodes (
            id          TEXT PRIMARY KEY,
            project_id  TEXT NOT NULL,
            title       TEXT NOT NULL,
            node_type   TEXT NOT NULL,
            summary     TEXT,
            metadata    TEXT,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL,
            deleted_at  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_knodes_project ON knowledge_nodes(project_id);

        CREATE TABLE IF NOT EXISTS knowledge_edges (
            source      TEXT NOT NULL,
            target      TEXT NOT NULL,
            relation    TEXT NOT NULL,
            PRIMARY KEY (source, target, relation)
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id          TEXT PRIMARY KEY,
            project_id  TEXT NOT NULL,
            title       TEXT NOT NULL,
            description TEXT,
            status      TEXT NOT NULL,
            priority    TEXT NOT NULL,
            owner       TEXT,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL,
            deleted_at  INTEGER,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);

        CREATE TABLE IF NOT EXISTS timeline_events (
            id          TEXT PRIMARY KEY,
            project_id  TEXT NOT NULL,
            event_type  TEXT NOT NULL,
            content     TEXT NOT NULL,
            created_at  INTEGER NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_tevents_project ON timeline_events(project_id);

        -- Memory facts: the unit of project memory after Entry 50. A fact is
        -- no longer a line of prose in a text column — it carries where it came
        -- from, whether a machine confirmed it, and when. A false fact is worse
        -- than a missing one precisely because it gets trusted.
        --   origin  : extracted | user | inferred | legacy
        --   status  : unverified | verified | stale | refuted
        --   verify  : JSON spec the checker knows how to run (grep / check), or NULL
        CREATE TABLE IF NOT EXISTS memory_facts (
            id            TEXT PRIMARY KEY,
            project_id    TEXT NOT NULL,
            kind          TEXT NOT NULL,
            text          TEXT NOT NULL,
            origin        TEXT NOT NULL,
            origin_detail TEXT,
            verify        TEXT,
            status        TEXT NOT NULL,
            checked_at    INTEGER,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL,
            deleted_at    INTEGER,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_facts_project ON memory_facts(project_id);

        -- Decisions: an event log, not a text field. In six months nobody
        -- needs to be told the architecture — they can read it — they need the
        -- reason it was chosen and what was rejected. That is why `rationale`
        -- and `alternatives` are separate columns and not prose: they are the
        -- part the code cannot tell you.
        CREATE TABLE IF NOT EXISTS decisions (
            id           TEXT PRIMARY KEY,
            project_id   TEXT NOT NULL,
            title        TEXT NOT NULL,
            rationale    TEXT,
            alternatives TEXT,
            files        TEXT,
            commit_sha   TEXT,
            origin       TEXT NOT NULL,
            created_at   INTEGER NOT NULL,
            deleted_at   INTEGER,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id);

        -- Divergences: contradictions between memory and the code, queued
        -- rather than raised. Confirmation fatigue is not a minor annoyance —
        -- it is what led the user to switch approvals off entirely and get a
        -- `pkill` without warning. So a model that notices memory is wrong
        -- leaves a note and keeps working; the human reviews the pile when it
        -- suits them.
        CREATE TABLE IF NOT EXISTS divergences (
            id          TEXT PRIMARY KEY,
            project_id  TEXT NOT NULL,
            fact_id     TEXT,
            summary     TEXT NOT NULL,
            proposal    TEXT,
            evidence    TEXT,
            source      TEXT NOT NULL,
            status      TEXT NOT NULL,
            created_at  INTEGER NOT NULL,
            resolved_at INTEGER,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_divergences_project ON divergences(project_id);

        -- Proposals: model suggestions the user can fold into project memory.
        -- The record is also the "already handled" marker for the message that
        -- produced it, so the accept/reject buttons do not reappear.
        CREATE TABLE IF NOT EXISTS proposals (
            id          TEXT PRIMARY KEY,
            project_id  TEXT NOT NULL,
            message_id  TEXT NOT NULL,
            text        TEXT NOT NULL,
            status      TEXT NOT NULL,
            review      TEXT,
            created_at  INTEGER NOT NULL,
            reviewed_at INTEGER,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_proposals_project ON proposals(project_id);

        -- Provider connections (durable — не в хрупком localStorage). Ключи
        -- по-прежнему в Keychain по connection id; здесь только метаданные.
        CREATE TABLE IF NOT EXISTS connections (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            kind       TEXT NOT NULL,
            base_url   TEXT NOT NULL,
            scope      TEXT,
            ca_path    TEXT,
            created_at INTEGER NOT NULL
        );

        -- Generation studio history: the user's produced media, kept across
        -- sessions so the gallery is not lost on leaving the studio. Global
        -- (not project-scoped) — it is a personal output library. `src` is the
        -- asset itself: a hosted URL (fal video) or an inline data-URI (OpenAI
        -- b64 image); storing the data-URI is the price of the image surviving
        -- a restart, the same trade-off attachments already make.
        CREATE TABLE IF NOT EXISTS generations (
            id         TEXT PRIMARY KEY,
            kind       TEXT NOT NULL,
            src        TEXT NOT NULL,
            name       TEXT NOT NULL,
            prompt     TEXT,
            model      TEXT,
            run_id     TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_generations_created ON generations(created_at);

        -- Workflows: user-built generation pipelines. The definition is a JSON
        -- document (nodes + edges) kept in one column — a V1 workflow is small
        -- and edited wholesale, so normalising it into rows now would add schema
        -- without a reader for it. Provider-neutral: nodes hold connection/model
        -- references, never keys. `project_id` is optional and deliberately not a
        -- foreign key — a workflow is a reusable personal asset, and deleting a
        -- project must not delete it.
        CREATE TABLE IF NOT EXISTS workflows (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            version     INTEGER NOT NULL DEFAULT 1,
            project_id  TEXT,
            definition  TEXT NOT NULL,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_workflows_updated ON workflows(updated_at);

        -- Agent runs: the durable record of one agent run so work survives a
        -- restart. The live loop still runs in the frontend; this table is the
        -- canon of what a run is, what it spent, and how it ended. `status` is
        -- one of running | paused | done | cancelled | error. Budgets are a
        -- ceiling the run may not exceed (NULL = no ceiling). `project_id` is
        -- deliberately not a foreign key — a run's history should outlive a
        -- project being closed.
        CREATE TABLE IF NOT EXISTS agent_runs (
            id            TEXT PRIMARY KEY,
            session_id    TEXT,
            project_id    TEXT,
            connection_id TEXT,
            model         TEXT,
            status        TEXT NOT NULL,
            started_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL,
            ended_at      INTEGER,
            steps         INTEGER NOT NULL DEFAULT 0,
            tokens_in     INTEGER NOT NULL DEFAULT 0,
            tokens_out    INTEGER NOT NULL DEFAULT 0,
            cost_usd      REAL NOT NULL DEFAULT 0,
            budget_steps  INTEGER,
            budget_usd    REAL,
            error         TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_id, started_at);
        CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);

        -- Append-only event log for a run: the ordered record of model turns,
        -- tool calls and their results. Replaying it in `seq` order reconstructs
        -- a run's trace after a restart. `payload` is an event-specific JSON blob.
        -- `kind` is one of model_turn | tool_call | tool_result | text | error |
        -- checkpoint. Rows are deleted with their run.
        CREATE TABLE IF NOT EXISTS agent_events (
            id         TEXT PRIMARY KEY,
            run_id     TEXT NOT NULL,
            seq        INTEGER NOT NULL,
            kind       TEXT NOT NULL,
            payload    TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_events_run ON agent_events(run_id, seq);
        "#,
    )
    .map_err(|e| e.to_string())?;

    migrate(&conn)?;

    DB.set(Mutex::new(conn))
        .map_err(|_| "db already initialized".to_string())?;
    Ok(())
}

/// Bring an existing database up to `SCHEMA_VERSION`. Steps are idempotent and
/// run in order; `user_version` is bumped only after a step succeeds.
fn migrate(conn: &Connection) -> Result<(), String> {
    let current: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    for v in (current + 1)..=SCHEMA_VERSION {
        match v {
            1 => migrate_v1(conn)?,
            2 => migrate_v2(conn)?,
            3 => migrate_v3(conn)?,
            4 => migrate_v4(conn)?,
            other => return Err(format!("unknown schema version {other}")),
        }
        conn.execute_batch(&format!("PRAGMA user_version = {v}"))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// v0 → v1: add columns introduced after the first schema. Only "duplicate
/// column" is expected and ignored — anything else is a real failure.
/// The project-scoped tables, and the column that ties each to its project.
///
/// Everything here is meaningless without its project: a fact about a project
/// that no longer exists is not a fact about anything.
const PROJECT_SCOPED: [&str; 6] = [
    "memory_facts",
    "decisions",
    "divergences",
    "proposals",
    "tasks",
    "timeline_events",
];

/// v2: make the project the owner of its memory, in the schema rather than by
/// convention.
///
/// Deleting a project was a soft delete that touched one row. Its facts,
/// decisions, queued contradictions, proposals, tasks and timeline stayed
/// behind for good — invisible, still counted by anything that reads the
/// tables, and impossible to get rid of from the interface. Nothing declared
/// the relationship, so nothing could enforce it.
///
/// SQLite cannot add a foreign key to an existing table, so each one is rebuilt
/// the documented way: new table, copy, drop, rename. Orphans are cleared
/// first, because they would otherwise make the copy fail — and a row whose
/// project vanished is exactly what this migration exists to remove.
fn migrate_v2(conn: &Connection) -> Result<(), String> {
    // Foreign keys must be off while tables are being swapped, and the whole
    // thing has to be one transaction: a half-rebuilt database is worse than an
    // unmigrated one.
    conn.execute_batch("PRAGMA foreign_keys = OFF;")
        .map_err(|e| e.to_string())?;

    let result = rebuild_project_tables(conn);

    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| e.to_string())?;
    result?;

    // If the rebuild produced a violation, the schema is now lying about its
    // own integrity — say so loudly rather than carrying on.
    let violations: i64 = conn
        .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r.get(0))
        .unwrap_or(0);
    if violations > 0 {
        return Err(format!("foreign key check failed after migration: {violations} rows"));
    }
    Ok(())
}

fn rebuild_project_tables(conn: &Connection) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    for table in PROJECT_SCOPED {
        // A table that does not exist yet was created with the foreign key
        // already in place by `init`, so there is nothing to rebuild.
        let exists: i64 = tx
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [table],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if exists == 0 {
            continue;
        }

        // Already rebuilt (a previous partial run, or a fresh database).
        let ddl: String = tx
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
                [table],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if ddl.contains("REFERENCES projects") {
            continue;
        }

        tx.execute(
            &format!(
                "DELETE FROM {table} WHERE project_id NOT IN (SELECT id FROM projects)"
            ),
            [],
        )
        .map_err(|e| e.to_string())?;

        // The new table copies the old declaration and appends the constraint,
        // so no column list has to be repeated here — repeating one is how a
        // rebuild silently drops a column.
        let new_ddl = ddl
            .replacen(
                &format!("CREATE TABLE {table}"),
                &format!("CREATE TABLE {table}__new"),
                1,
            )
            .replacen(
                &format!("CREATE TABLE IF NOT EXISTS {table}"),
                &format!("CREATE TABLE {table}__new"),
                1,
            );
        let new_ddl = match new_ddl.rfind(')') {
            Some(at) => format!(
                "{},\n  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE\n){}",
                &new_ddl[..at].trim_end().trim_end_matches(','),
                &new_ddl[at + 1..]
            ),
            None => return Err(format!("{table}: cannot parse its schema")),
        };

        tx.execute_batch(&new_ddl).map_err(|e| format!("{table}: {e}"))?;
        tx.execute_batch(&format!(
            "INSERT INTO {table}__new SELECT * FROM {table};
             DROP TABLE {table};
             ALTER TABLE {table}__new RENAME TO {table};
             CREATE INDEX IF NOT EXISTS idx_{table}_project ON {table}(project_id);"
        ))
        .map_err(|e| format!("{table}: {e}"))?;
    }

    tx.commit().map_err(|e| e.to_string())
}

/// v3: the workflow engine lands as a durable data model.
///
/// The `workflows` table is created by `init`'s idempotent schema block, which
/// runs on every launch, so an existing database gets it without a migration
/// step. What a migration must do is add `run_id` to the generation gallery —
/// `CREATE TABLE IF NOT EXISTS` cannot add a column to a table that already
/// exists. Guarded on existence because a synthetic pre-v1 test database has no
/// `generations` table yet.
fn migrate_v3(conn: &Connection) -> Result<(), String> {
    let exists: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='generations'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if exists > 0 {
        add_column(conn, "ALTER TABLE generations ADD COLUMN run_id TEXT")?;
    }
    Ok(())
}

/// v4: durable agent runs land as a data model.
///
/// The `agent_runs` and `agent_events` tables are created by `init`'s idempotent
/// schema block, which runs on every launch, so an existing database gets them
/// without a migration step. They are created here too so the step is a truthful,
/// self-contained record rather than an empty version bump.
fn migrate_v4(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS agent_runs (
            id            TEXT PRIMARY KEY,
            session_id    TEXT,
            project_id    TEXT,
            connection_id TEXT,
            model         TEXT,
            status        TEXT NOT NULL,
            started_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL,
            ended_at      INTEGER,
            steps         INTEGER NOT NULL DEFAULT 0,
            tokens_in     INTEGER NOT NULL DEFAULT 0,
            tokens_out    INTEGER NOT NULL DEFAULT 0,
            cost_usd      REAL NOT NULL DEFAULT 0,
            budget_steps  INTEGER,
            budget_usd    REAL,
            error         TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_id, started_at);
        CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
        CREATE TABLE IF NOT EXISTS agent_events (
            id         TEXT PRIMARY KEY,
            run_id     TEXT NOT NULL,
            seq        INTEGER NOT NULL,
            kind       TEXT NOT NULL,
            payload    TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_events_run ON agent_events(run_id, seq);
        "#,
    )
    .map_err(|e| e.to_string())
}

/// Mark runs left in flight as interrupted. Called at startup: nothing can still
/// be running, because the loop lived in a process that is gone. This keeps the
/// durable record honest — a killed app no longer leaves runs forever "running"
/// — and lets the UI show what was interrupted. Returns how many were fixed.
pub fn reconcile_agent_runs(conn: &Connection, now: i64) -> Result<usize, String> {
    conn.execute(
        "UPDATE agent_runs SET status = 'interrupted', updated_at = ?1, ended_at = ?1, \
           error = COALESCE(error, 'App was closed while this run was in flight') \
         WHERE status IN ('running', 'paused')",
        [now],
    )
    .map_err(|e| e.to_string())
}

fn migrate_v1(conn: &Connection) -> Result<(), String> {
    for stmt in [
        "ALTER TABLE sessions ADD COLUMN connection_id TEXT",
        "ALTER TABLE sessions ADD COLUMN model TEXT",
        "ALTER TABLE sessions ADD COLUMN summary TEXT",
        "ALTER TABLE sessions ADD COLUMN summary_up_to_id TEXT",
        "ALTER TABLE sessions ADD COLUMN project_id TEXT",
        // Which track a chat belongs to: "agent" (tools, edits the project) or
        // "chat" (talk it through, no tools). A chat carries its own model, so
        // switching tracks switches models without anyone remembering pairs.
        "ALTER TABLE sessions ADD COLUMN track TEXT",
        // Whether this conversation sees the project (memory, workspace root,
        // facts, decisions). NULL means "yes" — pre-flag chats keep their old
        // behaviour of seeing the project.
        "ALTER TABLE sessions ADD COLUMN sees_project INTEGER",
        "ALTER TABLE messages ADD COLUMN model TEXT",
        "ALTER TABLE messages ADD COLUMN attachments TEXT",
        "ALTER TABLE projects ADD COLUMN path TEXT",
        "ALTER TABLE projects ADD COLUMN last_state TEXT",
        // Set once a project's legacy text fields have been split into facts,
        // so the one-time migration never runs twice.
        "ALTER TABLE projects ADD COLUMN facts_migrated_at INTEGER",
        "ALTER TABLE projects ADD COLUMN decisions_migrated_at INTEGER",
    ] {
        add_column(conn, stmt)?;
    }
    Ok(())
}

/// Add a column when it is missing. Only "duplicate column" is treated as a
/// no-op — any other error means the migration should fail loudly.
/// Remove a project and everything that belonged to it.
///
/// The soft delete stays for the undo path; this is the drain. Cascade does the
/// work now that the schema declares the relationship, so a table added later
/// is covered by its own foreign key rather than by remembering to extend a
/// list here.
pub fn purge_project(conn: &Connection, id: &str) -> Result<usize, String> {
    let before: i64 = PROJECT_SCOPED
        .iter()
        .map(|t| {
            conn.query_row(
                &format!("SELECT count(*) FROM {t} WHERE project_id = ?1"),
                [id],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0)
        })
        .sum();
    conn.execute("DELETE FROM projects WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(before as usize)
}

/// What a health check found. Reported rather than repaired: a database that
/// has lost pages needs a person deciding what to do, not an automatic rewrite
/// that turns a recoverable problem into a finished one.
#[derive(serde::Serialize)]
pub struct Integrity {
    /// SQLite's own verdict. "ok" means the file structure is sound.
    pub structure: String,
    /// Rows pointing at a project that no longer exists. Should be zero now
    /// that the schema declares the relationship.
    pub orphans: i64,
    /// Row counts, so a "my memory disappeared" report has a number in it.
    pub projects: i64,
    pub facts: i64,
    pub decisions: i64,
    pub sessions: i64,
    pub messages: i64,
}

pub fn integrity(conn: &Connection) -> Result<Integrity, String> {
    let structure: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let orphans: i64 = conn
        .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r.get(0))
        .unwrap_or(0);
    let count = |t: &str| -> i64 {
        conn.query_row(&format!("SELECT count(*) FROM {t}"), [], |r| r.get(0))
            .unwrap_or(0)
    };
    Ok(Integrity {
        structure,
        orphans,
        projects: count("projects"),
        facts: count("memory_facts"),
        decisions: count("decisions"),
        sessions: count("sessions"),
        messages: count("messages"),
    })
}

/// Write a consistent copy of the whole database to `dest`.
///
/// `VACUUM INTO` rather than copying the file: the live database is in WAL
/// mode, so the `.sqlite` on disk is only part of the story and a plain copy
/// can miss committed data or catch a write mid-flight. This produces a single
/// self-contained file that opens on its own.
pub fn backup_to(conn: &Connection, dest: &std::path::Path) -> Result<u64, String> {
    if dest.exists() {
        // VACUUM INTO refuses an existing file, and silently overwriting
        // someone's previous backup is not this function's decision to make.
        return Err(format!("{} already exists", dest.display()));
    }
    conn.execute("VACUUM INTO ?1", [dest.to_string_lossy().as_ref()])
        .map_err(|e| e.to_string())?;
    std::fs::metadata(dest).map(|m| m.len()).map_err(|e| e.to_string())
}

fn add_column(conn: &Connection, stmt: &str) -> Result<(), String> {
    if let Err(e) = conn.execute(stmt, []) {
        let msg = e.to_string();
        if !msg.contains("duplicate column") {
            return Err(msg);
        }
    }
    Ok(())
}

/// Where the app keeps its own files. Set once at startup, like the key store.
static APP_DIR: OnceCell<std::path::PathBuf> = OnceCell::new();

pub fn app_dir() -> Result<std::path::PathBuf, String> {
    APP_DIR.get().cloned().ok_or_else(|| "app directory not set".to_string())
}

pub fn with_conn<T>(f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let m = DB.get().ok_or("db not initialized")?;
    let guard = m.lock().map_err(|e| e.to_string())?;
    f(&guard)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The pre-v1 tables, without the columns later migrations add.
    fn old_schema(conn: &Connection) {
        conn.execute_batch(
            r#"
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT 'New chat',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            "#,
        )
        .unwrap();
    }

    fn column_names(conn: &Connection, table: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .unwrap();
        stmt.query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .map(|x| x.unwrap())
            .collect()
    }

    #[test]
    fn migrate_adds_missing_columns_and_bumps_version() {
        let conn = Connection::open_in_memory().unwrap();
        old_schema(&conn);

        migrate(&conn).unwrap();

        let v: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, SCHEMA_VERSION);

        let sessions = column_names(&conn, "sessions");
        assert!(sessions.contains(&"track".to_string()));
        assert!(sessions.contains(&"sees_project".to_string()));
        assert!(sessions.contains(&"project_id".to_string()));
        let projects = column_names(&conn, "projects");
        assert!(projects.contains(&"path".to_string()));
        assert!(projects.contains(&"decisions_migrated_at".to_string()));
    }

    #[test]
    fn migrate_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        old_schema(&conn);

        migrate(&conn).unwrap();
        migrate(&conn).unwrap(); // second run must be a no-op

        let v: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, SCHEMA_VERSION);
    }

    /// A project-scoped table as it existed before v2: no foreign key, so
    /// nothing stopped a row outliving its project.
    fn unowned_memory_tables(conn: &Connection) {
        conn.execute_batch(
            r#"
            CREATE TABLE memory_facts (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                text TEXT NOT NULL,
                origin TEXT NOT NULL,
                origin_detail TEXT,
                verify TEXT,
                status TEXT NOT NULL,
                checked_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                deleted_at INTEGER
            );
            INSERT INTO projects (id, name, created_at, updated_at)
                VALUES ('p1', 'Kept', 1, 1);
            INSERT INTO memory_facts
                (id, project_id, kind, text, origin, status, created_at, updated_at)
                VALUES ('f1', 'p1', 'stack', 'Uses SQLite', 'user', 'unverified', 1, 1),
                       ('f2', 'gone', 'stack', 'Orphan', 'user', 'unverified', 1, 1);
            "#,
        )
        .unwrap();
    }

    #[test]
    fn v3_links_the_generation_gallery_to_runs() {
        let conn = Connection::open_in_memory().unwrap();
        old_schema(&conn);
        // A database from before the workflow engine that already has the
        // generation gallery, but not the run linkage.
        conn.execute_batch(
            "CREATE TABLE generations (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                src TEXT NOT NULL,
                name TEXT NOT NULL,
                prompt TEXT,
                model TEXT,
                created_at INTEGER NOT NULL
            );",
        )
        .unwrap();

        migrate(&conn).unwrap();

        let cols = column_names(&conn, "generations");
        assert!(cols.contains(&"run_id".to_string()));
    }

    #[test]
    fn v4_creates_durable_agent_run_tables() {
        let conn = Connection::open_in_memory().unwrap();
        old_schema(&conn);
        migrate(&conn).unwrap();

        // A run and one event round-trip through the durable tables.
        conn.execute_batch(
            "INSERT INTO agent_runs (id, session_id, status, started_at, updated_at, steps)
                VALUES ('r1', 's1', 'running', 10, 10, 0);
             INSERT INTO agent_events (id, run_id, seq, kind, payload, created_at)
                VALUES ('e1', 'r1', 0, 'model_turn', '{\"text\":\"hi\"}', 11);",
        )
        .unwrap();

        let status: String = conn
            .query_row("SELECT status FROM agent_runs WHERE id='r1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(status, "running");

        let kind: String = conn
            .query_row(
                "SELECT kind FROM agent_events WHERE run_id='r1' ORDER BY seq",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(kind, "model_turn");
    }

    #[test]
    fn reconcile_marks_stranded_runs_interrupted() {
        let conn = Connection::open_in_memory().unwrap();
        old_schema(&conn);
        migrate(&conn).unwrap();

        conn.execute_batch(
            "INSERT INTO agent_runs (id, status, started_at, updated_at) VALUES ('a','running',1,1);
             INSERT INTO agent_runs (id, status, started_at, updated_at) VALUES ('b','paused',1,1);
             INSERT INTO agent_runs (id, status, started_at, updated_at, error) VALUES ('c','running',1,1,'boom');
             INSERT INTO agent_runs (id, status, started_at, updated_at) VALUES ('d','done',1,1);",
        )
        .unwrap();

        let fixed = reconcile_agent_runs(&conn, 99).unwrap();
        assert_eq!(fixed, 3); // a, b, c — not the already-done d

        let statuses: Vec<(String, String)> = {
            let mut stmt = conn
                .prepare("SELECT id, status FROM agent_runs ORDER BY id")
                .unwrap();
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
            rows.map(|x| x.unwrap()).collect()
        };
        assert_eq!(
            statuses,
            vec![
                ("a".into(), "interrupted".into()),
                ("b".into(), "interrupted".into()),
                ("c".into(), "interrupted".into()),
                ("d".into(), "done".into()),
            ]
        );

        // An existing error message is preserved, not clobbered.
        let err_c: String = conn
            .query_row("SELECT error FROM agent_runs WHERE id='c'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(err_c, "boom");
    }

    #[test]
    fn migration_gives_a_project_ownership_of_its_memory() {
        let conn = Connection::open_in_memory().unwrap();
        old_schema(&conn);
        unowned_memory_tables(&conn);

        migrate(&conn).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

        // The row whose project no longer existed is gone. It was invisible in
        // the interface and impossible to remove from it, and every count that
        // read the table was wrong because of it.
        let ids: Vec<String> = {
            let mut stmt = conn.prepare("SELECT id FROM memory_facts ORDER BY id").unwrap();
            let rows = stmt.query_map([], |r| r.get(0)).unwrap();
            rows.map(|x| x.unwrap()).collect()
        };
        assert_eq!(ids, vec!["f1".to_string()]);

        // And the relationship is now declared, so it is enforced rather than
        // remembered.
        let orphan = conn.execute(
            "INSERT INTO memory_facts
               (id, project_id, kind, text, origin, status, created_at, updated_at)
             VALUES ('f3', 'nowhere', 'stack', 'x', 'user', 'unverified', 1, 1)",
            [],
        );
        assert!(orphan.is_err(), "a fact about no project must be refused");
    }

    #[test]
    fn deleting_a_project_takes_its_memory_with_it() {
        let conn = Connection::open_in_memory().unwrap();
        old_schema(&conn);
        unowned_memory_tables(&conn);
        migrate(&conn).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

        let removed = purge_project(&conn, "p1").expect("purge");
        assert_eq!(removed, 1, "the fact it owned is reported as removed");

        let left: i64 = conn
            .query_row("SELECT count(*) FROM memory_facts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn the_migration_can_be_run_twice() {
        // A partially applied migration is retried on the next launch, so
        // rebuilding a table that already has its key must be a no-op rather
        // than a second rebuild.
        let conn = Connection::open_in_memory().unwrap();
        old_schema(&conn);
        unowned_memory_tables(&conn);
        migrate(&conn).unwrap();
        migrate_v2(&conn).expect("second run is harmless");

        let left: i64 = conn
            .query_row("SELECT count(*) FROM memory_facts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 1);
    }

    /// Rehearse a migration on a copy of a real database before it runs on the
    /// original.
    ///
    /// Tests against a synthetic schema prove the logic; they cannot prove that
    /// *this* database, with whatever a year of use put in it, survives. Point
    /// `MAGNETAR_MIGRATE_FIXTURE` at a copy and this runs the real migration
    /// against it, then checks nothing was lost.
    ///
    /// Skipped when unset, so it never depends on anyone's private data.
    #[test]
    fn an_existing_database_migrates_without_losing_rows() {
        let Ok(fixture) = std::env::var("MAGNETAR_MIGRATE_FIXTURE") else {
            return;
        };
        let conn = Connection::open(&fixture).expect("open fixture");

        let before: Vec<(String, i64)> = PROJECT_SCOPED
            .iter()
            .map(|t| {
                let owned: i64 = conn
                    .query_row(
                        &format!(
                            "SELECT count(*) FROM {t} \
                             WHERE project_id IN (SELECT id FROM projects)"
                        ),
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                (t.to_string(), owned)
            })
            .collect();

        migrate(&conn).expect("migrate the real database");
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

        // Every row that had a project still has one. Only orphans may go.
        for (table, owned) in before {
            let after: i64 = conn
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
                .unwrap_or(0);
            assert_eq!(after, owned, "{table} lost rows that belonged to a project");
        }

        let report = integrity(&conn).expect("integrity");
        assert_eq!(report.structure, "ok");
        assert_eq!(report.orphans, 0);
    }

    #[test]
    fn a_healthy_database_reports_itself_healthy() {
        let conn = Connection::open_in_memory().unwrap();
        old_schema(&conn);
        unowned_memory_tables(&conn);
        migrate(&conn).unwrap();

        let report = integrity(&conn).expect("integrity");
        assert_eq!(report.structure, "ok");
        assert_eq!(report.orphans, 0, "the migration removed the orphan");
        assert_eq!(report.projects, 1);
        assert_eq!(report.facts, 1);
    }

    #[test]
    fn a_backup_is_a_file_that_opens_on_its_own() {
        let conn = Connection::open_in_memory().unwrap();
        old_schema(&conn);
        unowned_memory_tables(&conn);
        migrate(&conn).unwrap();

        let dest = std::env::temp_dir()
            .join(format!("magnetar-backup-{}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&dest);

        let bytes = backup_to(&conn, &dest).expect("backup");
        assert!(bytes > 0);

        // The point of a backup is that it can be read back without the app
        // that wrote it.
        let restored = Connection::open(&dest).expect("open backup");
        let facts: i64 = restored
            .query_row("SELECT count(*) FROM memory_facts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(facts, 1);

        // Refuses to overwrite: a backup that quietly replaces the previous one
        // is one backup, not two.
        assert!(backup_to(&conn, &dest).is_err());
        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    fn add_column_ignores_duplicate_column() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (id TEXT)").unwrap();

        add_column(&conn, "ALTER TABLE t ADD COLUMN extra TEXT").unwrap();
        // Adding the same column again must be a silent no-op.
        add_column(&conn, "ALTER TABLE t ADD COLUMN extra TEXT").unwrap();
    }

    #[test]
    fn add_column_fails_on_missing_table() {
        let conn = Connection::open_in_memory().unwrap();

        let err = add_column(&conn, "ALTER TABLE nope ADD COLUMN x TEXT").unwrap_err();
        assert!(err.contains("no such table"), "unexpected error: {err}");
    }
}
