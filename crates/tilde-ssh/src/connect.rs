//! Opening one SSH connection: TCP (or a given stream), host key check, authentication.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use parking_lot::Mutex;
use russh::{
    Channel, MethodKind, MethodSet,
    client::{self, AuthResult, ChannelOpenHandle, Handle, KeyboardInteractiveAuthResponse},
    keys::{
        PrivateKey, PrivateKeyWithHashAlg, PublicKey, PublicKeyOrCertificate, agent::AgentIdentity,
    },
};
use tilde_ssh_config::ResolvedHost;
use tokio::{
    io::{AsyncRead, AsyncWrite},
    net::TcpStream,
    time::timeout,
};

use crate::{
    AgentSource, AuthStep, ConnectError, HopLabel, HostKeyDecision, HostKeyPrompt, HostKeyStatus,
    KbdPrompt, KnownHosts, Prompter, SecretAnswer, SecretKind, SecretPrompt, SecretStore,
    agent::{DynAgent, connect_agent, default_agent_sources},
    auth_plan, fingerprint, passphrase_account, password_account,
};

/// Attempts per secret (password or passphrase) before giving up.
const MAX_ATTEMPTS: u32 = 3;

/// A byte stream an SSH connection can run over (TCP, a jump-host channel, a proxy command).
pub trait AsyncStream: AsyncRead + AsyncWrite + Unpin + Send + 'static {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send + 'static> AsyncStream for T {}

/// Defaults applied when `ssh_config` does not say otherwise.
#[derive(Debug, Clone, Copy)]
pub struct SshDefaults {
    pub connect_timeout: Duration,
    pub keepalive_interval: Duration,
    pub keepalive_max: usize,
}

impl Default for SshDefaults {
    fn default() -> Self {
        Self {
            connect_timeout: Duration::from_secs(15),
            keepalive_interval: Duration::from_secs(15),
            keepalive_max: 3,
        }
    }
}

/// Everything needed to open connections on the user's behalf.
pub struct Connector {
    /// `None`: use the host's `UserKnownHostsFile`s from `ssh_config`.
    pub known_hosts: Option<KnownHosts>,
    pub prompter: Arc<dyn Prompter>,
    pub secrets: Arc<dyn SecretStore>,
    pub defaults: SshDefaults,
    /// Home directory (default keys live in `~/.ssh`).
    pub home: PathBuf,
    /// Where to look for an SSH agent; `None`: the platform defaults.
    pub agent_sources: Option<Vec<AgentSource>>,
}

/// russh callbacks for one connection.
pub struct ClientHandler {
    host: String,
    port: u16,
    known_hosts: KnownHosts,
    prompter: Arc<dyn Prompter>,
    /// Why the host key was refused, to report it instead of a generic russh error.
    rejection: Arc<Mutex<Option<String>>>,
    /// `ForwardAgent yes`: serve the server's agent requests from the local agent.
    forward_agent: bool,
    agent_sources: Vec<AgentSource>,
}

impl ClientHandler {
    fn reject(&self, reason: &str) -> bool {
        *self.rejection.lock() = Some(reason.to_owned());
        false
    }
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    /// Bridges an `auth-agent@openssh.com` channel to a fresh local agent connection.
    /// Refused (by dropping `reply`) unless `ForwardAgent` is on for this host.
    async fn server_channel_open_agent_forward(
        &mut self,
        channel: Channel<client::Msg>,
        reply: ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        if !self.forward_agent {
            return Ok(());
        }
        reply.accept().await;
        let sources = self.agent_sources.clone();
        tokio::spawn(async move {
            let Some(agent) = connect_agent(&sources).await else {
                tracing::warn!("agent forwarding requested but no local agent answers");
                return;
            };
            let mut local = agent.into_inner();
            let mut remote = channel.into_stream();
            let _ = tokio::io::copy_bidirectional(&mut local, &mut remote).await;
        });
        Ok(())
    }

    async fn check_server_key(
        &mut self,
        server_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let PublicKeyOrCertificate::PublicKey { key, .. } = server_key else {
            return Ok(self.reject("certificats d'hôte non pris en charge"));
        };
        let status = self.known_hosts.check(&self.host, self.port, key);
        match status {
            HostKeyStatus::Known => return Ok(true),
            HostKeyStatus::Revoked => {
                return Ok(self.reject("cette clé est révoquée dans known_hosts"));
            }
            HostKeyStatus::Unknown | HostKeyStatus::Changed { .. } => {}
        }
        let changed = matches!(status, HostKeyStatus::Changed { .. });
        let decision = self
            .prompter
            .host_key(HostKeyPrompt {
                host: self.host.clone(),
                port: self.port,
                key_type: key.algorithm().as_str().to_owned(),
                fingerprint: fingerprint(key),
                status,
            })
            .await;
        let saved = match decision {
            HostKeyDecision::Reject => {
                let why = if changed { "empreinte modifiée" } else { "hôte inconnu refusé" };
                return Ok(self.reject(why));
            }
            HostKeyDecision::AcceptOnce => Ok(()),
            HostKeyDecision::AcceptAndSave if !changed => {
                self.known_hosts.add(&self.host, self.port, key)
            }
            // Accepting a changed key always replaces the old line.
            HostKeyDecision::AcceptAndSave | HostKeyDecision::Replace => {
                self.known_hosts.replace(&self.host, self.port, key)
            }
        };
        if let Err(e) = saved {
            tracing::warn!(error = %e, "could not update known_hosts");
        }
        Ok(true)
    }
}

/// Tries every agent identity, the ones matching an `IdentityFile` first.
/// `None` on success; otherwise the methods the server still accepts, if it said.
async fn agent_auth(
    handle: &mut Handle<ClientHandler>,
    user: &str,
    agent: &mut DynAgent,
    identity_files: &[PathBuf],
    hop: &HopLabel,
) -> Result<Option<Option<MethodSet>>, ConnectError> {
    let ssh = |source| ConnectError::Ssh { hop: hop.clone(), source: Box::new(source) };
    let Ok(identities) = agent.request_identities().await else { return Ok(Some(None)) };
    let preferred: Vec<PublicKey> = identity_files
        .iter()
        .filter_map(|p| std::fs::read_to_string(format!("{}.pub", p.display())).ok())
        .filter_map(|text| PublicKey::from_openssh(text.trim()).ok())
        .collect();
    let mut keys: Vec<PublicKey> = identities
        .into_iter()
        .filter_map(|id| match id {
            AgentIdentity::PublicKey { key, .. } => Some(key),
            AgentIdentity::Certificate { .. } => None,
        })
        .collect();
    keys.sort_by_key(|k| !preferred.iter().any(|p| p.key_data() == k.key_data()));
    let mut remaining = None;
    for key in keys {
        let hash = if key.algorithm().is_rsa() {
            handle.best_supported_rsa_hash().await.map_err(ssh)?.flatten()
        } else {
            None
        };
        match handle.authenticate_publickey_with(user, key, hash, agent).await {
            Ok(AuthResult::Success) => return Ok(None),
            Ok(AuthResult::Failure { remaining_methods, .. }) => {
                remaining = Some(remaining_methods);
            }
            Err(e) => tracing::debug!(error = %e, "agent signature failed"),
        }
    }
    Ok(Some(remaining))
}

/// `~/.ssh/id_ed25519` rather than the full path, for messages.
fn display_path(path: &Path, home: &Path) -> String {
    path.strip_prefix(home)
        .map_or_else(|_| path.display().to_string(), |rest| format!("~/{}", rest.display()))
        .replace('\\', "/")
}

/// Whether the server still accepts `kind` (unknown before the first failure).
fn allowed(remaining: Option<&MethodSet>, kind: MethodKind) -> bool {
    remaining.is_none_or(|set| set.contains(&kind))
}

impl Connector {
    fn agent_sources(&self) -> Vec<AgentSource> {
        self.agent_sources.clone().unwrap_or_else(default_agent_sources)
    }

    fn known_hosts_for(&self, host: &ResolvedHost) -> KnownHosts {
        self.known_hosts
            .clone()
            .unwrap_or_else(|| KnownHosts::new(host.user_known_hosts_files.clone()))
    }

    fn client_config(&self, host: &ResolvedHost) -> Arc<client::Config> {
        let interval = host
            .server_alive_interval
            .map_or(self.defaults.keepalive_interval, |s| Duration::from_secs(u64::from(s)));
        let max = host
            .server_alive_count_max
            .and_then(|n| usize::try_from(n).ok())
            .unwrap_or(self.defaults.keepalive_max);
        Arc::new(client::Config {
            inactivity_timeout: None,
            keepalive_interval: (!interval.is_zero()).then_some(interval),
            keepalive_max: max,
            nodelay: true,
            ..client::Config::default()
        })
    }

    /// Connects to `host` — over TCP, or over `stream` (jump host / proxy command) — then
    /// verifies its key and authenticates.
    ///
    /// # Errors
    ///
    /// A [`ConnectError`] naming `hop` and saying what went wrong.
    pub async fn connect_direct(
        &self,
        host: &ResolvedHost,
        stream: Option<Box<dyn AsyncStream>>,
        hop: HopLabel,
    ) -> Result<Handle<ClientHandler>, ConnectError> {
        let rejection = Arc::new(Mutex::new(None));
        let handler = ClientHandler {
            host: host.hostname.clone(),
            port: host.port,
            known_hosts: self.known_hosts_for(host),
            prompter: Arc::clone(&self.prompter),
            rejection: Arc::clone(&rejection),
            forward_agent: host.forward_agent,
            agent_sources: self.agent_sources(),
        };
        let deadline = host
            .connect_timeout
            .map_or(self.defaults.connect_timeout, |s| Duration::from_secs(u64::from(s)));
        let config = self.client_config(host);

        let stream: Box<dyn AsyncStream> = if let Some(s) = stream {
            s
        } else {
            let tcp = timeout(deadline, TcpStream::connect((host.hostname.as_str(), host.port)))
                .await
                .map_err(|_| ConnectError::Timeout { hop: hop.clone() })?
                .map_err(|source| ConnectError::Unreachable { hop: hop.clone(), source })?;
            Box::new(tcp)
        };

        // Bound the handshake too, but not the host-key question (the user may take time).
        let handshake = client::connect_stream(config, stream, handler);
        let mut handle = match handshake.await {
            Ok(h) => h,
            Err(source) => {
                if let Some(reason) = rejection.lock().take() {
                    return Err(ConnectError::HostKeyRejected { hop, reason });
                }
                return Err(ConnectError::Ssh { hop, source: Box::new(source) });
            }
        };
        self.authenticate(&mut handle, host, &hop).await?;
        tracing::info!(host = %host.hostname, port = host.port, user = %host.user, "ssh connected");
        Ok(handle)
    }

    async fn authenticate(
        &self,
        handle: &mut Handle<ClientHandler>,
        host: &ResolvedHost,
        hop: &HopLabel,
    ) -> Result<(), ConnectError> {
        let ssh = |source| ConnectError::Ssh { hop: hop.clone(), source: Box::new(source) };
        let user = host.user.as_str();
        let target = format!("{user}@{}", host.hostname);
        let mut tried: Vec<String> = Vec::new();
        let mut remaining: Option<MethodSet> = None;

        let mut agent =
            if host.identities_only { None } else { connect_agent(&self.agent_sources()).await };

        for step in auth_plan(host, &self.home, agent.is_some()) {
            match step {
                AuthStep::Agent => {
                    let Some(agent) = agent.as_mut() else { continue };
                    if !allowed(remaining.as_ref(), MethodKind::PublicKey) {
                        continue;
                    }
                    tried.push("agent".into());
                    match agent_auth(handle, user, agent, &host.identity_files, hop).await? {
                        None => return Ok(()),
                        Some(rest) => remaining = rest.or(remaining),
                    }
                }
                AuthStep::Key(path) => {
                    if !allowed(remaining.as_ref(), MethodKind::PublicKey) || !path.is_file() {
                        continue;
                    }
                    let Some(key) = self.load_key(&path, &target).await? else { continue };
                    tried.push(display_path(&path, &self.home));
                    let hash = if key.algorithm().is_rsa() {
                        handle.best_supported_rsa_hash().await.map_err(ssh)?.flatten()
                    } else {
                        None
                    };
                    let key = PrivateKeyWithHashAlg::new(Arc::new(key), hash);
                    match handle.authenticate_publickey(user, key).await.map_err(ssh)? {
                        AuthResult::Success => return Ok(()),
                        AuthResult::Failure { remaining_methods, .. } => {
                            remaining = Some(remaining_methods);
                        }
                    }
                }
                AuthStep::KeyboardInteractive => {
                    if !allowed(remaining.as_ref(), MethodKind::KeyboardInteractive) {
                        continue;
                    }
                    match self.keyboard_interactive(handle, user, &target, &mut tried, hop).await? {
                        Ok(()) => return Ok(()),
                        Err(rest) => remaining = Some(rest),
                    }
                }
                AuthStep::Password => {
                    if !allowed(remaining.as_ref(), MethodKind::Password) {
                        continue;
                    }
                    tried.push("mot de passe".into());
                    if self.password(handle, host, &target, hop).await? {
                        return Ok(());
                    }
                }
            }
        }
        Err(ConnectError::AuthFailed { hop: hop.clone(), user: user.to_owned(), tried })
    }

    /// Loads a private key, asking for (or recalling) its passphrase if it is encrypted.
    /// `None`: unusable key or the user cancelled — move on to the next method.
    async fn load_key(
        &self,
        path: &Path,
        target: &str,
    ) -> Result<Option<PrivateKey>, ConnectError> {
        match russh::keys::load_secret_key(path, None) {
            Ok(key) => return Ok(Some(key)),
            Err(russh::keys::Error::KeyIsEncrypted) => {}
            Err(e) => {
                tracing::warn!(key = %path.display(), error = %e, "private key skipped");
                return Ok(None);
            }
        }
        let account = passphrase_account(path);
        if let Some(stored) = self.secrets.get(&account) {
            if let Ok(key) = russh::keys::load_secret_key(path, Some(&stored)) {
                return Ok(Some(key));
            }
            self.secrets.delete(&account);
        }
        for attempt in 1..=MAX_ATTEMPTS {
            let Some(SecretAnswer { value, remember }) = self
                .prompter
                .secret(SecretPrompt {
                    kind: SecretKind::Passphrase { key_path: path.to_path_buf() },
                    target: target.to_owned(),
                    attempt,
                    can_remember: self.secrets.available(),
                })
                .await
            else {
                return Ok(None);
            };
            if let Ok(key) = russh::keys::load_secret_key(path, Some(&value)) {
                if remember {
                    self.secrets.set(&account, &value);
                }
                return Ok(Some(key));
            }
        }
        Ok(None)
    }

    async fn password(
        &self,
        handle: &mut Handle<ClientHandler>,
        host: &ResolvedHost,
        target: &str,
        hop: &HopLabel,
    ) -> Result<bool, ConnectError> {
        let ssh = |source| ConnectError::Ssh { hop: hop.clone(), source: Box::new(source) };
        let account = password_account(&host.user, &host.hostname, host.port);
        if let Some(stored) = self.secrets.get(&account) {
            let result = handle.authenticate_password(&host.user, stored).await.map_err(ssh)?;
            if matches!(result, AuthResult::Success) {
                return Ok(true);
            }
            // A remembered password that no longer works is forgotten, then asked again.
            self.secrets.delete(&account);
        }
        for attempt in 1..=MAX_ATTEMPTS {
            let Some(SecretAnswer { value, remember }) = self
                .prompter
                .secret(SecretPrompt {
                    kind: SecretKind::Password,
                    target: target.to_owned(),
                    attempt,
                    can_remember: self.secrets.available(),
                })
                .await
            else {
                return Err(ConnectError::Cancelled);
            };
            let result =
                handle.authenticate_password(&host.user, value.clone()).await.map_err(ssh)?;
            if matches!(result, AuthResult::Success) {
                if remember {
                    self.secrets.set(&account, &value);
                }
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// Runs keyboard-interactive rounds (2FA, OTP…). `Err(remaining)` when refused.
    async fn keyboard_interactive(
        &self,
        handle: &mut Handle<ClientHandler>,
        user: &str,
        target: &str,
        tried: &mut Vec<String>,
        hop: &HopLabel,
    ) -> Result<Result<(), MethodSet>, ConnectError> {
        let ssh = |source| ConnectError::Ssh { hop: hop.clone(), source: Box::new(source) };
        let mut response = handle
            .authenticate_keyboard_interactive_start(user, None::<String>)
            .await
            .map_err(ssh)?;
        let mut asked = false;
        loop {
            match response {
                KeyboardInteractiveAuthResponse::Success => return Ok(Ok(())),
                KeyboardInteractiveAuthResponse::Failure { remaining_methods, .. } => {
                    return Ok(Err(remaining_methods));
                }
                KeyboardInteractiveAuthResponse::InfoRequest { name, instructions, prompts } => {
                    let answers = if prompts.is_empty() {
                        Vec::new()
                    } else {
                        if !asked {
                            tried.push("keyboard-interactive".into());
                            asked = true;
                        }
                        self.prompter
                            .keyboard_interactive(KbdPrompt {
                                target: target.to_owned(),
                                name,
                                instructions,
                                prompts: prompts.into_iter().map(|p| (p.prompt, p.echo)).collect(),
                            })
                            .await
                            .ok_or(ConnectError::Cancelled)?
                    };
                    response = handle
                        .authenticate_keyboard_interactive_respond(answers)
                        .await
                        .map_err(ssh)?;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_path_uses_tilde() {
        let home = Path::new("/home/me");
        assert_eq!(display_path(&home.join(".ssh/id_rsa"), home), "~/.ssh/id_rsa");
        assert_eq!(display_path(Path::new("/keys/k"), home), "/keys/k");
    }
}
