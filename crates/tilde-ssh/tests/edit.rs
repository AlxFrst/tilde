//! External editing against the test bench: a local save reaches the server.
#![cfg(feature = "integration")]

use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use tilde_ssh::{EditSession, RemoteFile, SftpClient, TransferState};

mod support;

use support::session::{BENCH, Bench};

#[tokio::test(flavor = "multi_thread")]
async fn edit_round_trip() {
    let _bench = BENCH.read().await;
    let Some(bench) = Bench::new() else { return };
    let (shell, _out, _) = bench.open(false).await;
    let connection = shell.connection().unwrap();
    let (dir, _) = support::exec(connection.target(), "mktemp -d").await;
    let remote_path = format!("{}/notes.txt", dir.trim());
    support::exec(connection.target(), &format!("printf 'avant' > {remote_path}")).await;

    let client: Arc<dyn RemoteFile> = Arc::new(SftpClient::open(&connection).await.unwrap());
    let root = tempfile::TempDir::new().unwrap();
    let edit =
        EditSession::start(1, 1, root.path(), client, &remote_path, |_| Ok(()), Arc::new(|_| {}))
            .await
            .unwrap();
    assert_eq!(std::fs::read_to_string(edit.local_path()).unwrap(), "avant");

    std::fs::write(edit.local_path(), "après").unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let (now, _) = support::exec(connection.target(), &format!("cat {remote_path}")).await;
        if now == "après" {
            break;
        }
        assert!(Instant::now() < deadline, "remote still {now:?}");
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    assert_eq!(edit.info().state, TransferState::Done);
}
