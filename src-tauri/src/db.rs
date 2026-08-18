//! SQLite index storage: schema, per-file upsert/delete, search.
//!
//! The database is a *derived cache* (ADR D2): everything here can be
//! rebuilt from the vault files. The DB lives in the app-data directory,
//! never inside the vault.

use crate::parser::ParsedNote;
use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::Serialize;

pub fn init_schema(conn: &Connection) -> Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS files (
            id          INTEGER PRIMARY KEY,
            path        TEXT UNIQUE NOT NULL,   -- relative to vault root
            title       TEXT NOT NULL,
            mtime       INTEGER NOT NULL,       -- unix millis
            size        INTEGER NOT NULL,
            hash        TEXT NOT NULL,          -- sha256 hex of content
            frontmatter TEXT                    -- JSON string or NULL
        );
        CREATE TABLE IF NOT EXISTS sections (
            file_id INTEGER NOT NULL,
            heading TEXT NOT NULL,
            level   INTEGER NOT NULL,
            pos     INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS links (
            source_id INTEGER NOT NULL,
            target    TEXT NOT NULL,
            heading   TEXT,
            alias     TEXT,
            pos       INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tags (
            file_id INTEGER NOT NULL,
            tag     TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            title, body, tokenize = 'unicode61'
        );
        CREATE INDEX IF NOT EXISTS idx_sections_file ON sections(file_id);
        CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id);
        CREATE INDEX IF NOT EXISTS idx_links_target ON links(target);
        CREATE INDEX IF NOT EXISTS idx_tags_file ON tags(file_id);
        CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
        "#,
    )?;
    Ok(())
}

/// A stored file row (as returned to the frontend).
#[derive(Debug, Clone, Serialize)]
pub struct NoteMeta {
    pub path: String,
    pub title: String,
    pub tags: Vec<String>,
}

pub struct FileRow {
    pub id: i64,
    pub mtime: i64,
    pub size: i64,
    pub hash: String,
}

/// Fetch the recorded snapshot for `path` (for change detection).
pub fn get_file_snapshot(conn: &Connection, path: &str) -> Result<Option<FileRow>> {
    conn.query_row(
        "SELECT id, mtime, size, hash FROM files WHERE path = ?1",
        params![path],
        |row| {
            Ok(FileRow {
                id: row.get(0)?,
                mtime: row.get(1)?,
                size: row.get(2)?,
                hash: row.get(3)?,
            })
        },
    )
    .optional()
}

/// Insert or replace the index rows for one parsed note.
/// `path` is the vault-relative path, `meta` the on-disk snapshot.
pub fn upsert_note(
    conn: &Connection,
    path: &str,
    mtime: i64,
    size: i64,
    hash: &str,
    note: &ParsedNote,
) -> Result<i64> {
    delete_note(conn, path)?;

    let frontmatter_json = if note.frontmatter.is_empty() {
        None
    } else {
        let map: std::collections::BTreeMap<&str, &str> = note
            .frontmatter
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        serde_json::to_string(&map).ok()
    };

    conn.execute(
        "INSERT INTO files (path, title, mtime, size, hash, frontmatter)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![path, note.title, mtime, size, hash, frontmatter_json],
    )?;
    let file_id = conn.last_insert_rowid();

    {
        let mut stmt = conn.prepare(
            "INSERT INTO sections (file_id, heading, level, pos) VALUES (?1, ?2, ?3, ?4)",
        )?;
        for h in &note.headings {
            stmt.execute(params![file_id, h.text, h.level, h.pos as i64])?;
        }
    }
    {
        let mut stmt = conn.prepare(
            "INSERT INTO links (source_id, target, heading, alias, pos) VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        for l in &note.wikilinks {
            stmt.execute(params![
                file_id,
                l.target,
                l.heading,
                l.alias,
                l.pos as i64
            ])?;
        }
    }
    {
        let mut stmt = conn.prepare("INSERT INTO tags (file_id, tag) VALUES (?1, ?2)")?;
        for t in &note.tags {
            stmt.execute(params![file_id, t])?;
        }
    }

    conn.execute(
        "INSERT INTO notes_fts (rowid, title, body) VALUES (?1, ?2, ?3)",
        params![file_id, note.title, note.body],
    )?;

    Ok(file_id)
}

/// Remove all index rows for `path` (file row + children + FTS).
pub fn delete_note(conn: &Connection, path: &str) -> Result<()> {
    let Some(row) = get_file_snapshot(conn, path)? else {
        return Ok(());
    };
    conn.execute("DELETE FROM notes_fts WHERE rowid = ?1", params![row.id])?;
    conn.execute("DELETE FROM sections WHERE file_id = ?1", params![row.id])?;
    conn.execute("DELETE FROM links WHERE source_id = ?1", params![row.id])?;
    conn.execute("DELETE FROM tags WHERE file_id = ?1", params![row.id])?;
    conn.execute("DELETE FROM files WHERE id = ?1", params![row.id])?;
    Ok(())
}

/// All indexed notes, ordered by title (frontend list).
pub fn list_notes(conn: &Connection) -> Result<Vec<NoteMeta>> {
    let mut stmt = conn.prepare(
        "SELECT f.path, f.title,
                COALESCE((SELECT GROUP_CONCAT(tag, ',') FROM tags WHERE file_id = f.id), '')
         FROM files f ORDER BY f.title COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |row| {
        let tags_raw: String = row.get(2)?;
        let tags = if tags_raw.is_empty() {
            Vec::new()
        } else {
            tags_raw.split(',').map(|s| s.to_string()).collect()
        };
        Ok(NoteMeta {
            path: row.get(0)?,
            title: row.get(1)?,
            tags,
        })
    })?;
    rows.collect()
}

/// All indexed note paths (used to diff disk vs index on directory events).
pub fn list_indexed_paths(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT path FROM files")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect()
}

/// Vault-relative paths of files whose parsed links target `target`
/// (case-insensitive).
pub fn link_sources(conn: &Connection, target: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT f.path FROM links l
         JOIN files f ON f.id = l.source_id
         WHERE LOWER(l.target) = LOWER(?1)",
    )?;
    let rows = stmt.query_map(params![target], |row| row.get::<_, String>(0))?;
    rows.collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct TagCount {
    pub tag: String,
    pub count: i64,
}

/// All tags with occurrence counts, alphabetical.
pub fn list_tags(conn: &Connection) -> Result<Vec<TagCount>> {
    let mut stmt = conn.prepare(
        "SELECT tag, COUNT(*) AS c FROM tags GROUP BY tag ORDER BY tag COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(TagCount {
            tag: row.get(0)?,
            count: row.get(1)?,
        })
    })?;
    rows.collect()
}

/// Notes carrying a given tag.
pub fn files_by_tag(conn: &Connection, tag: &str) -> Result<Vec<NoteMeta>> {
    let mut stmt = conn.prepare(
        "SELECT f.path, f.title, '' FROM files f
         JOIN tags t ON t.file_id = f.id
         WHERE t.tag = ?1
         ORDER BY f.title COLLATE NOCASE",
    )?;
    let rows = stmt.query_map(params![tag], |row| {
        Ok(NoteMeta {
            path: row.get(0)?,
            title: row.get(1)?,
            tags: Vec::new(),
        })
    })?;
    rows.collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct Backlink {
    pub path: String,
    pub title: String,
    /// true = explicit `[[link]]`, false = plain text mention of the title.
    pub linked: bool,
}

/// Backlinks for a note: files with an explicit `[[link]]` to it, then files
/// whose body mentions its title as plain text (excluding linked ones).
pub fn backlinks_for(conn: &Connection, path: &str) -> Result<Vec<Backlink>> {
    let title: Option<String> = conn
        .query_row(
            "SELECT title FROM files WHERE path = ?1",
            params![path],
            |row| row.get(0),
        )
        .optional()?;
    let Some(title) = title else {
        return Ok(Vec::new());
    };

    // Explicit links: targets match the title or the path as written.
    let mut linked: Vec<Backlink> = {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT f.path, f.title FROM links l
             JOIN files f ON f.id = l.source_id
             WHERE l.target = ?1 OR l.target = ?2
             ORDER BY f.title COLLATE NOCASE",
        )?;
        let rows = stmt.query_map(params![title, path], |row| {
            Ok(Backlink {
                path: row.get(0)?,
                title: row.get(1)?,
                linked: true,
            })
        })?;
        rows.collect::<Result<Vec<_>>>()?
    };
    let linked_paths: std::collections::HashSet<String> =
        linked.iter().map(|b| b.path.clone()).collect();

    // Unlinked mentions: body text contains the title (LIKE over the FTS
    // content column; escaped). Excludes the note itself and linked notes.
    let pattern = format!("%{}%", escape_like(&title));
    let mut stmt = conn.prepare(
        "SELECT f.path, f.title FROM files f
         JOIN notes_fts n ON n.rowid = f.id
         WHERE n.body LIKE ?1 ESCAPE '\\'
           AND f.path != ?2
         ORDER BY f.title COLLATE NOCASE
         LIMIT 100",
    )?;
    let rows = stmt.query_map(params![pattern, path], |row| {
        Ok(Backlink {
            path: row.get(0)?,
            title: row.get(1)?,
            linked: false,
        })
    })?;
    let unlinked: Vec<Backlink> = rows
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .filter(|b| !linked_paths.contains(&b.path))
        .collect();

    linked.extend(unlinked);
    Ok(linked)
}

/// Escape `%`, `_`, `\` for use inside a LIKE ... ESCAPE '\\' pattern.
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// Full-text search with BM25 ranking and a snippet around the first match.
pub fn search_notes(conn: &Connection, query: &str, limit: i64) -> Result<Vec<SearchResult>> {
    let fts_query = fts_query_from_user(query);
    if fts_query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        "SELECT f.path, f.title, snippet(notes_fts, 1, '\u{0001}', '\u{0002}', '\u{2026}', 12),
                bm25(notes_fts)
         FROM notes_fts JOIN files f ON f.id = notes_fts.rowid
         WHERE notes_fts MATCH ?1
         ORDER BY bm25(notes_fts)
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![fts_query, limit], |row| {
        Ok(SearchResult {
            path: row.get(0)?,
            title: row.get(1)?,
            snippet: row.get(2)?,
            score: row.get(3)?,
        })
    })?;
    rows.collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub path: String,
    pub title: String,
    pub snippet: String,
    pub score: f64,
}

/// Build a safe FTS5 MATCH expression from free-text user input:
/// each whitespace-separated token becomes a quoted prefix term (ANDed),
/// so `hello world` finds docs containing both `hello*` and `world*`.
fn fts_query_from_user(query: &str) -> String {
    let tokens: Vec<String> = query
        .split_whitespace()
        .filter_map(|tok| {
            let clean: String = tok
                .chars()
                .filter(|c| !matches!(c, '"' | ':' | '*' | '(' | ')' | '^' | '-'))
                .collect();
            if clean.is_empty() {
                None
            } else {
                Some(format!("\"{}\"*", clean))
            }
        })
        .collect();
    tokens.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::parse_markdown;

    fn mem_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        conn
    }

    fn index(conn: &Connection, path: &str, raw: &str) -> i64 {
        let fallback = path.rsplit('/').next().unwrap().trim_end_matches(".md");
        let note = parse_markdown(raw, fallback);
        upsert_note(conn, path, 1, raw.len() as i64, "h", &note).unwrap()
    }

    #[test]
    fn schema_creates_tables() {
        let conn = mem_conn();
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN
                 ('files','sections','links','tags','notes_fts')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 5);
    }

    #[test]
    fn upsert_then_list_returns_meta() {
        let conn = mem_conn();
        index(&conn, "a.md", "# Alpha\nsome content");
        index(&conn, "b.md", "---\ntags: [x]\n---\n# Beta");
        let notes = list_notes(&conn).unwrap();
        assert_eq!(notes.len(), 2);
        let beta = notes.iter().find(|n| n.title == "Beta").unwrap();
        assert_eq!(beta.tags, vec!["x".to_string()]);
    }

    #[test]
    fn upsert_replaces_existing_rows() {
        let conn = mem_conn();
        index(&conn, "a.md", "# One\nold");
        index(&conn, "a.md", "# One\nnew content cosmo");
        let notes = list_notes(&conn).unwrap();
        assert_eq!(notes.len(), 1);
        let results = search_notes(&conn, "cosmo", 10).unwrap();
        assert_eq!(results.len(), 1);
        // stale FTS row must be gone
        let stale = search_notes(&conn, "old", 10).unwrap();
        assert!(stale.is_empty());
    }

    #[test]
    fn delete_removes_everything() {
        let conn = mem_conn();
        index(&conn, "a.md", "# A\nunique word zzz");
        delete_note(&conn, "a.md").unwrap();
        assert!(list_notes(&conn).unwrap().is_empty());
        assert!(search_notes(&conn, "zzz", 10).unwrap().is_empty());
    }

    #[test]
    fn search_ranks_and_snippets() {
        let conn = mem_conn();
        index(&conn, "a.md", "# Longer\nchemist the molecule of life");
        index(&conn, "b.md", "# Short\nmolecule here");
        let results = search_notes(&conn, "molecule", 10).unwrap();
        assert_eq!(results.len(), 2);
        // b has one mention, a has one: both match; snippet must contain text
        assert!(results.iter().all(|r| !r.snippet.is_empty()));
        // prefix query finds both
        let prefix = search_notes(&conn, "molec", 10).unwrap();
        assert_eq!(prefix.len(), 2);
    }

    #[test]
    fn search_handles_special_chars_gracefully() {
        let conn = mem_conn();
        index(&conn, "a.md", "# A\nplain text");
        // quotes/colons/dashes must not error
        let results = search_notes(&conn, "\"quoted: -dash\"", 10).unwrap();
        assert!(results.is_empty());
        let results = search_notes(&conn, "", 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn fts_query_builds_safe_prefix_terms() {
        assert_eq!(
            fts_query_from_user("hello world"),
            "\"hello\"* \"world\"*"
        );
        assert_eq!(fts_query_from_user("\"x\": y"), "\"x\"* \"y\"*");
        assert_eq!(fts_query_from_user("   "), "");
    }

    #[test]
    fn tags_list_counts_and_sorts() {
        let conn = mem_conn();
        index(&conn, "a.md", "---\ntags: [x, y]\n---\n# A");
        index(&conn, "b.md", "---\ntags: [x]\n---\n# B");
        let tags = list_tags(&conn).unwrap();
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0].tag, "x");
        assert_eq!(tags[0].count, 2);
        assert_eq!(tags[1].tag, "y");
        assert_eq!(tags[1].count, 1);
    }

    #[test]
    fn files_by_tag_returns_matching_notes() {
        let conn = mem_conn();
        index(&conn, "a.md", "---\ntags: [x]\n---\n# Alpha");
        index(&conn, "b.md", "---\ntags: [y]\n---\n# Beta");
        let files = files_by_tag(&conn, "x").unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].title, "Alpha");
    }

    #[test]
    fn backlinks_finds_linked_and_unlinked_mentions() {
        let conn = mem_conn();
        index(&conn, "a.md", "# Alpha\nsome body text");
        index(&conn, "b.md", "# Beta\nsee [[Alpha]] here");
        index(&conn, "c.md", "# Gamma\nmentioning Alpha in plain text");
        index(&conn, "a-self.md", "# A self note\nunrelated content"); // title differs, no 'Alpha' text

        let links = backlinks_for(&conn, "a.md").unwrap();
        let linked: Vec<_> = links.iter().filter(|b| b.linked).collect();
        let unlinked: Vec<_> = links.iter().filter(|b| !b.linked).collect();
        assert_eq!(linked.len(), 1);
        assert_eq!(linked[0].title, "Beta");
        assert_eq!(unlinked.len(), 1);
        assert_eq!(unlinked[0].title, "Gamma");
        // self is not a backlink
        assert!(!links.iter().any(|b| b.path == "a.md"));
    }

    #[test]
    fn backlinks_for_unknown_note_is_empty() {
        let conn = mem_conn();
        assert!(backlinks_for(&conn, "missing.md").unwrap().is_empty());
    }

    #[test]
    fn escape_like_handles_wildcards() {
        assert_eq!(escape_like("50%"), "50\\%");
        assert_eq!(escape_like("a_b"), "a\\_b");
        assert_eq!(escape_like("back\\slash"), "back\\\\slash");
    }
}