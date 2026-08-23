use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HealthProbe {
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

/// Minimal blocking HTTP/1.1 GET over a raw TcpStream.
pub fn probe_health(port: u16, timeout: Duration) -> HealthProbe {
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
    let _ = stream.read_to_end(&mut buf);
    if buf.is_empty() {
        return HealthProbe::ListeningNotHealthy;
    }

    let response = String::from_utf8_lossy(&buf);
    let status_line = response.lines().next().unwrap_or("");
    let is_200 = status_line.split_whitespace().nth(1) == Some("200");
    if is_200 && response.contains("engine_alive") {
        HealthProbe::Healthy
    } else {
        HealthProbe::ListeningNotHealthy
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
                Some(HealthProbe::NotListening) | None => {
                    ResolveAction::Spawn(PortChoice::Fallback)
                }
            }
        }
    }
}
