//! Tauri IPC commands — thin wrappers that acquire state and delegate to
//! service modules. No business logic lives here.

use crate::db::{self, NoteMeta, SearchResult};
use crate::indexer;
use crate::services::{export_service, note_service, query_service};
use crate::settings::{self, Settings};
use crate::vault::VaultState;
use crate::vault_path::safe_join;
use rusqlite::Connection;
use rusqlite::OptionalExtension;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;

// ---- IPC-layer types (serialized over the Tauri bridge) ----

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

#[derive(Debug, Serialize)]
pub struct OpResult {
    pub path: String,
    pub title: String,
    pub links_updated: usize,
}

#[derive(Serialize)]
pub struct Paged<T> {
    pub items: Vec<T>,
    pub total: i64,
}

// ---- Shared helpers ----

fn with_conn<T>(
    state: &State<'_, VaultState>,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let conn = state.conn.lock().map_err(|_| "index lock poisoned".to_string())?;
    f(&conn)
}

fn get_root(state: &State<'_, VaultState>) -> Result<PathBuf, String> {
    state
        .root
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "no vault open".to_string())
}

// ---- Vault lifecycle ----

/// Open a vault folder: incremental index reconcile in a blocking task, with
/// progress events. Starts the filesystem watcher and persists the vault path.
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
    let open_root = root.clone();

    let indexed = tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        crate::db::init_schema(&conn).map_err(|e| e.to_string())?;
        let progress = |done: usize, total: usize| {
            let _ = task_app.emit(
                "index-progress",
                serde_json::json!({ "done": done, "total": total }),
            );
        };
        let files = indexer::scan_markdown_files(&open_root);
        indexer::reconcile_index(&conn, &open_root, &files, Some(&progress))
            .map_err(|e| e.to_string())?;
        conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
        let res = (|| -> Result<(), String> {
            let on_disk: std::collections::HashSet<String> = files.iter().cloned().collect();
            for stale in db::list_indexed_paths(&conn).map_err(|e| e.to_string())? {
                if !on_disk.contains(&stale) {
                    db::delete_note(&conn, &stale).map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        })();
        match res {
            Ok(()) => conn.execute_batch("COMMIT").map_err(|e| e.to_string())?,
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                return Err(e);
            }
        }
        Ok::<usize, String>(files.len())
    })
    .await
    .map_err(|e| e.to_string())??;

    *state.root.lock().unwrap() = Some(root.clone());
    let _ = app.emit("index-ready", serde_json::json!({ "files": indexed }));
    let _ = state.start_watcher(app.clone());
    let mut s = settings::load(&state.settings_path);
    s.last_vault = Some(path.clone());
    let _ = settings::save(&state.settings_path, &s);
    Ok(VaultInfo { root: path, files: indexed })
}

/// Rebuild the full index for the current vault, reporting progress.
#[tauri::command]
pub async fn rebuild_index(
    state: State<'_, VaultState>,
    app: AppHandle,
) -> Result<usize, String> {
    let root = get_root(&state)?;
    let db_path = state.db_path.clone();
    let task_app = app.clone();
    let n = tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        crate::db::init_schema(&conn).map_err(|e| e.to_string())?;
        let progress = |done: usize, total: usize| {
            let _ = task_app.emit(
                "index-progress",
                serde_json::json!({ "done": done, "total": total }),
            );
        };
        indexer::rebuild_index(&conn, &root, Some(&progress)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = app.emit("index-ready", serde_json::json!({ "files": n }));
    Ok(n)
}

// ---- Index queries ----

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
    with_conn(&state, |conn| query_service::search(conn, &q, 50))
}

/// Quick switcher: fuzzy/subsequence match over note titles.
#[tauri::command]
pub fn quick_switcher(state: State<'_, VaultState>, q: String) -> Result<Vec<NoteMeta>, String> {
    with_conn(&state, |conn| query_service::quick_switcher(conn, &q))
}

/// All tags with counts (tag sidebar).
#[tauri::command]
pub fn tags_list(state: State<'_, VaultState>) -> Result<Vec<db::TagCount>, String> {
    with_conn(&state, query_service::tags_list)
}

/// Notes carrying a tag (tag-filtered view).
#[tauri::command]
pub fn files_by_tag(state: State<'_, VaultState>, tag: String) -> Result<Vec<NoteMeta>, String> {
    with_conn(&state, |conn| query_service::files_by_tag(conn, &tag))
}

/// Backlinks for a note (linked + unlinked mentions with context snippets).
#[tauri::command]
pub fn backlinks(state: State<'_, VaultState>, path: String) -> Result<Vec<db::Backlink>, String> {
    let root = get_root(&state)?;
    with_conn(&state, |conn| query_service::backlinks(conn, &root, &path))
}

/// Lightweight list of note titles (completion dictionary).
#[tauri::command]
pub fn list_titles(state: State<'_, VaultState>) -> Result<Vec<String>, String> {
    with_conn(&state, query_service::list_titles)
}

/// Number of indexed files — much cheaper than list_files, used to detect
/// whether the file list changed without fetching all metadata.
#[tauri::command]
pub fn count_files(state: State<'_, VaultState>) -> Result<i64, String> {
    with_conn(&state, query_service::count_files)
}

/// Wikilink targets that resolve to no existing note, paginated.
#[tauri::command]
pub fn broken_links(
    state: State<'_, VaultState>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Paged<db::BrokenLink>, String> {
    let limit = limit.unwrap_or(200) as i64;
    let offset = offset.unwrap_or(0) as i64;
    with_conn(&state, |conn| {
        let p = query_service::broken_links(conn, limit, offset)?;
        Ok(Paged { items: p.items, total: p.total })
    })
}

/// Notes that no other note links to, paginated.
#[tauri::command]
pub fn orphan_notes(
    state: State<'_, VaultState>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Paged<db::OrphanNote>, String> {
    let limit = limit.unwrap_or(200) as i64;
    let offset = offset.unwrap_or(0) as i64;
    with_conn(&state, |conn| {
        let p = query_service::orphan_notes(conn, limit, offset)?;
        Ok(Paged { items: p.items, total: p.total })
    })
}

/// Notes sharing at least one tag with the given note ("related by topic").
#[tauri::command]
pub fn related_notes(
    state: State<'_, VaultState>,
    path: String,
) -> Result<Vec<db::RelatedNote>, String> {
    with_conn(&state, |conn| query_service::related_notes(conn, &path))
}

/// Resolve a `[[wikilink]]` target to a vault file path: exact title match,
/// then case-insensitive prefix, then substring; returns null when unknown.
#[tauri::command]
pub fn resolve_link(
    state: State<'_, VaultState>,
    target: String,
) -> Result<Option<String>, String> {
    with_conn(&state, |conn| {
        let t = target.trim().to_lowercase();
        if t.is_empty() {
            return Ok(None);
        }
        let esc = t.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        let pref = format!("{esc}%");
        let subp = format!("%{esc}%");
        let q = |sql: &str, arg: &str| -> Result<Option<String>, String> {
            conn.query_row(sql, rusqlite::params![arg], |row| row.get(0))
                .optional()
                .map_err(|e| e.to_string())
        };
        if let Some(p) = q("SELECT path FROM files WHERE LOWER(title) = ?1 LIMIT 1", &t)? {
            return Ok(Some(p));
        }
        if let Some(p) = q("SELECT path FROM files WHERE LOWER(path) = ?1 LIMIT 1", &t)? {
            return Ok(Some(p));
        }
        if let Some(p) = q(
            "SELECT path FROM files WHERE LOWER(title) LIKE ?1 ESCAPE '\\' ORDER BY title LIMIT 1",
            &pref,
        )? {
            return Ok(Some(p));
        }
        if let Some(p) = q(
            "SELECT path FROM files WHERE LOWER(title) LIKE ?1 ESCAPE '\\' ORDER BY title LIMIT 1",
            &subp,
        )? {
            return Ok(Some(p));
        }
        Ok(None)
    })
}

// ---- Note CRUD ----

/// Read a note's content from disk (source of truth).
#[tauri::command]
pub fn get_note(state: State<'_, VaultState>, path: String) -> Result<NoteContent, String> {
    let root = get_root(&state)?;
    let content = note_service::read(&root, &path)?;
    let title = with_conn(&state, |conn| Ok(note_service::title_from_db(conn, &path)))
        .unwrap_or_else(|_| note_service::fallback_title(&path));
    Ok(NoteContent { path, title, content })
}

/// Save note content: atomic write, then update the index immediately.
#[tauri::command]
pub fn save_note(
    state: State<'_, VaultState>,
    path: String,
    content: String,
) -> Result<(), String> {
    let root = get_root(&state)?;
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

/// Create a new note with `# <title>` content, indexed immediately.
#[tauri::command]
pub fn create_note(
    state: State<'_, VaultState>,
    title: String,
    folder: Option<String>,
) -> Result<NoteContent, String> {
    let root = get_root(&state)?;
    with_conn(&state, |conn| {
        let (path, content) =
            note_service::create(conn, &root, &title, folder.as_deref())?;
        let note_title = title.trim().to_string();
        Ok(NoteContent { path, title: note_title, content })
    })
}

/// Rename a note: new filename from the title, same folder.
#[tauri::command]
pub fn rename_note(
    state: State<'_, VaultState>,
    path: String,
    new_title: String,
) -> Result<OpResult, String> {
    let root = get_root(&state)?;
    let conn = state.conn.lock().map_err(|_| "state lock poisoned")?;
    let r = note_service::rename(&conn, &root, &path, &new_title, &state.settings_path)?;
    Ok(OpResult { path: r.path, title: r.title, links_updated: r.links_updated })
}

/// Move a note to a different folder (vault-relative).
#[tauri::command]
pub fn move_note(
    state: State<'_, VaultState>,
    path: String,
    new_folder: String,
) -> Result<OpResult, String> {
    let root = get_root(&state)?;
    let conn = state.conn.lock().map_err(|_| "state lock poisoned")?;
    let r = note_service::move_to(&conn, &root, &path, &new_folder, &state.settings_path)?;
    Ok(OpResult { path: r.path, title: r.title, links_updated: r.links_updated })
}

/// Delete a note from disk and the index.
#[tauri::command]
pub fn delete_note_file(state: State<'_, VaultState>, path: String) -> Result<(), String> {
    let root = get_root(&state)?;
    let conn = state.conn.lock().map_err(|_| "state lock poisoned")?;
    note_service::delete(&conn, &root, &path)
}

/// Reveal a note in Finder (macOS).
#[tauri::command]
pub fn reveal_note(
    state: State<'_, VaultState>,
    path: String,
    app: AppHandle,
) -> Result<(), String> {
    let root = get_root(&state)?;
    app.opener()
        .reveal_item_in_dir(safe_join(&root, &path)?)
        .map_err(|e| e.to_string())
}

// ---- Settings ----

/// Current app settings.
#[tauri::command]
pub fn get_settings(state: State<'_, VaultState>) -> Result<Settings, String> {
    Ok(settings::load(&state.settings_path))
}

/// Persist settings. `last_vault` is server-managed and never overwritten by
/// the frontend-supplied value.
#[tauri::command]
pub fn save_settings(
    state: State<'_, VaultState>,
    mut settings_in: Settings,
) -> Result<(), String> {
    settings_in.sanitize();
    let mut stored = settings::load(&state.settings_path);
    settings_in.last_vault = stored.last_vault.take();
    settings::save(&state.settings_path, &settings_in)
}

// ---- Export ----

/// Write arbitrary text to an absolute path (used for HTML export via a
/// user-chosen save dialog).
#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    export_service::write_text_file(&path, &content)
}

/// Write HTML to the app-data exports dir and open it in the default browser.
#[tauri::command]
pub fn open_html_preview(
    state: State<'_, VaultState>,
    content: String,
    title: String,
    app: AppHandle,
) -> Result<String, String> {
    let exports_dir = state
        .settings_path
        .parent()
        .ok_or("no app data dir")?
        .join("exports");
    export_service::html_preview(&exports_dir, &content, &title, |path_str| {
        app.opener()
            .open_path(path_str, None::<&str>)
            .map_err(|e| e.to_string())
    })
}
