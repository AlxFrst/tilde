//! The local PTY backend and its threads:
//!
//! - **reader**: blocking reads from the PTY into a *bounded* channel. When the pump
//!   stops draining it, the reader blocks, and the PTY applies backpressure to the
//!   child process.
//! - **writer**: writes queued input, so a program that stops reading never blocks the
//!   caller (the IPC thread).
//! - **waiter**: waits for the child, then releases the PTY (on Windows the reader only
//!   sees EOF once the pseudoconsole is closed) and reports the exit code.

use std::{
    io::{self, Read, Write},
    path::PathBuf,
    sync::{Arc, mpsc},
    thread,
};

use parking_lot::Mutex;
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};

use crate::{Backend, OutputFeed, SessionError, SessionSpec};

const READ_CHUNK: usize = 64 * 1024;
/// Chunks buffered between reader and pump before the reader blocks.
const CHANNEL_DEPTH: usize = 8;

pub(crate) struct PtyBackend {
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    /// `None` once the PTY is released.
    input: Mutex<Option<mpsc::Sender<Vec<u8>>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pid: Option<u32>,
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }
}

fn home() -> Option<PathBuf> {
    std::env::home_dir()
}

fn spawn_err(
    command: &str,
    e: impl Into<Box<dyn std::error::Error + Send + Sync>>,
) -> SessionError {
    SessionError::Spawn { command: command.to_owned(), source: e.into() }
}

impl PtyBackend {
    /// Starts the process and its threads.
    pub(crate) fn spawn(spec: SessionSpec) -> Result<(Arc<Self>, OutputFeed), SessionError> {
        let cmd_name = spec.command.clone();
        let pair = native_pty_system()
            .openpty(size(spec.cols.max(1), spec.rows.max(1)))
            .map_err(|e| spawn_err(&cmd_name, e))?;

        let mut cmd = CommandBuilder::new(&spec.command);
        cmd.args(&spec.args);
        let cwd = spec.cwd.filter(|p| p.is_dir()).or_else(home);
        if let Some(cwd) = cwd {
            cmd.cwd(cwd);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "Tilde");
        cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
        for (k, v) in &spec.env {
            cmd.env(k, v);
        }

        let mut child = pair.slave.spawn_command(cmd).map_err(|e| spawn_err(&cmd_name, e))?;
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().map_err(|e| spawn_err(&cmd_name, e))?;
        let writer = pair.master.take_writer().map_err(|e| spawn_err(&cmd_name, e))?;
        let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>();

        let backend = Arc::new(Self {
            pid: child.process_id(),
            killer: Mutex::new(child.clone_killer()),
            master: Mutex::new(Some(pair.master)),
            input: Mutex::new(Some(input_tx)),
        });
        tracing::info!(command = %cmd_name, pid = ?backend.pid, "session started");

        let (chunk_tx, chunk_rx) = mpsc::sync_channel::<Vec<u8>>(CHANNEL_DEPTH);
        let (code_tx, code_rx) = mpsc::channel::<Option<i32>>();
        thread::Builder::new()
            .name("pty-writer".into())
            .spawn(move || write_loop(writer, &input_rx))?;
        thread::Builder::new()
            .name("pty-reader".into())
            .spawn(move || read_loop(reader, &chunk_tx))?;

        let waiter = Arc::clone(&backend);
        thread::Builder::new().name("pty-waiter".into()).spawn(move || {
            let code = match child.wait() {
                Ok(status) if status.signal().is_none() => i32::try_from(status.exit_code()).ok(),
                Ok(_) => None,
                Err(e) => {
                    tracing::warn!(error = %e, "waiting for child failed");
                    None
                }
            };
            waiter.release_pty();
            let _ = code_tx.send(code);
        })?;

        Ok((backend, OutputFeed { chunks: chunk_rx, exit: code_rx }))
    }

    /// Drops the input channel (the writer thread then exits and closes the PTY input)
    /// and the pseudoconsole; the reader then reaches EOF.
    fn release_pty(&self) {
        drop(self.input.lock().take());
        drop(self.master.lock().take());
    }
}

impl Backend for PtyBackend {
    fn write(&self, data: &[u8]) -> io::Result<()> {
        let input = self.input.lock();
        let tx = input.as_ref().ok_or(io::ErrorKind::BrokenPipe)?;
        tx.send(data.to_vec()).map_err(|_| io::ErrorKind::BrokenPipe.into())
    }

    fn resize(&self, cols: u16, rows: u16) -> io::Result<()> {
        if cols == 0 || rows == 0 {
            return Ok(());
        }
        match self.master.lock().as_ref() {
            Some(m) => m.resize(size(cols, rows)).map_err(io::Error::other),
            None => Ok(()),
        }
    }

    fn is_busy(&self) -> bool {
        let Some(pid) = self.pid else { return false };
        #[cfg(unix)]
        let leader = self.master.lock().as_ref().and_then(|m| m.process_group_leader());
        #[cfg(not(unix))]
        let leader = None;
        crate::busy::has_running_child(pid, leader)
    }

    /// Kills the process and frees the PTY. Releasing the pseudoconsole can block
    /// (`ClosePseudoConsole`), so it happens on a background thread.
    fn close(&self) {
        if let Err(e) = self.killer.lock().kill() {
            tracing::debug!(error = %e, "kill on close (process may already be gone)");
        }
        let input = self.input.lock().take();
        let master = self.master.lock().take();
        let _ = thread::Builder::new().name("pty-release".into()).spawn(move || {
            drop(input);
            drop(master);
        });
    }
}

fn read_loop(mut reader: Box<dyn Read + Send>, tx: &mpsc::SyncSender<Vec<u8>>) {
    let mut buf = vec![0; READ_CHUNK];
    loop {
        match reader.read(&mut buf) {
            // EIO on Unix means every slave fd is closed: same as EOF.
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        }
    }
}

fn write_loop(mut writer: Box<dyn Write + Send>, rx: &mpsc::Receiver<Vec<u8>>) {
    for data in rx {
        if writer.write_all(&data).and_then(|()| writer.flush()).is_err() {
            break;
        }
    }
}
