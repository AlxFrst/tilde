//! Terminal sessions: PTY processes and the output pump that feeds the UI.
//! No Tauri dependency.

mod coalescer;

pub use coalescer::{Coalescer, FLUSH_BYTES, FLUSH_INTERVAL, HIGH_WATERMARK, LOW_WATERMARK};
