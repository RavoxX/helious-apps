use crate::app::{HeliousApp, Page};
use eframe::egui;
use egui_kittest::{kittest::Queryable, Harness};
use serde_json::json;
use std::time::{Duration, Instant};
fn settle(harness: &mut Harness<'_, HeliousApp>) {
    for _ in 0..150 {
        harness.step();
        if harness.state().pending.is_none() && harness.state().queued.is_empty() {
            harness.step();
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!(
        "Native worker did not settle: {:?}",
        harness.state().pending
    );
}
#[test]
fn native_navigation_settings_and_local_save_are_functional() {
    let folder = tempfile::tempdir().unwrap();
    let vault = tempfile::tempdir().unwrap();
    std::fs::write(
        vault.path().join("Architecture.md"),
        "# Architecture\n\nA local note, connected to [[Runbook]].",
    )
    .unwrap();
    std::fs::write(
        vault.path().join("Runbook.md"),
        "# Runbook\n\nKeep the context.",
    )
    .unwrap();
    let mut harness = Harness::builder()
        .with_size(egui::vec2(1440.0, 940.0))
        .with_accessibility_check(false)
        .build_eframe(|cc| HeliousApp::with_folder(cc, folder.path().into()));
    harness.state_mut().next_poll = Instant::now() + Duration::from_secs(3600);
    harness.state_mut().automatic_checks = false;
    settle(&mut harness);
    harness.get_by_label("Account").click();
    harness.step();
    assert!(harness.state().page == Page::Account);
    assert_eq!(harness.state().origin, "https://helious.work");
    harness
        .get_all_by_label("Settings")
        .first()
        .unwrap()
        .click();
    harness.step();
    assert!(harness.state().page == Page::Settings);
    harness.state_mut().theme = "light".into();
    harness.state_mut().font_size = 19.0;
    harness.state_mut().settings_dirty = true;
    harness.step();
    harness.get_by_label("Save settings").click();
    settle(&mut harness);
    let stored: serde_json::Value =
        serde_json::from_slice(&std::fs::read(folder.path().join("registry.json")).unwrap())
            .unwrap();
    assert_eq!(stored["settings"]["theme"], "light");
    harness.state_mut().request(
        "open_local",
        json!({"operation":"open_local","path":vault.path()}),
    );
    settle(&mut harness);
    let id = harness
        .state()
        .notes
        .iter()
        .find(|n| n["path"] == "Architecture.md")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    harness.state_mut().select_note(&id);
    settle(&mut harness);
    harness
        .state_mut()
        .markdown
        .push_str("\n\nSaved by the native UI test.");
    assert!(harness.state().dirty());
    harness.state_mut().save();
    settle(&mut harness);
    assert!(
        std::fs::read_to_string(vault.path().join("Architecture.md"))
            .unwrap()
            .contains("Saved by the native UI test.")
    );
    if let Ok(path) = std::env::var("HELIOUS_NATIVE_PREVIEW_DIR") {
        std::fs::create_dir_all(&path).unwrap();
        harness.state_mut().mode = 1;
        harness.step();
        harness
            .render()
            .unwrap()
            .save(std::path::Path::new(&path).join("windows-workspace-light.png"))
            .unwrap();
        harness.state_mut().theme = "dark".into();
        harness.step();
        harness
            .render()
            .unwrap()
            .save(std::path::Path::new(&path).join("windows-workspace-dark.png"))
            .unwrap();
        harness.state_mut().page = Page::Account;
        harness.step();
        harness
            .render()
            .unwrap()
            .save(std::path::Path::new(&path).join("windows-account.png"))
            .unwrap();
    }
}
