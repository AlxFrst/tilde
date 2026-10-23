//! SSH client for Tilde. No Tauri dependency.

mod agent;
mod auth;
mod chain;
mod connect;
mod connection;
mod error;
mod interact;
mod known_hosts;
mod proxy_command;
mod secrets;
mod shell;

pub use agent::{
    AgentSource, DynAgent, WINDOWS_AGENT_PIPE, agent_candidates, connect_agent,
    default_agent_sources,
};
pub use auth::{AuthStep, DEFAULT_KEYS, auth_plan};
pub use chain::{Connection, MAX_HOPS, plan_chain};
pub use connect::{AsyncStream, ClientHandler, Connector, SshDefaults};
pub use connection::{
    ConnState, RECONNECTED_LINE, SshSessionSpec, SshTarget, StateCallback, backoff,
    open_ssh_session,
};
pub use error::{ConnectError, HopLabel};
pub use interact::{
    HostKeyDecision, HostKeyPrompt, KbdPrompt, Prompter, SecretAnswer, SecretKind, SecretPrompt,
};
pub use known_hosts::{HostKeyStatus, KnownHosts, fingerprint};
pub use proxy_command::{ProxyStream, spawn_proxy_command};
pub use secrets::{KeyringStore, MemoryStore, SecretStore, passphrase_account, password_account};
pub use shell::{HOLD_CAP, STALL_MAX, SshShell};
