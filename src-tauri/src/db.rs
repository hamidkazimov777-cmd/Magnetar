//! Local SQLite store — the provider-neutral canonical transcript. This is the
//! source of truth for sessions/messages so a conversation survives app
//! restarts and switching between different providers/APIs.

use once_cell::sync::OnceCell;
use rusqlite::Connection;
use std::sync::Mutex;

static DB: OnceCell<Mutex<Connection>> = OnceCell::new();

pub fn init(app_dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(app_dir).map_err(|e| e.to_string())?;
    let path = app_dir.join("magnetar.sqlite");
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;

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

    // Best-effort migrations for DBs created by an earlier schema. Duplicate
    // column errors are expected and ignored.
    for stmt in [
        "ALTER TABLE sessions ADD COLUMN connection_id TEXT",
        "ALTER TABLE sessions ADD COLUMN model TEXT",
        "ALTER TABLE sessions ADD COLUMN summary TEXT",
        "ALTER TABLE sessions ADD COLUMN summary_up_to_id TEXT",
        "ALTER TABLE sessions ADD COLUMN project_id TEXT",
        "ALTER TABLE messages ADD COLUMN model TEXT",
        "ALTER TABLE messages ADD COLUMN attachments TEXT",
        "ALTER TABLE projects ADD COLUMN path TEXT",
        "ALTER TABLE projects ADD COLUMN last_state TEXT",
    ] {
        let _ = conn.execute(stmt, []);
    }

    DB.set(Mutex::new(conn))
        .map_err(|_| "db already initialized".to_string())?;
    Ok(())
}

pub fn with_conn<T>(f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let m = DB.get().ok_or("db not initialized")?;
    let guard = m.lock().map_err(|e| e.to_string())?;
    f(&guard)
}
