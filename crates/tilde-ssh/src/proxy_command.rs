//! `ProxyCommand`: a local process whose stdin/stdout carry the SSH connection.

use std::{
    io,
    pin::Pin,
    process::Stdio,
    sync::Arc,
    task::{Context, Poll},
    time::Duration,
};

use parking_lot::Mutex;
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, ReadBuf},
    process::{Child, ChildStdin, ChildStdout, Command},
};

use crate::ConnectError;

/// Bytes of the command's stderr kept for error messages.
const STDERR_LIMIT: usize = 4096;

/// The running proxy command, usable as the connection's byte stream. The process is
/// killed when this is dropped.
pub struct ProxyStream {
    stdout: ChildStdout,
    stdin: ChildStdin,
    child: Child,
    stderr: Arc<Mutex<String>>,
}

impl ProxyStream {
    /// What the command wrote on stderr (up to 4 KiB), waiting briefly for it to finish.
    pub async fn stderr_after_failure(&mut self) -> String {
        let _ = tokio::time::timeout(Duration::from_millis(500), self.child.wait()).await;
        // Give the reader task a moment to collect the last lines.
        tokio::time::sleep(Duration::from_millis(50)).await;
        self.stderr.lock().trim().to_owned()
    }

    /// A handle on the stderr text, readable after the stream has been moved away.
    #[must_use]
    pub fn stderr_handle(&self) -> Arc<Mutex<String>> {
        Arc::clone(&self.stderr)
    }
}

impl AsyncRead for ProxyStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stdout).poll_read(cx, buf)
    }
}

impl AsyncWrite for ProxyStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.stdin).poll_write(cx, buf)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stdin).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stdin).poll_shutdown(cx)
    }
}

fn shell_command(cmd: &str) -> Command {
    #[cfg(windows)]
    {
        /// Keeps the proxy process from flashing a console window.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut c = Command::new("cmd.exe");
        // /S + outer quotes: cmd strips exactly those, preserving quotes inside `cmd`.
        c.raw_arg(format!("/S /C \"{cmd}\""));
        c.creation_flags(CREATE_NO_WINDOW);
        c
    }
    #[cfg(not(windows))]
    {
        let mut c = Command::new("/bin/sh");
        c.arg("-c").arg(cmd);
        c
    }
}

/// Starts `cmd` (tokens already expanded by the config resolver) through the system shell.
///
/// # Errors
///
/// [`ConnectError::Proxy`] if the process cannot be started.
pub fn spawn_proxy_command(cmd: &str) -> Result<ProxyStream, ConnectError> {
    let mut child = shell_command(cmd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| ConnectError::Proxy {
            message: format!("impossible de lancer le ProxyCommand « {cmd} » : {e}"),
        })?;
    let (Some(stdout), Some(stdin), Some(mut err)) =
        (child.stdout.take(), child.stdin.take(), child.stderr.take())
    else {
        return Err(ConnectError::Proxy { message: "ProxyCommand sans entrée/sortie".into() });
    };
    let stderr = Arc::new(Mutex::new(String::new()));
    let sink = Arc::clone(&stderr);
    tokio::spawn(async move {
        let mut buf = [0u8; 1024];
        while let Ok(n) = err.read(&mut buf).await {
            if n == 0 {
                break;
            }
            let text = String::from_utf8_lossy(&buf[..n]);
            tracing::debug!(stderr = %text.trim_end(), "ProxyCommand");
            let mut s = sink.lock();
            if s.len() < STDERR_LIMIT {
                s.push_str(&text);
            }
        }
    });
    Ok(ProxyStream { stdout, stdin, child, stderr })
}
