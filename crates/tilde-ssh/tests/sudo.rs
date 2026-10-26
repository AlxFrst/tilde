//! Files as root through sudo, against the test bench (target, direct on 2203): `tilde`
//! may use sudo with its own password.
#![cfg(feature = "integration")]

use std::sync::Arc;

use tilde_ssh::{MemoryStore, SecretStore, SftpError, SshShell, SudoError, sudo_account};

mod support;

use support::session::{Answers, BENCH, Bench};

async fn open() -> Option<(Bench, Arc<SshShell>)> {
    let bench = Bench::new()?;
    let (shell, _out, _) = bench.open(false).await;
    Some((bench, shell))
}

fn answers(passwords: &[&str]) -> Answers {
    let answers = Answers::default();
    answers.passwords.lock().extend(passwords.iter().map(|p| (*p).to_owned()));
    answers
}

async fn sh(shell: &SshShell, cmd: &str) -> String {
    support::exec(shell.connection().unwrap().target(), cmd).await.0
}

#[tokio::test(flavor = "multi_thread")]
async fn the_login_user_is_refused_root_files_as_a_permission_error() {
    let _bench = BENCH.read().await;
    let Some((_bench, shell)) = open().await else { return };
    let err = shell.sftp().await.unwrap().list("/root").await.unwrap_err();
    assert!(matches!(err, SftpError::PermissionDenied(ref p) if p == "/root"), "{err}");
}

#[tokio::test(flavor = "multi_thread")]
async fn files_as_root_after_a_wrong_password_then_back() {
    let _bench = BENCH.read().await;
    let Some((bench, shell)) = open().await else { return };
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
    assert_eq!(sh(&shell, &format!("stat -c %U {file}")).await.trim(), "root");
    sftp.remove(&file).await.unwrap();

    shell.switch_sftp_user(None, &secrets, &prompter).await.unwrap();
    assert_eq!(shell.sftp_user(), None);
    let err = shell.sftp().await.unwrap().list("/root").await.unwrap_err();
    assert!(matches!(err, SftpError::PermissionDenied(_)), "{err}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_remembered_sudo_password_is_used_without_asking() {
    let _bench = BENCH.read().await;
    let Some((bench, shell)) = open().await else { return };
    let secrets = MemoryStore::default();
    secrets.set(&sudo_account("tilde", "127.0.0.1", 2203), &bench.password);
    // Asking would cancel: the remembered password must do.
    shell.switch_sftp_user(Some("root"), &secrets, &answers(&[])).await.unwrap();
    assert!(shell.sftp().await.unwrap().list("/root").await.is_ok());
}

#[tokio::test(flavor = "multi_thread")]
async fn three_refused_passwords_keep_the_login_user() {
    let _bench = BENCH.read().await;
    let Some((_bench, shell)) = open().await else { return };
    let secrets = MemoryStore::default();
    let err = shell
        .switch_sftp_user(Some("root"), &secrets, &answers(&["a", "b", "c"]))
        .await
        .unwrap_err();
    assert!(matches!(err, SudoError::WrongPassword), "{err}");
    assert_eq!(shell.sftp_user(), None);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_unknown_account_is_refused() {
    let _bench = BENCH.read().await;
    let Some((bench, shell)) = open().await else { return };
    let err = shell
        .switch_sftp_user(Some("nosuchuser"), &MemoryStore::default(), &answers(&[&bench.password]))
        .await
        .unwrap_err();
    assert!(matches!(err, SudoError::Denied(_)), "{err}");
    assert_eq!(shell.sftp_user(), None);
}
