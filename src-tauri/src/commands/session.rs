//! Terminal sessions: output streams to the front-end as raw bytes over a channel,
//! input arrives as a raw request body. No JSON per byte in either direction.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::{
    State,
    ipc::{Channel, InvokeBody, InvokeResponseBody, Request},
};
use tilde_session::{OutputSink, SessionError, SessionId, SessionSpec};

use crate::{commands::profiles::current_profiles, state::AppState};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOpened {
    pub id: u32,
    pub profile_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SessionEvent {
    Exit { code: Option<i32> },
}

/// Mirrors `SessionErrorDto` in src/ipc/session.ts.
#[derive(Debug, Serialize)]
pub struct SessionErrorDto {
    /// `profileNotFound`, `spawn`, `notFound` or `io`.
    pub kind: &'static str,
    pub message: String,
}

impl From<SessionError> for SessionErrorDto {
    fn from(e: SessionError) -> Self {
        let kind = match e {
            SessionError::Spawn { .. } => "spawn",
            SessionError::NotFound(_) => "notFound",
            SessionError::Io(_) => "io",
        };
        Self { kind, message: e.to_string() }
    }
}

struct ChannelSink {
    output: Channel<InvokeResponseBody>,
    events: Channel<SessionEvent>,
}

impl OutputSink for ChannelSink {
    fn data(&self, bytes: Vec<u8>) {
        let _ = self.output.send(InvokeResponseBody::Raw(bytes));
    }
    fn exited(&self, code: Option<i32>) {
        let _ = self.events.send(SessionEvent::Exit { code });
    }
}

/// The requested directory if it exists, else the profile's, else `None` (home).
pub(crate) fn start_dir(requested: Option<&str>, profile_cwd: Option<&str>) -> Option<PathBuf> {
    [requested, profile_cwd].into_iter().flatten().map(PathBuf::from).find(|p| p.is_dir())
}

#[tauri::command]
pub async fn session_open(
    state: State<'_, AppState>,
    profile_id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    output: Channel<InvokeResponseBody>,
    events: Channel<SessionEvent>,
) -> Result<SessionOpened, SessionErrorDto> {
    let profile =
        current_profiles(&state).into_iter().find(|p| p.id == profile_id).ok_or_else(|| {
            SessionErrorDto {
                kind: "profileNotFound",
                message: format!("profil « {profile_id} » introuvable"),
            }
        })?;
    let dir = start_dir(cwd.as_deref(), profile.cwd.as_deref());
    if cwd.as_deref().is_some_and(|c| !Path::new(c).is_dir()) {
        tracing::warn!(?cwd, "requested cwd does not exist; using the profile's or home");
    }
    let spec = SessionSpec {
        command: profile.command,
        args: profile.args,
        cwd: dir,
        env: profile.env,
        cols,
        rows,
    };
    let id = state.sessions.open(spec, Arc::new(ChannelSink { output, events }))?;
    Ok(SessionOpened { id: id.0, profile_id })
}

#[tauri::command]
pub fn session_write(
    state: State<'_, AppState>,
    request: Request<'_>,
) -> Result<(), SessionErrorDto> {
    let id = request
        .headers()
        .get("x-session-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u32>().ok())
        .ok_or(SessionErrorDto {
            kind: "notFound",
            message: "en-tête x-session-id manquant".into(),
        })?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(SessionErrorDto { kind: "io", message: "corps binaire attendu".into() });
    };
    Ok(state.sessions.write(SessionId(id), bytes)?)
}

#[tauri::command]
pub fn session_resize(
    state: State<'_, AppState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), SessionErrorDto> {
    Ok(state.sessions.resize(SessionId(id), cols, rows)?)
}

#[tauri::command]
pub fn session_ack(
    state: State<'_, AppState>,
    id: u32,
    bytes: usize,
) -> Result<(), SessionErrorDto> {
    Ok(state.sessions.ack(SessionId(id), bytes)?)
}

#[tauri::command]
pub fn session_close(state: State<'_, AppState>, id: u32) -> Result<(), SessionErrorDto> {
    Ok(state.sessions.close(SessionId(id))?)
}

/// Inspects the process table, so it runs off the main thread.
#[tauri::command]
pub async fn session_busy(state: State<'_, AppState>, id: u32) -> Result<bool, SessionErrorDto> {
    Ok(state.sessions.is_busy(SessionId(id))?)
}

#[cfg(test)]
mod tests {
    use super::start_dir;

    #[test]
    fn start_dir_prefers_existing_requested_cwd() {
        let tmp = std::env::temp_dir();
        let t = tmp.to_string_lossy().into_owned();
        assert_eq!(start_dir(Some(&t), Some("/nope")), Some(tmp.clone()));
        assert_eq!(start_dir(Some("/definitely/missing/dir"), Some(&t)), Some(tmp));
        assert_eq!(start_dir(Some("/definitely/missing/dir"), None), None);
        assert_eq!(start_dir(None, None), None);
    }
}
