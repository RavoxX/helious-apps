use crate::app::{HeliousApp, Page};
use eframe::egui;
use egui_kittest::{kittest::Queryable, Harness};
use serde_json::json;
use std::time::{Duration, Instant};
#[test]
fn native_daily_properties_and_canvas_controls_save_guarded_files() {
    let folder = tempfile::tempdir().unwrap();
    let vault = tempfile::tempdir().unwrap();
    let mut harness = Harness::builder()
        .with_size(egui::vec2(1600.0, 1100.0))
        .with_accessibility_check(true)
        .build_eframe(|cc| HeliousApp::with_folder(cc, folder.path().into()));
    harness.state_mut().automatic_checks = false;
    harness.state_mut().next_poll = Instant::now() + Duration::from_secs(3600);
    settle(&mut harness);
    harness.state_mut().request(
        "open_local",
        json!({"operation":"open_local","path":vault.path()}),
    );
    settle(&mut harness);
    harness.get_by_label("Daily notes & templates").click();
    harness.step();
    harness.state_mut().authoring.day = "2026-10-31".into();
    harness.step();
    harness.get_by_label("Open daily note").click();
    settle(&mut harness);
    assert_eq!(harness.state().note["path"], "Daily/2026-10-31.md");
    harness.state_mut().markdown =
        "---\n# Keep my comment\nstatus: draft\n---\n# Daily body".into();
    harness.state_mut().authoring.property = "approved".into();
    harness.state_mut().authoring.kind = "boolean".into();
    harness.state_mut().authoring.value = "true".into();
    harness.get_by_label("Properties").click();
    harness.step();
    harness.get_by_label("Apply property to draft").click();
    settle(&mut harness);
    assert!(harness.state().markdown.contains("# Keep my comment"));
    assert!(harness.state().markdown.contains("true"));
    harness.state_mut().save();
    settle(&mut harness);
    let manifest = helious_native::extensions::validate(
        serde_json::from_str(helious_native::extensions::EXAMPLE).unwrap(),
    )
    .unwrap();
    harness.state_mut().extensions.installed = vec![helious_native::extensions::Installed {
        granted: manifest.permissions.clone(),
        manifest,
        enabled: true,
    }];
    harness.state_mut().extensions.selected = "meeting-tools/checklist".into();
    harness.get_by_label("Properties").click();
    harness.step();
    harness.get_by_label("Extensions").click();
    harness.step();
    harness.get_by_label("Preview command").click();
    harness.step();
    assert!(!harness.state().markdown.contains("## Meeting"));
    harness.get_by_label("Apply proposal to draft").click();
    harness.step();
    assert!(harness.state().markdown.contains("## Meeting"));
    assert!(
        !std::fs::read_to_string(vault.path().join("Daily/2026-10-31.md"))
            .unwrap()
            .contains("## Meeting")
    );
    harness.state_mut().save();
    settle(&mut harness);
    harness.get_by_label("Canvas").click();
    settle(&mut harness);
    harness.state_mut().canvas.new_path = "Canvas/Plan.canvas".into();
    harness.step();
    harness.get_by_label("Create canvas").click();
    settle(&mut harness);
    harness.state_mut().canvas.content = "Native canvas card".into();
    harness.step();
    harness.get_by_label("Add card").click();
    harness.step();
    assert!(harness.state().canvas.dirty());
    harness.get_by_label("Save canvas  Ctrl+S").click();
    settle(&mut harness);
    assert!(!harness.state().canvas.dirty());
    if let Ok(path) = std::env::var("HELIOUS_NATIVE_PREVIEW_DIR") {
        std::fs::create_dir_all(&path).unwrap();
        harness.step();
        harness
            .render()
            .unwrap()
            .save(std::path::Path::new(&path).join("windows-canvas-dark.png"))
            .unwrap();
    }

    assert!(
        std::fs::read_to_string(vault.path().join("Canvas/Plan.canvas"))
            .unwrap()
            .contains("Native canvas card")
    );
}
fn reading_ready(harness: &mut Harness<'_, HeliousApp>) {
    for _ in 0..500 {
        harness.step();
        if harness.state().reading.loaded
            && harness.state().pending.is_none()
            && harness.state().queued.is_empty()
        {
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!(
        "Native reading preview did not load: {}",
        harness.state().error
    );
}
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
        .with_accessibility_check(true)
        .build_eframe(|cc| HeliousApp::with_folder(cc, folder.path().into()));
    harness.state_mut().next_poll = Instant::now() + Duration::from_secs(3600);
    harness.state_mut().automatic_checks = false;
    settle(&mut harness);
    harness.get_by_label("Account").click();
    harness.step();
    assert!(harness.state().page == Page::Account);
    assert_eq!(harness.state().origin, "https://helious.work");
    harness.get_all_by_label("Settings").next().unwrap().click();
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
    let next = harness
        .state()
        .notes
        .iter()
        .find(|n| n["path"] == "Runbook.md")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    harness
        .state_mut()
        .markdown
        .push_str("\nAn unsaved thought.");
    harness.state_mut().select_note(&next);
    harness.step();
    harness.step();
    harness.step();
    assert!(harness.state().confirm_close);
    assert_eq!(harness.state().note["path"], "Architecture.md");
    harness.get_by_label("Keep editing").click();
    harness.step();
    assert!(harness.state().dirty());
    harness.state_mut().save();
    settle(&mut harness);
    harness.get_by_label("History").click();
    settle(&mut harness);
    assert!(
        harness.state().history["versions"]
            .as_array()
            .unwrap()
            .len()
            >= 2
    );
    harness.state_mut().history = serde_json::Value::Null;
    if let Ok(path) = std::env::var("HELIOUS_NATIVE_PREVIEW_DIR") {
        std::fs::create_dir_all(&path).unwrap();
        harness.state_mut().mode = 1;
        harness.step();
        std::thread::sleep(Duration::from_millis(400));
        harness.step();
        settle(&mut harness);
        reading_ready(&mut harness);
        harness
            .render()
            .unwrap()
            .save(std::path::Path::new(&path).join("windows-workspace-light.png"))
            .unwrap();
        harness.state_mut().theme = "dark".into();
        harness.step();
        reading_ready(&mut harness);
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
        harness.state_mut().page = Page::Settings;
        harness.state_mut().theme = "light".into();
        harness.step();
        harness
            .render()
            .unwrap()
            .save(std::path::Path::new(&path).join("windows-settings-light.png"))
            .unwrap();
    }
    harness.state_mut().page = Page::Workspace;
    harness.state_mut().new_path = "Created.md".into();
    harness.step();
    harness.get_by_label("+").click();
    settle(&mut harness);
    assert!(vault.path().join("Created.md").is_file());
    if harness.state().mode != 0 {
        reading_ready(&mut harness);
        settle(&mut harness);
    }
    harness.get_by_label("Delete note").click();
    harness.step();
    harness.step();
    harness.step();
    assert!(vault.path().join("Created.md").is_file());
    harness.get_by_label("Cancel").click();
    harness.step();
    assert!(!harness.state().confirm_delete);
    harness.get_by_label("Delete note").click();
    harness.step();
    harness.step();
    harness.step();
    harness.get_by_label("Confirm deletion").click();
    settle(&mut harness);
    assert!(!vault.path().join("Created.md").exists());
}

#[test]
fn folder_tree_tabs_search_rename_context_palette_and_graph_previews_work() {
    let folder = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let vault_dir = root.path().join("Helious Engineering");
    std::fs::create_dir_all(vault_dir.join("Projects")).unwrap();
    std::fs::create_dir_all(vault_dir.join("Operations")).unwrap();
    std::fs::write(
        vault_dir.join("Projects/Architecture.md"),
        "---\ntags:\n  - system\n  - native\nstatus: active\n---\n# Native Architecture\n\nHelious keeps notes as plain Markdown with `.helious/` history and Space isolation.\n\n## Core Principles\n\n- Local-first storage with atomic saves\n- Connected to [[/Operations/Runbook|Production Runbook]] and [[/Projects/Roadmap|Q4 Roadmap]]\n\n```rust\npub fn verify(hash: &str) -> bool { !hash.is_empty() }\n```\n\n## Sync Boundaries\n\nPersonal Spaces stay on this device unless explicitly mapped.",
    )
    .unwrap();
    std::fs::write(
        vault_dir.join("Projects/Roadmap.md"),
        "# Q4 Roadmap\n\nReview [[/Projects/Architecture|Native Architecture]] before tagging releases. #roadmap",
    )
    .unwrap();
    std::fs::write(
        vault_dir.join("Operations/Runbook.md"),
        "# Production Runbook\n\nFollow [[/Projects/Architecture]] checklists during deployment. #ops",
    )
    .unwrap();

    let mut harness = Harness::builder()
        .with_size(egui::vec2(1480.0, 940.0))
        .with_accessibility_check(true)
        .build_eframe(|cc| HeliousApp::with_folder(cc, folder.path().into()));
    harness.state_mut().automatic_checks = false;
    harness.state_mut().next_poll = Instant::now() + Duration::from_secs(3600);
    settle(&mut harness);

    harness.state_mut().request(
        "open_local",
        json!({"operation":"open_local","path":&vault_dir}),
    );
    settle(&mut harness);

    // Move all 3 notes into the shared Code Space so cross-note wikilinks & backlinks resolve!
    let code_space = harness
        .state()
        .spaces
        .iter()
        .find(|s| s["kind"] == "code")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    for path in [
        "Projects/Architecture.md",
        "Projects/Roadmap.md",
        "Operations/Runbook.md",
    ] {
        let id = harness
            .state()
            .notes
            .iter()
            .find(|n| n["path"] == path)
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        harness.state_mut().select_note(&id);
        settle(&mut harness);
        harness.state_mut().space = code_space.clone();
        harness.state_mut().save();
        settle(&mut harness);
    }

    // Open Architecture so tabs bar shows [Architecture.md, Roadmap.md, Runbook.md]
    let arch_id = harness
        .state()
        .notes
        .iter()
        .find(|n| n["path"] == "Projects/Architecture.md")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    harness.state_mut().select_note(&arch_id);
    settle(&mut harness);
    harness.state_mut().request_note_context();
    settle(&mut harness);
    assert_eq!(harness.state().tabs.len(), 3);
    assert_eq!(
        harness.state().inspector_state.context["backlinks"]
            .as_array()
            .unwrap()
            .len(),
        2
    );

    if let Ok(path) = std::env::var("HELIOUS_NATIVE_PREVIEW_DIR") {
        std::fs::create_dir_all(&path).unwrap();
        // Split mode dark preview (Explorer Tree + Tabs + Source + Reading + Context Inspector)
        harness.state_mut().mode = 2;
        harness.state_mut().theme = "dark".into();
        harness.step();
        std::thread::sleep(Duration::from_millis(400));
        harness.step();
        settle(&mut harness);
        reading_ready(&mut harness);
        harness
            .render()
            .unwrap()
            .save(std::path::Path::new(&path).join("windows-split-dark.png"))
            .unwrap();

        // Split mode light preview
        harness.state_mut().theme = "light".into();
        harness.step();
        std::thread::sleep(Duration::from_millis(400));
        harness.step();
        settle(&mut harness);
        reading_ready(&mut harness);
        harness
            .render()
            .unwrap()
            .save(std::path::Path::new(&path).join("windows-split-light.png"))
            .unwrap();

        // Command palette preview in dark mode
        harness.state_mut().theme = "dark".into();
        harness.state_mut().mode = 0;
        harness.state_mut().open_palette();
        harness.step();
        harness.step();
        harness
            .render()
            .unwrap()
            .save(std::path::Path::new(&path).join("windows-palette-dark.png"))
            .unwrap();
        harness.state_mut().palette.open = false;

        // Graph dark & light previews
        harness.state_mut().go(Page::Graph);
        settle(&mut harness);
        for _ in 0..40 {
            harness.step();
        }
        harness
            .render()
            .unwrap()
            .save(std::path::Path::new(&path).join("windows-graph-dark.png"))
            .unwrap();
        harness.state_mut().theme = "light".into();
        harness.step();
        harness.step();
        harness
            .render()
            .unwrap()
            .save(std::path::Path::new(&path).join("windows-graph-light.png"))
            .unwrap();
        harness.state_mut().theme = "dark".into();
        harness.state_mut().go(Page::Workspace);
        harness.step();
    }

    // Verify full-text search UI
    harness.get_by_label("Full-text search").click();
    harness.step();
    harness.state_mut().filter = "tag:system local-first".into();
    harness.step();
    harness.get_by_label("Search").click();
    settle(&mut harness);
    assert_eq!(harness.state().explorer.search_results.len(), 1);
    if let Ok(path) = std::env::var("HELIOUS_NATIVE_PREVIEW_DIR") {
        harness
            .input_mut()
            .events
            .push(egui::Event::PointerMoved(egui::pos2(24.0, 24.0)));
        harness.step();
        harness
            .render()
            .unwrap()
            .save(std::path::Path::new(&path).join("windows-search-dark.png"))
            .unwrap();
    }
    harness.get_by_label("Filter tree").click();
    harness.state_mut().filter.clear();
    harness.step();

    // Verify coordinated inline Rename UI
    harness.get_by_label("Rename…").click();
    harness.step();
    harness.state_mut().editor_tools.rename_path = "Projects/System-Architecture.md".into();
    harness.step();
    harness.get_by_label("Apply rename").click();
    settle(&mut harness);
    assert!(vault_dir.join("Projects/System-Architecture.md").is_file());
    assert!(!vault_dir.join("Projects/Architecture.md").exists());
    assert!(
        std::fs::read_to_string(vault_dir.join("Projects/Roadmap.md"))
            .unwrap()
            .contains("[[/Projects/System-Architecture|Native Architecture]]")
    );
}
