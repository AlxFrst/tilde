//! Port forwarding against the test bench. `target` runs a TCP echo server on 7777 and
//! busybox `nc`. Tests that restart the `target` container hold the bench exclusively.
#![cfg(feature = "integration")]

use std::time::{Duration, Instant};

use tilde_session::Backend;
use tilde_ssh::{ConnState, ForwardKind, ForwardSpec};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
};

mod support;

use support::session::{BENCH, Bench, TARGET_CONTAINER, docker};

fn local(listen_port: u16, port: u16) -> ForwardSpec {
    ForwardSpec {
        kind: ForwardKind::Local,
        bind: "127.0.0.1".into(),
        listen_port,
        host: "127.0.0.1".into(),
        port,
    }
}

/// Sends one line through `port` and returns the line that comes back.
async fn round_trip(port: u16, line: &str) -> String {
    let stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let (read, mut write) = stream.into_split();
    write.write_all(format!("{line}\n").as_bytes()).await.unwrap();
    let mut answer = String::new();
    tokio::time::timeout(Duration::from_secs(10), BufReader::new(read).read_line(&mut answer))
        .await
        .expect("no answer through the forward")
        .unwrap();
    answer
}

#[tokio::test(flavor = "multi_thread")]
async fn local_forward_reaches_echo_server() {
    let _bench = BENCH.read().await;
    let Some(bench) = Bench::new() else { return };
    let (shell, _out, _) = bench.open(false).await;
    let info = shell.add_forward(local(0, 7777)).await;
    assert_eq!(info.error, None);
    assert_ne!(info.bound_port, 0);
    assert_eq!(round_trip(info.bound_port, "ping").await, "ping\n");
    shell.close();
}

#[tokio::test(flavor = "multi_thread")]
async fn remote_forward_reaches_local_listener() {
    let _bench = BENCH.read().await;
    let Some(bench) = Bench::new() else { return };
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let local_port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let _ = socket.write_all(b"from-local\n").await;
        }
    });

    let (shell, _out, _) = bench.open(false).await;
    let info = shell
        .add_forward(ForwardSpec {
            kind: ForwardKind::Remote,
            bind: "127.0.0.1".into(),
            listen_port: 0,
            host: "127.0.0.1".into(),
            port: local_port,
        })
        .await;
    assert_eq!(info.error, None);
    assert_ne!(info.bound_port, 0);
    let connection = shell.connection().unwrap();
    let (out, _) = support::exec(
        connection.target(),
        &format!("nc -w 3 127.0.0.1 {} </dev/null", info.bound_port),
    )
    .await;
    assert_eq!(out.trim(), "from-local");
    shell.close();
}

#[tokio::test(flavor = "multi_thread")]
async fn port_in_use_reports_error_without_failing_connection() {
    let _bench = BENCH.read().await;
    let Some(bench) = Bench::new() else { return };
    let taken = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = taken.local_addr().unwrap().port();
    let (shell, mut out, states) =
        bench.open_with(false, &format!(" LocalForward 127.0.0.1:{port} 127.0.0.1:7777\n")).await;
    assert_eq!(states.snapshot().last(), Some(&ConnState::Ready));
    let forwards = shell.forwards();
    assert_eq!(forwards.len(), 1);
    assert!(forwards[0].error.is_some(), "{forwards:?}");

    shell.write(b"echo still-$((1+1))\n").unwrap();
    out.expect("still-2").await;
    shell.close();
}

#[tokio::test(flavor = "multi_thread")]
async fn removing_a_forward_closes_the_listener() {
    let _bench = BENCH.read().await;
    let Some(bench) = Bench::new() else { return };
    let (shell, _out, _) = bench.open(false).await;
    let info = shell.add_forward(local(0, 7777)).await;
    assert_eq!(round_trip(info.bound_port, "one").await, "one\n");
    assert!(shell.remove_forward(info.id).await);
    let deadline = Instant::now() + Duration::from_secs(3);
    while TcpStream::connect(("127.0.0.1", info.bound_port)).await.is_ok() {
        assert!(Instant::now() < deadline, "listener still open");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(shell.forwards(), vec![]);
    shell.close();
}

#[tokio::test(flavor = "multi_thread")]
async fn forwards_survive_reconnect() {
    let _bench = BENCH.write().await;
    let Some(bench) = Bench::new() else { return };
    let (shell, _out, states) = bench.open(true).await;
    let info = shell.add_forward(local(0, 7777)).await;
    assert_eq!(round_trip(info.bound_port, "before").await, "before\n");

    tokio::task::spawn_blocking(|| docker(&["restart", "-t", "1", TARGET_CONTAINER]))
        .await
        .unwrap();
    let lost =
        states.wait(0, Duration::from_secs(15), |s| matches!(s, ConnState::Lost { .. })).await;
    states.wait(lost, Duration::from_secs(40), |s| *s == ConnState::Ready).await;

    // Same port: the local listener stayed bound while reconnecting.
    assert_eq!(shell.forwards()[0].bound_port, info.bound_port);
    assert_eq!(round_trip(info.bound_port, "after").await, "after\n");
    shell.close();
}

/// A local client that stops reading must not freeze the connection: the shell and
/// other channels stay responsive, and the stalled tunnel is the one that gives up.
#[tokio::test(flavor = "multi_thread")]
async fn a_stalled_tunnel_does_not_freeze_the_connection() {
    let _bench = BENCH.read().await;
    let Some(bench) = Bench::new() else { return };
    let (shell, mut out, _) = bench.open(false).await;
    let connection = shell.connection().unwrap();
    // An endless source on the server, detached from the exec channel.
    support::exec(
        connection.target(),
        "nohup sh -c 'yes | nc -l -p 7790' >/dev/null 2>&1 </dev/null &",
    )
    .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let info = shell.add_forward(local(0, 7790)).await;
    let _stalled = TcpStream::connect(("127.0.0.1", info.bound_port)).await.unwrap(); // never read
    tokio::time::sleep(Duration::from_secs(2)).await;

    for _ in 0..10 {
        let start = Instant::now();
        let (pong, _) = support::exec(connection.target(), "echo pong").await;
        assert_eq!(pong.trim(), "pong");
        assert!(start.elapsed() < Duration::from_millis(500), "took {:?}", start.elapsed());
    }
    shell.write(b"echo alive-$((2+2))\n").unwrap();
    out.expect("alive-4").await;
    shell.close();
}
