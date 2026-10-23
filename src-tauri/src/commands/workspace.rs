use serde_json::Value;
use tauri::State;
use tilde_config::{ConfigErrorDto, load_workspace, save_workspace};

use crate::state::AppState;

#[tauri::command]
pub fn workspace_load(app: State<'_, AppState>) -> Option<Value> {
    let paths = app.settings.lock().paths().clone();
    load_workspace(&paths)
}

/// `state` is the front-end's workspace snapshot (it owns the format).
#[tauri::command]
pub fn workspace_save(app: State<'_, AppState>, state: Value) -> Result<(), ConfigErrorDto> {
    let paths = app.settings.lock().paths().clone();
    save_workspace(&paths, &state).map_err(|e| ConfigErrorDto::from(&e))
}
