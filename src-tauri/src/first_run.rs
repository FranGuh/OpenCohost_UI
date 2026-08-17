#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime_manifest::{
        ComponentsManifest, EngineManifest, HandoffStore, PiperManifest, RuntimeManifest,
        RuntimeOperation, RuntimeState, ToolingManifest,
    };
    use std::collections::BTreeMap;
    use std::path::PathBuf;
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
        ) -> Result<(), crate::runtime_manifest::RuntimeManifestError> {
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
            configure_data_root(&handoff, &test_root("stable-id"), Some(&first.install_id))
                .unwrap();
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
        let artifact = crate::provisioner::ArtifactSpec {
            name: "artifact".into(),
            version: "1".into(),
            kind: crate::provisioner::ArtifactKind::File,
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
        let artifact = crate::provisioner::ArtifactSpec {
            name: "artifact".into(),
            version: "1".into(),
            source: format!("http://127.0.0.1:{port}/artifact"),
            sha256: "00".repeat(32),
            kind: crate::provisioner::ArtifactKind::File,
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
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 14\r\nConnection: close\r\n\r\nserver-payload")
                .unwrap();
            let _ = stream.shutdown(std::net::Shutdown::Write);
        });
        let artifact = crate::provisioner::ArtifactSpec {
            name: "artifact".into(),
            version: "1.0.0".into(),
            source: format!("http://127.0.0.1:{port}/artifact"),
            sha256: "ff".repeat(32), // deliberate mismatch with "server-payload"
            kind: crate::provisioner::ArtifactKind::File,
            expected_size: 14,
            max_size: 14,
        };
        let result = crate::provisioner::download_verified(
            &CurlArtifactSource,
            &artifact,
            &root,
            1,
            Duration::ZERO,
            &CancellationToken::new(),
            &ProvisionDeadline::from_timeout(Duration::from_secs(15)).unwrap(),
            &mut crate::provisioner::NoopProgress,
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
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 14\r\nConnection: close\r\n\r\nserver-payload")
                .unwrap();
            let _ = stream.shutdown(std::net::Shutdown::Write);
        });
        let artifact = crate::provisioner::ArtifactSpec {
            name: "artifact".into(),
            version: "1.0.0".into(),
            source: format!("http://127.0.0.1:{port}/artifact"),
            sha256: "ff".repeat(32), // deliberate mismatch with "server-payload"
            kind: crate::provisioner::ArtifactKind::File,
            expected_size: 14,
            max_size: 14,
        };
        let result = crate::provisioner::download_verified(
            &CurlArtifactSource,
            &artifact,
            &root,
            1,
            Duration::ZERO,
            &CancellationToken::new(),
            &ProvisionDeadline::from_timeout(Duration::from_secs(15)).unwrap(),
            &mut crate::provisioner::NoopProgress,
        );
        assert_eq!(
            result.unwrap_err().code(),
            ProvisionErrorCode::HashMismatch
        );
        assert!(!destination.exists(), "corrupted destination must be cleaned up");
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
        let artifact = crate::provisioner::ArtifactSpec {
            name: "artifact".into(),
            version: "1".into(),
            source: format!("http://127.0.0.1:{port}/artifact"),
            sha256: "a".repeat(64),
            kind: crate::provisioner::ArtifactKind::File,
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
            schema_version: crate::runtime_manifest::RUNTIME_SCHEMA_VERSION,
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
            validate_data_root_candidate_with_boundaries(&candidate, &[root.clone()]).unwrap_err();
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
        let artifact = crate::provisioner::ArtifactSpec {
            name: "payload".into(),
            version: "1.0.0".into(),
            source: format!("http://{address}/stall"),
            sha256: "00".repeat(32),
            kind: crate::provisioner::ArtifactKind::File,
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
        let artifact = crate::provisioner::ArtifactSpec {
            name: "payload".into(),
            version: "1.0.0".into(),
            source: "https://example.invalid/payload".into(),
            sha256: "00".repeat(32),
            kind: crate::provisioner::ArtifactKind::File,
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
        let artifact = crate::provisioner::ArtifactSpec {
            name: "payload".into(),
            version: "1.0.0".into(),
            source: "https://example.invalid/payload".into(),
            sha256: "00".repeat(32),
            kind: crate::provisioner::ArtifactKind::File,
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
            crate::provisioner::ArtifactSpec {
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
        impl crate::provisioner::ArtifactSource for LocalSource {
            fn fetch(
                &self,
                artifact: &crate::provisioner::ArtifactSpec,
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
            schema_version: crate::provisioner::BOOTSTRAP_SCHEMA_VERSION,
            product_version: "local-test".into(),
            python_version: "3.12.4".into(),
            allowed_hosts: vec!["local.test".into()],
            uv: artifact(
                "uv",
                "0.11.6",
                "https://local.test/uv.exe",
                &uv,
                crate::provisioner::ArtifactKind::File,
            ),
            engine: artifact(
                "engine",
                "local",
                "https://local.test/engine.zip",
                &engine,
                crate::provisioner::ArtifactKind::Zip,
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
        let reopened_manifest = RuntimeManifest::read_recovery(
            &result.manifest_path,
            Some("real-lifecycle-install"),
        )
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
}
use crate::backend;
use crate::provisioner::{
    ArtifactSource, BootstrapManifest, CancellationToken, CommandProcessRunner, HealthChecker,
    ProgressEvent, ProgressSink, ProvisionDeadline, ProvisionError, ProvisionErrorCode,
    Provisioner, ProvisionerConfig,
};
#[cfg(windows)]
use crate::runtime_manifest::WindowsRegistryHandoff;
use crate::runtime_manifest::{
    HandoffStore, HandoffWriter, RuntimeLocator, RuntimeManifest, RuntimeState,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

pub const RUNTIME_MANAGER_VERSION: &str = "1";
static DOWNLOAD_NONCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FirstRunPhase {
    Unconfigured,
    Provisioning,
    Ready,
    Failed,
    Degraded,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProgressSnapshot {
    pub phase: String,
    pub completed: u64,
    pub total: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FirstRunStatus {
    pub phase: FirstRunPhase,
    pub launchable: bool,
    pub data_root: Option<String>,
    pub default_data_root: Option<String>,
    pub install_id: Option<String>,
    pub error_code: Option<String>,
    pub message: String,
    pub can_retry: bool,
    pub progress: Option<ProgressSnapshot>,
}

#[derive(Debug, Clone)]
pub struct FirstRunError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl FirstRunError {
    pub fn new(code: impl Into<String>, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable,
        }
    }
    pub fn cancelled() -> Self {
        Self::new("cancelled", "Provisioning cancelled", true)
    }
}

impl std::fmt::Display for FirstRunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for FirstRunError {}

fn safe_message(code: &str) -> &'static str {
    match code {
        "unconfigured" | "runtime_unprovisioned" => {
            "Choose a data folder to install the core runtime."
        }
        "invalid_handoff" | "runtime_invalid" | "data_root_inside_install" => {
            "The runtime configuration needs repair. Choose a safe data folder and retry."
        }
        "runtime_not_ready" | "operation_busy" => {
            "The core runtime is not ready yet. Provisioning can be retried."
        }
        "cancelled" => "Provisioning was cancelled. You can retry safely.",
        "bootstrap_unavailable" | "bootstrap_invalid" => {
            "The packaged runtime metadata is unavailable. Repair the installation."
        }
        "backend_launch_failed" => {
            "The runtime installed, but the backend did not become healthy. Retry."
        }
        "ipc_unavailable" => "The runtime manager is unavailable. Restart the app and retry.",
        "unsupported_platform" => "Installed runtime provisioning is supported on Windows.",
        _ => "Core runtime provisioning could not complete. Retry or repair the installation.",
    }
}

fn safe_error(error: &FirstRunError) -> FirstRunError {
    FirstRunError::new(
        error.code.clone(),
        safe_message(&error.code),
        error.retryable,
    )
}

pub fn is_launchable_state(state: &RuntimeState) -> bool {
    *state == RuntimeState::Ready
}

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
    crate::runtime_manifest::validate_data_root(path)
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

pub fn default_data_root() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|root| root.join("OpenCohost").join("data"))
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

pub fn inspect_runtime(store: &impl HandoffStore) -> FirstRunStatus {
    let data_root = store.value("DataRoot");
    let install_id = store.value("InstallId");
    let Some(data_root_value) = data_root.clone() else {
        return status(
            FirstRunPhase::Unconfigured,
            None,
            install_id,
            "Choose a local data folder",
            true,
            None,
            Some("unconfigured"),
        );
    };
    let Some(install_id_value) = install_id.clone() else {
        return status(
            FirstRunPhase::Degraded,
            Some(data_root_value),
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
            return status(
                FirstRunPhase::Degraded,
                Some(data_root_value),
                Some(install_id_value),
                safe_message("invalid_handoff"),
                true,
                None,
                Some("invalid_handoff"),
            )
        }
    };
    let manifest_path = locator
        .data_root
        .join("state")
        .join("runtime-manifest.json");
    let manifest = match RuntimeManifest::read_recovery(&manifest_path, Some(&locator.install_id)) {
        Ok(manifest) => manifest,
        Err(_error) => {
            return status(
                FirstRunPhase::Unconfigured,
                Some(locator.data_root.to_string_lossy().into_owned()),
                Some(locator.install_id),
                safe_message("runtime_unprovisioned"),
                true,
                None,
                Some("runtime_unprovisioned"),
            )
        }
    };
    if !is_launchable_state(&manifest.state) {
        return status(
            phase_for_state(&manifest.state),
            Some(locator.data_root.to_string_lossy().into_owned()),
            Some(locator.install_id),
            safe_message("runtime_not_ready"),
            true,
            None,
            Some("runtime_not_ready"),
        );
    }
    if let Err(_error) = locator.validate_manifest(&manifest) {
        return status(
            FirstRunPhase::Degraded,
            Some(locator.data_root.to_string_lossy().into_owned()),
            Some(locator.install_id),
            safe_message("runtime_invalid"),
            true,
            None,
            Some("runtime_invalid"),
        );
    }
    status(
        FirstRunPhase::Ready,
        Some(locator.data_root.to_string_lossy().into_owned()),
        Some(locator.install_id),
        "Core runtime ready",
        false,
        None,
        None,
    )
}

fn status(
    phase: FirstRunPhase,
    data_root: Option<String>,
    install_id: Option<String>,
    message: impl Into<String>,
    can_retry: bool,
    progress: Option<ProgressSnapshot>,
    error_code: Option<&str>,
) -> FirstRunStatus {
    FirstRunStatus {
        launchable: phase == FirstRunPhase::Ready,
        phase,
        data_root,
        default_data_root: default_data_root().map(|path| path.to_string_lossy().into_owned()),
        install_id,
        error_code: error_code.map(str::to_owned),
        message: message.into(),
        can_retry,
        progress,
    }
}

fn phase_for_state(state: &RuntimeState) -> FirstRunPhase {
    match state {
        RuntimeState::Ready => FirstRunPhase::Ready,
        RuntimeState::Provisioning | RuntimeState::Repairing | RuntimeState::Updating => {
            FirstRunPhase::Provisioning
        }
        RuntimeState::Unprovisioned => FirstRunPhase::Unconfigured,
        RuntimeState::Failed => FirstRunPhase::Failed,
    }
}

#[derive(Clone)]
pub struct ProvisioningController {
    inner: Arc<Mutex<ControllerInner>>,
}

struct ControllerInner {
    status: FirstRunStatus,
    cancel: Option<CancellationToken>,
}

impl ProvisioningController {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(ControllerInner {
                status: status(
                    FirstRunPhase::Unconfigured,
                    None,
                    None,
                    "Choose a local data folder",
                    true,
                    None,
                    Some("unconfigured"),
                ),
                cancel: None,
            })),
        }
    }

    pub fn status(&self) -> FirstRunStatus {
        self.inner.lock().unwrap().status.clone()
    }

    pub fn cancel(&self) -> Result<(), FirstRunError> {
        let guard = self.inner.lock().unwrap();
        let cancel = guard.cancel.as_ref().ok_or_else(|| {
            FirstRunError::new(
                "not_provisioning",
                "No provisioning operation is active",
                false,
            )
        })?;
        if cancel.cancel() {
            Ok(())
        } else {
            Err(FirstRunError::new(
                "cancellation_too_late",
                "Activation is already finishing; cancellation was not accepted",
                false,
            ))
        }
    }

    pub fn start_with_task<F>(&self, task: F) -> Result<(), FirstRunError>
    where
        F: FnOnce(
                CancellationToken,
                Arc<dyn Fn(ProgressSnapshot) + Send + Sync>,
            ) -> Result<(), FirstRunError>
            + Send
            + 'static,
    {
        let cancel = CancellationToken::new();
        let callback_controller = self.clone();
        let progress: Arc<dyn Fn(ProgressSnapshot) + Send + Sync> =
            Arc::new(move |snapshot| callback_controller.update_progress(snapshot));
        {
            let mut guard = self.inner.lock().unwrap();
            if guard.cancel.is_some() {
                return Err(FirstRunError::new(
                    "operation_busy",
                    "Provisioning is already running",
                    true,
                ));
            }
            guard.cancel = Some(cancel.clone());
            guard.status.phase = FirstRunPhase::Provisioning;
            guard.status.launchable = false;
            guard.status.error_code = None;
            guard.status.progress = None;
            guard.status.message = "Core runtime provisioning in progress".into();
            guard.status.can_retry = false;
        }
        let controller = self.clone();
        std::thread::spawn(move || {
            let result = task(cancel, progress);
            let mut guard = controller.inner.lock().unwrap();
            guard.cancel = None;
            match result {
                Ok(()) => {
                    guard.status.phase = FirstRunPhase::Ready;
                    guard.status.launchable = true;
                    guard.status.can_retry = false;
                    guard.status.message = "Core runtime ready".into();
                }
                Err(error) => {
                    let error = safe_error(&error);
                    guard.status.phase = if error.code == "cancelled" {
                        FirstRunPhase::Failed
                    } else {
                        FirstRunPhase::Failed
                    };
                    guard.status.launchable = false;
                    guard.status.can_retry = error.retryable;
                    guard.status.error_code = Some(error.code);
                    guard.status.message = error.message;
                }
            }
        });
        Ok(())
    }

    fn update_progress(&self, snapshot: ProgressSnapshot) {
        let mut guard = self.inner.lock().unwrap();
        let replace = guard
            .status
            .progress
            .as_ref()
            .map(|current| {
                current.phase != snapshot.phase || snapshot.completed >= current.completed
            })
            .unwrap_or(true);
        if replace {
            guard.status.progress = Some(snapshot);
        }
    }
}

impl Default for ProvisioningController {
    fn default() -> Self {
        Self::new()
    }
}

pub fn setup(app: &tauri::App) {
    app.manage(ProvisioningController::new());
}

// Production adapter: curl.exe is invoked directly (never through a shell),
// and the already-validated BootstrapManifest constrains HTTPS and hosts.
struct CurlArtifactSource;
impl ArtifactSource for CurlArtifactSource {
    fn fetch(
        &self,
        artifact: &crate::provisioner::ArtifactSpec,
        destination: &Path,
        deadline: &ProvisionDeadline,
        cancel: &CancellationToken,
    ) -> Result<(), ProvisionError> {
        self.fetch_with_executable("curl.exe", artifact, destination, deadline, cancel)
    }
}

impl CurlArtifactSource {
    fn fetch_with_executable(
        &self,
        executable: &str,
        artifact: &crate::provisioner::ArtifactSpec,
        destination: &Path,
        deadline: &ProvisionDeadline,
        cancel: &CancellationToken,
    ) -> Result<(), ProvisionError> {
        self.fetch_with_publication_hook(
            executable,
            artifact,
            destination,
            deadline,
            cancel,
            || Ok(()),
        )
    }

    fn fetch_with_publication_hook<F>(
        &self,
        executable: &str,
        artifact: &crate::provisioner::ArtifactSpec,
        destination: &Path,
        deadline: &ProvisionDeadline,
        cancel: &CancellationToken,
        before_publish: F,
    ) -> Result<(), ProvisionError>
    where
        F: FnOnce() -> Result<(), ProvisionError>,
    {
        self.fetch_with_publication_hooks(
            executable,
            artifact,
            destination,
            deadline,
            cancel,
            before_publish,
            |_commit| Ok(()),
        )
    }

    fn fetch_with_publication_hooks<F, G>(
        &self,
        executable: &str,
        artifact: &crate::provisioner::ArtifactSpec,
        destination: &Path,
        deadline: &ProvisionDeadline,
        cancel: &CancellationToken,
        before_publish: F,
        after_commit: G,
    ) -> Result<(), ProvisionError>
    where
        F: FnOnce() -> Result<(), ProvisionError>,
        G: FnOnce(&crate::provisioner::CommitGuard) -> Result<(), ProvisionError>,
    {
        if cancel.is_cancelled() {
            return Err(ProvisionError::new(
                ProvisionErrorCode::Cancelled,
                "operation cancelled",
                true,
            ));
        }
        if deadline.is_expired() {
            return Err(ProvisionError::new(
                ProvisionErrorCode::DeadlineExceeded,
                "download deadline exceeded",
                true,
            ));
        }
        let parent = destination.parent().ok_or_else(|| {
            ProvisionError::new(
                ProvisionErrorCode::DownloadFailed,
                "download destination has no parent",
                true,
            )
        })?;
        let file_name = destination
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("artifact");
        let temporary = parent.join(format!(
            ".{file_name}.download-{}-{}",
            std::process::id(),
            DOWNLOAD_NONCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_file(&temporary);
        let mut child = Command::new(executable)
            .args([
                "--fail",
                "--location",
                "--silent",
                "--show-error",
                "--max-time",
            ])
            .arg(deadline.remaining_seconds().to_string())
            .args(["--output"])
            .arg(&temporary)
            .arg(&artifact.source)
            .spawn()
            .map_err(|_error| {
                let _ = fs::remove_file(&temporary);
                ProvisionError::new(
                    ProvisionErrorCode::DownloadFailed,
                    "the runtime artifact downloader could not start",
                    true,
                )
            })?;
        loop {
            if cancel.is_cancelled() {
                let _ = child.kill();
                let _ = child.wait();
                let _ = fs::remove_file(&temporary);
                return Err(ProvisionError::new(
                    ProvisionErrorCode::Cancelled,
                    "operation cancelled",
                    true,
                ));
            }
            if deadline.is_expired() {
                let _ = child.kill();
                let _ = child.wait();
                let _ = fs::remove_file(&temporary);
                return Err(ProvisionError::new(
                    ProvisionErrorCode::DeadlineExceeded,
                    "download deadline exceeded",
                    true,
                ));
            }
            match child.try_wait() {
                Ok(Some(status)) if status.success() => {
                    if deadline.is_expired() {
                        let _ = fs::remove_file(&temporary);
                        return Err(ProvisionError::new(
                            ProvisionErrorCode::DeadlineExceeded,
                            "download deadline exceeded",
                            false,
                        ));
                    }
                    before_publish()?;
                    let Some(commit) = cancel.try_begin_commit() else {
                        let _ = fs::remove_file(&temporary);
                        return Err(ProvisionError::new(
                            ProvisionErrorCode::Cancelled,
                            "operation cancelled",
                            true,
                        ));
                    };
                    after_commit(&commit)?;
                    if commit.check_deadline(deadline).is_err() {
                        let _ = fs::remove_file(&temporary);
                        return Err(ProvisionError::new(
                            ProvisionErrorCode::DeadlineExceeded,
                            "download deadline exceeded",
                            true,
                        ));
                    }
                    if destination.exists() {
                        let _ = fs::remove_file(&temporary);
                        return Err(ProvisionError::new(
                            ProvisionErrorCode::DownloadFailed,
                            "download artifact destination already exists",
                            true,
                        ));
                    }
                    if fs::rename(&temporary, destination).is_err() {
                        let _ = fs::remove_file(&temporary);
                        return Err(ProvisionError::new(
                            ProvisionErrorCode::DownloadFailed,
                            "download artifact could not be published safely",
                            true,
                        ));
                    }
                    commit.complete();
                    return Ok(());
                }
                Ok(Some(_)) => {
                    let _ = fs::remove_file(&temporary);
                    return Err(ProvisionError::new(
                        ProvisionErrorCode::DownloadFailed,
                        "HTTPS artifact download failed",
                        true,
                    ));
                }
                Ok(None) => thread::sleep(Duration::from_millis(25)),
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = fs::remove_file(&temporary);
                    return Err(ProvisionError::new(
                        ProvisionErrorCode::DownloadFailed,
                        "download process could not be monitored",
                        true,
                    ));
                }
            }
        }
    }
}

struct PythonHealthChecker;
impl HealthChecker for PythonHealthChecker {
    fn check(
        &self,
        project_dir: &Path,
        python_executable: &Path,
        env: &BTreeMap<String, String>,
        cancel: &CancellationToken,
        deadline: &ProvisionDeadline,
    ) -> Result<(), ProvisionError> {
        deadline.check(cancel)?;
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|_| {
            ProvisionError::new(
                ProvisionErrorCode::HealthCheckFailed,
                "health probe unavailable",
                true,
            )
        })?;
        let port = listener
            .local_addr()
            .map_err(|_| {
                ProvisionError::new(
                    ProvisionErrorCode::HealthCheckFailed,
                    "health probe unavailable",
                    true,
                )
            })?
            .port();
        drop(listener);
        let mut child = Command::new(python_executable)
            .args([
                "-m",
                "uvicorn",
                "opencohost.api.main:app",
                "--host",
                "127.0.0.1",
                "--port",
            ])
            .arg(port.to_string())
            .current_dir(project_dir)
            .env_clear()
            .envs(env)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|_| {
                ProvisionError::new(
                    ProvisionErrorCode::HealthCheckFailed,
                    "health process could not start",
                    true,
                )
            })?;
        let result = loop {
            if let Err(error) = deadline.check(cancel) {
                let _ = child.kill();
                let _ = child.wait();
                break Err(error);
            }
            if let Ok(Some(_)) = child.try_wait() {
                let mut stderr = String::new();
                if let Some(mut pipe) = child.stderr.take() {
                    let _ = pipe.read_to_string(&mut stderr);
                }
                let _ = child.wait();
                let detail = stderr.trim().to_owned();
                break Err(ProvisionError::new(
                    ProvisionErrorCode::HealthCheckFailed,
                    if detail.is_empty() {
                        "health process exited before becoming ready".into()
                    } else {
                        format!("health process exited before becoming ready: {detail}")
                    },
                    true,
                ));
            }
            if let Ok(mut stream) = std::net::TcpStream::connect_timeout(
                &format!("127.0.0.1:{port}").parse().unwrap(),
                Duration::from_millis(100),
            ) {
                let _ = stream.set_read_timeout(Some(Duration::from_millis(100)));
                let _ = stream.write_all(
                    b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
                );
                let mut body = String::new();
                let _ = stream.read_to_string(&mut body);
                if body.contains("\"status\":\"ok\"") {
                    break Ok(());
                }
            }
            thread::sleep(Duration::from_millis(50));
        };
        let _ = child.kill();
        let _ = child.wait();
        result
    }
}

struct ControllerProgress {
    callback: Arc<dyn Fn(ProgressSnapshot) + Send + Sync>,
}
impl ProgressSink for ControllerProgress {
    fn report(&mut self, event: ProgressEvent) {
        drop(event.message);
        (self.callback)(ProgressSnapshot {
            phase: format!("{:?}", event.phase).to_ascii_lowercase(),
            completed: event.completed,
            total: event.total,
            message: format!("{:?}", event.phase).to_ascii_lowercase(),
        });
    }
}

fn production_task(
    data_root: PathBuf,
    install_id: String,
    bootstrap: BootstrapManifest,
) -> impl FnOnce(
    CancellationToken,
    Arc<dyn Fn(ProgressSnapshot) + Send + Sync>,
) -> Result<(), FirstRunError>
       + Send
       + 'static {
    move |cancel, callback| {
        let config = ProvisionerConfig {
            data_root,
            install_id,
            app_module: "opencohost.api.main:app".into(),
            preferred_port: 8765,
            fallback_port: 8770,
            bootstrap,
            max_download_retries: 3,
            retry_backoff: Duration::from_secs(2),
            python_executable_name: "python.exe".into(),
            operation_timeout: Duration::from_secs(30 * 60),
        };
        Provisioner::new(
            config,
            CurlArtifactSource,
            CommandProcessRunner,
            PythonHealthChecker,
            ControllerProgress { callback },
        )
        .provision_first_install(cancel)
        .map(|_| ())
        .map_err(|error| {
            FirstRunError::new(error.code().as_str(), error.to_string(), error.retryable())
        })
    }
}

#[cfg(windows)]
fn current_handoff() -> WindowsRegistryHandoff {
    WindowsRegistryHandoff
}

#[cfg(not(windows))]
fn current_handoff() {}

fn install_boundaries(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, FirstRunError> {
    let mut boundaries = Vec::new();
    let executable = std::env::current_exe().map_err(|_| {
        FirstRunError::new(
            "install_boundary_unavailable",
            "application install boundary is unavailable",
            false,
        )
    })?;
    if let Some(parent) = executable.parent() {
        boundaries.push(parent.to_path_buf());
    }
    let resource_dir = app.path().resource_dir().map_err(|_| {
        FirstRunError::new(
            "install_boundary_unavailable",
            "application resource boundary is unavailable",
            false,
        )
    })?;
    boundaries.push(resource_dir);
    Ok(boundaries)
}

fn bootstrap_from_resource(resource_dir: &Path) -> Result<BootstrapManifest, FirstRunError> {
    let path = resource_dir.join("bootstrap-manifest.json");
    let text = fs::read_to_string(&path).map_err(|_| {
        FirstRunError::new(
            "bootstrap_unavailable",
            "The packaged core runtime manifest is missing; repair the installation",
            false,
        )
    })?;
    serde_json::from_str(&text).map_err(|_| {
        FirstRunError::new(
            "bootstrap_invalid",
            "The packaged core runtime manifest is invalid",
            false,
        )
    })
}

#[tauri::command]
pub fn first_run_status() -> FirstRunStatus {
    #[cfg(windows)]
    {
        return inspect_runtime(&current_handoff());
    }
    #[cfg(not(windows))]
    {
        status(
            FirstRunPhase::Unconfigured,
            None,
            None,
            "Installed runtime is supported on Windows",
            false,
            None,
            Some("unsupported_platform"),
        )
    }
}

#[tauri::command]
pub fn provision_status(controller: tauri::State<ProvisioningController>) -> FirstRunStatus {
    controller.status()
}

#[tauri::command]
pub fn provision_cancel(
    controller: tauri::State<ProvisioningController>,
) -> Result<FirstRunStatus, String> {
    controller
        .cancel()
        // Return only the stable code; the UI owns localized wording and never
        // receives the internal error detail.
        .map_err(|error| error.code)?;
    Ok(controller.status())
}

#[tauri::command]
pub fn provision_start(
    app: tauri::AppHandle,
    data_root: String,
    controller: tauri::State<ProvisioningController>,
) -> Result<FirstRunStatus, String> {
    #[cfg(not(windows))]
    {
        let _ = (app, data_root, controller);
        return Err(safe_message("unsupported_platform").into());
    }
    #[cfg(windows)]
    {
        let writer = current_handoff();
        let boundaries = install_boundaries(&app).map_err(|error| safe_message(&error.code))?;
        let configured =
            configure_data_root_with_boundaries(&writer, Path::new(&data_root), None, &boundaries)
                .map_err(|error| safe_message(&error.code).to_owned())?;
        let bootstrap = bootstrap_from_resource(
            &app.path()
                .resource_dir()
                .map_err(|_| safe_message("bootstrap_unavailable"))?,
        )
        .map_err(|error| safe_message(&error.code).to_owned())?;
        let app_handle = app.clone();
        let task = production_task(configured.data_root, configured.install_id, bootstrap);
        controller
            .start_with_task(move |cancel, progress| {
                let result = task(cancel, progress);
                if result.is_ok() {
                    backend::reload_backend(&app_handle).map_err(|error| {
                        FirstRunError::new("backend_launch_failed", error, true)
                    })?;
                }
                result
            })
            .map_err(|error| safe_message(&error.code).to_owned())?;
        Ok(controller.status())
    }
}

#[tauri::command]
pub fn provision_retry(
    app: tauri::AppHandle,
    controller: tauri::State<ProvisioningController>,
) -> Result<FirstRunStatus, String> {
    #[cfg(not(windows))]
    {
        let _ = (app, controller);
        return Err(safe_message("unsupported_platform").into());
    }
    #[cfg(windows)]
    {
        let locator = RuntimeLocator::from_handoff(&current_handoff())
            .map_err(|_| safe_message("invalid_handoff").to_owned())?;
        provision_start(
            app,
            locator.data_root.to_string_lossy().into_owned(),
            controller,
        )
    }
}
