mod audit;
mod canon;
mod commands;
mod db;
mod index;
mod keychain;
mod lsp;
mod paths;
mod policy;
mod providers;
mod pty;
mod tools;
mod utf8;
mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            use tauri::Manager;
            // Initialize the local canon DB in the app data dir.
            let mut dark = false;
            if let Ok(dir) = app.path().app_data_dir() {
                if let Err(e) = db::init(&dir) {
                    eprintln!("db init failed: {e}");
                }
                // The secret store needs the same directory; without this it
                // has nowhere to write and every key lookup falls through.
                keychain::init(&dir);
                audit::init(&dir);
                policy::init(&dir);
                // The theme the frontend last persisted (see persist_window_theme).
                dark = std::fs::read_to_string(dir.join("window-theme"))
                    .map(|s| s.trim() == "dark")
                    .unwrap_or(false);
            }

            // Create the main window here rather than in tauri.conf so its native
            // background is the saved theme colour from the very first frame.
            // wry only disables the WebView's default white background when a
            // background colour is set AT CREATION — setting it later (in setup,
            // after the config window already exists) still let one white frame
            // through, which was the launch flash. Colours match index.html and
            // the splash exactly (pure black / white).
            let color = if dark {
                tauri::window::Color(0, 0, 0, 255)
            } else {
                tauri::window::Color(255, 255, 255, 255)
            };
            // Set data-theme before ANY page script runs, so the very first HTML
            // paint is already the right colour — the white flash was the page
            // rendering light before the bundle/localStorage could correct it.
            // This runs at document-start and is authoritative; index.html's
            // inline script only fills in when the attribute is not already set.
            let theme = if dark { "dark" } else { "light" };
            let init = format!(
                "document.documentElement.setAttribute('data-theme','{theme}');\
                 document.documentElement.style.colorScheme='{theme}';"
            );
            let win = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                .title("Magnetar")
                .inner_size(1080.0, 760.0)
                .min_inner_size(720.0, 520.0)
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .background_color(color)
                .initialization_script(&init)
                // Start hidden so no half-painted white frame is ever shown; the
                // frontend calls `show` once the splash is drawn (command below).
                .visible(false)
                .build()?;

            // Safety net for the failure mode of Entry 12: if the frontend never
            // asks to show the window (release-build hiccup, JS crash), reveal it
            // anyway after a short delay so the app can never launch invisible.
            let handle = win.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(900));
                let _ = handle.show();
                let _ = handle.set_focus();
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::save_api_key,
            commands::delete_api_key,
            commands::has_api_key,
            commands::list_models,
            commands::complete,
            commands::generate,
            commands::generate_async,
            commands::generate_replicate,
            commands::chat_stream,
            commands::cancel_stream,
            commands::list_sessions,
            commands::load_messages,
            commands::save_session,
            commands::upsert_message,
            commands::delete_session,
            commands::delete_messages_from,
            commands::agent_step,
            commands::agent_step_stream,
            commands::tool_read_file,
            commands::tool_list_dir,
            commands::tool_grep,
            commands::tool_write_file,
            commands::tool_delete_file,
            commands::list_project_files,
            commands::tool_edit_file,
            commands::tool_run_bash,
            commands::tool_kill_bash,
            commands::set_workspace_root,
            commands::read_file_base64,
            commands::pick_attachments,
            commands::key_storage,
            commands::set_read_only,
            commands::read_only,
            commands::trust_workspace,
            commands::distrust_workspace,
            commands::workspace_trusted,
            commands::tool_attach_file,
            commands::extract_pdf_text,
            commands::editor_read_file,
            commands::index_build,
            commands::index_search,
            commands::git_exec,
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::lsp_which,
            commands::lsp_spawn,
            commands::lsp_send,
            commands::lsp_kill,
            commands::list_connections,
            commands::save_connection,
            commands::delete_connection,
            commands::list_projects,
            commands::save_project,
            commands::delete_project,
            commands::create_project_dir,
            commands::list_facts,
            commands::save_facts,
            commands::delete_fact,
            commands::list_decisions,
            commands::save_decision,
            commands::delete_decision,
            commands::list_divergences,
            commands::save_divergence,
            commands::list_proposals,
            commands::save_proposal,
            commands::persist_window_theme,
            commands::list_generations,
            commands::save_generation,
            commands::delete_generation,
            commands::clear_generations,
            commands::list_tasks,
            commands::save_task,
            commands::delete_task,
            commands::list_knowledge_nodes,
            commands::save_knowledge_node,
            commands::list_knowledge_edges,
            commands::save_knowledge_edge,
            commands::list_timeline_events,
            commands::save_timeline_event,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod config_tests {
    /// The webview is untrusted presentation code, and a content policy is the
    /// one control that limits what it may do with a compromised page: where
    /// script may come from, and where anything may be sent.
    ///
    /// `csp: null` shipped for a long time, which is no policy at all. These
    /// tests exist so it cannot come back quietly — a config edit that weakens
    /// the policy fails the build rather than passing review unnoticed.
    fn csp() -> serde_json::Map<String, serde_json::Value> {
        let raw = include_str!("../tauri.conf.json");
        let conf: serde_json::Value = serde_json::from_str(raw).expect("tauri.conf.json parses");
        conf["app"]["security"]["csp"]
            .as_object()
            .expect("a content security policy is configured")
            .clone()
    }

    fn directive(name: &str) -> String {
        csp()
            .get(name)
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| panic!("{name} is declared"))
            .to_string()
    }

    fn capabilities() -> Vec<String> {
        let raw = include_str!("../capabilities/default.json");
        let conf: serde_json::Value = serde_json::from_str(raw).expect("capabilities parse");
        conf["permissions"]
            .as_array()
            .expect("permissions is a list")
            .iter()
            .map(|v| v.as_str().unwrap_or_default().to_string())
            .collect()
    }

    #[test]
    fn the_webview_is_granted_no_filesystem_access_of_its_own() {
        // Every file the frontend touches goes through a Tauri command that
        // resolves the path and, outside the workspace, asks the user. Granting
        // the fs plugin as well would put a second policy beside that one,
        // answering the same question with different rules and no audit record.
        let perms = capabilities();
        assert!(
            !perms.iter().any(|p| p.starts_with("fs:")),
            "the fs plugin must stay ungranted: {perms:?}"
        );
        // Reading a folder or saving an export still needs the file dialogs.
        assert!(perms.iter().any(|p| p == "dialog:default"));
    }

    #[test]
    fn the_embedded_browser_windows_inherit_nothing() {
        // The subscription bridge opens provider sites in their own webview
        // windows. Capabilities in Tauri v2 are scoped by window label, so
        // listing only "main" is what keeps a remote page from reaching the
        // app's commands. A wildcard here, or a `remote` allowance, would hand
        // chat.example.com the same backend the agent uses.
        let raw = include_str!("../capabilities/default.json");
        let conf: serde_json::Value = serde_json::from_str(raw).expect("capabilities parse");

        let windows: Vec<&str> = conf["windows"]
            .as_array()
            .expect("windows is a list")
            .iter()
            .map(|v| v.as_str().unwrap_or_default())
            .collect();
        assert_eq!(windows, vec!["main"]);
        assert!(conf.get("remote").is_none(), "no remote origin may be granted IPC");
    }

    #[test]
    fn the_policy_denies_by_default() {
        assert_eq!(directive("default-src"), "'self'");
        assert_eq!(directive("object-src"), "'none'");
        assert_eq!(directive("base-uri"), "'self'");
        assert_eq!(directive("frame-ancestors"), "'none'");
        assert_eq!(directive("form-action"), "'none'");
    }

    #[test]
    fn no_script_may_be_injected_or_fetched_from_elsewhere() {
        let script = directive("script-src");
        assert_eq!(script, "'self'");
        // These three are what turn a prompt injection or a malicious tool
        // result into code execution inside the app.
        for banned in ["'unsafe-inline'", "'unsafe-eval'", "*"] {
            assert!(!script.contains(banned), "script-src must not allow {banned}");
        }
    }

    #[test]
    fn the_frontend_can_only_talk_to_its_own_backend() {
        // Every provider call goes through Rust, so the webview itself has no
        // reason to reach the network. If that ever changes, this test is the
        // place the change has to be argued for.
        let connect = directive("connect-src");
        assert!(connect.starts_with("'self'"));
        assert!(connect.contains("ipc:"), "Tauri IPC must stay reachable");
        assert!(!connect.contains("https:"), "the webview must not open its own connections");
        assert!(!connect.contains('*'));
    }

    #[test]
    fn remote_media_is_allowed_only_where_generated_assets_need_it() {
        // Generation providers hand back an https URL for the finished asset,
        // and Studio renders it directly. That is the whole reason `https:`
        // appears here; it must not spread to anything executable. Step 13
        // saves assets to disk, and this can be tightened once it does.
        assert!(directive("img-src").contains("https:"));
        assert!(directive("media-src").contains("https:"));
        assert!(!directive("script-src").contains("https:"));
        assert!(!directive("style-src").contains("https:"));
    }
}
