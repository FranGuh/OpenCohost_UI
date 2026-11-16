use serde::Serialize;
use std::env;
use std::fs;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

use crate::backend::config::{
    default_port, load_backend_config, resolve_log_path, resolve_python_binary, BackendConfig,
};
use crate::backend::diagnostics::{
    backend_diagnostic, classify_backend_error, describe_spawn_failure, read_log_tail,
    BackendDiagnostic, SpawnFailureFacts,
};
use crate::backend::health::{
    decide_action, probe_health_for, HealthProbe, PortChoice, ResolveAction,
};
use crate::backend::identity::local_identity;
use crate::backend::shell_log::{self, log_line, MAX_LOG_BYTES};
use crate::backend::ptt::{spawn_ptt_bridge, PttBridge};
use crate::backend::token::{
    effective_data_root, read_operator_token_with_retry, resolve_token_file_candidates,
};
use crate::platform::JobObject;

#[cfg(test)]
use crate::backend::health::probe_health;
#[cfg(test)]
use crate::runtime::RuntimeManifest;

/// Response of the `backend_info` command — mirrors
/// `src/lib/backendBootstrap.ts::BackendInfo` on the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct BackendInfo {
    pub base_url: String,
    pub managed: bool,
    /// Populated on degraded resolution paths; always an allowlisted envelope.
    pub error: Option<BackendDiagnostic>,
}

/// Tauri-managed state: the resolved `BackendInfo` plus the spawned child.
pub struct BackendState {
    pub launch_config: Mutex<Option<BackendConfig>>,
    pub info: Mutex<BackendInfo>,
    pub child: Mutex<Option<Child>>,
    pub job: Mutex<Option<JobObject>>,
    pub ptt_child: Mutex<Option<Child>>,
    pub ptt_job: Mutex<Option<JobObject>>,
    /// Bumped on every (re)spawn so a stale watcher thread retires itself.
    pub watch_generation: AtomicU64,
    /// Automatic respawns used since the last explicit (re)load.
    pub restarts: AtomicU32,
    /// Exit status text of the managed child once it died, for diagnostics.
    pub last_exit: Mutex<Option<String>>,
}

/// A crashed managed child is respawned at most this many times.
pub const MAX_AUTO_RESTARTS: u32 = 1;

impl BackendState {
    pub fn new(
        launch_config: Option<BackendConfig>,
        outcome: SpawnOutcome,
        bridge: PttBridge,
    ) -> Self {
        Self {
            launch_config: Mutex::new(launch_config),
            info: Mutex::new(outcome.info),
            child: Mutex::new(outcome.child),
            job: Mutex::new(outcome.job),
            ptt_child: Mutex::new(bridge.child),
            ptt_job: Mutex::new(bridge.job),
            watch_generation: AtomicU64::new(0),
            restarts: AtomicU32::new(0),
            last_exit: Mutex::new(None),
        }
    }
}

impl BackendState {
    pub(super) fn operator_token(&self, attempts: u32, delay: Duration) -> Option<String> {
        let config = self.launch_config.lock().ok()?.clone()?;
        let candidates = resolve_token_file_candidates(
            config.resolved_working_dir(),
            config.data_root.as_deref(),
        );
        read_operator_token_with_retry(&candidates, attempts, delay)
    }
}

pub fn backend_info(state: tauri::State<BackendState>) -> BackendInfo {
    state
        .info
        .lock()
        .map(|info| info.clone())
        .unwrap_or_else(|_| BackendInfo {
            base_url: format!("http://127.0.0.1:{}", default_port()),
            managed: false,
            error: Some(backend_diagnostic("backend_state_unavailable")),
        })
}

pub struct SpawnOutcome {
    pub info: BackendInfo,
    pub child: Option<Child>,
    pub job: Option<JobObject>,
}

pub fn degraded_outcome(error: impl Into<String>, port: u16) -> SpawnOutcome {
    SpawnOutcome {
        info: BackendInfo {
            base_url: base_url_for(port),
            managed: false,
            error: Some(classify_backend_error(&error.into())),
        },
        child: None,
        job: None,
    }
}

/// Deterministic interpreter environment for the spawned backend: no stray
/// `__pycache__` written into the install, and UTF-8 I/O regardless of the
/// Windows ANSI code page.
pub fn apply_python_env(command: &mut Command) {
    command
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("PYTHONUTF8", "1");
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WatchAction {
    KeepWatching,
    Respawn,
    GiveUp,
}

/// Watcher policy: respawn a crashed child at most `max_restarts` times.
pub fn watch_decision(exited: bool, restarts_used: u32, max_restarts: u32) -> WatchAction {
    if !exited {
        WatchAction::KeepWatching
    } else if restarts_used < max_restarts {
        WatchAction::Respawn
    } else {
        WatchAction::GiveUp
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum ChildLiveness {
    Running,
    Exited(String),
    Absent,
}

pub fn child_liveness(slot: &Mutex<Option<Child>>) -> ChildLiveness {
    let mut guard = match slot.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    match guard.as_mut() {
        None => ChildLiveness::Absent,
        Some(child) => match child.try_wait() {
            Ok(Some(status)) => ChildLiveness::Exited(status.to_string()),
            Ok(None) | Err(_) => ChildLiveness::Running,
        },
    }
}

pub fn base_url_for(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

/// Opens the backend log for APPENDING (a spawn must never wipe the previous
/// run's evidence). One size-based rotation keeps a single `.1` backup.
pub fn log_stdio(log_path: &Path) -> (Stdio, Stdio) {
    shell_log::set_log_path(log_path);
    if let Some(parent) = log_path.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            eprintln!("backend supervisor: cannot create backend log directory: {error}");
            return (Stdio::null(), Stdio::null());
        }
    }
    shell_log::rotate_if_needed(log_path, MAX_LOG_BYTES);
    match shell_log::open_append(log_path) {
        Ok(log_out) => match log_out.try_clone() {
            Ok(log_err) => (Stdio::from(log_out), Stdio::from(log_err)),
            Err(err) => {
                eprintln!(
                    "backend supervisor: failed to clone log file handle for {log_path:?}: {err} — falling back to Stdio::null()"
                );
                (Stdio::null(), Stdio::null())
            }
        },
        Err(err) => {
            eprintln!(
                "backend supervisor: failed to open log file {log_path:?}: {err} — falling back to Stdio::null()"
            );
            (Stdio::null(), Stdio::null())
        }
    }
}

pub(crate) fn apply_owner_reflection_default(
    command: &mut Command,
    installed: bool,
    inherited: Option<&std::ffi::OsStr>,
) {
    if let Some(value) = inherited {
        // Presence is authoritative, including an explicitly empty disable.
        command.env("OPENCOHOST_OWNER_REFLECTION", value);
    } else if installed {
        command.env("OPENCOHOST_OWNER_REFLECTION", "on");
    }
}

pub fn spawn_backend(config: &BackendConfig, port: u16) -> std::io::Result<Child> {
    let log_path = resolve_log_path(config);
    let (stdout, stderr) = log_stdio(&log_path);
    let mut working_dir = config.resolved_working_dir();
    let python_bin = resolve_python_binary(config, &working_dir);

    if !working_dir.join("opencohost").is_dir() {
        if let Ok(exe_path) = env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                for candidate in [
                    exe_dir.join("resources").join("runtime"),
                    exe_dir.join("runtime"),
                    exe_dir.to_path_buf(),
                ] {
                    if candidate.join("opencohost").is_dir() {
                        working_dir = candidate;
                        break;
                    }
                }
            }
        }
    }

    let mut command = Command::new(&python_bin);
    command
        .arg("-m")
        .arg("uvicorn")
        .arg(&config.app_module)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--workers")
        .arg("1")
        .env("PYTHONPATH", &working_dir)
        .env("PYTHONUNBUFFERED", "1")
        .current_dir(&working_dir)
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr);

    apply_python_env(&mut command);
    if let Some(data_root) = &config.data_root {
        command.env("OPENCOHOST_DATA_ROOT", data_root);
    }
    apply_owner_reflection_default(
        &mut command,
        cfg!(not(debug_assertions)),
        env::var_os("OPENCOHOST_OWNER_REFLECTION").as_deref(),
    );

    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let res_dir = exe_dir.join("resources");
            if res_dir.is_dir() {
                command.env("OPENCOHOST_RESOURCES_DIR", &res_dir);
            }
            // Installed builds ship the official avatar; point the VRM list at it
            // so the installed app never reads the owner's Downloads folder.
            let vrm_dir = res_dir.join("vrm");
            if vrm_dir.is_dir() {
                command.env("OPENCOHOST_VRM_MODEL_DIR", &vrm_dir);
            }
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command.spawn()
}

pub fn spawn_and_verify(config: &BackendConfig, port: u16) -> SpawnOutcome {
    let log_path = resolve_log_path(config);

    let mut child = match spawn_backend(config, port) {
        Ok(child) => child,
        Err(err) => {
            log_line(&format!("backend supervisor: failed to spawn backend on port {port}: {err}"));
            return SpawnOutcome {
                info: BackendInfo {
                    base_url: base_url_for(port),
                    managed: false,
                    error: Some(backend_diagnostic("backend_launch_failed")),
                },
                child: None,
                job: None,
            };
        }
    };

    std::thread::sleep(Duration::from_millis(700));

    match child.try_wait() {
        Ok(Some(status)) => {
            let (working_dir, engine_root_found) = config.resolve_working_dir();
            let status_text = status.to_string();
            let log_tail = read_log_tail(&log_path);
            let message = describe_spawn_failure(&SpawnFailureFacts {
                port,
                status: &status_text,
                python_path: &config.python_path,
                working_dir: &working_dir,
                engine_root_found,
                log_path: &log_path,
                log_tail: log_tail.as_deref(),
            });
            log_line(&format!("backend supervisor: {message}"));
            SpawnOutcome {
                info: BackendInfo {
                    base_url: base_url_for(port),
                    managed: false,
                    error: Some(backend_diagnostic("backend_launch_failed")),
                },
                child: None,
                job: None,
            }
        }
        Ok(None) => {
            let job = JobObject::assign(&child);
            SpawnOutcome {
                info: BackendInfo {
                    base_url: base_url_for(port),
                    managed: true,
                    error: None,
                },
                child: Some(child),
                job,
            }
        }
        Err(err) => {
            log_line(&format!(
                "backend supervisor: try_wait failed for backend spawned on port {port}: {err}"
            ));
            let job = JobObject::assign(&child);
            SpawnOutcome {
                info: BackendInfo {
                    base_url: base_url_for(port),
                    managed: true,
                    error: None,
                },
                child: Some(child),
                job,
            }
        }
    }
}

pub fn resolve_backend(config: &BackendConfig) -> SpawnOutcome {
    let probe_timeout = Duration::from_millis(500);
    let local = local_identity(config.data_root.as_deref());
    let primary_probe = probe_health_for(config.port, probe_timeout, &local);

    let fallback_probe = if matches!(
        primary_probe,
        HealthProbe::ListeningNotHealthy | HealthProbe::HealthyForeign
    ) && config.spawn
    {
        Some(probe_health_for(config.fallback_port, probe_timeout, &local))
    } else {
        None
    };

    match decide_action(primary_probe, fallback_probe, config.spawn) {
        ResolveAction::ReuseHealthy(choice) => {
            let port = match choice {
                PortChoice::Primary => config.port,
                PortChoice::Fallback => config.fallback_port,
            };
            SpawnOutcome {
                info: BackendInfo {
                    base_url: base_url_for(port),
                    managed: false,
                    error: None,
                },
                child: None,
                job: None,
            }
        }
        ResolveAction::Spawn(choice) => {
            let port = match choice {
                PortChoice::Primary => config.port,
                PortChoice::Fallback => config.fallback_port,
            };
            spawn_and_verify(config, port)
        }
        ResolveAction::ForeignBackend => {
            log_line(&format!(
                "backend supervisor: a backend from another install or build answers on port {} / {}; refusing to reuse it",
                config.port, config.fallback_port
            ));
            SpawnOutcome {
                info: BackendInfo {
                    base_url: base_url_for(config.port),
                    managed: false,
                    error: Some(backend_diagnostic("backend_foreign_instance")),
                },
                child: None,
                job: None,
            }
        }
        ResolveAction::BothBusy => {
            log_line(&format!(
                "backend supervisor: port {} and fallback port {} are both occupied by unhealthy/unknown processes — refusing to spawn on top of either",
                config.port, config.fallback_port
            ));
            SpawnOutcome {
                info: BackendInfo {
                    base_url: base_url_for(config.port),
                    managed: false,
                    error: Some(backend_diagnostic("backend_ports_busy")),
                },
                child: None,
                job: None,
            }
        }
        ResolveAction::Unmanaged => SpawnOutcome {
            info: BackendInfo {
                base_url: base_url_for(config.port),
                managed: false,
                error: None,
            },
            child: None,
            job: None,
        },
    }
}

pub fn setup_backend(app: &tauri::App) -> tauri::Result<()> {
    let (outcome, config) = match load_backend_config() {
        Ok(mut config) => {
            config.data_root = effective_data_root(config.data_root.as_deref());
            shell_log::set_log_path(&resolve_log_path(&config));
            let outcome = resolve_backend(&config);
            (outcome, Some(config))
        }
        Err(error) => {
            log_line(&format!("backend supervisor: installed runtime is unavailable: {error}"));
            (degraded_outcome(error, default_port()), None)
        }
    };

    let bridge = if let Some(config) = config.as_ref() {
        let data_root = effective_data_root(config.data_root.as_deref());
        let token_candidates =
            resolve_token_file_candidates(config.resolved_working_dir(), data_root.as_deref());
        let token = read_operator_token_with_retry(&token_candidates, 1, Duration::from_millis(0));
        spawn_ptt_bridge(config, outcome.job.as_ref(), token.as_deref())
    } else {
        PttBridge::default()
    };

    app.manage(BackendState::new(config, outcome, bridge));
    start_child_watcher(app.handle());
    Ok(())
}

pub fn reload_backend(app_handle: &tauri::AppHandle) -> Result<BackendInfo, String> {
    let state = app_handle.state::<BackendState>();
    let mut retained = state
        .launch_config
        .lock()
        .map_err(|_| "backend_state_unavailable".to_owned())?;
    *retained = None;
    kill_child(&state.child);
    if let Ok(mut job) = state.job.lock() {
        job.take();
    }
    let mut config = load_backend_config().map_err(|_| "backend_launch_failed".to_owned())?;
    config.data_root = effective_data_root(config.data_root.as_deref());
    shell_log::set_log_path(&resolve_log_path(&config));
    state.restarts.store(0, Ordering::SeqCst);
    if let Ok(mut last) = state.last_exit.lock() {
        *last = None;
    }
    let outcome = resolve_backend(&config);
    if !outcome.info.managed {
        return Err(outcome
            .info
            .error
            .as_ref()
            .map(|error| error.code.clone())
            .unwrap_or_else(|| "backend_launch_failed".into()));
    }
    let info = outcome.info.clone();
    if let Ok(mut current) = state.info.lock() {
        *current = outcome.info;
    }
    if let Ok(mut child) = state.child.lock() {
        *child = outcome.child;
    }
    if let Ok(mut job) = state.job.lock() {
        *job = outcome.job;
    }
    restart_ptt_bridge(&state, &config);
    *retained = Some(config);
    drop(retained);
    start_child_watcher(app_handle);
    Ok(info)
}

/// Watches the managed child. A crash is noticed within ~0.5 s (the old 700 ms
/// post-spawn check missed everything that dies after the interpreter has
/// imported for a few seconds), recorded for the UI, and the child is respawned
/// at most `MAX_AUTO_RESTARTS` times.
pub fn start_child_watcher(app_handle: &tauri::AppHandle) {
    let Some(state) = app_handle.try_state::<BackendState>() else {
        return;
    };
    let mine = state.watch_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let has_child = state.child.lock().map(|c| c.is_some()).unwrap_or(false);
    if !has_child {
        return;
    }
    let app = app_handle.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(500));
        let Some(state) = app.try_state::<BackendState>() else {
            return;
        };
        if state.watch_generation.load(Ordering::SeqCst) != mine {
            return;
        }
        let status = match child_liveness(&state.child) {
            ChildLiveness::Running => continue,
            ChildLiveness::Absent => return,
            ChildLiveness::Exited(status) => status,
        };
        log_line(&format!(
            "backend supervisor: managed backend exited unexpectedly ({status})"
        ));
        if let Ok(mut last) = state.last_exit.lock() {
            *last = Some(status);
        }
        if let Ok(mut slot) = state.child.lock() {
            slot.take();
        }
        let used = state.restarts.load(Ordering::SeqCst);
        match watch_decision(true, used, MAX_AUTO_RESTARTS) {
            WatchAction::Respawn => {
                state.restarts.fetch_add(1, Ordering::SeqCst);
                log_line("backend supervisor: respawning the backend once");
                if !respawn_backend(&app) {
                    mark_backend_exited(&state);
                }
            }
            _ => mark_backend_exited(&state),
        }
        return;
    });
}

fn mark_backend_exited(state: &BackendState) {
    if let Ok(mut info) = state.info.lock() {
        info.managed = false;
        info.error = Some(backend_diagnostic("backend_exited"));
    }
    if let Ok(mut job) = state.job.lock() {
        job.take();
    }
}

fn respawn_backend(app_handle: &tauri::AppHandle) -> bool {
    let state = app_handle.state::<BackendState>();
    let Some(config) = state.launch_config.lock().ok().and_then(|c| c.clone()) else {
        return false;
    };
    let outcome = resolve_backend(&config);
    if !outcome.info.managed {
        return false;
    }
    if let Ok(mut current) = state.info.lock() {
        *current = outcome.info;
    }
    if let Ok(mut child) = state.child.lock() {
        *child = outcome.child;
    }
    if let Ok(mut job) = state.job.lock() {
        *job = outcome.job;
    }
    restart_ptt_bridge(&state, &config);
    start_child_watcher(app_handle);
    true
}

/// Whether the PTT bridge must be (re)spawned after a backend respawn/reload:
/// only when the new backend started and this config actually spawns children.
pub fn should_restart_bridge(backend_started: bool, spawn_enabled: bool) -> bool {
    backend_started && spawn_enabled
}

/// Replaces the PTT bridge after the backend was respawned or reloaded. The old
/// bridge was tied to the previous backend Job Object, which is dropped when the
/// backend is replaced, so a fresh one is spawned against the new job.
/// Call only after the new job is stored in `state.job`. Locks are taken one at a
/// time (`ptt_child`, `ptt_job`, then `job`, then the two ptt slots again) and
/// never nested, so this cannot deadlock with `shutdown_backend`.
fn restart_ptt_bridge(state: &BackendState, config: &BackendConfig) {
    if !should_restart_bridge(true, config.spawn) {
        return;
    }
    kill_child(&state.ptt_child);
    if let Ok(mut job) = state.ptt_job.lock() {
        job.take();
    }
    let data_root = effective_data_root(config.data_root.as_deref());
    let token_candidates =
        resolve_token_file_candidates(config.resolved_working_dir(), data_root.as_deref());
    let token =
        read_operator_token_with_retry(&token_candidates, 20, Duration::from_millis(250));
    let bridge = match state.job.lock() {
        Ok(job) => spawn_ptt_bridge(config, job.as_ref(), token.as_deref()),
        Err(_) => spawn_ptt_bridge(config, None, token.as_deref()),
    };
    let restarted = bridge.child.is_some();
    if let Ok(mut child) = state.ptt_child.lock() {
        *child = bridge.child;
    }
    if let Ok(mut job) = state.ptt_job.lock() {
        *job = bridge.job;
    }
    log_line(if restarted {
        "backend supervisor: PTT bridge restarted"
    } else {
        "backend supervisor: PTT bridge not restarted"
    });
}

/// Closed status snapshot for the startup gate. Carries the log path and its
/// last line (the owner asked for both in the error card) but no raw child
/// output beyond that single bounded line.
#[derive(Debug, Clone, Serialize)]
pub struct BackendStatus {
    pub managed: bool,
    pub child_alive: bool,
    /// The managed child died and the single automatic respawn is in flight.
    pub restarting: bool,
    /// The child died and the supervisor gave up: fail fast, do not keep polling.
    pub gave_up: bool,
    pub restarts: u32,
    pub error_code: Option<String>,
    pub log_path: Option<String>,
    pub last_line: Option<String>,
}

/// Derives `(restarting, gave_up)` from the raw supervisor facts.
pub fn status_flags(
    managed: bool,
    child_alive: bool,
    exit_recorded: bool,
    error_code: Option<&str>,
) -> (bool, bool) {
    let gave_up = error_code == Some("backend_exited");
    let restarting = managed && !child_alive && exit_recorded && !gave_up;
    (restarting, gave_up)
}

pub fn backend_status(state: &BackendState) -> BackendStatus {
    let (managed, error_code) = state
        .info
        .lock()
        .map(|info| (info.managed, info.error.as_ref().map(|e| e.code.clone())))
        .unwrap_or((false, None));
    let child_alive = matches!(child_liveness(&state.child), ChildLiveness::Running);
    let exit_recorded = state
        .last_exit
        .lock()
        .map(|last| last.is_some())
        .unwrap_or(false);
    let (restarting, gave_up) =
        status_flags(managed, child_alive, exit_recorded, error_code.as_deref());
    let log_path = shell_log::log_path();
    let last_line = log_path.as_deref().and_then(shell_log::last_line);
    BackendStatus {
        managed,
        child_alive,
        restarting,
        gave_up,
        restarts: state.restarts.load(Ordering::SeqCst),
        error_code,
        log_path: log_path.map(|p| p.to_string_lossy().into_owned()),
        last_line,
    }
}

pub fn reload_backend_command(app_handle: tauri::AppHandle) -> Result<BackendInfo, String> {
    reload_backend(&app_handle)
}

pub fn shutdown_backend(app_handle: &tauri::AppHandle) {
    let Some(state) = app_handle.try_state::<BackendState>() else {
        return;
    };

    kill_child(&state.ptt_child);
    if let Ok(mut job_guard) = state.ptt_job.lock() {
        job_guard.take();
    }

    let managed = state.info.lock().map(|info| info.managed).unwrap_or(false);
    if !managed {
        return;
    }
    // Ask the backend to stop gracefully (unloads Ollama models, tears down
    // vision) BEFORE the hard kill; bounded, with an Ollama-direct fallback.
    let base_url = state
        .info
        .lock()
        .map(|info| info.base_url.clone())
        .unwrap_or_default();
    if let Some(port) = crate::backend::shutdown::port_from_base_url(&base_url) {
        let token = state.operator_token(1, Duration::from_millis(0));
        let unload_models = crate::backend::prefs::unload_models_on_exit();
        crate::backend::shutdown::graceful_shutdown(port, token.as_deref(), unload_models);
    }
    kill_child(&state.child);

    if let Ok(mut job_guard) = state.job.lock() {
        job_guard.take();
    };
}

pub fn kill_child(slot: &Mutex<Option<Child>>) {
    let mut guard = match slot.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(test)]
pub(crate) fn launch_committed_manifest_for_probe(
    manifest: &RuntimeManifest,
) -> Result<(BackendInfo, Child), String> {
    let python = manifest
        .engine
        .python_executable
        .as_ref()
        .ok_or_else(|| "manifest missing interpreter".to_owned())?;
    let project = manifest
        .engine
        .project_dir
        .as_ref()
        .ok_or_else(|| "manifest missing project".to_owned())?;
    let config = BackendConfig {
        python_path: python.to_string_lossy().into_owned(),
        working_dir: project.to_string_lossy().into_owned(),
        app_module: manifest.engine.app_module.clone(),
        port: manifest.engine.preferred_port,
        fallback_port: manifest.engine.fallback_port,
        spawn: true,
        log_file: Some(
            manifest
                .data_root
                .join("state")
                .join("probe-backend.log")
                .to_string_lossy()
                .into_owned(),
        ),
        data_root: Some(manifest.data_root.clone()),
    };
    let outcome = resolve_backend(&config);
    let error_code = outcome
        .info
        .error
        .as_ref()
        .map(|error| error.code.clone())
        .unwrap_or_else(|| "backend_launch_failed".into());
    let mut child = outcome.child.ok_or(error_code)?;
    let launched_port = outcome
        .info
        .base_url
        .rsplit(':')
        .next()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(config.port);
    for _ in 0..120 {
        if probe_health(launched_port, Duration::from_millis(250)) == HealthProbe::Healthy {
            return Ok((outcome.info, child));
        }
        if child.try_wait().ok().flatten().is_some() {
            return Err("backend exited before health gate".into());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    let _ = child.kill();
    let _ = child.wait();
    Err("backend health deadline exceeded".into())
}
