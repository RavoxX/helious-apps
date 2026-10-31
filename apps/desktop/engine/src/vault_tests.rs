use crate::vault::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::fs;
fn op(path: &str, expected: Option<String>, text: Option<&str>, space: &str) -> Operation {
    Operation {
        path: path.into(),
        expected_hash: expected,
        data: text.map(|s| STANDARD.encode(s)),
        space_id: space.into(),
        source_id: None,
    }
}
#[test]
fn plain_markdown_external_edits_cas_history_and_restart() {
    let folder = tempfile::tempdir().unwrap();
    fs::write(folder.path().join("Existing.md"), "# Existing\n").unwrap();
    let mut vault = Vault::open(folder.path().into()).unwrap();
    let personal = vault.config.spaces[0].id.clone();
    let code = vault.config.spaces[1].id.clone();
    let file = vault.config.files["existing.md"].clone();
    assert_eq!(file.space_id, personal);
    assert_eq!(file.revision, 1);
    vault
        .commit(vec![op("New.md", None, Some("# New"), &code)])
        .unwrap();
    assert_eq!(vault.config.files["new.md"].space_id, code);
    fs::write(folder.path().join("Existing.md"), "# External change").unwrap();
    assert!(vault
        .commit(vec![op(
            "Existing.md",
            Some(file.hash.clone()),
            Some("do not overwrite"),
            &personal
        )])
        .unwrap_err()
        .starts_with("CONFLICT:"));
    assert_eq!(
        fs::read_to_string(folder.path().join("Existing.md")).unwrap(),
        "# External change"
    );
    let current = vault.config.files["existing.md"].clone();
    assert_eq!(current.revision, 2);
    vault
        .commit(vec![op(
            "Existing.md",
            Some(current.hash),
            Some(""),
            &personal,
        )])
        .unwrap();
    assert_eq!(
        fs::read(folder.path().join("Existing.md")).unwrap(),
        Vec::<u8>::new()
    );
    let version = vault.history(&file.id, Some(1)).unwrap();
    assert_eq!(version["version"]["markdown"], "# Existing\n");
    let identifier = vault.config.id.clone();
    drop(vault);
    let reopened = Vault::open(folder.path().into()).unwrap();
    assert_eq!(reopened.config.id, identifier);
    assert_eq!(reopened.config.files["existing.md"].revision, 3);
}
#[test]
fn moves_keep_identity_and_delete_recovery_retains_content() {
    let folder = tempfile::tempdir().unwrap();
    fs::write(folder.path().join("Before.md"), "# Before").unwrap();
    let mut vault = Vault::open(folder.path().into()).unwrap();
    let before = vault.config.files["before.md"].clone();
    let mut create = op("Folder/After.md", None, Some("# After"), &before.space_id);
    create.source_id = Some(before.id.clone());
    vault
        .commit(vec![
            create,
            op("Before.md", Some(before.hash), None, &before.space_id),
        ])
        .unwrap();
    let moved = vault.config.files["folder/after.md"].clone();
    assert_eq!(moved.id, before.id);
    assert_eq!(moved.revision, 2);
    assert!(!folder.path().join("Before.md").exists());
    assert_eq!(
        vault.history(&before.id, Some(1)).unwrap()["version"]["path"],
        "Before.md"
    );
    vault
        .commit(vec![op(
            "Folder/After.md",
            Some(moved.hash),
            None,
            &moved.space_id,
        )])
        .unwrap();
    assert!(vault.config.files["folder/after.md"].deleted);
    vault
        .commit(vec![op(
            "Folder/After.md",
            None,
            Some("# Restored"),
            &moved.space_id,
        )])
        .unwrap();
    assert_eq!(vault.config.files["folder/after.md"].id, before.id);
    assert_eq!(vault.config.files["folder/after.md"].revision, 4);
}
#[test]
fn rejects_unsafe_paths_internal_writes_and_duplicate_processes() {
    for path in [
        "../escape.md",
        "/absolute.md",
        ".helious/vault.json",
        "CON.md",
        "folder/../x.md",
        "back\\slash.md",
        "file?.md",
    ] {
        assert!(logical(path).is_err(), "{}", path);
    }
    let folder = tempfile::tempdir().unwrap();
    let mut vault = Vault::open(folder.path().into()).unwrap();
    assert!(Vault::open(folder.path().into()).is_err());
    let personal = vault.config.spaces[0].id.clone();
    assert!(vault
        .commit(vec![op(".helious/escape.md", None, Some("no"), &personal)])
        .is_err());
    let too_large = "x".repeat(1024 * 1024 + 1);
    assert!(vault
        .commit(vec![op("Too large.md", None, Some(&too_large), &personal)])
        .is_err());
    assert!(!folder.path().join("Too large.md").exists());
}
#[test]
fn excluded_paths_never_reach_writes_or_recovery() {
    let folder = tempfile::tempdir().unwrap();
    fs::write(folder.path().join("Keep.md"), "keep").unwrap();
    fs::create_dir(folder.path().join("TARGET")).unwrap();
    fs::write(folder.path().join("TARGET/existing.md"), "external").unwrap();
    let mut vault = Vault::open(folder.path().into()).unwrap();
    let space = vault.config.spaces[0].id.clone();
    assert!(!vault.config.files.contains_key("target/existing.md"));
    for path in [
        ".npmrc",
        ".git/hooks/pre-commit",
        "nested/.cargo/config.toml",
        "node_modules/tool.js",
        "Node_Modules/tool.js",
        "notes/TARGET/file.md",
    ] {
        // A batch must fail before even its first legitimate write.
        assert!(
            vault
                .commit(vec![
                    op("New.md", None, Some("new"), &space),
                    op(path, None, Some("untrusted"), &space)
                ])
                .is_err(),
            "{path}"
        );
        assert!(!folder.path().join("New.md").exists());
        assert!(!folder.path().join(path).exists());
        assert!(!folder.path().join(".helious/pending.json").exists());
        assert!(read(folder.path(), path, false).is_err());
        assert!(atomic(folder.path(), path, b"untrusted", false).is_err());
    }
    // Old or tampered journals cannot bypass the same filesystem boundary.
    atomic(
        folder.path(),
        ".helious/pending.json",
        &serde_json::to_vec(&vec![
            op("New.md", None, Some("new"), &space),
            op(".npmrc", None, Some("untrusted"), &space),
        ])
        .unwrap(),
        true,
    )
    .unwrap();
    drop(vault);
    assert!(Vault::open(folder.path().into()).is_err());
    assert!(!folder.path().join(".npmrc").exists());
    assert!(!folder.path().join("New.md").exists());
    assert_eq!(
        fs::read_to_string(folder.path().join("Keep.md")).unwrap(),
        "keep"
    );
    assert_eq!(
        fs::read_to_string(folder.path().join("TARGET/existing.md")).unwrap(),
        "external"
    );
    assert!(folder.path().join(".helious/pending.json").exists());
}
#[test]
fn interrupted_journal_replays_and_preserves_concurrent_edits() {
    let folder = tempfile::tempdir().unwrap();
    fs::write(folder.path().join("Note.md"), "old").unwrap();
    let vault = Vault::open(folder.path().into()).unwrap();
    let note = vault.config.files["note.md"].clone();
    let pending = vec![op(
        "Note.md",
        Some(note.hash.clone()),
        Some("staged"),
        &note.space_id,
    )];
    atomic(
        &vault.root,
        ".helious/pending.json",
        &serde_json::to_vec(&pending).unwrap(),
        true,
    )
    .unwrap();
    drop(vault);
    let vault = Vault::open(folder.path().into()).unwrap();
    assert_eq!(
        fs::read_to_string(folder.path().join("Note.md")).unwrap(),
        "staged"
    );
    assert!(!folder.path().join(".helious/pending.json").exists());
    atomic(
        &vault.root,
        ".helious/pending.json",
        &serde_json::to_vec(&pending).unwrap(),
        true,
    )
    .unwrap();
    drop(vault);
    fs::write(folder.path().join("Note.md"), "another editor").unwrap();
    let vault = Vault::open(folder.path().into()).unwrap();
    assert_eq!(
        fs::read_to_string(folder.path().join("Note.md")).unwrap(),
        "another editor"
    );
    assert!(fs::read_dir(folder.path()).unwrap().any(|e| e
        .unwrap()
        .file_name()
        .to_string_lossy()
        .contains("conflict")));
    drop(vault);
}
#[cfg(windows)]
#[test]
fn refuses_junctions_and_does_not_index_their_targets() {
    let folder = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("Private.md"), "outside").unwrap();
    let linked = folder.path().join("linked");
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&linked)
        .arg(outside.path())
        .output()
        .unwrap();
    assert!(status.status.success());
    let vault = Vault::open(folder.path().into()).unwrap();
    assert!(vault.config.files.is_empty());
    assert!(read(&vault.root, "linked/Private.md", false).is_err());
    fs::remove_dir(linked).unwrap();
}
