//! "Is a program running in this terminal?" — drives the close confirmation.

/// Unix: the PTY's foreground process group differs from the shell's.
/// Windows: the shell has a child process (console hosts excluded).
#[cfg(unix)]
#[must_use]
pub fn has_running_child(shell_pid: u32, pty_leader: Option<i32>) -> bool {
    pty_leader.is_some_and(|leader| u32::try_from(leader).ok() != Some(shell_pid))
}

#[cfg(windows)]
#[must_use]
pub fn has_running_child(shell_pid: u32, _pty_leader: Option<i32>) -> bool {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

    const CONSOLE_HOSTS: [&str; 2] = ["conhost.exe", "openconsole.exe"];
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let shell = Pid::from_u32(shell_pid);
    sys.processes().values().any(|p| {
        p.parent() == Some(shell)
            && !CONSOLE_HOSTS.contains(&p.name().to_string_lossy().to_lowercase().as_str())
    })
}
