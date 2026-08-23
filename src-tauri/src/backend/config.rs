use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(all(not(debug_assertions), windows))]
use crate::platform::WindowsRegistryHandoff;
#[cfg(not(debug_assertions))]
use crate::runtime::{launch_config, LaunchMode, RuntimeLocator, RuntimeManifest};

pub fn default_app_module() -> String {
    "opencohost.api.main:app".to_string()
}

pub fn default_port() -> u16 {
    8765
}

pub fn default_fallback_port() -> u16 {
    8770
}

pub fn default_spawn() -> bool {
    true
}

/// Resolved from JSON — see `BackendConfig::load` for the file resolution
/// order. Missing optional fields fall back to the `run-api.bat` defaults.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BackendConfig {
    pub python_path: String,
    pub working_dir: String,
    #[serde(default = "default_app_module")]
    pub app_module: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_fallback_port")]
    pub fallback_port: u16,
    #[serde(default = "default_spawn")]
    pub spawn: bool,
    #[serde(default)]
    pub log_file: Option<String>,
    #[serde(default)]
    pub data_root: Option<PathBuf>,
}

/// Compiled-in fallback — this crate's tracked `backend.config.default.json`,
/// baked in at compile time via `include_str!` so a build always has a
/// working, portable config even with no external file present. Deliberately
/// NOT `backend.config.json`: that filename stays gitignored so each
/// developer's real `python_path`/`working_dir` never gets committed or
/// clobbered by this portable default. Override it with
/// `OPENCOHOST_BACKEND_CONFIG` — see `load()` below.
pub const DEV_DEFAULT_CONFIG_JSON: &str = include_str!("../../backend.config.default.json");

/// Dev builds only: this crate's own gitignored `backend.config.json`, where a
/// developer keeps their real interpreter and repo paths.
/// `env!("CARGO_MANIFEST_DIR")` is resolved at compile time, so this bakes in a
/// *path* to the machine that built the binary — never the file's contents, and
/// never anything that survives into a release build (`debug_assertions` is off
/// there). The development source candidate remains explicit because the
/// editable backend config is intentionally not bundled.
#[cfg(debug_assertions)]
pub const DEV_SOURCE_CONFIG_PATH: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/backend.config.json");

impl BackendConfig {
    pub fn from_json(contents: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(contents)
    }

    /// Resolution order:
    /// (a) `OPENCOHOST_BACKEND_CONFIG` env var — path to a JSON file. This is
    ///     how a developer with a real local `backend.config.json` (gitignored,
    ///     never committed) points the app at their own python_path/working_dir.
    /// (b) DEV BUILDS ONLY: this crate's source-tree `backend.config.json`
    ///     (`DEV_SOURCE_CONFIG_PATH`). Deliberately ahead of (c) so a developer's
    ///     real config cannot be shadowed by a portable exe-adjacent file.
    /// (c) `backend.config.json` next to the running exe or in its `resources/`
    ///     subfolder when a developer supplies that file explicitly. The
    ///     installed release path never uses this fallback.
    /// (d) the compiled-in default (this crate's tracked
    ///     backend.config.default.json) — same portable values as (c), used
    ///     only if no file is found next to the exe at all.
    ///
    /// This resolves WHICH config to load — it does not resolve `working_dir`
    /// itself. That field means different things depending on whether it's
    /// absolute or relative; see `resolved_working_dir()` for the rule (a
    /// relative value like the shipped default's `".."` is walked from the
    /// exe location to the real backend root, NOT interpreted against
    /// whatever the calling process's current directory happens to be).
    pub fn load() -> Self {
        if let Ok(path) = env::var("OPENCOHOST_BACKEND_CONFIG") {
            match Self::load_from_path(Path::new(&path)) {
                Some(cfg) => return cfg,
                None => {
                    eprintln!(
                        "backend config: OPENCOHOST_BACKEND_CONFIG={path} could not be read/parsed, trying next candidate"
                    );
                }
            }
        }

        #[cfg(debug_assertions)]
        {
            if let Some(cfg) = Self::load_from_path(Path::new(DEV_SOURCE_CONFIG_PATH)) {
                return cfg;
            }
        }

        if let Ok(exe_path) = env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                for candidate in [
                    exe_dir.join("backend.config.json"),
                    exe_dir.join("resources").join("backend.config.json"),
                ] {
                    if let Some(cfg) = Self::load_from_path(&candidate) {
                        return cfg;
                    }
                }
            }
        }

        Self::from_json(DEV_DEFAULT_CONFIG_JSON)
            .expect("backend config: compiled-in backend.config.default.json must be valid JSON")
    }

    pub fn load_from_path(path: &Path) -> Option<Self> {
        let contents = fs::read_to_string(path).ok()?;
        match Self::from_json(&contents) {
            Ok(cfg) => Some(cfg),
            Err(err) => {
                eprintln!("backend config: failed to parse {path:?}: {err}");
                None
            }
        }
    }

    /// Resolves `working_dir` to an absolute path every caller (spawning the
    /// backend/PTT bridge, locating the dev-mode token file) can use as-is.
    pub fn resolved_working_dir(&self) -> PathBuf {
        self.resolve_working_dir().0
    }

    /// Same resolution as `resolved_working_dir`, plus whether the answer is
    /// trustworthy: `true` when `working_dir` was absolute (taken verbatim)
    /// or the repo-root walk actually found the engine, `false` when the
    /// fallback below was taken.
    pub fn resolve_working_dir(&self) -> (PathBuf, bool) {
        let raw = Path::new(&self.working_dir);
        let is_win_abs = self.working_dir.len() >= 3
            && self.working_dir.as_bytes()[1] == b':'
            && (self.working_dir.as_bytes()[2] == b'\\' || self.working_dir.as_bytes()[2] == b'/');
        if raw.is_absolute() || is_win_abs {
            return (raw.to_path_buf(), true);
        }

        if let Ok(exe_path) = env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                if let Some(root) = find_repo_root(exe_dir) {
                    return (root, true);
                }
            }
        }

        eprintln!(
            "backend config: could not find the opencohost backend (pyproject.toml + opencohost/) \
             walking up from the exe directory — falling back to resolving working_dir={:?} \
             against the process's current directory, which may be wrong",
            self.working_dir
        );
        (raw.to_path_buf(), false)
    }
}

/// Walks up from `start` (inclusive) looking for the backend repo root: a
/// directory containing both `pyproject.toml` and an `opencohost/` package
/// directory.
pub fn find_repo_root(start: &Path) -> Option<PathBuf> {
    let mut dir = Some(start);
    while let Some(d) = dir {
        if d.join("pyproject.toml").is_file() && d.join("opencohost").is_dir() {
            return Some(d.to_path_buf());
        }
        dir = d.parent();
    }
    None
}

pub fn resolve_python_binary(config: &BackendConfig, working_dir: &Path) -> PathBuf {
    let raw = Path::new(&config.python_path);
    if raw.is_absolute() && raw.exists() {
        return raw.to_path_buf();
    }
    let candidate = working_dir.join(raw);
    if candidate.exists() {
        return candidate;
    }
    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            for candidate in [
                exe_dir
                    .join("resources")
                    .join("runtime")
                    .join("venv")
                    .join("Scripts")
                    .join("python.exe"),
                exe_dir
                    .join("resources")
                    .join("runtime")
                    .join("python")
                    .join("python.exe"),
                exe_dir
                    .join("runtime")
                    .join("venv")
                    .join("Scripts")
                    .join("python.exe"),
                exe_dir.join("runtime").join("python").join("python.exe"),
                exe_dir.join("python").join("python.exe"),
            ] {
                if candidate.is_file() {
                    return candidate;
                }
            }
        }
    }
    if raw.exists() {
        return raw.to_path_buf();
    }
    #[cfg(windows)]
    let venv_candidate = working_dir.join(".venv").join("Scripts").join("python.exe");
    #[cfg(not(windows))]
    let venv_candidate = working_dir.join(".venv").join("bin").join("python3");
    if venv_candidate.exists() {
        return venv_candidate;
    }
    #[cfg(not(windows))]
    {
        if config.python_path == "python" {
            if let Some(path_val) = env::var_os("PATH") {
                for dir in env::split_paths(&path_val) {
                    let full = dir.join("python3");
                    if full.is_file() {
                        return full;
                    }
                }
            }
        }
    }
    raw.to_path_buf()
}

pub fn resolve_log_path(config: &BackendConfig) -> PathBuf {
    if let Some(path) = &config.log_file {
        return PathBuf::from(path);
    }
    env::temp_dir().join("opencohost-backend.log")
}

/// Development builds retain the source-tree configuration escape hatch. A
/// release build has no fallback to `backend.config.json`, repo walking, or
/// PATH: the HKCU handoff and validated runtime manifest are authoritative.
pub fn load_backend_config() -> Result<BackendConfig, String> {
    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            for candidate in [
                exe_dir.join("resources").join("runtime"),
                exe_dir.join("runtime"),
                exe_dir.to_path_buf(),
            ] {
                for py in [
                    candidate.join("python").join("python.exe"),
                    candidate.join("venv").join("Scripts").join("python.exe"),
                ] {
                    if py.is_file() && candidate.join("opencohost").is_dir() {
                        return Ok(BackendConfig {
                            python_path: py.to_string_lossy().into_owned(),
                            working_dir: candidate.to_string_lossy().into_owned(),
                            app_module: default_app_module(),
                            port: default_port(),
                            fallback_port: default_fallback_port(),
                            spawn: true,
                            log_file: None,
                            data_root: None,
                        });
                    }
                }
            }
        }
    }

    #[cfg(debug_assertions)]
    {
        Ok(BackendConfig::load())
    }

    #[cfg(all(not(debug_assertions), windows))]
    {
        let handoff = WindowsRegistryHandoff;
        let locator = RuntimeLocator::from_handoff(&handoff)
            .map_err(|error| format!("{error}; run Repair or provision the backend runtime"))?;
        let manifest_path = locator
            .data_root
            .join("state")
            .join("runtime-manifest.json");
        let manifest = RuntimeManifest::read_recovery(&manifest_path, Some(&locator.install_id))
            .map_err(|error| format!("{error}; run Repair or provision the backend runtime"))?;
        locator
            .validate_manifest(&manifest)
            .map_err(|error| format!("{error}; run Repair or provision the backend runtime"))?;
        let seed = BackendConfig {
            python_path: String::new(),
            working_dir: String::new(),
            app_module: String::new(),
            port: 0,
            fallback_port: 0,
            spawn: true,
            log_file: None,
            data_root: None,
        };
        return launch_config(LaunchMode::Installed, seed, &manifest)
            .map_err(|error| format!("{error}; run Repair or provision the backend runtime"));
    }

    #[cfg(all(not(debug_assertions), not(windows)))]
    {
        Err("installed OpenCohost runtime is supported only on Windows".to_string())
    }
}
