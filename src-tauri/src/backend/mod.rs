pub mod config;
pub mod diagnostics;
pub mod health;
pub mod ptt;
pub mod supervisor;
pub mod token;

#[cfg(test)]
mod tests;

pub use config::{
    default_app_module, default_fallback_port, default_port, default_spawn, find_repo_root,
    load_backend_config, resolve_log_path, resolve_python_binary, BackendConfig,
    DEV_DEFAULT_CONFIG_JSON,
};
pub use diagnostics::{
    backend_diagnostic, classify_backend_error, describe_spawn_failure, read_log_tail,
    BackendDiagnostic, SpawnFailureFacts, ENGINE_MISSING_MARKER, LOG_TAIL_BYTES,
    UVICORN_MISSING_MARKERS,
};
pub use health::{decide_action, probe_health, HealthProbe, PortChoice, ResolveAction};
pub use ptt::{spawn_ptt_bridge, spawn_ptt_bridge_process, PttBridge};
pub use supervisor::*;
pub use token::*;
