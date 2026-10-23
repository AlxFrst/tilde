//! The SSH shell as a terminal [`Backend`], and the delivery of its output to the pump.
//!
//! russh refills every channel window by itself, so a paused UI cannot slow the server
//! down per channel. The reader therefore drains the channel continuously (a stalled
//! reader would stall the whole connection) and, while the UI is behind, holds up to
//! [`HOLD_CAP`] bytes, then waits at most [`STALL_MAX`], then skips output — marked in
//! the terminal — until the UI catches up.

use std::{
    collections::VecDeque,
    io,
    path::Path,
    sync::{
        Arc, OnceLock,
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

use parking_lot::Mutex;
use tilde_session::{Backend, FlowState};
use tokio::sync::{Notify, mpsc::UnboundedSender};

use crate::{
    ForwardInfo, ForwardSpec, RemoteFile, SftpClient, SftpError, Stamp,
    chain::Connection,
    forward::{Forwards, Routes},
};

/// Output held while the UI is paused, before the reader starts waiting for it.
pub const HOLD_CAP: usize = 4 * 1024 * 1024;
/// How long the reader may hold the connection up for a paused UI, once per pause.
pub const STALL_MAX: Duration = Duration::from_millis(100);
const STALL_POLL: Duration = Duration::from_millis(10);

type Gate = Box<dyn Fn() -> bool + Send + Sync>;

pub(crate) enum Input {
    Data(Vec<u8>),
    Resize(u16, u16),
}

/// A remote shell, kept across reconnections. Implements [`Backend`].
pub struct SshShell {
    input: UnboundedSender<Input>,
    size: Mutex<(u16, u16)>,
    /// A shell is attached: input is accepted (dropped while reconnecting).
    ready: AtomicBool,
    /// The session is over (exited, failed or closed).
    ended: AtomicBool,
    closing: AtomicBool,
    pub(crate) closed: Notify,
    /// True while the UI is behind (the session's [`FlowState`]).
    paused: OnceLock<Gate>,
    held: AtomicUsize,
    connection: Mutex<Option<Arc<Connection>>>,
    pub(crate) forwards: Forwards,
    /// The SFTP session and the connection it was opened on.
    sftp: tokio::sync::Mutex<Option<(Arc<Connection>, Arc<SftpClient>)>>,
}

impl SshShell {
    pub(crate) fn new(input: UnboundedSender<Input>, cols: u16, rows: u16) -> Self {
        Self {
            input,
            size: Mutex::new((cols, rows)),
            ready: AtomicBool::new(false),
            ended: AtomicBool::new(false),
            closing: AtomicBool::new(false),
            closed: Notify::new(),
            paused: OnceLock::new(),
            held: AtomicUsize::new(0),
            connection: Mutex::new(None),
            forwards: Forwards::default(),
            sftp: tokio::sync::Mutex::new(None),
        }
    }

    /// Lets the shell see when the UI is behind. Call once, right after
    /// `SessionManager::open_backend`.
    pub fn attach_flow(&self, flow: FlowState) {
        self.set_gate(Box::new(move || flow.is_paused()));
    }

    pub(crate) fn set_gate(&self, gate: Gate) {
        let _ = self.paused.set(gate);
    }

    /// Output currently held back for a paused UI.
    #[must_use]
    pub fn held_bytes(&self) -> usize {
        self.held.load(Ordering::Relaxed)
    }

    /// The current connection (`None` while reconnecting or once ended).
    #[must_use]
    pub fn connection(&self) -> Option<Arc<Connection>> {
        self.connection.lock().clone()
    }

    /// Opens a tunnel on this session. A failure (port taken, refused by the server) is
    /// reported in [`ForwardInfo::error`]; the session is unaffected.
    pub async fn add_forward(self: &Arc<Self>, spec: ForwardSpec) -> ForwardInfo {
        self.forwards.add(spec, self).await
    }

    /// Closes a tunnel. `false` for an unknown id.
    pub async fn remove_forward(&self, id: u32) -> bool {
        self.forwards.remove(id, self.connection()).await
    }

    #[must_use]
    pub fn forwards(&self) -> Vec<ForwardInfo> {
        self.forwards.list()
    }

    pub(crate) fn routes(&self) -> Arc<Routes> {
        Arc::clone(&self.forwards.routes)
    }

    pub(crate) fn size(&self) -> (u16, u16) {
        *self.size.lock()
    }

    pub(crate) fn is_closing(&self) -> bool {
        self.closing.load(Ordering::Acquire)
    }

    pub(crate) fn attach(&self, connection: Option<Arc<Connection>>) {
        self.ready.store(connection.is_some(), Ordering::Release);
        *self.connection.lock() = connection;
    }

    /// The SFTP session of this SSH session, opened on first use and reopened after a
    /// reconnection (or after [`Self::reset_sftp`]).
    ///
    /// # Errors
    ///
    /// [`SftpError::Unavailable`] while reconnecting, or when the server has no SFTP.
    pub async fn sftp(&self) -> Result<Arc<SftpClient>, SftpError> {
        let Some(connection) = self.connection() else {
            return Err(SftpError::Unavailable("connexion en cours de rétablissement".into()));
        };
        let mut cached = self.sftp.lock().await;
        if let Some((on, client)) = cached.as_ref()
            && Arc::ptr_eq(on, &connection)
            && !client.is_dead()
        {
            return Ok(Arc::clone(client));
        }
        let client = Arc::new(SftpClient::open(&connection).await?);
        *cached = Some((connection, Arc::clone(&client)));
        Ok(client)
    }

    /// Forgets the SFTP session (its channel failed): the next call opens a new one.
    pub async fn reset_sftp(&self) {
        *self.sftp.lock().await = None;
    }

    pub(crate) fn end(&self) {
        self.attach(None);
        self.forwards.stop_all();
        self.ended.store(true, Ordering::Release);
    }

    fn paused(&self) -> bool {
        self.paused.get().is_some_and(|gate| gate())
    }
}

/// Edits go through the session's current SFTP client, so they keep working across
/// reconnections and reopened channels.
#[async_trait::async_trait]
impl RemoteFile for SshShell {
    async fn fetch(&self, remote: &str, local: &Path) -> Result<Stamp, SftpError> {
        self.sftp().await?.fetch(remote, local).await
    }

    async fn stamp(&self, remote: &str) -> Result<Stamp, SftpError> {
        self.sftp().await?.stamp(remote).await
    }

    async fn push(&self, local: &Path, remote: &str) -> Result<Stamp, SftpError> {
        self.sftp().await?.push(local, remote).await
    }
}

impl Backend for SshShell {
    fn write(&self, data: &[u8]) -> io::Result<()> {
        if self.ended.load(Ordering::Acquire) {
            return Err(io::ErrorKind::BrokenPipe.into());
        }
        if self.ready.load(Ordering::Acquire) {
            self.input.send(Input::Data(data.to_vec())).map_err(|_| io::ErrorKind::BrokenPipe)?;
        }
        Ok(())
    }

    fn resize(&self, cols: u16, rows: u16) -> io::Result<()> {
        if cols == 0 || rows == 0 {
            return Ok(());
        }
        *self.size.lock() = (cols, rows);
        if self.ready.load(Ordering::Acquire) {
            let _ = self.input.send(Input::Resize(cols, rows));
        }
        Ok(())
    }

    /// A connected SSH session always asks before closing.
    fn is_busy(&self) -> bool {
        !self.ended.load(Ordering::Acquire)
    }

    fn close(&self) {
        self.closing.store(true, Ordering::Release);
        self.closed.notify_one();
    }
}

/// The dim line that replaces skipped output.
fn notice(skipped: usize) -> Vec<u8> {
    let kib = skipped.div_ceil(1024);
    format!("\r\n\x1b[0m\x1b[2m── {kib} Kio de sortie ignorés (affichage en retard) ──\x1b[0m\r\n")
        .into_bytes()
}

/// Where the shell's output goes: straight to the pump, or held while the UI is behind.
pub(crate) struct Delivery {
    shell: Arc<SshShell>,
    tx: mpsc::Sender<Vec<u8>>,
    held: VecDeque<Vec<u8>>,
    held_bytes: usize,
    skipped: usize,
    /// Already waited for the UI during this pause.
    waited: bool,
}

impl Delivery {
    pub(crate) fn new(shell: Arc<SshShell>, tx: mpsc::Sender<Vec<u8>>) -> Self {
        Self { shell, tx, held: VecDeque::new(), held_bytes: 0, skipped: 0, waited: false }
    }

    pub(crate) fn has_backlog(&self) -> bool {
        !self.held.is_empty() || self.skipped > 0
    }

    /// Delivers what was held (and the skip notice) once the UI has caught up.
    pub(crate) fn release(&mut self) {
        if self.shell.paused() {
            return;
        }
        self.waited = false;
        for chunk in self.held.drain(..) {
            let _ = self.tx.send(chunk);
        }
        self.held_bytes = 0;
        self.shell.held.store(0, Ordering::Relaxed);
        if self.skipped > 0 {
            let _ = self.tx.send(notice(self.skipped));
            self.skipped = 0;
        }
    }

    pub(crate) async fn push(&mut self, data: Vec<u8>) {
        if self.held_bytes + data.len() > HOLD_CAP && !self.waited && self.shell.paused() {
            self.waited = true;
            let deadline = Instant::now() + STALL_MAX;
            while self.shell.paused() && Instant::now() < deadline {
                tokio::time::sleep(STALL_POLL).await;
            }
        }
        self.release();
        if !self.has_backlog() && !self.shell.paused() {
            let _ = self.tx.send(data);
        } else if self.held_bytes + data.len() <= HOLD_CAP {
            self.held_bytes += data.len();
            self.shell.held.store(self.held_bytes, Ordering::Relaxed);
            self.held.push_back(data);
        } else {
            self.skipped += data.len();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        shell: Arc<SshShell>,
        delivery: Delivery,
        out: mpsc::Receiver<Vec<u8>>,
        paused: Arc<AtomicBool>,
        _input: tokio::sync::mpsc::UnboundedReceiver<Input>,
    }

    fn fixture() -> Fixture {
        let (input, input_rx) = tokio::sync::mpsc::unbounded_channel();
        let shell = Arc::new(SshShell::new(input, 80, 24));
        let paused = Arc::new(AtomicBool::new(false));
        let gate = Arc::clone(&paused);
        shell.set_gate(Box::new(move || gate.load(Ordering::Relaxed)));
        let (tx, out) = mpsc::channel();
        Fixture {
            delivery: Delivery::new(Arc::clone(&shell), tx),
            shell,
            out,
            paused,
            _input: input_rx,
        }
    }

    fn drain(out: &mpsc::Receiver<Vec<u8>>) -> Vec<u8> {
        out.try_iter().flatten().collect()
    }

    #[tokio::test]
    async fn delivers_directly_when_not_paused() {
        let mut f = fixture();
        f.delivery.push(b"hello".to_vec()).await;
        assert_eq!(drain(&f.out), b"hello");
        assert_eq!(f.shell.held_bytes(), 0);
    }

    #[tokio::test]
    async fn holds_while_paused_and_releases_in_order() {
        let mut f = fixture();
        f.paused.store(true, Ordering::Relaxed);
        f.delivery.push(b"a".to_vec()).await;
        f.delivery.push(b"b".to_vec()).await;
        assert_eq!(drain(&f.out), b"");
        assert_eq!(f.shell.held_bytes(), 2);
        assert!(f.delivery.has_backlog());

        f.delivery.release();
        assert_eq!(drain(&f.out), b"", "still paused: nothing released");

        f.paused.store(false, Ordering::Relaxed);
        f.delivery.release();
        f.delivery.push(b"c".to_vec()).await;
        assert_eq!(drain(&f.out), b"abc");
        assert_eq!(f.shell.held_bytes(), 0);
        assert!(!f.delivery.has_backlog());
    }

    #[tokio::test]
    async fn skips_beyond_the_cap_after_waiting_once_and_says_so() {
        let mut f = fixture();
        f.paused.store(true, Ordering::Relaxed);
        let chunk = vec![b'x'; 64 * 1024];
        for _ in 0..(HOLD_CAP / chunk.len()) {
            f.delivery.push(chunk.clone()).await;
        }
        assert_eq!(f.shell.held_bytes(), HOLD_CAP);

        let start = Instant::now();
        f.delivery.push(chunk.clone()).await; // waits STALL_MAX, then skips
        assert!(start.elapsed() >= STALL_MAX);
        let start = Instant::now();
        f.delivery.push(chunk.clone()).await; // no second wait in the same pause
        assert!(start.elapsed() < STALL_MAX);
        assert_eq!(f.shell.held_bytes(), HOLD_CAP);

        f.paused.store(false, Ordering::Relaxed);
        f.delivery.release();
        let out = drain(&f.out);
        assert_eq!(out.len() - HOLD_CAP, notice(2 * chunk.len()).len());
        assert!(String::from_utf8_lossy(&out[HOLD_CAP..]).contains("128 Kio de sortie ignorés"));
    }

    #[tokio::test]
    async fn the_ui_catching_up_during_the_wait_loses_nothing() {
        let mut f = fixture();
        f.paused.store(true, Ordering::Relaxed);
        let chunk = vec![b'x'; HOLD_CAP];
        f.delivery.push(chunk).await;
        let paused = Arc::clone(&f.paused);
        tokio::spawn(async move {
            tokio::time::sleep(STALL_MAX / 4).await;
            paused.store(false, Ordering::Relaxed);
        });
        f.delivery.push(b"tail".to_vec()).await;
        let out = drain(&f.out);
        assert_eq!(out.len(), HOLD_CAP + 4);
        assert!(out.ends_with(b"tail"));
    }

    #[test]
    fn input_is_dropped_while_no_shell_is_attached() {
        let (input, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let shell = SshShell::new(input, 80, 24);
        shell.write(b"ls\r").unwrap();
        shell.resize(100, 40).unwrap();
        assert!(rx.try_recv().is_err());
        assert_eq!(shell.size(), (100, 40));
        assert!(shell.is_busy());

        shell.end();
        assert!(shell.write(b"x").is_err());
        assert!(!shell.is_busy());
    }
}
