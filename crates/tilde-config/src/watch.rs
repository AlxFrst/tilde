//! Debounced watching of `settings.json`.

use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache, new_debouncer};

use crate::{ConfigError, ConfigPaths};

const DEBOUNCE: Duration = Duration::from_millis(150);

/// Keeps the watch alive; dropping it stops watching.
pub struct SettingsWatcher {
    _debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
}

/// Calls `on_change` (from a background thread) whenever `settings.json` may have changed.
///
/// The config **directory** is watched non-recursively so that editors that save by
/// writing a temp file and renaming it over the original are still seen. Bursts of
/// events are debounced into a single call.
///
/// # Errors
///
/// [`ConfigError::Io`] if the OS watcher cannot be created or attached.
pub fn watch_settings(
    paths: &ConfigPaths,
    on_change: impl Fn() + Send + 'static,
) -> Result<SettingsWatcher, ConfigError> {
    let file_name = paths.settings_file().file_name().map(ToOwned::to_owned);
    let io = |e: notify::Error| ConfigError::Io {
        path: paths.root.clone(),
        source: std::io::Error::other(e),
    };
    let mut debouncer = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
        let Ok(events) = result else { return };
        let touches_settings = events
            .iter()
            .any(|ev| ev.paths.iter().any(|p| p.file_name().map(ToOwned::to_owned) == file_name));
        if touches_settings {
            on_change();
        }
    })
    .map_err(io)?;
    debouncer.watch(&paths.root, RecursiveMode::NonRecursive).map_err(io)?;
    Ok(SettingsWatcher { _debouncer: debouncer })
}
