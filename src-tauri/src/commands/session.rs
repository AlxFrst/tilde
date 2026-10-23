//! Terminal sessions: output streams to the front-end as raw bytes over a channel,
//! input arrives as a raw request body. No JSON per byte in either direction.

use std::path::{Path, PathBuf};
use std::{sync::Arc, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{
    State,
    ipc::{Channel, InvokeBody, InvokeResponseBody, Request},
};
use tilde_session::{OutputSink, SessionError, SessionId, SessionSpec};
use tilde_ssh::{
    ConnState, ConnectError, Connector, SshDefaults, SshSessionSpec, SshTarget, StateCallback,
    open_ssh_session,
};
use tilde_ssh_config::{ResolveContext, parse_file};

use crate::{commands::profiles::current_profiles, state::AppState};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOpened {
    pub id: u32,
    /// The local profile used (`None` for SSH).
    pub profile_id: Option<String>,
}

/// What `session_open` starts. Mirrors `SessionTarget` in src/ipc/session.ts.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum OpenTarget {
    Local {
        profile_id: String,
    },
    /// An alias of `~/.ssh/config` or `[user@]host[:port]`.
    Ssh {
        target: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SessionEvent {
    Exit {
        code: Option<i32>,
    },
    /// SSH only: connection progress, loss, reconnection.
    State {
        state: ConnState,
    },
}

/// Mirrors `SessionErrorDto` in src/ipc/session.ts.
#[derive(Debug, Serialize)]
pub struct SessionErrorDto {
    /// `profileNotFound`, `spawn`, `notFound`, `io`, `ssh` or `cancelled`.
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

impl From<ConnectError> for SessionErrorDto {
    fn from(e: ConnectError) -> Self {
        let kind = if matches!(e, ConnectError::Cancelled) { "cancelled" } else { "ssh" };
        Self { kind, message: e.to_string() }
    }
}

struct ChannelSink {
    output: Channel<InvokeResponseBody>,
    events: Channel<SessionEvent>,
    /// Runs once the session has ended on its own.
    on_exit: Option<Box<dyn Fn() + Send + Sync>>,
}

impl OutputSink for ChannelSink {
    fn data(&self, bytes: Vec<u8>) {
        let _ = self.output.send(InvokeResponseBody::Raw(bytes));
    }
    fn exited(&self, code: Option<i32>) {
        if let Some(on_exit) = &self.on_exit {
            on_exit();
        }
        let _ = self.events.send(SessionEvent::Exit { code });
    }
}

/// The requested directory if it exists, else the profile's, else `None` (home).
pub(crate) fn start_dir(requested: Option<&str>, profile_cwd: Option<&str>) -> Option<PathBuf> {
    [requested, profile_cwd].into_iter().flatten().map(PathBuf::from).find(|p| p.is_dir())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri command: one argument per IPC field
pub async fn session_open(
    state: State<'_, AppState>,
    target: OpenTarget,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    output: Channel<InvokeResponseBody>,
    events: Channel<SessionEvent>,
) -> Result<SessionOpened, SessionErrorDto> {
    match target {
        OpenTarget::Local { profile_id } => {
            open_local(&state, profile_id, cwd, cols, rows, output, events)
        }
        OpenTarget::Ssh { target } => {
            let id = open_ssh(&state, &target, cols, rows, output, events).await?;
            Ok(SessionOpened { id, profile_id: None })
        }
    }
}

fn open_local(
    state: &AppState,
    profile_id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    output: Channel<InvokeResponseBody>,
    events: Channel<SessionEvent>,
) -> Result<SessionOpened, SessionErrorDto> {
    let profile =
        current_profiles(state).into_iter().find(|p| p.id == profile_id).ok_or_else(|| {
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
    let id = state.sessions.open(spec, Arc::new(ChannelSink { output, events, on_exit: None }))?;
    Ok(SessionOpened { id: id.0, profile_id: Some(profile_id) })
}

/// Connects (asking the user through `ssh://prompt` as needed) and registers the shell.
async fn open_ssh(
    state: &AppState,
    text: &str,
    cols: u16,
    rows: u16,
    output: Channel<InvokeResponseBody>,
    events: Channel<SessionEvent>,
) -> Result<u32, SessionErrorDto> {
    let target =
        SshTarget::parse(text).map_err(|message| SessionErrorDto { kind: "ssh", message })?;
    let settings = state.settings.lock().settings().ssh.clone();
    let prompter = state.ssh.prompter.get().cloned().ok_or_else(|| SessionErrorDto {
        kind: "ssh",
        message: "l'application démarre encore, réessayez".into(),
    })?;
    let ctx = ResolveContext::from_env();
    let config = parse_file(&ctx.home.join(".ssh").join("config"));
    let connector = Arc::new(Connector {
        known_hosts: None,
        prompter,
        secrets: state.ssh.secrets.clone(),
        defaults: SshDefaults {
            keepalive_interval: Duration::from_secs(u64::from(settings.keepalive_interval_secs)),
            keepalive_max: settings.keepalive_count_max as usize,
            ..SshDefaults::default()
        },
        home: ctx.home.clone(),
        agent_sources: None,
    });
    let state_events = events.clone();
    let on_state: StateCallback = Arc::new(move |s| {
        let _ = state_events.send(SessionEvent::State { state: s });
    });
    let spec = SshSessionSpec {
        config: Arc::new(config),
        ctx,
        target,
        cols,
        rows,
        auto_reconnect: settings.auto_reconnect,
    };
    let (shell, feed) = open_ssh_session(connector, spec, on_state).await?;

    let shells = Arc::clone(&state.ssh.shells);
    let ended = Arc::clone(&shell);
    let on_exit = Box::new(move || shells.lock().retain(|_, s| !Arc::ptr_eq(s, &ended)));
    let sink = ChannelSink { output, events, on_exit: Some(on_exit) };
    let (id, flow) = state.sessions.open_backend(shell.clone(), feed, Arc::new(sink))?;
    shell.attach_flow(flow);
    state.ssh.shells.lock().insert(id.0, shell);
    Ok(id.0)
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
    state.ssh.shells.lock().remove(&id);
    Ok(state.sessions.close(SessionId(id))?)
}

/// Inspects the process table, so it runs off the main thread. A connected SSH session
/// is always busy, unless `ssh.confirmCloseSsh` is off.
#[tauri::command]
pub async fn session_busy(state: State<'_, AppState>, id: u32) -> Result<bool, SessionErrorDto> {
    if state.ssh.shells.lock().contains_key(&id)
        && !state.settings.lock().settings().ssh.confirm_close_ssh
    {
        return Ok(false);
    }
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
