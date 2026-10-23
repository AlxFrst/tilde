// The process-table logic is used by the Windows check only, but stays compiled (and
// unit-tested) everywhere.
#![cfg_attr(not(windows), allow(dead_code))]

//! "Is a program running in this terminal?" — drives the close confirmation.

/// A row of the process table, as seen by the busy check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcInfo {
    pub pid: u32,
    pub parent: Option<u32>,
    /// Executable name, e.g. `bash.exe`.
    pub name: String,
}

const CONSOLE_HOSTS: [&str; 2] = ["conhost.exe", "openconsole.exe"];

/// Programs inside these run where the Windows process table cannot see them.
const OPAQUE_SHELLS: [&str; 1] = ["wsl.exe"];

/// Launchers that start the real shell as their only child (Git for Windows'
/// `bin\bash.exe` runs `usr\bin\bash.exe`).
const LAUNCHERS: [&str; 1] = ["bash.exe"];

fn name_of(table: &[ProcInfo], pid: u32) -> Option<String> {
    table.iter().find(|p| p.pid == pid).map(|p| p.name.to_lowercase())
}

fn children(table: &[ProcInfo], pid: u32) -> Vec<&ProcInfo> {
    table
        .iter()
        .filter(|p| {
            p.parent == Some(pid) && !CONSOLE_HOSTS.contains(&p.name.to_lowercase().as_str())
        })
        .collect()
}

/// Decides from a process table whether something other than the idle shell runs.
///
/// - Opaque shells (WSL) are always considered busy: we cannot tell, so we ask.
/// - A launcher whose single child is the same shell is looked through once.
#[must_use]
pub fn busy_in(table: &[ProcInfo], shell_pid: u32) -> bool {
    let shell = name_of(table, shell_pid).unwrap_or_default();
    if OPAQUE_SHELLS.contains(&shell.as_str()) {
        return true;
    }
    let kids = children(table, shell_pid);
    if let [only] = kids.as_slice() {
        let child = only.name.to_lowercase();
        if LAUNCHERS.contains(&shell.as_str()) && child == shell {
            return !children(table, only.pid).is_empty();
        }
    }
    !kids.is_empty()
}

/// Unix: the PTY's foreground process group differs from the shell's.
#[cfg(unix)]
#[must_use]
pub fn has_running_child(shell_pid: u32, pty_leader: Option<i32>) -> bool {
    pty_leader.is_some_and(|leader| u32::try_from(leader).ok() != Some(shell_pid))
}

/// Windows: inspects the process table (see [`busy_in`]).
#[cfg(windows)]
#[must_use]
pub fn has_running_child(shell_pid: u32, _pty_leader: Option<i32>) -> bool {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let table: Vec<ProcInfo> = sys
        .processes()
        .values()
        .map(|p| ProcInfo {
            pid: p.pid().as_u32(),
            parent: p.parent().map(sysinfo::Pid::as_u32),
            name: p.name().to_string_lossy().into_owned(),
        })
        .collect();
    busy_in(&table, shell_pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pid: u32, parent: u32, name: &str) -> ProcInfo {
        ProcInfo { pid, parent: Some(parent), name: name.into() }
    }

    #[test]
    fn idle_shell_with_console_host_is_not_busy() {
        let t = [p(10, 1, "cmd.exe"), p(11, 10, "conhost.exe")];
        assert!(!busy_in(&t, 10));
    }

    #[test]
    fn shell_with_a_child_is_busy() {
        let t = [p(10, 1, "cmd.exe"), p(12, 10, "PING.EXE")];
        assert!(busy_in(&t, 10));
    }

    #[test]
    fn git_bash_launcher_is_looked_through() {
        // bin\bash.exe (20) → usr\bin\bash.exe (21): idle.
        let idle = [p(20, 1, "bash.exe"), p(21, 20, "bash.exe")];
        assert!(!busy_in(&idle, 20));
        // …running vim under the real bash: busy.
        let busy = [p(20, 1, "bash.exe"), p(21, 20, "bash.exe"), p(22, 21, "vim.exe")];
        assert!(busy_in(&busy, 20));
    }

    #[test]
    fn wsl_is_always_busy() {
        let t = [p(30, 1, "wsl.exe")];
        assert!(busy_in(&t, 30));
    }

    #[test]
    fn unknown_shell_pid_is_not_busy() {
        assert!(!busy_in(&[], 99));
    }
}
