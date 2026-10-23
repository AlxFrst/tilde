use std::fs;

use serde_json::json;
use tempfile::TempDir;
use tilde_config::{ConfigPaths, load_workspace, save_workspace};

fn paths() -> (TempDir, ConfigPaths) {
    let dir = TempDir::new().unwrap();
    let paths = ConfigPaths::new(dir.path().join("Tilde"));
    (dir, paths)
}

#[test]
fn save_then_load_roundtrip() {
    let (_dir, paths) = paths();
    let state = json!({"version": 1, "tabs": [], "activeTabId": null});
    save_workspace(&paths, &state).unwrap();
    assert_eq!(load_workspace(&paths), Some(state));
}

#[test]
fn missing_file_loads_none() {
    let (_dir, paths) = paths();
    assert_eq!(load_workspace(&paths), None);
}

#[test]
fn corrupt_file_loads_none_and_is_left_intact() {
    let (_dir, paths) = paths();
    fs::create_dir_all(&paths.root).unwrap();
    fs::write(paths.workspace_file(), "{oops").unwrap();
    assert_eq!(load_workspace(&paths), None);
    assert_eq!(fs::read_to_string(paths.workspace_file()).unwrap(), "{oops");
}
