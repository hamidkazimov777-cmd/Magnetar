//! Tauri command surface — the bridge the React frontend calls via `invoke`.

use crate::canon::{self, MessageRow, SessionMeta};
use crate::keychain;
use crate::providers::{build_provider, ChatParams, Connection, ModelInfo, StreamEvent};
use tauri::ipc::Channel;

// ---- Canon (SQLite) --------------------------------------------------------

#[tauri::command]
pub fn list_sessions() -> Result<Vec<SessionMeta>, String> {
    canon::list_sessions()
}

#[tauri::command]
pub fn load_messages(session_id: String) -> Result<Vec<MessageRow>, String> {
    canon::load_messages(&session_id)
}

#[tauri::command]
pub fn save_session(meta: SessionMeta) -> Result<(), String> {
    canon::save_session(meta)
}

#[tauri::command]
pub fn upsert_message(message: MessageRow) -> Result<(), String> {
    canon::upsert_message(message)
}

#[tauri::command]
pub fn delete_session(id: String) -> Result<(), String> {
    canon::delete_session(&id)
}

// ---- Secrets (Keychain) ----------------------------------------------------

#[tauri::command]
pub fn save_api_key(connection_id: String, key: String) -> Result<(), String> {
    keychain::set_key(&connection_id, &key)
}

#[tauri::command]
pub fn delete_api_key(connection_id: String) -> Result<(), String> {
    keychain::delete_key(&connection_id)
}

#[tauri::command]
pub fn has_api_key(connection_id: String) -> Result<bool, String> {
    Ok(keychain::has_key(&connection_id))
}

// ---- Provider calls --------------------------------------------------------

fn resolve_key(conn: &Connection) -> Result<String, String> {
    keychain::get_key(&conn.id)?
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "No API key saved for this connection".to_string())
}

#[tauri::command]
pub async fn list_models(connection: Connection) -> Result<Vec<ModelInfo>, String> {
    let key = resolve_key(&connection)?;
    let provider = build_provider(&connection, key).map_err(|e| e.to_string())?;
    provider.list_models().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn complete(connection: Connection, params: ChatParams) -> Result<String, String> {
    let key = resolve_key(&connection)?;
    let provider = build_provider(&connection, key).map_err(|e| e.to_string())?;
    provider.complete(params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn chat_stream(
    connection: Connection,
    params: ChatParams,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    let key = resolve_key(&connection)?;
    let provider = build_provider(&connection, key).map_err(|e| e.to_string())?;
    if let Err(e) = provider.chat_stream(params, &on_event).await {
        let _ = on_event.send(StreamEvent::Error {
            message: e.to_string(),
        });
        return Err(e.to_string());
    }
    Ok(())
}
