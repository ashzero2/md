//! Query services: search, quick-switcher, tags, backlinks, and diagnostics.
//!
//! All functions accept a `&Connection` directly and have no Tauri dependencies.

use crate::db::{self, Backlink, BrokenLink, NoteMeta, OrphanNote, RelatedNote, SearchResult, TagCount};
use crate::services::link_service;
use rusqlite::Connection;
use rusqlite::OptionalExtension;
use std::path::Path;

/// A page of items plus the total count available (for "load more").
pub struct Paged<T> {
    pub items: Vec<T>,
    pub total: i64,
}

/// Full-text search over the FTS5 index (up to `limit` results).
pub fn search(conn: &Connection, q: &str, limit: i64) -> Result<Vec<SearchResult>, String> {
    db::search_notes(conn, q, limit).map_err(|e| e.to_string())
}

/// Quick-switcher: fuzzy/subsequence match over note titles.
/// Prefix matches rank above later-position matches, then alphabetical.
pub fn quick_switcher(conn: &Connection, q: &str) -> Result<Vec<NoteMeta>, String> {
    let query = q.trim().to_lowercase();
    if query.is_empty() {
        return db::list_notes(conn)
            .map_err(|e| e.to_string())
            .map(|n| n.into_iter().take(20).collect());
    }
    let esc = escape_like(&query);
    let pref = format!("{esc}%");
    let sub = format!("%{esc}%");
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
    let mut cands: Vec<NoteMeta> = rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?;
    cands.retain(|n| title_subsequence(&n.title.to_lowercase(), &query));
    cands.sort_by(|a, b| {
        let ap = a.title.to_lowercase().starts_with(&query);
        let bp = b.title.to_lowercase().starts_with(&query);
        bp.cmp(&ap)
            .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });
    cands.truncate(20);
    Ok(cands)
}

/// All tags with note counts, sorted by count descending.
pub fn tags_list(conn: &Connection) -> Result<Vec<TagCount>, String> {
    db::list_tags(conn).map_err(|e| e.to_string())
}

/// Notes that carry a specific tag.
pub fn files_by_tag(conn: &Connection, tag: &str) -> Result<Vec<NoteMeta>, String> {
    db::files_by_tag(conn, tag).map_err(|e| e.to_string())
}

/// Backlinks for a note (linked + unlinked mentions), each with a context
/// snippet from the referencing file.
pub fn backlinks(conn: &Connection, root: &Path, path: &str) -> Result<Vec<Backlink>, String> {
    let needle = conn
        .query_row(
            "SELECT title FROM files WHERE path = ?1",
            rusqlite::params![path],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    let mut links = db::backlinks_for(conn, path).map_err(|e| e.to_string())?;
    for b in &mut links {
        if !needle.is_empty() {
            b.snippet = link_service::snippet_for(root, &b.path, &needle);
        }
    }
    Ok(links)
}

/// Lightweight list of all note titles (completion dictionary).
pub fn list_titles(conn: &Connection) -> Result<Vec<String>, String> {
    db::list_titles(conn).map_err(|e| e.to_string())
}

/// Number of indexed files. Much cheaper than list_files() — used by the
/// frontend to decide whether a full refresh is needed.
pub fn count_files(conn: &Connection) -> Result<i64, String> {
    conn.query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
        .map_err(|e| e.to_string())
}

/// Wikilink targets that resolve to no existing note, paginated.
pub fn broken_links(
    conn: &Connection,
    limit: i64,
    offset: i64,
) -> Result<Paged<BrokenLink>, String> {
    let (items, total) = db::broken_links(conn, limit, offset).map_err(|e| e.to_string())?;
    Ok(Paged { items, total })
}

/// Notes that no other note links to, paginated.
pub fn orphan_notes(
    conn: &Connection,
    limit: i64,
    offset: i64,
) -> Result<Paged<OrphanNote>, String> {
    let (items, total) = db::orphan_notes(conn, limit, offset).map_err(|e| e.to_string())?;
    Ok(Paged { items, total })
}

/// Notes sharing at least one tag with the given note ("related by topic").
pub fn related_notes(conn: &Connection, path: &str) -> Result<Vec<RelatedNote>, String> {
    db::related_notes(conn, path).map_err(|e| e.to_string())
}

// ---- Private helpers ----

fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

/// True when all chars of `q` appear in order within `title` (fuzzy match).
pub fn title_subsequence(title: &str, q: &str) -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subsequence_matches_in_order() {
        assert!(title_subsequence("sprint summary", "sp sum"));
        assert!(title_subsequence("client action closure", "cac"));
        assert!(title_subsequence("welcome", "wlcm"));
        assert!(!title_subsequence("welcome", "wlmce"));
        assert!(!title_subsequence("alpha", "xyz"));
        assert!(title_subsequence("alpha", ""));
    }
}
