//! User themes: one `themes/<id>.json` file per theme.
//!
//! Rust only guards the file system (safe ids, size cap, atomic writes); the front-end
//! validates colors and derives missing tokens, as it does for imported themes.

use std::{fs, io, path::Path};

use serde::Serialize;
use serde_json::Value;

use crate::{ConfigError, ConfigPaths, FieldError};

/// Largest theme file read or written.
pub const MAX_THEME_BYTES: u64 = 256 * 1024;
const THEME_FILE_VERSION: u32 = 1;

const RESERVED: &[&str] = &["con", "nul", "aux", "prn"];

/// A theme id is also its file name: `[a-z0-9][a-z0-9-]{0,63}`, never a reserved
/// Windows device name.
#[must_use]
pub fn is_valid_theme_id(id: &str) -> bool {
    let mut chars = id.chars();
    let Some(first) = chars.next() else { return false };
    let lower_alnum = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit();
    if id.len() > 64 || !lower_alnum(first) || !chars.all(|c| lower_alnum(c) || c == '-') {
        return false;
    }
    let device = |prefix: &str| {
        id.strip_prefix(prefix).is_some_and(|n| n.len() == 1 && n.as_bytes()[0].is_ascii_digit())
    };
    !RESERVED.contains(&id) && !device("com") && !device("lpt")
}

/// A theme file as stored; its content is checked by the front-end.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserTheme {
    pub id: String,
    pub data: Value,
}

/// A file of `themes/` that cannot be used.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeFileError {
    pub file: String,
    pub message: String,
}

fn invalid(message: impl Into<String>) -> ConfigError {
    ConfigError::Invalid(vec![FieldError { path: "theme".into(), message: message.into() }])
}

fn io_err(path: &Path) -> impl FnOnce(io::Error) -> ConfigError {
    let path = path.to_path_buf();
    move |source| ConfigError::Io { path, source }
}

fn checked_id(id: &str) -> Result<(), ConfigError> {
    if is_valid_theme_id(id) {
        Ok(())
    } else {
        Err(invalid(format!(
            "identifiant « {id} » invalide : lettres minuscules, chiffres et tirets (64 au plus)"
        )))
    }
}

fn read_theme(path: &Path) -> Result<Value, String> {
    let len = fs::metadata(path).map_err(|e| e.to_string())?.len();
    if len > MAX_THEME_BYTES {
        return Err(format!("fichier trop volumineux ({} Kio au plus)", MAX_THEME_BYTES / 1024));
    }
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("JSON invalide (ligne {}, colonne {})", e.line(), e.column()))?;
    if value.is_object() { Ok(value) } else { Err("un objet JSON est attendu".into()) }
}

/// Every `*.json` of the themes folder, sorted by id, plus the files that were skipped.
#[must_use]
pub fn list_user_themes(paths: &ConfigPaths) -> (Vec<UserTheme>, Vec<ThemeFileError>) {
    let mut themes = Vec::new();
    let mut errors = Vec::new();
    let Ok(dir) = fs::read_dir(paths.themes_dir()) else { return (themes, errors) };
    for entry in dir.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") || !path.is_file() {
            continue;
        }
        let file = entry.file_name().to_string_lossy().into_owned();
        let id = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
        if !is_valid_theme_id(id) {
            errors.push(ThemeFileError {
                file,
                message: "nom de fichier invalide : lettres minuscules, chiffres et tirets".into(),
            });
            continue;
        }
        match read_theme(&path) {
            Ok(data) => themes.push(UserTheme { id: id.to_owned(), data }),
            Err(message) => errors.push(ThemeFileError { file, message }),
        }
    }
    themes.sort_by(|a, b| a.id.cmp(&b.id));
    (themes, errors)
}

/// Writes `themes/<id>.json` atomically; the file name wins over any `id` in `data`.
///
/// # Errors
///
/// [`ConfigError::Invalid`] for an unsafe id, a non-object or an oversized theme;
/// [`ConfigError::Io`] if the file cannot be written.
pub fn save_user_theme(paths: &ConfigPaths, id: &str, data: &Value) -> Result<(), ConfigError> {
    checked_id(id)?;
    let Some(object) = data.as_object() else { return Err(invalid("un objet JSON est attendu")) };
    let mut object = object.clone();
    object.insert("version".into(), THEME_FILE_VERSION.into());
    object.insert("id".into(), id.into());
    let text = serde_json::to_string_pretty(&Value::Object(object)).unwrap_or_default() + "\n";
    if text.len() as u64 > MAX_THEME_BYTES {
        return Err(invalid(format!(
            "thème trop volumineux ({} Kio au plus)",
            MAX_THEME_BYTES / 1024
        )));
    }
    let dir = paths.themes_dir();
    fs::create_dir_all(&dir).map_err(io_err(&dir))?;
    let file = dir.join(format!("{id}.json"));
    let tmp = dir.join(format!("{id}.json.tmp"));
    fs::write(&tmp, text).map_err(io_err(&tmp))?;
    fs::rename(&tmp, &file).map_err(io_err(&file))
}

/// Removes `themes/<id>.json`; a missing file is not an error.
///
/// # Errors
///
/// [`ConfigError::Invalid`] for an unsafe id, [`ConfigError::Io`] if removal fails.
pub fn delete_user_theme(paths: &ConfigPaths, id: &str) -> Result<(), ConfigError> {
    checked_id(id)?;
    let file = paths.themes_dir().join(format!("{id}.json"));
    match fs::remove_file(&file) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(io_err(&file)(e)),
        _ => Ok(()),
    }
}
