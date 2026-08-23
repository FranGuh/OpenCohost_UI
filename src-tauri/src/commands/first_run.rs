use crate::first_run::{self, FirstRunStatus, ProvisioningController};

#[tauri::command]
pub fn first_run_status() -> FirstRunStatus {
    first_run::first_run_status()
}

#[tauri::command]
pub fn provision_status(controller: tauri::State<ProvisioningController>) -> FirstRunStatus {
    first_run::provision_status(controller)
}

#[tauri::command]
pub fn provision_cancel(
    controller: tauri::State<ProvisioningController>,
) -> Result<FirstRunStatus, String> {
    first_run::provision_cancel(controller)
}

#[tauri::command]
pub fn provision_start(
    app: tauri::AppHandle,
    data_root: String,
    controller: tauri::State<ProvisioningController>,
) -> Result<FirstRunStatus, String> {
    first_run::provision_start(app, data_root, controller)
}

#[tauri::command]
pub fn provision_retry(
    app: tauri::AppHandle,
    controller: tauri::State<ProvisioningController>,
) -> Result<FirstRunStatus, String> {
    first_run::provision_retry(app, controller)
}
