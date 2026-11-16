param(
    [string] $Compiler = "$env:LOCALAPPDATA\tauri\NSIS\makensis.exe",
    [string] $Template = (Join-Path $PSScriptRoot '..\custom-installer.nsi')
)

$ErrorActionPreference = 'Stop'
$templateText = Get-Content -LiteralPath $Template -Raw
$macroMatch = [regex]::Match($templateText, '(?s)!macro DefineOpenCohostProcessGuard PREFIX LABEL\r?\n.*?!macroend')
if (-not $macroMatch.Success) { throw 'Could not extract the production process-guard macro.' }
$guardMacro = $macroMatch.Value

function Get-InitCalls([string] $functionPattern) {
    $match = [regex]::Match($templateText, "(?s)Function $functionPattern\r?\n(.*?)FunctionEnd")
    if (-not $match.Success) { throw "Could not extract initializer $functionPattern." }
    return [regex]::Matches($match.Groups[1].Value, '(?m)^\s*Call\s+[^\r\n;]+') |
        ForEach-Object { $_.Value.Trim() }
}

$installerInitCalls = (Get-InitCalls '\.onInit') -join "`r`n"
$uninstallerInitCalls = (Get-InitCalls 'un\.onInit') -join "`r`n"
$testRunId = [guid]::NewGuid().ToString('N')
$workName = "opencohost-guard-$testRunId"
$tempRootInput = $env:TEMP
if ([string]::IsNullOrWhiteSpace($tempRootInput)) { throw 'The TEMP directory is unavailable.' }
$tempRootResolved = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $tempRootInput -ErrorAction Stop).ProviderPath)
$work = Join-Path $tempRootResolved $workName
$workCreated = $false
$dataRoot = Join-Path $work 'data-root'
$bootstrap = Join-Path $work 'bootstrap'
$managed = Join-Path $dataRoot 'engine\releases\v1\generations\g1\venv\Scripts'
$unrelated = Join-Path $work 'unrelated'
$testKeyNsis = "Software\OpenCohostInstallerGuardTest-$testRunId"
$testKey = "HKCU:\$testKeyNsis"
$registryKeyCreated = $false
$probeBase = 'OpenCohostGuardProbe-' + [guid]::NewGuid().ToString('N')
$probeName = "$probeBase.exe"
$probePath = Join-Path (Join-Path $work 'probe') $probeName
$testExe = Join-Path $work 'guard-test.exe'
$testUninstaller = Join-Path $bootstrap 'guard-uninstaller.exe'
$fixture = Join-Path $work 'guard-test.nsi'
$pluginDir = Join-Path (Split-Path $Compiler -Parent) 'Plugins\x86-unicode\additional'
$installerResultPath = Join-Path $work 'installer-result.txt'
$uninstallerResultPath = Join-Path $work 'uninstaller-result.txt'
$probeResultPath = Join-Path $work 'process-probe.txt'
$lock = Join-Path $dataRoot 'state\opencohost_api_engine.lock'
$venvPython = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\.venv\Scripts\python.exe'))
$pythonVenvRoot = Split-Path (Split-Path $venvPython -Parent) -Parent
$pythonHomeLine = Get-Content -LiteralPath (Join-Path $pythonVenvRoot 'pyvenv.cfg') |
    Where-Object { $_ -match '^home\s*=\s*(.+)$' } | Select-Object -First 1
if (-not $pythonHomeLine) { throw 'Could not resolve the configured venv Python runtime.' }
$pythonHome = $pythonHomeLine -replace '^home\s*=\s*', ''
$previousPythonHome = $env:PYTHONHOME
$previousPath = $env:PATH
$children = [Collections.Generic.List[Diagnostics.Process]]::new()

function Assert-SafeHarnessWorkPath {
    if (-not $workCreated) { throw 'Refusing harness cleanup before this run created its temporary root.' }
    $resolvedTemp = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $tempRootInput -ErrorAction Stop).ProviderPath)
    $resolvedWork = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $work -ErrorAction Stop).ProviderPath)
    $tempPrefix = $resolvedTemp.TrimEnd('\') + '\'
    $resolvedParent = [IO.Path]::GetDirectoryName($resolvedWork).TrimEnd('\')
    $leaf = [IO.Path]::GetFileName($resolvedWork)
    if ($leaf -cne $workName) { throw "Refusing cleanup of unexpected temporary root '$resolvedWork'." }
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals($resolvedParent, $resolvedTemp.TrimEnd('\'))) {
        throw "Refusing cleanup: temporary root '$resolvedWork' is not a direct child of '$resolvedTemp'."
    }
    if (-not $resolvedWork.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing cleanup: temporary root '$resolvedWork' is outside '$resolvedTemp'."
    }
    return $resolvedWork
}

function Assert-SafeHarnessRegistryKey {
    if (-not $registryKeyCreated) { throw 'Refusing registry cleanup before this run created its test key.' }
    if ($testKeyNsis -cnotmatch '^Software\\OpenCohostInstallerGuardTest-[0-9a-f]{32}$') {
        throw "Refusing registry cleanup of unexpected key '$testKeyNsis'."
    }
    if ($testKey -cne "HKCU:\$testKeyNsis" -or $testKeyNsis -ceq 'Software\OpenCohost\Runtime') {
        throw "Refusing registry cleanup of unexpected target '$testKey'."
    }
}

function Start-OwnedImage([string] $image) {
    New-Item -ItemType Directory -Force -Path (Split-Path $image -Parent) | Out-Null
    Copy-Item -LiteralPath $venvPython -Destination $image
    $candidateVenvRoot = Split-Path (Split-Path $image -Parent) -Parent
    Copy-Item -LiteralPath (Join-Path $pythonVenvRoot 'pyvenv.cfg') -Destination (Join-Path $candidateVenvRoot 'pyvenv.cfg')
    $env:PYTHONHOME = $pythonHome
    $env:PATH = "$pythonHome;$previousPath"
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $image
    $start.Arguments = '-c "import time; time.sleep(120)"'
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.CreateNoWindow = $true
    $process = [Diagnostics.Process]::Start($start)
    if (-not $process) { throw "Failed to launch isolated child at $image" }
    Start-Sleep -Milliseconds 250
    if ($process.HasExited) {
        $errorText = $process.StandardError.ReadToEnd().Trim()
        throw "Isolated child at $image exited early with code $($process.ExitCode): $errorText"
    }
    $children.Add($process)
    return $process
}

function Start-NSIS([string] $path, [string] $arguments) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $path
    $start.Arguments = $arguments
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $process = [Diagnostics.Process]::Start($start)
    if (-not $process.WaitForExit(15000)) {
        $process.Kill()
        $process.WaitForExit(3000)
        throw "NSIS fixture '$path' exceeded its 15-second timeout."
    }
    return $process.ExitCode
}

function Invoke-Installer([bool] $expectAbort = $false) {
    Remove-Item -LiteralPath $installerResultPath, $probeResultPath -Force -ErrorAction SilentlyContinue
    $exitCode = Start-NSIS $testExe '/S'
    $hasResult = Test-Path -LiteralPath $installerResultPath
    $probe = if (Test-Path -LiteralPath $probeResultPath) { (Get-Content -LiteralPath $probeResultPath -Raw).Trim() } else { '' }
    if ($expectAbort -and $hasResult) { throw "Installer continued after its process guard should have aborted (plugin probe '$probe')." }
    if (-not $expectAbort -and -not $hasResult) { throw "Installer did not complete its safe fixture section (exit $exitCode)." }
    $result = if ($hasResult) { (Get-Content -LiteralPath $installerResultPath -Raw).Trim() } else { '' }
    return @{ Result = $result; Probe = $probe }
}

function Invoke-Uninstaller([bool] $expectAbort = $false) {
    Remove-Item -LiteralPath $uninstallerResultPath, $probeResultPath -Force -ErrorAction SilentlyContinue
    $exitCode = Start-NSIS $testUninstaller "/S _?=$bootstrap"
    $hasResult = Test-Path -LiteralPath $uninstallerResultPath
    $probe = if (Test-Path -LiteralPath $probeResultPath) { (Get-Content -LiteralPath $probeResultPath -Raw).Trim() } else { '' }
    if ($expectAbort -and $hasResult) { throw "Uninstaller continued after its process guard should have aborted (plugin probe '$probe')." }
    if (-not $expectAbort -and -not $hasResult) { throw "Uninstaller did not complete its safe fixture section (exit $exitCode)." }
    $result = if ($hasResult) { (Get-Content -LiteralPath $uninstallerResultPath -Raw).Trim() } else { '' }
    return @{ Result = $result; Probe = $probe }
}

try {
    if (-not (Test-Path -LiteralPath $Compiler)) { throw "NSIS compiler not found: $Compiler" }
    if ($testKeyNsis -cnotmatch '^Software\\OpenCohostInstallerGuardTest-[0-9a-f]{32}$') {
        throw "Refusing to create unexpected test registry key '$testKeyNsis'."
    }
    if (Test-Path -LiteralPath $testKey) { throw "Refusing to overwrite pre-existing test registry key '$testKey'." }
    if (Test-Path -LiteralPath $work) { throw "Refusing to overwrite pre-existing temporary path '$work'." }
    New-Item -ItemType Directory -Path $work -ErrorAction Stop | Out-Null
    $workCreated = $true
    $null = Assert-SafeHarnessWorkPath
    New-Item -Path $testKey -ErrorAction Stop | Out-Null
    $registryKeyCreated = $true
    Assert-SafeHarnessRegistryKey
    New-ItemProperty -LiteralPath $testKey -Name DataRoot -Value $dataRoot -PropertyType String -ErrorAction Stop | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $dataRoot 'state'), $bootstrap, $managed, $unrelated | Out-Null
    Write-Output 'Compiling both production NSIS guard namespaces and lifecycle entry points...'

    $fixtureText = @"
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "StrFunc.nsh"
`${StrCase}
`${UnStrCase}
`${StrLoc}
`${UnStrLoc}
!define OPENCOHOST_RUNTIME_KEY "$testKeyNsis"
!define MANUPRODUCTKEY "$testKeyNsis\Install"
!define INSTALLMODE "currentUser"
!define MAINBINARYNAME "$probeBase"
RequestExecutionLevel user
!addplugindir "$pluginDir"
Var PassiveMode
Var OpenCohostBackendState
Var OpenCohostDataRoot
Var OpenCohostLockPath
Var ProcessProbeResult
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
LangString appRunning `${LANG_ENGLISH} "Close OpenCohost first."
Name "OpenCohost guard test"
OutFile "$testExe"
InstallDir "$bootstrap"
SilentInstall silent
SilentUnInstall silent
$guardMacro
!insertmacro DefineOpenCohostProcessGuard "" "installer_"
!insertmacro DefineOpenCohostProcessGuard "un." "uninstaller_"
Function RestorePreviousInstallLocation
  ; Test fixture preserves the installer's configured directory.
FunctionEnd
Function .onInit
  WriteRegStr HKCU "$testKeyNsis" "DataRoot" "$dataRoot"
  nsis_tauri_utils::FindProcessCurrentUser "$probeName"
  Pop `$ProcessProbeResult
  FileOpen `$0 "$probeResultPath" w
  FileWrite `$0 `$ProcessProbeResult
  FileClose `$0
$installerInitCalls
FunctionEnd
Function un.onInit
  WriteRegStr HKCU "$testKeyNsis" "DataRoot" "$dataRoot"
  nsis_tauri_utils::FindProcessCurrentUser "$probeName"
  Pop `$ProcessProbeResult
  FileOpen `$0 "$probeResultPath" w
  FileWrite `$0 `$ProcessProbeResult
  FileClose `$0
$uninstallerInitCalls
FunctionEnd
Section Install
  WriteRegStr HKCU "$testKeyNsis" "DataRoot" "$dataRoot"
  Call CheckOpenCohostProcesses
  WriteUninstaller "$testUninstaller"
  Call IsOwnedBackendRunning
  nsis_tauri_utils::FindProcessCurrentUser "$probeName"
  Pop `$ProcessProbeResult
  FileOpen `$0 "$installerResultPath" w
  FileWrite `$0 "`$OpenCohostBackendState|`$ProcessProbeResult"
  FileClose `$0
SectionEnd
Section Uninstall
  Call un.CheckOpenCohostProcesses
  Call un.IsOwnedBackendRunning
  nsis_tauri_utils::FindProcessCurrentUser "$probeName"
  Pop `$ProcessProbeResult
  FileOpen `$0 "$uninstallerResultPath" w
  FileWrite `$0 "`$OpenCohostBackendState|`$ProcessProbeResult"
  FileClose `$0
SectionEnd
"@
    Set-Content -LiteralPath $fixture -Value $fixtureText -Encoding UTF8
    & $Compiler /V1 $fixture
    if ($LASTEXITCODE -ne 0) { throw "makensis failed with exit code $LASTEXITCODE" }

    $baselineInstaller = Invoke-Installer
    if ($baselineInstaller.Result -ne '0|1') { throw "Unexpected installer baseline result '$($baselineInstaller.Result)'." }
    $baselineUninstaller = Invoke-Uninstaller
    if ($baselineUninstaller.Result -ne '0|1') { throw "Unexpected uninstaller baseline result '$($baselineUninstaller.Result)'." }

    $bootstrapChild = Start-OwnedImage (Join-Path $bootstrap 'resources\runtime\python\python.exe')
    Set-Content -LiteralPath $lock -Value $bootstrapChild.Id -NoNewline
    $blockedInstaller = Invoke-Installer -expectAbort $true
    if ($blockedInstaller.Probe -ne '1') { throw "Bootstrap guard unexpectedly found app probe '$($blockedInstaller.Probe)'." }
    $blockedUninstaller = Invoke-Uninstaller -expectAbort $true
    if ($blockedUninstaller.Probe -ne '1') { throw "Uninstaller bootstrap guard unexpectedly found app probe '$($blockedUninstaller.Probe)'." }
    Write-Output 'PASS: installer and uninstaller both block the bootstrap-owned live child.'
    $bootstrapChild.Kill()
    $bootstrapChild.WaitForExit(3000) | Out-Null
    Remove-Item -LiteralPath $lock -Force

    $managedChild = Start-OwnedImage (Join-Path $managed 'python.exe')
    Set-Content -LiteralPath $lock -Value $managedChild.Id -NoNewline
    Invoke-Installer -expectAbort $true | Out-Null
    Invoke-Uninstaller -expectAbort $true | Out-Null
    $managedChild.Kill()
    $managedChild.WaitForExit(3000) | Out-Null
    Remove-Item -LiteralPath $lock -Force
    Write-Output 'PASS: installer and uninstaller both block the managed-generation live child.'

    $unrelatedChild = Start-OwnedImage (Join-Path $unrelated 'python.exe')
    Set-Content -LiteralPath $lock -Value $unrelatedChild.Id -NoNewline
    $unrelatedInstaller = Invoke-Installer
    $unrelatedUninstaller = Invoke-Uninstaller
    if ($unrelatedInstaller.Result -ne '0|1' -or $unrelatedUninstaller.Result -ne '0|1') {
        throw 'An unrelated interpreter was misidentified as the OpenCohost backend.'
    }
    Set-Content -LiteralPath $lock -Value '2147483647' -NoNewline
    if ((Invoke-Installer).Result -ne '0|1' -or (Invoke-Uninstaller).Result -ne '0|1') {
        throw 'A stale PID incorrectly blocked installer or uninstaller.'
    }
    Set-Content -LiteralPath $lock -Value 'not-a-pid' -NoNewline
    Invoke-Installer -expectAbort $true | Out-Null
    Invoke-Uninstaller -expectAbort $true | Out-Null
    Remove-Item -LiteralPath $lock -Force
    $unrelatedChild.Kill()
    $unrelatedChild.WaitForExit(3000) | Out-Null
    Write-Output 'PASS: unrelated interpreter and stale PID are ignored; malformed lock fails closed.'

    $probeChild = Start-OwnedImage $probePath
    $appBlockedInstaller = Invoke-Installer -expectAbort $true
    $appBlockedUninstaller = Invoke-Uninstaller -expectAbort $true
    if ($appBlockedInstaller.Probe -ne '0' -or $appBlockedUninstaller.Probe -ne '0') {
        throw "Process plugin contract mismatch; expected live=0, got installer '$($appBlockedInstaller.Probe)', uninstaller '$($appBlockedUninstaller.Probe)'."
    }
    $probeChild.Kill()
    $probeChild.WaitForExit(3000) | Out-Null
    $absentProbe = Invoke-Installer
    if ($absentProbe.Probe -ne '1') { throw "Process plugin contract mismatch; expected absent=1, got '$($absentProbe.Probe)'." }
    Write-Output 'PASS: FindProcessCurrentUser reports live=0 and absent=1; both lifecycle entry points block the live probe.'
    Write-Output 'PASS: both exact production guard expansions compile and all installer/uninstaller runtime cases passed.'
}
finally {
    foreach ($child in $children) {
        try {
            if (-not $child.HasExited) { $child.Kill() }
            $child.WaitForExit(3000) | Out-Null
            $child.Dispose()
        } catch { Write-Warning "Could not stop isolated test child: $_" }
    }
    $env:PYTHONHOME = $previousPythonHome
    $env:PATH = $previousPath
    if ($registryKeyCreated -and (Test-Path -LiteralPath $testKey)) {
        Assert-SafeHarnessRegistryKey
        Remove-Item -LiteralPath $testKey -Recurse -Force -ErrorAction Stop
    }
    if ($workCreated -and (Test-Path -LiteralPath $work)) {
        $safeWorkPath = Assert-SafeHarnessWorkPath
        Remove-Item -LiteralPath $safeWorkPath -Recurse -Force -ErrorAction Stop
    }
    if (Test-Path -LiteralPath $testKey) { throw "Harness test registry key remains after cleanup: '$testKey'." }
    if (Test-Path -LiteralPath $work) { throw "Harness temp root remains after cleanup: '$work'." }
    Write-Output 'PASS: GUID-scoped registry key and temp root were removed after ownership/containment checks.'
}
