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
const SCHEMA_VERSION: i64 = 1;

pub fn init(app_dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(app_dir).map_err(|e| e.to_string())?;
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
            deleted_at  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);

        CREATE TABLE IF NOT EXISTS timeline_events (
            id          TEXT PRIMARY KEY,
            project_id  TEXT NOT NULL,
            event_type  TEXT NOT NULL,
            content     TEXT NOT NULL,
            created_at  INTEGER NOT NULL
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
            deleted_at    INTEGER
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
            deleted_at   INTEGER
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
            resolved_at INTEGER
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
            reviewed_at INTEGER
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
            other => return Err(format!("unknown schema version {other}")),
        }
        conn.execute_batch(&format!("PRAGMA user_version = {v}"))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// v0 → v1: add columns introduced after the first schema. Only "duplicate
/// column" is expected and ignored — anything else is a real failure.
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
fn add_column(conn: &Connection, stmt: &str) -> Result<(), String> {
    if let Err(e) = conn.execute(stmt, []) {
        let msg = e.to_string();
        if !msg.contains("duplicate column") {
            return Err(msg);
        }
    }
    Ok(())
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
