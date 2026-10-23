//! `workspace.json`: open tabs and splits, saved so they can be restored at startup.
//!
//! The front-end owns its shape (it carries its own `version`); Rust only stores it.

use std::fs;

use serde_json::Value;

use crate::{ConfigError, ConfigPaths};

/// The saved workspace, or `None` if there is none or it cannot be parsed
/// (a corrupt file is left untouched and simply ignored).
#[must_use]
pub fn load_workspace(paths: &ConfigPaths) -> Option<Value> {
    let file = paths.workspace_file();
    let text = fs::read_to_string(&file).ok()?;
    serde_json::from_str(&text)
        .inspect_err(|e| tracing::warn!(error = %e, "workspace.json ignored: invalid JSON"))
        .ok()
}

/// Writes the workspace atomically (temp file + rename).
///
/// # Errors
///
/// [`ConfigError::Io`] if the file cannot be written.
pub fn save_workspace(paths: &ConfigPaths, state: &Value) -> Result<(), ConfigError> {
    let file = paths.workspace_file();
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
