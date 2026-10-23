//! Shortcut overrides (`keybindings.json`): read, change, reset, hot reload.
//!
//! Every change is answered with the full [`KeybindingsSnapshot`] on
//! `keybindings://changed`.

use std::collections::BTreeMap;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tilde_config::{ConfigError, ConfigErrorDto, KeybindingsStore};

use crate::state::AppState;

pub const EVENT_CHANGED: &str = "keybindings://changed";
pub const EVENT_ERROR: &str = "keybindings://error";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingsSnapshot {
    pub bindings: BTreeMap<String, Option<String>>,
    pub read_only: bool,
    pub error: Option<ConfigErrorDto>,
    /// Entries of the file that were dropped, one sentence each.
    pub warnings: Vec<String>,
}

fn snapshot(state: &AppState) -> KeybindingsSnapshot {
    let store = state.keybindings.lock();
    let error = if store.read_only() { state.keybindings_error.lock().clone() } else { None };
    KeybindingsSnapshot {
        bindings: store.file().bindings.clone(),
        read_only: store.read_only(),
        error,
        warnings: store.warnings().to_vec(),
    }
}

fn emit_changed(app: &AppHandle) {
    let _ = app.emit(EVENT_CHANGED, snapshot(&app.state::<AppState>()));
}

fn edit(
    app: &AppHandle,
    f: impl FnOnce(&mut KeybindingsStore) -> Result<(), ConfigError>,
) -> Result<(), ConfigErrorDto> {
    let result = f(&mut app.state::<AppState>().keybindings.lock());
    result.map_err(|e| {
        tracing::warn!(error = %e, "keybindings change rejected");
        ConfigErrorDto::from(&e)
    })?;
    emit_changed(app);
    Ok(())
}

#[tauri::command]
pub fn keybindings_get(state: State<'_, AppState>) -> KeybindingsSnapshot {
    snapshot(&state)
}

/// Overrides a command's shortcut; `null` leaves it unbound.
#[tauri::command]
pub fn keybindings_set(
    app: AppHandle,
    command: String,
    binding: Option<String>,
) -> Result<(), ConfigErrorDto> {
    edit(&app, |s| s.set(&command, binding))
}

/// Back to the default for `command`, or for every command when `null`.
#[tauri::command]
pub fn keybindings_reset(app: AppHandle, command: Option<String>) -> Result<(), ConfigErrorDto> {
    edit(&app, |s| s.reset(command.as_deref()))
}

/// Opens `keybindings.json` in the user's editor, creating an empty one first.
#[tauri::command]
pub fn open_keybindings_file(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let file = state.keybindings.lock().paths().keybindings_file();
    if !file.exists() {
        let text = "{\n  \"$schema\": \"./keybindings.schema.json\",\n  \"version\": 1,\n  \"bindings\": {}\n}\n";
        std::fs::write(&file, text).map_err(|e| e.to_string())?;
    }
    app.opener().open_path(file.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// Called by the file watcher: reloads `keybindings.json` and notifies the front-end.
pub fn on_keybindings_file_changed(app: &AppHandle) {
    let state = app.state::<AppState>();
    let outcome = state.keybindings.lock().reload_from_disk();
    match outcome {
        Ok(true) => {
            tracing::info!("keybindings.json reloaded");
            *state.keybindings_error.lock() = None;
            emit_changed(app);
        }
        Ok(false) => {}
        Err(e) => {
            tracing::warn!(error = %e, "keybindings.json reload failed");
            let dto = ConfigErrorDto::from(&e);
            *state.keybindings_error.lock() = Some(dto.clone());
            let _ = app.emit(EVENT_ERROR, dto);
            emit_changed(app);
        }
    }
}
