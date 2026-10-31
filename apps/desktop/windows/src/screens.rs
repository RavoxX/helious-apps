use crate::app::{string, HeliousApp, Page};
use crate::chrome::{card, danger_button, primary_button};
use eframe::egui::{self, RichText};
use serde_json::{json, Value};
impl HeliousApp {
    pub fn workspace(&mut self, ui: &mut egui::Ui) {
        if self.vault.is_null() {
            self.welcome(ui);
            return;
        }
        egui::Panel::left("file-explorer")
            .default_size(260.0)
            .size_range(200.0..=420.0)
            .show(ui, |ui| {
                ui.add_space(10.0);
                ui.horizontal(|ui| {
                    ui.label(RichText::new("Notes").size(18.0).strong());
                    ui.weak(self.notes.len().to_string());
                });
                ui.add(
                    egui::TextEdit::singleline(&mut self.filter)
                        .hint_text("Search notes…")
                        .desired_width(f32::INFINITY),
                );
                ui.horizontal(|ui| {
                    let width = ui.available_width() - 44.0;
                    ui.add(
                        egui::TextEdit::singleline(&mut self.new_path)
                            .hint_text("New note, e.g. Ideas/Plan.md")
                            .desired_width(width),
                    );
                    if ui
                        .add_enabled(
                            !self.new_path.trim().is_empty() && self.pending.is_none(),
                            egui::Button::new("+"),
                        )
                        .on_hover_text("Create note")
                        .clicked()
                    {
                        self.create_note();
                    }
                });
                self.authoring_tools(ui);
                ui.separator();
                let filter = self.filter.to_lowercase();
                let notes: Vec<_> = self
                    .notes
                    .iter()
                    .filter(|n| {
                        string(n, "path").to_lowercase().contains(&filter)
                            || string(n, "title").to_lowercase().contains(&filter)
                    })
                    .cloned()
                    .collect();
                egui::ScrollArea::vertical()
                    .id_salt("notes-list")
                    .show(ui, |ui| {
                        let mut folder = String::new();
                        for item in &notes {
                            let path = string(item, "path");
                            let parent = path.rsplit_once('/').map(|(p, _)| p).unwrap_or("Vault root");
                            if folder != parent {
                                folder = parent.into();
                                crate::chrome::section_label(ui, &parent.to_uppercase());
                            }
                            let name = path.rsplit('/').next().unwrap_or(path);
                            if crate::chrome::nav_item(ui, item["id"] == self.note["id"], name)
                                .on_hover_text(path)
                                .clicked()
                            {
                                self.select_note(string(item, "id"));
                            }
                        }
                        if self.notes.is_empty() {
                            ui.add_space(16.0);
                            ui.weak("No notes yet. Name one above and press +. Markdown files added by another editor also appear here.");
                        } else if notes.is_empty() {
                            ui.add_space(16.0);
                            ui.weak("No notes match your search.");
                        }
                    });
            });
        if self.inspector && !self.note.is_null() {
            egui::Panel::right("note-inspector")
                .default_size(300.0)
                .size_range(240.0..=440.0)
                .show(ui, |ui| {
                    egui::ScrollArea::vertical()
                        .id_salt("inspector-scroll")
                        .show(ui, |ui| self.inspector_panel(ui));
                });
        }
        egui::CentralPanel::default().show(ui, |ui| {
            if self.note.is_null() {
                ui.add_space(90.0);
                ui.vertical_centered(|ui| {
                    ui.heading("Choose a note");
                    ui.weak("Pick a file in the explorer, or name a new note and press +.");
                });
                return;
            }
            let path = string(&self.note, "path").to_string();
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                ui.vertical(|ui| {
                    ui.label(
                        RichText::new(path.rsplit('/').next().unwrap_or(&path))
                            .size(20.0)
                            .strong(),
                    );
                    if self.dirty() {
                        ui.label(
                            RichText::new("Unsaved changes")
                                .small()
                                .color(ui.visuals().warn_fg_color),
                        );
                    } else {
                        ui.small(RichText::new(format!("{path} · Saved")).weak());
                    }
                });
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let dark = ui.visuals().dark_mode;
                    if ui
                        .add_enabled(self.pending.is_none(), primary_button("Save  Ctrl+S", dark))
                        .clicked()
                    {
                        self.save();
                    }
                    if ui
                        .selectable_label(self.inspector, "Inspector")
                        .on_hover_text("Show Space, properties, extensions and version history")
                        .clicked()
                    {
                        self.inspector = !self.inspector;
                    }
                });
            });
            ui.add_space(4.0);
            ui.horizontal(|ui| {
                for (i, label) in ["Source", "Reading", "Split"].iter().enumerate() {
                    if ui.selectable_label(self.mode == i as u8, *label).clicked() {
                        self.mode = i as u8;
                    }
                }
            });
            ui.separator();
            let editor = |ui: &mut egui::Ui, app: &mut HeliousApp| {
                egui::ScrollArea::both()
                    .id_salt("source-editor")
                    .show(ui, |ui| {
                        ui.add_enabled(
                            app.pending.as_deref() != Some("save_note"),
                            egui::TextEdit::multiline(&mut app.markdown)
                                .font(egui::FontId::monospace(app.font_size))
                                .desired_width(if app.wrap {
                                    ui.available_width()
                                } else {
                                    10000.0
                                })
                                .desired_rows(35)
                                .frame(egui::Frame::NONE)
                                .code_editor(),
                        )
                        .on_hover_text("Markdown source editor");
                    });
            };
            let preview = |ui: &mut egui::Ui, app: &mut HeliousApp| {
                app.reading_preview(ui);
            };
            if self.mode == 2 {
                ui.columns(2, |columns| {
                    editor(&mut columns[0], self);
                    preview(&mut columns[1], self);
                });
            } else if self.mode == 1 {
                preview(ui, self);
            } else {
                editor(ui, self);
            }
        });
    }
    fn create_note(&mut self) {
        if self.dirty() {
            self.error = "Save or discard the current draft before creating a note.".into();
            return;
        }
        let path = if self.new_path.ends_with(".md") {
            self.new_path.clone()
        } else {
            format!("{}.md", self.new_path)
        };
        let mut req = self.scope("create_note");
        req["body"] = json!({"path":path,"markdown":"","spaceId":self.spaces.iter().find(|s|s["kind"]=="personal").map(|s|s["id"].clone()).unwrap_or(Value::Null)});
        self.request("create_note", req);
    }
    fn inspector_panel(&mut self, ui: &mut egui::Ui) {
        ui.add_space(10.0);
        ui.label(RichText::new("Note").size(16.0).strong());
        ui.weak(string(&self.note, "path"));
        ui.add_space(4.0);
        ui.label("Space");
        egui::ComboBox::from_id_salt("note-space")
            .width(ui.available_width())
            .selected_text(
                self.spaces
                    .iter()
                    .find(|s| s["id"] == self.space)
                    .map(|s| string(s, "name"))
                    .unwrap_or("Space"),
            )
            .show_ui(ui, |ui| {
                for s in &self.spaces {
                    ui.selectable_value(
                        &mut self.space,
                        string(s, "id").to_string(),
                        string(s, "name"),
                    );
                }
            });
        ui.horizontal_wrapped(|ui| {
            if ui.button("Reload saved").clicked() {
                if self.dirty() {
                    self.error = "Save or copy your draft before reloading. Discard it explicitly if it is no longer needed.".into();
                } else {
                    let id = string(&self.note, "id").to_string();
                    self.select_note(&id);
                }
            }
            // Always present so the inspector does not reflow when a draft starts.
            if ui
                .add_enabled(self.dirty(), egui::Button::new("Discard draft"))
                .clicked()
            {
                self.pending_navigation = None;
                self.pending_quit = false;
                self.confirm_close = true;
            }
            if ui
                .add_enabled(
                    !self.dirty() && self.pending.is_none(),
                    danger_button("Delete note", ui.visuals().dark_mode),
                )
                .on_hover_text("Delete the saved note after confirmation. Save or discard your draft first.")
                .clicked()
            {
                self.confirm_delete = true;
            }
        });
        ui.separator();
        self.properties_panel(ui);
        self.extension_commands(ui);
        ui.separator();
        ui.horizontal(|ui| {
            ui.label(RichText::new("Version history").strong());
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui
                    .button("History")
                    .on_hover_text("Load saved revisions")
                    .clicked()
                {
                    let mut req = self.scope("history");
                    req["id"] = self.note["id"].clone();
                    self.request("history", req);
                }
            });
        });
        if self.history.is_null() {
            ui.weak("Every save keeps a revision. Load them to compare or restore.");
            return;
        }
        for version in self.history["versions"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .take(50)
        {
            let label = format!(
                "Revision {} · {}",
                version["revision"],
                string(version, "recordedAt")
            );
            if crate::chrome::nav_item(ui, false, &label).clicked() {
                let mut req = self.scope("history");
                req["id"] = self.note["id"].clone();
                req["revision"] = version["revision"].clone();
                self.request("version", req);
            }
        }
        if !self.version.is_null() {
            ui.label("Historical content (read only)");
            egui::ScrollArea::vertical()
                .max_height(220.0)
                .show(ui, |ui| {
                    ui.monospace(helious_native::knowledge::mask_secrets(string(
                        &self.version,
                        "markdown",
                    )));
                });
            if ui.button("Use this content as a draft").clicked() {
                self.markdown = string(&self.version, "markdown").into();
                self.version = Value::Null;
                self.history = Value::Null;
            }
        }
    }
    fn welcome(&mut self, ui: &mut egui::Ui) {
        ui.add_space(80.0);
        ui.vertical_centered(|ui| {
            ui.set_max_width(560.0);
            ui.heading("A home for what you know.");
            ui.add_space(6.0);
            ui.weak("Open a Markdown folder to start. Signing in adds your Cloud vaults; local vaults always work offline.");
            ui.add_space(22.0);
            ui.columns(2, |columns| {
                card(&mut columns[0], "On this device", |ui| {
                    ui.weak("Plain Markdown files with history in a .helious folder.");
                    let dark = ui.visuals().dark_mode;
                    if ui.add(primary_button("Open or create a local vault", dark)).clicked() {
                        self.open_folder();
                    }
                });
                card(&mut columns[1], "Helious Cloud", |ui| {
                    if self.me.is_null() {
                        ui.weak("Sync chosen Spaces and reach your vaults anywhere.");
                        if ui.button("Sign in to Helious Cloud").clicked() {
                            self.page = Page::Account;
                        }
                    } else {
                        ui.weak("Choose a Cloud vault in the sidebar to open it.");
                    }
                });
            });
        });
    }
    pub fn account(&mut self, ui: &mut egui::Ui) {
        ui.add_space(24.0);
        ui.heading("Account");
        ui.add_space(4.0);
        if !self.me.is_null() {
            ui.weak("Signed in. Local folders keep working offline.");
            ui.add_space(16.0);
            let name = string(&self.me, "name").to_owned();
            card(ui, &name, |ui| {
                ui.label(string(&self.me, "email"));
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
                    if ui.button(string(&item, "name")).clicked() {
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
            ui.set_max_width(460.0);
            card(ui, "Sign in", |ui| {
                ui.horizontal(|ui|{if ui.selectable_label(!self.custom_server,"Helious Cloud").clicked(){self.custom_server=false;self.origin=helious_native::CLOUD_ORIGIN.into();}
if ui.selectable_label(self.custom_server,"Self-hosted server").clicked(){self.custom_server=true;}});
                ui.add_space(6.0);if self.custom_server{let label=ui.label("Server address");ui.add(egui::TextEdit::singleline(&mut self.origin).hint_text("https://your-server.example").desired_width(f32::INFINITY)).labelled_by(label.id);}else{ui.weak("helious.work · connection required");}
                let label=ui.label("Email address");ui.add(egui::TextEdit::singleline(&mut self.email).hint_text("you@example.com").desired_width(f32::INFINITY)).labelled_by(label.id);
                let label=ui.label("Password");ui.add(egui::TextEdit::singleline(&mut self.password).password(!self.show_password).desired_width(f32::INFINITY)).labelled_by(label.id);ui.checkbox(&mut self.show_password,"Show password");
                let label=ui.label("Authenticator or recovery code (if enabled)");ui.add(egui::TextEdit::singleline(&mut self.factor).desired_width(f32::INFINITY)).labelled_by(label.id);ui.add_space(8.0);
                let dark=ui.visuals().dark_mode;
                if ui.add_enabled(self.pending.is_none()&&!self.email.is_empty()&&!self.password.is_empty(),primary_button(if self.pending.as_deref()==Some("login"){ "Signing in…" }else{"Sign in"},dark)).clicked(){
                    self.request("login",json!({"operation":"login","origin":self.origin,"email":self.email,"password":self.password,"code":self.factor}));self.password.clear();self.factor.clear();
                }
                ui.add_space(4.0);ui.horizontal(|ui|{if ui.link("Create account").clicked(){if let Ok(origin)=helious_native::remote::origin(&self.origin){let _=open::that(format!("{}/app/",origin));}}
if ui.link("Forgot password?").clicked(){if let Ok(origin)=helious_native::remote::origin(&self.origin){let _=open::that(format!("{}/forgot-password",origin));}}});
            });
            ui.add_space(12.0);
            ui.weak("Sessions are kept in Windows Credential Manager. Your password is never saved. If Cloud is unavailable, open a local vault from the sidebar.");
        });
    }
    pub fn settings(&mut self, ui: &mut egui::Ui) {
        ui.add_space(24.0);
        ui.heading("Settings");
        ui.add_space(16.0);
        card(ui, "Appearance", |ui| {
            ui.horizontal(|ui| {
                for (value, label) in [
                    ("dark", "Dark"),
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
        ui.add_space(14.0);
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
        ui.add_space(14.0);
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
            ui.weak("Updates come from RavoxX/helious-apps and must pass signature and checksum verification.");
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
            if ui.add_enabled(self.settings_dirty && self.pending.is_none(), primary_button("Save settings", dark)).clicked() {
                self.request("settings",json!({"operation":"settings","settings":{"theme":self.theme,"fontSize":self.font_size as u64,"wrap":self.wrap,"automaticChecks":self.automatic_checks,"automaticInstall":self.automatic_install}}));
            }
            if self.settings_dirty {
                ui.weak("Appearance, editor and update changes are not saved yet.");
            }
        });
        ui.add_space(20.0);
        card(ui, "Extensions", |ui| self.extension_manager(ui));
        ui.add_space(14.0);
        card(ui, "Storage", |ui| {
            ui.label("Local vaults contain plain Markdown and a .helious folder for history and sync checkpoints. Back up both.");
            ui.weak(self.data_folder.to_string_lossy());
            if ui.button("Open desktop settings folder").clicked() {
                let _ = open::that(&self.data_folder);
            }
        });
        ui.add_space(14.0);
        card(ui, "Keyboard shortcuts", |ui| {
            egui::Grid::new("shortcuts")
                .spacing([28.0, 10.0])
                .show(ui, |ui| {
                    for (key, action) in [
                        ("Ctrl+S", "Save note"),
                        ("Ctrl+O", "Open local folder"),
                        ("Ctrl+,", "Settings"),
                    ] {
                        ui.monospace(key);
                        ui.label(action);
                        ui.end_row();
                    }
                });
        });
        ui.add_space(14.0);
        card(ui, "About", |ui| {
            ui.label(format!(
                "Helious {} · Rust / egui / eframe / wgpu",
                env!("CARGO_PKG_VERSION")
            ));
            ui.weak("Windows uses a native rendered interface, with no webview and no application menu strip.");
        });
        ui.add_space(24.0);
    }
    pub fn sync(&mut self, ui: &mut egui::Ui) {
        ui.add_space(24.0);
        ui.heading("Sync");
        ui.weak(
            "Pair a local vault with selected server Spaces. Nothing is selected automatically.",
        );
        ui.add_space(16.0);
        card(ui, "Pairing", |ui| self.sync_pairing(ui));
    }
    fn sync_pairing(&mut self, ui: &mut egui::Ui) {
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
            ui.label(format!(
                "Paired with {}",
                string(&self.sync_config, "serverOrigin")
            ));
            if ui
                .add_enabled(
                    self.pending.is_none() && !self.dirty(),
                    egui::Button::new("Sync now"),
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
                ui.label(format!("Conflict: {}", string(&conflict, "path")));
                ui.weak(format!("Preserved copy: {}", string(&conflict, "copy")));
                ui.horizontal(|ui|{for (choice,label) in [("local","Use local version"),("server","Use server version")]{if ui.add_enabled(self.pending.is_none()&&!self.dirty(),egui::Button::new(label)).clicked(){self.request("resolve_sync",json!({"operation":"resolve_sync","vaultId":self.vault["id"],"path":conflict["path"],"choice":choice}));}}});
            }
            ui.add_space(20.0);
            if ui.button("Stop pairing (keep files)").clicked() {
                self.mappings = json!({});
                self.request("local_config",json!({"operation":"local_config","vaultId":self.vault["id"],"value":{"sync":null}}));
            }
            return;
        }
        let mut changed = false;
        egui::ComboBox::from_id_salt("sync-server-vault")
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
        let mut has_personal = false;
        for local in self.spaces.clone() {
            ui.horizontal(|ui| {
                ui.label(string(&local, "name"));
                let key = string(&local, "id");
                let mut selected = self.mappings[key].as_str().unwrap_or("").to_string();
                egui::ComboBox::from_id_salt(key)
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
            });
        }
        if has_personal {
            ui.checkbox(
                &mut self.personal_confirm,
                "I explicitly want to sync the selected Personal Space.",
            );
        }
        if ui
            .add_enabled(
                !self.sync_vault.is_empty()
                    && self.pending.is_none()
                    && (!has_personal || self.personal_confirm)
                    && self.mappings.as_object().is_some_and(|m| !m.is_empty()),
                egui::Button::new("Save sync pairing"),
            )
            .clicked()
        {
            let config = json!({"schema":1,"serverOrigin":self.origin,"ownerId":self.me["id"],"vaultId":self.sync_vault,"mappings":self.mappings,"base":{},"conflicts":{},"auto":false});
            self.request("local_config",json!({"operation":"local_config","vaultId":self.vault["id"],"value":{"sync":config},"confirmPersonal":self.personal_confirm}));
        }
    }
}
