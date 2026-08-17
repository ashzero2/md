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

/// Quick switcher (Cmd+P): fuzzy/subsequence match over note titles.
/// Prefix matches rank above later-position matches, then alphabetical.
#[tauri::command]
pub fn quick_switcher(state: State<'_, VaultState>, q: String) -> Result<Vec<NoteMeta>, String> {
    with_conn(&state, |conn| {
        let notes = db::list_notes(conn).map_err(|e| e.to_string())?;
        let query = q.trim().to_lowercase();
        if query.is_empty() {
            return Ok(notes.into_iter().take(20).collect());
        }
        let mut out: Vec<NoteMeta> = notes
            .into_iter()
            .filter(|n| title_subsequence(&n.title.to_lowercase(), &query))
            .collect();
        out.sort_by(|a, b| {
            let a_prefix = a.title.to_lowercase().starts_with(&query);
            let b_prefix = b.title.to_lowercase().starts_with(&query);
            b_prefix
                .cmp(&a_prefix)
                .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
        });
        out.truncate(20);
        Ok(out)
    })
}

/// True when all chars of `q` appear in order within `title` (fuzzy match).
fn title_subsequence(title: &str, q: &str) -> bool {
    if q.is_empty() {
        return true;
    }
    let mut chars = title.chars();
    for c in q.chars() {
        match chars.find(|&t| t == c) {
            Some(_) => {}
            None => return false,
        }
    }
    true
}

/// Create a new note at the vault root: `# <title>` content, filename from a
/// sanitized title (deduped with a numeric suffix if it already exists).
/// The note is indexed immediately.
#[tauri::command]
pub fn create_note(state: State<'_, VaultState>, title: String) -> Result<NoteContent, String> {
    let root = state
        .root
        .lock()
        .map_err(|_| "state lock poisoned")?
        .clone()
        .ok_or("no vault open")?;
    let title = title.trim();
    if title.is_empty() {
        return Err("title is empty".to_string());
    }
    let base = sanitize_filename(title);
    let mut name = base.clone();
    let mut counter = 2;
    let path = loop {
        let candidate = format!("{name}.md");
        if !root.join(&candidate).exists() {
            break candidate;
        }
        name = format!("{base} {counter}");
        counter += 1;
    };
    let content = format!("# {title}\n");
    crate::storage::atomic_write(&root.join(&path), &content).map_err(|e| e.to_string())?;
    let snap = indexer::snapshot_file(&root, &path).map_err(|e| e.to_string())?;
    let note = indexer::parse_file(&root, &path);
    with_conn(&state, |conn| {
        db::upsert_note(conn, &path, snap.mtime, snap.size, &snap.hash, &note)
            .map(|_| ())
            .map_err(|e| e.to_string())
    })?;
    Ok(NoteContent {
        path,
        title: title.to_string(),
        content,
    })
}

fn sanitize_filename(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '?' | '*' | '"' | '<' | '>' | '|') {
                '-'
            } else {
                c
            }
        })
        .collect();
    if cleaned.trim().is_empty() {
        "Untitled".to_string()
    } else {
        cleaned
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subsequence_matches_in_order() {
        assert!(title_subsequence("sprint summary", "sp sum"));
        assert!(title_subsequence("client action closure", "cac"));
        assert!(title_subsequence("welcome", "wlcm"));
        assert!(!title_subsequence("welcome", "wlmce")); // wrong order
        assert!(!title_subsequence("alpha", "xyz"));
        assert!(title_subsequence("alpha", ""));
    }

    #[test]
    fn sanitize_removes_path_chars() {
        assert_eq!(sanitize_filename("a/b:c"), "a-b-c");
        assert_eq!(sanitize_filename("  "), "Untitled");
        assert_eq!(sanitize_filename("normal title"), "normal title");
    }
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