//! SSH client for Tilde. No Tauri dependency.

mod agent;
mod auth;
mod connect;
mod error;
mod interact;
mod known_hosts;
mod secrets;

pub use agent::{
    AgentSource, DynAgent, WINDOWS_AGENT_PIPE, agent_candidates, connect_agent,
    default_agent_sources,
};
pub use auth::{AuthStep, DEFAULT_KEYS, auth_plan};
pub use connect::{AsyncStream, ClientHandler, Connector, SshDefaults};
pub use error::{ConnectError, HopLabel};
pub use interact::{
    HostKeyDecision, HostKeyPrompt, KbdPrompt, Prompter, SecretAnswer, SecretKind, SecretPrompt,
};
pub use known_hosts::{HostKeyStatus, KnownHosts, fingerprint};
pub use secrets::{KeyringStore, MemoryStore, SecretStore, passphrase_account, password_account};
