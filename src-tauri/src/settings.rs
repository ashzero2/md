//! App settings — persisted as JSON in app-data (never inside the vault).
//! Thin by design: only settings that remove workflow friction. Defaults
//! always reproduce the pre-settings behavior.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Settings {
    /// Reopen the last used vault on launch.
    pub reopen_last_vault: bool,
    /// Ask for confirmation before deleting a note.
    pub confirm_before_delete: bool,
    /// Where new notes are created: "root" | "same_folder".
    pub default_new_note_location: String,
    /// Autosave debounce in milliseconds.
    pub autosave_delay_ms: u64,
    /// "system" | "light" | "dark".
    pub theme: String,
    /// Internal: last opened vault path (persisted by open_vault).
    pub last_vault: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            reopen_last_vault: false,
            confirm_before_delete: true,
            default_new_note_location: "root".to_string(),
            autosave_delay_ms: 600,
            theme: "system".to_string(),
            last_vault: None,
        }
    }
}

impl Settings {
    /// Coerce user-supplied values into the allowed set (integrity on save).
    pub fn sanitize(&mut self) {
        if !matches!(self.theme.as_str(), "system" | "light" | "dark") {
            self.theme = "system".to_string();
        }
        if !matches!(self.default_new_note_location.as_str(), "root" | "same_folder") {
            self.default_new_note_location = "root".to_string();
        }
        if !matches!(self.autosave_delay_ms, 300 | 600 | 1000) {
            self.autosave_delay_ms = 600;
        }
    }
}

pub fn settings_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("settings.json")
}

pub fn load(path: &Path) -> Settings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    crate::storage::atomic_write(path, &json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_loads_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let s = load(&dir.path().join("settings.json"));
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut s = Settings::default();
        s.theme = "dark".to_string();
        s.autosave_delay_ms = 1000;
        save(&path, &s).unwrap();
        assert_eq!(load(&path), s);
    }

    #[test]
    fn sanitize_coerces_invalid_values() {
        let mut s = Settings {
            theme: "neon".to_string(),
            default_new_note_location: "elsewhere".to_string(),
            autosave_delay_ms: 42,
            ..Default::default()
        };
        s.sanitize();
        assert_eq!(s.theme, "system");
        assert_eq!(s.default_new_note_location, "root");
        assert_eq!(s.autosave_delay_ms, 600);
    }

    #[test]
    fn partially_missing_json_uses_defaults_per_field() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"theme":"light"}"#).unwrap();
        let s = load(&path);
        assert_eq!(s.theme, "light");
        assert_eq!(s.reopen_last_vault, false);
        assert_eq!(s.autosave_delay_ms, 600);
    }
}