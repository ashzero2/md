//! Tauri IPC commands — thin wrappers over db/indexer logic.

use crate::db::{self, NoteMeta, SearchResult};
use crate::indexer;
use crate::vault::VaultState;
use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Serialize)]
pub struct VaultInfo {
    pub root: String,
    pub files: usize,
}

#[derive(Debug, Serialize)]
pub struct NoteContent {
    pub path: String,
    pub title: String,
    pub content: String,
}

fn with_conn<T>(state: &State<'_, VaultState>, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let conn = state.conn.lock().map_err(|_| "index lock poisoned".to_string())?;
    f(&conn)
}

/// Open a vault folder: full (non-incremental) rebuild of the index in a
/// blocking task, with progress events. Future opens will reconcile instead
/// (Phase 2), but a full rebuild is always a correct baseline.
#[tauri::command]
pub async fn open_vault(
    state: State<'_, VaultState>,
    app: AppHandle,
    path: String,
) -> Result<VaultInfo, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("'{path}' is not a folder"));
    }
    let db_path = state.db_path.clone();
    let task_app = app.clone();
    let root_for_task = root.clone();

    let indexed = tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        crate::db::init_schema(&conn).map_err(|e| e.to_string())?;
        let progress = |done: usize, total: usize| {
            let _ = task_app.emit(
                "index-progress",
                serde_json::json!({ "done": done, "total": total }),
            );
        };
        indexer::rebuild_index(&conn, &root_for_task, Some(&progress)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    *state.root.lock().unwrap() = Some(root.clone());
    let _ = app.emit("index-ready", serde_json::json!({ "files": indexed }));
    let _ = state.start_watcher(app.clone());
    Ok(VaultInfo {
        root: path,
        files: indexed,
    })
}

/// All indexed notes (flat list for status/counts).
#[tauri::command]
pub fn list_files(state: State<'_, VaultState>) -> Result<Vec<NoteMeta>, String> {
    with_conn(&state, |conn| db::list_notes(conn).map_err(|e| e.to_string()))
}

/// Directory tree over indexed files, for the sidebar navigator.
#[tauri::command]
pub fn list_tree(state: State<'_, VaultState>) -> Result<Vec<indexer::FileNode>, String> {
    with_conn(&state, |conn| {
        let paths = db::list_indexed_paths(conn).map_err(|e| e.to_string())?;
        Ok(indexer::build_tree(&paths))
    })
}

/// Full-text search over the FTS5 index.
#[tauri::command]
pub fn search(state: State<'_, VaultState>, q: String) -> Result<Vec<SearchResult>, String> {
    with_conn(&state, |conn| db::search_notes(conn, &q, 50).map_err(|e| e.to_string()))
}

/// Read a note's content from disk (source of truth).
#[tauri::command]
pub fn get_note(state: State<'_, VaultState>, path: String) -> Result<NoteContent, String> {
    let root = state
        .root
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?
        .clone()
        .ok_or("no vault open")?;
    let full = root.join(&path);
    let content = std::fs::read_to_string(&full).map_err(|e| e.to_string())?;
    let title = title_from_db(&state, &path);
    Ok(NoteContent {
        path,
        title,
        content,
    })
}

fn title_from_db(state: &State<'_, VaultState>, path: &str) -> String {
    with_conn(state, |conn| {
        conn.query_row(
            "SELECT title FROM files WHERE path = ?1",
            rusqlite::params![path],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())
    })
    .unwrap_or_else(|_| fallback_title(path))
}

fn fallback_title(path: &str) -> String {
    std::path::Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

/// Save note content: atomic write, then update the index immediately (so
/// search/backlinks reflect the new text without waiting for the watcher).
/// The watcher's later reconcile is a harmless no-op (same snapshot).
#[tauri::command]
pub fn save_note(
    state: State<'_, VaultState>,
    path: String,
    content: String,
) -> Result<(), String> {
    let root = state
        .root
        .lock()
        .map_err(|_| "state lock poisoned")?
        .clone()
        .ok_or("no vault open")?;
    let full = safe_join(&root, &path)?;

    crate::storage::atomic_write(&full, &content).map_err(|e| e.to_string())?;

    let snap = indexer::snapshot_file(&root, &path).map_err(|e| e.to_string())?;
    let note = indexer::parse_file(&root, &path);
    with_conn(&state, |conn| {
        db::upsert_note(conn, &path, snap.mtime, snap.size, &snap.hash, &note)
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
}

/// Resolve a `[[wikilink]]` target to a vault file path: exact title match,
/// then case-insensitive prefix, then substring; returns null when unknown.
#[tauri::command]
pub fn resolve_link(state: State<'_, VaultState>, target: String) -> Result<Option<String>, String> {
    with_conn(&state, |conn| {
        let notes = db::list_notes(conn).map_err(|e| e.to_string())?;
        let t = target.trim().to_lowercase();
        let exact = notes.iter().find(|n| n.title.to_lowercase() == t);
        let prefix = exact.or_else(|| {
            notes
                .iter()
                .find(|n| n.title.to_lowercase().starts_with(&t))
        });
        let fuzzy = prefix.or_else(|| {
            notes
                .iter()
                .find(|n| n.title.to_lowercase().contains(&t))
        });
        Ok(fuzzy.map(|n| n.path.clone()))
    })
}

/// Join a vault-relative path to the root and verify it stays inside the
/// vault (defense against path traversal from the frontend).
fn safe_join(root: &std::path::Path, rel: &str) -> Result<std::path::PathBuf, String> {
    let candidate = root.join(rel).canonicalize().map_err(|e| e.to_string())?;
    let root_canon = root.canonicalize().map_err(|e| e.to_string())?;
    if candidate.starts_with(&root_canon) {
        Ok(candidate)
    } else {
        Err(format!("path escapes the vault: {rel}"))
    }
}