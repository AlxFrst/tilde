//! The SSH connection's questions, asked through the UI: an `ssh://prompt` event carries
//! the question, `ssh_prompt_reply` resolves it. Unanswered after [`PROMPT_TIMEOUT`],
//! the question is cancelled (and the dialog dismissed with `ssh://prompt-dismissed`).

use std::{
    collections::HashMap,
    sync::atomic::{AtomicU32, Ordering},
    time::Duration,
};

use async_trait::async_trait;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tilde_ssh::{
    HostKeyDecision, HostKeyPrompt, HostKeyStatus, KbdPrompt, Prompter, SecretAnswer, SecretKind,
    SecretPrompt,
};
use tokio::sync::oneshot;

pub const PROMPT_EVENT: &str = "ssh://prompt";
pub const DISMISS_EVENT: &str = "ssh://prompt-dismissed";
pub const PROMPT_TIMEOUT: Duration = Duration::from_mins(5);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedKey {
    pub file: String,
    pub line: usize,
    pub old_fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KbdQuestion {
    pub text: String,
    pub echo: bool,
}

/// A question for the user. Mirrors `SshPrompt` in src/ipc/ssh.ts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PromptRequest {
    HostKey {
        host: String,
        port: u16,
        key_type: String,
        fingerprint: String,
        /// Set when the recorded key differs (possible man-in-the-middle).
        changed: Option<ChangedKey>,
    },
    Secret {
        /// `password`, `passphrase` or `sudo` (the login password for the files pane).
        secret: &'static str,
        key_path: Option<String>,
        target: String,
        attempt: u32,
        can_remember: bool,
        /// For `sudo`: the user the files will be read and written as.
        #[serde(skip_serializing_if = "Option::is_none")]
        sudo_user: Option<String>,
    },
    KeyboardInteractive {
        target: String,
        name: String,
        instructions: String,
        questions: Vec<KbdQuestion>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PromptEvent {
    pub id: u32,
    #[serde(flatten)]
    pub request: PromptRequest,
}

/// The user's answer. No `Debug`: it may carry a secret.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PromptReply {
    HostKey { decision: HostKeyChoice },
    Secret { value: String, remember: bool },
    KeyboardInteractive { answers: Vec<String> },
    Cancel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HostKeyChoice {
    AcceptAndSave,
    AcceptOnce,
    Replace,
    Reject,
}

/// What the prompter tells the UI.
pub enum Notice {
    Ask(PromptEvent),
    Dismiss(u32),
}

type Notify = Box<dyn Fn(Notice) + Send + Sync>;

/// [`Prompter`] backed by the UI's dialogs.
pub struct UiPrompter {
    notify: Notify,
    timeout: Duration,
    next_id: AtomicU32,
    pending: Mutex<HashMap<u32, oneshot::Sender<PromptReply>>>,
}

impl UiPrompter {
    pub fn new(notify: Notify, timeout: Duration) -> Self {
        Self { notify, timeout, next_id: AtomicU32::new(0), pending: Mutex::new(HashMap::new()) }
    }

    /// Resolves question `id`. `false` if nobody is waiting for it (timed out, unknown).
    pub fn reply(&self, id: u32, reply: PromptReply) -> bool {
        match self.pending.lock().remove(&id) {
            Some(waiting) => waiting.send(reply).is_ok(),
            None => false,
        }
    }

    /// Asks and waits. `None`: cancelled or unanswered in time.
    async fn ask(&self, request: PromptRequest) -> Option<PromptReply> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let (tx, rx) = oneshot::channel();
        self.pending.lock().insert(id, tx);
        // Dismisses the dialog if we stop waiting without an answer: timeout, or the
        // connection attempt was dropped (tab closed).
        let _waiting = Waiting { prompter: self, id };
        (self.notify)(Notice::Ask(PromptEvent { id, request }));
        match tokio::time::timeout(self.timeout, rx).await {
            Ok(Ok(PromptReply::Cancel) | Err(_)) => None,
            Ok(Ok(reply)) => Some(reply),
            Err(_) => {
                tracing::info!(prompt = id, "ssh question unanswered in time: cancelled");
                None
            }
        }
    }
}

struct Waiting<'a> {
    prompter: &'a UiPrompter,
    id: u32,
}

impl Drop for Waiting<'_> {
    fn drop(&mut self) {
        // Still pending = never answered (an answer removes the entry first).
        if self.prompter.pending.lock().remove(&self.id).is_some() {
            (self.prompter.notify)(Notice::Dismiss(self.id));
        }
    }
}

#[async_trait]
impl Prompter for UiPrompter {
    async fn host_key(&self, req: HostKeyPrompt) -> HostKeyDecision {
        let changed = match req.status {
            HostKeyStatus::Changed { file, line, old_fingerprint } => {
                Some(ChangedKey { file: file.display().to_string(), line, old_fingerprint })
            }
            _ => None,
        };
        let request = PromptRequest::HostKey {
            host: req.host,
            port: req.port,
            key_type: req.key_type,
            fingerprint: req.fingerprint,
            changed,
        };
        match self.ask(request).await {
            Some(PromptReply::HostKey { decision }) => match decision {
                HostKeyChoice::AcceptAndSave => HostKeyDecision::AcceptAndSave,
                HostKeyChoice::AcceptOnce => HostKeyDecision::AcceptOnce,
                HostKeyChoice::Replace => HostKeyDecision::Replace,
                HostKeyChoice::Reject => HostKeyDecision::Reject,
            },
            _ => HostKeyDecision::Reject,
        }
    }

    async fn secret(&self, req: SecretPrompt) -> Option<SecretAnswer> {
        let (secret, key_path, sudo_user) = match req.kind {
            SecretKind::Password => ("password", None, None),
            SecretKind::Passphrase { key_path } => {
                ("passphrase", Some(key_path.display().to_string()), None)
            }
            SecretKind::Sudo { user } => ("sudo", None, Some(user)),
        };
        let request = PromptRequest::Secret {
            secret,
            key_path,
            target: req.target,
            attempt: req.attempt,
            can_remember: req.can_remember,
            sudo_user,
        };
        match self.ask(request).await {
            Some(PromptReply::Secret { value, remember }) => {
                Some(SecretAnswer { value, remember: remember && req.can_remember })
            }
            _ => None,
        }
    }

    async fn keyboard_interactive(&self, req: KbdPrompt) -> Option<Vec<String>> {
        let count = req.prompts.len();
        let request = PromptRequest::KeyboardInteractive {
            target: req.target,
            name: req.name,
            instructions: req.instructions,
            questions: req
                .prompts
                .into_iter()
                .map(|(text, echo)| KbdQuestion { text, echo })
                .collect(),
        };
        match self.ask(request).await {
            Some(PromptReply::KeyboardInteractive { answers }) if answers.len() == count => {
                Some(answers)
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    /// A prompter whose notices are recorded.
    fn prompter(timeout: Duration) -> (Arc<UiPrompter>, Arc<Mutex<Vec<String>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&seen);
        let notify: Notify = Box::new(move |n| {
            log.lock().push(match n {
                Notice::Ask(e) => format!("ask {}", serde_json::to_string(&e).unwrap()),
                Notice::Dismiss(id) => format!("dismiss {id}"),
            });
        });
        (Arc::new(UiPrompter::new(notify, timeout)), seen)
    }

    fn password_prompt() -> SecretPrompt {
        SecretPrompt {
            kind: SecretKind::Password,
            target: "alice@h".into(),
            attempt: 1,
            can_remember: true,
        }
    }

    async fn wait_for_question(seen: &Mutex<Vec<String>>) -> String {
        for _ in 0..200 {
            if let Some(ask) = seen.lock().iter().find(|s| s.starts_with("ask ")) {
                return ask.clone();
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("no question asked");
    }

    #[tokio::test]
    async fn reply_resolves_waiting_prompt() {
        let (p, seen) = prompter(PROMPT_TIMEOUT);
        let asking = tokio::spawn({
            let p = Arc::clone(&p);
            async move { p.secret(password_prompt()).await }
        });
        let ask = wait_for_question(&seen).await;
        assert_eq!(
            ask,
            r#"ask {"id":1,"kind":"secret","secret":"password","keyPath":null,"target":"alice@h","attempt":1,"canRemember":true}"#
        );
        assert!(p.reply(1, PromptReply::Secret { value: "pw".into(), remember: true }));
        let answer = asking.await.unwrap().unwrap();
        assert_eq!((answer.value.as_str(), answer.remember), ("pw", true));
    }

    #[tokio::test]
    async fn a_sudo_password_names_the_user_it_is_for() {
        let (p, seen) = prompter(PROMPT_TIMEOUT);
        let asking = tokio::spawn({
            let p = Arc::clone(&p);
            async move {
                p.secret(SecretPrompt {
                    kind: SecretKind::Sudo { user: "root".into() },
                    ..password_prompt()
                })
                .await
            }
        });
        let ask = wait_for_question(&seen).await;
        assert_eq!(
            ask,
            r#"ask {"id":1,"kind":"secret","secret":"sudo","keyPath":null,"target":"alice@h","attempt":1,"canRemember":true,"sudoUser":"root"}"#
        );
        assert!(p.reply(1, PromptReply::Cancel));
        assert!(asking.await.unwrap().is_none());
    }

    #[tokio::test]
    async fn timeout_rejects() {
        let (p, seen) = prompter(Duration::from_millis(50));
        let decision = p
            .host_key(HostKeyPrompt {
                host: "h".into(),
                port: 22,
                key_type: "ssh-ed25519".into(),
                fingerprint: "SHA256:x".into(),
                status: HostKeyStatus::Unknown,
            })
            .await;
        assert_eq!(decision, HostKeyDecision::Reject);
        assert_eq!(seen.lock().last().map(String::as_str), Some("dismiss 1"));
        assert!(!p.reply(1, PromptReply::Cancel), "a late answer finds nobody waiting");
    }

    #[tokio::test]
    async fn an_abandoned_question_is_dismissed() {
        let (p, seen) = prompter(PROMPT_TIMEOUT);
        let asking = tokio::spawn({
            let p = Arc::clone(&p);
            async move { p.secret(password_prompt()).await }
        });
        wait_for_question(&seen).await;
        asking.abort(); // the tab was closed while the dialog was open
        let _ = asking.await;
        assert_eq!(seen.lock().last().map(String::as_str), Some("dismiss 1"));
        assert!(!p.reply(1, PromptReply::Cancel), "nobody waits for it any more");
    }

    #[tokio::test]
    async fn unknown_prompt_id_is_ignored() {
        let (p, _) = prompter(PROMPT_TIMEOUT);
        assert!(!p.reply(42, PromptReply::Cancel));
    }

    #[tokio::test]
    async fn changed_key_carries_the_old_fingerprint_and_cancel_rejects() {
        let (p, seen) = prompter(PROMPT_TIMEOUT);
        let asking = tokio::spawn({
            let p = Arc::clone(&p);
            async move {
                p.host_key(HostKeyPrompt {
                    host: "h".into(),
                    port: 2222,
                    key_type: "ssh-ed25519".into(),
                    fingerprint: "SHA256:new".into(),
                    status: HostKeyStatus::Changed {
                        file: "/k".into(),
                        line: 3,
                        old_fingerprint: "SHA256:old".into(),
                    },
                })
                .await
            }
        });
        let ask = wait_for_question(&seen).await;
        assert!(
            ask.contains(r#""changed":{"file":"/k","line":3,"oldFingerprint":"SHA256:old"}"#),
            "{ask}"
        );
        assert!(p.reply(1, PromptReply::Cancel));
        assert_eq!(asking.await.unwrap(), HostKeyDecision::Reject);
    }

    #[test]
    fn replies_deserialize_from_the_ui() {
        let r: PromptReply =
            serde_json::from_str(r#"{"kind":"hostKey","decision":"acceptOnce"}"#).unwrap();
        assert!(matches!(r, PromptReply::HostKey { decision: HostKeyChoice::AcceptOnce }));
        let r: PromptReply =
            serde_json::from_str(r#"{"kind":"keyboardInteractive","answers":["1"]}"#).unwrap();
        assert!(matches!(r, PromptReply::KeyboardInteractive { answers } if answers == ["1"]));
    }
}
