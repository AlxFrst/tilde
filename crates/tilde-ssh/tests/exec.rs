//! `SshShell::exec` against the test bench, and the remote monitor command on a real
//! Linux server.
#![cfg(feature = "integration")]

use std::time::Duration;

use tilde_ssh::ExecError;

mod support;

use support::session::{BENCH, Bench};

#[tokio::test(flavor = "multi_thread")]
async fn exec_returns_output_and_exit_code() {
    let _bench = BENCH.read().await;
    let Some(bench) = Bench::new() else { return };
    let (shell, _out, _) = bench.open(false).await;
    let ok = shell.exec("echo hello; exit 3", 1024, Duration::from_secs(10)).await.unwrap();
    assert_eq!((ok.stdout.as_str(), ok.exit), ("hello\n", Some(3)));
    let big = shell.exec("head -c 5000 /dev/zero", 1000, Duration::from_secs(10)).await;
    assert!(matches!(big, Err(ExecError::TooLarge(1000))), "{big:?}");
    let slow = shell.exec("sleep 5", 1024, Duration::from_millis(300)).await;
    assert!(matches!(slow, Err(ExecError::Timeout)), "{slow:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn monitor_command_parses_on_the_bench() {
    let _bench = BENCH.read().await;
    let Some(bench) = Bench::new() else { return };
    let (shell, _out, _) = bench.open(false).await;
    let out = shell
        .exec(tilde_monitor::REMOTE_COMMAND, 1024 * 1024, Duration::from_secs(10))
        .await
        .unwrap();
    let raw = tilde_monitor::parse_remote(&out.stdout).unwrap();
    let s = tilde_monitor::RemoteMonitor::default().update(raw, std::time::Instant::now());
    assert!(s.cores >= 1);
    assert!(s.mem_total > 0 && s.mem_used <= s.mem_total);
    assert_ne!(s.host, "");
    assert!(s.disks.iter().any(|d| d.mount == "/"), "{:?}", s.disks);
}
