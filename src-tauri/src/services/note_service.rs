//! Note CRUD service: create, read, rename, move, and delete notes.
//!
//! All functions operate on the filesystem and SQLite index. They have no
//! Tauri dependencies and are unit-testable without a Tauri runtime.

use crate::db;
use crate::indexer;
use crate::services::link_service;
use crate::settings;
use crate::vault_path::{safe_join, safe_join_lenient};
use rusqlite::Connection;
use rusqlite::OptionalExtension;
use std::path::Path;

/// Sanitize a user-supplied title into a safe filename component.
/// Replaces filesystem-illegal characters with `-`.
pub fn sanitize_filename(title: &str) -> String {
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

/// Return a note's title from the DB, falling back to the filename stem.
pub fn title_from_db(conn: &Connection, path: &str) -> String {
    conn.query_row(
        "SELECT title FROM files WHERE path = ?1",
        rusqlite::params![path],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_else(|_| fallback_title(path))
}

/// Derive a display title from a vault-relative path (filename stem).
pub fn fallback_title(path: &str) -> String {
    std::path::Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

/// Create a new note with `# <title>` content. The filename is derived from
/// the sanitized title and deduplicated with a numeric suffix if needed.
/// The note is indexed immediately so it's searchable without waiting for the
/// watcher.
pub fn create(
    conn: &Connection,
    root: &Path,
    title: &str,
    folder: Option<&str>,
) -> Result<(String, String), String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("title is empty".to_string());
    }
    let dir = match folder {
        Some(f) if !f.trim().is_empty() => safe_join(root, f)?,
        _ => root.to_path_buf(),
    };
    let base = sanitize_filename(title);
    let mut name = base.clone();
    let mut counter = 2u32;
    let full = loop {
        let candidate = format!("{name}.md");
        let full = dir.join(&candidate);
        if !full.exists() {
            break full;
        }
        name = format!("{base} {counter}");
        counter += 1;
    };
    let rel = full
        .strip_prefix(root)
        .map_err(|_| "note escapes the vault".to_string())?
        .to_string_lossy()
        .into_owned();
    let content = format!("# {title}\n");
    crate::storage::atomic_write(&full, &content).map_err(|e| e.to_string())?;
    let snap = indexer::snapshot_file(root, &rel).map_err(|e| e.to_string())?;
    let note = indexer::parse_file(root, &rel);
    db::upsert_note(conn, &rel, snap.mtime, snap.size, &snap.hash, &note)
        .map_err(|e| e.to_string())?;
    Ok((rel, content))
}

/// Read a note's raw content from disk (source of truth).
pub fn read(root: &Path, path: &str) -> Result<String, String> {
    let full = safe_join(root, path)?;
    std::fs::read_to_string(&full).map_err(|e| e.to_string())
}

/// The result of a rename or move operation.
pub struct OpResult {
    pub path: String,
    pub title: String,
    pub links_updated: usize,
}

/// Rename a note: new filename from the title, same folder. Wikilinks across
/// the vault are rewritten to the new title when `update_links_on_rename` is
/// set.
///
/// ## Atomicity guarantee
/// Link rewrites are planned entirely in memory before anything is mutated.
/// If any referencing file cannot be read, the whole operation fails before
/// touching disk, so the vault stays consistent.
pub fn rename(
    conn: &Connection,
    root: &Path,
    path: &str,
    new_title: &str,
    settings_path: &Path,
) -> Result<OpResult, String> {
    let new_title = new_title.trim();
    if new_title.is_empty() {
        return Err("title is empty".to_string());
    }
    let old_full = safe_join(root, path)?;
    if !old_full.is_file() {
        return Err(format!("note not found: {path}"));
    }
    let folder = path.rsplit_once('/').map(|(d, _)| d.to_string());
    let new_filename = format!("{}.md", sanitize_filename(new_title));
    let new_path = match &folder {
        Some(d) => format!("{d}/{new_filename}"),
        None => new_filename,
    };
    if new_path != path && safe_join_lenient(root, &new_path)?.exists() {
        return Err(format!("a note named '{new_title}' already exists"));
    }
    let old_title = conn
        .query_row(
            "SELECT title FROM files WHERE path = ?1",
            rusqlite::params![path],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| fallback_title(path));

    // Plan all link rewrites in memory BEFORE touching disk.
    // If any referencing file is unreadable, this fails here — nothing mutated.
    let update_links = settings::load(settings_path).update_links_on_rename;
    let plan = if update_links {
        link_service::plan_rewrites(conn, root, &[old_title, path.to_string()], new_title)?
    } else {
        link_service::RewritePlan { rewrites: vec![] }
    };

    // Rename the source file — the only filesystem mutation before the plan is applied.
    std::fs::rename(&old_full, safe_join_lenient(root, &new_path)?)
        .map_err(|e| e.to_string())?;
    db::delete_note(conn, path).map_err(|e| e.to_string())?;
    link_service::reindex_rel(conn, root, &new_path)?;

    // Apply pre-computed rewrites. All content was already validated above.
    let links_updated = link_service::apply_rewrites(conn, root, plan)?;
    Ok(OpResult {
        path: new_path,
        title: new_title.to_string(),
        links_updated,
    })
}

/// Move a note to a different folder (vault-relative). Path-form wikilinks
/// are rewritten to the new location; title-only links need no change.
///
/// ## Atomicity guarantee
/// Same as `rename`: all rewrites are computed in memory before any mutation.
pub fn move_to(
    conn: &Connection,
    root: &Path,
    path: &str,
    new_folder: &str,
    settings_path: &Path,
) -> Result<OpResult, String> {
    let old_full = safe_join(root, path)?;
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
    if new_path != path && safe_join_lenient(root, &new_path)?.exists() {
        return Err("a note with that name already exists in the destination".to_string());
    }
    let old_title = conn
        .query_row(
            "SELECT title FROM files WHERE path = ?1",
            rusqlite::params![path],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| fallback_title(path));

    // Plan all link rewrites in memory BEFORE touching disk.
    let update_links = settings::load(settings_path).update_links_on_rename;
    let plan = if update_links {
        link_service::plan_rewrites(conn, root, &[path.to_string()], &new_path)?
    } else {
        link_service::RewritePlan { rewrites: vec![] }
    };

    // Move the source file.
    std::fs::rename(&old_full, safe_join_lenient(root, &new_path)?)
        .map_err(|e| e.to_string())?;
    db::delete_note(conn, path).map_err(|e| e.to_string())?;
    link_service::reindex_rel(conn, root, &new_path)?;

    // Apply pre-computed rewrites.
    let links_updated = link_service::apply_rewrites(conn, root, plan)?;
    Ok(OpResult {
        path: new_path,
        title: old_title,
        links_updated,
    })
}

/// Delete a note from disk and the index.
pub fn delete(conn: &Connection, root: &Path, path: &str) -> Result<(), String> {
    let full = safe_join(root, path)?;
    if full.is_file() {
        std::fs::remove_file(&full).map_err(|e| e.to_string())?;
    }
    db::delete_note(conn, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_removes_path_chars() {
        assert_eq!(sanitize_filename("a/b:c"), "a-b-c");
        assert_eq!(sanitize_filename("  "), "Untitled");
        assert_eq!(sanitize_filename("normal title"), "normal title");
    }
}
