//! User themes (`themes/*.json`): list, save, delete, import a file, export, hot reload.
//!
//! Every change is answered with the full [`ThemesSnapshot`] on `themes://changed`.

use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tilde_config::{
    ConfigErrorDto, ConfigPaths, ThemeFileError, UserTheme, delete_user_theme, is_valid_theme_id,
    list_user_themes, save_user_theme,
};

use crate::state::AppState;

pub const EVENT_CHANGED: &str = "themes://changed";
/// Color scheme files are a few KiB; the front-end refuses the same size.
const MAX_IMPORT_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemesSnapshot {
    pub themes: Vec<UserTheme>,
    pub errors: Vec<ThemeFileError>,
}

/// A file picked for import, handed to the front-end parsers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFile {
    pub name: String,
    pub text: String,
}

fn paths(state: &AppState) -> ConfigPaths {
    state.settings.lock().paths().clone()
}

fn snapshot(state: &AppState) -> ThemesSnapshot {
    let (themes, errors) = list_user_themes(&paths(state));
    ThemesSnapshot { themes, errors }
}

fn emit_changed(app: &AppHandle) {
    let _ = app.emit(EVENT_CHANGED, snapshot(&app.state::<AppState>()));
}

#[tauri::command]
pub fn themes_list(state: State<'_, AppState>) -> ThemesSnapshot {
    snapshot(&state)
}

#[tauri::command]
pub fn themes_save(
    app: AppHandle,
    id: String,
    data: serde_json::Value,
) -> Result<(), ConfigErrorDto> {
    save_user_theme(&paths(&app.state::<AppState>()), &id, &data)
        .map_err(|e| ConfigErrorDto::from(&e))?;
    emit_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn themes_delete(app: AppHandle, id: String) -> Result<(), ConfigErrorDto> {
    delete_user_theme(&paths(&app.state::<AppState>()), &id)
        .map_err(|e| ConfigErrorDto::from(&e))?;
    emit_changed(&app);
    Ok(())
}

/// Reads a picked file: at most 1 MiB of UTF-8.
pub(crate) fn read_import(path: &Path) -> Result<PickedFile, String> {
    let len = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    if len > MAX_IMPORT_BYTES {
        return Err("fichier trop volumineux (1 Mio au plus)".into());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let text = String::from_utf8(bytes).map_err(|_| "le fichier n'est pas du texte UTF-8")?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(PickedFile { name, text })
}

/// Asks for a color scheme file (native dialog). `None` when cancelled.
#[tauri::command]
pub async fn themes_import_pick(app: AppHandle) -> Result<Option<PickedFile>, String> {
    let locale = &app.state::<AppState>().locale;
    let dialog = app
        .dialog()
        .file()
        .add_filter(
            locale.pick("Jeux de couleurs", "Color schemes"),
            &["itermcolors", "json", "yaml", "yml"],
        )
        .set_title(locale.pick("Importer un thème", "Import a theme"));
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .ok()
        .flatten();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    read_import(&path).map(Some)
}

/// Asks where to save (native dialog) and writes the theme. `false` when cancelled.
#[tauri::command]
pub async fn themes_export(app: AppHandle, id: String, text: String) -> Result<bool, String> {
    let file_name =
        if is_valid_theme_id(&id) { format!("{id}.json") } else { "theme.json".to_owned() };
    let title = app.state::<AppState>().locale.pick("Exporter le thème", "Export theme");
    let dialog =
        app.dialog().file().add_filter("JSON", &["json"]).set_file_name(file_name).set_title(title);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .ok()
        .flatten();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(false) };
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn open_themes_dir(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let dir = paths(&state).themes_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// Called by the file watcher when a file of `themes/` changes.
pub fn on_themes_changed(app: &AppHandle) {
    tracing::info!("themes folder changed");
    emit_changed(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_pick_refuses_large_files() {
        let dir = tempfile::TempDir::new().unwrap();
        let big = dir.path().join("big.json");
        std::fs::write(&big, vec![b' '; 1024 * 1024 + 1]).unwrap();
        assert!(read_import(&big).unwrap_err().contains("1 Mio"));

        let binary = dir.path().join("x.itermcolors");
        std::fs::write(&binary, [0xff, 0xfe, 0x00]).unwrap();
        assert!(read_import(&binary).unwrap_err().contains("UTF-8"));

        let ok = dir.path().join("Nord.yaml");
        std::fs::write(&ok, "base00: \"2e3440\"").unwrap();
        assert_eq!(
            read_import(&ok).unwrap(),
            PickedFile { name: "Nord.yaml".into(), text: "base00: \"2e3440\"".into() }
        );
    }
}
