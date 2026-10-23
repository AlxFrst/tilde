//! Text files for the built-in editor and the preview.
//!
//! Remote files go through the SSH session's SFTP. Local files are only reachable
//! through a native dialog: the front-end gets a document id, never chooses a path.

use std::{
    path::PathBuf,
    sync::atomic::{AtomicU32, Ordering},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, ipc::Response};
use tauri_plugin_dialog::DialogExt;
use tilde_ssh::{
    PREVIEW_MAX_BYTES, Stamp, TextError, read_local_bytes, read_local_text, write_local_text,
};

use crate::{commands::sftp::client, state::AppState};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StampDto {
    pub size: u64,
    pub mtime: Option<u64>,
}

impl From<Stamp> for StampDto {
    fn from(s: Stamp) -> Self {
        Self { size: s.size, mtime: s.mtime }
    }
}

impl From<StampDto> for Stamp {
    fn from(s: StampDto) -> Self {
        Self { size: s.size, mtime: s.mtime }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorErrorDto {
    /// `tooLarge`, `binary`, `conflict`, `notFound` or `io`.
    pub kind: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<StampDto>,
}

impl From<TextError> for EditorErrorDto {
    fn from(e: TextError) -> Self {
        let (kind, current) = match &e {
            TextError::TooLarge { .. } => ("tooLarge", None),
            TextError::Binary => ("binary", None),
            TextError::Conflict { current } => ("conflict", Some((*current).into())),
            TextError::Sftp(_) | TextError::Io(_) => ("io", None),
        };
        Self { kind, message: e.to_string(), current }
    }
}

fn not_found(message: &str) -> EditorErrorDto {
    EditorErrorDto { kind: "notFound", message: message.into(), current: None }
}

async fn remote(
    state: &AppState,
    session_id: u32,
) -> Result<std::sync::Arc<tilde_ssh::SftpClient>, EditorErrorDto> {
    client(state, session_id).await.map_err(|e| EditorErrorDto {
        kind: if e.kind == "notFound" { "notFound" } else { "io" },
        message: e.message,
        current: None,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedText {
    pub text: String,
    pub stamp: StampDto,
}

#[tauri::command]
pub async fn editor_open_remote(
    state: State<'_, AppState>,
    session_id: u32,
    path: String,
) -> Result<OpenedText, EditorErrorDto> {
    let (text, stamp) = remote(&state, session_id).await?.read_text(&path).await?;
    Ok(OpenedText { text, stamp: stamp.into() })
}

/// Saves unless the file changed since `expected` was read; `force` overwrites anyway.
#[tauri::command]
pub async fn editor_save_remote(
    state: State<'_, AppState>,
    session_id: u32,
    path: String,
    text: String,
    expected: Option<StampDto>,
    force: bool,
) -> Result<StampDto, EditorErrorDto> {
    let expected = if force { None } else { expected.map(Into::into) };
    let stamp = remote(&state, session_id).await?.write_text(&path, &text, expected).await?;
    Ok(stamp.into())
}

#[tauri::command]
pub async fn preview_read_remote(
    state: State<'_, AppState>,
    session_id: u32,
    path: String,
) -> Result<Response, EditorErrorDto> {
    let bytes = remote(&state, session_id).await?.read_bytes(&path, PREVIEW_MAX_BYTES).await?;
    Ok(Response::new(bytes))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalOpened {
    pub doc_id: u32,
    pub name: String,
    pub text: String,
    pub stamp: StampDto,
}

static NEXT_DOC: AtomicU32 = AtomicU32::new(1);

fn local_path(state: &AppState, doc_id: u32) -> Result<PathBuf, EditorErrorDto> {
    state
        .local_docs
        .lock()
        .get(&doc_id)
        .cloned()
        .ok_or_else(|| not_found("ce fichier n'est plus ouvert : rouvrez-le"))
}

/// Asks for a local file (native dialog) and opens it. `None` when cancelled.
#[tauri::command]
pub async fn editor_open_local(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<LocalOpened>, EditorErrorDto> {
    let dialog = app.dialog().file().set_title("Ouvrir un fichier");
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .ok()
        .flatten();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    let read = path.clone();
    let (text, stamp) = tauri::async_runtime::spawn_blocking(move || read_local_text(&read))
        .await
        .map_err(|e| EditorErrorDto { kind: "io", message: e.to_string(), current: None })??;
    let doc_id = NEXT_DOC.fetch_add(1, Ordering::Relaxed);
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    state.local_docs.lock().insert(doc_id, path);
    Ok(Some(LocalOpened { doc_id, name, text, stamp: stamp.into() }))
}

#[tauri::command]
pub async fn editor_save_local(
    state: State<'_, AppState>,
    doc_id: u32,
    text: String,
    expected: Option<StampDto>,
    force: bool,
) -> Result<StampDto, EditorErrorDto> {
    let path = local_path(&state, doc_id)?;
    let expected = if force { None } else { expected.map(Into::into) };
    let stamp =
        tauri::async_runtime::spawn_blocking(move || write_local_text(&path, &text, expected))
            .await
            .map_err(|e| EditorErrorDto { kind: "io", message: e.to_string(), current: None })??;
    Ok(stamp.into())
}

/// The editor pane closed: forget the path.
#[tauri::command]
pub fn editor_close_local(state: State<'_, AppState>, doc_id: u32) {
    state.local_docs.lock().remove(&doc_id);
}

#[tauri::command]
pub async fn preview_read_local(
    state: State<'_, AppState>,
    doc_id: u32,
) -> Result<Response, EditorErrorDto> {
    let path = local_path(&state, doc_id)?;
    let bytes =
        tauri::async_runtime::spawn_blocking(move || read_local_bytes(&path, PREVIEW_MAX_BYTES))
            .await
            .map_err(|e| EditorErrorDto { kind: "io", message: e.to_string(), current: None })??;
    Ok(Response::new(bytes))
}
