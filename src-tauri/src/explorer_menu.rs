//! "Ouvrir dans Tilde" in Windows Explorer's context menu, for the current user only
//! (`HKCU\Software\Classes`, no admin rights). Kept in step with `general.explorerMenu`,
//! with the interface's language ("Open in Tilde") and with where this `tilde.exe` lives;
//! the uninstallers remove it.
//!
//! On Windows 11 these entries sit under "Afficher plus d'options" (Maj+F10), like those of
//! every program that is not a packaged app.

use std::{io, path::Path};

use parking_lot::Mutex;
use winreg::{RegKey, enums::HKEY_CURRENT_USER};

use crate::locale::UiLocale;

/// The entry's label, in the interface's language.
const LABEL_FR: &str = "Ouvrir dans Tilde";
const LABEL_EN: &str = "Open in Tilde";
/// Startup, a settings change and a language change may apply at once: one at a time,
/// each reading the language when it writes, so the last label written is current.
static APPLYING: Mutex<()> = Mutex::new(());
/// A folder, the background of an open folder, a drive.
const PLACES: [&str; 3] =
    [r"Directory\shell\Tilde", r"Directory\Background\shell\Tilde", r"Drive\shell\Tilde"];

/// Adds (labelled `label`) or removes the entries for `exe`.
pub fn sync(enabled: bool, exe: &Path, label: &str) -> io::Result<()> {
    sync_under(r"Software\Classes", enabled, exe, label)
}

fn sync_under(classes: &str, enabled: bool, exe: &Path, label: &str) -> io::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for place in PLACES {
        let path = format!(r"{classes}\{place}");
        if enabled {
            let (key, _) = hkcu.create_subkey(&path)?;
            key.set_value("", &label)?;
            key.set_value("Icon", &format!("\"{}\",0", exe.display()))?;
            let (command, _) = key.create_subkey("command")?;
            command.set_value("", &format!("\"{}\" --open \"%V\"", exe.display()))?;
        } else {
            match hkcu.delete_subkey_all(&path) {
                Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e),
                _ => {}
            }
        }
    }
    Ok(())
}

/// Applies the setting, the label in the interface's language (also called when that
/// language changes); failures are logged (the menu entry is a convenience).
pub fn apply(enabled: bool, locale: &UiLocale) {
    // A development build must not take over the entry of the installed Tilde.
    if cfg!(debug_assertions) {
        return;
    }
    let _one_at_a_time = APPLYING.lock();
    let label = locale.pick(LABEL_FR, LABEL_EN);
    let result = std::env::current_exe().and_then(|exe| sync(enabled, &exe, label));
    if let Err(e) = result {
        tracing::warn!(error = %e, "could not update Explorer's \"Ouvrir dans Tilde\" entry");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway key, removed when dropped.
    struct Scratch(String);
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(&self.0);
        }
    }

    #[test]
    fn entries_are_added_for_this_exe_then_removed() {
        let root = Scratch(format!(r"Software\TildeTests\explorer-{}", std::process::id()));
        let exe = Path::new(r"C:\Program Files\Tilde\tilde.exe");
        sync_under(&root.0, true, exe, LABEL_FR).unwrap();
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        for place in PLACES {
            let key = hkcu.open_subkey(format!(r"{}\{place}", root.0)).unwrap();
            assert_eq!(key.get_value::<String, _>("").unwrap(), "Ouvrir dans Tilde");
            let command = key.open_subkey("command").unwrap();
            assert_eq!(
                command.get_value::<String, _>("").unwrap(),
                r#""C:\Program Files\Tilde\tilde.exe" --open "%V""#
            );
        }
        // Idempotent, relabelled in the other language, and removing twice is fine.
        sync_under(&root.0, true, exe, LABEL_FR).unwrap();
        sync_under(&root.0, true, exe, LABEL_EN).unwrap();
        for place in PLACES {
            let key = hkcu.open_subkey(format!(r"{}\{place}", root.0)).unwrap();
            assert_eq!(key.get_value::<String, _>("").unwrap(), "Open in Tilde");
        }
        sync_under(&root.0, false, exe, LABEL_EN).unwrap();
        sync_under(&root.0, false, exe, LABEL_EN).unwrap();
        for place in PLACES {
            assert!(hkcu.open_subkey(format!(r"{}\{place}", root.0)).is_err());
        }
    }
}
