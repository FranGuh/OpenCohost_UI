use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::first_run::status::{
    is_launchable_state, phase_for_state, safe_message, status_with_default, FirstRunError,
    FirstRunPhase, FirstRunStatus,
};
use crate::runtime::{
    validate_data_root, HandoffStore, HandoffWriter, RuntimeLocator, RuntimeManifest,
};

pub const RUNTIME_MANAGER_VERSION: &str = "1";

pub fn validate_data_root_candidate(path: &Path) -> Result<(), FirstRunError> {
    validate_data_root_candidate_with_boundaries(path, &[])
}

pub fn validate_data_root_candidate_with_boundaries(
    path: &Path,
    install_boundaries: &[PathBuf],
) -> Result<(), FirstRunError> {
    if !path.is_absolute() {
        return Err(FirstRunError::new(
            "invalid_data_root",
            "DataRoot must be an absolute local fixed-drive path",
            false,
        ));
    }
    reject_install_boundary(path, install_boundaries)?;
    if !path.exists() {
        fs::create_dir_all(path)
            .map_err(|error| FirstRunError::new("invalid_data_root", error.to_string(), false))?;
    }
    validate_data_root(path)
        .map_err(|error| FirstRunError::new("invalid_data_root", error.to_string(), false))
}

fn reject_install_boundary(path: &Path, boundaries: &[PathBuf]) -> Result<(), FirstRunError> {
    let candidate_ancestor = nearest_existing_ancestor(path).ok_or_else(|| {
        FirstRunError::new(
            "invalid_data_root",
            "DataRoot has no existing ancestor",
            false,
        )
    })?;
    let candidate = fs::canonicalize(candidate_ancestor).map_err(|_| {
        FirstRunError::new(
            "invalid_data_root",
            "DataRoot could not be resolved safely",
            false,
        )
    })?;
    for boundary in boundaries {
        let Ok(boundary) = fs::canonicalize(boundary) else {
            continue;
        };
        if candidate == boundary || candidate.starts_with(&boundary) {
            return Err(FirstRunError::new(
                "data_root_inside_install",
                "Choose a data folder outside the application install directory",
                false,
            ));
        }
    }
    Ok(())
}

pub(crate) fn nearest_existing_ancestor(path: &Path) -> Option<PathBuf> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        if candidate.exists() {
            return Some(candidate.to_path_buf());
        }
        current = candidate.parent();
    }
    None
}

pub fn default_data_root() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|root| root.join("OpenCohostData"))
}

pub fn default_data_root_in_outside(local: &Path, boundaries: &[PathBuf]) -> Option<PathBuf> {
    [
        local.join("OpenCohostData"),
        local.join("OpenCohost-data"),
        local.join("OpenCohost").join("data"),
    ]
    .into_iter()
    .find(|candidate| reject_install_boundary(candidate, boundaries).is_ok())
}

pub fn default_data_root_outside_boundaries(boundaries: &[PathBuf]) -> Option<PathBuf> {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;
    default_data_root_in_outside(&local, boundaries)
}

pub struct ConfiguredRuntime {
    pub data_root: PathBuf,
    pub install_id: String,
}

pub fn configure_data_root<W: HandoffWriter + HandoffStore>(
    writer: &W,
    data_root: &Path,
    expected_install_id: Option<&str>,
) -> Result<ConfiguredRuntime, FirstRunError> {
    configure_data_root_with_boundaries(writer, data_root, expected_install_id, &[])
}

pub fn configure_data_root_with_boundaries<W: HandoffWriter + HandoffStore>(
    writer: &W,
    data_root: &Path,
    expected_install_id: Option<&str>,
    install_boundaries: &[PathBuf],
) -> Result<ConfiguredRuntime, FirstRunError> {
    validate_data_root_candidate_with_boundaries(data_root, install_boundaries)?;
    let existing = writer_existing_id(writer);
    let install_id = match (existing, expected_install_id) {
        (Some(existing), Some(expected)) if existing != expected => {
            return Err(FirstRunError::new(
                "install_id_mismatch",
                "InstallId does not match the existing handoff",
                false,
            ));
        }
        (Some(existing), _) => existing,
        (None, Some(expected)) if !expected.trim().is_empty() => expected.to_string(),
        _ => new_install_id(),
    };
    writer
        .write_values(&[
            ("DataRoot".into(), data_root.to_string_lossy().into_owned()),
            ("InstallId".into(), install_id.clone()),
            (
                "RuntimeManagerVersion".into(),
                RUNTIME_MANAGER_VERSION.into(),
            ),
        ])
        .map_err(|error| FirstRunError::new("handoff_write_failed", error.to_string(), true))?;
    Ok(ConfiguredRuntime {
        data_root: data_root.to_path_buf(),
        install_id,
    })
}

fn writer_existing_id<W: HandoffWriter + HandoffStore>(writer: &W) -> Option<String> {
    writer.value("InstallId")
}

fn new_install_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("install-{}-{millis}", std::process::id())
}

fn invalid_handoff_code(data_root_value: &str, boundaries: &[PathBuf]) -> &'static str {
    let candidate = Path::new(data_root_value);
    if candidate.is_absolute()
        && reject_install_boundary(candidate, boundaries)
            .is_err_and(|err| err.code == "data_root_inside_install")
    {
        "data_root_inside_install"
    } else {
        "invalid_handoff"
    }
}

pub fn inspect_runtime(store: &impl HandoffStore) -> FirstRunStatus {
    let exe_path = std::env::current_exe().ok();
    let exe_dir = exe_path.as_ref().and_then(|path| path.parent());
    inspect_runtime_at(exe_dir, store)
}

pub fn inspect_runtime_at(exe_dir: Option<&Path>, store: &impl HandoffStore) -> FirstRunStatus {
    let boundaries: Vec<PathBuf> = exe_dir
        .map(|dir| vec![dir.to_path_buf()])
        .unwrap_or_default();
    let safe_default = default_data_root_outside_boundaries(&boundaries)
        .map(|path| path.to_string_lossy().into_owned());

    if let Some(exe_dir) = exe_dir {
        for candidate in [
            exe_dir
                .join("resources")
                .join("runtime")
                .join("venv")
                .join("Scripts")
                .join("python.exe"),
            exe_dir
                .join("resources")
                .join("runtime")
                .join("python")
                .join("python.exe"),
            exe_dir
                .join("runtime")
                .join("venv")
                .join("Scripts")
                .join("python.exe"),
            exe_dir
                .join("runtime")
                .join("python")
                .join("python.exe"),
            exe_dir.join("python").join("python.exe"),
        ] {
            if candidate.is_file() {
                if let Some(data_root_value) = store.value("DataRoot") {
                    let Some(install_id_value) = store.value("InstallId") else {
                        return status_with_default(
                            FirstRunPhase::Degraded,
                            None,
                            safe_default,
                            None,
                            safe_message("invalid_handoff"),
                            true,
                            None,
                            Some("invalid_handoff"),
                        );
                    };
                    let locator = match RuntimeLocator::from_handoff(store) {
                        Ok(locator) => locator,
                        Err(_) => {
                            let code = invalid_handoff_code(&data_root_value, &boundaries);
                            return status_with_default(
                                FirstRunPhase::Degraded,
                                None,
                                safe_default,
                                Some(install_id_value),
                                safe_message(code),
                                true,
                                None,
                                Some(code),
                            );
                        }
                    };
                    if let Err(error) = reject_install_boundary(&locator.data_root, &boundaries) {
                        return status_with_default(
                            FirstRunPhase::Degraded,
                            None,
                            safe_default,
                            Some(locator.install_id),
                            safe_message(&error.code),
                            true,
                            None,
                            Some(&error.code),
                        );
                    }
                    return status_with_default(
                        FirstRunPhase::Ready,
                        Some(locator.data_root.to_string_lossy().into_owned()),
                        safe_default,
                        Some(locator.install_id),
                        "Embedded runtime ready",
                        true,
                        None,
                        None,
                    );
                }
                return status_with_default(
                    FirstRunPhase::Ready,
                    safe_default.clone(),
                    safe_default,
                    Some("embedded-install".into()),
                    "Embedded runtime ready",
                    true,
                    None,
                    None,
                );
            }
        }
    }

    let data_root = store.value("DataRoot");
    let install_id = store.value("InstallId");
    let Some(data_root_value) = data_root.clone() else {
        return status_with_default(
            FirstRunPhase::Unconfigured,
            None,
            safe_default,
            install_id,
            "Choose a local data folder",
            true,
            None,
            Some("unconfigured"),
        );
    };
    let Some(install_id_value) = install_id.clone() else {
        return status_with_default(
            FirstRunPhase::Degraded,
            None,
            safe_default,
            None,
            "The runtime handoff is incomplete; choose a data folder again",
            true,
            None,
            Some("invalid_handoff"),
        );
    };
    let locator = match RuntimeLocator::from_handoff(store) {
        Ok(locator) => locator,
        Err(_error) => {
            let code = invalid_handoff_code(&data_root_value, &boundaries);
            return status_with_default(
                FirstRunPhase::Degraded,
                None,
                safe_default,
                Some(install_id_value),
                safe_message(code),
                true,
                None,
                Some(code),
            );
        }
    };
    if let Err(error) = reject_install_boundary(&locator.data_root, &boundaries) {
        return status_with_default(
            FirstRunPhase::Degraded,
            None,
            safe_default,
            Some(locator.install_id),
            safe_message(&error.code),
            true,
            None,
            Some(&error.code),
        );
    }
    let manifest_path = locator
        .data_root
        .join("state")
        .join("runtime-manifest.json");
    let manifest = match RuntimeManifest::read_recovery(&manifest_path, Some(&locator.install_id)) {
        Ok(manifest) => manifest,
        Err(_error) => {
            return status_with_default(
                FirstRunPhase::Unconfigured,
                Some(locator.data_root.to_string_lossy().into_owned()),
                safe_default,
                Some(locator.install_id),
                safe_message("runtime_unprovisioned"),
                true,
                None,
                Some("runtime_unprovisioned"),
            )
        }
    };
    if !is_launchable_state(&manifest.state) {
        return status_with_default(
            phase_for_state(&manifest.state),
            Some(locator.data_root.to_string_lossy().into_owned()),
            safe_default,
            Some(locator.install_id),
            safe_message("runtime_not_ready"),
            true,
            None,
            Some("runtime_not_ready"),
        );
    }
    if let Err(_error) = locator.validate_manifest(&manifest) {
        return status_with_default(
            FirstRunPhase::Degraded,
            Some(locator.data_root.to_string_lossy().into_owned()),
            safe_default,
            Some(locator.install_id),
            safe_message("runtime_invalid"),
            true,
            None,
            Some("runtime_invalid"),
        );
    }
    status_with_default(
        FirstRunPhase::Ready,
        Some(locator.data_root.to_string_lossy().into_owned()),
        safe_default,
        Some(locator.install_id),
        "Core runtime ready",
        false,
        None,
        None,
    )
}
