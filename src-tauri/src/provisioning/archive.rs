use crate::provisioning::error::{ProvisionError, ProvisionErrorCode};
use crate::provisioning::model::windows_collision_key;
use std::fs::{self, File};
use std::io::{self};
use std::path::{Component, Path, PathBuf};

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

pub fn extract_zip_safely(bytes: &[u8], root: &Path) -> Result<(), ProvisionError> {
    extract_zip_safely_with_limits(bytes, root, ZipLimits::default())
}

pub fn extract_zip_safely_with_limits(
    bytes: &[u8],
    root: &Path,
    limits: ZipLimits,
) -> Result<(), ProvisionError> {
    extract_zip_safely_under_root_with_limits(bytes, root, root, limits)
}

pub(crate) fn extract_zip_safely_under_root(
    bytes: &[u8],
    approved_root: &Path,
    root: &Path,
) -> Result<(), ProvisionError> {
    extract_zip_safely_under_root_with_limits(bytes, approved_root, root, ZipLimits::default())
}

pub(crate) fn extract_zip_safely_under_root_with_limits(
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

pub(crate) fn normalize_zip_name(name: &str) -> Result<String, ProvisionError> {
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

pub(crate) fn nearest_existing(path: &Path) -> Option<PathBuf> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        if candidate.exists() {
            return Some(candidate.to_path_buf());
        }
        current = candidate.parent();
    }
    None
}

pub(crate) fn contained(root: &Path, candidate: &Path) -> bool {
    #[cfg(windows)]
    {
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
    {
        candidate.starts_with(root)
    }
}

pub(crate) fn validate_write_boundary(
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

pub(crate) fn validate_missing_boundary(
    approved_root: &Path,
    candidate: &Path,
) -> Result<(), ProvisionError> {
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
