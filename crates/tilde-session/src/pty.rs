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
/// Quiet period after the process exited before the session is reported as ended.
const EXIT_GRACE: Duration = Duration::from_millis(200);

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
    /// Input goes through a dedicated thread so a program that stops reading never
    /// blocks the caller (the IPC thread). `None` once the PTY is released.
    input: Mutex<Option<mpsc::Sender<Vec<u8>>>>,
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
        let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>();

        let session = Arc::new(Self {
            pid: child.process_id(),
            killer: Mutex::new(child.clone_killer()),
            master: Mutex::new(Some(pair.master)),
            input: Mutex::new(Some(input_tx)),
            flow: Flow {
                state: Mutex::new(FlowState { coalescer: Coalescer::new(), closed: false }),
                cv: Condvar::new(),
            },
        });
        tracing::info!(command = %cmd_name, pid = ?session.pid, "session started");

        let (chunk_tx, chunk_rx) = mpsc::sync_channel::<Vec<u8>>(CHANNEL_DEPTH);
        thread::Builder::new()
            .name("pty-writer".into())
            .spawn(move || write_loop(writer, &input_rx))?;
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
        // Set once the process has exited. A background job can keep the PTY open after
        // the shell is gone (`sleep 600 & exit` on Unix), so the reader may never see EOF:
        // once the output has been quiet for EXIT_GRACE we finish anyway.
        let mut exited: Option<Option<i32>> = None;
        let mut last_data = Instant::now();
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
            let mut timeout =
                deadline.map_or(IDLE_WAIT, |d| d.saturating_duration_since(Instant::now()));
            if exited.is_some() {
                timeout = timeout.min(EXIT_GRACE);
            }
            let received = chunks.recv_timeout(timeout);
            if received.is_ok() {
                last_data = Instant::now();
            }
            if exited.is_none() {
                exited = exit_code.try_recv().ok();
            }
            let quiet_after_exit = exited.is_some() && last_data.elapsed() >= EXIT_GRACE;
            let (out, done) = {
                let mut st = self.flow.state.lock();
                let now = Instant::now();
                match received {
                    Ok(bytes) => {
                        (st.coalescer.push(&bytes, now).or_else(|| st.coalescer.poll(now)), false)
                    }
                    Err(RecvTimeoutError::Timeout) if quiet_after_exit => {
                        (st.coalescer.flush(), true)
                    }
                    Err(RecvTimeoutError::Timeout) => (st.coalescer.poll(now), false),
                    Err(RecvTimeoutError::Disconnected) => (st.coalescer.flush(), true),
                }
            };
            if let Some(out) = out {
                sink.data(out);
            }
            if done {
                break;
            }
        }
        let code = match exited {
            Some(code) => code,
            None => exit_code.recv_timeout(EXIT_CODE_WAIT).ok().flatten(),
        };
        if !self.flow.state.lock().closed {
            tracing::info!(pid = ?self.pid, ?code, "session exited");
            sink.exited(code);
        }
    }

    /// Drops the input channel (the writer thread then exits and closes the PTY input)
    /// and the pseudoconsole; the reader then reaches EOF.
    fn release_pty(&self) {
        drop(self.input.lock().take());
        drop(self.master.lock().take());
    }

    /// Queues input; never blocks, even if the program is not reading.
    pub(crate) fn write(&self, data: &[u8]) -> std::io::Result<()> {
        let input = self.input.lock();
        let tx = input.as_ref().ok_or(std::io::ErrorKind::BrokenPipe)?;
        tx.send(data.to_vec()).map_err(|_| std::io::ErrorKind::BrokenPipe.into())
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
    /// Releasing the pseudoconsole can block (`ClosePseudoConsole`), so it happens on a
    /// background thread rather than the caller's.
    pub(crate) fn close(self: &Arc<Self>) {
        self.flow.state.lock().closed = true;
        self.flow.cv.notify_all();
        if let Err(e) = self.killer.lock().kill() {
            tracing::debug!(error = %e, "kill on close (process may already be gone)");
        }
        let this = Arc::clone(self);
        let _ = thread::Builder::new().name("pty-release".into()).spawn(move || this.release_pty());
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
