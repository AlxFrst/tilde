use std::fs;

use serde_json::json;
use tempfile::TempDir;
use tilde_config::{ConfigPaths, load_workspace, remove_workspace, save_workspace, saved_windows};

fn paths() -> (TempDir, ConfigPaths) {
    let dir = TempDir::new().unwrap();
    let paths = ConfigPaths::new(dir.path().join("Tilde"));
    (dir, paths)
}

#[test]
fn save_then_load_roundtrip() {
    let (_dir, paths) = paths();
    let state = json!({"version": 1, "tabs": [], "activeTabId": null});
    save_workspace(&paths, "main", &state).unwrap();
    assert_eq!(load_workspace(&paths, "main"), Some(state));
}

#[test]
fn missing_file_loads_none() {
    let (_dir, paths) = paths();
    assert_eq!(load_workspace(&paths, "main"), None);
}

#[test]
fn corrupt_file_loads_none_and_is_left_intact() {
    let (_dir, paths) = paths();
    fs::create_dir_all(&paths.root).unwrap();
    fs::write(paths.workspace_file(), "{oops").unwrap();
    assert_eq!(load_workspace(&paths, "main"), None);
    assert_eq!(fs::read_to_string(paths.workspace_file()).unwrap(), "{oops");
}

#[test]
fn each_window_has_its_own_workspace() {
    let (_dir, paths) = paths();
    save_workspace(&paths, "main", &json!({"tabs": ["a"]})).unwrap();
    save_workspace(&paths, "window-2", &json!({"tabs": ["b"]})).unwrap();
    assert_eq!(load_workspace(&paths, "main"), Some(json!({"tabs": ["a"]})));
    assert_eq!(load_workspace(&paths, "window-2"), Some(json!({"tabs": ["b"]})));
    // The main window's file keeps its name from before there were several windows.
    assert!(paths.workspace_file().is_file());
    assert!(paths.root.join("workspace-window-2.json").is_file());
}

#[test]
fn the_other_windows_saved_are_listed_in_order() {
    let (_dir, paths) = paths();
    for label in ["window-10", "main", "window-2", "window-3"] {
        save_workspace(&paths, label, &json!({})).unwrap();
    }
    fs::write(paths.root.join("workspace-window-x.json"), "{}").unwrap();
    fs::write(paths.root.join("workspace-window-4.json.tmp"), "{}").unwrap();
    assert_eq!(saved_windows(&paths), ["window-2", "window-3", "window-10"]);
}

#[test]
fn a_removed_workspace_is_gone_and_removing_none_is_fine() {
    let (_dir, paths) = paths();
    save_workspace(&paths, "window-2", &json!({})).unwrap();
    remove_workspace(&paths, "window-2").unwrap();
    assert_eq!(load_workspace(&paths, "window-2"), None);
    assert_eq!(saved_windows(&paths), Vec::<String>::new());
    remove_workspace(&paths, "window-2").unwrap();
}

#[test]
fn only_tilde_windows_have_a_workspace() {
    let (_dir, paths) = paths();
    for label in ["quake", "../settings", "window-", "window-2/x", "Main"] {
        save_workspace(&paths, label, &json!({"tabs": []})).unwrap();
        assert_eq!(load_workspace(&paths, label), None, "{label}");
    }
    assert!(!paths.root.exists() || fs::read_dir(&paths.root).unwrap().next().is_none());
}
