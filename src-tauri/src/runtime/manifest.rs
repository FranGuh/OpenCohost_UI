use serde::{Deserialize, Serialize};
use std::fmt;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

pub const RUNTIME_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum RuntimeState {
    Unprovisioned,
    Provisioning,
    Ready,
    Repairing,
    Updating,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(deny_unknown_fields)]
pub struct RuntimeOperation {
    pub id: Option<String>,
    pub kind: Option<String>,
    pub phase: Option<String>,
    pub last_error_code: Option<String>,
    pub retryable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EngineManifest {
    pub active_version: Option<String>,
    pub previous_version: Option<String>,
    pub pending_version: Option<String>,
    pub active_generation: Option<String>,
    pub previous_generation: Option<String>,
    pub project_dir: Option<PathBuf>,
    pub python_executable: Option<PathBuf>,
    pub app_module: String,
    pub preferred_port: u16,
    pub fallback_port: u16,
    pub lock_sha256: Option<String>,
    pub payload_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ToolingManifest {
    pub uv_version: String,
    pub python_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PiperManifest {
    pub requested: bool,
    pub state: String,
    pub package_version: Option<String>,
    pub voices_manifest_sha256: Option<String>,
    pub voices: Vec<VoiceManifest>,
}

impl Default for PiperManifest {
    fn default() -> Self {
        Self {
            requested: false,
            state: "absent".into(),
            package_version: None,
            voices_manifest_sha256: None,
            voices: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct VoiceManifest {
    pub id: String,
    pub language: String,
    pub model_path: String,
    pub config_path: String,
    pub model_sha256: String,
    pub config_sha256: String,
    pub source: String,
    pub license: String,
    pub notice_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ComponentsManifest {
    pub piper: PiperManifest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RuntimeManifest {
    pub schema_version: u32,
    pub install_id: String,
    pub product_version: String,
    pub data_root: PathBuf,
    pub revision: u64,
    pub state: RuntimeState,
    pub operation: RuntimeOperation,
    pub engine: EngineManifest,
    pub tooling: ToolingManifest,
    pub components: ComponentsManifest,
}

#[derive(Debug)]
pub struct RuntimeManifestError(String);

impl RuntimeManifestError {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for RuntimeManifestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for RuntimeManifestError {}

impl From<io::Error> for RuntimeManifestError {
    fn from(error: io::Error) -> Self {
        Self::new(error.to_string())
    }
}

impl From<serde_json::Error> for RuntimeManifestError {
    fn from(error: serde_json::Error) -> Self {
        Self::new(format!("invalid runtime manifest JSON: {error}"))
    }
}

static MANIFEST_WRITE_LOCK: Mutex<()> = Mutex::new(());
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

impl RuntimeManifest {
    pub fn read(
        path: &Path,
        expected_install_id: Option<&str>,
    ) -> Result<Self, RuntimeManifestError> {
        let text = fs::read_to_string(path)?;
        let manifest: Self = serde_json::from_str(&text)?;
        manifest.validate(expected_install_id)?;
        Ok(manifest)
    }

    pub fn read_recovery(
        path: &Path,
        expected_install_id: Option<&str>,
    ) -> Result<Self, RuntimeManifestError> {
        match Self::read(path, expected_install_id) {
            Ok(manifest) => Ok(manifest),
            Err(primary_error) => {
                let recovery = recovery_path(path);
                Self::read(&recovery, expected_install_id).map_err(|recovery_error| {
                    RuntimeManifestError::new(format!(
                        "runtime manifest and recovery copy are invalid: primary={primary_error}; recovery={recovery_error}"
                    ))
                })
            }
        }
    }

    pub fn validate(&self, expected_install_id: Option<&str>) -> Result<(), RuntimeManifestError> {
        if self.schema_version != RUNTIME_SCHEMA_VERSION {
            return Err(RuntimeManifestError::new(format!(
                "unsupported runtime manifest schema version {}",
                self.schema_version
            )));
        }
        if self.install_id.trim().is_empty() {
            return Err(RuntimeManifestError::new(
                "runtime manifest install_id is empty",
            ));
        }
        if let Some(expected) = expected_install_id {
            if expected != self.install_id {
                return Err(RuntimeManifestError::new(
                    "runtime manifest install_id does not match HKCU handoff",
                ));
            }
        }
        if self.product_version.trim().is_empty() || self.engine.app_module.trim().is_empty() {
            return Err(RuntimeManifestError::new(
                "runtime manifest product/module is empty",
            ));
        }
        if self.preferred_port() == 0 || self.fallback_port() == 0 {
            return Err(RuntimeManifestError::new(
                "runtime manifest ports must be non-zero",
            ));
        }
        if self.preferred_port() == self.fallback_port() {
            return Err(RuntimeManifestError::new(
                "runtime manifest preferred and fallback ports must differ",
            ));
        }
        validate_data_root(&self.data_root)?;

        if let Some(active_generation) = &self.engine.active_generation {
            if active_generation.trim().is_empty() {
                return Err(RuntimeManifestError::new("active_generation is empty"));
            }
        }
        if let Some(project_dir) = &self.engine.project_dir {
            validate_existing_path(&self.data_root, project_dir, true, "engine.project_dir")?;
        }
        if let Some(python_executable) = &self.engine.python_executable {
            validate_existing_path(
                &self.data_root,
                python_executable,
                false,
                "engine.python_executable",
            )?;
        }
        if matches!(
            self.state,
            RuntimeState::Ready | RuntimeState::Repairing | RuntimeState::Updating
        ) && (self.engine.project_dir.is_none() || self.engine.python_executable.is_none())
        {
            return Err(RuntimeManifestError::new(
                "active runtime state requires project_dir and python_executable",
            ));
        }
        validate_hash(self.engine.lock_sha256.as_deref(), "engine.lock_sha256")?;
        validate_hash(
            self.engine.payload_sha256.as_deref(),
            "engine.payload_sha256",
        )?;
        if self.tooling.uv_version.trim().is_empty()
            || self.tooling.python_version.trim().is_empty()
        {
            return Err(RuntimeManifestError::new(
                "runtime tooling versions are empty",
            ));
        }
        validate_piper(&self.data_root, &self.components.piper)?;
        Ok(())
    }

    pub fn write_atomic(&self, path: &Path) -> Result<(), RuntimeManifestError> {
        self.write_atomic_cas(path, None)
    }

    pub fn write_atomic_cas(
        &self,
        path: &Path,
        expected_revision: Option<u64>,
    ) -> Result<(), RuntimeManifestError> {
        self.write_atomic_inner(path, expected_revision, false)
    }

    pub(crate) fn write_atomic_cas_with_gate<F>(
        &self,
        path: &Path,
        expected_revision: Option<u64>,
        before_replace: F,
    ) -> Result<(), RuntimeManifestError>
    where
        F: FnOnce() -> Result<(), RuntimeManifestError>,
    {
        self.write_atomic_inner_with_gate(path, expected_revision, false, before_replace)
    }

    #[cfg(test)]
    pub(crate) fn write_atomic_for_test(
        &self,
        path: &Path,
        expected_revision: Option<u64>,
        inject_failure: bool,
    ) -> Result<(), RuntimeManifestError> {
        self.write_atomic_inner(path, expected_revision, inject_failure)
    }

    fn write_atomic_inner(
        &self,
        path: &Path,
        expected_revision: Option<u64>,
        inject_failure: bool,
    ) -> Result<(), RuntimeManifestError> {
        self.write_atomic_inner_with_gate(path, expected_revision, inject_failure, || Ok(()))
    }

    fn write_atomic_inner_with_gate<F>(
        &self,
        path: &Path,
        expected_revision: Option<u64>,
        inject_failure: bool,
        before_replace: F,
    ) -> Result<(), RuntimeManifestError>
    where
        F: FnOnce() -> Result<(), RuntimeManifestError>,
    {
        self.validate(None)?;
        let _guard = MANIFEST_WRITE_LOCK
            .lock()
            .map_err(|_| RuntimeManifestError::new("manifest writer lock is poisoned"))?;
        let parent = path
            .parent()
            .ok_or_else(|| RuntimeManifestError::new("manifest path has no parent"))?;
        fs::create_dir_all(parent)?;

        let current = latest_readable_manifest(path);
        if current.is_none()
            && expected_revision.is_some()
            && (path.exists() || recovery_path(path).exists())
        {
            return Err(RuntimeManifestError::new(
                "manifest_revision_conflict: no readable primary or recovery manifest",
            ));
        }
        if let Some(expected) = expected_revision {
            let actual = current.as_ref().map(|manifest| manifest.revision);
            if actual != Some(expected) || self.revision <= expected {
                return Err(RuntimeManifestError::new(format!(
                    "manifest_revision_conflict: expected revision {expected}, actual {:?}, candidate {}",
                    actual, self.revision
                )));
            }
        } else if let Some(previous) = &current {
            if self.revision <= previous.revision {
                return Err(RuntimeManifestError::new(format!(
                    "manifest_revision_conflict: current revision {}, candidate {}",
                    previous.revision, self.revision
                )));
            }
        }
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let temp_path = parent.join(format!(
            ".{}.{}.{}.tmp",
            path.file_name().unwrap_or_default().to_string_lossy(),
            std::process::id(),
            sequence
        ));
        let result = (|| {
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temp_path)?;
            let encoded = serde_json::to_vec_pretty(self)?;
            file.write_all(&encoded)?;
            file.write_all(b"\n")?;
            file.flush()?;
            file.sync_all()?;
            if inject_failure {
                return Err(RuntimeManifestError::new("injected manifest write failure"));
            }
            before_replace()?;
            if let Some(previous) = &current {
                let recovery = recovery_path(path);
                let encoded_prev = serde_json::to_vec_pretty(previous)?;
                fs::write(recovery, [encoded_prev, b"\n".to_vec()].concat())?;
            }
            fs::rename(&temp_path, path)?;
            Ok::<(), RuntimeManifestError>(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temp_path);
        }
        result
    }

    fn preferred_port(&self) -> u16 {
        self.engine.preferred_port
    }
    fn fallback_port(&self) -> u16 {
        self.engine.fallback_port
    }
}

pub(crate) fn recovery_path(path: &Path) -> PathBuf {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("runtime-manifest");
    path.with_file_name(format!("{stem}.previous.json"))
}

pub(crate) fn latest_readable_manifest(path: &Path) -> Option<RuntimeManifest> {
    [path.to_path_buf(), recovery_path(path)]
        .iter()
        .filter_map(|candidate| RuntimeManifest::read(candidate, None).ok())
        .max_by_key(|manifest| manifest.revision)
}

pub fn validate_data_root(path: &Path) -> Result<(), RuntimeManifestError> {
    if !path.is_absolute() {
        return Err(RuntimeManifestError::new("data_root must be absolute"));
    }
    if is_unc_path(path) {
        return Err(RuntimeManifestError::new(
            "network/UNC data roots are not supported",
        ));
    }
    if !path.is_dir() {
        return Err(RuntimeManifestError::new(
            "data_root does not exist as a directory",
        ));
    }
    let canonical = fs::canonicalize(path)?;
    if is_unc_path(&canonical) || !is_fixed_drive_path(&canonical) {
        return Err(RuntimeManifestError::new(
            "data_root must be on a local fixed drive",
        ));
    }
    Ok(())
}

pub(crate) fn validate_existing_path(
    root: &Path,
    path: &Path,
    directory: bool,
    label: &str,
) -> Result<(), RuntimeManifestError> {
    if !path.is_absolute() {
        return Err(RuntimeManifestError::new(format!(
            "{label} must be absolute"
        )));
    }
    if is_unc_path(path) {
        return Err(RuntimeManifestError::new(format!(
            "{label} cannot use a network/UNC path"
        )));
    }
    let canonical_root = fs::canonicalize(root)?;
    let canonical_path = fs::canonicalize(path)
        .map_err(|error| RuntimeManifestError::new(format!("{label} does not exist: {error}")))?;
    if !is_contained(&canonical_root, &canonical_path) {
        return Err(RuntimeManifestError::new(format!(
            "{label} escapes data_root"
        )));
    }
    let metadata = fs::metadata(&canonical_path)?;
    if directory && !metadata.is_dir() {
        return Err(RuntimeManifestError::new(format!(
            "{label} is not a directory"
        )));
    }
    if !directory && !metadata.is_file() {
        return Err(RuntimeManifestError::new(format!("{label} is not a file")));
    }
    Ok(())
}

#[cfg(windows)]
pub(crate) fn is_contained(root: &Path, candidate: &Path) -> bool {
    if candidate.starts_with(root) {
        return true;
    }
    let root = root.to_string_lossy().to_ascii_lowercase();
    let candidate = candidate.to_string_lossy().to_ascii_lowercase();
    candidate == root
        || candidate
            .strip_prefix(root.trim_end_matches(['\\', '/']))
            .is_some_and(|suffix| suffix.starts_with('\\') || suffix.starts_with('/'))
}

#[cfg(not(windows))]
pub(crate) fn is_contained(root: &Path, candidate: &Path) -> bool {
    candidate.starts_with(root)
}

pub(crate) fn canonical_paths_equal(
    left: &Path,
    right: &Path,
) -> Result<bool, RuntimeManifestError> {
    let left = fs::canonicalize(left)?;
    let right = fs::canonicalize(right)?;
    #[cfg(windows)]
    {
        Ok(left
            .to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy()))
    }
    #[cfg(not(windows))]
    {
        Ok(left == right)
    }
}

pub(crate) fn validate_hash(value: Option<&str>, label: &str) -> Result<(), RuntimeManifestError> {
    if let Some(hash) = value {
        if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(RuntimeManifestError::new(format!(
                "{label} must be a SHA-256 hex digest"
            )));
        }
    }
    Ok(())
}

pub(crate) fn validate_piper(
    root: &Path,
    piper: &PiperManifest,
) -> Result<(), RuntimeManifestError> {
    if !matches!(
        piper.state.as_str(),
        "absent" | "installing" | "installed" | "removing" | "failed"
    ) {
        return Err(RuntimeManifestError::new(
            "components.piper.state is invalid",
        ));
    }
    if piper.state == "absent" && !piper.voices.is_empty() {
        return Err(RuntimeManifestError::new(
            "absent Piper component cannot contain voices",
        ));
    }
    if piper.state == "installed"
        && (!piper.requested
            || piper
                .package_version
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty()
            || piper.voices_manifest_sha256.is_none())
    {
        return Err(RuntimeManifestError::new(
            "installed Piper component requires requested=true, package_version, and voices_manifest_sha256",
        ));
    }
    validate_hash(
        piper.voices_manifest_sha256.as_deref(),
        "components.piper.voices_manifest_sha256",
    )?;
    for voice in &piper.voices {
        if voice.id.trim().is_empty()
            || voice.language.trim().is_empty()
            || voice.license.trim().is_empty()
        {
            return Err(RuntimeManifestError::new(
                "Piper voice metadata is incomplete",
            ));
        }
        validate_relative_component_path(root, &voice.model_path, "Piper model_path")?;
        validate_relative_component_path(root, &voice.config_path, "Piper config_path")?;
        validate_relative_component_path(root, &voice.notice_path, "Piper notice_path")?;
        validate_hash(Some(&voice.model_sha256), "Piper model_sha256")?;
        validate_hash(Some(&voice.config_sha256), "Piper config_sha256")?;
    }
    Ok(())
}

pub(crate) fn validate_relative_component_path(
    root: &Path,
    value: &str,
    label: &str,
) -> Result<(), RuntimeManifestError> {
    let relative = Path::new(value);
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(RuntimeManifestError::new(format!(
            "{label} must remain relative and contained"
        )));
    }
    let component_root = root.join("components").join("piper");
    let candidate = component_root.join(relative);

    let canonical_data_root = fs::canonicalize(root)?;
    let canonical_component_root =
        fs::canonicalize(nearest_existing_ancestor(&component_root).ok_or_else(|| {
            RuntimeManifestError::new(format!("{label} has no existing component ancestor"))
        })?)?;
    let canonical_candidate_ancestor =
        fs::canonicalize(nearest_existing_ancestor(&candidate).ok_or_else(|| {
            RuntimeManifestError::new(format!("{label} has no existing ancestor"))
        })?)?;
    validate_canonical_component_ancestor(
        &canonical_data_root,
        &canonical_component_root,
        &canonical_candidate_ancestor,
        label,
    )?;

    if candidate.exists() {
        validate_existing_path(root, &candidate, false, label)?;
    }
    Ok(())
}

fn nearest_existing_ancestor(path: &Path) -> Option<PathBuf> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        if candidate.exists() {
            return Some(candidate.to_path_buf());
        }
        current = candidate.parent();
    }
    None
}

fn validate_canonical_component_ancestor(
    canonical_data_root: &Path,
    canonical_component_root: &Path,
    canonical_ancestor: &Path,
    label: &str,
) -> Result<(), RuntimeManifestError> {
    if !is_contained(canonical_data_root, canonical_component_root) {
        return Err(RuntimeManifestError::new(format!(
            "{label} escapes data_root"
        )));
    }
    if !is_contained(canonical_component_root, canonical_ancestor) {
        return Err(RuntimeManifestError::new(format!(
            "{label} escapes approved component root"
        )));
    }
    Ok(())
}

fn is_unc_path(path: &Path) -> bool {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix("\\\\?\\") {
        return rest
            .as_bytes()
            .get(0..2)
            .is_none_or(|prefix| prefix[1] != b':');
    }
    text.starts_with(r"\\") || text.starts_with("//")
}

#[cfg(windows)]
fn is_fixed_drive_path(path: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;
    let text = path.to_string_lossy();
    let drive = if let Some(rest) = text.strip_prefix("\\\\?\\") {
        rest.as_bytes().get(0..2).filter(|prefix| prefix[1] == b':')
    } else {
        text.as_bytes().get(0..2).filter(|prefix| prefix[1] == b':')
    };
    let Some(drive) = drive else {
        return false;
    };
    let mut root = String::from_utf8_lossy(drive).into_owned();
    root.push('\\');
    let mut wide: Vec<u16> = std::ffi::OsStr::new(&root).encode_wide().collect();
    wide.push(0);
    const DRIVE_FIXED: u32 = 3;
    unsafe { GetDriveTypeW(wide.as_ptr()) == DRIVE_FIXED }
}

#[cfg(not(windows))]
fn is_fixed_drive_path(_path: &Path) -> bool {
    true
}
