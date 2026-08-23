use crate::provisioning::cancellation::{ensure_not_cancelled, CancellationToken};
use std::fmt;
use std::io;
use std::time::Duration;

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

impl From<crate::runtime::RuntimeManifestError> for ProvisionError {
    fn from(error: crate::runtime::RuntimeManifestError) -> Self {
        Self::new(
            ProvisionErrorCode::ManifestConflict,
            error.to_string(),
            false,
        )
    }
}
