//! Tauri IPC commands — thin wrappers over db/indexer logic.

use crate::db::{self, NoteMeta, SearchResult};
use crate::indexer;
use crate::settings::{self, Settings};
use crate::vault::VaultState;
use regex::Regex;
use rusqlite::Connection;
use rusqlite::OptionalExtension;
use serde::Serialize;
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;

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
        // Incremental open: reconcile new/changed files, then drop index rows
        // for files no longer on disk. Unchanged files are never re-read.
        let files = indexer::scan_markdown_files(&open_root);
        indexer::reconcile_index(&conn, &open_root, &files, Some(&progress)).map_err(|e| e.to_string())?;
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
    // Remember this vault for "reopen last vault on launch".
    let mut s = settings::load(&state.settings_path);
    s.last_vault = Some(path.clone());
    let _ = settings::save(&state.settings_path, &s);
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
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

#[tauri::command]
pub fn quick_switcher(state: State<'_, VaultState>, q: String) -> Result<Vec<NoteMeta>, String> {
    with_conn(&state, |conn| {
        let query = q.trim().to_lowercase();
        if query.is_empty() {
            return db::list_notes(conn)
                .map_err(|e| e.to_string())
                .map(|n| n.into_iter().take(20).collect());
        }
        let esc = escape_like(&query);
        let pref = format!("{esc}%");
        let sub = format!("%{esc}%");
        // Pull a bounded candidate set from SQLite (prefix + substring,
        // prefix-ranked), then apply subsequence fuzzy + rank in Rust.
        let mut stmt = conn
            .prepare(
                "SELECT path, title FROM files
                 WHERE LOWER(title) LIKE ?1 ESCAPE '\\'
                    OR LOWER(title) LIKE ?2 ESCAPE '\\'
                 ORDER BY (LOWER(title) LIKE ?3 ESCAPE '\\') DESC, title COLLATE NOCASE
                 LIMIT 60",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![&pref, &sub, &pref], |row| {
                Ok(NoteMeta {
                    path: row.get(0)?,
                    title: row.get(1)?,
                    tags: Vec::new(),
                })
            })
            .map_err(|e| e.to_string())?;
        let mut cands: Vec<NoteMeta> =
            rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?;
        cands.retain(|n| title_subsequence(&n.title.to_lowercase(), &query));
        cands.sort_by(|a, b| {
            let ap = a.title.to_lowercase().starts_with(&query);
            let bp = b.title.to_lowercase().starts_with(&query);
            bp.cmp(&ap)
                .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
        });
        cands.truncate(20);
        Ok(cands)
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

/// Create a new note: `# <title>` content, filename from a sanitized title
/// (deduped with a numeric suffix if it already exists). Created in `folder`
/// (vault-relative, optional; defaults to vault root). Indexed immediately.
#[tauri::command]
pub fn create_note(
    state: State<'_, VaultState>,
    title: String,
    folder: Option<String>,
) -> Result<NoteContent, String> {
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
    let dir = match folder {
        Some(f) if !f.trim().is_empty() => safe_join(&root, &f)?,
        _ => root.clone(),
    };
    let base = sanitize_filename(title);
    let mut name = base.clone();
    let mut counter = 2;
    let (_, full) = loop {
        let candidate = format!("{name}.md");
        let full = dir.join(&candidate);
        if !full.exists() {
            break (candidate, full);
        }
        name = format!("{base} {counter}");
        counter += 1;
    };
    let rel = full
        .strip_prefix(&root)
        .map_err(|_| "note escapes the vault".to_string())?
        .to_string_lossy()
        .into_owned();
    let content = format!("# {title}\n");
    crate::storage::atomic_write(&full, &content).map_err(|e| e.to_string())?;
    let snap = indexer::snapshot_file(&root, &rel).map_err(|e| e.to_string())?;
    let note = indexer::parse_file(&root, &rel);
    with_conn(&state, |conn| {
        db::upsert_note(conn, &rel, snap.mtime, snap.size, &snap.hash, &note)
            .map(|_| ())
            .map_err(|e| e.to_string())
    })?;
    Ok(NoteContent {
        path: rel,
        title: title.to_string(),
        content,
    })
}

/// Current app settings.
#[tauri::command]
pub fn get_settings(state: State<'_, VaultState>) -> Result<Settings, String> {
    Ok(settings::load(&state.settings_path))
}

/// Persist settings. `last_vault` is server-managed: the value on disk is
/// preserved and user-supplied value ignored (avoids clobbering).
#[tauri::command]
pub fn save_settings(state: State<'_, VaultState>, mut settings_in: Settings) -> Result<(), String> {
    settings_in.sanitize();
    let mut stored = settings::load(&state.settings_path);
    settings_in.last_vault = stored.last_vault.take();
    settings::save(&state.settings_path, &settings_in)
}

// ---- File operations (Phase 2) ----

#[derive(Debug, Serialize)]
pub struct OpResult {
    pub path: String,
    pub title: String,
    /// Number of files whose wikilinks were rewritten to follow the change.
    pub links_updated: usize,
}

fn reindex_rel(conn: &Connection, root: &std::path::Path, rel: &str) -> Result<(), String> {
    match indexer::snapshot_file(root, rel) {
        Ok(snap) => {
            let note = indexer::parse_file(root, rel);
            db::upsert_note(conn, rel, snap.mtime, snap.size, &snap.hash, &note)
                .map(|_| ())
                .map_err(|e| e.to_string())
        }
        Err(_) => db::delete_note(conn, rel).map_err(|e| e.to_string()),
    }
}

/// Rewrite the target portion of every `[[...]]` link whose path-part equals
/// `old` (case-insensitive) to `new`, across every file that references it.
/// Returns the number of files updated.
fn rewrite_references(
    conn: &Connection,
    root: &std::path::Path,
    olds: &[String],
    new: &str,
) -> Result<usize, String> {
    let re = Regex::new(r"\[\[([^\[\]\n]+)\]\]").map_err(|e| e.to_string())?;
    let mut touched: HashSet<String> = HashSet::new();
    for old in olds {
        for rel in db::link_sources(conn, old).map_err(|e| e.to_string())? {
            touched.insert(rel);
        }
    }
    let mut updated = 0usize;
    for rel in touched {
        let full = root.join(&rel);
        let Ok(content) = std::fs::read_to_string(&full) else { continue };
        let mut out = String::with_capacity(content.len());
        let mut last = 0usize;
        let mut changed = false;
        for caps in re.captures_iter(&content) {
            let m = caps.get(0).unwrap();
            out.push_str(&content[last..m.start()]);
            let inner = caps.get(1).unwrap().as_str();
            let (path_part, rest) = match inner.split_once('|') {
                Some((p, alias)) => (p, Some(format!("|{alias}"))),
                None => (inner, None),
            };
            let (path_part, heading) = match path_part.split_once('#') {
                Some((p, h)) => (p, Some(format!("#{h}"))),
                None => (path_part, None),
            };
            if olds.iter().any(|o| path_part.trim().eq_ignore_ascii_case(o)) {
                let mut rebuilt = format!("[[{new}");
                if let Some(h) = heading {
                    rebuilt.push_str(&h);
                }
                if let Some(r) = rest {
                    rebuilt.push_str(&r);
                }
                rebuilt.push_str("]]");
                out.push_str(&rebuilt);
                changed = true;
            } else {
                out.push_str(m.as_str());
            }
            last = m.end();
        }
        out.push_str(&content[last..]);
        if !changed {
            continue;
        }
        crate::storage::atomic_write(&full, &out).map_err(|e| e.to_string())?;
        reindex_rel(conn, root, &rel)?;
        updated += 1;
    }
    Ok(updated)
}

/// Rename a note: new filename from the title, same folder. Wikilinks across
/// the vault are rewritten to the new title (per the update_links_on_rename
/// setting). Title collisions are rejected before anything is changed.
#[tauri::command]
pub fn rename_note(
    state: State<'_, VaultState>,
    path: String,
    new_title: String,
) -> Result<OpResult, String> {
    let root = state
        .root
        .lock()
        .map_err(|_| "state lock poisoned")?
        .clone()
        .ok_or("no vault open")?;
    let new_title = new_title.trim();
    if new_title.is_empty() {
        return Err("title is empty".to_string());
    }
    let old_full = root.join(&path);
    if !old_full.is_file() {
        return Err(format!("note not found: {path}"));
    }
    let folder = path.rsplit_once('/').map(|(d, _)| d.to_string());
    let new_filename = format!("{}.md", sanitize_filename(new_title));
    let new_path = match &folder {
        Some(d) => format!("{d}/{new_filename}"),
        None => new_filename,
    };
    if new_path != path && root.join(&new_path).exists() {
        return Err(format!("a note named '{new_title}' already exists"));
    }
    let old_title = with_conn(&state, |conn| {
        conn.query_row(
            "SELECT title FROM files WHERE path = ?1",
            rusqlite::params![path],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())
    })?
    .unwrap_or_else(|| fallback_title(&path));

    std::fs::rename(&old_full, root.join(&new_path)).map_err(|e| e.to_string())?;
    let conn = state.conn.lock().map_err(|_| "state lock poisoned")?;
    db::delete_note(&conn, &path).map_err(|e| e.to_string())?;
    reindex_rel(&conn, &root, &new_path)?;

    let update_links = settings::load(&state.settings_path).update_links_on_rename;
    let links_updated = if update_links {
        rewrite_references(
            &conn,
            &root,
            &[old_title, path.clone()],
            new_title,
        )?
    } else {
        0
    };
    Ok(OpResult {
        path: new_path,
        title: new_title.to_string(),
        links_updated,
    })
}

/// Move a note into a folder (vault-relative). Path-form wikilinks are
/// rewritten to the new location; title links need no change.
#[tauri::command]
pub fn move_note(
    state: State<'_, VaultState>,
    path: String,
    new_folder: String,
) -> Result<OpResult, String> {
    let root = state
        .root
        .lock()
        .map_err(|_| "state lock poisoned")?
        .clone()
        .ok_or("no vault open")?;
    let old_full = root.join(&path);
    if !old_full.is_file() {
        return Err(format!("note not found: {path}"));
    }
    let filename = path.rsplit('/').next().unwrap().to_string();
    let folder = new_folder.trim().trim_matches('/').to_string();
    let new_path = if folder.is_empty() {
        filename.clone()
    } else {
        format!("{folder}/{filename}")
    };
    if new_path != path && root.join(&new_path).exists() {
        return Err("a note with that name already exists in the destination".to_string());
    }
    let old_title = with_conn(&state, |conn| {
        conn.query_row(
            "SELECT title FROM files WHERE path = ?1",
            rusqlite::params![path],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())
    })?
    .unwrap_or_else(|| fallback_title(&path));

    std::fs::rename(&old_full, root.join(&new_path)).map_err(|e| e.to_string())?;
    let conn = state.conn.lock().map_err(|_| "state lock poisoned")?;
    db::delete_note(&conn, &path).map_err(|e| e.to_string())?;
    reindex_rel(&conn, &root, &new_path)?;

    let update_links = settings::load(&state.settings_path).update_links_on_rename;
    let links_updated = if update_links {
        rewrite_references(&conn, &root, &[path.clone()], &new_path)?
    } else {
        0
    };
    Ok(OpResult {
        path: new_path,
        title: old_title,
        links_updated,
    })
}

/// Delete a note from disk and the index. (Confirmation is the frontend's
/// job, honoring the confirm_before_delete setting.)
#[tauri::command]
pub fn delete_note_file(state: State<'_, VaultState>, path: String) -> Result<(), String> {
    let root = state
        .root
        .lock()
        .map_err(|_| "state lock poisoned")?
        .clone()
        .ok_or("no vault open")?;
    let full = root.join(&path);
    if full.is_file() {
        std::fs::remove_file(&full).map_err(|e| e.to_string())?;
    }
    let conn = state.conn.lock().map_err(|_| "state lock poisoned")?;
    db::delete_note(&conn, &path).map_err(|e| e.to_string())
}

/// Reveal a note in Finder (macOS).
#[tauri::command]
pub fn reveal_note(state: State<'_, VaultState>, path: String, app: AppHandle) -> Result<(), String> {
    let root = state
        .root
        .lock()
        .map_err(|_| "state lock poisoned")?
        .clone()
        .ok_or("no vault open")?;
    app.opener()
        .reveal_item_in_dir(root.join(&path))
        .map_err(|e| e.to_string())
}

/// Write arbitrary text to an absolute path (used for HTML export). The path
/// comes from a user-chosen save dialog, so it may be anywhere on disk.
#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() {
        return Err("path must be absolute".to_string());
    }
    crate::storage::atomic_write(&p, &content).map_err(|e| e.to_string())
}

/// Write HTML to the app-data exports dir and open it in the default browser
/// (used for Print / Save as PDF via the OS print flow).
#[tauri::command]
pub fn open_html_preview(
    state: State<'_, VaultState>,
    content: String,
    title: String,
    app: AppHandle,
) -> Result<String, String> {
    let dir = state
        .settings_path
        .parent()
        .ok_or("no app data dir")?
        .join("exports");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = if title.trim().is_empty() {
        "preview".to_string()
    } else {
        title.trim().to_string()
    };
    let file = dir.join(format!("{}.html", sanitize_filename(&name)));
    crate::storage::atomic_write(&file, &content).map_err(|e| e.to_string())?;
    let path_str = file.to_string_lossy().into_owned();
    app.opener()
        .open_path(path_str, None::<&str>)
        .map_err(|e| e.to_string())?;
    Ok(file.to_string_lossy().into_owned())
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

/// All tags with counts (tag sidebar).
#[tauri::command]
pub fn tags_list(state: State<'_, VaultState>) -> Result<Vec<db::TagCount>, String> {
    with_conn(&state, |conn| db::list_tags(conn).map_err(|e| e.to_string()))
}

/// Notes carrying a tag (tag-filtered view).
#[tauri::command]
pub fn files_by_tag(state: State<'_, VaultState>, tag: String) -> Result<Vec<NoteMeta>, String> {
    with_conn(&state, |conn| {
        db::files_by_tag(conn, &tag).map_err(|e| e.to_string())
    })
}

/// Backlinks for a note (linked + unlinked mentions), each with a context
/// snippet from the referencing file.
#[tauri::command]
pub fn backlinks(state: State<'_, VaultState>, path: String) -> Result<Vec<db::Backlink>, String> {
    let root = state
        .root
        .lock()
        .map_err(|_| "state lock poisoned")?
        .clone()
        .ok_or("no vault open")?;
    let needle = with_conn(&state, |conn| {
        conn.query_row(
            "SELECT title FROM files WHERE path = ?1",
            rusqlite::params![path],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())
    })?
    .unwrap_or_default();
    with_conn(&state, |conn| {
        let mut links = db::backlinks_for(conn, &path).map_err(|e| e.to_string())?;
        for b in &mut links {
            if !needle.is_empty() {
                b.snippet = snippet_for(&root, &b.path, &needle);
            }
        }
        Ok(links)
    })
}

/// First line of a file containing `needle` (case-insensitive), trimmed.
/// Streams line-by-line and stops at the first match (bounded memory).
fn snippet_for(root: &std::path::Path, rel: &str, needle: &str) -> String {
    use std::io::BufRead;
    let Ok(file) = std::fs::File::open(root.join(rel)) else {
        return String::new();
    };
    let reader = std::io::BufReader::new(file);
    let lower = needle.to_lowercase();
    for line in reader.lines().map_while(Result::ok) {
        if line.to_lowercase().contains(&lower) {
            return line.trim().chars().take(140).collect();
        }
    }
    String::new()
}

/// Lightweight list of note titles (completion dictionary / quick switcher).
#[tauri::command]
pub fn list_titles(state: State<'_, VaultState>) -> Result<Vec<String>, String> {
    with_conn(&state, |conn| db::list_titles(conn).map_err(|e| e.to_string()))
}


/// Wikilink targets that resolve to no existing note.
#[tauri::command]
pub fn broken_links(state: State<'_, VaultState>) -> Result<Vec<db::BrokenLink>, String> {
    with_conn(&state, |conn| db::broken_links(conn).map_err(|e| e.to_string()))
}

/// Notes sharing at least one tag with the given note ("related by topic").
#[tauri::command]
pub fn related_notes(state: State<'_, VaultState>, path: String) -> Result<Vec<db::RelatedNote>, String> {
    with_conn(&state, |conn| db::related_notes(conn, &path).map_err(|e| e.to_string()))
}

/// Rebuild the full index for the current vault, reporting progress.
#[tauri::command]
pub async fn rebuild_index(
    state: State<'_, VaultState>,
    app: AppHandle,
) -> Result<usize, String> {
    let root = state
        .root
        .lock()
        .map_err(|_| "state lock poisoned")?
        .clone()
        .ok_or("no vault open")?;
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

/// Notes that no other note links to.
#[tauri::command]
pub fn orphan_notes(state: State<'_, VaultState>) -> Result<Vec<db::OrphanNote>, String> {
    with_conn(&state, |conn| db::orphan_notes(conn).map_err(|e| e.to_string()))
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

    #[test]
    fn rewrite_references_handles_path_tokens_on_move() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("Proj")).unwrap();
        std::fs::write(root.join("a.md"), "# A\ngoto [[Proj/Old.md]] now").unwrap();

        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        let files = crate::indexer::scan_markdown_files(root);
        for rel in &files {
            reindex_rel(&conn, root, rel).unwrap();
        }

        // move: old path token "Proj/Old.md" -> "Archive/Old.md"
        let updated = rewrite_references(
            &conn,
            root,
            &["Proj/Old.md".to_string()],
            "Archive/Old.md",
        )
        .unwrap();
        assert_eq!(updated, 1);
        let aa = std::fs::read_to_string(root.join("a.md")).unwrap();
        assert!(aa.contains("[[Archive/Old.md]]"));
        assert!(!aa.contains("Proj/Old"));
    }

    #[test]
    fn rewrite_references_does_not_touch_other_links() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("a.md"), "# A\nkeep [[Welcome]] and [[Old Name]]").unwrap();
        std::fs::write(root.join("b.md"), "# B\n[[Welcome]] only").unwrap();

        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        for rel in crate::indexer::scan_markdown_files(root) {
            reindex_rel(&conn, root, &rel).unwrap();
        }

        // Only "Welcome" is rewritten; "Old Name" and the untouched file stay.
        let updated = rewrite_references(&conn, root, &["Welcome".to_string()], "Home").unwrap();
        assert_eq!(updated, 2);
        let aa = std::fs::read_to_string(root.join("a.md")).unwrap();
        assert!(aa.contains("[[Home]]"));
        assert!(aa.contains("[[Old Name]]"));
        let bb = std::fs::read_to_string(root.join("b.md")).unwrap();
        assert!(bb.contains("[[Home]]"));
    }

    #[test]
    fn rewrite_references_updates_matching_files_only() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(
            root.join("a.md"),
            "# A\nlink to [[Old Name]] and [[Old Name#head|alias]] here",
        )
        .unwrap();
        std::fs::write(root.join("b.md"), "# B\nno links at all").unwrap();
        std::fs::write(root.join("src/c.md"), "# C\n[[old name]] lowercase-ok").unwrap();

        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        let files = crate::indexer::scan_markdown_files(root);
        for rel in &files {
            reindex_rel(&conn, root, rel).unwrap();
        }

        let updated =
            rewrite_references(&conn, root, &["Old Name".to_string()], "New Name").unwrap();
        // a.md + c.md updated; b.md not
        assert_eq!(updated, 2);
        let aa = std::fs::read_to_string(root.join("a.md")).unwrap();
        assert!(aa.contains("[[New Name]]"));
        assert!(aa.contains("[[New Name#head|alias]]"));
        assert!(!aa.contains("Old Name"));
        let cc = std::fs::read_to_string(root.join("src/c.md")).unwrap();
        assert!(cc.contains("[[New Name]]"));
        let bb = std::fs::read_to_string(root.join("b.md")).unwrap();
        assert!(!bb.contains("New"));
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
        let t = target.trim().to_lowercase();
        if t.is_empty() {
            return Ok(None);
        }
        let esc = escape_like(&t);
        let pref = format!("{esc}%");
        let subp = format!("%{esc}%");
        // staged SQLite lookups, each LIMIT 1 / near-index
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