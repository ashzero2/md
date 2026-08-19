mod db;
mod indexer;
mod ipc;
mod parser;
mod settings;
mod storage;
mod vault;
mod watcher;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
                .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("app data dir available");
            let state = vault::VaultState::open(app_data_dir)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::open_vault,
            ipc::list_files,
            ipc::list_tree,
            ipc::search,
            ipc::get_note,
            ipc::save_note,
            ipc::resolve_link,
            ipc::quick_switcher,
            ipc::create_note,
            ipc::tags_list,
            ipc::files_by_tag,
            ipc::list_titles,
            ipc::backlinks,
            ipc::broken_links,
            ipc::orphan_notes,
            ipc::related_notes,
            ipc::rebuild_index,
            ipc::get_settings,
            ipc::save_settings,
            ipc::rename_note,
            ipc::move_note,
            ipc::delete_note_file,
            ipc::reveal_note,
            ipc::write_text_file,
            ipc::open_html_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
