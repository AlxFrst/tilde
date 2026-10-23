//! Batches PTY output into IPC-sized chunks and tracks unacknowledged bytes.

use std::time::{Duration, Instant};

pub const FLUSH_INTERVAL: Duration = Duration::from_millis(4);
pub const FLUSH_BYTES: usize = 65_536;
pub const HIGH_WATERMARK: usize = 1_048_576;
pub const LOW_WATERMARK: usize = 262_144;

/// Pure state machine (no threads, no clock): the caller passes `now`, which keeps it
/// deterministic to test. Every byte handed out counts as unacknowledged until `ack`.
#[derive(Debug, Default)]
pub struct Coalescer {
    buf: Vec<u8>,
    first_pending: Option<Instant>,
    unacked: usize,
    paused: bool,
}

impl Coalescer {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Buffers `data`; returns the whole buffer once it reaches [`FLUSH_BYTES`].
    pub fn push(&mut self, data: &[u8], now: Instant) -> Option<Vec<u8>> {
        if data.is_empty() {
            return None;
        }
        self.first_pending.get_or_insert(now);
        self.buf.extend_from_slice(data);
        if self.buf.len() >= FLUSH_BYTES { self.flush() } else { None }
    }

    /// Returns the buffer once its oldest byte has waited [`FLUSH_INTERVAL`].
    pub fn poll(&mut self, now: Instant) -> Option<Vec<u8>> {
        match self.next_deadline() {
            Some(deadline) if now >= deadline => self.flush(),
            _ => None,
        }
    }

    /// Returns whatever is buffered, regardless of timing (end of stream).
    pub fn flush(&mut self) -> Option<Vec<u8>> {
        if self.buf.is_empty() {
            return None;
        }
        self.first_pending = None;
        let chunk = std::mem::take(&mut self.buf);
        self.unacked += chunk.len();
        if self.unacked >= HIGH_WATERMARK {
            self.paused = true;
        }
        Some(chunk)
    }

    #[must_use]
    pub fn next_deadline(&self) -> Option<Instant> {
        self.first_pending.map(|t| t + FLUSH_INTERVAL)
    }

    /// Records that the UI has processed `bytes`; may lift a pause (with hysteresis).
    pub fn ack(&mut self, bytes: usize) {
        self.unacked = self.unacked.saturating_sub(bytes);
        if self.unacked < LOW_WATERMARK {
            self.paused = false;
        }
    }

    /// True once [`HIGH_WATERMARK`] bytes are unacknowledged, until they drop below
    /// [`LOW_WATERMARK`]. While paused the pump stops reading the PTY.
    #[must_use]
    pub fn is_paused(&self) -> bool {
        self.paused
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MS: Duration = Duration::from_millis(1);

    #[test]
    fn small_writes_wait_for_interval() {
        let t0 = Instant::now();
        let mut c = Coalescer::new();
        assert_eq!(c.push(b"ab", t0), None);
        assert_eq!(c.poll(t0 + 3 * MS), None);
        assert_eq!(c.poll(t0 + 4 * MS).as_deref(), Some(&b"ab"[..]));
    }

    #[test]
    fn large_write_flushes_immediately() {
        let mut c = Coalescer::new();
        assert_eq!(c.push(&vec![0; 70_000], Instant::now()).map(|v| v.len()), Some(70_000));
    }

    #[test]
    fn writes_are_merged_in_order() {
        let t0 = Instant::now();
        let mut c = Coalescer::new();
        for part in [&b"a"[..], b"b", b"c"] {
            assert_eq!(c.push(part, t0), None);
        }
        assert_eq!(c.poll(t0 + 4 * MS).as_deref(), Some(&b"abc"[..]));
    }

    #[test]
    fn pauses_above_high_watermark_and_resumes_below_low() {
        let mut c = Coalescer::new();
        let t0 = Instant::now();
        for _ in 0..16 {
            assert!(c.push(&vec![1; FLUSH_BYTES], t0).is_some());
        }
        assert!(c.is_paused());
        c.ack(700_000);
        assert!(c.is_paused(), "348 576 bytes still unacked is above LOW_WATERMARK");
        c.ack(100_000);
        assert!(!c.is_paused());
    }

    #[test]
    fn ack_saturates_at_zero() {
        let mut c = Coalescer::new();
        c.ack(10);
        assert!(!c.is_paused());
    }

    #[test]
    fn next_deadline_tracks_first_pending_byte() {
        let t0 = Instant::now();
        let mut c = Coalescer::new();
        assert_eq!(c.next_deadline(), None);
        c.push(b"x", t0);
        c.push(b"y", t0 + 2 * MS);
        assert_eq!(c.next_deadline(), Some(t0 + 4 * MS));
        c.flush();
        assert_eq!(c.next_deadline(), None);
    }
}
