use crate::Engine;
use serde_json::json;
#[test]
fn native_daily_templates_canvas_cas_and_embed_spaces_are_preserved() {
    let settings = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    let mut engine = Engine::new(settings.path().into()).unwrap();
    let vault = engine
        .execute(json!({"operation":"open_local","path":folder.path()}))
        .unwrap();
    let id = &vault["id"];
    let spaces = vault["spaces"].as_array().unwrap();
    let personal = &spaces.iter().find(|s| s["kind"] == "personal").unwrap()["id"];
    let code = &spaces.iter().find(|s| s["kind"] == "code").unwrap()["id"];
    let template=engine.execute(json!({"operation":"create_note","source":"local","vaultId":id,"body":{"path":"Templates/Meeting.md","spaceId":code,"markdown":"# {{title}}\n\n{{date}} {{secret:key}}"}})).unwrap();
    let request = json!({"operation":"open_daily","source":"local","vaultId":id,"spaceId":code,"day":"2026-10-31","templateId":template["note"]["id"]});
    let daily = engine.execute(request.clone()).unwrap();
    assert!(daily["note"]["markdown"]
        .as_str()
        .unwrap()
        .contains("2026-10-31 {{secret:key}}"));
    std::fs::write(
        folder.path().join("Daily/2026-10-31.md"),
        "# Keep my existing daily note",
    )
    .unwrap();
    let reopened = engine.execute(request).unwrap();
    assert_eq!(reopened["note"]["id"], daily["note"]["id"]);
    assert_eq!(
        reopened["note"]["markdown"],
        "# Keep my existing daily note"
    );
    assert!(engine.execute(json!({"operation":"open_daily","source":"local","vaultId":id,"spaceId":personal,"day":"2026-10-31"})).is_err());
    engine.execute(json!({"operation":"create_note","source":"local","vaultId":id,"body":{"path":"Journal.md","spaceId":personal,"markdown":"PERSONAL-CANARY"}})).unwrap();
    assert!(engine.execute(json!({"operation":"reading_embed","source":"local","vaultId":id,"spaceId":code,"path":"Project.md","target":"Journal","syntax":"wiki"})).is_err());
    let board=engine.execute(json!({"operation":"canvas_save","source":"local","vaultId":id,"spaceId":code,"path":"Canvas/Plan.canvas","expected":null,"text":"{\"nodes\":[],\"edges\":[]}"})).unwrap();
    let expected = board["file"].clone();
    let next="{\"nodes\":[{\"id\":\"a\",\"type\":\"text\",\"text\":\"Keep\",\"x\":0,\"y\":0,\"width\":280,\"height\":180}],\"edges\":[]}";
    let saved=engine.execute(json!({"operation":"canvas_save","source":"local","vaultId":id,"spaceId":code,"path":"Canvas/Plan.canvas","expected":expected,"text":next})).unwrap();
    assert!(engine.execute(json!({"operation":"canvas_save","source":"local","vaultId":id,"spaceId":code,"path":"Canvas/Plan.canvas","expected":expected,"text":"{\"nodes\":[],\"edges\":[]}"})).is_err());
    assert_eq!(
        std::fs::read_to_string(folder.path().join("Canvas/Plan.canvas")).unwrap(),
        next
    );
    let opened=engine.execute(json!({"operation":"canvas_read","source":"local","vaultId":id,"spaceId":code,"id":saved["file"]["id"]})).unwrap();
    assert_eq!(opened["document"]["nodes"][0]["text"], "Keep");
}
#[test]
fn opens_existing_vault_edits_preserves_history_and_persists_native_settings() {
    let settings = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    std::fs::write(folder.path().join("Note.md"), "# Existing\n[[Other]]").unwrap();
    let mut engine = Engine::new(settings.path().into()).unwrap();
    let vault = engine
        .execute(json!({"operation":"open_local","path":folder.path()}))
        .unwrap();
    let id = vault["id"].clone();
    let notes = engine
        .execute(json!({"operation":"notes","source":"local","vaultId":id}))
        .unwrap();
    let note = &notes["notes"][0];
    assert_eq!(note["title"], "Existing");
    engine.execute(json!({"operation":"save_note","source":"local","vaultId":id,"id":note["id"],"body":{"path":note["path"],"hash":note["hash"],"markdown":"# Updated","spaceId":note["spaceId"]}})).unwrap();
    assert_eq!(
        std::fs::read_to_string(folder.path().join("Note.md")).unwrap(),
        "# Updated"
    );
    assert!(engine.execute(json!({"operation":"save_note","source":"local","vaultId":id,"id":note["id"],"body":{"path":note["path"],"hash":note["hash"],"markdown":"overwrite newer file","spaceId":note["spaceId"]}})).is_err());
    let history = engine
        .execute(json!({"operation":"history","source":"local","vaultId":id,"id":note["id"]}))
        .unwrap();
    assert!(history["versions"].as_array().unwrap().len() >= 2);
    engine.execute(json!({"operation":"settings","settings":{"theme":"light","fontSize":18,"automaticInstall":true}})).unwrap();
    drop(engine);
    let mut reopened = Engine::new(settings.path().into()).unwrap();
    let state = reopened.execute(json!({"operation":"status"})).unwrap();
    assert_eq!(state["settings"]["theme"], "light");
    assert_eq!(state["settings"]["automaticInstall"], true);
    assert_eq!(state["recent"][0]["id"], id);
    assert!(
        !std::fs::read_to_string(settings.path().join("registry.json"))
            .unwrap()
            .contains("password")
    );
}

#[test]
fn extension_grants_persist_and_disable_revokes_execution_without_saving_drafts() {
    let settings = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    let mut engine = Engine::new(settings.path().into()).unwrap();
    let manifest: serde_json::Value = serde_json::from_str(crate::extensions::EXAMPLE).unwrap();
    assert!(engine
        .execute(json!({"operation":"install_extension","manifest":manifest,"consent":false}))
        .is_err());
    engine
        .execute(json!({"operation":"install_extension","manifest":manifest,"consent":true}))
        .unwrap();
    let vault = engine
        .execute(json!({"operation":"open_local","path":folder.path()}))
        .unwrap();
    let note=engine.execute(json!({"operation":"create_note","source":"local","vaultId":vault["id"],"body":{"path":"Review.md","spaceId":vault["spaces"][0]["id"],"markdown":"# Saved"}})).unwrap();
    let req = json!({"operation":"run_extension","id":"meeting-tools","command":"checklist","markdown":"# Unsaved","path":"Review.md"});
    let result = engine.execute(req.clone()).unwrap();
    assert!(result["markdown"].as_str().unwrap().contains("# Unsaved"));
    assert_eq!(
        std::fs::read_to_string(folder.path().join("Review.md")).unwrap(),
        "# Saved"
    );
    assert_eq!(note["note"]["revision"], 1);
    drop(engine);
    let mut engine = Engine::new(settings.path().into()).unwrap();
    assert_eq!(
        engine.execute(json!({"operation":"extensions"})).unwrap()["extensions"][0]["granted"],
        manifest["permissions"]
    );
    engine
        .execute(json!({"operation":"enable_extension","id":"meeting-tools","enabled":false}))
        .unwrap();
    assert!(engine.execute(req.clone()).is_err());
    engine
        .execute(json!({"operation":"remove_extension","id":"meeting-tools"}))
        .unwrap();
    assert!(engine.execute(req).is_err());
}

#[test]
fn coordinated_rename_search_context_and_partial_settings_preserve_invariants() {
    let settings = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    let mut engine = Engine::new(settings.path().into()).unwrap();
    let vault = engine
        .execute(json!({"operation":"open_local","path":folder.path()}))
        .unwrap();
    let id = vault["id"].clone();
    let code = vault["spaces"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["kind"] == "code")
        .unwrap()["id"]
        .clone();

    let target = engine
        .execute(json!({
            "operation": "create_note",
            "source": "local",
            "vaultId": id,
            "body": {
                "path": "todo.md",
                "spaceId": code,
                "markdown": "# Launch Checklist\n\nSecret {{secret:prod_token}} and #release\n## Verification\nRun tests."
            }
        }))
        .unwrap()["note"]
        .clone();
    let linker = engine
        .execute(json!({
            "operation": "create_note",
            "source": "local",
            "vaultId": id,
            "body": {
                "path": "Overview.md",
                "spaceId": code,
                "markdown": "# Overview\n\nTrack [[todo|Launch Tasks]] before ship."
            }
        }))
        .unwrap()["note"]
        .clone();

    // Case-only rename on NTFS/APFS updates exact directory entry casing.
    let case_renamed = engine
        .execute(json!({
            "operation": "rename_note",
            "source": "local",
            "vaultId": id,
            "id": target["id"],
            "path": "TODO.md",
            "hash": target["hash"],
        }))
        .unwrap();
    assert_eq!(case_renamed["note"]["path"], "TODO.md");

    // Folder move rewrites inbound wikilinks atomically in the same Space.
    let moved = engine
        .execute(json!({
            "operation": "rename_note",
            "source": "local",
            "vaultId": id,
            "id": target["id"],
            "path": "Ops/Launch.md",
            "hash": case_renamed["note"]["hash"],
        }))
        .unwrap();
    assert_eq!(moved["note"]["path"], "Ops/Launch.md");
    assert_eq!(moved["updatedLinks"], 1);
    let updated_linker = engine
        .execute(json!({
            "operation": "read_note",
            "source": "local",
            "vaultId": id,
            "id": linker["id"],
        }))
        .unwrap();
    assert!(updated_linker["note"]["markdown"]
        .as_str()
        .unwrap()
        .contains("[[/Ops/Launch|Launch Tasks]]"));

    // Context exposes outline + backlinks; search finds tags/body and masks secrets.
    let ctx = engine
        .execute(json!({
            "operation": "note_context",
            "source": "local",
            "vaultId": id,
            "id": target["id"],
        }))
        .unwrap();
    assert_eq!(ctx["backlinks"].as_array().unwrap().len(), 1);
    assert_eq!(ctx["headings"].as_array().unwrap().len(), 2);

    let hits = engine
        .execute(json!({
            "operation": "search_notes",
            "source": "local",
            "vaultId": id,
            "query": "tag:release Verification",
        }))
        .unwrap();
    assert_eq!(hits["results"].as_array().unwrap().len(), 1);
    assert!(!hits["results"][0]["snippet"]
        .as_str()
        .unwrap()
        .contains("prod_token"));

    // History records local actions accurately rather than external-edit.
    let history = engine
        .execute(json!({
            "operation": "history",
            "source": "local",
            "vaultId": id,
            "id": target["id"],
        }))
        .unwrap();
    let actions: Vec<&str> = history["versions"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|v| v["action"].as_str())
        .collect();
    assert!(actions.contains(&"local-create"));
    assert!(actions.contains(&"local-move"));

    // Partial settings updates must preserve automaticInstall / automaticChecks.
    engine
        .execute(json!({
            "operation": "settings",
            "settings": {"theme": "dark", "fontSize": 17, "automaticChecks": false, "automaticInstall": true}
        }))
        .unwrap();
    let merged = engine
        .execute(json!({
            "operation": "settings",
            "settings": {"theme": "light", "fontSize": 18, "wrap": false}
        }))
        .unwrap();
    assert_eq!(merged["automaticChecks"], false);
    assert_eq!(merged["automaticInstall"], true);
}
