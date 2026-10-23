//! Parsing remote `/proc` output and computing rates; sampling the local machine.

use std::time::{Duration, Instant};

use tilde_monitor::{LocalMonitor, MonitorError, REMOTE_COMMAND, RemoteMonitor, parse_remote};

const DEBIAN_1: &str = include_str!("fixtures/debian-1.txt");
const DEBIAN_2: &str = include_str!("fixtures/debian-2.txt");
const ALPINE: &str = include_str!("fixtures/alpine.txt");
const MACOS: &str = include_str!("fixtures/macos.txt");

const KIB: u64 = 1024;

#[test]
fn parses_proc_outputs() {
    let mut m = RemoteMonitor::default();
    let s = m.update(parse_remote(DEBIAN_1).unwrap(), Instant::now());
    assert_eq!(s.host, "web-01");
    assert_eq!(s.cores, 2);
    assert_eq!(s.mem_total, 8_000_000 * KIB);
    assert_eq!(s.mem_used, 2_000_000 * KIB, "total - available");
    assert_eq!((s.swap_total, s.swap_used), (2_000_000 * KIB, 500_000 * KIB));
    assert_eq!(s.load, Some([0.52, 0.40, 0.31]));
    assert_eq!(s.uptime_secs, 350_000);
    // First sample: no rate yet.
    assert_eq!(s.cpu_percent, None);
    assert_eq!(s.net_rx_per_sec, None);

    // BusyBox: no MemAvailable (free + buffers + cached), no swap.
    let a = RemoteMonitor::default().update(parse_remote(ALPINE).unwrap(), Instant::now());
    assert_eq!(a.mem_used, (512_000 - 300_000) * KIB);
    assert_eq!((a.swap_total, a.swap_used), (0, 0));
    assert_eq!(a.host, "alpine-box");
}

#[test]
fn cpu_and_network_rates_come_from_deltas() {
    let mut m = RemoteMonitor::default();
    let t0 = Instant::now();
    m.update(parse_remote(DEBIAN_1).unwrap(), t0);
    let s = m.update(parse_remote(DEBIAN_2).unwrap(), t0 + Duration::from_secs(2));
    // busy +400 (user 300 + system 100), idle +800 → 400 / 1200.
    let cpu = s.cpu_percent.unwrap();
    assert!((cpu - 33.333).abs() < 0.01, "{cpu}");
    // eth0 only (lo excluded): +2 MiB received, +512 KiB sent over 2 s.
    assert_eq!(s.net_rx_per_sec, Some(1024 * 1024));
    assert_eq!(s.net_tx_per_sec, Some(256 * 1024));
}

#[test]
fn counter_reset_gives_no_rate() {
    let mut m = RemoteMonitor::default();
    let t0 = Instant::now();
    m.update(parse_remote(DEBIAN_2).unwrap(), t0);
    // The server rebooted: counters went down.
    let s = m.update(parse_remote(DEBIAN_1).unwrap(), t0 + Duration::from_secs(2));
    assert_eq!(s.cpu_percent, None);
    assert_eq!(s.net_rx_per_sec, None);
    assert_eq!(s.net_tx_per_sec, None);
}

#[test]
fn non_linux_output_is_a_clear_error() {
    let err = parse_remote(MACOS).unwrap_err();
    assert!(matches!(err, MonitorError::NotLinux), "{err}");
    assert!(err.to_string().contains("Linux uniquement"));
    assert!(matches!(parse_remote(""), Err(MonitorError::NotLinux)));
}

#[test]
fn pseudo_filesystems_are_skipped() {
    let s = RemoteMonitor::default().update(parse_remote(DEBIAN_1).unwrap(), Instant::now());
    let mounts: Vec<&str> = s.disks.iter().map(|d| d.mount.as_str()).collect();
    assert_eq!(mounts, ["/", "/srv/data"]);
    let root = &s.disks[0];
    assert_eq!((root.total, root.used), (50_000_000 * KIB, 45_500_000 * KIB));

    // In a container, / is an overlay: it is still the disk that matters.
    let a = RemoteMonitor::default().update(parse_remote(ALPINE).unwrap(), Instant::now());
    let mounts: Vec<&str> = a.disks.iter().map(|d| d.mount.as_str()).collect();
    assert_eq!(mounts, ["/"]);
}

#[test]
fn remote_command_reads_every_section() {
    for section in ["stat", "meminfo", "loadavg", "uptime", "netdev", "hostname", "df"] {
        assert!(REMOTE_COMMAND.contains(&format!("@@tilde:{section}@@")), "{section}");
    }
    assert!(REMOTE_COMMAND.contains("LC_ALL=C"));
}

#[test]
fn local_sample_is_sane() {
    let mut m = LocalMonitor::new();
    let first = m.sample();
    assert!(first.cores >= 1);
    assert!(first.mem_total > 0 && first.mem_used <= first.mem_total);
    assert_ne!(first.host, "");
    std::thread::sleep(Duration::from_millis(250));
    let second = m.sample();
    let cpu = second.cpu_percent.unwrap();
    assert!((0.0..=100.0).contains(&cpu), "{cpu}");
    assert!(second.net_rx_per_sec.is_some());
}
