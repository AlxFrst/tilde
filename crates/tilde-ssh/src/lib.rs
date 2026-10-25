//! SSH client for Tilde. No Tauri dependency.

mod agent;
mod auth;
mod chain;
mod connect;
mod connection;
mod edit;
mod error;
mod exec;
mod forward;
mod interact;
mod known_hosts;
mod notices;
mod proxy_command;
mod secrets;
mod sftp;
mod shell;
mod textfile;
mod transfer;

pub use agent::{
    AgentSource, DynAgent, WINDOWS_AGENT_PIPE, agent_candidates, connect_agent,
    default_agent_sources,
};
pub use auth::{AuthStep, DEFAULT_KEYS, auth_plan};
pub use chain::{Connection, MAX_HOPS, plan_chain};
pub use connect::{AsyncStream, ClientHandler, Connector, SshDefaults};
pub use connection::{
    ConnState, SshSessionSpec, SshTarget, StateCallback, backoff, open_ssh_session,
};
pub use edit::{
    EDIT_DEBOUNCE, EDIT_MAX_BYTES, EditSession, RemoteFile, Stamp, clean_stale_edit_dirs,
    session_temp_dir,
};
pub use error::{ConnectError, HopLabel};
pub use exec::{ExecError, ExecOutput};
pub use forward::{ForwardInfo, ForwardKind, ForwardSpec};
pub use interact::{
    HostKeyDecision, HostKeyPrompt, KbdPrompt, Prompter, SecretAnswer, SecretKind, SecretPrompt,
};
pub use known_hosts::{HostKeyStatus, KnownHosts, fingerprint};
pub use notices::set_english_notices;
pub use proxy_command::{ProxyStream, spawn_proxy_command};
pub use secrets::{KeyringStore, MemoryStore, SecretStore, passphrase_account, password_account};
pub use sftp::{
    EntryKind, MAX_REMOVE, RemoteEntry, SftpClient, SftpError, join_remote, safe_local_name,
};
pub use shell::{HOLD_CAP, STALL_MAX, SshShell};
pub use textfile::{
    PREVIEW_MAX_BYTES, TEXT_MAX_BYTES, TextError, decode_text, read_local_bytes, read_local_text,
    write_local_text,
};
pub use transfer::{
    CHUNK, Direction, PROGRESS_EVERY, Speed, Throttle, TransferInfo, TransferQueue, TransferState,
};
