//! Debounced watching of the configuration files (`settings.json`, `connections.json`,
//! `keybindings.json`) and of the user themes folder.

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
    Keybindings,
    /// Any `*.json` of the themes folder.
    Themes,
}

/// Keeps the watch alive; dropping it stops watching.
pub struct ConfigWatcher {
    _debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
}

/// Calls `on_change` (from a background thread) for each configuration file that may
/// have changed.
///
/// The config **directory** is watched non-recursively so that editors that save by
/// writing a temp file and renaming it over the original are still seen. The themes
/// folder (created if missing) is watched the same way. Bursts of events are debounced
/// into a single call per file.
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
        (name(paths.keybindings_file()), ConfigFile::Keybindings),
    ];
    let themes_dir = paths.themes_dir();
    let themes_name = name(themes_dir.clone());
    let io = |e: notify::Error| ConfigError::Io {
        path: paths.root.clone(),
        source: std::io::Error::other(e),
    };
    let mut debouncer = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
        let Ok(events) = result else { return };
        // Compare parent folder names, not full paths: the OS may report them in
        // another form (8.3 names, `\\?\` prefixes).
        let in_themes = |p: &std::path::Path| {
            p.parent().and_then(|d| d.file_name()).map(ToOwned::to_owned) == themes_name
        };
        let paths = || events.iter().flat_map(|ev| ev.paths.iter());
        for (file_name, which) in &files {
            if paths().any(|p| !in_themes(p) && p.file_name().map(ToOwned::to_owned) == *file_name)
            {
                on_change(*which);
            }
        }
        if paths().any(|p| in_themes(p) && p.extension().is_some_and(|e| e == "json")) {
            on_change(ConfigFile::Themes);
        }
    })
    .map_err(io)?;
    std::fs::create_dir_all(&themes_dir)
        .map_err(|source| ConfigError::Io { path: themes_dir.clone(), source })?;
    debouncer.watch(&paths.root, RecursiveMode::NonRecursive).map_err(io)?;
    debouncer.watch(&themes_dir, RecursiveMode::NonRecursive).map_err(io)?;
    Ok(ConfigWatcher { _debouncer: debouncer })
}
