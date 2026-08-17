//! Atomic file writes: write to a temp sibling file, fsync, then rename
//! over the target. Readers (our own watcher, external editors) never see
//! partially-written content (ADR D5).

use std::path::{Path, PathBuf};
use uuid::Uuid;

/// Atomically replace `path` with `content`. Creates parent dirs if missing.
pub fn atomic_write(path: &Path, content: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let tmp: PathBuf = path.with_extension(format!(
        "{}.tmp-{}",
        path.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default(),
        Uuid::new_v4()
    ));
    write_and_fsync(&tmp, content)?;
    std::fs::rename(&tmp, path)
}

fn write_and_fsync(path: &Path, content: &str) -> std::io::Result<()> {
    let mut f = std::fs::File::create(path)?;
    std::io::Write::write_all(&mut f, content.as_bytes())?;
    f.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn writes_content_and_leaves_no_temp_files() {
        let dir = tmp_dir();
        let target = dir.path().join("note.md");
        atomic_write(&target, "# Hello\nworld").unwrap();
        assert_eq!(
            fs::read_to_string(&target).unwrap(),
            "# Hello\nworld"
        );
        // no leftover temp files
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "temp files must be cleaned up");
    }

    #[test]
    fn overwrites_existing_cleanly() {
        let dir = tmp_dir();
        let target = dir.path().join("note.md");
        atomic_write(&target, "version 1").unwrap();
        atomic_write(&target, "version 2").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "version 2");
    }

    #[test]
    fn creates_missing_parent_directories() {
        let dir = tmp_dir();
        let target = dir.path().join("deep/nested/folder/note.md");
        atomic_write(&target, "nested").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "nested");
    }
}