use std::fs;

use serde_json::{Value, json};
use tempfile::TempDir;
use tilde_config::{ConfigError, ConfigPaths, Settings, SettingsStore};

fn setup(contents: Option<&str>) -> (TempDir, ConfigPaths) {
    let dir = TempDir::new().unwrap();
    let paths = ConfigPaths::new(dir.path().join("Tilde"));
    if let Some(c) = contents {
        fs::create_dir_all(&paths.root).unwrap();
        fs::write(paths.settings_file(), c).unwrap();
    }
    (dir, paths)
}

fn read_json(paths: &ConfigPaths) -> Value {
    serde_json::from_str(&fs::read_to_string(paths.settings_file()).unwrap()).unwrap()
}

#[test]
fn first_launch_creates_file_and_schema() {
    let (_dir, paths) = setup(None);
    let (store, err) = SettingsStore::load(paths.clone());
    assert!(err.is_none(), "{err:?}");
    assert!(!store.read_only());
    assert!(paths.schema_file().exists());
    let raw = read_json(&paths);
    assert_eq!(raw.as_object().unwrap().keys().next().unwrap(), "$schema");
    let parsed: Settings = serde_json::from_value(raw).unwrap();
    assert_eq!(parsed, Settings::default());
    assert_eq!(store.settings(), &Settings::default());
}

#[test]
fn load_with_syntax_error_keeps_defaults_and_is_read_only() {
    let original = r#"{"terminal": {"#;
    let (_dir, paths) = setup(Some(original));
    let (mut store, err) = SettingsStore::load(paths.clone());
    let Some(ConfigError::Parse { line, .. }) = err else {
        panic!("expected Parse, got {err:?}")
    };
    assert_eq!(line, 1);
    assert_eq!(store.settings(), &Settings::default());
    assert!(store.read_only());
    assert!(
        store
            .update(&json!({"terminal": {"fontSize": 20}}))
            .is_err()
    );
    assert_eq!(fs::read_to_string(paths.settings_file()).unwrap(), original);
}

#[test]
fn invalid_type_reports_key_path() {
    let (_dir, paths) = setup(Some(r#"{"version":1,"terminal":{"fontSize":"big"}}"#));
    let (_store, err) = SettingsStore::load(paths);
    let Some(ConfigError::Type { path, .. }) = err else {
        panic!("expected Type, got {err:?}")
    };
    assert_eq!(path, "terminal.fontSize");
}

#[test]
fn future_version_is_read_only_and_untouched() {
    let original = r#"{"version": 99}"#;
    let (_dir, paths) = setup(Some(original));
    let (store, err) = SettingsStore::load(paths.clone());
    assert!(matches!(
        err,
        Some(ConfigError::FutureVersion {
            found: 99,
            supported: 1
        })
    ));
    assert!(store.read_only());
    assert_eq!(fs::read_to_string(paths.settings_file()).unwrap(), original);
}

#[test]
fn v0_file_is_migrated_with_backup() {
    let original = r#"{"terminal":{"fontSize":18}}"#;
    let (_dir, paths) = setup(Some(original));
    let (store, err) = SettingsStore::load(paths.clone());
    assert!(err.is_none(), "{err:?}");
    assert_eq!(read_json(&paths)["version"], 1);
    let backup = paths.root.join("settings.json.v0.bak");
    assert_eq!(fs::read_to_string(backup).unwrap(), original);
    assert_eq!(store.settings().terminal.font_size, 18);
}

#[test]
fn update_preserves_unknown_keys_and_schema() {
    let (_dir, paths) = setup(Some(
        r#"{"$schema":"./settings.schema.json","version":1,"x-plugin":{"a":1}}"#,
    ));
    let (mut store, err) = SettingsStore::load(paths.clone());
    assert!(err.is_none(), "{err:?}");
    let updated = store
        .update(&json!({"terminal": {"fontSize": 20}}))
        .unwrap();
    assert_eq!(updated.terminal.font_size, 20);
    let raw = read_json(&paths);
    assert_eq!(raw["x-plugin"]["a"], 1);
    assert_eq!(raw["$schema"], "./settings.schema.json");
    assert_eq!(raw["terminal"]["fontSize"], 20);
}

#[test]
fn update_rejects_invalid_and_keeps_previous() {
    let (_dir, paths) = setup(None);
    let (mut store, _) = SettingsStore::load(paths.clone());
    let before = fs::read_to_string(paths.settings_file()).unwrap();
    let err = store
        .update(&json!({"terminal": {"fontSize": 100}}))
        .unwrap_err();
    assert!(matches!(err, ConfigError::Invalid(_)));
    assert_eq!(fs::read_to_string(paths.settings_file()).unwrap(), before);
    assert_eq!(store.settings(), &Settings::default());
}

#[test]
fn unwritable_dir_falls_back_to_memory() {
    let dir = TempDir::new().unwrap();
    let blocker = dir.path().join("not-a-dir");
    fs::write(&blocker, "").unwrap();
    let (store, err) = SettingsStore::load(ConfigPaths::new(blocker.join("Tilde")));
    assert!(matches!(err, Some(ConfigError::Io { .. })), "{err:?}");
    assert_eq!(store.settings(), &Settings::default());
}
