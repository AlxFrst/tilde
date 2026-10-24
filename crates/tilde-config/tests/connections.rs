//! `connections.json`: loading, repairs, validation, persistence, import/export.

use std::fs;

use tilde_config::{
    ConfigError, ConfigPaths, Connection, ConnectionsStore, Folder, MAIN_SPACE_ID, MAX_RECENTS,
    Space,
};

fn setup(contents: Option<&str>) -> (tempfile::TempDir, ConfigPaths) {
    let dir = tempfile::TempDir::new().unwrap();
    let paths = ConfigPaths::new(dir.path());
    if let Some(text) = contents {
        fs::write(paths.connections_file(), text).unwrap();
    }
    (dir, paths)
}

fn conn(name: &str, host: &str) -> Connection {
    Connection { name: name.into(), host: host.into(), ..Connection::default() }
}

fn read(paths: &ConfigPaths) -> String {
    fs::read_to_string(paths.connections_file()).unwrap()
}

#[test]
fn missing_file_is_an_empty_list() {
    let (_d, paths) = setup(None);
    let (store, err) = ConnectionsStore::load(paths.clone());
    assert!(err.is_none());
    assert!(!store.read_only());
    assert_eq!(store.file().connections.len(), 0);
    assert!(!paths.connections_file().exists(), "nothing is written until something changes");
}

#[test]
fn upsert_assigns_an_id_and_persists_atomically() {
    let (_d, paths) = setup(None);
    let (mut store, _) = ConnectionsStore::load(paths.clone());
    let saved = store.upsert_connection(conn("Prod", "prod.example")).unwrap();
    assert_eq!(saved.id.len(), 16);

    let (again, err) = ConnectionsStore::load(paths.clone());
    assert!(err.is_none());
    assert_eq!(again.file().connections, vec![saved]);
    assert!(read(&paths).contains("\"$schema\": \"./connections.schema.json\""));
    let leftovers: Vec<_> = fs::read_dir(&paths.root)
        .unwrap()
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty());
}

#[test]
fn invalid_json_is_never_overwritten() {
    let broken = "{ \"version\": 1, \"connections\": [ { \"name\": \"a\" ";
    let (_d, paths) = setup(Some(broken));
    let (mut store, err) = ConnectionsStore::load(paths.clone());
    assert!(matches!(err, Some(ConfigError::Parse { line: 1, .. })), "{err:?}");
    assert!(store.read_only());
    assert!(matches!(store.upsert_connection(conn("x", "h")), Err(ConfigError::ReadOnlyFile(_))));
    store.record_recent("ssh:h", "h");
    assert_eq!(read(&paths), broken);
}

#[test]
fn wrong_types_make_the_file_read_only_instead_of_dropping_entries() {
    let text = r#"{ "version": 1, "connections": [ { "id": "a", "name": "A", "host": "h", "port": "22" } ] }"#;
    let (_d, paths) = setup(Some(text));
    let (mut store, err) = ConnectionsStore::load(paths.clone());
    let Some(ConfigError::Type { path, .. }) = err else { panic!("{err:?}") };
    assert_eq!(path, "connections[0].port");
    assert!(store.upsert_connection(conn("x", "h")).is_err());
    assert_eq!(read(&paths), text);
}

#[test]
fn future_version_is_read_only() {
    let text = r#"{ "version": 9, "connections": [ { "id": "a", "name": "A", "host": "h" } ] }"#;
    let (_d, paths) = setup(Some(text));
    let (store, err) = ConnectionsStore::load(paths);
    assert!(matches!(err, Some(ConfigError::FutureVersion { found: 9, supported: 1 })));
    assert!(store.read_only());
    assert_eq!(store.file().connections.len(), 1, "still shown, just not editable");
}

#[test]
fn repairs_duplicate_ids_and_unknown_folders() {
    let text = r#"{ "version": 1,
        "folders": [ { "id": "f", "name": "Prod" } ],
        "connections": [
          { "id": "a", "name": "A", "host": "a", "folderId": "f", "icon": "server" },
          { "id": "a", "name": "B", "host": "b", "folderId": "gone", "icon": "unicorn",
            "tags": [" web ", "web", ""] }
        ] }"#;
    let (_d, paths) = setup(Some(text));
    let (store, err) = ConnectionsStore::load(paths.clone());
    assert!(err.is_none(), "{err:?}");
    let c = &store.file().connections;
    assert_eq!(c[0].id, "a");
    assert_ne!(c[1].id, "a");
    assert_eq!(c[0].folder_id.as_deref(), Some("f"));
    assert_eq!(c[1].folder_id, None);
    assert_eq!(c[1].icon, None);
    assert_eq!(c[1].tags, vec!["web".to_owned()]);
    assert_eq!(read(&paths), text, "repairs are written with the next change only");
}

#[test]
fn rejects_invalid_fields() {
    let (_d, paths) = setup(None);
    let (mut store, _) = ConnectionsStore::load(paths);
    let cases = [
        (Connection { port: Some(0), ..conn("a", "h") }, "port"),
        (conn("a", "my host"), "host"),
        (conn("  ", "h"), "name"),
        (Connection { color: Some("red".into()), ..conn("a", "h") }, "color"),
        (Connection { proxy_jump: Some("a,,b".into()), ..conn("a", "h") }, "proxyJump"),
        (Connection { user: Some("me@x".into()), ..conn("a", "h") }, "user"),
        (Connection { folder_id: Some("nope".into()), ..conn("a", "h") }, "folderId"),
    ];
    for (c, field) in cases {
        let Err(ConfigError::Invalid(errors)) = store.upsert_connection(c) else {
            panic!("{field} accepted")
        };
        assert_eq!(errors[0].path, field);
    }
    assert_eq!(store.file().connections.len(), 0);
}

#[test]
fn removing_a_folder_keeps_its_connections() {
    let (_d, paths) = setup(None);
    let (mut store, _) = ConnectionsStore::load(paths);
    let f = store.upsert_folder(Folder { name: "Prod".into(), ..Folder::default() }).unwrap();
    let c = store
        .upsert_connection(Connection { folder_id: Some(f.id.clone()), ..conn("a", "h") })
        .unwrap();
    store.remove_folder(&f.id).unwrap();
    assert_eq!(store.file().folders, vec![]);
    assert_eq!(store.file().connections[0].id, c.id);
    assert_eq!(store.file().connections[0].folder_id, None);
}

#[test]
fn recents_are_capped_deduplicated_and_most_recent_first() {
    let (_d, paths) = setup(None);
    let (mut store, _) = ConnectionsStore::load(paths);
    for i in 0..15 {
        store.record_recent(&format!("ssh:h{i}"), &format!("h{i}"));
    }
    store.record_recent("ssh:h10", "h10");
    let keys: Vec<_> = store.file().recents.iter().map(|r| r.key.as_str()).collect();
    assert_eq!(keys.len(), MAX_RECENTS);
    assert_eq!(keys[0], "ssh:h10");
    assert_eq!(keys[1], "ssh:h14");
    assert_eq!(keys.iter().filter(|k| **k == "ssh:h10").count(), 1);
}

#[test]
fn unknown_fields_are_dropped() {
    let text = r#"{ "version": 1, "connections": [
        { "id": "a", "name": "A", "host": "h", "password": "hunter2" } ] }"#;
    let (_d, paths) = setup(Some(text));
    let (mut store, _) = ConnectionsStore::load(paths.clone());
    store.set_favorite("a", true).unwrap();
    assert!(!read(&paths).contains("hunter2"));
}

#[test]
fn import_drops_unknown_fields_and_skips_duplicates() {
    let (_d, paths) = setup(None);
    let (mut store, _) = ConnectionsStore::load(paths.clone());
    let prod = store.upsert_folder(Folder { name: "Prod".into(), ..Folder::default() }).unwrap();
    let existing = store
        .upsert_connection(Connection { user: Some("root".into()), ..conn("db", "db.example") })
        .unwrap();
    let import = format!(
        r#"{{ "version": 1,
            "folders": [ {{ "id": "x1", "name": "prod" }}, {{ "id": "x2", "name": "Staging" }} ],
            "connections": [
              {{ "id": "{id}", "name": "db again", "host": "DB.example", "user": "root" }},
              {{ "id": "{id}", "name": "web", "host": "web.example", "folderId": "x1",
                 "password": "secret" }},
              {{ "id": "n", "name": "api", "host": "api.example", "folderId": "x2" }},
              {{ "id": "bad", "name": "bad", "host": "has space" }}
            ],
            "recents": [ {{ "key": "ssh:zzz", "label": "zzz", "at": 1 }} ] }}"#,
        id = existing.id
    );
    let report = store.import(&import).unwrap();
    assert_eq!((report.imported, report.skipped), (2, 2));

    let file = store.file();
    assert_eq!(file.folders.len(), 2, "« prod » merged with « Prod »");
    let web = file.connections.iter().find(|c| c.name == "web").unwrap();
    assert_ne!(web.id, existing.id, "ids are regenerated");
    assert_eq!(web.folder_id.as_deref(), Some(prod.id.as_str()));
    let staging = file.folders.iter().find(|f| f.name == "Staging").unwrap();
    let api = file.connections.iter().find(|c| c.name == "api").unwrap();
    assert_eq!(api.folder_id.as_deref(), Some(staging.id.as_str()));
    assert_eq!(file.recents, vec![], "recents are not imported");
    assert!(!read(&paths).contains("secret"));
}

#[test]
fn import_of_garbage_changes_nothing() {
    let (_d, paths) = setup(None);
    let (mut store, _) = ConnectionsStore::load(paths);
    store.upsert_connection(conn("a", "h")).unwrap();
    assert!(store.import("not json").is_err());
    assert_eq!(store.file().connections.len(), 1);
}

#[test]
fn export_contains_no_recents_and_no_unknown_fields() {
    let text = r#"{ "version": 1, "connections": [
        { "id": "a", "name": "A", "host": "h", "password": "hunter2" } ],
        "recents": [ { "key": "conn:a", "label": "A", "at": 5 } ] }"#;
    let (_d, paths) = setup(Some(text));
    let (store, _) = ConnectionsStore::load(paths);
    let out = store.export().unwrap();
    assert!(!out.contains("hunter2"));
    assert!(!out.contains("recents"));
    assert!(!out.contains("$schema"));
    let back: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(back["connections"][0]["host"], "h");
}

#[test]
fn reload_sees_external_edits_but_not_its_own_writes() {
    let (_d, paths) = setup(None);
    let (mut store, _) = ConnectionsStore::load(paths.clone());
    store.upsert_connection(conn("a", "h")).unwrap();
    assert!(!store.reload_from_disk().unwrap(), "our own write");

    let mut edited = read(&paths);
    edited = edited.replace("\"a\"", "\"renamed\"");
    fs::write(paths.connections_file(), edited).unwrap();
    assert!(store.reload_from_disk().unwrap());
    assert_eq!(store.file().connections[0].name, "renamed");

    fs::write(paths.connections_file(), "{").unwrap();
    assert!(store.reload_from_disk().is_err());
    assert!(store.read_only());
    assert_eq!(store.file().connections[0].name, "renamed", "last good content stays shown");
}

#[test]
fn restoring_the_exact_last_bytes_after_a_broken_edit_unlocks() {
    let (_d, paths) = setup(None);
    let (mut store, _) = ConnectionsStore::load(paths.clone());
    store.upsert_connection(conn("a", "h")).unwrap();
    let good = read(&paths);
    fs::write(paths.connections_file(), "{").unwrap();
    assert!(store.reload_from_disk().is_err());
    assert!(store.read_only());

    fs::write(paths.connections_file(), &good).unwrap(); // Ctrl+Z, save
    assert!(store.reload_from_disk().unwrap(), "the UI must hear that editing is back");
    assert!(!store.read_only());
    store.upsert_connection(conn("b", "h2")).unwrap();
}

#[test]
fn invalid_values_written_by_hand_are_reported() {
    let text = r#"{ "version": 1, "connections": [
        { "id": "a", "name": "A", "host": "h", "port": 0 },
        { "id": "b", "name": "B", "host": "h", "proxyJump": "x,,y" },
        { "id": "c", "name": "C", "host": "h" } ] }"#;
    let (_d, paths) = setup(Some(text));
    let (store, err) = ConnectionsStore::load(paths);
    assert!(err.is_none());
    let warnings = store.warnings();
    assert_eq!(warnings.len(), 2, "{warnings:?}");
    assert!(warnings[0].contains("« A »") && warnings[0].contains("port"), "{warnings:?}");
    assert!(store.problem("b").is_some());
    assert!(store.problem("c").is_none());
}

#[test]
fn app_writes_keep_hand_edits_not_yet_reloaded() {
    let (_d, paths) = setup(None);
    let (mut store, _) = ConnectionsStore::load(paths.clone());
    store.upsert_connection(conn("a", "h")).unwrap();
    // The user adds an entry by hand; the watcher has not fired yet.
    let edited = read(&paths).replace(
        "\"connections\": [",
        "\"connections\": [ { \"id\": \"hand\", \"name\": \"Hand\", \"host\": \"x\" },",
    );
    fs::write(paths.connections_file(), edited).unwrap();
    store.record_recent("ssh:h", "h");
    assert!(read(&paths).contains("\"Hand\""), "the hand edit survived");
    assert!(store.file().connections.iter().any(|c| c.id == "hand"));
}

#[test]
fn import_neutralises_risky_fields_and_names_entries_to_review() {
    let (_d, paths) = setup(None);
    let (mut store, _) = ConnectionsStore::load(paths);
    let report = store
        .import(
            r#"{ "version": 1, "connections": [
            { "id": "1", "name": "unc", "host": "a", "identityFile": "//evil.example/share/k",
              "forwardAgent": true },
            { "id": "2", "name": "unc2", "host": "b", "identityFile": "\\\\evil\\k" },
            { "id": "3", "name": "jump", "host": "c", "proxyJump": "x@bastion" },
            { "id": "4", "name": "plain", "host": "d" } ] }"#,
        )
        .unwrap();
    assert_eq!((report.imported, report.skipped), (4, 0));
    assert_eq!(report.review, vec!["unc", "unc2", "jump"]);
    let by = |n: &str| store.file().connections.iter().find(|c| c.name == n).unwrap().clone();
    assert_eq!(by("unc").identity_file, None, "network key paths are dropped");
    assert_eq!(by("unc2").identity_file, None);
    assert_eq!(by("unc").forward_agent, None, "agent forwarding is never imported");
    assert_eq!(by("jump").proxy_jump.as_deref(), Some("x@bastion"));

    let newer = store.import(r#"{ "version": 9, "connections": [] }"#);
    assert!(matches!(newer, Err(ConfigError::FutureVersion { .. })));
}

#[test]
fn export_is_refused_while_the_file_is_unreadable() {
    let (_d, paths) = setup(Some("{ broken"));
    let (store, _) = ConnectionsStore::load(paths);
    assert!(matches!(store.export(), Err(ConfigError::ReadOnlyFile(_))));
}

// ---- spaces ---------------------------------------------------------------------------

fn space(name: &str) -> Space {
    Space { name: name.into(), ..Space::default() }
}

fn invalid_path(err: Result<impl std::fmt::Debug, ConfigError>) -> String {
    match err {
        Err(ConfigError::Invalid(fields)) => fields[0].path.clone(),
        other => panic!("expected an invalid field, got {other:?}"),
    }
}

#[test]
fn no_space_means_one_implicit_main_space() {
    let text = r#"{ "version": 1, "connections": [ { "id": "a", "name": "A", "host": "h" } ] }"#;
    let (_d, paths) = setup(Some(text));
    let (store, err) = ConnectionsStore::load(paths.clone());
    assert!(err.is_none());
    assert_eq!(store.file().spaces, Vec::<Space>::new());
    assert_eq!(store.file().connections[0].space_id, None);
    assert_eq!(read(&paths), text, "loading writes nothing");
}

#[test]
fn creating_a_space_writes_main_first() {
    let (_d, paths) = setup(None);
    let (mut store, _) = ConnectionsStore::load(paths.clone());
    let pro = store.upsert_space(space("Pro")).unwrap();
    let names: Vec<_> =
        store.file().spaces.iter().map(|s| (s.id.as_str(), s.name.as_str())).collect();
    assert_eq!(names, [(MAIN_SPACE_ID, "Principal"), (pro.id.as_str(), "Pro")]);
    assert_eq!(pro.id.len(), 16);
    // A second space does not add another "Principal".
    store.upsert_space(space("Perso")).unwrap();
    assert_eq!(store.file().spaces.len(), 3);
    let (again, _) = ConnectionsStore::load(paths);
    assert_eq!(again.file().spaces.len(), 3);
}

#[test]
fn a_connection_takes_its_folder_space_on_load() {
    let text = r#"{ "version": 1,
      "spaces": [ { "id": "main", "name": "Principal" }, { "id": "pro", "name": "Pro" } ],
      "folders": [ { "id": "f", "name": "Prod", "spaceId": "pro" } ],
      "connections": [ { "id": "a", "name": "A", "host": "h", "folderId": "f", "spaceId": "main" } ] }"#;
    let (_d, paths) = setup(Some(text));
    let (store, _) = ConnectionsStore::load(paths);
    assert_eq!(store.file().connections[0].space_id.as_deref(), Some("pro"));
}

#[test]
fn moving_a_connection_to_another_space_leaves_its_folder() {
    let (_d, paths) = setup(None);
    let (mut store, _) = ConnectionsStore::load(paths);
    let pro = store.upsert_space(space("Pro")).unwrap();
    let folder = store
        .upsert_folder(Folder {
            name: "Prod".into(),
            space_id: Some(pro.id.clone()),
            ..Folder::default()
        })
        .unwrap();
    let mut c = conn("A", "h");
    c.folder_id = Some(folder.id.clone());
    c.space_id = Some(pro.id.clone());
    let saved = store.upsert_connection(c).unwrap();
    assert_eq!(saved.folder_id.as_deref(), Some(folder.id.as_str()));

    let moved = store
        .upsert_connection(Connection { space_id: Some(MAIN_SPACE_ID.into()), ..saved })
        .unwrap();
    assert_eq!(moved.space_id.as_deref(), Some(MAIN_SPACE_ID));
    assert_eq!(moved.folder_id, None, "the folder belongs to the other space");
}

#[test]
fn unknown_space_is_refused_on_write_and_repaired_on_load() {
    let (_d, paths) = setup(None);
    let (mut store, _) = ConnectionsStore::load(paths);
    let mut c = conn("A", "h");
    c.space_id = Some("nowhere".into());
    assert_eq!(invalid_path(store.upsert_connection(c)), "spaceId");
    let f = Folder { name: "F".into(), space_id: Some("nowhere".into()), ..Folder::default() };
    assert_eq!(invalid_path(store.upsert_folder(f)), "spaceId");

    let text = r#"{ "version": 1, "folders": [ { "id": "f", "name": "F", "spaceId": "gone" } ],
      "connections": [ { "id": "a", "name": "A", "host": "h", "spaceId": "gone" } ] }"#;
    let (_d2, paths2) = setup(Some(text));
    let (repaired, _) = ConnectionsStore::load(paths2);
    assert_eq!(repaired.file().folders[0].space_id, None);
    assert_eq!(repaired.file().connections[0].space_id, None);
}

#[test]
fn removing_a_space_moves_its_folders_and_connections_to_the_first_one() {
    let (_d, paths) = setup(None);
    let (mut store, _) = ConnectionsStore::load(paths);
    let pro = store.upsert_space(space("Pro")).unwrap();
    let folder = store
        .upsert_folder(Folder {
            name: "Prod".into(),
            space_id: Some(pro.id.clone()),
            ..Folder::default()
        })
        .unwrap();
    let mut c = conn("A", "h");
    c.space_id = Some(pro.id.clone());
    c.folder_id = Some(folder.id.clone());
    store.upsert_connection(c).unwrap();

    store.remove_space(&pro.id).unwrap();
    assert_eq!(store.file().spaces.len(), 1);
    assert_eq!(store.file().folders[0].space_id.as_deref(), Some(MAIN_SPACE_ID));
    let moved = &store.file().connections[0];
    assert_eq!(moved.space_id.as_deref(), Some(MAIN_SPACE_ID));
    assert_eq!(moved.folder_id.as_deref(), Some(folder.id.as_str()), "folders move whole");
}

#[test]
fn the_last_space_cannot_be_removed() {
    let (_d, paths) = setup(None);
    let (mut store, _) = ConnectionsStore::load(paths);
    assert!(matches!(store.remove_space(MAIN_SPACE_ID), Err(ConfigError::Invalid(_))));
    let pro = store.upsert_space(space("Pro")).unwrap();
    store.remove_space(MAIN_SPACE_ID).unwrap();
    assert!(matches!(store.remove_space(&pro.id), Err(ConfigError::Invalid(_))));
}

#[test]
fn space_names_colors_and_icons_are_checked() {
    let (_d, paths) = setup(None);
    let (mut store, _) = ConnectionsStore::load(paths);
    assert_eq!(invalid_path(store.upsert_space(space("  "))), "name");
    let bad_color = Space { color: Some("red".into()), ..space("X") };
    assert_eq!(invalid_path(store.upsert_space(bad_color)), "color");
    let bad_icon = Space { icon: Some("dragon".into()), ..space("X") };
    assert_eq!(invalid_path(store.upsert_space(bad_icon)), "icon");
    let ok =
        Space { color: Some("#7AA2F7".into()), icon: Some("briefcase".into()), ..space(" Pro ") };
    assert_eq!(store.upsert_space(ok).unwrap().name, "Pro");
}

#[test]
fn import_matches_spaces_by_name() {
    let (_d, paths) = setup(None);
    let (mut store, _) = ConnectionsStore::load(paths);
    let pro = store.upsert_space(space("Pro")).unwrap();
    store
        .import(
            r#"{ "version": 1,
          "spaces": [ { "id": "x1", "name": "pro" }, { "id": "x2", "name": "Cloud" } ],
          "folders": [ { "id": "f1", "name": "Prod", "spaceId": "x1" } ],
          "connections": [
            { "id": "c1", "name": "web", "host": "web.example", "folderId": "f1", "spaceId": "x1" },
            { "id": "c2", "name": "vm", "host": "vm.example", "spaceId": "x2" } ] }"#,
        )
        .unwrap();
    let cloud = store.file().spaces.iter().find(|s| s.name == "Cloud").unwrap().id.clone();
    let by = |n: &str| store.file().connections.iter().find(|c| c.name == n).unwrap().clone();
    assert_eq!(by("web").space_id.as_deref(), Some(pro.id.as_str()));
    assert_eq!(by("vm").space_id.as_deref(), Some(cloud.as_str()));
    assert_eq!(store.file().folders[0].space_id.as_deref(), Some(pro.id.as_str()));
    assert_eq!(store.file().spaces.len(), 3);
}

#[test]
fn export_keeps_the_spaces() {
    let (_d, paths) = setup(None);
    let (mut store, _) = ConnectionsStore::load(paths);
    store.upsert_space(space("Pro")).unwrap();
    let text = store.export().unwrap();
    assert!(text.contains("\"spaces\""));
    assert!(text.contains("\"Pro\""));
}
