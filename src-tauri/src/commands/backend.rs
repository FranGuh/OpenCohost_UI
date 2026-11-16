use crate::backend::{self, BackendInfo, BackendState};

#[tauri::command]
pub fn backend_info(state: tauri::State<BackendState>) -> BackendInfo {
    backend::backend_info(state)
}

#[tauri::command]
pub fn reload_backend_command(app: tauri::AppHandle) -> Result<BackendInfo, String> {
    backend::reload_backend_command(app)
}

#[tauri::command(async)]
pub fn api_token(state: tauri::State<BackendState>) -> Option<String> {
    backend::api_token(&state)
}

#[tauri::command]
pub fn get_unload_models_on_exit() -> bool {
    backend::prefs::unload_models_on_exit()
}

#[tauri::command]
pub fn set_unload_models_on_exit(enabled: bool) -> Result<(), String> {
    backend::prefs::save_prefs_to(
        &backend::prefs::resolve_prefs_path(),
        &backend::prefs::ShellPrefs {
            unload_models_on_exit: enabled,
        },
    )
}

#[tauri::command]
pub fn backend_status(state: tauri::State<BackendState>) -> backend::BackendStatus {
    backend::backend_status(&state)
}
