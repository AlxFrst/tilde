//! Tilde's jump list, on Windows: what a right-click on its taskbar button offers. A task,
//! « Nouvelle fenêtre », and a « Récentes » category with the last connections opened, each
//! starting Tilde with `--connect` (see `launch.rs`). Labels follow the interface's language.
//!
//! The list is rebuilt at startup, when the connections or their recents change and when the
//! language does, by one thread of its own (the shell's objects want a single-threaded COM
//! apartment, which the main thread must not be turned into). An entry the user removed from
//! the list stays out of it, and leaves Tilde's recents: the shell only reports it until the
//! list is written again, and asks applications to forget it (it comes back once opened
//! again). A list that cannot be written is logged: it is a convenience.
//!
//! Elsewhere there is no such list: [`refresh`] and [`claim_app_id`] do nothing.
// The list's content is built on every system so that its tests run everywhere; only Windows
// writes it.
#![cfg_attr(not(windows), allow(dead_code))]

use tilde_config::ConnectionsFile;

use crate::launch::{MAX_CONNECT_KEY, connect_arguments};

/// At most this many recents are listed (fewer when the user's settings fit fewer).
const MAX_LISTED: usize = 6;
/// The task's and the category's labels, in the interface's language.
const NEW_WINDOW_FR: &str = "Nouvelle fenêtre";
const NEW_WINDOW_EN: &str = "New window";
const RECENT_FR: &str = "Récentes";
const RECENT_EN: &str = "Recent";
/// Tauri's installers give Tilde's shortcuts this `AppUserModelID` (the bundle identifier,
/// `tauri.conf.json`), and the NSIS uninstaller deletes the jump list filed under it.
const INSTALLED_APP_ID: &str = "dev.tilde.app";
/// A development build files its windows and its list apart, so that it never shows in, nor
/// rewrites the list of, the installed Tilde's taskbar button.
const DEV_APP_ID: &str = "dev.tilde.app.dev";
const APP_ID: &str = if cfg!(debug_assertions) { DEV_APP_ID } else { INSTALLED_APP_ID };

/// An entry of « Récentes ».
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Recent {
    /// The recent's key (`conn:<id>`, `ssh:<target>`).
    pub key: String,
    pub title: String,
    /// What it starts Tilde with: `--connect <token>`.
    pub arguments: String,
}

/// The recents that can be listed, most recent first: saved connections that still exist
/// (under their current name, as the palette shows them) and targets typed by hand.
fn candidates(file: &ConnectionsFile) -> Vec<Recent> {
    file.recents
        .iter()
        .filter(|r| r.key.len() <= MAX_CONNECT_KEY)
        .filter_map(|r| {
            let title = if let Some(id) = r.key.strip_prefix("conn:") {
                file.connections.iter().find(|c| c.id == id)?.name.clone()
            } else {
                let target = r.key.strip_prefix("ssh:")?;
                if r.label.trim().is_empty() { target.to_string() } else { r.label.clone() }
            };
            Some(Recent { key: r.key.clone(), title, arguments: connect_arguments(&r.key) })
        })
        .collect()
}

/// What « Récentes » shows: the first `limit` candidates, without those the user removed
/// from the list (`removed`: their arguments). One the user removed must not come back: the
/// shell would refuse the whole category.
fn listed(candidates: &[Recent], removed: &[String], limit: usize) -> Vec<Recent> {
    let mut out: Vec<Recent> = Vec::new();
    for c in candidates {
        if out.len() == limit {
            break;
        }
        let gone = removed.contains(&c.arguments);
        if !gone && !out.iter().any(|o| o.arguments == c.arguments) {
            out.push(c.clone());
        }
    }
    out
}

/// The keys of the recents the user removed from the list (`removed`: their arguments), for
/// Tilde to forget.
fn removed_keys(candidates: &[Recent], removed: &[String]) -> Vec<String> {
    candidates.iter().filter(|c| removed.contains(&c.arguments)).map(|c| c.key.clone()).collect()
}

#[cfg(windows)]
pub use win::{claim_app_id, refresh};

/// No jump list on this system.
#[cfg(not(windows))]
pub fn refresh(_app: &tauri::AppHandle) {}

/// No `AppUserModelID` on this system.
#[cfg(not(windows))]
pub fn claim_app_id() {}

#[cfg(windows)]
mod win {
    use std::{
        path::PathBuf,
        sync::{
            OnceLock,
            mpsc::{self, Receiver, Sender},
        },
        time::Duration,
    };

    use ::windows::{
        Win32::{
            Foundation::E_ACCESSDENIED,
            Storage::EnhancedStorage::PKEY_Title,
            System::{
                Com::{
                    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance,
                    CoInitializeEx, StructuredStorage::PROPVARIANT,
                },
                Variant::VT_LPWSTR,
            },
            UI::Shell::{
                Common::{IObjectArray, IObjectCollection},
                DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW,
                PropertiesSystem::IPropertyStore,
                SHStrDupW, SetCurrentProcessExplicitAppUserModelID, ShellLink,
            },
        },
        core::{HSTRING, Interface},
    };
    use tauri::{AppHandle, Manager};

    use super::{
        APP_ID, MAX_LISTED, NEW_WINDOW_EN, NEW_WINDOW_FR, RECENT_EN, RECENT_FR, Recent, candidates,
        listed, removed_keys,
    };
    use crate::state::AppState;

    /// Changes come in bursts (a session opening records a recent, then the window's
    /// language arrives…): the list is written once they have settled.
    const SETTLE: Duration = Duration::from_millis(300);
    /// The longest arguments read back from a removed entry (`INFOTIPSIZE`).
    const MAX_ARGUMENTS: usize = 1024;

    /// What the list holds, as last written.
    #[derive(PartialEq, Eq)]
    struct Content {
        exe: PathBuf,
        new_window: &'static str,
        recent: &'static str,
        recents: Vec<Recent>,
    }

    /// Makes `APP_ID` this process's `AppUserModelID`, as on the shortcuts the installers make:
    /// whether Tilde was started from one of them, from Explorer's menu, from its own jump
    /// list or after an update, its windows share one taskbar button, and that button shows
    /// this list. To be called before any window exists.
    pub fn claim_app_id() {
        // SAFETY: a plain call with a valid string, before any window or jump list exists.
        if let Err(e) = unsafe { SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(APP_ID)) } {
            tracing::warn!(error = %e, "could not set Tilde's AppUserModelID");
        }
    }

    /// Asks for the list to be written again, from the current connections and language.
    pub fn refresh(app: &AppHandle) {
        static WRITER: OnceLock<Sender<()>> = OnceLock::new();
        let _ = WRITER.get_or_init(|| start(app.clone())).send(());
    }

    /// Starts the thread that writes the list, one request after the other.
    fn start(app: AppHandle) -> Sender<()> {
        let (requests, received) = mpsc::channel();
        let thread = std::thread::Builder::new()
            .name("jump-list".into())
            .spawn(move || serve(&app, &received));
        if let Err(e) = thread {
            tracing::warn!(error = %e, "no thread for the jump list: it stays as it is");
        }
        requests
    }

    fn serve(app: &AppHandle, requests: &Receiver<()>) {
        // SAFETY: once, on this thread of ours, before any COM call on it.
        let init = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if let Err(e) = init.ok() {
            tracing::warn!(error = %e, "COM unavailable: the jump list stays as it is");
            return;
        }
        let mut written: Option<Content> = None;
        while requests.recv().is_ok() {
            while requests.recv_timeout(SETTLE).is_ok() {}
            let content = match content(app) {
                Ok(content) => content,
                Err(e) => {
                    tracing::warn!(error = %e, "jump list not updated: Tilde's path is unknown");
                    continue;
                }
            };
            // Unchanged (a favourite toggled, a folder renamed): what the user removed since
            // is gone from the list already.
            if written.as_ref() == Some(&content) {
                continue;
            }
            match write(&content) {
                Ok(removed) => {
                    forget(app, &removed_keys(&content.recents, &removed));
                    written = Some(content);
                }
                Err(e) => {
                    tracing::warn!(error = %e, "the taskbar's jump list could not be updated");
                }
            }
        }
    }

    /// Drops from the recents those the user removed from the list: once the list is written
    /// again, the shell no longer reports them, and the next list would bring them back. The
    /// change reaches the windows, and asks for this list again (without them).
    fn forget(app: &AppHandle, keys: &[String]) {
        if keys.is_empty() {
            return;
        }
        let forgotten = app.state::<AppState>().connections.lock().forget_recents(keys);
        if forgotten {
            crate::commands::connections::emit_changed(app);
        }
    }

    fn content(app: &AppHandle) -> std::io::Result<Content> {
        let state = app.state::<AppState>();
        let recents = candidates(state.connections.lock().file());
        Ok(Content {
            exe: std::env::current_exe()?,
            new_window: state.locale.pick(NEW_WINDOW_FR, NEW_WINDOW_EN),
            recent: state.locale.pick(RECENT_FR, RECENT_EN),
            recents,
        })
    }

    /// Replaces the list (once begun, it is either committed or aborted). Returns the
    /// arguments of the entries the user had removed from it.
    fn write(content: &Content) -> ::windows::core::Result<Vec<String>> {
        // SAFETY: COM calls on objects created here, on this thread (initialised by `serve`).
        unsafe {
            let list: ICustomDestinationList =
                CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)?;
            list.SetAppID(&HSTRING::from(APP_ID))?;
            let mut slots = 0u32;
            let removed = removed_arguments(&list.BeginList::<IObjectArray>(&raw mut slots)?);
            let fit = usize::try_from(slots).unwrap_or(usize::MAX).min(MAX_LISTED);
            let recents = listed(&content.recents, &removed, fit);
            let result = fill(&list, content, &recents).and_then(|()| list.CommitList());
            if result.is_err() {
                let _ = list.AbortList();
            }
            result.map(|()| removed)
        }
    }

    /// « Récentes » (when there are some), then the task.
    fn fill(
        list: &ICustomDestinationList,
        content: &Content,
        recents: &[Recent],
    ) -> ::windows::core::Result<()> {
        let exe = HSTRING::from(content.exe.as_path());
        // SAFETY: COM calls on a list begun on this thread, and on objects created here.
        unsafe {
            if !recents.is_empty() {
                let items: IObjectCollection =
                    CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
                for r in recents {
                    items.AddObject(&link(&exe, &r.title, &r.arguments)?)?;
                }
                let appended = list
                    .AppendCategory(&HSTRING::from(content.recent), &items.cast::<IObjectArray>()?);
                if let Err(e) = appended
                    && !category_refused(&e)
                {
                    return Err(e);
                }
            }
            // Starting Tilde again opens a new window (`launch::on_second_instance`); the
            // first start just starts it.
            let tasks: IObjectCollection =
                CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
            tasks.AddObject(&link(&exe, content.new_window, "")?)?;
            list.AddUserTasks(&tasks.cast::<IObjectArray>()?)
        }
    }

    /// Whether `AppendCategory` failed because Windows keeps no recent items (turned off in
    /// Settings › Personalisation › Start, or by a policy). The list then goes without the
    /// category, as Microsoft asks: « Nouvelle fenêtre » still belongs in it.
    fn category_refused(e: &::windows::core::Error) -> bool {
        e.code() == E_ACCESSDENIED
    }

    /// A shell link starting Tilde with `arguments`, shown as `title` with Tilde's icon.
    fn link(exe: &HSTRING, title: &str, arguments: &str) -> ::windows::core::Result<IShellLinkW> {
        let mut value = PROPVARIANT::default();
        // SAFETY: COM calls on a link created here, on this thread. The title is a property of
        // the link (never part of a command line), a string the PROPVARIANT owns: dropping it
        // frees the string with `CoTaskMemFree` (`PropVariantClear`), hence `SHStrDupW`.
        unsafe {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            link.SetPath(exe)?;
            link.SetArguments(&HSTRING::from(arguments))?;
            link.SetIconLocation(exe, 0)?;
            // Zeroed (`VT_EMPTY`), it owned nothing before.
            let string = &mut *value.Anonymous.Anonymous;
            string.Anonymous.pwszVal = SHStrDupW(&HSTRING::from(title))?;
            string.vt = VT_LPWSTR;
            let store: IPropertyStore = link.cast()?;
            store.SetValue(&PKEY_Title, &raw const value)?;
            store.Commit()?;
            Ok(link)
        }
    }

    /// The arguments of the entries the user removed from the list.
    fn removed_arguments(removed: &IObjectArray) -> Vec<String> {
        let mut out = Vec::new();
        // SAFETY: COM calls on the array `BeginList` returned, on this thread.
        unsafe {
            for i in 0..removed.GetCount().unwrap_or(0) {
                let Ok(link) = removed.GetAt::<IShellLinkW>(i) else { continue };
                let mut buffer = [0u16; MAX_ARGUMENTS];
                if link.GetArguments(&mut buffer).is_ok() {
                    let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
                    out.push(String::from_utf16_lossy(&buffer[..len]));
                }
            }
        }
        out
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::launch::connect_arguments;

        fn com() {
            // SAFETY: on this test's thread, before any other COM call on it.
            unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap() };
        }

        /// In memory only: nothing reaches the taskbar.
        #[test]
        fn an_entry_keeps_its_title_and_its_arguments_are_read_back() {
            com();
            let exe = HSTRING::from(std::env::current_exe().unwrap().as_path());
            let arguments = connect_arguments("ssh:root@demo-server");
            let entry = link(&exe, "demo-server « prod »", &arguments).unwrap();
            // SAFETY: COM calls on objects created on this thread.
            let (title, removed) = unsafe {
                let store: IPropertyStore = entry.cast().unwrap();
                let title = store.GetValue(&PKEY_Title).unwrap().to_string();
                let removed: IObjectCollection =
                    CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)
                        .unwrap();
                removed.AddObject(&entry).unwrap();
                (title, removed.cast::<IObjectArray>().unwrap())
            };
            assert_eq!(title, "demo-server « prod »");
            assert_eq!(removed_arguments(&removed), [arguments]);
        }

        #[test]
        fn recent_items_turned_off_leave_the_task_in_the_list() {
            assert!(category_refused(&::windows::core::Error::from(E_ACCESSDENIED)));
            let other = ::windows::Win32::Foundation::E_OUTOFMEMORY;
            assert!(!category_refused(&::windows::core::Error::from(other)));
        }

        /// Writes, then deletes, the list of development builds (never the installed Tilde's):
        /// the shell accepts what Tilde writes. Not run by `cargo test`, which must leave the
        /// taskbar alone: `cargo test -p tilde jump_list -- --ignored`.
        #[test]
        #[ignore = "writes the development build's jump list"]
        fn the_shell_accepts_the_list() {
            assert_eq!(APP_ID, super::super::DEV_APP_ID, "a debug build only");
            com();
            let content = Content {
                exe: std::env::current_exe().unwrap(),
                new_window: NEW_WINDOW_FR,
                recent: RECENT_FR,
                recents: vec![Recent {
                    key: "ssh:root@demo-server".into(),
                    title: "demo-server « prod »".into(),
                    arguments: connect_arguments("ssh:root@demo-server"),
                }],
            };
            let written = write(&content);
            // SAFETY: a COM call on this thread, initialised above.
            unsafe {
                let list: ICustomDestinationList =
                    CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER).unwrap();
                list.DeleteList(&HSTRING::from(APP_ID)).unwrap();
            }
            written.unwrap();
        }
    }
}

#[cfg(test)]
mod tests {
    use tilde_config::{Connection, Recent as Entry};

    use super::*;

    fn file(recents: &[(&str, &str)]) -> ConnectionsFile {
        let mut file = ConnectionsFile::default();
        for (id, name) in [("c1", "Prod"), ("c2", "Staging")] {
            file.connections.push(Connection {
                id: id.into(),
                name: name.into(),
                host: "demo-server".into(),
                ..Default::default()
            });
        }
        file.recents = recents
            .iter()
            .map(|(key, label)| Entry { key: (*key).into(), label: (*label).into(), at: 1 })
            .collect();
        file
    }

    fn titles(recents: &[Recent]) -> Vec<&str> {
        recents.iter().map(|r| r.title.as_str()).collect()
    }

    #[test]
    fn recents_are_listed_most_recent_first_under_the_names_tilde_shows() {
        let file = file(&[
            ("ssh:root@example.com", "root@example.com"),
            ("conn:c1", "Old name"),
            ("conn:gone", "Deleted"),
            ("other:x", "Unknown kind"),
            ("ssh:demo-server", ""),
            ("conn:c2", "Staging"),
        ]);
        let all = candidates(&file);
        assert_eq!(titles(&all), ["root@example.com", "Prod", "demo-server", "Staging"]);
        assert_eq!(all[1].arguments, connect_arguments("conn:c1"));
    }

    #[test]
    fn a_key_too_long_for_a_command_line_is_not_listed() {
        let long = format!("ssh:{}", "a".repeat(MAX_CONNECT_KEY));
        assert_eq!(candidates(&file(&[(long.as_str(), "long")])), Vec::<Recent>::new());
    }

    #[test]
    fn at_most_what_fits_is_listed_and_what_the_user_removed_stays_out() {
        let keys: Vec<String> = (0..9).map(|i| format!("ssh:host{i}.example.com")).collect();
        let recents: Vec<(&str, &str)> = keys.iter().map(|k| (k.as_str(), &k[4..])).collect();
        let all = candidates(&file(&recents));
        assert_eq!(all.len(), 9);

        let shown = listed(&all, &[], MAX_LISTED);
        assert_eq!(shown, all[..6]);
        assert_eq!(listed(&all, &[], 3), all[..3]);
        assert_eq!(listed(&all, &[], 0), Vec::<Recent>::new());

        // Removed ones leave room for the next.
        let removed = [all[0].arguments.clone(), all[4].arguments.clone()];
        let shown = listed(&all, &removed, MAX_LISTED);
        assert_eq!(
            titles(&shown),
            [
                "host1.example.com",
                "host2.example.com",
                "host3.example.com",
                "host5.example.com",
                "host6.example.com",
                "host7.example.com"
            ]
        );
        // …and leave the recents.
        let gone = [removed[0].clone(), removed[1].clone(), "--connect 00".into(), String::new()];
        assert_eq!(removed_keys(&all, &gone), ["ssh:host0.example.com", "ssh:host4.example.com"]);
        assert_eq!(removed_keys(&all, &[]), Vec::<String>::new());
    }

    #[test]
    fn an_entry_is_listed_once() {
        let all = candidates(&file(&[("conn:c1", "Prod"), ("conn:c1", "Prod")]));
        assert_eq!(titles(&listed(&all, &[], MAX_LISTED)), ["Prod"]);
    }

    /// The jump list must be filed under the `AppUserModelID` the installers give Tilde.
    #[test]
    fn the_installed_app_id_is_the_bundle_identifier() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], INSTALLED_APP_ID);
        assert_ne!(DEV_APP_ID, INSTALLED_APP_ID);
    }
}
