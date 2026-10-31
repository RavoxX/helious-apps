//! Multi-tab bar, document header, inline rename, find/replace, Markdown toolbar and split editor.
use crate::{
    app::{string, HeliousApp},
    chrome::{badge_pill, kbd_badge, palette, primary_button},
};
use eframe::egui::{self, RichText, Stroke};
use serde_json::json;

impl HeliousApp {
    pub fn show_editor_pane(&mut self, ui: &mut egui::Ui) {
        let colors = palette(ui.visuals().dark_mode);
        egui::CentralPanel::default()
            .frame(
                egui::Frame::new()
                    .fill(colors.surface)
                    .inner_margin(egui::Margin::symmetric(14, 8)),
            )
            .show(ui, |ui| {
                if !self.tabs.is_empty() {
                    self.show_tab_strip(ui);
                    ui.add_space(4.0);
                }

                if self.note.is_null() {
                    ui.add_space(80.0);
                    ui.vertical_centered(|ui| {
                        ui.set_max_width(480.0);
                        ui.heading("Choose or create a note");
                        ui.add_space(4.0);
                        ui.weak("Select a note in the explorer tree, press Ctrl+K to jump anywhere, or open today's note.");
                        ui.add_space(16.0);
                        ui.horizontal(|ui| {
                            if ui.button("Quick switch  Ctrl+K").clicked() {
                                self.open_palette();
                            }
                            if ui
                                .add_enabled(
                                    self.pending.is_none(),
                                    egui::Button::new("Today's daily note"),
                                )
                                .clicked()
                            {
                                self.open_today_daily();
                            }
                        });
                    });
                    return;
                }

                let path = string(&self.note, "path").to_string();
                let (folder_prefix, filename) = path
                    .rsplit_once('/')
                    .map(|(dir, file)| (Some(dir), file))
                    .unwrap_or((None, path.as_str()));

                ui.horizontal(|ui| {
                    ui.vertical(|ui| {
                        ui.horizontal(|ui| {
                            if let Some(dir) = folder_prefix {
                                ui.label(RichText::new(format!("{dir} /")).color(colors.muted));
                            }
                            ui.label(RichText::new(filename).size(19.0).strong());
                            if let Some(space) =
                                self.spaces.iter().find(|s| s["id"] == self.space)
                            {
                                let space_color = if space["kind"] == "personal" {
                                    colors.warn
                                } else {
                                    colors.accent
                                };
                                badge_pill(ui, string(space, "name"), space_color);
                            }
                        });
                        if self.dirty() {
                            ui.label(
                                RichText::new("• Unsaved changes in draft")
                                    .small()
                                    .color(colors.warn),
                            );
                        } else {
                            let rev = self.note["revision"].as_u64().unwrap_or(1);
                            ui.small(RichText::new(format!("{path} · Rev {rev} · Saved")).weak());
                        }
                    });

                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        let dark = ui.visuals().dark_mode;
                        if ui
                            .add_enabled(
                                self.pending.is_none(),
                                primary_button("Save  Ctrl+S", dark),
                            )
                            .clicked()
                        {
                            self.save();
                        }
                        if ui
                            .selectable_label(self.inspector, "Inspector")
                            .on_hover_text(
                                "Toggle Context, Outline, Backlinks, Properties, Extensions and History",
                            )
                            .clicked()
                        {
                            self.inspector = !self.inspector;
                        }
                        if ui
                            .selectable_label(self.editor_tools.find_open, "Find")
                            .on_hover_text("Find and replace in note (Ctrl+F)")
                            .clicked()
                        {
                            self.editor_tools.find_open = !self.editor_tools.find_open;
                        }
                        if ui
                            .selectable_label(self.editor_tools.rename_open, "Rename…")
                            .on_hover_text(
                                "Move or rename this note and update inbound wikilinks (F2)",
                            )
                            .clicked()
                        {
                            self.toggle_rename_bar();
                        }
                    });
                });

                if self.editor_tools.rename_open {
                    self.show_rename_bar(ui);
                }
                if self.editor_tools.find_open {
                    self.show_find_bar(ui);
                }

                ui.add_space(2.0);
                ui.horizontal_wrapped(|ui| {
                    for (i, label) in ["Source", "Reading", "Split"].iter().enumerate() {
                        if ui.selectable_label(self.mode == i as u8, *label).clicked() {
                            self.mode = i as u8;
                        }
                    }
                    if self.mode != 1 {
                        ui.separator();
                        if ui
                            .small_button("B")
                            .on_hover_text("Insert bold Markdown")
                            .clicked()
                        {
                            self.append_snippet("**bold**");
                        }
                        if ui
                            .small_button("I")
                            .on_hover_text("Insert italic Markdown")
                            .clicked()
                        {
                            self.append_snippet("*italic*");
                        }
                        if ui
                            .small_button("Code")
                            .on_hover_text("Insert inline code")
                            .clicked()
                        {
                            self.append_snippet("`code`");
                        }
                        if ui
                            .small_button("H2")
                            .on_hover_text("Insert section heading")
                            .clicked()
                        {
                            self.append_block("\n## Heading\n");
                        }
                        if ui
                            .small_button("Task")
                            .on_hover_text("Insert checklist item")
                            .clicked()
                        {
                            self.append_block("\n- [ ] ");
                        }
                        if ui
                            .small_button("[[Link]]")
                            .on_hover_text("Insert a wikilink to another note in this Space")
                            .clicked()
                        {
                            self.editor_tools.link_picker_open =
                                !self.editor_tools.link_picker_open;
                        }
                    }
                });

                if self.editor_tools.link_picker_open && self.mode != 1 {
                    self.show_link_picker(ui);
                }

                ui.separator();

                if self.mode == 2 {
                    ui.columns(2, |columns| {
                        self.render_source_editor(&mut columns[0]);
                        self.reading_preview(&mut columns[1]);
                    });
                } else if self.mode == 1 {
                    self.reading_preview(ui);
                } else {
                    self.render_source_editor(ui);
                }
            });
    }

    fn show_tab_strip(&mut self, ui: &mut egui::Ui) {
        let colors = palette(ui.visuals().dark_mode);
        let active_id = string(&self.note, "id").to_string();
        let is_dirty = self.dirty();
        let mut switch_to: Option<String> = None;
        let mut close_id: Option<String> = None;

        egui::ScrollArea::horizontal()
            .id_salt("open-note-tabs")
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    for tab in &self.tabs {
                        let active = tab.id == active_id;
                        egui::Frame::new()
                            .fill(if active { colors.selected } else { colors.card })
                            .stroke(Stroke::new(
                                1.0,
                                if active { colors.accent } else { colors.line },
                            ))
                            .corner_radius(6)
                            .inner_margin(egui::Margin::symmetric(8, 3))
                            .show(ui, |ui| {
                                let label = if active && is_dirty {
                                    format!("• {}", tab.title)
                                } else {
                                    tab.title.clone()
                                };
                                if ui
                                    .selectable_label(active, &label)
                                    .on_hover_text(&tab.path)
                                    .clicked()
                                    && !active
                                {
                                    switch_to = Some(tab.id.clone());
                                }
                                if ui
                                    .small_button("×")
                                    .on_hover_text(format!("Close tab {}", tab.title))
                                    .clicked()
                                {
                                    close_id = Some(tab.id.clone());
                                }
                            });
                    }
                });
            });

        if let Some(id) = close_id {
            self.close_tab(&id);
        } else if let Some(id) = switch_to {
            self.select_note(&id);
        }
    }

    pub fn toggle_rename_bar(&mut self) {
        if self.note.is_null() {
            return;
        }
        self.editor_tools.rename_open = !self.editor_tools.rename_open;
        if self.editor_tools.rename_open {
            self.editor_tools.rename_path = string(&self.note, "path").to_string();
        }
    }

    fn show_rename_bar(&mut self, ui: &mut egui::Ui) {
        let colors = palette(ui.visuals().dark_mode);
        egui::Frame::new()
            .fill(colors.card)
            .stroke(Stroke::new(1.0, colors.line))
            .corner_radius(6)
            .inner_margin(egui::Margin::symmetric(10, 6))
            .show(ui, |ui| {
                ui.horizontal_wrapped(|ui| {
                    ui.label(RichText::new("Move / rename:").strong());
                    let resp = ui.add(
                        egui::TextEdit::singleline(&mut self.editor_tools.rename_path)
                            .hint_text("Folder/Note.md")
                            .desired_width(280.0),
                    );
                    let enter = resp.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
                    let path_ready = !self.editor_tools.rename_path.trim().is_empty();
                    if (enter && path_ready)
                        || ui
                            .add_enabled(
                                self.pending.is_none() && path_ready,
                                egui::Button::new("Apply rename"),
                            )
                            .clicked()
                    {
                        self.apply_rename();
                    }
                    if ui.button("Cancel rename").clicked() {
                        self.editor_tools.rename_open = false;
                    }
                    ui.small("Inbound [[wikilinks]] in this Space are updated atomically.");
                });
            });
    }

    pub fn apply_rename(&mut self) {
        if self.note.is_null() {
            return;
        }
        let raw = self.editor_tools.rename_path.trim();
        if raw.is_empty() {
            return;
        }
        let target = if raw.to_lowercase().ends_with(".md") {
            raw.to_string()
        } else {
            format!("{raw}.md")
        };
        let mut req = self.scope("rename_note");
        req["id"] = self.note["id"].clone();
        req["path"] = json!(target);
        req["markdown"] = json!(self.markdown);
        req["spaceId"] = json!(self.space);
        req["hash"] = self.note["hash"].clone();
        req["revision"] = self.note["revision"].clone();
        self.editor_tools.rename_open = false;
        self.request("rename_note", req);
    }

    fn show_find_bar(&mut self, ui: &mut egui::Ui) {
        let colors = palette(ui.visuals().dark_mode);
        egui::Frame::new()
            .fill(colors.card)
            .stroke(Stroke::new(1.0, colors.line))
            .corner_radius(6)
            .inner_margin(egui::Margin::symmetric(10, 6))
            .show(ui, |ui| {
                ui.horizontal_wrapped(|ui| {
                    ui.add(
                        egui::TextEdit::singleline(&mut self.editor_tools.find_query)
                            .hint_text("Find in note…")
                            .desired_width(180.0),
                    );
                    let matches = if self.editor_tools.find_query.is_empty() {
                        0
                    } else {
                        self.markdown
                            .to_lowercase()
                            .matches(&self.editor_tools.find_query.to_lowercase())
                            .count()
                    };
                    ui.small(format!("{matches} matches"));
                    ui.separator();
                    ui.add(
                        egui::TextEdit::singleline(&mut self.editor_tools.replace_text)
                            .hint_text("Replace with…")
                            .desired_width(160.0),
                    );
                    if ui
                        .add_enabled(
                            !self.editor_tools.find_query.is_empty() && matches > 0,
                            egui::Button::new("Replace next"),
                        )
                        .clicked()
                    {
                        if let Some(idx) = self
                            .markdown
                            .to_lowercase()
                            .find(&self.editor_tools.find_query.to_lowercase())
                        {
                            let end = idx + self.editor_tools.find_query.len();
                            if self.markdown.is_char_boundary(idx)
                                && self.markdown.is_char_boundary(end)
                            {
                                self.markdown
                                    .replace_range(idx..end, &self.editor_tools.replace_text);
                            }
                        }
                    }
                    if ui
                        .add_enabled(
                            !self.editor_tools.find_query.is_empty() && matches > 0,
                            egui::Button::new("Replace all"),
                        )
                        .clicked()
                    {
                        self.markdown = self.markdown.replace(
                            &self.editor_tools.find_query,
                            &self.editor_tools.replace_text,
                        );
                    }
                    if ui.small_button("Close find").clicked() {
                        self.editor_tools.find_open = false;
                    }
                    kbd_badge(ui, "Ctrl+F");
                });
            });
    }

    fn show_link_picker(&mut self, ui: &mut egui::Ui) {
        let colors = palette(ui.visuals().dark_mode);
        let mut insert: Option<String> = None;
        egui::Frame::new()
            .fill(colors.card)
            .stroke(Stroke::new(1.0, colors.accent))
            .corner_radius(6)
            .inner_margin(egui::Margin::symmetric(10, 8))
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.strong("Insert [[wikilink]]");
                    ui.add(
                        egui::TextEdit::singleline(&mut self.editor_tools.link_filter)
                            .hint_text("Filter notes in this Space…")
                            .desired_width(220.0),
                    );
                    if ui.small_button("Close link picker").clicked() {
                        self.editor_tools.link_picker_open = false;
                    }
                });
                let filter = self.editor_tools.link_filter.to_lowercase();
                let candidates: Vec<_> = self
                    .notes
                    .iter()
                    .filter(|n| {
                        n["spaceId"] == self.space
                            && n["id"] != self.note["id"]
                            && (filter.is_empty()
                                || string(n, "path").to_lowercase().contains(&filter)
                                || string(n, "title").to_lowercase().contains(&filter))
                    })
                    .take(8)
                    .collect();
                if candidates.is_empty() {
                    ui.weak("No matching notes in this Space.");
                } else {
                    ui.horizontal_wrapped(|ui| {
                        for item in candidates {
                            let path = string(item, "path");
                            let stem = path.trim_end_matches(".md");
                            if ui.small_button(format!("[[/{stem}]]")).clicked() {
                                insert = Some(format!("[[/{stem}]]"));
                            }
                        }
                    });
                }
            });
        if let Some(token) = insert {
            self.append_snippet(&token);
            self.editor_tools.link_picker_open = false;
            self.editor_tools.link_filter.clear();
        }
    }

    fn render_source_editor(&mut self, ui: &mut egui::Ui) {
        let colors = palette(ui.visuals().dark_mode);
        egui::Frame::new()
            .fill(colors.editor_bg)
            .stroke(Stroke::new(1.0, colors.line))
            .corner_radius(6)
            .inner_margin(egui::Margin::symmetric(12, 10))
            .show(ui, |ui| {
                egui::ScrollArea::both()
                    .id_salt("source-editor")
                    .auto_shrink([false, false])
                    .show(ui, |ui| {
                        let resp = ui
                            .add_enabled(
                                self.pending.as_deref() != Some("save_note"),
                                egui::TextEdit::multiline(&mut self.markdown)
                                    .font(egui::FontId::monospace(self.font_size))
                                    .hint_text("Start writing in Markdown…")
                                    .desired_width(if self.wrap {
                                        ui.available_width()
                                    } else {
                                        10000.0
                                    })
                                    .desired_rows(34)
                                    .frame(egui::Frame::NONE)
                                    .code_editor(),
                            )
                            .on_hover_text("Markdown source editor");
                        if self.editor_tools.focus_editor {
                            resp.request_focus();
                            self.editor_tools.focus_editor = false;
                        }
                    });
            });
    }

    fn append_snippet(&mut self, snippet: &str) {
        if !self.markdown.is_empty() && !self.markdown.ends_with([' ', '\n']) {
            self.markdown.push(' ');
        }
        self.markdown.push_str(snippet);
    }

    fn append_block(&mut self, snippet: &str) {
        self.markdown.push_str(snippet);
    }

    pub fn open_today_daily(&mut self) {
        if self.spaces.is_empty() {
            return;
        }
        if self.authoring.space.is_empty() {
            self.authoring.space = self
                .spaces
                .iter()
                .find(|s| s["kind"] != "personal")
                .or_else(|| self.spaces.first())
                .map(|s| string(s, "id").to_string())
                .unwrap_or_default();
        }
        self.authoring.day = helious_native::authoring::today();
        let mut req = self.scope("open_daily");
        req["spaceId"] = json!(self.authoring.space);
        req["day"] = json!(self.authoring.day);
        req["templateId"] = json!(self.authoring.template);
        self.request("create_note", req);
    }
}
