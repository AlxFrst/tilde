use std::io;

/// The process side of a terminal session: a local PTY, an SSH shell…
///
/// Methods are synchronous and must not block: input is queued, `close` hands slow
/// teardown to a background thread.
pub trait Backend: Send + Sync {
    /// Queues keyboard input.
    ///
    /// # Errors
    ///
    /// The session's input is gone (process ended, connection lost).
    fn write(&self, data: &[u8]) -> io::Result<()>;

    /// Ignores zero sizes (a hidden or collapsed pane).
    ///
    /// # Errors
    ///
    /// The resize could not be applied.
    fn resize(&self, cols: u16, rows: u16) -> io::Result<()>;

    /// Whether closing should ask for confirmation.
    fn is_busy(&self) -> bool;

    /// Ends the session. The output feed then winds down; no `exited` is reported.
    fn close(&self);
}
