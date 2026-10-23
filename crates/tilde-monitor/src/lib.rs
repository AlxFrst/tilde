//! System sampling for Tilde's monitor panel: the local machine through `sysinfo`, and a
//! remote Linux server from the output of [`REMOTE_COMMAND`] (run over SSH by the app).
//!
//! No Tauri and no network here: everything is testable with `cargo test`.

mod local;
mod remote;

use serde::Serialize;

pub use local::LocalMonitor;
pub use remote::{REMOTE_COMMAND, RemoteMonitor, RemoteRaw, parse_remote};

/// One sample, the same for a local or a remote machine. Sizes are in bytes.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// `None` until a second sample gives a difference to measure.
    pub cpu_percent: Option<f32>,
    pub cores: usize,
    pub mem_total: u64,
    pub mem_used: u64,
    pub swap_total: u64,
    pub swap_used: u64,
    /// 1, 5 and 15 minutes; `None` where the OS has none (Windows).
    pub load: Option<[f64; 3]>,
    pub uptime_secs: u64,
    pub net_rx_per_sec: Option<u64>,
    pub net_tx_per_sec: Option<u64>,
    pub disks: Vec<Disk>,
    pub host: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Disk {
    pub mount: String,
    pub total: u64,
    pub used: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum MonitorError {
    #[error("moniteur distant : Linux uniquement (/proc introuvable sur ce serveur)")]
    NotLinux,
}

/// Mount points that are not storage the user cares about.
pub(crate) fn is_pseudo_mount(fs: &str, mount: &str) -> bool {
    const PSEUDO_FS: &[&str] = &[
        "tmpfs", "devtmpfs", "udev", "shm", "none", "overlay", "squashfs", "proc", "sysfs",
        "devfs", "cgroup", "cgroup2",
    ];
    const PSEUDO_MOUNTS: &[&str] =
        &["/dev", "/proc", "/sys", "/run", "/etc", "/snap", "/var/lib/docker", "/boot/efi"];
    if mount == "/" {
        return false;
    }
    let fs = fs.to_ascii_lowercase();
    PSEUDO_FS.contains(&fs.as_str())
        || PSEUDO_MOUNTS.iter().any(|p| mount == *p || mount.starts_with(&format!("{p}/")))
}
