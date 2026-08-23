use crate::provisioning::archive::validate_write_boundary;
use crate::provisioning::cancellation::CancellationToken;
use crate::provisioning::error::{ProvisionDeadline, ProvisionError, ProvisionErrorCode};
use crate::provisioning::model::{ArtifactSpec, ProgressEvent, ProgressSink, ProvisionPhase};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub trait ArtifactSource {
    fn fetch(
        &self,
        artifact: &ArtifactSpec,
        destination: &Path,
        deadline: &ProvisionDeadline,
        cancel: &CancellationToken,
    ) -> Result<(), ProvisionError>;
}

pub fn sha256(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(bytes);
    format!("{:x}", digest.finalize())
}

pub fn file_sha256(path: &Path) -> Result<String, ProvisionError> {
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

pub fn download_verified<S: ArtifactSource>(
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

pub(crate) fn download_verified_under_root<S: ArtifactSource>(
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
