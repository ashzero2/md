//! Vault-relative path validation: defense against path traversal from the
//! frontend. All note commands that accept user-supplied paths must go through
//! one of these helpers before touching the filesystem.

use std::path::{Path, PathBuf};

/// Join a vault-relative path to the root and verify it stays inside the
/// vault. Requires the path to already exist on disk (uses `canonicalize`).
/// Use for reading, deleting, and revealing existing notes.
pub fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let candidate = root.join(rel).canonicalize().map_err(|e| e.to_string())?;
    let root_canon = root.canonicalize().map_err(|e| e.to_string())?;
    if candidate.starts_with(&root_canon) {
        Ok(candidate)
    } else {
        Err(format!("path escapes the vault: {rel}"))
    }
}

/// Like `safe_join`, but works for paths that do not yet exist (rename/create
/// targets). Rejects `..` components and absolute paths without relying on
/// `canonicalize()`. Use for rename destinations and new note paths.
pub fn safe_join_lenient(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if Path::new(rel).is_absolute() {
        return Err(format!("path escapes the vault: {rel}"));
    }
    let root_canon = root.canonicalize().map_err(|e| e.to_string())?;
    let mut check = root_canon.clone();
    for component in Path::new(rel).components() {
        match component {
            std::path::Component::Normal(p) => check.push(p),
            _ => return Err(format!("path escapes the vault: {rel}")),
        }
    }
    if !check.starts_with(&root_canon) {
        return Err(format!("path escapes the vault: {rel}"));
    }
    Ok(root.join(rel))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_join_blocks_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        assert!(safe_join(root, "../outside.md").is_err());
        assert!(safe_join(root, "/etc/passwd").is_err());

        assert!(safe_join_lenient(root, "../outside.md").is_err());
        assert!(safe_join_lenient(root, "/etc/passwd").is_err());
        assert!(safe_join_lenient(root, "../../etc/passwd").is_err());

        assert!(safe_join_lenient(root, "Projects/New Note.md").is_ok());
        assert!(safe_join_lenient(root, "note.md").is_ok());
    }

    #[test]
    fn safe_join_allows_existing_paths() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("note.md"), "# Hello").unwrap();

        let result = safe_join(root, "note.md");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), root.canonicalize().unwrap().join("note.md"));
    }
}
