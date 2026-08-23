use crate::backend::config::{resolve_python_binary, BackendConfig};
use crate::backend::supervisor::log_stdio;
use crate::platform::JobObject;
use std::env;
use std::process::{Child, Command, Stdio};

/// The spawned F10 push-to-talk bridge child, plus its own Job Object when one
/// had to be created for it. Both `None` when the bridge wasn't spawned
/// (guards failed) or failed to spawn.
#[derive(Default)]
pub struct PttBridge {
    pub child: Option<Child>,
    pub job: Option<JobObject>,
}

pub fn spawn_ptt_bridge(
    config: &BackendConfig,
    backend_job: Option<&JobObject>,
    token: Option<&str>,
) -> PttBridge {
    if !config.spawn {
        return PttBridge::default();
    }

    let module = config
        .resolved_working_dir()
        .join("opencohost")
        .join("api")
        .join("ptt_f10_bridge.py");
    if !module.exists() {
        eprintln!(
            "backend ptt: packaged PTT bridge module not found at {module:?} — skipping global F10 push-to-talk"
        );
        return PttBridge::default();
    }

    let child = match spawn_ptt_bridge_process(config, token) {
        Ok(child) => child,
        Err(err) => {
            eprintln!(
                "backend ptt: failed to spawn packaged PTT bridge: {err} — continuing without global F10 push-to-talk"
            );
            return PttBridge::default();
        }
    };

    let own_job = match backend_job {
        Some(job) => {
            job.assign_existing(&child);
            None
        }
        None => JobObject::assign(&child),
    };

    PttBridge {
        child: Some(child),
        job: own_job,
    }
}

pub fn spawn_ptt_bridge_process(
    config: &BackendConfig,
    token: Option<&str>,
) -> std::io::Result<Child> {
    let log_path = env::temp_dir().join("opencohost-ptt-bridge.log");
    let (stdout, stderr) = log_stdio(&log_path);
    let working_dir = config.resolved_working_dir();
    let python_bin = resolve_python_binary(config, &working_dir);

    let mut command = Command::new(&python_bin);
    command
        .arg("-m")
        .arg("opencohost.api.ptt_f10_bridge")
        .env("PYTHONPATH", &working_dir)
        .env("PYTHONUNBUFFERED", "1")
        .current_dir(&working_dir)
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr);

    if let Some(token) = token {
        command.env("OPENCOHOST_API_TOKEN", token);
    }
    if let Some(data_root) = &config.data_root {
        command.env("OPENCOHOST_DATA_ROOT", data_root);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command.spawn()
}
