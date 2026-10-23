use std::path::PathBuf;

use parking_lot::Mutex;
use tilde_config::{ConfigErrorDto, SettingsStore, SettingsWatcher};

/// Application-wide state managed by Tauri.
pub struct AppState {
    pub settings: Mutex<SettingsStore>,
    /// Why `settings.json` is currently unusable, if it is (shown again on reload of the UI).
    pub settings_error: Mutex<Option<ConfigErrorDto>>,
    /// `None` when the OS gives no data directory; logs then go to stderr only.
    pub log_dir: Option<PathBuf>,
    /// Kept alive for hot reload; `None` if the watcher could not start.
    pub watcher: Mutex<Option<SettingsWatcher>>,
}
