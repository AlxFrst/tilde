//! A remote Linux server, read from `/proc` in one command (no agent to install).

use std::time::Instant;

use crate::{Disk, MonitorError, Snapshot, is_pseudo_mount};

/// One command printing every section the monitor needs, each after a
/// `@@tilde:<section>@@` marker. `LC_ALL=C` keeps `df`'s output parseable.
///
/// The SSH server runs it through the user's login shell, which may be fish or csh:
/// the script itself always runs under `/bin/sh` (it contains no single quote).
pub const REMOTE_COMMAND: &str = "/bin/sh -c 'LC_ALL=C; export LC_ALL; \
echo @@tilde:stat@@; cat /proc/stat 2>&1; \
echo @@tilde:meminfo@@; cat /proc/meminfo 2>&1; \
echo @@tilde:loadavg@@; cat /proc/loadavg 2>&1; \
echo @@tilde:uptime@@; cat /proc/uptime 2>&1; \
echo @@tilde:netdev@@; cat /proc/net/dev 2>&1; \
echo @@tilde:hostname@@; hostname 2>/dev/null || cat /proc/sys/kernel/hostname 2>/dev/null; \
echo @@tilde:df@@; df -kP 2>/dev/null'";

/// What one run of [`REMOTE_COMMAND`] says, before rates are computed.
#[derive(Debug, Clone, PartialEq)]
pub struct RemoteRaw {
    /// (total, idle) jiffies of the `cpu` line.
    cpu: (u64, u64),
    cores: usize,
    mem_total: u64,
    mem_available: u64,
    swap_total: u64,
    swap_free: u64,
    load: Option<[f64; 3]>,
    uptime_secs: u64,
    /// Bytes received and sent by every interface but `lo`.
    net: (u64, u64),
    host: String,
    disks: Vec<Disk>,
}

fn sections(output: &str) -> Vec<(&str, &str)> {
    let mut out = Vec::new();
    let mut rest = output;
    while let Some(start) = rest.find("@@tilde:") {
        let after = &rest[start + 8..];
        let Some(end) = after.find("@@") else { break };
        let name = &after[..end];
        let body_start = after[end + 2..].trim_start_matches(['\r', '\n']);
        let body_end = body_start.find("@@tilde:").unwrap_or(body_start.len());
        out.push((name, &body_start[..body_end]));
        rest = &body_start[body_end..];
    }
    out
}

fn kib(meminfo: &str, key: &str) -> Option<u64> {
    meminfo.lines().find_map(|l| {
        let (k, v) = l.split_once(':')?;
        (k.trim() == key).then(|| v.split_whitespace().next()?.parse::<u64>().ok())?
    })
}

/// Reads the output of [`REMOTE_COMMAND`].
///
/// # Errors
///
/// [`MonitorError::NotLinux`] when `/proc/stat` is missing (macOS, BSD…).
pub fn parse_remote(output: &str) -> Result<RemoteRaw, MonitorError> {
    let s = sections(output);
    let get = |name: &str| s.iter().find(|(n, _)| *n == name).map_or("", |(_, b)| *b);

    let stat = get("stat");
    let cpu_line = stat.lines().find(|l| l.starts_with("cpu ")).ok_or(MonitorError::NotLinux)?;
    let fields: Vec<u64> =
        cpu_line.split_whitespace().skip(1).filter_map(|f| f.parse().ok()).collect();
    if fields.len() < 4 {
        return Err(MonitorError::NotLinux);
    }
    // user nice system idle iowait irq softirq steal (guest is already in user).
    let total: u64 = fields.iter().take(8).sum();
    let idle = fields[3] + fields.get(4).copied().unwrap_or(0);
    let cores = stat
        .lines()
        .filter(|l| l.starts_with("cpu") && l.as_bytes().get(3).is_some_and(u8::is_ascii_digit))
        .count()
        .max(1);

    let meminfo = get("meminfo");
    let mem_total = kib(meminfo, "MemTotal").unwrap_or(0) * 1024;
    let mem_available = kib(meminfo, "MemAvailable").map_or_else(
        || {
            ["MemFree", "Buffers", "Cached"].iter().filter_map(|k| kib(meminfo, k)).sum::<u64>()
                * 1024
        },
        |a| a * 1024,
    );
    let swap_total = kib(meminfo, "SwapTotal").unwrap_or(0) * 1024;
    let swap_free = kib(meminfo, "SwapFree").unwrap_or(0) * 1024;

    let load_fields: Vec<f64> =
        get("loadavg").split_whitespace().take(3).filter_map(|f| f.parse().ok()).collect();
    let load = (load_fields.len() == 3).then(|| [load_fields[0], load_fields[1], load_fields[2]]);

    let uptime_secs = get("uptime")
        .split_whitespace()
        .next()
        .and_then(|f| f.parse::<f64>().ok())
        .map_or(0, |f| {
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)] // ≥ 0, seconds
            let secs = f as u64;
            secs
        });

    let mut net = (0, 0);
    for line in get("netdev").lines().skip(2) {
        let Some((iface, counters)) = line.split_once(':') else { continue };
        if iface.trim() == "lo" {
            continue;
        }
        let c: Vec<u64> = counters.split_whitespace().filter_map(|f| f.parse().ok()).collect();
        if c.len() >= 9 {
            net.0 += c[0];
            net.1 += c[8];
        }
    }

    let host = get("hostname").lines().next().unwrap_or("").trim().to_owned();

    let mut disks: Vec<Disk> = Vec::new();
    for line in get("df").lines().skip(1) {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() < 6 {
            continue;
        }
        let mount = f[5..].join(" ");
        let (Ok(total), Ok(used)) = (f[1].parse::<u64>(), f[2].parse::<u64>()) else { continue };
        if total == 0 || is_pseudo_mount(f[0], &mount) || disks.iter().any(|d| d.mount == mount) {
            continue;
        }
        disks.push(Disk { mount, total: total * 1024, used: used * 1024 });
    }

    Ok(RemoteRaw {
        cpu: (total, idle),
        cores,
        mem_total,
        mem_available: mem_available.min(mem_total),
        swap_total,
        swap_free: swap_free.min(swap_total),
        load,
        uptime_secs,
        net,
        host,
        disks,
    })
}

/// Turns successive [`RemoteRaw`] samples into snapshots (rates need two samples).
#[derive(Debug, Default)]
pub struct RemoteMonitor {
    previous: Option<(RemoteRaw, Instant)>,
}

/// `(now - before) / secs`, or `None` if a counter went down (reboot, wrap).
fn rate(before: u64, now: u64, secs: f64) -> Option<u64> {
    if now < before || secs <= 0.0 {
        return None;
    }
    #[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let r = ((now - before) as f64 / secs).round() as u64;
    Some(r)
}

impl RemoteMonitor {
    pub fn update(&mut self, raw: RemoteRaw, at: Instant) -> Snapshot {
        let (cpu_percent, received, sent) = match &self.previous {
            Some((prev, when)) => {
                let secs = at.saturating_duration_since(*when).as_secs_f64();
                let (dt, di) =
                    (raw.cpu.0.checked_sub(prev.cpu.0), raw.cpu.1.checked_sub(prev.cpu.1));
                let cpu = match (dt, di) {
                    (Some(dt), Some(di)) if dt > 0 && di <= dt => {
                        #[allow(clippy::cast_precision_loss)]
                        let busy = (dt - di) as f32 / dt as f32 * 100.0;
                        Some(busy)
                    }
                    _ => None,
                };
                (cpu, rate(prev.net.0, raw.net.0, secs), rate(prev.net.1, raw.net.1, secs))
            }
            None => (None, None, None),
        };
        let snapshot = Snapshot {
            cpu_percent,
            cores: raw.cores,
            mem_total: raw.mem_total,
            mem_used: raw.mem_total - raw.mem_available,
            swap_total: raw.swap_total,
            swap_used: raw.swap_total - raw.swap_free,
            load: raw.load,
            uptime_secs: raw.uptime_secs,
            net_rx_per_sec: received,
            net_tx_per_sec: sent,
            disks: raw.disks.clone(),
            host: raw.host.clone(),
        };
        self.previous = Some((raw, at));
        snapshot
    }
}
