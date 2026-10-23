//! Finding and talking to an SSH agent (OpenSSH on Unix and Windows, Pageant).

use std::{ffi::OsString, path::PathBuf, time::Duration};

use russh::keys::agent::client::{AgentClient, AgentStream};

/// An agent with its transport erased, so every platform's agent has the same type.
pub type DynAgent = AgentClient<Box<dyn AgentStream + Send + Unpin + 'static>>;

/// Windows' OpenSSH agent service pipe.
pub const WINDOWS_AGENT_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);

/// Where an agent may be listening.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentSource {
    /// `SSH_AUTH_SOCK` on Unix.
    Unix(PathBuf),
    /// A Windows named pipe (OpenSSH's service, or `SSH_AUTH_SOCK` set to a pipe).
    NamedPipe(String),
    Pageant,
}

/// Agents to try, in order. On Windows a Unix-style `SSH_AUTH_SOCK` (Git Bash, Cygwin)
/// cannot be used and is ignored.
#[must_use]
pub fn agent_candidates(env_sock: Option<OsString>, windows: bool) -> Vec<AgentSource> {
    let env = env_sock.map(|s| s.to_string_lossy().into_owned()).filter(|s| !s.is_empty());
    if !windows {
        return env.map(|s| AgentSource::Unix(s.into())).into_iter().collect();
    }
    let mut out = Vec::new();
    if let Some(pipe) = env.filter(|s| s.starts_with(r"\\.\pipe\")) {
        out.push(AgentSource::NamedPipe(pipe));
    }
    let service = AgentSource::NamedPipe(WINDOWS_AGENT_PIPE.into());
    if !out.contains(&service) {
        out.push(service);
    }
    out.push(AgentSource::Pageant);
    out
}

/// The candidates for this machine (from `SSH_AUTH_SOCK` and the platform).
#[must_use]
pub fn default_agent_sources() -> Vec<AgentSource> {
    agent_candidates(std::env::var_os("SSH_AUTH_SOCK"), cfg!(windows))
}

async fn connect_source(source: &AgentSource) -> Option<DynAgent> {
    let result = match source {
        #[cfg(unix)]
        AgentSource::Unix(path) => AgentClient::connect_uds(path).await.map(AgentClient::dynamic),
        #[cfg(windows)]
        AgentSource::NamedPipe(pipe) => {
            AgentClient::connect_named_pipe(pipe).await.map(AgentClient::dynamic)
        }
        #[cfg(windows)]
        AgentSource::Pageant => AgentClient::connect_pageant().await.map(AgentClient::dynamic),
        #[allow(unreachable_patterns)]
        _ => return None,
    };
    result.inspect_err(|e| tracing::debug!(?source, error = %e, "ssh agent unavailable")).ok()
}

/// Connects to the first agent that answers among `sources` (2 s each).
pub async fn connect_agent(sources: &[AgentSource]) -> Option<DynAgent> {
    for source in sources {
        if let Ok(Some(mut agent)) =
            tokio::time::timeout(CONNECT_TIMEOUT, connect_source(source)).await
        {
            // Pageant "connects" even when not running: make sure it actually answers.
            if agent.request_identities().await.is_ok() {
                tracing::debug!(?source, "ssh agent connected");
                return Some(agent);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_without_env_tries_the_service_then_pageant() {
        assert_eq!(
            agent_candidates(None, true),
            [AgentSource::NamedPipe(WINDOWS_AGENT_PIPE.into()), AgentSource::Pageant]
        );
    }

    #[test]
    fn windows_env_pipe_comes_first() {
        let custom = r"\\.\pipe\my-agent";
        assert_eq!(
            agent_candidates(Some(custom.into()), true),
            [
                AgentSource::NamedPipe(custom.into()),
                AgentSource::NamedPipe(WINDOWS_AGENT_PIPE.into()),
                AgentSource::Pageant,
            ]
        );
    }

    #[test]
    fn windows_ignores_unix_style_sockets() {
        assert_eq!(
            agent_candidates(Some("/tmp/ssh-XXXX/agent.123".into()), true),
            [AgentSource::NamedPipe(WINDOWS_AGENT_PIPE.into()), AgentSource::Pageant]
        );
    }

    #[test]
    fn windows_does_not_repeat_the_service_pipe() {
        assert_eq!(
            agent_candidates(Some(WINDOWS_AGENT_PIPE.into()), true),
            [AgentSource::NamedPipe(WINDOWS_AGENT_PIPE.into()), AgentSource::Pageant]
        );
    }

    #[test]
    fn unix_uses_ssh_auth_sock_only() {
        assert_eq!(
            agent_candidates(Some("/run/agent.sock".into()), false),
            [AgentSource::Unix("/run/agent.sock".into())]
        );
        assert_eq!(agent_candidates(None, false), []);
        assert_eq!(agent_candidates(Some("".into()), false), []);
    }
}
