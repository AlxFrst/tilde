//! Files as root through sudo, against the test bench: `tilde` may use sudo with its own
//! password on `target` (classic sudo, direct on 2203) and on `sudors` (sudo-rs, 2204).
#![cfg(feature = "integration")]

use std::sync::Arc;

use tilde_ssh::{MemoryStore, SecretStore, SftpError, SshShell, SudoError, sudo_account};

mod support;

use support::session::{Answers, BENCH, Bench, Output};

async fn open() -> Option<(Bench, Arc<SshShell>, Output)> {
    let bench = Bench::new()?;
    let (shell, out, _) = bench.open(false).await;
    Some((bench, shell, out))
}

/// The sudo-rs server, or `None` when the bench is not running (required in CI).
async fn open_sudo_rs() -> Option<(Bench, Arc<SshShell>, Output)> {
    let bench = Bench::new()?;
    if !support::reachable(support::SUDO_RS_PORT) {
        assert!(
            std::env::var_os("TILDE_REQUIRE_SSH_BENCH").is_none(),
            "the sudo-rs server of the bench is not running"
        );
        return None;
    }
    let (shell, out) = bench.open_at(support::SUDO_RS_PORT).await;
    Some((bench, shell, out))
}

fn answers(passwords: &[&str]) -> Answers {
    let answers = Answers::default();
    answers.passwords.lock().extend(passwords.iter().map(|p| (*p).to_owned()));
    answers
}

async fn sh(shell: &SshShell, cmd: &str) -> String {
    support::exec(shell.connection().unwrap().target(), cmd).await.0
}

/// Root, after one wrong password, then back to the login user.
async fn root_then_back(bench: &Bench, shell: &SshShell) {
    let secrets = MemoryStore::default();
    let prompter = answers(&["not-the-password", &bench.password]);
    shell.switch_sftp_user(Some("root"), &secrets, &prompter).await.unwrap();
    assert_eq!(shell.sftp_user().as_deref(), Some("root"));
    assert!(prompter.passwords.lock().is_empty(), "asked twice");

    let sftp = shell.sftp().await.unwrap();
    assert!(sftp.list("/root").await.is_ok());
    // What it writes belongs to root.
    let file = format!("/tmp/tilde-sudo-{}", std::process::id());
    sftp.create_file(&file).await.unwrap();
    assert_eq!(sh(shell, &format!("stat -c %U {file}")).await.trim(), "root");
    sftp.remove(&file).await.unwrap();

    shell.switch_sftp_user(None, &secrets, &prompter).await.unwrap();
    assert_eq!(shell.sftp_user(), None);
    let err = shell.sftp().await.unwrap().list("/root").await.unwrap_err();
    assert!(matches!(err, SftpError::PermissionDenied(_)), "{err}");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_login_user_is_refused_root_files_as_a_permission_error() {
    let _bench = BENCH.read().await;
    let Some((_bench, shell, _out)) = open().await else { return };
    let err = shell.sftp().await.unwrap().list("/root").await.unwrap_err();
    assert!(matches!(err, SftpError::PermissionDenied(ref p) if p == "/root"), "{err}");
}

#[tokio::test(flavor = "multi_thread")]
async fn files_as_root_after_a_wrong_password_then_back() {
    let _bench = BENCH.read().await;
    let Some((bench, shell, _out)) = open().await else { return };
    root_then_back(&bench, &shell).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn files_as_root_with_sudo_rs() {
    let _bench = BENCH.read().await;
    let Some((bench, shell, _out)) = open_sudo_rs().await else { return };
    root_then_back(&bench, &shell).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_remembered_sudo_password_is_used_without_asking() {
    let _bench = BENCH.read().await;
    let Some((bench, shell, _out)) = open().await else { return };
    let secrets = MemoryStore::default();
    secrets.set(&sudo_account("tilde", "127.0.0.1", 2203), &bench.password);
    // Asking would cancel: the remembered password must do.
    shell.switch_sftp_user(Some("root"), &secrets, &answers(&[])).await.unwrap();
    assert!(shell.sftp().await.unwrap().list("/root").await.is_ok());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_stale_remembered_password_costs_one_try_and_is_forgotten() {
    let _bench = BENCH.read().await;
    let Some((bench, shell, _out)) = open().await else { return };
    let secrets = MemoryStore::default();
    let account = sudo_account("tilde", "127.0.0.1", 2203);
    secrets.set(&account, "stale");
    // Two prompts left (three tries in all): the second is the right one.
    let prompter = answers(&["wrong", &bench.password, "never-asked"]);
    shell.switch_sftp_user(Some("root"), &secrets, &prompter).await.unwrap();
    assert_eq!(secrets.get(&account), None);
    assert_eq!(prompter.passwords.lock().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn three_refused_passwords_keep_the_login_user() {
    let _bench = BENCH.read().await;
    let Some((_bench, shell, _out)) = open().await else { return };
    let prompter = answers(&["a", "b", "c", "never-asked"]);
    let err =
        shell.switch_sftp_user(Some("root"), &MemoryStore::default(), &prompter).await.unwrap_err();
    assert!(matches!(err, SudoError::WrongPassword), "{err}");
    assert_eq!(prompter.passwords.lock().len(), 1, "three tries at most");
    assert_eq!(shell.sftp_user(), None);
}

#[tokio::test(flavor = "multi_thread")]
async fn three_refused_passwords_with_sudo_rs() {
    let _bench = BENCH.read().await;
    let Some((_bench, shell, _out)) = open_sudo_rs().await else { return };
    let err = shell
        .switch_sftp_user(Some("root"), &MemoryStore::default(), &answers(&["a", "b", "c"]))
        .await
        .unwrap_err();
    assert!(matches!(err, SudoError::WrongPassword), "{err}");
    assert_eq!(shell.sftp_user(), None);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_unknown_account_is_refused() {
    let _bench = BENCH.read().await;
    for opened in [open().await, open_sudo_rs().await] {
        let Some((bench, shell, _out)) = opened else { continue };
        let err = shell
            .switch_sftp_user(
                Some("nosuchuser"),
                &MemoryStore::default(),
                &answers(&[&bench.password]),
            )
            .await
            .unwrap_err();
        assert!(matches!(err, SudoError::Denied(_)), "{err}");
        assert_eq!(shell.sftp_user(), None);
    }
}

/// The password changes while the files are root's; the next SFTP session (after a
/// reconnection) cannot open them as root any more: they go back to the login user at
/// once, instead of trying sudo again on every call.
#[tokio::test(flavor = "multi_thread")]
async fn a_password_changed_meanwhile_brings_the_files_back_to_the_login_user() {
    // Exclusive: `tilde`'s password changes for a moment.
    let _bench = BENCH.write().await;
    let Some((bench, shell, _out)) = open().await else { return };
    shell
        .switch_sftp_user(Some("root"), &MemoryStore::default(), &answers(&[&bench.password]))
        .await
        .unwrap();
    let other = format!("other-{}", std::process::id());
    let set = |from: &str, to: &str| {
        format!("printf '%s\\n' '{from}' | sudo -S -k -p '' sh -c 'echo tilde:{to} | chpasswd'")
    };
    sh(&shell, &set(&bench.password, &other)).await;
    shell.reset_sftp().await;
    let reopened = shell.sftp().await.map(|_| ());
    let user_after = shell.sftp_user();
    let next = shell.sftp().await.map(|c| Arc::clone(&c));
    // Put the password back before checking anything.
    sh(&shell, &set(&other, &bench.password)).await;

    assert!(matches!(reopened, Err(SftpError::Sudo(SudoError::WrongPassword))), "{reopened:?}");
    assert_eq!(user_after, None);
    let err = next.unwrap().list("/root").await.unwrap_err();
    assert!(matches!(err, SftpError::PermissionDenied(_)), "{err}");
}
