use super::*;
use crate::backend::BackendConfig;
use std::fs;
use std::path::{Path, PathBuf};
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
    assert!(manifest::is_contained(&root, &root));
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
    let recovery = manifest::recovery_path(&path);
    let first = valid_manifest(&root);
    first.write_atomic(&path).unwrap();
    let mut candidate = first.clone();
    candidate.revision = 2;
    assert!(
        !recovery.exists(),
        "recovery file must not exist before second revision"
    );
    let _ = candidate.write_atomic_cas_with_gate(&path, Some(1), || {
        Err(RuntimeManifestError::new("injected_gate_abort"))
    });
    assert!(
        !recovery.exists(),
        "recovery file must not be created when gate fails"
    );

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
    let token = crate::provisioning::CancellationToken::new();
    let deadline =
        crate::provisioning::ProvisionDeadline::from_timeout(Duration::from_millis(50)).unwrap();
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
    let token = crate::provisioning::CancellationToken::new();
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
    let cancel_token = crate::provisioning::CancellationToken::new();
    cancel_token.cancel();
    let deadline =
        crate::provisioning::ProvisionDeadline::from_timeout(Duration::from_secs(5)).unwrap();
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
        manifest::recovery_path(&path),
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
            manifest::validate_relative_component_path(&root, value, "component").is_err(),
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
        assert!(manifest::validate_relative_component_path(&root, value, "component").is_ok());
    }
    let _ = fs::remove_dir_all(root);
}

#[test]
fn injected_canonical_ancestor_escape_is_rejected() {
    let error = manifest::validate_relative_component_path(
        Path::new(r"C:\data"),
        r"..\outside\escape",
        "component",
    )
    .unwrap_err();
    assert!(error
        .to_string()
        .contains("must remain relative and contained"));
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
            assert!(manifest::validate_relative_component_path(
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
fn create_test_junction(
    link: &std::path::Path,
    target: &std::path::Path,
) -> Result<(), JunctionUnavailable> {
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
    assert!(serde_json::from_value::<RuntimeManifest>(serde_json::Value::Object(object)).is_err());
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
