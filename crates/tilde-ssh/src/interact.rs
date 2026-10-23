//! Questions the connection asks the user (host keys, passwords, passphrases, 2FA).
//! The app implements [`Prompter`] with dialogs; tests use scripted answers.

use std::path::PathBuf;

use async_trait::async_trait;

use crate::HostKeyStatus;

/// A server key that isn't simply known: new, or different from the recorded one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostKeyPrompt {
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub fingerprint: String,
    /// `Unknown` or `Changed` (a revoked key is refused without asking).
    pub status: HostKeyStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostKeyDecision {
    /// Trust and record in `known_hosts`.
    AcceptAndSave,
    /// Trust for this connection only.
    AcceptOnce,
    /// For a changed key: replace the recorded key (explicit, risky choice).
    Replace,
    Reject,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretKind {
    Password,
    Passphrase { key_path: PathBuf },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretPrompt {
    pub kind: SecretKind,
    /// `user@host`, shown in the dialog.
    pub target: String,
    /// 1-based attempt number (max 3).
    pub attempt: u32,
    /// False when no keyring is available: "remember" must be disabled.
    pub can_remember: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretAnswer {
    pub value: String,
    pub remember: bool,
}

/// A keyboard-interactive round (OTP, 2FA…).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KbdPrompt {
    pub target: String,
    pub name: String,
    pub instructions: String,
    /// `(question, echo)`: answers are hidden when `echo` is false.
    pub prompts: Vec<(String, bool)>,
}

/// Asks the user. `None` / `Reject` means "cancel".
#[async_trait]
pub trait Prompter: Send + Sync {
    async fn host_key(&self, req: HostKeyPrompt) -> HostKeyDecision;
    async fn secret(&self, req: SecretPrompt) -> Option<SecretAnswer>;
    async fn keyboard_interactive(&self, req: KbdPrompt) -> Option<Vec<String>>;
}
