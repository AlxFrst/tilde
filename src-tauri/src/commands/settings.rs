use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tilde_config::{ConfigErrorDto, ReloadOutcome, Settings};

use crate::state::AppState;

pub const EVENT_CHANGED: &str = "settings://changed";
pub const EVENT_ERROR: &str = "settings://error";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshot {
    pub settings: Settings,
    pub read_only: bool,
    pub error: Option<ConfigErrorDto>,
}

/// Returns the current settings, plus the pending error if `settings.json` is broken.
#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> SettingsSnapshot {
    let store = state.settings.lock();
    let error = if store.read_only() { state.settings_error.lock().clone() } else { None };
    SettingsSnapshot { settings: store.settings().clone(), read_only: store.read_only(), error }
}

/// Applies a JSON Merge Patch to the settings and persists it.
#[tauri::command]
pub fn settings_update(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: serde_json::Value,
) -> Result<Settings, ConfigErrorDto> {
    let settings = state.settings.lock().update(&patch).map_err(|e| {
        tracing::warn!(error = %e, "settings update rejected");
        ConfigErrorDto::from(&e)
    })?;
    apply_live(&app, &settings);
    Ok(settings)
}

/// Settings that running services pick up without a restart.
pub fn apply_live(app: &AppHandle, settings: &Settings) {
    let state = app.state::<AppState>();
    if let Some(q) = state.sftp.transfers.get() {
        q.set_concurrency(usize::from(settings.sftp.concurrency));
    }
    crate::quake::sync_quake(app, &settings.general.quake, &state.quake);
    #[cfg(windows)]
    crate::explorer_menu::apply(settings.general.explorer_menu, &state.locale);
}

/// Called by the file watcher: reloads `settings.json` and notifies the front-end.
pub fn on_settings_file_changed(app: &AppHandle) {
    let state = app.state::<AppState>();
    let outcome = state.settings.lock().reload_from_disk();
    match outcome {
        Ok(ReloadOutcome::Changed(settings)) => {
            tracing::info!("settings.json reloaded");
            *state.settings_error.lock() = None;
            apply_live(app, &settings);
            let _ = app.emit(EVENT_CHANGED, *settings);
        }
        Ok(ReloadOutcome::Unchanged | ReloadOutcome::SelfWrite) => {}
        Err(e) => {
            tracing::warn!(error = %e, "settings.json reload failed");
            let dto = ConfigErrorDto::from(&e);
            *state.settings_error.lock() = Some(dto.clone());
            let _ = app.emit(EVENT_ERROR, dto);
        }
    }
}
