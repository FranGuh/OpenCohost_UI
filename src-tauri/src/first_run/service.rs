use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::Manager;

use crate::backend;
use crate::first_run::controller::ProvisioningController;
use crate::first_run::data_root::{configure_data_root_with_boundaries, inspect_runtime};
use crate::first_run::status::{safe_message, FirstRunError, FirstRunStatus, ProgressSnapshot};
#[cfg(windows)]
use crate::platform::windows::WindowsRegistryHandoff;
use crate::provisioning::{
    ArtifactSource, BootstrapManifest, CancellationToken, CommandProcessRunner, HealthChecker,
    ProgressEvent, ProgressSink, ProvisionDeadline, ProvisionError, ProvisionErrorCode,
    Provisioner, ProvisionerConfig,
};
use crate::runtime::RuntimeLocator;

static DOWNLOAD_NONCE: AtomicU64 = AtomicU64::new(1);

pub fn setup(app: &tauri::App) {
    app.manage(ProvisioningController::new());
}

// Production adapter: curl.exe is invoked directly (never through a shell),
// and the already-validated BootstrapManifest constrains HTTPS and hosts.
pub struct CurlArtifactSource;
impl ArtifactSource for CurlArtifactSource {
    fn fetch(
        &self,
        artifact: &crate::provisioning::ArtifactSpec,
        destination: &Path,
        deadline: &ProvisionDeadline,
        cancel: &CancellationToken,
    ) -> Result<(), ProvisionError> {
        self.fetch_with_executable("curl.exe", artifact, destination, deadline, cancel)
    }
}

impl CurlArtifactSource {
    pub fn fetch_with_executable(
        &self,
        executable: &str,
        artifact: &crate::provisioning::ArtifactSpec,
        destination: &Path,
        deadline: &ProvisionDeadline,
        cancel: &CancellationToken,
    ) -> Result<(), ProvisionError> {
        self.fetch_with_publication_hook(
            executable,
            artifact,
            destination,
            deadline,
            cancel,
            || Ok(()),
        )
    }

    pub fn fetch_with_publication_hook<F>(
        &self,
        executable: &str,
        artifact: &crate::provisioning::ArtifactSpec,
        destination: &Path,
        deadline: &ProvisionDeadline,
        cancel: &CancellationToken,
        before_publish: F,
    ) -> Result<(), ProvisionError>
    where
        F: FnOnce() -> Result<(), ProvisionError>,
    {
        self.fetch_with_publication_hooks(
            executable,
            artifact,
            destination,
            deadline,
            cancel,
            before_publish,
            |_commit| Ok(()),
        )
    }

    pub fn fetch_with_publication_hooks<F, G>(
        &self,
        executable: &str,
        artifact: &crate::provisioning::ArtifactSpec,
        destination: &Path,
        deadline: &ProvisionDeadline,
        cancel: &CancellationToken,
        before_publish: F,
        after_commit: G,
    ) -> Result<(), ProvisionError>
    where
        F: FnOnce() -> Result<(), ProvisionError>,
        G: FnOnce(&crate::provisioning::CommitGuard) -> Result<(), ProvisionError>,
    {
        if cancel.is_cancelled() {
            return Err(ProvisionError::new(
                ProvisionErrorCode::Cancelled,
                "operation cancelled",
                true,
            ));
        }
        if deadline.is_expired() {
            return Err(ProvisionError::new(
                ProvisionErrorCode::DeadlineExceeded,
                "download deadline exceeded",
                true,
            ));
        }
        let parent = destination.parent().ok_or_else(|| {
            ProvisionError::new(
                ProvisionErrorCode::DownloadFailed,
                "download destination has no parent",
                true,
            )
        })?;
        let file_name = destination
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("artifact");
        let temporary = parent.join(format!(
            ".{file_name}.download-{}-{}",
            std::process::id(),
            DOWNLOAD_NONCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_file(&temporary);

        let bundled_candidates = [
            format!("{}-{}.zip", artifact.name, artifact.version),
            format!("{}.zip", artifact.name),
            format!("{}-{}.tar.gz", artifact.name, artifact.version),
            format!("{}.tar.gz", artifact.name),
        ];
        let mut found_bundled = None;
        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                for dir in [exe_dir.join("resources"), exe_dir.to_path_buf()] {
                    for candidate in &bundled_candidates {
                        let path = dir.join(candidate);
                        if path.is_file() {
                            found_bundled = Some(path);
                            break;
                        }
                    }
                    if found_bundled.is_some() {
                        break;
                    }
                }
            }
        }

        if let Some(bundled_path) = found_bundled {
            if fs::copy(&bundled_path, &temporary).is_ok() {
                before_publish()?;
                let Some(commit) = cancel.try_begin_commit() else {
                    let _ = fs::remove_file(&temporary);
                    return Err(ProvisionError::new(
                        ProvisionErrorCode::Cancelled,
                        "operation cancelled",
                        true,
                    ));
                };
                after_commit(&commit)?;
                if commit.check_deadline(deadline).is_err() {
                    let _ = fs::remove_file(&temporary);
                    return Err(ProvisionError::new(
                        ProvisionErrorCode::DeadlineExceeded,
                        "download deadline exceeded",
                        true,
                    ));
                }
                if destination.exists() {
                    let _ = fs::remove_file(&temporary);
                    return Err(ProvisionError::new(
                        ProvisionErrorCode::DownloadFailed,
                        "download artifact destination already exists",
                        true,
                    ));
                }
                fs::rename(&temporary, destination)?;
                return Ok(());
            }
        }

        let mut child = Command::new(executable)
            .args([
                "--fail",
                "--location",
                "--silent",
                "--show-error",
                "--max-time",
            ])
            .arg(deadline.remaining_seconds().to_string())
            .args(["--output"])
            .arg(&temporary)
            .arg(&artifact.source)
            .spawn()
            .map_err(|_error| {
                let _ = fs::remove_file(&temporary);
                ProvisionError::new(
                    ProvisionErrorCode::DownloadFailed,
                    "the runtime artifact downloader could not start",
                    true,
                )
            })?;
        loop {
            if cancel.is_cancelled() {
                let _ = child.kill();
                let _ = child.wait();
                let _ = fs::remove_file(&temporary);
                return Err(ProvisionError::new(
                    ProvisionErrorCode::Cancelled,
                    "operation cancelled",
                    true,
                ));
            }
            if deadline.is_expired() {
                let _ = child.kill();
                let _ = child.wait();
                let _ = fs::remove_file(&temporary);
                return Err(ProvisionError::new(
                    ProvisionErrorCode::DeadlineExceeded,
                    "download deadline exceeded",
                    true,
                ));
            }
            match child.try_wait() {
                Ok(Some(status)) if status.success() => {
                    if deadline.is_expired() {
                        let _ = fs::remove_file(&temporary);
                        return Err(ProvisionError::new(
                            ProvisionErrorCode::DeadlineExceeded,
                            "download deadline exceeded",
                            false,
                        ));
                    }
                    before_publish()?;
                    let Some(commit) = cancel.try_begin_commit() else {
                        let _ = fs::remove_file(&temporary);
                        return Err(ProvisionError::new(
                            ProvisionErrorCode::Cancelled,
                            "operation cancelled",
                            true,
                        ));
                    };
                    after_commit(&commit)?;
                    if commit.check_deadline(deadline).is_err() {
                        let _ = fs::remove_file(&temporary);
                        return Err(ProvisionError::new(
                            ProvisionErrorCode::DeadlineExceeded,
                            "download deadline exceeded",
                            true,
                        ));
                    }
                    if destination.exists() {
                        let _ = fs::remove_file(&temporary);
                        return Err(ProvisionError::new(
                            ProvisionErrorCode::DownloadFailed,
                            "download artifact destination already exists",
                            true,
                        ));
                    }
                    if fs::rename(&temporary, destination).is_err() {
                        let _ = fs::remove_file(&temporary);
                        return Err(ProvisionError::new(
                            ProvisionErrorCode::DownloadFailed,
                            "download artifact could not be published safely",
                            true,
                        ));
                    }
                    commit.complete();
                    return Ok(());
                }
                Ok(Some(_)) => {
                    let _ = fs::remove_file(&temporary);
                    return Err(ProvisionError::new(
                        ProvisionErrorCode::DownloadFailed,
                        "HTTPS artifact download failed",
                        true,
                    ));
                }
                Ok(None) => thread::sleep(Duration::from_millis(25)),
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = fs::remove_file(&temporary);
                    return Err(ProvisionError::new(
                        ProvisionErrorCode::DownloadFailed,
                        "download process could not be monitored",
                        true,
                    ));
                }
            }
        }
    }
}

pub struct PythonHealthChecker;
impl HealthChecker for PythonHealthChecker {
    fn check(
        &self,
        project_dir: &Path,
        python_executable: &Path,
        env: &BTreeMap<String, String>,
        cancel: &CancellationToken,
        deadline: &ProvisionDeadline,
    ) -> Result<(), ProvisionError> {
        deadline.check(cancel)?;
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|_| {
            ProvisionError::new(
                ProvisionErrorCode::HealthCheckFailed,
                "health probe unavailable",
                true,
            )
        })?;
        let port = listener
            .local_addr()
            .map_err(|_| {
                ProvisionError::new(
                    ProvisionErrorCode::HealthCheckFailed,
                    "health probe unavailable",
                    true,
                )
            })?
            .port();
        drop(listener);
        let mut child = Command::new(python_executable)
            .args([
                "-m",
                "uvicorn",
                "opencohost.api.main:app",
                "--host",
                "127.0.0.1",
                "--port",
            ])
            .arg(port.to_string())
            .current_dir(project_dir)
            .env_clear()
            .envs(env)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|_| {
                ProvisionError::new(
                    ProvisionErrorCode::HealthCheckFailed,
                    "health process could not start",
                    true,
                )
            })?;
        let result = loop {
            if let Err(error) = deadline.check(cancel) {
                let _ = child.kill();
                let _ = child.wait();
                break Err(error);
            }
            if let Ok(Some(_)) = child.try_wait() {
                let mut stderr = String::new();
                if let Some(mut pipe) = child.stderr.take() {
                    let _ = pipe.read_to_string(&mut stderr);
                }
                let _ = child.wait();
                let detail = stderr.trim().to_owned();
                break Err(ProvisionError::new(
                    ProvisionErrorCode::HealthCheckFailed,
                    if detail.is_empty() {
                        "health process exited before becoming ready".into()
                    } else {
                        format!("health process exited before becoming ready: {detail}")
                    },
                    true,
                ));
            }
            if let Ok(mut stream) = std::net::TcpStream::connect_timeout(
                &format!("127.0.0.1:{port}").parse().unwrap(),
                Duration::from_millis(100),
            ) {
                let _ = stream.set_read_timeout(Some(Duration::from_millis(100)));
                let _ = stream.write_all(
                    b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
                );
                let mut body = String::new();
                let _ = stream.read_to_string(&mut body);
                if body.contains("\"status\":\"ok\"") {
                    break Ok(());
                }
            }
            thread::sleep(Duration::from_millis(50));
        };
        let _ = child.kill();
        let _ = child.wait();
        result
    }
}

pub struct ControllerProgress {
    pub callback: Arc<dyn Fn(ProgressSnapshot) + Send + Sync>,
}
impl ProgressSink for ControllerProgress {
    fn report(&mut self, event: ProgressEvent) {
        drop(event.message);
        (self.callback)(ProgressSnapshot {
            phase: format!("{:?}", event.phase).to_ascii_lowercase(),
            completed: event.completed,
            total: event.total,
            message: format!("{:?}", event.phase).to_ascii_lowercase(),
        });
    }
}

pub fn production_task(
    data_root: PathBuf,
    install_id: String,
    bootstrap: BootstrapManifest,
) -> impl FnOnce(
    CancellationToken,
    Arc<dyn Fn(ProgressSnapshot) + Send + Sync>,
) -> Result<(), FirstRunError>
       + Send
       + 'static {
    move |cancel, callback| {
        let config = ProvisionerConfig {
            data_root,
            install_id,
            app_module: "opencohost.api.main:app".into(),
            preferred_port: 8765,
            fallback_port: 8770,
            bootstrap,
            max_download_retries: 3,
            retry_backoff: Duration::from_secs(2),
            python_executable_name: "python.exe".into(),
            operation_timeout: Duration::from_secs(30 * 60),
        };
        Provisioner::new(
            config,
            CurlArtifactSource,
            CommandProcessRunner,
            PythonHealthChecker,
            ControllerProgress { callback },
        )
        .provision_first_install(cancel)
        .map(|_| ())
        .map_err(|error| {
            FirstRunError::new(error.code().as_str(), error.to_string(), error.retryable())
        })
    }
}

#[cfg(windows)]
pub fn current_handoff() -> WindowsRegistryHandoff {
    WindowsRegistryHandoff
}

#[cfg(not(windows))]
pub fn current_handoff() {}

pub fn install_boundaries(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, FirstRunError> {
    let mut boundaries = Vec::new();
    let executable = std::env::current_exe().map_err(|_| {
        FirstRunError::new(
            "install_boundary_unavailable",
            "application install boundary is unavailable",
            false,
        )
    })?;
    if let Some(parent) = executable.parent() {
        boundaries.push(parent.to_path_buf());
    }
    let resource_dir = app.path().resource_dir().map_err(|_| {
        FirstRunError::new(
            "install_boundary_unavailable",
            "application resource boundary is unavailable",
            false,
        )
    })?;
    boundaries.push(resource_dir);
    Ok(boundaries)
}

pub fn bootstrap_from_resource(resource_dir: &Path) -> Result<BootstrapManifest, FirstRunError> {
    let path = resource_dir.join("bootstrap-manifest.json");
    let text = fs::read_to_string(&path).map_err(|_| {
        FirstRunError::new(
            "bootstrap_unavailable",
            "The packaged core runtime manifest is missing; repair the installation",
            false,
        )
    })?;
    serde_json::from_str(&text).map_err(|_| {
        FirstRunError::new(
            "bootstrap_invalid",
            "The packaged core runtime manifest is invalid",
            false,
        )
    })
}

pub fn first_run_status() -> FirstRunStatus {
    #[cfg(windows)]
    {
        inspect_runtime(&current_handoff())
    }
    #[cfg(not(windows))]
    {
        status(
            FirstRunPhase::Unconfigured,
            None,
            None,
            "Installed runtime is supported on Windows",
            false,
            None,
            Some("unsupported_platform"),
        )
    }
}

pub fn provision_status(controller: tauri::State<ProvisioningController>) -> FirstRunStatus {
    controller.status()
}

pub fn provision_cancel(
    controller: tauri::State<ProvisioningController>,
) -> Result<FirstRunStatus, String> {
    controller
        .cancel()
        // Return only the stable code; the UI owns localized wording and never
        // receives the internal error detail.
        .map_err(|error| error.code)?;
    Ok(controller.status())
}

pub fn provision_start(
    app: tauri::AppHandle,
    data_root: String,
    controller: tauri::State<ProvisioningController>,
) -> Result<FirstRunStatus, String> {
    #[cfg(not(windows))]
    {
        let _ = (app, data_root, controller);
        return Err(safe_message("unsupported_platform").into());
    }
    #[cfg(windows)]
    {
        let writer = current_handoff();
        let boundaries = install_boundaries(&app).map_err(|error| safe_message(&error.code))?;
        let configured =
            configure_data_root_with_boundaries(&writer, Path::new(&data_root), None, &boundaries)
                .map_err(|error| safe_message(&error.code).to_owned())?;
        let bootstrap = bootstrap_from_resource(
            &app.path()
                .resource_dir()
                .map_err(|_| safe_message("bootstrap_unavailable"))?,
        )
        .map_err(|error| safe_message(&error.code).to_owned())?;
        let app_handle = app.clone();
        let task = production_task(configured.data_root, configured.install_id, bootstrap);
        controller
            .start_with_task(move |cancel, progress| {
                let result = task(cancel, progress);
                if result.is_ok() {
                    backend::reload_backend(&app_handle).map_err(|error| {
                        FirstRunError::new("backend_launch_failed", error, true)
                    })?;
                }
                result
            })
            .map_err(|error| safe_message(&error.code).to_owned())?;
        Ok(controller.status())
    }
}

pub fn provision_retry(
    app: tauri::AppHandle,
    controller: tauri::State<ProvisioningController>,
) -> Result<FirstRunStatus, String> {
    #[cfg(not(windows))]
    {
        let _ = (app, controller);
        return Err(safe_message("unsupported_platform").into());
    }
    #[cfg(windows)]
    {
        let locator = RuntimeLocator::from_handoff(&current_handoff())
            .map_err(|_| safe_message("invalid_handoff").to_owned())?;
        provision_start(
            app,
            locator.data_root.to_string_lossy().into_owned(),
            controller,
        )
    }
}
