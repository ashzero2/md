//! App-wide state: the open vault root, the SQLite index connection, and the
//! active file watcher. The DB lives in app-data (never inside the vault) and
//! the watcher is trigger-only (ADR D2 + D5).

use crate::{db, indexer, settings, watcher::WatcherGuard};
use rusqlite::Connection;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

pub struct VaultState {
    pub root: Mutex<Option<PathBuf>>,
    pub conn: Mutex<Connection>,
    pub db_path: PathBuf,
    pub settings_path: PathBuf,
    pub watcher: Mutex<Option<WatcherGuard>>,
}

impl VaultState {
    pub fn open(app_data_dir: PathBuf) -> Result<Self, String> {
        let db_path = app_data_dir.join("vault-index.db");
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        db::init_schema(&conn).map_err(|e| e.to_string())?;
        Ok(VaultState {
            root: Mutex::new(None),
            conn: Mutex::new(conn),
            db_path,
            settings_path: settings::settings_path(&app_data_dir),
            watcher: Mutex::new(None),
        })
    }

    /// Replace any active watcher with one over the current vault root.
    /// Each debounced batch is reconciled against the index on a fresh
    /// connection (the state connection is owned by the UI thread), then a
    /// `vault-changed` event is emitted with the changed paths.
    pub fn start_watcher(&self, app: AppHandle) -> Result<(), String> {
        if let Some(w) = self.watcher.lock().unwrap().take() {
            drop(w); // stop the old watcher (vault switch)
        }
        let root = self
            .root
            .lock()
            .unwrap()
            .clone()
            .ok_or("no vault open")?;
        let db_path = self.db_path.clone();
        let on_root = root.clone();

        let on_batch = move |paths: Vec<String>| {
            let Ok(conn) = Connection::open(&db_path) else {
                return;
            };
            let _ = db::init_schema(&conn);

            // If any batched path is a directory, new `.md` files inside it
            // may not have produced their own events — diff the full scan.
            let has_dir = paths.iter().any(|p| {
                std::fs::metadata(on_root.join(p))
                    .map(|m| m.is_dir())
                    .unwrap_or(false)
            });
            let mut reconcile_paths = paths.clone();
            if has_dir {
                let disk: HashSet<String> =
                    indexer::scan_markdown_files(&on_root).into_iter().collect();
                let indexed: HashSet<String> = db::list_indexed_paths(&conn)
                    .unwrap_or_default()
                    .into_iter()
                    .collect();
                for p in disk.difference(&indexed) {
                    if !reconcile_paths.contains(p) {
                        reconcile_paths.push(p.clone());
                    }
                }
            }

            // Paths that no longer exist and were never indexed are no-ops
            // inside reconcile; deletions with index rows get cleaned up.
            let _ = indexer::reconcile_index(&conn, &on_root, &reconcile_paths, None);
            let _ = app.emit(
                "vault-changed",
                serde_json::json!({ "paths": reconcile_paths }),
            );
        };

        let watch_root = root.clone();
        let guard = crate::watcher::watch(&watch_root, 300, on_batch)?;
        *self.watcher.lock().unwrap() = Some(guard);
        Ok(())
    }
}