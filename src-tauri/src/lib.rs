//! Tilde desktop application: wires the core crates into Tauri.

mod commands;
mod logging;
mod prompter;
mod state;

use parking_lot::Mutex;
use std::sync::Arc;

use tauri::{Emitter, Manager};
use tauri_plugin_window_state::StateFlags;
use tilde_config::{
    ConfigErrorDto, ConfigFile, ConfigPaths, ConnectionsStore, SettingsStore, watch_config,
};
use tilde_session::SessionManager;

use crate::{
    commands::{connections::on_connections_file_changed, settings::on_settings_file_changed},
    prompter::{DISMISS_EVENT, Notice, PROMPT_EVENT, PROMPT_TIMEOUT, UiPrompter},
    state::AppState,
};

/// The front-end shows the (initially hidden) window once it has rendered. If it crashes
/// before that, the window would stay invisible forever — and single-instance would only
/// "focus" that ghost on relaunch — so Rust shows it anyway after a grace period.
fn show_window_if_frontend_stalls(app: tauri::AppHandle) {
    const GRACE: std::time::Duration = std::time::Duration::from_secs(5);
    std::thread::spawn(move || {
        std::thread::sleep(GRACE);
        if let Some(window) = app.get_webview_window("main")
            && !window.is_visible().unwrap_or(true)
        {
            tracing::warn!("front-end did not show the window in time; showing it as a fallback");
            let _ = window.show();
        }
    });
}

/// Wires what needs the app handle: SSH prompts, config hot reload, shell cache warm-up.
fn on_startup(app: &tauri::AppHandle, paths: &ConfigPaths) {
    let handle = app.clone();
    let prompter = UiPrompter::new(
        Box::new(move |notice| {
            let _ = match notice {
                Notice::Ask(event) => handle.emit(PROMPT_EVENT, event),
                Notice::Dismiss(id) => handle.emit(DISMISS_EVENT, id),
            };
        }),
        PROMPT_TIMEOUT,
    );
    let _ = app.state::<AppState>().ssh.prompter.set(Arc::new(prompter));
    let handle = app.clone();
    let concurrency =
        usize::from(app.state::<AppState>().settings.lock().settings().sftp.concurrency);
    let transfers = tilde_ssh::TransferQueue::new(
        concurrency,
        Arc::new(move |info| commands::sftp::emit_transfer(&handle, info)),
    );
    let _ = app.state::<AppState>().sftp.transfers.set(transfers);
    std::thread::spawn(tilde_ssh::clean_stale_edit_dirs);
    let handle = app.clone();
    let on_change = move |file| match file {
        ConfigFile::Settings => on_settings_file_changed(&handle),
        ConfigFile::Connections => on_connections_file_changed(&handle),
        ConfigFile::Themes => commands::themes::on_themes_changed(&handle),
        ConfigFile::Keybindings => {}
    };
    match watch_config(paths, on_change) {
        Ok(w) => *app.state::<AppState>().watcher.lock() = Some(w),
        Err(e) => tracing::error!(error = %e, "configuration hot reload disabled"),
    }
    // Warm the shell cache so the first new tab doesn't wait for `wsl.exe`.
    let handle = app.clone();
    std::thread::spawn(move || {
        commands::profiles::detected_shells(&handle.state::<AppState>());
    });
    show_window_if_frontend_stalls(app.clone());
}

/// Every command the front-end may invoke.
fn command_handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        commands::settings::settings_get,
        commands::settings::settings_update,
        commands::app::app_info,
        commands::app::open_logs_dir,
        commands::app::open_settings_file,
        commands::app::open_connections_file,
        commands::app::open_url,
        commands::profiles::profiles_list,
        commands::profiles::profiles_refresh,
        commands::session::session_open,
        commands::session::session_write,
        commands::session::session_resize,
        commands::session::session_ack,
        commands::session::session_close,
        commands::session::session_busy,
        commands::connections::connections_get,
        commands::connections::connections_upsert,
        commands::connections::connections_remove,
        commands::connections::connections_set_favorite,
        commands::connections::folders_upsert,
        commands::connections::folders_remove,
        commands::connections::connections_import,
        commands::connections::connections_export,
        commands::sftp::sftp_home,
        commands::sftp::sftp_list,
        commands::sftp::sftp_mkdir,
        commands::sftp::sftp_rename,
        commands::sftp::sftp_remove,
        commands::sftp::sftp_chmod,
        commands::sftp::sftp_download,
        commands::sftp::sftp_upload,
        commands::sftp::sftp_edit,
        commands::sftp::edit_resolve,
        commands::sftp::transfers_list,
        commands::sftp::transfer_cancel,
        commands::sftp::transfer_retry,
        commands::sftp::transfers_clear,
        commands::sftp::transfer_reveal,
        commands::ssh::ssh_hosts,
        commands::ssh::ssh_prompt_reply,
        commands::ssh::secrets_available,
        commands::ssh::ssh_forwards,
        commands::ssh::ssh_forward_add,
        commands::ssh::ssh_forward_remove,
        commands::themes::themes_list,
        commands::themes::themes_save,
        commands::themes::themes_delete,
        commands::themes::themes_import_pick,
        commands::themes::themes_export,
        commands::themes::open_themes_dir,
        commands::workspace::workspace_load,
        commands::workspace::workspace_save,
    ]
}

/// Starts the Tauri application.
///
/// # Panics
///
/// Panics if the Tauri runtime fails to start (e.g. the webview cannot be created).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log_dir = dirs::data_local_dir().map(|d| d.join("Tilde").join("logs"));
    let _log_guard = logging::init(log_dir.as_deref());
    tracing::info!(version = env!("CARGO_PKG_VERSION"), "starting Tilde");

    // Without an OS config dir (exotic systems only) we still start, keeping settings
    // in a temp folder rather than refusing to launch.
    let paths = ConfigPaths::from_os()
        .unwrap_or_else(|| ConfigPaths::new(std::env::temp_dir().join("Tilde")));
    let (store, load_error) = SettingsStore::load(paths.clone());
    if let Some(e) = &load_error {
        tracing::error!(error = %e, "settings.json could not be loaded; using defaults");
    }

    let (connections, connections_error) = ConnectionsStore::load(paths.clone());
    if let Some(e) = &connections_error {
        tracing::error!(error = %e, "connections.json cannot be used; it is left untouched");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        // Restore size/position, but let the front-end decide when to show the window.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            settings: Mutex::new(store),
            settings_error: Mutex::new(load_error.as_ref().map(ConfigErrorDto::from)),
            log_dir,
            watcher: Mutex::new(None),
            connections: Mutex::new(connections),
            connections_error: Mutex::new(connections_error.as_ref().map(ConfigErrorDto::from)),
            sessions: SessionManager::new(),
            shells: Mutex::new(None),
            ssh: state::SshState::default(),
            sftp: state::SftpState::default(),
        })
        .setup(move |app| {
            on_startup(app.handle(), &paths);
            Ok(())
        })
        .invoke_handler(command_handler())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<AppState>().sessions.close_all();
            }
        });
}
