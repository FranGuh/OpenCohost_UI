//! Release builds have no console, so the shell's own diagnostics (`eprintln!`)
//! go nowhere. This module appends them to the backend log so one file tells the
//! whole startup story. Content-free by contract: callers pass operational text,
//! never chat.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static LOG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Backend log size above which the next spawn rotates it to `<name>.1`.
pub const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

/// Longest log line handed to the UI.
const LAST_LINE_MAX_CHARS: usize = 240;

/// Remembers where the shell log lives (set when the backend log path resolves).
pub fn set_log_path(path: &Path) {
    if let Ok(mut slot) = LOG_PATH.lock() {
        *slot = Some(path.to_path_buf());
    }
}

/// The remembered log path, if any.
pub fn log_path() -> Option<PathBuf> {
    LOG_PATH.lock().ok().and_then(|slot| slot.clone())
}

/// Appends one timestamped line to the log. Never fails the caller.
pub fn log_line(message: &str) {
    // Dev builds keep the console copy; release builds have none.
    eprintln!("{message}");
    let Some(path) = log_path() else {
        return;
    };
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut file) = open_append(&path) {
        let _ = file.write_all(format_line(secs, message).as_bytes());
    }
}

pub fn format_line(epoch_secs: u64, message: &str) -> String {
    let flat = message.replace(['\r', '\n'], " ");
    format!("[shell {epoch_secs}] {flat}\n")
}

/// Rotates `path` to `<path>.1` (replacing an older backup) when it exceeds
/// `max_bytes`. Returns whether it rotated.
pub fn rotate_if_needed(path: &Path, max_bytes: u64) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if meta.len() <= max_bytes {
        return false;
    }
    let mut backup = path.as_os_str().to_owned();
    backup.push(".1");
    let backup = PathBuf::from(backup);
    let _ = std::fs::remove_file(&backup);
    std::fs::rename(path, &backup).is_ok()
}

/// Opens `path` for appending, creating parent directories.
pub fn open_append(path: &Path) -> std::io::Result<std::fs::File> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
}

/// Last non-empty line of the log, trimmed and length-bounded for the UI.
pub fn last_line(path: &Path) -> Option<String> {
    let tail = crate::backend::diagnostics::read_log_tail(path)?;
    let line = tail
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    let mut bounded: String = line.chars().take(LAST_LINE_MAX_CHARS).collect();
    if line.chars().count() > LAST_LINE_MAX_CHARS {
        bounded.push_str("...");
    }
    Some(bounded)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "opencohost-shell-log-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn lines_are_timestamped_and_single_line() {
        let line = format_line(1_700_000_000, "spawn failed\nsecond line");
        assert!(line.starts_with("[shell 1700000000] "));
        assert!(line.ends_with('\n'));
        assert_eq!(
            line.matches('\n').count(),
            1,
            "newlines in the message are flattened"
        );
    }

    #[test]
    fn small_logs_are_not_rotated_and_big_ones_keep_one_backup() {
        let dir = temp_dir("rotate");
        let log = dir.join("backend.log");
        std::fs::write(&log, b"small").unwrap();
        assert!(!rotate_if_needed(&log, 100));
        assert!(log.is_file());

        std::fs::write(&log, vec![b'x'; 200]).unwrap();
        assert!(rotate_if_needed(&log, 100));
        assert!(!log.exists(), "the live log starts fresh");
        assert_eq!(std::fs::read(dir.join("backend.log.1")).unwrap().len(), 200);

        // A second rotation replaces the single backup instead of piling up.
        std::fs::write(&log, vec![b'y'; 300]).unwrap();
        assert!(rotate_if_needed(&log, 100));
        assert_eq!(std::fs::read(dir.join("backend.log.1")).unwrap().len(), 300);
        assert!(!dir.join("backend.log.2").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotating_a_missing_log_is_a_noop() {
        let dir = temp_dir("missing");
        assert!(!rotate_if_needed(&dir.join("nope.log"), 10));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_append_keeps_earlier_content() {
        let dir = temp_dir("append");
        let log = dir.join("nested").join("backend.log");
        writeln!(open_append(&log).unwrap(), "first").unwrap();
        writeln!(open_append(&log).unwrap(), "second").unwrap();
        let text = std::fs::read_to_string(&log).unwrap();
        assert_eq!(text, "first\nsecond\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn last_line_skips_blank_tail_and_bounds_length() {
        let dir = temp_dir("last");
        let log = dir.join("backend.log");
        std::fs::write(&log, "one\nModuleNotFoundError: boom\n\n  \n").unwrap();
        assert_eq!(
            last_line(&log).as_deref(),
            Some("ModuleNotFoundError: boom")
        );

        std::fs::write(&log, format!("{}\n", "z".repeat(1000))).unwrap();
        assert!(last_line(&log).unwrap().chars().count() <= LAST_LINE_MAX_CHARS + 3);

        assert_eq!(last_line(&dir.join("absent.log")), None);
        std::fs::write(&log, "").unwrap();
        assert_eq!(last_line(&log), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
