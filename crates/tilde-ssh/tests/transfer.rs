//! Transfers against the test bench: round trip, resume both ways, cancel, concurrency,
//! directories, and a shell flood during a download.
#![cfg(feature = "integration")]

use std::{
    path::Path,
    sync::Arc,
    time::{Duration, Instant},
};

use parking_lot::Mutex;
use russh_sftp::protocol::OpenFlags;
use tilde_session::Backend;
use tilde_ssh::{SftpClient, SshShell, TransferInfo, TransferQueue, TransferState};
use tokio::io::AsyncWriteExt;

mod support;

use support::session::{BENCH, Bench};

const MIB: usize = 1024 * 1024;

/// Deterministic pseudo-random bytes (xorshift), so content checks are meaningful.
fn data(len: usize, seed: u64) -> Vec<u8> {
    let mut x = seed | 1;
    (0..len)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            (x & 0xff) as u8
        })
        .collect()
}

struct Fixture {
    shell: Arc<SshShell>,
    client: Arc<SftpClient>,
    queue: TransferQueue,
    events: Arc<Mutex<Vec<TransferInfo>>>,
    remote: String,
    local: tempfile::TempDir,
    _out: support::session::Output,
}

async fn fixture(concurrency: usize) -> Option<Fixture> {
    let bench = Bench::new()?;
    let (shell, out, _) = bench.open(false).await;
    let connection = shell.connection().unwrap();
    let (dir, _) = support::exec(connection.target(), "mktemp -d").await;
    let client = Arc::new(SftpClient::open(&connection).await.unwrap());
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let queue = TransferQueue::new(concurrency, Arc::new(move |i| sink.lock().push(i)));
    Some(Fixture {
        shell,
        client,
        queue,
        events,
        remote: dir.trim().to_owned(),
        local: tempfile::TempDir::new().unwrap(),
        _out: out,
    })
}

impl Fixture {
    /// Creates a remote file (`SftpSession::write` only opens existing files).
    async fn put(&self, name: &str, bytes: &[u8]) -> String {
        let path = format!("{}/{name}", self.remote);
        let flags = OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE;
        let mut file = self.client.inner().open_with_flags(&path, flags).await.unwrap();
        file.write_all(bytes).await.unwrap();
        file.shutdown().await.unwrap();
        path
    }

    async fn wait(&self, id: u32, within: Duration) -> TransferState {
        let deadline = Instant::now() + within;
        loop {
            let state = self.queue.list().into_iter().find(|t| t.id == id).map(|t| t.state);
            if let Some(
                s @ (TransferState::Done | TransferState::Failed { .. } | TransferState::Cancelled),
            ) = state
            {
                return s;
            }
            assert!(Instant::now() < deadline, "transfer {id} still {state:?}");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// The smallest progress `done` reported for `id` (proves where it started).
    fn first_done(&self, id: u32) -> u64 {
        self.events
            .lock()
            .iter()
            .filter(|e| e.id == id && e.done > 0)
            .map(|e| e.done)
            .min()
            .unwrap_or(0)
    }
}

fn read(p: &Path) -> Vec<u8> {
    std::fs::read(p).unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn upload_then_download_round_trips() {
    let _bench = BENCH.read().await;
    let Some(f) = fixture(3).await else { return };
    let original = data(5 * MIB, 1);
    let src = f.local.path().join("src.bin");
    std::fs::write(&src, &original).unwrap();
    let up = f.queue.upload(1, Arc::clone(&f.client), &src, &f.remote).await.unwrap();
    assert_eq!(f.wait(up[0], Duration::from_secs(30)).await, TransferState::Done);

    let back = tempfile::TempDir::new().unwrap();
    let remote = format!("{}/src.bin", f.remote);
    let down = f.queue.download(1, Arc::clone(&f.client), &remote, back.path()).await.unwrap();
    assert_eq!(f.wait(down[0], Duration::from_secs(30)).await, TransferState::Done);
    assert_eq!(read(&back.path().join("src.bin")), original);
    assert!(!back.path().join("src.bin.part").exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn retry_resumes_a_download_from_its_partial_file() {
    let _bench = BENCH.read().await;
    let Some(f) = fixture(3).await else { return };
    let original = data(4 * MIB, 2);
    let remote = f.put("big.bin", &original).await;
    // The « folder » is a plain file: the first attempt fails, deterministically.
    let dest = f.local.path().join("dest");
    std::fs::write(&dest, b"not a folder").unwrap();
    let id = f.queue.download(1, Arc::clone(&f.client), &remote, &dest).await.unwrap()[0];
    assert!(matches!(f.wait(id, Duration::from_secs(30)).await, TransferState::Failed { .. }));

    // What a cut transfer leaves behind: the first megabyte.
    std::fs::remove_file(&dest).unwrap();
    std::fs::create_dir(&dest).unwrap();
    std::fs::write(dest.join("big.bin.part"), &original[..MIB]).unwrap();
    f.events.lock().clear();
    f.queue.retry(id, Arc::clone(&f.client));
    assert_eq!(f.wait(id, Duration::from_secs(30)).await, TransferState::Done);
    assert_eq!(read(&dest.join("big.bin")), original);
    assert!(f.first_done(id) > MIB as u64, "« Réessayer » started from the partial file");
}

#[tokio::test(flavor = "multi_thread")]
async fn retry_resumes_an_upload_from_its_partial_remote_file() {
    let _bench = BENCH.read().await;
    let Some(f) = fixture(3).await else { return };
    let original = data(4 * MIB, 3);
    let src = f.local.path().join("up.bin");
    std::fs::write(&src, &original).unwrap();
    // A remote folder that does not exist yet: the first attempt fails.
    let remote_dir = format!("{}/later", f.remote);
    let id = f.queue.upload(1, Arc::clone(&f.client), &src, &remote_dir).await.unwrap()[0];
    assert!(matches!(f.wait(id, Duration::from_secs(30)).await, TransferState::Failed { .. }));

    f.client.mkdir(&remote_dir).await.unwrap();
    let flags = OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE;
    let part = format!("{remote_dir}/up.bin.tilde-part");
    let mut file = f.client.inner().open_with_flags(&part, flags).await.unwrap();
    file.write_all(&original[..MIB]).await.unwrap();
    file.shutdown().await.unwrap();
    f.events.lock().clear();
    f.queue.retry(id, Arc::clone(&f.client));
    assert_eq!(f.wait(id, Duration::from_secs(30)).await, TransferState::Done);
    let back = f.client.inner().read(format!("{remote_dir}/up.bin")).await.unwrap();
    assert_eq!(back, original);
    assert!(f.first_done(id) > MIB as u64);
    assert!(f.client.stat(&part).await.is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn cancel_stops_and_removes_the_part_file() {
    let _bench = BENCH.read().await;
    let Some(f) = fixture(3).await else { return };
    let remote = format!("{}/huge.bin", f.remote);
    support::exec(
        f.shell.connection().unwrap().target(),
        &format!("head -c 200000000 /dev/zero > {remote}"),
    )
    .await;
    let id = f.queue.download(1, Arc::clone(&f.client), &remote, f.local.path()).await.unwrap()[0];
    let deadline = Instant::now() + Duration::from_secs(20);
    while f.first_done(id) == 0 {
        assert!(Instant::now() < deadline, "no progress");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    f.queue.cancel(id);
    assert_eq!(f.wait(id, Duration::from_secs(10)).await, TransferState::Cancelled);
    assert!(!f.local.path().join("huge.bin.part").exists(), "nothing half-written is left");
    assert!(!f.local.path().join("huge.bin").exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn concurrency_is_respected() {
    let _bench = BENCH.read().await;
    let Some(f) = fixture(2).await else { return };
    let mut ids = Vec::new();
    // Create every file first, then queue them all at once: a transfer must not be able
    // to finish before the next one is queued.
    let mut remotes = Vec::new();
    for i in 0..5 {
        remotes.push(f.put(&format!("c{i}.bin"), &data(16 * MIB, 10 + i)).await);
    }
    for remote in &remotes {
        ids.extend(
            f.queue.download(1, Arc::clone(&f.client), remote, f.local.path()).await.unwrap(),
        );
    }
    for id in &ids {
        assert_eq!(f.wait(*id, Duration::from_secs(60)).await, TransferState::Done);
    }
    // Replay the state changes: never more than 2 running at once.
    let mut running = std::collections::HashSet::new();
    let mut max = 0;
    for e in f.events.lock().iter() {
        if e.state == TransferState::Running {
            running.insert(e.id);
        } else {
            running.remove(&e.id);
        }
        max = max.max(running.len());
    }
    assert_eq!(max, 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn directories_transfer_recursively() {
    let _bench = BENCH.read().await;
    let Some(f) = fixture(3).await else { return };
    support::exec(
        f.shell.connection().unwrap().target(),
        &format!(
            "mkdir -p {r}/tree/sub && echo a > {r}/tree/a && echo b > {r}/tree/sub/b && \
             ln -s /etc {r}/tree/link",
            r = f.remote
        ),
    )
    .await;
    let ids = f
        .queue
        .download(1, Arc::clone(&f.client), &format!("{}/tree", f.remote), f.local.path())
        .await
        .unwrap();
    assert_eq!(ids.len(), 2, "two files; the link is not followed");
    for id in ids {
        assert_eq!(f.wait(id, Duration::from_secs(30)).await, TransferState::Done);
    }
    assert_eq!(read(&f.local.path().join("tree/sub/b")), b"b\n");
    assert!(!f.local.path().join("tree/link").exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn shell_flood_does_not_stall_a_transfer() {
    let _bench = BENCH.read().await;
    let Some(f) = fixture(3).await else { return };
    let remote = format!("{}/twenty.bin", f.remote);
    support::exec(
        f.shell.connection().unwrap().target(),
        &format!("head -c 20000000 /dev/urandom > {remote}"),
    )
    .await;
    f.shell.write(b"yes | head -c 100000000\n").unwrap();
    let start = Instant::now();
    let id = f.queue.download(1, Arc::clone(&f.client), &remote, f.local.path()).await.unwrap()[0];
    assert_eq!(f.wait(id, Duration::from_secs(20)).await, TransferState::Done);
    assert!(start.elapsed() < Duration::from_secs(20));
    assert_eq!(std::fs::metadata(f.local.path().join("twenty.bin")).unwrap().len(), 20_000_000);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_new_upload_ignores_a_stale_partial() {
    let _bench = BENCH.read().await;
    let Some(f) = fixture(3).await else { return };
    let original = data(4 * MIB, 21);
    let src = f.local.path().join("app.jar");
    std::fs::write(&src, &original).unwrap();
    // Left by an earlier, cancelled upload of another version.
    f.put("app.jar.tilde-part", &data(MIB, 99)).await;

    let id = f.queue.upload(1, Arc::clone(&f.client), &src, &f.remote).await.unwrap()[0];
    assert_eq!(f.wait(id, Duration::from_secs(30)).await, TransferState::Done);
    let back = f.client.inner().read(format!("{}/app.jar", f.remote)).await.unwrap();
    assert_eq!(back, original, "no stitched file");
}

#[tokio::test(flavor = "multi_thread")]
async fn upload_keeps_the_replaced_files_mode() {
    let _bench = BENCH.read().await;
    let Some(f) = fixture(3).await else { return };
    let remote = f.put("deploy.sh", b"old").await;
    f.client.chmod(&remote, 0o750).await.unwrap();
    let src = f.local.path().join("deploy.sh");
    std::fs::write(&src, b"#!/bin/sh\necho new\n").unwrap();

    let id = f.queue.upload(1, Arc::clone(&f.client), &src, &f.remote).await.unwrap()[0];
    assert_eq!(f.wait(id, Duration::from_secs(30)).await, TransferState::Done);
    assert_eq!(f.client.stat(&remote).await.unwrap().permissions, Some(0o750));
}
