//! Destination screens: Welcome, Account, Sync and Settings for Helious Windows.
use crate::{
    app::{string, HeliousApp, Page},
    chrome::{badge_pill, card, nav_item_indented, palette, primary_button},
};
use eframe::egui::{self, RichText};
use serde_json::{json, Value};

impl HeliousApp {
    pub fn workspace(&mut self, ui: &mut egui::Ui) {
        if self.vault.is_null() {
            self.welcome(ui);
            return;
        }
        self.show_explorer(ui);
        self.show_inspector(ui);
        self.show_editor_pane(ui);
    }

    pub fn create_note(&mut self) {
        if self.dirty() {
            self.error = "Save or discard the current draft before creating a note.".into();
            return;
        }
        let trimmed = self.new_path.trim();
        if trimmed.is_empty() {
            return;
        }
        let path = if trimmed.to_lowercase().ends_with(".md") {
            trimmed.to_string()
        } else {
            format!("{trimmed}.md")
        };
        let target_space = if !self.explorer.space_filter.is_empty() {
            json!(self.explorer.space_filter)
        } else {
            self.spaces
                .iter()
                .find(|s| s["kind"] == "personal")
                .or_else(|| self.spaces.first())
                .map(|s| s["id"].clone())
                .unwrap_or(Value::Null)
        };
        let mut req = self.scope("create_note");
        req["body"] = json!({"path":path,"markdown":"","spaceId":target_space});
        self.request("create_note", req);
    }

    fn welcome(&mut self, ui: &mut egui::Ui) {
        ui.add_space(56.0);
        ui.vertical_centered(|ui| {
            ui.set_max_width(640.0);
            ui.heading("A calm home for what you know.");
            ui.add_space(4.0);
            ui.weak("Plain Markdown on disk with version history in .helious. Sign in when you want Cloud vaults or selective Space sync.");
            ui.add_space(22.0);
            ui.columns(2, |columns| {
                card(&mut columns[0], "On this device", |ui| {
                    ui.weak("Open any folder of Markdown notes. Works completely offline.");
                    ui.add_space(8.0);
                    let dark = ui.visuals().dark_mode;
                    if ui
                        .add(primary_button("Open or create a local vault", dark))
                        .clicked()
                    {
                        self.open_folder();
                    }
                });
                card(&mut columns[1], "Helious Cloud", |ui| {
                    if self.me.is_null() {
                        ui.weak("Reach server vaults and sync explicitly selected Spaces.");
                        ui.add_space(8.0);
                        if ui.button("Sign in to Helious Cloud").clicked() {
                            self.page = Page::Account;
                        }
                    } else {
                        ui.weak(format!(
                            "Connected as {}. Open a Cloud vault from the sidebar.",
                            string(&self.me, "email")
                        ));
                    }
                });
            });

            let recent = self.status["recent"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            if !recent.is_empty() {
                ui.add_space(18.0);
                card(ui, "Recent local vaults", |ui| {
                    for item in recent.iter().take(5) {
                        let name = string(item, "name");
                        let path = string(item, "path");
                        if nav_item_indented(ui, false, name, 0.0, Some(path)).clicked() {
                            self.navigate(json!({"operation":"open_recent","id":item["id"]}));
                        }
                    }
                });
            }
        });
    }

    pub fn account(&mut self, ui: &mut egui::Ui) {
        let colors = palette(ui.visuals().dark_mode);
        ui.add_space(20.0);
        ui.heading("Account");
        ui.add_space(4.0);
        if !self.me.is_null() {
            ui.weak("Signed in via Windows Credential Manager. Local folders always stay available offline.");
            ui.add_space(16.0);
            let name = {
                let n = string(&self.me, "name");
                if n.is_empty() {
                    "Connected account".to_owned()
                } else {
                    n.to_owned()
                }
            };
            card(ui, &name, |ui| {
                ui.horizontal(|ui| {
                    ui.label(string(&self.me, "email"));
                    badge_pill(
                        ui,
                        if self.me["totpEnabled"] == true {
                            "2FA active"
                        } else {
                            "Session active"
                        },
                        colors.success,
                    );
                });
                ui.weak(&self.origin);
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    if ui.button("Refresh Cloud vaults").clicked() {
                        self.api("server_vaults", "/api/vaults".into(), "GET", Value::Null);
                    }
                    if ui.button("Sign out").clicked() {
                        self.navigate(json!({"operation":"logout"}));
                    }
                });
            });
            ui.add_space(14.0);
            card(ui, "Cloud vaults", |ui| {
                for item in self.server_vaults.clone() {
                    if nav_item_indented(ui, false, string(&item, "name"), 0.0, Some("Open"))
                        .clicked()
                    {
                        self.navigate(json!({"operation":"open_server","vault":item}));
                    }
                }
                if self.server_vaults.is_empty() {
                    ui.weak("No Cloud vaults yet. Create one below.");
                }
                ui.add_space(6.0);
                ui.horizontal(|ui| {
                    ui.add(
                        egui::TextEdit::singleline(&mut self.new_path)
                            .hint_text("New Cloud vault name")
                            .char_limit(100),
                    );
                    if ui
                        .add_enabled(
                            !self.new_path.trim().is_empty(),
                            egui::Button::new("Create vault"),
                        )
                        .clicked()
                    {
                        self.api(
                            "create_vault",
                            "/api/vaults".into(),
                            "POST",
                            json!({"name":self.new_path}),
                        );
                    }
                });
            });
            ui.add_space(14.0);
            card(ui, "Security & access", |ui| {
                ui.label(if self.me["totpEnabled"] == true {
                    "Two-factor authentication is enabled."
                } else {
                    "Two-factor authentication is not enabled. Set it up in account security."
                });
                ui.weak("Sessions, password, two-factor authentication, secrets and agent tokens are managed in your server's secure account pages.");
                if ui.button("Open security settings in browser").clicked() {
                    let _ = open::that(format!("{}/app/", self.origin));
                }
            });
            return;
        }

        ui.weak("Sign in to access server vaults. Your local folders stay available offline.");
        ui.add_space(16.0);
        ui.scope(|ui| {
            ui.set_max_width(480.0);
            card(ui, "Sign in", |ui| {
                ui.horizontal(|ui| {
                    if ui
                        .selectable_label(!self.custom_server, "Helious Cloud")
                        .clicked()
                    {
                        self.custom_server = false;
                        self.origin = helious_native::CLOUD_ORIGIN.into();
                    }
                    if ui
                        .selectable_label(self.custom_server, "Self-hosted server")
                        .clicked()
                    {
                        self.custom_server = true;
                    }
                });
                ui.add_space(6.0);
                if self.custom_server {
                    let label = ui.label("Server address");
                    ui.add(
                        egui::TextEdit::singleline(&mut self.origin)
                            .hint_text("https://your-server.example")
                            .desired_width(f32::INFINITY),
                    )
                    .labelled_by(label.id);
                } else {
                    ui.weak("https://helious.work · HTTPS + OS keyring session");
                }
                let label = ui.label("Email address");
                ui.add(
                    egui::TextEdit::singleline(&mut self.email)
                        .hint_text("you@example.com")
                        .desired_width(f32::INFINITY),
                )
                .labelled_by(label.id);
                let label = ui.label("Password");
                ui.add(
                    egui::TextEdit::singleline(&mut self.password)
                        .hint_text("Account password")
                        .password(!self.show_password)
                        .desired_width(f32::INFINITY),
                )
                .labelled_by(label.id);
                ui.checkbox(&mut self.show_password, "Show password");
                let label = ui.label("Authenticator or recovery code (if enabled)");
                ui.add(
                    egui::TextEdit::singleline(&mut self.factor)
                        .hint_text("6-digit TOTP or recovery code")
                        .desired_width(f32::INFINITY),
                )
                .labelled_by(label.id);
                ui.add_space(8.0);
                let dark = ui.visuals().dark_mode;
                if ui
                    .add_enabled(
                        self.pending.is_none()
                            && !self.email.is_empty()
                            && !self.password.is_empty(),
                        primary_button(
                            if self.pending.as_deref() == Some("login") {
                                "Signing in…"
                            } else {
                                "Sign in"
                            },
                            dark,
                        ),
                    )
                    .clicked()
                {
                    self.request(
                        "login",
                        json!({"operation":"login","origin":self.origin,"email":self.email,"password":self.password,"code":self.factor}),
                    );
                    self.password.clear();
                    self.factor.clear();
                }
                ui.add_space(4.0);
                ui.horizontal(|ui| {
                    if ui.link("Create account").clicked() {
                        if let Ok(origin) = helious_native::remote::origin(&self.origin) {
                            let _ = open::that(format!("{}/app/", origin));
                        }
                    }
                    if ui.link("Forgot password?").clicked() {
                        if let Ok(origin) = helious_native::remote::origin(&self.origin) {
                            let _ = open::that(format!("{}/forgot-password", origin));
                        }
                    }
                });
            });
            ui.add_space(12.0);
            ui.weak("Sessions are kept in Windows Credential Manager. Your password is never saved. If Cloud is unavailable, open a local vault from the sidebar.");
        });
    }

    pub fn settings(&mut self, ui: &mut egui::Ui) {
        ui.add_space(20.0);
        ui.heading("Settings");
        ui.add_space(12.0);
        card(ui, "Appearance", |ui| {
            ui.horizontal(|ui| {
                for (value, label) in [
                    ("dark", "Dark (Near-black)"),
                    ("light", "Light"),
                    ("system", "Match Windows"),
                ] {
                    if ui
                        .selectable_value(&mut self.theme, value.into(), label)
                        .changed()
                    {
                        self.settings_dirty = true;
                    }
                }
            });
        });
        ui.add_space(12.0);
        card(ui, "Editor", |ui| {
            self.settings_dirty |= ui
                .add(
                    egui::Slider::new(&mut self.font_size, 12.0..=28.0)
                        .text("Text size")
                        .step_by(1.0),
                )
                .changed();
            self.settings_dirty |= ui.checkbox(&mut self.wrap, "Wrap long lines").changed();
        });
        ui.add_space(12.0);
        card(ui, "Updates", |ui| {
            self.settings_dirty |= ui
                .checkbox(
                    &mut self.automatic_checks,
                    "Check GitHub for updates automatically",
                )
                .changed();
            self.settings_dirty |= ui
                .checkbox(
                    &mut self.automatic_install,
                    "Download and install automatically when no draft is open",
                )
                .changed();
            ui.weak("Updates come from RavoxX/helious-apps and must pass Ed25519 signature and SHA-256 checksum verification.");
            ui.horizontal(|ui| {
                if ui
                    .add_enabled(
                        self.pending.is_none(),
                        egui::Button::new("Check for updates"),
                    )
                    .clicked()
                {
                    self.request("check_update", json!({"operation":"check_update"}));
                }
                if self.update["available"] == true
                    && !self.update_ready
                    && ui
                        .add_enabled(self.pending.is_none(), egui::Button::new("Download update"))
                        .clicked()
                {
                    self.request("download_update", json!({"operation":"download_update"}));
                }
                if self.update_ready
                    && ui
                        .add_enabled(
                            self.pending.is_none() && !self.dirty(),
                            egui::Button::new("Update and restart"),
                        )
                        .clicked()
                {
                    self.request("install_update", json!({"operation":"install_update"}));
                }
            });
            if self.update_ready && self.dirty() {
                ui.weak("Save your current draft before installing.");
            }
        });
        ui.add_space(12.0);
        ui.horizontal(|ui| {
            let dark = ui.visuals().dark_mode;
            if ui
                .add_enabled(
                    self.settings_dirty && self.pending.is_none(),
                    primary_button("Save settings", dark),
                )
                .clicked()
            {
                self.request(
                    "settings",
                    json!({"operation":"settings","settings":{"theme":self.theme,"fontSize":self.font_size as u64,"wrap":self.wrap,"automaticChecks":self.automatic_checks,"automaticInstall":self.automatic_install}}),
                );
            }
            if self.settings_dirty {
                ui.weak("Appearance, editor and update changes are not saved yet.");
            }
        });
        ui.add_space(18.0);
        card(ui, "Extensions", |ui| self.extension_manager(ui));
        ui.add_space(12.0);
        card(ui, "Storage", |ui| {
            ui.label("Local vaults contain plain Markdown and a .helious folder for history and sync checkpoints. Back up both.");
            ui.weak(self.data_folder.to_string_lossy());
            if ui.button("Open desktop settings folder").clicked() {
                let _ = open::that(&self.data_folder);
            }
        });
        ui.add_space(12.0);
        card(ui, "Keyboard shortcuts", |ui| {
            egui::Grid::new("shortcuts")
                .spacing([28.0, 8.0])
                .show(ui, |ui| {
                    for (key, action) in [
                        ("Ctrl+K / Ctrl+P", "Quick switcher & command palette"),
                        ("Ctrl+S", "Save active note or canvas"),
                        ("Ctrl+O", "Open local vault folder"),
                        ("Ctrl+F", "Find and replace in note"),
                        ("F2", "Move or rename active note"),
                        ("Ctrl+B", "Toggle left navigation sidebar"),
                        ("Ctrl+,", "Open Settings"),
                    ] {
                        ui.monospace(key);
                        ui.label(action);
                        ui.end_row();
                    }
                });
        });
        ui.add_space(12.0);
        card(ui, "About", |ui| {
            ui.label(format!(
                "Helious {} · Rust / egui / eframe / wgpu",
                env!("CARGO_PKG_VERSION")
            ));
            ui.weak("Windows uses a native GPU-rendered interface, with no webview and no application menu strip.");
        });
        ui.add_space(24.0);
    }

    pub fn sync(&mut self, ui: &mut egui::Ui) {
        ui.add_space(20.0);
        ui.heading("Sync");
        ui.weak(
            "Pair a local vault with explicitly chosen server Spaces. Unmapped Personal Spaces stay strictly on this device.",
        );
        ui.add_space(14.0);
        card(ui, "Space pairing", |ui| self.sync_pairing(ui));
    }

    fn sync_pairing(&mut self, ui: &mut egui::Ui) {
        let colors = palette(ui.visuals().dark_mode);
        if self.source != "local" || self.vault.is_null() {
            ui.label("Open a local folder first, then return here to configure its sync.");
            return;
        }
        if self.me.is_null() {
            if ui
                .button("Sign in to Cloud or a self-hosted server")
                .clicked()
            {
                self.page = Page::Account;
            }
            return;
        }
        if !self.sync_config.is_null() {
            ui.horizontal(|ui| {
                ui.label(
                    RichText::new(format!(
                        "Paired with {}",
                        string(&self.sync_config, "serverOrigin")
                    ))
                    .strong(),
                );
                badge_pill(ui, "Paired", colors.success);
            });
            let last = string(&self.sync_config, "lastSync");
            if !last.is_empty() {
                ui.small(format!("Last completed sync: {last}"));
            }
            ui.add_space(6.0);
            let dark = ui.visuals().dark_mode;
            if ui
                .add_enabled(
                    self.pending.is_none() && !self.dirty(),
                    primary_button("Sync now", dark),
                )
                .clicked()
            {
                self.request(
                    "sync",
                    json!({"operation":"sync","vaultId":self.vault["id"]}),
                );
            }
            for conflict in self.sync_config["conflicts"]
                .as_object()
                .into_iter()
                .flat_map(|m| m.values())
                .cloned()
                .collect::<Vec<_>>()
            {
                ui.separator();
                ui.colored_label(
                    colors.warn,
                    format!("Conflict: {}", string(&conflict, "path")),
                );
                ui.weak(format!("Preserved copy: {}", string(&conflict, "copy")));
                ui.horizontal(|ui| {
                    for (choice, label) in [
                        ("local", "Use local version"),
                        ("server", "Use server version"),
                    ] {
                        if ui
                            .add_enabled(
                                self.pending.is_none() && !self.dirty(),
                                egui::Button::new(label),
                            )
                            .clicked()
                        {
                            self.request(
                                "resolve_sync",
                                json!({"operation":"resolve_sync","vaultId":self.vault["id"],"path":conflict["path"],"choice":choice}),
                            );
                        }
                    }
                });
            }
            ui.add_space(16.0);
            if ui.button("Stop pairing (keep files)").clicked() {
                self.mappings = json!({});
                self.request(
                    "local_config",
                    json!({"operation":"local_config","vaultId":self.vault["id"],"value":{"sync":null}}),
                );
            }
            return;
        }

        let mut changed = false;
        ui.label("Target server vault");
        egui::ComboBox::from_id_salt("sync-server-vault")
            .width(280.0)
            .selected_text(
                self.server_vaults
                    .iter()
                    .find(|v| v["id"] == self.sync_vault)
                    .map(|v| string(v, "name"))
                    .unwrap_or("Choose server vault"),
            )
            .show_ui(ui, |ui| {
                for vault in &self.server_vaults {
                    changed |= ui
                        .selectable_value(
                            &mut self.sync_vault,
                            string(vault, "id").into(),
                            string(vault, "name"),
                        )
                        .changed();
                }
            });
        if changed {
            self.mappings = json!({});
            self.personal_confirm = false;
            self.api(
                "remote_spaces",
                format!("/api/vaults/{}/spaces", self.sync_vault),
                "GET",
                Value::Null,
            );
        }

        ui.add_space(8.0);
        let mut has_personal = false;
        egui::Grid::new("sync-space-grid")
            .spacing([18.0, 8.0])
            .show(ui, |ui| {
                for local in self.spaces.clone() {
                    ui.horizontal(|ui| {
                        ui.label(string(&local, "name"));
                        if local["kind"] == "personal" {
                            badge_pill(ui, "Personal", colors.warn);
                        }
                    });
                    ui.weak("→");
                    let key = string(&local, "id");
                    let mut selected = self.mappings[key].as_str().unwrap_or("").to_string();
                    egui::ComboBox::from_id_salt(key)
                        .width(200.0)
                        .selected_text(
                            self.remote_spaces
                                .iter()
                                .find(|s| s["id"] == selected)
                                .map(|s| string(s, "name"))
                                .unwrap_or("Do not sync"),
                        )
                        .show_ui(ui, |ui| {
                            ui.selectable_value(&mut selected, String::new(), "Do not sync");
                            for remote in &self.remote_spaces {
                                ui.selectable_value(
                                    &mut selected,
                                    string(remote, "id").into(),
                                    string(remote, "name"),
                                );
                            }
                        });
                    if selected.is_empty() {
                        self.mappings.as_object_mut().unwrap().remove(key);
                    } else {
                        self.mappings[key] = json!(selected);
                        if local["kind"] == "personal"
                            || self
                                .remote_spaces
                                .iter()
                                .any(|s| s["id"] == selected && s["kind"] == "personal")
                        {
                            has_personal = true;
                        }
                    }
                    ui.end_row();
                }
            });

        if has_personal {
            ui.add_space(6.0);
            ui.checkbox(
                &mut self.personal_confirm,
                "I explicitly want to sync the selected Personal Space.",
            );
        }
        ui.add_space(8.0);
        let dark = ui.visuals().dark_mode;
        if ui
            .add_enabled(
                !self.sync_vault.is_empty()
                    && self.pending.is_none()
                    && (!has_personal || self.personal_confirm)
                    && self.mappings.as_object().is_some_and(|m| !m.is_empty()),
                primary_button("Save sync pairing", dark),
            )
            .clicked()
        {
            let config = json!({"schema":1,"serverOrigin":self.origin,"ownerId":self.me["id"],"vaultId":self.sync_vault,"mappings":self.mappings,"base":{},"conflicts":{},"auto":false});
            self.request(
                "local_config",
                json!({"operation":"local_config","vaultId":self.vault["id"],"value":{"sync":config},"confirmPersonal":self.personal_confirm}),
            );
        }
    }
}
