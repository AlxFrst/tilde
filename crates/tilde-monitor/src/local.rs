//! The local machine, through `sysinfo`.

use std::time::Instant;

use sysinfo::{Disks, Networks, System};

use crate::{Disk, Snapshot, is_pseudo_mount};

/// Keeps the `sysinfo` state between samples (CPU usage and network rates are
/// differences between two refreshes).
pub struct LocalMonitor {
    system: System,
    networks: Networks,
    disks: Disks,
    previous: Option<(Instant, u64, u64)>,
    sampled: bool,
}

impl Default for LocalMonitor {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalMonitor {
    #[must_use]
    pub fn new() -> Self {
        Self {
            system: System::new(),
            networks: Networks::new_with_refreshed_list(),
            disks: Disks::new_with_refreshed_list(),
            previous: None,
            sampled: false,
        }
    }

    pub fn sample(&mut self) -> Snapshot {
        self.system.refresh_cpu_usage();
        self.system.refresh_memory();
        self.networks.refresh(true);
        self.disks.refresh(true);

        // The first refresh has nothing to compare with: its usage is meaningless.
        let cpu_percent = self.sampled.then(|| self.system.global_cpu_usage());
        self.sampled = true;

        let now = Instant::now();
        let (rx, tx) = self
            .networks
            .iter()
            .filter(|(name, _)| !name.eq_ignore_ascii_case("lo"))
            .fold((0u64, 0u64), |(r, t), (_, n)| {
                (r + n.total_received(), t + n.total_transmitted())
            });
        let (received, sent) = match self.previous {
            Some((when, prx, ptx)) => {
                let secs = now.saturating_duration_since(when).as_secs_f64();
                (per_sec(prx, rx, secs), per_sec(ptx, tx, secs))
            }
            None => (None, None),
        };
        self.previous = Some((now, rx, tx));

        let mut disks: Vec<Disk> = Vec::new();
        for d in self.disks.list() {
            let mount = d.mount_point().to_string_lossy().into_owned();
            let fs = d.file_system().to_string_lossy();
            let total = d.total_space();
            if total == 0 || is_pseudo_mount(&fs, &mount) || disks.iter().any(|x| x.mount == mount)
            {
                continue;
            }
            disks.push(Disk { mount, total, used: total.saturating_sub(d.available_space()) });
        }

        let load = System::load_average();
        let load = (cfg!(not(windows))
            && (load.one > 0.0 || load.five > 0.0 || load.fifteen > 0.0))
            .then_some([load.one, load.five, load.fifteen]);

        Snapshot {
            cpu_percent,
            cores: self.system.cpus().len().max(1),
            mem_total: self.system.total_memory(),
            mem_used: self.system.used_memory(),
            swap_total: self.system.total_swap(),
            swap_used: self.system.used_swap(),
            load,
            uptime_secs: System::uptime(),
            net_rx_per_sec: received,
            net_tx_per_sec: sent,
            disks,
            host: System::host_name().unwrap_or_else(|| "cette machine".into()),
        }
    }
}

fn per_sec(before: u64, now: u64, secs: f64) -> Option<u64> {
    if now < before || secs <= 0.0 {
        return None;
    }
    #[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let r = ((now - before) as f64 / secs).round() as u64;
    Some(r)
}
