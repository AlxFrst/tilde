//! Tilde desktop application: wires the core crates into Tauri.

mod commands;
mod logging;
mod state;

use parking_lot::Mutex;
use tauri::Manager;
use tauri_plugin_window_state::StateFlags;
use tilde_config::{ConfigErrorDto, ConfigPaths, SettingsStore, watch_settings};
use tilde_session::SessionManager;

use crate::{commands::settings::on_settings_file_changed, state::AppState};

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
        .manage(AppState {
            settings: Mutex::new(store),
            settings_error: Mutex::new(load_error.as_ref().map(ConfigErrorDto::from)),
            log_dir,
            watcher: Mutex::new(None),
            sessions: SessionManager::new(),
            shells: Mutex::new(None),
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            match watch_settings(&paths, move || on_settings_file_changed(&handle)) {
                Ok(w) => *app.state::<AppState>().watcher.lock() = Some(w),
                Err(e) => tracing::error!(error = %e, "settings hot reload disabled"),
            }
            // Warm the shell cache so the first new tab doesn't wait for `wsl.exe`.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                commands::profiles::detected_shells(&handle.state::<AppState>());
            });
            show_window_if_frontend_stalls(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::settings_get,
            commands::settings::settings_update,
            commands::app::app_info,
            commands::app::open_logs_dir,
            commands::app::open_settings_file,
            commands::app::open_url,
            commands::profiles::profiles_list,
            commands::profiles::profiles_refresh,
            commands::session::session_open,
            commands::session::session_write,
            commands::session::session_resize,
            commands::session::session_ack,
            commands::session::session_close,
            commands::session::session_busy,
            commands::workspace::workspace_load,
            commands::workspace::workspace_save,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<AppState>().sessions.close_all();
            }
        });
}
