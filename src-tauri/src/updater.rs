//! Built-in updates from the GitHub releases (tauri-plugin-updater).
//!
//! Updates are signed with Tilde's updater key (minisign), independent of OS code
//! signing: an update whose signature does not match the public key in tauri.conf.json
//! is refused. Only Rust talks to the updater; the front-end has no permission for it.

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

pub const EVENT_PROGRESS: &str = "update://progress";

/// One install at a time.
static INSTALLING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
    /// RFC 3339.
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

fn message(e: &tauri_plugin_updater::Error) -> String {
    format!("mise à jour impossible : {e}")
}

/// The newer version published on GitHub, if there is one.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let update = app.updater().map_err(|e| message(&e))?.check().await.map_err(|e| message(&e))?;
    Ok(update.map(|u| UpdateInfo {
        version: u.version,
        notes: u.body,
        date: u.date.and_then(|d| d.format(&time::format_description::well_known::Rfc3339).ok()),
    }))
}

/// Downloads, verifies and installs the newer version, then restarts Tilde.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    if INSTALLING.swap(true, Ordering::AcqRel) {
        return Err("une mise à jour est déjà en cours".into());
    }
    let result = install(&app).await;
    INSTALLING.store(false, Ordering::Release);
    result?;
    tracing::info!("update installed, restarting");
    app.restart();
}

async fn install(app: &AppHandle) -> Result<(), String> {
    let Some(update) =
        app.updater().map_err(|e| message(&e))?.check().await.map_err(|e| message(&e))?
    else {
        return Err("Tilde est déjà à jour".into());
    };
    tracing::info!(version = %update.version, "installing update");
    let mut downloaded: u64 = 0;
    let handle = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = handle.emit(EVENT_PROGRESS, Progress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| message(&e))
}
