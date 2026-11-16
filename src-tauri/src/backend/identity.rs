//! Install identity: who owns the backend that answers on our port?
//!
//! Writer A's `/api/health` reports `build_version` and `install_id`. This
//! install knows its own values from the runtime manifest in the data root
//! (`state/runtime-manifest.json`: `install_id` and `product_version`), which
//! the first-run code writes next to the `InstallId` in
//! `HKCU\Software\OpenCohost\Runtime`.
//!
//! A backend whose identity DIFFERS is stale or foreign (another install, an
//! older build left running) and must not be reused. A backend that does not
//! report the fields at all is an old build: keep today's behaviour (reuse) but
//! log it.

use std::path::Path;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InstallIdentity {
    pub install_id: Option<String>,
    pub build_version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityVerdict {
    /// At least one field was comparable and nothing differed.
    Match,
    /// A comparable field differs; the payload names it.
    Foreign(&'static str),
    /// Nothing comparable (old backend, or this install cannot tell).
    Unknown,
}

/// Brings semver-style (`0.5.0-alpha.1`) and PEP 440 (`0.5.0a1`) spellings of
/// the same version to one form, so the Rust shell and the Python package never
/// disagree over punctuation.
pub fn normalize_build_version(raw: &str) -> String {
    let lowered = raw.trim().to_ascii_lowercase();
    let mut text = lowered.strip_prefix('v').unwrap_or(&lowered).to_owned();
    for (long, short) in [
        ("-alpha.", "a"),
        ("-alpha", "a"),
        ("-beta.", "b"),
        ("-beta", "b"),
        ("-rc.", "rc"),
        ("-rc", "rc"),
    ] {
        text = text.replace(long, short);
    }
    text
}

fn non_blank(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

/// Extracts the identity fields from a raw HTTP response (headers + JSON body).
pub fn parse_health_identity(response: &str) -> InstallIdentity {
    let body = response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or(response);
    let (Some(start), Some(end)) = (body.find('{'), body.rfind('}')) else {
        return InstallIdentity::default();
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&body[start..=end]) else {
        return InstallIdentity::default();
    };
    InstallIdentity {
        install_id: non_blank(json.get("install_id")),
        build_version: non_blank(json.get("build_version")),
    }
}

pub fn compare_identity(local: &InstallIdentity, remote: &InstallIdentity) -> IdentityVerdict {
    let mut compared = false;
    if let (Some(ours), Some(theirs)) = (&local.install_id, &remote.install_id) {
        if ours != theirs {
            return IdentityVerdict::Foreign("install_id");
        }
        compared = true;
    }
    if let (Some(ours), Some(theirs)) = (&local.build_version, &remote.build_version) {
        if normalize_build_version(ours) != normalize_build_version(theirs) {
            return IdentityVerdict::Foreign("build_version");
        }
        compared = true;
    }
    if compared {
        IdentityVerdict::Match
    } else {
        IdentityVerdict::Unknown
    }
}

/// This install's identity, from the runtime manifest under `data_root`.
/// Absent manifest (dev builds, first run) yields an empty identity, which makes
/// every comparison `Unknown`.
pub fn local_identity(data_root: Option<&Path>) -> InstallIdentity {
    let Some(root) = data_root else {
        return InstallIdentity::default();
    };
    let path = root.join("state").join("runtime-manifest.json");
    let Ok(text) = std::fs::read_to_string(path) else {
        return InstallIdentity::default();
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
        return InstallIdentity::default();
    };
    InstallIdentity {
        install_id: non_blank(json.get("install_id")),
        build_version: non_blank(json.get("product_version")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(install: Option<&str>, build: Option<&str>) -> InstallIdentity {
        InstallIdentity {
            install_id: install.map(str::to_owned),
            build_version: build.map(str::to_owned),
        }
    }

    #[test]
    fn version_spellings_normalize_to_one_form() {
        assert_eq!(normalize_build_version("0.5.0-alpha.1"), "0.5.0a1");
        assert_eq!(normalize_build_version("0.5.0a1"), "0.5.0a1");
        assert_eq!(normalize_build_version("v0.5.0"), "0.5.0");
        assert_eq!(normalize_build_version(" 0.5.0-rc.2 "), "0.5.0rc2");
        assert_eq!(normalize_build_version("0.5.0-beta.3"), "0.5.0b3");
        assert_ne!(
            normalize_build_version("0.5.0"),
            normalize_build_version("0.5.1")
        );
    }

    #[test]
    fn parses_identity_from_a_raw_http_response() {
        let response = "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n{\"status\":\"ok\",\"engine_alive\":true,\"build_version\":\"0.5.0\",\"install_id\":\"install-1-2\"}";
        assert_eq!(
            parse_health_identity(response),
            id(Some("install-1-2"), Some("0.5.0"))
        );
    }

    #[test]
    fn old_backend_without_the_fields_parses_to_an_empty_identity() {
        let response = "HTTP/1.1 200 OK\r\n\r\n{\"status\":\"ok\",\"engine_alive\":true}";
        assert_eq!(parse_health_identity(response), InstallIdentity::default());
        assert_eq!(parse_health_identity("garbage"), InstallIdentity::default());
    }

    #[test]
    fn null_or_blank_fields_count_as_absent() {
        let response = "HTTP/1.1 200 OK\r\n\r\n{\"engine_alive\":true,\"build_version\":null,\"install_id\":\"  \"}";
        assert_eq!(parse_health_identity(response), InstallIdentity::default());
    }

    #[test]
    fn different_install_id_is_foreign() {
        assert_eq!(
            compare_identity(
                &id(Some("install-a"), Some("0.5.0")),
                &id(Some("install-b"), Some("0.5.0"))
            ),
            IdentityVerdict::Foreign("install_id")
        );
    }

    #[test]
    fn different_build_is_stale() {
        assert_eq!(
            compare_identity(
                &id(Some("install-a"), Some("0.5.0")),
                &id(Some("install-a"), Some("0.4.9"))
            ),
            IdentityVerdict::Foreign("build_version")
        );
    }

    #[test]
    fn punctuation_only_version_difference_still_matches() {
        assert_eq!(
            compare_identity(
                &id(Some("install-a"), Some("0.5.0-alpha.1")),
                &id(Some("install-a"), Some("0.5.0a1"))
            ),
            IdentityVerdict::Match
        );
    }

    #[test]
    fn old_backend_or_unknown_local_is_unknown_not_foreign() {
        let local = id(Some("install-a"), Some("0.5.0"));
        assert_eq!(
            compare_identity(&local, &InstallIdentity::default()),
            IdentityVerdict::Unknown
        );
        assert_eq!(
            compare_identity(&InstallIdentity::default(), &local),
            IdentityVerdict::Unknown
        );
    }

    #[test]
    fn a_single_comparable_field_is_enough_to_match() {
        assert_eq!(
            compare_identity(
                &id(Some("install-a"), None),
                &id(Some("install-a"), Some("0.5.0"))
            ),
            IdentityVerdict::Match
        );
    }

    #[test]
    fn local_identity_reads_the_runtime_manifest_and_tolerates_its_absence() {
        let root = std::env::temp_dir().join(format!(
            "opencohost-identity-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join("state")).unwrap();
        assert_eq!(local_identity(Some(&root)), InstallIdentity::default());
        assert_eq!(local_identity(None), InstallIdentity::default());

        std::fs::write(
            root.join("state").join("runtime-manifest.json"),
            r#"{"install_id":"install-9-9","product_version":"0.5.0-alpha.1","extra":1}"#,
        )
        .unwrap();
        assert_eq!(
            local_identity(Some(&root)),
            id(Some("install-9-9"), Some("0.5.0-alpha.1"))
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
