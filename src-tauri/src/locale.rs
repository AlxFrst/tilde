//! The interface's language, for the little text Rust shows itself: native dialogs and
//! Explorer's context menu. Messages sent to the web view stay French; the front-end
//! translates them.

use std::sync::atomic::{AtomicBool, Ordering};

/// French until the front-end says otherwise (`app_set_locale`).
#[derive(Debug, Default)]
pub struct UiLocale {
    english: AtomicBool,
}

impl UiLocale {
    /// `en` is English; anything else is French. Returns whether the language changed.
    pub fn set(&self, locale: &str) -> bool {
        let english = locale == "en";
        self.english.swap(english, Ordering::AcqRel) != english
    }

    pub fn is_english(&self) -> bool {
        self.english.load(Ordering::Acquire)
    }

    /// `fr` or `en`, whichever the interface shows.
    pub fn pick(&self, fr: &'static str, en: &'static str) -> &'static str {
        if self.is_english() { en } else { fr }
    }
}

#[cfg(test)]
mod tests {
    use super::UiLocale;

    #[test]
    fn french_unless_english_is_asked_for() {
        let locale = UiLocale::default();
        assert_eq!(locale.pick("Ouvrir", "Open"), "Ouvrir");
        assert!(locale.set("en"));
        assert_eq!(locale.pick("Ouvrir", "Open"), "Open");
        assert!(!locale.set("en"), "unchanged");
        assert!(locale.set("de"), "an unknown language is French");
        assert!(!locale.is_english());
        assert!(!locale.set("fr"));
    }
}
