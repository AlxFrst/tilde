//! Editing a remote file in a local editor: download to a per-session temporary folder,
//! watch it, upload each saved version after a debounce — unless the remote file changed
//! meanwhile, which is reported as a conflict instead of being overwritten.

use std::{
    hash::{DefaultHasher, Hash, Hasher},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime},
};

use async_trait::async_trait;
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache, new_debouncer};
use parking_lot::Mutex;
use russh_sftp::protocol::OpenFlags;
use tokio::{io::AsyncWriteExt, sync::mpsc};

use crate::{Direction, SftpClient, SftpError, TransferInfo, TransferState, safe_local_name};

/// Editors save in bursts (temp file, rename, metadata): wait for quiet first.
pub const EDIT_DEBOUNCE: Duration = Duration::from_millis(500);
/// Files larger than this are not opened for editing (they are read in memory): use
/// « Télécharger » instead.
pub const EDIT_MAX_BYTES: u64 = 64 * 1024 * 1024;
/// Temporary edit folders older than this are removed at startup.
const STALE_AFTER: Duration = Duration::from_hours(7 * 24);

/// What identifies a version of the remote file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stamp {
    pub size: u64,
    pub mtime: Option<u64>,
}

/// The remote side of an edit (the SFTP client; a fake in tests).
#[async_trait]
pub trait RemoteFile: Send + Sync {
    /// Downloads `remote` into `local`; returns the version fetched.
    async fn fetch(&self, remote: &str, local: &Path) -> Result<Stamp, SftpError>;
    async fn stamp(&self, remote: &str) -> Result<Stamp, SftpError>;
    /// Uploads `local` over `remote`; returns the new remote version.
    async fn push(&self, local: &Path, remote: &str) -> Result<Stamp, SftpError>;
}

fn local_err(path: &Path, e: &std::io::Error) -> SftpError {
    SftpError::Io { path: path.display().to_string(), message: e.to_string() }
}

#[async_trait]
impl RemoteFile for SftpClient {
    async fn fetch(&self, remote: &str, local: &Path) -> Result<Stamp, SftpError> {
        let bytes = self
            .inner()
            .read(remote)
            .await
            .map_err(|e| SftpError::Io { path: remote.to_owned(), message: e.to_string() })?;
        tokio::fs::write(local, bytes).await.map_err(|e| local_err(local, &e))?;
        self.stamp(remote).await
    }

    async fn stamp(&self, remote: &str) -> Result<Stamp, SftpError> {
        let e = self.stat(remote).await?;
        Ok(Stamp { size: e.size, mtime: e.modified })
    }

    async fn push(&self, local: &Path, remote: &str) -> Result<Stamp, SftpError> {
        let bytes = tokio::fs::read(local).await.map_err(|e| local_err(local, &e))?;
        let io = |e: &dyn std::fmt::Display| SftpError::Io {
            path: remote.to_owned(),
            message: e.to_string(),
        };
        let flags = OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE;
        let mut file = self.inner().open_with_flags(remote, flags).await.map_err(|e| io(&e))?;
        file.write_all(&bytes).await.map_err(|e| io(&e))?;
        file.shutdown().await.map_err(|e| io(&e))?;
        drop(file);
        self.stamp(remote).await
    }
}

/// The temporary folder of one SSH session's edits.
#[must_use]
pub fn session_temp_dir(session: u32) -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("Tilde")
        .join("edit")
        .join(format!("{}-{session}", std::process::id()))
}

/// Removes edit folders left by sessions older than a week (crashes, kills).
pub fn clean_stale_edit_dirs() {
    let Some(root) = session_temp_dir(0).parent().map(Path::to_path_buf) else { return };
    let Ok(entries) = std::fs::read_dir(&root) else { return };
    let now = SystemTime::now();
    for e in entries.flatten() {
        let old = e
            .metadata()
            .and_then(|m| m.modified())
            .is_ok_and(|t| now.duration_since(t).unwrap_or_default() > STALE_AFTER);
        if old {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

fn hash_file(path: &Path) -> Option<u64> {
    let bytes = std::fs::read(path).ok()?;
    let mut h = DefaultHasher::new();
    bytes.hash(&mut h);
    Some(h.finish())
}

struct State {
    /// The remote version last downloaded or uploaded.
    stamp: Stamp,
    /// Hash of the local content last synchronised (unchanged saves are skipped).
    synced: Option<u64>,
    info: TransferInfo,
}

type OnEvent = Arc<dyn Fn(TransferInfo) + Send + Sync>;

/// One remote file open in a local editor.
pub struct EditSession {
    state: Arc<Mutex<State>>,
    remote: Arc<dyn RemoteFile>,
    on_event: OnEvent,
    local: PathBuf,
    _watcher: Debouncer<RecommendedWatcher, RecommendedCache>,
    worker: tokio::task::JoinHandle<()>,
}

impl EditSession {
    /// Downloads `remote_path` under `root`, calls `open` on the local copy, then
    /// uploads each save. Status goes to `on_event` as a transfer with id `id`.
    ///
    /// # Errors
    ///
    /// The download fails, or the local folder or the watcher cannot be set up.
    pub async fn start(
        id: u32,
        session: u32,
        root: &Path,
        remote: Arc<dyn RemoteFile>,
        remote_path: &str,
        open: impl FnOnce(&Path) -> Result<(), String>,
        on_event: OnEvent,
    ) -> Result<Self, SftpError> {
        let mut h = DefaultHasher::new();
        remote_path.hash(&mut h);
        let dir = root.join(format!("{:016x}", h.finish()));
        std::fs::create_dir_all(&dir).map_err(|e| local_err(&dir, &e))?;
        let name = remote_path.rsplit('/').next().unwrap_or(remote_path);
        let local = dir.join(safe_local_name(name));
        let size = remote.stamp(remote_path).await?.size;
        if size > EDIT_MAX_BYTES {
            return Err(SftpError::Io {
                path: remote_path.to_owned(),
                message: format!(
                    "fichier trop volumineux pour être modifié ({} Mio au plus) : téléchargez-le",
                    EDIT_MAX_BYTES / (1024 * 1024)
                ),
            });
        }
        let stamp = remote.fetch(remote_path, &local).await?;
        let info = TransferInfo {
            id,
            session,
            direction: Direction::Upload,
            local: local.display().to_string(),
            remote: remote_path.to_owned(),
            total: stamp.size,
            done: stamp.size,
            bytes_per_sec: 0,
            state: TransferState::Done,
        };
        let state =
            Arc::new(Mutex::new(State { stamp, synced: hash_file(&local), info: info.clone() }));
        on_event(info);

        let (tx, mut rx) = mpsc::unbounded_channel::<()>();
        let file_name = local.file_name().map(ToOwned::to_owned);
        let io = |e: notify::Error| SftpError::Io {
            path: dir.display().to_string(),
            message: e.to_string(),
        };
        // Watch the folder: many editors save by writing a new file and renaming it.
        let mut watcher = new_debouncer(EDIT_DEBOUNCE, None, move |r: DebounceEventResult| {
            let Ok(events) = r else { return };
            let ours = events.iter().any(|ev| {
                ev.paths.iter().any(|p| p.file_name().map(ToOwned::to_owned) == file_name)
            });
            if ours {
                let _ = tx.send(());
            }
        })
        .map_err(io)?;
        watcher.watch(&dir, RecursiveMode::NonRecursive).map_err(io)?;

        let worker = {
            let (state, remote, on_event, local, remote_path) = (
                Arc::clone(&state),
                Arc::clone(&remote),
                Arc::clone(&on_event),
                local.clone(),
                remote_path.to_owned(),
            );
            tokio::spawn(async move {
                while rx.recv().await.is_some() {
                    while rx.try_recv().is_ok() {}
                    sync(&state, remote.as_ref(), &on_event, &local, &remote_path, false).await;
                }
            })
        };
        let session = Self { state, remote, on_event, local, _watcher: watcher, worker };
        open(&session.local).map_err(|message| SftpError::Io {
            path: session.local.display().to_string(),
            message: format!("impossible d'ouvrir l'éditeur : {message}"),
        })?;
        Ok(session)
    }

    #[must_use]
    pub fn local_path(&self) -> &Path {
        &self.local
    }

    #[must_use]
    pub fn info(&self) -> TransferInfo {
        self.state.lock().info.clone()
    }

    /// Local changes not on the server yet (unsent save, conflict, failed upload).
    #[must_use]
    pub fn is_dirty(&self) -> bool {
        let st = self.state.lock();
        !matches!(st.info.state, TransferState::Done) || hash_file(&self.local) != st.synced
    }

    /// Tries the upload again after a failure (still refusing to overwrite a remote
    /// change).
    pub async fn retry(&self) {
        let remote_path = self.state.lock().info.remote.clone();
        sync(&self.state, self.remote.as_ref(), &self.on_event, &self.local, &remote_path, false)
            .await;
    }

    /// Opens the local copy again (« Modifier » on a file already being edited).
    ///
    /// # Errors
    ///
    /// The editor could not be started.
    pub fn reopen(&self, open: impl FnOnce(&Path) -> Result<(), String>) -> Result<(), String> {
        open(&self.local)
    }

    /// After a conflict: `true` uploads the local version anyway, `false` replaces it with
    /// the remote one.
    pub async fn resolve(&self, overwrite: bool) {
        let remote_path = self.state.lock().info.remote.clone();
        if overwrite {
            sync(
                &self.state,
                self.remote.as_ref(),
                &self.on_event,
                &self.local,
                &remote_path,
                true,
            )
            .await;
            return;
        }
        let result = self.remote.fetch(&remote_path, &self.local).await;
        let info = {
            let mut st = self.state.lock();
            match result {
                Ok(stamp) => {
                    st.stamp = stamp;
                    st.synced = hash_file(&self.local);
                    st.info.state = TransferState::Done;
                    st.info.total = stamp.size;
                    st.info.done = stamp.size;
                }
                Err(e) => st.info.state = TransferState::Failed { message: e.to_string() },
            }
            st.info.clone()
        };
        (self.on_event)(info);
    }
}

impl Drop for EditSession {
    fn drop(&mut self) {
        self.worker.abort();
    }
}

fn publish(state: &Mutex<State>, on_event: &OnEvent, update: impl FnOnce(&mut State)) {
    let info = {
        let mut st = state.lock();
        update(&mut st);
        st.info.clone()
    };
    on_event(info);
}

/// Uploads the local file if it changed — unless the remote one changed too (`force`
/// skips that check, after the user chose to overwrite).
async fn sync(
    state: &Mutex<State>,
    remote: &dyn RemoteFile,
    on_event: &OnEvent,
    local: &Path,
    remote_path: &str,
    force: bool,
) {
    let current = hash_file(local);
    let (known, synced, in_conflict) = {
        let st = state.lock();
        (st.stamp, st.synced, matches!(st.info.state, TransferState::Conflict { .. }))
    };
    let failed = matches!(state.lock().info.state, TransferState::Failed { .. });
    if current.is_none() || (current == synced && !force && !failed) {
        return;
    }
    if !force {
        match remote.stamp(remote_path).await {
            Ok(now) if now != known || in_conflict => {
                publish(state, on_event, |st| {
                    st.info.state = TransferState::Conflict {
                        message: "le fichier a été modifié sur le serveur depuis son ouverture"
                            .into(),
                    };
                });
                return;
            }
            Ok(_) => {}
            Err(e) => {
                publish(state, on_event, |st| {
                    st.info.state = TransferState::Failed { message: e.to_string() };
                });
                return;
            }
        }
    }
    publish(state, on_event, |st| st.info.state = TransferState::Running);
    let result = remote.push(local, remote_path).await;
    publish(state, on_event, |st| match result {
        Ok(stamp) => {
            st.stamp = stamp;
            st.synced = current;
            st.info.state = TransferState::Done;
            st.info.total = stamp.size;
            st.info.done = stamp.size;
        }
        Err(e) => st.info.state = TransferState::Failed { message: e.to_string() },
    });
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use super::*;

    /// An in-memory remote file whose version can be changed behind our back.
    #[derive(Default)]
    struct Fake {
        content: Mutex<Vec<u8>>,
        mtime: Mutex<u64>,
        pushes: Mutex<u32>,
    }

    impl Fake {
        fn stamp_now(&self) -> Stamp {
            Stamp { size: self.content.lock().len() as u64, mtime: Some(*self.mtime.lock()) }
        }
    }

    #[async_trait]
    impl RemoteFile for Fake {
        async fn fetch(&self, _remote: &str, local: &Path) -> Result<Stamp, SftpError> {
            std::fs::write(local, &*self.content.lock()).unwrap();
            Ok(self.stamp_now())
        }
        async fn stamp(&self, _remote: &str) -> Result<Stamp, SftpError> {
            Ok(self.stamp_now())
        }
        async fn push(&self, local: &Path, _remote: &str) -> Result<Stamp, SftpError> {
            *self.content.lock() = std::fs::read(local).unwrap();
            *self.mtime.lock() += 1;
            *self.pushes.lock() += 1;
            Ok(self.stamp_now())
        }
    }

    async fn start(
        fake: &Arc<Fake>,
    ) -> (EditSession, Arc<Mutex<Vec<TransferInfo>>>, tempfile::TempDir) {
        *fake.content.lock() = b"v1".to_vec();
        let root = tempfile::TempDir::new().unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        let remote: Arc<dyn RemoteFile> = Arc::clone(fake) as Arc<dyn RemoteFile>;
        let edit = EditSession::start(
            7,
            1,
            root.path(),
            remote,
            "/srv/app/config.yml",
            |_| Ok(()),
            Arc::new(move |i| sink.lock().push(i)),
        )
        .await
        .unwrap();
        (edit, events, root)
    }

    async fn settle(pred: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !pred() {
            assert!(Instant::now() < deadline, "condition not reached");
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn editing_a_huge_file_is_refused() {
        // Pretend the remote file is huge: only its stamp is checked before fetching.
        struct Huge(Arc<Fake>);
        #[async_trait]
        impl RemoteFile for Huge {
            async fn fetch(&self, r: &str, l: &Path) -> Result<Stamp, SftpError> {
                self.0.fetch(r, l).await
            }
            async fn stamp(&self, _r: &str) -> Result<Stamp, SftpError> {
                Ok(Stamp { size: EDIT_MAX_BYTES + 1, mtime: Some(1) })
            }
            async fn push(&self, l: &Path, r: &str) -> Result<Stamp, SftpError> {
                self.0.push(l, r).await
            }
        }
        let fake = Arc::new(Fake::default());
        *fake.content.lock() = vec![0; 16];
        let root = tempfile::TempDir::new().unwrap();
        let huge: Arc<dyn RemoteFile> = Arc::new(Huge(Arc::clone(&fake)));
        let err = EditSession::start(
            1,
            1,
            root.path(),
            huge,
            "/var/log/big.log",
            |_| Ok(()),
            Arc::new(|_| {}),
        )
        .await
        .err()
        .expect("refused");
        assert!(err.to_string().contains("trop volumineux"), "{err}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unsent_changes_make_the_edit_dirty() {
        let fake = Arc::new(Fake::default());
        let (edit, _events, _root) = start(&fake).await;
        assert!(!edit.is_dirty());
        *fake.content.lock() = b"theirs".to_vec();
        *fake.mtime.lock() += 10;
        std::fs::write(edit.local_path(), "mine").unwrap();
        settle(|| matches!(edit.info().state, TransferState::Conflict { .. })).await;
        assert!(edit.is_dirty(), "a conflict holds unsent work");
        edit.resolve(true).await;
        assert!(!edit.is_dirty());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn an_editor_that_cannot_start_is_reported() {
        let fake = Arc::new(Fake::default());
        *fake.content.lock() = b"v1".to_vec();
        let root = tempfile::TempDir::new().unwrap();
        let remote: Arc<dyn RemoteFile> = Arc::clone(&fake) as Arc<dyn RemoteFile>;
        let err = EditSession::start(
            1,
            1,
            root.path(),
            remote,
            "/a",
            |_| Err("programme introuvable".into()),
            Arc::new(|_| {}),
        )
        .await
        .err()
        .expect("reported");
        assert!(err.to_string().contains("programme introuvable"), "{err}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn edit_uploads_after_debounce() {
        let fake = Arc::new(Fake::default());
        let (edit, _events, _root) = start(&fake).await;
        assert_eq!(std::fs::read(edit.local_path()).unwrap(), b"v1");
        assert!(edit.local_path().ends_with("config.yml"));

        std::fs::write(edit.local_path(), "v2").unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        std::fs::write(edit.local_path(), "v3").unwrap();
        settle(|| *fake.pushes.lock() >= 1).await;
        tokio::time::sleep(EDIT_DEBOUNCE * 3).await;
        assert_eq!(*fake.pushes.lock(), 1, "one upload for a burst of saves");
        assert_eq!(*fake.content.lock(), b"v3");
        assert_eq!(edit.info().state, TransferState::Done);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn edit_detects_a_remote_change_before_uploading() {
        let fake = Arc::new(Fake::default());
        let (edit, _events, _root) = start(&fake).await;
        // Someone else saves the remote file.
        *fake.content.lock() = b"theirs".to_vec();
        *fake.mtime.lock() += 10;

        std::fs::write(edit.local_path(), "mine").unwrap();
        settle(|| matches!(edit.info().state, TransferState::Conflict { .. })).await;
        assert_eq!(*fake.pushes.lock(), 0, "nothing overwritten silently");

        edit.resolve(true).await;
        assert_eq!(*fake.content.lock(), b"mine");
        assert_eq!(edit.info().state, TransferState::Done);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn resolving_with_the_remote_version_replaces_the_local_copy() {
        let fake = Arc::new(Fake::default());
        let (edit, _events, _root) = start(&fake).await;
        *fake.content.lock() = b"theirs".to_vec();
        *fake.mtime.lock() += 10;
        std::fs::write(edit.local_path(), "mine").unwrap();
        settle(|| matches!(edit.info().state, TransferState::Conflict { .. })).await;

        edit.resolve(false).await;
        assert_eq!(std::fs::read(edit.local_path()).unwrap(), b"theirs");
        assert_eq!(edit.info().state, TransferState::Done);
        tokio::time::sleep(EDIT_DEBOUNCE * 3).await;
        assert_eq!(*fake.pushes.lock(), 0, "the refreshed copy is not sent back");
    }
}
