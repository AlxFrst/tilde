//! Files as another user: an SFTP server started through `sudo` on a channel of the
//! session's connection, for what the login user cannot read or write (`/root`,
//! `/etc/ssl/private`…). The terminal's `sudo su` cannot be followed (nothing tells which
//! user a shell is), so the user picks it in the files pane.
//!
//! `sudo` reads the password on its standard input (`-S`, one byte at a time, classic sudo
//! and sudo-rs alike) and hands the rest of the input to the program it starts. That
//! program is a shell that finds `sftp-server`, says [`READY`] on its output, then becomes
//! the server, which speaks SFTP on the same channel. Until [`READY`], what `sudo` says is
//! read: a refused password stops the attempt at once, so no try is ever wasted, and the
//! reason is told as it is.

use std::{sync::Arc, time::Duration};

use russh::{Channel, ChannelMsg, client};
use zeroize::Zeroizing;

use crate::{
    Prompter, SecretAnswer, SecretKind, SecretPrompt, SecretStore, SftpClient, SftpError, SshShell,
    chain::Connection, secrets::sudo_account,
};

/// Who the files are read and written as, when not the login user.
#[derive(Clone)]
pub struct SudoUser {
    /// The account `sudo -u` switches to (`root`).
    pub user: String,
    /// The password `sudo` asks for, when it asks for one.
    pub password: Option<Zeroizing<String>>,
}

impl std::fmt::Debug for SudoUser {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SudoUser")
            .field("user", &self.user)
            .field("password", &self.password.as_ref().map(|_| "…"))
            .finish()
    }
}

/// Why the files cannot be opened as another user, phrased for the user.
#[derive(Debug, thiserror::Error)]
pub enum SudoError {
    #[error("nom d'utilisateur invalide : {0}")]
    InvalidUser(String),
    #[error("sudo demande un mot de passe")]
    PasswordRequired,
    #[error("mot de passe sudo refusé")]
    WrongPassword,
    #[error("sudo refusé : {0}")]
    Denied(String),
    #[error("sudo n'est pas installé sur ce serveur")]
    Missing,
    #[error("sftp-server introuvable sur ce serveur")]
    NoServer,
    #[error("la session SSH n'est pas connectée")]
    Disconnected,
    #[error("annulé")]
    Cancelled,
    #[error("sudo ne répond pas : {0}")]
    Failed(String),
}

/// What the shell `sudo` started says once it has found the SFTP server, just before
/// becoming it.
pub(crate) const READY: &str = "TILDE_SFTP_READY";

/// Finds the SFTP server (the distributions' usual places), says [`READY`], becomes it.
/// Run by `/bin/sh -c '…'`: it must not contain a single quote.
pub(crate) const SFTP_SERVER_SCRIPT: &str = "for p in /usr/lib/openssh/sftp-server \
/usr/libexec/openssh/sftp-server /usr/lib/ssh/sftp-server /usr/libexec/ssh/sftp-server \
/usr/libexec/sftp-server /usr/lib/sftp-server /usr/local/libexec/sftp-server \
/usr/local/lib/sftp-server; do if [ -x \"$p\" ]; then echo TILDE_SFTP_READY; exec \"$p\"; \
fi; done; echo sftp-server introuvable >&2; exit 127";

/// What the check runs: the same program as the server, so a rule that allows one
/// command but not a shell is seen before any password is asked.
const CHECK_COMMAND: &str = "/bin/sh -c 'exit 0'";

/// An account name that is safe on a command line: letters, digits, `_`, `.`, `-`, not
/// starting with `-` or `.`, at most 32 characters.
#[must_use]
pub fn valid_user(user: &str) -> bool {
    let mut chars = user.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphanumeric() || c == '_')
        && user.len() <= 32
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

/// `sudo` running `command` as `user`, in the C locale (its messages are matched): `-n`
/// when no password is needed, else `-S -k -p ''` (password on standard input, asked
/// every time so it is never left unread, no prompt).
pub(crate) fn sudo_command(user: &str, with_password: bool, command: &str) -> String {
    let how = if with_password { "-S -k -p ''" } else { "-n" };
    format!("env LC_ALL=C sudo {how} -u {user} -- {command}")
}

/// `password` and a line break, for `sudo -S`; wiped when dropped. Sized up front: a
/// buffer that grows would leave copies behind.
pub(crate) fn password_line(password: &str) -> Zeroizing<Vec<u8>> {
    let mut line = Vec::with_capacity(password.len() + 1);
    line.extend_from_slice(password.as_bytes());
    line.push(b'\n');
    Zeroizing::new(line)
}

/// A locked account (`pam_faillock`, sudo-rs): never taken for a wrong password, so a
/// remembered password is kept and nothing is tried again.
fn locked(said: &str) -> bool {
    said.contains("locked")
}

/// `sudo` refused the password just given (classic sudo and sudo-rs words).
pub(crate) fn refused_password(said: &str) -> bool {
    !locked(said)
        && (said.contains("Sorry, try again")
            || said.contains("incorrect password")
            || said.contains("Authentication failed")
            || said.contains("incorrect authentication"))
}

/// The last thing `sudo` said (after the lecture, warnings…), for the user.
fn last_line(said: &str) -> String {
    said.lines().map(str::trim).rfind(|l| !l.is_empty()).unwrap_or_default().to_owned()
}

/// What `sudo` said when it stopped, as an error.
pub(crate) fn read_refusal(exit: Option<u32>, said: &str) -> SudoError {
    if locked(said) {
        SudoError::Denied(last_line(said))
    } else if said.contains("sftp-server introuvable") {
        SudoError::NoServer
    } else if refused_password(said) {
        SudoError::WrongPassword
    } else if said.contains("a password is required")
        || said.contains("interactive authentication is required")
    {
        SudoError::PasswordRequired
    } else if exit == Some(127)
        || said.contains("command not found")
        || said.contains("sudo: not found")
    {
        SudoError::Missing
    } else if said.trim().is_empty() {
        SudoError::Failed("pas de réponse".into())
    } else {
        SudoError::Denied(last_line(said))
    }
}

/// What `sudo -n …` said: no password needed, or why not.
pub(crate) fn read_check(exit: Option<u32>, said: &str) -> Result<(), SudoError> {
    match exit {
        Some(0) => Ok(()),
        _ => Err(read_refusal(exit, said)),
    }
}

/// More than `sudo` ever says.
const MAX_OUTPUT: usize = 16 * 1024;

/// Appends `data` to `buf`, at most [`MAX_OUTPUT`] bytes in all.
fn keep(buf: &mut Vec<u8>, data: &[u8]) {
    let room = MAX_OUTPUT.saturating_sub(buf.len());
    buf.extend_from_slice(&data[..data.len().min(room)]);
}

/// Reads what `sudo` and the shell it started say until the shell announces the server
/// ([`READY`]). A refused password closes the channel at once: waiting would only let
/// `sudo` count another failed attempt.
///
/// # Errors
///
/// What `sudo` refused, or that it stopped without the server starting.
pub(crate) async fn wait_until_ready(channel: &mut Channel<client::Msg>) -> Result<(), SudoError> {
    let mut out = Vec::new();
    let mut said = Vec::new();
    let mut exit = None;
    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { data } => {
                keep(&mut out, &data);
                if String::from_utf8_lossy(&out).lines().any(|l| l.trim() == READY) {
                    return Ok(());
                }
            }
            ChannelMsg::ExtendedData { data, .. } => {
                keep(&mut said, &data);
                let text = String::from_utf8_lossy(&said);
                if refused_password(&text) || locked(&text) {
                    let _ = channel.close().await;
                    return Err(read_refusal(exit, &text));
                }
            }
            ChannelMsg::ExitStatus { exit_status } => exit = Some(exit_status),
            ChannelMsg::Close => break,
            _ => {}
        }
    }
    Err(read_refusal(exit, &String::from_utf8_lossy(&said)))
}

/// Bound on the check (`sudo -n`).
const CHECK_TIMEOUT: Duration = Duration::from_secs(15);
/// Tries per switch, remembered password included: as many as `sudo` itself allows, so
/// a switch never costs more failed attempts than one `sudo` in a terminal.
const MAX_ATTEMPTS: u32 = 3;

impl SshShell {
    /// `Ok` when `sudo -u user` needs no password for the server's shell; else why not
    /// ([`SudoError::PasswordRequired`] when it needs one). Never asks for a password, so
    /// it never counts as a failed attempt.
    ///
    /// # Errors
    ///
    /// See above; also a bad name, no connection or no answer.
    pub async fn sudo_check(&self, user: &str) -> Result<(), SudoError> {
        if !valid_user(user) {
            return Err(SudoError::InvalidUser(user.to_owned()));
        }
        let connection = self.connection().ok_or(SudoError::Disconnected)?;
        let failed = |e: russh::Error| SudoError::Failed(e.to_string());
        let command = sudo_command(user, false, CHECK_COMMAND);
        let run = async {
            let mut channel = connection.target().channel_open_session().await.map_err(failed)?;
            channel.exec(true, command).await.map_err(failed)?;
            channel.eof().await.map_err(failed)?;
            let mut said = Vec::new();
            let mut exit = None;
            while let Some(msg) = channel.wait().await {
                match msg {
                    ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                        keep(&mut said, &data);
                    }
                    ChannelMsg::ExitStatus { exit_status } => exit = Some(exit_status),
                    ChannelMsg::Close => break,
                    _ => {}
                }
            }
            read_check(exit, &String::from_utf8_lossy(&said))
        };
        tokio::time::timeout(CHECK_TIMEOUT, run)
            .await
            .map_err(|_| SudoError::Failed("le serveur ne répond pas".into()))?
    }

    /// Opens the files as `user` with `password` and makes them the session's: the open
    /// itself is the test of the password.
    async fn adopt(
        &self,
        connection: &Arc<Connection>,
        user: &str,
        password: Option<Zeroizing<String>>,
    ) -> Result<(), SudoError> {
        let who = SudoUser { user: user.to_owned(), password };
        match SftpClient::open_as(connection, &who).await {
            Ok(client) => {
                self.install_sftp(Arc::clone(connection), Some(who), client).await;
                Ok(())
            }
            Err(SftpError::Sudo(e)) => Err(e),
            Err(e) => Err(SudoError::Failed(e.to_string())),
        }
    }

    /// From now on the files of this session are read and written as `user`, through
    /// `sudo` (`None`: as the login user again). When `sudo` wants a password, the one
    /// remembered for it is tried, else the user is asked through `prompter` (and the
    /// password remembered if they say so); at most three tries in all, as `sudo` allows.
    /// One switch at a time.
    ///
    /// # Errors
    ///
    /// The user cannot use `sudo` that way, the password was refused, or the prompt was
    /// cancelled. The files keep their current user then.
    pub async fn switch_sftp_user(
        &self,
        user: Option<&str>,
        secrets: &dyn SecretStore,
        prompter: &dyn Prompter,
    ) -> Result<(), SudoError> {
        let _one_at_a_time = self.switching.lock().await;
        let Some(user) = user else {
            self.set_sftp_as(None).await;
            return Ok(());
        };
        let connection = self.connection().ok_or(SudoError::Disconnected)?;
        match self.sudo_check(user).await {
            Ok(()) => return self.adopt(&connection, user, None).await,
            Err(SudoError::PasswordRequired) => {}
            Err(e) => return Err(e),
        }
        let (login, host, port) = self.login().ok_or(SudoError::Disconnected)?;
        let (login, host) = (login.to_owned(), host.to_owned());
        let account = sudo_account(&login, &host, port);
        let mut tries = 0;
        if let Some(stored) = secrets.get(&account).map(Zeroizing::new) {
            tries += 1;
            match self.adopt(&connection, user, Some(stored)).await {
                Ok(()) => return Ok(()),
                // A remembered password that no longer works is forgotten, then asked.
                Err(SudoError::WrongPassword) => secrets.delete(&account),
                Err(e) => return Err(e),
            }
        }
        while tries < MAX_ATTEMPTS {
            tries += 1;
            let Some(SecretAnswer { value, remember }) = prompter
                .secret(SecretPrompt {
                    kind: SecretKind::Sudo { user: user.to_owned() },
                    target: format!("{login}@{host}"),
                    attempt: tries,
                    can_remember: secrets.available(),
                })
                .await
            else {
                return Err(SudoError::Cancelled);
            };
            let value = Zeroizing::new(value);
            match self.adopt(&connection, user, Some(value.clone())).await {
                Ok(()) => {
                    if remember {
                        secrets.set(&account, &value);
                    }
                    return Ok(());
                }
                Err(SudoError::WrongPassword) => {}
                Err(e) => return Err(e),
            }
        }
        Err(SudoError::WrongPassword)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_account_names_reach_the_command_line() {
        for ok in ["root", "www-data", "deploy_1", "svc.app", "Admin"] {
            assert!(valid_user(ok), "{ok}");
        }
        let long = "a".repeat(33);
        for bad in ["", "-u", ".x", "root;rm", "a b", "$(id)", "ro'ot", "a\nb", "é", &long] {
            assert!(!valid_user(bad), "{bad:?}");
        }
    }

    #[test]
    fn the_command_asks_for_a_password_only_when_one_is_given() {
        assert_eq!(sudo_command("root", false, "true"), "env LC_ALL=C sudo -n -u root -- true");
        assert_eq!(
            sudo_command("www-data", true, "true"),
            "env LC_ALL=C sudo -S -k -p '' -u www-data -- true"
        );
        assert!(!CHECK_COMMAND.contains(';'));
    }

    #[test]
    fn the_server_script_announces_the_server_and_survives_single_quoting() {
        assert!(!SFTP_SERVER_SCRIPT.contains('\''));
        assert!(SFTP_SERVER_SCRIPT.contains(&format!("echo {READY}; exec")));
        assert!(SFTP_SERVER_SCRIPT.contains("/usr/lib/openssh/sftp-server"));
        assert!(SFTP_SERVER_SCRIPT.contains("/usr/lib/ssh/sftp-server"));
    }

    #[test]
    fn the_password_line_is_sized_once() {
        let line = password_line("s3cret");
        assert_eq!(&line[..], b"s3cret\n");
        assert_eq!(line.capacity(), 7);
    }

    #[test]
    fn classic_sudo_answers_are_read() {
        assert!(read_check(Some(0), "").is_ok());
        assert!(matches!(
            read_check(Some(1), "sudo: a password is required\n"),
            Err(SudoError::PasswordRequired)
        ));
        assert!(matches!(read_check(Some(127), "sh: sudo: not found\n"), Err(SudoError::Missing)));
        assert!(matches!(
            read_check(Some(1), "sudo: sorry, you must have a tty to run sudo\n"),
            Err(SudoError::Denied(m)) if m == "sudo: sorry, you must have a tty to run sudo"
        ));
        assert!(matches!(
            read_refusal(Some(1), "Sorry, try again.\nsudo: 1 incorrect password attempt\n"),
            SudoError::WrongPassword
        ));
        // The lecture comes first; the reason is the last line.
        assert!(matches!(
            read_refusal(
                Some(1),
                "\nWe trust you have received the usual lecture.\n\nSorry, user tilde is not \
                 allowed to execute '/bin/sh -c exit 0' as root on target.\n"
            ),
            SudoError::Denied(m) if m.starts_with("Sorry, user tilde is not allowed")
        ));
        assert!(matches!(
            read_refusal(Some(127), "sftp-server introuvable\n"),
            SudoError::NoServer
        ));
        assert!(matches!(read_refusal(None, ""), SudoError::Failed(_)));
    }

    #[test]
    fn sudo_rs_answers_are_read() {
        assert!(matches!(
            read_check(Some(1), "sudo: interactive authentication is required\n"),
            Err(SudoError::PasswordRequired)
        ));
        assert!(matches!(
            read_refusal(
                Some(1),
                "sudo: Authentication failed, try again.\nsudo: maximum 3 incorrect \
                 authentication attempts\n"
            ),
            SudoError::WrongPassword
        ));
        assert!(matches!(
            read_refusal(Some(1), "sudo: I'm sorry tilde. I'm afraid I can't do that\n"),
            SudoError::Denied(_)
        ));
        assert!(matches!(
            read_refusal(Some(1), "sudo: user 'nosuchuser' not found\n"),
            SudoError::Denied(m) if m == "sudo: user 'nosuchuser' not found"
        ));
    }

    #[test]
    fn a_locked_account_is_never_a_wrong_password() {
        let faillock = "Sorry, try again.\nThe account is locked due to 3 failed logins.\n";
        assert!(!refused_password(faillock));
        assert!(matches!(read_refusal(Some(1), faillock), SudoError::Denied(_)));
        let sudo_rs = "sudo: Account validation failure, is your account locked?\n";
        assert!(matches!(read_refusal(Some(1), sudo_rs), SudoError::Denied(_)));
        assert!(refused_password("sudo: Authentication failed, try again."));
    }
}
