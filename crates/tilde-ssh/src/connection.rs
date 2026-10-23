//! An SSH terminal session over time: connection, shell, loss detection (keepalive),
//! reconnection with backoff.

use std::{
    sync::{Arc, mpsc},
    time::Duration,
};

use russh::{Channel, ChannelMsg, client};
use serde::Serialize;
use tilde_session::OutputFeed;
use tilde_ssh_config::{ResolveContext, ResolvedHost, SshConfig};
use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};

use crate::{
    ConnectError, Connector, ForwardKind, ForwardSpec, HopLabel,
    chain::Connection,
    shell::{Delivery, Input, SshShell},
};

/// Injected into the terminal once the shell is back after a reconnection.
pub const RECONNECTED_LINE: &[u8] =
    b"\r\n\x1b[2m\xe2\x94\x80\xe2\x94\x80 reconnect\xc3\xa9 \xe2\x94\x80\xe2\x94\x80\x1b[0m\r\n";

/// How often held output is retried while the UI is behind.
const RELEASE_TICK: Duration = Duration::from_millis(20);

/// Where a session is, for the tab's status indicator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ConnState {
    Resolving,
    /// Reaching (and authenticating on) a hop; `hop` reads like "bastion 1/2 (b1)".
    Connecting {
        hop: String,
    },
    Ready,
    Lost {
        reason: String,
    },
    Reconnecting {
        attempt: u32,
        in_secs: u32,
    },
    Closed,
    Failed {
        message: String,
    },
}

/// What the user asked to connect to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SshTarget {
    /// A `Host` alias of `~/.ssh/config` (or any host name).
    Alias(String),
    /// `user@host:port`: `ssh_config` still applies to `host`; `user` and `port` win.
    Direct { user: Option<String>, host: String, port: Option<u16> },
}

impl SshTarget {
    #[must_use]
    pub fn resolve(&self, config: &SshConfig, ctx: &ResolveContext) -> ResolvedHost {
        match self {
            Self::Alias(alias) => config.resolve(alias, ctx),
            Self::Direct { user, host, port } => {
                let mut resolved = config.resolve(host, ctx);
                if let Some(user) = user {
                    resolved.user.clone_from(user);
                }
                if let Some(port) = port {
                    resolved.port = *port;
                }
                resolved
            }
        }
    }
}

/// Everything needed to open (and reopen) one terminal session.
pub struct SshSessionSpec {
    pub config: Arc<SshConfig>,
    pub ctx: ResolveContext,
    pub target: SshTarget,
    pub cols: u16,
    pub rows: u16,
    /// Reconnect after a loss (`settings.ssh.autoReconnect`).
    pub auto_reconnect: bool,
}

pub type StateCallback = Arc<dyn Fn(ConnState) + Send + Sync>;

/// Delay before reconnection attempt `attempt` (1-based): 1, 2, 4, 8, 16, then 30 s.
#[must_use]
pub fn backoff(attempt: u32) -> Duration {
    let secs = match attempt {
        0..=5 => 1 << attempt.saturating_sub(1),
        _ => 30,
    };
    Duration::from_secs(secs)
}

/// Errors that retrying cannot fix: they end the session instead of looping.
fn is_fatal(e: &ConnectError) -> bool {
    matches!(
        e,
        ConnectError::AuthFailed { .. }
            | ConnectError::HostKeyRejected { .. }
            | ConnectError::Cancelled
    )
}

/// Connects and starts a shell, then keeps the session alive (reconnecting on loss)
/// until the shell exits, reconnection fails for good, or the shell is closed.
/// The returned feed stays the same across reconnections.
///
/// # Errors
///
/// The first connection's failure.
pub async fn open_ssh_session(
    connector: Arc<Connector>,
    spec: SshSessionSpec,
    on_state: StateCallback,
) -> Result<(Arc<SshShell>, OutputFeed), ConnectError> {
    on_state(ConnState::Resolving);
    let host = spec.target.resolve(&spec.config, &spec.ctx);
    let (input_tx, input_rx) = unbounded_channel();
    let shell = Arc::new(SshShell::new(input_tx, spec.cols, spec.rows));
    let (connection, channel) =
        establish(&connector, &spec, &host, &shell, (spec.cols, spec.rows), &on_state).await?;
    shell.attach(Some(Arc::clone(&connection)));
    let configured =
        host.local_forwards.iter().map(|f| ForwardSpec::from_config(ForwardKind::Local, f)).chain(
            host.remote_forwards.iter().map(|f| ForwardSpec::from_config(ForwardKind::Remote, f)),
        );
    for forward in configured {
        shell.add_forward(forward).await;
    }
    on_state(ConnState::Ready);

    let (chunk_tx, chunks) = mpsc::channel();
    let (exit_tx, exit) = mpsc::channel();
    let supervisor = Supervisor {
        connector,
        spec,
        host,
        delivery: Delivery::new(Arc::clone(&shell), chunk_tx),
        shell: Arc::clone(&shell),
        input: Arc::new(tokio::sync::Mutex::new(input_rx)),
        exit: exit_tx,
        on_state,
    };
    tokio::spawn(supervisor.run(connection, channel));
    Ok((shell, OutputFeed { chunks, exit }))
}

/// Connects through the chain and opens a shell channel of `size`.
async fn establish(
    connector: &Connector,
    spec: &SshSessionSpec,
    host: &ResolvedHost,
    shell: &SshShell,
    (cols, rows): (u16, u16),
    on_state: &StateCallback,
) -> Result<(Arc<Connection>, Channel<client::Msg>), ConnectError> {
    let on_hop = |hop: &HopLabel| on_state(ConnState::Connecting { hop: hop.to_string() });
    let connection = connector
        .connect_chain_routed(&spec.config, &spec.ctx, host, on_hop, Some(shell.routes()))
        .await?;
    let hop = HopLabel::target(&host.hostname);
    let ssh = |source| ConnectError::Ssh { hop: hop.clone(), source: Box::new(source) };
    let target = connection.target();
    let channel = target.channel_open_session().await.map_err(ssh)?;
    channel
        .request_pty(false, "xterm-256color", u32::from(cols), u32::from(rows), 0, 0, &[])
        .await
        .map_err(ssh)?;
    // Only honoured if the server's AcceptEnv allows them; a refusal is harmless.
    for (name, value) in [
        ("TERM_PROGRAM", "Tilde"),
        ("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION")),
        ("COLORTERM", "truecolor"),
    ] {
        channel.set_env(false, name, value).await.map_err(ssh)?;
    }
    if host.forward_agent {
        channel.agent_forward(false).await.map_err(ssh)?;
    }
    channel.request_shell(false).await.map_err(ssh)?;
    Ok((Arc::new(connection), channel))
}

/// How one shell ended.
enum End {
    Exited(Option<i32>),
    Lost(String),
    Closed,
}

struct Supervisor {
    connector: Arc<Connector>,
    spec: SshSessionSpec,
    host: ResolvedHost,
    shell: Arc<SshShell>,
    delivery: Delivery,
    /// Shared with each connection's writer task, in turn.
    input: Arc<tokio::sync::Mutex<UnboundedReceiver<Input>>>,
    exit: mpsc::Sender<Option<i32>>,
    on_state: StateCallback,
}

impl Supervisor {
    async fn run(mut self, mut connection: Arc<Connection>, mut channel: Channel<client::Msg>) {
        loop {
            let end = self.serve(channel).await;
            self.shell.attach(None);
            connection.disconnect().await;
            match end {
                End::Exited(code) => {
                    let _ = self.exit.send(code);
                    break;
                }
                End::Closed => {
                    (self.on_state)(ConnState::Closed);
                    break;
                }
                End::Lost(reason) => {
                    tracing::info!(host = %self.host.hostname, %reason, "ssh connection lost");
                    (self.on_state)(ConnState::Lost { reason });
                    if !self.spec.auto_reconnect {
                        let _ = self.exit.send(None);
                        break;
                    }
                    let Some((c, ch)) = self.reconnect().await else { break };
                    (connection, channel) = (c, ch);
                    // Keystrokes typed while disconnected are not replayed.
                    while self.input.lock().await.try_recv().is_ok() {}
                    self.delivery.push(RECONNECTED_LINE.to_vec()).await;
                    self.shell.attach(Some(Arc::clone(&connection)));
                    self.shell.forwards.reattach(&connection).await;
                    (self.on_state)(ConnState::Ready);
                }
            }
        }
        self.shell.end();
    }

    /// Pumps one shell channel until it ends.
    async fn serve(&mut self, channel: Channel<client::Msg>) -> End {
        let (mut read, write) = channel.split();
        let input = Arc::clone(&self.input);
        let writer = tokio::spawn(async move {
            let mut input = input.lock_owned().await;
            while let Some(msg) = input.recv().await {
                let sent = match msg {
                    Input::Data(data) => write.data_bytes(data).await,
                    Input::Resize(cols, rows) => {
                        write.window_change(u32::from(cols), u32::from(rows), 0, 0).await
                    }
                };
                if sent.is_err() {
                    break;
                }
            }
        });
        let end = self.read(&mut read).await;
        writer.abort();
        end
    }

    async fn read(&mut self, read: &mut russh::ChannelReadHalf) -> End {
        if self.shell.is_closing() {
            return End::Closed;
        }
        let mut code = None;
        let mut exited = false;
        let mut tick = tokio::time::interval(RELEASE_TICK);
        loop {
            tokio::select! {
                () = self.shell.closed.notified() => return End::Closed,
                msg = read.wait() => match msg {
                    Some(ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, ext: 1 }) => {
                        self.delivery.push(data.to_vec()).await;
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        code = i32::try_from(exit_status).ok();
                        exited = true;
                    }
                    Some(ChannelMsg::ExitSignal { .. }) => exited = true,
                    Some(ChannelMsg::Close) => {
                        self.delivery.release();
                        return End::Exited(code);
                    }
                    Some(_) => {}
                    // The channel vanished without closing: the connection is gone.
                    None if exited => return End::Exited(code),
                    None => return End::Lost("connexion perdue".into()),
                },
                _ = tick.tick(), if self.delivery.has_backlog() => self.delivery.release(),
            }
        }
    }

    /// Retries with backoff until a new shell is up. `None` when the session is over
    /// (closed, or a failure retrying cannot fix).
    async fn reconnect(&mut self) -> Option<(Arc<Connection>, Channel<client::Msg>)> {
        for attempt in 1.. {
            let delay = backoff(attempt);
            (self.on_state)(ConnState::Reconnecting {
                attempt,
                in_secs: u32::try_from(delay.as_secs()).unwrap_or(u32::MAX),
            });
            let size = self.shell.size();
            let result = tokio::select! {
                () = self.shell.closed.notified() => None,
                r = async {
                    tokio::time::sleep(delay).await;
                    establish(&self.connector, &self.spec, &self.host, &self.shell, size, &self.on_state)
                        .await
                } => Some(r),
            };
            match result {
                None => {
                    (self.on_state)(ConnState::Closed);
                    return None;
                }
                Some(Ok(pair)) => return Some(pair),
                Some(Err(e)) if is_fatal(&e) => {
                    (self.on_state)(ConnState::Failed { message: e.to_string() });
                    let _ = self.exit.send(None);
                    return None;
                }
                Some(Err(e)) => tracing::info!(attempt, error = %e, "ssh reconnection failed"),
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use tilde_ssh_config::parse_str;

    use super::*;

    #[test]
    fn backoff_follows_the_schedule() {
        let secs: Vec<u64> = (1..=8).map(|a| backoff(a).as_secs()).collect();
        assert_eq!(secs, [1, 2, 4, 8, 16, 30, 30, 30]);
        assert_eq!(backoff(u32::MAX).as_secs(), 30);
    }

    #[test]
    fn direct_target_keeps_config_but_explicit_user_and_port_win() {
        let ctx = ResolveContext { local_user: "me".into(), home: "/home/me".into() };
        let config = parse_str(
            "Host srv\n HostName srv.example\n User alice\n Port 2222\n ForwardAgent yes\n",
            Path::new("/home/me/.ssh/config"),
        );
        let alias = SshTarget::Alias("srv".into()).resolve(&config, &ctx);
        assert_eq!(
            (alias.hostname.as_str(), alias.user.as_str(), alias.port),
            ("srv.example", "alice", 2222)
        );

        let direct =
            SshTarget::Direct { user: Some("root".into()), host: "srv".into(), port: Some(22) }
                .resolve(&config, &ctx);
        assert_eq!(
            (direct.hostname.as_str(), direct.user.as_str(), direct.port),
            ("srv.example", "root", 22)
        );
        assert!(direct.forward_agent);

        let bare =
            SshTarget::Direct { user: None, host: "srv".into(), port: None }.resolve(&config, &ctx);
        assert_eq!((bare.user.as_str(), bare.port), ("alice", 2222));
    }

    #[test]
    fn states_serialize_for_the_ui() {
        let json = |s: &ConnState| serde_json::to_string(s).unwrap();
        assert_eq!(json(&ConnState::Ready), r#"{"kind":"ready"}"#);
        assert_eq!(
            json(&ConnState::Reconnecting { attempt: 2, in_secs: 4 }),
            r#"{"kind":"reconnecting","attempt":2,"inSecs":4}"#
        );
        assert_eq!(
            json(&ConnState::Connecting { hop: "h".into() }),
            r#"{"kind":"connecting","hop":"h"}"#
        );
    }

    #[test]
    fn only_auth_and_host_key_failures_stop_reconnection() {
        let hop = HopLabel::target("h");
        let auth = ConnectError::AuthFailed { hop: hop.clone(), user: "u".into(), tried: vec![] };
        let key = ConnectError::HostKeyRejected { hop: hop.clone(), reason: "x".into() };
        let down = ConnectError::Timeout { hop };
        assert!(is_fatal(&auth));
        assert!(is_fatal(&key));
        assert!(is_fatal(&ConnectError::Cancelled));
        assert!(!is_fatal(&down));
    }

    #[test]
    fn reconnected_line_reads_right() {
        let text = String::from_utf8(RECONNECTED_LINE.to_vec()).unwrap();
        assert_eq!(text, "\r\n\x1b[2m── reconnecté ──\x1b[0m\r\n");
    }
}
