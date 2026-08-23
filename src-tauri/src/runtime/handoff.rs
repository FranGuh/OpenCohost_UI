use crate::runtime::manifest::{
    canonical_paths_equal, validate_data_root, RuntimeManifest, RuntimeManifestError, RuntimeState,
};
use std::path::PathBuf;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchMode {
    Development,
    Installed,
}

pub fn launch_config(
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
