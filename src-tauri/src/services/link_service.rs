//! Link rewriting and backlink snippet services.
//!
//! Contains all logic for updating wikilink references across the vault when a
//! note is renamed or moved, and for extracting context snippets from files.

use crate::db;
use crate::indexer;
use crate::vault_path::safe_join;
use regex::Regex;
use rusqlite::Connection;
use std::collections::HashSet;
use std::path::Path;

/// Re-index a vault-relative path: snapshot + parse the file and upsert into
/// the DB. If the file no longer exists, removes the DB row instead.
pub fn reindex_rel(conn: &Connection, root: &Path, rel: &str) -> Result<(), String> {
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
/// one of `olds` (case-insensitive) to `new`, across every file that
/// references it. Returns the number of files updated.
pub fn rewrite_references(
    conn: &Connection,
    root: &Path,
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
        let full = match safe_join(root, &rel) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let Ok(content) = std::fs::read_to_string(&full) else {
            continue;
        };
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

/// Return the first line of a file that contains `needle` (case-insensitive),
/// trimmed to 140 chars. Streams line-by-line for bounded memory usage.
pub fn snippet_for(root: &Path, rel: &str, needle: &str) -> String {
    use std::io::BufRead;
    let path = match safe_join(root, rel) {
        Ok(p) => p,
        Err(_) => return String::new(),
    };
    let Ok(file) = std::fs::File::open(path) else {
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

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

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
