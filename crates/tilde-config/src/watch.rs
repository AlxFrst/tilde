//! Debounced watching of the configuration files (`settings.json`, `connections.json`).

use std::{ffi::OsString, time::Duration};

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache, new_debouncer};

use crate::{ConfigError, ConfigPaths};

const DEBOUNCE: Duration = Duration::from_millis(150);

/// A configuration file that may have changed on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigFile {
    Settings,
    Connections,
}

/// Keeps the watch alive; dropping it stops watching.
pub struct ConfigWatcher {
    _debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
}

/// Calls `on_change` (from a background thread) for each configuration file that may
/// have changed.
///
/// The config **directory** is watched non-recursively so that editors that save by
/// writing a temp file and renaming it over the original are still seen. Bursts of
/// events are debounced into a single call per file.
///
/// # Errors
///
/// [`ConfigError::Io`] if the OS watcher cannot be created or attached.
pub fn watch_config(
    paths: &ConfigPaths,
    on_change: impl Fn(ConfigFile) + Send + 'static,
) -> Result<ConfigWatcher, ConfigError> {
    let name = |p: std::path::PathBuf| p.file_name().map(ToOwned::to_owned);
    let files: Vec<(Option<OsString>, ConfigFile)> = vec![
        (name(paths.settings_file()), ConfigFile::Settings),
        (name(paths.connections_file()), ConfigFile::Connections),
    ];
    let io = |e: notify::Error| ConfigError::Io {
        path: paths.root.clone(),
        source: std::io::Error::other(e),
    };
    let mut debouncer = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
        let Ok(events) = result else { return };
        for (file_name, which) in &files {
            let touched = events.iter().any(|ev| {
                ev.paths.iter().any(|p| p.file_name().map(ToOwned::to_owned) == *file_name)
            });
            if touched {
                on_change(*which);
            }
        }
    })
    .map_err(io)?;
    debouncer.watch(&paths.root, RecursiveMode::NonRecursive).map_err(io)?;
    Ok(ConfigWatcher { _debouncer: debouncer })
}
