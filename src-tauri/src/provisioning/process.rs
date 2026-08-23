use crate::provisioning::archive::contained;
use crate::provisioning::cancellation::CancellationToken;
use crate::provisioning::error::{ProvisionDeadline, ProvisionError, ProvisionErrorCode};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Clone, Default)]
pub struct ProcessOutput {
    pub status: i32,
    pub stdout: String,
    pub stderr: String,
}

pub trait ProcessRunner {
    fn run(
        &self,
        program: &Path,
        args: &[String],
        cwd: &Path,
        env: &BTreeMap<String, String>,
        cancel: &CancellationToken,
        deadline: &ProvisionDeadline,
    ) -> Result<ProcessOutput, ProvisionError>;
}

pub struct CommandProcessRunner;
impl ProcessRunner for CommandProcessRunner {
    fn run(
        &self,
        program: &Path,
        args: &[String],
        cwd: &Path,
        env: &BTreeMap<String, String>,
        cancel: &CancellationToken,
        deadline: &ProvisionDeadline,
    ) -> Result<ProcessOutput, ProvisionError> {
        #[cfg(windows)]
        return self.run_with_job_assigner(
            program,
            args,
            cwd,
            env,
            cancel,
            deadline,
            WindowsJob::assign,
        );

        #[cfg(not(windows))]
        {
            deadline.check(cancel)?;
            let mut child = std::process::Command::new(program)
                .args(args)
                .current_dir(cwd)
                .env_clear()
                .envs(env)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .map_err(|error| {
                    ProvisionError::new(ProvisionErrorCode::ProcessFailed, error.to_string(), true)
                })?;
            loop {
                if let Err(error) = deadline.check(cancel) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
                if child
                    .try_wait()
                    .map_err(|error| {
                        ProvisionError::new(
                            ProvisionErrorCode::ProcessFailed,
                            error.to_string(),
                            true,
                        )
                    })?
                    .is_some()
                {
                    break;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            let output = child.wait_with_output().map_err(|error| {
                ProvisionError::new(ProvisionErrorCode::ProcessFailed, error.to_string(), true)
            })?;
            Ok(ProcessOutput {
                status: output.status.code().unwrap_or(-1),
                stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            })
        }
    }
}

#[cfg(windows)]
impl CommandProcessRunner {
    pub(crate) fn run_with_job_assigner<F>(
        &self,
        program: &Path,
        args: &[String],
        cwd: &Path,
        env: &BTreeMap<String, String>,
        cancel: &CancellationToken,
        deadline: &ProvisionDeadline,
        assigner: F,
    ) -> Result<ProcessOutput, ProvisionError>
    where
        F: FnOnce(&std::process::Child) -> Result<WindowsJob, ()>,
    {
        deadline.check(cancel)?;
        let mut child = std::process::Command::new(program)
            .args(args)
            .current_dir(cwd)
            .env_clear()
            .envs(env)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|error| {
                ProvisionError::new(ProvisionErrorCode::ProcessFailed, error.to_string(), true)
            })?;
        let job = match assigner(&child) {
            Ok(job) => job,
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(ProvisionError::new(
                    ProvisionErrorCode::ProcessIsolationFailed,
                    "kill-on-close Job Object could not be established",
                    false,
                ));
            }
        };
        loop {
            if let Err(error) = deadline.check(cancel) {
                job.kill_tree();
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
            if child
                .try_wait()
                .map_err(|error| {
                    ProvisionError::new(ProvisionErrorCode::ProcessFailed, error.to_string(), true)
                })?
                .is_some()
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        let output = child.wait_with_output().map_err(|error| {
            ProvisionError::new(ProvisionErrorCode::ProcessFailed, error.to_string(), true)
        })?;
        Ok(ProcessOutput {
            status: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

#[cfg(windows)]
pub(crate) struct WindowsJob(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl WindowsJob {
    pub(crate) fn assign(child: &std::process::Child) -> Result<Self, ()> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() || job == INVALID_HANDLE_VALUE {
                return Err(());
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            ) == 0
                || AssignProcessToJobObject(
                    job,
                    child.as_raw_handle() as windows_sys::Win32::Foundation::HANDLE,
                ) == 0
            {
                windows_sys::Win32::Foundation::CloseHandle(job);
                return Err(());
            }
            Ok(Self(job))
        }
    }
    pub(crate) fn kill_tree(&self) {
        unsafe {
            let _ = windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0, 1);
        }
    }
}

#[cfg(windows)]
impl Drop for WindowsJob {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

pub fn build_child_environment(
    inherited: &BTreeMap<String, String>,
    root: &Path,
) -> Result<BTreeMap<String, String>, ProvisionError> {
    let mut env = BTreeMap::new();
    for (key, value) in inherited {
        let upper = key.to_ascii_uppercase();
        let allowed = matches!(
            upper.as_str(),
            "SYSTEMROOT"
                | "WINDIR"
                | "TEMP"
                | "TMP"
                | "LOCALAPPDATA"
                | "APPDATA"
                | "USERPROFILE"
                | "OPENCOHOST_DATA_ROOT"
        );
        if allowed {
            env.insert(key.clone(), value.clone());
        }
    }
    env.insert(
        "UV_PYTHON_INSTALL_DIR".into(),
        root.join("python").to_string_lossy().into_owned(),
    );
    env.insert(
        "UV_PROJECT_ENVIRONMENT".into(),
        root.join("venv").to_string_lossy().into_owned(),
    );
    env.insert(
        "UV_CACHE_DIR".into(),
        root.join("cache").to_string_lossy().into_owned(),
    );
    Ok(env)
}

pub fn build_uv_python_install_args(version: &str, install_dir: &Path) -> Vec<String> {
    vec![
        "python".into(),
        "install".into(),
        "--managed-python".into(),
        "--no-registry".into(),
        "--no-bin".into(),
        "--no-config".into(),
        "--install-dir".into(),
        install_dir.to_string_lossy().into_owned(),
        version.into(),
    ]
}

pub fn build_uv_find_args(version: &str) -> Vec<String> {
    vec![
        "python".into(),
        "find".into(),
        "--managed-python".into(),
        "--no-project".into(),
        "--no-config".into(),
        version.into(),
    ]
}

pub fn resolve_managed_python_path(
    output: &ProcessOutput,
    managed_root: &Path,
) -> Result<PathBuf, ProvisionError> {
    if output.status != 0 {
        return Err(ProvisionError::new(
            ProvisionErrorCode::ProcessFailed,
            "uv python find failed",
            true,
        ));
    }
    let lines = output
        .stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    // uv may emit a progress/info line on stdout in addition to the final
    // interpreter path. Only one absolute path is accepted; all other output
    // remains non-authoritative diagnostics.
    let paths = lines
        .iter()
        .filter(|line| Path::new(**line).is_absolute())
        .copied()
        .collect::<Vec<_>>();
    if paths.len() != 1 {
        return Err(ProvisionError::new(
            ProvisionErrorCode::ProcessFailed,
            "uv python find returned malformed output",
            false,
        ));
    }
    let path = PathBuf::from(paths[0]);
    if !path.is_absolute() || !path.is_file() {
        return Err(ProvisionError::new(
            ProvisionErrorCode::ProcessFailed,
            "uv python find did not return an existing absolute interpreter",
            false,
        ));
    }
    let root = fs::canonicalize(managed_root)?;
    let canonical = fs::canonicalize(&path)?;
    if !contained(&root, &canonical) {
        return Err(ProvisionError::new(
            ProvisionErrorCode::ProcessFailed,
            "uv python find escaped the managed Python root",
            false,
        ));
    }
    Ok(canonical)
}

pub fn build_uv_sync_args(project: &Path, python: &Path) -> Vec<String> {
    vec![
        "sync".into(),
        "--locked".into(),
        "--no-editable".into(),
        "--no-config".into(),
        "--project".into(),
        project.to_string_lossy().into_owned(),
        "--python".into(),
        python.to_string_lossy().into_owned(),
        "--managed-python".into(),
    ]
}

pub fn is_successor_venv_interpreter(candidate: &Path, managed_base: &Path) -> bool {
    let text = candidate
        .to_string_lossy()
        .to_ascii_lowercase()
        .replace('\\', "/");
    candidate.is_absolute() && candidate != managed_base && text.contains("/venv/")
}
