//! `keybindings.json`: overrides of the default shortcuts.

use std::fs;

use tilde_config::{ConfigError, ConfigPaths, KeybindingsStore};

fn setup(contents: Option<&str>) -> (tempfile::TempDir, ConfigPaths) {
    let dir = tempfile::TempDir::new().unwrap();
    let paths = ConfigPaths::new(dir.path());
    if let Some(text) = contents {
        fs::write(paths.keybindings_file(), text).unwrap();
    }
    (dir, paths)
}

fn on_disk(paths: &ConfigPaths) -> serde_json::Value {
    serde_json::from_str(&fs::read_to_string(paths.keybindings_file()).unwrap()).unwrap()
}

#[test]
fn missing_file_means_no_overrides() {
    let (_d, paths) = setup(None);
    let (store, err) = KeybindingsStore::load(paths.clone());
    assert!(err.is_none());
    assert!(!store.read_only());
    assert_eq!(store.file().bindings.len(), 0);
    assert!(!paths.keybindings_file().exists(), "nothing is written until something changes");
    assert!(paths.keybindings_schema_file().exists());
}

#[test]
fn set_and_reset_roundtrip() {
    let (_d, paths) = setup(None);
    let (mut store, _) = KeybindingsStore::load(paths.clone());
    store.set("tab.new", Some("Ctrl+Alt+T".into())).unwrap();
    store.set("pane.close", Some("Ctrl+Shift+Q".into())).unwrap();
    let json = on_disk(&paths);
    assert_eq!(json["$schema"], "./keybindings.schema.json");
    assert_eq!(json["version"], 1);
    assert_eq!(
        json["bindings"],
        serde_json::json!({"pane.close": "Ctrl+Shift+Q", "tab.new": "Ctrl+Alt+T"})
    );

    store.reset(Some("tab.new")).unwrap();
    assert_eq!(on_disk(&paths)["bindings"], serde_json::json!({"pane.close": "Ctrl+Shift+Q"}));
    store.reset(None).unwrap();
    assert_eq!(on_disk(&paths)["bindings"], serde_json::json!({}));
    assert_eq!(store.file().bindings.len(), 0);
}

#[test]
fn null_unbinds() {
    let (_d, paths) = setup(None);
    let (mut store, _) = KeybindingsStore::load(paths.clone());
    store.set("tab.next", None).unwrap();
    assert_eq!(on_disk(&paths)["bindings"], serde_json::json!({"tab.next": null}));
    assert_eq!(store.file().bindings.get("tab.next"), Some(&None));
}

#[test]
fn invalid_entries_are_dropped_with_warnings() {
    let long = "K".repeat(200);
    let text = format!(
        r#"{{"version":1,"bindings":{{"../x":"Ctrl+A","tab.new":"{long}","pane.close":"Ctrl+Shift+Q","bad":"Ctrl+\u0007"}}}}"#
    );
    let (_d, paths) = setup(Some(&text));
    let (store, err) = KeybindingsStore::load(paths);
    assert!(err.is_none(), "{err:?}");
    assert!(!store.read_only());
    assert_eq!(store.file().bindings.keys().collect::<Vec<_>>(), ["pane.close"]);
    assert_eq!(store.warnings().len(), 3, "{:?}", store.warnings());

    let (_d, paths) = setup(None);
    let (mut store, _) = KeybindingsStore::load(paths.clone());
    assert!(matches!(store.set("../x", Some("Ctrl+A".into())), Err(ConfigError::Invalid(_))));
    assert!(matches!(store.set("tab.new", Some(String::new())), Err(ConfigError::Invalid(_))));
    assert!(matches!(store.set("tab.new", Some("K".repeat(65))), Err(ConfigError::Invalid(_))));
    assert!(!paths.keybindings_file().exists());
}

#[test]
fn broken_file_is_read_only_and_untouched() {
    let (_d, paths) = setup(Some("{oops"));
    let (mut store, err) = KeybindingsStore::load(paths.clone());
    assert!(matches!(err, Some(ConfigError::Parse { .. })));
    assert!(store.read_only());
    assert!(matches!(
        store.set("tab.new", Some("Ctrl+N".into())),
        Err(ConfigError::ReadOnlyFile(_))
    ));
    assert!(matches!(store.reset(None), Err(ConfigError::ReadOnlyFile(_))));
    assert_eq!(fs::read_to_string(paths.keybindings_file()).unwrap(), "{oops");

    let (_d, paths) = setup(Some(r#"{"version":99,"bindings":{}}"#));
    let (store, err) = KeybindingsStore::load(paths);
    assert!(matches!(err, Some(ConfigError::FutureVersion { found: 99, .. })));
    assert!(store.read_only());
}

#[test]
fn self_write_is_not_a_change() {
    let (_d, paths) = setup(None);
    let (mut store, _) = KeybindingsStore::load(paths.clone());
    store.set("tab.new", Some("Ctrl+Alt+T".into())).unwrap();
    assert!(!store.reload_from_disk().unwrap());

    fs::write(paths.keybindings_file(), r#"{"version":1,"bindings":{"tab.new":"Ctrl+N"}}"#)
        .unwrap();
    assert!(store.reload_from_disk().unwrap());
    assert_eq!(store.file().bindings["tab.new"].as_deref(), Some("Ctrl+N"));
}
