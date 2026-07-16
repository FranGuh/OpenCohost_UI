//! Managed Python backend lifecycle (WU-E): resolves whether a real
//! `opencohost.api.main:app` (uvicorn, --workers 1) is already reachable,
//! spawns one if not, and exposes the resolved base URL to the frontend via
//! the `backend_info` command. No shell plugin, no sidecar binary — direct
//! `std::process::Command`, mirroring `run-api.bat` exactly.

use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Manager;

fn default_app_module() -> String {
    "opencohost.api.main:app".to_string()
}

fn default_port() -> u16 {
    8765
}

fn default_fallback_port() -> u16 {
    8770
}

fn default_spawn() -> bool {
    true
}

/// Resolved from JSON — see `BackendConfig::load` for the file resolution
/// order. Missing optional fields fall back to the `run-api.bat` defaults.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BackendConfig {
    pub python_path: String,
    pub working_dir: String,
    #[serde(default = "default_app_module")]
    pub app_module: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_fallback_port")]
    pub fallback_port: u16,
    #[serde(default = "default_spawn")]
    pub spawn: bool,
    #[serde(default)]
    pub log_file: Option<String>,
}

/// Compiled-in dev-mode fallback — this crate's own `backend.config.json`,
/// baked in at compile time via `include_str!` so a dev build always has a
/// working config even with no external file present.
const DEV_DEFAULT_CONFIG_JSON: &str = include_str!("../backend.config.json");

impl BackendConfig {
    pub fn from_json(contents: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(contents)
    }

    /// Resolution order:
    /// (a) `OPENCOHOST_BACKEND_CONFIG` env var — path to a JSON file.
    /// (b) `backend.config.json` next to the running exe (or, for a bundled
    ///     NSIS install, inside its `resources/` subfolder — Tauri's
    ///     bundle.resources may land there instead of directly beside the
    ///     exe depending on the target).
    /// (c) the compiled-in dev default (this crate's own backend.config.json).
    pub fn load() -> Self {
        if let Ok(path) = env::var("OPENCOHOST_BACKEND_CONFIG") {
            match Self::load_from_path(Path::new(&path)) {
                Some(cfg) => return cfg,
                None => {
                    eprintln!(
                        "backend.rs: OPENCOHOST_BACKEND_CONFIG={path} could not be read/parsed, trying next candidate"
                    );
                }
            }
        }

        if let Ok(exe_path) = env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                for candidate in [
                    exe_dir.join("backend.config.json"),
                    exe_dir.join("resources").join("backend.config.json"),
                ] {
                    if let Some(cfg) = Self::load_from_path(&candidate) {
                        return cfg;
                    }
                }
            }
        }

        Self::from_json(DEV_DEFAULT_CONFIG_JSON)
            .expect("backend.rs: compiled-in backend.config.json must be valid JSON")
    }

    fn load_from_path(path: &Path) -> Option<Self> {
        let contents = fs::read_to_string(path).ok()?;
        match Self::from_json(&contents) {
            Ok(cfg) => Some(cfg),
            Err(err) => {
                eprintln!("backend.rs: failed to parse {path:?}: {err}");
                None
            }
        }
    }
}

/// Response of the `backend_info` command — mirrors
/// `src/lib/backendBootstrap.ts::BackendInfo` on the frontend. Kept in sync
/// manually, same pattern as the hand-typed API response shapes.
#[derive(Debug, Clone, Serialize)]
pub struct BackendInfo {
    pub base_url: String,
    pub managed: bool,
    /// Populated on every degraded resolution path (spawn IO error, child
    /// exited immediately after spawn, both primary and fallback ports
    /// busy with unhealthy processes) so the frontend can surface the
    /// concrete failure instead of a generic "not reachable" message.
    /// `None` on the healthy/managed-success paths.
    pub error: Option<String>,
}

/// Tauri-managed state: the resolved `BackendInfo` (immutable after
/// `setup_backend`) plus the spawned child (if any), so `shutdown_backend`
/// can kill it on app exit.
pub struct BackendState {
    pub info: BackendInfo,
    pub child: Mutex<Option<Child>>,
    /// Windows Job Object holding the spawned child (if any) with
    /// kill-on-close semantics — see `job_object` module below. Always
    /// `None` on non-Windows targets. Must stay alive for the app's
    /// lifetime: dropping/closing it early would kill the managed backend
    /// prematurely, and keeping it open is exactly what guarantees the
    /// backend gets killed by the OS if this process dies without running
    /// `shutdown_backend`.
    pub job: Mutex<Option<job_object::JobObject>>,
    /// The global F10 push-to-talk bridge child (`ptt_f10_bridge.py`), if it
    /// was spawned — killed in `shutdown_backend` regardless of `info.managed`
    /// (the bridge is always ours, even when the backend was a reused one).
    pub ptt_child: Mutex<Option<Child>>,
    /// The bridge's own Job Object — only `Some` when the backend was reused
    /// and so had no job of ours to share; otherwise the bridge is a member of
    /// `job` above. Held for the app's lifetime for the same crash-orphan
    /// guarantee as `job`.
    pub ptt_job: Mutex<Option<job_object::JobObject>>,
}

#[tauri::command]
pub fn backend_info(state: tauri::State<BackendState>) -> BackendInfo {
    state.info.clone()
}

/// Operator token handoff (agent_context_gateway Phase 4, design ADR-5): the
/// bearer token minted by the Python backend
/// (`opencohost/api/auth.py::ensure_tokens`) is read here and handed to the
/// frontend via `api_token` — deliberately never added to `BackendInfo`
/// above, which is surfaced/logged on error paths. Two candidate paths are
/// probed (`resolve_token_file_candidates`): `%APPDATA%\OpenCohost\config\
/// api_tokens.json` only applies when the Python backend runs frozen
/// (`opencohost/config/storage.py::get_user_data_dir`'s win32 branch); the
/// Tauri shell today always spawns `python -m uvicorn` from source
/// (`spawn_backend` below, `config.working_dir`), which is never frozen, so
/// the token is actually minted at `<working_dir>\config\api_tokens.json` —
/// that candidate is checked first.
/// Shape of the minted token file. Only `operator` is read — the `agent`
/// token is deliberately never exposed to the Tauri frontend (ADR-3: it's
/// the one secret handed to external tools).
#[derive(Debug, Deserialize)]
struct ApiTokens {
    operator: String,
}

/// Mirrors `opencohost/config/storage.py::get_user_data_dir` win32 branch
/// (storage.py:32-33): `%APPDATA%\OpenCohost`, falling back to
/// `<home>\AppData\Roaming` (via `USERPROFILE`) when `APPDATA` isn't set —
/// same fallback Python's `Path.home()` resolves to on Windows. Pure
/// function (env values passed in) so it's testable without touching the
/// real environment.
fn token_file_path(appdata: Option<&str>, userprofile: Option<&str>) -> PathBuf {
    let base = appdata
        .map(PathBuf::from)
        .or_else(|| userprofile.map(|home| Path::new(home).join("AppData").join("Roaming")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("OpenCohost").join("config").join("api_tokens.json")
}

fn resolve_token_file_path() -> PathBuf {
    token_file_path(env::var("APPDATA").ok().as_deref(), env::var("USERPROFILE").ok().as_deref())
}

/// Non-frozen / source-run token path: `opencohost/config/storage.py::get_user_data_dir`
/// only returns `%APPDATA%\OpenCohost` when `sys.frozen`; the Tauri shell
/// spawns the backend via plain `python -m uvicorn` from `config.working_dir`
/// (`spawn_backend` below), never frozen, so `USER_DATA_DIR` — and therefore
/// `settings.API_TOKENS_FILE` — resolves to `<working_dir>\config\api_tokens.json`
/// in every current deployment.
fn dev_token_file_path(working_dir: &str) -> PathBuf {
    Path::new(working_dir).join("config").join("api_tokens.json")
}

/// Both plausible token file locations, in probe order: the source-run
/// (`working_dir`) candidate first — the one actually used today — then the
/// `%APPDATA%` candidate as the frozen-build fallback.
fn resolve_token_file_candidates(working_dir: &str) -> Vec<PathBuf> {
    vec![dev_token_file_path(working_dir), resolve_token_file_path()]
}

/// Parses the operator token out of the minted token file's JSON contents.
/// `None` on any malformed/missing-field JSON — mirrors `auth.py::load_tokens`
/// treating a bad file as unusable rather than panicking.
fn parse_operator_token(contents: &str) -> Option<String> {
    serde_json::from_str::<ApiTokens>(contents).ok().map(|tokens| tokens.operator)
}

fn read_operator_token(path: &Path) -> Option<String> {
    let contents = fs::read_to_string(path).ok()?;
    parse_operator_token(&contents)
}

const TOKEN_READ_ATTEMPTS: u32 = 5;
const TOKEN_READ_RETRY_DELAY: Duration = Duration::from_millis(300);

/// Retries the read a few times across every candidate path — the token
/// file is minted at the very start of the Python backend's lifespan
/// startup (`main.py::lifespan`, `ensure_tokens()` called before the engine
/// host loads), but `spawn_and_verify` above only confirms the spawned
/// process is alive (`try_wait`), not that lifespan startup has actually
/// reached that point yet (design risk: "Token file appears AFTER Tauri
/// probes"). ~1.5s total budget covers realistic cold-start import overhead.
/// All candidates are tried on every attempt (not one candidate exhausted
/// before the next) so a late-appearing file at any candidate is picked up
/// without waiting out a full retry budget on a candidate that will never
/// exist.
/// `# ponytail: fixed retry count, revisit only if a slow machine proves
/// this insufficient in practice.`
fn read_operator_token_with_retry(paths: &[PathBuf], attempts: u32, delay: Duration) -> Option<String> {
    for attempt in 0..attempts.max(1) {
        for path in paths {
            if let Some(token) = read_operator_token(path) {
                return Some(token);
            }
        }
        if attempt + 1 < attempts {
            std::thread::sleep(delay);
        }
    }
    None
}

/// Returns the operator bearer token for the frontend to attach as
/// `Authorization: Bearer <token>`, or `None` if the token file hasn't
/// appeared yet or can't be parsed. `None` is not an error: per owner
/// decision D2, every mutating call must keep working with no token
/// attached at all while enforcement stays off — the frontend degrades to
/// "no header" exactly like it does today.
///
/// `async` (Tauri v2 runs non-async commands on the main thread): the retry
/// loop above can sleep up to `TOKEN_READ_ATTEMPTS * TOKEN_READ_RETRY_DELAY`
/// (~1.2s) when the file hasn't appeared yet, and this is awaited before
/// first paint (`main.tsx` -> `backendBootstrap.ts::bootstrapApiToken`) —
/// marking it async moves that wait off the main/UI thread.
#[tauri::command(async)]
pub fn api_token() -> Option<String> {
    let config = BackendConfig::load();
    let candidates = resolve_token_file_candidates(&config.working_dir);
    read_operator_token_with_retry(&candidates, TOKEN_READ_ATTEMPTS, TOKEN_READ_RETRY_DELAY)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HealthProbe {
    /// GET /api/health returned 200 with a body containing the
    /// `engine_alive` marker field — a real OpenCohost backend is up.
    Healthy,
    /// TCP connect succeeded but the response wasn't a 200-with-marker (or
    /// wasn't a well-formed HTTP response at all) — something else owns
    /// that port.
    ListeningNotHealthy,
    /// TCP connect itself failed — nothing is listening on that port.
    NotListening,
}

/// Minimal blocking HTTP/1.1 GET over a raw TcpStream — deliberately not
/// pulling in a request crate (ureq/reqwest) for a single liveness probe.
fn probe_health(port: u16, timeout: Duration) -> HealthProbe {
    let addr: SocketAddr = match format!("127.0.0.1:{port}").parse() {
        Ok(addr) => addr,
        Err(_) => return HealthProbe::NotListening,
    };

    let mut stream = match TcpStream::connect_timeout(&addr, timeout) {
        Ok(stream) => stream,
        Err(_) => return HealthProbe::NotListening,
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let request = b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(request).is_err() {
        return HealthProbe::ListeningNotHealthy;
    }

    let mut buf = Vec::new();
    // A short-timeout read may legitimately return Err (WouldBlock/TimedOut)
    // after the server already closed the connection and flushed its
    // response — whatever was read up to that point is still in `buf`, so
    // only bail out empty-handed if nothing at all came back.
    let _ = stream.read_to_end(&mut buf);
    if buf.is_empty() {
        return HealthProbe::ListeningNotHealthy;
    }

    let response = String::from_utf8_lossy(&buf);
    let status_line = response.lines().next().unwrap_or("");
    let is_200 = status_line.split_whitespace().nth(1) == Some("200");
    // The real `GET /api/health` (opencohost/api/main.py::get_health) returns
    // a JSON body with an `engine_alive` field. A bare 200 isn't enough to
    // trust the port — some unrelated local service could also answer 200 —
    // so require the marker substring in the body too.
    if is_200 && response.contains("engine_alive") {
        HealthProbe::Healthy
    } else {
        HealthProbe::ListeningNotHealthy
    }
}

fn resolve_log_path(config: &BackendConfig) -> PathBuf {
    if let Some(path) = &config.log_file {
        return PathBuf::from(path);
    }
    // Default moved off exe_dir (WU-E M3): a per-machine install directory
    // may be read-only for the running user (e.g. Program Files without
    // elevation), which would abort spawning entirely just because logging
    // couldn't be set up. The OS temp dir is always writable by the current
    // user.
    env::temp_dir().join("opencohost-backend.log")
}

/// Opens `log_path` (truncating) as the stdout+stderr targets for a spawned
/// child. A log failure (create or clone) must never abort a spawn — logging
/// is a nice-to-have, the process itself is not — so any IO error falls back
/// to `Stdio::null()` for both streams. Shared by `spawn_backend` and
/// `spawn_ptt_bridge_process`.
fn log_stdio(log_path: &Path) -> (Stdio, Stdio) {
    match fs::File::create(log_path) {
        Ok(log_out) => match log_out.try_clone() {
            Ok(log_err) => (Stdio::from(log_out), Stdio::from(log_err)),
            Err(err) => {
                eprintln!(
                    "backend.rs: failed to clone log file handle for {log_path:?}: {err} — falling back to Stdio::null()"
                );
                (Stdio::null(), Stdio::null())
            }
        },
        Err(err) => {
            eprintln!(
                "backend.rs: failed to create log file {log_path:?}: {err} — falling back to Stdio::null()"
            );
            (Stdio::null(), Stdio::null())
        }
    }
}

/// Spawns `python -m uvicorn {app_module} --host 127.0.0.1 --port {port}
/// --workers 1` exactly like run-api.bat, with PYTHONPATH=working_dir,
/// stdout/stderr truncated into the log file, and no inherited console
/// window on Windows.
fn spawn_backend(config: &BackendConfig, port: u16) -> std::io::Result<Child> {
    let log_path = resolve_log_path(config);
    let (stdout, stderr) = log_stdio(&log_path);

    let mut command = Command::new(&config.python_path);
    command
        .arg("-m")
        .arg("uvicorn")
        .arg(&config.app_module)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--workers")
        .arg("1")
        .env("PYTHONPATH", &config.working_dir)
        .env("PYTHONUNBUFFERED", "1")
        .current_dir(&config.working_dir)
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW — never flash/inherit a console window.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command.spawn()
}

fn base_url_for(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

/// Which of the two configured ports a `ResolveAction` refers to — kept as
/// a marker (not a raw `u16`) so `decide_action` stays pure and testable
/// without any IO or config plumbing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PortChoice {
    Primary,
    Fallback,
}

/// Pure decision taken from the two probe results — deliberately separated
/// from `spawn_backend`/IO so it can be unit tested exhaustively without a
/// real TCP listener or process spawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ResolveAction {
    /// A healthy backend already owns this port — reuse it, `managed: false`.
    ReuseHealthy(PortChoice),
    /// Spawn a new backend on this port.
    Spawn(PortChoice),
    /// Both the primary and fallback ports are occupied by
    /// listening-but-unhealthy processes — nowhere safe to spawn. Report
    /// unmanaged with an error, never blind-spawn on top of an unknown
    /// process (WU-E M1).
    BothBusy,
    /// `spawn == false`, or the primary is not-listening with spawning
    /// disabled — report the primary port unmanaged, no error.
    Unmanaged,
}

/// Startup decision (design WU-E, revised for M1):
/// 1. Probe `config.port`. A 200 (with the health marker) means a real
///    backend (ours or an already-running instance) owns it — reuse it,
///    never spawn.
/// 2. TCP connects but isn't healthy (something else owns the port, e.g.
///    WhisperLive STT on 8765) — probe `config.fallback_port` too before
///    doing anything:
///    - fallback healthy → reuse it, `managed: false`.
///    - fallback listening-but-unhealthy → both ports are busy with
///      something else; do NOT spawn anywhere, report unmanaged + error.
///    - fallback not listening → spawn there.
/// 3. Nothing listening on the primary at all — spawn on `config.port`.
/// `config.spawn == false` disables spawning entirely (external process
/// management expected); the primary port is still reported so the
/// frontend's BackendGate can surface "not reachable" honestly.
fn decide_action(
    primary: HealthProbe,
    fallback: Option<HealthProbe>,
    spawn_enabled: bool,
) -> ResolveAction {
    match primary {
        HealthProbe::Healthy => ResolveAction::ReuseHealthy(PortChoice::Primary),
        HealthProbe::NotListening => {
            if spawn_enabled {
                ResolveAction::Spawn(PortChoice::Primary)
            } else {
                ResolveAction::Unmanaged
            }
        }
        HealthProbe::ListeningNotHealthy => {
            if !spawn_enabled {
                return ResolveAction::Unmanaged;
            }
            match fallback {
                Some(HealthProbe::Healthy) => ResolveAction::ReuseHealthy(PortChoice::Fallback),
                Some(HealthProbe::ListeningNotHealthy) => ResolveAction::BothBusy,
                Some(HealthProbe::NotListening) | None => ResolveAction::Spawn(PortChoice::Fallback),
            }
        }
    }
}

/// Result of attempting to spawn+verify a backend on a chosen port.
struct SpawnOutcome {
    info: BackendInfo,
    child: Option<Child>,
    job: Option<job_object::JobObject>,
}

/// Spawns the backend on `port`, then gives the process ~700ms to settle
/// and checks `try_wait()` — a process that crashes immediately (bad
/// python_path, import error, port race) would otherwise be reported as a
/// live managed backend even though it's already dead (WU-E M1 follow-up).
/// On success, assigns the child to a kill-on-close Windows Job Object so
/// the OS reaps it if this process dies without running `shutdown_backend`
/// (WU-E M2).
fn spawn_and_verify(config: &BackendConfig, port: u16) -> SpawnOutcome {
    let log_path = resolve_log_path(config);

    let mut child = match spawn_backend(config, port) {
        Ok(child) => child,
        Err(err) => {
            eprintln!("backend.rs: failed to spawn backend on port {port}: {err}");
            return SpawnOutcome {
                info: BackendInfo {
                    base_url: base_url_for(port),
                    managed: false,
                    error: Some(format!(
                        "Failed to spawn backend on port {port}: {err}. See log: {}",
                        log_path.display()
                    )),
                },
                child: None,
                job: None,
            };
        }
    };

    std::thread::sleep(Duration::from_millis(700));

    match child.try_wait() {
        Ok(Some(status)) => {
            eprintln!(
                "backend.rs: backend spawned on port {port} exited immediately ({status}) — see log at {}",
                log_path.display()
            );
            SpawnOutcome {
                info: BackendInfo {
                    base_url: base_url_for(port),
                    managed: false,
                    error: Some(format!(
                        "Backend process on port {port} exited immediately after spawn ({status}). See log: {}",
                        log_path.display()
                    )),
                },
                child: None,
                job: None,
            }
        }
        Ok(None) => {
            let job = job_object::JobObject::assign(&child);
            SpawnOutcome {
                info: BackendInfo {
                    base_url: base_url_for(port),
                    managed: true,
                    error: None,
                },
                child: Some(child),
                job,
            }
        }
        Err(err) => {
            // try_wait() itself failing is rare and not actionable — treat
            // the child as still alive rather than losing the handle.
            eprintln!("backend.rs: try_wait failed for backend spawned on port {port}: {err}");
            let job = job_object::JobObject::assign(&child);
            SpawnOutcome {
                info: BackendInfo {
                    base_url: base_url_for(port),
                    managed: true,
                    error: None,
                },
                child: Some(child),
                job,
            }
        }
    }
}

fn resolve_backend(config: &BackendConfig) -> SpawnOutcome {
    let probe_timeout = Duration::from_millis(500);
    let primary_probe = probe_health(config.port, probe_timeout);

    // Only probe the fallback port when it's actually relevant — avoids an
    // extra 500ms connect-timeout on the common paths (healthy primary,
    // nothing listening at all, or spawning disabled).
    let fallback_probe = if primary_probe == HealthProbe::ListeningNotHealthy && config.spawn {
        Some(probe_health(config.fallback_port, probe_timeout))
    } else {
        None
    };

    match decide_action(primary_probe, fallback_probe, config.spawn) {
        ResolveAction::ReuseHealthy(choice) => {
            let port = match choice {
                PortChoice::Primary => config.port,
                PortChoice::Fallback => config.fallback_port,
            };
            SpawnOutcome {
                info: BackendInfo {
                    base_url: base_url_for(port),
                    managed: false,
                    error: None,
                },
                child: None,
                job: None,
            }
        }
        ResolveAction::Spawn(choice) => {
            let port = match choice {
                PortChoice::Primary => config.port,
                PortChoice::Fallback => config.fallback_port,
            };
            spawn_and_verify(config, port)
        }
        ResolveAction::BothBusy => {
            eprintln!(
                "backend.rs: port {} and fallback port {} are both occupied by unhealthy/unknown processes — refusing to spawn on top of either",
                config.port, config.fallback_port
            );
            SpawnOutcome {
                info: BackendInfo {
                    base_url: base_url_for(config.port),
                    managed: false,
                    error: Some(format!(
                        "Port {} and fallback port {} are both in use by processes that did not respond as a healthy OpenCohost backend.",
                        config.port, config.fallback_port
                    )),
                },
                child: None,
                job: None,
            }
        }
        ResolveAction::Unmanaged => SpawnOutcome {
            info: BackendInfo {
                base_url: base_url_for(config.port),
                managed: false,
                error: None,
            },
            child: None,
            job: None,
        },
    }
}

/// The spawned F10 push-to-talk bridge child, plus its own Job Object when one
/// had to be created for it (see `spawn_ptt_bridge`). Both `None` when the
/// bridge wasn't spawned (guards failed) or failed to spawn.
#[derive(Default)]
struct PttBridge {
    child: Option<Child>,
    job: Option<job_object::JobObject>,
}

/// Spawns the standalone global push-to-talk bridge (`ptt_f10_bridge.py` at
/// `config.working_dir`) as a second managed child, mirroring `spawn_backend`'s
/// process setup: the same resolved `python_path`, run from `working_dir` with
/// `PYTHONPATH=working_dir`, `CREATE_NO_WINDOW`, and stdout/stderr truncated
/// into `%TEMP%\opencohost-ptt-bridge.log`.
///
/// Best-effort by contract: the bridge is a convenience (global F10 hold-to-
/// talk while any other app is focused), never load-bearing for the shell. Any
/// failure — missing script, spawn IO error — is logged and swallowed so the
/// app always comes up.
///
/// Guards: only spawns when `config.spawn == true` AND the script file exists.
///
/// Job Object: assigned to the backend's existing kill-on-close job when we
/// have one (backend was spawned by us), so it dies with the app exactly like
/// the backend. When the backend was reused (already healthy, no job of ours),
/// a fresh job is created for the bridge and returned to be held for the app's
/// lifetime in `BackendState.ptt_job`.
fn spawn_ptt_bridge(
    config: &BackendConfig,
    backend_job: Option<&job_object::JobObject>,
    token: Option<&str>,
) -> PttBridge {
    if !config.spawn {
        return PttBridge::default();
    }

    let script = Path::new(&config.working_dir).join("ptt_f10_bridge.py");
    if !script.exists() {
        eprintln!(
            "backend.rs: PTT bridge script not found at {script:?} — skipping global F10 push-to-talk"
        );
        return PttBridge::default();
    }

    let child = match spawn_ptt_bridge_process(config, &script, token) {
        Ok(child) => child,
        Err(err) => {
            eprintln!(
                "backend.rs: failed to spawn PTT bridge from {script:?}: {err} — continuing without global F10 push-to-talk"
            );
            return PttBridge::default();
        }
    };

    // Reuse the backend's job object when we own one; otherwise give the
    // bridge its own so it still dies with the app.
    let own_job = match backend_job {
        Some(job) => {
            job.assign_existing(&child);
            None
        }
        None => job_object::JobObject::assign(&child),
    };

    PttBridge { child: Some(child), job: own_job }
}

/// Spawns `python <script>` from `config.working_dir`, mirroring
/// `spawn_backend` (shared `log_stdio`, `PYTHONPATH`, `CREATE_NO_WINDOW`).
/// Passes the operator token through as `OPENCOHOST_API_TOKEN` when one was
/// resolved — otherwise the bridge inherits the parent env and degrades to
/// sending no Authorization header, exactly like the frontend does today.
fn spawn_ptt_bridge_process(
    config: &BackendConfig,
    script: &Path,
    token: Option<&str>,
) -> std::io::Result<Child> {
    let log_path = env::temp_dir().join("opencohost-ptt-bridge.log");
    let (stdout, stderr) = log_stdio(&log_path);

    let mut command = Command::new(&config.python_path);
    command
        .arg(script)
        .env("PYTHONPATH", &config.working_dir)
        .env("PYTHONUNBUFFERED", "1")
        .current_dir(&config.working_dir)
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr);

    if let Some(token) = token {
        command.env("OPENCOHOST_API_TOKEN", token);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW — never flash/inherit a console window.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command.spawn()
}

/// Called from `main.rs`'s `.setup(...)` — resolves the backend, spawns the
/// global PTT bridge, and registers `BackendState` so `backend_info` and
/// `shutdown_backend` can reach both.
pub fn setup_backend(app: &tauri::App) -> tauri::Result<()> {
    let config = BackendConfig::load();
    let outcome = resolve_backend(&config);

    // Best-effort operator token handoff for the bridge: a single, non-blocking
    // sweep of the same candidates `api_token` reads. The token file may not be
    // minted this early (the backend was just spawned) — that's fine while auth
    // enforcement is off (D2): the bridge sends no header, same as the frontend.
    // ponytail: single sweep, no retry — revisit (read the token inside the
    // bridge, or delay its spawn) only when API auth enforcement is switched on.
    let token_candidates = resolve_token_file_candidates(&config.working_dir);
    let token = read_operator_token_with_retry(&token_candidates, 1, Duration::from_millis(0));

    let bridge = spawn_ptt_bridge(&config, outcome.job.as_ref(), token.as_deref());

    app.manage(BackendState {
        info: outcome.info,
        child: Mutex::new(outcome.child),
        job: Mutex::new(outcome.job),
        ptt_child: Mutex::new(bridge.child),
        ptt_job: Mutex::new(bridge.job),
    });
    Ok(())
}

/// Called from `main.rs`'s `RunEvent::ExitRequested` / `RunEvent::Exit`
/// handler — kills the managed child (if any) so a single-window app close
/// doesn't leave an orphaned uvicorn process behind. No-op for an external
/// (unmanaged) backend, and no restart-on-crash logic here by design (kept
/// out of scope for this work unit).
pub fn shutdown_backend(app_handle: &tauri::AppHandle) {
    let Some(state) = app_handle.try_state::<BackendState>() else {
        return;
    };

    // The PTT bridge is spawned independently of whether the backend was
    // managed, so kill it first — before the `!managed` early return below —
    // otherwise a reused (unmanaged) backend would orphan the bridge.
    kill_child(&state.ptt_child);
    if let Ok(mut job_guard) = state.ptt_job.lock() {
        job_guard.take();
    }

    if !state.info.managed {
        return;
    }
    kill_child(&state.child);

    // Explicit clean shutdown already killed the child above; drop the Job
    // Object handle too so it isn't held open longer than necessary. This is
    // a courtesy for the clean-exit path — the crash-orphan guarantee (WU-E
    // M2) is the OS closing this same handle automatically when the process
    // dies without reaching this function at all.
    if let Ok(mut job_guard) = state.job.lock() {
        job_guard.take();
    };
}

/// Kills and reaps the child held in `slot`, if any. Poisoned-lock tolerant —
/// shutdown must make its best effort regardless of a panicked holder.
/// `--workers 1` / the single bridge process means no process-tree kill.
fn kill_child(slot: &Mutex<Option<Child>>) {
    let mut guard = match slot.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Windows Job Object wiring for WU-E M2 (orphan-on-crash prevention).
///
/// Assigning the spawned uvicorn child to a Job Object configured with
/// `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` makes the OS itself kill the child
/// the moment the job's last handle is closed — including implicitly, when
/// this process terminates for any reason (crash, task-killed, power loss
/// notwithstanding) without ever running `shutdown_backend`. This is the
/// only way to guarantee no orphaned backend process on a hard crash;
/// `Drop`/exit-handler based cleanup cannot run if the process itself is
/// killed ungracefully.
///
/// The handle must stay open for the app's entire lifetime — it lives in
/// `BackendState.job` for exactly that reason. Closing it early would kill
/// the still-needed backend prematurely; never closing it at all (or the
/// process exiting) is what triggers the kill-on-close cleanup.
#[cfg(windows)]
mod job_object {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    use windows_sys::Win32::Foundation::HANDLE;

    pub struct JobObject(HANDLE);

    // SAFETY: a Win32 HANDLE is an opaque kernel object reference — it's
    // fine to move across threads, and every Win32 call made on it here is
    // safe to invoke from any thread.
    unsafe impl Send for JobObject {}

    impl JobObject {
        /// Creates an anonymous kill-on-close job object and assigns
        /// `child` to it. Returns `None` on any Win32 failure — a failure
        /// here must never abort the already-successful spawn, it just
        /// means this particular child loses the crash-orphan guarantee.
        pub fn assign(child: &Child) -> Option<Self> {
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    eprintln!("backend.rs: CreateJobObjectW failed, backend won't be killed on host crash");
                    return None;
                }

                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

                let set_ok = SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if set_ok == 0 {
                    eprintln!("backend.rs: SetInformationJobObject failed, backend won't be killed on host crash");
                    CloseHandle(job);
                    return None;
                }

                let process_handle = child.as_raw_handle() as HANDLE;
                let assign_ok = AssignProcessToJobObject(job, process_handle);
                if assign_ok == 0 {
                    eprintln!("backend.rs: AssignProcessToJobObject failed, backend won't be killed on host crash");
                    CloseHandle(job);
                    return None;
                }

                Some(JobObject(job))
            }
        }

        /// Assigns an additional, already-spawned `child` to this same job so
        /// it shares the kill-on-close guarantee. Returns `true` on success; a
        /// failure just means this extra child loses the crash-orphan
        /// guarantee — never fatal, never aborts an already-successful spawn.
        pub fn assign_existing(&self, child: &Child) -> bool {
            unsafe {
                let process_handle = child.as_raw_handle() as HANDLE;
                if AssignProcessToJobObject(self.0, process_handle) == 0 {
                    eprintln!("backend.rs: AssignProcessToJobObject (PTT bridge) failed, bridge won't be killed on host crash");
                    return false;
                }
                true
            }
        }
    }

    impl Drop for JobObject {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

/// Non-Windows stub: no Job Object equivalent is wired up for this work
/// unit — `assign` always returns `None`, and `BackendState.job` is simply
/// unused on these targets.
#[cfg(not(windows))]
mod job_object {
    use std::process::Child;

    pub struct JobObject;

    impl JobObject {
        pub fn assign(_child: &Child) -> Option<Self> {
            None
        }

        pub fn assign_existing(&self, _child: &Child) -> bool {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

        assert!(result.is_err(), "python_path/working_dir have no #[serde(default)], must fail to parse without them");
    }

    #[test]
    fn compiled_in_dev_default_config_is_valid_and_matches_shipped_values() {
        let config = BackendConfig::from_json(DEV_DEFAULT_CONFIG_JSON)
            .expect("src-tauri/backend.config.json must be valid JSON matching BackendConfig's shape");

        assert_eq!(config.python_path, "E:\\Miniconda\\envs\\flux_env\\python.exe");
        assert_eq!(config.working_dir, "E:\\VoiceAI");
        assert_eq!(config.app_module, "opencohost.api.main:app");
        assert_eq!(config.port, 8765);
        assert_eq!(config.fallback_port, 8770);
        assert!(config.spawn);
        assert_eq!(config.log_file, None);
    }

    // --- decide_action: pure decision logic, no IO involved (WU-E M1) ---

    #[test]
    fn healthy_primary_always_reuses_primary_regardless_of_spawn_flag() {
        assert_eq!(
            decide_action(HealthProbe::Healthy, None, true),
            ResolveAction::ReuseHealthy(PortChoice::Primary)
        );
        assert_eq!(
            decide_action(HealthProbe::Healthy, None, false),
            ResolveAction::ReuseHealthy(PortChoice::Primary)
        );
    }

    #[test]
    fn not_listening_primary_spawns_on_primary_when_spawn_enabled() {
        assert_eq!(
            decide_action(HealthProbe::NotListening, None, true),
            ResolveAction::Spawn(PortChoice::Primary)
        );
    }

    #[test]
    fn not_listening_primary_is_unmanaged_when_spawn_disabled() {
        assert_eq!(
            decide_action(HealthProbe::NotListening, None, false),
            ResolveAction::Unmanaged
        );
    }

    #[test]
    fn listening_not_healthy_primary_is_unmanaged_when_spawn_disabled() {
        // spawn=false short-circuits before the fallback is even probed —
        // caller never passes a fallback probe in this case.
        assert_eq!(
            decide_action(HealthProbe::ListeningNotHealthy, None, false),
            ResolveAction::Unmanaged
        );
    }

    #[test]
    fn listening_not_healthy_primary_reuses_healthy_fallback() {
        assert_eq!(
            decide_action(
                HealthProbe::ListeningNotHealthy,
                Some(HealthProbe::Healthy),
                true
            ),
            ResolveAction::ReuseHealthy(PortChoice::Fallback)
        );
    }

    #[test]
    fn listening_not_healthy_primary_spawns_on_not_listening_fallback() {
        assert_eq!(
            decide_action(
                HealthProbe::ListeningNotHealthy,
                Some(HealthProbe::NotListening),
                true
            ),
            ResolveAction::Spawn(PortChoice::Fallback)
        );
    }

    #[test]
    fn both_ports_listening_not_healthy_refuses_to_spawn_anywhere() {
        // WU-E M1: this is the exact "blind fallback spawn" bug — must
        // never spawn on top of an unknown listening process.
        assert_eq!(
            decide_action(
                HealthProbe::ListeningNotHealthy,
                Some(HealthProbe::ListeningNotHealthy),
                true
            ),
            ResolveAction::BothBusy
        );
    }

    #[test]
    fn missing_fallback_probe_with_unhealthy_primary_treated_as_not_listening() {
        // resolve_backend always supplies a fallback probe when it reaches
        // this branch with spawn enabled, but the pure function itself
        // should still make a safe (spawn) decision if ever called with
        // `None` here, matching the not-listening case rather than
        // silently blocking.
        assert_eq!(
            decide_action(HealthProbe::ListeningNotHealthy, None, true),
            ResolveAction::Spawn(PortChoice::Fallback)
        );
    }

    // --- operator token handoff (agent_context_gateway Phase 4, ADR-5) ---

    #[test]
    fn token_file_path_uses_appdata_when_set() {
        let path = token_file_path(Some("C:\\Users\\bob\\AppData\\Roaming"), None);
        assert_eq!(
            path,
            PathBuf::from("C:\\Users\\bob\\AppData\\Roaming\\OpenCohost\\config\\api_tokens.json")
        );
    }

    #[test]
    fn token_file_path_falls_back_to_userprofile_when_appdata_missing() {
        // Mirrors storage.py:32-33's Path.home() fallback (APPDATA unset).
        let path = token_file_path(None, Some("C:\\Users\\bob"));
        assert_eq!(
            path,
            PathBuf::from("C:\\Users\\bob\\AppData\\Roaming\\OpenCohost\\config\\api_tokens.json")
        );
    }

    #[test]
    fn parse_operator_token_extracts_operator_field_only() {
        // Mirrors opencohost/api/auth.py::ensure_tokens' minted shape — the
        // agent token must never be read here (ADR-3).
        let json = r#"{"version": 1, "operator": "op-secret", "agent": "agent-secret"}"#;
        assert_eq!(parse_operator_token(json), Some("op-secret".to_string()));
    }

    #[test]
    fn parse_operator_token_none_on_malformed_json() {
        assert_eq!(parse_operator_token("not json"), None);
    }

    #[test]
    fn parse_operator_token_none_when_operator_field_missing() {
        assert_eq!(parse_operator_token(r#"{"agent": "only-agent"}"#), None);
    }

    #[test]
    fn read_operator_token_none_on_missing_file() {
        let missing = env::temp_dir().join("opencohost-test-missing-token-file.json");
        let _ = fs::remove_file(&missing);
        assert_eq!(read_operator_token(&missing), None);
    }

    #[test]
    fn read_operator_token_with_retry_picks_up_a_file_written_after_a_short_delay() {
        // The design risk this covers: the token file is minted at the very
        // start of the Python backend's lifespan startup, but
        // `spawn_and_verify` only confirms the process is alive
        // (`try_wait`), not that lifespan startup has run yet — so the file
        // can legitimately appear a little after `api_token` is first
        // invoked.
        let path = env::temp_dir().join("opencohost-test-retry-token-file.json");
        let _ = fs::remove_file(&path);
        let write_path = path.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(5));
            fs::write(&write_path, r#"{"version": 1, "operator": "late-token", "agent": "x"}"#)
                .expect("test setup: write must succeed");
        });

        let token = read_operator_token_with_retry(&[path.clone()], 10, Duration::from_millis(5));

        assert_eq!(token, Some("late-token".to_string()));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn read_operator_token_with_retry_gives_up_after_exhausting_attempts() {
        let missing = env::temp_dir().join("opencohost-test-never-appears-token-file.json");
        let _ = fs::remove_file(&missing);
        assert_eq!(read_operator_token_with_retry(&[missing], 2, Duration::from_millis(2)), None);
    }

    // --- dev-mode (non-frozen) token path fix — critical finding: the
    // backend actually mints the token at `<working_dir>\config\
    // api_tokens.json` in every current deployment, not %APPDATA% (that
    // branch only applies to a frozen build). ---

    #[test]
    fn dev_token_file_path_joins_working_dir_config_api_tokens_json() {
        let path = dev_token_file_path("E:\\VoiceAI");
        assert_eq!(path, PathBuf::from("E:\\VoiceAI\\config\\api_tokens.json"));
    }

    #[test]
    fn resolve_token_file_candidates_checks_working_dir_before_appdata() {
        // working_dir (source-run) is the real, verified-on-disk path in
        // every current deployment — must be probed before the
        // frozen-build-only %APPDATA% candidate.
        let candidates = resolve_token_file_candidates("E:\\VoiceAI");
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0], PathBuf::from("E:\\VoiceAI\\config\\api_tokens.json"));
        assert!(candidates[1].ends_with(Path::new("OpenCohost").join("config").join("api_tokens.json")));
    }

    #[test]
    fn read_operator_token_with_retry_finds_token_at_a_later_candidate_when_an_earlier_one_is_missing() {
        // Root-cause regression for the critical finding: with the old
        // single-path lookup this scenario (only the second candidate
        // exists — exactly today's real dev-mode deployment) always
        // returned None. All candidates must be probed on every attempt.
        let missing = env::temp_dir().join("opencohost-test-multi-candidate-missing.json");
        let present = env::temp_dir().join("opencohost-test-multi-candidate-present.json");
        let _ = fs::remove_file(&missing);
        fs::write(&present, r#"{"version": 1, "operator": "dev-mode-token", "agent": "x"}"#)
            .expect("test setup: write must succeed");

        let token =
            read_operator_token_with_retry(&[missing, present.clone()], 1, Duration::from_millis(1));

        assert_eq!(token, Some("dev-mode-token".to_string()));
        let _ = fs::remove_file(&present);
    }
}
