//! 4-tab Note Inspector: Context (Outline, Backlinks, Outgoing, Unlinked Mentions), Properties, Extensions, History.
use crate::{
    app::{string, HeliousApp},
    chrome::{badge_pill, card, danger_button, nav_item, nav_item_indented, palette},
    state::{InspectorTab, SearchMode},
};
use eframe::egui::{self, RichText, Stroke};
use serde_json::Value;

impl HeliousApp {
    pub fn show_inspector(&mut self, ui: &mut egui::Ui) {
        if !self.inspector || self.note.is_null() {
            return;
        }
        let colors = palette(ui.visuals().dark_mode);
        egui::Panel::right("note-inspector")
            .default_size(328.0)
            .size_range(260.0..=460.0)
            .frame(
                egui::Frame::new()
                    .fill(colors.surface)
                    .stroke(Stroke::new(1.0, colors.line))
                    .inner_margin(egui::Margin::symmetric(12, 10)),
            )
            .show_separator_line(false)
            .show(ui, |ui| {
                egui::ScrollArea::vertical()
                    .id_salt("inspector-scroll")
                    .auto_shrink([false, false])
                    .show(ui, |ui| {
                        ui.set_width(ui.available_width());
                        self.inspector_header(ui);
                        ui.add_space(6.0);
                        self.inspector_tabs(ui);
                        ui.separator();
                        match self.inspector_state.tab {
                            InspectorTab::Context => self.inspector_context_tab(ui),
                            InspectorTab::Properties => self.properties_body(ui),
                            InspectorTab::Extensions => self.extension_commands_body(ui),
                            InspectorTab::History => self.inspector_history_tab(ui),
                        }
                    });
            });
    }

    fn inspector_header(&mut self, ui: &mut egui::Ui) {
        card(ui, "", |ui| {
            ui.horizontal(|ui| {
                ui.label(RichText::new("Note details").strong());
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.small(string(&self.note, "path"));
                });
            });
            ui.add_space(4.0);
            ui.horizontal(|ui| {
                ui.label("Space");
                egui::ComboBox::from_id_salt("note-space")
                    .width((ui.available_width() - 8.0).max(100.0))
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
                    .on_hover_text(
                        "Delete the saved note after confirmation. Save or discard your draft first.",
                    )
                    .clicked()
                {
                    self.confirm_delete = true;
                }
            });
        });
    }

    fn inspector_tabs(&mut self, ui: &mut egui::Ui) {
        ui.scope(|ui| {
            ui.spacing_mut().item_spacing.x = 4.0;
            ui.spacing_mut().button_padding = egui::vec2(6.0, 5.0);
            ui.horizontal(|ui| {
                for (tab, label) in [
                    (InspectorTab::Context, "Context"),
                    (InspectorTab::Properties, "Properties"),
                    (InspectorTab::Extensions, "Extensions"),
                    (InspectorTab::History, "History"),
                ] {
                    if ui
                        .selectable_label(self.inspector_state.tab == tab, label)
                        .clicked()
                    {
                        self.inspector_state.tab = tab;
                        if tab == InspectorTab::History && self.history.is_null() {
                            self.load_history();
                        }
                    }
                }
            });
        });
    }

    pub fn request_note_context(&mut self) {
        if self.vault.is_null() || self.note.is_null() {
            return;
        }
        let id = string(&self.note, "id").to_string();
        if id.is_empty() {
            return;
        }
        self.inspector_state.context_note_id = id.clone();
        let mut req = self.scope("note_context");
        req["id"] = serde_json::json!(id);
        req["markdown"] = serde_json::json!(self.markdown);
        self.request("note_context", req);
    }

    fn load_history(&mut self) {
        if self.note.is_null() {
            return;
        }
        let mut req = self.scope("history");
        req["id"] = self.note["id"].clone();
        self.request("history", req);
    }

    fn inspector_context_tab(&mut self, ui: &mut egui::Ui) {
        let colors = palette(ui.visuals().dark_mode);
        let tags = helious_native::knowledge::extract_tags(&self.markdown);
        if !tags.is_empty() {
            ui.strong("Tags");
            let mut clicked_tag: Option<String> = None;
            ui.horizontal_wrapped(|ui| {
                for tag in &tags {
                    if ui
                        .small_button(format!("#{tag}"))
                        .on_hover_text("Search notes with this tag")
                        .clicked()
                    {
                        clicked_tag = Some(tag.clone());
                    }
                }
            });
            if let Some(tag) = clicked_tag {
                self.explorer.mode = SearchMode::FullText;
                self.filter = format!("tag:{tag}");
                self.run_fulltext_search();
            }
            ui.add_space(6.0);
        }

        let headings = helious_native::knowledge::extract_headings(&self.markdown);
        ui.horizontal(|ui| {
            ui.strong("Outline");
            ui.weak(headings.len().to_string());
        });
        if headings.is_empty() {
            ui.weak("Add # headings to generate a table of contents.");
        } else {
            for h in &headings {
                let level = h["level"].as_u64().unwrap_or(1).clamp(1, 6) as usize;
                let text = string(h, "text");
                let line = h["line"].as_u64().unwrap_or(1);
                let indent = ((level - 1) as f32) * 10.0;
                let line_hint = format!("L{line}");
                if nav_item_indented(ui, false, text, indent, Some(&line_hint)).clicked() {
                    if self.mode == 1 {
                        self.mode = 0;
                    }
                    self.editor_tools.focus_editor = true;
                }
            }
        }

        ui.separator();
        ui.horizontal(|ui| {
            ui.strong("Connected notes");
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui
                    .add_enabled(self.pending.is_none(), egui::Button::new("Refresh links"))
                    .clicked()
                {
                    self.request_note_context();
                }
            });
        });

        let ctx = self.inspector_state.context.clone();
        let backlinks = ctx["backlinks"].as_array().cloned().unwrap_or_default();
        let outgoing = ctx["outgoing"].as_array().cloned().unwrap_or_default();
        let mentions = ctx["unlinkedMentions"]
            .as_array()
            .cloned()
            .unwrap_or_default();

        let mut open_id: Option<String> = None;

        ui.add_space(4.0);
        ui.horizontal(|ui| {
            ui.label(RichText::new("Backlinks").strong());
            badge_pill(ui, &backlinks.len().to_string(), colors.accent);
        });
        if backlinks.is_empty() {
            ui.weak("No notes in this Space link here yet.");
        } else {
            for item in &backlinks {
                let title = string(item, "title");
                let path = string(item, "path");
                let label = if title.is_empty() { path } else { title };
                if nav_item(ui, false, label).on_hover_text(path).clicked() {
                    open_id = Some(string(item, "id").to_string());
                }
                let snippet = string(item, "snippet");
                if !snippet.is_empty() {
                    ui.small(RichText::new(snippet).color(colors.muted));
                }
            }
        }

        ui.add_space(6.0);
        ui.horizontal(|ui| {
            ui.label(RichText::new("Outgoing links").strong());
            badge_pill(ui, &outgoing.len().to_string(), colors.muted);
        });
        if outgoing.is_empty() {
            ui.weak("Use [[Note]] to connect ideas.");
        } else {
            for item in &outgoing {
                let resolved = item["resolved"] == true;
                let target = string(item, "target");
                let title = string(item, "title");
                let label = if title.is_empty() { target } else { title };
                if resolved {
                    if nav_item(ui, false, label)
                        .on_hover_text(string(item, "path"))
                        .clicked()
                    {
                        open_id = Some(string(item, "id").to_string());
                    }
                } else {
                    ui.horizontal(|ui| {
                        ui.weak(format!("[[{target}]]"));
                        badge_pill(ui, "unresolved", colors.warn);
                    });
                }
            }
        }

        if !mentions.is_empty() {
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                ui.label(RichText::new("Unlinked mentions").strong());
                badge_pill(ui, &mentions.len().to_string(), colors.muted);
            });
            for item in &mentions {
                let title = string(item, "title");
                let path = string(item, "path");
                let label = if title.is_empty() { path } else { title };
                if nav_item(ui, false, label).on_hover_text(path).clicked() {
                    open_id = Some(string(item, "id").to_string());
                }
            }
        }

        if let Some(id) = open_id.filter(|s| !s.is_empty()) {
            self.select_note(&id);
        }
    }

    fn inspector_history_tab(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.strong("Version history");
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui
                    .add_enabled(
                        self.pending.is_none(),
                        egui::Button::new("Reload revisions"),
                    )
                    .clicked()
                {
                    self.load_history();
                }
            });
        });

        if self.history.is_null() {
            ui.weak("Every save keeps a revision. Select Reload revisions to inspect or restore.");
            return;
        }

        let versions = self.history["versions"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        if versions.is_empty() {
            ui.weak("No saved revisions recorded yet.");
        }
        for version in versions.iter().take(50) {
            let action = match string(version, "action") {
                "local-create" | "create" => "Created",
                "local-edit" | "update" => "Saved",
                "local-move" | "move" => "Moved",
                "local-delete" | "delete" => "Deleted",
                "import" => "Imported",
                "external-edit" => "External edit",
                other if !other.is_empty() => other,
                _ => "Revision",
            };
            let label = format!(
                "Rev {} · {} · {}",
                version["revision"],
                action,
                string(version, "recordedAt")
            );
            let selected =
                !self.version.is_null() && self.version["revision"] == version["revision"];
            if nav_item(ui, selected, &label).clicked() {
                let mut req = self.scope("history");
                req["id"] = self.note["id"].clone();
                req["revision"] = version["revision"].clone();
                self.request("version", req);
            }
        }

        if !self.version.is_null() {
            ui.separator();
            ui.strong("Historical content (read only)");
            egui::ScrollArea::vertical()
                .id_salt("history-preview-scroll")
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
                self.message = "Historical revision copied to draft. Save to keep it.".into();
            }
        }
    }
}
