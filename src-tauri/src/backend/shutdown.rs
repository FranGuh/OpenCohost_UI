//! Graceful backend shutdown helpers (clean_shutdown_unload_20261007).
//!
//! Closing the app used to `TerminateProcess` the Python backend, so its
//! model unload and vision teardown never ran. `graceful_shutdown` first asks
//! the backend to stop itself (`POST /api/system/shutdown`, operator token),
//! and if that fails or times out it unloads the loaded Ollama models
//! directly (`/api/ps` + `keep_alive: 0`). Both steps have hard total
//! deadlines so exit can never hang. No new crates: raw HTTP/1.1 over
//! `TcpStream`, like `health.rs`.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

/// Total bound for the backend's own graceful stop (connect + write + read).
pub const GRACEFUL_BOUND: Duration = Duration::from_secs(4);
/// Total bound for the whole Ollama fallback (ps + every unload).
pub const FALLBACK_BOUND: Duration = Duration::from_secs(2);

const DEFAULT_OLLAMA_PORT: u16 = 11434;

/// `unload_models == false` sends `{"unload_models": false}` so the backend
/// still tears down cleanly but leaves the Ollama models loaded.
pub fn build_shutdown_request(port: u16, token: Option<&str>, unload_models: bool) -> String {
    let auth = token
        .map(|t| format!("Authorization: Bearer {t}\r\n"))
        .unwrap_or_default();
    if unload_models {
        return format!(
            "POST /api/system/shutdown HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{auth}Content-Length: 0\r\nConnection: close\r\n\r\n"
        );
    }
    let body = serde_json::json!({ "unload_models": false }).to_string();
    format!(
        "POST /api/system/shutdown HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{auth}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

pub fn build_ps_request(host: &str, port: u16) -> String {
    format!("GET /api/ps HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n")
}

pub fn build_unload_request(host: &str, port: u16, model: &str) -> String {
    let body = serde_json::json!({ "model": model, "keep_alive": 0 }).to_string();
    format!(
        "POST /api/generate HTTP/1.1\r\nHost: {host}:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

/// Names of the models in an Ollama `/api/ps` body; empty on any parse miss.
pub fn parse_ps_models(body: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return Vec::new();
    };
    value
        .get("models")
        .and_then(|m| m.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// Resolve the Ollama endpoint from an `OLLAMA_HOST`-style value. Wildcard and
/// `localhost` hosts map to loopback; empty/absent means the default.
pub fn parse_ollama_host(raw: Option<&str>) -> (String, u16) {
    let default = ("127.0.0.1".to_string(), DEFAULT_OLLAMA_PORT);
    let Some(raw) = raw.map(str::trim).filter(|r| !r.is_empty()) else {
        return default;
    };
    let rest = raw.split("://").last().unwrap_or(raw);
    let rest = rest.split('/').next().unwrap_or(rest);
    let (host, port) = match rest.rsplit_once(':') {
        Some((h, p)) => (h, p.parse::<u16>().unwrap_or(DEFAULT_OLLAMA_PORT)),
        None => (rest, DEFAULT_OLLAMA_PORT),
    };
    let host = match host {
        "" | "0.0.0.0" | "localhost" | "[::]" => "127.0.0.1",
        other => other,
    };
    (host.to_string(), port)
}

pub fn port_from_base_url(base_url: &str) -> Option<u16> {
    base_url.rsplit_once(':')?.1.trim_end_matches('/').parse().ok()
}

pub fn response_status(raw: &str) -> Option<u16> {
    let line = raw.lines().next()?;
    if !line.starts_with("HTTP/") {
        return None;
    }
    line.split_whitespace().nth(1)?.parse().ok()
}

pub fn response_body(raw: &str) -> &str {
    raw.split_once("\r\n\r\n").map(|(_, b)| b).unwrap_or("")
}

/// True unless the backend answered 200 with `ok: true` and `timed_out: false`.
pub fn needs_fallback(graceful_response: Option<&str>) -> bool {
    let Some(raw) = graceful_response else {
        return true;
    };
    if response_status(raw) != Some(200) {
        return true;
    }
    let Ok(v) = serde_json::from_str::<serde_json::Value>(response_body(raw).trim()) else {
        return true;
    };
    !(v.get("ok").and_then(|x| x.as_bool()) == Some(true)
        && v.get("timed_out").and_then(|x| x.as_bool()) == Some(false))
}

/// The Ollama-direct fallback only runs when the owner wants models unloaded.
pub fn should_fallback(unload_models: bool, graceful_response: Option<&str>) -> bool {
    unload_models && needs_fallback(graceful_response)
}

/// One HTTP exchange bounded by a TOTAL deadline. `None` when the connection
/// failed; a partial/empty read returns whatever arrived before the deadline.
pub fn http_exchange(host: &str, port: u16, request: &str, total: Duration) -> Option<String> {
    let deadline = Instant::now() + total;
    let addr: SocketAddr = (host, port).to_socket_addrs().ok()?.next()?;
    let mut stream = TcpStream::connect_timeout(&addr, total.max(Duration::from_millis(1))).ok()?;
    let remaining = |d: Instant| d.saturating_duration_since(Instant::now());
    let _ = stream.set_write_timeout(Some(remaining(deadline).max(Duration::from_millis(1))));
    stream.write_all(request.as_bytes()).ok()?;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 2048];
    loop {
        let left = remaining(deadline);
        if left.is_zero() {
            break;
        }
        let _ = stream.set_read_timeout(Some(left));
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(_) => break,
        }
    }
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// Ollama fallback: unload every loaded model, bounded by `FALLBACK_BOUND` in
/// total. Returns the models it asked Ollama to unload.
pub fn unload_ollama_models(ollama_host: Option<&str>) -> Vec<String> {
    let deadline = Instant::now() + FALLBACK_BOUND;
    let (host, port) = parse_ollama_host(ollama_host);
    let left = |d: Instant| d.saturating_duration_since(Instant::now());
    let Some(raw) = http_exchange(&host, port, &build_ps_request(&host, port), left(deadline))
    else {
        return Vec::new();
    };
    let models = parse_ps_models(response_body(&raw));
    let mut unloaded = Vec::new();
    for model in models {
        let remaining = left(deadline);
        if remaining.is_zero() {
            break;
        }
        if http_exchange(&host, port, &build_unload_request(&host, port, &model), remaining)
            .is_some()
        {
            unloaded.push(model);
        }
    }
    unloaded
}

/// Ask the backend to stop gracefully; fall back to unloading Ollama models
/// directly when that fails. Never blocks beyond `GRACEFUL_BOUND` +
/// `FALLBACK_BOUND`.
pub fn graceful_shutdown(backend_port: u16, token: Option<&str>, unload_models: bool) {
    let response = http_exchange(
        "127.0.0.1",
        backend_port,
        &build_shutdown_request(backend_port, token, unload_models),
        GRACEFUL_BOUND,
    );
    if should_fallback(unload_models, response.as_deref()) {
        let ollama = std::env::var("OLLAMA_HOST").ok();
        let unloaded = unload_ollama_models(ollama.as_deref());
        eprintln!(
            "backend shutdown: graceful stop unavailable, unloaded {} model(s) via Ollama",
            unloaded.len()
        );
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shutdown_request_carries_bearer_and_zero_body() {
        let req = build_shutdown_request(8765, Some("tok"), true);
        assert!(req.starts_with("POST /api/system/shutdown HTTP/1.1\r\n"));
        assert!(req.contains("Authorization: Bearer tok\r\n"));
        assert!(req.contains("Content-Length: 0\r\n"));
        assert!(req.contains("Connection: close\r\n"));
        assert!(req.ends_with("\r\n\r\n"));
    }

    #[test]
    fn shutdown_request_without_token_has_no_auth_header() {
        let req = build_shutdown_request(8765, None, true);
        assert!(!req.contains("Authorization"));
    }

    #[test]
    fn shutdown_request_opt_out_sends_unload_models_false_body() {
        let req = build_shutdown_request(8765, Some("tok"), false);
        let body = req.split("\r\n\r\n").nth(1).unwrap();
        let v: serde_json::Value = serde_json::from_str(body).unwrap();
        assert_eq!(v["unload_models"], false);
        assert!(req.contains("Content-Type: application/json\r\n"));
        assert!(req.contains(&format!("Content-Length: {}\r\n", body.len())));
    }

    #[test]
    fn fallback_is_skipped_when_the_owner_opted_out_of_unloading() {
        assert!(!should_fallback(false, None));
        assert!(!should_fallback(false, Some("garbage")));
        assert!(should_fallback(true, None));
        let ok = "HTTP/1.1 200 OK\r\n\r\n{\"ok\":true,\"unloaded\":null,\"timed_out\":false}";
        assert!(!should_fallback(true, Some(ok)));
    }

    #[test]
    fn ps_models_are_parsed_and_garbage_yields_empty() {
        let body = r#"{"models":[{"name":"qwen3:8b","model":"qwen3:8b"},{"name":"llava:7b"}]}"#;
        assert_eq!(parse_ps_models(body), vec!["qwen3:8b", "llava:7b"]);
        assert!(parse_ps_models("not json").is_empty());
        assert!(parse_ps_models(r#"{"models":null}"#).is_empty());
        assert!(parse_ps_models(r#"{}"#).is_empty());
    }

    #[test]
    fn unload_request_sets_keep_alive_zero() {
        let req = build_unload_request("127.0.0.1", 11434, "qwen3:8b");
        assert!(req.starts_with("POST /api/generate HTTP/1.1\r\n"));
        let body = req.split("\r\n\r\n").nth(1).unwrap();
        let v: serde_json::Value = serde_json::from_str(body).unwrap();
        assert_eq!(v["model"], "qwen3:8b");
        assert_eq!(v["keep_alive"], 0);
        assert!(req.contains(&format!("Content-Length: {}\r\n", body.len())));
    }

    #[test]
    fn ollama_host_parsing_handles_env_shapes() {
        assert_eq!(parse_ollama_host(None), ("127.0.0.1".to_string(), 11434));
        assert_eq!(parse_ollama_host(Some("")), ("127.0.0.1".to_string(), 11434));
        assert_eq!(
            parse_ollama_host(Some("127.0.0.1:11500")),
            ("127.0.0.1".to_string(), 11500)
        );
        assert_eq!(
            parse_ollama_host(Some("http://localhost:11500/")),
            ("127.0.0.1".to_string(), 11500)
        );
        assert_eq!(
            parse_ollama_host(Some("0.0.0.0")),
            ("127.0.0.1".to_string(), 11434)
        );
        assert_eq!(
            parse_ollama_host(Some("10.0.0.5:9")),
            ("10.0.0.5".to_string(), 9)
        );
    }

    #[test]
    fn response_helpers_split_status_and_body() {
        let raw = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"ok\":true}";
        assert_eq!(response_status(raw), Some(200));
        assert_eq!(response_body(raw), "{\"ok\":true}");
        assert_eq!(response_status("garbage"), None);
    }

    #[test]
    fn graceful_result_decides_whether_to_fall_back() {
        let ok = "HTTP/1.1 200 OK\r\n\r\n{\"ok\":true,\"unloaded\":\"m\",\"timed_out\":false}";
        assert!(!needs_fallback(Some(ok)));
        let timed_out = "HTTP/1.1 200 OK\r\n\r\n{\"ok\":true,\"unloaded\":null,\"timed_out\":true}";
        assert!(needs_fallback(Some(timed_out)));
        let not_ok = "HTTP/1.1 200 OK\r\n\r\n{\"ok\":false,\"unloaded\":null,\"timed_out\":false}";
        assert!(needs_fallback(Some(not_ok)));
        let forbidden = "HTTP/1.1 403 Forbidden\r\n\r\n{\"detail\":\"x\"}";
        assert!(needs_fallback(Some(forbidden)));
        assert!(needs_fallback(Some("garbage")));
        assert!(needs_fallback(None));
    }

    #[test]
    fn port_is_extracted_from_base_url() {
        assert_eq!(port_from_base_url("http://127.0.0.1:8770"), Some(8770));
        assert_eq!(port_from_base_url("http://127.0.0.1"), None);
    }

    #[test]
    fn http_exchange_returns_none_when_nothing_listens() {
        // Port 1 on loopback is closed; must fail fast, not hang.
        let t0 = std::time::Instant::now();
        let out = http_exchange(
            "127.0.0.1",
            1,
            "GET / HTTP/1.1\r\n\r\n",
            std::time::Duration::from_millis(500),
        );
        assert!(out.is_none());
        assert!(t0.elapsed() < std::time::Duration::from_secs(2));
    }

    #[test]
    fn http_exchange_is_bounded_by_total_deadline_on_a_silent_server() {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (_s, _) = listener.accept().unwrap();
            std::thread::sleep(std::time::Duration::from_secs(3));
        });
        let t0 = std::time::Instant::now();
        let out = http_exchange(
            "127.0.0.1",
            port,
            "GET / HTTP/1.1\r\n\r\n",
            std::time::Duration::from_millis(400),
        );
        assert!(t0.elapsed() < std::time::Duration::from_millis(1500));
        assert!(out.is_none() || out.as_deref() == Some(""));
        drop(handle);
    }
}
