//! Starting Tilde on a folder or on a connection: `tilde --open <dir>`, which Explorer's
//! "Ouvrir dans Tilde" runs, and `tilde --connect <token>`, which a recent connection of the
//! taskbar's jump list runs. A first launch keeps them until the main window asks for them;
//! a later launch hands them to the last window used (single instance) as events. A later
//! launch naming neither opens a new window.

use std::path::{Path, PathBuf};

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tilde_config::ConnectionsFile;

use crate::state::AppState;

/// Sent to the main window with the folder to open a terminal in.
pub const OPEN_DIR_EVENT: &str = "launch://open-dir";
/// Sent to the last window used with the key (`conn:<id>`, `ssh:<target>`) of the recent
/// connection to open.
pub const OPEN_CONNECTION_EVENT: &str = "launch://open-connection";
/// The longest key put on a command line (bytes). Shell links keep their arguments short,
/// and no key Tilde records comes near this: a saved connection's is `conn:` and 16 digits.
pub const MAX_CONNECT_KEY: usize = 256;

/// The arguments that open the recent connection `key`: `--connect <token>`, the token being
/// the key's bytes in lowercase hex. A typed target or a label can hold spaces, quotes or
/// `%`: in hex, nothing a key says can end the argument early or add another one.
#[cfg_attr(not(windows), allow(dead_code))] // Only the Windows jump list writes them.
pub fn connect_arguments(key: &str) -> String {
    use std::fmt::Write;
    key.bytes().fold(String::from("--connect "), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    })
}

/// The key a `--connect` token stands for. `None` for anything [`connect_arguments`] does
/// not write: empty, odd length, not lowercase hex, too long, not UTF-8, not a `conn:` or
/// `ssh:` key.
fn key_from_token(token: &str) -> Option<String> {
    let digit = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        _ => None,
    };
    if token.is_empty() || !token.len().is_multiple_of(2) || token.len() > 2 * MAX_CONNECT_KEY {
        return None;
    }
    let bytes = token
        .as_bytes()
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&[high, low]| Some((digit(high)? << 4) | digit(low)?))
        .collect::<Option<Vec<u8>>>()?;
    let key = String::from_utf8(bytes).ok()?;
    (key.starts_with("conn:") || key.starts_with("ssh:")).then_some(key)
}

/// The key of the recent connection named by `--connect <token>` (or `--connect=<token>`)
/// in a command line whose first item is the program; still to be checked with
/// [`connect_allowed`]. `None` when there is none or its token is not one Tilde writes.
pub fn connect_from_args<S: AsRef<str>>(args: &[S]) -> Option<String> {
    let mut rest = args.iter().skip(1).map(AsRef::as_ref);
    while let Some(arg) = rest.next() {
        let token = if arg == "--connect" {
            rest.next()?
        } else if let Some(t) = arg.strip_prefix("--connect=") {
            t
        } else {
            // A folder is never read as an option, whatever its name.
            if arg == "--open" {
                rest.next();
            }
            continue;
        };
        return key_from_token(token);
    }
    None
}

/// Whether a key read from a command line may be opened: a saved connection that exists,
/// or a target the user typed that is still among the recents. A command line is anyone's
/// to write (a shortcut, a link): it must never make Tilde connect to a host the user has
/// not chosen.
pub fn connect_allowed(file: &ConnectionsFile, key: &str) -> bool {
    if let Some(id) = key.strip_prefix("conn:") {
        return file.connections.iter().any(|c| c.id == id);
    }
    key.starts_with("ssh:") && file.recents.iter().any(|r| r.key == key)
}

/// [`connect_allowed`] on the current connections, noting a refusal in the logs.
fn allowed_now(state: &AppState, key: &str) -> bool {
    let allowed = connect_allowed(state.connections.lock().file(), key);
    if !allowed {
        tracing::warn!(key, "--connect names no saved or recent connection: ignored");
    }
    allowed
}

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
        let dir = cwd.join(drive_root(value.trim_matches('"')).as_ref());
        return dir.is_dir().then_some(dir);
    }
    None
}

/// `C:` alone means "the current directory on C:"; Explorer means the drive's root (its
/// `"C:\"` reaches us as `C:"`, the backslash escaping the quote).
fn drive_root(value: &str) -> std::borrow::Cow<'_, str> {
    let bytes = value.as_bytes();
    if cfg!(windows) && bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        format!("{value}\\").into()
    } else {
        value.into()
    }
}

/// The folder Tilde was started on, kept until the front-end takes it.
#[derive(Default)]
pub struct LaunchDir(pub Mutex<Option<PathBuf>>);

/// The folder Tilde was started on, once (`None` afterwards), for the main window: the
/// windows reopened at startup beside it do not take it.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri hands command arguments over by value.
pub fn launch_take_dir(window: WebviewWindow, state: State<'_, AppState>) -> Option<String> {
    if window.label() != tilde_config::MAIN_WINDOW {
        return None;
    }
    state.launch_dir.0.lock().take().map(|d| d.display().to_string())
}

/// The recent connection Tilde was started on (`--connect`), kept until the front-end takes
/// it. Checked when taken, against the connections as they are then.
#[derive(Default)]
pub struct LaunchConnection(pub Mutex<Option<String>>);

/// The key of the recent connection Tilde was started on, once (`None` afterwards), for the
/// main window; `None` too when it may not be opened ([`connect_allowed`]).
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri hands command arguments over by value.
pub fn launch_take_connection(window: WebviewWindow, state: State<'_, AppState>) -> Option<String> {
    if window.label() != tilde_config::MAIN_WINDOW {
        return None;
    }
    let key = state.launch_connection.0.lock().take()?;
    allowed_now(&state, &key).then_some(key)
}

/// What a later launch does, Tilde running already.
#[derive(Debug, PartialEq, Eq)]
pub enum SecondLaunch {
    /// It names nothing to open: a new window.
    NewWindow,
    /// The last window used comes forward and opens what the launch names.
    Forward { dir: Option<PathBuf>, connection: Option<String> },
}

/// What a later launch with `args`, started in `cwd`, does. A `--connect` key that `allowed`
/// refuses (a jump list entry that has left the recents since) still brings Tilde forward:
/// the click is answered, without connecting anywhere.
pub fn second_launch<S: AsRef<str>>(
    args: &[S],
    cwd: &Path,
    allowed: impl FnOnce(&str) -> bool,
) -> SecondLaunch {
    let dir = dir_from_args(args, cwd);
    let key = connect_from_args(args);
    if dir.is_none() && key.is_none() {
        return SecondLaunch::NewWindow;
    }
    SecondLaunch::Forward { dir, connection: key.filter(|k| allowed(k)) }
}

/// Called by the single-instance plugin when Tilde is started again. With a folder or a
/// connection: the last window used comes forward and opens it. Without: a new window opens.
pub fn on_second_instance(app: &AppHandle, args: &[String], cwd: &str) {
    let allowed = |key: &str| allowed_now(&app.state::<AppState>(), key);
    let SecondLaunch::Forward { dir, connection } = second_launch(args, Path::new(cwd), allowed)
    else {
        crate::windows::open_new(app, None);
        return;
    };
    let Some(window) = crate::windows::launch_target(app) else { return };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    if let Some(dir) = dir {
        let _ = window.emit_to(window.label(), OPEN_DIR_EVENT, dir.display().to_string());
    }
    if let Some(key) = connection {
        let _ = window.emit_to(window.label(), OPEN_CONNECTION_EVENT, key);
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

    /// Explorer runs `--open "C:\"` on a drive: the `\"` reaches us as a quote, `C:"`.
    #[cfg(windows)]
    #[test]
    fn a_drive_root_opens_the_root_not_the_current_directory() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(
            dir_from_args(&["tilde", "--open", "C:\""], tmp.path()),
            Some(PathBuf::from("C:\\"))
        );
        assert_eq!(
            dir_from_args(&["tilde", "--open", "C:"], tmp.path()),
            Some(PathBuf::from("C:\\"))
        );
        assert_eq!(
            dir_from_args(&["tilde", "--open=C:\\"], tmp.path()),
            Some(PathBuf::from("C:\\"))
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

    /// The command line a jump list entry runs, split as Windows would split it.
    fn command_line(key: &str) -> Vec<String> {
        let mut args = vec!["tilde".to_string()];
        args.extend(connect_arguments(key).split(' ').map(String::from));
        args
    }

    #[test]
    fn a_connect_token_carries_any_key_and_nothing_but_hex_digits() {
        for key in [
            "conn:0123456789abcdef",
            "ssh:root@demo-server:2222",
            "ssh:demo-server \"--open\" C:\\ & calc %PATH% 'x'",
            "ssh:hôte.example.com",
        ] {
            let args = connect_arguments(key);
            let token = args.strip_prefix("--connect ").unwrap();
            assert!(token.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
            assert_eq!(command_line(key).len(), 3, "one argument, whatever the key holds");
            assert_eq!(connect_from_args(&command_line(key)).as_deref(), Some(key));
        }
    }

    #[test]
    fn a_token_tilde_does_not_write_is_refused() {
        let hex = |s: &str| connect_arguments(s).split_off("--connect ".len());
        let too_long = hex(&format!("ssh:{}", "a".repeat(MAX_CONNECT_KEY)));
        for token in [
            "",
            "abc",
            "zz",
            "636F6E6E3A6331",     // conn:c1, in capitals
            &hex("calc.exe"),     // not a recent's key
            &hex("connexion:c1"), // nor this one
            "ff00",               // not UTF-8
            "73 73683a",          // a space inside
            &too_long,
        ] {
            assert_eq!(connect_from_args(&["tilde", "--connect", token]), None, "{token}");
        }
    }

    #[test]
    fn connect_is_read_alone_beside_open_and_not_without_its_token() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().display().to_string();
        let token = connect_arguments("conn:c1").split_off("--connect ".len());
        let both = ["tilde", "--open", &dir, "--connect", &token];
        assert_eq!(connect_from_args(&both).as_deref(), Some("conn:c1"));
        assert_eq!(dir_from_args(&both, tmp.path()), Some(tmp.path().to_path_buf()));
        let reversed = ["tilde", "--connect", &token, "--open", &dir];
        assert_eq!(connect_from_args(&reversed).as_deref(), Some("conn:c1"));
        assert_eq!(dir_from_args(&reversed, tmp.path()), Some(tmp.path().to_path_buf()));
        let joined = format!("--connect={token}");
        assert_eq!(connect_from_args(&["tilde", &joined]).as_deref(), Some("conn:c1"));
        assert_eq!(connect_from_args(&["tilde"]), None);
        assert_eq!(connect_from_args(&["tilde", "--connect"]), None);
        // A folder named like the option is a folder.
        assert_eq!(connect_from_args(&["tilde", "--open", "--connect", &token]), None);
        // The program's own path is never read as a token.
        assert_eq!(connect_from_args(&[token.as_str()]), None);
    }

    fn connections() -> ConnectionsFile {
        let mut file = ConnectionsFile::default();
        file.connections.push(tilde_config::Connection {
            id: "c1".into(),
            name: "Prod".into(),
            host: "demo-server".into(),
            ..Default::default()
        });
        for key in ["ssh:root@demo-server", "conn:deleted"] {
            file.recents.push(tilde_config::Recent { key: key.into(), label: key.into(), at: 1 });
        }
        file
    }

    #[test]
    fn only_saved_connections_and_typed_recents_may_be_opened_from_a_command_line() {
        let file = connections();
        assert!(connect_allowed(&file, "conn:c1"), "saved, even if not among the recents");
        assert!(connect_allowed(&file, "ssh:root@demo-server"));
        assert!(!connect_allowed(&file, "ssh:root@example.com"), "never typed");
        assert!(!connect_allowed(&file, "conn:deleted"), "a recent whose connection is gone");
        assert!(!connect_allowed(&file, "conn:"));
        assert!(!connect_allowed(&file, "root@demo-server"));
    }

    #[test]
    fn a_later_launch_opens_a_window_or_hands_over_what_it_names() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().display().to_string();
        let file = connections();
        let allowed = |key: &str| connect_allowed(&file, key);
        let launch = |args: &[&str]| second_launch(args, tmp.path(), allowed);
        let token = |key: &str| connect_arguments(key).split_off("--connect ".len());
        let forward = |dir: Option<&Path>, connection: Option<&str>| SecondLaunch::Forward {
            dir: dir.map(Path::to_path_buf),
            connection: connection.map(String::from),
        };

        assert_eq!(launch(&["tilde"]), SecondLaunch::NewWindow);
        assert_eq!(launch(&["tilde", "--open", "missing"]), SecondLaunch::NewWindow);
        assert_eq!(launch(&["tilde", "--connect", "garbage"]), SecondLaunch::NewWindow);
        assert_eq!(launch(&["tilde", "--open", &dir]), forward(Some(tmp.path()), None));
        assert_eq!(
            launch(&["tilde", "--connect", &token("conn:c1")]),
            forward(None, Some("conn:c1"))
        );
        assert_eq!(
            launch(&["tilde", "--open", &dir, "--connect", &token("ssh:root@demo-server")]),
            forward(Some(tmp.path()), Some("ssh:root@demo-server"))
        );
        // Gone from the recents since the list was written: Tilde comes forward, no more.
        assert_eq!(
            launch(&["tilde", "--connect", &token("ssh:root@example.com")]),
            forward(None, None)
        );
    }
}
