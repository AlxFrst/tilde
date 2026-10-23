//! The output pump shared by every backend: coalesces chunks into the sink and pauses
//! while too many bytes are unacknowledged.

use std::{
    sync::{
        Arc,
        mpsc::{self, RecvTimeoutError},
    },
    time::{Duration, Instant},
};

use parking_lot::{Condvar, Mutex};

use crate::{Coalescer, OutputSink};

/// How long the pump waits for the exit code once output has ended.
const EXIT_CODE_WAIT: Duration = Duration::from_secs(5);
const IDLE_WAIT: Duration = Duration::from_millis(250);
/// Quiet period after the process exited before the session is reported as ended.
const EXIT_GRACE: Duration = Duration::from_millis(200);

/// What a backend produces: output chunks, then (once) its exit code.
///
/// Dropping the `chunks` sender ends the output; `exit` carries `None` when the code is
/// unknown (signal, lost connection).
pub struct OutputFeed {
    pub chunks: mpsc::Receiver<Vec<u8>>,
    pub exit: mpsc::Receiver<Option<i32>>,
}

struct Inner {
    coalescer: Coalescer,
    /// Set by an explicit close: stop delivering anything, including `exited`.
    closed: bool,
}

struct Flow {
    state: Mutex<Inner>,
    cv: Condvar,
}

/// Shared flow-control state of one session. Backends that can throttle their source
/// (SSH, through the channel window) poll [`FlowState::is_paused`].
#[derive(Clone)]
pub struct FlowState(Arc<Flow>);

impl Default for FlowState {
    fn default() -> Self {
        Self(Arc::new(Flow {
            state: Mutex::new(Inner { coalescer: Coalescer::new(), closed: false }),
            cv: Condvar::new(),
        }))
    }
}

impl FlowState {
    /// True while the UI has too many unacknowledged bytes.
    #[must_use]
    pub fn is_paused(&self) -> bool {
        self.0.state.lock().coalescer.is_paused()
    }

    pub(crate) fn ack(&self, bytes: usize) {
        self.0.state.lock().coalescer.ack(bytes);
        self.0.cv.notify_all();
    }

    pub(crate) fn close(&self) {
        self.0.state.lock().closed = true;
        self.0.cv.notify_all();
    }

    /// Delivers `feed` into `sink` until it ends (then `exited`) or the session is closed.
    pub(crate) fn run(&self, feed: &OutputFeed, sink: &dyn OutputSink) {
        let flow = &self.0;
        // Set once the process has exited. A background job can keep a PTY open after
        // the shell is gone (`sleep 600 & exit` on Unix), so the output may never end:
        // once it has been quiet for EXIT_GRACE we finish anyway.
        let mut exited: Option<Option<i32>> = None;
        let mut last_data = Instant::now();
        loop {
            let deadline = {
                let mut st = flow.state.lock();
                while st.coalescer.is_paused() && !st.closed {
                    flow.cv.wait(&mut st);
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
            let received = feed.chunks.recv_timeout(timeout);
            if received.is_ok() {
                last_data = Instant::now();
            }
            if exited.is_none() {
                exited = feed.exit.try_recv().ok();
            }
            let quiet_after_exit = exited.is_some() && last_data.elapsed() >= EXIT_GRACE;
            let (out, done) = {
                let mut st = flow.state.lock();
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
            None => feed.exit.recv_timeout(EXIT_CODE_WAIT).ok().flatten(),
        };
        if !flow.state.lock().closed {
            tracing::info!(?code, "session exited");
            sink.exited(code);
        }
    }
}
