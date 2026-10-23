//! Saved connections (`connections.json`): read, edit, import/export, hot reload.
//!
//! Every change is answered with the full [`ConnectionsView`] on `connections://changed`,
//! so the front-end never merges state itself.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tilde_config::{
    ConfigError, ConfigErrorDto, Connection, ConnectionsFile, ConnectionsStore, Folder,
    ImportReport, connection_problem,
};
use tilde_ssh::SshTarget;

use crate::state::AppState;

pub const EVENT_CHANGED: &str = "connections://changed";
pub const EVENT_ERROR: &str = "connections://error";
/// An exported file is a few KiB; anything this large is not one.
const MAX_IMPORT_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionsView {
    pub file: ConnectionsFile,
    pub read_only: bool,
    pub error: Option<ConfigErrorDto>,
    /// Hand-written values that will be refused when opening (one line each).
    pub warnings: Vec<String>,
}

fn view(state: &AppState) -> ConnectionsView {
    let store = state.connections.lock();
    let error = if store.read_only() { state.connections_error.lock().clone() } else { None };
    ConnectionsView {
        file: store.file().clone(),
        read_only: store.read_only(),
        error,
        warnings: store.warnings(),
    }
}

pub(crate) fn emit_changed(app: &AppHandle) {
    let _ = app.emit(EVENT_CHANGED, view(&app.state::<AppState>()));
}

/// Runs `change` on the store, then tells the front-end.
fn edit<T>(
    app: &AppHandle,
    change: impl FnOnce(&mut ConnectionsStore) -> Result<T, ConfigError>,
) -> Result<T, ConfigErrorDto> {
    let state = app.state::<AppState>();
    let result = change(&mut state.connections.lock());
    match result {
        Ok(value) => {
            emit_changed(app);
            Ok(value)
        }
        Err(e) => {
            tracing::info!(error = %e, "connections change rejected");
            Err(ConfigErrorDto::from(&e))
        }
    }
}

#[tauri::command]
pub fn connections_get(state: State<'_, AppState>) -> ConnectionsView {
    view(&state)
}

#[tauri::command]
pub fn connections_upsert(
    app: AppHandle,
    connection: Connection,
) -> Result<Connection, ConfigErrorDto> {
    edit(&app, |s| s.upsert_connection(connection))
}

#[tauri::command]
pub fn connections_remove(app: AppHandle, id: String) -> Result<(), ConfigErrorDto> {
    edit(&app, |s| s.remove_connection(&id))
}

#[tauri::command]
pub fn connections_set_favorite(
    app: AppHandle,
    id: String,
    favorite: bool,
) -> Result<(), ConfigErrorDto> {
    edit(&app, |s| s.set_favorite(&id, favorite))
}

#[tauri::command]
pub fn folders_upsert(app: AppHandle, folder: Folder) -> Result<Folder, ConfigErrorDto> {
    edit(&app, |s| s.upsert_folder(folder))
}

#[tauri::command]
pub fn folders_remove(app: AppHandle, id: String) -> Result<(), ConfigErrorDto> {
    edit(&app, |s| s.remove_folder(&id))
}

fn io_dto(path: PathBuf, source: std::io::Error) -> ConfigErrorDto {
    ConfigErrorDto::from(&ConfigError::Io { path, source })
}

/// Asks for a file (native dialog) and imports it. `None` when cancelled.
#[tauri::command]
pub async fn connections_import(app: AppHandle) -> Result<Option<ImportReport>, ConfigErrorDto> {
    let dialog =
        app.dialog().file().add_filter("JSON", &["json"]).set_title("Importer des connexions");
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .ok()
        .flatten();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    let too_big =
        std::fs::metadata(&path).map_err(|e| io_dto(path.clone(), e))?.len() > MAX_IMPORT_BYTES;
    if too_big {
        return Err(io_dto(path, std::io::Error::other("fichier trop volumineux (5 Mo au plus)")));
    }
    let text = std::fs::read_to_string(&path).map_err(|e| io_dto(path.clone(), e))?;
    let report = edit(&app, |s| s.import(&text))?;
    tracing::info!(?report, "connections imported");
    Ok(Some(report))
}

/// Asks where to save (native dialog) and writes the export. `false` when cancelled.
#[tauri::command]
pub async fn connections_export(app: AppHandle) -> Result<bool, ConfigErrorDto> {
    let text = app
        .state::<AppState>()
        .connections
        .lock()
        .export()
        .map_err(|e| ConfigErrorDto::from(&e))?;
    let dialog = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .set_file_name("tilde-connections.json")
        .set_title("Exporter les connexions");
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .ok()
        .flatten();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(false) };
    std::fs::write(&path, text).map_err(|e| io_dto(path, e))?;
    Ok(true)
}

/// Called by the file watcher: reloads `connections.json` and notifies the front-end.
pub fn on_connections_file_changed(app: &AppHandle) {
    let state = app.state::<AppState>();
    let outcome = state.connections.lock().reload_from_disk();
    match outcome {
        Ok(true) => {
            tracing::info!("connections.json reloaded");
            *state.connections_error.lock() = None;
            emit_changed(app);
        }
        Ok(false) => {}
        Err(e) => {
            tracing::warn!(error = %e, "connections.json reload failed");
            let dto = ConfigErrorDto::from(&e);
            *state.connections_error.lock() = Some(dto.clone());
            let _ = app.emit(EVENT_ERROR, dto);
            emit_changed(app);
        }
    }
}

/// What to connect to for a pane, and how to record it in the recents. A pane whose
/// saved connection has since been deleted falls back to the target it was opened with.
///
/// # Errors
///
/// The fallback target is not a valid `[user@]host[:port]` / alias.
pub fn ssh_target_for(
    file: &ConnectionsFile,
    target: &str,
    connection_id: Option<&str>,
) -> Result<(SshTarget, (String, String)), String> {
    if let Some(c) = connection_id.and_then(|id| file.connections.iter().find(|c| c.id == id)) {
        if let Some(problem) = connection_problem(c, &file.folders) {
            return Err(format!(
                "« {} » ne peut pas être ouverte ({problem}) : corrigez-la dans la sidebar",
                c.name
            ));
        }
        let custom = SshTarget::Custom {
            host: c.host.clone(),
            user: c.user.clone(),
            port: c.port,
            identity_file: c.identity_file.clone(),
            proxy_jump: c.proxy_jump.clone(),
            forward_agent: c.forward_agent,
        };
        return Ok((custom, (format!("conn:{}", c.id), c.name.clone())));
    }
    let parsed = SshTarget::parse(target)?;
    let text = target.trim().to_owned();
    Ok((parsed, (format!("ssh:{text}"), text)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deleted_connection_falls_back_to_the_saved_target() {
        let mut file = ConnectionsFile::default();
        file.connections.push(Connection {
            id: "c1".into(),
            name: "Prod".into(),
            host: "prod".into(),
            port: Some(2222),
            ..Connection::default()
        });

        let (target, recent) = ssh_target_for(&file, "prod", Some("c1")).unwrap();
        assert!(matches!(target, SshTarget::Custom { port: Some(2222), .. }));
        assert_eq!(recent, ("conn:c1".to_owned(), "Prod".to_owned()));

        let (target, recent) = ssh_target_for(&file, "root@db:22", Some("gone")).unwrap();
        assert!(matches!(target, SshTarget::Direct { port: Some(22), .. }));
        assert_eq!(recent, ("ssh:root@db:22".to_owned(), "root@db:22".to_owned()));

        assert!(ssh_target_for(&file, "  ", None).is_err());
    }

    /// A `ProxyJump` typo must not silently connect without the bastion.
    #[test]
    fn an_invalid_saved_connection_is_not_opened() {
        let mut file = ConnectionsFile::default();
        file.connections.push(Connection {
            id: "c1".into(),
            name: "Prod".into(),
            host: "prod".into(),
            proxy_jump: Some("b1,,b2".into()),
            ..Connection::default()
        });
        let err = ssh_target_for(&file, "prod", Some("c1")).unwrap_err();
        assert!(err.contains("Prod") && err.contains("proxyJump"), "{err}");
    }
}
