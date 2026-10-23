//! Starting Tilde on a folder: `tilde --open <dir>`, which Explorer's "Ouvrir dans Tilde"
//! runs. A first launch keeps the folder until the front-end asks for it; a second launch
//! hands it to the running window (single instance) as an event.

use std::path::{Path, PathBuf};

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::state::AppState;

/// Sent to the main window with the folder to open a terminal in.
pub const OPEN_DIR_EVENT: &str = "launch://open-dir";

/// The folder named by `--open <dir>` (or `--open=<dir>`) in a command line whose first
/// item is the program, resolved against `cwd` when relative. `None` when there is none or
/// it is not an existing directory.
pub fn dir_from_args<S: AsRef<str>>(args: &[S], cwd: &Path) -> Option<PathBuf> {
    let mut rest = args.iter().skip(1).map(AsRef::as_ref);
    while let Some(arg) = rest.next() {
        let value = if arg == "--open" {
            rest.next()?
        } else if let Some(v) = arg.strip_prefix("--open=") {
            v
        } else {
            continue;
        };
        let dir = cwd.join(value.trim_matches('"'));
        return dir.is_dir().then_some(dir);
    }
    None
}

/// The folder Tilde was started on, kept until the front-end takes it.
#[derive(Default)]
pub struct LaunchDir(pub Mutex<Option<PathBuf>>);

/// The folder Tilde was started on, once (`None` afterwards).
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri hands command arguments over by value.
pub fn launch_take_dir(state: State<'_, AppState>) -> Option<String> {
    state.launch_dir.0.lock().take().map(|d| d.display().to_string())
}

/// Called by the single-instance plugin when Tilde is started again: shows the window
/// and, if that launch named a folder, asks it to open a terminal there.
pub fn on_second_instance(app: &AppHandle, args: &[String], cwd: &str) {
    let Some(window) = app.get_webview_window("main") else { return };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    if let Some(dir) = dir_from_args(args, Path::new(cwd)) {
        let _ = window.emit(OPEN_DIR_EVENT, dir.display().to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_names_an_existing_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().display().to_string();
        assert_eq!(
            dir_from_args(&["tilde", "--open", &dir], Path::new("C:\\")),
            Some(tmp.path().to_path_buf())
        );
        assert_eq!(
            dir_from_args(&["tilde".to_string(), format!("--open=\"{dir}\"")], Path::new("/")),
            Some(tmp.path().to_path_buf())
        );
    }

    #[test]
    fn a_relative_folder_is_taken_from_the_launch_directory() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("projet")).unwrap();
        assert_eq!(
            dir_from_args(&["tilde", "--open", "projet"], tmp.path()),
            Some(tmp.path().join("projet"))
        );
    }

    #[test]
    fn nothing_to_open_without_an_existing_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("notes.txt");
        std::fs::write(&file, "x").unwrap();
        let cwd = tmp.path();
        assert_eq!(dir_from_args(&["tilde"], cwd), None);
        assert_eq!(dir_from_args(&["tilde", "--open"], cwd), None);
        assert_eq!(dir_from_args(&["tilde", "--open", "missing"], cwd), None);
        assert_eq!(dir_from_args(&["tilde", "--open", file.to_str().unwrap()], cwd), None);
        // The program's own path is never taken for a folder.
        assert_eq!(dir_from_args(&[cwd.to_str().unwrap()], cwd), None);
    }
}
