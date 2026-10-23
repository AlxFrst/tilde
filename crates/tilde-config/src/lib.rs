//! Settings model, persistence, migrations and hot reload for Tilde.
//!
//! This crate has no Tauri dependency so it can be tested with `cargo test` alone.

mod connections;
mod error;
mod merge_patch;
mod migrate;
mod paths;
mod settings;
mod store;
mod watch;
mod workspace;

pub use connections::{
    CONNECTIONS_VERSION, Connection, ConnectionsFile, ConnectionsStore, Folder, ICONS,
    ImportReport, MAX_RECENTS, Recent, connection_problem, connections_schema, new_id,
};
pub use error::{ConfigError, ConfigErrorDto, FieldError};
pub use merge_patch::merge_patch;
pub use migrate::migrate;
pub use paths::ConfigPaths;
pub use settings::*;
pub use store::{ReloadOutcome, SettingsStore};
pub use watch::{ConfigFile, ConfigWatcher, watch_config};
pub use workspace::{load_workspace, save_workspace};
