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
        "ALTER TABLE messages ADD COLUMN model TEXT",
        "ALTER TABLE messages ADD COLUMN attachments TEXT",
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
