pub mod backend;
pub mod commands;
pub mod first_run;
pub mod platform;
pub mod provisioning;
pub mod runtime;

use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::Manager;

/// Safety net for the "start hidden until first paint" trick (window is
/// created with `visible: false` in tauri.conf.json): if the frontend never
/// fires `PageLoadEvent::Finished` — a broken build, a blank bundle, a Vite
/// dev server that never comes up — show the window anyway after this delay so
/// the app can never be left invisible forever.
const WINDOW_SHOW_FALLBACK_SECS: u64 = 4;

pub fn run() {
    tauri::Builder::default()
        // Native file picker — the only way the webview can hand the API a
        // real absolute path (music import, avatar per-state images).
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::backend::backend_info,
            commands::backend::reload_backend_command,
            commands::backend::api_token,
            commands::first_run::first_run_status,
            commands::first_run::provision_status,
            commands::first_run::provision_start,
            commands::first_run::provision_cancel,
            commands::first_run::provision_retry
        ])
        // Show the window only once the page has actually painted, so WebView2
        // never flashes its black default surface while Vite transforms the
        // module graph cold in dev.
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let window = webview.window();
                let _ = window.show();
                let _ = window.set_focus();
            }
        })
        .setup(|app| {
            backend::setup_backend(app)?;
            first_run::setup(app);

            // Fallback: a broken/blank frontend must not leave the app
            // invisible with no way to reach it. Show it after a grace period
            // if the page-load event never arrived.
            if let Some(window) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(WINDOW_SHOW_FALLBACK_SECS));
                    // On an is_visible() error, err toward showing — an
                    // unreachable invisible window is the worse failure.
                    if !window.is_visible().unwrap_or(false) {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build OpenCohost Tauri shell prototype")
        .run(|app_handle, event| {
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                backend::shutdown_backend(app_handle);
            }
        });
}
