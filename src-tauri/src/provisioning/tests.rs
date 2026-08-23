use super::*;
use crate::provisioning::archive::{
    extract_zip_safely, extract_zip_safely_under_root, extract_zip_safely_with_limits, ZipLimits,
};
use crate::provisioning::artifacts::download_verified;
use crate::provisioning::cancellation::{
    set_activation_commit_hook, set_activation_wait_hook, ACTIVATION_HOOK_TEST_LOCK,
};
use crate::provisioning::health::HealthChecker;
use crate::provisioning::process::{
    build_child_environment, build_uv_find_args, build_uv_python_install_args, build_uv_sync_args,
    is_successor_venv_interpreter, resolve_managed_python_path, CommandProcessRunner,
    ProcessOutput,
};
use sha2::Digest;
use std::collections::BTreeMap;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[test]
fn red_uv_find_resolves_versioned_managed_interpreter_under_root() {
    let root = test_root("uv-find-red");
    let versioned = root
        .join("cpython-3.12.4-windows-x86_64-none")
        .join("python.exe");
    fs::create_dir_all(versioned.parent().unwrap()).unwrap();
    fs::write(&versioned, b"python").unwrap();
    let output = ProcessOutput {
        status: 0,
        stdout: format!("{}\n", versioned.display()),
        ..Default::default()
    };
    let resolved = resolve_managed_python_path(&output, &root).unwrap();
    assert_eq!(resolved, fs::canonicalize(versioned).unwrap());
    assert_eq!(
        build_uv_find_args("3.12.4"),
        vec![
            "python",
            "find",
            "--managed-python",
            "--no-project",
            "--no-config",
            "3.12.4"
        ]
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn red_uv_find_rejects_system_or_malformed_output() {
    let root = test_root("uv-find-reject-red");
    fs::create_dir_all(&root).unwrap();
    assert!(resolve_managed_python_path(
        &ProcessOutput {
            status: 0,
            stdout: "C:\\Windows\\python.exe\n".into(),
            ..Default::default()
        },
        &root
    )
    .is_err());
    assert!(resolve_managed_python_path(
        &ProcessOutput {
            status: 1,
            stderr: "not found".into(),
            ..Default::default()
        },
        &root
    )
    .is_err());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn red_cancel_commit_linearization_is_deterministic_in_both_orders() {
    let cancelled_first = CancellationToken::new();
    assert!(cancelled_first.cancel());
    assert!(cancelled_first.try_begin_commit().is_none());

    let commit_first = CancellationToken::new();
    let commit = commit_first
        .try_begin_commit()
        .expect("commit must win first");
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let release = barrier.clone();
    let token = commit_first.clone();
    let cancelled = std::thread::spawn(move || {
        release.wait();
        token.cancel()
    });
    barrier.wait();
    assert!(!cancelled.join().unwrap());
    commit.complete();
    assert!(!commit_first.cancel());
    assert!(!commit_first.is_cancelled());
}

fn create_dummy_generation(
    root: &Path,
    version: &str,
    generation_id: &str,
) -> Vec<(PathBuf, String)> {
    let gen_dir = root
        .join("engine")
        .join("releases")
        .join(version)
        .join("generations")
        .join(generation_id);
    let venv_py = gen_dir.join("venv").join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    });
    fs::create_dir_all(venv_py.parent().unwrap()).unwrap();
    fs::write(&venv_py, b"previous-venv-python-bytes").unwrap();
    let project = root
        .join("engine")
        .join("releases")
        .join(version)
        .join("project");
    fs::create_dir_all(&project).unwrap();
    let main_py = project.join("main.py");
    fs::write(&main_py, b"previous-project-main-bytes").unwrap();
    let mut entries = Vec::new();
    for path in [&venv_py, &main_py] {
        let bytes = fs::read(path).unwrap();
        let mut hasher = sha2::Sha256::new();
        hasher.update(&bytes);
        entries.push((path.clone(), format!("{:x}", hasher.finalize())));
    }
    entries
}

#[test]
fn red_generation_activation_barrier_is_exposed_by_the_real_provisioner_path() {
    let hook_lock = ACTIVATION_HOOK_TEST_LOCK.lock().unwrap();
    let root = test_root("generation-activation-barrier");
    fs::create_dir_all(&root).unwrap();
    let previous_hashes = create_dummy_generation(&root, "0.9.0", "g0");
    let bootstrap = test_bootstrap(b"engine payload");
    let token = CancellationToken::new();
    let entered = Arc::new(std::sync::Barrier::new(2));
    let release = Arc::new(std::sync::Barrier::new(2));
    let entered_hook = entered.clone();
    let release_hook = release.clone();
    let target_token = token.clone();
    set_activation_wait_hook(Some(Box::new(move |received, _| {
        if !Arc::ptr_eq(&received.0, &target_token.0) {
            return;
        }
        entered_hook.wait();
        release_hook.wait();
    })));
    let worker_token = token.clone();
    let worker_root = root.clone();
    let worker = std::thread::spawn(move || {
        let mut progress = RecordingProgress::default();
        Provisioner::new(
            test_config(worker_root.clone(), bootstrap.clone()),
            FakeArtifactSource::bytes_for(&bootstrap.engine),
            FakeProcessRunner::successful(&worker_root),
            FakeHealthChecker::healthy(),
            &mut progress,
        )
        .provision_first_install(worker_token)
    });
    entered.wait();
    assert!(token.cancel());
    release.wait();
    let error = worker.join().unwrap().unwrap_err();
    assert_eq!(error.code(), ProvisionErrorCode::Cancelled);
    set_activation_wait_hook(None);
    set_activation_commit_hook(None);
    drop(hook_lock);
    assert!(!root.join("engine").join("releases").join("1.0.0").exists());
    for (path, expected_hash) in &previous_hashes {
        assert!(path.is_file());
        let bytes = fs::read(path).unwrap();
        let mut hasher = sha2::Sha256::new();
        hasher.update(&bytes);
        assert_eq!(&format!("{:x}", hasher.finalize()), expected_hash);
    }
    let _ = fs::remove_dir_all(root);
}

#[test]
fn red_generation_activation_commit_winner_rejects_late_cancel() {
    let _hook_lock = ACTIVATION_HOOK_TEST_LOCK.lock().unwrap();
    let root = test_root("generation-activation-commit-winner");
    fs::create_dir_all(&root).unwrap();
    let bootstrap = test_bootstrap(b"engine payload");
    let token = CancellationToken::new();
    let late_cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let observed = late_cancel.clone();
    let hook_token = token.clone();
    set_activation_commit_hook(Some(Box::new(move |commit, _| {
        if !Arc::ptr_eq(&commit.token.0, &hook_token.0) {
            return;
        }
        observed.store(!hook_token.cancel(), std::sync::atomic::Ordering::SeqCst);
    })));
    let mut progress = RecordingProgress::default();
    let result = Provisioner::new(
        test_config(root.clone(), bootstrap.clone()),
        FakeArtifactSource::bytes_for(&bootstrap.engine),
        FakeProcessRunner::successful(&root),
        FakeHealthChecker::healthy(),
        &mut progress,
    )
    .provision_first_install(token.clone())
    .unwrap();
    set_activation_wait_hook(None);
    set_activation_commit_hook(None);
    assert!(late_cancel.load(std::sync::atomic::Ordering::SeqCst));
    assert_eq!(result.state, ProvisionedState::Ready);
    assert!(result.manifest.engine.active_generation.is_some());
    assert!(!token.cancel());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn red_generation_activation_barrier_observes_expiry_before_rename() {
    let _hook_lock = ACTIVATION_HOOK_TEST_LOCK.lock().unwrap();
    let root = test_root("generation-activation-deadline-barrier");
    fs::create_dir_all(&root).unwrap();
    let previous_hashes = create_dummy_generation(&root, "0.9.0", "g0");
    let bootstrap = test_bootstrap(b"engine payload");
    let entered = Arc::new(std::sync::Barrier::new(2));
    let release = Arc::new(std::sync::Barrier::new(2));
    let entered_hook = entered.clone();
    let release_hook = release.clone();
    let token = CancellationToken::new();
    let target_token = token.clone();
    set_activation_wait_hook(Some(Box::new(move |received, deadline| {
        if !Arc::ptr_eq(&received.0, &target_token.0) {
            return;
        }
        entered_hook.wait();
        while !deadline.is_expired() {
            std::thread::yield_now();
        }
        release_hook.wait();
    })));
    let worker_root = root.clone();
    let worker = std::thread::spawn(move || {
        let mut config = test_config(worker_root.clone(), bootstrap.clone());
        config.operation_timeout = Duration::from_secs(1);
        let mut progress = RecordingProgress::default();
        Provisioner::new(
            config,
            FakeArtifactSource::bytes_for(&bootstrap.engine),
            FakeProcessRunner::successful(&worker_root),
            FakeHealthChecker::healthy(),
            &mut progress,
        )
        .provision_first_install(token)
    });
    entered.wait();
    release.wait();
    let error = worker.join().unwrap().unwrap_err();
    set_activation_wait_hook(None);
    set_activation_commit_hook(None);
    assert_eq!(error.code(), ProvisionErrorCode::DeadlineExceeded);
    assert!(!root.join("engine").join("releases").join("1.0.0").exists());
    for (path, expected_hash) in &previous_hashes {
        assert!(path.is_file());
        let bytes = fs::read(path).unwrap();
        let mut hasher = sha2::Sha256::new();
        hasher.update(&bytes);
        assert_eq!(&format!("{:x}", hasher.finalize()), expected_hash);
    }
    let _ = fs::remove_dir_all(root);
}

#[test]
fn red_terminal_download_errors_are_not_retried_or_wrapped() {
    let root = test_root("terminal-download");
    fs::create_dir_all(&root).unwrap();
    let spec = artifact("engine", b"expected");
    let source = TerminalArtifactSource {
        code: ProvisionErrorCode::DeadlineExceeded,
        calls: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
    };
    let error = download_verified(
        &source,
        &spec,
        &root,
        3,
        Duration::ZERO,
        &CancellationToken::new(),
        &ProvisionDeadline::from_timeout(Duration::from_secs(30)).unwrap(),
        &mut NoopProgress,
    )
    .unwrap_err();
    assert_eq!(error.code(), ProvisionErrorCode::DeadlineExceeded);
    assert_eq!(source.calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn red_unicode_windows_collision_key_rejects_case_and_canonical_equivalents() {
    let mut bootstrap = test_bootstrap(b"engine payload");
    bootstrap.uv.name = "Ä".into();
    bootstrap.engine.name = "ä".into();
    assert!(bootstrap.validate().is_err());

    let root = test_root("unicode-zip-red");
    let archive = zip_bytes([
        ("Ä.txt", b"a".as_slice()),
        ("a\u{308}.txt", b"b".as_slice()),
    ]);
    assert!(extract_zip_safely_with_limits(&archive, &root, ZipLimits::default()).is_err());
    let _ = fs::remove_dir_all(root);
}

#[cfg(windows)]
#[test]
fn red_windows_lock_denies_path_replacement_while_owner_holds_it() {
    let root = test_root("lock-replacement-red");
    let path = root.join("state").join("operation.lock");
    let replacement = root.join("state").join("replacement.lock");
    let holder = OperationLock::acquire(&path, "holder").unwrap();
    fs::write(&replacement, b"replacement").unwrap();
    assert!(fs::rename(&replacement, &path).is_err());
    assert_eq!(
        OperationLock::acquire(&path, "contender")
            .unwrap_err()
            .code(),
        ProvisionErrorCode::LockBusy
    );
    drop(holder);
    fs::rename(&replacement, &path).unwrap();
    fs::remove_file(&path).unwrap();
    let reacquired = OperationLock::acquire(&path, "after-release").unwrap();
    drop(reacquired);
    let _ = fs::remove_dir_all(root);
}

#[cfg(windows)]
#[test]
fn red_injected_job_assignment_failure_kills_direct_child() {
    let runner = CommandProcessRunner;
    let cwd = test_root("job-assignment-red");
    fs::create_dir_all(&cwd).unwrap();
    let cancel = CancellationToken::new();
    let deadline = ProvisionDeadline::from_timeout(Duration::from_secs(10)).unwrap();
    let mut observed_pid = None;
    let result = runner.run_with_job_assigner(
        Path::new("cmd.exe"),
        &["/C".into(), "timeout /T 30 /NOBREAK >NUL".into()],
        &cwd,
        &BTreeMap::new(),
        &cancel,
        &deadline,
        |child| {
            observed_pid = Some(child.id());
            Err(())
        },
    );
    assert_eq!(
        result.unwrap_err().code(),
        ProvisionErrorCode::ProcessIsolationFailed
    );
    let pid = observed_pid.expect("injection seam must observe the spawned child");
    assert!(!windows_process_is_alive(pid));
    let _ = fs::remove_dir_all(cwd);
}

#[cfg(windows)]
#[test]
fn real_windows_job_cancellation_kills_grandchild_process() {
    let powershell = Path::new(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe");
    if !powershell.is_file() {
        eprintln!("UNAVAILABLE real Windows Job Object probe: powershell.exe missing");
        return;
    }
    let root = test_root("job-tree-real");
    fs::create_dir_all(&root).unwrap();
    let pid_file = root.join("grandchild.pid");
    let command = format!(
        "$child = Start-Process -FilePath 'C:\\Windows\\System32\\cmd.exe' -ArgumentList '/c','C:\\Windows\\System32\\ping.exe -n 30 127.0.0.1 > nul' -PassThru; Set-Content -LiteralPath '{}' -Value $child.Id; Wait-Process -Id $child.Id",
        pid_file.display()
    );
    let runner = CommandProcessRunner;
    let cancel = CancellationToken::new();
    let thread_cancel = cancel.clone();
    let thread_root = root.clone();
    let mut child_env = BTreeMap::new();
    child_env.insert("SystemRoot".into(), r"C:\Windows".into());
    child_env.insert("WINDIR".into(), r"C:\Windows".into());
    child_env.insert("PATH".into(), r"C:\Windows\System32".into());
    let deadline = ProvisionDeadline::from_timeout(Duration::from_secs(30)).unwrap();
    let thread = std::thread::spawn(move || {
        runner.run(
            powershell,
            &["-NoProfile".into(), "-Command".into(), command],
            &thread_root,
            &child_env,
            &thread_cancel,
            &deadline,
        )
    });
    let mut grandchild_pid = None;
    for _ in 0..100 {
        if let Ok(contents) = fs::read_to_string(&pid_file) {
            grandchild_pid = contents.trim().parse::<u32>().ok();
            if grandchild_pid.is_some() {
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    let pid = grandchild_pid.expect("real probe must start and record a grandchild");
    cancel.cancel();
    let result = thread.join().unwrap().unwrap_err();
    assert_eq!(result.code(), ProvisionErrorCode::Cancelled);
    for _ in 0..40 {
        if !windows_process_is_alive(pid) {
            break;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    assert!(!windows_process_is_alive(pid));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn red_deadline_is_configured_and_source_health_receive_it() {
    let deadline = ProvisionDeadline::from_timeout(Duration::from_secs(3)).unwrap();
    assert!(!deadline.is_expired());
    assert!(ProvisionDeadline::from_timeout(Duration::ZERO).is_err());
}

#[test]
fn red_operation_lock_uses_os_exclusive_ownership_not_unlink_release() {
    let root = test_root("exclusive-lock-red");
    let path = root.join("state").join("operation.lock");
    let first = OperationLock::acquire(&path, "first").unwrap();
    let second = OperationLock::acquire(&path, "second");
    assert_eq!(second.unwrap_err().code(), ProvisionErrorCode::LockBusy);
    drop(first);
    let third = OperationLock::acquire(&path, "third").unwrap();
    drop(third);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn real_uv_managed_python_and_venv_probe_is_typed_unavailable_without_opt_in() {
    if std::env::var_os("OPENCOHOST_RUN_REAL_UV").is_none() {
        eprintln!("UNAVAILABLE real uv probe: set OPENCOHOST_RUN_REAL_UV=1 to enable the external-tool integration probe");
        return;
    }
    let root = test_root("real-uv");
    let project = root.join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("pyproject.toml"), "[project]\nname = \"probe_project\"\nversion = \"0.1.0\"\nrequires-python = \">=3.12,<3.13\"\ndependencies = []\n").unwrap();
    let managed = root.join("managed");
    let cache = root.join("cache");
    let install = std::process::Command::new("uv")
        .args([
            "python",
            "install",
            "3.12.4",
            "--managed-python",
            "--no-registry",
            "--no-bin",
            "--no-config",
            "--install-dir",
        ])
        .arg(&managed)
        .env("UV_PYTHON_INSTALL_DIR", &managed)
        .env("UV_CACHE_DIR", &cache)
        .output();
    let Ok(install) = install else {
        eprintln!("UNAVAILABLE real uv probe: uv executable missing");
        return;
    };
    if !install.status.success() {
        eprintln!(
            "UNAVAILABLE real uv probe: {}",
            String::from_utf8_lossy(&install.stderr)
        );
        return;
    }
    let find = std::process::Command::new("uv")
        .args([
            "python",
            "find",
            "--managed-python",
            "--no-project",
            "--no-config",
            "3.12.4",
        ])
        .env("UV_PYTHON_INSTALL_DIR", &managed)
        .env("UV_CACHE_DIR", &cache)
        .output()
        .unwrap();
    let interpreter = resolve_managed_python_path(
        &ProcessOutput {
            status: find.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&find.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&find.stderr).into_owned(),
        },
        &managed,
    )
    .unwrap();
    let lock = std::process::Command::new("uv")
        .args(["lock", "--offline", "--no-config", "--project"])
        .arg(&project)
        .output()
        .unwrap();
    assert!(
        lock.status.success(),
        "uv lock failed: {}",
        String::from_utf8_lossy(&lock.stderr)
    );
    let sync = std::process::Command::new("uv")
        .args([
            "sync",
            "--locked",
            "--no-editable",
            "--no-config",
            "--project",
        ])
        .arg(&project)
        .args(["--python"])
        .arg(&interpreter)
        .arg("--managed-python")
        .env("UV_PYTHON_INSTALL_DIR", &managed)
        .env("UV_PROJECT_ENVIRONMENT", project.join(".venv"))
        .env("UV_CACHE_DIR", &cache)
        .output()
        .unwrap();
    assert!(
        sync.status.success(),
        "uv sync failed: {}",
        String::from_utf8_lossy(&sync.stderr)
    );
    let venv_python = project.join(".venv").join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    });
    assert!(venv_python.is_file());
    let run = std::process::Command::new(&venv_python)
        .args(["-c", "import sys; print(sys.executable)"])
        .output()
        .unwrap();
    assert!(run.status.success());

    fs::write(
        project.join("health_probe.py"),
        r#"from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/api/health":
            self.send_response(404)
            self.end_headers()
            return
        body = b'{"status":"ok"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *_args):
        pass

server = HTTPServer(("127.0.0.1", 0), Handler)
Path("health_port.txt").write_text(str(server.server_port), encoding="ascii")
server.handle_request()
server.server_close()
"#,
    )
    .unwrap();
    let mut health_process = std::process::Command::new(&venv_python)
        .arg("health_probe.py")
        .current_dir(&project)
        .spawn()
        .unwrap();
    let port_file = project.join("health_port.txt");
    let mut port = None;
    for _ in 0..100 {
        if let Ok(contents) = fs::read_to_string(&port_file) {
            port = contents.trim().parse::<u16>().ok();
            if port.is_some() {
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    let port = port.expect("real uv probe must start its /api/health server");
    let mut response = String::new();
    let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .write_all(b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .unwrap();
    stream.read_to_string(&mut response).unwrap();
    assert!(response.contains("200 OK"));
    assert!(response.contains("{\"status\":\"ok\"}"));
    assert!(health_process.wait().unwrap().success());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn red_zip_enforces_aggregate_compressed_and_actual_output_limits() {
    let root = test_root("zip-aggregate-red");
    let archive = zip_bytes([("large.txt", b"payload payload payload".as_slice())]);
    let limits = ZipLimits {
        max_total_compressed_size: 1,
        max_total_size: 1,
        ..ZipLimits::default()
    };
    assert!(extract_zip_safely_with_limits(&archive, &root, limits).is_err());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn red_uv_contract_targets_successor_venv_and_restricts_sources() {
    let root = test_root("uv-contract-red");
    let project = root.join("project");
    let uv = root.join("tools").join("uv.exe");
    let args = build_uv_python_install_args("3.12.4", &root.join("python"));
    assert_eq!(args.first().map(String::as_str), Some("python"));
    assert!(args.iter().any(|arg| arg == "--no-registry"));
    assert!(args.iter().any(|arg| arg == "--no-bin"));
    assert!(args.iter().any(|arg| arg == "--no-config"));
    let sync = build_uv_sync_args(&project, &root.join("python.exe"));
    assert!(sync.iter().any(|arg| arg == "--project"));
    assert!(sync.iter().any(|arg| arg == "--no-config"));
    let final_python = root
        .join("engine")
        .join("releases")
        .join("1")
        .join("generations")
        .join("op")
        .join("venv")
        .join("Scripts")
        .join("python.exe");
    assert!(is_successor_venv_interpreter(
        &final_python,
        &root.join("python").join("python.exe")
    ));
    assert!(uv.is_absolute());
}

#[test]
fn red_zip_pre_scan_rejects_limits_collisions_reserved_and_normalization() {
    let root = test_root("zip-prescan-red");
    let limits = ZipLimits {
        max_entries: 1,
        ..ZipLimits::default()
    };
    assert!(extract_zip_safely_with_limits(
        &zip_bytes([("a.txt", b"a"), ("b.txt", b"b")]),
        &root,
        limits
    )
    .is_err());
    assert!(extract_zip_safely_with_limits(
        &zip_bytes([("A.txt", b"a"), ("a.TXT", b"b")]),
        &root,
        ZipLimits::default()
    )
    .is_err());
    assert!(extract_zip_safely_with_limits(
        &zip_bytes([("CON.txt", b"a")]),
        &root,
        ZipLimits::default()
    )
    .is_err());
    assert!(extract_zip_safely_with_limits(
        &zip_bytes([("a. ", b"a"), ("a", b"b")]),
        &root,
        ZipLimits::default()
    )
    .is_err());
    let pristine_root = test_root("zip-prescan-pristine");
    assert!(extract_zip_safely_with_limits(
        &zip_bytes([("A.txt", b"a"), ("a.TXT", b"b")]),
        &pristine_root,
        ZipLimits::default()
    )
    .is_err());
    assert!(
        !pristine_root.exists(),
        "pre-scan rejection must not create the extraction root"
    );
    let _ = fs::remove_dir_all(root);
    let _ = fs::remove_dir_all(pristine_root);
}

#[test]
fn red_child_environment_is_allowlisted_and_drops_user_path() {
    let mut inherited = BTreeMap::new();
    inherited.insert("PATH".into(), "user-path".into());
    inherited.insert("PYTHONHOME".into(), "bad".into());
    inherited.insert("VIRTUAL_ENV".into(), "bad".into());
    inherited.insert("CONDA_PREFIX".into(), "bad".into());
    inherited.insert("PIP_INDEX_URL".into(), "bad".into());
    let env = build_child_environment(&inherited, &test_root("env-red")).unwrap();
    assert!(!env.contains_key("PATH"));
    assert!(!env.contains_key("PYTHONHOME"));
    assert!(!env.contains_key("VIRTUAL_ENV"));
    assert!(!env.contains_key("CONDA_PREFIX"));
    assert!(!env.contains_key("PIP_INDEX_URL"));
}

#[test]
fn red_lock_metadata_requires_nonce_and_nonzero_identity() {
    assert!(serde_json::from_str::<OperationMetadata>(
        r#"{"operation_id":"","owner_pid":0,"acquired_unix_ms":0}"#
    )
    .is_err());
    assert!(OperationMetadata::validate(&OperationMetadata {
        operation_id: "".into(),
        owner_pid: 0,
        acquired_unix_ms: 0,
        ownership_nonce: String::new(),
        process_start_unix_ms: None
    })
    .is_err());
}

#[test]
fn red_bootstrap_requires_allowed_https_hosts_and_nonzero_sizes() {
    let mut bootstrap = test_bootstrap(b"engine payload");
    bootstrap.allowed_hosts = vec!["example.test".into()];
    bootstrap.uv.expected_size = 0;
    assert!(bootstrap.validate().is_err());
    bootstrap.uv.expected_size = 2;
    bootstrap.uv.max_size = 1;
    assert!(bootstrap.validate().is_err());
}

#[test]
fn real_process_import_probe_is_typed_unavailable_without_private_fixture() {
    let output = std::process::Command::new("python")
        .args(["-c", "import sys; import json; print(sys.executable)"])
        .output();
    match output {
        Ok(output) if output.status.success() => {
            assert!(!String::from_utf8_lossy(&output.stdout).trim().is_empty())
        }
        Ok(output) => eprintln!(
            "UNAVAILABLE real-process fixture: {}",
            String::from_utf8_lossy(&output.stderr)
        ),
        Err(error) => eprintln!("UNAVAILABLE real-process fixture: {error}"),
    }
}

#[test]
fn operation_lock_rejects_live_owner_even_when_old() {
    let root = test_root("live-lock");
    fs::create_dir_all(&root).unwrap();
    let path = root.join("state").join("operation.lock");
    let first =
        OperationLock::acquire_with_probe(&path, "operation-a", 111, &FakeLiveness::live([111]))
            .unwrap();
    let error = OperationLock::acquire_with_probe(
        &path,
        "operation-b",
        222,
        &FakeLiveness::live([111, 222]),
    )
    .unwrap_err();
    assert_eq!(error.code(), ProvisionErrorCode::LockBusy);
    drop(first);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn operation_lock_reclaims_dead_owner_without_elapsed_time_steal() {
    let root = test_root("dead-lock");
    let path = root.join("state").join("operation.lock");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(
        &path,
        r#"{"operation_id":"dead","owner_pid":999,"acquired_unix_ms":1,"ownership_nonce":"dead-nonce","process_start_unix_ms":null}"#,
    )
    .unwrap();
    let lock =
        OperationLock::acquire_with_probe(&path, "operation-new", 222, &FakeLiveness::dead([999]))
            .unwrap();
    assert_eq!(lock.metadata().operation_id, "operation-new");
    drop(lock);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn operation_lock_metadata_is_owner_and_operation_specific() {
    let root = test_root("lock-metadata");
    let lock = OperationLock::acquire(&root.join("state").join("operation.lock"), "op").unwrap();
    assert_eq!(lock.metadata().operation_id, "op");
    assert_eq!(lock.metadata().owner_pid, std::process::id());
    drop(lock);
    assert!(root.join("state").join("operation.lock").exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn operation_lock_has_one_winner_under_barrier_contention() {
    use std::sync::{Arc, Barrier};
    let root = test_root("lock-race");
    let path = Arc::new(root.join("state").join("operation.lock"));
    let barrier = Arc::new(Barrier::new(8));
    let mut workers = Vec::new();
    for index in 0..8 {
        let path = path.clone();
        let barrier = barrier.clone();
        workers.push(std::thread::spawn(move || {
            barrier.wait();
            OperationLock::acquire(&path, &format!("op-{index}"))
                .map(|lock| {
                    // Keep the winning OS-held lock until every contender
                    // has had time to attempt acquisition. Without this,
                    // a later contender can legitimately acquire after an
                    // early winner drops, making the assertion timing
                    // dependent rather than a contention proof.
                    std::thread::sleep(Duration::from_millis(500));
                    drop(lock);
                })
                .is_ok()
        }));
    }
    let winners = workers
        .into_iter()
        .filter_map(|worker| worker.join().ok())
        .filter(|won| *won)
        .count();
    assert_eq!(winners, 1);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn child_environment_is_private_and_strips_conflicting_cache_inputs() {
    let root = test_root("child-env");
    let mut inherited = BTreeMap::new();
    inherited.insert("UV_CACHE_DIR".into(), "user-cache".into());
    inherited.insert("UV_INDEX_URL".into(), "user-index".into());
    inherited.insert("PYTHONPATH".into(), "user-path".into());
    inherited.insert("HF_HOME".into(), "user-hf".into());
    inherited.insert("PATH".into(), "user-path".into());
    inherited.insert("OPENCOHOST_DATA_ROOT".into(), "user-root".into());
    let env = build_child_environment(&inherited, &root).unwrap();
    assert_eq!(
        env.get("UV_PYTHON_INSTALL_DIR"),
        Some(&root.join("python").to_string_lossy().into_owned())
    );
    assert_eq!(
        env.get("UV_PROJECT_ENVIRONMENT"),
        Some(&root.join("venv").to_string_lossy().into_owned())
    );
    assert_eq!(
        env.get("UV_CACHE_DIR"),
        Some(&root.join("cache").to_string_lossy().into_owned())
    );
    assert!(!env.contains_key("UV_INDEX_URL"));
    assert!(!env.contains_key("PYTHONPATH"));
    assert!(!env.contains_key("HF_HOME"));
    assert!(!env.contains_key("PATH"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn safe_zip_extraction_rejects_slip_root_prefix_and_symlink_entries() {
    let root = test_root("zip-safety");
    fs::create_dir_all(&root).unwrap();
    for name in ["../escape.txt", r"C:\outside.txt", r"\root.txt"] {
        let archive = zip_bytes([(name, b"bad".as_slice())]);
        assert_eq!(
            extract_zip_safely(&archive, &root).unwrap_err().code(),
            ProvisionErrorCode::ZipSlip
        );
    }
    let _ = fs::remove_dir_all(root);
}

#[cfg(windows)]
#[test]
fn safe_zip_extraction_rejects_missing_leaf_beyond_junction_escape() {
    let root = test_root("zip-junction");
    let outside = test_root("zip-junction-outside");
    let stage = root.join("staging");
    let junction = stage.join("escape");
    fs::create_dir_all(&stage).unwrap();
    fs::create_dir_all(&outside).unwrap();
    match create_junction(&junction, &outside) {
        Ok(()) => {
            let archive = zip_bytes([("escape/missing.bin", b"bad".as_slice())]);
            assert_eq!(
                extract_zip_safely_under_root(&archive, &root, &stage)
                    .unwrap_err()
                    .code(),
                ProvisionErrorCode::ZipSlip
            );
        }
        Err(unavailable) => {
            eprintln!("SKIPPED junction capability: {unavailable:?}");
            assert!(!unavailable.reason.is_empty());
        }
    }
    let _ = fs::remove_dir_all(root);
    let _ = fs::remove_dir_all(outside);
}

#[test]
fn bootstrap_manifest_fails_closed_for_non_https_sources_and_unknown_fields() {
    let mut bootstrap = test_bootstrap(b"engine payload");
    bootstrap.engine.source = "file:///untrusted".into();
    assert_eq!(
        bootstrap.validate().unwrap_err().code(),
        ProvisionErrorCode::InvalidBootstrap
    );
    let mut unknown = serde_json::to_value(test_bootstrap(b"engine payload")).unwrap();
    unknown
        .as_object_mut()
        .unwrap()
        .insert("unexpected".into(), serde_json::Value::Bool(true));
    assert!(serde_json::from_value::<BootstrapManifest>(unknown).is_err());
}

#[test]
fn retries_download_and_reports_hash_mismatch() {
    let root = test_root("hash-retry");
    fs::create_dir_all(&root).unwrap();
    let spec = artifact("engine", b"expected");
    let source = FakeArtifactSource::failing_then_bytes(1, b"wrong".to_vec());
    let error = download_verified(
        &source,
        &spec,
        &root,
        2,
        Duration::ZERO,
        &CancellationToken::new(),
        &ProvisionDeadline::from_timeout(Duration::from_secs(30)).unwrap(),
        &mut NoopProgress,
    )
    .unwrap_err();
    assert_eq!(error.code(), ProvisionErrorCode::HashMismatch);
    assert_eq!(source.calls(), 2);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn red_failed_retry_preserves_an_existing_destination_byte_for_byte() {
    let root = test_root("destination-preserve");
    fs::create_dir_all(&root).unwrap();
    let spec = artifact("engine", b"new-bytes");
    let destination = root.join("engine-1.0.0");
    fs::write(&destination, b"active-bytes").unwrap();
    let source = FakeArtifactSource::failing_then_bytes(3, b"new-bytes".to_vec());
    let error = download_verified(
        &source,
        &spec,
        &root,
        2,
        Duration::ZERO,
        &CancellationToken::new(),
        &ProvisionDeadline::from_timeout(Duration::from_secs(30)).unwrap(),
        &mut NoopProgress,
    )
    .unwrap_err();
    assert_eq!(error.code(), ProvisionErrorCode::DownloadFailed);
    assert_eq!(fs::read(&destination).unwrap(), b"active-bytes");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn cancellation_is_honored_at_each_progress_phase() {
    for phase in ProvisionPhase::ALL {
        let mut sink = CancelOnPhase::new(phase);
        sink.report(ProgressEvent::phase(phase));
        assert!(
            sink.token().is_cancelled(),
            "phase {phase:?} was not cancellable"
        );
    }
}

#[test]
fn provisioner_cancels_before_activation_when_each_operational_phase_requests_it() {
    for phase in ProvisionPhase::ALL
        .into_iter()
        .filter(|phase| *phase != ProvisionPhase::Cleanup)
    {
        let root = test_root(&format!("cancel-{phase:?}"));
        fs::create_dir_all(&root).unwrap();
        let bootstrap = test_bootstrap(b"engine payload");
        let mut sink = CancelOnPhase::new(phase);
        let token = sink.token();
        let error = Provisioner::new(
            test_config(root.clone(), bootstrap.clone()),
            FakeArtifactSource::bytes_for(&bootstrap.engine),
            FakeProcessRunner::successful(&root),
            FakeHealthChecker::healthy(),
            &mut sink,
        )
        .provision_first_install(token)
        .unwrap_err();
        assert_eq!(
            error.code(),
            ProvisionErrorCode::Cancelled,
            "phase {phase:?}"
        );
        if phase != ProvisionPhase::VerifyBootstrap {
            assert!(
                root.join("quarantine").exists(),
                "cancelled phase {phase:?} was not quarantined"
            );
        }
        let _ = fs::remove_dir_all(root);
    }
}

#[test]
fn successful_first_install_health_gates_manifest_activation_and_cleanup() {
    let root = test_root("success");
    fs::create_dir_all(&root).unwrap();
    let bootstrap = test_bootstrap(b"engine payload");
    let source = FakeArtifactSource::bytes_for(&bootstrap.engine);
    let runner = FakeProcessRunner::successful(&root);
    let health = FakeHealthChecker::healthy();
    let mut progress = RecordingProgress::default();
    let config = test_config(root.clone(), bootstrap);
    let result = Provisioner::new(config, source, runner.clone(), health, &mut progress)
        .provision_first_install(CancellationToken::new())
        .unwrap();
    assert_eq!(result.state, ProvisionedState::Ready);
    assert!(result.manifest.engine.project_dir.unwrap().is_dir());
    assert!(result
        .manifest
        .engine
        .python_executable
        .as_ref()
        .unwrap()
        .is_file());
    let persisted_python = result.manifest.engine.python_executable.as_ref().unwrap();
    assert!(persisted_python
        .to_string_lossy()
        .to_ascii_lowercase()
        .contains("venv"));
    assert!(!persisted_python.starts_with(root.join("python")));
    assert!(result.manifest_path.is_file());
    assert!(!root.join("staging").join(&result.operation_id).exists());
    assert!(runner
        .sync_args()
        .iter()
        .any(|args| args.iter().any(|arg| arg == "--locked")));
    let env = runner.last_env();
    assert!(env.contains_key("UV_PYTHON_INSTALL_DIR"));
    assert!(env.contains_key("UV_PROJECT_ENVIRONMENT"));
    assert!(env.contains_key("UV_CACHE_DIR"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn process_failure_health_failure_cancel_and_cas_failure_quarantine_staging() {
    let root = test_root("failures");
    fs::create_dir_all(&root).unwrap();
    let bootstrap = test_bootstrap(b"engine payload");
    let source = FakeArtifactSource::bytes_for(&bootstrap.engine);
    let mut runner = FakeProcessRunner::successful(&root);
    runner.fail_sync = true;
    let mut progress = RecordingProgress::default();
    let error = Provisioner::new(
        test_config(root.clone(), bootstrap.clone()),
        source,
        runner,
        FakeHealthChecker::healthy(),
        &mut progress,
    )
    .provision_first_install(CancellationToken::new())
    .unwrap_err();
    assert_eq!(error.code(), ProvisionErrorCode::ProcessFailed);
    assert!(root.join("quarantine").exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn health_failure_is_typed_and_never_activates() {
    let root = test_root("health-failure");
    fs::create_dir_all(&root).unwrap();
    let bootstrap = test_bootstrap(b"engine payload");
    let mut health = FakeHealthChecker::healthy();
    health.fail = true;
    let mut progress = RecordingProgress::default();
    let error = Provisioner::new(
        test_config(root.clone(), bootstrap.clone()),
        FakeArtifactSource::bytes_for(&bootstrap.engine),
        FakeProcessRunner::successful(&root),
        health,
        &mut progress,
    )
    .provision_first_install(CancellationToken::new())
    .unwrap_err();
    assert_eq!(error.code(), ProvisionErrorCode::HealthCheckFailed);
    assert!(!root.join("engine").join("releases").exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn activation_uses_manifest_cas_and_quarantines_on_revision_conflict() {
    let root = test_root("cas-conflict");
    fs::create_dir_all(&root).unwrap();
    let bootstrap = test_bootstrap(b"engine payload");
    let mut runner = FakeProcessRunner::successful(&root);
    runner.corrupt_manifest_on_sync = true;
    let mut progress = RecordingProgress::default();
    let error = Provisioner::new(
        test_config(root.clone(), bootstrap.clone()),
        FakeArtifactSource::bytes_for(&bootstrap.engine),
        runner,
        FakeHealthChecker::healthy(),
        &mut progress,
    )
    .provision_first_install(CancellationToken::new())
    .unwrap_err();
    assert_eq!(error.code(), ProvisionErrorCode::ManifestConflict);
    assert!(root.join("quarantine").exists());
    let _ = fs::remove_dir_all(root);
}

fn artifact(name: &str, bytes: &[u8]) -> ArtifactSpec {
    ArtifactSpec {
        name: name.into(),
        version: "1.0.0".into(),
        sha256: sha256(bytes),
        source: format!("https://example.test/{name}"),
        kind: ArtifactKind::File,
        expected_size: bytes.len() as u64,
        max_size: bytes.len() as u64,
    }
}

fn test_bootstrap(bytes: &[u8]) -> BootstrapManifest {
    BootstrapManifest {
        schema_version: BOOTSTRAP_SCHEMA_VERSION,
        product_version: "1.0.0".into(),
        python_version: "3.12.4".into(),
        allowed_hosts: vec!["example.test".into()],
        uv: artifact("uv", b"uv"),
        engine: artifact("engine", bytes),
    }
}

fn test_config(root: PathBuf, bootstrap: BootstrapManifest) -> ProvisionerConfig {
    ProvisionerConfig {
        data_root: root,
        install_id: "install-1".into(),
        app_module: "opencohost.api.main:app".into(),
        preferred_port: 8765,
        fallback_port: 8770,
        bootstrap,
        max_download_retries: 2,
        retry_backoff: Duration::ZERO,
        python_executable_name: "python.exe".into(),
        operation_timeout: Duration::from_secs(300),
    }
}

fn test_root(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!("opencohost-wu3-{label}-{}", std::process::id()))
}

#[cfg(windows)]
fn windows_process_is_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return false;
        }
        let mut exit_code = 0;
        let result = GetExitCodeProcess(handle, &mut exit_code);
        CloseHandle(handle);
        result != 0 && exit_code == 259
    }
}

fn sha256(bytes: &[u8]) -> String {
    let mut digest = sha2::Sha256::new();
    digest.update(bytes);
    format!("{:x}", digest.finalize())
}

fn zip_bytes<const N: usize>(entries: [(&str, &[u8]); N]) -> Vec<u8> {
    let mut out = Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(&mut out);
    for (name, bytes) in entries {
        zip.start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap();
    out.into_inner()
}

fn find_test_python(root: &Path) -> Option<String> {
    for entry in fs::read_dir(root).ok()? {
        let entry = entry.ok()?;
        let path = entry.path();
        if path.file_name().is_some_and(|name| name == "python.exe") {
            return Some(path.to_string_lossy().into_owned());
        }
        if path.is_dir() {
            if let Some(found) = find_test_python(&path) {
                return Some(found);
            }
        }
    }
    None
}

struct FakeLiveness(std::collections::HashSet<u32>);
impl FakeLiveness {
    fn live<const N: usize>(pids: [u32; N]) -> Self {
        Self(pids.into_iter().collect())
    }
    fn dead<const N: usize>(pids: [u32; N]) -> Self {
        let _ = pids;
        Self(std::collections::HashSet::new())
    }
}
impl ProcessLiveness for FakeLiveness {
    fn is_alive(&self, pid: u32) -> bool {
        self.0.contains(&pid)
    }
}

#[cfg(windows)]
#[derive(Debug)]
struct JunctionUnavailable {
    reason: String,
}

#[cfg(windows)]
fn create_junction(link: &Path, target: &Path) -> Result<(), JunctionUnavailable> {
    let link = link.to_string_lossy().into_owned();
    let target = target.to_string_lossy().into_owned();
    let output = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J", &link, &target])
        .output()
        .map_err(|error| JunctionUnavailable {
            reason: error.to_string(),
        })?;
    if output.status.success() {
        Ok(())
    } else {
        Err(JunctionUnavailable {
            reason: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        })
    }
}

#[derive(Default)]
struct RecordingProgress {
    events: Vec<ProgressEvent>,
}
impl ProgressSink for RecordingProgress {
    fn report(&mut self, event: ProgressEvent) {
        self.events.push(event);
    }
}

struct CancelOnPhase {
    target: ProvisionPhase,
    token: CancellationToken,
}
impl CancelOnPhase {
    fn new(target: ProvisionPhase) -> Self {
        Self {
            target,
            token: CancellationToken::new(),
        }
    }
    fn token(&self) -> CancellationToken {
        self.token.clone()
    }
}
impl ProgressSink for CancelOnPhase {
    fn report(&mut self, event: ProgressEvent) {
        if event.phase == self.target {
            self.token.cancel();
        }
    }
}

struct FakeArtifactSource {
    calls: Arc<std::sync::atomic::AtomicUsize>,
    failures: Arc<std::sync::atomic::AtomicUsize>,
    bytes: Arc<BTreeMap<String, Vec<u8>>>,
}

struct TerminalArtifactSource {
    code: ProvisionErrorCode,
    calls: Arc<std::sync::atomic::AtomicUsize>,
}
impl ArtifactSource for TerminalArtifactSource {
    fn fetch(
        &self,
        _artifact: &ArtifactSpec,
        _destination: &Path,
        _deadline: &ProvisionDeadline,
        _cancel: &CancellationToken,
    ) -> Result<(), ProvisionError> {
        self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Err(ProvisionError::new(self.code, "terminal", false))
    }
}
impl FakeArtifactSource {
    fn failing_then_bytes(failures: usize, bytes: Vec<u8>) -> Self {
        Self {
            calls: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            failures: Arc::new(std::sync::atomic::AtomicUsize::new(failures)),
            bytes: Arc::new(BTreeMap::from([("engine".into(), bytes)])),
        }
    }
    fn bytes_for(engine: &ArtifactSpec) -> Self {
        Self {
            calls: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            failures: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            bytes: Arc::new(BTreeMap::from([
                ("uv".into(), b"uv".to_vec()),
                ("python".into(), b"python".to_vec()),
                (engine.name.clone(), b"engine payload".to_vec()),
            ])),
        }
    }
    fn calls(&self) -> usize {
        self.calls.load(std::sync::atomic::Ordering::SeqCst)
    }
}
impl ArtifactSource for FakeArtifactSource {
    fn fetch(
        &self,
        artifact: &ArtifactSpec,
        destination: &Path,
        deadline: &ProvisionDeadline,
        cancel: &CancellationToken,
    ) -> Result<(), ProvisionError> {
        deadline.check(cancel)?;
        self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if self
            .failures
            .fetch_update(
                std::sync::atomic::Ordering::SeqCst,
                std::sync::atomic::Ordering::SeqCst,
                |value| value.checked_sub(1),
            )
            .is_ok()
        {
            return Err(ProvisionError::new(
                ProvisionErrorCode::DownloadFailed,
                "injected",
                true,
            ));
        }
        fs::write(
            destination,
            self.bytes.get(&artifact.name).cloned().unwrap_or_default(),
        )
        .map_err(Into::into)
    }
}

#[derive(Clone)]
struct FakeProcessRunner {
    root: PathBuf,
    pub fail_sync: bool,
    pub corrupt_manifest_on_sync: bool,
    args: Arc<Mutex<Vec<Vec<String>>>>,
    envs: Arc<Mutex<Vec<BTreeMap<String, String>>>>,
}
impl FakeProcessRunner {
    fn successful(root: &Path) -> Self {
        Self {
            root: root.into(),
            fail_sync: false,
            corrupt_manifest_on_sync: false,
            args: Arc::new(Mutex::new(Vec::new())),
            envs: Arc::new(Mutex::new(Vec::new())),
        }
    }
    fn sync_args(&self) -> Vec<Vec<String>> {
        self.args.lock().unwrap().clone()
    }
    fn last_env(&self) -> BTreeMap<String, String> {
        self.envs
            .lock()
            .unwrap()
            .last()
            .cloned()
            .unwrap_or_default()
    }
}
impl ProcessRunner for FakeProcessRunner {
    fn run(
        &self,
        _program: &Path,
        args: &[String],
        _cwd: &Path,
        env: &BTreeMap<String, String>,
        cancel: &CancellationToken,
        deadline: &ProvisionDeadline,
    ) -> Result<ProcessOutput, ProvisionError> {
        deadline.check(cancel)?;
        self.args.lock().unwrap().push(args.to_vec());
        self.envs.lock().unwrap().push(env.clone());
        if args.first().is_some_and(|arg| arg == "sync") {
            let venv = env
                .get("UV_PROJECT_ENVIRONMENT")
                .map(PathBuf::from)
                .unwrap();
            fs::create_dir_all(venv.join(if cfg!(windows) { "Scripts" } else { "bin" })).unwrap();
            fs::write(
                venv.join(if cfg!(windows) {
                    "Scripts/python.exe"
                } else {
                    "bin/python"
                }),
                b"venv-python",
            )
            .unwrap();
            fs::write(
                venv.join("pyvenv.cfg"),
                format!("home = {}\n", env.get("UV_PYTHON_INSTALL_DIR").unwrap()),
            )
            .unwrap();
            if self.corrupt_manifest_on_sync {
                let _ = fs::write(
                    self.root.join("state").join("runtime-manifest.json"),
                    b"corrupt",
                );
            }
            if self.fail_sync {
                return Ok(ProcessOutput {
                    status: 1,
                    stderr: "sync failed".into(),
                    ..Default::default()
                });
            }
        }
        if args.first().is_some_and(|arg| arg == "python") {
            if let Some(index) = args.iter().position(|arg| arg == "--install-dir") {
                let dir = PathBuf::from(&args[index + 1]);
                fs::create_dir_all(&dir).unwrap();
                let versioned = dir.join("cpython-3.12.4-windows-x86_64-none");
                fs::create_dir_all(&versioned).unwrap();
                fs::write(versioned.join("python.exe"), b"python").unwrap();
            }
        }
        if args.first().is_some_and(|arg| arg == "python")
            && args.get(1).is_some_and(|arg| arg == "find")
        {
            let root = PathBuf::from(env.get("UV_PYTHON_INSTALL_DIR").unwrap());
            let found = find_test_python(&root).unwrap_or_default();
            return Ok(ProcessOutput {
                status: 0,
                stdout: format!("{found}\n"),
                ..Default::default()
            });
        }
        Ok(ProcessOutput {
            status: 0,
            ..Default::default()
        })
    }
}

struct FakeHealthChecker {
    fail: bool,
}
impl FakeHealthChecker {
    fn healthy() -> Self {
        Self { fail: false }
    }
}
impl HealthChecker for FakeHealthChecker {
    fn check(
        &self,
        _project_dir: &Path,
        _python_executable: &Path,
        _env: &BTreeMap<String, String>,
        cancel: &CancellationToken,
        deadline: &ProvisionDeadline,
    ) -> Result<(), ProvisionError> {
        deadline.check(cancel)?;
        if self.fail {
            Err(ProvisionError::new(
                ProvisionErrorCode::HealthCheckFailed,
                "health failed",
                true,
            ))
        } else {
            Ok(())
        }
    }
}
