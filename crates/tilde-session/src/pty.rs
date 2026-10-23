//! One PTY-backed session and its three threads:
//!
//! - **reader**: blocking reads from the PTY into a *bounded* channel. When the pump
//!   stops draining it, the reader blocks, and the PTY applies backpressure to the
//!   child process.
//! - **pump**: coalesces chunks into the sink; while paused (too many unacked bytes)
//!   it waits for acks instead of reading.
//! - **waiter**: waits for the child, then releases the PTY (on Windows the reader only
//!   sees EOF once the pseudoconsole is closed) and hands the exit code to the pump.

use std::{
    io::{Read, Write},
    path::PathBuf,
    sync::{
        Arc,
        mpsc::{self, RecvTimeoutError},
    },
    thread,
    time::{Duration, Instant},
};

use parking_lot::{Condvar, Mutex};
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};

use crate::{Coalescer, OutputSink, SessionError, SessionSpec};

const READ_CHUNK: usize = 64 * 1024;
/// Chunks buffered between reader and pump before the reader blocks.
const CHANNEL_DEPTH: usize = 8;
/// How long the pump waits for the exit code once output has ended.
const EXIT_CODE_WAIT: Duration = Duration::from_secs(5);
const IDLE_WAIT: Duration = Duration::from_millis(250);

struct FlowState {
    coalescer: Coalescer,
    /// Set by an explicit close: stop delivering anything, including `exited`.
    closed: bool,
}

struct Flow {
    state: Mutex<FlowState>,
    cv: Condvar,
}

pub(crate) struct Session {
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pid: Option<u32>,
    flow: Flow,
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

impl Session {
    /// Starts the process and its threads. `on_end` runs once, when the session is over
    /// (process exit or explicit close), on a background thread.
    pub(crate) fn spawn(
        spec: SessionSpec,
        sink: Arc<dyn OutputSink>,
        on_end: impl FnOnce() + Send + 'static,
    ) -> Result<Arc<Self>, SessionError> {
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

        let session = Arc::new(Self {
            pid: child.process_id(),
            killer: Mutex::new(child.clone_killer()),
            master: Mutex::new(Some(pair.master)),
            writer: Mutex::new(Some(writer)),
            flow: Flow {
                state: Mutex::new(FlowState { coalescer: Coalescer::new(), closed: false }),
                cv: Condvar::new(),
            },
        });
        tracing::info!(command = %cmd_name, pid = ?session.pid, "session started");

        let (chunk_tx, chunk_rx) = mpsc::sync_channel::<Vec<u8>>(CHANNEL_DEPTH);
        let (code_tx, code_rx) = mpsc::channel::<Option<i32>>();

        thread::Builder::new()
            .name("pty-reader".into())
            .spawn(move || read_loop(reader, &chunk_tx))?;

        let waiter_session = Arc::clone(&session);
        thread::Builder::new().name("pty-waiter".into()).spawn(move || {
            let code = match child.wait() {
                Ok(status) if status.signal().is_none() => i32::try_from(status.exit_code()).ok(),
                Ok(_) => None,
                Err(e) => {
                    tracing::warn!(error = %e, "waiting for child failed");
                    None
                }
            };
            waiter_session.release_pty();
            let _ = code_tx.send(code);
        })?;

        let pump_session = Arc::clone(&session);
        thread::Builder::new().name("pty-pump".into()).spawn(move || {
            pump_session.pump(&chunk_rx, &code_rx, sink.as_ref());
            on_end();
        })?;

        Ok(session)
    }

    fn pump(
        &self,
        chunks: &mpsc::Receiver<Vec<u8>>,
        exit_code: &mpsc::Receiver<Option<i32>>,
        sink: &dyn OutputSink,
    ) {
        loop {
            let deadline = {
                let mut st = self.flow.state.lock();
                while st.coalescer.is_paused() && !st.closed {
                    self.flow.cv.wait(&mut st);
                }
                if st.closed {
                    return;
                }
                st.coalescer.next_deadline()
            };
            let timeout =
                deadline.map_or(IDLE_WAIT, |d| d.saturating_duration_since(Instant::now()));
            let received = chunks.recv_timeout(timeout);
            let (out, eof) = {
                let mut st = self.flow.state.lock();
                let now = Instant::now();
                match received {
                    Ok(bytes) => {
                        (st.coalescer.push(&bytes, now).or_else(|| st.coalescer.poll(now)), false)
                    }
                    Err(RecvTimeoutError::Timeout) => (st.coalescer.poll(now), false),
                    Err(RecvTimeoutError::Disconnected) => (st.coalescer.flush(), true),
                }
            };
            if let Some(out) = out {
                sink.data(out);
            }
            if eof {
                break;
            }
        }
        let code = exit_code.recv_timeout(EXIT_CODE_WAIT).ok().flatten();
        if !self.flow.state.lock().closed {
            tracing::info!(pid = ?self.pid, ?code, "session exited");
            sink.exited(code);
        }
    }

    /// Drops the writer and the pseudoconsole; the reader then reaches EOF.
    fn release_pty(&self) {
        drop(self.writer.lock().take());
        drop(self.master.lock().take());
    }

    pub(crate) fn write(&self, data: &[u8]) -> std::io::Result<()> {
        let mut writer = self.writer.lock();
        let w = writer.as_mut().ok_or(std::io::ErrorKind::BrokenPipe)?;
        w.write_all(data)?;
        w.flush()
    }

    pub(crate) fn resize(&self, cols: u16, rows: u16) -> std::io::Result<()> {
        if cols == 0 || rows == 0 {
            return Ok(());
        }
        match self.master.lock().as_ref() {
            Some(m) => m.resize(size(cols, rows)).map_err(std::io::Error::other),
            None => Ok(()),
        }
    }

    pub(crate) fn ack(&self, bytes: usize) {
        self.flow.state.lock().coalescer.ack(bytes);
        self.flow.cv.notify_all();
    }

    pub(crate) fn is_busy(&self) -> bool {
        let Some(pid) = self.pid else { return false };
        #[cfg(unix)]
        let leader = self.master.lock().as_ref().and_then(|m| m.process_group_leader());
        #[cfg(not(unix))]
        let leader = None;
        crate::busy::has_running_child(pid, leader)
    }

    /// Stops delivery, kills the process and frees the PTY. Threads wind down on their own.
    pub(crate) fn close(&self) {
        self.flow.state.lock().closed = true;
        self.flow.cv.notify_all();
        if let Err(e) = self.killer.lock().kill() {
            tracing::debug!(error = %e, "kill on close (process may already be gone)");
        }
        self.release_pty();
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
