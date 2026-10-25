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

/// The interface's language (`fr` or `en`; anything else is French), for the text Rust
/// shows itself: native dialogs, Explorer's context menu, the lines written into SSH
/// terminals. Messages sent to the front-end stay French (it translates them).
#[tauri::command]
pub fn app_set_locale(state: State<'_, AppState>, locale: String) {
    if !state.locale.set(&locale) {
        return;
    }
    tilde_ssh::set_english_notices(state.locale.is_english());
    #[cfg(windows)]
    {
        let enabled = state.settings.lock().settings().general.explorer_menu;
        if enabled {
            crate::explorer_menu::apply(true, &state.locale);
        }
    }
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

/// Opens `connections.json` in the user's editor (to fix it when it is broken).
#[tauri::command]
pub fn open_connections_file(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let file = state.connections.lock().paths().connections_file();
    app.opener().open_path(file.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// Only web links from terminal output may be opened: `file:`, custom protocol handlers
/// or `javascript:` would let a remote host make the OS run something.
pub(crate) fn is_allowed_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    ["http://", "https://"]
        .iter()
        .any(|scheme| lower.starts_with(scheme) && lower.len() > scheme.len())
}

#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    if !is_allowed_url(&url) {
        tracing::warn!(%url, "refused to open a non-web link");
        return Err("seuls les liens http et https peuvent être ouverts".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::is_allowed_url;

    #[test]
    fn only_web_links_are_opened() {
        assert!(is_allowed_url("https://tilde.dev/docs"));
        assert!(is_allowed_url("HTTP://example.com"));
        assert!(!is_allowed_url("file:///C:/Windows/System32/calc.exe"));
        assert!(!is_allowed_url("javascript:alert(1)"));
        assert!(!is_allowed_url("ms-settings:"));
        assert!(!is_allowed_url("https:"));
    }
}
