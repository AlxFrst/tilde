use serde_json::Value;
use tauri::{State, WebviewWindow};
use tilde_config::{ConfigErrorDto, load_workspace, save_workspace};

use crate::state::AppState;

/// The calling window's saved workspace (each Tilde window has its own).
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri hands command arguments over by value.
pub fn workspace_load(window: WebviewWindow, app: State<'_, AppState>) -> Option<Value> {
    let paths = app.settings.lock().paths().clone();
    load_workspace(&paths, window.label())
}

/// `state` is the front-end's workspace snapshot (it owns the format). A window closed for
/// good saves nothing more: a late save would bring it back at the next start.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri hands command arguments over by value.
pub fn workspace_save(
    window: WebviewWindow,
    app: State<'_, AppState>,
    state: Value,
) -> Result<(), ConfigErrorDto> {
    if app.windows.is_forgotten(window.label()) {
        return Ok(());
    }
    let paths = app.settings.lock().paths().clone();
    save_workspace(&paths, window.label(), &state).map_err(|e| ConfigErrorDto::from(&e))
}
