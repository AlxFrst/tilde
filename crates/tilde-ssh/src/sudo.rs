//! Files as another user: an SFTP server started through `sudo` on a channel of the
//! session's connection, for what the login user cannot read or write (`/root`,
//! `/etc/ssl/private`…). The terminal's `sudo su` cannot be followed (nothing tells which
//! user a shell is), so the user picks it in the files pane.
//!
//! `sudo` reads the password on its standard input (`-S`) and hands the rest of the input
//! to the program it starts, here `sftp-server`, which speaks SFTP on the same channel.

use std::time::Duration;

use russh::ChannelMsg;
use zeroize::Zeroizing;

use crate::{
    Prompter, SecretAnswer, SecretKind, SecretPrompt, SecretStore, SshShell, password_account,
    secrets::sudo_account,
};

/// Who the files are read and written as, when not the login user.
#[derive(Clone)]
pub struct SudoUser {
    /// The account `sudo -u` switches to (`root`).
    pub user: String,
    /// The login user's password for `sudo`, when it asks for one.
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
    #[error("la session SSH n'est pas connectée")]
    Disconnected,
    #[error("annulé")]
    Cancelled,
    #[error("sudo ne répond pas : {0}")]
    Failed(String),
}

/// Program candidates for the SFTP server, the distributions' usual places first. The
/// script is run by `/bin/sh -c '…'`: it must not contain a single quote.
pub(crate) const SFTP_SERVER_SCRIPT: &str = "for p in /usr/lib/openssh/sftp-server \
/usr/libexec/openssh/sftp-server /usr/lib/ssh/sftp-server /usr/libexec/ssh/sftp-server \
/usr/libexec/sftp-server /usr/lib/sftp-server /usr/local/libexec/sftp-server \
/usr/local/lib/sftp-server; do [ -x \"$p\" ] && exec \"$p\"; done; \
echo sftp-server introuvable >&2; exit 127";

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

/// `sudo` could not run at all.
fn missing(exit: Option<u32>, output: &str) -> bool {
    exit == Some(127) || output.contains("command not found") || output.contains("sudo: not found")
}

/// What `sudo -n … true` said: no password needed, or why not.
pub(crate) fn read_check(exit: Option<u32>, output: &str) -> Result<(), SudoError> {
    match exit {
        Some(0) => Ok(()),
        None => Err(SudoError::Failed("pas de réponse".into())),
        _ if missing(exit, output) => Err(SudoError::Missing),
        _ if output.contains("a password is required") => Err(SudoError::PasswordRequired),
        _ => Err(SudoError::Denied(output.trim().to_owned())),
    }
}

/// What `sudo -S … true`, given a password, said.
pub(crate) fn read_validate(exit: Option<u32>, output: &str) -> Result<(), SudoError> {
    match exit {
        Some(0) => Ok(()),
        None => Err(SudoError::Failed("pas de réponse".into())),
        _ if missing(exit, output) => Err(SudoError::Missing),
        _ if output.contains("incorrect password") || output.contains("Sorry, try again") => {
            Err(SudoError::WrongPassword)
        }
        _ => Err(SudoError::Denied(output.trim().to_owned())),
    }
}

/// Bound on one `sudo` run (a refused password costs about two seconds).
const SUDO_TIMEOUT: Duration = Duration::from_secs(20);
/// More than `sudo` ever says.
const MAX_OUTPUT: usize = 16 * 1024;
/// Password prompts before giving up, as `sudo` does.
const MAX_ATTEMPTS: u32 = 3;

impl SshShell {
    /// Runs `command` (a `sudo …`), writing `input` and a newline on its standard input
    /// first; returns its exit status and what it printed (both streams).
    async fn run_sudo(
        &self,
        command: &str,
        input: Option<&str>,
    ) -> Result<(Option<u32>, String), SudoError> {
        let connection = self.connection().ok_or(SudoError::Disconnected)?;
        let failed = |e: russh::Error| SudoError::Failed(e.to_string());
        let run = async {
            let mut channel = connection.target().channel_open_session().await.map_err(failed)?;
            channel.exec(true, command).await.map_err(failed)?;
            if let Some(text) = input {
                let line = Zeroizing::new(format!("{text}\n"));
                channel.data(line.as_bytes()).await.map_err(failed)?;
            }
            channel.eof().await.map_err(failed)?;
            let mut out = Vec::new();
            let mut exit = None;
            while let Some(msg) = channel.wait().await {
                match msg {
                    ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                        let room = MAX_OUTPUT.saturating_sub(out.len());
                        out.extend_from_slice(&data[..data.len().min(room)]);
                    }
                    ChannelMsg::ExitStatus { exit_status } => exit = Some(exit_status),
                    ChannelMsg::Close => break,
                    _ => {}
                }
            }
            Ok((exit, String::from_utf8_lossy(&out).into_owned()))
        };
        tokio::time::timeout(SUDO_TIMEOUT, run)
            .await
            .map_err(|_| SudoError::Failed("le serveur ne répond pas".into()))?
    }

    /// `Ok` when `sudo -u user` needs no password; else why not
    /// ([`SudoError::PasswordRequired`] when it needs one).
    ///
    /// # Errors
    ///
    /// See above; also a bad name, no connection or no answer.
    pub async fn sudo_check(&self, user: &str) -> Result<(), SudoError> {
        if !valid_user(user) {
            return Err(SudoError::InvalidUser(user.to_owned()));
        }
        let (exit, output) = self.run_sudo(&sudo_command(user, false, "true"), None).await?;
        read_check(exit, &output)
    }

    /// Checks the login user's `password` for `sudo -u user`.
    ///
    /// # Errors
    ///
    /// [`SudoError::WrongPassword`], [`SudoError::Denied`] (not allowed), and the rest.
    pub async fn sudo_validate(&self, user: &str, password: &str) -> Result<(), SudoError> {
        if !valid_user(user) {
            return Err(SudoError::InvalidUser(user.to_owned()));
        }
        // `sudo` reads one line: anything after a line break would reach the server.
        if password.contains(['\n', '\r']) {
            return Err(SudoError::WrongPassword);
        }
        let (exit, output) =
            self.run_sudo(&sudo_command(user, true, "true"), Some(password)).await?;
        read_validate(exit, &output)
    }

    /// From now on the files of this session are read and written as `user`, through
    /// `sudo` (`None`: as the login user again). A password `sudo` asks for is looked for
    /// in `secrets` (the one remembered for `sudo`, then the login password), else asked
    /// through `prompter`, and remembered if the user says so.
    ///
    /// # Errors
    ///
    /// The user cannot use `sudo` that way, the password was refused three times, or the
    /// prompt was cancelled. The files keep their current user then.
    pub async fn switch_sftp_user(
        &self,
        user: Option<&str>,
        secrets: &dyn SecretStore,
        prompter: &dyn Prompter,
    ) -> Result<(), SudoError> {
        let Some(user) = user else {
            self.set_sftp_as(None).await;
            return Ok(());
        };
        let as_user = |password: Option<String>| SudoUser {
            user: user.to_owned(),
            password: password.map(Zeroizing::new),
        };
        match self.sudo_check(user).await {
            Ok(()) => {
                self.set_sftp_as(Some(as_user(None))).await;
                return Ok(());
            }
            Err(SudoError::PasswordRequired) => {}
            Err(e) => return Err(e),
        }
        let (login, host, port) = self.login().ok_or(SudoError::Disconnected)?;
        let (login, host) = (login.to_owned(), host.to_owned());
        let sudo_acc = sudo_account(&login, &host, port);
        // The password remembered for sudo, then the login one: sudo asks for the login
        // user's own password. A remembered sudo password that fails is forgotten.
        for (account, stale_is_forgotten) in
            [(sudo_acc.clone(), true), (password_account(&login, &host, port), false)]
        {
            let Some(stored) = secrets.get(&account).map(Zeroizing::new) else { continue };
            match self.sudo_validate(user, &stored).await {
                Ok(()) => {
                    self.set_sftp_as(Some(as_user(Some(stored.to_string())))).await;
                    return Ok(());
                }
                Err(SudoError::WrongPassword) if stale_is_forgotten => secrets.delete(&account),
                Err(SudoError::WrongPassword) => {}
                Err(e) => return Err(e),
            }
        }
        for attempt in 1..=MAX_ATTEMPTS {
            let Some(SecretAnswer { value, remember }) = prompter
                .secret(SecretPrompt {
                    kind: SecretKind::Sudo { user: user.to_owned() },
                    target: format!("{login}@{host}"),
                    attempt,
                    can_remember: secrets.available(),
                })
                .await
            else {
                return Err(SudoError::Cancelled);
            };
            let value = Zeroizing::new(value);
            match self.sudo_validate(user, &value).await {
                Ok(()) => {
                    if remember {
                        secrets.set(&sudo_acc, &value);
                    }
                    self.set_sftp_as(Some(as_user(Some(value.to_string())))).await;
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
    }

    #[test]
    fn the_server_script_survives_single_quoting() {
        assert!(!SFTP_SERVER_SCRIPT.contains('\''));
        assert!(SFTP_SERVER_SCRIPT.contains("/usr/lib/openssh/sftp-server"));
        assert!(SFTP_SERVER_SCRIPT.contains("/usr/lib/ssh/sftp-server"));
    }

    #[test]
    fn sudo_answers_are_read() {
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

        assert!(read_validate(Some(0), "").is_ok());
        assert!(matches!(
            read_validate(Some(1), "Sorry, try again.\nsudo: 1 incorrect password attempt\n"),
            Err(SudoError::WrongPassword)
        ));
        assert!(matches!(
            read_validate(Some(1), "tilde is not in the sudoers file.\n"),
            Err(SudoError::Denied(m)) if m == "tilde is not in the sudoers file."
        ));
        assert!(matches!(read_validate(None, ""), Err(SudoError::Failed(_))));
    }
}
