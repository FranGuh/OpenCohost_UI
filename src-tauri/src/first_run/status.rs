use crate::runtime::RuntimeState;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FirstRunPhase {
    Unconfigured,
    Provisioning,
    Ready,
    Failed,
    Degraded,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProgressSnapshot {
    pub phase: String,
    pub completed: u64,
    pub total: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FirstRunStatus {
    pub phase: FirstRunPhase,
    pub launchable: bool,
    pub data_root: Option<String>,
    pub default_data_root: Option<String>,
    pub install_id: Option<String>,
    pub error_code: Option<String>,
    pub message: String,
    pub can_retry: bool,
    pub progress: Option<ProgressSnapshot>,
}

#[derive(Debug, Clone)]
pub struct FirstRunError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl FirstRunError {
    pub fn new(code: impl Into<String>, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable,
        }
    }
    pub fn cancelled() -> Self {
        Self::new("cancelled", "Provisioning cancelled", true)
    }
}

impl std::fmt::Display for FirstRunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for FirstRunError {}

pub fn safe_message(code: &str) -> &'static str {
    match code {
        "unconfigured" | "runtime_unprovisioned" => {
            "Choose a data folder to install the core runtime."
        }
        "invalid_handoff" | "runtime_invalid" | "data_root_inside_install" => {
            "The runtime configuration needs repair. Choose a safe data folder and retry."
        }
        "runtime_not_ready" | "operation_busy" => {
            "The core runtime is not ready yet. Provisioning can be retried."
        }
        "cancelled" => "Provisioning was cancelled. You can retry safely.",
        "bootstrap_unavailable" | "bootstrap_invalid" => {
            "The packaged runtime metadata is unavailable. Repair the installation."
        }
        "backend_launch_failed" => {
            "The runtime installed, but the backend did not become healthy. Retry."
        }
        "ipc_unavailable" => "The runtime manager is unavailable. Restart the app and retry.",
        "unsupported_platform" => "Installed runtime provisioning is supported on Windows.",
        _ => "Core runtime provisioning could not complete. Retry or repair the installation.",
    }
}

pub fn safe_error(error: &FirstRunError) -> FirstRunError {
    FirstRunError::new(
        error.code.clone(),
        safe_message(&error.code),
        error.retryable,
    )
}

pub fn is_launchable_state(state: &RuntimeState) -> bool {
    *state == RuntimeState::Ready
}

pub fn phase_for_state(state: &RuntimeState) -> FirstRunPhase {
    match state {
        RuntimeState::Ready => FirstRunPhase::Ready,
        RuntimeState::Provisioning | RuntimeState::Repairing | RuntimeState::Updating => {
            FirstRunPhase::Provisioning
        }
        RuntimeState::Unprovisioned => FirstRunPhase::Unconfigured,
        RuntimeState::Failed => FirstRunPhase::Failed,
    }
}

pub fn status(
    phase: FirstRunPhase,
    data_root: Option<String>,
    install_id: Option<String>,
    message: impl Into<String>,
    can_retry: bool,
    progress: Option<ProgressSnapshot>,
    error_code: Option<&str>,
) -> FirstRunStatus {
    FirstRunStatus {
        launchable: phase == FirstRunPhase::Ready,
        phase,
        data_root,
        default_data_root: crate::first_run::data_root::default_data_root()
            .map(|path| path.to_string_lossy().into_owned()),
        install_id,
        error_code: error_code.map(str::to_owned),
        message: message.into(),
        can_retry,
        progress,
    }
}
