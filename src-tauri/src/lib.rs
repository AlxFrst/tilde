//! Tilde desktop application: wires the core crates into Tauri.

/// Starts the Tauri application.
///
/// # Panics
///
/// Panics if the Tauri runtime fails to start (e.g. the webview cannot be created).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
