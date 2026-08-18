//! Tauri command surface — the bridge the React frontend calls via `invoke`.

use crate::canon::{self, MessageRow, SessionMeta};
use crate::workspace::{
    self, ConnectionRow, KnowledgeEdge, KnowledgeNode, Project, Task, TimelineEvent,
};
use crate::keychain;
use crate::providers::{
    build_provider, AgentStep, ChatParams, Connection, ModelInfo, StreamEvent, ToolDef,
};
use crate::tools;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

/// Live stream cancellation flags, keyed by a frontend-supplied request id.
static CANCELS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

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

// ---- Connections (durable, in SQLite) --------------------------------------

#[tauri::command]
pub fn list_connections() -> Result<Vec<ConnectionRow>, String> {
    workspace::list_connections()
}

#[tauri::command]
pub fn save_connection(connection: ConnectionRow) -> Result<(), String> {
    workspace::save_connection(connection)
}

#[tauri::command]
pub fn delete_connection(id: String) -> Result<(), String> {
    workspace::delete_connection(&id)
}

// ---- Workspace (Projects, Tasks, Knowledge, Timeline) ----------------------

#[tauri::command]
pub fn list_projects() -> Result<Vec<Project>, String> {
    workspace::list_projects()
}

#[tauri::command]
pub fn save_project(project: Project) -> Result<(), String> {
    workspace::save_project(project)
}

#[tauri::command]
pub fn delete_project(id: String) -> Result<(), String> {
    workspace::delete_project(&id)
}

#[tauri::command]
pub fn list_tasks(project_id: String) -> Result<Vec<Task>, String> {
    workspace::list_tasks(&project_id)
}

#[tauri::command]
pub fn save_task(task: Task) -> Result<(), String> {
    workspace::save_task(task)
}

#[tauri::command]
pub fn delete_task(id: String) -> Result<(), String> {
    workspace::delete_task(&id)
}

#[tauri::command]
pub fn list_knowledge_nodes(project_id: String) -> Result<Vec<KnowledgeNode>, String> {
    workspace::list_knowledge_nodes(&project_id)
}

#[tauri::command]
pub fn save_knowledge_node(node: KnowledgeNode) -> Result<(), String> {
    workspace::save_knowledge_node(node)
}

#[tauri::command]
pub fn list_knowledge_edges(project_id: String) -> Result<Vec<KnowledgeEdge>, String> {
    workspace::list_knowledge_edges(&project_id)
}

#[tauri::command]
pub fn save_knowledge_edge(edge: KnowledgeEdge) -> Result<(), String> {
    workspace::save_knowledge_edge(edge)
}

#[tauri::command]
pub fn list_timeline_events(project_id: String) -> Result<Vec<TimelineEvent>, String> {
    workspace::list_timeline_events(&project_id)
}

#[tauri::command]
pub fn save_timeline_event(event: TimelineEvent) -> Result<(), String> {
    workspace::save_timeline_event(event)
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
pub fn tool_read_file(
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<tools::ReadResult, String> {
    tools::read_file(&path, offset, limit)
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
pub fn tool_attach_file(path: String) -> Result<String, String> {
    if std::path::Path::new(&path).exists() {
        Ok(format!("File {} successfully attached.", path))
    } else {
        Err(format!("File not found: {}", path))
    }
}

#[tauri::command]
pub fn tool_kill_bash(pid: Option<u32>) -> Result<(), String> {
    tools::kill_bash(pid)
}

#[tauri::command]
pub fn extract_pdf_text(path: String) -> Result<String, String> {
    pdf_extract::extract_text(&path).map_err(|e| format!("Failed to extract PDF: {}", e))
}

/// Full file read for the code editor (no size cap).
#[tauri::command]
pub fn editor_read_file(path: String) -> Result<String, String> {
    tools::read_text(&path)
}

// ---- Codebase index (BM25 retrieval) --------------------------------------

#[tauri::command]
pub fn index_build(root: String) -> Result<crate::index::IndexStats, String> {
    crate::index::build(&root)
}

#[tauri::command]
pub fn index_search(
    root: String,
    query: String,
    top_k: Option<usize>,
) -> Result<Vec<crate::index::SearchHit>, String> {
    crate::index::search(&root, &query, top_k.unwrap_or(8))
}

#[tauri::command]
pub fn git_exec(cwd: String, args: Vec<String>) -> Result<tools::BashResult, String> {
    tools::git_exec(&cwd, args)
}

// ---- Embedded terminal (PTY) ----------------------------------------------

#[tauri::command]
pub fn pty_spawn(
    id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_data: Channel<String>,
) -> Result<(), String> {
    crate::pty::spawn(id, cwd, cols, rows, on_data)
}

#[tauri::command]
pub fn pty_write(id: String, data: String) -> Result<(), String> {
    crate::pty::write(&id, &data)
}

#[tauri::command]
pub fn pty_resize(id: String, cols: u16, rows: u16) -> Result<(), String> {
    crate::pty::resize(&id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(id: String) -> Result<(), String> {
    crate::pty::kill(&id)
}

#[tauri::command]
pub async fn chat_stream(
    connection: Connection,
    params: ChatParams,
    request_id: String,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    let key = resolve_key(&connection)?;
    let provider = build_provider(&connection, key).map_err(|e| e.to_string())?;

    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut m) = CANCELS.lock() {
        m.insert(request_id.clone(), cancel.clone());
    }

    let result = provider.chat_stream(params, &on_event, cancel).await;

    if let Ok(mut m) = CANCELS.lock() {
        m.remove(&request_id);
    }

    if let Err(e) = result {
        let _ = on_event.send(StreamEvent::Error {
            message: e.to_string(),
        });
        return Err(e.to_string());
    }
    Ok(())
}

/// Ask an in-flight `chat_stream` to stop early.
#[tauri::command]
pub fn cancel_stream(request_id: String) -> Result<(), String> {
    if let Ok(m) = CANCELS.lock() {
        if let Some(flag) = m.get(&request_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}
