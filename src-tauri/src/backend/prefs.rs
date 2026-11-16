//! Shell-side preferences the Tauri process must read AT EXIT without the
//! backend being alive (settings toggle "Unload models when closing").
//!
//! Stored as a tiny JSON file next to the backend's other per-user config
//! (`%APPDATA%\OpenCohost\config\shell_prefs.json`). Missing, unreadable or
//! malformed files mean the defaults, so a broken file can never leave models
//! resident by accident: `unload_models_on_exit` defaults to `true`.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShellPrefs {
    #[serde(default = "default_unload")]
    pub unload_models_on_exit: bool,
}

fn default_unload() -> bool {
    true
}

impl Default for ShellPrefs {
    fn default() -> Self {
        Self {
            unload_models_on_exit: true,
        }
    }
}

pub fn parse_prefs(contents: &str) -> ShellPrefs {
    serde_json::from_str(contents).unwrap_or_default()
}

pub fn render_prefs(prefs: &ShellPrefs) -> String {
    serde_json::to_string_pretty(prefs).unwrap_or_else(|_| "{}".into())
}

pub fn prefs_file_path(appdata: Option<&str>, userprofile: Option<&str>) -> PathBuf {
    let base = appdata
        .map(PathBuf::from)
        .or_else(|| userprofile.map(|home| Path::new(home).join("AppData").join("Roaming")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("OpenCohost")
        .join("config")
        .join("shell_prefs.json")
}

pub fn resolve_prefs_path() -> PathBuf {
    prefs_file_path(
        std::env::var("APPDATA").ok().as_deref(),
        std::env::var("USERPROFILE").ok().as_deref(),
    )
}

pub fn load_prefs_from(path: &Path) -> ShellPrefs {
    fs::read_to_string(path)
        .map(|contents| parse_prefs(&contents))
        .unwrap_or_default()
}

pub fn save_prefs_to(path: &Path, prefs: &ShellPrefs) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, render_prefs(prefs)).map_err(|error| error.to_string())
}

pub fn load_prefs() -> ShellPrefs {
    load_prefs_from(&resolve_prefs_path())
}

pub fn unload_models_on_exit() -> bool {
    load_prefs().unload_models_on_exit
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("oc_prefs_{name}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("config").join("shell_prefs.json")
    }

    #[test]
    fn defaults_to_unloading_when_missing_or_garbage() {
        assert!(parse_prefs("").unload_models_on_exit);
        assert!(parse_prefs("not json").unload_models_on_exit);
        assert!(parse_prefs("{}").unload_models_on_exit);
        assert!(load_prefs_from(Path::new("Z:/definitely/missing.json")).unload_models_on_exit);
    }

    #[test]
    fn parses_an_explicit_opt_out() {
        assert!(!parse_prefs(r#"{"unload_models_on_exit":false}"#).unload_models_on_exit);
    }

    #[test]
    fn save_then_load_round_trips_and_creates_parent_dirs() {
        let path = temp_file("roundtrip");
        save_prefs_to(
            &path,
            &ShellPrefs {
                unload_models_on_exit: false,
            },
        )
        .unwrap();
        assert!(!load_prefs_from(&path).unload_models_on_exit);
        save_prefs_to(
            &path,
            &ShellPrefs {
                unload_models_on_exit: true,
            },
        )
        .unwrap();
        assert!(load_prefs_from(&path).unload_models_on_exit);
        let _ = fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn path_lives_under_opencohost_config() {
        let p = prefs_file_path(Some("C:/Users/x/AppData/Roaming"), None);
        assert!(p.ends_with("OpenCohost/config/shell_prefs.json"));
        let q = prefs_file_path(None, Some("C:/Users/x"));
        assert!(q.to_string_lossy().contains("AppData"));
    }
}
