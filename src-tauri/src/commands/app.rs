use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct AppInfo {
    pub version: String,
    /// `windows`, `macos` or `linux`.
    pub platform: &'static str,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    AppInfo { version: app.package_info().version.to_string(), platform: std::env::consts::OS }
}

#[tauri::command]
pub fn open_logs_dir(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let dir = state.log_dir.as_ref().ok_or("aucun dossier de logs disponible")?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_settings_file(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let file = state.settings.lock().paths().settings_file();
    app.opener().open_path(file.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}
