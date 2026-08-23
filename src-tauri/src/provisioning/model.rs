use crate::provisioning::error::{ProvisionError, ProvisionErrorCode};
use crate::runtime::RuntimeManifest;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use unicode_normalization::UnicodeNormalization;
use url::Url;

pub const BOOTSTRAP_SCHEMA_VERSION: u32 = 1;

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
    pub fn phase(phase: ProvisionPhase) -> Self {
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
    pub fn validate(&self) -> Result<(), ProvisionError> {
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

pub fn artifact_destination_identity(artifact: &ArtifactSpec) -> String {
    windows_collision_key(&format!(
        "{}-{}",
        artifact.name.trim_end_matches(['.', ' ']),
        artifact.version.trim_end_matches(['.', ' '])
    ))
}

pub fn windows_collision_key(value: &str) -> String {
    value.nfc().flat_map(char::to_uppercase).collect()
}

pub fn is_pinned_python_request(request: &str) -> bool {
    let parts = request.split('.').collect::<Vec<_>>();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty() && part.chars().all(|character| character.is_ascii_digit())
        })
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
