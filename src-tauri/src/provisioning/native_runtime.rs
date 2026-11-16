use crate::provisioning::archive::validate_write_boundary;
use crate::provisioning::{ProvisionError, ProvisionErrorCode};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

pub(crate) const MSVC_CRT_FILES: [&str; 10] = [
    "concrt140.dll",
    "msvcp140.dll",
    "msvcp140_1.dll",
    "msvcp140_2.dll",
    "msvcp140_atomic_wait.dll",
    "msvcp140_codecvt_ids.dll",
    "vccorlib140.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
    "vcruntime140_threads.dll",
];

const KNOWN_PREVIOUS_PYTHON_CRT: [(&str, &str); 2] = [
    (
        "vcruntime140.dll",
        "3ea53d61f2c5a96bfaa6722b271bcfca84b1f3fb1020c5d081e12762eb3797ce",
    ),
    (
        "vcruntime140_1.dll",
        "03fd6ba760bb3e85f55c9ce707ae11d3a25cb1487c987c6c1f8d3262c9875acf",
    ),
];

/// Copies the verified app-local CRT next to both managed Python executables.
/// Existing files are retained unless they are the exact older CRT pair from
/// the checked-in CPython 3.12.4 distribution.
pub(crate) fn materialize_msvc_crt(
    source: &Path,
    approved_root: &Path,
    python_root: &Path,
    venv_scripts_root: &Path,
) -> Result<(), ProvisionError> {
    let manifest_path = source.join("msvc-crt-manifest.json");
    let manifest: Value = serde_json::from_slice(&fs::read(&manifest_path).map_err(|error| {
        ProvisionError::new(
            ProvisionErrorCode::InvalidBootstrap,
            error.to_string(),
            false,
        )
    })?)
    .map_err(|error| {
        ProvisionError::new(
            ProvisionErrorCode::InvalidBootstrap,
            error.to_string(),
            false,
        )
    })?;
    if manifest.get("schema").and_then(Value::as_u64) != Some(1)
        || manifest.get("publisher").and_then(Value::as_str) != Some("Microsoft Corporation")
        || manifest.get("architecture").and_then(Value::as_str) != Some("x64")
        || manifest.get("version").and_then(Value::as_str) != Some("14.50.35719.0")
    {
        return Err(ProvisionError::new(
            ProvisionErrorCode::InvalidBootstrap,
            "bundled MSVC CRT manifest provenance is invalid",
            false,
        ));
    }
    let files = manifest
        .get("files")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            ProvisionError::new(
                ProvisionErrorCode::InvalidBootstrap,
                "bundled MSVC CRT file inventory is invalid",
                false,
            )
        })?;
    if files.len() != MSVC_CRT_FILES.len()
        || MSVC_CRT_FILES.iter().any(|name| !files.contains_key(*name))
    {
        return Err(ProvisionError::new(
            ProvisionErrorCode::InvalidBootstrap,
            "bundled MSVC CRT family is incomplete",
            false,
        ));
    }

    let source_root = fs::canonicalize(source).map_err(|error| {
        ProvisionError::new(
            ProvisionErrorCode::InvalidBootstrap,
            error.to_string(),
            false,
        )
    })?;
    let mut verified = Vec::with_capacity(MSVC_CRT_FILES.len());
    for name in MSVC_CRT_FILES {
        let expected = files[name]
            .get("sha256")
            .and_then(Value::as_str)
            .filter(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .ok_or_else(|| {
                ProvisionError::new(
                    ProvisionErrorCode::InvalidBootstrap,
                    "bundled MSVC CRT hash entry is invalid",
                    false,
                )
            })?;
        let source_file = source.join(name);
        let canonical_file = fs::canonicalize(&source_file).map_err(|error| {
            ProvisionError::new(
                ProvisionErrorCode::InvalidBootstrap,
                error.to_string(),
                false,
            )
        })?;
        if !canonical_file.starts_with(&source_root) || !canonical_file.is_file() {
            return Err(ProvisionError::new(
                ProvisionErrorCode::InvalidBootstrap,
                "bundled MSVC CRT member escapes its package root",
                false,
            ));
        }
        let bytes = fs::read(&canonical_file)?;
        let actual = format!("{:x}", Sha256::digest(&bytes));
        if !actual.eq_ignore_ascii_case(expected)
            || files[name].get("size").and_then(Value::as_u64) != Some(bytes.len() as u64)
        {
            return Err(ProvisionError::new(
                ProvisionErrorCode::HashMismatch,
                "bundled MSVC CRT member does not match its inventory",
                false,
            ));
        }
        verified.push((name, canonical_file, actual));
    }

    let destinations = [python_root, venv_scripts_root];
    for root in destinations {
        validate_write_boundary(approved_root, approved_root, root)?;
        for (name, _, expected) in &verified {
            let candidate = root.join(name);
            validate_write_boundary(approved_root, approved_root, &candidate)?;
            if candidate.exists() {
                if !candidate.is_file() || file_sha256(&candidate)? != *expected {
                    let old_hash = file_sha256(&candidate).unwrap_or_default();
                    let known_previous = KNOWN_PREVIOUS_PYTHON_CRT
                        .iter()
                        .any(|(old_name, hash)| old_name == name && *hash == old_hash);
                    if !known_previous {
                        return Err(ProvisionError::new(
                            ProvisionErrorCode::ActivationFailed,
                            format!("refusing to replace unrecognized Python runtime file: {name}"),
                            false,
                        ));
                    }
                }
            }
        }
    }
    for root in destinations {
        for (name, source_file, expected) in &verified {
            let destination = root.join(name);
            if destination.exists() && file_sha256(&destination)? == *expected {
                continue;
            }
            let old_hash = if destination.exists() {
                file_sha256(&destination)?
            } else {
                String::new()
            };
            let known_previous = KNOWN_PREVIOUS_PYTHON_CRT
                .iter()
                .any(|(old_name, hash)| old_name == name && *hash == old_hash);
            if destination.exists() && !known_previous {
                return Err(ProvisionError::new(
                    ProvisionErrorCode::ActivationFailed,
                    format!("refusing to replace unrecognized Python runtime file: {name}"),
                    false,
                ));
            }
            fs::copy(source_file, destination)?;
        }
    }
    Ok(())
}

fn file_sha256(path: &Path) -> Result<String, ProvisionError> {
    let bytes = fs::read(path)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}
