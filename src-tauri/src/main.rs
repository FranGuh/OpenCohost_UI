#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![backend::backend_info, backend::api_token])
        .setup(|app| {
            backend::setup_backend(app)?;
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
