use serde::{Deserialize, Serialize};
use std::fmt;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

pub const RUNTIME_SCHEMA_VERSION: u32 = 1;
#[cfg(windows)]
pub const RUNTIME_REGISTRY_KEY: &str = r"Software\OpenCohost\Runtime";

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

    /// Writes through the same manifest mutex used by normal CAS, invoking
    /// `before_replace` while that mutex is held immediately before the
    /// irreversible primary-manifest replacement. Provisioning supplies its
    /// cancellation/deadline commit guard here so CAS has one linearization
    /// point rather than a pre-lock check followed by a rename.
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
    fn write_atomic_for_test(
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

fn recovery_path(path: &Path) -> PathBuf {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("runtime-manifest");
    path.with_file_name(format!("{stem}.previous.json"))
}

fn latest_readable_manifest(path: &Path) -> Option<RuntimeManifest> {
    [path.to_path_buf(), recovery_path(path)]
        .iter()
        .filter_map(|candidate| RuntimeManifest::read(candidate, None).ok())
        .max_by_key(|manifest| manifest.revision)
}

pub(crate) fn validate_data_root(path: &Path) -> Result<(), RuntimeManifestError> {
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

fn validate_existing_path(
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
fn is_contained(root: &Path, candidate: &Path) -> bool {
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
fn is_contained(root: &Path, candidate: &Path) -> bool {
    candidate.starts_with(root)
}

fn canonical_paths_equal(left: &Path, right: &Path) -> Result<bool, RuntimeManifestError> {
    let left = fs::canonicalize(left)?;
    let right = fs::canonicalize(right)?;
    #[cfg(windows)]
    {
        return Ok(left
            .to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy()));
    }
    #[cfg(not(windows))]
    {
        Ok(left == right)
    }
}

fn validate_hash(value: Option<&str>, label: &str) -> Result<(), RuntimeManifestError> {
    if let Some(hash) = value {
        if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(RuntimeManifestError::new(format!(
                "{label} must be a SHA-256 hex digest"
            )));
        }
    }
    Ok(())
}

fn validate_piper(root: &Path, piper: &PiperManifest) -> Result<(), RuntimeManifestError> {
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

fn validate_relative_component_path(
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

    // Validate the nearest existing ancestor, not only an existing leaf. A
    // junction/reparse point can redirect a path before its missing leaf is
    // created. This is a read-time check only: WU3's provisioner must hold
    // its cross-process operation lock and repeat this containment check at
    // the actual write boundary to close the TOCTOU window.
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
        return !(rest
            .as_bytes()
            .get(0..2)
            .is_some_and(|prefix| prefix[1] == b':'));
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

pub trait HandoffStore {
    fn value(&self, name: &str) -> Option<String>;
}

pub trait HandoffWriter {
    fn write_values(&self, values: &[(String, String)]) -> Result<(), RuntimeManifestError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeLocator {
    pub data_root: PathBuf,
    pub install_id: String,
}

impl RuntimeLocator {
    pub fn from_handoff(store: &impl HandoffStore) -> Result<Self, RuntimeManifestError> {
        let data_root = store
            .value("DataRoot")
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| RuntimeManifestError::new("HKCU handoff is missing DataRoot"))?;
        let install_id = store
            .value("InstallId")
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| RuntimeManifestError::new("HKCU handoff is missing InstallId"))?;
        let locator = Self {
            data_root: PathBuf::from(data_root),
            install_id,
        };
        validate_data_root(&locator.data_root)?;
        Ok(locator)
    }

    pub fn validate_manifest(
        &self,
        manifest: &RuntimeManifest,
    ) -> Result<(), RuntimeManifestError> {
        manifest.validate(Some(&self.install_id))?;
        if !canonical_paths_equal(&self.data_root, &manifest.data_root)? {
            return Err(RuntimeManifestError::new(
                "runtime_root_mismatch: HKCU DataRoot does not match runtime manifest data_root",
            ));
        }
        Ok(())
    }
}

#[cfg(windows)]
pub struct WindowsRegistryHandoff;

#[cfg(windows)]
impl HandoffStore for WindowsRegistryHandoff {
    fn value(&self, name: &str) -> Option<String> {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY_CURRENT_USER, KEY_READ, REG_SZ,
        };
        let key_name: Vec<u16> = std::ffi::OsStr::new(RUNTIME_REGISTRY_KEY)
            .encode_wide()
            .chain(Some(0))
            .collect();
        let value_name: Vec<u16> = std::ffi::OsStr::new(name)
            .encode_wide()
            .chain(Some(0))
            .collect();
        let mut key = std::ptr::null_mut();
        if unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, key_name.as_ptr(), 0, KEY_READ, &mut key) }
            != 0
        {
            return None;
        }
        let mut value_type = 0;
        let mut byte_len = 0;
        let result = unsafe {
            RegQueryValueExW(
                key,
                value_name.as_ptr(),
                std::ptr::null(),
                &mut value_type,
                std::ptr::null_mut(),
                &mut byte_len,
            )
        };
        if result != 0 || value_type != REG_SZ || byte_len < 2 {
            unsafe {
                RegCloseKey(key);
            }
            return None;
        }
        let mut bytes = vec![0u8; byte_len as usize];
        let result = unsafe {
            RegQueryValueExW(
                key,
                value_name.as_ptr(),
                std::ptr::null(),
                &mut value_type,
                bytes.as_mut_ptr(),
                &mut byte_len,
            )
        };
        unsafe {
            RegCloseKey(key);
        }
        if result != 0 {
            return None;
        }
        let words: &[u16] =
            unsafe { std::slice::from_raw_parts(bytes.as_ptr().cast(), byte_len as usize / 2) };
        Some(
            String::from_utf16_lossy(words)
                .trim_end_matches('\0')
                .to_string(),
        )
    }
}

#[cfg(windows)]
impl HandoffWriter for WindowsRegistryHandoff {
    fn write_values(&self, values: &[(String, String)]) -> Result<(), RuntimeManifestError> {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY_CURRENT_USER, KEY_WRITE,
            REG_OPTION_NON_VOLATILE, REG_SZ,
        };
        let key_name: Vec<u16> = std::ffi::OsStr::new(RUNTIME_REGISTRY_KEY)
            .encode_wide()
            .chain(Some(0))
            .collect();
        let mut key = std::ptr::null_mut();
        let result = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                key_name.as_ptr(),
                0,
                std::ptr::null_mut(),
                REG_OPTION_NON_VOLATILE,
                KEY_WRITE,
                std::ptr::null(),
                &mut key,
                std::ptr::null_mut(),
            )
        };
        if result != 0 {
            return Err(RuntimeManifestError::new(format!(
                "HKCU handoff key could not be opened: win32={result}"
            )));
        }
        let result = (|| {
            for (name, value) in values {
                let name: Vec<u16> = std::ffi::OsStr::new(name)
                    .encode_wide()
                    .chain(Some(0))
                    .collect();
                let mut encoded: Vec<u16> = std::ffi::OsStr::new(value).encode_wide().collect();
                encoded.push(0);
                let bytes = unsafe {
                    std::slice::from_raw_parts(
                        encoded.as_ptr().cast::<u8>(),
                        encoded.len() * std::mem::size_of::<u16>(),
                    )
                };
                let result = unsafe {
                    RegSetValueExW(
                        key,
                        name.as_ptr(),
                        0,
                        REG_SZ,
                        bytes.as_ptr(),
                        bytes.len() as u32,
                    )
                };
                if result != 0 {
                    return Err(RuntimeManifestError::new(format!(
                        "HKCU handoff value {name:?} could not be written: win32={result}"
                    )));
                }
            }
            Ok(())
        })();
        unsafe { RegCloseKey(key) };
        result
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchMode {
    Development,
    Installed,
}

pub(crate) fn launch_config(
    mode: LaunchMode,
    development: crate::backend::BackendConfig,
    manifest: &RuntimeManifest,
) -> Result<crate::backend::BackendConfig, RuntimeManifestError> {
    match mode {
        LaunchMode::Development => Ok(development),
        LaunchMode::Installed => {
            if manifest.state != RuntimeState::Ready {
                return Err(RuntimeManifestError::new(format!(
                    "runtime_not_launchable: state {} is not launchable; run Provision or Repair",
                    runtime_state_name(&manifest.state)
                )));
            }
            manifest.validate(None)?;
            let python = manifest.engine.python_executable.as_ref().ok_or_else(|| {
                RuntimeManifestError::new("installed runtime has no Python executable")
            })?;
            let project = manifest.engine.project_dir.as_ref().ok_or_else(|| {
                RuntimeManifestError::new("installed runtime has no project directory")
            })?;
            Ok(crate::backend::BackendConfig {
                python_path: python.display().to_string(),
                working_dir: project.display().to_string(),
                app_module: manifest.engine.app_module.clone(),
                port: manifest.engine.preferred_port,
                fallback_port: manifest.engine.fallback_port,
                spawn: true,
                log_file: Some(
                    manifest
                        .data_root
                        .join("user")
                        .join("logs")
                        .join("backend.log")
                        .display()
                        .to_string(),
                ),
                data_root: Some(manifest.data_root.clone()),
            })
        }
    }
}

fn runtime_state_name(state: &RuntimeState) -> &'static str {
    match state {
        RuntimeState::Unprovisioned => "unprovisioned",
        RuntimeState::Provisioning => "provisioning",
        RuntimeState::Ready => "ready",
        RuntimeState::Repairing => "repairing",
        RuntimeState::Updating => "updating",
        RuntimeState::Failed => "failed",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::BackendConfig;
    use std::fs;
    use std::path::PathBuf;
    use std::time::Duration;

    fn valid_manifest(root: &std::path::Path) -> RuntimeManifest {
        let engine = root.join("engine");
        let generation = engine.join("generations").join("g1");
        fs::create_dir_all(&engine).unwrap();
        fs::create_dir_all(&generation).unwrap();
        let python = generation.join("python.exe");
        let project = generation.join("project");
        fs::write(&python, b"python").unwrap();
        fs::create_dir_all(&project).unwrap();
        RuntimeManifest {
            schema_version: 1,
            install_id: "install-1".into(),
            product_version: "0.1.1".into(),
            data_root: root.to_path_buf(),
            revision: 1,
            state: RuntimeState::Ready,
            operation: RuntimeOperation::default(),
            engine: EngineManifest {
                active_version: Some("0.1.1".into()),
                previous_version: None,
                pending_version: None,
                active_generation: Some("g1".into()),
                previous_generation: None,
                project_dir: Some(project),
                python_executable: Some(python),
                app_module: "opencohost.api.main:app".into(),
                preferred_port: 8765,
                fallback_port: 8770,
                lock_sha256: Some("a".repeat(64)),
                payload_sha256: Some("b".repeat(64)),
            },
            tooling: ToolingManifest {
                uv_version: "0.8.0".into(),
                python_version: "3.12".into(),
            },
            components: ComponentsManifest {
                piper: PiperManifest::default(),
            },
        }
    }

    #[test]
    fn rejects_missing_and_malformed_manifest() {
        let root = tempfile_path("missing");
        let missing = root.join("runtime-manifest.json");
        assert!(RuntimeManifest::read(&missing, None).is_err());
        fs::create_dir_all(&root).unwrap();
        fs::write(&missing, b"{").unwrap();
        assert!(RuntimeManifest::read(&missing, None).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn validates_schema_identity_paths_and_unicode() {
        let root = tempfile_path("manifest-\u{00fc}nicode");
        let manifest = valid_manifest(&root);
        manifest.validate(Some("install-1")).unwrap();
        assert!(manifest.validate(Some("other-install")).is_err());

        let mut wrong_schema = manifest.clone();
        wrong_schema.schema_version = 99;
        assert!(wrong_schema.validate(None).is_err());

        let mut escaped = manifest.clone();
        escaped.engine.project_dir = Some(root.parent().unwrap().to_path_buf());
        assert!(escaped.validate(None).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_unc_and_missing_executable_or_project() {
        let root = tempfile_path("manifest-paths");
        let mut manifest = valid_manifest(&root);
        manifest.data_root = PathBuf::from(r"\\server\share\OpenCohost");
        assert!(manifest.validate(None).is_err());

        let mut missing = valid_manifest(&root);
        missing.engine.python_executable = Some(root.join("missing.exe"));
        assert!(missing.validate(None).is_err());
        let mut no_project = valid_manifest(&root);
        no_project.engine.project_dir = Some(root.join("missing-project"));
        assert!(no_project.validate(None).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn accepts_a_local_fixed_drive_data_root() {
        let root = tempfile_path("manifest-fixed-drive");
        fs::create_dir_all(&root).unwrap();
        assert!(is_fixed_drive_path(&root));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn atomic_write_preserves_previous_and_recovers() {
        let root = tempfile_path("manifest-atomic");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("runtime-manifest.json");
        let first = valid_manifest(&root);
        first.write_atomic(&path).unwrap();
        let mut second = first.clone();
        second.revision = 2;
        second.write_atomic(&path).unwrap();
        assert_eq!(RuntimeManifest::read(&path, None).unwrap().revision, 2);
        assert_eq!(
            RuntimeManifest::read_recovery(&path, None)
                .unwrap()
                .revision,
            2
        );

        fs::write(&path, b"corrupt").unwrap();
        assert_eq!(
            RuntimeManifest::read_recovery(&path, None)
                .unwrap()
                .revision,
            1
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn compare_and_swap_rejects_stale_writer_and_preserves_newer_manifest() {
        let root = tempfile_path("manifest-cas");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("runtime-manifest.json");
        let first = valid_manifest(&root);
        first.write_atomic(&path).unwrap();
        let mut newer = first.clone();
        newer.revision = 2;
        newer.write_atomic_cas(&path, Some(1)).unwrap();
        let mut stale = first;
        stale.revision = 2;
        let error = stale.write_atomic(&path).unwrap_err();
        assert!(error.to_string().starts_with("manifest_revision_conflict:"));
        assert_eq!(RuntimeManifest::read(&path, None).unwrap().revision, 2);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn concurrent_compare_and_swap_writers_have_unique_temp_ownership() {
        use std::sync::{Arc, Barrier};
        use std::thread;

        let root = tempfile_path("manifest-concurrent");
        fs::create_dir_all(&root).unwrap();
        let path = Arc::new(root.join("runtime-manifest.json"));
        valid_manifest(&root).write_atomic(&path).unwrap();
        let barrier = Arc::new(Barrier::new(8));
        let mut workers = Vec::new();
        for revision in 2..10 {
            let barrier = Arc::clone(&barrier);
            let path = Arc::clone(&path);
            let root = root.clone();
            workers.push(thread::spawn(move || {
                barrier.wait();
                let mut candidate = valid_manifest(&root);
                candidate.revision = revision;
                candidate.write_atomic_cas(&path, Some(1)).is_ok()
            }));
        }
        let successes = workers
            .into_iter()
            .filter_map(|worker| worker.join().ok())
            .filter(|ok| *ok)
            .count();
        assert_eq!(successes, 1);
        assert!(RuntimeManifest::read(&path, None).unwrap().revision >= 2);
        assert!(!fs::read_dir(&root).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn injected_atomic_failure_keeps_primary_manifest_readable() {
        let root = tempfile_path("manifest-failure");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("runtime-manifest.json");
        let first = valid_manifest(&root);
        first.write_atomic(&path).unwrap();
        let mut second = first.clone();
        second.revision = 2;
        assert!(second.write_atomic_for_test(&path, Some(1), true).is_err());
        assert_eq!(RuntimeManifest::read(&path, None).unwrap().revision, 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn red_recovery_copy_is_unmodified_when_gate_fails() {
        let root = tempfile_path("manifest-recovery-gate-fail");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("runtime-manifest.json");
        let recovery = recovery_path(&path);
        let first = valid_manifest(&root);
        first.write_atomic(&path).unwrap();
        let mut candidate = first.clone();
        candidate.revision = 2;
        assert!(!recovery.exists(), "recovery file must not exist before second revision");
        let _ = candidate.write_atomic_cas_with_gate(&path, Some(1), || {
            Err(RuntimeManifestError::new("injected_gate_abort"))
        });
        assert!(
            !recovery.exists(),
            "recovery file must not be created when gate fails"
        );

        // Write second revision successfully so recovery file is established
        candidate.write_atomic(&path).unwrap();
        assert!(recovery.exists());
        let recovery_before = fs::read(&recovery).unwrap();
        let mut third = candidate.clone();
        third.revision = 3;
        let _ = third.write_atomic_cas_with_gate(&path, Some(2), || {
            Err(RuntimeManifestError::new("injected_gate_abort"))
        });
        assert_eq!(
            fs::read(&recovery).unwrap(),
            recovery_before,
            "existing recovery file must remain unmodified when gate fails"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn red_direct_manifest_cas_barrier_preserves_bytes_when_deadline_wins() {
        let root = tempfile_path("manifest-cas-barrier");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("runtime-manifest.json");
        let first = valid_manifest(&root);
        first.write_atomic(&path).unwrap();
        let mut candidate = first.clone();
        candidate.revision = 2;
        let before = fs::read(&path).unwrap();
        let token = crate::provisioner::CancellationToken::new();
        let deadline =
            crate::provisioner::ProvisionDeadline::from_timeout(Duration::from_millis(50)).unwrap();
        let entered = std::sync::Arc::new(std::sync::Barrier::new(2));
        let release = std::sync::Arc::new(std::sync::Barrier::new(2));
        let entered_hook = entered.clone();
        let release_hook = release.clone();
        let worker_path = path.clone();
        let worker = std::thread::spawn(move || {
            candidate
                .write_atomic_cas_with_gate(&worker_path, Some(1), || {
                    let commit = token.try_begin_commit().expect("commit gate begins");
                    entered_hook.wait();
                    while !deadline.is_expired() {
                        std::thread::yield_now();
                    }
                    release_hook.wait();
                    commit
                        .check_deadline(&deadline)
                        .map_err(|err| RuntimeManifestError::new(err.to_string()))
                })
                .unwrap_err()
        });
        entered.wait();
        release.wait();
        let error = worker.join().unwrap();
        assert!(error.to_string().contains("deadline_exceeded"));
        assert_eq!(fs::read(&path).unwrap(), before);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn red_direct_manifest_cas_commit_winner_rejects_late_cancel_and_releases() {
        let root = tempfile_path("manifest-cas-commit-winner");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("runtime-manifest.json");
        let first = valid_manifest(&root);
        first.write_atomic(&path).unwrap();
        let mut candidate = first.clone();
        candidate.revision = 2;
        let token = crate::provisioner::CancellationToken::new();
        let commit = token.try_begin_commit().unwrap();
        let late = token.clone();
        candidate
            .write_atomic_cas_with_gate(&path, Some(1), || {
                assert!(!late.cancel());
                Ok(())
            })
            .unwrap();
        commit.complete();
        assert_eq!(RuntimeManifest::read(&path, None).unwrap().revision, 2);

        let mut third = candidate.clone();
        third.revision = 3;
        let cancel_token = crate::provisioner::CancellationToken::new();
        cancel_token.cancel();
        let deadline =
            crate::provisioner::ProvisionDeadline::from_timeout(Duration::from_secs(5)).unwrap();
        third
            .write_atomic_cas_with_gate(&path, Some(2), || {
                deadline
                    .check(&cancel_token)
                    .map_err(|err| RuntimeManifestError::new(err.to_string()))
            })
            .unwrap_err();
        let mut fourth = candidate;
        fourth.revision = 3;
        fourth.write_atomic_cas(&path, Some(2)).unwrap();
        assert_eq!(RuntimeManifest::read(&path, None).unwrap().revision, 3);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn recovery_revision_is_authoritative_when_primary_is_unreadable() {
        let root = tempfile_path("manifest-recovery-cas");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("runtime-manifest.json");
        let first = valid_manifest(&root);
        first.write_atomic(&path).unwrap();
        let mut recovered = first.clone();
        recovered.revision = 3;
        fs::write(
            recovery_path(&path),
            format!("{}\n", serde_json::to_string_pretty(&recovered).unwrap()),
        )
        .unwrap();
        fs::write(&path, b"corrupt").unwrap();

        let mut stale = first.clone();
        stale.revision = 2;
        assert!(stale.write_atomic(&path).is_err());
        assert_eq!(
            RuntimeManifest::read_recovery(&path, None)
                .unwrap()
                .revision,
            3
        );

        let mut failed = recovered.clone();
        failed.revision = 4;
        assert!(failed.write_atomic_for_test(&path, None, true).is_err());
        assert_eq!(
            RuntimeManifest::read_recovery(&path, None)
                .unwrap()
                .revision,
            3
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn rejects_windows_root_relative_prefix_and_missing_component_paths() {
        let root = tempfile_path("component-path-safety");
        fs::create_dir_all(&root).unwrap();
        for value in [r"\outside", r"C:outside", r"C:\outside", r"..\escape"] {
            assert!(
                validate_relative_component_path(&root, value, "component").is_err(),
                "path must be rejected: {value}"
            );
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn accepts_existing_leaf_and_nested_missing_leaves_under_in_root_ancestor() {
        let root = tempfile_path("component-path-ancestors");
        let component_root = root.join("components").join("piper");
        fs::create_dir_all(&component_root).unwrap();
        fs::write(component_root.join("existing.bin"), b"voice").unwrap();

        for value in [
            "existing.bin",
            "nested/missing.bin",
            "nested/deeper/missing.json",
        ] {
            assert!(validate_relative_component_path(&root, value, "component").is_ok());
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn injected_canonical_ancestor_escape_is_rejected() {
        let error = validate_canonical_component_ancestor(
            Path::new(r"C:\data"),
            Path::new(r"C:\data\components\piper"),
            Path::new(r"C:\outside\escape"),
            "component",
        )
        .unwrap_err();
        assert!(error
            .to_string()
            .contains("escapes approved component root"));
    }

    #[cfg(windows)]
    #[test]
    fn rejects_missing_leaf_beyond_windows_junction_escape() {
        let root = tempfile_path("component-junction");
        let outside = tempfile_path("component-junction-outside");
        let component_root = root.join("components").join("piper");
        let junction = component_root.join("escape");
        fs::create_dir_all(&component_root).unwrap();
        fs::create_dir_all(&outside).unwrap();

        match create_test_junction(&junction, &outside) {
            Ok(()) => {
                assert!(validate_relative_component_path(
                    &root,
                    r"escape\missing.bin",
                    "component"
                )
                .is_err());
            }
            Err(unavailable) => {
                eprintln!("SKIPPED junction capability: {unavailable:?}");
                assert!(!unavailable.reason.is_empty());
            }
        }
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[cfg(windows)]
    #[derive(Debug)]
    struct JunctionUnavailable {
        reason: String,
    }

    #[cfg(windows)]
    fn create_test_junction(link: &Path, target: &Path) -> Result<(), JunctionUnavailable> {
        let link_text = link.to_string_lossy().into_owned();
        let target_text = target.to_string_lossy().into_owned();
        let output = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &link_text, &target_text])
            .output()
            .map_err(|error| JunctionUnavailable {
                reason: format!("could not invoke mklink: {error}"),
            })?;
        if output.status.success() {
            Ok(())
        } else {
            let reason = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            Err(JunctionUnavailable {
                reason: if reason.is_empty() {
                    format!("mklink exited with {}", output.status)
                } else {
                    reason
                },
            })
        }
    }

    #[test]
    fn installed_locator_requires_data_root_and_install_id() {
        let root = tempfile_path("handoff-root");
        fs::create_dir_all(&root).unwrap();
        let handoff = MemoryHandoff::new([
            ("DataRoot", root.to_str().unwrap()),
            ("InstallId", "install-1"),
        ]);
        let located = RuntimeLocator::from_handoff(&handoff).unwrap();
        assert_eq!(located.install_id, "install-1");
        assert_eq!(located.data_root, root);

        let missing = MemoryHandoff::new([("DataRoot", "C:\\data")]);
        assert!(RuntimeLocator::from_handoff(&missing).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_handoff_manifest_root_and_install_identity_mismatch() {
        let root = tempfile_path("handoff-binding");
        fs::create_dir_all(&root).unwrap();
        let manifest = valid_manifest(&root);
        let handoff = MemoryHandoff::new([
            ("DataRoot", root.to_str().unwrap()),
            ("InstallId", "install-1"),
        ]);
        let locator = RuntimeLocator::from_handoff(&handoff).unwrap();
        locator.validate_manifest(&manifest).unwrap();

        let mut wrong_root = manifest.clone();
        let other = tempfile_path("handoff-other-root");
        fs::create_dir_all(&other).unwrap();
        wrong_root.data_root = other.clone();
        assert!(locator.validate_manifest(&wrong_root).is_err());

        let mut wrong_id = manifest;
        wrong_id.install_id = "install-2".into();
        assert!(locator.validate_manifest(&wrong_id).is_err());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(other);
    }

    #[test]
    fn only_ready_state_is_launchable() {
        let root = tempfile_path("launch-state");
        let manifest = valid_manifest(&root);
        for state in [
            RuntimeState::Unprovisioned,
            RuntimeState::Provisioning,
            RuntimeState::Repairing,
            RuntimeState::Updating,
            RuntimeState::Failed,
        ] {
            let mut candidate = manifest.clone();
            candidate.state = state;
            let error = launch_config(LaunchMode::Installed, test_backend_config(), &candidate)
                .expect_err("non-ready state must not launch");
            assert!(error.to_string().starts_with("runtime_not_launchable:"));
            assert!(error.to_string().contains("Provision or Repair"));
        }
        assert!(launch_config(LaunchMode::Installed, test_backend_config(), &manifest).is_ok());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn installed_component_cannot_claim_success_without_metadata() {
        let root = tempfile_path("piper-installed");
        let mut manifest = valid_manifest(&root);
        manifest.components.piper.requested = true;
        manifest.components.piper.state = "installed".into();
        assert!(manifest.validate(None).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_zero_ports_and_unknown_manifest_fields() {
        let root = tempfile_path("manifest-schema-strict");
        let mut manifest = valid_manifest(&root);
        manifest.engine.preferred_port = 0;
        assert!(manifest.validate(None).is_err());

        let encoded = serde_json::to_value(valid_manifest(&root)).unwrap();
        let mut object = encoded.as_object().unwrap().clone();
        object.insert("unknown_field".into(), serde_json::json!(true));
        assert!(
            serde_json::from_value::<RuntimeManifest>(serde_json::Value::Object(object)).is_err()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn launch_config_keeps_development_and_installed_modes_distinct() {
        let root = tempfile_path("launch-mode");
        let manifest = valid_manifest(&root);
        let dev = BackendConfig {
            python_path: "python".into(),
            working_dir: "..".into(),
            app_module: "opencohost.api.main:app".into(),
            port: 8765,
            fallback_port: 8770,
            spawn: true,
            log_file: None,
            data_root: None,
        };
        let development = launch_config(LaunchMode::Development, dev.clone(), &manifest).unwrap();
        assert_eq!(development.python_path, "python");
        let installed = launch_config(LaunchMode::Installed, dev, &manifest).unwrap();
        assert_eq!(
            installed.python_path,
            manifest
                .engine
                .python_executable
                .unwrap()
                .display()
                .to_string()
        );
        assert_eq!(
            installed.working_dir,
            manifest.engine.project_dir.unwrap().display().to_string()
        );
        let _ = fs::remove_dir_all(root);
    }

    fn tempfile_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("opencohost-wu2-{label}-{}", std::process::id()))
    }

    fn test_backend_config() -> BackendConfig {
        BackendConfig {
            python_path: "python".into(),
            working_dir: ".".into(),
            app_module: "opencohost.api.main:app".into(),
            port: 8765,
            fallback_port: 8770,
            spawn: true,
            log_file: None,
            data_root: None,
        }
    }

    struct MemoryHandoff(std::collections::HashMap<String, String>);
    impl MemoryHandoff {
        fn new<const N: usize>(values: [(&str, &str); N]) -> Self {
            Self(
                values
                    .into_iter()
                    .map(|(k, v)| (k.into(), v.into()))
                    .collect(),
            )
        }
    }
    impl HandoffStore for MemoryHandoff {
        fn value(&self, name: &str) -> Option<String> {
            self.0.get(name).cloned()
        }
    }
}
