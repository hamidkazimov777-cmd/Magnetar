//! CRUD over the canonical transcript (see `db.rs`). DTOs here mirror the
//! frontend `Session`/`ChatMessage` shapes (camelCase on the wire via serde).

use crate::db::with_conn;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub id: String,
    pub title: String,
    pub connection_id: Option<String>,
    pub model: Option<String>,
    pub summary: Option<String>,
    pub summary_up_to_id: Option<String>,
    pub project_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRow {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub model: Option<String>,
    pub attachments: Option<String>,
    pub created_at: i64,
}

pub fn list_sessions() -> Result<Vec<SessionMeta>, String> {
    with_conn(|c| {
        let mut stmt = c
            .prepare(
                "SELECT id, title, connection_id, model, summary, summary_up_to_id, \
                 project_id, created_at, updated_at FROM sessions ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(SessionMeta {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    connection_id: r.get(2)?,
                    model: r.get(3)?,
                    summary: r.get(4)?,
                    summary_up_to_id: r.get(5)?,
                    project_id: r.get(6)?,
                    created_at: r.get(7)?,
                    updated_at: r.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

pub fn load_messages(session_id: &str) -> Result<Vec<MessageRow>, String> {
    with_conn(|c| {
        let mut stmt = c
            .prepare(
                "SELECT id, session_id, role, content, model, attachments, created_at \
                 FROM messages WHERE session_id = ?1 ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], |r| {
                Ok(MessageRow {
                    id: r.get(0)?,
                    session_id: r.get(1)?,
                    role: r.get(2)?,
                    content: r.get(3)?,
                    model: r.get(4)?,
                    attachments: r.get(5)?,
                    created_at: r.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

pub fn save_session(meta: SessionMeta) -> Result<(), String> {
    with_conn(|c| {
        c.execute(
            "INSERT INTO sessions \
               (id, title, connection_id, model, summary, summary_up_to_id, project_id, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
             ON CONFLICT(id) DO UPDATE SET \
               title=excluded.title, connection_id=excluded.connection_id, \
               model=excluded.model, summary=excluded.summary, \
               summary_up_to_id=excluded.summary_up_to_id, project_id=excluded.project_id, updated_at=excluded.updated_at",
            params![
                meta.id,
                meta.title,
                meta.connection_id,
                meta.model,
                meta.summary,
                meta.summary_up_to_id,
                meta.project_id,
                meta.created_at,
                meta.updated_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn upsert_message(msg: MessageRow) -> Result<(), String> {
    with_conn(|c| {
        c.execute(
            "INSERT INTO messages (id, session_id, role, content, model, attachments, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
             ON CONFLICT(id) DO UPDATE SET content=excluded.content, model=excluded.model, attachments=excluded.attachments",
            params![
                msg.id,
                msg.session_id,
                msg.role,
                msg.content,
                msg.model,
                msg.attachments,
                msg.created_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        // Touch the parent session so it sorts to the top.
        c.execute(
            "UPDATE sessions SET updated_at = ?2 WHERE id = ?1",
            params![msg.session_id, msg.created_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// Delete a message and everything after it in the same session.
///
/// This is what "edit a message" means for a transcript: the turns that
/// followed were answers to the old wording, so keeping them would leave the
/// model reading a conversation that never happened. Ordering is by created_at
/// with id as the tiebreaker, matching how messages are loaded back.
pub fn delete_messages_from(session_id: &str, message_id: &str) -> Result<(), String> {
    with_conn(|c| {
        let created_at: i64 = c
            .query_row(
                "SELECT created_at FROM messages WHERE id = ?1 AND session_id = ?2",
                params![message_id, session_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;

        c.execute(
            "DELETE FROM messages WHERE session_id = ?1 \
             AND (created_at > ?2 OR (created_at = ?2 AND id >= ?3))",
            params![session_id, created_at, message_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn delete_session(id: &str) -> Result<(), String> {
    with_conn(|c| {
        c.execute("DELETE FROM messages WHERE session_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        c.execute("DELETE FROM sessions WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}
