//! `workspace.json`: open tabs and splits, saved so they can be restored at startup.
//!
//! Each Tilde window has its own: the first one (`main`) in `workspace.json`, the others
//! (`window-2`, `window-3`…) in `workspace-window-<n>.json`. The front-end owns their shape
//! (it carries its own `version`); Rust only stores them.

use std::{fs, path::PathBuf};

use serde_json::Value;

use crate::{ConfigError, ConfigPaths};

/// The label of the first Tilde window.
pub const MAIN_WINDOW: &str = "main";

/// The number of a Tilde window from its label: 1 for `main`, `n` for `window-<n>` (n ≥ 2).
/// `None` for any other window (the Quake console) or label.
#[must_use]
pub fn window_number(label: &str) -> Option<u32> {
    if label == MAIN_WINDOW {
        return Some(1);
    }
    let digits = label.strip_prefix("window-")?;
    // Canonical digits only: `window-02` would be a second name for window 2.
    if digits.is_empty() || digits.starts_with('0') || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok().filter(|n| *n >= 2)
}

/// The label of Tilde window number `n` (1 is `main`).
#[must_use]
pub fn window_label(n: u32) -> String {
    if n <= 1 { MAIN_WINDOW.to_string() } else { format!("window-{n}") }
}

fn workspace_file(paths: &ConfigPaths, label: &str) -> Option<PathBuf> {
    match window_number(label)? {
        1 => Some(paths.workspace_file()),
        _ => Some(paths.root.join(format!("workspace-{label}.json"))),
    }
}

/// The saved workspace of window `label`, or `None` if there is none or it cannot be parsed
/// (a corrupt file is left untouched and simply ignored).
#[must_use]
pub fn load_workspace(paths: &ConfigPaths, label: &str) -> Option<Value> {
    let file = workspace_file(paths, label)?;
    let text = fs::read_to_string(&file).ok()?;
    serde_json::from_str(&text)
        .inspect_err(|e| tracing::warn!(error = %e, file = %file.display(), "workspace ignored: invalid JSON"))
        .ok()
}

/// Writes window `label`'s workspace atomically (temp file + rename). Windows that are not
/// Tilde windows (the Quake console) have none: nothing is written.
///
/// # Errors
///
/// [`ConfigError::Io`] if the file cannot be written.
pub fn save_workspace(paths: &ConfigPaths, label: &str, state: &Value) -> Result<(), ConfigError> {
    let Some(file) = workspace_file(paths, label) else { return Ok(()) };
    let tmp = file.with_extension("json.tmp");
    let io = |path: &std::path::Path| {
        let path = path.to_path_buf();
        move |source| ConfigError::Io { path, source }
    };
    fs::create_dir_all(&paths.root).map_err(io(&paths.root))?;
    let text = serde_json::to_string(state).unwrap_or_default();
    fs::write(&tmp, text).map_err(io(&tmp))?;
    fs::rename(&tmp, &file).map_err(io(&file))
}

/// Forgets window `label`'s workspace (the window was closed while others stayed open).
///
/// # Errors
///
/// [`ConfigError::Io`] if the file exists and cannot be removed.
pub fn remove_workspace(paths: &ConfigPaths, label: &str) -> Result<(), ConfigError> {
    let Some(file) = workspace_file(paths, label) else { return Ok(()) };
    match fs::remove_file(&file) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            Err(ConfigError::Io { path: file, source: e })
        }
        _ => Ok(()),
    }
}

/// The windows other than `main` that have a saved workspace, by number: the ones open when
/// Tilde was last quit, to open again.
#[must_use]
pub fn saved_windows(paths: &ConfigPaths) -> Vec<String> {
    let Ok(entries) = fs::read_dir(&paths.root) else { return Vec::new() };
    let mut numbers: Vec<u32> = entries
        .filter_map(|e| {
            let name = e.ok()?.file_name().into_string().ok()?;
            let label = name.strip_prefix("workspace-")?.strip_suffix(".json")?;
            window_number(label).filter(|n| *n >= 2)
        })
        .collect();
    numbers.sort_unstable();
    numbers.into_iter().map(window_label).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_labels_and_numbers_match() {
        assert_eq!(window_number("main"), Some(1));
        assert_eq!(window_number("window-2"), Some(2));
        assert_eq!(window_number("window-17"), Some(17));
        for other in ["quake", "window-1", "window-0", "window-02", "window-", "window-2x", ""] {
            assert_eq!(window_number(other), None, "{other}");
        }
        assert_eq!(window_label(1), "main");
        assert_eq!(window_label(3), "window-3");
    }
}
