use serde::Serialize;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// Closed, IPC-safe degraded diagnostic. Low-level spawn errors, paths,
/// commands and log tails never cross this boundary.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BackendDiagnostic {
    pub code: String,
    pub stage: String,
    pub action: String,
    pub message_key: String,
}

pub fn backend_diagnostic(code: &str) -> BackendDiagnostic {
    let (stage, action, message_key) = match code {
        "runtime_not_ready" => ("runtime", "provision_or_repair", "runtime_not_ready"),
        "backend_state_unavailable" => ("startup", "restart", "ipc_unavailable"),
        "backend_launch_failed" => ("launch", "retry", "backend_launch_failed"),
        "backend_ports_busy" => ("launch", "retry", "backend_ports_busy"),
        _ => ("startup", "retry", "generic"),
    };
    BackendDiagnostic {
        code: code.to_owned(),
        stage: stage.to_owned(),
        action: action.to_owned(),
        message_key: message_key.to_owned(),
    }
}

pub fn classify_backend_error(error: &str) -> BackendDiagnostic {
    if error.contains("runtime_not_ready") || error.contains("Provision or Repair") {
        backend_diagnostic("runtime_not_ready")
    } else if error.contains("both in use") {
        backend_diagnostic("backend_ports_busy")
    } else {
        backend_diagnostic("backend_launch_failed")
    }
}

pub const LOG_TAIL_BYTES: u64 = 8 * 1024;

/// Last `LOG_TAIL_BYTES` of `path`, lossily decoded. `None` for a missing,
/// unreadable or empty log.
pub fn read_log_tail(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    if len > LOG_TAIL_BYTES {
        file.seek(SeekFrom::Start(len - LOG_TAIL_BYTES)).ok()?;
    }
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).ok()?;
    if buf.is_empty() {
        return None;
    }
    Some(String::from_utf8_lossy(&buf).into_owned())
}

pub struct SpawnFailureFacts<'a> {
    pub port: u16,
    pub status: &'a str,
    pub python_path: &'a str,
    pub working_dir: &'a Path,
    pub engine_root_found: bool,
    pub log_path: &'a Path,
    pub log_tail: Option<&'a str>,
}

pub const ENGINE_MISSING_MARKER: &str = "No module named 'opencohost'";
pub const UVICORN_MISSING_MARKERS: [&str; 2] =
    ["No module named uvicorn", "No module named 'uvicorn'"];

pub fn describe_spawn_failure(facts: &SpawnFailureFacts) -> String {
    let tail = facts.log_tail.unwrap_or_default();

    let root_note = if facts.engine_root_found {
        ""
    } else {
        " No engine folder (pyproject.toml + opencohost/) was found above the app, \
          so this install does not include the Python engine."
    };
    let context = format!(
        "Interpreter: '{}'. Working directory: '{}'.{root_note} Log: {}",
        facts.python_path,
        facts.working_dir.display(),
        facts.log_path.display()
    );

    if tail.contains(ENGINE_MISSING_MARKER) {
        return format!(
            "The OpenCohost Python engine is not installed in the interpreter this app used. \
             Install the engine, then point python_path and working_dir in backend.config.json \
             at it. {context}"
        );
    }

    if UVICORN_MISSING_MARKERS
        .iter()
        .any(|marker| tail.contains(marker))
    {
        return format!(
            "uvicorn is missing from the interpreter this app used, so the API server could not \
             start. Install the engine's \"api\" extra there. {context}"
        );
    }

    let last_line = tail
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("(no log output)");
    format!(
        "Backend process on port {} exited immediately after spawn ({}). Last log line: \
         {last_line}. {context}",
        facts.port, facts.status
    )
}
