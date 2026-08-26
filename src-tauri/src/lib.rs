mod canon;
mod commands;
mod db;
mod index;
mod keychain;
mod lsp;
mod providers;
mod pty;
mod tools;
mod utf8;
mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
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
