//! Quake mode: a global shortcut shows or hides a terminal window anchored to the top
//! of the screen. The window is created on first use and only hidden afterwards.

use parking_lot::Mutex;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use tilde_config::Quake;

pub const QUAKE_LABEL: &str = "quake";
pub const QUAKE_HEIGHT_RATIO: f64 = 0.4;
pub const EVENT_ERROR: &str = "quake://error";
pub const EVENT_SHUTDOWN: &str = "quake://shutdown";

/// What is currently applied, so a settings reload only re-registers on change.
#[derive(Default)]
pub struct QuakeState {
    applied: Option<Quake>,
    shortcut: Option<Shortcut>,
    /// Why the enabled shortcut is not registered; kept for the settings page, since a
    /// failure at startup happens before any page listens to `quake://error`.
    error: Option<String>,
}

/// Serialises toggles: two quick presses must not both create the window.
static TOGGLE: Mutex<()> = Mutex::new(());

/// Symbol keys: refused for a global shortcut, because the OS hotkey is registered by
/// virtual key, and those move with the keyboard layout (on AZERTY, `Backquote` is ù).
const SYMBOLS: &str = r"`-=[]\;',./";
const NAMED: &[&str] = &[
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Tab",
    "Enter",
    "Escape",
    "Space",
    "Backspace",
    "Delete",
    "Insert",
    "Home",
    "End",
    "PageUp",
    "PageDown",
];

fn key_code(key: &str) -> Option<String> {
    let mut chars = key.chars();
    if let (Some(c), None) = (chars.next(), chars.next()) {
        if c.is_ascii_alphabetic() {
            return Some(format!("Key{}", c.to_ascii_uppercase()));
        }
        if c.is_ascii_digit() {
            return Some(format!("Digit{c}"));
        }
    }
    if let Some(n) = key.strip_prefix(['F', 'f']).and_then(|n| n.parse::<u8>().ok())
        && (1..=24).contains(&n)
    {
        return Some(format!("F{n}"));
    }
    NAMED.iter().find(|n| n.eq_ignore_ascii_case(key)).map(|n| (*n).to_owned())
}

/// Tilde's shortcut syntax (``Ctrl+` ``, as in keybindings) to the global-hotkey syntax.
/// `Ctrl` means ⌘ on macOS, as everywhere in Tilde.
///
/// # Errors
///
/// A French message for an empty string, an unknown key or modifier, or a key without
/// modifier (function keys excepted).
pub fn to_accelerator(binding: &str) -> Result<String, String> {
    let mut parts: Vec<&str> = binding.trim().split('+').map(str::trim).collect();
    let key = parts.pop().filter(|k| !k.is_empty()).ok_or("raccourci vide")?;
    if key.chars().count() == 1 && SYMBOLS.contains(key) {
        return Err("choisissez une lettre, un chiffre ou une touche F : un symbole change de \
                    place selon la disposition du clavier"
            .into());
    }
    let code = key_code(key).ok_or_else(|| format!("touche inconnue : « {key} »"))?;
    let mut out = Vec::new();
    for m in parts {
        out.push(match m.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => "CommandOrControl",
            "alt" => "Alt",
            "shift" => "Shift",
            _ => return Err(format!("modificateur inconnu : « {m} »")),
        });
    }
    let has_modifier = out.iter().any(|m| *m != "Shift");
    if !has_modifier && !code.starts_with('F') {
        return Err("ajoutez Ctrl ou Alt : une touche seule casserait la saisie".into());
    }
    out.push(&code);
    let accelerator = out.join("+");
    accelerator
        .parse::<Shortcut>()
        .map_err(|e| format!("raccourci refusé par le système : {e}"))?;
    Ok(accelerator)
}

/// Full width of the monitor, 40 % of its height, anchored to its top.
#[must_use]
pub fn quake_geometry(monitor_pos: (i32, i32), monitor_size: (u32, u32)) -> (i32, i32, u32, u32) {
    let height = (f64::from(monitor_size.1) * QUAKE_HEIGHT_RATIO).round();
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)] // ≤ the monitor height
    let height = height as u32;
    (monitor_pos.0, monitor_pos.1, monitor_size.0, height)
}

/// Registers (or releases) the global shortcut to match the settings. Called at startup
/// and whenever the settings change; does nothing if `general.quake` did not change.
pub fn sync_quake(app: &AppHandle, quake: &Quake, state: &Mutex<QuakeState>) {
    let mut st = state.lock();
    if st.applied.as_ref() == Some(quake) {
        return;
    }
    st.applied = Some(quake.clone());
    st.error = None;
    let shortcuts = app.global_shortcut();
    if let Some(previous) = st.shortcut.take()
        && let Err(e) = shortcuts.unregister(previous)
    {
        tracing::warn!(error = %e, "previous Quake shortcut could not be released");
    }
    if !quake.enabled {
        // The page closes its tabs (ending their sessions), then destroys its window;
        // destroying it from here would leave those sessions running.
        if let Some(window) = app.get_webview_window(QUAKE_LABEL)
            && window.emit_to(QUAKE_LABEL, EVENT_SHUTDOWN, ()).is_err()
        {
            let _ = window.destroy();
        }
        return;
    }
    let registered = to_accelerator(&quake.shortcut).and_then(|acc| {
        let shortcut: Shortcut = acc.parse().map_err(|e| format!("{e}"))?;
        shortcuts.register(shortcut).map_err(|e| e.to_string())?;
        Ok(shortcut)
    });
    match registered {
        Ok(shortcut) => {
            tracing::info!(shortcut = %quake.shortcut, "Quake shortcut registered");
            st.shortcut = Some(shortcut);
        }
        Err(e) => {
            tracing::warn!(error = %e, shortcut = %quake.shortcut, "Quake shortcut unavailable");
            let message = format!("Raccourci Quake « {} » indisponible : {e}", quake.shortcut);
            st.error = Some(message.clone());
            let _ = app.emit(EVENT_ERROR, message);
        }
    }
}

fn create_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, QUAKE_LABEL, WebviewUrl::App("index.html".into()))
        .title("Tilde")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .transparent(true)
        .resizable(false)
        .visible(false)
        .build()
}

/// Puts the window at the top of the monitor under the mouse (else the primary one).
fn place(app: &AppHandle, window: &WebviewWindow) {
    let cursor = app.cursor_position().ok();
    let monitors = app.available_monitors().unwrap_or_default();
    let under_cursor = cursor.and_then(|c| {
        monitors.into_iter().find(|m| {
            let (p, s) = (m.position(), m.size());
            c.x >= f64::from(p.x)
                && c.y >= f64::from(p.y)
                && c.x < f64::from(p.x) + f64::from(s.width)
                && c.y < f64::from(p.y) + f64::from(s.height)
        })
    });
    let Some(monitor) = under_cursor.or_else(|| app.primary_monitor().ok().flatten()) else {
        return;
    };
    let (pos, size) = (monitor.position(), monitor.size());
    let (x, y, width, height) = quake_geometry((pos.x, pos.y), (size.width, size.height));
    let _ = window.set_size(PhysicalSize::new(width, height));
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

/// Why the Quake shortcut is not active although enabled, if it is not.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri hands command arguments over by value.
pub fn quake_status(state: tauri::State<'_, crate::state::AppState>) -> Option<String> {
    state.quake.lock().error.clone()
}

/// The global shortcut: hides the focused Quake window, otherwise shows and focuses it.
///
/// Runs on its own thread: the shortcut handler is called on the main thread, where
/// building a webview window deadlocks on Windows (see `WebviewWindowBuilder::new`).
pub fn toggle_quake(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let _serial = TOGGLE.lock();
        toggle(&app);
    });
}

fn toggle(app: &AppHandle) {
    let window = match app.get_webview_window(QUAKE_LABEL) {
        Some(w) => w,
        None => match create_window(app) {
            Ok(w) => w,
            Err(e) => {
                tracing::error!(error = %e, "Quake window could not be created");
                return;
            }
        },
    };
    let visible = window.is_visible().unwrap_or(false);
    if visible && window.is_focused().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    if !visible {
        place(app, &window);
        let _ = window.show();
    }
    let _ = window.set_focus();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_accelerator_maps_tilde_syntax() {
        assert_eq!(to_accelerator("Alt+F12").unwrap(), "Alt+F12");
        assert_eq!(to_accelerator("Alt+Shift+F12").unwrap(), "Alt+Shift+F12");
        assert_eq!(to_accelerator("Ctrl+1").unwrap(), "CommandOrControl+Digit1");
        assert_eq!(to_accelerator("ctrl+alt+t").unwrap(), "CommandOrControl+Alt+KeyT");
        assert_eq!(to_accelerator("Alt+Space").unwrap(), "Alt+Space");
        assert_eq!(to_accelerator("F11").unwrap(), "F11");
    }

    #[test]
    fn invalid_shortcut_is_an_error() {
        // Symbol keys move with the keyboard layout: on AZERTY, global-hotkey's Backquote
        // is the ù key. Global shortcuts take letters, digits, F-keys and named keys only.
        for bad in
            ["", "Ctrl+", "Ctrl+Truc", "`", "Shift+A", "Hyper+A", "Ctrl+F25", "Ctrl+`", "Alt+-"]
        {
            assert!(to_accelerator(bad).is_err(), "{bad:?} accepted");
        }
    }

    #[test]
    fn quake_geometry_spans_the_top_of_the_monitor() {
        assert_eq!(quake_geometry((-1920, 0), (1920, 1080)), (-1920, 0, 1920, 432));
        assert_eq!(quake_geometry((0, 0), (2560, 1440)), (0, 0, 2560, 576));
    }
}
