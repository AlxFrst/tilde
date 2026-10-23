//! Terminal sessions: PTY processes and the output pump that feeds the UI.
//! No Tauri dependency.

mod busy;
mod coalescer;
mod error;
mod manager;
mod pty;
mod spec;

pub use coalescer::{Coalescer, FLUSH_BYTES, FLUSH_INTERVAL, HIGH_WATERMARK, LOW_WATERMARK};
pub use error::SessionError;
pub use manager::SessionManager;
pub use spec::{OutputSink, SessionId, SessionSpec};
