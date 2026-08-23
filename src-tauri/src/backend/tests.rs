use super::*;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[test]
fn missing_installed_runtime_becomes_degraded_backend_state() {
    let outcome = supervisor::degraded_outcome("runtime_not_ready: run Provision or Repair", 8765);
    assert!(!outcome.info.managed);
    assert_eq!(outcome.info.base_url, "http://127.0.0.1:8765");
    assert_eq!(
        outcome.info.error.as_ref().map(|error| error.code.as_str()),
        Some("runtime_not_ready")
    );
    assert!(outcome.child.is_none());
    assert!(outcome.job.is_none());
}

#[test]
fn backend_info_serializes_only_closed_diagnostic_fields() {
    let outcome = supervisor::degraded_outcome(
        "SECRET_CANARY C:\\Users\\alice\\AppData\\Local\\backend.log --token=hidden",
        8765,
    );
    let serialized = serde_json::to_string(&outcome.info).unwrap();
    assert!(!serialized.contains("SECRET_CANARY"));
    assert!(!serialized.contains("alice"));
    assert!(!serialized.contains("hidden"));
    assert!(serialized.contains("backend_launch_failed"));
}

#[test]
fn parses_full_config_json() {
    let json = r#"{
        "python_path": "C:\\Python\\python.exe",
        "working_dir": "C:\\App",
        "app_module": "custom.module:app",
        "port": 9000,
        "fallback_port": 9001,
        "spawn": false,
        "log_file": "C:\\App\\log.txt"
    }"#;

    let config = BackendConfig::from_json(json).expect("valid config JSON must parse");

    assert_eq!(config.python_path, "C:\\Python\\python.exe");
    assert_eq!(config.working_dir, "C:\\App");
    assert_eq!(config.app_module, "custom.module:app");
    assert_eq!(config.port, 9000);
    assert_eq!(config.fallback_port, 9001);
    assert!(!config.spawn);
    assert_eq!(config.log_file, Some("C:\\App\\log.txt".to_string()));
}

#[test]
fn applies_defaults_for_omitted_optional_fields() {
    let json = r#"{
        "python_path": "C:\\Python\\python.exe",
        "working_dir": "C:\\App"
    }"#;

    let config = BackendConfig::from_json(json).expect("minimal config JSON must still parse");

    assert_eq!(config.app_module, "opencohost.api.main:app");
    assert_eq!(config.port, 8765);
    assert_eq!(config.fallback_port, 8770);
    assert!(config.spawn);
    assert_eq!(config.log_file, None);
}

#[test]
fn rejects_json_missing_required_fields() {
    let json = r#"{ "port": 8765 }"#;

    let result = BackendConfig::from_json(json);

    assert!(
        result.is_err(),
        "python_path/working_dir have no #[serde(default)], must fail to parse without them"
    );
}

#[test]
fn compiled_in_dev_default_config_is_valid_and_matches_shipped_values() {
    let config = BackendConfig::from_json(config::DEV_DEFAULT_CONFIG_JSON).expect(
        "src-tauri/backend.config.default.json must be valid JSON matching BackendConfig's shape",
    );

    assert_eq!(config.python_path, "python");
    assert_eq!(config.working_dir, "..");
    assert_eq!(config.app_module, "opencohost.api.main:app");
    assert_eq!(config.port, 8765);
    assert_eq!(config.fallback_port, 8770);
    assert!(config.spawn);
    assert_eq!(config.log_file, None);
}

#[cfg(debug_assertions)]
#[test]
fn dev_source_config_path_anchors_to_this_crate_root() {
    let path = Path::new(config::DEV_SOURCE_CONFIG_PATH);
    assert_eq!(
        path.file_name().and_then(|n| n.to_str()),
        Some("backend.config.json")
    );

    let crate_dir = path
        .parent()
        .expect("the constant must have a parent directory");
    assert!(
        crate_dir.join("Cargo.toml").is_file(),
        "expected the src-tauri crate root at {crate_dir:?}"
    );
    assert!(
        crate_dir.join("backend.config.default.json").is_file(),
        "the portable default must sit beside the developer config path at {crate_dir:?}"
    );
}

fn make_repo_root_marker(root: &Path) {
    fs::create_dir_all(root.join("opencohost"))
        .expect("test setup: mkdir opencohost/ must succeed");
    fs::write(
        root.join("pyproject.toml"),
        "[project]\nname = \"opencohost\"\n",
    )
    .expect("test setup: write pyproject.toml must succeed");
}

#[test]
fn find_repo_root_locates_marker_several_levels_up() {
    let root = env::temp_dir().join("opencohost-test-repo-root-depth");
    let _ = fs::remove_dir_all(&root);
    make_repo_root_marker(&root);
    let start = root
        .join("OpenCohost_UI")
        .join("src-tauri")
        .join("target")
        .join("debug");
    fs::create_dir_all(&start).expect("test setup: mkdir nested start dir must succeed");

    assert_eq!(config::find_repo_root(&start), Some(root.clone()));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn find_repo_root_returns_none_when_no_marker_exists_up_the_chain() {
    let base = env::temp_dir().join("opencohost-test-repo-root-missing");
    let _ = fs::remove_dir_all(&base);
    let start = base.join("a").join("b");
    fs::create_dir_all(&start).expect("test setup: mkdir must succeed");

    assert_eq!(config::find_repo_root(&start), None);

    let _ = fs::remove_dir_all(&base);
}

#[test]
fn resolved_working_dir_returns_absolute_input_verbatim_without_walking() {
    let json = r#"{
        "python_path": "python",
        "working_dir": "C:\\Some\\Absolute\\Path"
    }"#;
    let config = BackendConfig::from_json(json).expect("valid config JSON must parse");

    assert_eq!(
        config.resolved_working_dir(),
        PathBuf::from("C:\\Some\\Absolute\\Path")
    );
}

fn shell_only_install_facts(log_tail: Option<&str>) -> diagnostics::SpawnFailureFacts<'_> {
    diagnostics::SpawnFailureFacts {
        port: 8765,
        status: "exit code: 1",
        python_path: "python",
        working_dir: Path::new("C:\\Users\\bob\\OpenCohost\\.."),
        engine_root_found: false,
        log_path: Path::new("C:\\Users\\bob\\AppData\\Local\\Temp\\opencohost-backend.log"),
        log_tail,
    }
}

#[test]
fn describe_spawn_failure_names_the_missing_engine() {
    let tail = "  File \"<frozen importlib._bootstrap>\", line 1324, in _find_and_load_unlocked\nModuleNotFoundError: No module named 'opencohost'\n";

    let message = diagnostics::describe_spawn_failure(&shell_only_install_facts(Some(tail)));

    assert!(
        message.contains("engine is not installed"),
        "got: {message}"
    );
    assert!(
        message.contains("backend.config.json"),
        "must name the file to fix: {message}"
    );
    assert!(message.contains("Interpreter: 'python'"), "got: {message}");
    assert!(
        message.contains("C:\\Users\\bob\\OpenCohost\\.."),
        "got: {message}"
    );
    assert!(
        !message.contains("importlib"),
        "the traceback body must not leak into the UI: {message}"
    );
}

#[test]
fn describe_spawn_failure_points_at_the_api_extra_for_both_uvicorn_spellings() {
    for tail in [
        "C:\\Python313\\python.exe: No module named uvicorn\n",
        "ModuleNotFoundError: No module named 'uvicorn'\n",
    ] {
        let message = diagnostics::describe_spawn_failure(&shell_only_install_facts(Some(tail)));

        assert!(message.contains("uvicorn is missing"), "got: {message}");
        assert!(message.contains("\"api\" extra"), "got: {message}");
    }
}

#[test]
fn describe_spawn_failure_does_not_treat_a_missing_submodule_as_a_missing_engine() {
    let tail = "ModuleNotFoundError: No module named 'opencohost.api'\n";

    let message = diagnostics::describe_spawn_failure(&shell_only_install_facts(Some(tail)));

    assert!(
        !message.contains("engine is not installed"),
        "got: {message}"
    );
    assert!(
        message.contains("No module named 'opencohost.api'"),
        "got: {message}"
    );
}

#[test]
fn describe_spawn_failure_keeps_the_generic_message_and_adds_the_last_log_line() {
    let tail = "INFO: starting\nOSError: [Errno 98] Address already in use\n\n";

    let message = diagnostics::describe_spawn_failure(&shell_only_install_facts(Some(tail)));

    assert!(
        message.contains("exited immediately after spawn (exit code: 1)"),
        "got: {message}"
    );
    assert!(
        message.contains("Last log line: OSError: [Errno 98] Address already in use"),
        "trailing blank lines must be skipped: {message}"
    );
    assert!(message.contains("Interpreter: 'python'"), "got: {message}");
    assert!(
        message.contains("C:\\Users\\bob\\AppData\\Local\\Temp\\opencohost-backend.log"),
        "got: {message}"
    );
}

#[test]
fn describe_spawn_failure_still_reports_the_facts_with_no_log_at_all() {
    let message = diagnostics::describe_spawn_failure(&shell_only_install_facts(None));

    assert!(
        message.contains("Last log line: (no log output)"),
        "got: {message}"
    );
    assert!(message.contains("Interpreter: 'python'"), "got: {message}");
    assert!(
        message.contains("C:\\Users\\bob\\OpenCohost\\.."),
        "got: {message}"
    );
}

#[test]
fn describe_spawn_failure_surfaces_a_missing_engine_root_in_every_branch() {
    for tail in [
        Some("ModuleNotFoundError: No module named 'opencohost'\n"),
        Some("ModuleNotFoundError: No module named 'uvicorn'\n"),
        Some("RuntimeError: something else entirely\n"),
        None,
    ] {
        let message = diagnostics::describe_spawn_failure(&shell_only_install_facts(tail));
        assert!(message.contains("No engine folder"), "got: {message}");
    }
}

#[test]
fn describe_spawn_failure_omits_the_root_note_when_the_engine_root_was_found() {
    let mut facts =
        shell_only_install_facts(Some("ModuleNotFoundError: No module named 'opencohost'\n"));
    facts.engine_root_found = true;
    facts.working_dir = Path::new("C:\\Users\\bob\\OpenCohost");

    let message = diagnostics::describe_spawn_failure(&facts);

    assert!(!message.contains("No engine folder"), "got: {message}");
    assert!(
        message.contains("engine is not installed"),
        "got: {message}"
    );
}

#[test]
fn read_log_tail_returns_none_for_a_missing_log() {
    let missing = env::temp_dir().join("opencohost-test-missing-backend-log.log");
    let _ = fs::remove_file(&missing);
    assert_eq!(diagnostics::read_log_tail(&missing), None);
}

#[test]
fn read_log_tail_returns_none_for_an_empty_log() {
    let empty = env::temp_dir().join("opencohost-test-empty-backend-log.log");
    fs::write(&empty, "").expect("test setup: write must succeed");
    assert_eq!(diagnostics::read_log_tail(&empty), None);
    let _ = fs::remove_file(&empty);
}

#[test]
fn read_log_tail_reads_only_the_last_few_kb_of_a_large_log() {
    let path = env::temp_dir().join("opencohost-test-large-backend-log.log");
    let filler = "x".repeat(diagnostics::LOG_TAIL_BYTES as usize * 2);
    fs::write(&path, format!("HEAD-MARKER\n{filler}\nTAIL-MARKER"))
        .expect("test setup: write must succeed");

    let tail = diagnostics::read_log_tail(&path).expect("a non-empty log must produce a tail");

    assert!(
        tail.len() as u64 <= diagnostics::LOG_TAIL_BYTES,
        "read must stay bounded, got {} bytes",
        tail.len()
    );
    assert!(
        tail.contains("TAIL-MARKER"),
        "the tail is the part that matters"
    );
    assert!(
        !tail.contains("HEAD-MARKER"),
        "the head must not be read back"
    );
    let _ = fs::remove_file(&path);
}

#[test]
fn healthy_primary_always_reuses_primary_regardless_of_spawn_flag() {
    assert_eq!(
        health::decide_action(health::HealthProbe::Healthy, None, true),
        health::ResolveAction::ReuseHealthy(health::PortChoice::Primary)
    );
    assert_eq!(
        health::decide_action(health::HealthProbe::Healthy, None, false),
        health::ResolveAction::ReuseHealthy(health::PortChoice::Primary)
    );
}

#[test]
fn not_listening_primary_spawns_on_primary_when_spawn_enabled() {
    assert_eq!(
        health::decide_action(health::HealthProbe::NotListening, None, true),
        health::ResolveAction::Spawn(health::PortChoice::Primary)
    );
}

#[test]
fn not_listening_primary_is_unmanaged_when_spawn_disabled() {
    assert_eq!(
        health::decide_action(health::HealthProbe::NotListening, None, false),
        health::ResolveAction::Unmanaged
    );
}

#[test]
fn listening_not_healthy_primary_is_unmanaged_when_spawn_disabled() {
    assert_eq!(
        health::decide_action(health::HealthProbe::ListeningNotHealthy, None, false),
        health::ResolveAction::Unmanaged
    );
}

#[test]
fn listening_not_healthy_primary_reuses_healthy_fallback() {
    assert_eq!(
        health::decide_action(
            health::HealthProbe::ListeningNotHealthy,
            Some(health::HealthProbe::Healthy),
            true
        ),
        health::ResolveAction::ReuseHealthy(health::PortChoice::Fallback)
    );
}

#[test]
fn listening_not_healthy_primary_spawns_on_not_listening_fallback() {
    assert_eq!(
        health::decide_action(
            health::HealthProbe::ListeningNotHealthy,
            Some(health::HealthProbe::NotListening),
            true
        ),
        health::ResolveAction::Spawn(health::PortChoice::Fallback)
    );
}

#[test]
fn both_ports_listening_not_healthy_refuses_to_spawn_anywhere() {
    assert_eq!(
        health::decide_action(
            health::HealthProbe::ListeningNotHealthy,
            Some(health::HealthProbe::ListeningNotHealthy),
            true
        ),
        health::ResolveAction::BothBusy
    );
}

#[test]
fn missing_fallback_probe_with_unhealthy_primary_treated_as_not_listening() {
    assert_eq!(
        health::decide_action(health::HealthProbe::ListeningNotHealthy, None, true),
        health::ResolveAction::Spawn(health::PortChoice::Fallback)
    );
}

#[test]
fn token_file_path_uses_appdata_when_set() {
    let path = token::token_file_path(Some("C:\\Users\\bob\\AppData\\Roaming"), None);
    assert_eq!(
        path,
        Path::new("C:\\Users\\bob\\AppData\\Roaming")
            .join("OpenCohost")
            .join("config")
            .join("api_tokens.json")
    );
}

#[test]
fn token_file_path_falls_back_to_userprofile_when_appdata_missing() {
    let path = token::token_file_path(None, Some("C:\\Users\\bob"));
    assert_eq!(
        path,
        Path::new("C:\\Users\\bob")
            .join("AppData")
            .join("Roaming")
            .join("OpenCohost")
            .join("config")
            .join("api_tokens.json")
    );
}

#[test]
fn parse_operator_token_extracts_operator_field_only() {
    let json = r#"{"version": 1, "operator": "op-secret", "agent": "agent-secret"}"#;
    assert_eq!(
        token::parse_operator_token(json),
        Some("op-secret".to_string())
    );
}

#[test]
fn parse_operator_token_none_on_malformed_json() {
    assert_eq!(token::parse_operator_token("not json"), None);
}

#[test]
fn parse_operator_token_none_when_operator_field_missing() {
    assert_eq!(
        token::parse_operator_token(r#"{"agent": "only-agent"}"#),
        None
    );
}

#[test]
fn read_operator_token_none_on_missing_file() {
    let missing = env::temp_dir().join("opencohost-test-missing-token-file.json");
    let _ = fs::remove_file(&missing);
    assert_eq!(token::read_operator_token(&missing), None);
}

#[test]
fn read_operator_token_with_retry_picks_up_a_file_written_after_a_short_delay() {
    let path = env::temp_dir().join("opencohost-test-retry-token-file.json");
    let _ = fs::remove_file(&path);
    let write_path = path.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(5));
        fs::write(
            &write_path,
            r#"{"version": 1, "operator": "late-token", "agent": "x"}"#,
        )
        .expect("test setup: write must succeed");
    });

    let token = token::read_operator_token_with_retry(
        std::slice::from_ref(&path),
        10,
        Duration::from_millis(5),
    );

    assert_eq!(token, Some("late-token".to_string()));
    let _ = fs::remove_file(&path);
}

#[test]
fn read_operator_token_with_retry_gives_up_after_exhausting_attempts() {
    let missing = env::temp_dir().join("opencohost-test-never-appears-token-file.json");
    let _ = fs::remove_file(&missing);
    assert_eq!(
        token::read_operator_token_with_retry(&[missing], 2, Duration::from_millis(2)),
        None
    );
}

#[test]
fn dev_token_file_path_joins_working_dir_config_api_tokens_json() {
    let path = token::dev_token_file_path("C:\\App");
    assert_eq!(
        path,
        Path::new("C:\\App").join("config").join("api_tokens.json")
    );
}

#[test]
fn resolve_token_file_candidates_checks_working_dir_before_appdata() {
    let candidates = token::resolve_token_file_candidates("C:\\App");
    assert_eq!(candidates.len(), 2);
    assert_eq!(
        candidates[0],
        Path::new("C:\\App").join("config").join("api_tokens.json")
    );
    assert!(candidates[1].ends_with(
        Path::new("OpenCohost")
            .join("config")
            .join("api_tokens.json")
    ));
}

#[test]
fn read_operator_token_with_retry_finds_token_at_a_later_candidate_when_an_earlier_one_is_missing()
{
    let missing = env::temp_dir().join("opencohost-test-multi-candidate-missing.json");
    let present = env::temp_dir().join("opencohost-test-multi-candidate-present.json");
    let _ = fs::remove_file(&missing);
    fs::write(
        &present,
        r#"{"version": 1, "operator": "dev-mode-token", "agent": "x"}"#,
    )
    .expect("test setup: write must succeed");

    let token = token::read_operator_token_with_retry(
        &[missing, present.clone()],
        1,
        Duration::from_millis(1),
    );

    assert_eq!(token, Some("dev-mode-token".to_string()));
    let _ = fs::remove_file(&present);
}
