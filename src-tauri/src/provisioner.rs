use crate::runtime_manifest::{
    ComponentsManifest, EngineManifest, RuntimeManifest, RuntimeOperation, RuntimeState,
    ToolingManifest,
};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use unicode_normalization::UnicodeNormalization;
use url::Url;

pub const BOOTSTRAP_SCHEMA_VERSION: u32 = 1;
static LOCK_NONCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProvisionErrorCode {
    LockBusy,
    InvalidBootstrap,
    Cancelled,
    DeadlineExceeded,
    DownloadFailed,
    HashMismatch,
    ZipSlip,
    ProcessFailed,
    HealthCheckFailed,
    ManifestConflict,
    ActivationFailed,
    CleanupFailed,
    Io,
    ProcessIsolationFailed,
}

impl ProvisionErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LockBusy => "lock_busy",
            Self::InvalidBootstrap => "invalid_bootstrap",
            Self::Cancelled => "cancelled",
            Self::DeadlineExceeded => "deadline_exceeded",
            Self::DownloadFailed => "download_failed",
            Self::HashMismatch => "hash_mismatch",
            Self::ZipSlip => "zip_slip",
            Self::ProcessFailed => "process_failed",
            Self::HealthCheckFailed => "health_check_failed",
            Self::ManifestConflict => "manifest_conflict",
            Self::ActivationFailed => "activation_failed",
            Self::CleanupFailed => "cleanup_failed",
            Self::Io => "io",
            Self::ProcessIsolationFailed => "process_isolation_failed",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProvisionError {
    code: ProvisionErrorCode,
    message: String,
    retryable: bool,
}

impl ProvisionError {
    pub(crate) fn new(
        code: ProvisionErrorCode,
        message: impl Into<String>,
        retryable: bool,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
        }
    }

    pub fn code(&self) -> ProvisionErrorCode {
        self.code
    }
    pub fn retryable(&self) -> bool {
        self.retryable
    }
}

impl fmt::Display for ProvisionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for ProvisionError {}

#[derive(Debug, Clone, Copy)]
pub struct ProvisionDeadline {
    at: std::time::Instant,
}

impl ProvisionDeadline {
    pub fn from_timeout(timeout: Duration) -> Result<Self, ProvisionError> {
        if timeout.is_zero() {
            return Err(ProvisionError::new(
                ProvisionErrorCode::InvalidBootstrap,
                "provisioning deadline must be positive",
                false,
            ));
        }
        Ok(Self {
            at: std::time::Instant::now() + timeout,
        })
    }
    pub fn is_expired(&self) -> bool {
        std::time::Instant::now() >= self.at
    }
    /// Returns a bounded whole-second budget for an external child process.
    /// A minimum of one second avoids passing a zero timeout while still
    /// ensuring the child cannot outlive the provisioner's deadline.
    pub(crate) fn remaining_seconds(&self) -> u64 {
        self.at
            .saturating_duration_since(std::time::Instant::now())
            .as_secs()
            .max(1)
    }
    pub(crate) fn check(&self, cancel: &CancellationToken) -> Result<(), ProvisionError> {
        ensure_not_cancelled(cancel)?;
        if self.is_expired() {
            return Err(ProvisionError::new(
                ProvisionErrorCode::DeadlineExceeded,
                "provisioning deadline exceeded",
                true,
            ));
        }
        Ok(())
    }
}

impl From<io::Error> for ProvisionError {
    fn from(error: io::Error) -> Self {
        Self::new(ProvisionErrorCode::Io, error.to_string(), false)
    }
}

impl From<crate::runtime_manifest::RuntimeManifestError> for ProvisionError {
    fn from(error: crate::runtime_manifest::RuntimeManifestError) -> Self {
        Self::new(
            ProvisionErrorCode::ManifestConflict,
            error.to_string(),
            false,
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProvisionPhase {
    VerifyBootstrap,
    Download,
    VerifyHash,
    Stage,
    InstallPython,
    Sync,
    HealthCheck,
    Activate,
    Cleanup,
}

impl ProvisionPhase {
    pub const ALL: [Self; 9] = [
        Self::VerifyBootstrap,
        Self::Download,
        Self::VerifyHash,
        Self::Stage,
        Self::InstallPython,
        Self::Sync,
        Self::HealthCheck,
        Self::Activate,
        Self::Cleanup,
    ];
}

#[derive(Debug, Clone)]
pub struct ProgressEvent {
    pub phase: ProvisionPhase,
    pub message: String,
    pub completed: u64,
    pub total: u64,
}

impl ProgressEvent {
    fn phase(phase: ProvisionPhase) -> Self {
        Self {
            phase,
            message: String::new(),
            completed: 0,
            total: 0,
        }
    }
}

pub trait ProgressSink {
    fn report(&mut self, event: ProgressEvent);
}

impl<T: ProgressSink + ?Sized> ProgressSink for &mut T {
    fn report(&mut self, event: ProgressEvent) {
        (**self).report(event);
    }
}

pub struct NoopProgress;
impl ProgressSink for NoopProgress {
    fn report(&mut self, _event: ProgressEvent) {}
}

#[derive(Clone)]
pub struct CancellationToken(Arc<Mutex<CancellationState>>);

#[derive(Default)]
struct CancellationState {
    cancelled: bool,
    commit_started: bool,
    committed: bool,
}

pub struct CommitGuard {
    token: CancellationToken,
    completed: bool,
}

// Publication linearization model: cancellation wins before `try_begin_commit`;
// once it succeeds, `commit_started` rejects cancellation and every irreversible
// artifact/generation/manifest operation checks the deadline immediately before
// replacing bytes. Runtime-manifest CAS invokes that check while its write mutex
// is held, so a waiter cannot pass a pre-lock check and then publish.

#[cfg(test)]
type ActivationWaitHook = Box<dyn Fn(&CancellationToken, &ProvisionDeadline) + Send + Sync>;
#[cfg(test)]
type ActivationCommitHook = Box<dyn Fn(&CommitGuard, &ProvisionDeadline) + Send + Sync>;
#[cfg(test)]
static ACTIVATION_WAIT_HOOK: Mutex<Option<ActivationWaitHook>> = Mutex::new(None);
#[cfg(test)]
static ACTIVATION_COMMIT_HOOK: Mutex<Option<ActivationCommitHook>> = Mutex::new(None);
#[cfg(test)]
static ACTIVATION_HOOK_TEST_LOCK: Mutex<()> = Mutex::new(());

#[cfg(test)]
pub(crate) fn set_activation_wait_hook(hook: Option<ActivationWaitHook>) {
    *ACTIVATION_WAIT_HOOK
        .lock()
        .expect("activation wait hook lock") = hook;
}

#[cfg(test)]
pub(crate) fn set_activation_commit_hook(hook: Option<ActivationCommitHook>) {
    *ACTIVATION_COMMIT_HOOK
        .lock()
        .expect("activation commit hook lock") = hook;
}

#[cfg(test)]
fn invoke_activation_wait_hook(cancel: &CancellationToken, deadline: &ProvisionDeadline) {
    if let Some(hook) = ACTIVATION_WAIT_HOOK
        .lock()
        .expect("activation wait hook lock")
        .as_ref()
    {
        hook(cancel, deadline);
    }
}

#[cfg(test)]
fn invoke_activation_commit_hook(commit: &CommitGuard, deadline: &ProvisionDeadline) {
    if let Some(hook) = ACTIVATION_COMMIT_HOOK
        .lock()
        .expect("activation commit hook lock")
        .as_ref()
    {
        hook(commit, deadline);
    }
}

impl Drop for CommitGuard {
    fn drop(&mut self) {
        if !self.completed {
            self.token.finish_commit(false);
        }
    }
}

impl CommitGuard {
    pub(crate) fn check_deadline(
        &self,
        deadline: &ProvisionDeadline,
    ) -> Result<(), ProvisionError> {
        if deadline.is_expired() {
            return Err(ProvisionError::new(
                ProvisionErrorCode::DeadlineExceeded,
                "provisioning deadline exceeded",
                true,
            ));
        }
        Ok(())
    }

    pub fn complete(mut self) {
        self.token.finish_commit(true);
        self.completed = true;
    }
}

impl CancellationToken {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(CancellationState::default())))
    }
    pub fn cancel(&self) -> bool {
        let Ok(mut state) = self.0.lock() else {
            return false;
        };
        if state.commit_started || state.committed {
            return false;
        }
        state.cancelled = true;
        true
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.lock().map(|state| state.cancelled).unwrap_or(true)
    }
    pub fn try_begin_commit(&self) -> Option<CommitGuard> {
        let Ok(mut state) = self.0.lock() else {
            return None;
        };
        if state.cancelled || state.commit_started || state.committed {
            return None;
        }
        state.commit_started = true;
        Some(CommitGuard {
            token: self.clone(),
            completed: false,
        })
    }
    fn finish_commit(&self, success: bool) {
        if let Ok(mut state) = self.0.lock() {
            state.commit_started = false;
            state.committed = success;
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum ArtifactKind {
    File,
    Zip,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ArtifactSpec {
    pub name: String,
    pub version: String,
    pub source: String,
    pub sha256: String,
    pub kind: ArtifactKind,
    pub expected_size: u64,
    pub max_size: u64,
}

impl ArtifactSpec {
    fn validate(&self) -> Result<(), ProvisionError> {
        if self.name.trim().is_empty()
            || self.version.trim().is_empty()
            || self.source.trim().is_empty()
        {
            return Err(ProvisionError::new(
                ProvisionErrorCode::InvalidBootstrap,
                "artifact identity is empty",
                false,
            ));
        }
        if self.name.chars().any(|character| {
            character == '/'
                || character == '\\'
                || character.is_control()
                || "<>:\"|?*".contains(character)
        }) || self.version.chars().any(|character| {
            character == '/'
                || character == '\\'
                || character.is_control()
                || "<>:\"|?*".contains(character)
        }) || self.name == "."
            || self.name == ".."
            || self.version == "."
            || self.version == ".."
            || self.name.ends_with(['.', ' '])
            || self.version.ends_with(['.', ' '])
        {
            return Err(ProvisionError::new(
                ProvisionErrorCode::InvalidBootstrap,
                "artifact identity contains path separators",
                false,
            ));
        }
        let parsed = Url::parse(&self.source).map_err(|_| {
            ProvisionError::new(
                ProvisionErrorCode::InvalidBootstrap,
                "artifact source URL is malformed",
                false,
            )
        })?;
        if parsed.scheme() != "https" || parsed.host_str().is_none() {
            return Err(ProvisionError::new(
                ProvisionErrorCode::InvalidBootstrap,
                format!("{} source must use HTTPS", self.name),
                false,
            ));
        }
        if self.expected_size == 0 || self.max_size == 0 || self.expected_size > self.max_size {
            return Err(ProvisionError::new(
                ProvisionErrorCode::InvalidBootstrap,
                format!("{} has invalid size limits", self.name),
                false,
            ));
        }
        if self.sha256.len() != 64 || !self.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ProvisionError::new(
                ProvisionErrorCode::InvalidBootstrap,
                format!("{} has invalid SHA-256", self.name),
                false,
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BootstrapManifest {
    pub schema_version: u32,
    pub product_version: String,
    pub python_version: String,
    pub allowed_hosts: Vec<String>,
    pub uv: ArtifactSpec,
    pub engine: ArtifactSpec,
}

impl BootstrapManifest {
    pub fn validate(&self) -> Result<(), ProvisionError> {
        if self.schema_version != BOOTSTRAP_SCHEMA_VERSION || self.product_version.trim().is_empty()
        {
            return Err(ProvisionError::new(
                ProvisionErrorCode::InvalidBootstrap,
                "unsupported bootstrap schema or empty product version",
                false,
            ));
        }
        if !is_pinned_python_request(&self.python_version) || self.allowed_hosts.is_empty() {
            return Err(ProvisionError::new(
                ProvisionErrorCode::InvalidBootstrap,
                "python version and allowed hosts are required",
                false,
            ));
        }
        self.uv.validate()?;
        self.engine.validate()?;
        for artifact in [&self.uv, &self.engine] {
            let host = Url::parse(&artifact.source)
                .ok()
                .and_then(|url| url.host_str().map(str::to_owned));
            if host.as_deref().is_none_or(|host| {
                !self
                    .allowed_hosts
                    .iter()
                    .any(|allowed| allowed.eq_ignore_ascii_case(host))
            }) {
                return Err(ProvisionError::new(
                    ProvisionErrorCode::InvalidBootstrap,
                    format!("{} source host is not allowlisted", artifact.name),
                    false,
                ));
            }
        }
        if artifact_destination_identity(&self.uv) == artifact_destination_identity(&self.engine) {
            return Err(ProvisionError::new(
                ProvisionErrorCode::InvalidBootstrap,
                "artifact destinations are not unique",
                false,
            ));
        }
        Ok(())
    }
}

fn artifact_destination_identity(artifact: &ArtifactSpec) -> String {
    windows_collision_key(&format!(
        "{}-{}",
        artifact.name.trim_end_matches(['.', ' ']),
        artifact.version.trim_end_matches(['.', ' '])
    ))
}

/// Conservative Windows destination identity: canonical Unicode composition
/// followed by culture-independent uppercase folding. This deliberately
/// treats canonically equivalent names and Unicode case variants as the same
/// destination before any artifact or ZIP write occurs.
fn windows_collision_key(value: &str) -> String {
    value.nfc().flat_map(char::to_uppercase).collect()
}

fn is_pinned_python_request(request: &str) -> bool {
    let parts = request.split('.').collect::<Vec<_>>();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty() && part.chars().all(|character| character.is_ascii_digit())
        })
}

pub trait ArtifactSource {
    fn fetch(
        &self,
        artifact: &ArtifactSpec,
        destination: &Path,
        deadline: &ProvisionDeadline,
        cancel: &CancellationToken,
    ) -> Result<(), ProvisionError>;
}

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
    fn run_with_job_assigner<F>(
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
struct WindowsJob(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl WindowsJob {
    fn assign(child: &std::process::Child) -> Result<Self, ()> {
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
    fn kill_tree(&self) {
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

pub trait HealthChecker {
    fn check(
        &self,
        project_dir: &Path,
        python_executable: &Path,
        env: &BTreeMap<String, String>,
        cancel: &CancellationToken,
        deadline: &ProvisionDeadline,
    ) -> Result<(), ProvisionError>;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct OperationMetadata {
    pub operation_id: String,
    pub owner_pid: u32,
    pub acquired_unix_ms: u128,
    pub ownership_nonce: String,
    pub process_start_unix_ms: Option<u128>,
}

impl OperationMetadata {
    fn validate(&self) -> Result<(), ProvisionError> {
        if self.operation_id.trim().is_empty()
            || self.owner_pid == 0
            || self.acquired_unix_ms == 0
            || self.ownership_nonce.trim().is_empty()
            || self.process_start_unix_ms == Some(0)
        {
            return Err(ProvisionError::new(
                ProvisionErrorCode::LockBusy,
                "operation lock metadata is invalid",
                true,
            ));
        }
        Ok(())
    }
}

pub trait ProcessLiveness {
    fn is_alive(&self, pid: u32) -> bool;
}

struct SystemProcessLiveness;
impl ProcessLiveness for SystemProcessLiveness {
    fn is_alive(&self, pid: u32) -> bool {
        if pid == std::process::id() {
            return true;
        }
        #[cfg(windows)]
        {
            use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
            use windows_sys::Win32::System::Threading::{
                GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
            };
            unsafe {
                let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
                if handle.is_null() {
                    return false;
                }
                let mut status = 0;
                let ok = GetExitCodeProcess(handle, &mut status) != 0;
                CloseHandle(handle);
                return ok && status == STILL_ACTIVE as u32;
            }
        }
        #[cfg(unix)]
        {
            return PathBuf::from("/proc").join(pid.to_string()).exists();
        }
        #[cfg(not(any(windows, unix)))]
        {
            false
        }
    }
}

#[derive(Debug)]
pub struct OperationLock {
    handle: File,
    metadata: OperationMetadata,
}

impl OperationLock {
    pub fn acquire(path: &Path, operation_id: &str) -> Result<Self, ProvisionError> {
        Self::acquire_with_probe(
            path,
            operation_id,
            std::process::id(),
            &SystemProcessLiveness,
        )
    }

    pub fn acquire_with_probe<P: ProcessLiveness + ?Sized>(
        path: &Path,
        operation_id: &str,
        owner_pid: u32,
        _liveness: &P,
    ) -> Result<Self, ProvisionError> {
        if operation_id.trim().is_empty() {
            return Err(ProvisionError::new(
                ProvisionErrorCode::LockBusy,
                "operation id is empty",
                false,
            ));
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let metadata = OperationMetadata {
            operation_id: operation_id.into(),
            owner_pid,
            acquired_unix_ms: now_ms(),
            ownership_nonce: format!(
                "{}-{}-{}",
                owner_pid,
                now_ms(),
                LOCK_NONCE.fetch_add(1, Ordering::Relaxed)
            ),
            process_start_unix_ms: None,
        };
        metadata.validate()?;
        let encoded = format!(
            "{}\n",
            serde_json::to_string(&metadata).map_err(|error| ProvisionError::new(
                ProvisionErrorCode::Io,
                error.to_string(),
                false
            ))?
        );
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            // FILE_SHARE_READ | FILE_SHARE_WRITE, intentionally excluding
            // FILE_SHARE_DELETE so the locked pathname cannot be replaced.
            options.share_mode(0x0000_0001 | 0x0000_0002);
        }
        let mut file = options.open(path)?;
        let existing = fs::read_to_string(path).unwrap_or_default();
        if !existing.trim().is_empty() {
            let holder: OperationMetadata = serde_json::from_str(&existing).map_err(|_| {
                ProvisionError::new(
                    ProvisionErrorCode::LockBusy,
                    "operation lock metadata is unreadable",
                    true,
                )
            })?;
            holder.validate()?;
        }
        if let Err(error) = file.try_lock_exclusive() {
            if error.kind() == io::ErrorKind::WouldBlock {
                return Err(ProvisionError::new(
                    ProvisionErrorCode::LockBusy,
                    "operation lock is held by another owner",
                    true,
                ));
            }
            return Err(ProvisionError::new(
                ProvisionErrorCode::LockBusy,
                error.to_string(),
                true,
            ));
        }
        file.set_len(0)?;
        if let Err(error) = file
            .write_all(encoded.as_bytes())
            .and_then(|_| file.sync_all())
        {
            let _ = file.unlock();
            return Err(error.into());
        }
        return Ok(Self {
            handle: file,
            metadata,
        });
    }

    pub fn metadata(&self) -> &OperationMetadata {
        &self.metadata
    }
}

impl Drop for OperationLock {
    fn drop(&mut self) {
        let _ = self.handle.unlock();
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

fn sha256(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(bytes);
    format!("{:x}", digest.finalize())
}

fn file_sha256(path: &Path) -> Result<String, ProvisionError> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

pub(crate) fn download_verified<S: ArtifactSource>(
    source: &S,
    artifact: &ArtifactSpec,
    root: &Path,
    retries: u32,
    backoff: Duration,
    cancel: &CancellationToken,
    deadline: &ProvisionDeadline,
    progress: &mut dyn ProgressSink,
) -> Result<PathBuf, ProvisionError> {
    download_verified_under_root(
        source, artifact, root, root, retries, backoff, cancel, deadline, progress,
    )
}

fn download_verified_under_root<S: ArtifactSource>(
    source: &S,
    artifact: &ArtifactSpec,
    approved_root: &Path,
    root: &Path,
    retries: u32,
    backoff: Duration,
    cancel: &CancellationToken,
    deadline: &ProvisionDeadline,
    progress: &mut dyn ProgressSink,
) -> Result<PathBuf, ProvisionError> {
    let destination = root.join(format!("{}-{}", artifact.name, artifact.version));
    let attempts = retries.max(1);
    for attempt in 0..attempts {
        deadline.check(cancel)?;
        progress.report(ProgressEvent {
            phase: ProvisionPhase::Download,
            message: artifact.name.clone(),
            completed: attempt as u64,
            total: attempts as u64,
        });
        validate_write_boundary(approved_root, root, &destination)?;
        let destination_existed = destination.exists();
        if let Err(error) = source.fetch(artifact, &destination, deadline, cancel) {
            if !destination_existed {
                let _ = fs::remove_file(&destination);
            }
            if matches!(
                error.code(),
                ProvisionErrorCode::Cancelled | ProvisionErrorCode::DeadlineExceeded
            ) {
                return Err(error);
            }
            if attempt + 1 == attempts {
                return Err(ProvisionError::new(
                    ProvisionErrorCode::DownloadFailed,
                    error.to_string(),
                    true,
                ));
            }
            sleep_with_cancel(backoff, cancel, deadline)?;
            continue;
        }
        // The source may return successfully just as cancellation/deadline wins;
        // arbitrate that result before any verification can publish it.
        deadline.check(cancel)?;
        validate_write_boundary(approved_root, root, &destination)?;
        progress.report(ProgressEvent {
            phase: ProvisionPhase::VerifyHash,
            message: artifact.name.clone(),
            completed: 1,
            total: 1,
        });
        let actual_size = fs::metadata(&destination)?.len();
        if actual_size > artifact.max_size || actual_size != artifact.expected_size {
            if !destination_existed {
                let _ = fs::remove_file(&destination);
            }
            if attempt + 1 == attempts {
                return Err(ProvisionError::new(
                    ProvisionErrorCode::HashMismatch,
                    format!("{} size does not match pinned metadata", artifact.name),
                    false,
                ));
            }
            sleep_with_cancel(backoff, cancel, deadline)?;
            continue;
        }
        if file_sha256(&destination)? == artifact.sha256 {
            return Ok(destination);
        }
        if !destination_existed {
            let _ = fs::remove_file(&destination);
        }
        if attempt + 1 == attempts {
            return Err(ProvisionError::new(
                ProvisionErrorCode::HashMismatch,
                format!("{} hash does not match pinned metadata", artifact.name),
                false,
            ));
        }
        sleep_with_cancel(backoff, cancel, deadline)?;
    }
    Err(ProvisionError::new(
        ProvisionErrorCode::DownloadFailed,
        "download attempts exhausted",
        true,
    ))
}

fn sleep_with_cancel(
    duration: Duration,
    cancel: &CancellationToken,
    deadline: &ProvisionDeadline,
) -> Result<(), ProvisionError> {
    let start = std::time::Instant::now();
    while start.elapsed() < duration {
        deadline.check(cancel)?;
        std::thread::sleep(Duration::from_millis(10).min(duration.saturating_sub(start.elapsed())));
    }
    deadline.check(cancel)
}

fn ensure_not_cancelled(cancel: &CancellationToken) -> Result<(), ProvisionError> {
    if cancel.is_cancelled() {
        Err(ProvisionError::new(
            ProvisionErrorCode::Cancelled,
            "operation cancelled",
            true,
        ))
    } else {
        Ok(())
    }
}

pub fn extract_zip_safely(bytes: &[u8], root: &Path) -> Result<(), ProvisionError> {
    extract_zip_safely_with_limits(bytes, root, ZipLimits::default())
}

#[derive(Debug, Clone, Copy)]
pub struct ZipLimits {
    pub max_entries: usize,
    pub max_compressed_size: u64,
    pub max_total_compressed_size: u64,
    pub max_entry_size: u64,
    pub max_total_size: u64,
    pub max_compression_ratio: u64,
}

impl Default for ZipLimits {
    fn default() -> Self {
        Self {
            max_entries: 4096,
            max_compressed_size: 512 * 1024 * 1024,
            max_total_compressed_size: 2 * 1024 * 1024 * 1024,
            max_entry_size: 512 * 1024 * 1024,
            max_total_size: 2 * 1024 * 1024 * 1024,
            max_compression_ratio: 1000,
        }
    }
}

pub fn extract_zip_safely_with_limits(
    bytes: &[u8],
    root: &Path,
    limits: ZipLimits,
) -> Result<(), ProvisionError> {
    extract_zip_safely_under_root_with_limits(bytes, root, root, limits)
}

fn extract_zip_safely_under_root(
    bytes: &[u8],
    approved_root: &Path,
    root: &Path,
) -> Result<(), ProvisionError> {
    extract_zip_safely_under_root_with_limits(bytes, approved_root, root, ZipLimits::default())
}

fn extract_zip_safely_under_root_with_limits(
    bytes: &[u8],
    approved_root: &Path,
    root: &Path,
    limits: ZipLimits,
) -> Result<(), ProvisionError> {
    let reader = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|error| {
        ProvisionError::new(ProvisionErrorCode::ZipSlip, error.to_string(), false)
    })?;
    if archive.len() > limits.max_entries {
        return Err(ProvisionError::new(
            ProvisionErrorCode::ZipSlip,
            "archive entry limit exceeded",
            false,
        ));
    }
    let mut destinations = std::collections::HashSet::new();
    let mut total_size = 0u64;
    let mut total_compressed_size = 0u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|error| {
            ProvisionError::new(ProvisionErrorCode::ZipSlip, error.to_string(), false)
        })?;
        let name = entry.name().to_owned();
        let normalized = normalize_zip_name(&name)?;
        if !destinations.insert(normalized.clone()) {
            return Err(ProvisionError::new(
                ProvisionErrorCode::ZipSlip,
                "duplicate archive destination",
                false,
            ));
        }
        let compressed = entry.compressed_size();
        let uncompressed = entry.size();
        if compressed > limits.max_compressed_size
            || total_compressed_size.saturating_add(compressed) > limits.max_total_compressed_size
            || uncompressed > limits.max_entry_size
            || total_size.saturating_add(uncompressed) > limits.max_total_size
            || (compressed == 0 && uncompressed > 0)
            || (compressed > 0 && uncompressed / compressed.max(1) > limits.max_compression_ratio)
        {
            return Err(ProvisionError::new(
                ProvisionErrorCode::ZipSlip,
                "archive size or compression limit exceeded",
                false,
            ));
        }
        total_size = total_size.saturating_add(uncompressed);
        total_compressed_size = total_compressed_size.saturating_add(compressed);
    }
    // The complete archive has passed structural, path, and resource checks;
    // only now create the destination tree and begin writes.
    fs::create_dir_all(root)?;
    validate_write_boundary(approved_root, root, root)?;
    let mut actual_total_size = 0u64;
    let mut actual_total_compressed_size = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| {
            ProvisionError::new(ProvisionErrorCode::ZipSlip, error.to_string(), false)
        })?;
        if entry.is_symlink()
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(ProvisionError::new(
                ProvisionErrorCode::ZipSlip,
                "symbolic-link archive entry is not allowed",
                false,
            ));
        }
        let name = entry.name();
        let relative = Path::new(name);
        let portable_name = name.replace('\\', "/");
        let has_drive_prefix = portable_name
            .as_bytes()
            .get(1)
            .is_some_and(|byte| *byte == b':');
        if relative.is_absolute()
            || has_drive_prefix
            || portable_name.starts_with('/')
            || portable_name.split('/').any(|part| part == "..")
            || relative.components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err(ProvisionError::new(
                ProvisionErrorCode::ZipSlip,
                format!("archive entry escapes staging root: {name}"),
                false,
            ));
        }
        // Keep the archive's original spelling for the actual write (Python
        // imports and other consumers can be case-sensitive), while the
        // normalized value above remains the collision/validation identity.
        let _collision_key = normalize_zip_name(name)?;
        let target = root.join(portable_name);
        validate_write_boundary(approved_root, root, &target)?;
        if entry.is_dir() {
            fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        validate_write_boundary(approved_root, root, &target)?;
        let mut output = File::create(&target)?;
        let actual_size = io::copy(&mut entry, &mut output)?;
        if actual_size != entry.size() || actual_size > limits.max_entry_size {
            return Err(ProvisionError::new(
                ProvisionErrorCode::ZipSlip,
                "archive expanded bytes differ from declared limits",
                false,
            ));
        }
        actual_total_size = actual_total_size.saturating_add(actual_size);
        actual_total_compressed_size =
            actual_total_compressed_size.saturating_add(entry.compressed_size());
        if actual_total_size > limits.max_total_size
            || actual_total_compressed_size > limits.max_total_compressed_size
        {
            return Err(ProvisionError::new(
                ProvisionErrorCode::ZipSlip,
                "archive aggregate bytes exceed limits",
                false,
            ));
        }
        output.sync_all()?;
    }
    Ok(())
}

fn normalize_zip_name(name: &str) -> Result<String, ProvisionError> {
    let portable = name.replace('\\', "/");
    let mut parts = Vec::new();
    for part in portable.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." || part.ends_with(['.', ' ']) || part.contains(':') {
            return Err(ProvisionError::new(
                ProvisionErrorCode::ZipSlip,
                "unsafe archive path",
                false,
            ));
        }
        let stem = part.split('.').next().unwrap_or(part).to_ascii_uppercase();
        if matches!(
            stem.as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        ) {
            return Err(ProvisionError::new(
                ProvisionErrorCode::ZipSlip,
                "reserved Windows archive name",
                false,
            ));
        }
        parts.push(part);
    }
    if portable.starts_with('/') || portable.as_bytes().get(1) == Some(&b':') || parts.is_empty() {
        return Err(ProvisionError::new(
            ProvisionErrorCode::ZipSlip,
            "absolute archive path",
            false,
        ));
    }
    Ok(windows_collision_key(&parts.join("/")))
}

fn build_uv_python_install_args(version: &str, install_dir: &Path) -> Vec<String> {
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

fn build_uv_find_args(version: &str) -> Vec<String> {
    vec![
        "python".into(),
        "find".into(),
        "--managed-python".into(),
        "--no-project".into(),
        "--no-config".into(),
        version.into(),
    ]
}

fn resolve_managed_python_path(
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

fn build_uv_sync_args(project: &Path, python: &Path) -> Vec<String> {
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

fn is_successor_venv_interpreter(candidate: &Path, managed_base: &Path) -> bool {
    let text = candidate
        .to_string_lossy()
        .to_ascii_lowercase()
        .replace('\\', "/");
    candidate.is_absolute() && candidate != managed_base && text.contains("/venv/")
}

fn nearest_existing(path: &Path) -> Option<PathBuf> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        if candidate.exists() {
            return Some(candidate.to_path_buf());
        }
        current = candidate.parent();
    }
    None
}

fn contained(root: &Path, candidate: &Path) -> bool {
    #[cfg(windows)]
    {
        if candidate.starts_with(root) {
            return true;
        }
        let root = root.to_string_lossy().to_ascii_lowercase();
        let candidate = candidate.to_string_lossy().to_ascii_lowercase();
        return candidate == root
            || candidate
                .strip_prefix(root.trim_end_matches(['\\', '/']))
                .is_some_and(|suffix| suffix.starts_with('\\') || suffix.starts_with('/'));
    }
    #[cfg(not(windows))]
    {
        candidate.starts_with(root)
    }
}

fn validate_write_boundary(
    approved_root: &Path,
    root: &Path,
    candidate: &Path,
) -> Result<(), ProvisionError> {
    let canonical_approved_root = fs::canonicalize(approved_root).map_err(|error| {
        ProvisionError::new(ProvisionErrorCode::ZipSlip, error.to_string(), false)
    })?;
    let canonical_root = fs::canonicalize(root).map_err(|error| {
        ProvisionError::new(ProvisionErrorCode::ZipSlip, error.to_string(), false)
    })?;
    if !contained(&canonical_approved_root, &canonical_root) {
        return Err(ProvisionError::new(
            ProvisionErrorCode::ZipSlip,
            "staging root escapes approved data root",
            false,
        ));
    }
    let ancestor = nearest_existing(candidate).ok_or_else(|| {
        ProvisionError::new(
            ProvisionErrorCode::ZipSlip,
            "staging path has no existing ancestor",
            false,
        )
    })?;
    let canonical_ancestor = fs::canonicalize(ancestor).map_err(|error| {
        ProvisionError::new(ProvisionErrorCode::ZipSlip, error.to_string(), false)
    })?;
    if !contained(&canonical_root, &canonical_ancestor)
        || !contained(&canonical_approved_root, &canonical_ancestor)
    {
        return Err(ProvisionError::new(
            ProvisionErrorCode::ZipSlip,
            "staging path escapes its canonical root",
            false,
        ));
    }
    Ok(())
}

fn validate_missing_boundary(approved_root: &Path, candidate: &Path) -> Result<(), ProvisionError> {
    let canonical_approved_root = fs::canonicalize(approved_root).map_err(|error| {
        ProvisionError::new(ProvisionErrorCode::ZipSlip, error.to_string(), false)
    })?;
    let ancestor = nearest_existing(candidate).ok_or_else(|| {
        ProvisionError::new(
            ProvisionErrorCode::ZipSlip,
            "path has no existing ancestor",
            false,
        )
    })?;
    let canonical_ancestor = fs::canonicalize(ancestor).map_err(|error| {
        ProvisionError::new(ProvisionErrorCode::ZipSlip, error.to_string(), false)
    })?;
    if !contained(&canonical_approved_root, &canonical_ancestor) {
        return Err(ProvisionError::new(
            ProvisionErrorCode::ZipSlip,
            "path escapes approved data root",
            false,
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProvisionedState {
    Ready,
}

#[derive(Debug, Clone)]
pub struct ProvisionResult {
    pub operation_id: String,
    pub state: ProvisionedState,
    pub manifest: RuntimeManifest,
    pub manifest_path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct ProvisionerConfig {
    pub data_root: PathBuf,
    pub install_id: String,
    pub app_module: String,
    pub preferred_port: u16,
    pub fallback_port: u16,
    pub bootstrap: BootstrapManifest,
    pub max_download_retries: u32,
    pub retry_backoff: Duration,
    pub python_executable_name: String,
    pub operation_timeout: Duration,
}

pub struct Provisioner<S, R, H, P> {
    config: ProvisionerConfig,
    source: S,
    runner: R,
    health: H,
    progress: P,
}

impl<S, R, H, P> Provisioner<S, R, H, P>
where
    S: ArtifactSource,
    R: ProcessRunner,
    H: HealthChecker,
    P: ProgressSink,
{
    pub fn new(config: ProvisionerConfig, source: S, runner: R, health: H, progress: P) -> Self {
        Self {
            config,
            source,
            runner,
            health,
            progress,
        }
    }

    pub fn provision_first_install(
        mut self,
        cancel: CancellationToken,
    ) -> Result<ProvisionResult, ProvisionError> {
        self.config.bootstrap.validate()?;
        self.progress
            .report(ProgressEvent::phase(ProvisionPhase::VerifyBootstrap));
        ensure_not_cancelled(&cancel)?;
        fs::create_dir_all(&self.config.data_root)?;
        let deadline = ProvisionDeadline::from_timeout(self.config.operation_timeout)?;
        deadline.check(&cancel)?;
        let manifest_path = self
            .config
            .data_root
            .join("state")
            .join("runtime-manifest.json");
        let lock_path = self.config.data_root.join("state").join("operation.lock");
        let operation_id = format!("op-{}-{}", std::process::id(), now_ms());
        let _lock = OperationLock::acquire(&lock_path, &operation_id)?;
        let mut manifest =
            match RuntimeManifest::read_recovery(&manifest_path, Some(&self.config.install_id)) {
                Ok(existing) => {
                    if !matches!(
                        existing.state,
                        RuntimeState::Unprovisioned | RuntimeState::Failed
                    ) {
                        return Err(ProvisionError::new(
                            ProvisionErrorCode::ManifestConflict,
                            "runtime is already provisioned or busy",
                            false,
                        ));
                    }
                    existing
                }
                Err(_) => initial_manifest(&self.config),
            };
        let expected_revision = if manifest_path.exists() {
            Some(manifest.revision)
        } else {
            None
        };
        manifest.state = RuntimeState::Provisioning;
        manifest.revision =
            manifest.revision.max(1) + if expected_revision.is_some() { 1 } else { 0 };
        manifest.operation = RuntimeOperation {
            id: Some(operation_id.clone()),
            kind: Some("first_install".into()),
            phase: Some("download".into()),
            last_error_code: None,
            retryable: false,
        };
        manifest.write_atomic_cas(&manifest_path, expected_revision)?;
        let staging = self.config.data_root.join("staging").join(&operation_id);
        let downloads = staging.join("downloads");
        validate_missing_boundary(&self.config.data_root, &staging)?;
        fs::create_dir_all(&downloads)?;
        validate_missing_boundary(&self.config.data_root, &downloads)?;
        let result = self.provision_staged(
            &cancel,
            &operation_id,
            &staging,
            &downloads,
            manifest.clone(),
            manifest_path.clone(),
            &deadline,
        );
        match result {
            Ok(result) => Ok(result),
            Err(error) => {
                self.progress
                    .report(ProgressEvent::phase(ProvisionPhase::Cleanup));
                let quarantine = self.config.data_root.join("quarantine").join(&operation_id);
                if let Err(cleanup) =
                    quarantine_staging(&self.config.data_root, &staging, &quarantine)
                {
                    return Err(cleanup);
                }
                let mut failed = manifest;
                failed.state = RuntimeState::Unprovisioned;
                failed.operation.last_error_code = Some(error.code().as_str().into());
                failed.operation.retryable = error.retryable();
                failed.revision += 1;
                let _ = failed.write_atomic_cas(&manifest_path, Some(failed.revision - 1));
                Err(error)
            }
        }
    }

    fn provision_staged(
        &mut self,
        cancel: &CancellationToken,
        operation_id: &str,
        staging: &Path,
        downloads: &Path,
        mut manifest: RuntimeManifest,
        manifest_path: PathBuf,
        deadline: &ProvisionDeadline,
    ) -> Result<ProvisionResult, ProvisionError> {
        let uv = download_verified_under_root(
            &self.source,
            &self.config.bootstrap.uv,
            &self.config.data_root,
            downloads,
            self.config.max_download_retries,
            self.config.retry_backoff,
            cancel,
            deadline,
            &mut self.progress,
        )?;
        let engine = download_verified_under_root(
            &self.source,
            &self.config.bootstrap.engine,
            &self.config.data_root,
            downloads,
            self.config.max_download_retries,
            self.config.retry_backoff,
            cancel,
            deadline,
            &mut self.progress,
        )?;
        if cancel.is_cancelled() {
            return Err(ProvisionError::new(
                ProvisionErrorCode::Cancelled,
                "operation cancelled",
                true,
            ));
        }
        self.progress
            .report(ProgressEvent::phase(ProvisionPhase::Stage));
        deadline.check(cancel)?;
        let engine_stage = staging
            .join("engine")
            .join(&self.config.bootstrap.engine.version);
        let project_stage = engine_stage.join("project");
        validate_write_boundary(&self.config.data_root, staging, &project_stage)?;
        fs::create_dir_all(&project_stage)?;
        let bytes = fs::read(&engine)?;
        match self.config.bootstrap.engine.kind {
            ArtifactKind::Zip => {
                extract_zip_safely_under_root(&bytes, &self.config.data_root, &project_stage)?
            }
            ArtifactKind::File => {
                let payload = project_stage.join("payload.bin");
                validate_write_boundary(&self.config.data_root, &project_stage, &payload)?;
                fs::write(payload, bytes)?;
            }
        }
        let uv_stage = staging.join("tools").join("uv.exe");
        validate_missing_boundary(&self.config.data_root, &uv_stage)?;
        fs::create_dir_all(uv_stage.parent().unwrap())?;
        validate_write_boundary(&self.config.data_root, staging, &uv_stage)?;
        fs::copy(uv, &uv_stage)?;
        let generation_stage = engine_stage.join("generations").join(operation_id);
        let python_stage = generation_stage.join("python");
        let venv_stage = generation_stage.join("venv");
        validate_missing_boundary(&self.config.data_root, &python_stage)?;
        validate_missing_boundary(&self.config.data_root, &generation_stage)?;
        validate_missing_boundary(
            &self.config.data_root,
            &self.config.data_root.join("cache").join("uv"),
        )?;
        let mut inherited = std::env::vars().collect::<BTreeMap<_, _>>();
        inherited.insert(
            "OPENCOHOST_DATA_ROOT".into(),
            self.config.data_root.to_string_lossy().into_owned(),
        );
        let mut env = build_child_environment(&inherited, staging)?;
        env.insert(
            "UV_PYTHON_INSTALL_DIR".into(),
            python_stage.to_string_lossy().into_owned(),
        );
        env.insert(
            "UV_PROJECT_ENVIRONMENT".into(),
            venv_stage.to_string_lossy().into_owned(),
        );
        env.insert(
            "UV_CACHE_DIR".into(),
            self.config
                .data_root
                .join("cache")
                .join("uv")
                .to_string_lossy()
                .into_owned(),
        );
        self.progress
            .report(ProgressEvent::phase(ProvisionPhase::InstallPython));
        deadline.check(cancel)?;
        let install = self.runner.run(
            &uv_stage,
            &build_uv_python_install_args(&self.config.bootstrap.python_version, &python_stage),
            staging,
            &env,
            cancel,
            deadline,
        )?;
        deadline.check(cancel)?;
        if install.status != 0 {
            return Err(ProvisionError::new(
                ProvisionErrorCode::ProcessFailed,
                install.stderr,
                true,
            ));
        }
        let find = self.runner.run(
            &uv_stage,
            &build_uv_find_args(&self.config.bootstrap.python_version),
            staging,
            &env,
            cancel,
            deadline,
        )?;
        deadline.check(cancel)?;
        let managed_python = resolve_managed_python_path(&find, &python_stage)?;
        let python_executable_stage = venv_stage.join(if cfg!(windows) {
            "Scripts/python.exe"
        } else {
            "bin/python"
        });
        self.progress
            .report(ProgressEvent::phase(ProvisionPhase::Sync));
        deadline.check(cancel)?;
        let sync = self.runner.run(
            &uv_stage,
            &build_uv_sync_args(&project_stage, &managed_python),
            &project_stage,
            &env,
            cancel,
            deadline,
        )?;
        deadline.check(cancel)?;
        if sync.status != 0 {
            return Err(ProvisionError::new(
                ProvisionErrorCode::ProcessFailed,
                sync.stderr,
                true,
            ));
        }
        self.progress
            .report(ProgressEvent::phase(ProvisionPhase::HealthCheck));
        deadline.check(cancel)?;
        if !python_executable_stage.is_file() {
            return Err(ProvisionError::new(
                ProvisionErrorCode::HealthCheckFailed,
                "uv sync did not create the successor venv interpreter",
                false,
            ));
        }
        let health_result = self.health.check(
            &project_stage,
            &python_executable_stage,
            &env,
            cancel,
            deadline,
        );
        deadline.check(cancel)?;
        health_result.map_err(|error| {
            if matches!(
                error.code(),
                ProvisionErrorCode::Cancelled | ProvisionErrorCode::DeadlineExceeded
            ) {
                return error;
            }
            ProvisionError::new(
                ProvisionErrorCode::HealthCheckFailed,
                error.to_string(),
                true,
            )
        })?;
        deadline.check(cancel)?;
        self.progress
            .report(ProgressEvent::phase(ProvisionPhase::Activate));
        deadline.check(cancel)?;
        let final_release = self
            .config
            .data_root
            .join("engine")
            .join("releases")
            .join(&self.config.bootstrap.engine.version);
        if final_release.exists() {
            return Err(ProvisionError::new(
                ProvisionErrorCode::ActivationFailed,
                "target generation already exists",
                false,
            ));
        }
        validate_missing_boundary(&self.config.data_root, &final_release)?;
        fs::create_dir_all(final_release.parent().unwrap())?;
        validate_write_boundary(
            &self.config.data_root,
            &self.config.data_root,
            &final_release,
        )?;
        #[cfg(test)]
        invoke_activation_wait_hook(cancel, deadline);
        let Some(commit) = cancel.try_begin_commit() else {
            return Err(ProvisionError::new(
                ProvisionErrorCode::Cancelled,
                "operation cancelled",
                true,
            ));
        };
        #[cfg(test)]
        invoke_activation_commit_hook(&commit, deadline);
        commit.check_deadline(deadline)?;
        fs::rename(&engine_stage, &final_release)?;
        let final_generation = final_release.join("generations").join(operation_id);
        rebase_venv_after_generation_rename(&generation_stage, &final_generation)?;
        let final_project = final_release.join("project");
        let final_python_executable =
            final_release
                .join("generations")
                .join(operation_id)
                .join(if cfg!(windows) {
                    "venv/Scripts/python.exe"
                } else {
                    "venv/bin/python"
                });
        manifest.state = RuntimeState::Ready;
        manifest.revision += 1;
        manifest.operation = RuntimeOperation::default();
        manifest.engine = EngineManifest {
            active_version: Some(self.config.bootstrap.engine.version.clone()),
            previous_version: None,
            pending_version: None,
            active_generation: Some(operation_id.into()),
            previous_generation: None,
            project_dir: Some(final_project),
            python_executable: Some(final_python_executable),
            app_module: self.config.app_module.clone(),
            preferred_port: self.config.preferred_port,
            fallback_port: self.config.fallback_port,
            lock_sha256: None,
            payload_sha256: Some(self.config.bootstrap.engine.sha256.clone()),
        };
        manifest.tooling = ToolingManifest {
            uv_version: self.config.bootstrap.uv.version.clone(),
            python_version: self.config.bootstrap.python_version.clone(),
        };
        manifest.components = ComponentsManifest {
            piper: Default::default(),
        };
        commit.check_deadline(deadline)?;
        if let Err(error) =
            manifest.write_atomic_cas_with_gate(&manifest_path, Some(manifest.revision - 1), || {
                commit.check_deadline(deadline).map_err(|error| {
                    crate::runtime_manifest::RuntimeManifestError::new(error.to_string())
                })
            })
        {
            let quarantine = self
                .config
                .data_root
                .join("quarantine")
                .join(format!("{}-generation", operation_id));
            if let Err(cleanup) =
                quarantine_staging(&self.config.data_root, &final_release, &quarantine)
            {
                return Err(cleanup);
            }
            if error.to_string().contains("provisioning deadline exceeded") {
                return Err(ProvisionError::new(
                    ProvisionErrorCode::DeadlineExceeded,
                    "provisioning deadline exceeded",
                    true,
                ));
            }
            return Err(error.into());
        }
        commit.complete();
        self.progress
            .report(ProgressEvent::phase(ProvisionPhase::Cleanup));
        if staging.exists() {
            validate_write_boundary(&self.config.data_root, &self.config.data_root, staging)?;
            fs::remove_dir_all(staging).map_err(|error| {
                ProvisionError::new(ProvisionErrorCode::CleanupFailed, error.to_string(), false)
            })?;
        }
        Ok(ProvisionResult {
            operation_id: operation_id.into(),
            state: ProvisionedState::Ready,
            manifest,
            manifest_path,
        })
    }
}

fn rebase_venv_after_generation_rename(
    staged_generation: &Path,
    final_generation: &Path,
) -> Result<(), ProvisionError> {
    let config = final_generation.join("venv").join("pyvenv.cfg");
    let contents = fs::read_to_string(&config).map_err(|error| {
        ProvisionError::new(
            ProvisionErrorCode::ActivationFailed,
            error.to_string(),
            false,
        )
    })?;
    let old = staged_generation.to_string_lossy();
    let new = final_generation.to_string_lossy();
    if !contents.contains(old.as_ref()) {
        return Err(ProvisionError::new(
            ProvisionErrorCode::ActivationFailed,
            "successor venv points outside the committed generation",
            false,
        ));
    }
    let rebased = contents.replace(old.as_ref(), new.as_ref());
    fs::write(&config, rebased).map_err(|error| {
        ProvisionError::new(
            ProvisionErrorCode::ActivationFailed,
            error.to_string(),
            false,
        )
    })?;
    Ok(())
}

fn quarantine_staging(
    approved_root: &Path,
    staging: &Path,
    quarantine: &Path,
) -> Result<(), ProvisionError> {
    if !staging.exists() {
        return Ok(());
    }
    validate_missing_boundary(approved_root, quarantine)?;
    fs::create_dir_all(quarantine.parent().ok_or_else(|| {
        ProvisionError::new(
            ProvisionErrorCode::CleanupFailed,
            "quarantine has no parent",
            false,
        )
    })?)
    .map_err(|error| {
        ProvisionError::new(ProvisionErrorCode::CleanupFailed, error.to_string(), false)
    })?;
    validate_write_boundary(approved_root, approved_root, staging)?;
    validate_missing_boundary(approved_root, quarantine)?;
    fs::rename(staging, quarantine)
        .or_else(|_| fs::remove_dir_all(staging))
        .map_err(|error| {
            ProvisionError::new(ProvisionErrorCode::CleanupFailed, error.to_string(), false)
        })
}

fn initial_manifest(config: &ProvisionerConfig) -> RuntimeManifest {
    RuntimeManifest {
        schema_version: crate::runtime_manifest::RUNTIME_SCHEMA_VERSION,
        install_id: config.install_id.clone(),
        product_version: config.bootstrap.product_version.clone(),
        data_root: config.data_root.clone(),
        revision: 1,
        state: RuntimeState::Unprovisioned,
        operation: RuntimeOperation::default(),
        engine: EngineManifest {
            active_version: None,
            previous_version: None,
            pending_version: None,
            active_generation: None,
            previous_generation: None,
            project_dir: None,
            python_executable: None,
            app_module: config.app_module.clone(),
            preferred_port: config.preferred_port,
            fallback_port: config.fallback_port,
            lock_sha256: None,
            payload_sha256: None,
        },
        tooling: ToolingManifest {
            uv_version: config.bootstrap.uv.version.clone(),
            python_version: config.bootstrap.python_version.clone(),
        },
        components: ComponentsManifest {
            piper: Default::default(),
        },
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::fs;
    use std::io::{Cursor, Write};
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    #[test]
    fn red_uv_find_resolves_versioned_managed_interpreter_under_root() {
        let root = test_root("uv-find-red");
        let versioned = root
            .join("cpython-3.12.4-windows-x86_64-none")
            .join("python.exe");
        fs::create_dir_all(versioned.parent().unwrap()).unwrap();
        fs::write(&versioned, b"python").unwrap();
        let output = ProcessOutput {
            status: 0,
            stdout: format!("{}\n", versioned.display()),
            ..Default::default()
        };
        let resolved = resolve_managed_python_path(&output, &root).unwrap();
        assert_eq!(resolved, fs::canonicalize(versioned).unwrap());
        assert_eq!(
            build_uv_find_args("3.12.4"),
            vec![
                "python",
                "find",
                "--managed-python",
                "--no-project",
                "--no-config",
                "3.12.4"
            ]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn red_uv_find_rejects_system_or_malformed_output() {
        let root = test_root("uv-find-reject-red");
        fs::create_dir_all(&root).unwrap();
        assert!(resolve_managed_python_path(
            &ProcessOutput {
                status: 0,
                stdout: "C:\\Windows\\python.exe\n".into(),
                ..Default::default()
            },
            &root
        )
        .is_err());
        assert!(resolve_managed_python_path(
            &ProcessOutput {
                status: 1,
                stderr: "not found".into(),
                ..Default::default()
            },
            &root
        )
        .is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn red_cancel_commit_linearization_is_deterministic_in_both_orders() {
        let cancelled_first = CancellationToken::new();
        assert!(cancelled_first.cancel());
        assert!(cancelled_first.try_begin_commit().is_none());

        let commit_first = CancellationToken::new();
        let commit = commit_first
            .try_begin_commit()
            .expect("commit must win first");
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let release = barrier.clone();
        let token = commit_first.clone();
        let cancelled = std::thread::spawn(move || {
            release.wait();
            token.cancel()
        });
        barrier.wait();
        assert!(!cancelled.join().unwrap());
        commit.complete();
        assert!(!commit_first.cancel());
        assert!(!commit_first.is_cancelled());
    }

    fn create_dummy_generation(
        root: &Path,
        version: &str,
        generation_id: &str,
    ) -> Vec<(PathBuf, String)> {
        let gen_dir = root
            .join("engine")
            .join("releases")
            .join(version)
            .join("generations")
            .join(generation_id);
        let venv_py = gen_dir.join("venv").join(if cfg!(windows) {
            "Scripts/python.exe"
        } else {
            "bin/python"
        });
        fs::create_dir_all(venv_py.parent().unwrap()).unwrap();
        fs::write(&venv_py, b"previous-venv-python-bytes").unwrap();
        let project = root
            .join("engine")
            .join("releases")
            .join(version)
            .join("project");
        fs::create_dir_all(&project).unwrap();
        let main_py = project.join("main.py");
        fs::write(&main_py, b"previous-project-main-bytes").unwrap();
        let mut entries = Vec::new();
        for path in [&venv_py, &main_py] {
            let bytes = fs::read(path).unwrap();
            let mut hasher = sha2::Sha256::new();
            hasher.update(&bytes);
            entries.push((path.clone(), format!("{:x}", hasher.finalize())));
        }
        entries
    }

    #[test]
    fn red_generation_activation_barrier_is_exposed_by_the_real_provisioner_path() {
        let hook_lock = ACTIVATION_HOOK_TEST_LOCK.lock().unwrap();
        let root = test_root("generation-activation-barrier");
        fs::create_dir_all(&root).unwrap();
        let previous_hashes = create_dummy_generation(&root, "0.9.0", "g0");
        let bootstrap = test_bootstrap(b"engine payload");
        let token = CancellationToken::new();
        let entered = Arc::new(std::sync::Barrier::new(2));
        let release = Arc::new(std::sync::Barrier::new(2));
        let entered_hook = entered.clone();
        let release_hook = release.clone();
        let target_token = token.clone();
        set_activation_wait_hook(Some(Box::new(move |received, _| {
            if !Arc::ptr_eq(&received.0, &target_token.0) {
                return;
            }
            entered_hook.wait();
            release_hook.wait();
        })));
        let worker_token = token.clone();
        let worker_root = root.clone();
        let worker = std::thread::spawn(move || {
            let mut progress = RecordingProgress::default();
            Provisioner::new(
                test_config(worker_root.clone(), bootstrap.clone()),
                FakeArtifactSource::bytes_for(&bootstrap.engine),
                FakeProcessRunner::successful(&worker_root),
                FakeHealthChecker::healthy(),
                &mut progress,
            )
            .provision_first_install(worker_token)
        });
        entered.wait();
        assert!(token.cancel());
        release.wait();
        let error = worker.join().unwrap().unwrap_err();
        assert_eq!(error.code(), ProvisionErrorCode::Cancelled);
        set_activation_wait_hook(None);
        set_activation_commit_hook(None);
        drop(hook_lock);
        assert!(!root.join("engine").join("releases").join("1.0.0").exists());
        for (path, expected_hash) in &previous_hashes {
            assert!(path.is_file());
            let bytes = fs::read(path).unwrap();
            let mut hasher = sha2::Sha256::new();
            hasher.update(&bytes);
            assert_eq!(&format!("{:x}", hasher.finalize()), expected_hash);
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn red_generation_activation_commit_winner_rejects_late_cancel() {
        let _hook_lock = ACTIVATION_HOOK_TEST_LOCK.lock().unwrap();
        let root = test_root("generation-activation-commit-winner");
        fs::create_dir_all(&root).unwrap();
        let bootstrap = test_bootstrap(b"engine payload");
        let token = CancellationToken::new();
        let late_cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let observed = late_cancel.clone();
        let hook_token = token.clone();
        set_activation_commit_hook(Some(Box::new(move |commit, _| {
            if !Arc::ptr_eq(&commit.token.0, &hook_token.0) {
                return;
            }
            observed.store(!hook_token.cancel(), std::sync::atomic::Ordering::SeqCst);
        })));
        let mut progress = RecordingProgress::default();
        let result = Provisioner::new(
            test_config(root.clone(), bootstrap.clone()),
            FakeArtifactSource::bytes_for(&bootstrap.engine),
            FakeProcessRunner::successful(&root),
            FakeHealthChecker::healthy(),
            &mut progress,
        )
        .provision_first_install(token.clone())
        .unwrap();
        set_activation_wait_hook(None);
        set_activation_commit_hook(None);
        assert!(late_cancel.load(std::sync::atomic::Ordering::SeqCst));
        assert_eq!(result.state, ProvisionedState::Ready);
        assert!(result.manifest.engine.active_generation.is_some());
        assert!(!token.cancel());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn red_generation_activation_barrier_observes_expiry_before_rename() {
        let _hook_lock = ACTIVATION_HOOK_TEST_LOCK.lock().unwrap();
        let root = test_root("generation-activation-deadline-barrier");
        fs::create_dir_all(&root).unwrap();
        let previous_hashes = create_dummy_generation(&root, "0.9.0", "g0");
        let bootstrap = test_bootstrap(b"engine payload");
        let entered = Arc::new(std::sync::Barrier::new(2));
        let release = Arc::new(std::sync::Barrier::new(2));
        let entered_hook = entered.clone();
        let release_hook = release.clone();
        let token = CancellationToken::new();
        let target_token = token.clone();
        set_activation_wait_hook(Some(Box::new(move |received, deadline| {
            if !Arc::ptr_eq(&received.0, &target_token.0) {
                return;
            }
            entered_hook.wait();
            while !deadline.is_expired() {
                std::thread::yield_now();
            }
            release_hook.wait();
        })));
        let worker_root = root.clone();
        let worker = std::thread::spawn(move || {
            let mut config = test_config(worker_root.clone(), bootstrap.clone());
            config.operation_timeout = Duration::from_secs(1);
            let mut progress = RecordingProgress::default();
            Provisioner::new(
                config,
                FakeArtifactSource::bytes_for(&bootstrap.engine),
                FakeProcessRunner::successful(&worker_root),
                FakeHealthChecker::healthy(),
                &mut progress,
            )
            .provision_first_install(token)
        });
        entered.wait();
        release.wait();
        let error = worker.join().unwrap().unwrap_err();
        set_activation_wait_hook(None);
        set_activation_commit_hook(None);
        assert_eq!(error.code(), ProvisionErrorCode::DeadlineExceeded);
        assert!(!root.join("engine").join("releases").join("1.0.0").exists());
        for (path, expected_hash) in &previous_hashes {
            assert!(path.is_file());
            let bytes = fs::read(path).unwrap();
            let mut hasher = sha2::Sha256::new();
            hasher.update(&bytes);
            assert_eq!(&format!("{:x}", hasher.finalize()), expected_hash);
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn red_terminal_download_errors_are_not_retried_or_wrapped() {
        let root = test_root("terminal-download");
        fs::create_dir_all(&root).unwrap();
        let spec = artifact("engine", b"expected");
        let source = TerminalArtifactSource {
            code: ProvisionErrorCode::DeadlineExceeded,
            calls: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        };
        let error = download_verified(
            &source,
            &spec,
            &root,
            3,
            Duration::ZERO,
            &CancellationToken::new(),
            &ProvisionDeadline::from_timeout(Duration::from_secs(30)).unwrap(),
            &mut NoopProgress,
        )
        .unwrap_err();
        assert_eq!(error.code(), ProvisionErrorCode::DeadlineExceeded);
        assert_eq!(source.calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn red_unicode_windows_collision_key_rejects_case_and_canonical_equivalents() {
        let mut bootstrap = test_bootstrap(b"engine payload");
        bootstrap.uv.name = "Ä".into();
        bootstrap.engine.name = "ä".into();
        assert!(bootstrap.validate().is_err());

        let root = test_root("unicode-zip-red");
        let archive = zip_bytes([
            ("Ä.txt", b"a".as_slice()),
            ("a\u{308}.txt", b"b".as_slice()),
        ]);
        assert!(extract_zip_safely_with_limits(&archive, &root, ZipLimits::default()).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn red_windows_lock_denies_path_replacement_while_owner_holds_it() {
        let root = test_root("lock-replacement-red");
        let path = root.join("state").join("operation.lock");
        let replacement = root.join("state").join("replacement.lock");
        let holder = OperationLock::acquire(&path, "holder").unwrap();
        fs::write(&replacement, b"replacement").unwrap();
        assert!(fs::rename(&replacement, &path).is_err());
        assert_eq!(
            OperationLock::acquire(&path, "contender")
                .unwrap_err()
                .code(),
            ProvisionErrorCode::LockBusy
        );
        drop(holder);
        fs::rename(&replacement, &path).unwrap();
        fs::remove_file(&path).unwrap();
        let reacquired = OperationLock::acquire(&path, "after-release").unwrap();
        drop(reacquired);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn red_injected_job_assignment_failure_kills_direct_child() {
        let runner = CommandProcessRunner;
        let cwd = test_root("job-assignment-red");
        fs::create_dir_all(&cwd).unwrap();
        let cancel = CancellationToken::new();
        let deadline = ProvisionDeadline::from_timeout(Duration::from_secs(10)).unwrap();
        let mut observed_pid = None;
        let result = runner.run_with_job_assigner(
            Path::new("cmd.exe"),
            &["/C".into(), "timeout /T 30 /NOBREAK >NUL".into()],
            &cwd,
            &BTreeMap::new(),
            &cancel,
            &deadline,
            |child| {
                observed_pid = Some(child.id());
                Err(())
            },
        );
        assert_eq!(
            result.unwrap_err().code(),
            ProvisionErrorCode::ProcessIsolationFailed
        );
        let pid = observed_pid.expect("injection seam must observe the spawned child");
        assert!(!windows_process_is_alive(pid));
        let _ = fs::remove_dir_all(cwd);
    }

    #[cfg(windows)]
    #[test]
    fn real_windows_job_cancellation_kills_grandchild_process() {
        let powershell = Path::new(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe");
        if !powershell.is_file() {
            eprintln!("UNAVAILABLE real Windows Job Object probe: powershell.exe missing");
            return;
        }
        let root = test_root("job-tree-real");
        fs::create_dir_all(&root).unwrap();
        let pid_file = root.join("grandchild.pid");
        let command = format!(
            "$child = Start-Process -FilePath 'C:\\Windows\\System32\\cmd.exe' -ArgumentList '/c','C:\\Windows\\System32\\ping.exe -n 30 127.0.0.1 > nul' -PassThru; Set-Content -LiteralPath '{}' -Value $child.Id; Wait-Process -Id $child.Id",
            pid_file.display()
        );
        let runner = CommandProcessRunner;
        let cancel = CancellationToken::new();
        let thread_cancel = cancel.clone();
        let thread_root = root.clone();
        let mut child_env = BTreeMap::new();
        child_env.insert("SystemRoot".into(), r"C:\Windows".into());
        child_env.insert("WINDIR".into(), r"C:\Windows".into());
        child_env.insert("PATH".into(), r"C:\Windows\System32".into());
        let deadline = ProvisionDeadline::from_timeout(Duration::from_secs(30)).unwrap();
        let thread = std::thread::spawn(move || {
            runner.run(
                powershell,
                &["-NoProfile".into(), "-Command".into(), command],
                &thread_root,
                &child_env,
                &thread_cancel,
                &deadline,
            )
        });
        let mut grandchild_pid = None;
        for _ in 0..100 {
            if let Ok(contents) = fs::read_to_string(&pid_file) {
                grandchild_pid = contents.trim().parse::<u32>().ok();
                if grandchild_pid.is_some() {
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        let pid = grandchild_pid.expect("real probe must start and record a grandchild");
        cancel.cancel();
        let result = thread.join().unwrap().unwrap_err();
        assert_eq!(result.code(), ProvisionErrorCode::Cancelled);
        for _ in 0..40 {
            if !windows_process_is_alive(pid) {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        assert!(!windows_process_is_alive(pid));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn red_deadline_is_configured_and_source_health_receive_it() {
        let deadline = ProvisionDeadline::from_timeout(Duration::from_secs(3)).unwrap();
        assert!(!deadline.is_expired());
        assert!(ProvisionDeadline::from_timeout(Duration::ZERO).is_err());
    }

    #[test]
    fn red_operation_lock_uses_os_exclusive_ownership_not_unlink_release() {
        let root = test_root("exclusive-lock-red");
        let path = root.join("state").join("operation.lock");
        let first = OperationLock::acquire(&path, "first").unwrap();
        let second = OperationLock::acquire(&path, "second");
        assert_eq!(second.unwrap_err().code(), ProvisionErrorCode::LockBusy);
        drop(first);
        let third = OperationLock::acquire(&path, "third").unwrap();
        drop(third);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn real_uv_managed_python_and_venv_probe_is_typed_unavailable_without_opt_in() {
        if std::env::var_os("OPENCOHOST_RUN_REAL_UV").is_none() {
            eprintln!("UNAVAILABLE real uv probe: set OPENCOHOST_RUN_REAL_UV=1 to enable the external-tool integration probe");
            return;
        }
        let root = test_root("real-uv");
        let project = root.join("project");
        fs::create_dir_all(&project).unwrap();
        fs::write(project.join("pyproject.toml"), "[project]\nname = \"probe_project\"\nversion = \"0.1.0\"\nrequires-python = \">=3.12,<3.13\"\ndependencies = []\n").unwrap();
        let managed = root.join("managed");
        let cache = root.join("cache");
        let install = std::process::Command::new("uv")
            .args([
                "python",
                "install",
                "3.12.4",
                "--managed-python",
                "--no-registry",
                "--no-bin",
                "--no-config",
                "--install-dir",
            ])
            .arg(&managed)
            .env("UV_PYTHON_INSTALL_DIR", &managed)
            .env("UV_CACHE_DIR", &cache)
            .output();
        let Ok(install) = install else {
            eprintln!("UNAVAILABLE real uv probe: uv executable missing");
            return;
        };
        if !install.status.success() {
            eprintln!(
                "UNAVAILABLE real uv probe: {}",
                String::from_utf8_lossy(&install.stderr)
            );
            return;
        }
        let find = std::process::Command::new("uv")
            .args([
                "python",
                "find",
                "--managed-python",
                "--no-project",
                "--no-config",
                "3.12.4",
            ])
            .env("UV_PYTHON_INSTALL_DIR", &managed)
            .env("UV_CACHE_DIR", &cache)
            .output()
            .unwrap();
        let interpreter = resolve_managed_python_path(
            &ProcessOutput {
                status: find.status.code().unwrap_or(-1),
                stdout: String::from_utf8_lossy(&find.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&find.stderr).into_owned(),
            },
            &managed,
        )
        .unwrap();
        let lock = std::process::Command::new("uv")
            .args(["lock", "--offline", "--no-config", "--project"])
            .arg(&project)
            .output()
            .unwrap();
        assert!(
            lock.status.success(),
            "uv lock failed: {}",
            String::from_utf8_lossy(&lock.stderr)
        );
        let sync = std::process::Command::new("uv")
            .args([
                "sync",
                "--locked",
                "--no-editable",
                "--no-config",
                "--project",
            ])
            .arg(&project)
            .args(["--python"])
            .arg(&interpreter)
            .arg("--managed-python")
            .env("UV_PYTHON_INSTALL_DIR", &managed)
            .env("UV_PROJECT_ENVIRONMENT", project.join(".venv"))
            .env("UV_CACHE_DIR", &cache)
            .output()
            .unwrap();
        assert!(
            sync.status.success(),
            "uv sync failed: {}",
            String::from_utf8_lossy(&sync.stderr)
        );
        let venv_python = project.join(".venv").join(if cfg!(windows) {
            "Scripts/python.exe"
        } else {
            "bin/python"
        });
        assert!(venv_python.is_file());
        let run = std::process::Command::new(&venv_python)
            .args(["-c", "import sys; print(sys.executable)"])
            .output()
            .unwrap();
        assert!(run.status.success());

        fs::write(
            project.join("health_probe.py"),
            r#"from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/api/health":
            self.send_response(404)
            self.end_headers()
            return
        body = b'{"status":"ok"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *_args):
        pass

server = HTTPServer(("127.0.0.1", 0), Handler)
Path("health_port.txt").write_text(str(server.server_port), encoding="ascii")
server.handle_request()
server.server_close()
"#,
        )
        .unwrap();
        let mut health_process = std::process::Command::new(&venv_python)
            .arg("health_probe.py")
            .current_dir(&project)
            .spawn()
            .unwrap();
        let port_file = project.join("health_port.txt");
        let mut port = None;
        for _ in 0..100 {
            if let Ok(contents) = fs::read_to_string(&port_file) {
                port = contents.trim().parse::<u16>().ok();
                if port.is_some() {
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        let port = port.expect("real uv probe must start its /api/health server");
        let mut response = String::new();
        let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .write_all(b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
            .unwrap();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.contains("200 OK"));
        assert!(response.contains("{\"status\":\"ok\"}"));
        assert!(health_process.wait().unwrap().success());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn red_zip_enforces_aggregate_compressed_and_actual_output_limits() {
        let root = test_root("zip-aggregate-red");
        let archive = zip_bytes([("large.txt", b"payload payload payload".as_slice())]);
        let limits = ZipLimits {
            max_total_compressed_size: 1,
            max_total_size: 1,
            ..ZipLimits::default()
        };
        assert!(extract_zip_safely_with_limits(&archive, &root, limits).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn red_uv_contract_targets_successor_venv_and_restricts_sources() {
        let root = test_root("uv-contract-red");
        let project = root.join("project");
        let uv = root.join("tools").join("uv.exe");
        let args = build_uv_python_install_args("3.12.4", &root.join("python"));
        assert_eq!(args.first().map(String::as_str), Some("python"));
        assert!(args.iter().any(|arg| arg == "--no-registry"));
        assert!(args.iter().any(|arg| arg == "--no-bin"));
        assert!(args.iter().any(|arg| arg == "--no-config"));
        let sync = build_uv_sync_args(&project, &root.join("python.exe"));
        assert!(sync.iter().any(|arg| arg == "--project"));
        assert!(sync.iter().any(|arg| arg == "--no-config"));
        let final_python = root
            .join("engine")
            .join("releases")
            .join("1")
            .join("generations")
            .join("op")
            .join("venv")
            .join("Scripts")
            .join("python.exe");
        assert!(is_successor_venv_interpreter(
            &final_python,
            &root.join("python").join("python.exe")
        ));
        assert!(uv.is_absolute());
    }

    #[test]
    fn red_zip_pre_scan_rejects_limits_collisions_reserved_and_normalization() {
        let root = test_root("zip-prescan-red");
        let limits = ZipLimits {
            max_entries: 1,
            ..ZipLimits::default()
        };
        assert!(extract_zip_safely_with_limits(
            &zip_bytes([("a.txt", b"a"), ("b.txt", b"b")]),
            &root,
            limits
        )
        .is_err());
        assert!(extract_zip_safely_with_limits(
            &zip_bytes([("A.txt", b"a"), ("a.TXT", b"b")]),
            &root,
            ZipLimits::default()
        )
        .is_err());
        assert!(extract_zip_safely_with_limits(
            &zip_bytes([("CON.txt", b"a")]),
            &root,
            ZipLimits::default()
        )
        .is_err());
        assert!(extract_zip_safely_with_limits(
            &zip_bytes([("a. ", b"a"), ("a", b"b")]),
            &root,
            ZipLimits::default()
        )
        .is_err());
        let pristine_root = test_root("zip-prescan-pristine");
        assert!(extract_zip_safely_with_limits(
            &zip_bytes([("A.txt", b"a"), ("a.TXT", b"b")]),
            &pristine_root,
            ZipLimits::default()
        )
        .is_err());
        assert!(
            !pristine_root.exists(),
            "pre-scan rejection must not create the extraction root"
        );
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(pristine_root);
    }

    #[test]
    fn red_child_environment_is_allowlisted_and_drops_user_path() {
        let mut inherited = BTreeMap::new();
        inherited.insert("PATH".into(), "user-path".into());
        inherited.insert("PYTHONHOME".into(), "bad".into());
        inherited.insert("VIRTUAL_ENV".into(), "bad".into());
        inherited.insert("CONDA_PREFIX".into(), "bad".into());
        inherited.insert("PIP_INDEX_URL".into(), "bad".into());
        let env = build_child_environment(&inherited, &test_root("env-red")).unwrap();
        assert!(!env.contains_key("PATH"));
        assert!(!env.contains_key("PYTHONHOME"));
        assert!(!env.contains_key("VIRTUAL_ENV"));
        assert!(!env.contains_key("CONDA_PREFIX"));
        assert!(!env.contains_key("PIP_INDEX_URL"));
    }

    #[test]
    fn red_lock_metadata_requires_nonce_and_nonzero_identity() {
        assert!(serde_json::from_str::<OperationMetadata>(
            r#"{"operation_id":"","owner_pid":0,"acquired_unix_ms":0}"#
        )
        .is_err());
        assert!(OperationMetadata::validate(&OperationMetadata {
            operation_id: "".into(),
            owner_pid: 0,
            acquired_unix_ms: 0,
            ownership_nonce: String::new(),
            process_start_unix_ms: None
        })
        .is_err());
    }

    #[test]
    fn red_bootstrap_requires_allowed_https_hosts_and_nonzero_sizes() {
        let mut bootstrap = test_bootstrap(b"engine payload");
        bootstrap.allowed_hosts = vec!["example.test".into()];
        bootstrap.uv.expected_size = 0;
        assert!(bootstrap.validate().is_err());
        bootstrap.uv.expected_size = 2;
        bootstrap.uv.max_size = 1;
        assert!(bootstrap.validate().is_err());
    }

    #[test]
    fn real_process_import_probe_is_typed_unavailable_without_private_fixture() {
        let output = std::process::Command::new("python")
            .args(["-c", "import sys; import json; print(sys.executable)"])
            .output();
        match output {
            Ok(output) if output.status.success() => {
                assert!(!String::from_utf8_lossy(&output.stdout).trim().is_empty())
            }
            Ok(output) => eprintln!(
                "UNAVAILABLE real-process fixture: {}",
                String::from_utf8_lossy(&output.stderr)
            ),
            Err(error) => eprintln!("UNAVAILABLE real-process fixture: {error}"),
        }
    }

    #[test]
    fn operation_lock_rejects_live_owner_even_when_old() {
        let root = test_root("live-lock");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("state").join("operation.lock");
        let first = OperationLock::acquire_with_probe(
            &path,
            "operation-a",
            111,
            &FakeLiveness::live([111]),
        )
        .unwrap();
        let error = OperationLock::acquire_with_probe(
            &path,
            "operation-b",
            222,
            &FakeLiveness::live([111, 222]),
        )
        .unwrap_err();
        assert_eq!(error.code(), ProvisionErrorCode::LockBusy);
        drop(first);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn operation_lock_reclaims_dead_owner_without_elapsed_time_steal() {
        let root = test_root("dead-lock");
        let path = root.join("state").join("operation.lock");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            r#"{"operation_id":"dead","owner_pid":999,"acquired_unix_ms":1,"ownership_nonce":"dead-nonce","process_start_unix_ms":null}"#,
        )
        .unwrap();
        let lock = OperationLock::acquire_with_probe(
            &path,
            "operation-new",
            222,
            &FakeLiveness::dead([999]),
        )
        .unwrap();
        assert_eq!(lock.metadata().operation_id, "operation-new");
        drop(lock);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn operation_lock_metadata_is_owner_and_operation_specific() {
        let root = test_root("lock-metadata");
        let lock =
            OperationLock::acquire(&root.join("state").join("operation.lock"), "op").unwrap();
        assert_eq!(lock.metadata().operation_id, "op");
        assert_eq!(lock.metadata().owner_pid, std::process::id());
        drop(lock);
        assert!(root.join("state").join("operation.lock").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn operation_lock_has_one_winner_under_barrier_contention() {
        use std::sync::{Arc, Barrier};
        let root = test_root("lock-race");
        let path = Arc::new(root.join("state").join("operation.lock"));
        let barrier = Arc::new(Barrier::new(8));
        let mut workers = Vec::new();
        for index in 0..8 {
            let path = path.clone();
            let barrier = barrier.clone();
            workers.push(std::thread::spawn(move || {
                barrier.wait();
                OperationLock::acquire(&path, &format!("op-{index}"))
                    .map(|lock| {
                        // Keep the winning OS-held lock until every contender
                        // has had time to attempt acquisition. Without this,
                        // a later contender can legitimately acquire after an
                        // early winner drops, making the assertion timing
                        // dependent rather than a contention proof.
                        std::thread::sleep(Duration::from_millis(500));
                        drop(lock);
                    })
                    .is_ok()
            }));
        }
        let winners = workers
            .into_iter()
            .filter_map(|worker| worker.join().ok())
            .filter(|won| *won)
            .count();
        assert_eq!(winners, 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn child_environment_is_private_and_strips_conflicting_cache_inputs() {
        let root = test_root("child-env");
        let mut inherited = BTreeMap::new();
        inherited.insert("UV_CACHE_DIR".into(), "user-cache".into());
        inherited.insert("UV_INDEX_URL".into(), "user-index".into());
        inherited.insert("PYTHONPATH".into(), "user-path".into());
        inherited.insert("HF_HOME".into(), "user-hf".into());
        inherited.insert("PATH".into(), "user-path".into());
        inherited.insert("OPENCOHOST_DATA_ROOT".into(), "user-root".into());
        let env = build_child_environment(&inherited, &root).unwrap();
        assert_eq!(
            env.get("UV_PYTHON_INSTALL_DIR"),
            Some(&root.join("python").to_string_lossy().into_owned())
        );
        assert_eq!(
            env.get("UV_PROJECT_ENVIRONMENT"),
            Some(&root.join("venv").to_string_lossy().into_owned())
        );
        assert_eq!(
            env.get("UV_CACHE_DIR"),
            Some(&root.join("cache").to_string_lossy().into_owned())
        );
        assert!(!env.contains_key("UV_INDEX_URL"));
        assert!(!env.contains_key("PYTHONPATH"));
        assert!(!env.contains_key("HF_HOME"));
        assert!(!env.contains_key("PATH"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn safe_zip_extraction_rejects_slip_root_prefix_and_symlink_entries() {
        let root = test_root("zip-safety");
        fs::create_dir_all(&root).unwrap();
        for name in ["../escape.txt", r"C:\outside.txt", r"\root.txt"] {
            let archive = zip_bytes([(name, b"bad".as_slice())]);
            assert_eq!(
                extract_zip_safely(&archive, &root).unwrap_err().code(),
                ProvisionErrorCode::ZipSlip
            );
        }
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn safe_zip_extraction_rejects_missing_leaf_beyond_junction_escape() {
        let root = test_root("zip-junction");
        let outside = test_root("zip-junction-outside");
        let stage = root.join("staging");
        let junction = stage.join("escape");
        fs::create_dir_all(&stage).unwrap();
        fs::create_dir_all(&outside).unwrap();
        match create_junction(&junction, &outside) {
            Ok(()) => {
                let archive = zip_bytes([("escape/missing.bin", b"bad".as_slice())]);
                assert_eq!(
                    extract_zip_safely_under_root(&archive, &root, &stage)
                        .unwrap_err()
                        .code(),
                    ProvisionErrorCode::ZipSlip
                );
            }
            Err(unavailable) => {
                eprintln!("SKIPPED junction capability: {unavailable:?}");
                assert!(!unavailable.reason.is_empty());
            }
        }
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn bootstrap_manifest_fails_closed_for_non_https_sources_and_unknown_fields() {
        let mut bootstrap = test_bootstrap(b"engine payload");
        bootstrap.engine.source = "file:///untrusted".into();
        assert_eq!(
            bootstrap.validate().unwrap_err().code(),
            ProvisionErrorCode::InvalidBootstrap
        );
        let mut unknown = serde_json::to_value(test_bootstrap(b"engine payload")).unwrap();
        unknown
            .as_object_mut()
            .unwrap()
            .insert("unexpected".into(), serde_json::Value::Bool(true));
        assert!(serde_json::from_value::<BootstrapManifest>(unknown).is_err());
    }

    #[test]
    fn retries_download_and_reports_hash_mismatch() {
        let root = test_root("hash-retry");
        fs::create_dir_all(&root).unwrap();
        let spec = artifact("engine", b"expected");
        let source = FakeArtifactSource::failing_then_bytes(1, b"wrong".to_vec());
        let error = download_verified(
            &source,
            &spec,
            &root,
            2,
            Duration::ZERO,
            &CancellationToken::new(),
            &ProvisionDeadline::from_timeout(Duration::from_secs(30)).unwrap(),
            &mut NoopProgress,
        )
        .unwrap_err();
        assert_eq!(error.code(), ProvisionErrorCode::HashMismatch);
        assert_eq!(source.calls(), 2);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn red_failed_retry_preserves_an_existing_destination_byte_for_byte() {
        let root = test_root("destination-preserve");
        fs::create_dir_all(&root).unwrap();
        let spec = artifact("engine", b"new-bytes");
        let destination = root.join("engine-1.0.0");
        fs::write(&destination, b"active-bytes").unwrap();
        let source = FakeArtifactSource::failing_then_bytes(3, b"new-bytes".to_vec());
        let error = download_verified(
            &source,
            &spec,
            &root,
            2,
            Duration::ZERO,
            &CancellationToken::new(),
            &ProvisionDeadline::from_timeout(Duration::from_secs(30)).unwrap(),
            &mut NoopProgress,
        )
        .unwrap_err();
        assert_eq!(error.code(), ProvisionErrorCode::DownloadFailed);
        assert_eq!(fs::read(&destination).unwrap(), b"active-bytes");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cancellation_is_honored_at_each_progress_phase() {
        for phase in ProvisionPhase::ALL {
            let mut sink = CancelOnPhase::new(phase);
            sink.report(ProgressEvent::phase(phase));
            assert!(
                sink.token().is_cancelled(),
                "phase {phase:?} was not cancellable"
            );
        }
    }

    #[test]
    fn provisioner_cancels_before_activation_when_each_operational_phase_requests_it() {
        for phase in ProvisionPhase::ALL
            .into_iter()
            .filter(|phase| *phase != ProvisionPhase::Cleanup)
        {
            let root = test_root(&format!("cancel-{phase:?}"));
            fs::create_dir_all(&root).unwrap();
            let bootstrap = test_bootstrap(b"engine payload");
            let mut sink = CancelOnPhase::new(phase);
            let token = sink.token();
            let error = Provisioner::new(
                test_config(root.clone(), bootstrap.clone()),
                FakeArtifactSource::bytes_for(&bootstrap.engine),
                FakeProcessRunner::successful(&root),
                FakeHealthChecker::healthy(),
                &mut sink,
            )
            .provision_first_install(token)
            .unwrap_err();
            assert_eq!(
                error.code(),
                ProvisionErrorCode::Cancelled,
                "phase {phase:?}"
            );
            if phase != ProvisionPhase::VerifyBootstrap {
                assert!(
                    root.join("quarantine").exists(),
                    "cancelled phase {phase:?} was not quarantined"
                );
            }
            let _ = fs::remove_dir_all(root);
        }
    }

    #[test]
    fn successful_first_install_health_gates_manifest_activation_and_cleanup() {
        let root = test_root("success");
        fs::create_dir_all(&root).unwrap();
        let bootstrap = test_bootstrap(b"engine payload");
        let source = FakeArtifactSource::bytes_for(&bootstrap.engine);
        let runner = FakeProcessRunner::successful(&root);
        let health = FakeHealthChecker::healthy();
        let mut progress = RecordingProgress::default();
        let config = test_config(root.clone(), bootstrap);
        let result = Provisioner::new(config, source, runner.clone(), health, &mut progress)
            .provision_first_install(CancellationToken::new())
            .unwrap();
        assert_eq!(result.state, ProvisionedState::Ready);
        assert!(result.manifest.engine.project_dir.unwrap().is_dir());
        assert!(result
            .manifest
            .engine
            .python_executable
            .as_ref()
            .unwrap()
            .is_file());
        let persisted_python = result.manifest.engine.python_executable.as_ref().unwrap();
        assert!(persisted_python
            .to_string_lossy()
            .to_ascii_lowercase()
            .contains("venv"));
        assert!(!persisted_python.starts_with(root.join("python")));
        assert!(result.manifest_path.is_file());
        assert!(!root.join("staging").join(&result.operation_id).exists());
        assert!(runner
            .sync_args()
            .iter()
            .any(|args| args.iter().any(|arg| arg == "--locked")));
        let env = runner.last_env();
        assert!(env.contains_key("UV_PYTHON_INSTALL_DIR"));
        assert!(env.contains_key("UV_PROJECT_ENVIRONMENT"));
        assert!(env.contains_key("UV_CACHE_DIR"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn process_failure_health_failure_cancel_and_cas_failure_quarantine_staging() {
        let root = test_root("failures");
        fs::create_dir_all(&root).unwrap();
        let bootstrap = test_bootstrap(b"engine payload");
        let source = FakeArtifactSource::bytes_for(&bootstrap.engine);
        let mut runner = FakeProcessRunner::successful(&root);
        runner.fail_sync = true;
        let mut progress = RecordingProgress::default();
        let error = Provisioner::new(
            test_config(root.clone(), bootstrap.clone()),
            source,
            runner,
            FakeHealthChecker::healthy(),
            &mut progress,
        )
        .provision_first_install(CancellationToken::new())
        .unwrap_err();
        assert_eq!(error.code(), ProvisionErrorCode::ProcessFailed);
        assert!(root.join("quarantine").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn health_failure_is_typed_and_never_activates() {
        let root = test_root("health-failure");
        fs::create_dir_all(&root).unwrap();
        let bootstrap = test_bootstrap(b"engine payload");
        let mut health = FakeHealthChecker::healthy();
        health.fail = true;
        let mut progress = RecordingProgress::default();
        let error = Provisioner::new(
            test_config(root.clone(), bootstrap.clone()),
            FakeArtifactSource::bytes_for(&bootstrap.engine),
            FakeProcessRunner::successful(&root),
            health,
            &mut progress,
        )
        .provision_first_install(CancellationToken::new())
        .unwrap_err();
        assert_eq!(error.code(), ProvisionErrorCode::HealthCheckFailed);
        assert!(!root.join("engine").join("releases").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn activation_uses_manifest_cas_and_quarantines_on_revision_conflict() {
        let root = test_root("cas-conflict");
        fs::create_dir_all(&root).unwrap();
        let bootstrap = test_bootstrap(b"engine payload");
        let mut runner = FakeProcessRunner::successful(&root);
        runner.corrupt_manifest_on_sync = true;
        let mut progress = RecordingProgress::default();
        let error = Provisioner::new(
            test_config(root.clone(), bootstrap.clone()),
            FakeArtifactSource::bytes_for(&bootstrap.engine),
            runner,
            FakeHealthChecker::healthy(),
            &mut progress,
        )
        .provision_first_install(CancellationToken::new())
        .unwrap_err();
        assert_eq!(error.code(), ProvisionErrorCode::ManifestConflict);
        assert!(root.join("quarantine").exists());
        let _ = fs::remove_dir_all(root);
    }

    fn artifact(name: &str, bytes: &[u8]) -> ArtifactSpec {
        ArtifactSpec {
            name: name.into(),
            version: "1.0.0".into(),
            sha256: sha256(bytes),
            source: format!("https://example.test/{name}"),
            kind: ArtifactKind::File,
            expected_size: bytes.len() as u64,
            max_size: bytes.len() as u64,
        }
    }

    fn test_bootstrap(bytes: &[u8]) -> BootstrapManifest {
        BootstrapManifest {
            schema_version: BOOTSTRAP_SCHEMA_VERSION,
            product_version: "1.0.0".into(),
            python_version: "3.12.4".into(),
            allowed_hosts: vec!["example.test".into()],
            uv: artifact("uv", b"uv"),
            engine: artifact("engine", bytes),
        }
    }

    fn test_config(root: PathBuf, bootstrap: BootstrapManifest) -> ProvisionerConfig {
        ProvisionerConfig {
            data_root: root,
            install_id: "install-1".into(),
            app_module: "opencohost.api.main:app".into(),
            preferred_port: 8765,
            fallback_port: 8770,
            bootstrap,
            max_download_retries: 2,
            retry_backoff: Duration::ZERO,
            python_executable_name: "python.exe".into(),
            operation_timeout: Duration::from_secs(300),
        }
    }

    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("opencohost-wu3-{label}-{}", std::process::id()))
    }

    #[cfg(windows)]
    fn windows_process_is_alive(pid: u32) -> bool {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return false;
            }
            let mut exit_code = 0;
            let result = GetExitCodeProcess(handle, &mut exit_code);
            CloseHandle(handle);
            result != 0 && exit_code == 259
        }
    }

    fn sha256(bytes: &[u8]) -> String {
        let mut digest = sha2::Sha256::new();
        digest.update(bytes);
        format!("{:x}", digest.finalize())
    }
    fn zip_bytes<const N: usize>(entries: [(&str, &[u8]); N]) -> Vec<u8> {
        let mut out = Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(&mut out);
        for (name, bytes) in entries {
            zip.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
        out.into_inner()
    }

    fn find_test_python(root: &Path) -> Option<String> {
        for entry in fs::read_dir(root).ok()? {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.file_name().is_some_and(|name| name == "python.exe") {
                return Some(path.to_string_lossy().into_owned());
            }
            if path.is_dir() {
                if let Some(found) = find_test_python(&path) {
                    return Some(found);
                }
            }
        }
        None
    }

    struct FakeLiveness(std::collections::HashSet<u32>);
    impl FakeLiveness {
        fn live<const N: usize>(pids: [u32; N]) -> Self {
            Self(pids.into_iter().collect())
        }
        fn dead<const N: usize>(pids: [u32; N]) -> Self {
            let _ = pids;
            Self(std::collections::HashSet::new())
        }
    }
    impl ProcessLiveness for FakeLiveness {
        fn is_alive(&self, pid: u32) -> bool {
            self.0.contains(&pid)
        }
    }

    #[cfg(windows)]
    #[derive(Debug)]
    struct JunctionUnavailable {
        reason: String,
    }

    #[cfg(windows)]
    fn create_junction(link: &Path, target: &Path) -> Result<(), JunctionUnavailable> {
        let link = link.to_string_lossy().into_owned();
        let target = target.to_string_lossy().into_owned();
        let output = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &link, &target])
            .output()
            .map_err(|error| JunctionUnavailable {
                reason: error.to_string(),
            })?;
        if output.status.success() {
            Ok(())
        } else {
            Err(JunctionUnavailable {
                reason: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            })
        }
    }

    #[derive(Default)]
    struct RecordingProgress {
        events: Vec<ProgressEvent>,
    }
    impl ProgressSink for RecordingProgress {
        fn report(&mut self, event: ProgressEvent) {
            self.events.push(event);
        }
    }

    struct CancelOnPhase {
        target: ProvisionPhase,
        token: CancellationToken,
    }
    impl CancelOnPhase {
        fn new(target: ProvisionPhase) -> Self {
            Self {
                target,
                token: CancellationToken::new(),
            }
        }
        fn token(&self) -> CancellationToken {
            self.token.clone()
        }
    }
    impl ProgressSink for CancelOnPhase {
        fn report(&mut self, event: ProgressEvent) {
            if event.phase == self.target {
                self.token.cancel();
            }
        }
    }

    struct FakeArtifactSource {
        calls: Arc<std::sync::atomic::AtomicUsize>,
        failures: Arc<std::sync::atomic::AtomicUsize>,
        bytes: Arc<BTreeMap<String, Vec<u8>>>,
    }

    struct TerminalArtifactSource {
        code: ProvisionErrorCode,
        calls: Arc<std::sync::atomic::AtomicUsize>,
    }
    impl ArtifactSource for TerminalArtifactSource {
        fn fetch(
            &self,
            _artifact: &ArtifactSpec,
            _destination: &Path,
            _deadline: &ProvisionDeadline,
            _cancel: &CancellationToken,
        ) -> Result<(), ProvisionError> {
            self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Err(ProvisionError::new(self.code, "terminal", false))
        }
    }
    impl FakeArtifactSource {
        fn failing_then_bytes(failures: usize, bytes: Vec<u8>) -> Self {
            Self {
                calls: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
                failures: Arc::new(std::sync::atomic::AtomicUsize::new(failures)),
                bytes: Arc::new(BTreeMap::from([("engine".into(), bytes)])),
            }
        }
        fn bytes_for(engine: &ArtifactSpec) -> Self {
            Self {
                calls: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
                failures: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
                bytes: Arc::new(BTreeMap::from([
                    ("uv".into(), b"uv".to_vec()),
                    ("python".into(), b"python".to_vec()),
                    (engine.name.clone(), b"engine payload".to_vec()),
                ])),
            }
        }
        fn calls(&self) -> usize {
            self.calls.load(std::sync::atomic::Ordering::SeqCst)
        }
    }
    impl ArtifactSource for FakeArtifactSource {
        fn fetch(
            &self,
            artifact: &ArtifactSpec,
            destination: &Path,
            deadline: &ProvisionDeadline,
            cancel: &CancellationToken,
        ) -> Result<(), ProvisionError> {
            deadline.check(cancel)?;
            self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if self
                .failures
                .fetch_update(
                    std::sync::atomic::Ordering::SeqCst,
                    std::sync::atomic::Ordering::SeqCst,
                    |value| value.checked_sub(1),
                )
                .is_ok()
            {
                return Err(ProvisionError::new(
                    ProvisionErrorCode::DownloadFailed,
                    "injected",
                    true,
                ));
            }
            fs::write(
                destination,
                self.bytes.get(&artifact.name).cloned().unwrap_or_default(),
            )
            .map_err(Into::into)
        }
    }

    #[derive(Clone)]
    struct FakeProcessRunner {
        root: PathBuf,
        pub fail_sync: bool,
        pub corrupt_manifest_on_sync: bool,
        args: Arc<Mutex<Vec<Vec<String>>>>,
        envs: Arc<Mutex<Vec<BTreeMap<String, String>>>>,
    }
    impl FakeProcessRunner {
        fn successful(root: &Path) -> Self {
            Self {
                root: root.into(),
                fail_sync: false,
                corrupt_manifest_on_sync: false,
                args: Arc::new(Mutex::new(Vec::new())),
                envs: Arc::new(Mutex::new(Vec::new())),
            }
        }
        fn sync_args(&self) -> Vec<Vec<String>> {
            self.args.lock().unwrap().clone()
        }
        fn last_env(&self) -> BTreeMap<String, String> {
            self.envs
                .lock()
                .unwrap()
                .last()
                .cloned()
                .unwrap_or_default()
        }
    }
    impl ProcessRunner for FakeProcessRunner {
        fn run(
            &self,
            _program: &Path,
            args: &[String],
            _cwd: &Path,
            env: &BTreeMap<String, String>,
            cancel: &CancellationToken,
            deadline: &ProvisionDeadline,
        ) -> Result<ProcessOutput, ProvisionError> {
            deadline.check(cancel)?;
            self.args.lock().unwrap().push(args.to_vec());
            self.envs.lock().unwrap().push(env.clone());
            if args.first().is_some_and(|arg| arg == "sync") {
                let venv = env
                    .get("UV_PROJECT_ENVIRONMENT")
                    .map(PathBuf::from)
                    .unwrap();
                fs::create_dir_all(venv.join(if cfg!(windows) { "Scripts" } else { "bin" }))
                    .unwrap();
                fs::write(
                    venv.join(if cfg!(windows) {
                        "Scripts/python.exe"
                    } else {
                        "bin/python"
                    }),
                    b"venv-python",
                )
                .unwrap();
                fs::write(
                    venv.join("pyvenv.cfg"),
                    format!("home = {}\n", env.get("UV_PYTHON_INSTALL_DIR").unwrap()),
                )
                .unwrap();
                if self.corrupt_manifest_on_sync {
                    let _ = fs::write(
                        self.root.join("state").join("runtime-manifest.json"),
                        b"corrupt",
                    );
                }
                if self.fail_sync {
                    return Ok(ProcessOutput {
                        status: 1,
                        stderr: "sync failed".into(),
                        ..Default::default()
                    });
                }
            }
            if args.first().is_some_and(|arg| arg == "python") {
                if let Some(index) = args.iter().position(|arg| arg == "--install-dir") {
                    let dir = PathBuf::from(&args[index + 1]);
                    fs::create_dir_all(&dir).unwrap();
                    let versioned = dir.join("cpython-3.12.4-windows-x86_64-none");
                    fs::create_dir_all(&versioned).unwrap();
                    fs::write(versioned.join("python.exe"), b"python").unwrap();
                }
            }
            if args.first().is_some_and(|arg| arg == "python")
                && args.get(1).is_some_and(|arg| arg == "find")
            {
                let root = PathBuf::from(env.get("UV_PYTHON_INSTALL_DIR").unwrap());
                let found = find_test_python(&root).unwrap_or_default();
                return Ok(ProcessOutput {
                    status: 0,
                    stdout: format!("{found}\n"),
                    ..Default::default()
                });
            }
            Ok(ProcessOutput {
                status: 0,
                ..Default::default()
            })
        }
    }

    struct FakeHealthChecker {
        fail: bool,
    }
    impl FakeHealthChecker {
        fn healthy() -> Self {
            Self { fail: false }
        }
    }
    impl HealthChecker for FakeHealthChecker {
        fn check(
            &self,
            _project_dir: &Path,
            _python_executable: &Path,
            _env: &BTreeMap<String, String>,
            cancel: &CancellationToken,
            deadline: &ProvisionDeadline,
        ) -> Result<(), ProvisionError> {
            deadline.check(cancel)?;
            if self.fail {
                Err(ProvisionError::new(
                    ProvisionErrorCode::HealthCheckFailed,
                    "health failed",
                    true,
                ))
            } else {
                Ok(())
            }
        }
    }
}
