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
fn snippet_for(root: &std::path::Path, rel: &str, needle: &str) -> String {
    let Ok(content) = std::fs::read_to_string(root.join(rel)) else {
        return String::new();
    };
    let lower = needle.to_lowercase();
    content
        .lines()
        .find(|l| l.to_lowercase().contains(&lower))
        .map(|l| l.trim().chars().take(140).collect())
        .unwrap_or_default()
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