//! Files of an SSH session (SFTP): browsing, operations, transfers, external editing.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tilde_ssh::{
    EditSession, RemoteEntry, RemoteFile, SftpClient, SftpError, SshShell, TransferInfo,
    TransferQueue, session_temp_dir,
};

use crate::{commands::session::SessionErrorDto, state::AppState};

pub const TRANSFER_EVENT: &str = "sftp://transfer";

fn sftp_err(e: &SftpError) -> SessionErrorDto {
    SessionErrorDto { kind: "sftp", message: e.to_string() }
}

fn shell(state: &AppState, session_id: u32) -> Result<Arc<SshShell>, SessionErrorDto> {
    state.ssh.shells.lock().get(&session_id).cloned().ok_or_else(|| SessionErrorDto {
        kind: "notFound",
        message: "cette session SSH n’est plus ouverte".into(),
    })
}

async fn client(state: &AppState, session_id: u32) -> Result<Arc<SftpClient>, SessionErrorDto> {
    shell(state, session_id)?.sftp().await.map_err(|e| sftp_err(&e))
}

fn queue(state: &AppState) -> Result<&TransferQueue, SessionErrorDto> {
    state.sftp.transfers.get().ok_or(SessionErrorDto {
        kind: "sftp",
        message: "l'application démarre encore, réessayez".into(),
    })
}

/// Where downloads go: the Downloads folder (else home), or the folder the user picked
/// with « Télécharger vers… » (`None` if they cancelled).
pub fn download_destination(
    save_as: bool,
    picked: Option<PathBuf>,
    downloads: Option<PathBuf>,
) -> Option<PathBuf> {
    if save_as { picked } else { downloads.or_else(dirs::home_dir) }
}

#[tauri::command]
pub async fn sftp_home(
    state: State<'_, AppState>,
    session_id: u32,
) -> Result<String, SessionErrorDto> {
    client(&state, session_id).await?.home().await.map_err(|e| sftp_err(&e))
}

#[tauri::command]
pub async fn sftp_list(
    state: State<'_, AppState>,
    session_id: u32,
    path: String,
) -> Result<Vec<RemoteEntry>, SessionErrorDto> {
    client(&state, session_id).await?.list(&path).await.map_err(|e| sftp_err(&e))
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    session_id: u32,
    path: String,
) -> Result<(), SessionErrorDto> {
    client(&state, session_id).await?.mkdir(&path).await.map_err(|e| sftp_err(&e))
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    session_id: u32,
    from: String,
    to: String,
) -> Result<(), SessionErrorDto> {
    client(&state, session_id).await?.rename(&from, &to).await.map_err(|e| sftp_err(&e))
}

/// Deletes a file, a link or a directory tree; returns how many entries went.
#[tauri::command]
pub async fn sftp_remove(
    state: State<'_, AppState>,
    session_id: u32,
    path: String,
) -> Result<u64, SessionErrorDto> {
    client(&state, session_id).await?.remove(&path).await.map_err(|e| sftp_err(&e))
}

#[tauri::command]
pub async fn sftp_chmod(
    state: State<'_, AppState>,
    session_id: u32,
    path: String,
    mode: u32,
) -> Result<(), SessionErrorDto> {
    client(&state, session_id).await?.chmod(&path, mode).await.map_err(|e| sftp_err(&e))
}

/// Queues downloads; `[]` when « Télécharger vers… » was cancelled.
#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: u32,
    paths: Vec<String>,
    save_as: bool,
) -> Result<Vec<u32>, SessionErrorDto> {
    let picked = if save_as {
        let dialog = app.dialog().file().set_title("Télécharger vers…");
        tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
            .await
            .ok()
            .flatten()
            .and_then(|p| p.into_path().ok())
    } else {
        None
    };
    let Some(dest) = download_destination(save_as, picked, dirs::download_dir()) else {
        return Ok(Vec::new());
    };
    let client = client(&state, session_id).await?;
    let queue = queue(&state)?;
    let mut ids = Vec::new();
    for path in paths {
        let queued = queue.download(session_id, Arc::clone(&client), &path, &dest).await;
        ids.extend(queued.map_err(|e| sftp_err(&e))?);
    }
    Ok(ids)
}

/// Queues uploads into `remote_dir`; without `local_paths`, asks for files.
#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: u32,
    local_paths: Option<Vec<String>>,
    remote_dir: String,
) -> Result<Vec<u32>, SessionErrorDto> {
    let locals: Vec<PathBuf> = if let Some(paths) = local_paths {
        paths.into_iter().map(PathBuf::from).collect()
    } else {
        let dialog = app.dialog().file().set_title("Envoyer des fichiers");
        tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_files())
            .await
            .ok()
            .flatten()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|p| p.into_path().ok())
            .collect()
    };
    if locals.is_empty() {
        return Ok(Vec::new());
    }
    let client = client(&state, session_id).await?;
    let queue = queue(&state)?;
    let mut ids = Vec::new();
    for local in locals {
        let queued = queue.upload(session_id, Arc::clone(&client), &local, &remote_dir).await;
        ids.extend(queued.map_err(|e| sftp_err(&e))?);
    }
    Ok(ids)
}

/// Opens a local copy in the editor (`sftp.externalEditor`, else the OS default app).
fn open_in_editor(app: &AppHandle, editor: Option<&str>, path: &Path) {
    let opened = match editor.map(str::trim).filter(|e| !e.is_empty()) {
        // « code --wait », « notepad++ »: program then its arguments, the file last.
        Some(cmd) => {
            let mut parts = cmd.split_whitespace();
            let program = parts.next().unwrap_or(cmd);
            std::process::Command::new(program)
                .args(parts)
                .arg(path)
                .spawn()
                .map(drop)
                .map_err(|e| e.to_string())
        }
        None => {
            app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
        }
    };
    if let Err(e) = opened {
        tracing::warn!(error = %e, "could not open the external editor");
    }
}

/// Downloads a file, opens it in the editor and uploads each save. Returns its id in
/// the transfer list.
#[tauri::command]
pub async fn sftp_edit(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: u32,
    path: String,
) -> Result<u32, SessionErrorDto> {
    let client: Arc<dyn RemoteFile> = client(&state, session_id).await?;
    let id = queue(&state)?.next_id();
    let editor = state.settings.lock().settings().sftp.external_editor.clone();
    let events = app.clone();
    let opener = app.clone();
    let edit = EditSession::start(
        id,
        session_id,
        &session_temp_dir(session_id),
        client,
        &path,
        move |local| open_in_editor(&opener, editor.as_deref(), local),
        Arc::new(move |info: TransferInfo| emit_transfer(&events, info)),
    )
    .await
    .map_err(|e| sftp_err(&e))?;
    state.sftp.edits.lock().insert(id, (session_id, Arc::new(edit)));
    Ok(id)
}

#[tauri::command]
pub async fn edit_resolve(
    state: State<'_, AppState>,
    edit_id: u32,
    overwrite: bool,
) -> Result<(), SessionErrorDto> {
    let edit = state.sftp.edits.lock().get(&edit_id).map(|(_, e)| Arc::clone(e));
    if let Some(edit) = edit {
        edit.resolve(overwrite).await;
    }
    Ok(())
}

#[tauri::command]
pub fn transfers_list(state: State<'_, AppState>) -> Vec<TransferInfo> {
    let mut all = state.sftp.transfers.get().map(TransferQueue::list).unwrap_or_default();
    all.extend(state.sftp.edits.lock().values().map(|(_, e)| e.info()));
    all.sort_by_key(|t| t.id);
    all
}

#[tauri::command]
pub fn transfer_cancel(state: State<'_, AppState>, id: u32) {
    if let Some(q) = state.sftp.transfers.get() {
        q.cancel(id);
    }
}

/// Retries a failed transfer on the session's current SFTP session (it resumes).
#[tauri::command]
pub async fn transfer_retry(state: State<'_, AppState>, id: u32) -> Result<(), SessionErrorDto> {
    let queue = queue(&state)?;
    let Some(info) = queue.list().into_iter().find(|t| t.id == id) else { return Ok(()) };
    let client = client(&state, info.session).await?;
    queue.retry(id, client);
    Ok(())
}

#[tauri::command]
pub fn transfers_clear(state: State<'_, AppState>) {
    if let Some(q) = state.sftp.transfers.get() {
        q.clear_finished();
    }
}

/// Shows a downloaded file in the system file manager.
#[tauri::command]
pub fn transfer_reveal(app: AppHandle, state: State<'_, AppState>, id: u32) -> Result<(), String> {
    let info = transfers_list(state).into_iter().find(|t| t.id == id).ok_or("transfert inconnu")?;
    app.opener().reveal_item_in_dir(&info.local).map_err(|e| e.to_string())
}

pub(crate) fn emit_transfer(app: &AppHandle, info: TransferInfo) {
    use tauri::Emitter;
    let _ = app.emit(TRANSFER_EVENT, info);
}

/// A session ended: stop its transfers and edits, remove its temporary edit folder.
pub(crate) fn on_session_closed(app: &AppHandle, session_id: u32) {
    let state = app.state::<AppState>();
    if let Some(q) = state.sftp.transfers.get() {
        q.cancel_session(session_id);
    }
    state.sftp.edits.lock().retain(|_, (s, _)| *s != session_id);
    let dir = session_temp_dir(session_id);
    std::thread::spawn(move || {
        let _ = std::fs::remove_dir_all(dir);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn download_destination_is_the_downloads_folder_unless_save_as() {
        let dl = Some(PathBuf::from("/home/me/Téléchargements"));
        let picked = Some(PathBuf::from("/mnt/backup"));
        assert_eq!(download_destination(false, None, dl.clone()), dl);
        assert_eq!(download_destination(true, picked.clone(), dl.clone()), picked);
        assert_eq!(download_destination(true, None, dl), None, "cancelled: nothing downloaded");
        assert_eq!(download_destination(false, None, None), dirs::home_dir());
    }
}
