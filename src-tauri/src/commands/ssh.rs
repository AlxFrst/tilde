//! SSH: the host list for quick connect, answers to connection questions, tunnels.

use serde::Serialize;
use tauri::State;
use tilde_ssh::{ForwardInfo, ForwardSpec, SecretStore, SshShell};
use tilde_ssh_config::{ResolveContext, parse_file};

use crate::{commands::session::SessionErrorDto, prompter::PromptReply, state::AppState};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHostEntry {
    pub alias: String,
    pub hostname: String,
    pub user: String,
    pub port: u16,
}

/// The concrete `Host` entries of `~/.ssh/config`, read on each call (it is small).
#[tauri::command]
pub async fn ssh_hosts() -> Vec<SshHostEntry> {
    let ctx = ResolveContext::from_env();
    let config = parse_file(&ctx.home.join(".ssh").join("config"));
    for d in &config.diagnostics {
        tracing::info!(diagnostic = %d, "ssh_config");
    }
    config
        .concrete_hosts()
        .into_iter()
        .map(|alias| {
            let host = config.resolve(&alias, &ctx);
            SshHostEntry { alias, hostname: host.hostname, user: host.user, port: host.port }
        })
        .collect()
}

/// Answers a question asked with `ssh://prompt`. `false` if it is no longer waiting.
#[tauri::command]
pub fn ssh_prompt_reply(state: State<'_, AppState>, id: u32, reply: PromptReply) -> bool {
    state.ssh.prompter.get().is_some_and(|p| p.reply(id, reply))
}

/// Whether "remember in the keyring" can be offered.
#[tauri::command]
pub async fn secrets_available(state: State<'_, AppState>) -> Result<bool, ()> {
    Ok(state.ssh.secrets.available())
}

fn shell(state: &AppState, session_id: u32) -> Result<std::sync::Arc<SshShell>, SessionErrorDto> {
    state.ssh.shells.lock().get(&session_id).cloned().ok_or_else(|| SessionErrorDto {
        kind: "notFound",
        message: format!("session SSH {session_id} introuvable"),
    })
}

#[tauri::command]
pub fn ssh_forwards(
    state: State<'_, AppState>,
    session_id: u32,
) -> Result<Vec<ForwardInfo>, SessionErrorDto> {
    Ok(shell(&state, session_id)?.forwards())
}

#[tauri::command]
pub async fn ssh_forward_add(
    state: State<'_, AppState>,
    session_id: u32,
    spec: ForwardSpec,
) -> Result<ForwardInfo, SessionErrorDto> {
    let shell = shell(&state, session_id)?;
    Ok(shell.add_forward(spec).await)
}

#[tauri::command]
pub async fn ssh_forward_remove(
    state: State<'_, AppState>,
    session_id: u32,
    forward_id: u32,
) -> Result<bool, SessionErrorDto> {
    let shell = shell(&state, session_id)?;
    Ok(shell.remove_forward(forward_id).await)
}
