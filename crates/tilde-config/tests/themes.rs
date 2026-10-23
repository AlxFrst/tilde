use std::fs;

use serde_json::json;
use tempfile::TempDir;
use tilde_config::{
    ConfigError, ConfigPaths, MAX_THEME_BYTES, delete_user_theme, is_valid_theme_id,
    list_user_themes, save_user_theme,
};

fn paths() -> (TempDir, ConfigPaths) {
    let dir = TempDir::new().unwrap();
    let paths = ConfigPaths::new(dir.path().join("Tilde"));
    (dir, paths)
}

fn all_files(dir: &std::path::Path) -> Vec<String> {
    let mut out = Vec::new();
    for entry in walk(dir) {
        out.push(entry.strip_prefix(dir).unwrap().to_string_lossy().replace('\\', "/"));
    }
    out.sort();
    out
}

fn walk(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let Ok(rd) = fs::read_dir(dir) else { return Vec::new() };
    rd.flatten()
        .flat_map(|e| {
            let p = e.path();
            if p.is_dir() { walk(&p) } else { vec![p] }
        })
        .collect()
}

#[test]
fn theme_ids_cannot_escape_the_themes_dir() {
    let (dir, paths) = paths();
    let long = "a".repeat(65);
    for id in
        ["../x", "a/b", "a\\b", "CON", "con", "nul", "com1", "lpt9", "", "X", "-a", "a.b", &long]
    {
        assert!(!is_valid_theme_id(id), "{id:?} accepted");
        let err = save_user_theme(&paths, id, &json!({"name": "x"})).unwrap_err();
        assert!(matches!(err, ConfigError::Invalid(_)), "{id:?}: {err:?}");
        assert!(matches!(delete_user_theme(&paths, id), Err(ConfigError::Invalid(_))));
    }
    assert!(all_files(dir.path()).is_empty(), "{:?}", all_files(dir.path()));
    for id in ["nord", "my-theme-2", "a", "0x"] {
        assert!(is_valid_theme_id(id), "{id:?} refused");
    }
}

#[test]
fn save_list_delete_roundtrip() {
    let (dir, paths) = paths();
    assert_eq!(list_user_themes(&paths).0.len(), 0);
    save_user_theme(&paths, "b-theme", &json!({"name": "B", "id": "other"})).unwrap();
    save_user_theme(&paths, "a-theme", &json!({"name": "A"})).unwrap();
    let (themes, errors) = list_user_themes(&paths);
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(themes.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["a-theme", "b-theme"]);
    assert_eq!(themes[1].data["id"], "b-theme", "the file name is the id");
    assert_eq!(themes[1].data["version"], 1);
    assert_eq!(all_files(dir.path()), ["Tilde/themes/a-theme.json", "Tilde/themes/b-theme.json"]);

    delete_user_theme(&paths, "a-theme").unwrap();
    delete_user_theme(&paths, "a-theme").unwrap();
    assert_eq!(list_user_themes(&paths).0.len(), 1);
}

#[test]
fn broken_theme_file_is_reported_not_fatal() {
    let (_dir, paths) = paths();
    let themes = paths.themes_dir();
    fs::create_dir_all(&themes).unwrap();
    fs::write(themes.join("good.json"), r#"{"name":"Good"}"#).unwrap();
    fs::write(themes.join("bad.json"), "{oops").unwrap();
    fs::write(themes.join("list.json"), "[1,2]").unwrap();
    fs::write(themes.join("Bad Name.json"), r#"{"name":"x"}"#).unwrap();
    fs::write(themes.join("notes.txt"), "ignored").unwrap();
    let (list, errors) = list_user_themes(&paths);
    assert_eq!(list.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["good"]);
    let mut files: Vec<_> = errors.iter().map(|e| e.file.as_str()).collect();
    files.sort_unstable();
    assert_eq!(files, ["Bad Name.json", "bad.json", "list.json"]);
    assert!(errors.iter().all(|e| !e.message.is_empty()));
}

#[test]
fn oversized_theme_is_refused() {
    let (_dir, paths) = paths();
    let big = "x".repeat(usize::try_from(MAX_THEME_BYTES).unwrap());
    let err = save_user_theme(&paths, "big", &json!({"name": big})).unwrap_err();
    assert!(matches!(err, ConfigError::Invalid(_)), "{err:?}");
    assert!(matches!(save_user_theme(&paths, "arr", &json!([1])), Err(ConfigError::Invalid(_))));

    fs::create_dir_all(paths.themes_dir()).unwrap();
    fs::write(paths.themes_dir().join("huge.json"), format!(r#"{{"name":"{big}"}}"#)).unwrap();
    let (list, errors) = list_user_themes(&paths);
    assert_eq!(list.len(), 0);
    assert_eq!(errors.len(), 1);
}
