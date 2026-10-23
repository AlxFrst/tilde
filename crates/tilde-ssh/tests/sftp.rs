//! SFTP against the test bench (target, direct on 2203). Each test works in its own
//! temporary directory on the server.
#![cfg(feature = "integration")]

use std::{sync::Arc, time::Instant};

use tilde_ssh::{EntryKind, SftpClient, SshShell};

mod support;

use support::session::{BENCH, Bench};

async fn setup() -> Option<(Arc<SshShell>, SftpClient, String)> {
    let bench = Bench::new()?;
    let (shell, _out, _) = bench.open(false).await;
    let connection = shell.connection().unwrap();
    let (dir, _) = support::exec(connection.target(), "mktemp -d").await;
    let client = SftpClient::open(&connection).await.unwrap();
    Some((shell, client, dir.trim().to_owned()))
}

async fn sh(shell: &SshShell, cmd: &str) -> String {
    support::exec(shell.connection().unwrap().target(), cmd).await.0
}

#[tokio::test(flavor = "multi_thread")]
async fn lists_home_with_dirs_first() {
    let _bench = BENCH.read().await;
    let Some((shell, sftp, dir)) = setup().await else { return };
    sh(&shell, &format!("cd {dir} && mkdir zdir && touch Afile bfile .hidden")).await;
    let names: Vec<(String, EntryKind)> =
        sftp.list(&dir).await.unwrap().into_iter().map(|e| (e.name, e.kind)).collect();
    assert_eq!(
        names,
        vec![
            ("zdir".into(), EntryKind::Dir),
            (".hidden".into(), EntryKind::File),
            ("Afile".into(), EntryKind::File),
            ("bfile".into(), EntryKind::File),
        ]
    );
    assert!(sftp.home().await.unwrap().starts_with('/'));
}

#[tokio::test(flavor = "multi_thread")]
async fn mkdir_rename_chmod_and_stat() {
    let _bench = BENCH.read().await;
    let Some((_shell, sftp, dir)) = setup().await else { return };
    let a = format!("{dir}/a");
    let b = format!("{dir}/b");
    sftp.mkdir(&a).await.unwrap();
    sftp.rename(&a, &b).await.unwrap();
    sftp.chmod(&b, 0o750).await.unwrap();
    let st = sftp.stat(&b).await.unwrap();
    assert_eq!((st.kind, st.permissions), (EntryKind::Dir, Some(0o750)));
    assert!(sftp.stat(&a).await.is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn recursive_remove_does_not_follow_symlinks() {
    let _bench = BENCH.read().await;
    let Some((shell, sftp, dir)) = setup().await else { return };
    sh(
        &shell,
        &format!(
            "mkdir -p {dir}/keep && echo precious > {dir}/keep/x && \
             mkdir -p {dir}/tree/sub && touch {dir}/tree/sub/f {dir}/tree/g && \
             ln -s /etc/hostname {dir}/tree/file_link && ln -s {dir}/keep {dir}/tree/dir_link"
        ),
    )
    .await;
    let removed = sftp.remove(&format!("{dir}/tree")).await.unwrap();
    assert_eq!(removed, 6, "f, g, two links, sub, tree");
    assert_eq!(sh(&shell, &format!("cat {dir}/keep/x")).await.trim(), "precious");
    assert_ne!(sh(&shell, "cat /etc/hostname").await.trim(), "", "the link target is intact");
}

#[tokio::test(flavor = "multi_thread")]
async fn listing_a_large_directory() {
    let _bench = BENCH.read().await;
    let Some((shell, sftp, dir)) = setup().await else { return };
    sh(&shell, &format!("cd {dir} && seq 1 5000 | xargs touch")).await;
    let start = Instant::now();
    let entries = sftp.list(&dir).await.unwrap();
    assert_eq!(entries.len(), 5000);
    assert!(start.elapsed().as_secs() < 3, "{:?}", start.elapsed());
}
