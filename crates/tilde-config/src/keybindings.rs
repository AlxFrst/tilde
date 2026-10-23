//! `keybindings.json`: the user's changes to the default shortcuts.
//!
//! Only overrides are stored: a string replaces a command's shortcut, `null` removes it.
//! Rust does not know the commands (plugins will add theirs), so it only checks the
//! shape of each entry; the front-end parses the shortcuts themselves. Like
//! `connections.json`, a file that cannot be read as a whole is left untouched and
//! read-only, while bad entries are dropped in memory and reported.

use std::{collections::BTreeMap, fs, io, path::Path};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::{
    ConfigError, ConfigPaths, FieldError,
    store::{hash_bytes, parse_json},
};

pub const KEYBINDINGS_VERSION: u32 = 1;
const FILE_NAME: &str = "keybindings.json";
const SCHEMA_REF: &str = "./keybindings.schema.json";
const MAX_ENTRIES: usize = 500;
const MAX_BINDING: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct KeybindingsFile {
    pub version: u32,
    /// Command id → shortcut (`Ctrl+Alt+T`), or `null` to leave the command unbound.
    pub bindings: BTreeMap<String, Option<String>>,
}

impl Default for KeybindingsFile {
    fn default() -> Self {
        Self { version: KEYBINDINGS_VERSION, bindings: BTreeMap::new() }
    }
}

/// JSON Schema of `keybindings.json`, for editors.
///
/// # Panics
///
/// Never: a derived schema always serializes.
#[must_use]
pub fn keybindings_schema() -> Value {
    let mut schema = serde_json::to_value(schemars::schema_for!(KeybindingsFile))
        .expect("a derived JSON schema always serializes");
    if let Some(obj) = schema.as_object_mut() {
        obj.insert("$id".into(), "https://tilde.dev/schemas/keybindings.schema.json".into());
        if let Some(props) = obj.get_mut("properties").and_then(|p| p.as_object_mut()) {
            props.insert("$schema".into(), serde_json::json!({ "type": "string" }));
        }
    }
    schema
}

fn invalid(path: &str, message: impl Into<String>) -> ConfigError {
    ConfigError::Invalid(vec![FieldError { path: path.into(), message: message.into() }])
}

fn io_err(path: &Path, source: io::Error) -> ConfigError {
    ConfigError::Io { path: path.to_path_buf(), source }
}

fn valid_command(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Why an entry cannot be used, if it cannot.
fn entry_problem(command: &str, binding: Option<&str>) -> Option<&'static str> {
    if !valid_command(command) {
        return Some("identifiant de commande invalide");
    }
    let b = binding?;
    if b.is_empty() || b.chars().count() > MAX_BINDING {
        return Some("raccourci vide ou trop long (64 caractères au plus)");
    }
    if b.chars().any(char::is_control) {
        return Some("raccourci contenant un caractère de contrôle");
    }
    None
}

fn parse(text: &str) -> Result<(KeybindingsFile, Vec<String>), ConfigError> {
    let raw = parse_json(text.trim_start_matches('\u{feff}'))?;
    let mut file: KeybindingsFile = serde_path_to_error::deserialize(raw).map_err(|e| {
        ConfigError::Type { path: e.path().to_string(), message: e.inner().to_string() }
    })?;
    let mut warnings = Vec::new();
    file.bindings.retain(|command, binding| match entry_problem(command, binding.as_deref()) {
        Some(problem) => {
            warnings.push(format!("« {command} » : {problem}"));
            false
        }
        None => true,
    });
    if file.bindings.len() > MAX_ENTRIES {
        warnings.push(format!("plus de {MAX_ENTRIES} raccourcis : les suivants sont ignorés"));
        file.bindings = file.bindings.into_iter().take(MAX_ENTRIES).collect();
    }
    Ok((file, warnings))
}

/// Owns `keybindings.json` and is its only writer.
#[derive(Debug)]
pub struct KeybindingsStore {
    paths: ConfigPaths,
    file: KeybindingsFile,
    warnings: Vec<String>,
    read_only: bool,
    /// Hash of the bytes last read from or written to disk.
    disk_hash: Option<u64>,
}

impl KeybindingsStore {
    /// Always returns a usable store; an unusable file is reported and left untouched.
    #[must_use]
    pub fn load(paths: ConfigPaths) -> (Self, Option<ConfigError>) {
        let mut store = Self {
            paths,
            file: KeybindingsFile::default(),
            warnings: Vec::new(),
            read_only: false,
            disk_hash: None,
        };
        store.write_schema();
        let err = store.reload_from_disk().err();
        (store, err)
    }

    #[must_use]
    pub fn file(&self) -> &KeybindingsFile {
        &self.file
    }

    #[must_use]
    pub fn read_only(&self) -> bool {
        self.read_only
    }

    /// Entries of the file that were dropped, one sentence each.
    #[must_use]
    pub fn warnings(&self) -> &[String] {
        &self.warnings
    }

    #[must_use]
    pub fn paths(&self) -> &ConfigPaths {
        &self.paths
    }

    /// Re-reads the file. `Ok(false)` when it is what this store last wrote (or still
    /// absent). On error the last good content stays and the store becomes read-only.
    ///
    /// # Errors
    ///
    /// The file cannot be read, parsed, or comes from a newer version.
    pub fn reload_from_disk(&mut self) -> Result<bool, ConfigError> {
        let path = self.paths.keybindings_file();
        let was_read_only = self.read_only;
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                let changed = was_read_only || !self.file.bindings.is_empty();
                self.read_only = false;
                self.disk_hash = None;
                self.file = KeybindingsFile::default();
                self.warnings.clear();
                return Ok(changed);
            }
            Err(e) => {
                self.read_only = true;
                return Err(io_err(&path, e));
            }
        };
        let hash = hash_bytes(text.as_bytes());
        if !was_read_only && self.disk_hash == Some(hash) {
            return Ok(false);
        }
        let (file, warnings) = parse(&text).inspect_err(|_| self.read_only = true)?;
        if file.version > KEYBINDINGS_VERSION {
            self.read_only = true;
            return Err(ConfigError::FutureVersion {
                found: file.version,
                supported: KEYBINDINGS_VERSION,
            });
        }
        let changed = was_read_only || file != self.file || warnings != self.warnings;
        self.file = file;
        self.warnings = warnings;
        self.read_only = false;
        self.disk_hash = Some(hash);
        Ok(changed)
    }

    /// Picks up hand edits the watcher has not delivered yet, then checks the file may
    /// be written.
    fn check_writable(&mut self) -> Result<(), ConfigError> {
        if let Err(e) = self.reload_from_disk() {
            tracing::warn!(error = %e, "keybindings.json changed on disk and is now unusable");
        }
        if self.read_only { Err(ConfigError::ReadOnlyFile(FILE_NAME)) } else { Ok(()) }
    }

    /// Overrides `command`'s shortcut; `None` leaves it unbound.
    ///
    /// # Errors
    ///
    /// Read-only file, invalid entry ([`ConfigError::Invalid`]), or I/O.
    pub fn set(&mut self, command: &str, binding: Option<String>) -> Result<(), ConfigError> {
        if let Some(problem) = entry_problem(command, binding.as_deref()) {
            return Err(invalid(command, problem));
        }
        self.check_writable()?;
        let mut file = self.file.clone();
        if !file.bindings.contains_key(command) && file.bindings.len() >= MAX_ENTRIES {
            return Err(invalid(command, format!("{MAX_ENTRIES} raccourcis au plus")));
        }
        file.bindings.insert(command.to_owned(), binding);
        self.commit(file)
    }

    /// Back to the default shortcut for `command`, or for every command with `None`.
    ///
    /// # Errors
    ///
    /// Read-only file or I/O.
    pub fn reset(&mut self, command: Option<&str>) -> Result<(), ConfigError> {
        self.check_writable()?;
        let mut file = self.file.clone();
        match command {
            Some(c) => {
                file.bindings.remove(c);
            }
            None => file.bindings.clear(),
        }
        self.commit(file)
    }

    /// Writes `file` atomically, then makes it current.
    fn commit(&mut self, file: KeybindingsFile) -> Result<(), ConfigError> {
        let mut doc = Map::new();
        doc.insert("$schema".into(), SCHEMA_REF.into());
        if let Value::Object(map) = serde_json::to_value(&file).unwrap_or(Value::Null) {
            doc.extend(map);
        }
        let text = serde_json::to_string_pretty(&Value::Object(doc)).unwrap_or_default() + "\n";
        let root = self.paths.root.clone();
        fs::create_dir_all(&root).map_err(|e| io_err(&root, e))?;
        let path = self.paths.keybindings_file();
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, &text).map_err(|e| io_err(&tmp, e))?;
        fs::rename(&tmp, &path).map_err(|e| io_err(&path, e))?;
        self.disk_hash = Some(hash_bytes(text.as_bytes()));
        self.file = file;
        self.warnings.clear();
        Ok(())
    }

    /// Keeps `keybindings.schema.json` next to the file for editor completion.
    fn write_schema(&self) {
        let text = serde_json::to_string_pretty(&keybindings_schema()).unwrap_or_default();
        let path = self.paths.keybindings_schema_file();
        if fs::read_to_string(&path).ok().as_deref() != Some(text.as_str())
            && let Err(e) =
                fs::create_dir_all(&self.paths.root).and_then(|()| fs::write(&path, &text))
        {
            tracing::debug!(error = %e, "keybindings.schema.json not written");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_snapshot() {
        insta::assert_json_snapshot!(keybindings_schema());
    }
}
