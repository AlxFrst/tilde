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
    TransferQueue, TransferState, session_temp_dir,
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

pub(crate) async fn client(
    state: &AppState,
    session_id: u32,
) -> Result<Arc<SftpClient>, SessionErrorDto> {
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
pub async fn sftp_create_file(
    state: State<'_, AppState>,
    session_id: u32,
    path: String,
) -> Result<(), SessionErrorDto> {
    client(&state, session_id).await?.create_file(&path).await.map_err(|e| sftp_err(&e))
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
        let title = state.locale.pick("Télécharger vers…", "Download to…");
        let dialog = app.dialog().file().set_title(title);
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
        let title = state.locale.pick("Envoyer des fichiers", "Upload files");
        let dialog = app.dialog().file().set_title(title);
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

/// Splits an editor command like a shell would: spaces separate words, quotes keep
/// them together (`"C:\Program Files\Notepad++\notepad++.exe" -multiInst`).
pub fn split_command(cmd: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let mut quote: Option<char> = None;
    let mut started = false;
    for c in cmd.chars() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (None, '"' | '\'') => {
                quote = Some(c);
                started = true;
            }
            (None, c) if c.is_whitespace() => {
                if started {
                    words.push(std::mem::take(&mut word));
                    started = false;
                }
            }
            (_, c) => {
                word.push(c);
                started = true;
            }
        }
    }
    if started {
        words.push(word);
    }
    words
}

/// Extensions the desktop treats as programs or launchers: never handed to the system's
/// default action (it would run a file that came from the server).
const LAUNCHERS: &[&str] = &[
    "bat", "cmd", "com", "cpl", "exe", "hta", "inf", "js", "jse", "lnk", "msc", "msi", "msp",
    "pif", "ps1", "reg", "scf", "scr", "url", "vb", "vbe", "vbs", "ws", "wsc", "wsf", "wsh",
    "desktop", "app", "command", "terminal", "fileloc", "webloc", "workflow",
];

/// The program and arguments that open `path` for editing. A configured editor is used as
/// is (the file last). Otherwise a text editor is named explicitly — never the system's
/// default « open », which runs scripts on Windows.
///
/// # Errors
///
/// No usable editor (empty command, or a launcher file on Linux without one).
pub fn editor_invocation(
    configured: Option<&str>,
    path: &Path,
    os: &str,
) -> Result<(String, Vec<String>), String> {
    let file = path.to_string_lossy().into_owned();
    if let Some(cmd) = configured.map(str::trim).filter(|c| !c.is_empty()) {
        let mut words = split_command(cmd);
        if words.is_empty() {
            return Err("commande d'éditeur vide".into());
        }
        let program = words.remove(0);
        words.push(file);
        return Ok((program, words));
    }
    match os {
        "windows" => Ok(("notepad.exe".into(), vec![file])),
        // `-t`: the default *text* editor, whatever the file's type.
        "macos" => Ok(("open".into(), vec!["-t".into(), file])),
        _ => {
            let ext =
                path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            if LAUNCHERS.contains(&ext.as_str()) {
                return Err(format!(
                    "pour modifier un fichier « .{ext} », indiquez un éditeur dans sftp.externalEditor"
                ));
            }
            Ok(("xdg-open".into(), vec![file]))
        }
    }
}

/// On Windows, `code` is `code.cmd`: find the program on PATH with its PATHEXT extension.
fn resolve_program(program: &str) -> String {
    if !cfg!(windows) || Path::new(program).extension().is_some() || program.contains(['\\', '/']) {
        return program.to_owned();
    }
    let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
    let paths = std::env::var_os("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&paths) {
        for ext in exts.split(';').filter(|e| !e.is_empty()) {
            let candidate = dir.join(format!("{program}{}", ext.to_lowercase()));
            if candidate.is_file() {
                return candidate.to_string_lossy().into_owned();
            }
        }
    }
    program.to_owned()
}

/// Opens a local copy for editing; the error says why it could not.
fn open_in_editor(editor: Option<&str>, path: &Path) -> Result<(), String> {
    let (program, args) = editor_invocation(editor, path, std::env::consts::OS)?;
    let mut child = std::process::Command::new(resolve_program(&program))
        .args(&args)
        .spawn()
        .map_err(|e| format!("« {program} » : {e}"))?;
    // Reap it when it exits (no zombie per edit on Unix).
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
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
    let editor = state.settings.lock().settings().sftp.external_editor.clone();
    // Already being edited: open the same local copy again (a second download would
    // overwrite unsent changes).
    let existing = state
        .sftp
        .edits
        .lock()
        .iter()
        .find(|(_, (s, e))| *s == session_id && e.info().remote == path)
        .map(|(id, (_, e))| (*id, Arc::clone(e)));
    if let Some((id, edit)) = existing {
        edit.reopen(|local| open_in_editor(editor.as_deref(), local))
            .map_err(|message| SessionErrorDto { kind: "sftp", message })?;
        return Ok(id);
    }
    // Through the session, not one SFTP client: edits keep working after a reconnection.
    let remote: Arc<dyn RemoteFile> = shell(&state, session_id)?;
    let id = queue(&state)?.next_id();
    let events = app.clone();
    let edit = EditSession::start(
        id,
        session_id,
        &session_temp_dir(session_id),
        remote,
        &path,
        move |local| open_in_editor(editor.as_deref(), local),
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
    // An edit: stop watching it (its local copy stays where it is).
    if state.sftp.edits.lock().remove(&id).is_some() {
        return;
    }
    if let Some(q) = state.sftp.transfers.get() {
        q.cancel(id);
    }
}

/// Retries a failed transfer on the session's current SFTP session (it resumes).
#[tauri::command]
pub async fn transfer_retry(state: State<'_, AppState>, id: u32) -> Result<(), SessionErrorDto> {
    let edit = state.sftp.edits.lock().get(&id).map(|(_, e)| Arc::clone(e));
    if let Some(edit) = edit {
        edit.retry().await;
        return Ok(());
    }
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
    let ended: Vec<Arc<EditSession>> = {
        let mut edits = state.sftp.edits.lock();
        let ids: Vec<u32> =
            edits.iter().filter(|(_, (s, _))| *s == session_id).map(|(id, _)| *id).collect();
        ids.iter().filter_map(|id| edits.remove(id)).map(|(_, e)| e).collect()
    };
    // Changes not yet on the server are never deleted: their copy stays, and the list says
    // where.
    let mut unsent = false;
    for edit in &ended {
        if edit.is_dirty() {
            unsent = true;
            let mut info = edit.info();
            info.state = TransferState::Failed {
                message: format!(
                    "session fermée avant l'envoi : votre version est conservée dans {}",
                    edit.local_path().display()
                ),
            };
            emit_transfer(app, info);
        }
    }
    if !unsent {
        let dir = session_temp_dir(session_id);
        std::thread::spawn(move || {
            let _ = std::fs::remove_dir_all(dir);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editor_commands_split_like_a_shell() {
        assert_eq!(split_command("code --wait"), ["code", "--wait"]);
        assert_eq!(
            split_command(r#""C:\Program Files\Notepad++\notepad++.exe" -multiInst"#),
            [r"C:\Program Files\Notepad++\notepad++.exe", "-multiInst"]
        );
        assert_eq!(split_command("  vim  "), ["vim"]);
        assert_eq!(split_command("ed ''"), ["ed", ""]);
    }

    #[test]
    fn without_an_editor_a_server_file_is_never_run() {
        let script = Path::new(r"C:\tmp\build.js");
        let (program, args) = editor_invocation(None, script, "windows").unwrap();
        assert_eq!(program, "notepad.exe", "never the system's « open », which runs .js");
        assert_eq!(args, [script.to_string_lossy()]);
        let (program, args) =
            editor_invocation(None, Path::new("/tmp/x.command"), "macos").unwrap();
        assert_eq!((program.as_str(), args[0].as_str()), ("open", "-t"));
        assert!(editor_invocation(None, Path::new("/tmp/evil.desktop"), "linux").is_err());
        assert!(editor_invocation(None, Path::new("/tmp/notes.txt"), "linux").is_ok());
        let (program, args) =
            editor_invocation(Some("code --wait"), Path::new("/tmp/a.js"), "windows").unwrap();
        assert_eq!((program.as_str(), args), ("code", vec!["--wait".into(), "/tmp/a.js".into()]));
    }

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
