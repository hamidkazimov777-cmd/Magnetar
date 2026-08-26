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
            if let Ok(dir) = app.path().app_data_dir() {
                if let Err(e) = db::init(&dir) {
                    eprintln!("db init failed: {e}");
                }
                // The secret store needs the same directory; without this it
                // has nowhere to write and every key lookup falls through.
                keychain::init(&dir);
            }
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
