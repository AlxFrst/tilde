//! The transfer queue: streamed uploads and downloads with resume, cancellation and
//! throttled progress.
//!
//! Data always goes through a partial file (`*.part` locally, `*.tilde-part` on the
//! server) renamed at the end, so a cut transfer never leaves a truncated file under the
//! real name, and « Réessayer » resumes from the partial file's size.

use std::{
    collections::VecDeque,
    io::SeekFrom,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
    time::{Duration, Instant},
};

use parking_lot::Mutex;
use russh_sftp::protocol::OpenFlags;
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use crate::sftp::{EntryKind, SftpClient, SftpError, join_remote, safe_local_name};

/// Bytes per read/write: memory per transfer does not depend on the file size.
pub const CHUNK: usize = 256 * 1024;
/// At most one progress event per transfer per this interval (state changes always go).
pub const PROGRESS_EVERY: Duration = Duration::from_millis(100);
const SPEED_WINDOW: Duration = Duration::from_secs(2);
const LOCAL_PART: &str = "part";
const REMOTE_PART: &str = ".tilde-part";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    Upload,
    Download,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum TransferState {
    Queued,
    Running,
    Done,
    Failed {
        message: String,
    },
    Cancelled,
    /// External edit: the remote file changed since it was opened.
    Conflict {
        message: String,
    },
}

impl TransferState {
    fn is_finished(&self) -> bool {
        matches!(self, Self::Done | Self::Failed { .. } | Self::Cancelled)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferInfo {
    pub id: u32,
    /// The SSH session it belongs to.
    pub session: u32,
    pub direction: Direction,
    pub local: String,
    pub remote: String,
    pub total: u64,
    pub done: u64,
    pub bytes_per_sec: u64,
    pub state: TransferState,
}

/// Lets an event through at most every `every`.
#[derive(Debug)]
pub struct Throttle {
    every: Duration,
    last: Option<Instant>,
}

impl Throttle {
    #[must_use]
    pub fn new(every: Duration) -> Self {
        Self { every, last: None }
    }

    pub fn ready(&mut self, now: Instant) -> bool {
        if self.last.is_some_and(|last| now.duration_since(last) < self.every) {
            return false;
        }
        self.last = Some(now);
        true
    }
}

/// Bytes per second over the last couple of seconds.
#[derive(Debug, Default)]
pub struct Speed {
    samples: VecDeque<(Instant, u64)>,
}

impl Speed {
    /// Records that `done` bytes were transferred at `now`; returns the current speed.
    pub fn record(&mut self, now: Instant, done: u64) -> u64 {
        self.samples.push_back((now, done));
        while self.samples.len() > 2
            && self.samples.front().is_some_and(|(t, _)| now.duration_since(*t) > SPEED_WINDOW)
        {
            self.samples.pop_front();
        }
        let (Some((t0, d0)), Some((t1, d1))) = (self.samples.front(), self.samples.back()) else {
            return 0;
        };
        let secs = t1.duration_since(*t0).as_secs_f64();
        if secs <= f64::EPSILON {
            return 0;
        }
        #[allow(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            clippy::cast_precision_loss
        )]
        let speed = ((d1 - d0) as f64 / secs) as u64;
        speed
    }
}

struct Job {
    info: TransferInfo,
    client: Arc<SftpClient>,
    cancel: Arc<AtomicBool>,
}

type OnEvent = Arc<dyn Fn(TransferInfo) + Send + Sync>;

struct Inner {
    concurrency: Mutex<usize>,
    jobs: Mutex<Vec<Job>>,
    next_id: AtomicU32,
    on_event: OnEvent,
}

/// Runs transfers, `concurrency` at a time. Cheap to clone.
#[derive(Clone)]
pub struct TransferQueue {
    inner: Arc<Inner>,
}

impl TransferQueue {
    #[must_use]
    pub fn new(concurrency: usize, on_event: OnEvent) -> Self {
        Self {
            inner: Arc::new(Inner {
                concurrency: Mutex::new(concurrency.max(1)),
                jobs: Mutex::new(Vec::new()),
                next_id: AtomicU32::new(0),
                on_event,
            }),
        }
    }

    /// A fresh id from the same sequence as transfers (external edits use it).
    #[must_use]
    pub fn next_id(&self) -> u32 {
        self.inner.next_id.fetch_add(1, Ordering::Relaxed) + 1
    }

    pub fn set_concurrency(&self, n: usize) {
        *self.inner.concurrency.lock() = n.max(1);
        self.pump();
    }

    #[must_use]
    pub fn list(&self) -> Vec<TransferInfo> {
        self.inner.jobs.lock().iter().map(|j| j.info.clone()).collect()
    }

    /// Queues the download of a remote file or directory tree into `local_dir`. Local
    /// names are made safe; an existing local file is never overwritten (« nom (1).ext »).
    ///
    /// # Errors
    ///
    /// The remote path (or a directory inside) cannot be read.
    pub async fn download(
        &self,
        session: u32,
        client: Arc<SftpClient>,
        remote: &str,
        local_dir: &Path,
    ) -> Result<Vec<u32>, SftpError> {
        let root = client.stat(remote).await?;
        let mut files = Vec::new();
        if root.kind == EntryKind::Dir {
            let base = unique_path(&local_dir.join(safe_local_name(&root.name)));
            let mut stack = vec![(remote.to_owned(), base)];
            while let Some((dir, local)) = stack.pop() {
                std::fs::create_dir_all(&local).map_err(|e| local_err(&local, &e))?;
                for e in client.list(&dir).await? {
                    let target = local.join(safe_local_name(&e.name));
                    match e.kind {
                        EntryKind::Dir => stack.push((e.path, target)),
                        EntryKind::File => files.push((e.path, target, e.size)),
                        // Links and devices are not copied: following a link could pull
                        // in anything on the server.
                        EntryKind::Symlink | EntryKind::Other => {}
                    }
                }
            }
        } else {
            files.push((
                remote.to_owned(),
                unique_path(&local_dir.join(safe_local_name(&root.name))),
                root.size,
            ));
        }
        Ok(files
            .into_iter()
            .map(|(remote, local, size)| {
                self.enqueue(session, &client, Direction::Download, &local, &remote, size)
            })
            .collect())
    }

    /// Queues the upload of a local file or directory tree into `remote_dir`.
    ///
    /// # Errors
    ///
    /// The local path cannot be read, or a remote directory cannot be created.
    pub async fn upload(
        &self,
        session: u32,
        client: Arc<SftpClient>,
        local: &Path,
        remote_dir: &str,
    ) -> Result<Vec<u32>, SftpError> {
        let meta = std::fs::metadata(local).map_err(|e| local_err(local, &e))?;
        let name = local.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let mut files = Vec::new();
        if meta.is_dir() {
            let mut stack = vec![(local.to_path_buf(), join_remote(remote_dir, &name))];
            while let Some((dir, remote)) = stack.pop() {
                if client.stat(&remote).await.is_err() {
                    client.mkdir(&remote).await?;
                }
                for e in std::fs::read_dir(&dir).map_err(|e| local_err(&dir, &e))?.flatten() {
                    let child = join_remote(&remote, &e.file_name().to_string_lossy());
                    let Ok(t) = e.file_type() else { continue };
                    if t.is_dir() {
                        stack.push((e.path(), child));
                    } else if t.is_file() {
                        let size = e.metadata().map_or(0, |m| m.len());
                        files.push((e.path(), child, size));
                    }
                }
            }
        } else {
            files.push((local.to_path_buf(), join_remote(remote_dir, &name), meta.len()));
        }
        Ok(files
            .into_iter()
            .map(|(local, remote, size)| {
                self.enqueue(session, &client, Direction::Upload, &local, &remote, size)
            })
            .collect())
    }

    fn enqueue(
        &self,
        session: u32,
        client: &Arc<SftpClient>,
        direction: Direction,
        local: &Path,
        remote: &str,
        total: u64,
    ) -> u32 {
        let id = self.next_id();
        let info = TransferInfo {
            id,
            session,
            direction,
            local: local.to_string_lossy().into_owned(),
            remote: remote.to_owned(),
            total,
            done: 0,
            bytes_per_sec: 0,
            state: TransferState::Queued,
        };
        (self.inner.on_event)(info.clone());
        self.inner.jobs.lock().push(Job {
            info,
            client: Arc::clone(client),
            cancel: Arc::new(AtomicBool::new(false)),
        });
        self.pump();
        id
    }

    /// Stops a queued or running transfer; its partial file is kept for a retry.
    pub fn cancel(&self, id: u32) {
        let mut cancelled = None;
        if let Some(job) = self.inner.jobs.lock().iter_mut().find(|j| j.info.id == id) {
            job.cancel.store(true, Ordering::Release);
            if job.info.state == TransferState::Queued {
                job.info.state = TransferState::Cancelled;
                cancelled = Some(job.info.clone());
            }
        }
        if let Some(info) = cancelled {
            (self.inner.on_event)(info);
        }
    }

    /// Cancels everything of a closed session.
    pub fn cancel_session(&self, session: u32) {
        let ids: Vec<u32> = self
            .inner
            .jobs
            .lock()
            .iter()
            .filter(|j| j.info.session == session && !j.info.state.is_finished())
            .map(|j| j.info.id)
            .collect();
        for id in ids {
            self.cancel(id);
        }
    }

    /// Queues a failed or cancelled transfer again (it resumes from its partial file),
    /// possibly on a new SFTP session (after a reconnection).
    pub fn retry(&self, id: u32, client: Arc<SftpClient>) {
        let mut queued = None;
        if let Some(job) = self.inner.jobs.lock().iter_mut().find(|j| j.info.id == id)
            && matches!(job.info.state, TransferState::Failed { .. } | TransferState::Cancelled)
        {
            job.client = client;
            job.cancel = Arc::new(AtomicBool::new(false));
            job.info.state = TransferState::Queued;
            job.info.bytes_per_sec = 0;
            queued = Some(job.info.clone());
        }
        if let Some(info) = queued {
            (self.inner.on_event)(info);
            self.pump();
        }
    }

    /// Forgets finished transfers.
    pub fn clear_finished(&self) {
        self.inner.jobs.lock().retain(|j| !j.info.state.is_finished());
    }

    /// Starts queued transfers while fewer than `concurrency` run.
    fn pump(&self) {
        let limit = *self.inner.concurrency.lock();
        let mut to_start = Vec::new();
        {
            let mut jobs = self.inner.jobs.lock();
            let mut running =
                jobs.iter().filter(|j| j.info.state == TransferState::Running).count();
            for job in jobs.iter_mut() {
                if running >= limit {
                    break;
                }
                if job.info.state == TransferState::Queued {
                    job.info.state = TransferState::Running;
                    running += 1;
                    to_start.push((
                        job.info.clone(),
                        Arc::clone(&job.client),
                        Arc::clone(&job.cancel),
                    ));
                }
            }
        }
        for (info, client, cancel) in to_start {
            (self.inner.on_event)(info.clone());
            let queue = self.clone();
            tokio::spawn(async move {
                let state = match run(&queue, &info, &client, &cancel).await {
                    Ok(()) if cancel.load(Ordering::Acquire) => TransferState::Cancelled,
                    Ok(()) => TransferState::Done,
                    Err(e) => TransferState::Failed { message: e.to_string() },
                };
                queue.finish(info.id, state);
            });
        }
    }

    fn update(&self, id: u32, done: u64, total: u64, bytes_per_sec: u64, emit: bool) {
        let info = {
            let mut jobs = self.inner.jobs.lock();
            let Some(job) = jobs.iter_mut().find(|j| j.info.id == id) else { return };
            job.info.done = done;
            job.info.total = total;
            job.info.bytes_per_sec = bytes_per_sec;
            job.info.clone()
        };
        if emit {
            (self.inner.on_event)(info);
        }
    }

    fn finish(&self, id: u32, state: TransferState) {
        let info = {
            let mut jobs = self.inner.jobs.lock();
            let Some(job) = jobs.iter_mut().find(|j| j.info.id == id) else { return };
            if state == TransferState::Done {
                job.info.done = job.info.total;
            }
            job.info.state = state;
            job.info.bytes_per_sec = 0;
            job.info.clone()
        };
        if let TransferState::Failed { message } = &info.state {
            tracing::info!(transfer = id, %message, "transfer failed");
        }
        (self.inner.on_event)(info);
        self.pump();
    }
}

fn local_err(path: &Path, e: &std::io::Error) -> SftpError {
    SftpError::Io { path: path.display().to_string(), message: e.to_string() }
}

fn remote_err(path: &str, e: impl std::fmt::Display) -> SftpError {
    SftpError::Io { path: path.to_owned(), message: e.to_string() }
}

/// `path`, or « name (1).ext », « name (2).ext »… if it exists.
fn unique_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (1..10_000)
        .map(|n| path.with_file_name(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .unwrap_or_else(|| path.to_path_buf())
}

fn local_part(local: &Path) -> PathBuf {
    let mut name = local.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".{LOCAL_PART}"));
    local.with_file_name(name)
}

async fn run(
    queue: &TransferQueue,
    info: &TransferInfo,
    client: &SftpClient,
    cancel: &AtomicBool,
) -> Result<(), SftpError> {
    let ctx = Ctx { queue, info, cancel };
    match info.direction {
        Direction::Download => download_file(&ctx, client).await,
        Direction::Upload => upload_file(&ctx, client).await,
    }
}

/// What a running transfer reports to.
struct Ctx<'a> {
    queue: &'a TransferQueue,
    info: &'a TransferInfo,
    cancel: &'a AtomicBool,
}

/// Copies `reader` into `writer` from `done`, reporting progress, until EOF or cancel.
/// `names` are (source, destination) for error messages.
async fn pump_bytes(
    ctx: &Ctx<'_>,
    reader: &mut (impl tokio::io::AsyncRead + Unpin),
    writer: &mut (impl tokio::io::AsyncWrite + Unpin),
    mut done: u64,
    total: u64,
    names: (&str, &str),
) -> Result<u64, SftpError> {
    let mut buf = vec![0; CHUNK];
    let mut throttle = Throttle::new(PROGRESS_EVERY);
    let mut speed = Speed::default();
    loop {
        if ctx.cancel.load(Ordering::Acquire) {
            break;
        }
        let n = reader.read(&mut buf).await.map_err(|e| remote_err(names.0, e))?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n]).await.map_err(|e| remote_err(names.1, e))?;
        done += n as u64;
        let now = Instant::now();
        let bps = speed.record(now, done);
        let emit = throttle.ready(now);
        ctx.queue.update(ctx.info.id, done, total.max(done), bps, emit);
    }
    writer.flush().await.map_err(|e| remote_err(names.1, e))?;
    Ok(done)
}

async fn download_file(ctx: &Ctx<'_>, client: &SftpClient) -> Result<(), SftpError> {
    let (info, cancel) = (ctx.info, ctx.cancel);
    let local = PathBuf::from(&info.local);
    let part = local_part(&local);
    let total = client.stat(&info.remote).await?.size;
    let have = tokio::fs::metadata(&part).await.map_or(0, |m| m.len());
    // A partial file shorter than the remote one is resumed; anything else restarts.
    let offset = if have < total { have } else { 0 };
    let mut out = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(offset == 0)
        .open(&part)
        .await
        .map_err(|e| local_err(&part, &e))?;
    out.seek(SeekFrom::Start(offset)).await.map_err(|e| local_err(&part, &e))?;
    let mut remote =
        client.inner().open(&info.remote).await.map_err(|e| remote_err(&info.remote, e))?;
    remote.seek(SeekFrom::Start(offset)).await.map_err(|e| remote_err(&info.remote, e))?;
    let part_name = part.display().to_string();
    let done =
        pump_bytes(ctx, &mut remote, &mut out, offset, total, (&info.remote, &part_name)).await?;
    drop(out);
    if cancel.load(Ordering::Acquire) {
        return Ok(());
    }
    if done < total {
        return Err(remote_err(&info.remote, "fichier distant raccourci pendant le transfert"));
    }
    tokio::fs::rename(&part, &local).await.map_err(|e| local_err(&local, &e))
}

async fn upload_file(ctx: &Ctx<'_>, client: &SftpClient) -> Result<(), SftpError> {
    let (info, cancel) = (ctx.info, ctx.cancel);
    let local = PathBuf::from(&info.local);
    let part = format!("{}{REMOTE_PART}", info.remote);
    let total = tokio::fs::metadata(&local).await.map_err(|e| local_err(&local, &e))?.len();
    let have = client.stat(&part).await.map_or(0, |e| e.size);
    let offset = if have < total { have } else { 0 };
    let mut flags = OpenFlags::WRITE | OpenFlags::CREATE;
    if offset == 0 {
        flags |= OpenFlags::TRUNCATE;
    }
    let mut remote =
        client.inner().open_with_flags(&part, flags).await.map_err(|e| remote_err(&part, e))?;
    remote.seek(SeekFrom::Start(offset)).await.map_err(|e| remote_err(&part, e))?;
    let mut input = tokio::fs::File::open(&local).await.map_err(|e| local_err(&local, &e))?;
    input.seek(SeekFrom::Start(offset)).await.map_err(|e| local_err(&local, &e))?;
    let local_name = local.display().to_string();
    pump_bytes(ctx, &mut input, &mut remote, offset, total, (&local_name, &part)).await?;
    remote.shutdown().await.map_err(|e| remote_err(&part, e))?;
    drop(remote);
    if cancel.load(Ordering::Acquire) {
        return Ok(());
    }
    // SFTP v3 cannot rename over an existing file: replace it.
    let _ = client.inner().remove_file(&info.remote).await;
    client.rename(&part, &info.remote).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_events_are_throttled() {
        let mut t = Throttle::new(Duration::from_millis(100));
        let t0 = Instant::now();
        let fired: usize =
            (0..50).map(|i| t0 + Duration::from_millis(i * 10)).filter(|&now| t.ready(now)).count();
        assert_eq!(fired, 5, "500 ms of updates every 10 ms → 5 events");
    }

    #[test]
    fn speed_is_a_moving_average() {
        let mut s = Speed::default();
        let t0 = Instant::now();
        assert_eq!(s.record(t0, 0), 0);
        assert_eq!(s.record(t0 + Duration::from_secs(1), 1_000_000), 1_000_000);
        // Old samples leave the window: a stall shows as a slower speed.
        let later = s.record(t0 + Duration::from_secs(5), 1_000_000);
        assert_eq!(later, 0);
    }

    #[test]
    fn unique_names_never_overwrite() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path().join("rapport.pdf");
        assert_eq!(unique_path(&p), p);
        std::fs::write(&p, "x").unwrap();
        assert_eq!(unique_path(&p), dir.path().join("rapport (1).pdf"));
        std::fs::write(dir.path().join("rapport (1).pdf"), "x").unwrap();
        assert_eq!(unique_path(&p), dir.path().join("rapport (2).pdf"));
    }
}
