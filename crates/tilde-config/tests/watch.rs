use std::{
    fs,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    thread,
    time::Duration,
};

use serde_json::json;
use tempfile::TempDir;
use tilde_config::{ConfigError, ConfigPaths, ReloadOutcome, SettingsStore, watch_settings};

fn loaded() -> (TempDir, SettingsStore) {
    let dir = TempDir::new().unwrap();
    let (store, err) = SettingsStore::load(ConfigPaths::new(dir.path().join("Tilde")));
    assert!(err.is_none(), "{err:?}");
    (dir, store)
}

#[test]
fn reload_detects_external_change() {
    let (_dir, mut store) = loaded();
    fs::write(store.paths().settings_file(), r#"{"version":1,"terminal":{"fontSize":22}}"#)
        .unwrap();
    let Ok(ReloadOutcome::Changed(s)) = store.reload_from_disk() else {
        panic!("expected Changed")
    };
    assert_eq!(s.terminal.font_size, 22);
    assert_eq!(store.settings().terminal.font_size, 22);
}

#[test]
fn self_write_is_ignored() {
    let (_dir, mut store) = loaded();
    store.update(&json!({"terminal": {"fontSize": 16}})).unwrap();
    assert!(matches!(store.reload_from_disk(), Ok(ReloadOutcome::SelfWrite)));
}

#[test]
fn reload_with_bad_file_keeps_previous() {
    let (_dir, mut store) = loaded();
    let file = store.paths().settings_file();
    fs::write(&file, "{oops").unwrap();
    assert!(matches!(store.reload_from_disk(), Err(ConfigError::Parse { .. })));
    assert_eq!(store.settings().terminal.font_size, 14);
    assert!(store.read_only());

    fs::write(&file, r#"{"version":1,"terminal":{"fontSize":15}}"#).unwrap();
    assert!(matches!(store.reload_from_disk(), Ok(ReloadOutcome::Changed(_))));
    assert!(!store.read_only());
}

#[test]
fn atomic_rename_triggers_single_reload() {
    let (_dir, store) = loaded();
    let paths = store.paths().clone();
    // Let the initial write settle before watching.
    thread::sleep(Duration::from_millis(200));
    let count = Arc::new(AtomicUsize::new(0));
    let c = Arc::clone(&count);
    let _watcher = watch_settings(&paths, move || {
        c.fetch_add(1, Ordering::SeqCst);
    })
    .unwrap();

    let tmp = paths.root.join("settings.json.tmp");
    fs::write(&tmp, r#"{"version":1,"terminal":{"fontSize":19}}"#).unwrap();
    fs::rename(&tmp, paths.settings_file()).unwrap();

    thread::sleep(Duration::from_millis(600));
    assert_eq!(count.load(Ordering::SeqCst), 1);
}
