use crate::provisioning::archive::{
    extract_zip_safely_under_root, validate_missing_boundary, validate_write_boundary,
};
use crate::provisioning::artifacts::download_verified_under_root;
use crate::provisioning::artifacts::ArtifactSource;
use crate::provisioning::cancellation::{ensure_not_cancelled, CancellationToken};
#[cfg(test)]
use crate::provisioning::cancellation::{
    invoke_activation_commit_hook, invoke_activation_wait_hook,
};
use crate::provisioning::error::{ProvisionDeadline, ProvisionError, ProvisionErrorCode};
use crate::provisioning::health::HealthChecker;
use crate::provisioning::model::{
    ArtifactKind, ProgressEvent, ProgressSink, ProvisionPhase, ProvisionResult, ProvisionedState,
    ProvisionerConfig,
};
use crate::provisioning::operation_lock::{now_ms, OperationLock};
use crate::provisioning::process::{
    build_child_environment, build_uv_find_args, build_uv_python_install_args, build_uv_sync_args,
    resolve_managed_python_path, ProcessRunner,
};
use crate::runtime::{
    ComponentsManifest, EngineManifest, RuntimeManifest, RuntimeOperation, RuntimeState,
    ToolingManifest,
};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

pub struct Provisioner<S, R, H, P> {
    config: ProvisionerConfig,
    source: S,
    runner: R,
    health: H,
    progress: P,
}

impl<S, R, H, P> Provisioner<S, R, H, P>
where
    S: ArtifactSource,
    R: ProcessRunner,
    H: HealthChecker,
    P: ProgressSink,
{
    pub fn new(config: ProvisionerConfig, source: S, runner: R, health: H, progress: P) -> Self {
        Self {
            config,
            source,
            runner,
            health,
            progress,
        }
    }

    pub fn provision_first_install(
        mut self,
        cancel: CancellationToken,
    ) -> Result<ProvisionResult, ProvisionError> {
        self.config.bootstrap.validate()?;
        self.progress
            .report(ProgressEvent::phase(ProvisionPhase::VerifyBootstrap));
        ensure_not_cancelled(&cancel)?;
        fs::create_dir_all(&self.config.data_root)?;
        let deadline = ProvisionDeadline::from_timeout(self.config.operation_timeout)?;
        deadline.check(&cancel)?;
        let manifest_path = self
            .config
            .data_root
            .join("state")
            .join("runtime-manifest.json");
        let lock_path = self.config.data_root.join("state").join("operation.lock");
        let operation_id = format!("op-{}-{}", std::process::id(), now_ms());
        let _lock = OperationLock::acquire(&lock_path, &operation_id)?;
        let mut manifest =
            match RuntimeManifest::read_recovery(&manifest_path, Some(&self.config.install_id)) {
                Ok(existing) => {
                    if !matches!(
                        existing.state,
                        RuntimeState::Unprovisioned | RuntimeState::Failed
                    ) {
                        return Err(ProvisionError::new(
                            ProvisionErrorCode::ManifestConflict,
                            "runtime is already provisioned or busy",
                            false,
                        ));
                    }
                    existing
                }
                Err(_) => initial_manifest(&self.config),
            };
        let expected_revision = if manifest_path.exists() {
            Some(manifest.revision)
        } else {
            None
        };
        manifest.state = RuntimeState::Provisioning;
        manifest.revision =
            manifest.revision.max(1) + if expected_revision.is_some() { 1 } else { 0 };
        manifest.operation = RuntimeOperation {
            id: Some(operation_id.clone()),
            kind: Some("first_install".into()),
            phase: Some("download".into()),
            last_error_code: None,
            retryable: false,
        };
        manifest.write_atomic_cas(&manifest_path, expected_revision)?;
        let staging = self.config.data_root.join("staging").join(&operation_id);
        let downloads = staging.join("downloads");
        validate_missing_boundary(&self.config.data_root, &staging)?;
        fs::create_dir_all(&downloads)?;
        validate_missing_boundary(&self.config.data_root, &downloads)?;
        let result = self.provision_staged(
            &cancel,
            &operation_id,
            &staging,
            &downloads,
            manifest.clone(),
            manifest_path.clone(),
            &deadline,
        );
        match result {
            Ok(result) => Ok(result),
            Err(error) => {
                self.progress
                    .report(ProgressEvent::phase(ProvisionPhase::Cleanup));
                let quarantine = self.config.data_root.join("quarantine").join(&operation_id);
                quarantine_staging(&self.config.data_root, &staging, &quarantine)?;
                let mut failed = manifest;
                failed.state = RuntimeState::Unprovisioned;
                failed.operation.last_error_code = Some(error.code().as_str().into());
                failed.operation.retryable = error.retryable();
                failed.revision += 1;
                let _ = failed.write_atomic_cas(&manifest_path, Some(failed.revision - 1));
                Err(error)
            }
        }
    }

    fn provision_staged(
        &mut self,
        cancel: &CancellationToken,
        operation_id: &str,
        staging: &Path,
        downloads: &Path,
        mut manifest: RuntimeManifest,
        manifest_path: PathBuf,
        deadline: &ProvisionDeadline,
    ) -> Result<ProvisionResult, ProvisionError> {
        let uv = download_verified_under_root(
            &self.source,
            &self.config.bootstrap.uv,
            &self.config.data_root,
            downloads,
            self.config.max_download_retries,
            self.config.retry_backoff,
            cancel,
            deadline,
            &mut self.progress,
        )?;
        let engine = download_verified_under_root(
            &self.source,
            &self.config.bootstrap.engine,
            &self.config.data_root,
            downloads,
            self.config.max_download_retries,
            self.config.retry_backoff,
            cancel,
            deadline,
            &mut self.progress,
        )?;
        if cancel.is_cancelled() {
            return Err(ProvisionError::new(
                ProvisionErrorCode::Cancelled,
                "operation cancelled",
                true,
            ));
        }
        self.progress
            .report(ProgressEvent::phase(ProvisionPhase::Stage));
        deadline.check(cancel)?;
        let engine_stage = staging
            .join("engine")
            .join(&self.config.bootstrap.engine.version);
        let project_stage = engine_stage.join("project");
        validate_write_boundary(&self.config.data_root, staging, &project_stage)?;
        fs::create_dir_all(&project_stage)?;
        let bytes = fs::read(&engine)?;
        match self.config.bootstrap.engine.kind {
            ArtifactKind::Zip => {
                extract_zip_safely_under_root(&bytes, &self.config.data_root, &project_stage)?
            }
            ArtifactKind::File => {
                let payload = project_stage.join("payload.bin");
                validate_write_boundary(&self.config.data_root, &project_stage, &payload)?;
                fs::write(payload, bytes)?;
            }
        }
        let tools_dir = staging.join("tools");
        let uv_stage = tools_dir.join("uv.exe");
        validate_missing_boundary(&self.config.data_root, &uv_stage)?;
        fs::create_dir_all(&tools_dir)?;
        validate_write_boundary(&self.config.data_root, staging, &uv_stage)?;
        let uv_bytes = fs::read(&uv)?;
        if uv_bytes.starts_with(b"PK") {
            extract_zip_safely_under_root(&uv_bytes, &self.config.data_root, &tools_dir)?;
        } else {
            fs::copy(uv, &uv_stage)?;
        }
        let generation_stage = engine_stage.join("generations").join(operation_id);
        let python_stage = generation_stage.join("python");
        let venv_stage = generation_stage.join("venv");
        validate_missing_boundary(&self.config.data_root, &python_stage)?;
        validate_missing_boundary(&self.config.data_root, &generation_stage)?;
        validate_missing_boundary(
            &self.config.data_root,
            &self.config.data_root.join("cache").join("uv"),
        )?;
        let mut inherited = std::env::vars().collect::<BTreeMap<_, _>>();
        inherited.insert(
            "OPENCOHOST_DATA_ROOT".into(),
            self.config.data_root.to_string_lossy().into_owned(),
        );
        let mut env = build_child_environment(&inherited, staging)?;
        env.insert(
            "UV_PYTHON_INSTALL_DIR".into(),
            python_stage.to_string_lossy().into_owned(),
        );
        env.insert(
            "UV_PROJECT_ENVIRONMENT".into(),
            venv_stage.to_string_lossy().into_owned(),
        );
        env.insert(
            "UV_CACHE_DIR".into(),
            self.config
                .data_root
                .join("cache")
                .join("uv")
                .to_string_lossy()
                .into_owned(),
        );
        self.progress
            .report(ProgressEvent::phase(ProvisionPhase::InstallPython));
        deadline.check(cancel)?;
        let install = self.runner.run(
            &uv_stage,
            &build_uv_python_install_args(&self.config.bootstrap.python_version, &python_stage),
            staging,
            &env,
            cancel,
            deadline,
        )?;
        deadline.check(cancel)?;
        if install.status != 0 {
            return Err(ProvisionError::new(
                ProvisionErrorCode::ProcessFailed,
                install.stderr,
                true,
            ));
        }
        let find = self.runner.run(
            &uv_stage,
            &build_uv_find_args(&self.config.bootstrap.python_version),
            staging,
            &env,
            cancel,
            deadline,
        )?;
        deadline.check(cancel)?;
        let managed_python = resolve_managed_python_path(&find, &python_stage)?;
        let python_executable_stage = venv_stage.join(if cfg!(windows) {
            "Scripts/python.exe"
        } else {
            "bin/python"
        });
        self.progress
            .report(ProgressEvent::phase(ProvisionPhase::Sync));
        deadline.check(cancel)?;
        let sync = self.runner.run(
            &uv_stage,
            &build_uv_sync_args(&project_stage, &managed_python),
            &project_stage,
            &env,
            cancel,
            deadline,
        )?;
        deadline.check(cancel)?;
        if sync.status != 0 {
            return Err(ProvisionError::new(
                ProvisionErrorCode::ProcessFailed,
                sync.stderr,
                true,
            ));
        }
        self.progress
            .report(ProgressEvent::phase(ProvisionPhase::HealthCheck));
        deadline.check(cancel)?;
        if !python_executable_stage.is_file() {
            return Err(ProvisionError::new(
                ProvisionErrorCode::HealthCheckFailed,
                "uv sync did not create the successor venv interpreter",
                false,
            ));
        }
        let health_result = self.health.check(
            &project_stage,
            &python_executable_stage,
            &env,
            cancel,
            deadline,
        );
        deadline.check(cancel)?;
        health_result.map_err(|error| {
            if matches!(
                error.code(),
                ProvisionErrorCode::Cancelled | ProvisionErrorCode::DeadlineExceeded
            ) {
                return error;
            }
            ProvisionError::new(
                ProvisionErrorCode::HealthCheckFailed,
                error.to_string(),
                true,
            )
        })?;
        deadline.check(cancel)?;
        self.progress
            .report(ProgressEvent::phase(ProvisionPhase::Activate));
        deadline.check(cancel)?;
        let final_release = self
            .config
            .data_root
            .join("engine")
            .join("releases")
            .join(&self.config.bootstrap.engine.version);
        if final_release.exists() {
            return Err(ProvisionError::new(
                ProvisionErrorCode::ActivationFailed,
                "target generation already exists",
                false,
            ));
        }
        validate_missing_boundary(&self.config.data_root, &final_release)?;
        fs::create_dir_all(final_release.parent().unwrap())?;
        validate_write_boundary(
            &self.config.data_root,
            &self.config.data_root,
            &final_release,
        )?;
        #[cfg(test)]
        invoke_activation_wait_hook(cancel, deadline);
        let Some(commit) = cancel.try_begin_commit() else {
            return Err(ProvisionError::new(
                ProvisionErrorCode::Cancelled,
                "operation cancelled",
                true,
            ));
        };
        #[cfg(test)]
        invoke_activation_commit_hook(&commit, deadline);
        commit.check_deadline(deadline)?;
        fs::rename(&engine_stage, &final_release)?;
        let final_generation = final_release.join("generations").join(operation_id);
        rebase_venv_after_generation_rename(&generation_stage, &final_generation)?;
        let final_project = final_release.join("project");
        let final_python_executable =
            final_release
                .join("generations")
                .join(operation_id)
                .join(if cfg!(windows) {
                    "venv/Scripts/python.exe"
                } else {
                    "venv/bin/python"
                });
        manifest.state = RuntimeState::Ready;
        manifest.revision += 1;
        manifest.operation = RuntimeOperation::default();
        manifest.engine = EngineManifest {
            active_version: Some(self.config.bootstrap.engine.version.clone()),
            previous_version: None,
            pending_version: None,
            active_generation: Some(operation_id.into()),
            previous_generation: None,
            project_dir: Some(final_project),
            python_executable: Some(final_python_executable),
            app_module: self.config.app_module.clone(),
            preferred_port: self.config.preferred_port,
            fallback_port: self.config.fallback_port,
            lock_sha256: None,
            payload_sha256: Some(self.config.bootstrap.engine.sha256.clone()),
        };
        manifest.tooling = ToolingManifest {
            uv_version: self.config.bootstrap.uv.version.clone(),
            python_version: self.config.bootstrap.python_version.clone(),
        };
        manifest.components = ComponentsManifest {
            piper: Default::default(),
        };
        commit.check_deadline(deadline)?;
        if let Err(error) =
            manifest.write_atomic_cas_with_gate(&manifest_path, Some(manifest.revision - 1), || {
                commit
                    .check_deadline(deadline)
                    .map_err(|error| crate::runtime::RuntimeManifestError::new(error.to_string()))
            })
        {
            let quarantine = self
                .config
                .data_root
                .join("quarantine")
                .join(format!("{}-generation", operation_id));
            quarantine_staging(&self.config.data_root, &final_release, &quarantine)?;
            if error.to_string().contains("provisioning deadline exceeded") {
                return Err(ProvisionError::new(
                    ProvisionErrorCode::DeadlineExceeded,
                    "provisioning deadline exceeded",
                    true,
                ));
            }
            return Err(error.into());
        }
        commit.complete();
        self.progress
            .report(ProgressEvent::phase(ProvisionPhase::Cleanup));
        if staging.exists() {
            validate_write_boundary(&self.config.data_root, &self.config.data_root, staging)?;
            fs::remove_dir_all(staging).map_err(|error| {
                ProvisionError::new(ProvisionErrorCode::CleanupFailed, error.to_string(), false)
            })?;
        }
        Ok(ProvisionResult {
            operation_id: operation_id.into(),
            state: ProvisionedState::Ready,
            manifest,
            manifest_path,
        })
    }
}

fn rebase_venv_after_generation_rename(
    staged_generation: &Path,
    final_generation: &Path,
) -> Result<(), ProvisionError> {
    let config = final_generation.join("venv").join("pyvenv.cfg");
    let contents = fs::read_to_string(&config).map_err(|error| {
        ProvisionError::new(
            ProvisionErrorCode::ActivationFailed,
            error.to_string(),
            false,
        )
    })?;
    let old = staged_generation.to_string_lossy();
    let new = final_generation.to_string_lossy();
    if !contents.contains(old.as_ref()) {
        return Err(ProvisionError::new(
            ProvisionErrorCode::ActivationFailed,
            "successor venv points outside the committed generation",
            false,
        ));
    }
    let rebased = contents.replace(old.as_ref(), new.as_ref());
    fs::write(&config, rebased).map_err(|error| {
        ProvisionError::new(
            ProvisionErrorCode::ActivationFailed,
            error.to_string(),
            false,
        )
    })?;
    Ok(())
}

fn quarantine_staging(
    approved_root: &Path,
    staging: &Path,
    quarantine: &Path,
) -> Result<(), ProvisionError> {
    if !staging.exists() {
        return Ok(());
    }
    validate_missing_boundary(approved_root, quarantine)?;
    fs::create_dir_all(quarantine.parent().ok_or_else(|| {
        ProvisionError::new(
            ProvisionErrorCode::CleanupFailed,
            "quarantine has no parent",
            false,
        )
    })?)
    .map_err(|error| {
        ProvisionError::new(ProvisionErrorCode::CleanupFailed, error.to_string(), false)
    })?;
    validate_write_boundary(approved_root, approved_root, staging)?;
    validate_missing_boundary(approved_root, quarantine)?;
    fs::rename(staging, quarantine)
        .or_else(|_| fs::remove_dir_all(staging))
        .map_err(|error| {
            ProvisionError::new(ProvisionErrorCode::CleanupFailed, error.to_string(), false)
        })
}

fn initial_manifest(config: &ProvisionerConfig) -> RuntimeManifest {
    RuntimeManifest {
        schema_version: crate::runtime::RUNTIME_SCHEMA_VERSION,
        install_id: config.install_id.clone(),
        product_version: config.bootstrap.product_version.clone(),
        data_root: config.data_root.clone(),
        revision: 1,
        state: RuntimeState::Unprovisioned,
        operation: RuntimeOperation::default(),
        engine: EngineManifest {
            active_version: None,
            previous_version: None,
            pending_version: None,
            active_generation: None,
            previous_generation: None,
            project_dir: None,
            python_executable: None,
            app_module: config.app_module.clone(),
            preferred_port: config.preferred_port,
            fallback_port: config.fallback_port,
            lock_sha256: None,
            payload_sha256: None,
        },
        tooling: ToolingManifest {
            uv_version: config.bootstrap.uv.version.clone(),
            python_version: config.bootstrap.python_version.clone(),
        },
        components: ComponentsManifest {
            piper: Default::default(),
        },
    }
}
