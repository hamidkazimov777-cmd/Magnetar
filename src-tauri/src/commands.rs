//! Tauri command surface — the bridge the React frontend calls via `invoke`.

use crate::canon::{self, MessageRow, SessionMeta};
use crate::workspace::{
    self, ConnectionRow, Decision, Divergence, Generation, KnowledgeEdge, KnowledgeNode,
    MemoryFact, Project, Proposal, Task,
    TimelineEvent,
};
use crate::keychain;
use crate::providers::{
    build_provider, AgentStep, ChatParams, Connection, ModelInfo, StreamEvent, ToolDef,
};
use crate::audit;
use crate::paths::{self, Decision as PathDecision};
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

/// One shared HTTP client for generation requests. Building a `reqwest::Client`
/// per call meant a fresh connection pool and TLS setup every time — which adds
/// up when several generations run alongside the agent and chat. Cloning shares
/// the same pool (the client is Arc-backed internally).
static GEN_HTTP: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .pool_idle_timeout(std::time::Duration::from_secs(90))
        .tcp_keepalive(std::time::Duration::from_secs(60))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});

/// Bounds how many heavy generation jobs run at once, so a burst can't starve
/// the agent or the UI — the "isolate concurrent generation workers" gap. The
/// cap is generous (6): a real user rarely fires that many together, so normal
/// use is never serialized; it only tames pathological load. A permit is held
/// for the whole job (including the minutes a video spends polling).
static GEN_SEM: Lazy<tokio::sync::Semaphore> = Lazy::new(|| tokio::sync::Semaphore::new(6));

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
pub fn list_generations() -> Result<Vec<Generation>, String> {
    workspace::list_generations()
}

#[tauri::command]
pub fn save_generation(generation: Generation) -> Result<(), String> {
    workspace::save_generation(generation)
}

#[tauri::command]
pub fn delete_generation(id: String) -> Result<(), String> {
    workspace::delete_generation(&id)
}

#[tauri::command]
pub fn clear_generations() -> Result<(), String> {
    workspace::clear_generations()
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

/// One universal generative call: POST `{base}/{endpoint}` with
/// `{model, prompt, ...params}` and collect the returned assets. Nothing here is
/// image-specific — `image` is just a provider whose endpoint happens to be
/// `images/generations`; a video or audio provider is a different catalog entry
/// with a different endpoint and the same request/result shapes.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationResult {
    pub kind: String,
    pub assets: Vec<GenerationAsset>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationAsset {
    pub url: Option<String>,
    pub b64: Option<String>,
    pub mime_type: Option<String>,
}

#[tauri::command]
pub async fn generate(
    connection: Connection,
    kind: String,
    model: String,
    prompt: String,
    endpoint: String,
    params: Option<serde_json::Value>,
    // Provider-shape knobs (default = OpenAI-compatible):
    //   auth_scheme:   "key" sends `Authorization: Key <k>` (fal.ai); else Bearer.
    //   result_path:   where the assets array lives in the response (default "data";
    //                  fal.ai uses "images").
    //   model_in_body: false omits "model" from the body — for providers that put
    //                  the model in the URL path (fal.ai).
    auth_scheme: Option<String>,
    result_path: Option<String>,
    model_in_body: Option<bool>,
) -> Result<GenerationResult, String> {
    let _permit = GEN_SEM.acquire().await.map_err(|e| e.to_string())?;
    let key = resolve_key(&connection).await?;
    let url = connection.endpoint(&endpoint);

    let mut body = serde_json::json!({ "prompt": prompt });
    if model_in_body != Some(false) {
        body["model"] = serde_json::json!(model);
    }
    if let Some(serde_json::Value::Object(map)) = params {
        for (k, v) in map {
            body[k] = v;
        }
    }

    let req = GEN_HTTP.post(&url).json(&body);
    let req = if auth_scheme.as_deref() == Some("key") {
        req.header("Authorization", format!("Key {key}"))
    } else {
        req.bearer_auth(&key)
    };
    let resp = req
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;

    if !resp.status().is_success() {
        let code = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("{code}: {text}"));
    }

    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let arr = v
        .get(result_path.as_deref().unwrap_or("data"))
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default();

    let assets: Vec<GenerationAsset> = arr
        .iter()
        .filter_map(|item| {
            let url = item.get("url").and_then(|x| x.as_str()).map(String::from);
            let b64 = item
                .get("b64_json")
                .and_then(|x| x.as_str())
                .map(String::from);
            let mime_type = item
                .get("mime_type")
                .and_then(|x| x.as_str())
                .map(String::from);
            if url.is_none() && b64.is_none() {
                return None;
            }
            Some(GenerationAsset { url, b64, mime_type })
        })
        .collect();

    if assets.is_empty() {
        return Err("provider returned no assets".to_string());
    }
    Ok(GenerationResult { kind, assets })
}

/// Pull produced assets out of a response JSON. Handles the shapes providers
/// actually return: an array at `result_path` (images/data), or a single media
/// object with a `url` (fal.ai video/audio return `{ "video": { "url": … } }`).
fn extract_assets(v: &serde_json::Value, result_path: &str) -> Vec<GenerationAsset> {
    let asset_from = |item: &serde_json::Value| -> Option<GenerationAsset> {
        let url = item.get("url").and_then(|x| x.as_str()).map(String::from);
        let b64 = item
            .get("b64_json")
            .and_then(|x| x.as_str())
            .map(String::from);
        let mime_type = item
            .get("content_type")
            .or_else(|| item.get("mime_type"))
            .and_then(|x| x.as_str())
            .map(String::from);
        if url.is_none() && b64.is_none() {
            return None;
        }
        Some(GenerationAsset { url, b64, mime_type })
    };

    // Try, in order: the named path (array or single object), then the common
    // fallbacks.
    for key in [result_path, "images", "data", "video", "audio", "image"] {
        if let Some(node) = v.get(key) {
            if let Some(arr) = node.as_array() {
                let out: Vec<_> = arr.iter().filter_map(asset_from).collect();
                if !out.is_empty() {
                    return out;
                }
            } else if let Some(a) = asset_from(node) {
                return vec![a];
            }
        }
    }
    Vec::new()
}

/// Long-running generation (video / audio) via fal.ai's queue: submit the job,
/// poll its status until it completes, then fetch the result. Blocking on the
/// Rust async side, so the UI thread is never held.
#[tauri::command]
pub async fn generate_async(
    connection: Connection,
    kind: String,
    model: String,
    prompt: String,
    params: Option<serde_json::Value>,
    result_path: Option<String>,
) -> Result<GenerationResult, String> {
    let _permit = GEN_SEM.acquire().await.map_err(|e| e.to_string())?;
    let key = resolve_key(&connection).await?;
    let auth = format!("Key {key}");
    // fal.ai's synchronous host is fal.run; its queue is queue.fal.run.
    let base = connection.base_url.replace("fal.run", "queue.fal.run");
    let submit_url = format!("{}/{}", base.trim_end_matches('/'), model);

    let mut body = serde_json::json!({ "prompt": prompt });
    if let Some(serde_json::Value::Object(map)) = params {
        for (k, v) in map {
            body[k] = v;
        }
    }

    let client = GEN_HTTP.clone();
    let sub: serde_json::Value = client
        .post(&submit_url)
        .header("Authorization", &auth)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let status_url = sub
        .get("status_url")
        .and_then(|x| x.as_str())
        .ok_or("no status_url in submit response")?
        .to_string();
    let response_url = sub
        .get("response_url")
        .and_then(|x| x.as_str())
        .ok_or("no response_url in submit response")?
        .to_string();

    // Poll up to ~5 minutes; video can genuinely take that long.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        if std::time::Instant::now() > deadline {
            return Err("generation timed out".to_string());
        }
        let st: serde_json::Value = client
            .get(&status_url)
            .header("Authorization", &auth)
            .send()
            .await
            .map_err(|e| format!("network error: {e}"))?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        match st.get("status").and_then(|x| x.as_str()) {
            Some("COMPLETED") => break,
            Some("IN_QUEUE") | Some("IN_PROGRESS") | None => continue,
            Some(other) => return Err(format!("generation {other}")),
        }
    }

    let result: serde_json::Value = client
        .get(&response_url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let assets = extract_assets(&result, result_path.as_deref().unwrap_or("video"));
    if assets.is_empty() {
        return Err("provider returned no assets".to_string());
    }
    Ok(GenerationResult { kind, assets })
}

/// Replicate's `output` is a plain URL string, an array of URL strings, or the
/// occasional `{url}` object — never fal's `{images:[…]}` shape. Pull the URLs.
fn replicate_assets(out: Option<&serde_json::Value>) -> Vec<GenerationAsset> {
    let mut assets = Vec::new();
    let push = |s: &str, v: &mut Vec<GenerationAsset>| {
        if s.starts_with("http") || s.starts_with("data:") {
            v.push(GenerationAsset { url: Some(s.to_string()), b64: None, mime_type: None });
        }
    };
    match out {
        Some(serde_json::Value::String(s)) => push(s, &mut assets),
        Some(serde_json::Value::Array(arr)) => {
            for item in arr {
                if let Some(s) = item.as_str() {
                    push(s, &mut assets);
                } else if let Some(u) = item.get("url").and_then(|x| x.as_str()) {
                    push(u, &mut assets);
                }
            }
        }
        Some(obj) if obj.is_object() => {
            if let Some(u) = obj.get("url").and_then(|x| x.as_str()) {
                push(u, &mut assets);
            }
        }
        _ => {}
    }
    assets
}

/// Generation via Replicate. Creates a prediction against a model by name
/// (`owner/name`, no version hash needed for official models), asks the API to
/// block until done (`Prefer: wait`), and polls the prediction if it is still
/// running. Auth is `Token <key>`; output URLs are pulled by `replicate_assets`.
#[tauri::command]
pub async fn generate_replicate(
    connection: Connection,
    kind: String,
    model: String,
    prompt: String,
    params: Option<serde_json::Value>,
) -> Result<GenerationResult, String> {
    let _permit = GEN_SEM.acquire().await.map_err(|e| e.to_string())?;
    let key = resolve_key(&connection).await?;
    let auth = format!("Token {key}");
    let base = connection.base_url.trim_end_matches('/');
    let create_url = format!("{base}/models/{model}/predictions");

    let mut input = serde_json::json!({ "prompt": prompt });
    if let Some(serde_json::Value::Object(map)) = params {
        for (k, v) in map {
            input[k] = v;
        }
    }
    let body = serde_json::json!({ "input": input });

    let client = GEN_HTTP.clone();
    let mut pred: serde_json::Value = client
        .post(&create_url)
        .header("Authorization", &auth)
        .header("Prefer", "wait")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let get_url = pred
        .get("urls")
        .and_then(|u| u.get("get"))
        .and_then(|x| x.as_str())
        .map(String::from);

    // `Prefer: wait` usually returns a terminal prediction already; poll only if
    // it is still running (slow video/audio models).
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);
    loop {
        match pred.get("status").and_then(|x| x.as_str()) {
            Some("succeeded") => break,
            Some("failed") | Some("canceled") => {
                let err = pred
                    .get("error")
                    .and_then(|x| x.as_str())
                    .unwrap_or("generation failed");
                return Err(err.to_string());
            }
            _ => {}
        }
        if std::time::Instant::now() > deadline {
            return Err("generation timed out".to_string());
        }
        let url = get_url.clone().ok_or("no poll url in prediction")?;
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        pred = client
            .get(&url)
            .header("Authorization", &auth)
            .send()
            .await
            .map_err(|e| format!("network error: {e}"))?
            .json()
            .await
            .map_err(|e| e.to_string())?;
    }

    let assets = replicate_assets(pred.get("output"));
    if assets.is_empty() {
        return Err("provider returned no assets".to_string());
    }
    Ok(GenerationResult { kind, assets })
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


// ---- Path authorization ----------------------------------------------------

/// Tell the backend which folder is open. Containment is decided here rather
/// than in the store: the webview is the side that gets compromised, and a
/// boundary it can move is not a boundary.
#[tauri::command]
pub fn set_workspace_root(root: Option<String>) {
    paths::set_workspace_root(root);
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
    let path = ensure_allowed(&app, &path).await?;
    blocking(move || tools::read_file(&path.to_string_lossy(), offset, limit)).await
}

#[tauri::command]
pub async fn tool_list_dir(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<tools::DirEntry>, String> {
    let path = ensure_allowed(&app, &path).await?;
    blocking(move || tools::list_dir(&path.to_string_lossy())).await
}

#[tauri::command]
pub async fn tool_grep(
    app: tauri::AppHandle,
    pattern: String,
    path: Option<String>,
) -> Result<Vec<tools::GrepHit>, String> {
    // "." used to mean the process working directory, which is wherever the
    // app happened to be launched from — not the project. Resolving it against
    // the workspace root is both the containment fix and the correct default.
    let root = ensure_allowed(&app, path.as_deref().unwrap_or(".")).await?;
    blocking(move || tools::grep(&pattern, &root.to_string_lossy())).await
}

#[tauri::command]
pub async fn tool_write_file(
    app: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<usize, String> {
    let path = ensure_allowed(&app, &path).await?;
    blocking(move || tools::write_file(&path.to_string_lossy(), &content)).await
}

#[tauri::command]
pub async fn list_project_files(root: String) -> Result<Vec<String>, String> {
    blocking(move || crate::index::list_files(&root)).await
}

#[tauri::command]
pub async fn tool_delete_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
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

#[tauri::command]
pub async fn tool_attach_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
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
    let path = ensure_allowed(&app, &path).await?;
    blocking(move || {
        pdf_extract::extract_text(&path).map_err(|e| format!("Failed to extract PDF: {}", e))
    })
    .await
}

/// Full file read for the code editor (no size cap).
#[tauri::command]
pub async fn editor_read_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let path = ensure_allowed(&app, &path).await?;
    blocking(move || tools::read_text(&path.to_string_lossy())).await
}

// ---- Codebase index (BM25 retrieval) --------------------------------------

#[tauri::command]
pub async fn index_build(root: String) -> Result<crate::index::IndexStats, String> {
    blocking(move || crate::index::build(&root)).await
}

#[tauri::command]
pub async fn index_search(
    root: String,
    query: String,
    top_k: Option<usize>,
) -> Result<Vec<crate::index::SearchHit>, String> {
    blocking(move || crate::index::search(&root, &query, top_k.unwrap_or(8))).await
}

#[tauri::command]
pub async fn git_exec(
    app: tauri::AppHandle,
    cwd: String,
    args: Vec<String>,
) -> Result<tools::BashResult, String> {
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
pub fn lsp_which(bin: String) -> Option<String> {
    crate::lsp::which(&bin)
}

#[tauri::command]
pub fn lsp_spawn(
    id: String,
    cmd: String,
    args: Vec<String>,
    cwd: Option<String>,
    on_msg: Channel<String>,
) -> Result<(), String> {
    crate::lsp::spawn(id, cmd, args, cwd, on_msg)
}

#[tauri::command]
pub fn lsp_send(id: String, message: String) -> Result<(), String> {
    crate::lsp::send(&id, &message)
}

#[tauri::command]
pub fn lsp_kill(id: String) -> Result<(), String> {
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
