//! `connections.json`: saved SSH connections, folders and recents.
//!
//! Rust owns the file so it can resolve a saved connection when opening a session. It
//! holds **no secrets** (passwords and passphrases live in the OS keyring). Unknown keys
//! are ignored when reading and never written back or exported. A file that cannot be
//! read as a whole (syntax, types, newer version) is shown read-only and never
//! overwritten; small inconsistencies (duplicate ids, unknown folder or icon) are
//! repaired in memory and written with the next change.

use std::{
    collections::HashSet,
    fs,
    hash::{DefaultHasher, Hash, Hasher},
    io,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::{
    ConfigError, ConfigPaths, FieldError,
    store::{hash_bytes, parse_json},
};

pub const CONNECTIONS_VERSION: u32 = 1;
pub const MAX_RECENTS: usize = 10;
const FILE_NAME: &str = "connections.json";
const SCHEMA_REF: &str = "./connections.schema.json";
const MAX_NAME: usize = 100;

/// Icons a connection may use (lucide names).
pub const ICONS: &[&str] = &[
    "server", "database", "cloud", "globe", "terminal", "box", "cpu", "shield", "house", "rocket",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct ConnectionsFile {
    pub version: u32,
    pub folders: Vec<Folder>,
    pub connections: Vec<Connection>,
    pub recents: Vec<Recent>,
}

impl Default for ConnectionsFile {
    fn default() -> Self {
        Self {
            version: CONNECTIONS_VERSION,
            folders: Vec::new(),
            connections: Vec::new(),
            recents: Vec::new(),
        }
    }
}

/// A folder of connections (one level).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    /// `#RRGGBB`.
    pub color: Option<String>,
}

/// A saved connection. `host` is an alias of `~/.ssh/config` or a host name; the
/// fields set here override what `ssh_config` says for it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: Option<u16>,
    pub user: Option<String>,
    /// Private key path (`~` allowed).
    pub identity_file: Option<String>,
    /// `ProxyJump` syntax: `[user@]host[:port]`, comma-separated.
    pub proxy_jump: Option<String>,
    /// `None`: as `ssh_config` says.
    pub forward_agent: Option<bool>,
    pub folder_id: Option<String>,
    /// `#RRGGBB`.
    pub color: Option<String>,
    /// One of [`ICONS`].
    pub icon: Option<String>,
    pub tags: Vec<String>,
    pub favorite: bool,
}

/// A recently opened target: `conn:<id>` or `ssh:<typed target>`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Recent {
    pub key: String,
    pub label: String,
    /// Seconds since the Unix epoch.
    pub at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ImportReport {
    pub imported: usize,
    pub skipped: usize,
}

/// A fresh 16-hex-digit id.
#[must_use]
pub fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut h = DefaultHasher::new();
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_nanos()).hash(&mut h);
    COUNTER.fetch_add(1, Ordering::Relaxed).hash(&mut h);
    std::process::id().hash(&mut h);
    format!("{:016x}", h.finish())
}

/// JSON Schema of `connections.json`, for editors.
///
/// # Panics
///
/// Never: a derived schema always serializes.
#[must_use]
pub fn connections_schema() -> Value {
    let mut schema = serde_json::to_value(schemars::schema_for!(ConnectionsFile))
        .expect("a derived JSON schema always serializes");
    if let Some(obj) = schema.as_object_mut() {
        obj.insert("$id".into(), "https://tilde.dev/schemas/connections.schema.json".into());
        if let Some(props) = obj.get_mut("properties").and_then(|p| p.as_object_mut()) {
            props.insert("$schema".into(), serde_json::json!({ "type": "string" }));
        }
    }
    schema
}

fn invalid(path: &str, message: impl Into<String>) -> ConfigError {
    ConfigError::Invalid(vec![FieldError { path: path.into(), message: message.into() }])
}

fn is_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

fn blank_to_none(v: &mut Option<String>) {
    if let Some(s) = v {
        let t = s.trim();
        if t.is_empty() {
            *v = None;
        } else if t.len() != s.len() {
            *v = Some(t.to_owned());
        }
    }
}

fn clean_tags(tags: &mut Vec<String>) {
    let mut seen = HashSet::new();
    let cleaned: Vec<String> = tags
        .iter()
        .map(|t| t.trim().to_owned())
        .filter(|t| !t.is_empty() && seen.insert(t.to_lowercase()))
        .collect();
    *tags = cleaned;
}

/// Normalises a connection and checks it; `folders` are the known folder ids.
fn validate_connection(c: &mut Connection, folders: &[Folder]) -> Result<(), ConfigError> {
    c.name = c.name.trim().to_owned();
    c.host = c.host.trim().to_owned();
    for field in [&mut c.user, &mut c.identity_file, &mut c.proxy_jump, &mut c.color, &mut c.icon] {
        blank_to_none(field);
    }
    blank_to_none(&mut c.folder_id);
    clean_tags(&mut c.tags);

    if c.name.is_empty() {
        return Err(invalid("name", "le nom est obligatoire"));
    }
    if c.name.chars().count() > MAX_NAME {
        return Err(invalid("name", format!("{MAX_NAME} caractères au plus")));
    }
    if c.host.is_empty() || c.host.chars().any(char::is_whitespace) {
        return Err(invalid("host", "un hôte ou un alias, sans espace"));
    }
    if c.port == Some(0) {
        return Err(invalid("port", "entre 1 et 65535"));
    }
    if c.user.as_deref().is_some_and(|u| u.contains('@') || u.chars().any(char::is_whitespace)) {
        return Err(invalid("user", "sans espace ni @"));
    }
    if c.color.as_deref().is_some_and(|col| !is_color(col)) {
        return Err(invalid("color", "format #RRGGBB"));
    }
    if let Some(jump) = &c.proxy_jump
        && let Err(message) = tilde_ssh_config::parse_proxy_jump(jump)
    {
        return Err(invalid("proxyJump", message));
    }
    if c.folder_id.as_ref().is_some_and(|id| !folders.iter().any(|f| &f.id == id)) {
        return Err(invalid("folderId", "dossier inconnu"));
    }
    if c.icon.as_deref().is_some_and(|i| !ICONS.contains(&i)) {
        return Err(invalid("icon", "icône inconnue"));
    }
    Ok(())
}

fn validate_folder(f: &mut Folder) -> Result<(), ConfigError> {
    f.name = f.name.trim().to_owned();
    blank_to_none(&mut f.color);
    if f.name.is_empty() {
        return Err(invalid("name", "le nom est obligatoire"));
    }
    if f.name.chars().count() > MAX_NAME {
        return Err(invalid("name", format!("{MAX_NAME} caractères au plus")));
    }
    if f.color.as_deref().is_some_and(|col| !is_color(col)) {
        return Err(invalid("color", "format #RRGGBB"));
    }
    Ok(())
}

/// Repairs what can be repaired without losing data; logs each repair.
fn repair(file: &mut ConnectionsFile) {
    let mut ids = HashSet::new();
    for f in &mut file.folders {
        if f.id.is_empty() || !ids.insert(f.id.clone()) {
            tracing::warn!(folder = %f.name, "connections.json: duplicate folder id renewed");
            f.id = new_id();
            ids.insert(f.id.clone());
        }
    }
    let folder_ids: HashSet<String> = file.folders.iter().map(|f| f.id.clone()).collect();
    let mut ids = HashSet::new();
    for c in &mut file.connections {
        if c.id.is_empty() || !ids.insert(c.id.clone()) {
            tracing::warn!(connection = %c.name, "connections.json: duplicate id renewed");
            c.id = new_id();
            ids.insert(c.id.clone());
        }
        if c.folder_id.as_ref().is_some_and(|f| !folder_ids.contains(f)) {
            tracing::warn!(connection = %c.name, "connections.json: unknown folder, moved to root");
            c.folder_id = None;
        }
        if c.icon.as_deref().is_some_and(|i| !ICONS.contains(&i)) {
            c.icon = None;
        }
        clean_tags(&mut c.tags);
    }
    file.recents.truncate(MAX_RECENTS);
}

/// Parses a whole document. Types are strict: an entry of the wrong shape makes the
/// file unusable rather than silently dropped (and later erased by a rewrite).
fn parse(text: &str) -> Result<ConnectionsFile, ConfigError> {
    let raw = parse_json(text)?;
    serde_path_to_error::deserialize(raw).map_err(|e| ConfigError::Type {
        path: e.path().to_string(),
        message: e.inner().to_string(),
    })
}

fn io_err(path: &Path, source: io::Error) -> ConfigError {
    ConfigError::Io { path: path.to_path_buf(), source }
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// Owns `connections.json` and is its only writer.
#[derive(Debug)]
pub struct ConnectionsStore {
    paths: ConfigPaths,
    file: ConnectionsFile,
    read_only: bool,
    last_written_hash: Option<u64>,
}

impl ConnectionsStore {
    /// Always returns a usable store; an unusable file is reported and left untouched.
    #[must_use]
    pub fn load(paths: ConfigPaths) -> (Self, Option<ConfigError>) {
        let mut store = Self {
            paths,
            file: ConnectionsFile::default(),
            read_only: false,
            last_written_hash: None,
        };
        store.write_schema();
        let err = store.reload_from_disk().err();
        (store, err)
    }

    #[must_use]
    pub fn file(&self) -> &ConnectionsFile {
        &self.file
    }

    #[must_use]
    pub fn read_only(&self) -> bool {
        self.read_only
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
        let path = self.paths.connections_file();
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                self.read_only = false;
                return Ok(false);
            }
            Err(e) => {
                self.read_only = true;
                return Err(io_err(&path, e));
            }
        };
        if self.last_written_hash == Some(hash_bytes(text.as_bytes())) {
            return Ok(false);
        }
        let mut file = parse(&text).inspect_err(|_| self.read_only = true)?;
        repair(&mut file);
        if file.version > CONNECTIONS_VERSION {
            self.file = file;
            self.read_only = true;
            return Err(ConfigError::FutureVersion {
                found: self.file.version,
                supported: CONNECTIONS_VERSION,
            });
        }
        let changed = file != self.file;
        self.file = file;
        self.read_only = false;
        Ok(changed)
    }

    fn check_writable(&self) -> Result<(), ConfigError> {
        if self.read_only { Err(ConfigError::ReadOnlyFile(FILE_NAME)) } else { Ok(()) }
    }

    /// Creates (empty id) or replaces a connection.
    ///
    /// # Errors
    ///
    /// Read-only file, invalid field ([`ConfigError::Invalid`] naming it), or I/O.
    pub fn upsert_connection(&mut self, mut c: Connection) -> Result<Connection, ConfigError> {
        self.check_writable()?;
        validate_connection(&mut c, &self.file.folders)?;
        let mut file = self.file.clone();
        if let Some(existing) =
            file.connections.iter_mut().find(|x| !c.id.is_empty() && x.id == c.id)
        {
            existing.clone_from(&c);
        } else {
            c.id = new_id();
            file.connections.push(c.clone());
        }
        self.commit(file)?;
        Ok(c)
    }

    /// # Errors
    ///
    /// Read-only file or I/O.
    pub fn remove_connection(&mut self, id: &str) -> Result<(), ConfigError> {
        self.check_writable()?;
        let mut file = self.file.clone();
        file.connections.retain(|c| c.id != id);
        file.recents.retain(|r| r.key != format!("conn:{id}"));
        self.commit(file)
    }

    /// # Errors
    ///
    /// Read-only file, unknown id or I/O.
    pub fn set_favorite(&mut self, id: &str, favorite: bool) -> Result<(), ConfigError> {
        self.check_writable()?;
        let mut file = self.file.clone();
        let c = file
            .connections
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| invalid("id", "connexion inconnue"))?;
        c.favorite = favorite;
        self.commit(file)
    }

    /// Creates (empty id) or renames/recolours a folder.
    ///
    /// # Errors
    ///
    /// Read-only file, invalid field or I/O.
    pub fn upsert_folder(&mut self, mut f: Folder) -> Result<Folder, ConfigError> {
        self.check_writable()?;
        validate_folder(&mut f)?;
        let mut file = self.file.clone();
        if let Some(existing) = file.folders.iter_mut().find(|x| !f.id.is_empty() && x.id == f.id) {
            existing.clone_from(&f);
        } else {
            f.id = new_id();
            file.folders.push(f.clone());
        }
        self.commit(file)?;
        Ok(f)
    }

    /// Removes a folder; its connections move to the root (never deleted).
    ///
    /// # Errors
    ///
    /// Read-only file or I/O.
    pub fn remove_folder(&mut self, id: &str) -> Result<(), ConfigError> {
        self.check_writable()?;
        let mut file = self.file.clone();
        file.folders.retain(|f| f.id != id);
        for c in &mut file.connections {
            if c.folder_id.as_deref() == Some(id) {
                c.folder_id = None;
            }
        }
        self.commit(file)
    }

    /// Puts `key` first in the recents. Best effort: ignored while read-only.
    pub fn record_recent(&mut self, key: &str, label: &str) {
        if self.read_only {
            return;
        }
        let mut file = self.file.clone();
        file.recents.retain(|r| r.key != key);
        file.recents.insert(0, Recent { key: key.into(), label: label.into(), at: now() });
        file.recents.truncate(MAX_RECENTS);
        if let Err(e) = self.commit(file) {
            tracing::warn!(error = %e, "could not record a recent connection");
        }
    }

    /// Adds the folders and connections of an exported file. Folders are matched by
    /// name, ids are regenerated, connections already present (same host, user and
    /// port) or invalid are skipped, recents and unknown keys are ignored.
    ///
    /// # Errors
    ///
    /// Read-only file, unreadable import (nothing is changed) or I/O.
    pub fn import(&mut self, text: &str) -> Result<ImportReport, ConfigError> {
        self.check_writable()?;
        let incoming = parse(text)?;
        let mut file = self.file.clone();
        let mut folder_map = std::collections::HashMap::new();
        for mut f in incoming.folders {
            let old = f.id.clone();
            let id = if let Some(existing) =
                file.folders.iter().find(|x| x.name.eq_ignore_ascii_case(f.name.trim()))
            {
                existing.id.clone()
            } else {
                if validate_folder(&mut f).is_err() {
                    continue;
                }
                f.id = new_id();
                file.folders.push(f.clone());
                f.id
            };
            folder_map.insert(old, id);
        }
        let mut report = ImportReport { imported: 0, skipped: 0 };
        for mut c in incoming.connections {
            c.folder_id = c.folder_id.and_then(|f| folder_map.get(&f).cloned());
            if validate_connection(&mut c, &file.folders).is_err()
                || file.connections.iter().any(|x| {
                    x.host.eq_ignore_ascii_case(&c.host) && x.user == c.user && x.port == c.port
                })
            {
                report.skipped += 1;
                continue;
            }
            c.id = new_id();
            file.connections.push(c);
            report.imported += 1;
        }
        self.commit(file)?;
        Ok(report)
    }

    /// The folders and connections as a shareable JSON document (no recents).
    ///
    /// # Panics
    ///
    /// Never: the model always serializes.
    #[must_use]
    pub fn export(&self) -> String {
        let out = ConnectionsFile { recents: Vec::new(), ..self.file.clone() };
        let mut value = serde_json::to_value(out).expect("the model serializes");
        if let Some(obj) = value.as_object_mut() {
            obj.remove("recents");
        }
        serde_json::to_string_pretty(&value).expect("a JSON value serializes") + "\n"
    }

    /// Writes `file` atomically, then makes it current.
    fn commit(&mut self, file: ConnectionsFile) -> Result<(), ConfigError> {
        let mut doc = Map::new();
        doc.insert("$schema".into(), SCHEMA_REF.into());
        if let Value::Object(map) = serde_json::to_value(&file).unwrap_or(Value::Null) {
            doc.extend(map);
        }
        let text = serde_json::to_string_pretty(&Value::Object(doc)).unwrap_or_default() + "\n";
        let root = self.paths.root.clone();
        fs::create_dir_all(&root).map_err(|e| io_err(&root, e))?;
        let path = self.paths.connections_file();
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, &text).map_err(|e| io_err(&tmp, e))?;
        fs::rename(&tmp, &path).map_err(|e| io_err(&path, e))?;
        self.last_written_hash = Some(hash_bytes(text.as_bytes()));
        self.file = file;
        Ok(())
    }

    /// Keeps `connections.schema.json` next to the file for editor completion.
    fn write_schema(&self) {
        let text = serde_json::to_string_pretty(&connections_schema()).unwrap_or_default();
        let path = self.paths.connections_schema_file();
        if fs::read_to_string(&path).ok().as_deref() != Some(text.as_str())
            && let Err(e) =
                fs::create_dir_all(&self.paths.root).and_then(|()| fs::write(&path, &text))
        {
            tracing::debug!(error = %e, "connections.schema.json not written");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_hex() {
        let a = new_id();
        let b = new_id();
        assert_ne!(a, b);
        assert!(a.len() == 16 && a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn schema_declares_the_schema_key() {
        let s = connections_schema();
        assert!(s["properties"]["$schema"].is_object());
        assert!(s["properties"]["connections"].is_object());
    }
}
