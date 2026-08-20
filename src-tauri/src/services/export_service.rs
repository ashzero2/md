//! Export services: HTML file export and browser preview.
//!
//! These functions have no Tauri dependencies except for the `open_path`
//! callback in `html_preview`, which is injected by the command layer.

use std::path::{Path, PathBuf};

/// Write arbitrary text to an absolute path. Used for HTML export via a
/// user-chosen save dialog — the path may be anywhere on disk.
pub fn write_text_file(path: &str, content: &str) -> Result<(), String> {
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err("path must be absolute".to_string());
    }
    crate::storage::atomic_write(&p, content).map_err(|e| e.to_string())
}

/// Write HTML to the exports directory and open it via the provided callback.
/// Returns the path of the written file.
///
/// The `open` callback is injected by the command layer so this function
/// stays free of Tauri dependencies.
pub fn html_preview(
    exports_dir: &Path,
    content: &str,
    title: &str,
    open: impl FnOnce(&str) -> Result<(), String>,
) -> Result<String, String> {
    std::fs::create_dir_all(exports_dir).map_err(|e| e.to_string())?;
    let name = if title.trim().is_empty() {
        "preview".to_string()
    } else {
        title.trim().to_string()
    };
    let file = exports_dir.join(format!("{}.html", crate::services::note_service::sanitize_filename(&name)));
    crate::storage::atomic_write(&file, content).map_err(|e| e.to_string())?;
    let path_str = file.to_string_lossy().into_owned();
    open(&path_str)?;
    Ok(path_str)
}
