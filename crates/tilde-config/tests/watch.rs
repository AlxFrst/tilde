use std::{
    fs,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    thread,
    time::Duration,
};

use parking_lot::Mutex;
use serde_json::json;
use tempfile::TempDir;
use tilde_config::{
    ConfigError, ConfigFile, ConfigPaths, ReloadOutcome, SettingsStore, watch_config,
};

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
fn undo_to_last_app_write_after_broken_edit_unlocks() {
    let (_dir, mut store) = loaded();
    store.update(&json!({"terminal": {"fontSize": 16}})).unwrap();
    let file = store.paths().settings_file();
    let app_bytes = fs::read(&file).unwrap();

    fs::write(&file, "{typo").unwrap();
    assert!(store.reload_from_disk().is_err());
    assert!(store.read_only());

    // The user undoes the typo: the file is byte-for-byte what the app last wrote.
    fs::write(&file, &app_bytes).unwrap();
    assert!(matches!(store.reload_from_disk(), Ok(ReloadOutcome::Changed(_))));
    assert!(!store.read_only());
}

#[test]
fn undo_external_edit_back_to_app_bytes_is_applied() {
    let (_dir, mut store) = loaded();
    store.update(&json!({"terminal": {"fontSize": 16}})).unwrap();
    let file = store.paths().settings_file();
    let app_bytes = fs::read(&file).unwrap();

    fs::write(&file, r#"{"version":1,"terminal":{"fontSize":20}}"#).unwrap();
    store.reload_from_disk().unwrap();
    assert_eq!(store.settings().terminal.font_size, 20);

    fs::write(&file, &app_bytes).unwrap();
    store.reload_from_disk().unwrap();
    assert_eq!(store.settings().terminal.font_size, 16);
}

#[test]
fn migration_on_reload_keeps_the_first_backup() {
    let (_dir, mut store) = loaded();
    let root = store.paths().root.clone();
    let file = store.paths().settings_file();
    fs::write(root.join("settings.json.v0.bak"), "original backup").unwrap();

    fs::write(&file, r#"{"terminal":{"fontSize":17}}"#).unwrap();
    assert!(matches!(store.reload_from_disk(), Ok(ReloadOutcome::Changed(_))));
    assert_eq!(fs::read_to_string(root.join("settings.json.v0.bak")).unwrap(), "original backup");
}

#[test]
fn atomic_rename_triggers_single_reload() {
    let (_dir, store) = loaded();
    let paths = store.paths().clone();
    // Let the initial write settle before watching.
    thread::sleep(Duration::from_millis(200));
    let count = Arc::new(AtomicUsize::new(0));
    let c = Arc::clone(&count);
    let _watcher = watch_config(&paths, move |file| {
        assert_eq!(file, ConfigFile::Settings);
        c.fetch_add(1, Ordering::SeqCst);
    })
    .unwrap();

    let tmp = paths.root.join("settings.json.tmp");
    fs::write(&tmp, r#"{"version":1,"terminal":{"fontSize":19}}"#).unwrap();
    fs::rename(&tmp, paths.settings_file()).unwrap();

    thread::sleep(Duration::from_millis(600));
    assert_eq!(count.load(Ordering::SeqCst), 1);
}

#[test]
fn watch_reports_which_file_changed() {
    let (_dir, store) = loaded();
    let paths = store.paths().clone();
    thread::sleep(Duration::from_millis(200));
    let seen = Arc::new(Mutex::new(Vec::new()));
    let s = Arc::clone(&seen);
    let _watcher = watch_config(&paths, move |file| s.lock().push(file)).unwrap();

    fs::write(paths.connections_file(), r#"{"version":1}"#).unwrap();
    fs::write(paths.root.join("unrelated.txt"), "x").unwrap();
    thread::sleep(Duration::from_millis(600));
    assert_eq!(*seen.lock(), vec![ConfigFile::Connections]);
}

#[test]
fn theme_file_change_is_reported() {
    let (_dir, store) = loaded();
    let paths = store.paths().clone();
    thread::sleep(Duration::from_millis(200));
    let seen = Arc::new(Mutex::new(Vec::new()));
    let s = Arc::clone(&seen);
    let _watcher = watch_config(&paths, move |file| s.lock().push(file)).unwrap();
    assert!(paths.themes_dir().is_dir(), "watching creates the themes folder");

    fs::write(paths.themes_dir().join("mine.json"), r#"{"name":"Mine"}"#).unwrap();
    // A file named like a root config file inside themes/ is a theme, not settings.
    fs::write(paths.themes_dir().join("settings.json"), "{}").unwrap();
    fs::write(paths.themes_dir().join("notes.txt"), "x").unwrap();
    thread::sleep(Duration::from_millis(600));
    let seen = seen.lock();
    assert!(!seen.is_empty());
    assert!(seen.iter().all(|f| *f == ConfigFile::Themes), "{seen:?}");
}

#[test]
fn keybindings_change_is_reported() {
    let (_dir, store) = loaded();
    let paths = store.paths().clone();
    thread::sleep(Duration::from_millis(200));
    let seen = Arc::new(Mutex::new(Vec::new()));
    let s = Arc::clone(&seen);
    let _watcher = watch_config(&paths, move |file| s.lock().push(file)).unwrap();

    fs::write(paths.keybindings_file(), r#"{"version":1,"bindings":{}}"#).unwrap();
    thread::sleep(Duration::from_millis(600));
    assert_eq!(*seen.lock(), vec![ConfigFile::Keybindings]);
}
