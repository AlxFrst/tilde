use std::{collections::BTreeMap, path::PathBuf};

use serde::{Deserialize, Serialize};

/// What to launch in a new terminal session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionSpec {
    pub command: String,
    pub args: Vec<String>,
    /// Missing or nonexistent → the user's home directory.
    pub cwd: Option<PathBuf>,
    /// Applied after Tilde's own `TERM*` variables, so a profile can override them.
    pub env: BTreeMap<String, String>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SessionId(pub u32);

impl std::fmt::Display for SessionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "#{}", self.0)
    }
}

/// Where a session's output goes (the Tauri channel in the app, a recorder in tests).
pub trait OutputSink: Send + Sync + 'static {
    fn data(&self, bytes: Vec<u8>);
    /// Called exactly once, after the last `data`, when the process ends on its own.
    /// Not called when the session is closed with [`crate::SessionManager::close`].
    fn exited(&self, code: Option<i32>);
}
