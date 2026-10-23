//! Finding the shells installed on this machine.

use serde::Serialize;

/// A shell found on this machine, before user profiles are applied.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellCandidate {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub icon: &'static str,
}

/// Parses `wsl.exe -l -q`, which prints UTF-16LE on most Windows builds and UTF-8 on some.
#[must_use]
pub fn parse_wsl_list(stdout: &[u8]) -> Vec<String> {
    let looks_utf16 = stdout.len().is_multiple_of(2) && stdout.contains(&0);
    let text = if looks_utf16 {
        let units: Vec<u16> =
            stdout.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(stdout).into_owned()
    };
    text.lines()
        .map(|l| l.trim_matches(|c: char| c == '\u{feff}' || c == '\0' || c.is_whitespace()))
        .filter(|l| !l.is_empty() && !l.starts_with("docker-desktop"))
        .map(str::to_owned)
        .collect()
}

/// Parses `/etc/shells`: one path per line, `#` comments.
#[must_use]
pub fn parse_etc_shells(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(str::to_owned)
        .collect()
}

/// Lists the shells available on this machine, in the order the UI shows them.
#[must_use]
pub fn detect_shells() -> Vec<ShellCandidate> {
    let shells = platform::detect();
    tracing::debug!(count = shells.len(), "shells detected");
    shells
}

#[cfg(windows)]
mod platform {
    use std::{
        env,
        os::windows::process::CommandExt,
        path::{Path, PathBuf},
        process::{Command, Stdio},
        sync::mpsc,
        thread,
        time::Duration,
    };

    use super::{ShellCandidate, parse_wsl_list};

    /// Keeps `wsl.exe` from flashing a console window.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const WSL_TIMEOUT: Duration = Duration::from_secs(3);

    fn shell(
        id: &str,
        name: &str,
        command: &Path,
        args: &[&str],
        icon: &'static str,
    ) -> ShellCandidate {
        ShellCandidate {
            id: id.into(),
            name: name.into(),
            command: command.to_string_lossy().into_owned(),
            args: args.iter().map(|&a| a.to_owned()).collect(),
            icon,
        }
    }

    fn env_path(var: &str, rest: &str) -> Option<PathBuf> {
        let p = PathBuf::from(env::var_os(var)?).join(rest);
        p.is_file().then_some(p)
    }

    fn git_bash() -> Option<PathBuf> {
        use winreg::{
            RegKey,
            enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE},
        };
        [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER]
            .into_iter()
            .find_map(|hive| {
                let key = RegKey::predef(hive).open_subkey(r"SOFTWARE\GitForWindows").ok()?;
                let dir: String = key.get_value("InstallPath").ok()?;
                let bash = PathBuf::from(dir).join(r"bin\bash.exe");
                bash.is_file().then_some(bash)
            })
            .or_else(|| env_path("ProgramFiles", r"Git\bin\bash.exe"))
    }

    fn wsl_distros() -> Vec<String> {
        let Ok(child) = Command::new("wsl.exe")
            .args(["-l", "-q"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        else {
            return Vec::new();
        };
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let _ = tx.send(child.wait_with_output());
        });
        match rx.recv_timeout(WSL_TIMEOUT) {
            Ok(Ok(out)) if out.status.success() => parse_wsl_list(&out.stdout),
            Ok(_) => Vec::new(),
            Err(_) => {
                tracing::warn!("wsl.exe -l -q timed out; WSL distributions skipped");
                Vec::new()
            }
        }
    }

    pub fn detect() -> Vec<ShellCandidate> {
        let mut out = Vec::new();
        if let Some(p) =
            which::which("pwsh").ok().or_else(|| env_path("ProgramFiles", r"PowerShell\7\pwsh.exe"))
        {
            out.push(shell("pwsh", "PowerShell", &p, &[], "powershell"));
        }
        if let Some(p) = which::which("powershell")
            .ok()
            .or_else(|| env_path("SystemRoot", r"System32\WindowsPowerShell\v1.0\powershell.exe"))
        {
            out.push(shell("powershell", "Windows PowerShell", &p, &[], "powershell"));
        }
        if let Some(p) = env::var_os("ComSpec")
            .map(PathBuf::from)
            .filter(|p| p.is_file())
            .or_else(|| which::which("cmd").ok())
        {
            out.push(shell("cmd", "Invite de commandes", &p, &[], "cmd"));
        }
        if let Some(p) = git_bash() {
            out.push(shell("git-bash", "Git Bash", &p, &["--login", "-i"], "git"));
        }
        for distro in wsl_distros() {
            out.push(ShellCandidate {
                id: format!("wsl:{distro}"),
                name: format!("{distro} (WSL)"),
                command: "wsl.exe".into(),
                args: vec!["-d".into(), distro],
                icon: "linux",
            });
        }
        out
    }
}

#[cfg(not(windows))]
mod platform {
    use std::{collections::HashSet, env, fs, path::Path};

    use super::{ShellCandidate, parse_etc_shells};

    pub fn detect() -> Vec<ShellCandidate> {
        let mut paths: Vec<String> = env::var("SHELL").into_iter().collect();
        paths.extend(parse_etc_shells(&fs::read_to_string("/etc/shells").unwrap_or_default()));
        let mut seen = HashSet::new();
        paths
            .into_iter()
            .filter(|p| Path::new(p).is_file())
            .filter_map(|p| {
                let id = Path::new(&p).file_name()?.to_string_lossy().into_owned();
                seen.insert(id.clone()).then(|| ShellCandidate {
                    name: id.clone(),
                    id,
                    command: p,
                    args: vec!["-l".into()],
                    icon: "terminal",
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16le(s: &str) -> Vec<u8> {
        s.encode_utf16().flat_map(u16::to_le_bytes).collect()
    }

    #[test]
    fn wsl_list_utf16_with_bom() {
        let bytes = utf16le("\u{feff}Ubuntu\r\nDebian\r\ndocker-desktop\r\n\r\n");
        assert_eq!(parse_wsl_list(&bytes), ["Ubuntu", "Debian"]);
    }

    #[test]
    fn wsl_list_utf8_fallback() {
        assert_eq!(parse_wsl_list(b"Ubuntu\nkali-linux\n"), ["Ubuntu", "kali-linux"]);
    }

    #[test]
    fn wsl_list_empty_or_error_text() {
        assert_eq!(parse_wsl_list(b""), Vec::<String>::new());
    }

    #[test]
    fn etc_shells_skips_comments() {
        let text = "# /etc/shells\n/bin/sh\n\n/usr/bin/zsh\n";
        assert_eq!(parse_etc_shells(text), ["/bin/sh", "/usr/bin/zsh"]);
    }

    #[test]
    fn detect_finds_a_shell_on_this_machine() {
        let shells = detect_shells();
        assert_ne!(shells.len(), 0);
        if cfg!(windows) {
            let cmd = shells.iter().find(|s| s.id == "cmd").expect("cmd detected");
            assert!(cmd.command.to_lowercase().ends_with("cmd.exe"), "{}", cmd.command);
        }
    }
}
