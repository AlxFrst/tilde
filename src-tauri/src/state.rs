use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, OnceLock},
};

use parking_lot::Mutex;
use tilde_config::{
    ConfigErrorDto, ConfigWatcher, ConnectionsStore, KeybindingsStore, SettingsStore,
};
use tilde_pty::ShellCandidate;
use tilde_session::SessionManager;
use tilde_ssh::{EditSession, KeyringStore, SshShell, TransferQueue};

use crate::prompter::UiPrompter;

/// Application-wide state managed by Tauri.
pub struct AppState {
    pub settings: Mutex<SettingsStore>,
    /// Why `settings.json` is currently unusable, if it is (shown again on reload of the UI).
    pub settings_error: Mutex<Option<ConfigErrorDto>>,
    /// `None` when the OS gives no data directory; logs then go to stderr only.
    pub log_dir: Option<PathBuf>,
    /// Kept alive for hot reload; `None` if the watcher could not start.
    pub watcher: Mutex<Option<ConfigWatcher>>,
    pub connections: Mutex<ConnectionsStore>,
    /// Why `connections.json` is currently unusable, if it is.
    pub connections_error: Mutex<Option<ConfigErrorDto>>,
    pub keybindings: Mutex<KeybindingsStore>,
    /// Why `keybindings.json` is currently unusable, if it is.
    pub keybindings_error: Mutex<Option<ConfigErrorDto>>,
    pub sessions: SessionManager,
    /// Detected shells; filled in the background at startup, cleared by `profiles_refresh`.
    pub shells: Mutex<Option<Vec<ShellCandidate>>>,
    pub ssh: SshState,
    pub sftp: SftpState,
}

#[derive(Default)]
pub struct SftpState {
    /// Set at startup, once the app handle (to emit progress) exists.
    pub transfers: OnceLock<TransferQueue>,
    /// External edits by transfer id, with their session id.
    pub edits: Mutex<HashMap<u32, (u32, Arc<EditSession>)>>,
}

#[derive(Default)]
pub struct SshState {
    /// Set at startup, once the app handle (to emit events) exists.
    pub prompter: OnceLock<Arc<UiPrompter>>,
    pub secrets: Arc<KeyringStore>,
    /// Live SSH sessions by session id (tunnels, close confirmation).
    pub shells: Arc<Mutex<HashMap<u32, Arc<SshShell>>>>,
}
