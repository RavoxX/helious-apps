//! Hierarchical folder explorer, Space filter and full-text search panel for Helious Windows.
use crate::{
    app::{string, HeliousApp},
    chrome::{folder_item, nav_item_indented, palette},
    state::{FolderNode, SearchMode},
};
use eframe::egui::{self, RichText, Stroke};
use serde_json::{json, Value};

impl HeliousApp {
    pub fn show_explorer(&mut self, ui: &mut egui::Ui) {
        let colors = palette(ui.visuals().dark_mode);
        egui::Panel::left("file-explorer")
            .default_size(272.0)
            .size_range(210.0..=440.0)
            .frame(
                egui::Frame::new()
                    .fill(colors.surface)
                    .stroke(Stroke::new(1.0, colors.line))
                    .inner_margin(egui::Margin::symmetric(10, 10)),
            )
            .show_separator_line(false)
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.label(RichText::new("Notes").size(16.0).strong());
                    ui.weak(self.notes.len().to_string());
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        let space_name = if self.explorer.space_filter.is_empty() {
                            "All Spaces"
                        } else {
                            self.spaces
                                .iter()
                                .find(|s| s["id"] == self.explorer.space_filter)
                                .map(|s| string(s, "name"))
                                .unwrap_or("All Spaces")
                        };
                        egui::ComboBox::from_id_salt("explorer-space-filter")
                            .width(112.0)
                            .selected_text(space_name)
                            .show_ui(ui, |ui| {
                                ui.selectable_value(
                                    &mut self.explorer.space_filter,
                                    String::new(),
                                    "All Spaces",
                                );
                                for s in &self.spaces {
                                    ui.selectable_value(
                                        &mut self.explorer.space_filter,
                                        string(s, "id").to_string(),
                                        string(s, "name"),
                                    );
                                }
                            });
                    });
                });

                ui.add_space(4.0);
                ui.horizontal(|ui| {
                    let is_filter = self.explorer.mode == SearchMode::Filter;
                    if ui
                        .selectable_label(is_filter, "Filter tree")
                        .on_hover_text("Instant filter by note title or path")
                        .clicked()
                    {
                        self.explorer.mode = SearchMode::Filter;
                    }
                    if ui
                        .selectable_label(!is_filter, "Full-text search")
                        .on_hover_text("Search note bodies, tag:name, -tag:name, path:folder")
                        .clicked()
                    {
                        self.explorer.mode = SearchMode::FullText;
                        if !self.filter.trim().is_empty() {
                            self.run_fulltext_search();
                        }
                    }
                });

                if self.explorer.mode == SearchMode::Filter {
                    ui.add(
                        egui::TextEdit::singleline(&mut self.filter)
                            .hint_text("Filter notes by name or path…")
                            .desired_width(f32::INFINITY),
                    );
                } else {
                    ui.horizontal(|ui| {
                        let width = (ui.available_width() - 62.0).max(80.0);
                        let resp = ui.add(
                            egui::TextEdit::singleline(&mut self.filter)
                                .hint_text("Search text, tag:work, path:Docs…")
                                .desired_width(width),
                        );
                        let enter =
                            resp.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
                        if enter
                            || ui
                                .add_enabled(self.pending.is_none(), egui::Button::new("Search"))
                                .on_hover_text("Run full-text search across notes")
                                .clicked()
                        {
                            self.run_fulltext_search();
                        }
                    });
                }

                ui.horizontal(|ui| {
                    let width = (ui.available_width() - 40.0).max(80.0);
                    let resp = ui.add(
                        egui::TextEdit::singleline(&mut self.new_path)
                            .hint_text("New note, e.g. Ideas/Plan.md")
                            .desired_width(width),
                    );
                    let enter = resp.lost_focus()
                        && ui.input(|i| i.key_pressed(egui::Key::Enter))
                        && !self.new_path.trim().is_empty();
                    if enter
                        || ui
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

                egui::ScrollArea::vertical()
                    .id_salt("notes-list")
                    .show(ui, |ui| {
                        if self.explorer.mode == SearchMode::FullText
                            && !self.filter.trim().is_empty()
                        {
                            self.show_search_results(ui);
                        } else {
                            self.show_folder_tree(ui);
                        }
                    });
            });
    }

    pub fn run_fulltext_search(&mut self) {
        if self.vault.is_null() {
            return;
        }
        let query = self.filter.trim().to_string();
        self.explorer.searched_query = query.clone();
        if query.is_empty() {
            self.explorer.search_results.clear();
            return;
        }
        let mut req = self.scope("search_notes");
        req["query"] = json!(query);
        if !self.explorer.space_filter.is_empty() {
            req["spaceId"] = json!(self.explorer.space_filter);
        }
        req["limit"] = json!(60);
        self.explorer.searching = true;
        self.request("search_notes", req);
    }

    fn show_search_results(&mut self, ui: &mut egui::Ui) {
        let colors = palette(ui.visuals().dark_mode);
        if self.explorer.searching {
            ui.weak("Searching vault…");
            return;
        }
        if self.explorer.search_results.is_empty() {
            ui.add_space(12.0);
            ui.weak("No notes matched your query. Try tag:name, path:Folder, or another phrase.");
            return;
        }
        ui.small(format!(
            "{} matching notes",
            self.explorer.search_results.len()
        ));
        ui.add_space(4.0);
        let mut chosen: Option<String> = None;
        for hit in &self.explorer.search_results {
            let id = string(hit, "id");
            let path = string(hit, "path");
            let title = string(hit, "title");
            let snippet = string(hit, "snippet");
            let selected = self.note["id"] == hit["id"];
            egui::Frame::new()
                .fill(if selected {
                    colors.selected
                } else {
                    colors.card
                })
                .stroke(Stroke::new(
                    1.0,
                    if selected { colors.accent } else { colors.line },
                ))
                .corner_radius(6)
                .inner_margin(egui::Margin::symmetric(10, 8))
                .show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    let label = if title.is_empty() { path } else { title };
                    if ui
                        .selectable_label(selected, RichText::new(label).strong())
                        .on_hover_text(path)
                        .clicked()
                    {
                        chosen = Some(id.to_string());
                    }
                    ui.small(RichText::new(path).color(colors.subtle));
                    if !snippet.is_empty() {
                        ui.small(RichText::new(snippet).color(colors.muted));
                    }
                });
            ui.add_space(4.0);
        }
        if let Some(id) = chosen {
            self.select_note(&id);
        }
    }

    fn show_folder_tree(&mut self, ui: &mut egui::Ui) {
        let filter = self.filter.trim().to_lowercase();
        let space_filter = self.explorer.space_filter.clone();
        let filtered: Vec<Value> = self
            .notes
            .iter()
            .filter(|n| {
                (space_filter.is_empty() || n["spaceId"] == space_filter)
                    && (filter.is_empty()
                        || string(n, "path").to_lowercase().contains(&filter)
                        || string(n, "title").to_lowercase().contains(&filter))
            })
            .cloned()
            .collect();

        if self.notes.is_empty() {
            ui.add_space(16.0);
            ui.weak("No notes yet. Name one above and press +. Markdown files added by another editor also appear here.");
            return;
        }
        if filtered.is_empty() {
            ui.add_space(16.0);
            ui.weak("No notes match your current filter.");
            return;
        }

        let tree = FolderNode::build(&filtered);
        let mut select_id: Option<String> = None;
        let force_open = !filter.is_empty();
        self.render_folder_children(ui, &tree, 0, force_open, &mut select_id);
        if let Some(id) = select_id {
            self.select_note(&id);
        }
    }

    fn render_folder_children(
        &mut self,
        ui: &mut egui::Ui,
        node: &FolderNode,
        depth: usize,
        force_open: bool,
        select_id: &mut Option<String>,
    ) {
        let indent = (depth as f32) * 14.0;
        for folder in &node.children {
            let collapsed =
                !force_open && self.explorer.collapsed_folders.contains(&folder.full_path);
            let count = folder.total_notes().to_string();
            if folder_item(ui, collapsed, &folder.name, indent, &count)
                .on_hover_text(format!("Folder: {}", folder.full_path))
                .clicked()
            {
                if collapsed {
                    self.explorer.collapsed_folders.remove(&folder.full_path);
                } else {
                    self.explorer
                        .collapsed_folders
                        .insert(folder.full_path.clone());
                }
            }
            if !collapsed {
                self.render_folder_children(ui, folder, depth + 1, force_open, select_id);
            }
        }
        for item in &node.notes {
            let path = string(item, "path");
            let name = path.rsplit('/').next().unwrap_or(path);
            let selected = item["id"] == self.note["id"];
            let space_badge = if self.explorer.space_filter.is_empty() {
                self.spaces
                    .iter()
                    .find(|s| s["id"] == item["spaceId"])
                    .and_then(|s| s["name"].as_str())
                    .map(|s| s.chars().take(1).collect::<String>())
            } else {
                None
            };
            if nav_item_indented(ui, selected, name, indent, space_badge.as_deref())
                .on_hover_text(path)
                .clicked()
            {
                *select_id = Some(string(item, "id").to_string());
            }
        }
    }
}
