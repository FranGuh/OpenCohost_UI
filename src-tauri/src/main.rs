#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;

use std::time::Duration;

use tauri::webview::PageLoadEvent;
use tauri::Manager;

/// Safety net for the "start hidden until first paint" trick (window is
/// created with `visible: false` in tauri.conf.json): if the frontend never
/// fires `PageLoadEvent::Finished` — a broken build, a blank bundle, a Vite
/// dev server that never comes up — show the window anyway after this delay so
/// the app can never be left invisible forever.
const WINDOW_SHOW_FALLBACK_SECS: u64 = 4;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![backend::backend_info, backend::api_token])
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
