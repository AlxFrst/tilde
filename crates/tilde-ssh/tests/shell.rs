//! SSH shell sessions against the test bench: output, exit code, resize, flow control,
//! keepalive and reconnection. Tests that pause or restart the `target` container hold
//! the bench exclusively.
#![cfg(feature = "integration")]

use std::{
    fs,
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

use tilde_session::{Backend, OutputSink, SessionManager};
use tilde_ssh::{
    ConnState, Connector, KnownHosts, MemoryStore, SshDefaults, SshSessionSpec, SshTarget,
    open_ssh_session,
};
use tilde_ssh_config::{ResolveContext, parse_file};

mod support;

use support::session::{
    Answers, BENCH, Bench, KEEPALIVE, KEEPALIVE_MAX, Output, States, TARGET_CONTAINER, Unpause,
    docker,
};

#[tokio::test(flavor = "multi_thread")]
async fn shell_echo_and_exit_code() {
    let _bench = BENCH.read().await;
    let Some(bench) = Bench::new() else { return };
    let (shell, mut out, states) = bench.open(false).await;
    assert_eq!(states.snapshot().last(), Some(&ConnState::Ready));

    shell.write(b"echo T=$TERM\n").unwrap();
    out.expect("T=xterm-256color").await;
    shell.write(b"exit 4\n").unwrap();
    assert_eq!(out.exit_code().await, Some(4));
}

#[tokio::test(flavor = "multi_thread")]
async fn resize_reaches_remote() {
    let _bench = BENCH.read().await;
    let Some(bench) = Bench::new() else { return };
    let (shell, mut out, _) = bench.open(false).await;
    shell.resize(100, 40).unwrap();
    shell.write(b"echo S=$(stty size)\n").unwrap();
    out.expect("S=40 100").await;
    shell.close();
}

/// Counts what reaches the UI, and never acknowledges it (a frozen tab).
#[derive(Default)]
struct Frozen(AtomicUsize);

impl OutputSink for Frozen {
    fn data(&self, bytes: Vec<u8>) {
        self.0.fetch_add(bytes.len(), Ordering::Relaxed);
    }
    fn exited(&self, _code: Option<i32>) {}
}

#[tokio::test(flavor = "multi_thread")]
async fn remote_flood_does_not_starve_other_channels() {
    let _bench = BENCH.read().await;
    let Some(bench) = Bench::new() else { return };
    let (shell, out, _) = bench.open(false).await;
    let manager = SessionManager::new();
    let sink = Arc::new(Frozen::default());
    let (id, flow) = manager.open_backend(shell.clone(), out.feed, sink.clone()).unwrap();
    shell.attach_flow(flow);

    shell.write(b"head -c 200000000 /dev/zero | base64\n").unwrap();
    let connection = shell.connection().unwrap();
    let mut max_held = 0;
    for _ in 0..20 {
        let start = Instant::now();
        let (pong, _) = support::exec(connection.target(), "echo pong").await;
        let took = start.elapsed();
        assert_eq!(pong.trim(), "pong");
        assert!(took < Duration::from_millis(500), "round trip took {took:?}");
        max_held = max_held.max(shell.held_bytes());
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(
        sink.0.load(Ordering::Relaxed) >= tilde_session::HIGH_WATERMARK,
        "the flood never reached the UI"
    );
    assert!(max_held < 8 * 1024 * 1024, "held {max_held} bytes");
    manager.close(id).unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn keepalive_detects_dead_server() {
    let _bench = BENCH.write().await;
    let Some(bench) = Bench::new() else { return };
    let (shell, _out, states) = bench.open(false).await;
    let _unpause = Unpause;
    docker(&["pause", TARGET_CONTAINER]);
    let start = Instant::now();
    states.wait(0, Duration::from_secs(15), |s| matches!(s, ConnState::Lost { .. })).await;
    let bound = KEEPALIVE * (KEEPALIVE_MAX + 2);
    assert!(start.elapsed() < bound, "loss noticed after {:?}", start.elapsed());
    shell.close();
}

#[tokio::test(flavor = "multi_thread")]
async fn reconnects_after_server_restart() {
    let _bench = BENCH.write().await;
    let Some(bench) = Bench::new() else { return };
    let (shell, mut out, states) = bench.open(true).await;
    shell.write(b"echo before\n").unwrap();
    out.expect("before").await;

    tokio::task::spawn_blocking(|| docker(&["restart", "-t", "1", TARGET_CONTAINER]))
        .await
        .unwrap();
    let lost =
        states.wait(0, Duration::from_secs(15), |s| matches!(s, ConnState::Lost { .. })).await;
    let again = states
        .wait(lost, Duration::from_secs(15), |s| matches!(s, ConnState::Reconnecting { .. }))
        .await;
    states.wait(again, Duration::from_secs(40), |s| *s == ConnState::Ready).await;
    out.expect("reconnecté").await;

    shell.write(b"echo again-$((40+2))\n").unwrap();
    out.expect("again-42").await;
    shell.close();
}

#[tokio::test(flavor = "multi_thread")]
async fn auth_failure_does_not_reconnect_forever() {
    let _bench = BENCH.write().await;
    let Some(bench) = Bench::new() else { return };
    let answers = Arc::new(Answers::default());
    answers.passwords.lock().extend([
        bench.password.clone(),
        "wrong".into(),
        "wrong".into(),
        "wrong".into(),
    ]);
    let states = Arc::new(States::default());
    let (_shell, out) =
        open_ssh_session(bench.connector(answers), bench.spec(true, true), states.callback())
            .await
            .unwrap();
    let out = Output::new(out);

    tokio::task::spawn_blocking(|| docker(&["restart", "-t", "1", TARGET_CONTAINER]))
        .await
        .unwrap();
    let failed =
        states.wait(0, Duration::from_secs(60), |s| matches!(s, ConnState::Failed { .. })).await;
    let ConnState::Failed { message } = &states.snapshot()[failed] else { unreachable!() };
    assert!(message.contains("authentification refusée"), "{message}");
    assert_eq!(out.exit_code().await, None);
    tokio::time::sleep(Duration::from_secs(3)).await;
    assert_eq!(
        states.snapshot().len(),
        failed + 1,
        "no attempt after the failure: {:?}",
        states.snapshot()
    );
}

/// Opt-in, read-only, against one of the developer's own hosts (see tests/connect.rs):
/// `TILDE_SSH_REAL_HOST=<alias> cargo test -p tilde-ssh --features integration`.
#[tokio::test(flavor = "multi_thread")]
async fn real_host_shell_round_trip() {
    let Ok(alias) = std::env::var("TILDE_SSH_REAL_HOST") else { return };
    let ctx = ResolveContext::from_env();
    let config = parse_file(&ctx.home.join(".ssh").join("config"));
    let host = config.resolve(&alias, &ctx);
    let tmp = tempfile::TempDir::new().unwrap();
    let mut files = Vec::new();
    for (i, f) in host.user_known_hosts_files.iter().enumerate() {
        if Path::new(f).exists() {
            let copy = tmp.path().join(format!("kh{i}"));
            fs::copy(f, &copy).unwrap();
            files.push(copy);
        }
    }
    let connector = Arc::new(Connector {
        known_hosts: Some(KnownHosts::new(files)),
        // Host-key answers only reach the temporary copy of known_hosts.
        prompter: Arc::new(Answers::default()),
        secrets: Arc::new(MemoryStore::default()),
        defaults: SshDefaults::default(),
        home: ctx.home.clone(),
        agent_sources: None,
    });
    let spec = SshSessionSpec {
        config: Arc::new(config),
        ctx,
        target: SshTarget::Alias(alias),
        cols: 80,
        rows: 24,
        auto_reconnect: false,
    };
    let states = Arc::new(States::default());
    let (shell, feed) = open_ssh_session(connector, spec, states.callback()).await.unwrap();
    let mut out = Output::new(feed);
    // A proxy such as Warpgate drops a resize sent before the target shell is up.
    shell.write(b"echo r$((1+1))eady\n").unwrap();
    out.expect("r2eady").await;
    shell.resize(100, 40).unwrap();
    shell.write(b"echo T=$TERM S=$(stty size)\n").unwrap();
    out.expect("T=xterm-256color S=40 100").await;
    shell.write(b"exit 4\n").unwrap();
    assert_eq!(out.exit_code().await, Some(4));
}

#[tokio::test(flavor = "multi_thread")]
async fn sftp_is_shared_until_the_connection_changes() {
    let _bench = BENCH.read().await;
    let Some(bench) = Bench::new() else { return };
    let (shell, _out, _) = bench.open(false).await;
    let a = shell.sftp().await.unwrap();
    let b = shell.sftp().await.unwrap();
    assert!(Arc::ptr_eq(&a, &b));
    assert!(a.home().await.unwrap().starts_with('/'));
    shell.close();
}

#[tokio::test(flavor = "multi_thread")]
async fn sftp_reopens_after_reconnect() {
    let _bench = BENCH.write().await;
    let Some(bench) = Bench::new() else { return };
    let (shell, _out, states) = bench.open(true).await;
    let before = shell.sftp().await.unwrap();
    let home = before.home().await.unwrap();

    tokio::task::spawn_blocking(|| docker(&["restart", "-t", "1", TARGET_CONTAINER]))
        .await
        .unwrap();
    let lost =
        states.wait(0, Duration::from_secs(15), |s| matches!(s, ConnState::Lost { .. })).await;
    assert!(shell.sftp().await.is_err(), "no SFTP while reconnecting");
    states.wait(lost, Duration::from_secs(40), |s| *s == ConnState::Ready).await;

    let after = shell.sftp().await.unwrap();
    assert!(!Arc::ptr_eq(&before, &after), "a new session on the new connection");
    assert_ne!(after.list(&home).await.unwrap(), vec![]);
    shell.close();
}

#[tokio::test(flavor = "multi_thread")]
async fn edit_survives_a_reconnect() {
    use tilde_ssh::{EditSession, RemoteFile};
    let _bench = BENCH.write().await;
    let Some(bench) = Bench::new() else { return };
    let (shell, _out, states) = bench.open(true).await;
    let connection = shell.connection().unwrap();
    let (dir, _) = support::exec(connection.target(), "mktemp -d").await;
    let remote_path = format!("{}/notes.txt", dir.trim());
    support::exec(connection.target(), &format!("printf 'v1' > {remote_path}")).await;
    drop(connection);

    let remote: Arc<dyn RemoteFile> = shell.clone();
    let root = tempfile::TempDir::new().unwrap();
    let edit =
        EditSession::start(1, 1, root.path(), remote, &remote_path, |_| Ok(()), Arc::new(|_| {}))
            .await
            .unwrap();

    tokio::task::spawn_blocking(|| docker(&["restart", "-t", "1", TARGET_CONTAINER]))
        .await
        .unwrap();
    let lost =
        states.wait(0, Duration::from_secs(15), |s| matches!(s, ConnState::Lost { .. })).await;
    states.wait(lost, Duration::from_secs(40), |s| *s == ConnState::Ready).await;

    std::fs::write(edit.local_path(), "v2").unwrap();
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let target = shell.connection().unwrap();
        let (now, _) = support::exec(target.target(), &format!("cat {remote_path}")).await;
        if now == "v2" {
            break;
        }
        assert!(Instant::now() < deadline, "still {now:?}: {:?}", edit.info().state);
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    shell.close();
}
