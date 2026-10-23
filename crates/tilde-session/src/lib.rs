//! Terminal sessions: backends (local PTY, SSH…) and the output pump that feeds the UI.
//! No Tauri dependency.

mod backend;
mod busy;
mod coalescer;
mod error;
mod manager;
mod pty;
mod pump;
mod spec;

pub use backend::Backend;
pub use coalescer::{Coalescer, FLUSH_BYTES, FLUSH_INTERVAL, HIGH_WATERMARK, LOW_WATERMARK};
pub use error::SessionError;
pub use manager::SessionManager;
pub use pump::{FlowState, OutputFeed};
pub use spec::{OutputSink, SessionId, SessionSpec};
