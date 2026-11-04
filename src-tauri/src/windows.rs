//! Tilde's windows. The first one (`main`) opens at startup; *Nouvelle fenêtre*
//! (`Ctrl+Shift+N`) and starting Tilde again open others (`window-2`, `window-3`…). Each has
//! its own sessions and workspace, and Tilde reopens at startup the windows that were open
//! when it was quit. Closing a window while others stay open ends its sessions and forgets
//! its workspace; closing the last one quits Tilde. The Quake console is apart from them.

use std::collections::{HashMap, HashSet};

use parking_lot::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tilde_config::{MAIN_WINDOW, remove_workspace, saved_windows, window_label, window_number};

use crate::state::AppState;

/// Where a new window opens, from the window it opens beside.
const CASCADE: f64 = 32.0;

/// What Rust keeps about the open windows.
#[derive(Default)]
pub struct Windows {
    /// The window each session was opened from: closing a window ends its sessions.
    owners: Mutex<HashMap<u32, String>>,
    /// Windows the user is closing (confirmed in the window), to forget once they are gone.
    closing: Mutex<HashSet<String>>,
    /// Windows closed for good: a save that arrives late must not bring them back.
    forgotten: Mutex<HashSet<String>>,
    /// The last Tilde window to have had the focus.
    last_focused: Mutex<Option<String>>,
}

impl Windows {
    pub fn session_opened(&self, id: u32, label: &str) {
        self.owners.lock().insert(id, label.to_string());
    }

    pub fn session_closed(&self, id: u32) {
        self.owners.lock().remove(&id);
    }

    /// The sessions opened from window `label`, which no longer belong to it.
    pub fn take_sessions(&self, label: &str) -> Vec<u32> {
        let mut owners = self.owners.lock();
        let ids: Vec<u32> = owners.iter().filter(|(_, l)| *l == label).map(|(id, _)| *id).collect();
        for id in &ids {
            owners.remove(id);
        }
        ids
    }

    /// A window (perhaps under a closed one's label) opens: it is a window like any other.
    pub fn opening(&self, label: &str) {
        self.closing.lock().remove(label);
        self.forgotten.lock().remove(label);
    }

    /// The user confirmed closing window `label` (not Tilde quitting, nor the OS ending it).
    pub fn closing(&self, label: &str) {
        self.closing.lock().insert(label.to_string());
    }

    /// Window `label` is gone. `true` when it was closed by the user while `others_open`:
    /// its workspace is then to be forgotten, and later saves from it ignored.
    pub fn gone(&self, label: &str, others_open: bool) -> bool {
        let closed_by_user = self.closing.lock().remove(label);
        if self.last_focused.lock().as_deref() == Some(label) {
            *self.last_focused.lock() = None;
        }
        let forget = closed_by_user && others_open;
        if forget {
            self.forgotten.lock().insert(label.to_string());
        }
        forget
    }

    pub fn is_forgotten(&self, label: &str) -> bool {
        self.forgotten.lock().contains(label)
    }

    pub fn focused(&self, label: &str) {
        if window_number(label).is_some() {
            *self.last_focused.lock() = Some(label.to_string());
        }
    }

    pub fn last_focused(&self) -> Option<String> {
        self.last_focused.lock().clone()
    }
}

/// The first free Tilde window label among `open` ones: `main`, then `window-2`…
pub fn free_label<'a>(open: impl IntoIterator<Item = &'a str>) -> String {
    let used: HashSet<u32> = open.into_iter().filter_map(window_number).collect();
    // `used.len()` windows take at most that many numbers: one of the next is free.
    let last = u32::try_from(used.len()).unwrap_or(u32::MAX - 1) + 1;
    window_label((1..=last).find(|n| !used.contains(n)).unwrap_or(last))
}

/// Whether a Tilde window other than `label` is open (the Quake console does not count).
fn others_open(app: &AppHandle, label: &str) -> bool {
    app.webview_windows().keys().any(|l| l != label && window_number(l).is_some())
}

/// The Tilde window a folder from Explorer opens in: the last one used.
pub fn launch_target(app: &AppHandle) -> Option<WebviewWindow> {
    let windows = app.webview_windows();
    app.state::<AppState>()
        .windows
        .last_focused()
        .and_then(|l| windows.get(&l).cloned())
        .or_else(|| windows.get(MAIN_WINDOW).cloned())
        .or_else(|| windows.into_iter().find(|(l, _)| window_number(l).is_some()).map(|(_, w)| w))
}

/// Opens Tilde window `label`, hidden: its page shows it once rendered. Beside `near` (same
/// size, a little lower right) if given; a window reopened at startup gets its place back
/// from the window-state plugin.
pub fn create(
    app: &AppHandle,
    label: &str,
    near: Option<&WebviewWindow>,
) -> tauri::Result<WebviewWindow> {
    app.state::<AppState>().windows.opening(label);
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("Tilde")
        .inner_size(1200.0, 760.0)
        .min_inner_size(720.0, 480.0)
        .decorations(false)
        .transparent(true)
        .visible(false);
    let builder = match near.and_then(beside) {
        Some((x, y, width, height)) => builder.position(x, y).inner_size(width, height),
        None => builder.center(),
    };
    let window = builder.build()?;
    crate::autofill::disable(&window);
    crate::show_if_page_stalls(app.clone(), label.to_string());
    Ok(window)
}

/// Position and size (logical) of a window opened beside `w`; `None` when `w` fills the
/// screen (the new one is then centred).
fn beside(w: &WebviewWindow) -> Option<(f64, f64, f64, f64)> {
    if w.is_maximized().unwrap_or(false) || w.is_fullscreen().unwrap_or(false) {
        return None;
    }
    let scale = w.scale_factor().ok()?;
    let pos = w.outer_position().ok()?.to_logical::<f64>(scale);
    let size = w.inner_size().ok()?.to_logical::<f64>(scale);
    Some((pos.x + CASCADE, pos.y + CASCADE, size.width, size.height))
}

/// Opens a new Tilde window beside the last one used.
///
/// On its own thread: building a webview window from the main thread (where the
/// single-instance callback runs) deadlocks on Windows (see `WebviewWindowBuilder::new`).
pub fn open_new(app: &AppHandle) {
    static OPENING: Mutex<()> = Mutex::new(());
    let app = app.clone();
    std::thread::spawn(move || {
        let _serial = OPENING.lock();
        let label = free_label(app.webview_windows().keys().map(String::as_str));
        let near = launch_target(&app);
        if let Err(e) = create(&app, &label, near.as_ref()) {
            tracing::error!(error = %e, label, "new window could not be created");
        }
    });
}

/// Reopens the windows (other than `main`) that were open when Tilde was quit.
pub fn reopen_saved(app: &AppHandle) {
    let paths = app.state::<AppState>().settings.lock().paths().clone();
    for label in saved_windows(&paths) {
        if let Err(e) = create(app, &label, None) {
            tracing::error!(error = %e, label, "saved window could not be reopened");
        }
    }
}

/// A window is gone: its sessions end. A Tilde window the user closed while others stay open
/// is forgotten; the last one quits Tilde (the Quake console does not count).
pub fn on_destroyed(app: &AppHandle, label: &str) {
    let state = app.state::<AppState>();
    for id in state.windows.take_sessions(label) {
        crate::commands::session::end_session(app, &state, id);
    }
    if window_number(label).is_none() {
        return;
    }
    let others = others_open(app, label);
    if state.windows.gone(label, others) {
        let paths = state.settings.lock().paths().clone();
        if let Err(e) = remove_workspace(&paths, label) {
            tracing::warn!(error = %e, label, "closed window's workspace could not be removed");
        }
    }
    if !others {
        app.exit(0);
    }
}

/// *Nouvelle fenêtre*.
#[tauri::command]
pub async fn window_new(app: AppHandle) {
    open_new(&app);
}

/// The window's page confirmed that the user closes it (nothing left running, or they
/// agreed): once it is gone, its workspace is forgotten unless it was the last window.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri hands command arguments over by value.
pub fn window_closing(window: WebviewWindow, state: tauri::State<'_, AppState>) {
    state.windows.closing(window.label());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_window_takes_the_first_free_label() {
        assert_eq!(free_label([]), "main");
        assert_eq!(free_label(["main"]), "window-2");
        assert_eq!(free_label(["main", "quake", "window-2"]), "window-3");
        assert_eq!(free_label(["main", "window-3"]), "window-2");
        assert_eq!(free_label(["window-2", "quake"]), "main");
    }

    #[test]
    fn closing_a_window_ends_only_its_sessions() {
        let w = Windows::default();
        w.session_opened(1, "main");
        w.session_opened(2, "window-2");
        w.session_opened(3, "window-2");
        w.session_closed(3);
        assert_eq!(w.take_sessions("window-2"), [2]);
        assert_eq!(w.take_sessions("window-2"), Vec::<u32>::new());
        assert_eq!(w.take_sessions("main"), [1]);
    }

    #[test]
    fn a_window_the_user_closes_while_others_stay_open_is_forgotten() {
        let w = Windows::default();
        w.closing("window-2");
        assert!(w.gone("window-2", true));
        assert!(w.is_forgotten("window-2"));
        // Reopened later under the same label, it saves again.
        w.opening("window-2");
        assert!(!w.is_forgotten("window-2"));
    }

    #[test]
    fn the_last_window_closed_is_kept_for_next_time() {
        let w = Windows::default();
        w.closing("main");
        assert!(!w.gone("main", false));
        assert!(!w.is_forgotten("main"));
    }

    #[test]
    fn a_window_gone_without_being_closed_is_kept() {
        // Tilde quitting (an update), the OS ending the session: every window comes back.
        let w = Windows::default();
        assert!(!w.gone("window-2", true));
        assert!(!w.is_forgotten("window-2"));
    }

    #[test]
    fn a_label_taken_again_starts_clean() {
        let w = Windows::default();
        w.closing("window-2");
        w.opening("window-2");
        assert!(!w.gone("window-2", true));
    }

    #[test]
    fn the_last_focused_window_is_a_tilde_window_still_open() {
        let w = Windows::default();
        w.focused("window-2");
        w.focused("quake");
        assert_eq!(w.last_focused().as_deref(), Some("window-2"));
        w.gone("window-2", true);
        assert_eq!(w.last_focused(), None);
    }
}
