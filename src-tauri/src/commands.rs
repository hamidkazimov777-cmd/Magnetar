//! Tauri command surface — the bridge the React frontend calls via `invoke`.

use crate::canon::{self, MessageRow, SessionMeta};
use crate::keychain;
use crate::providers::{
    build_provider, AgentStep, ChatParams, Connection, ModelInfo, StreamEvent, ToolDef,
};
use crate::tools;
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
pub async fn agent_step(
    connection: Connection,
    model: String,
    messages: Vec<serde_json::Value>,
    tools: Vec<ToolDef>,
) -> Result<AgentStep, String> {
    let key = resolve_key(&connection)?;
    let provider = build_provider(&connection, key).map_err(|e| e.to_string())?;
    provider
        .agent_step(model, messages, tools)
        .await
        .map_err(|e| e.to_string())
}

// ---- Agent tools -----------------------------------------------------------

#[tauri::command]
pub fn tool_read_file(path: String) -> Result<tools::ReadResult, String> {
    tools::read_file(&path)
}

#[tauri::command]
pub fn tool_list_dir(path: String) -> Result<Vec<tools::DirEntry>, String> {
    tools::list_dir(&path)
}

#[tauri::command]
pub fn tool_grep(pattern: String, path: Option<String>) -> Result<Vec<tools::GrepHit>, String> {
    tools::grep(&pattern, path.as_deref().unwrap_or("."))
}

#[tauri::command]
pub fn tool_write_file(path: String, content: String) -> Result<usize, String> {
    tools::write_file(&path, &content)
}

#[tauri::command]
pub fn tool_edit_file(
    path: String,
    old_string: String,
    new_string: String,
) -> Result<tools::EditResult, String> {
    tools::edit_file(&path, &old_string, &new_string)
}

#[tauri::command]
pub fn tool_run_bash(command: String, cwd: Option<String>) -> Result<tools::BashResult, String> {
    tools::run_bash(&command, cwd.as_deref())
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
