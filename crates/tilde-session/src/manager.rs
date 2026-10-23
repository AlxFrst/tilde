use std::{
    collections::HashMap,
    sync::{
        Arc, Weak,
        atomic::{AtomicU32, Ordering},
    },
    thread,
};

use parking_lot::Mutex;

use crate::{
    Backend, FlowState, OutputFeed, OutputSink, SessionError, SessionId, SessionSpec,
    pty::PtyBackend,
};

struct Entry {
    backend: Arc<dyn Backend>,
    flow: FlowState,
}

#[derive(Default)]
struct Inner {
    sessions: Mutex<HashMap<SessionId, Entry>>,
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

    /// Launches a local shell. Output goes to `sink`; the session removes itself when
    /// it ends.
    ///
    /// # Errors
    ///
    /// [`SessionError::Spawn`] if the PTY or the process cannot be created.
    pub fn open(
        &self,
        spec: SessionSpec,
        sink: Arc<dyn OutputSink>,
    ) -> Result<SessionId, SessionError> {
        let (backend, feed) = PtyBackend::spawn(spec)?;
        Ok(self.open_backend(backend, feed, sink)?.0)
    }

    /// Registers any backend (PTY, SSH…) and starts pumping its output into `sink`.
    /// The returned [`FlowState`] lets the backend throttle its source while paused.
    ///
    /// # Errors
    ///
    /// [`SessionError::Io`] if the pump thread cannot be started.
    pub fn open_backend(
        &self,
        backend: Arc<dyn Backend>,
        feed: OutputFeed,
        sink: Arc<dyn OutputSink>,
    ) -> Result<(SessionId, FlowState), SessionError> {
        let id = SessionId(self.inner.next_id.fetch_add(1, Ordering::Relaxed) + 1);
        let flow = FlowState::default();
        let weak: Weak<Inner> = Arc::downgrade(&self.inner);
        // Hold the map lock across spawn + insert: a session that ends instantly removes
        // itself (which needs this lock) only after it has been inserted.
        let mut sessions = self.inner.sessions.lock();
        let pump_flow = flow.clone();
        thread::Builder::new().name("session-pump".into()).spawn(move || {
            pump_flow.run(&feed, sink.as_ref());
            if let Some(inner) = weak.upgrade() {
                inner.sessions.lock().remove(&id);
            }
        })?;
        sessions.insert(id, Entry { backend, flow: flow.clone() });
        Ok((id, flow))
    }

    fn get(&self, id: SessionId) -> Result<Arc<dyn Backend>, SessionError> {
        self.inner
            .sessions
            .lock()
            .get(&id)
            .map(|e| Arc::clone(&e.backend))
            .ok_or(SessionError::NotFound(id))
    }

    /// # Errors
    ///
    /// `NotFound` for an unknown id, `Io` if the session's input is gone.
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
        let sessions = self.inner.sessions.lock();
        sessions.get(&id).ok_or(SessionError::NotFound(id))?.flow.ack(bytes);
        Ok(())
    }

    /// Whether closing should ask for confirmation.
    ///
    /// # Errors
    ///
    /// `NotFound` for an unknown id.
    pub fn is_busy(&self, id: SessionId) -> Result<bool, SessionError> {
        Ok(self.get(id)?.is_busy())
    }

    /// Ends the session and forgets it. No `exited` event is sent.
    ///
    /// # Errors
    ///
    /// `NotFound` for an unknown id.
    pub fn close(&self, id: SessionId) -> Result<(), SessionError> {
        let entry = self.inner.sessions.lock().remove(&id).ok_or(SessionError::NotFound(id))?;
        entry.flow.close();
        entry.backend.close();
        Ok(())
    }

    /// Closes every session (application shutdown).
    pub fn close_all(&self) {
        let all: Vec<_> = self.inner.sessions.lock().drain().map(|(_, e)| e).collect();
        for e in all {
            e.flow.close();
            e.backend.close();
        }
    }

    #[must_use]
    pub fn count(&self) -> usize {
        self.inner.sessions.lock().len()
    }
}
