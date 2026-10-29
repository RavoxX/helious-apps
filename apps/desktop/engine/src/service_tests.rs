use crate::Engine;
use serde_json::json;
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
