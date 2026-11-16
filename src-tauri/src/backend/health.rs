use crate::backend::identity::{
    compare_identity, parse_health_identity, IdentityVerdict, InstallIdentity,
};
use crate::backend::shell_log;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HealthProbe {
    /// GET /api/health returned 200 with a body containing the
    /// `engine_alive` marker field — a real OpenCohost backend is up.
    Healthy,
    /// A real OpenCohost backend answers, but its `install_id`/`build_version`
    /// differ from this install's: stale or foreign, never reused.
    HealthyForeign,
    /// TCP connect succeeded but the response wasn't a 200-with-marker (or
    /// wasn't a well-formed HTTP response at all) — something else owns
    /// that port.
    ListeningNotHealthy,
    /// TCP connect itself failed — nothing is listening on that port.
    NotListening,
}

/// Minimal blocking HTTP/1.1 GET over a raw TcpStream. Identity is NOT checked
/// here; see `probe_health_for`.
pub fn probe_health(port: u16, timeout: Duration) -> HealthProbe {
    probe_health_response(port, timeout).0
}

/// Like `probe_health`, but a healthy backend whose `install_id`/`build_version`
/// differ from this install's is reported as `HealthyForeign` so it is never
/// reused. A backend that reports no identity at all (an older build) keeps
/// today's behaviour (`Healthy`) and the fact is logged.
pub fn probe_health_for(port: u16, timeout: Duration, local: &InstallIdentity) -> HealthProbe {
    let (probe, response) = probe_health_response(port, timeout);
    if probe != HealthProbe::Healthy {
        return probe;
    }
    let remote = parse_health_identity(&response);
    match compare_identity(local, &remote) {
        IdentityVerdict::Foreign(field) => {
            shell_log::log_line(&format!(
                "backend supervisor: backend on port {port} is stale or foreign ({field} differs); refusing to reuse it"
            ));
            HealthProbe::HealthyForeign
        }
        IdentityVerdict::Unknown => {
            if remote == InstallIdentity::default() && *local != InstallIdentity::default() {
                shell_log::log_line(&format!(
                    "backend supervisor: backend on port {port} reports no install identity (older build); reusing it"
                ));
            }
            HealthProbe::Healthy
        }
        IdentityVerdict::Match => HealthProbe::Healthy,
    }
}

fn probe_health_response(port: u16, timeout: Duration) -> (HealthProbe, String) {
    let addr: SocketAddr = match format!("127.0.0.1:{port}").parse() {
        Ok(addr) => addr,
        Err(_) => return (HealthProbe::NotListening, String::new()),
    };

    let mut stream = match TcpStream::connect_timeout(&addr, timeout) {
        Ok(stream) => stream,
        Err(_) => return (HealthProbe::NotListening, String::new()),
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let request = b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(request).is_err() {
        return (HealthProbe::ListeningNotHealthy, String::new());
    }

    let mut buf = Vec::new();
    let _ = stream.read_to_end(&mut buf);
    if buf.is_empty() {
        return (HealthProbe::ListeningNotHealthy, String::new());
    }

    let response = String::from_utf8_lossy(&buf).into_owned();
    let status_line = response.lines().next().unwrap_or("");
    let is_200 = status_line.split_whitespace().nth(1) == Some("200");
    if is_200 && response.contains("engine_alive") {
        (HealthProbe::Healthy, response)
    } else {
        (HealthProbe::ListeningNotHealthy, String::new())
    }
}

/// Which of the two configured ports a `ResolveAction` refers to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PortChoice {
    Primary,
    Fallback,
}

/// Pure decision taken from the two probe results.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolveAction {
    /// A healthy backend already owns this port — reuse it, `managed: false`.
    ReuseHealthy(PortChoice),
    /// Spawn a new backend on this port.
    Spawn(PortChoice),
    /// Both the primary and fallback ports are occupied by
    /// listening-but-unhealthy processes — nowhere safe to spawn.
    BothBusy,
    /// A healthy backend owns the port but belongs to another install or an
    /// older build, and there is no safe port left to spawn on.
    ForeignBackend,
    /// `spawn == false`, or the primary is not-listening with spawning
    /// disabled — report the primary port unmanaged, no error.
    Unmanaged,
}

pub fn decide_action(
    primary: HealthProbe,
    fallback: Option<HealthProbe>,
    spawn_enabled: bool,
) -> ResolveAction {
    match primary {
        HealthProbe::Healthy => ResolveAction::ReuseHealthy(PortChoice::Primary),
        HealthProbe::HealthyForeign => {
            if !spawn_enabled {
                // The owner pointed the shell at an external backend on purpose.
                return ResolveAction::Unmanaged;
            }
            match fallback {
                Some(HealthProbe::Healthy) => ResolveAction::ReuseHealthy(PortChoice::Fallback),
                Some(HealthProbe::HealthyForeign) | Some(HealthProbe::ListeningNotHealthy) => {
                    ResolveAction::ForeignBackend
                }
                Some(HealthProbe::NotListening) | None => {
                    ResolveAction::Spawn(PortChoice::Fallback)
                }
            }
        }
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
                Some(HealthProbe::HealthyForeign) => ResolveAction::ForeignBackend,
                Some(HealthProbe::NotListening) | None => {
                    ResolveAction::Spawn(PortChoice::Fallback)
                }
            }
        }
    }
}
