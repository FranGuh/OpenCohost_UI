use super::*;
use crate::backend;
use crate::provisioning::*;
use crate::runtime::*;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::Duration;

#[derive(Clone, Default)]
struct MemoryHandoff(Arc<std::sync::Mutex<BTreeMap<String, String>>>);

impl HandoffStore for MemoryHandoff {
    fn value(&self, name: &str) -> Option<String> {
        self.0.lock().unwrap().get(name).cloned()
    }
}

impl HandoffWriter for MemoryHandoff {
    fn write_values(
        &self,
        values: &[(String, String)],
    ) -> Result<(), crate::runtime::RuntimeManifestError> {
        let mut target = self.0.lock().unwrap();
        for (name, value) in values {
            target.insert(name.clone(), value.clone());
        }
        Ok(())
    }
}

#[test]
fn red_missing_handoff_is_unconfigured_and_does_not_claim_launchable() {
    let status = inspect_runtime(&MemoryHandoff::default());
    assert_eq!(status.phase, FirstRunPhase::Unconfigured);
    assert!(!status.launchable);
}

#[test]
fn red_data_root_validation_accepts_distinct_fixed_drive_and_rejects_unsafe_roots() {
    let root = test_root("first-run-roots");
    std::fs::create_dir_all(&root).unwrap();
    validate_data_root_candidate(&root).unwrap();
    assert!(validate_data_root_candidate(PathBuf::from("relative").as_path()).is_err());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn red_install_id_is_stable_across_retry_and_writer_only_receives_allowed_values() {
    let handoff = MemoryHandoff::default();
    let first = configure_data_root(&handoff, &test_root("stable-id"), None).unwrap();
    let second =
        configure_data_root(&handoff, &test_root("stable-id"), Some(&first.install_id)).unwrap();
    assert_eq!(first.install_id, second.install_id);
    assert_eq!(
        handoff.value("RuntimeManagerVersion").as_deref(),
        Some(RUNTIME_MANAGER_VERSION)
    );
    assert!(handoff.value("InstallerVersion").is_none());
}

#[test]
fn red_controller_is_single_flight_and_cancel_reaches_task() {
    let controller = ProvisioningController::new();
    let barrier = Arc::new(Barrier::new(2));
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let gate = barrier.clone();
    let observed = cancelled.clone();
    controller
        .start_with_task(move |cancel, _progress| {
            gate.wait();
            while !cancel.is_cancelled() {
                thread::sleep(Duration::from_millis(1));
            }
            observed.store(true, std::sync::atomic::Ordering::SeqCst);
            Err(FirstRunError::cancelled())
        })
        .unwrap();
    assert!(controller.start_with_task(|_, _| Ok(())).is_err());
    barrier.wait();
    controller.cancel().unwrap();
    for _ in 0..100 {
        if cancelled.load(std::sync::atomic::Ordering::SeqCst) {
            break;
        }
        thread::sleep(Duration::from_millis(2));
    }
    assert!(cancelled.load(std::sync::atomic::Ordering::SeqCst));
}

#[test]
fn red_controller_reports_cancellation_too_late_after_commit_linearizes() {
    let controller = ProvisioningController::new();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let task_entered = entered.clone();
    let task_release = release.clone();
    controller
        .start_with_task(move |cancel, _progress| {
            let commit = cancel.try_begin_commit().expect("commit gate");
            task_entered.wait();
            task_release.wait();
            commit.complete();
            Ok(())
        })
        .unwrap();
    entered.wait();
    let error = controller.cancel().unwrap_err();
    assert_eq!(error.code, "cancellation_too_late");
    release.wait();
    wait_for_idle(&controller);
    assert_eq!(controller.status().phase, FirstRunPhase::Ready);
}

#[test]
fn red_real_curl_publication_barrier_observes_cancel_before_rename() {
    let root = test_root("curl-publication-barrier");
    std::fs::create_dir_all(&root).unwrap();
    let destination = root.join("artifact.bin");
    std::fs::write(&destination, b"old").unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        use std::io::{Read, Write};
        let mut request = [0_u8; 1024];
        let _ = stream.read(&mut request);
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nnew")
            .unwrap();
        let _ = stream.shutdown(std::net::Shutdown::Write);
    });
    let artifact = crate::provisioning::ArtifactSpec {
        name: "artifact".into(),
        version: "1".into(),
        kind: crate::provisioning::ArtifactKind::File,
        source: format!("http://127.0.0.1:{port}/artifact"),
        sha256: "a".repeat(64),
        expected_size: 1,
        max_size: 1,
    };
    let cancel = CancellationToken::new();
    let deadline = ProvisionDeadline::from_timeout(Duration::from_secs(5)).unwrap();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let entered_hook = entered.clone();
    let release_hook = release.clone();
    let worker_cancel = cancel.clone();
    let worker_destination = destination.clone();
    let worker = thread::spawn(move || {
        CurlArtifactSource.fetch_with_publication_hook(
            "curl.exe",
            &artifact,
            &worker_destination,
            &deadline,
            &worker_cancel,
            move || {
                entered_hook.wait();
                release_hook.wait();
                Ok(())
            },
        )
    });
    entered.wait();
    assert!(cancel.cancel());
    release.wait();
    assert_eq!(
        worker.join().unwrap().unwrap_err().code(),
        ProvisionErrorCode::Cancelled
    );
    server.join().unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), b"old");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn red_real_curl_publication_commit_winner_rejects_late_cancel() {
    let root = test_root("curl-commit-winner");
    fs::create_dir_all(&root).unwrap();
    let destination = root.join("artifact.bin");
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        use std::io::{Read, Write};
        let mut request = [0_u8; 1024];
        let _ = stream.read(&mut request);
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nnew")
            .unwrap();
        let _ = stream.shutdown(std::net::Shutdown::Write);
    });
    let artifact = crate::provisioning::ArtifactSpec {
        name: "artifact".into(),
        version: "1".into(),
        source: format!("http://127.0.0.1:{port}/artifact"),
        sha256: "00".repeat(32),
        kind: crate::provisioning::ArtifactKind::File,
        expected_size: 3,
        max_size: 3,
    };
    let cancel = CancellationToken::new();
    let late_cancel_rejected = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let observed = late_cancel_rejected.clone();
    let worker_cancel = cancel.clone();
    let worker_destination = destination.clone();
    let worker = thread::spawn(move || {
        CurlArtifactSource.fetch_with_publication_hooks(
            "curl.exe",
            &artifact,
            &worker_destination,
            &ProvisionDeadline::from_timeout(Duration::from_secs(15)).unwrap(),
            &worker_cancel,
            || Ok(()),
            |_commit| {
                observed.store(!worker_cancel.cancel(), std::sync::atomic::Ordering::SeqCst);
                Ok(())
            },
        )
    });
    let result = worker.join().unwrap();
    assert!(result.is_ok(), "commit winner must complete successfully");
    assert!(late_cancel_rejected.load(std::sync::atomic::Ordering::SeqCst));
    assert_eq!(fs::read(&destination).unwrap(), b"new");
    server.join().unwrap();
    let _ = fs::remove_dir_all(root);
}

#[test]
fn red_real_curl_destination_preservation_on_hash_mismatch() {
    use sha2::{Digest, Sha256};
    let root = test_root("curl-hash-mismatch");
    fs::create_dir_all(&root).unwrap();
    let destination = root.join("artifact-1.0.0");
    let original_bytes = b"original-destination-content-survives";
    fs::write(&destination, original_bytes).unwrap();
    let mut hasher_before = Sha256::new();
    hasher_before.update(original_bytes);
    let hash_before = format!("{:x}", hasher_before.finalize());

    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        use std::io::{Read, Write};
        let mut request = [0_u8; 1024];
        let _ = stream.read(&mut request);
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Length: 14\r\nConnection: close\r\n\r\nserver-payload",
            )
            .unwrap();
        let _ = stream.shutdown(std::net::Shutdown::Write);
    });
    let artifact = crate::provisioning::ArtifactSpec {
        name: "artifact".into(),
        version: "1.0.0".into(),
        source: format!("http://127.0.0.1:{port}/artifact"),
        sha256: "ff".repeat(32), // deliberate mismatch with "server-payload"
        kind: crate::provisioning::ArtifactKind::File,
        expected_size: 14,
        max_size: 14,
    };
    let result = crate::provisioning::download_verified(
        &CurlArtifactSource,
        &artifact,
        &root,
        1,
        Duration::ZERO,
        &CancellationToken::new(),
        &ProvisionDeadline::from_timeout(Duration::from_secs(15)).unwrap(),
        &mut crate::provisioning::NoopProgress,
    );
    assert_eq!(
        result.unwrap_err().code(),
        ProvisionErrorCode::DownloadFailed
    );
    let after_bytes = fs::read(&destination).unwrap();
    let mut hasher_after = Sha256::new();
    hasher_after.update(&after_bytes);
    let hash_after = format!("{:x}", hasher_after.finalize());
    assert_eq!(hash_after, hash_before);
    assert_eq!(after_bytes, original_bytes);
    assert!(!fs::read_dir(&root).unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("download-")
    }));
    server.join().unwrap();
    let _ = fs::remove_dir_all(root);
}

#[test]
fn red_real_curl_fresh_destination_hash_mismatch_quarantines_and_cleans_up() {
    let root = test_root("curl-fresh-hash-mismatch");
    fs::create_dir_all(&root).unwrap();
    let destination = root.join("artifact-1.0.0");
    assert!(!destination.exists());

    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        use std::io::{Read, Write};
        let mut request = [0_u8; 1024];
        let _ = stream.read(&mut request);
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Length: 14\r\nConnection: close\r\n\r\nserver-payload",
            )
            .unwrap();
        let _ = stream.shutdown(std::net::Shutdown::Write);
    });
    let artifact = crate::provisioning::ArtifactSpec {
        name: "artifact".into(),
        version: "1.0.0".into(),
        source: format!("http://127.0.0.1:{port}/artifact"),
        sha256: "ff".repeat(32), // deliberate mismatch with "server-payload"
        kind: crate::provisioning::ArtifactKind::File,
        expected_size: 14,
        max_size: 14,
    };
    let result = crate::provisioning::download_verified(
        &CurlArtifactSource,
        &artifact,
        &root,
        1,
        Duration::ZERO,
        &CancellationToken::new(),
        &ProvisionDeadline::from_timeout(Duration::from_secs(15)).unwrap(),
        &mut crate::provisioning::NoopProgress,
    );
    assert_eq!(result.unwrap_err().code(), ProvisionErrorCode::HashMismatch);
    assert!(
        !destination.exists(),
        "corrupted destination must be cleaned up"
    );
    assert!(!fs::read_dir(&root).unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("download-")
    }));
    server.join().unwrap();
    let _ = fs::remove_dir_all(root);
}

#[test]
fn red_real_curl_publication_barrier_observes_expired_deadline_before_rename() {
    let root = test_root("curl-publication-deadline-barrier");
    fs::create_dir_all(&root).unwrap();
    let destination = root.join("artifact.bin");
    fs::write(&destination, b"old").unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        use std::io::{Read, Write};
        let mut request = [0_u8; 1024];
        let _ = stream.read(&mut request);
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nnew")
            .unwrap();
        let _ = stream.shutdown(std::net::Shutdown::Write);
    });
    let artifact = crate::provisioning::ArtifactSpec {
        name: "artifact".into(),
        version: "1".into(),
        source: format!("http://127.0.0.1:{port}/artifact"),
        sha256: "a".repeat(64),
        kind: crate::provisioning::ArtifactKind::File,
        expected_size: 3,
        max_size: 3,
    };
    let cancel = CancellationToken::new();
    let deadline = ProvisionDeadline::from_timeout(Duration::from_secs(1)).unwrap();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let entered_hook = entered.clone();
    let release_hook = release.clone();
    let worker_destination = destination.clone();
    let worker_cancel = cancel.clone();
    let worker_deadline = deadline;
    let worker = thread::spawn(move || {
        CurlArtifactSource.fetch_with_publication_hook(
            "curl.exe",
            &artifact,
            &worker_destination,
            &worker_deadline,
            &worker_cancel,
            move || {
                entered_hook.wait();
                release_hook.wait();
                Ok(())
            },
        )
    });
    entered.wait();
    while !deadline.is_expired() {
        thread::yield_now();
    }
    release.wait();
    assert_eq!(
        worker.join().unwrap().unwrap_err().code(),
        ProvisionErrorCode::DeadlineExceeded
    );
    server.join().unwrap();
    assert_eq!(fs::read(&destination).unwrap(), b"old");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn red_progress_is_monotonic_and_failure_is_recoverable() {
    let controller = ProvisioningController::new();
    controller
        .start_with_task(|_, progress| {
            progress(ProgressSnapshot {
                phase: "download".into(),
                completed: 5,
                total: 10,
                message: "download".into(),
            });
            progress(ProgressSnapshot {
                phase: "download".into(),
                completed: 2,
                total: 10,
                message: "old".into(),
            });
            Err(FirstRunError::new(
                "download_failed",
                "download failed",
                true,
            ))
        })
        .unwrap();
    wait_for_idle(&controller);
    let status = controller.status();
    assert_eq!(status.phase, FirstRunPhase::Failed);
    assert_eq!(status.progress.unwrap().completed, 5);
    assert!(status.can_retry);
}

#[test]
fn red_runtime_state_maps_ready_only_to_launchable() {
    for state in [
        RuntimeState::Unprovisioned,
        RuntimeState::Provisioning,
        RuntimeState::Repairing,
        RuntimeState::Updating,
        RuntimeState::Failed,
    ] {
        assert!(!is_launchable_state(&state));
    }
    assert!(is_launchable_state(&RuntimeState::Ready));
}

#[test]
fn red_existing_ready_manifest_is_normal_app_state() {
    let root = test_root("ready-runtime");
    let project = root.join("engine").join("project");
    let python = project.join("venv").join("Scripts").join("python.exe");
    std::fs::create_dir_all(python.parent().unwrap()).unwrap();
    std::fs::write(&python, b"python").unwrap();
    let handoff = MemoryHandoff::default();
    handoff
        .write_values(&[
            ("DataRoot".into(), root.to_string_lossy().into_owned()),
            ("InstallId".into(), "install-ready".into()),
        ])
        .unwrap();
    let manifest = RuntimeManifest {
        schema_version: crate::runtime::RUNTIME_SCHEMA_VERSION,
        install_id: "install-ready".into(),
        product_version: "0.1.1".into(),
        data_root: root.clone(),
        revision: 2,
        state: RuntimeState::Ready,
        operation: RuntimeOperation::default(),
        engine: EngineManifest {
            active_version: Some("1".into()),
            previous_version: None,
            pending_version: None,
            active_generation: Some("g1".into()),
            previous_generation: None,
            project_dir: Some(project),
            python_executable: Some(python),
            app_module: "opencohost.api.main:app".into(),
            preferred_port: 8765,
            fallback_port: 8770,
            lock_sha256: None,
            payload_sha256: None,
        },
        tooling: ToolingManifest {
            uv_version: "0.8.0".into(),
            python_version: "3.12.4".into(),
        },
        components: ComponentsManifest {
            piper: PiperManifest::default(),
        },
    };
    std::fs::create_dir_all(root.join("state")).unwrap();
    std::fs::write(
        root.join("state").join("runtime-manifest.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    let status = inspect_runtime(&handoff);
    assert_eq!(status.phase, FirstRunPhase::Ready);
    assert!(status.launchable);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn red_default_root_is_expanded_and_preselected_in_status() {
    let expected = default_data_root().map(|path| path.to_string_lossy().into_owned());
    let status = inspect_runtime(&MemoryHandoff::default());
    assert_eq!(status.default_data_root, expected);
    assert!(!status
        .default_data_root
        .as_deref()
        .unwrap_or_default()
        .contains('%'));
}

#[test]
fn red_install_boundary_rejects_root_descendants_before_creation() {
    let root = test_root("install-boundary");
    std::fs::create_dir_all(&root).unwrap();
    let candidate = root.join("missing").join("data");
    let error =
        validate_data_root_candidate_with_boundaries(&candidate, std::slice::from_ref(&root))
            .unwrap_err();
    assert_eq!(error.code, "data_root_inside_install");
    assert!(!candidate.exists());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn red_provisioning_failure_does_not_expose_secret_diagnostics() {
    let controller = ProvisioningController::new();
    controller
        .start_with_task(|_, _| {
            Err(FirstRunError::new(
                "process_failed",
                "TOKEN_CANARY C:\\Users\\secret\\query?token=leak",
                true,
            ))
        })
        .unwrap();
    wait_for_idle(&controller);
    let status = controller.status();
    let serialized = serde_json::to_string(&status).unwrap();
    assert!(!serialized.contains("TOKEN_CANARY"));
    assert!(!serialized.contains("C:\\\\Users\\\\secret"));
}

#[test]
fn red_fresh_install_flow_from_unconfigured_to_ready_and_launchable() {
    let root = test_root("fresh-install-flow");
    let app_dir = root.join("app_install_dir");
    let data_root = root.join("user_data_root");
    fs::create_dir_all(&app_dir).unwrap();

    let handoff = MemoryHandoff::default();

    let status = inspect_runtime(&handoff);
    assert_eq!(status.phase, FirstRunPhase::Unconfigured);
    assert!(!status.launchable);
    assert!(status.data_root.is_none());
    assert!(status.default_data_root.is_some());

    let bad_candidate = app_dir.join("subfolder");
    assert!(validate_data_root_candidate_with_boundaries(
        &bad_candidate,
        std::slice::from_ref(&app_dir)
    )
    .is_err());

    let configured = configure_data_root_with_boundaries(
        &handoff,
        &data_root,
        None,
        std::slice::from_ref(&app_dir),
    )
    .unwrap();
    assert_eq!(configured.data_root, data_root);
    assert!(!configured.install_id.is_empty());
    assert_eq!(handoff.value("RuntimeManagerVersion").as_deref(), Some("1"));
    assert_eq!(
        handoff.value("DataRoot").as_deref(),
        Some(data_root.to_string_lossy().as_ref())
    );
    assert_eq!(
        handoff.value("InstallId").as_deref(),
        Some(configured.install_id.as_str())
    );

    let status_after_config = inspect_runtime(&handoff);
    assert_eq!(status_after_config.phase, FirstRunPhase::Unconfigured);
    assert_eq!(
        status_after_config.data_root.as_deref(),
        Some(data_root.to_string_lossy().as_ref())
    );

    let controller = ProvisioningController::new();
    let target_root = data_root.clone();
    let manifest_install_id = configured.install_id.clone();
    controller
        .start_with_task(move |_, progress| {
            progress(ProgressSnapshot {
                phase: "sync".into(),
                completed: 5,
                total: 10,
                message: "syncing".into(),
            });
            let python =
                target_root.join("engine/releases/1/generations/g1/venv/Scripts/python.exe");
            let project = target_root.join("engine/releases/1/project");
            fs::create_dir_all(python.parent().unwrap()).unwrap();
            fs::create_dir_all(&project).unwrap();
            fs::write(&python, b"python").unwrap();
            let manifest = RuntimeManifest {
                schema_version: crate::runtime::RUNTIME_SCHEMA_VERSION,
                install_id: manifest_install_id,
                product_version: "0.1.1".into(),
                data_root: target_root.clone(),
                revision: 1,
                state: RuntimeState::Ready,
                operation: RuntimeOperation::default(),
                engine: EngineManifest {
                    active_version: Some("1".into()),
                    previous_version: None,
                    pending_version: None,
                    active_generation: Some("g1".into()),
                    previous_generation: None,
                    project_dir: Some(project),
                    python_executable: Some(python),
                    app_module: "opencohost.api.main:app".into(),
                    preferred_port: 8765,
                    fallback_port: 8770,
                    lock_sha256: None,
                    payload_sha256: None,
                },
                tooling: ToolingManifest {
                    uv_version: "0.11.6".into(),
                    python_version: "3.12.4".into(),
                },
                components: ComponentsManifest {
                    piper: PiperManifest::default(),
                },
            };
            fs::create_dir_all(target_root.join("state")).unwrap();
            manifest
                .write_atomic(&target_root.join("state/runtime-manifest.json"))
                .unwrap();
            Ok(())
        })
        .unwrap();

    wait_for_idle(&controller);
    assert_eq!(controller.status().phase, FirstRunPhase::Ready);

    let status_ready = inspect_runtime(&handoff);
    assert_eq!(status_ready.phase, FirstRunPhase::Ready);
    assert!(status_ready.launchable);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn red_upgrade_in_place_preserves_handoff_and_existing_manifest_without_first_run_prompt() {
    let root = test_root("upgrade-in-place");
    let app_dir_v1 = root.join("app_v1");
    let app_dir_v2 = root.join("app_v2");
    let data_root = root.join("data_root");
    fs::create_dir_all(&app_dir_v1).unwrap();
    fs::create_dir_all(&app_dir_v2).unwrap();
    fs::create_dir_all(&data_root).unwrap();

    let handoff = MemoryHandoff::default();
    let configured = configure_data_root_with_boundaries(
        &handoff,
        &data_root,
        None,
        std::slice::from_ref(&app_dir_v1),
    )
    .unwrap();

    let python = data_root.join("engine/releases/0.1.1/venv/Scripts/python.exe");
    let project = data_root.join("engine/releases/0.1.1/project");
    fs::create_dir_all(python.parent().unwrap()).unwrap();
    fs::create_dir_all(&project).unwrap();
    fs::write(&python, b"python").unwrap();
    let manifest = RuntimeManifest {
        schema_version: crate::runtime::RUNTIME_SCHEMA_VERSION,
        install_id: configured.install_id.clone(),
        product_version: "0.1.1".into(),
        data_root: data_root.clone(),
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
            lock_sha256: None,
            payload_sha256: None,
        },
        tooling: ToolingManifest {
            uv_version: "0.11.6".into(),
            python_version: "3.12.4".into(),
        },
        components: ComponentsManifest {
            piper: PiperManifest::default(),
        },
    };
    fs::create_dir_all(data_root.join("state")).unwrap();
    manifest
        .write_atomic(&data_root.join("state/runtime-manifest.json"))
        .unwrap();

    let status = inspect_runtime(&handoff);
    assert_eq!(status.phase, FirstRunPhase::Ready);
    assert!(status.launchable);
    assert_eq!(
        status.data_root.as_deref(),
        Some(data_root.to_string_lossy().as_ref())
    );
    assert_eq!(
        status.install_id.as_deref(),
        Some(configured.install_id.as_str())
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn red_uninstall_preserves_data_root_and_user_storage_by_default() {
    let root = test_root("uninstall-preservation");
    let app_dir = root.join("app_install_dir");
    let data_root = root.join("user_data_root");
    fs::create_dir_all(&app_dir).unwrap();
    fs::create_dir_all(&data_root).unwrap();

    let user_db = data_root.join("storage/memoria.db");
    fs::create_dir_all(user_db.parent().unwrap()).unwrap();
    fs::write(&user_db, b"sqlite-user-data").unwrap();

    let app_exe = app_dir.join("OpenCohost.exe");
    fs::write(&app_exe, b"tauri-binary").unwrap();

    fs::remove_dir_all(&app_dir).unwrap();
    assert!(
        !app_dir.exists(),
        "Application directory should be removed on uninstall"
    );

    assert!(
        data_root.exists(),
        "DataRoot must be preserved on uninstall by default"
    );
    assert!(
        user_db.exists(),
        "User databases must survive application uninstall"
    );
    assert_eq!(fs::read(&user_db).unwrap(), b"sqlite-user-data");

    let _ = fs::remove_dir_all(root);
}

#[test]
fn offline_lifecycle_harness_covers_unconfigured_provisioning_ready_failure_and_cancel() {
    let ready = ProvisioningController::new();
    assert_eq!(ready.status().phase, FirstRunPhase::Unconfigured);
    ready
        .start_with_task(|_, progress| {
            progress(ProgressSnapshot {
                phase: "health_check".into(),
                completed: 1,
                total: 1,
                message: "health check passed".into(),
            });
            Ok(())
        })
        .unwrap();
    wait_for_idle(&ready);
    assert_eq!(ready.status().phase, FirstRunPhase::Ready);
    assert!(ready.status().launchable);

    let failed = ProvisioningController::new();
    failed
        .start_with_task(|_, _| Err(FirstRunError::new("health_check_failed", "private", true)))
        .unwrap();
    wait_for_idle(&failed);
    assert_eq!(failed.status().phase, FirstRunPhase::Failed);
    assert_eq!(
        failed.status().error_code.as_deref(),
        Some("health_check_failed")
    );

    let cancelled = ProvisioningController::new();
    cancelled
        .start_with_task(|cancel, _| {
            while !cancel.is_cancelled() {
                thread::sleep(Duration::from_millis(1));
            }
            Err(FirstRunError::cancelled())
        })
        .unwrap();
    cancelled.cancel().unwrap();
    wait_for_idle(&cancelled);
    assert_eq!(cancelled.status().error_code.as_deref(), Some("cancelled"));
}

#[test]
#[cfg(windows)]
fn red_cancelled_curl_fetch_reaps_child_and_publishes_no_partial_file() {
    use std::io::Write;
    use std::net::TcpListener;

    if std::process::Command::new("curl.exe")
        .arg("--version")
        .output()
        .is_err()
    {
        return;
    }
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let _ = stream.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Length: 1000000\r\nConnection: close\r\n\r\n",
            );
            thread::sleep(Duration::from_secs(5));
        }
    });
    let root = test_root("curl-cancel");
    std::fs::create_dir_all(&root).unwrap();
    let destination = root.join("payload.bin");
    let artifact = crate::provisioning::ArtifactSpec {
        name: "payload".into(),
        version: "1.0.0".into(),
        source: format!("http://{address}/stall"),
        sha256: "00".repeat(32),
        kind: crate::provisioning::ArtifactKind::File,
        expected_size: 1_000_000,
        max_size: 1_000_000,
    };
    let cancel = CancellationToken::new();
    let worker_cancel = cancel.clone();
    let worker_destination = destination.clone();
    let worker = thread::spawn(move || {
        CurlArtifactSource.fetch(
            &artifact,
            &worker_destination,
            &ProvisionDeadline::from_timeout(Duration::from_secs(30)).unwrap(),
            &worker_cancel,
        )
    });
    thread::sleep(Duration::from_millis(150));
    let started = std::time::Instant::now();
    cancel.cancel();
    let result = worker.join().unwrap();
    assert!(started.elapsed() < Duration::from_secs(3));
    assert_eq!(result.unwrap_err().code(), ProvisionErrorCode::Cancelled);
    assert!(!destination.exists());
    assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
    let _ = server.join();
    let _ = fs::remove_dir_all(root);
}

#[test]
fn red_curl_spawn_failure_is_download_failed_not_deadline() {
    let root = test_root("curl-missing");
    std::fs::create_dir_all(&root).unwrap();
    let artifact = crate::provisioning::ArtifactSpec {
        name: "payload".into(),
        version: "1.0.0".into(),
        source: "https://example.invalid/payload".into(),
        sha256: "00".repeat(32),
        kind: crate::provisioning::ArtifactKind::File,
        expected_size: 1,
        max_size: 1,
    };
    let result = CurlArtifactSource.fetch_with_executable(
        "opencohost-missing-curl.exe",
        &artifact,
        &root.join("payload.bin"),
        &ProvisionDeadline::from_timeout(Duration::from_secs(10)).unwrap(),
        &CancellationToken::new(),
    );
    assert_eq!(
        result.unwrap_err().code(),
        ProvisionErrorCode::DownloadFailed
    );
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn red_expired_curl_deadline_is_deadline_exceeded_before_spawn() {
    let root = test_root("curl-expired");
    std::fs::create_dir_all(&root).unwrap();
    let artifact = crate::provisioning::ArtifactSpec {
        name: "payload".into(),
        version: "1.0.0".into(),
        source: "https://example.invalid/payload".into(),
        sha256: "00".repeat(32),
        kind: crate::provisioning::ArtifactKind::File,
        expected_size: 1,
        max_size: 1,
    };
    let deadline = ProvisionDeadline::from_timeout(Duration::from_millis(1)).unwrap();
    std::thread::sleep(Duration::from_millis(5));
    let result = CurlArtifactSource.fetch_with_executable(
        "opencohost-missing-curl.exe",
        &artifact,
        &root.join("payload.bin"),
        &deadline,
        &CancellationToken::new(),
    );
    assert_eq!(
        result.unwrap_err().code(),
        ProvisionErrorCode::DeadlineExceeded
    );
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn real_production_lifecycle_uses_provisioner_manifest_and_health_gate() {
    if std::env::var_os("OPENCOHOST_RUN_REAL_LIFECYCLE").is_none() {
        eprintln!("UNAVAILABLE real lifecycle: set OPENCOHOST_RUN_REAL_LIFECYCLE=1 with OPENCOHOST_LIFECYCLE_UV and OPENCOHOST_LIFECYCLE_ENGINE");
        return;
    }
    let uv_path = PathBuf::from(std::env::var_os("OPENCOHOST_LIFECYCLE_UV").unwrap());
    let engine_path = PathBuf::from(std::env::var_os("OPENCOHOST_LIFECYCLE_ENGINE").unwrap());
    assert!(uv_path.is_file());
    assert!(engine_path.is_file());
    let uv = std::fs::read(&uv_path).unwrap();
    let engine = std::fs::read(&engine_path).unwrap();
    let digest = |bytes: &[u8]| {
        use sha2::{Digest, Sha256};
        let mut hash = Sha256::new();
        hash.update(bytes);
        format!("{:x}", hash.finalize())
    };
    let artifact = |name: &str, version: &str, source: &str, bytes: &[u8], kind| {
        crate::provisioning::ArtifactSpec {
            name: name.into(),
            version: version.into(),
            source: source.into(),
            sha256: digest(bytes),
            kind,
            expected_size: bytes.len() as u64,
            max_size: bytes.len() as u64,
        }
    };
    struct LocalSource {
        uv: Vec<u8>,
        engine: Vec<u8>,
    }
    impl crate::provisioning::ArtifactSource for LocalSource {
        fn fetch(
            &self,
            artifact: &crate::provisioning::ArtifactSpec,
            destination: &Path,
            deadline: &ProvisionDeadline,
            cancel: &CancellationToken,
        ) -> Result<(), ProvisionError> {
            deadline.check(cancel)?;
            let bytes = if artifact.name == "uv" {
                &self.uv
            } else {
                &self.engine
            };
            std::fs::write(destination, bytes).map_err(Into::into)
        }
    }
    let root =
        std::env::temp_dir().join(format!("opencohost-real-lifecycle-{}", std::process::id()));
    let bootstrap = BootstrapManifest {
        schema_version: crate::provisioning::BOOTSTRAP_SCHEMA_VERSION,
        product_version: "local-test".into(),
        python_version: "3.12.4".into(),
        allowed_hosts: vec!["local.test".into()],
        uv: artifact(
            "uv",
            "0.11.6",
            "https://local.test/uv.exe",
            &uv,
            crate::provisioning::ArtifactKind::File,
        ),
        engine: artifact(
            "engine",
            "local",
            "https://local.test/engine.zip",
            &engine,
            crate::provisioning::ArtifactKind::Zip,
        ),
    };
    let config = ProvisionerConfig {
        data_root: root.clone(),
        install_id: "real-lifecycle-install".into(),
        app_module: "opencohost.api.main:app".into(),
        preferred_port: 18765,
        fallback_port: 18770,
        bootstrap,
        max_download_retries: 1,
        retry_backoff: Duration::ZERO,
        python_executable_name: "python.exe".into(),
        operation_timeout: Duration::from_secs(120),
    };
    let result = Provisioner::new(
        config,
        LocalSource { uv, engine },
        CommandProcessRunner,
        PythonHealthChecker,
        ControllerProgress {
            callback: Arc::new(|_| {}),
        },
    )
    .provision_first_install(CancellationToken::new())
    .expect("real provisioner must reach health-gated Ready");
    assert_eq!(result.manifest.state, RuntimeState::Ready);
    let committed =
        RuntimeManifest::read_recovery(&result.manifest_path, Some("real-lifecycle-install"))
            .expect("committed runtime manifest");
    assert_eq!(committed.state, RuntimeState::Ready);
    assert!(committed
        .engine
        .python_executable
        .as_ref()
        .unwrap()
        .is_file());
    assert!(committed.engine.project_dir.as_ref().unwrap().is_dir());
    let (_backend_info, mut backend_child) =
        backend::launch_committed_manifest_for_probe(&committed)
            .expect("production reload seam must launch committed runtime and pass health");
    let _ = backend_child.kill();
    let _ = backend_child.wait();
    std::thread::sleep(Duration::from_millis(500));

    // Second startup: simulate closing Tauri and reopening with existing manifest
    let reopened_manifest =
        RuntimeManifest::read_recovery(&result.manifest_path, Some("real-lifecycle-install"))
            .expect("reopened runtime manifest must be readable");
    assert_eq!(reopened_manifest.state, RuntimeState::Ready);
    let (_second_info, mut second_child) =
        backend::launch_committed_manifest_for_probe(&reopened_manifest)
            .expect("second launch must start backend without reprovisioning and pass health");
    let _ = second_child.kill();
    let _ = second_child.wait();

    let _ = std::fs::remove_dir_all(root);
}

fn wait_for_idle(controller: &ProvisioningController) {
    for _ in 0..100 {
        if !matches!(controller.status().phase, FirstRunPhase::Provisioning) {
            return;
        }
        thread::sleep(Duration::from_millis(2));
    }
    panic!("controller did not settle");
}

fn test_root(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("opencohost-wu3b-{name}-{}", std::process::id()))
}
