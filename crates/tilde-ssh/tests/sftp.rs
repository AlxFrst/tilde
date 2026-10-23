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

#[tokio::test(flavor = "multi_thread")]
async fn read_and_write_text_roundtrip() {
    let _bench = BENCH.read().await;
    let Some((shell, sftp, dir)) = setup().await else { return };
    let file = format!("{dir}/notes.md");
    sh(&shell, &format!("printf '# Titre\nligne\n' > {file}")).await;
    let (text, stamp) = sftp.read_text(&file).await.unwrap();
    assert_eq!(text, "# Titre\nligne\n");
    let new = sftp.write_text(&file, "# Titre\nmodifié\n", Some(stamp)).await.unwrap();
    assert_eq!(sh(&shell, &format!("cat {file}")).await, "# Titre\nmodifié\n");
    assert_eq!(new.size, "# Titre\nmodifié\n".len() as u64);
}

#[tokio::test(flavor = "multi_thread")]
async fn save_refuses_a_changed_remote_file() {
    let _bench = BENCH.read().await;
    let Some((shell, sftp, dir)) = setup().await else { return };
    let file = format!("{dir}/app.conf");
    sh(&shell, &format!("echo a=1 > {file}")).await;
    let (_, stamp) = sftp.read_text(&file).await.unwrap();
    // Someone else edits it on the server (another size, so even the same second shows).
    sh(&shell, &format!("echo b=2 >> {file}")).await;
    let err = sftp.write_text(&file, "a=3\n", Some(stamp)).await.unwrap_err();
    assert!(matches!(err, tilde_ssh::TextError::Conflict { .. }), "{err}");
    assert_eq!(sh(&shell, &format!("cat {file}")).await, "a=1\nb=2\n");
    // Overwriting on purpose works.
    sftp.write_text(&file, "a=3\n", None).await.unwrap();
    assert_eq!(sh(&shell, &format!("cat {file}")).await, "a=3\n");
}

#[tokio::test(flavor = "multi_thread")]
async fn write_text_keeps_permissions() {
    let _bench = BENCH.read().await;
    let Some((shell, sftp, dir)) = setup().await else { return };
    let file = format!("{dir}/secret.env");
    sh(&shell, &format!("echo x > {file} && chmod 640 {file}")).await;
    let (_, stamp) = sftp.read_text(&file).await.unwrap();
    sftp.write_text(&file, "y\n", Some(stamp)).await.unwrap();
    assert_eq!(sh(&shell, &format!("stat -c %a {file}")).await.trim(), "640");
}

#[tokio::test(flavor = "multi_thread")]
async fn read_text_refuses_large_files_before_downloading() {
    let _bench = BENCH.read().await;
    let Some((shell, sftp, dir)) = setup().await else { return };
    let file = format!("{dir}/big.log");
    sh(&shell, &format!("head -c 6291456 /dev/zero | tr '\0' a > {file}")).await;
    let started = Instant::now();
    let err = sftp.read_text(&file).await.unwrap_err();
    assert!(matches!(err, tilde_ssh::TextError::TooLarge { .. }), "{err}");
    // Refused from the size alone: no 6 MiB download.
    assert!(started.elapsed() < std::time::Duration::from_secs(2));
    let bin = format!("{dir}/a.bin");
    sh(&shell, &format!("printf 'a\000b' > {bin}")).await;
    assert!(matches!(sftp.read_text(&bin).await, Err(tilde_ssh::TextError::Binary)));
}
