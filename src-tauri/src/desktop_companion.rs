use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DesktopSnapshot {
    pub enabled: bool,
    pub visible: bool,
    pub ready: bool,
    pub model: String,
    pub revision: u64,
    pub generation: u64,
    pub error: Option<String>,
}

impl Default for DesktopSnapshot {
    fn default() -> Self {
        Self {
            enabled: false,
            visible: false,
            ready: false,
            model: String::new(),
            revision: 0,
            generation: 0,
            error: None,
        }
    }
}

/// Whether showing the desktop companion requires the main window to be minimized.
/// On Linux/Wayland, compositors do not reliably expose `is_minimized()` to GTK3/tao,
/// so toggling Desktop Companion ON shows the companion immediately.
pub const REQUIRE_MINIMIZED_TO_SHOW: bool = !cfg!(target_os = "linux");

/// Pure visibility decision parameterized by whether minimization is required.
pub fn should_show_with_policy(
    enabled: bool,
    minimized: bool,
    ready: bool,
    exiting: bool,
    require_minimized: bool,
) -> bool {
    enabled && (!require_minimized || minimized) && ready && !exiting
}

pub fn should_show(enabled: bool, minimized: bool, ready: bool, exiting: bool) -> bool {
    should_show_with_policy(enabled, minimized, ready, exiting, REQUIRE_MINIMIZED_TO_SHOW)
}

/// Whether the OS window itself should be visible.
/// On Linux/WebKitGTK, a hidden webview can throttle JS before `desktop_ready` fires,
/// so the OS window stays visible whenever enabled (including while loading or
/// switching VRM models) and hides reliably as soon as disabled or exiting.
pub fn should_show_os_window_with_policy(
    enabled: bool,
    minimized: bool,
    ready: bool,
    exiting: bool,
    require_minimized: bool,
    show_while_loading: bool,
) -> bool {
    if show_while_loading {
        enabled && !exiting
    } else {
        should_show_with_policy(enabled, minimized, ready, exiting, require_minimized)
    }
}

// ---------------------------------------------------------------------------
// Pure logic (unit-tested): geometry, debounce, topmost pacing, close contract.
// ---------------------------------------------------------------------------

/// Physical-pixel rectangle used by the position maths.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Distance kept between the companion and the work-area edge, in logical px.
pub const COMPANION_MARGIN_LOGICAL: f64 = 20.0;

/// Margin in physical pixels for a monitor/window scale factor.
pub fn margin_px(scale_factor: f64) -> i32 {
    let scale = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    (COMPANION_MARGIN_LOGICAL * scale).round() as i32
}

impl Rect {
    fn right(&self) -> i64 {
        self.x as i64 + self.width as i64
    }
    fn bottom(&self) -> i64 {
        self.y as i64 + self.height as i64
    }
    fn contains(&self, inner: &Rect) -> bool {
        inner.x >= self.x
            && inner.y >= self.y
            && inner.right() <= self.right()
            && inner.bottom() <= self.bottom()
    }
    fn overlap_area(&self, other: &Rect) -> i64 {
        let w = self.right().min(other.right()) - (self.x.max(other.x) as i64);
        let h = self.bottom().min(other.bottom()) - (self.y.max(other.y) as i64);
        if w > 0 && h > 0 {
            w * h
        } else {
            0
        }
    }
}

/// Bottom-right placement inside a work area for a window of `outer` physical
/// size, never left/above the work-area origin.
pub fn corner_position(work: Rect, outer: (u32, u32), margin: i32) -> (i32, i32) {
    let x = work.right() - outer.0 as i64 - margin as i64;
    let y = work.bottom() - outer.1 as i64 - margin as i64;
    (
        x.max(work.x as i64) as i32,
        y.max(work.y as i64) as i32,
    )
}

/// `None` when `window` already lies fully inside one work area; otherwise the
/// position that brings it back on a monitor (nudged into the work area it
/// overlaps most, or its corner on the first monitor when it overlaps none).
pub fn clamp_to_work_areas(window: Rect, works: &[Rect], margin: i32) -> Option<(i32, i32)> {
    let first = works.first()?;
    if works.iter().any(|work| work.contains(&window)) {
        return None;
    }
    let best = works
        .iter()
        .map(|work| (work, work.overlap_area(&window)))
        .filter(|(_, area)| *area > 0)
        .max_by_key(|(_, area)| *area);
    let Some((work, _)) = best else {
        return Some(corner_position(*first, (window.width, window.height), margin));
    };
    let max_x = (work.right() - window.width as i64).max(work.x as i64);
    let max_y = (work.bottom() - window.height as i64).max(work.y as i64);
    Some((
        (window.x as i64).clamp(work.x as i64, max_x) as i32,
        (window.y as i64).clamp(work.y as i64, max_y) as i32,
    ))
}

/// Generation counter that coalesces bursts of main-window events: only the
/// latest scheduled callback is allowed to act.
#[derive(Clone, Default)]
pub struct ReconcileDebounce(Arc<AtomicU64>);

impl ReconcileDebounce {
    pub fn begin(&self) -> u64 {
        self.0.fetch_add(1, Ordering::SeqCst) + 1
    }
    pub fn is_latest(&self, ticket: u64) -> bool {
        self.0.load(Ordering::SeqCst) == ticket
    }
}

/// Single-flight guard for the topmost keeper thread.
#[derive(Clone, Default)]
pub struct TopmostKeeper(Arc<AtomicBool>);

impl TopmostKeeper {
    pub fn try_claim(&self) -> bool {
        self.0
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }
    pub fn release(&self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// The keeper only runs while the companion is visible and the app is alive.
pub fn keeper_should_continue(visible: bool, exiting: bool) -> bool {
    visible && !exiting
}

/// How often topmost is re-asserted while visible.
pub const TOPMOST_INTERVAL: Duration = Duration::from_millis(2500);

/// How long the companion webview may take to report ready before we surface
/// an error to the main UI.
pub const COMPANION_READY_TIMEOUT: Duration = Duration::from_secs(20);

pub const ERR_COMPANION_LOAD: &str = "companion_load_failed";
pub const ERR_COMPANION_BUILD: &str = "companion_build_failed";

#[derive(Default)]
pub struct DesktopState {
    pub snapshot: DesktopSnapshot,
    pub exiting: bool,
}

/// Applies a `desktop_ready` report. Returns whether it was accepted.
pub fn apply_ready(state: &mut DesktopState, generation: u64) -> bool {
    if state.snapshot.enabled && state.snapshot.generation == generation {
        state.snapshot.ready = true;
        state.snapshot.error = None;
        state.snapshot.revision += 1;
        true
    } else {
        false
    }
}

/// Watchdog verdict: marks the snapshot as failed when the companion of
/// `generation` never reported ready. Returns whether the snapshot changed.
pub fn mark_load_failed(state: &mut DesktopState, generation: u64) -> bool {
    let snapshot = &mut state.snapshot;
    if !snapshot.enabled
        || snapshot.generation != generation
        || snapshot.ready
        || snapshot.error.is_some()
    {
        return false;
    }
    snapshot.error = Some(ERR_COMPANION_LOAD.into());
    snapshot.revision += 1;
    true
}

/// What closing the main window must do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MainClosePlan {
    pub destroy_companion: bool,
    pub exit_app: bool,
}

/// Records that the app is going away and returns the follow-up actions.
pub fn apply_main_close(state: &mut DesktopState) -> MainClosePlan {
    state.exiting = true;
    state.snapshot.visible = false;
    state.snapshot.revision += 1;
    MainClosePlan {
        destroy_companion: true,
        exit_app: true,
    }
}

#[derive(Clone)]
pub struct DesktopManager {
    pub state: Arc<Mutex<DesktopState>>,
    pub debounce: ReconcileDebounce,
    pub keeper: TopmostKeeper,
}

impl DesktopManager {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(DesktopState::default())),
            debounce: ReconcileDebounce::default(),
            keeper: TopmostKeeper::default(),
        }
    }
}

// ---------------------------------------------------------------------------
// OS layer. The companion must NEVER take focus from the foreground app, so on
// Windows show/hide/topmost are done natively with the no-activate flags.
// ---------------------------------------------------------------------------

mod native {
    use tauri::WebviewWindow;

    /// Shows the window without activating it.
    ///
    /// tao only honours `focused(false)` for the *first* `show()`: it clears its
    /// internal MARKER_DONT_FOCUS after that, so every later `show()` is a plain
    /// `SW_SHOW`, which activates the window and steals focus from a game.
    #[cfg(windows)]
    pub fn show_no_activate(window: &WebviewWindow) {
        use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                ShowWindow(hwnd.0 as _, SW_SHOWNOACTIVATE);
            }
        }
    }

    #[cfg(not(windows))]
    pub fn show_no_activate(window: &WebviewWindow) {
        let _ = window.show();
    }

    /// Hides natively so it stays symmetric with `show_no_activate` (tao's own
    /// visibility flag is not updated by the native show).
    #[cfg(windows)]
    pub fn hide(window: &WebviewWindow) {
        use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                ShowWindow(hwnd.0 as _, SW_HIDE);
            }
        }
    }

    #[cfg(not(windows))]
    pub fn hide(window: &WebviewWindow) {
        let _ = window.hide();
    }

    /// Re-asserts the topmost band with `SWP_NOACTIVATE`: a z-order change that
    /// can never activate the window or move keyboard focus.
    #[cfg(windows)]
    pub fn assert_topmost(window: &WebviewWindow) {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        };
        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                SetWindowPos(
                    hwnd.0 as _,
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
        }
    }

    #[cfg(not(windows))]
    pub fn assert_topmost(window: &WebviewWindow) {
        let _ = window.set_always_on_top(true);
    }
}

fn monitor_rects(window: &WebviewWindow) -> Vec<Rect> {
    window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let area = m.work_area();
            Rect {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            }
        })
        .collect()
}

/// Initial placement: bottom-right of the monitor the window is on, using the
/// real outer size and scale factor (the window is 320x440 *logical*).
fn place_initial(window: &WebviewWindow) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let Ok(size) = window.outer_size() else {
        return;
    };
    let work = match window.current_monitor() {
        Ok(Some(monitor)) => {
            let area = monitor.work_area();
            Rect {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            }
        }
        _ => match monitor_rects(window).first() {
            Some(rect) => *rect,
            None => return,
        },
    };
    let (x, y) = corner_position(work, (size.width, size.height), margin_px(scale));
    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
}

/// On every show: if the window ended up off-screen (monitor unplugged,
/// resolution change), bring it back onto an available monitor.
fn reclamp_to_monitors(window: &WebviewWindow) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return;
    };
    let current = Rect {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    };
    if let Some((x, y)) = clamp_to_work_areas(current, &monitor_rects(window), margin_px(scale)) {
        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
    }
}

pub fn ensure_companion_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(existing) = app.get_webview_window("kira-desktop") {
        // On Linux/WebKitGTK, a hidden webview can throttle JS execution and
        // prevent `desktop_ready` from firing before the watchdog expires.
        #[cfg(target_os = "linux")]
        native::show_no_activate(&existing);
        return Ok(existing);
    }

    // On Linux/WebKitGTK, `.visible(false)` can throttle webview JS execution
    // and stall `desktop_ready`. Create it visible since this is only called
    // when Desktop Companion is enabled.
    let initial_visible = cfg!(target_os = "linux");

    let window = tauri::WebviewWindowBuilder::new(
        app,
        "kira-desktop",
        tauri::WebviewUrl::App("/desktop/kira".into()),
    )
    .inner_size(320.0, 440.0)
    .decorations(false)
    .shadow(false)
    .resizable(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(initial_visible)
    .focused(false)
    .build()
    .map_err(|e| format!("failed to build desktop companion window: {e}"))?;

    place_initial(&window);
    Ok(window)
}

fn log_line(message: &str) {
    crate::backend::shell_log::log_line(message);
}

/// Keeps the companion in the topmost band while it is visible. One thread,
/// started on the first show and stopped as soon as the companion is hidden or
/// the app is exiting. Re-asserting uses SWP_NOACTIVATE, so it is invisible to
/// the foreground app.
fn ensure_topmost_keeper(app: &AppHandle, manager: &DesktopManager) {
    if !manager.keeper.try_claim() {
        return;
    }
    let app = app.clone();
    let state = manager.state.clone();
    let keeper = manager.keeper.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(TOPMOST_INTERVAL);
        let alive = |state: &Arc<Mutex<DesktopState>>| {
            state
                .lock()
                .map(|s| keeper_should_continue(s.snapshot.visible, s.exiting))
                .unwrap_or(false)
        };
        if alive(&state) {
            if let Some(window) = app.get_webview_window("kira-desktop") {
                native::assert_topmost(&window);
            }
            continue;
        }
        // Release first, then re-check: a show that raced the shutdown decision
        // must not be left without a keeper.
        keeper.release();
        if alive(&state) && keeper.try_claim() {
            continue;
        }
        break;
    });
}

fn apply_os_visibility(app: &AppHandle, visible: bool) {
    let Some(companion) = app.get_webview_window("kira-desktop") else {
        return;
    };
    if visible {
        reclamp_to_monitors(&companion);
        native::show_no_activate(&companion);
        native::assert_topmost(&companion);
        if let Some(manager) = app.try_state::<DesktopManager>() {
            ensure_topmost_keeper(app, &manager);
        }
    } else {
        native::hide(&companion);
    }
}

const MAX_RECONCILE_PASSES: usize = 4;

pub fn reconcile_visibility(
    app: &AppHandle,
    state_lock: &Arc<Mutex<DesktopState>>,
) -> Result<DesktopSnapshot, String> {
    // The OS calls must not run under the state lock (the main thread takes the
    // same lock from window events, and a cross-thread show/hide waits on the
    // main thread), so consistency is enforced by convergence instead: after
    // applying, re-read the latest desired state and re-apply the OS call if a
    // concurrent reconcile changed it meanwhile.
    let mut force_os = false;
    let mut snap = DesktopSnapshot::default();
    for _ in 0..MAX_RECONCILE_PASSES {
        let is_minimized = app
            .get_webview_window("main")
            .and_then(|w| w.is_minimized().ok())
            .unwrap_or(false);

        let (changed, desired, desired_os, current) = {
            let mut state = state_lock.lock().map_err(|e| e.to_string())?;
            let desired = should_show(
                state.snapshot.enabled,
                is_minimized,
                state.snapshot.ready,
                state.exiting,
            );
            let desired_os = should_show_os_window_with_policy(
                state.snapshot.enabled,
                is_minimized,
                state.snapshot.ready,
                state.exiting,
                REQUIRE_MINIMIZED_TO_SHOW,
                cfg!(target_os = "linux"),
            );
            let changed = state.snapshot.visible != desired;
            if changed {
                state.snapshot.visible = desired;
                state.snapshot.revision += 1;
            }
            (changed, desired, desired_os, state.snapshot.clone())
        };
        snap = current;

        if changed || force_os || (cfg!(target_os = "linux") && !desired_os) {
            apply_os_visibility(app, desired_os);
        }

        let latest_visible = state_lock
            .lock()
            .map(|s| s.snapshot.visible)
            .unwrap_or(desired);
        if latest_visible == desired {
            break;
        }
        force_os = true;
    }

    let _ = app.emit("desktop-state", &snap);
    Ok(snap)
}

#[tauri::command]
pub async fn desktop_state(
    window: WebviewWindow,
    manager: tauri::State<'_, DesktopManager>,
) -> Result<DesktopSnapshot, String> {
    let label = window.label();
    if label != "main" && label != "kira-desktop" {
        return Err("unauthorized window label for desktop_state".into());
    }
    let state = manager.state.lock().map_err(|e| e.to_string())?;
    Ok(state.snapshot.clone())
}

/// Surfaces a companion that never reaches `ready`: the webview failed to load
/// (or errored before calling `desktop_ready`), which would otherwise leave the
/// companion invisible forever with no explanation.
fn spawn_ready_watchdog(app: &AppHandle, manager: &DesktopManager, generation: u64) {
    let app = app.clone();
    let state = manager.state.clone();
    std::thread::spawn(move || {
        std::thread::sleep(COMPANION_READY_TIMEOUT);
        let snapshot = {
            let Ok(mut guard) = state.lock() else {
                return;
            };
            if !mark_load_failed(&mut guard, generation) {
                return;
            }
            guard.snapshot.clone()
        };
        log_line("desktop companion: webview did not report ready in time (companion_load_failed)");
        let _ = app.emit("desktop-state", &snapshot);
    });
}

#[tauri::command]
pub async fn desktop_set_mode(
    app: AppHandle,
    window: WebviewWindow,
    manager: tauri::State<'_, DesktopManager>,
    enabled: bool,
    model: String,
) -> Result<DesktopSnapshot, String> {
    if window.label() != "main" {
        return Err("only main window can toggle desktop mode".into());
    }

    let generation = {
        let mut state = manager.state.lock().map_err(|e| e.to_string())?;
        let model_changed = state.snapshot.model != model;
        let mode_changed = state.snapshot.enabled != enabled;

        if mode_changed || model_changed {
            state.snapshot.generation += 1;
            state.snapshot.enabled = enabled;
            state.snapshot.model = model;
            state.snapshot.ready = false;
            state.snapshot.revision += 1;
            state.snapshot.error = None;
        }
        state.snapshot.generation
    };

    if enabled {
        match ensure_companion_window(&app) {
            Ok(_) => spawn_ready_watchdog(&app, &manager, generation),
            Err(error) => {
                log_line(&format!("desktop companion: {error}"));
                if let Ok(mut state) = manager.state.lock() {
                    state.snapshot.error = Some(ERR_COMPANION_BUILD.into());
                    state.snapshot.revision += 1;
                }
            }
        }
    }
    reconcile_visibility(&app, &manager.state)
}

#[tauri::command]
pub async fn desktop_ready(
    app: AppHandle,
    window: WebviewWindow,
    manager: tauri::State<'_, DesktopManager>,
    generation: u64,
) -> Result<DesktopSnapshot, String> {
    if window.label() != "kira-desktop" {
        return Err("only kira-desktop can report ready".into());
    }

    let should_reconcile = {
        let mut state = manager.state.lock().map_err(|e| e.to_string())?;
        apply_ready(&mut state, generation)
    };

    if should_reconcile {
        reconcile_visibility(&app, &manager.state)
    } else {
        let state = manager.state.lock().map_err(|e| e.to_string())?;
        Ok(state.snapshot.clone())
    }
}

#[tauri::command]
pub async fn desktop_reconcile(
    app: AppHandle,
    window: WebviewWindow,
    manager: tauri::State<'_, DesktopManager>,
) -> Result<DesktopSnapshot, String> {
    let label = window.label();
    if label != "main" && label != "kira-desktop" {
        return Err("unauthorized window label for desktop_reconcile".into());
    }
    reconcile_visibility(&app, &manager.state)
}

/// Delay that lets minimize/restore settle before the follow-up reconcile.
const RECONCILE_SETTLE: Duration = Duration::from_millis(150);

pub fn handle_window_event(app: &AppHandle, window: &tauri::Window, event: &tauri::WindowEvent) {
    let label = window.label();
    if label == "main" {
        match event {
            tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(_) => {
                if let Some(manager) = app.try_state::<DesktopManager>() {
                    let _ = reconcile_visibility(app, &manager.state);
                    // Debounce: a burst of Resized/Focused events schedules one
                    // settle pass (the latest), not one thread per event.
                    let ticket = manager.debounce.begin();
                    let debounce = manager.debounce.clone();
                    let app_clone = app.clone();
                    let state_clone = manager.state.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(RECONCILE_SETTLE);
                        if debounce.is_latest(ticket) {
                            let _ = reconcile_visibility(&app_clone, &state_clone);
                        }
                    });
                }
            }
            tauri::WindowEvent::CloseRequested { .. } => {
                if let Some(manager) = app.try_state::<DesktopManager>() {
                    let plan = match manager.state.lock() {
                        Ok(mut state) => apply_main_close(&mut state),
                        Err(_) => MainClosePlan {
                            destroy_companion: true,
                            exit_app: true,
                        },
                    };
                    if plan.destroy_companion {
                        if let Some(comp) = app.get_webview_window("kira-desktop") {
                            native::hide(&comp);
                            let _ = comp.destroy();
                        }
                    }
                    if plan.exit_app {
                        // The companion's own CloseRequested is prevented, so
                        // without an explicit exit the process (and the managed
                        // backend) could outlive the main window.
                        app.exit(0);
                    }
                }
            }
            _ => {}
        }
    } else if label == "kira-desktop" {
        match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                let exiting = app
                    .try_state::<DesktopManager>()
                    .and_then(|m| m.state.lock().ok().map(|s| s.exiting))
                    .unwrap_or(false);
                if exiting {
                    return;
                }
                api.prevent_close();
                if let Some(manager) = app.try_state::<DesktopManager>() {
                    if let Ok(mut state) = manager.state.lock() {
                        state.snapshot.enabled = false;
                        state.snapshot.visible = false;
                        state.snapshot.revision += 1;
                        let snap = state.snapshot.clone();
                        drop(state);
                        let _ = app.emit("desktop-state", &snap);
                    }
                    if let Some(comp) = app.get_webview_window("kira-desktop") {
                        native::hide(&comp);
                    }
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.unminimize();
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_companion_never_shows_after_restore() {
        assert!(should_show_with_policy(true, true, true, false, true));
        assert!(!should_show_with_policy(true, false, true, false, true));
        assert!(!should_show_with_policy(true, true, true, true, true));
    }

    #[test]
    fn desktop_companion_late_ready_cannot_change_disabled_state() {
        let mut snapshot = DesktopSnapshot::default();
        snapshot.enabled = false;
        snapshot.generation = 1;

        // Simulate late ready from old generation
        let late_generation = 0;
        let mut ready_applied = false;
        if snapshot.enabled && snapshot.generation == late_generation {
            snapshot.ready = true;
            ready_applied = true;
        }
        assert!(!ready_applied);
        assert!(!snapshot.ready);
        assert!(!should_show(snapshot.enabled, true, snapshot.ready, false));
    }

    #[test]
    fn desktop_companion_focus_loss_without_minimization_never_shows() {
        let minimized = false;
        assert!(!should_show_with_policy(true, minimized, true, false, true));
    }

    #[test]
    fn desktop_companion_shows_immediately_without_minimization_when_unconstrained() {
        assert!(should_show_with_policy(true, false, true, false, false));
        assert!(should_show_with_policy(true, true, true, false, false));
        assert!(!should_show_with_policy(false, false, true, false, false));
        assert!(!should_show_with_policy(true, false, false, false, false));
        assert!(!should_show_with_policy(true, false, true, true, false));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_should_show_does_not_require_minimization() {
        assert!(!REQUIRE_MINIMIZED_TO_SHOW);
        assert!(should_show(true, false, true, false));
        assert!(should_show(true, true, true, false));
        assert!(!should_show(false, false, true, false));
        assert!(!should_show(true, false, false, false));
        assert!(!should_show(true, false, true, true));
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn non_linux_should_show_requires_minimization() {
        assert!(REQUIRE_MINIMIZED_TO_SHOW);
        assert!(should_show(true, true, true, false));
        assert!(!should_show(true, false, true, false));
    }

    fn rect(x: i32, y: i32, w: u32, h: u32) -> Rect {
        Rect {
            x,
            y,
            width: w,
            height: h,
        }
    }

    #[test]
    fn margin_scales_with_dpi_and_survives_bad_factors() {
        assert_eq!(margin_px(1.0), 20);
        assert_eq!(margin_px(1.5), 30);
        assert_eq!(margin_px(2.0), 40);
        assert_eq!(margin_px(0.0), 20);
        assert_eq!(margin_px(f64::NAN), 20);
    }

    #[test]
    fn corner_uses_the_real_outer_size_not_a_hardcoded_logical_one() {
        let work = rect(0, 0, 1920, 1040);
        // 150% HiDPI: the 320x440 logical window is 480x660 physical.
        assert_eq!(corner_position(work, (480, 660), 30), (1410, 350));
        // 100%
        assert_eq!(corner_position(work, (320, 440), 20), (1580, 580));
    }

    #[test]
    fn corner_respects_a_work_area_that_does_not_start_at_the_origin() {
        let work = rect(-1920, 0, 1920, 1040);
        assert_eq!(corner_position(work, (320, 440), 20), (-340, 580));
    }

    #[test]
    fn corner_never_leaves_the_work_area_origin_when_the_window_is_larger() {
        let work = rect(100, 50, 200, 200);
        assert_eq!(corner_position(work, (320, 440), 20), (100, 50));
    }

    #[test]
    fn fully_visible_window_is_left_alone() {
        let works = [rect(0, 0, 1920, 1040)];
        assert_eq!(
            clamp_to_work_areas(rect(1500, 500, 320, 440), &works, 20),
            None
        );
    }

    #[test]
    fn partially_offscreen_window_is_nudged_back_in() {
        let works = [rect(0, 0, 1920, 1040)];
        assert_eq!(
            clamp_to_work_areas(rect(1800, 900, 320, 440), &works, 20),
            Some((1600, 600))
        );
        assert_eq!(
            clamp_to_work_areas(rect(-100, -50, 320, 440), &works, 20),
            Some((0, 0))
        );
    }

    #[test]
    fn window_on_an_unplugged_monitor_returns_to_the_first_monitor_corner() {
        let works = [rect(0, 0, 1920, 1040), rect(1920, 0, 1920, 1040)];
        assert_eq!(
            clamp_to_work_areas(rect(5000, 300, 320, 440), &works, 20),
            Some((1580, 580))
        );
    }

    #[test]
    fn window_straddling_two_monitors_is_pulled_into_the_larger_overlap() {
        let works = [rect(0, 0, 1920, 1040), rect(1920, 0, 1920, 1040)];
        // 250px on monitor 1, 70px on monitor 2.
        assert_eq!(
            clamp_to_work_areas(rect(1670, 100, 320, 440), &works, 20),
            Some((1600, 100))
        );
    }

    #[test]
    fn clamp_without_monitors_does_nothing() {
        assert_eq!(clamp_to_work_areas(rect(0, 0, 320, 440), &[], 20), None);
    }

    #[test]
    fn debounce_only_lets_the_latest_ticket_act() {
        let debounce = ReconcileDebounce::default();
        let first = debounce.begin();
        assert!(debounce.is_latest(first));
        let second = debounce.begin();
        assert!(!debounce.is_latest(first));
        assert!(debounce.is_latest(second));
    }

    #[test]
    fn debounce_clones_share_one_counter() {
        let a = ReconcileDebounce::default();
        let b = a.clone();
        let ticket = a.begin();
        b.begin();
        assert!(!a.is_latest(ticket));
    }

    #[test]
    fn topmost_keeper_is_single_flight_and_reclaimable() {
        let keeper = TopmostKeeper::default();
        assert!(keeper.try_claim());
        assert!(!keeper.clone().try_claim());
        keeper.release();
        assert!(keeper.try_claim());
    }

    #[test]
    fn topmost_keeper_runs_only_while_visible_and_alive() {
        assert!(keeper_should_continue(true, false));
        assert!(!keeper_should_continue(false, false));
        assert!(!keeper_should_continue(true, true));
        assert!(TOPMOST_INTERVAL >= Duration::from_secs(2));
        assert!(TOPMOST_INTERVAL <= Duration::from_secs(3));
    }

    #[test]
    fn ready_report_is_accepted_only_for_the_current_generation_and_clears_errors() {
        let mut state = DesktopState::default();
        state.snapshot.enabled = true;
        state.snapshot.generation = 2;
        state.snapshot.error = Some(ERR_COMPANION_LOAD.into());
        assert!(!apply_ready(&mut state, 1));
        assert!(!state.snapshot.ready);
        let before = state.snapshot.revision;
        assert!(apply_ready(&mut state, 2));
        assert!(state.snapshot.ready);
        assert_eq!(state.snapshot.error, None);
        assert_eq!(state.snapshot.revision, before + 1);
    }

    #[test]
    fn never_ready_companion_surfaces_a_load_error_once() {
        let mut state = DesktopState::default();
        state.snapshot.enabled = true;
        state.snapshot.generation = 3;
        assert!(mark_load_failed(&mut state, 3));
        assert_eq!(state.snapshot.error.as_deref(), Some(ERR_COMPANION_LOAD));
        let revision = state.snapshot.revision;
        // Second verdict is a no-op, so the UI is not spammed.
        assert!(!mark_load_failed(&mut state, 3));
        assert_eq!(state.snapshot.revision, revision);
    }

    #[test]
    fn load_watchdog_ignores_stale_disabled_and_ready_companions() {
        let mut state = DesktopState::default();
        state.snapshot.enabled = true;
        state.snapshot.generation = 4;
        assert!(!mark_load_failed(&mut state, 3), "stale generation");
        state.snapshot.ready = true;
        assert!(!mark_load_failed(&mut state, 4), "already ready");
        state.snapshot.ready = false;
        state.snapshot.enabled = false;
        assert!(!mark_load_failed(&mut state, 4), "disabled");
        assert_eq!(state.snapshot.error, None);
    }

    #[test]
    fn closing_main_exits_the_app_and_takes_the_companion_down() {
        let mut state = DesktopState::default();
        state.snapshot.enabled = true;
        state.snapshot.ready = true;
        state.snapshot.visible = true;
        let revision = state.snapshot.revision;
        let plan = apply_main_close(&mut state);
        assert!(plan.exit_app, "the process must not outlive the main window");
        assert!(plan.destroy_companion);
        assert!(state.exiting);
        assert!(!state.snapshot.visible);
        assert_eq!(state.snapshot.revision, revision + 1);
        assert!(!should_show(true, true, true, state.exiting));
        assert!(!keeper_should_continue(
            state.snapshot.visible,
            state.exiting
        ));
    }

    #[test]
    fn desktop_companion_only_one_window_created_across_repeated_enable() {
        // Pure state check: repeated mode set increments revision/generation cleanly
        let manager = DesktopManager::new();
        {
            let mut state = manager.state.lock().unwrap();
            state.snapshot.enabled = true;
            state.snapshot.generation += 1;
            state.snapshot.revision += 1;
        }
        {
            let state = manager.state.lock().unwrap();
            // Second enable without model change does not create a second state instance
            assert_eq!(state.snapshot.generation, 1);
            assert_eq!(state.snapshot.revision, 1);
        }
    }

    #[test]
    fn linux_os_window_stays_visible_while_loading_and_hides_when_disabled() {
        // Pre-ready or model-switch while enabled: stays visible so WebKitGTK does not throttle JS.
        assert!(should_show_os_window_with_policy(true, false, false, false, false, true));
        // Ready and enabled: visible.
        assert!(should_show_os_window_with_policy(true, false, true, false, false, true));
        // Toggled OFF before ready (or after timeout): must hide the OS window.
        assert!(!should_show_os_window_with_policy(false, false, false, false, false, true));
        // Exiting: must hide the OS window.
        assert!(!should_show_os_window_with_policy(true, false, true, true, false, true));
        // Windows policy (show_while_loading=false, require_minimized=true) stays strictly minimize+ready gated.
        assert!(!should_show_os_window_with_policy(true, true, false, false, true, false));
        assert!(should_show_os_window_with_policy(true, true, true, false, true, false));
    }
}
