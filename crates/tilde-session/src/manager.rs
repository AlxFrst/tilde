use std::{
    collections::HashMap,
    sync::{
        Arc, Weak,
        atomic::{AtomicU32, Ordering},
    },
};

use parking_lot::Mutex;

use crate::{OutputSink, SessionError, SessionId, SessionSpec, pty::Session};

#[derive(Default)]
struct Inner {
    sessions: Mutex<HashMap<SessionId, Arc<Session>>>,
    next_id: AtomicU32,
}

/// All live terminal sessions. Cheap to clone; clones share state.
#[derive(Clone, Default)]
pub struct SessionManager {
    inner: Arc<Inner>,
}

impl SessionManager {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Launches `spec`. Output goes to `sink`; the session removes itself when it ends.
    ///
    /// # Errors
    ///
    /// [`SessionError::Spawn`] if the PTY or the process cannot be created.
    pub fn open(
        &self,
        spec: SessionSpec,
        sink: Arc<dyn OutputSink>,
    ) -> Result<SessionId, SessionError> {
        let id = SessionId(self.inner.next_id.fetch_add(1, Ordering::Relaxed) + 1);
        let weak: Weak<Inner> = Arc::downgrade(&self.inner);
        // Hold the map lock across spawn + insert: a process that exits instantly runs
        // `on_end` (which needs this lock) only after it has been inserted.
        let mut sessions = self.inner.sessions.lock();
        let session = Session::spawn(spec, sink, move || {
            if let Some(inner) = weak.upgrade() {
                inner.sessions.lock().remove(&id);
            }
        })?;
        sessions.insert(id, session);
        Ok(id)
    }

    fn get(&self, id: SessionId) -> Result<Arc<Session>, SessionError> {
        self.inner.sessions.lock().get(&id).cloned().ok_or(SessionError::NotFound(id))
    }

    /// # Errors
    ///
    /// `NotFound` for an unknown id, `Io` if the PTY is gone.
    pub fn write(&self, id: SessionId, data: &[u8]) -> Result<(), SessionError> {
        Ok(self.get(id)?.write(data)?)
    }

    /// Ignores zero sizes (a hidden or collapsed pane).
    ///
    /// # Errors
    ///
    /// `NotFound` for an unknown id, `Io` if the resize fails.
    pub fn resize(&self, id: SessionId, cols: u16, rows: u16) -> Result<(), SessionError> {
        Ok(self.get(id)?.resize(cols, rows)?)
    }

    /// Records that the UI rendered `bytes` of output.
    ///
    /// # Errors
    ///
    /// `NotFound` for an unknown id.
    pub fn ack(&self, id: SessionId, bytes: usize) -> Result<(), SessionError> {
        self.get(id)?.ack(bytes);
        Ok(())
    }

    /// Whether a program other than the shell is running (asks before closing).
    ///
    /// # Errors
    ///
    /// `NotFound` for an unknown id.
    pub fn is_busy(&self, id: SessionId) -> Result<bool, SessionError> {
        Ok(self.get(id)?.is_busy())
    }

    /// Kills the process and forgets the session. No `exited` event is sent.
    ///
    /// # Errors
    ///
    /// `NotFound` for an unknown id.
    pub fn close(&self, id: SessionId) -> Result<(), SessionError> {
        let session = self.inner.sessions.lock().remove(&id).ok_or(SessionError::NotFound(id))?;
        session.close();
        Ok(())
    }

    /// Closes every session (application shutdown).
    pub fn close_all(&self) {
        let all: Vec<_> = self.inner.sessions.lock().drain().map(|(_, s)| s).collect();
        for s in all {
            s.close();
        }
    }

    #[must_use]
    pub fn count(&self) -> usize {
        self.inner.sessions.lock().len()
    }
}
