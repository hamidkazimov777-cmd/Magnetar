//! Tauri command surface — the bridge the React frontend calls via `invoke`.

use crate::canon::{self, MessageRow, SessionMeta};
use crate::workspace::{
    self, AgentEventRow, AgentRunRow, ConnectionRow, Decision, Divergence, GenerationRow,
    KnowledgeEdge, KnowledgeNode, MemoryFact, Project, Proposal, Task,
    TimelineEvent,
};
use crate::keychain;
use crate::providers::{
    build_provider, AgentStep, ChatParams, Connection, ModelInfo, StreamEvent, ToolDef,
};
use crate::audit;
use crate::paths::{self, Decision as PathDecision};
use crate::policy::{self, Access};
use crate::tools;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// Live stream cancellation flags, keyed by a frontend-supplied request id.
static CANCELS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Shared HTTP client for media generation (image/video) calls. Cloning shares
/// one connection pool instead of rebuilding TLS per request.
static GEN_HTTP: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .pool_idle_timeout(std::time::Duration::from_secs(90))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});

// ---- Canon (SQLite) --------------------------------------------------------

/// Run blocking work off the UI thread.
///
/// A synchronous `#[tauri::command]` executes on the main thread, so anything
/// slow there freezes the whole window — `run_bash` could hang it for the full
/// timeout. Every long command goes through here instead.
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("task failed: {e}"))?
}

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

// ---- Agent runs (durable) --------------------------------------------------

#[tauri::command]
pub fn agent_run_save(run: AgentRunRow) -> Result<(), String> {
    workspace::save_agent_run(run)
}

#[tauri::command]
pub fn agent_event_append(
    run_id: String,
    id: String,
    kind: String,
    payload: Option<String>,
    created_at: i64,
) -> Result<i64, String> {
    workspace::append_agent_event(&run_id, &id, &kind, payload, created_at)
}

#[tauri::command]
pub fn agent_runs_list(session_id: Option<String>, limit: Option<i64>) -> Result<Vec<AgentRunRow>, String> {
    workspace::list_agent_runs(session_id, limit.unwrap_or(50))
}

#[tauri::command]
pub fn agent_runs_active() -> Result<Vec<AgentRunRow>, String> {
    workspace::active_agent_runs()
}

#[tauri::command]
pub fn agent_run_get(id: String) -> Result<Option<AgentRunRow>, String> {
    workspace::get_agent_run(&id)
}

#[tauri::command]
pub fn agent_events_list(run_id: String) -> Result<Vec<AgentEventRow>, String> {
    workspace::list_agent_events(&run_id)
}

#[tauri::command]
pub fn agent_runs_reconcile() -> Result<usize, String> {
    workspace::reconcile_agent_runs()
}

#[tauri::command]
pub fn agent_run_delete(id: String) -> Result<(), String> {
    workspace::delete_agent_run(&id)
}

// ---- Generations (Studio gallery, durable) ---------------------------------

#[tauri::command]
pub fn generation_save(generation: GenerationRow) -> Result<(), String> {
    workspace::save_generation(generation)
}

#[tauri::command]
pub fn generations_list(limit: Option<i64>) -> Result<Vec<GenerationRow>, String> {
    workspace::list_generations(limit.unwrap_or(100))
}

#[tauri::command]
pub fn generation_delete(id: String) -> Result<(), String> {
    workspace::delete_generation(&id)
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
pub async fn create_project_dir(app: tauri::AppHandle, name: String) -> Result<String, String> {
    use tauri::Manager;
    let home = app
        .path()
        .home_dir()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .into_owned();
    blocking(move || tools::create_project_dir(&home, &name)).await
}

#[tauri::command]
pub fn list_facts(project_id: String) -> Result<Vec<MemoryFact>, String> {
    workspace::list_facts(&project_id)
}

#[tauri::command]
pub fn save_facts(facts: Vec<MemoryFact>) -> Result<(), String> {
    workspace::save_facts(facts)
}

#[tauri::command]
pub fn delete_fact(id: String) -> Result<(), String> {
    workspace::delete_fact(&id)
}

#[tauri::command]
pub fn list_decisions(project_id: String) -> Result<Vec<Decision>, String> {
    workspace::list_decisions(&project_id)
}

#[tauri::command]
pub fn save_decision(decision: Decision) -> Result<(), String> {
    workspace::save_decision(decision)
}

#[tauri::command]
pub fn delete_decision(id: String) -> Result<(), String> {
    workspace::delete_decision(&id)
}

#[tauri::command]
pub fn list_divergences(project_id: String) -> Result<Vec<Divergence>, String> {
    workspace::list_divergences(&project_id)
}

#[tauri::command]
pub fn save_divergence(divergence: Divergence) -> Result<(), String> {
    workspace::save_divergence(divergence)
}

#[tauri::command]
pub fn list_proposals(project_id: String) -> Result<Vec<Proposal>, String> {
    workspace::list_proposals(&project_id)
}

#[tauri::command]
pub fn save_proposal(proposal: Proposal) -> Result<(), String> {
    workspace::save_proposal(proposal)
}

/// Remember the resolved theme so the next launch paints the native window in
/// the right colour before the webview loads (kills the launch flash), and
/// recolour the live window now so an in-session theme switch sticks too.
#[tauri::command]
pub fn persist_window_theme(app: tauri::AppHandle, dark: bool) -> Result<(), String> {
    use tauri::Manager;
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join("window-theme"), if dark { "dark" } else { "light" });
    }
    if let Some(win) = app.get_webview_window("main") {
        let color = if dark {
            tauri::window::Color(0, 0, 0, 255)
        } else {
            tauri::window::Color(255, 255, 255, 255)
        };
        let _ = win.set_background_color(Some(color));
    }
    Ok(())
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

/// Where this connection's key is actually kept.
///
/// Surfaced so Settings can state the truth instead of letting the user assume
/// the Keychain: a debug build that fell back to a file must say so.
#[tauri::command]
pub fn key_storage(connection_id: String) -> keychain::Storage {
    keychain::storage_of(&connection_id)
}

// ---- Provider calls --------------------------------------------------------

/// Resolve the saved API key off the main thread: `get_key` does file I/O and,
/// on first sight, a one-time Keychain read — blocking work that must not run
/// inside an async command on the runtime's worker.
async fn resolve_key(conn: &Connection) -> Result<String, String> {
    let id = conn.id.clone();
    blocking(move || {
        keychain::get_key(&id)?
            .filter(|k| !k.is_empty())
            .ok_or_else(|| "No API key saved for this connection".to_string())
    })
    .await
}

#[tauri::command]
pub async fn list_models(connection: Connection) -> Result<Vec<ModelInfo>, String> {
    let key = resolve_key(&connection).await?;
    let provider = build_provider(&connection, key).map_err(|e| e.to_string())?;
    provider.list_models().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn complete(connection: Connection, params: ChatParams) -> Result<String, String> {
    let key = resolve_key(&connection).await?;
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
    let key = resolve_key(&connection).await?;
    let provider = build_provider(&connection, key).map_err(|e| e.to_string())?;
    provider
        .agent_step(model, messages, tools)
        .await
        .map_err(|e| e.to_string())
}

/// Streaming agent step. Same as `agent_step`, but text and reasoning reach the
/// UI as they are produced, and the run can be cancelled mid-turn.
#[tauri::command]
pub async fn agent_step_stream(
    connection: Connection,
    model: String,
    messages: Vec<serde_json::Value>,
    tools: Vec<ToolDef>,
    request_id: String,
    on_event: Channel<StreamEvent>,
) -> Result<AgentStep, String> {
    let key = resolve_key(&connection).await?;
    let provider = build_provider(&connection, key).map_err(|e| e.to_string())?;

    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut m) = CANCELS.lock() {
        m.insert(request_id.clone(), cancel.clone());
    }

    let result = provider
        .agent_step_stream(model, messages, tools, &on_event, cancel)
        .await;

    if let Ok(mut m) = CANCELS.lock() {
        m.remove(&request_id);
    }

    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_messages_from(session_id: String, message_id: String) -> Result<(), String> {
    canon::delete_messages_from(&session_id, &message_id)
}


// ---- Modes -----------------------------------------------------------------

/// Turn read-only mode on or off.
///
/// Held in Rust, not in the store: a switch the webview owns is one that stops
/// existing the moment the page is compromised, and a hidden button is not a
/// control.
#[tauri::command]
pub fn set_read_only(on: bool) {
    policy::set_read_only(on);
}

#[tauri::command]
pub fn read_only() -> bool {
    policy::read_only()
}

// ---- Path authorization ----------------------------------------------------

/// Tell the backend which folder is open. Containment is decided here rather
/// than in the store: the webview is the side that gets compromised, and a
/// boundary it can move is not a boundary.
#[tauri::command]
pub fn set_workspace_root(root: Option<String>) {
    // Trust follows the folder, so both have to learn about it together.
    // Canonicalised first: a folder reached through a symlink is the same
    // folder, and trusting it twice under two names is how a "trusted" list
    // starts disagreeing with itself.
    let canonical = root
        .as_ref()
        .and_then(|r| std::path::Path::new(r).canonicalize().ok());
    paths::set_workspace_root(root);
    policy::set_workspace(canonical);
}

/// Vouch for the open folder: allow changes and commands in it, and remember.
///
/// Remembered per folder because being asked every morning about the project
/// you work in daily is how a prompt becomes something people click through
/// without reading.
#[tauri::command]
pub fn trust_workspace() -> Result<(), String> {
    policy::trust_workspace()
}

#[tauri::command]
pub fn distrust_workspace() {
    policy::distrust_workspace();
}

#[tauri::command]
pub fn workspace_trusted() -> bool {
    policy::trusted()
}

/// Resolve a requested path, and when it lands outside the open folder, ask
/// the user.
///
/// The dialog is drawn by the backend on purpose. The frontend already has its
/// own confirmation flow, but a confirmation the webview renders is one a
/// compromised webview can skip — and the strings being confirmed usually came
/// from a model in the first place. This one the page cannot draw, cannot
/// answer and cannot bypass.
///
/// The workspace root is deliberately not a wall: work outside it is allowed,
/// it just has to be the user who allows it.
async fn ensure_allowed(app: &tauri::AppHandle, requested: &str) -> Result<std::path::PathBuf, String> {
    match paths::authorize(requested)? {
        PathDecision::Allowed(p) => Ok(p),
        PathDecision::NeedsGrant(p) => {
            let (tx, rx) = tokio::sync::oneshot::channel();
            app.dialog()
                .message(format!(
                    "{}\n\nAllow Magnetar to work there?",
                    paths::outside_message(&p)
                ))
                .title("Work outside the project folder?")
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Allow".into(),
                    "Deny".into(),
                ))
                .show(move |granted| {
                    let _ = tx.send(granted);
                });
            // A dialog that cannot report an answer is not an approval.
            if rx.await.unwrap_or(false) {
                paths::grant(&p);
                Ok(p)
            } else {
                Err(format!("denied: {}", paths::outside_message(&p)))
            }
        }
    }
}

// ---- Agent tools -----------------------------------------------------------

#[tauri::command]
pub async fn tool_read_file(
    app: tauri::AppHandle,
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<tools::ReadResult, String> {
    policy::require(Access::Read)?;
    let path = ensure_allowed(&app, &path).await?;
    blocking(move || tools::read_file(&path.to_string_lossy(), offset, limit)).await
}

#[tauri::command]
pub async fn tool_list_dir(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<tools::DirEntry>, String> {
    policy::require(Access::Read)?;
    let path = ensure_allowed(&app, &path).await?;
    blocking(move || tools::list_dir(&path.to_string_lossy())).await
}

#[tauri::command]
pub async fn tool_grep(
    app: tauri::AppHandle,
    pattern: String,
    path: Option<String>,
) -> Result<Vec<tools::GrepHit>, String> {
    policy::require(Access::Read)?;
    // "." used to mean the process working directory, which is wherever the
    // app happened to be launched from — not the project. Resolving it against
    // the workspace root is both the containment fix and the correct default.
    let root = ensure_allowed(&app, path.as_deref().unwrap_or(".")).await?;
    blocking(move || tools::grep(&pattern, &root.to_string_lossy())).await
}

#[tauri::command]
pub async fn tool_create_dir(
    app: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    policy::require(Access::Write)?;
    let path = ensure_allowed(&app, &path).await?;
    blocking(move || tools::create_dir(&path.to_string_lossy())).await
}

#[tauri::command]
pub async fn tool_write_file(
    app: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<usize, String> {
    policy::require(Access::Write)?;
    let path = ensure_allowed(&app, &path).await?;
    blocking(move || tools::write_file(&path.to_string_lossy(), &content)).await
}

#[tauri::command]
pub async fn list_project_files(app: tauri::AppHandle, root: String) -> Result<Vec<String>, String> {
    policy::require(Access::Read)?;
    let root = ensure_allowed(&app, &root).await?.to_string_lossy().into_owned();
    blocking(move || crate::index::list_files(&root)).await
}

#[tauri::command]
pub async fn tool_delete_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    policy::require(Access::Write)?;
    let path = ensure_allowed(&app, &path).await?;
    blocking(move || tools::delete_file(&path.to_string_lossy())).await
}

#[tauri::command]
pub async fn tool_edit_file(
    app: tauri::AppHandle,
    path: String,
    old_string: String,
    new_string: String,
) -> Result<tools::EditResult, String> {
    policy::require(Access::Write)?;
    let path = ensure_allowed(&app, &path).await?;
    blocking(move || tools::edit_file(&path.to_string_lossy(), &old_string, &new_string)).await
}

#[tauri::command]
pub async fn tool_run_bash(
    app: tauri::AppHandle,
    command: String,
    cwd: Option<String>,
    timeout_secs: Option<u64>,
) -> Result<tools::BashResult, String> {
    policy::require(Access::Execute)?;
    // A command is an opaque string: working out what `make deploy` will touch
    // means running it. So containment applies to where the command *starts* —
    // with no cwd it used to inherit the process working directory, which is
    // wherever the app happened to be launched from — and the record below
    // covers what containment cannot.
    let requested = cwd.clone().unwrap_or_else(|| ".".into());
    let dir = match ensure_allowed(&app, &requested).await {
        Ok(dir) => dir.to_string_lossy().into_owned(),
        Err(refusal) => {
            audit::record("bash", &requested, &command, &refusal);
            return Err(refusal);
        }
    };

    let logged = command.clone();
    let in_dir = dir.clone();
    let result = blocking(move || tools::run_bash(&command, Some(&dir), timeout_secs)).await;
    audit::record(
        "bash",
        &in_dir,
        &logged,
        &match &result {
            Ok(r) => format!("exit {}", r.code),
            Err(e) => format!("failed: {e}"),
        },
    );
    result
}

/// Open the system file picker and grant what the user chooses.
///
/// The picker runs here rather than in the webview because choosing a file *is*
/// the authorization: a person selecting `~/Desktop/photo.png` in the system
/// dialog has said what they want far more clearly than any second prompt could
/// ask them. Doing it in the backend means the grant can be recorded on the
/// strength of that choice, instead of the frontend asking to be trusted about
/// what the user picked.
#[tauri::command]
pub async fn pick_attachments(
    app: tauri::AppHandle,
    extensions: Vec<String>,
) -> Result<Vec<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let refs: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
    app.dialog()
        .file()
        .add_filter("Attachments", &refs)
        .pick_files(move |chosen| {
            let _ = tx.send(chosen);
        });

    let Some(chosen) = rx.await.unwrap_or(None) else {
        return Ok(Vec::new()); // the user cancelled
    };

    let mut out = Vec::with_capacity(chosen.len());
    for file in chosen {
        let path = file.into_path().map_err(|e| e.to_string())?;
        // Grant the file itself, not its folder: picking one image is not
        // permission to read everything sitting next to it.
        paths::grant(&path);
        out.push(path.to_string_lossy().into_owned());
    }
    Ok(out)
}

/// Ask where to save something, and grant what the user chooses.
///
/// Same reasoning as `pick_attachments`: naming a destination in the system
/// dialog is the permission. The dialog runs here so the grant rests on the
/// user's choice rather than on the frontend reporting what they chose.
#[tauri::command]
pub async fn pick_save_path(
    app: tauri::AppHandle,
    suggested_name: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let refs: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
    app.dialog()
        .file()
        .set_file_name(suggested_name)
        .add_filter("Magnetar", &refs)
        .save_file(move |chosen| {
            let _ = tx.send(chosen);
        });

    let Some(chosen) = rx.await.unwrap_or(None) else {
        return Ok(None); // cancelled
    };
    let path = chosen.into_path().map_err(|e| e.to_string())?;
    paths::grant(&path);
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// What a health check found. Reported, never repaired automatically.
#[tauri::command]
pub async fn db_integrity() -> Result<crate::db::Integrity, String> {
    blocking(|| crate::db::with_conn(crate::db::integrity)).await
}

/// Write a consistent copy of the whole database somewhere the user chose.
#[tauri::command]
pub async fn db_backup(app: tauri::AppHandle, dest: String) -> Result<u64, String> {
    let dest = ensure_allowed(&app, &dest).await?;
    blocking(move || crate::db::with_conn(|c| crate::db::backup_to(c, &dest))).await
}

/// Read a file as base64 for the composer's attachments.
///
/// This used to be `readFile` from the fs plugin, which answers to Tauri's own
/// scope rather than to path containment — two policies deciding the same
/// question, and only one of them auditable. It also meant a dragged-in file
/// could not be read at all: the dialog plugin grants scope for a *picked*
/// path, and a drop is not a pick, so dragging an image into the composer went
/// through a permission the app never granted.
///
/// Going through the same gate as every other file command fixes both.
#[tauri::command]
pub async fn read_file_base64(app: tauri::AppHandle, path: String) -> Result<String, String> {
    policy::require(Access::Read)?;
    const MAX_BYTES: u64 = 25 * 1024 * 1024;
    let path = ensure_allowed(&app, &path).await?;
    blocking(move || {
        let size = std::fs::metadata(&path).map_err(|e| format!("{}: {e}", path.display()))?.len();
        // Attachments are inlined into a prompt as base64, which is a third
        // larger again. A refusal with the size in it is far more use than a
        // provider error about the request body.
        if size > MAX_BYTES {
            return Err(format!(
                "{} is {:.1} MB; attachments are limited to 25 MB",
                path.display(),
                size as f64 / (1024.0 * 1024.0)
            ));
        }
        let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes))
    })
    .await
}

#[tauri::command]
pub async fn tool_attach_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    policy::require(Access::Read)?;
    let path = ensure_allowed(&app, &path).await?;
    if path.exists() {
        Ok(format!("File {} successfully attached.", path.display()))
    } else {
        Err(format!("File not found: {}", path.display()))
    }
}

#[tauri::command]
pub fn tool_kill_bash(pid: Option<u32>) -> Result<(), String> {
    tools::kill_bash(pid)
}

#[tauri::command]
pub async fn extract_pdf_text(app: tauri::AppHandle, path: String) -> Result<String, String> {
    policy::require(Access::Read)?;
    let path = ensure_allowed(&app, &path).await?;
    blocking(move || {
        pdf_extract::extract_text(&path).map_err(|e| format!("Failed to extract PDF: {}", e))
    })
    .await
}

/// Full file read for the code editor (no size cap).
#[tauri::command]
pub async fn editor_read_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    policy::require(Access::Read)?;
    let path = ensure_allowed(&app, &path).await?;
    blocking(move || tools::read_text(&path.to_string_lossy())).await
}

// ---- Text search -----------------------------------------------------------

/// Search the project's text, reporting why it stopped.
///
/// `id` is the caller's handle on this run: passing it to `search_cancel`
/// stops that search and no other. Without one, a user typing quickly would
/// cancel the search they are waiting for along with the one they abandoned.
#[tauri::command]
pub async fn search_text(
    app: tauri::AppHandle,
    root: String,
    pattern: String,
    options: crate::search::Options,
    id: String,
) -> Result<crate::search::Outcome, String> {
    policy::require(Access::Read)?;
    let root = ensure_allowed(&app, &root).await?;
    blocking(move || crate::search::run(&root.to_string_lossy(), &pattern, &options, &id)).await
}

#[tauri::command]
pub fn search_cancel(id: String) {
    crate::search::cancel(&id);
}

// ---- Codebase index (BM25 retrieval) --------------------------------------

#[tauri::command]
pub async fn index_build(app: tauri::AppHandle, root: String) -> Result<crate::index::IndexStats, String> {
    policy::require(Access::Read)?;
    let root = ensure_allowed(&app, &root).await?.to_string_lossy().into_owned();
    blocking(move || crate::index::sync(&root)).await
}

/// Start following a workspace's files, keeping the index current as they
/// change. Called when a folder opens.
#[tauri::command]
pub async fn index_watch(app: tauri::AppHandle, root: String) -> Result<(), String> {
    let root = ensure_allowed(&app, &root).await?.to_string_lossy().into_owned();
    blocking(move || crate::index::watch(&root)).await
}

#[tauri::command]
pub fn index_unwatch(root: String) {
    crate::index::unwatch(&root);
}

#[tauri::command]
pub async fn index_search(
    app: tauri::AppHandle,
    root: String,
    query: String,
    top_k: Option<usize>,
) -> Result<Vec<crate::index::SearchHit>, String> {
    policy::require(Access::Read)?;
    let root = ensure_allowed(&app, &root).await?.to_string_lossy().into_owned();
    blocking(move || crate::index::search(&root, &query, top_k.unwrap_or(8))).await
}

#[tauri::command]
pub async fn git_exec(
    app: tauri::AppHandle,
    cwd: String,
    args: Vec<String>,
) -> Result<tools::BashResult, String> {
    policy::require(Access::Execute)?;
    // `git` takes arbitrary subcommands, including ones that write outside the
    // repository (`git config --global`, `git push`), so it goes through the
    // same gate and the same record as a shell command.
    let logged = format!("git {}", args.join(" "));
    let cwd = match ensure_allowed(&app, &cwd).await {
        Ok(dir) => dir.to_string_lossy().into_owned(),
        Err(refusal) => {
            audit::record("git", &cwd, &logged, &refusal);
            return Err(refusal);
        }
    };
    let in_dir = cwd.clone();
    let outcome = git_exec_inner(cwd, args).await;
    audit::record(
        "git",
        &in_dir,
        &logged,
        &match &outcome {
            Ok(r) => format!("exit {}", r.code),
            Err(e) => format!("failed: {e}"),
        },
    );
    outcome
}

async fn git_exec_inner(cwd: String, args: Vec<String>) -> Result<tools::BashResult, String> {
    blocking(move || tools::git_exec(&cwd, args)).await
}

/// Apply a patch to the index or the working tree, for hunk-level staging.
///
/// A write to the repository, so it goes through the same gate and record as
/// any other git command. `args` are the `apply` flags the frontend chooses
/// (`--cached`, `-R`); the patch itself is data and never a path.
#[tauri::command]
pub async fn git_apply(
    app: tauri::AppHandle,
    cwd: String,
    args: Vec<String>,
    patch: String,
) -> Result<tools::BashResult, String> {
    policy::require(Access::Execute)?;
    let logged = format!("git apply {}", args.join(" "));
    let cwd = match ensure_allowed(&app, &cwd).await {
        Ok(dir) => dir.to_string_lossy().into_owned(),
        Err(refusal) => {
            audit::record("git", &cwd, &logged, &refusal);
            return Err(refusal);
        }
    };
    let in_dir = cwd.clone();
    let outcome = blocking(move || tools::git_apply(&cwd, args, &patch)).await;
    audit::record(
        "git",
        &in_dir,
        &logged,
        &match &outcome {
            Ok(r) => format!("exit {}", r.code),
            Err(e) => format!("failed: {e}"),
        },
    );
    outcome
}

// ---- Embedded terminal (PTY) ----------------------------------------------

#[tauri::command]
pub async fn pty_spawn(
    app: tauri::AppHandle,
    id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_data: Channel<String>,
) -> Result<(), String> {
    // A terminal runs the user's shell — execution — in a directory that must be
    // inside the project the same way a bash tool call is. The webview is the
    // untrusted side, so this cannot be left ungated.
    policy::require(Access::Execute)?;
    let requested = cwd.unwrap_or_else(|| ".".into());
    let dir = match ensure_allowed(&app, &requested).await {
        Ok(d) => d,
        Err(refusal) => {
            audit::record("pty", &requested, "<shell>", &refusal);
            return Err(refusal);
        }
    };
    let dir = dir.to_string_lossy().into_owned();
    audit::record("pty", &dir, "<shell>", "spawn");
    crate::pty::spawn(id, Some(dir), cols, rows, on_data)
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
pub fn lsp_which(bin: String) -> Option<String> {
    crate::lsp::which(&bin)
}

#[tauri::command]
pub async fn lsp_spawn(
    app: tauri::AppHandle,
    id: String,
    cmd: String,
    args: Vec<String>,
    cwd: Option<String>,
    on_msg: Channel<String>,
) -> Result<(), String> {
    // A language server is a spawned process that runs build scripts and
    // proc-macros (rust-analyzer does both) — execution — so it is gated and
    // contained to the project like any other command.
    policy::require(Access::Execute)?;
    let requested = cwd.unwrap_or_else(|| ".".into());
    let dir = match ensure_allowed(&app, &requested).await {
        Ok(d) => d,
        Err(refusal) => {
            audit::record("lsp", &requested, &cmd, &refusal);
            return Err(refusal);
        }
    };
    let dir = dir.to_string_lossy().into_owned();
    audit::record("lsp", &dir, &format!("{cmd} {}", args.join(" ")), "spawn");
    crate::lsp::spawn(id, cmd, args, Some(dir), on_msg)
}

#[tauri::command]
pub fn lsp_send(id: String, message: String) -> Result<(), String> {
    crate::lsp::send(&id, &message)
}

#[tauri::command]
pub fn lsp_kill(id: String) -> Result<(), String> {
    crate::lsp::kill(&id)
}

// ---- Debug adapters (DAP) --------------------------------------------------
//
// The Debug Adapter Protocol uses the identical Content-Length framing as LSP,
// so the transport is the same one — spawn a process, frame JSON both ways over
// stdio. What differs is the protocol spoken on top, which lives in the
// frontend. Reusing the transport rather than copying it means one place gets
// the process reaping and pipe-drain behaviour right.

#[tauri::command]
pub async fn dap_spawn(
    app: tauri::AppHandle,
    id: String,
    cmd: String,
    args: Vec<String>,
    cwd: Option<String>,
    on_msg: Channel<String>,
) -> Result<(), String> {
    // A debug adapter launches the user's own program, so it is execution and
    // gated as such — and contained to the project, so the working directory is
    // authorized like any command, not merely recorded.
    policy::require(Access::Execute)?;
    let requested = cwd.unwrap_or_else(|| ".".into());
    let dir = match ensure_allowed(&app, &requested).await {
        Ok(d) => d,
        Err(refusal) => {
            audit::record("dap", &requested, &cmd, &refusal);
            return Err(refusal);
        }
    };
    let dir = dir.to_string_lossy().into_owned();
    audit::record("dap", &dir, &format!("{cmd} {}", args.join(" ")), "spawn");
    crate::lsp::spawn(id, cmd, args, Some(dir), on_msg)
}

#[tauri::command]
pub fn dap_send(id: String, message: String) -> Result<(), String> {
    crate::lsp::send(&id, &message)
}

#[tauri::command]
pub fn dap_kill(id: String) -> Result<(), String> {
    crate::lsp::kill(&id)
}

#[tauri::command]
pub async fn chat_stream(
    connection: Connection,
    params: ChatParams,
    request_id: String,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    let key = resolve_key(&connection).await?;
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

// ---- Attachment bytes -------------------------------------------------------
//
// What the user handed the model used to live only in memory: reopen the app
// and the conversation still said "look at this image" with nothing attached.
//
// The bytes go to a file under the app's own data directory and the metadata
// goes in the message row, rather than base64 in the column. A message row is
// read on every launch and on every render of the transcript; making each one
// carry a few megabytes of image would be paid for continuously, to no purpose,
// since the picture is wanted only when it is actually on screen.
//
// The frontend never names a path here — it names an id. There is no path for a
// compromised page to point somewhere else.

fn attachment_dir() -> Result<std::path::PathBuf, String> {
    let dir = crate::db::app_dir()?.join("attachments");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn attachment_file(id: &str) -> Result<std::path::PathBuf, String> {
    // An id from the frontend must not be able to escape the folder — the
    // whole point of taking an id instead of a path.
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("invalid attachment id".into());
    }
    Ok(attachment_dir()?.join(id))
}

/// Keep an attachment's bytes so the conversation still has them tomorrow.
#[tauri::command]
pub async fn attachment_write(id: String, data: String) -> Result<(), String> {
    blocking(move || {
        let path = attachment_file(&id)?;
        let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data)
            .map_err(|e| format!("attachment {id}: {e}"))?;
        std::fs::write(path, bytes).map_err(|e| e.to_string())
    })
    .await
}

/// Read one back. Returns None when it is gone rather than failing: an
/// attachment the user deleted from disk should leave the message readable.
#[tauri::command]
pub async fn attachment_read(id: String) -> Result<Option<String>, String> {
    blocking(move || {
        let path = attachment_file(&id)?;
        match std::fs::read(path) {
            Ok(bytes) => Ok(Some(base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                bytes,
            ))),
            Err(_) => Ok(None),
        }
    })
    .await
}

// ============================================================================
// MEDIA GENERATION (image + video)
//
// Three provider shapes, all verified live against real keys:
//   - openai_images : POST {base}/images/generations -> data[].b64_json|url
//                     (TokenRouter, OpenAI Images)
//   - chat_image    : POST {base}/chat/completions with modalities
//                     -> choices[0].message.images[].image_url.url (OpenRouter),
//                     falling back to a data:/http URL inside message.content
//   - video_poll    : POST {base}/video/generations -> { task_id }, then
//                     GET {base}/video/generations/{id} -> data.result_url
//                     (TokenRouter async video; one normalized url field for
//                     every upstream provider — MiniMax/Kling/Dreamina)
// Keys resolve from the connection's Keychain entry, HTTP goes through the
// backend so the webview CSP never blocks a provider call.
// ============================================================================

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenAsset {
    pub url: Option<String>,
    pub b64: Option<String>,
    pub mime: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenImageResult {
    pub assets: Vec<GenAsset>,
}

/// Pull a `data:`/`http` image URL out of a chat reply's text content, for
/// proxies that inline the image as markdown (`![](data:image/png;base64,…)`).
fn image_url_from_text(content: &str) -> Option<String> {
    if let Some(i) = content.find("data:image/") {
        let tail = &content[i..];
        let end = tail
            .find(|c: char| c == ')' || c == ']' || c == '"' || c == '\'' || c.is_whitespace())
            .unwrap_or(tail.len());
        return Some(tail[..end].to_string());
    }
    for word in content.split_whitespace() {
        let clean = word.trim_matches(|c| matches!(c, '(' | ')' | '[' | ']' | '<' | '>' | '!' | '"' | '\''));
        if clean.starts_with("http") {
            return Some(clean.to_string());
        }
    }
    None
}

#[tauri::command]
pub async fn gen_image(
    connection: Connection,
    api: String,
    model: String,
    prompt: String,
    params: Option<serde_json::Value>,
    // Reference images as `data:` URIs, for edit / image-to-image / character
    // reference. Sent as chat image parts for chat_image; passed through as an
    // `image` field for openai_images (edit-capable models use it).
    images: Option<Vec<String>>,
) -> Result<GenImageResult, String> {
    let key = resolve_key(&connection).await?;
    let refs: Vec<String> = images.unwrap_or_default();

    if api == "chat_image" {
        let url = connection.endpoint("chat/completions");
        // With references, the message content becomes an array of parts (text +
        // one image_url per reference); without, a plain string.
        let content = if refs.is_empty() {
            serde_json::json!(prompt)
        } else {
            let mut parts = vec![serde_json::json!({ "type": "text", "text": prompt })];
            for u in &refs {
                parts.push(serde_json::json!({
                    "type": "image_url",
                    "image_url": { "url": u },
                }));
            }
            serde_json::Value::Array(parts)
        };
        let body = serde_json::json!({
            "model": model,
            "modalities": ["image", "text"],
            "messages": [{ "role": "user", "content": content }],
        });
        let resp = GEN_HTTP
            .post(&url)
            .bearer_auth(&key)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("network error: {e}"))?;
        if !resp.status().is_success() {
            let code = resp.status();
            return Err(format!("{code}: {}", resp.text().await.unwrap_or_default()));
        }
        let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let msg = v
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|a| a.first())
            .and_then(|f| f.get("message"))
            .ok_or_else(|| "provider returned no message".to_string())?;

        let mut assets = Vec::new();
        if let Some(imgs) = msg.get("images").and_then(|i| i.as_array()) {
            for img in imgs {
                let u = img
                    .get("image_url")
                    .and_then(|x| x.get("url"))
                    .and_then(|x| x.as_str())
                    .or_else(|| img.get("url").and_then(|x| x.as_str()));
                if let Some(u) = u {
                    assets.push(GenAsset { url: Some(u.to_string()), b64: None, mime: None });
                }
            }
        }
        if assets.is_empty() {
            if let Some(content) = msg.get("content").and_then(|c| c.as_str()) {
                if let Some(u) = image_url_from_text(content) {
                    assets.push(GenAsset { url: Some(u), b64: None, mime: None });
                }
            }
        }
        if assets.is_empty() {
            return Err("provider returned no image (model may not support image output)".into());
        }
        return Ok(GenImageResult { assets });
    }

    // openai_images
    let url = connection.endpoint("images/generations");
    let mut body = serde_json::json!({ "model": model, "prompt": prompt });
    if let Some(serde_json::Value::Object(map)) = params {
        for (k, val) in map {
            body[k] = val;
        }
    }
    // Best-effort reference passthrough for edit-capable models. Only set when
    // references exist, so plain text-to-image requests are unchanged.
    if !refs.is_empty() {
        body["image"] = serde_json::json!(refs);
    }
    let resp = GEN_HTTP
        .post(&url)
        .bearer_auth(&key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;
    if !resp.status().is_success() {
        let code = resp.status();
        return Err(format!("{code}: {}", resp.text().await.unwrap_or_default()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let arr = v
        .get("data")
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default();
    let assets: Vec<GenAsset> = arr
        .iter()
        .filter_map(|item| {
            let url = item.get("url").and_then(|x| x.as_str()).map(String::from);
            let b64 = item
                .get("b64_json")
                .or_else(|| item.get("b64"))
                .and_then(|x| x.as_str())
                .map(String::from);
            let mime = item
                .get("mime_type")
                .or_else(|| item.get("content_type"))
                .and_then(|x| x.as_str())
                .map(String::from);
            if url.is_none() && b64.is_none() {
                return None;
            }
            Some(GenAsset { url, b64, mime })
        })
        .collect();
    if assets.is_empty() {
        return Err("provider returned no image".into());
    }
    Ok(GenImageResult { assets })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenVideoSubmit {
    pub task_id: String,
}

#[tauri::command]
pub async fn gen_video_submit(
    connection: Connection,
    model: String,
    prompt: String,
    params: Option<serde_json::Value>,
) -> Result<GenVideoSubmit, String> {
    let key = resolve_key(&connection).await?;
    let url = connection.endpoint("video/generations");
    let mut body = serde_json::json!({ "model": model, "prompt": prompt });
    if let Some(serde_json::Value::Object(map)) = params {
        for (k, val) in map {
            body[k] = val;
        }
    }
    let resp = GEN_HTTP
        .post(&url)
        .bearer_auth(&key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    // The provider reports quota / validation failures in the body with HTTP 200.
    if let Some(task) = v
        .get("task_id")
        .or_else(|| v.get("id"))
        .and_then(|x| x.as_str())
    {
        return Ok(GenVideoSubmit { task_id: task.to_string() });
    }
    let msg = v
        .get("message")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .or_else(|| v.get("code").and_then(|x| x.as_str()))
        .unwrap_or("video submit failed");
    Err(msg.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenVideoStatus {
    pub status: String,
    pub progress: Option<String>,
    pub url: Option<String>,
    pub fail_reason: Option<String>,
}

#[tauri::command]
pub async fn gen_video_poll(
    connection: Connection,
    task_id: String,
) -> Result<GenVideoStatus, String> {
    let key = resolve_key(&connection).await?;
    let url = connection.endpoint(&format!("video/generations/{task_id}"));
    let resp = GEN_HTTP
        .get(&url)
        .bearer_auth(&key)
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let d = v.get("data").unwrap_or(&v);
    let status = d
        .get("status")
        .and_then(|x| x.as_str())
        .unwrap_or("UNKNOWN")
        .to_string();
    let progress = d
        .get("progress")
        .and_then(|x| x.as_str().map(String::from).or_else(|| x.as_i64().map(|n| n.to_string())));
    // TokenRouter normalizes the finished asset to `data.result_url`; keep a few
    // fallbacks for other proxy shapes.
    let url = d
        .get("result_url")
        .or_else(|| d.get("video_url"))
        .or_else(|| d.get("url"))
        .and_then(|x| x.as_str())
        .map(String::from);
    let fail_reason = d
        .get("fail_reason")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);
    Ok(GenVideoStatus { status, progress, url, fail_reason })
}
