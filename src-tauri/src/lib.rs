mod db;
mod indexer;
mod ipc;
mod parser;
mod storage;
mod vault;
mod watcher;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let db_path = app
                .path()
                .app_data_dir()
                .expect("app data dir available")
                .join("vault-index.db");
            let state = vault::VaultState::open(db_path)?;
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
            ipc::backlinks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
