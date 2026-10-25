//! The lines Tilde writes into SSH terminals itself, in the interface's language: they
//! are part of the terminal's output, so the front-end cannot translate them.

use std::sync::atomic::{AtomicBool, Ordering};

static ENGLISH: AtomicBool = AtomicBool::new(false);

/// Writes the terminal notices in English (`true`) or in French (the default).
pub fn set_english_notices(english: bool) {
    ENGLISH.store(english, Ordering::Relaxed);
}

fn english() -> bool {
    ENGLISH.load(Ordering::Relaxed)
}

/// The dim line shown once the shell is back after a reconnection.
pub(crate) fn reconnected() -> Vec<u8> {
    reconnected_in(english())
}

fn reconnected_in(english: bool) -> Vec<u8> {
    let word = if english { "reconnected" } else { "reconnecté" };
    format!("\r\n\x1b[2m── {word} ──\x1b[0m\r\n").into_bytes()
}

/// The dim line that replaces `bytes` of output dropped while the UI was behind.
pub(crate) fn skipped(bytes: usize) -> Vec<u8> {
    skipped_in(bytes, english())
}

fn skipped_in(bytes: usize, english: bool) -> Vec<u8> {
    let kib = bytes.div_ceil(1024);
    let text = if english {
        format!("{kib} KB of output skipped (display fell behind)")
    } else {
        format!("{kib} Kio de sortie ignorés (affichage en retard)")
    };
    format!("\r\n\x1b[0m\x1b[2m── {text} ──\x1b[0m\r\n").into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(bytes: Vec<u8>) -> String {
        String::from_utf8(bytes).unwrap()
    }

    #[test]
    fn reconnected_line_reads_right() {
        assert_eq!(text(reconnected_in(false)), "\r\n\x1b[2m── reconnecté ──\x1b[0m\r\n");
        assert_eq!(text(reconnected_in(true)), "\r\n\x1b[2m── reconnected ──\x1b[0m\r\n");
    }

    #[test]
    fn skipped_output_is_counted_in_kib() {
        assert!(text(skipped_in(1, false)).contains("── 1 Kio de sortie ignorés (affichage"));
        assert!(text(skipped_in(2049, true)).contains("── 3 KB of output skipped (display"));
    }
}
