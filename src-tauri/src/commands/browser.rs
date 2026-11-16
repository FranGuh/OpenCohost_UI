//! Commands for delegating external URLs to the user's default OS browser.
//! Ensures strict protocol validation (`http` and `https` only) to protect
//! against arbitrary execution and shell injection.

use url::Url;

/// Opens an external HTTP or HTTPS URL in the operating system's default browser.
///
/// # Security
/// Only `http` and `https` URLs are allowed. Any other scheme (such as `file:`,
/// `javascript:`, `cmd:`, or protocol handlers that could execute local binaries)
/// is strictly rejected.
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|e| format!("Invalid URL: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only http and https URLs are allowed".into());
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", parsed.as_str()])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Failed to launch default browser: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(parsed.as_str())
            .spawn()
            .map_err(|e| format!("Failed to launch default browser: {e}"))?;
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(parsed.as_str())
            .spawn()
            .map_err(|e| format!("Failed to launch default browser: {e}"))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_http_schemes() {
        assert!(open_external_url("file:///C:/test.txt".into()).is_err());
        assert!(open_external_url("javascript:alert(1)".into()).is_err());
        assert!(open_external_url("cmd.exe".into()).is_err());
        assert!(open_external_url("ftp://example.com".into()).is_err());
    }

    #[test]
    fn validates_valid_urls() {
        let valid_http = Url::parse("http://localhost:8765").unwrap();
        assert_eq!(valid_http.scheme(), "http");

        let valid_https = Url::parse("https://www.tavily.com/?utm_source=opencohost").unwrap();
        assert_eq!(valid_https.scheme(), "https");
    }
}
