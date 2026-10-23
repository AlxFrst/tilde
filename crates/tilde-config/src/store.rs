//! Loading, validating and persisting `settings.json`.
//!
//! The store keeps the **raw** JSON document alongside the typed [`Settings`] so that
//! keys it does not know about (future settings, plugins, `$schema`) survive UI edits.

use std::{
    fs,
    hash::{DefaultHasher, Hash, Hasher},
    io,
    path::Path,
};

use serde_json::{Map, Value};

use crate::{
    ConfigError, ConfigPaths, SETTINGS_VERSION, Settings, merge_patch::merge_patch,
    migrate::migrate, settings_schema,
};

const SCHEMA_REF: &str = "./settings.schema.json";

/// Owns the user's settings and is the only writer of `settings.json`.
#[derive(Debug)]
pub struct SettingsStore {
    paths: ConfigPaths,
    raw: Value,
    settings: Settings,
    read_only: bool,
    last_written_hash: Option<u64>,
}

/// Result of [`SettingsStore::reload_from_disk`].
#[derive(Debug, Clone, PartialEq)]
pub enum ReloadOutcome {
    /// The file changed and yields new settings.
    Changed(Box<Settings>),
    /// The file was rewritten but the effective settings are identical.
    Unchanged,
    /// The file is exactly what this store last wrote.
    SelfWrite,
}

/// A successfully parsed, migrated and validated document.
pub(crate) struct Parsed {
    pub raw: Value,
    pub settings: Settings,
    pub migrated_from: Option<u32>,
}

impl SettingsStore {
    /// Loads settings from disk, creating the file on first launch.
    ///
    /// Always returns a usable store. When the file cannot be used (syntax error, bad
    /// type, out-of-range value, newer version) the store falls back to defaults, is
    /// marked read-only and **never** overwrites the user's file; the error is returned
    /// alongside so the caller can report it.
    #[must_use]
    pub fn load(paths: ConfigPaths) -> (Self, Option<ConfigError>) {
        let mut store = Self {
            paths,
            raw: with_schema_first(defaults_value()),
            settings: Settings::default(),
            read_only: false,
            last_written_hash: None,
        };
        let err = store.load_inner().err();
        (store, err)
    }

    fn load_inner(&mut self) -> Result<(), ConfigError> {
        let root = self.paths.root.clone();
        fs::create_dir_all(&root).map_err(|e| io_err(&root, e))?;
        self.write_schema();

        let file = self.paths.settings_file();
        let text = match fs::read_to_string(&file) {
            Ok(text) => text,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                return self.write_raw(&self.raw.clone());
            }
            Err(e) => {
                self.read_only = true;
                return Err(io_err(&file, e));
            }
        };

        let parsed = parse_document(&text).inspect_err(|_| self.read_only = true)?;
        self.raw = with_schema_first(parsed.raw);
        self.settings = parsed.settings;
        if let Some(from) = parsed.migrated_from {
            self.backup_once(from, &text)?;
            self.write_raw(&self.raw.clone())?;
            tracing::info!(from, to = SETTINGS_VERSION, "settings.json migrated");
        }
        Ok(())
    }

    #[must_use]
    pub fn settings(&self) -> &Settings {
        &self.settings
    }

    /// True while `settings.json` is unusable; UI edits are refused until it is fixed.
    #[must_use]
    pub fn read_only(&self) -> bool {
        self.read_only
    }

    #[must_use]
    pub fn paths(&self) -> &ConfigPaths {
        &self.paths
    }

    /// Applies a JSON Merge Patch, validates the result and writes it atomically.
    ///
    /// # Errors
    ///
    /// [`ConfigError::ReadOnly`] while the file on disk is broken, a type or range
    /// error if the patched document is invalid, or an I/O error. On error nothing is
    /// written and the current settings are kept.
    pub fn update(&mut self, patch: &Value) -> Result<Settings, ConfigError> {
        if self.read_only {
            return Err(ConfigError::ReadOnly);
        }
        let mut candidate = self.raw.clone();
        merge_patch(&mut candidate, patch);
        if let Some(obj) = candidate.as_object_mut() {
            obj.insert("version".into(), SETTINGS_VERSION.into());
        }
        let settings = deserialize(&candidate)?;
        settings.validate()?;
        let candidate = with_schema_first(candidate);
        self.write_raw(&candidate)?;
        self.raw = candidate;
        self.settings = settings.clone();
        Ok(settings)
    }

    /// Re-reads `settings.json` after an external change (called by the file watcher).
    ///
    /// Our own writes are recognised by content hash and reported as
    /// [`ReloadOutcome::SelfWrite`], so saving from the UI never loops back.
    ///
    /// # Errors
    ///
    /// Any load error; the previous settings are kept and the store becomes read-only
    /// until a valid file is saved.
    pub fn reload_from_disk(&mut self) -> Result<ReloadOutcome, ConfigError> {
        let file = self.paths.settings_file();
        let text = fs::read_to_string(&file).map_err(|e| io_err(&file, e))?;
        // One-shot: the hash only identifies the event caused by our own last write. A
        // later file with the same bytes (e.g. the user undoing an edit) is a real change.
        if self.last_written_hash.take() == Some(hash_bytes(text.as_bytes())) {
            return Ok(ReloadOutcome::SelfWrite);
        }
        let parsed = parse_document(&text).inspect_err(|_| self.read_only = true)?;
        let raw = with_schema_first(parsed.raw);
        if let Some(from) = parsed.migrated_from {
            self.backup_once(from, &text)?;
            self.write_raw(&raw)?;
        }
        let was_read_only = std::mem::replace(&mut self.read_only, false);
        self.raw = raw;
        if parsed.settings == self.settings && !was_read_only {
            return Ok(ReloadOutcome::Unchanged);
        }
        self.settings = parsed.settings.clone();
        Ok(ReloadOutcome::Changed(Box::new(parsed.settings)))
    }

    /// Saves the pre-migration file as `settings.json.v{from}.bak`, never replacing an
    /// existing backup (the first one is the user's real original).
    fn backup_once(&self, from: u32, text: &str) -> Result<(), ConfigError> {
        let backup = self.paths.root.join(format!("settings.json.v{from}.bak"));
        if backup.exists() {
            return Ok(());
        }
        fs::write(&backup, text).map_err(|e| io_err(&backup, e))
    }

    fn write_schema(&self) {
        let path = self.paths.schema_file();
        let json = serde_json::to_string_pretty(&settings_schema()).unwrap_or_default() + "\n";
        if let Err(e) = fs::write(&path, json) {
            tracing::warn!(path = %path.display(), error = %e, "cannot write settings schema");
        }
    }

    /// Writes `raw` via a temp file + rename so readers never see a half-written file.
    fn write_raw(&mut self, raw: &Value) -> Result<(), ConfigError> {
        let file = self.paths.settings_file();
        let tmp = file.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(raw).unwrap_or_default() + "\n";
        fs::write(&tmp, &text).map_err(|e| io_err(&tmp, e))?;
        fs::rename(&tmp, &file).map_err(|e| io_err(&file, e))?;
        self.last_written_hash = Some(hash_bytes(text.as_bytes()));
        Ok(())
    }
}

/// Parses, migrates, type-checks and validates a `settings.json` document.
pub(crate) fn parse_document(text: &str) -> Result<Parsed, ConfigError> {
    let raw: Value = serde_json::from_str(text).map_err(|e| {
        // serde_json appends " at line L column C"; we report the position separately.
        let full = e.to_string();
        let message = full.split_once(" at line ").map_or(full.as_str(), |(m, _)| m).to_owned();
        ConfigError::Parse { message, line: e.line(), column: e.column() }
    })?;
    let (raw, migrated_from) = migrate(raw)?;
    let settings = deserialize(&raw)?;
    settings.validate()?;
    Ok(Parsed { raw, settings, migrated_from })
}

fn deserialize(raw: &Value) -> Result<Settings, ConfigError> {
    serde_path_to_error::deserialize(raw.clone()).map_err(|e| ConfigError::Type {
        path: e.path().to_string(),
        message: e.inner().to_string(),
    })
}

fn defaults_value() -> Value {
    serde_json::to_value(Settings::default()).unwrap_or_else(|_| Value::Object(Map::new()))
}

/// Returns `raw` with a `$schema` key in first position (keeps an existing value).
fn with_schema_first(raw: Value) -> Value {
    let Value::Object(map) = raw else { return raw };
    let mut out = Map::with_capacity(map.len() + 1);
    let schema = map.get("$schema").cloned().unwrap_or_else(|| SCHEMA_REF.into());
    out.insert("$schema".into(), schema);
    out.extend(map.into_iter().filter(|(k, _)| k != "$schema"));
    Value::Object(out)
}

pub(crate) fn hash_bytes(bytes: &[u8]) -> u64 {
    let mut h = DefaultHasher::new();
    bytes.hash(&mut h);
    h.finish()
}

fn io_err(path: &Path, source: io::Error) -> ConfigError {
    ConfigError::Io { path: path.to_path_buf(), source }
}
