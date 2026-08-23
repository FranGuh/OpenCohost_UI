use crate::provisioning::error::{ProvisionError, ProvisionErrorCode};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static LOCK_NONCE: AtomicU64 = AtomicU64::new(1);

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
    pub fn validate(&self) -> Result<(), ProvisionError> {
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

pub struct SystemProcessLiveness;
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
                ok && status == STILL_ACTIVE as u32
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
        Ok(Self {
            handle: file,
            metadata,
        })
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

pub(crate) fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
