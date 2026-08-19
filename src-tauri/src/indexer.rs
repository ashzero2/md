//! Vault scanning, file snapshots (mtime/size/hash), and diff-driven
//! reconciliation between disk and the SQLite index (ADR D5).

use crate::db;
use crate::parser::{parse_markdown, ParsedNote};
use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;
use walkdir::WalkDir;

/// Directories ignored at any depth (also all hidden dot-directories).
const IGNORED_DIRS: &[&str] = &[".git", ".obsidian", ".trash", "node_modules", ".DS_Store"];

/// Vault-relative paths of all `.md` files under `root`.
pub fn scan_markdown_files(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            if e.file_type().is_dir() {
                let name = e.file_name().to_string_lossy();
                return !name.starts_with('.') && !IGNORED_DIRS.contains(&name.as_ref());
            }
            true
        })
    {
        let Ok(entry) = entry else { continue };
        if entry.file_type().is_file()
            && entry.path().extension().map(|e| e == "md").unwrap_or(false)
        {
            let rel = entry
                .path()
                .strip_prefix(root)
                .expect("walkdir rooted at vault")
                .to_string_lossy()
                .into_owned();
            out.push(rel);
        }
    }
    out.sort();
    out
}

/// Snapshot for change detection: mtime (unix millis), size, sha256 hex.
pub struct FileSnapshot {
    #[allow(dead_code)] // retained for parity; callers use mtime/size/hash
    pub path: String,
    pub mtime: i64,
    pub size: i64,
    pub hash: String,
}

pub fn snapshot_file(root: &Path, rel_path: &str) -> std::io::Result<FileSnapshot> {
    let full = root.join(rel_path);
    let meta = std::fs::metadata(&full)?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let hash = hash_file(&full)?;
    Ok(FileSnapshot {
        path: rel_path.to_string(),
        mtime,
        size: meta.len() as i64,
        hash,
    })
}

pub fn hash_file(full: &Path) -> std::io::Result<String> {
    let mut hasher = Sha256::new();
    let mut f = std::io::BufReader::new(std::fs::File::open(full)?);
    std::io::copy(&mut f, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
}

/// Parse a file into an index-ready note. Never panics on malformed input:
/// parse errors degrade to an empty note with the filename title.
pub fn parse_file(root: &Path, rel_path: &str) -> ParsedNote {
    let fallback = Path::new(rel_path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| rel_path.to_string());
    match std::fs::read_to_string(root.join(rel_path)) {
        Ok(raw) => parse_markdown(&raw, &fallback),
        Err(_) => ParsedNote {
            title: fallback,
            ..Default::default()
        },
    }
}

/// Directory tree built from vault-relative paths, for the sidebar.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FileNode {
    pub name: String,
    /// Vault-relative path; dirs end without trailing slash, root is "".
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<FileNode>,
}

/// Build a sorted directory tree (dirs first, then files, alphabetical)
/// from sorted vault-relative paths like `{"Welcome.md", "Sprint Plans/x.md"}`.
pub fn build_tree(paths: &[String]) -> Vec<FileNode> {
    fn insert(nodes: &mut Vec<FileNode>, parts: &[&str], full: &str) {
        let name = parts[0];
        if parts.len() == 1 {
            if !nodes.iter().any(|n| n.name == name && !n.is_dir) {
                nodes.push(FileNode {
                    name: name.to_string(),
                    path: full.to_string(),
                    is_dir: false,
                    children: Vec::new(),
                });
            }
            return;
        }
        let dir_full: String = full.split('/').take(parts.len()).collect::<Vec<_>>().join("/");
        match nodes.iter_mut().find(|n| n.name == name && n.is_dir) {
            Some(dir) => insert(&mut dir.children, &parts[1..], full),
            None => {
                let mut dir = FileNode {
                    name: name.to_string(),
                    path: dir_full,
                    is_dir: true,
                    children: Vec::new(),
                };
                insert(&mut dir.children, &parts[1..], full);
                // keep dirs sorted on insert for stable order before sort pass
                nodes.push(dir);
            }
        }
    }

    fn sort_nodes(nodes: &mut Vec<FileNode>) {
        nodes.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir) // dirs first
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        for n in nodes {
            sort_nodes(&mut n.children);
        }
    }

    let mut root: Vec<FileNode> = Vec::new();
    for p in paths {
        let parts: Vec<&str> = p.split('/').collect();
        insert(&mut root, &parts, p);
    }
    sort_nodes(&mut root);
    root
}

/// Full (re)index of the vault: delete + reinsert every `.md` file in one
/// transaction. Used on first open and for explicit repairs.
pub fn rebuild_index(conn: &Connection, root: &Path, progress: Option<&dyn Fn(usize, usize)>) -> Result<usize, String> {
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    let result = (|| -> Result<usize, String> {
        conn.execute_batch(
            "DELETE FROM notes_fts; DELETE FROM sections; DELETE FROM links; DELETE FROM tags; DELETE FROM files;",
        )
        .map_err(|e| e.to_string())?;

        let files = scan_markdown_files(root);
        let total = files.len();
        for (i, rel) in files.iter().enumerate() {
            if let Some(fresh) = read_and_parse(root, rel) {
                db::upsert_note(conn, rel, fresh.0, fresh.1, &fresh.2, &fresh.3)
                    .map_err(|e| e.to_string())?;
            }
            if let Some(cb) = progress {
                if (i + 1) % 100 == 0 || i + 1 == total {
                    cb(i + 1, total);
                }
            }
        }
        Ok(total)
    })();
    match result {
        Ok(total) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            Ok(total)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

fn mtime_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn hash_bytes(bytes: &[u8]) -> String {
    use sha2::Digest;
    let mut h = sha2::Sha256::new();
    h.update(bytes);
    format!("{:x}", h.finalize())
}

fn fallback_for(rel: &str) -> String {
    std::path::Path::new(rel)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| rel.to_string())
}

/// Read a markdown file ONCE, returning (mtime, size, hash, parsed note).
/// Avoids the previous read-twice (hash + parse) behaviour.
fn read_and_parse(root: &Path, rel: &str) -> Option<(i64, i64, String, ParsedNote)> {
    let full = root.join(rel);
    let meta = std::fs::metadata(&full).ok()?;
    let bytes = std::fs::read(&full).ok()?;
    let mtime = mtime_ms(&meta);
    let size = meta.len() as i64;
    let hash = hash_bytes(&bytes);
    let text = String::from_utf8_lossy(&bytes);
    let note = parse_markdown(&text, &fallback_for(rel));
    Some((mtime, size, hash, note))
}

/// Reconcile one file: cheap mtime+size check against the DB first (no
/// hashing/reading when unchanged), else read-once and re-index.
/// Returns true when the index changed.
fn reconcile_rel(conn: &Connection, root: &Path, rel: &str) -> Result<bool, String> {
    let full = root.join(rel);
    match std::fs::metadata(&full) {
        Ok(meta) => {
            let mtime = mtime_ms(&meta);
            let size = meta.len() as i64;
            if let Ok(Some(row)) = db::get_file_snapshot(conn, rel) {
                if row.mtime == mtime && row.size == size {
                    return Ok(false); // unchanged — skip hashing entirely
                }
            }
            let Some(fresh) = read_and_parse(root, rel) else {
                return Ok(false);
            };
            db::upsert_note(conn, rel, fresh.0, fresh.1, &fresh.2, &fresh.3)
                .map_err(|e| e.to_string())?;
            Ok(true)
        }
        Err(_) => {
            let had = db::get_file_snapshot(conn, rel)
                .map(|r| r.is_some())
                .unwrap_or(false);
            if had {
                db::delete_note(conn, rel).map_err(|e| e.to_string())?;
                Ok(true)
            } else {
                Ok(false)
            }
        }
    }
}

/// Index only the files whose snapshot differs from the DB (startup/tickle),
/// wrapped in a single transaction. Returns (indexed, unchanged) counts.
pub fn reconcile_index(
    conn: &Connection,
    root: &Path,
    paths: &[String],
    progress: Option<&dyn Fn(usize, usize)>,
) -> Result<(usize, usize), String> {
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    let result = (|| -> Result<(usize, usize), String> {
        let mut indexed = 0usize;
        let mut unchanged = 0usize;
        for (i, rel) in paths.iter().enumerate() {
            if reconcile_rel(conn, root, rel).map_err(|e| e.to_string())? {
                indexed += 1;
            } else {
                unchanged += 1;
            }
            if let Some(cb) = progress {
                if (i + 1) % 100 == 0 || i + 1 == paths.len() {
                    cb(i + 1, paths.len());
                }
            }
        }
        Ok((indexed, unchanged))
    })();
    match result {
        Ok(v) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            Ok(v)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_schema;
    use std::fs;

    fn fixture_root() -> std::path::PathBuf {
        let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        std::path::Path::new(&manifest).join("tests/fixtures/vaults/basic")
    }

    fn tmp_vault(name: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join(name);
        fs::create_dir_all(&root).unwrap();
        (dir, root)
    }

    #[test]
    fn scans_only_markdown_and_skips_hidden() {
        let (_d, root) = tmp_vault("v");
        fs::create_dir_all(root.join(".obsidian")).unwrap();
        fs::write(root.join("a.md"), "# A").unwrap();
        fs::write(root.join("b.md.txt"), "nope").unwrap();
        fs::write(root.join(".obsidian/c.md"), "# c").unwrap();
        let files = scan_markdown_files(&root);
        assert_eq!(files, vec!["a.md".to_string()]);
    }

    #[test]
    fn scan_is_sorted_and_recursive() {
        let (_d, root) = tmp_vault("v");
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("b.md"), "# B").unwrap();
        fs::write(root.join("sub/a.md"), "# A").unwrap();
        let files = scan_markdown_files(&root);
        // lexicographic sort: "b.md" < "sub/a.md"
        assert_eq!(files, vec!["b.md".to_string(), "sub/a.md".to_string()]);
    }

    #[test]
    fn rebuild_index_indexes_fixture() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let n = rebuild_index(&conn, &fixture_root(), None).unwrap();
        assert!(n >= 3, "fixture vault should have 3+ files, got {n}");
        let notes = db::list_notes(&conn).unwrap();
        assert!(notes.iter().any(|m| m.title.contains("Welcome")));
    }

    #[test]
    fn reconcile_is_incremental() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (_d, root) = tmp_vault("v");
        fs::write(root.join("a.md"), "# A\nhello world").unwrap();
        fs::write(root.join("b.md"), "# B\nstatic").unwrap();
        let all = scan_markdown_files(&root);

        let (indexed, unchanged) = reconcile_index(&conn, &root, &all, None).unwrap();
        assert_eq!(indexed, 2);
        assert_eq!(unchanged, 0);

        // Second pass: nothing changed.
        let (indexed, unchanged) = reconcile_index(&conn, &root, &all, None).unwrap();
        assert_eq!(indexed, 0);
        assert_eq!(unchanged, 2);

        // Modify one file only.
        fs::write(root.join("a.md"), "# A\nhello world 2").unwrap();
        let (indexed, _) = reconcile_index(&conn, &root, &["a.md".to_string()], None).unwrap();
        assert_eq!(indexed, 1);
        // and the other stays untouched
        let b_snap = db::get_file_snapshot(&conn, "b.md").unwrap().unwrap();
        assert_eq!(b_snap.hash.len(), 64);
    }

    #[test]
    fn build_tree_nests_dirs_first_then_files_alphabetically() {
        let paths = vec![
            "b.md".to_string(),
            "a.md".to_string(),
            "Sprint Plans/Client Action Closure.md".to_string(),
            "Sprint Plans/Sub/Deep.md".to_string(),
        ];
        let tree = build_tree(&paths);
        // root: dir "Sprint Plans" first, then files a.md, b.md
        assert_eq!(tree.len(), 3);
        assert!(tree[0].is_dir);
        assert_eq!(tree[0].name, "Sprint Plans");
        assert!(!tree[1].is_dir);
        assert_eq!(tree[1].name, "a.md");
        assert_eq!(tree[1].path, "a.md");
        assert!(!tree[2].is_dir);
        assert_eq!(tree[2].name, "b.md");
        // nested children
        let sp = &tree[0].children;
        assert_eq!(sp.len(), 2); // Sub dir + file
        assert!(sp[0].is_dir && sp[0].name == "Sub");
        assert_eq!(sp[1].name, "Client Action Closure.md");
        assert_eq!(sp[1].path, "Sprint Plans/Client Action Closure.md");
        assert_eq!(sp[0].children[0].name, "Deep.md");
    }

    /// Large-vault performance smoke (run explicitly with -- --ignored).
    /// Generates N files, full index, then incremental reconcile of one change.
    #[test]
    #[ignore = "large vault generation; run explicitly"]
    fn large_vault_indexes_quickly() {
        const N: usize = 5_000;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("big");
        std::fs::create_dir_all(&root).unwrap();
        for i in 0..N {
            let sub = root.join(format!("d{}", i % 20));
            std::fs::create_dir_all(&sub).unwrap();
            std::fs::write(
                sub.join(format!("note-{i}.md")),
                format!(
                    "---\ntitle: Note {i}\ntags: [t{}]\n---\n# Note {i}\n\nContains word-{} and links [[Note {}]] and [[Sprint Summary]].\n",
                    i % 10,
                    i,
                    (i + 1) % N
                ),
            )
            .unwrap();
        }

        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let t0 = std::time::Instant::now();
        let n = rebuild_index(&conn, &root, None).unwrap();
        let full_ms = t0.elapsed().as_millis();
        assert_eq!(n, N);

        // Incremental: modify one file, reconcile just it.
        std::fs::write(
            root.join("d0/note-0.md"),
            "# Note 0\n\nnow has a brand new word zzzzz\n",
        )
        .unwrap();
        let t1 = std::time::Instant::now();
        let (indexed, _) = reconcile_index(&conn, &root, &["d0/note-0.md".to_string()], None).unwrap();
        let inc_ms = t1.elapsed().as_millis();
        assert_eq!(indexed, 1);
        assert!(!db::search_notes(&conn, "zzzzz", 10).unwrap().is_empty());

        println!("large_vault: {N} files full index {full_ms}ms, single-file reconcile {inc_ms}ms");
        assert!(full_ms < 30_000, "full index too slow: {full_ms}ms");
        assert!(inc_ms < 500, "incremental too slow: {inc_ms}ms");
    }

    #[test]
    fn delete_file_removes_all_index_rows() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (_d, root) = tmp_vault("v");
        fs::write(root.join("a.md"), "# A\ngone soon").unwrap();
        reconcile_index(&conn, &root, &["a.md".to_string()], None).unwrap();
        fs::remove_file(root.join("a.md")).unwrap();
        let (indexed, _) = reconcile_index(&conn, &root, &["a.md".to_string()], None).unwrap();
        assert_eq!(indexed, 1, "deletion counts as a change");
        assert!(db::list_notes(&conn).unwrap().is_empty());
    }

    /// Scale benchmark: cold (full via empty-DB reconcile) vs warm (unchanged,
    /// no-hash) for 100 / 1,000 / 5,000 files. Run explicitly.
    #[test]
    #[ignore = "benchmark; run with -- --ignored --nocapture"]
    fn bench_scale() {
        for &n in &[100usize, 1_000, 5_000] {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path().join("bench");
            std::fs::create_dir_all(&root).unwrap();
            for i in 0..n {
                let sub = root.join(format!("d{}", i % 25));
                std::fs::create_dir_all(&sub).unwrap();
                // rich note: frontmatter, tags, headings, code fence, wikilinks
                let body = if i % 100 == 0 {
                    // a few large notes
                    format!(
                        "---\ntitle: Big {i}\ntags: [bench, big]\n---\n# Big {i}\n\n{}",
                        "paragraphs of text with **bold** and *italic* and `code` and [[Other]] links.\n\n"
                            .repeat(200)
                    )
                } else if i % 10 == 0 {
                    // graph-heavy: many links
                    let links: String =
                        (1..20).map(|j| format!("[[Note {}]]\n", (i + j) % n)).collect();
                    format!("---\ntitle: Hub {i}\ntags: [bench, hub]\n---\n# Hub {i}\n\n{links}")
                } else {
                    format!(
                        "---\ntitle: Note {i}\ntags: [t{}]\n---\n# Note {i}\n\nContent word-{i} with [[Note {}]].\n\n```text\ncode block {i}\n```\n",
                        i % 10,
                        (i + 1) % n
                    )
                };
                std::fs::write(sub.join(format!("note-{i}.md")), body).unwrap();
            }
            let files = scan_markdown_files(&root);
            assert_eq!(files.len(), n);

            let conn = Connection::open_in_memory().unwrap();
            init_schema(&conn).unwrap();

            let t0 = std::time::Instant::now();
            let (idx0, _) = reconcile_index(&conn, &root, &files, None).unwrap();
            let cold = t0.elapsed().as_millis();
            assert_eq!(idx0, n);

            let t1 = std::time::Instant::now();
            let (idx1, unc1) = reconcile_index(&conn, &root, &files, None).unwrap();
            let warm = t1.elapsed().as_millis();
            assert_eq!(idx1, 0, "warm open must not re-index unchanged files");
            assert_eq!(unc1, n);

            println!("vault={n:<5} cold={cold:>4}ms warm={warm:>4}ms (indexed 0 / unchanged {unc1})");
        }
    }
}