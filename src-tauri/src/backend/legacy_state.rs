//! Preserve embedded state byte-for-byte before selecting an external runtime.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(test)]
#[path = "legacy_state_tests.rs"]
mod tests;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    relative: PathBuf,
    hash: String,
}

#[derive(PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PendingAdoption {
    schema_version: u32,
    source_root: PathBuf,
    destination_root: PathBuf,
    group: PathBuf,
    files: Vec<Entry>,
}

fn invalid() -> io::Error {
    io::Error::other("Embedded state preservation could not verify a safe, unchanged file")
}

// Reject links at every existing component, including a junction above a root.
fn check_path(root: &Path, path: &Path) -> io::Result<()> {
    if !path.is_absolute()
        || !path.starts_with(root)
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(invalid());
    }
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) => {
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if metadata.file_attributes() & 0x400 != 0 {
                        return Err(invalid());
                    }
                }
                if metadata.file_type().is_symlink() {
                    return Err(invalid());
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    if path.exists() && !fs::canonicalize(path)?.starts_with(fs::canonicalize(root)?) {
        return Err(invalid());
    }
    Ok(())
}

fn open_source(root: &Path, path: &Path) -> io::Result<File> {
    check_path(root, path)?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Do not follow a leaf reparse point or permit a writer during this read.
        options.custom_flags(0x00200000).share_mode(1);
    }
    let file = options.open(path)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if file.metadata()?.file_attributes() & 0x400 != 0 {
            return Err(invalid());
        }
    }
    if !file.metadata()?.is_file() {
        return Err(invalid());
    }
    Ok(file)
}

fn file_hash(root: &Path, path: &Path) -> io::Result<String> {
    let mut file = open_source(root, path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let size = file.read(&mut buffer)?;
        if size == 0 {
            break;
        }
        digest.update(&buffer[..size]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn matches_child_name(actual: &std::ffi::OsStr, expected: &str) -> bool {
    if cfg!(windows) {
        actual.to_string_lossy().eq_ignore_ascii_case(expected)
    } else {
        actual == expected
    }
}

fn collect(root: &Path, path: &Path, entries: &mut Vec<Entry>) -> io::Result<()> {
    check_path(root, path)?;
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if metadata.is_dir() {
        let is_data_dir = path == root.join("data");
        let is_config_dir = path == root.join("config");
        for child in fs::read_dir(path)? {
            let child = child?;
            let name = child.file_name();
            if name == ".gitkeep" {
                continue;
            }
            if is_data_dir
                && ["memorias", "memory_v5_shadow"]
                    .iter()
                    .any(|skipped| matches_child_name(&name, skipped))
            {
                continue;
            }
            if is_config_dir
                && [
                    "default_profiles.json",
                    "setup_state.json",
                    "setup_checkpoint.json",
                    "memorias_notice.json",
                ]
                .iter()
                .any(|skipped| matches_child_name(&name, skipped))
            {
                continue;
            }
            collect(root, &child.path(), entries)?;
        }
    } else {
        entries.push(Entry {
            relative: path
                .strip_prefix(root)
                .map_err(|_| invalid())?
                .to_path_buf(),
            hash: file_hash(root, path)?,
        });
    }
    Ok(())
}

fn inventory(root: &Path, root_configuration: bool) -> io::Result<Vec<Entry>> {
    let mut entries = Vec::new();
    for name in [
        "perfiles.json",
        "cohost_profiles.json",
        "cards.db",
        "data",
        "assets",
        "user",
    ] {
        collect(root, &root.join(name), &mut entries)?;
    }
    // Package/config contains shipped Python modules and YAML defaults, not
    // the writable runtime/config directory scanned by the original guard.
    if root_configuration {
        collect(root, &root.join("config"), &mut entries)?;
    }
    // Root-level SQLite sidecars must travel with their database, too.
    for suffix in ["-wal", "-shm", "-journal"] {
        collect(root, &root.join(format!("cards.db{suffix}")), &mut entries)?;
    }
    entries.sort_by(|left, right| left.relative.cmp(&right.relative));
    Ok(entries)
}

fn group_key(relative: &Path) -> PathBuf {
    let name = relative.file_name().unwrap().to_string_lossy();
    for suffix in ["-wal", "-shm", "-journal"] {
        if let Some(base) = name.strip_suffix(suffix) {
            if Path::new(base).extension().is_some_and(|ext| {
                ["db", "sqlite", "sqlite3"]
                    .iter()
                    .any(|candidate| ext.eq_ignore_ascii_case(candidate))
            }) {
                return relative.with_file_name(base);
            }
        }
    }
    relative.to_path_buf()
}

fn ensure_directory(root: &Path, path: &Path) -> io::Result<()> {
    check_path(root, path)?;
    fs::create_dir_all(path)?;
    check_path(root, path)
}

#[cfg(windows)]
fn publish_no_replace(temporary: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    // Canonical parents supply extended-length paths without following a
    // missing destination. MoveFileW refuses to replace an existing name.
    let source = fs::canonicalize(temporary)?;
    let destination = fs::canonicalize(destination.parent().ok_or_else(invalid)?)?
        .join(destination.file_name().ok_or_else(invalid)?);
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    if unsafe {
        windows_sys::Win32::Storage::FileSystem::MoveFileW(source.as_ptr(), destination.as_ptr())
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(windows))]
fn publish_no_replace(temporary: &Path, destination: &Path) -> io::Result<()> {
    fs::hard_link(temporary, destination)
}

fn is_secret_relative(relative: &Path) -> bool {
    let normalized = relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/");
    const SECRET_RELATIVES: [&str; 4] = [
        "config/llm_keys.json",
        "config/api_tokens.json",
        "data/stream_admin/oauth_tokens.json",
        "data/stream_admin/oauth_client.json",
    ];
    SECRET_RELATIVES.iter().any(|candidate| {
        if cfg!(windows) {
            normalized.eq_ignore_ascii_case(candidate)
        } else {
            normalized == *candidate
        }
    })
}

fn secret_selection_key(key: &Path) -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(key.to_string_lossy().to_ascii_lowercase())
    } else {
        key.to_path_buf()
    }
}

#[cfg(windows)]
fn extract_windows_sid(output: &str) -> Option<String> {
    let start = output.find("S-1-")?;
    let rest = &output[start + 4..];
    let sid_tail: String = rest
        .chars()
        .take_while(|ch| ch.is_ascii_digit() || *ch == '-')
        .collect();
    let trimmed = sid_tail.trim_end_matches('-');
    if !trimmed.is_empty()
        && trimmed
            .split('-')
            .all(|segment| !segment.is_empty() && segment.bytes().all(|b| b.is_ascii_digit()))
    {
        Some(format!("*S-1-{trimmed}"))
    } else {
        None
    }
}

#[cfg(windows)]
fn current_windows_principal() -> Option<String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    if let Ok(output) = Command::new("whoami")
        .args(["/user", "/fo", "csv", "/nh"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(sid) = extract_windows_sid(&stdout) {
                return Some(sid);
            }
        }
    }
    std::env::var("USERNAME")
        .ok()
        .filter(|name| !name.trim().is_empty())
}

#[cfg(windows)]
fn restrict_file_permissions(path: &Path) -> io::Result<()> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let principal = current_windows_principal()
        .ok_or_else(|| io::Error::other("Could not determine current user for secret ACL"))?;
    let path_text = path.to_string_lossy();
    let target = path_text.strip_prefix(r"\\?\").unwrap_or(&path_text);
    let output = Command::new("icacls")
        .arg(target)
        .args(["/inheritance:r", "/grant:r"])
        .arg(format!("{principal}:(R,W,D)"))
        .creation_flags(CREATE_NO_WINDOW)
        .output()?;
    if !output.status.success() {
        return Err(io::Error::other(
            "icacls failed to restrict secret file permissions",
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn restrict_file_permissions(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
}

// Stage + verify, then publish without replacing any existing destination.
fn publish_verified(
    destination_root: &Path,
    destination: &Path,
    expected: &str,
    write: impl FnOnce(&mut File) -> io::Result<()>,
) -> io::Result<()> {
    publish_verified_impl(destination_root, destination, expected, false, write)
}

fn publish_verified_secret(
    destination_root: &Path,
    destination: &Path,
    expected: &str,
    write: impl FnOnce(&mut File) -> io::Result<()>,
) -> io::Result<()> {
    publish_verified_impl(destination_root, destination, expected, true, write)
}

fn publish_verified_impl(
    destination_root: &Path,
    destination: &Path,
    expected: &str,
    restrict_acl: bool,
    write: impl FnOnce(&mut File) -> io::Result<()>,
) -> io::Result<()> {
    check_path(destination_root, destination)?;
    if destination.exists() {
        if restrict_acl {
            return Ok(());
        }
        return if file_hash(destination_root, destination)? == expected {
            Ok(())
        } else {
            Err(invalid())
        };
    }
    ensure_directory(destination_root, destination.parent().ok_or_else(invalid)?)?;
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let temporary = destination.with_file_name(format!(
        ".preserving-{}-{}.tmp",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    let result = (|| {
        if restrict_acl {
            restrict_file_permissions(&temporary)?;
        }
        write(&mut output)?;
        output.flush()?;
        output.sync_all()?;
        drop(output);
        if file_hash(destination_root, &temporary)? != expected {
            return Err(invalid());
        }
        check_path(destination_root, destination)?;
        match publish_no_replace(&temporary, destination) {
            Ok(()) => {
                if file_hash(destination_root, destination)? != expected {
                    return Err(invalid());
                }
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                if !restrict_acl && file_hash(destination_root, destination)? != expected {
                    return Err(invalid());
                }
            }
            Err(error) => return Err(error),
        }
        Ok(())
    })();
    let cleanup = match fs::remove_file(&temporary) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    };
    result.and(cleanup)
}

fn copy_verified_with(
    source_root: &Path,
    source: &Path,
    destination_root: &Path,
    destination: &Path,
    expected: &str,
    restrict_acl: bool,
) -> io::Result<()> {
    let write = |output: &mut File| {
        let mut input = open_source(source_root, source)?;
        io::copy(&mut input, output)?;
        if file_hash(source_root, source)? != expected {
            return Err(invalid());
        }
        Ok(())
    };
    if restrict_acl {
        publish_verified_secret(destination_root, destination, expected, write)
    } else {
        publish_verified(destination_root, destination, expected, write)
    }
}

fn copy_verified(
    source_root: &Path,
    source: &Path,
    destination_root: &Path,
    destination: &Path,
    expected: &str,
) -> io::Result<()> {
    copy_verified_with(
        source_root,
        source,
        destination_root,
        destination,
        expected,
        false,
    )
}

fn copy_verified_secret(
    source_root: &Path,
    source: &Path,
    destination_root: &Path,
    destination: &Path,
    expected: &str,
) -> io::Result<()> {
    copy_verified_with(
        source_root,
        source,
        destination_root,
        destination,
        expected,
        true,
    )
}

fn read_pending(root: &Path, path: &Path) -> io::Result<PendingAdoption> {
    let mut bytes = Vec::new();
    open_source(root, path)?
        .take(1_048_577)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 1_048_576 {
        return Err(invalid());
    }
    serde_json::from_slice(&bytes).map_err(|_| invalid())
}

fn pending_adoptions(root: &Path) -> io::Result<BTreeMap<PathBuf, (PathBuf, PendingAdoption)>> {
    let mut pending = BTreeMap::new();
    for origin in ["runtime-root", "package-root"] {
        let directory = root.join("legacy-preserved").join(origin);
        check_path(root, &directory)?;
        if !directory.exists() {
            continue;
        }
        for entry in fs::read_dir(directory)? {
            let snapshot = entry?.path();
            check_path(root, &snapshot)?;
            if !snapshot.is_dir() {
                continue;
            }
            let path = snapshot.join(".adoption-pending.json");
            check_path(root, &path)?;
            if path.exists() {
                let record = read_pending(root, &path)?;
                if pending
                    .insert(record.group.clone(), (path, record))
                    .is_some()
                {
                    return Err(invalid());
                }
            }
        }
    }
    Ok(pending)
}

fn sqlite_members(key: &Path) -> Vec<PathBuf> {
    let mut members = vec![key.to_path_buf()];
    for suffix in ["-wal", "-shm", "-journal"] {
        members.push(key.with_file_name(format!(
            "{}{suffix}",
            key.file_name().unwrap().to_string_lossy()
        )));
    }
    members
}

fn verify_owned_partial(root: &Path, key: &Path, group: &[&Entry]) -> io::Result<()> {
    for relative in sqlite_members(key) {
        let destination = root.join(&relative);
        check_path(root, &destination)?;
        if destination.exists() {
            let expected = group
                .iter()
                .find(|entry| entry.relative == relative)
                .ok_or_else(invalid)?;
            if file_hash(root, &destination)? != expected.hash {
                return Err(invalid());
            }
        }
    }
    if root.join(key).exists()
        && group
            .iter()
            .any(|entry| !root.join(&entry.relative).exists())
    {
        return Err(invalid());
    }
    Ok(())
}

fn adopt_sqlite(
    root: &Path,
    source: &Path,
    snapshot: &Path,
    key: &Path,
    group: &[&Entry],
    owned: Option<(PathBuf, PendingAdoption)>,
) -> io::Result<()> {
    let pending = snapshot.join(".adoption-pending.json");
    if !group.iter().any(|entry| entry.relative == key) {
        return if owned.is_some() {
            Err(invalid())
        } else {
            Ok(())
        };
    }
    let expected = PendingAdoption {
        schema_version: 1,
        source_root: source.to_path_buf(),
        destination_root: root.to_path_buf(),
        group: key.to_path_buf(),
        files: group.iter().map(|entry| (*entry).clone()).collect(),
    };
    if let Some((path, record)) = owned {
        if path != pending || record != expected {
            return Err(invalid());
        }
    } else {
        if pending.exists() {
            return Err(invalid());
        }
        for member in sqlite_members(key) {
            let destination = root.join(member);
            check_path(root, &destination)?;
            // Existing external state wins even when its bytes match a legacy
            // checkpoint. A matching main file does not authorize adding WAL.
            if destination.exists() {
                return Ok(());
            }
        }
        let bytes = serde_json::to_vec(&expected).map_err(|_| invalid())?;
        let hash = format!("{:x}", Sha256::digest(&bytes));
        publish_verified(root, &pending, &hash, |output| output.write_all(&bytes))?;
    }
    verify_owned_partial(root, key, group)?;
    // Main last: an interruption leaves only explicitly owned sidecars, never
    // an apparently complete new database without its committed transactions.
    let mut ordered = group.to_vec();
    ordered.sort_by_key(|entry| entry.relative == key);
    for entry in ordered {
        copy_verified(
            root,
            &snapshot.join(&entry.relative),
            root,
            &root.join(&entry.relative),
            &entry.hash,
        )?;
    }
    verify_owned_partial(root, key, group)?;
    for entry in group {
        if file_hash(root, &root.join(&entry.relative))? != entry.hash {
            return Err(invalid());
        }
    }
    if read_pending(root, &pending)? != expected {
        return Err(invalid());
    }
    fs::remove_file(pending)
}

pub(crate) fn validate_root(data_root: &Path) -> io::Result<()> {
    check_path(data_root, data_root)
}

pub(crate) fn preserve(runtime: &Path, data_root: &Path) -> io::Result<()> {
    check_path(runtime, runtime)?;
    check_path(data_root, data_root)?;
    let mut pending = pending_adoptions(data_root)?;
    let roots = [
        ("runtime-root", runtime.to_path_buf(), true),
        ("package-root", runtime.join("opencohost"), false),
    ];
    let inventories = roots
        .iter()
        .map(|(_, root, configuration)| inventory(root, *configuration))
        .collect::<io::Result<Vec<_>>>()?;
    // Root-first precedence. Never merge JSON or SQLite: a conflicting member
    // preserves the whole database/sidecar group without adopting any of it.
    let mut selected = BTreeSet::new();
    for ((origin, root, _), entries) in roots.iter().zip(&inventories) {
        let mut groups: BTreeMap<PathBuf, Vec<&Entry>> = BTreeMap::new();
        for entry in entries {
            groups
                .entry(group_key(&entry.relative))
                .or_default()
                .push(entry);
        }
        for (key, group) in &groups {
            if group.iter().any(|entry| is_secret_relative(&entry.relative)) {
                if !selected.insert(secret_selection_key(key)) {
                    continue;
                }
                for entry in group {
                    let destination = data_root.join(&entry.relative);
                    check_path(data_root, &destination)?;
                    if destination.exists() {
                        continue;
                    }
                    copy_verified_secret(
                        root,
                        &root.join(&entry.relative),
                        data_root,
                        &destination,
                        &entry.hash,
                    )?;
                }
                continue;
            }
            let mut digest = Sha256::new();
            digest.update(root.to_str().ok_or_else(invalid)?.as_bytes());
            for entry in group {
                digest.update([0]);
                digest.update(entry.relative.to_str().ok_or_else(invalid)?.as_bytes());
                digest.update(entry.hash.as_bytes());
            }
            let snapshot = data_root
                .join("legacy-preserved")
                .join(origin)
                .join(format!("{:x}", digest.finalize()));
            for entry in group {
                copy_verified(
                    root,
                    &root.join(&entry.relative),
                    data_root,
                    &snapshot.join(&entry.relative),
                    &entry.hash,
                )?;
            }
            if !selected.insert(key.clone()) {
                continue;
            }
            if key.extension().is_some_and(|ext| {
                ["db", "sqlite", "sqlite3"]
                    .iter()
                    .any(|candidate| ext.eq_ignore_ascii_case(candidate))
            }) {
                adopt_sqlite(data_root, root, &snapshot, key, group, pending.remove(key))?;
                continue;
            }
            let mut conflict = false;
            for entry in group {
                let destination = data_root.join(&entry.relative);
                check_path(data_root, &destination)?;
                if destination.exists() && file_hash(data_root, &destination)? != entry.hash {
                    conflict = true;
                }
            }
            if !conflict {
                for entry in group {
                    copy_verified(
                        data_root,
                        &snapshot.join(&entry.relative),
                        data_root,
                        &data_root.join(&entry.relative),
                        &entry.hash,
                    )?;
                }
            }
        }
    }
    for ((_, root, configuration), before) in roots.iter().zip(&inventories) {
        if inventory(root, *configuration)? != *before {
            return Err(invalid());
        }
    }
    if !pending.is_empty() || !pending_adoptions(data_root)?.is_empty() {
        return Err(invalid());
    }
    Ok(())
}
