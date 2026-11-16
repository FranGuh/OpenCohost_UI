use super::*;
use std::process::Command;

fn python() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join(".venv/Scripts/python.exe")
}

fn sqlite_fixture(active: bool) -> (PathBuf, PathBuf) {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let root = std::env::temp_dir().join(format!(
        "opencohost-sqlite-preservation-{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let runtime = root.join("runtime");
    let external = root.join("external");
    let output = Command::new(python())
        .args([
            "-B",
            "-c",
            r#"
from pathlib import Path
import shutil, sqlite3, sys
root = Path(sys.argv[1])
source = root / 'runtime/opencohost/data/smart_aggregator'
destination = root / 'external/data/smart_aggregator'
source.mkdir(parents=True)
destination.mkdir(parents=True)
working = root / 'working.db'
connection = sqlite3.connect(working)
connection.execute('PRAGMA journal_mode=WAL')
connection.execute('PRAGMA wal_autocheckpoint=0')
connection.execute('CREATE TABLE records(value TEXT)')
connection.execute("INSERT INTO records VALUES ('active checkpoint')")
connection.commit()
connection.execute('PRAGMA wal_checkpoint(TRUNCATE)')
shutil.copyfile(working, source / 'sessions.db')
if sys.argv[2] == 'true':
    shutil.copyfile(working, destination / 'sessions.db')
connection.execute("INSERT INTO records VALUES ('legacy-only transaction')")
connection.commit()
for suffix in ('-wal', '-shm'):
    shutil.copyfile(str(working) + suffix, source / ('sessions.db' + suffix))
connection.close()
"#,
        ])
        .arg(&root)
        .arg(active.to_string())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    (runtime, external)
}

fn records(database: &Path) -> Vec<String> {
    let output = Command::new(python()).args(["-B", "-c", "import json,sqlite3,sys; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); print(json.dumps([r[0] for r in c.execute('SELECT value FROM records ORDER BY rowid')])); c.close()"])
        .arg(database).output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

// Reproduce the on-disk boundary after a durable intent and first sidecar,
// before main-file publication. No SQLite connection opens the source/snapshot.
fn interrupted_after_sidecar(runtime: &Path, external: &Path) -> PathBuf {
    let source = runtime.join("opencohost");
    let entries = inventory(&source, false).unwrap();
    let mut digest = Sha256::new();
    digest.update(source.to_str().unwrap().as_bytes());
    for entry in &entries {
        digest.update([0]);
        digest.update(entry.relative.to_str().unwrap().as_bytes());
        digest.update(entry.hash.as_bytes());
    }
    let snapshot = external
        .join("legacy-preserved/package-root")
        .join(format!("{:x}", digest.finalize()));
    for entry in &entries {
        let destination = snapshot.join(&entry.relative);
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        fs::copy(source.join(&entry.relative), destination).unwrap();
    }
    let pending = snapshot.join(".adoption-pending.json");
    let files: Vec<_> = entries
        .iter()
        .map(|entry| serde_json::json!({"relative": entry.relative, "hash": entry.hash}))
        .collect();
    fs::write(
        &pending,
        serde_json::to_vec(&serde_json::json!({
            "schema_version": 1, "source_root": source, "destination_root": external,
            "group": "data/smart_aggregator/sessions.db", "files": files
        }))
        .unwrap(),
    )
    .unwrap();
    fs::copy(
        snapshot.join("data/smart_aggregator/sessions.db-wal"),
        external.join("data/smart_aggregator/sessions.db-wal"),
    )
    .unwrap();
    pending
}

#[test]
fn existing_identical_active_database_never_receives_legacy_wal() {
    let (runtime, external) = sqlite_fixture(true);
    let active = external.join("data/smart_aggregator/sessions.db");
    let source = runtime.join("opencohost/data/smart_aggregator/sessions.db");
    let before = fs::read(&active).unwrap();
    assert_eq!(before, fs::read(&source).unwrap());

    preserve(&runtime, &external).unwrap();

    let legacy_wal_published = external
        .join("data/smart_aggregator/sessions.db-wal")
        .exists();
    assert_eq!(
        records(&active),
        vec!["active checkpoint"],
        "An existing active group must not receive legacy transactions"
    );
    assert_eq!(fs::read(&active).unwrap(), before);
    assert!(
        !legacy_wal_published,
        "Inspect publication before the SQLite reader creates its own empty WAL"
    );
    assert_eq!(fs::read(source).unwrap(), before);
}

#[test]
fn interrupted_sidecar_publication_resumes_only_owned_group_and_retires_pending() {
    let (runtime, external) = sqlite_fixture(false);
    let pending = interrupted_after_sidecar(&runtime, &external);
    let active = external.join("data/smart_aggregator/sessions.db");
    assert!(!active.exists());

    preserve(&runtime, &external).unwrap();

    assert!(
        !pending.exists(),
        "Complete group verification must retire pending ownership"
    );
    assert_eq!(
        records(&active),
        vec!["active checkpoint", "legacy-only transaction"]
    );
    preserve(&runtime, &external).unwrap();
    assert_eq!(
        records(&active),
        vec!["active checkpoint", "legacy-only transaction"]
    );
}

#[test]
fn owned_partial_divergence_blocks_without_overwrite_or_pending_removal() {
    let (runtime, external) = sqlite_fixture(false);
    let pending = interrupted_after_sidecar(&runtime, &external);
    let record = fs::read(&pending).unwrap();
    let sidecar = external.join("data/smart_aggregator/sessions.db-wal");
    fs::write(&sidecar, b"external divergent transaction").unwrap();

    assert!(preserve(&runtime, &external).is_err());

    assert_eq!(
        fs::read(sidecar).unwrap(),
        b"external divergent transaction"
    );
    assert_eq!(fs::read(pending).unwrap(), record);
    assert!(!external.join("data/smart_aggregator/sessions.db").exists());
}

#[test]
fn unowned_identical_sidecar_never_authorizes_database_adoption() {
    let (runtime, external) = sqlite_fixture(false);
    let sidecar = external.join("data/smart_aggregator/sessions.db-wal");
    fs::copy(
        runtime.join("opencohost/data/smart_aggregator/sessions.db-wal"),
        &sidecar,
    )
    .unwrap();
    let before = fs::read(&sidecar).unwrap();

    preserve(&runtime, &external).unwrap();

    assert!(!external.join("data/smart_aggregator/sessions.db").exists());
    assert_eq!(fs::read(sidecar).unwrap(), before);
}

#[test]
fn owned_main_without_complete_sidecars_is_not_resumed_as_partial_adoption() {
    let (runtime, external) = sqlite_fixture(false);
    let pending = interrupted_after_sidecar(&runtime, &external);
    let record = fs::read(&pending).unwrap();
    let active = external.join("data/smart_aggregator/sessions.db");
    fs::copy(
        runtime.join("opencohost/data/smart_aggregator/sessions.db"),
        &active,
    )
    .unwrap();
    fs::remove_file(external.join("data/smart_aggregator/sessions.db-wal")).unwrap();

    assert!(
        preserve(&runtime, &external).is_err(),
        "Main-last publication cannot produce a main file with missing expected sidecars"
    );

    assert_eq!(fs::read(pending).unwrap(), record);
    assert!(!external
        .join("data/smart_aggregator/sessions.db-wal")
        .exists());
    assert_eq!(records(&active), vec!["active checkpoint"]);
}

#[cfg(windows)]
#[test]
fn windows_publication_moves_new_file_and_never_replaces_existing_destination() {
    let (runtime, _) = sqlite_fixture(false);
    let staged = runtime.join("staged.tmp");
    let destination = runtime.join("destination.bin");
    fs::write(&staged, b"staged").unwrap();
    fs::write(&destination, b"existing").unwrap();
    assert!(publish_no_replace(&staged, &destination).is_err());
    assert_eq!(fs::read(&destination).unwrap(), b"existing");
    assert_eq!(fs::read(&staged).unwrap(), b"staged");
    let fresh = runtime.join("fresh.bin");
    publish_no_replace(&staged, &fresh).unwrap();
    assert!(!staged.exists());
    assert_eq!(fs::read(fresh).unwrap(), b"staged");
}

fn secret_test_root(label: &str) -> (PathBuf, PathBuf, PathBuf) {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let root = std::env::temp_dir().join(format!(
        "opencohost-secret-preservation-{label}-{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let runtime = root.join("runtime");
    let data_root = root.join("data_root");
    fs::create_dir_all(&runtime).unwrap();
    fs::create_dir_all(&data_root).unwrap();
    (root, runtime, data_root)
}

fn collect_files_recursive(dir: &Path, out: &mut Vec<PathBuf>) {
    if !dir.exists() {
        return;
    }
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            collect_files_recursive(&path, out);
        } else {
            out.push(path);
        }
    }
}

#[cfg(windows)]
fn assert_restricted_windows_acl(path: &Path) {
    let output = Command::new("icacls").arg(path).output().unwrap();
    assert!(
        output.status.success(),
        "icacls must succeed for {}: {}",
        path.display(),
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    let normalized_path = path.to_string_lossy().replace('/', "\\");
    let ace_lines: Vec<&str> = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("Successfully processed"))
        .map(|line| {
            let trimmed = line.strip_prefix(path.to_string_lossy().as_ref())
                .or_else(|| line.strip_prefix(&normalized_path))
                .unwrap_or(line);
            trimmed.trim()
        })
        .filter(|line| !line.is_empty())
        .collect();
    assert!(
        !ace_lines.is_empty(),
        "expected explicit ACE entries for {}, got:\n{stdout}",
        path.display()
    );
    for ace in &ace_lines {
        assert!(
            !ace.contains("(I)"),
            "secret file {} must disable inherited permissions, got:\n{stdout}",
            path.display()
        );
        let lower = ace.to_ascii_lowercase();
        for forbidden in [
            "builtin\\users",
            "builtin\\usuarios",
            "authenticated",
            "autentificados",
            "everyone",
            "todos",
        ] {
            assert!(
                !lower.contains(forbidden),
                "secret file {} must not grant access to {forbidden}, got:\n{stdout}",
                path.display()
            );
        }
    }
    assert_eq!(
        ace_lines.len(),
        1,
        "secret file {} must only have the current user's explicit ACE, got:\n{stdout}",
        path.display()
    );
}

#[test]
fn secrets_are_migrated_once_with_restricted_acl_and_never_copied_to_legacy_preserved() {
    let (root, runtime, data_root) = secret_test_root("fresh");
    let secrets: [(&str, &[u8]); 4] = [
        ("config/llm_keys.json", br#"{"openai":"sk-test-llm-secret"}"#),
        (
            "config/api_tokens.json",
            br#"{"operator":"secret-operator-token","agent":"secret-agent-token"}"#,
        ),
        (
            "data/stream_admin/oauth_tokens.json",
            br#"{"twitch":{"access_token":"secret-oauth"}}"#,
        ),
        (
            "data/stream_admin/oauth_client.json",
            br#"{"twitch":{"client_secret":"secret-client"}}"#,
        ),
    ];
    for (rel, bytes) in secrets {
        let src = runtime.join(rel);
        fs::create_dir_all(src.parent().unwrap()).unwrap();
        fs::write(&src, bytes).unwrap();
    }
    // Nested package-root duplicate must lose to root-first and never enter legacy-preserved.
    let nested_oauth = runtime.join("opencohost/data/stream_admin/oauth_tokens.json");
    fs::create_dir_all(nested_oauth.parent().unwrap()).unwrap();
    fs::write(&nested_oauth, br#"{"twitch":{"access_token":"nested-older"}}"#).unwrap();
    // Non-secret state alongside secrets continues to be preserved normally.
    fs::write(runtime.join("perfiles.json"), br#"{"profiles":{}}"#).unwrap();

    preserve(&runtime, &data_root).unwrap();

    let mut preserved = Vec::new();
    collect_files_recursive(&data_root.join("legacy-preserved"), &mut preserved);
    for (rel, _) in secrets {
        let filename = Path::new(rel).file_name().unwrap();
        assert!(
            !preserved.iter().any(|p| p.file_name() == Some(filename)),
            "secret {} must never appear in legacy-preserved/: {:?}",
            rel,
            preserved
        );
    }
    assert!(
        preserved
            .iter()
            .any(|p| p.file_name() == Some(std::ffi::OsStr::new("perfiles.json"))),
        "non-secret files must still be preserved in legacy-preserved/"
    );

    for (rel, expected_bytes) in secrets {
        let live = data_root.join(rel);
        assert!(live.is_file(), "expected live secret at {}", live.display());
        assert_eq!(fs::read(&live).unwrap(), expected_bytes);
        #[cfg(windows)]
        assert_restricted_windows_acl(&live);
    }

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn existing_live_secrets_are_untouched_and_never_duplicated_to_legacy_preserved() {
    let (root, runtime, data_root) = secret_test_root("existing");
    let pairs: [(&str, &[u8], &[u8]); 4] = [
        (
            "config/llm_keys.json",
            br#"{"openai":"sk-legacy-plaintext"}"#,
            b"{}\n",
        ),
        (
            "config/api_tokens.json",
            br#"{"operator":"legacy-token"}"#,
            br#"{"operator":"rotated-live-token"}"#,
        ),
        (
            "data/stream_admin/oauth_tokens.json",
            br#"{"twitch":{"access_token":"legacy-oauth"}}"#,
            br#"{"twitch":{"access_token":"refreshed-live-oauth"}}"#,
        ),
        (
            "data/stream_admin/oauth_client.json",
            br#"{"twitch":{"client_secret":"legacy-client"}}"#,
            br#"{"twitch":{"client_secret":"updated-live-client"}}"#,
        ),
    ];
    for (rel, legacy_bytes, live_bytes) in pairs {
        let src = runtime.join(rel);
        let dst = data_root.join(rel);
        fs::create_dir_all(src.parent().unwrap()).unwrap();
        fs::create_dir_all(dst.parent().unwrap()).unwrap();
        fs::write(&src, legacy_bytes).unwrap();
        fs::write(&dst, live_bytes).unwrap();
    }

    preserve(&runtime, &data_root).unwrap();

    for (rel, _, live_bytes) in pairs {
        assert_eq!(fs::read(data_root.join(rel)).unwrap(), live_bytes);
    }
    let mut preserved = Vec::new();
    collect_files_recursive(&data_root.join("legacy-preserved"), &mut preserved);
    assert!(
        preserved.is_empty(),
        "no secret files may be copied into legacy-preserved/, found: {:?}",
        preserved
    );

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn memories_and_setup_state_are_never_copied_to_data_root_or_legacy_preserved() {
    let (root, runtime, data_root) = secret_test_root("omit-memories-and-setup");
    let omitted: [(&str, &[u8]); 11] = [
        ("memorias.json", br#"{"facts":["legacy"]}"#),
        ("memory.db", b"legacy-memory-db"),
        ("memory.db-wal", b"legacy-memory-wal"),
        ("memory.db-shm", b"legacy-memory-shm"),
        ("memory.db-journal", b"legacy-memory-journal"),
        ("data/memorias/memorias.db", b"legacy-memorias-db"),
        (
            "data/memory_v5_shadow/memory_v5_shadow.db",
            b"legacy-v5-shadow-db",
        ),
        ("config/setup_state.json", br#"{"completed":true}"#),
        ("config/setup_checkpoint.json", br#"{"step":"done"}"#),
        ("config/memorias_notice.json", br#"{"seen":true}"#),
        ("config/default_profiles.json", br#"{"default":true}"#),
    ];
    for (rel, bytes) in omitted {
        let src = runtime.join(rel);
        fs::create_dir_all(src.parent().unwrap()).unwrap();
        fs::write(&src, bytes).unwrap();
    }
    let package_omitted: [(&str, &[u8]); 4] = [
        ("opencohost/memorias.json", br#"{"facts":["pkg"]}"#),
        ("opencohost/memory.db", b"pkg-memory-db"),
        ("opencohost/data/memorias/memorias.db", b"pkg-memorias-db"),
        (
            "opencohost/data/memory_v5_shadow/memory_v5_shadow.db",
            b"pkg-v5-shadow-db",
        ),
    ];
    for (rel, bytes) in package_omitted {
        let src = runtime.join(rel);
        fs::create_dir_all(src.parent().unwrap()).unwrap();
        fs::write(&src, bytes).unwrap();
    }

    preserve(&runtime, &data_root).unwrap();

    for rel in [
        "memorias.json",
        "memory.db",
        "memory.db-wal",
        "memory.db-shm",
        "memory.db-journal",
        "data/memorias/memorias.db",
        "data/memory_v5_shadow/memory_v5_shadow.db",
        "config/setup_state.json",
        "config/setup_checkpoint.json",
        "config/memorias_notice.json",
        "config/default_profiles.json",
    ] {
        assert!(
            !data_root.join(rel).exists(),
            "omitted file {} must never be adopted into data_root",
            rel
        );
    }

    let mut preserved = Vec::new();
    collect_files_recursive(&data_root.join("legacy-preserved"), &mut preserved);
    assert!(
        preserved.is_empty(),
        "memories and setup state must never be copied into legacy-preserved/, found: {:?}",
        preserved
    );

    for (rel, bytes) in omitted {
        assert_eq!(fs::read(runtime.join(rel)).unwrap(), bytes);
    }
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn non_memory_030_state_is_preserved_and_adopted_to_data_root() {
    let (root, runtime, data_root) = secret_test_root("adopt-non-memory");
    let items: [(&str, &[u8]); 12] = [
        ("perfiles.json", br#"{"profiles":{"kira":{"name":"Kira"}}}"#),
        ("cohost_profiles.json", br#"{"active":"streamer"}"#),
        ("cards.db", b"root-cards-db"),
        ("cards.db-wal", b"root-cards-wal"),
        ("data/editorial_cards/cards.db", b"editorial-cards-db"),
        (
            "data/smart_aggregator/sessions.db",
            b"smart-aggregator-sessions",
        ),
        ("assets/music/theme.mp3", b"mp3-bytes"),
        ("assets/avatar/kira/custom.png", b"png-bytes"),
        ("config/locale.json", br#"{"locale":"en"}"#),
        ("config/piper_voice.json", br#"{"voice":"en_US-amy-medium"}"#),
        ("config/personalization.json", br#"{"nickname":"Owner"}"#),
        ("config/llm_provider.json", br#"{"active_provider":"openai"}"#),
    ];
    for (rel, bytes) in items {
        let src = runtime.join(rel);
        fs::create_dir_all(src.parent().unwrap()).unwrap();
        fs::write(&src, bytes).unwrap();
    }

    preserve(&runtime, &data_root).unwrap();

    let mut preserved = Vec::new();
    collect_files_recursive(&data_root.join("legacy-preserved"), &mut preserved);
    for (rel, expected_bytes) in items {
        let live = data_root.join(rel);
        assert!(
            live.is_file(),
            "expected non-memory file {} to be adopted at {}",
            rel,
            live.display()
        );
        assert_eq!(fs::read(&live).unwrap(), expected_bytes);
        let rel_path = Path::new(rel);
        assert!(
            preserved
                .iter()
                .any(|p| p.ends_with(rel_path) && fs::read(p).unwrap() == expected_bytes),
            "expected {} to also be backed up in legacy-preserved/: {:?}",
            rel,
            preserved
        );
        assert_eq!(fs::read(runtime.join(rel)).unwrap(), expected_bytes);
    }

    let _ = fs::remove_dir_all(&root);
}
