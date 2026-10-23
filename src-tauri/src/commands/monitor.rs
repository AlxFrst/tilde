//! System monitor samples: this machine, or the server of an SSH session.

use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::State;
use tilde_monitor::{MonitorError, REMOTE_COMMAND, Snapshot, parse_remote};
use tilde_ssh::ExecError;

use crate::state::AppState;

/// The remote command prints a few KiB; anything this large is not its output.
const MAX_OUTPUT: usize = 1024 * 1024;
const EXEC_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorErrorDto {
    /// `notLinux`, `disconnected` or `failed`.
    pub kind: &'static str,
    pub message: String,
}

#[tauri::command]
pub async fn monitor_local(state: State<'_, AppState>) -> Result<Snapshot, ()> {
    // sysinfo reads /proc or system APIs: keep it off the async runtime.
    let monitor = std::sync::Arc::clone(&state.monitor_local);
    tauri::async_runtime::spawn_blocking(move || monitor.lock().sample()).await.map_err(|_| ())
}

#[tauri::command]
pub async fn monitor_remote(
    state: State<'_, AppState>,
    session_id: u32,
) -> Result<Snapshot, MonitorErrorDto> {
    let shell = state.ssh.shells.lock().get(&session_id).cloned();
    let Some(shell) = shell else {
        state.monitor_remote.lock().remove(&session_id);
        return Err(MonitorErrorDto {
            kind: "disconnected",
            message: "cette session SSH n'est plus ouverte".into(),
        });
    };
    let output = shell.exec(REMOTE_COMMAND, MAX_OUTPUT, EXEC_TIMEOUT).await.map_err(|e| {
        MonitorErrorDto {
            kind: if matches!(e, ExecError::Disconnected) { "disconnected" } else { "failed" },
            message: e.to_string(),
        }
    })?;
    let raw = parse_remote(&output.stdout).map_err(|e| MonitorErrorDto {
        kind: match e {
            MonitorError::NotLinux => "notLinux",
        },
        message: e.to_string(),
    })?;
    Ok(state.monitor_remote.lock().entry(session_id).or_default().update(raw, Instant::now()))
}
