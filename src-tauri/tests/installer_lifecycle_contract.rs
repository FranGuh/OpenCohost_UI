use std::fs;
use std::path::PathBuf;

fn installer_template() -> String {
    fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("custom-installer.nsi"))
        .expect("custom NSIS installer template must be readable")
}

fn block<'a>(source: &'a str, start: &str, end: &str) -> &'a str {
    let start = source
        .find(start)
        .unwrap_or_else(|| panic!("missing block start: {start}"));
    let body = &source[start..];
    let end = body
        .find(end)
        .unwrap_or_else(|| panic!("missing block end: {end}"));
    &body[..end]
}

#[test]
fn both_initializers_and_mutation_sections_require_the_lifecycle_guard() {
    let source = installer_template();
    let install_init = block(&source, "Function .onInit", "FunctionEnd");
    let uninstall_init = block(&source, "Function un.onInit", "FunctionEnd");
    let install_section = block(&source, "Section Install", "SectionEnd");
    let uninstall_section = block(&source, "Section Uninstall", "SectionEnd");

    assert!(install_init.contains("Call CheckOpenCohostProcesses"));
    assert!(uninstall_init.contains("Call un.CheckOpenCohostProcesses"));
    assert!(
        !uninstall_init.contains("Call RestorePreviousInstallLocation"),
        "un.onInit must not call the installer-only restore helper"
    );
    assert!(install_section.contains("Call CheckOpenCohostProcesses"));
    assert!(
        uninstall_section
            .matches("Call un.CheckOpenCohostProcesses")
            .count()
            >= 2
    );
    let install_guard = install_section
        .find("Call CheckOpenCohostProcesses")
        .expect("the install guard must precede mutations");
    let install_mutation = install_section
        .find("SetOutPath")
        .expect("the install section must set its output path");
    assert!(install_guard < install_mutation);
    let preuninstall_hook = uninstall_section
        .find("NSIS_HOOK_PREUNINSTALL")
        .expect("the uninstall hook boundary must exist");
    let post_hook_guard = uninstall_section
        .rfind("Call un.CheckOpenCohostProcesses")
        .expect("the guard must run after the uninstall hook");
    let pre_hook_guard = uninstall_section
        .find("Call un.CheckOpenCohostProcesses")
        .expect("the uninstall guard must precede hooks");
    let uninstall_mutation = uninstall_section
        .find("Delete ")
        .expect("the uninstall section must delete its binary");
    assert!(pre_hook_guard < preuninstall_hook);
    assert!(post_hook_guard < uninstall_mutation);
    assert!(!install_section.contains("CheckIfAppIsRunning"));
    assert!(!uninstall_section.contains("CheckIfAppIsRunning"));
}

#[test]
fn running_process_guard_asks_then_rechecks_and_never_kills() {
    let source = installer_template();
    let guard = block(
        &source,
        "!macro DefineOpenCohostProcessGuard PREFIX LABEL",
        "!macroend",
    );

    assert!(guard.contains("MB_OKCANCEL|MB_ICONEXCLAMATION"));
    assert!(guard.matches("FindProcessCurrentUser").count() >= 2);
    assert!(guard.matches("Call ${PREFIX}IsOwnedBackendRunning").count() >= 2);
    let prompt = guard
        .find("MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION")
        .expect("interactive users must be asked to close the app");
    let recheck = guard
        .find("${LABEL}process_recheck:")
        .expect("OK must route to a fresh process check");
    assert!(prompt < recheck);
    assert!(guard.contains("IDCANCEL"));
    assert!(guard.contains("IfSilent ${LABEL}process_abort"));
    assert!(guard.contains("$PassiveMode = 1"));
    assert!(guard.contains("Abort"));
    assert!(guard.matches("${If} $R0 != 1").count() >= 2);
    assert!(!guard.contains("KillProcess"));
}

#[test]
fn backend_guard_uses_runtime_lock_pid_and_exact_bundled_interpreter_path() {
    let source = installer_template();
    let guard = block(
        &source,
        "Function ${PREFIX}IsOwnedBackendRunning",
        "FunctionEnd",
    );

    assert!(source.contains("!define OPENCOHOST_RUNTIME_KEY \"Software\\OpenCohost\\Runtime\""));
    assert!(guard.contains("${OPENCOHOST_RUNTIME_KEY}"));
    assert!(source.contains("${UnStrLoc}"));
    assert!(guard.contains("DataRoot"));
    assert!(guard.contains("opencohost_api_engine.lock"));
    assert!(guard.contains("OpenProcess"));
    assert!(guard.contains("QueryFullProcessImageNameW"));
    assert!(guard.contains("$INSTDIR\\resources\\runtime\\python\\python.exe"));
    assert!(guard.contains("$OpenCohostDataRoot\\engine\\releases\\"));
    assert!(guard.contains("\\generations\\"));
    assert!(guard.contains("${StrCase} $R5 \"$5\" \"L\""));
    assert!(guard.contains("${UnStrCase} $R5 \"$5\" \"L\""));
    assert!(guard.contains("${UnStrLoc} $R4 $R9 \"\\generations\\\" \">\""));
    assert!(guard.contains("${UnStrLoc} $R8 $R3 \"\\\" \">\""));
    assert!(!guard.contains("${StrCase} $R5 \"$R5\" \"L\""));
    assert!(guard.contains("backend_invalid_pid"));
    assert!(guard.contains("p .r4 ?e"));
    assert!(!guard.contains("kernel32::GetLastError"));
    assert!(guard.contains("If} $R5 = 87"));
    assert!(!guard.contains("FindProcessCurrentUser \"python.exe\""));
}

#[test]
fn native_guard_harness_covers_owned_unrelated_stale_malformed_and_missing_processes() {
    let harness =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/installer_process_guard_runtime.ps1");
    let source = fs::read_to_string(harness).expect("native NSIS guard harness must be readable");
    for scenario in [
        "both production NSIS guard namespaces and lifecycle entry points",
        "bootstrap-owned live child",
        "managed-generation live child",
        "unrelated interpreter and stale PID",
        "malformed lock fails closed",
        "FindProcessCurrentUser reports live=0 and absent=1",
    ] {
        assert!(
            source.contains(scenario),
            "missing native scenario: {scenario}"
        );
    }
    assert!(source.contains("InstallerGuardTest"));
    assert!(source.contains("OpenCohostInstallerGuardTest-"));
    assert!(source.contains("Assert-SafeHarnessWorkPath"));
    assert!(source.contains("$workCreated"));
    assert!(source.contains("$registryKeyCreated"));
    assert!(source.contains("PASS: GUID-scoped registry key and temp root were removed"));
    assert!(source.contains("$child.Kill()"));
    assert!(source.contains("FindProcessCurrentUser \"$probeName\""));
    assert!(source.contains("/S _?=$bootstrap"));
    assert!(source.contains("both lifecycle entry points block the live probe"));
}

#[test]
fn runtime_registry_key_is_injectable_for_isolated_native_guard_tests() {
    let source = installer_template();
    assert!(source.contains("!define OPENCOHOST_RUNTIME_KEY"));
    assert!(source.contains("HKCU \"${OPENCOHOST_RUNTIME_KEY}\" \"DataRoot\""));
}

#[test]
fn runtime_data_cleanup_is_opt_in_and_removes_only_the_named_owned_artifacts() {
    let source = installer_template();
    let uninstall_section = block(&source, "Section Uninstall", "SectionEnd");
    let cleanup = block(
        uninstall_section,
        "${If} $DeleteAppDataCheckboxState = 1",
        "${EndIf}",
    );

    assert!(cleanup.contains("${AndIf} $UpdateMode <> 1"));
    assert!(cleanup.contains("RmDir /r \"$APPDATA\\${BUNDLEID}\""));
    assert!(cleanup.contains("RmDir /r \"$LOCALAPPDATA\\${BUNDLEID}\""));
    assert!(cleanup.contains("RmDir /r \"$LOCALAPPDATA\\OpenCohost\""));
    assert!(cleanup.contains("Delete \"$TEMP\\opencohost-backend.log\""));
    assert!(cleanup.contains("Delete \"$TEMP\\opencohost-ptt-bridge.log\""));
    assert!(cleanup.contains("Delete \"$TEMP\\opencohost_api_engine.lock\""));
    assert!(cleanup.contains("DeleteRegKey HKCU \"Software\\OpenCohost\\Runtime\""));
    assert!(cleanup.contains("DeleteRegKey /ifempty HKCU \"Software\\OpenCohost\""));

    for command in [
        "RmDir /r \"$LOCALAPPDATA\\OpenCohost\"",
        "Delete \"$TEMP\\opencohost-backend.log\"",
        "Delete \"$TEMP\\opencohost-ptt-bridge.log\"",
        "Delete \"$TEMP\\opencohost_api_engine.lock\"",
        "DeleteRegKey HKCU \"Software\\OpenCohost\\Runtime\"",
        "DeleteRegKey /ifempty HKCU \"Software\\OpenCohost\"",
    ] {
        assert_eq!(
            uninstall_section.matches(command).count(),
            1,
            "{command} must occur only inside the checkbox/non-update cleanup gate"
        );
    }
}

#[test]
fn reinstall_triggered_uninstall_always_updates_and_never_asks_about_data() {
    let source = installer_template();
    let leave = block(&source, "Function PageLeaveReinstall", "FunctionEnd");
    let uninstall = block(leave, "reinst_uninstall:", "BringToFront");

    // /UPDATE is appended unconditionally: a reinstall must never delete data,
    // whatever mode the NEW installer itself was started in.
    assert!(uninstall.contains("StrCpy $R1 \"$R1 /UPDATE\""));
    assert!(
        !uninstall.contains("${IfThen} $UpdateMode = 1 ${|} StrCpy $R1 \"$R1 /UPDATE\""),
        "/UPDATE must not depend on the new installer's own update mode"
    );
    // /P makes even an older uninstaller (without the update-aware page skip)
    // skip its confirm page, so the delete-data checkbox is never shown.
    assert!(uninstall.contains("StrCpy $R1 \"$R1 /P\""));
    assert!(
        !uninstall.contains("${IfThen} $PassiveMode = 1 ${|} StrCpy $R1 \"$R1 /P\""),
        "/P must not depend on the new installer's own passive mode"
    );
}

#[test]
fn uninstaller_confirm_page_with_delete_data_is_skipped_when_updating() {
    let source = installer_template();
    let skip = block(&source, "Function un.SkipIfPassiveOrUpdate", "FunctionEnd");
    assert!(skip.contains("$PassiveMode = 1"));
    assert!(skip.contains("$UpdateMode = 1"));
    assert!(skip.contains("Abort"));

    let page = block(
        &source,
        "!define MUI_PAGE_CUSTOMFUNCTION_PRE un.SkipIfPassiveOrUpdate",
        "!insertmacro MUI_UNPAGE_CONFIRM",
    );
    assert!(!page.contains("un.SkipIfPassive\n"));
}

#[test]
fn registered_data_root_is_removed_only_when_marked_and_never_when_unsafe() {
    let source = installer_template();
    let func = block(&source, "Function un.RemoveRegisteredDataRoot", "FunctionEnd");

    assert!(func.contains("ReadRegStr $0 HKCU \"${OPENCOHOST_RUNTIME_KEY}\" \"DataRoot\""));
    // Marker: the runtime manifest or the state\ directory the app creates.
    assert!(func.contains("$0\\state\\runtime-manifest.json"));
    assert!(func.contains("$0\\state\\*.*"));
    // Refusals: drive root / too short, INSTDIR or a parent of INSTDIR, and the
    // well-known user folders.
    assert!(func.contains("StrLen $1 $0"));
    assert!(func.contains("$1 < 4"));
    assert!(func.contains("StrCpy $3 \"$INSTDIR\\\" $1"));
    for folder in ["$PROFILE", "$LOCALAPPDATA", "$APPDATA", "$DOCUMENTS", "$DESKTOP"] {
        assert!(func.contains(folder), "must refuse {folder}");
    }
    let marker = func.find("runtime-manifest.json").unwrap();
    let delete = func.find("RmDir /r \"$0\"").expect("the guarded delete");
    assert!(marker < delete, "the marker check must precede the delete");

    // Wiring: runs inside the opt-in cleanup gate, BEFORE the Runtime key that
    // holds DataRoot is deleted.
    let uninstall_section = block(&source, "Section Uninstall", "SectionEnd");
    let call = uninstall_section
        .find("Call un.RemoveRegisteredDataRoot")
        .expect("the uninstall section must call the data-root cleanup");
    let gate = uninstall_section
        .find("${If} $DeleteAppDataCheckboxState = 1")
        .unwrap();
    let key_delete = uninstall_section
        .find("DeleteRegKey HKCU \"Software\\OpenCohost\\Runtime\"")
        .unwrap();
    assert!(gate < call && call < key_delete);
}

#[test]
fn confirm_page_shows_the_registered_data_folder() {
    let source = installer_template();
    let show = block(&source, "Function un.ConfirmShow", "FunctionEnd");
    assert!(show.contains("\"DataRoot\""));
}

#[test]
fn uninstall_removes_the_resources_directory_after_the_per_file_deletes() {
    let source = installer_template();
    let uninstall_section = block(&source, "Section Uninstall", "SectionEnd");
    let files = uninstall_section
        .find("Delete \"$INSTDIR\\${MAINBINARYNAME}.exe\"")
        .unwrap();
    let recursive = uninstall_section
        .find("RMDir /r \"$INSTDIR\\resources\"")
        .expect("stale runtime files (pyc, caches) must not block removal");
    let install_dir = uninstall_section.find("RMDir \"$INSTDIR\"").unwrap();
    assert!(files < recursive && recursive < install_dir);
}
