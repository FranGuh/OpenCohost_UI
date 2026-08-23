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
pub fn api_token() -> Option<String> {
    backend::api_token()
}
