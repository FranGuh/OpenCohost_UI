use serde::Serialize;
use std::env;
use std::fs;
use std::path::Path;
use std::process::{Child, Command, Stdio};
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
use crate::backend::health::{decide_action, probe_health, HealthProbe, PortChoice, ResolveAction};
use crate::backend::ptt::{spawn_ptt_bridge, PttBridge};
use crate::backend::token::{read_operator_token_with_retry, resolve_token_file_candidates};
use crate::platform::JobObject;

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
    pub info: Mutex<BackendInfo>,
    pub child: Mutex<Option<Child>>,
    pub job: Mutex<Option<JobObject>>,
    pub ptt_child: Mutex<Option<Child>>,
    pub ptt_job: Mutex<Option<JobObject>>,
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

pub fn base_url_for(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

pub fn log_stdio(log_path: &Path) -> (Stdio, Stdio) {
    match fs::File::create(log_path) {
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
                "backend supervisor: failed to create log file {log_path:?}: {err} — falling back to Stdio::null()"
            );
            (Stdio::null(), Stdio::null())
        }
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

    if let Some(data_root) = &config.data_root {
        command.env("OPENCOHOST_DATA_ROOT", data_root);
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
            eprintln!("backend supervisor: failed to spawn backend on port {port}: {err}");
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
            eprintln!("backend supervisor: {message}");
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
            eprintln!(
                "backend supervisor: try_wait failed for backend spawned on port {port}: {err}"
            );
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
    let primary_probe = probe_health(config.port, probe_timeout);

    let fallback_probe = if primary_probe == HealthProbe::ListeningNotHealthy && config.spawn {
        Some(probe_health(config.fallback_port, probe_timeout))
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
        ResolveAction::BothBusy => {
            eprintln!(
                "backend supervisor: port {} and fallback port {} are both occupied by unhealthy/unknown processes — refusing to spawn on top of either",
                config.port, config.fallback_port
            );
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
        Ok(config) => {
            let outcome = resolve_backend(&config);
            (outcome, Some(config))
        }
        Err(error) => {
            eprintln!("backend supervisor: installed runtime is unavailable: {error}");
            (degraded_outcome(error, default_port()), None)
        }
    };

    let bridge = if let Some(config) = config.as_ref() {
        let token_candidates = resolve_token_file_candidates(config.resolved_working_dir());
        let token = read_operator_token_with_retry(&token_candidates, 1, Duration::from_millis(0));
        spawn_ptt_bridge(config, outcome.job.as_ref(), token.as_deref())
    } else {
        PttBridge::default()
    };

    app.manage(BackendState {
        info: Mutex::new(outcome.info),
        child: Mutex::new(outcome.child),
        job: Mutex::new(outcome.job),
        ptt_child: Mutex::new(bridge.child),
        ptt_job: Mutex::new(bridge.job),
    });
    Ok(())
}

pub fn reload_backend(app_handle: &tauri::AppHandle) -> Result<BackendInfo, String> {
    let state = app_handle.state::<BackendState>();
    kill_child(&state.child);
    if let Ok(mut job) = state.job.lock() {
        job.take();
    }
    let config = load_backend_config().map_err(|_| "backend_launch_failed".to_owned())?;
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
    Ok(info)
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
