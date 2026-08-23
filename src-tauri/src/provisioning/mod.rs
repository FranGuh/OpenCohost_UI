pub mod archive;
pub mod artifacts;
pub mod cancellation;
pub mod error;
pub mod health;
pub mod model;
pub mod operation_lock;
pub mod orchestrator;
pub mod process;

#[cfg(test)]
mod tests;

pub use archive::{extract_zip_safely, extract_zip_safely_with_limits, ZipLimits};
#[allow(unused_imports)]
pub(crate) use archive::{
    extract_zip_safely_under_root, validate_missing_boundary, validate_write_boundary,
};
#[allow(unused_imports)]
pub(crate) use artifacts::download_verified_under_root;
pub use artifacts::{download_verified, sha256, ArtifactSource};
pub use cancellation::{CancellationToken, CommitGuard};
pub use error::{ProvisionDeadline, ProvisionError, ProvisionErrorCode};
pub use health::HealthChecker;
pub use model::{
    ArtifactKind, ArtifactSpec, BootstrapManifest, NoopProgress, ProgressEvent, ProgressSink,
    ProvisionPhase, ProvisionResult, ProvisionedState, ProvisionerConfig, BOOTSTRAP_SCHEMA_VERSION,
};
pub use operation_lock::{
    OperationLock, OperationMetadata, ProcessLiveness, SystemProcessLiveness,
};
pub use orchestrator::Provisioner;
pub use process::{
    build_child_environment, build_uv_find_args, build_uv_python_install_args, build_uv_sync_args,
    resolve_managed_python_path, CommandProcessRunner, ProcessOutput, ProcessRunner,
};
