use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(windows)]
use crate::platform::WindowsRegistryHandoff;
#[cfg(not(debug_assertions))]
use crate::runtime::{launch_config, LaunchMode, RuntimeManifest};
use crate::runtime::{HandoffStore, RuntimeLocator};

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

    fn load_explicit() -> Option<Self> {
        if let Ok(path) = env::var("OPENCOHOST_BACKEND_CONFIG") {
            match Self::load_from_path(Path::new(&path)) {
                Some(cfg) => return Some(cfg),
                None => {
                    eprintln!(
                        "backend config: OPENCOHOST_BACKEND_CONFIG={path} could not be read/parsed, trying next candidate"
                    );
                }
            }
        }
        None
    }

    #[cfg(debug_assertions)]
    fn load_source() -> Option<Self> {
        Self::load_from_path(Path::new(DEV_SOURCE_CONFIG_PATH))
    }

    fn load_portable() -> Self {
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
        if let Some(cfg) = Self::load_explicit() {
            return cfg;
        }

        #[cfg(debug_assertions)]
        {
            if let Some(cfg) = Self::load_source() {
                return cfg;
            }
        }

        Self::load_portable()
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
    if let Some(root) = &config.data_root {
        return root.join("logs").join("backend.log");
    }
    env::temp_dir().join("opencohost-backend.log")
}

fn select_backend_config_with<T, Explicit, Source, Packaged>(
    debug_build: bool,
    explicit: Explicit,
    source: Source,
    packaged: Packaged,
) -> Option<T>
where
    Explicit: FnOnce() -> Option<T>,
    Source: FnOnce() -> Option<T>,
    Packaged: FnOnce() -> Option<T>,
{
    if debug_build {
        explicit().or_else(source).or_else(packaged)
    } else {
        packaged()
    }
}

// The legacy handoff trait represents missing and unreadable values as None.
// Probe key presence separately: a corrupt or unreadable existing handoff must
// never be mistaken for a fresh install and silently reset personal storage.
#[cfg(windows)]
fn registry_handoff_present() -> Result<bool, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, HKEY_CURRENT_USER, KEY_READ,
    };
    let name: Vec<u16> =
        std::ffi::OsStr::new(crate::platform::windows::registry::RUNTIME_REGISTRY_KEY)
            .encode_wide()
            .chain(Some(0))
            .collect();
    let mut key = std::ptr::null_mut();
    let result = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, name.as_ptr(), 0, KEY_READ, &mut key) };
    match result {
        0 => {
            unsafe {
                RegCloseKey(key);
            }
            Ok(true)
        }
        2 => Ok(false), // ERROR_FILE_NOT_FOUND is the only absent-handoff case.
        _ => Err("The runtime handoff cannot be read; run Repair before launching".into()),
    }
}

fn packaged_config_at(
    exe_dir: &Path,
    handoff: &impl HandoffStore,
    handoff_present: bool,
    default_root: Option<PathBuf>,
) -> Result<Option<BackendConfig>, String> {
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
                let data_root = if handoff_present {
                    RuntimeLocator::from_handoff(handoff)
                        .map_err(|_| "The existing runtime handoff is invalid; run Repair to preserve the configured data folder".to_string())?
                        .data_root
                } else {
                    default_root.clone().ok_or_else(|| "LOCALAPPDATA is unavailable; run Repair to choose an external data folder".to_string())?
                };
                super::legacy_state::validate_root(&data_root)
                    .map_err(|_| "The data folder contains an unsafe link; run Repair to choose a local data folder".to_string())?;
                crate::first_run::validate_data_root_candidate_with_boundaries(&data_root, &[exe_dir.to_path_buf()])
                    .map_err(|_| "Choose a writable data folder outside the application install directory; run Repair".to_string())?;
                super::legacy_state::preserve(&candidate, &data_root)
                    .map_err(|_| "Embedded user data could not be preserved safely; run Repair without deleting the original files".to_string())?;
                return Ok(Some(BackendConfig {
                    python_path: py.to_string_lossy().into_owned(),
                    working_dir: candidate.to_string_lossy().into_owned(),
                    app_module: default_app_module(),
                    port: default_port(),
                    fallback_port: default_fallback_port(),
                    spawn: true,
                    log_file: None,
                    data_root: Some(data_root),
                }));
            }
        }
    }
    Ok(None)
}

fn discover_packaged_backend_config() -> Option<Result<BackendConfig, String>> {
    let exe_path = env::current_exe().ok()?;
    let exe_dir = exe_path.parent()?;
    #[cfg(windows)]
    {
        // Do not inspect the owner's handoff unless a bundled runtime exists.
        let bundled = [
            exe_dir.join("resources/runtime"),
            exe_dir.join("runtime"),
            exe_dir.to_path_buf(),
        ]
        .iter()
        .any(|root| {
            root.join("opencohost").is_dir()
                && [
                    root.join("python/python.exe"),
                    root.join("venv/Scripts/python.exe"),
                ]
                .iter()
                .any(|python| python.is_file())
        });
        if !bundled {
            return None;
        }
        let present = match registry_handoff_present() {
            Ok(present) => present,
            Err(error) => return Some(Err(error)),
        };
        return packaged_config_at(
            exe_dir,
            &WindowsRegistryHandoff,
            present,
            crate::first_run::default_data_root_outside_boundaries(&[exe_dir.to_path_buf()]),
        )
        .transpose();
    }
    #[cfg(not(windows))]
    None
}

/// Development builds retain the source-tree configuration escape hatch. A
/// release build has no fallback to `backend.config.json`, repo walking, or
/// PATH: the HKCU handoff and validated runtime manifest are authoritative.
pub fn load_backend_config() -> Result<BackendConfig, String> {
    #[cfg(debug_assertions)]
    {
        if let Some(config) = select_backend_config_with(
            true,
            || BackendConfig::load_explicit().map(Ok),
            || BackendConfig::load_source().map(Ok),
            discover_packaged_backend_config,
        ) {
            return config;
        }
        return Ok(BackendConfig::load_portable());
    }

    #[cfg(not(debug_assertions))]
    if let Some(config) = select_backend_config_with(
        false,
        || None::<Result<BackendConfig, String>>,
        || None::<Result<BackendConfig, String>>,
        discover_packaged_backend_config,
    ) {
        return config;
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

#[cfg(test)]
mod tests {
    use super::{select_backend_config_with, BackendConfig};

    struct TestHandoff(Option<String>, Option<String>);

    impl crate::runtime::HandoffStore for TestHandoff {
        fn value(&self, name: &str) -> Option<String> {
            match name {
                "DataRoot" => self.0.clone(),
                "InstallId" => self.1.clone(),
                _ => None,
            }
        }
    }

    fn packaged_fixture() -> (std::path::PathBuf, std::path::PathBuf) {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("temp/local-installer-lp2/rust")
            .join(format!(
                "{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
        let exe = root.join("install");
        std::fs::create_dir_all(exe.join("resources/runtime/python")).unwrap();
        std::fs::create_dir_all(exe.join("resources/runtime/opencohost")).unwrap();
        std::fs::write(exe.join("resources/runtime/python/python.exe"), b"fixture").unwrap();
        (exe, root.join("local/OpenCohost/data"))
    }

    #[test]
    fn packaged_runtime_uses_external_default_data_root() {
        let (exe, default) = packaged_fixture();
        let config =
            super::packaged_config_at(&exe, &TestHandoff(None, None), false, Some(default.clone()))
                .unwrap()
                .unwrap();
        assert_eq!(config.data_root, Some(default.clone()));
        assert_eq!(
            super::resolve_log_path(&config),
            default.join("logs/backend.log")
        );
        assert!(config
            .python_path
            .ends_with("resources\\runtime\\python\\python.exe"));
        assert_eq!(
            crate::backend::token::resolve_token_file_candidates(
                &config.working_dir,
                config.data_root.as_deref()
            )[0],
            default.join("config/api_tokens.json")
        );
    }

    #[test]
    fn packaged_backend_log_creates_external_log_directory() {
        let (_, root) = packaged_fixture();
        let log = root.join("logs/backend.log");
        let _stdio = crate::backend::supervisor::log_stdio(&log);
        assert!(log.is_file());
    }

    #[test]
    fn packaged_runtime_preserves_valid_handoff_root() {
        let (exe, default) = packaged_fixture();
        let custom = exe.parent().unwrap().join("custom-data");
        std::fs::create_dir_all(&custom).unwrap();
        let config = super::packaged_config_at(
            &exe,
            &TestHandoff(
                Some(custom.to_string_lossy().into_owned()),
                Some("existing-install".into()),
            ),
            true,
            Some(default.clone()),
        )
        .unwrap()
        .unwrap();
        assert_eq!(config.data_root, Some(custom));
        assert!(!default.exists());
    }

    #[test]
    fn invalid_existing_handoff_does_not_silently_reset_root() {
        let (exe, default) = packaged_fixture();
        for handoff in [
            TestHandoff(None, None),
            TestHandoff(Some("relative".into()), Some("id".into())),
            TestHandoff(Some(default.to_string_lossy().into_owned()), None),
        ] {
            let error =
                super::packaged_config_at(&exe, &handoff, true, Some(default.clone())).unwrap_err();
            assert!(error.contains("Repair"));
            assert!(!default.exists());
        }
    }

    #[test]
    fn packaged_runtime_rejects_handoff_inside_install() {
        let (exe, default) = packaged_fixture();
        let error = super::packaged_config_at(
            &exe,
            &TestHandoff(
                Some(exe.join("resources/runtime").to_string_lossy().into_owned()),
                Some("id".into()),
            ),
            true,
            Some(default.clone()),
        )
        .unwrap_err();
        assert!(error.contains("outside"));
        assert!(!default.exists());
    }

    #[test]
    fn legacy_embedded_state_is_preserved_before_new_default() {
        let (exe, default) = packaged_fixture();
        let legacy = exe.join("resources/runtime/data/editorial_cards");
        let omitted_memories = exe.join("resources/runtime/data/memorias");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::create_dir_all(&omitted_memories).unwrap();
        std::fs::write(legacy.join("cards.db"), b"synthetic owner state").unwrap();
        std::fs::write(omitted_memories.join("memory.db"), b"legacy memory state").unwrap();
        let config =
            super::packaged_config_at(&exe, &TestHandoff(None, None), false, Some(default.clone()))
                .unwrap()
                .unwrap();
        assert_eq!(config.data_root.as_ref(), Some(&default));
        assert_eq!(
            std::fs::read(default.join("data/editorial_cards/cards.db")).unwrap(),
            b"synthetic owner state"
        );
        assert!(
            !default.join("data/memorias/memory.db").exists(),
            "memories must remain omitted during embedded-state adoption"
        );
        assert_eq!(
            std::fs::read(legacy.join("cards.db")).unwrap(),
            b"synthetic owner state"
        );
        assert_eq!(
            std::fs::read(omitted_memories.join("memory.db")).unwrap(),
            b"legacy memory state"
        );
    }

    fn preserved_files(directory: &std::path::Path) -> Vec<(std::path::PathBuf, Vec<u8>)> {
        let mut files = Vec::new();
        for entry in std::fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                files.extend(preserved_files(&path));
            } else {
                files.push((path.clone(), std::fs::read(path).unwrap()));
            }
        }
        files.sort();
        files
    }

    #[test]
    fn legacy_root_and_package_preserve_profiles_history_sidecars_and_repeat() {
        let (exe, external) = packaged_fixture();
        let runtime = exe.join("resources/runtime");
        let history = runtime.join("opencohost/data/smart_aggregator");
        std::fs::create_dir_all(&history).unwrap();
        std::fs::write(runtime.join("perfiles.json"), br#"{"profiles":{}}"#).unwrap();
        for (name, bytes) in [
            ("sessions.db", b"database".as_slice()),
            ("sessions.db-wal", b"wal"),
            ("sessions.db-shm", b"shm"),
        ] {
            std::fs::write(history.join(name), bytes).unwrap();
        }
        for _ in 0..2 {
            let config = super::packaged_config_at(
                &exe,
                &TestHandoff(None, None),
                false,
                Some(external.clone()),
            )
            .unwrap()
            .unwrap();
            assert_eq!(config.data_root.as_ref(), Some(&external));
            assert_eq!(
                std::fs::read(external.join("perfiles.json")).unwrap(),
                br#"{"profiles":{}}"#
            );
            for name in ["sessions.db", "sessions.db-wal", "sessions.db-shm"] {
                assert_eq!(
                    std::fs::read(external.join("data/smart_aggregator").join(name)).unwrap(),
                    std::fs::read(history.join(name)).unwrap()
                );
            }
        }
        let before = preserved_files(&external.join("legacy-preserved"));
        super::packaged_config_at(
            &exe,
            &TestHandoff(None, None),
            false,
            Some(external.clone()),
        )
        .unwrap();
        assert_eq!(before, preserved_files(&external.join("legacy-preserved")));
        assert!(runtime.join("perfiles.json").is_file());
    }

    #[test]
    fn legacy_conflicts_keep_custom_active_state_and_complete_sqlite_group() {
        let (exe, default) = packaged_fixture();
        let custom = default.parent().unwrap().join("custom");
        let target = custom.join("data/smart_aggregator");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("sessions.db"), b"active database").unwrap();
        let source = exe.join("resources/runtime/opencohost/data/smart_aggregator");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("sessions.db"), b"legacy database").unwrap();
        std::fs::write(source.join("sessions.db-wal"), b"legacy wal").unwrap();
        let handoff = TestHandoff(
            Some(custom.to_string_lossy().into_owned()),
            Some("existing".into()),
        );
        let config = super::packaged_config_at(&exe, &handoff, true, Some(default.clone()))
            .unwrap()
            .unwrap();
        assert_eq!(config.data_root.as_ref(), Some(&custom));
        assert!(!default.exists());
        assert_eq!(
            std::fs::read(target.join("sessions.db")).unwrap(),
            b"active database"
        );
        assert!(
            !target.join("sessions.db-wal").exists(),
            "Never mix sidecars with a different active database"
        );
        let preserved = preserved_files(&custom.join("legacy-preserved"));
        assert!(preserved
            .iter()
            .any(|(_, bytes)| bytes == b"legacy database"));
        assert!(preserved.iter().any(|(_, bytes)| bytes == b"legacy wal"));
    }

    #[test]
    fn legacy_root_wins_without_merging_different_nested_profile() {
        let (exe, external) = packaged_fixture();
        let runtime = exe.join("resources/runtime");
        std::fs::write(runtime.join("perfiles.json"), b"root profile").unwrap();
        std::fs::write(runtime.join("opencohost/perfiles.json"), b"nested profile").unwrap();
        super::packaged_config_at(
            &exe,
            &TestHandoff(None, None),
            false,
            Some(external.clone()),
        )
        .unwrap();
        assert_eq!(
            std::fs::read(external.join("perfiles.json")).unwrap(),
            b"root profile"
        );
        assert!(preserved_files(&external.join("legacy-preserved"))
            .iter()
            .any(|(_, bytes)| bytes == b"nested profile"));
    }

    #[test]
    fn legacy_root_database_group_wins_without_adopting_nested_sidecars() {
        let (exe, external) = packaged_fixture();
        let runtime = exe.join("resources/runtime");
        for prefix in ["data/smart_aggregator", "opencohost/data/smart_aggregator"] {
            let directory = runtime.join(prefix);
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(directory.join("sessions.db"), b"same checkpoint pages").unwrap();
        }
        std::fs::write(
            runtime.join("opencohost/data/smart_aggregator/sessions.db-wal"),
            b"nested transaction",
        )
        .unwrap();
        super::packaged_config_at(
            &exe,
            &TestHandoff(None, None),
            false,
            Some(external.clone()),
        )
        .unwrap();
        assert_eq!(
            std::fs::read(external.join("data/smart_aggregator/sessions.db")).unwrap(),
            b"same checkpoint pages"
        );
        assert!(
            !external
                .join("data/smart_aggregator/sessions.db-wal")
                .exists(),
            "Root-first precedence applies to complete database groups, not individual filenames"
        );
        assert!(preserved_files(&external.join("legacy-preserved"))
            .iter()
            .any(|(_, bytes)| bytes == b"nested transaction"));
    }

    #[test]
    fn packaged_runtime_keeps_bundled_config_code_separate_from_preserved_state() {
        let (exe, external) = packaged_fixture();
        let runtime = exe.join("resources/runtime");
        std::fs::create_dir_all(runtime.join("opencohost/config")).unwrap();
        std::fs::write(
            runtime.join("opencohost/config/settings.py"),
            b"bundled code",
        )
        .unwrap();
        std::fs::write(
            runtime.join("opencohost/config/smart_aggregator.yaml"),
            b"bundled defaults",
        )
        .unwrap();
        std::fs::create_dir_all(runtime.join("config")).unwrap();
        std::fs::write(runtime.join("config/custom.json"), b"owner configuration").unwrap();
        super::packaged_config_at(
            &exe,
            &TestHandoff(None, None),
            false,
            Some(external.clone()),
        )
        .unwrap();
        assert_eq!(
            std::fs::read(external.join("config/custom.json")).unwrap(),
            b"owner configuration"
        );
        assert!(!external.join("config/settings.py").exists());
        assert!(!external.join("config/smart_aggregator.yaml").exists());
    }

    #[test]
    fn legacy_preservation_detects_corrupted_snapshot_without_overwrite() {
        let (exe, external) = packaged_fixture();
        let source = exe.join("resources/runtime/perfiles.json");
        std::fs::write(&source, b"original").unwrap();
        super::packaged_config_at(
            &exe,
            &TestHandoff(None, None),
            false,
            Some(external.clone()),
        )
        .unwrap();
        let snapshot = preserved_files(&external.join("legacy-preserved"))
            .remove(0)
            .0;
        std::fs::write(&snapshot, b"corrupted snapshot").unwrap();
        assert!(super::packaged_config_at(
            &exe,
            &TestHandoff(None, None),
            false,
            Some(external.clone())
        )
        .is_err());
        assert_eq!(std::fs::read(snapshot).unwrap(), b"corrupted snapshot");
        assert_eq!(std::fs::read(source).unwrap(), b"original");
        assert_eq!(
            std::fs::read(external.join("perfiles.json")).unwrap(),
            b"original"
        );
    }

    #[test]
    fn legacy_preservation_copy_error_blocks_startup_and_keeps_original() {
        let (exe, external) = packaged_fixture();
        let source = exe.join("resources/runtime/perfiles.json");
        std::fs::write(&source, b"original").unwrap();
        std::fs::create_dir_all(&external).unwrap();
        std::fs::write(external.join("legacy-preserved"), b"not a directory").unwrap();
        assert!(
            super::packaged_config_at(&exe, &TestHandoff(None, None), false, Some(external))
                .is_err()
        );
        assert_eq!(std::fs::read(source).unwrap(), b"original");
    }

    #[test]
    fn legacy_partial_preservation_stays_blocked_and_retry_completes_without_overwrite() {
        let (exe, external) = packaged_fixture();
        let runtime = exe.join("resources/runtime");
        std::fs::write(runtime.join("cards.db"), b"cards").unwrap();
        std::fs::write(runtime.join("perfiles.json"), b"profiles").unwrap();
        std::fs::create_dir_all(external.join("perfiles.json")).unwrap();
        assert!(super::packaged_config_at(
            &exe,
            &TestHandoff(None, None),
            false,
            Some(external.clone())
        )
        .is_err());
        assert_eq!(std::fs::read(external.join("cards.db")).unwrap(), b"cards");
        assert_eq!(
            std::fs::read(runtime.join("perfiles.json")).unwrap(),
            b"profiles"
        );
        // Remove only the empty, deliberately invalid test destination.
        std::fs::remove_dir(external.join("perfiles.json")).unwrap();
        super::packaged_config_at(
            &exe,
            &TestHandoff(None, None),
            false,
            Some(external.clone()),
        )
        .unwrap();
        assert_eq!(std::fs::read(external.join("cards.db")).unwrap(), b"cards");
        assert_eq!(
            std::fs::read(external.join("perfiles.json")).unwrap(),
            b"profiles"
        );
    }

    #[cfg(windows)]
    #[test]
    fn legacy_preservation_rejects_source_and_destination_junctions() {
        for source_link in [true, false] {
            let (exe, external) = packaged_fixture();
            let outside = exe.parent().unwrap().join("outside");
            std::fs::create_dir_all(&outside).unwrap();
            let runtime = exe.join("resources/runtime");
            std::fs::create_dir_all(&external).unwrap();
            let link = if source_link {
                runtime.join("data")
            } else {
                std::fs::create_dir_all(runtime.join("data")).unwrap();
                std::fs::write(runtime.join("data/sessions.db"), b"private").unwrap();
                external.join("data")
            };
            let output = std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(link.to_string_lossy().replace('/', "\\"))
                .arg(outside.to_string_lossy().replace('/', "\\"))
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "Junction fixture must be available: {:?}",
                output
            );
            std::fs::write(outside.join("sessions.db"), b"outside").unwrap();
            let handoff = TestHandoff(
                Some(external.to_string_lossy().into_owned()),
                Some("existing".into()),
            );
            assert!(super::packaged_config_at(&exe, &handoff, true, None).is_err());
            assert_eq!(
                std::fs::read(outside.join("sessions.db")).unwrap(),
                b"outside"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn legacy_preservation_read_failure_with_existing_handoff_blocks_startup() {
        use std::os::windows::fs::OpenOptionsExt;
        let (exe, external) = packaged_fixture();
        std::fs::create_dir_all(&external).unwrap();
        let source = exe.join("resources/runtime/perfiles.json");
        std::fs::write(&source, b"private").unwrap();
        let _locked = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&source)
            .unwrap();
        let handoff = TestHandoff(
            Some(external.to_string_lossy().into_owned()),
            Some("existing".into()),
        );
        assert!(super::packaged_config_at(&exe, &handoff, true, None).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn legacy_preservation_rejects_linked_data_root_before_creating_directories() {
        let (exe, _) = packaged_fixture();
        let outside = exe.parent().unwrap().join("outside");
        let link = exe.parent().unwrap().join("linked-root");
        std::fs::create_dir_all(&outside).unwrap();
        let output = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link.to_string_lossy().replace('/', "\\"))
            .arg(outside.to_string_lossy().replace('/', "\\"))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "Junction fixture must be available"
        );
        let destination = link.join("new-data");
        assert!(super::packaged_config_at(
            &exe,
            &TestHandoff(None, None),
            false,
            Some(destination)
        )
        .is_err());
        assert!(
            !outside.join("new-data").exists(),
            "Do not write through a destination ancestor junction"
        );
    }

    #[test]
    fn debug_source_config_precedes_packaged_runtime() {
        let resolved =
            select_backend_config_with(true, || None, || Some("source"), || Some("packaged"));

        assert_eq!(resolved, Some("source"));
    }

    #[test]
    fn debug_absent_or_invalid_config_uses_packaged_runtime() {
        let invalid_explicit = BackendConfig::from_json("{").ok();
        let invalid_source = BackendConfig::from_json(r#"{"python_path":"python"}"#).ok();
        assert!(invalid_explicit.is_none());
        assert!(invalid_source.is_none());

        for (explicit, source) in [(None, None), (invalid_explicit, invalid_source)] {
            let resolved = select_backend_config_with(
                true,
                || explicit.map(|_| "explicit"),
                || source.map(|_| "source"),
                || Some("packaged"),
            );
            assert_eq!(resolved, Some("packaged"));
        }
    }

    #[test]
    fn release_packaged_runtime_precedes_development_config() {
        let resolved = select_backend_config_with(
            false,
            || Some("explicit"),
            || Some("source"),
            || Some("packaged"),
        );

        assert_eq!(resolved, Some("packaged"));
    }

    #[test]
    fn debug_explicit_config_precedes_source_and_packaged_runtime() {
        let resolved = select_backend_config_with(
            true,
            || Some("explicit"),
            || Some("source"),
            || Some("packaged"),
        );

        assert_eq!(resolved, Some("explicit"));
    }

    #[test]
    fn no_candidate_delegates_to_existing_build_fallback() {
        let debug_fallback = select_backend_config_with(true, || None, || None, || None);
        assert_eq!(debug_fallback, None::<&str>);

        let release_fallback = select_backend_config_with(false, || None, || None, || None);
        assert_eq!(release_fallback, None::<&str>);
    }

    #[test]
    fn packaged_runtime_uses_sibling_default_data_root_outside_legacy_and_clean_install_dirs() {
        const CHILD: &str = "OPENCOHOST_CONFIG_SIBLING_ROOT_TEST";
        if std::env::var_os(CHILD).is_none() {
            let root = std::env::temp_dir().join(format!(
                "opencohost-sibling-root-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            let local = root.join("local");
            std::fs::create_dir_all(&local).unwrap();
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "backend::config::tests::packaged_runtime_uses_sibling_default_data_root_outside_legacy_and_clean_install_dirs",
                    "--nocapture",
                ])
                .env(CHILD, &root)
                .env("LOCALAPPDATA", &local)
                .output()
                .unwrap();
            let _ = std::fs::remove_dir_all(&root);
            assert!(
                output.status.success(),
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }

        let root = std::path::PathBuf::from(std::env::var_os(CHILD).unwrap());
        let local = root.join("local");
        let expected_sibling = local.join("OpenCohostData");

        for exe_dir in [local.join("OpenCohost"), local.join("Programs/OpenCohost")] {
            std::fs::create_dir_all(exe_dir.join("resources/runtime/python")).unwrap();
            std::fs::create_dir_all(exe_dir.join("resources/runtime/opencohost")).unwrap();
            std::fs::write(exe_dir.join("resources/runtime/python/python.exe"), b"fixture").unwrap();

            let default_root = crate::first_run::default_data_root_outside_boundaries(
                std::slice::from_ref(&exe_dir),
            );
            assert_eq!(default_root.as_ref(), Some(&expected_sibling));
            let config =
                super::packaged_config_at(&exe_dir, &TestHandoff(None, None), false, default_root)
                    .expect("packaged_config_at must succeed for sibling default_data_root")
                    .expect("packaged config must be discovered");
            let data_root = config.data_root.expect("data_root must be set");
            assert!(!data_root.starts_with(&exe_dir));
            assert_eq!(data_root, expected_sibling);
        }

        let adversarial_exe = local.join("OpenCohostData");
        std::fs::create_dir_all(adversarial_exe.join("resources/runtime/python")).unwrap();
        std::fs::create_dir_all(adversarial_exe.join("resources/runtime/opencohost")).unwrap();
        std::fs::write(
            adversarial_exe.join("resources/runtime/python/python.exe"),
            b"fixture",
        )
        .unwrap();
        let fallback_root = crate::first_run::default_data_root_outside_boundaries(
            std::slice::from_ref(&adversarial_exe),
        );
        assert_eq!(fallback_root, Some(local.join("OpenCohost-data")));
        let adv_config = super::packaged_config_at(
            &adversarial_exe,
            &TestHandoff(None, None),
            false,
            fallback_root,
        )
        .expect("packaged_config_at must succeed for adversarial install dir")
        .expect("packaged config must be discovered");
        let adv_data_root = adv_config.data_root.expect("data_root must be set");
        assert!(!adv_data_root.starts_with(&adversarial_exe));
        assert_eq!(adv_data_root, local.join("OpenCohost-data"));
    }

    #[test]
    fn packaged_runtime_boundary_aware_default_avoids_adversarial_install_dir() {
        let root = std::env::temp_dir().join(format!(
            "opencohost-boundary-default-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let local = root.join("local");
        for (install_rel, expected_rel) in [
            ("OpenCohost", "OpenCohostData"),
            ("Programs/OpenCohost", "OpenCohostData"),
            ("OpenCohostData", "OpenCohost-data"),
        ] {
            let exe_dir = local.join(install_rel);
            std::fs::create_dir_all(exe_dir.join("resources/runtime/python")).unwrap();
            std::fs::create_dir_all(exe_dir.join("resources/runtime/opencohost")).unwrap();
            std::fs::write(exe_dir.join("resources/runtime/python/python.exe"), b"fixture").unwrap();

            let default_root = crate::first_run::default_data_root_in_outside(
                &local,
                std::slice::from_ref(&exe_dir),
            );
            assert_eq!(default_root, Some(local.join(expected_rel)));
            let config =
                super::packaged_config_at(&exe_dir, &TestHandoff(None, None), false, default_root)
                    .expect("packaged_config_at must succeed")
                    .expect("packaged config must be discovered");
            let data_root = config.data_root.expect("data_root must be set");
            assert!(!data_root.starts_with(&exe_dir));
            assert_eq!(data_root, local.join(expected_rel));
        }
        let _ = std::fs::remove_dir_all(&root);
    }
}
