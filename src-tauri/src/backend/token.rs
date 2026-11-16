use crate::backend::supervisor::BackendState;
use serde::Deserialize;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Shape of the minted token file. Only `operator` is read.
#[derive(Debug, Deserialize)]
pub struct ApiTokens {
    pub operator: String,
}

pub fn token_file_path(appdata: Option<&str>, userprofile: Option<&str>) -> PathBuf {
    let base = appdata
        .map(PathBuf::from)
        .or_else(|| userprofile.map(|home| Path::new(home).join("AppData").join("Roaming")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("OpenCohost")
        .join("config")
        .join("api_tokens.json")
}

pub fn resolve_token_file_path() -> PathBuf {
    token_file_path(
        env::var("APPDATA").ok().as_deref(),
        env::var("USERPROFILE").ok().as_deref(),
    )
}

pub fn dev_token_file_path(working_dir: impl AsRef<Path>) -> PathBuf {
    working_dir.as_ref().join("config").join("api_tokens.json")
}

/// Where the backend keeps its token file, most specific first. With a data
/// root set, the backend writes `<data_root>/config/api_tokens.json`
/// (`opencohost/config/storage.py`), so that path is checked before the
/// dev-mode `working_dir` and the default `%APPDATA%` locations.
pub fn resolve_token_file_candidates(
    working_dir: impl AsRef<Path>,
    data_root: Option<&Path>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::with_capacity(3);
    if let Some(root) = data_root {
        candidates.push(dev_token_file_path(root));
    }
    candidates.push(dev_token_file_path(working_dir));
    candidates.push(resolve_token_file_path());
    candidates
}

/// The data root the spawned backend actually runs with: the configured root
/// (the supervisor exports it as `OPENCOHOST_DATA_ROOT`), otherwise an
/// `OPENCOHOST_DATA_ROOT` the shell passed down to both processes.
pub fn effective_data_root(configured: Option<&Path>) -> Option<PathBuf> {
    configured.map(Path::to_path_buf).or_else(|| {
        env::var_os("OPENCOHOST_DATA_ROOT")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    })
}

pub fn parse_operator_token(contents: &str) -> Option<String> {
    serde_json::from_str::<ApiTokens>(contents)
        .ok()
        .map(|tokens| tokens.operator)
}

pub fn read_operator_token(path: &Path) -> Option<String> {
    let contents = fs::read_to_string(path).ok()?;
    parse_operator_token(&contents)
}

pub const TOKEN_READ_ATTEMPTS: u32 = 5;
pub const TOKEN_READ_RETRY_DELAY: Duration = Duration::from_millis(300);

pub fn read_operator_token_with_retry(
    paths: &[PathBuf],
    attempts: u32,
    delay: Duration,
) -> Option<String> {
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
/// appeared yet or can't be parsed.
pub fn api_token(state: &BackendState) -> Option<String> {
    state.operator_token(TOKEN_READ_ATTEMPTS, TOKEN_READ_RETRY_DELAY)
}
