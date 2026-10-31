//! Left navigation rail, top workspace bar and bottom status bar for Helious Windows.
use crate::{
    app::{string, HeliousApp, Page},
    chrome::{badge_pill, kbd_badge, nav_item, nav_item_indented, palette, section_label},
};
use eframe::egui::{self, RichText, Stroke};
use serde_json::{json, Value};

impl HeliousApp {
    pub fn show_sidebar(&mut self, ui: &mut egui::Ui) {
        if !self.sidebar_open {
            return;
        }
        let colors = palette(ui.visuals().dark_mode);
        egui::Panel::left("navigation")
            .exact_size(236.0)
            .frame(
                egui::Frame::new()
                    .fill(colors.sidebar)
                    .stroke(Stroke::new(1.0, colors.line))
                    .inner_margin(egui::Margin::symmetric(10, 12)),
            )
            .show_separator_line(false)
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.add_space(4.0);
                    ui.image((self.logo.id(), egui::vec2(26.0, 26.0)));
                    ui.label(RichText::new("helious.").size(20.0).strong());
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui
                            .small_button("«")
                            .on_hover_text("Collapse navigation sidebar (Ctrl+B)")
                            .clicked()
                        {
                            self.sidebar_open = false;
                        }
                    });
                });
                ui.add_space(8.0);
                if nav_item_indented(ui, false, "Quick switch", 0.0, Some("Ctrl+K"))
                    .on_hover_text("Jump to any note or run a workspace command (Ctrl+K)")
                    .clicked()
                {
                    self.open_palette();
                }
                ui.add_space(4.0);

                egui::Panel::bottom("navigation-account")
                    .frame(egui::Frame::NONE)
                    .show_separator_line(false)
                    .show(ui, |ui| {
                        ui.separator();
                        ui.add_space(2.0);
                        if nav_item(ui, self.page == Page::Account, "Account").clicked() {
                            self.go(Page::Account);
                        }
                        if nav_item_indented(
                            ui,
                            self.page == Page::Settings,
                            "Settings",
                            0.0,
                            Some("Ctrl+,"),
                        )
                        .clicked()
                        {
                            self.go(Page::Settings);
                        }
                        if nav_item(ui, false, "Help & documentation")
                            .on_hover_text("Opens the desktop guide in your browser")
                            .clicked()
                        {
                            let _ = open::that(format!(
                                "{}/docs/desktop",
                                helious_native::CLOUD_ORIGIN
                            ));
                        }
                    });

                egui::ScrollArea::vertical()
                    .id_salt("navigation-scroll")
                    .show(ui, |ui| {
                        section_label(ui, "WORKSPACE");
                        for (page, label) in [
                            (Page::Workspace, "Workspace"),
                            (Page::Graph, "Graph"),
                            (Page::Canvas, "Canvas"),
                            (Page::Sync, "Sync"),
                        ] {
                            if nav_item(ui, self.page == page, label).clicked() {
                                self.go(page);
                            }
                        }

                        section_label(ui, "ON THIS DEVICE");
                        let recent = self.status["recent"]
                            .as_array()
                            .cloned()
                            .unwrap_or_default();
                        for item in recent.iter().take(8) {
                            let selected = self.source == "local" && self.vault["id"] == item["id"];
                            if nav_item(ui, selected, string(item, "name"))
                                .on_hover_text(string(item, "path"))
                                .clicked()
                            {
                                self.navigate(json!({"operation":"open_recent","id":item["id"]}));
                            }
                        }
                        if nav_item_indented(ui, false, "Open folder…", 0.0, Some("Ctrl+O"))
                            .on_hover_text("Open or create a local Markdown vault (Ctrl+O)")
                            .clicked()
                        {
                            self.open_folder();
                        }

                        section_label(ui, "HELIOUS CLOUD");
                        if self.me.is_null() {
                            if nav_item(ui, false, "Sign in to Helious Cloud").clicked() {
                                self.go(Page::Account);
                            }
                        } else {
                            for item in self.server_vaults.clone() {
                                let selected =
                                    self.source == "server" && self.vault["id"] == item["id"];
                                if nav_item(ui, selected, string(&item, "name")).clicked() {
                                    self.navigate(json!({"operation":"open_server","vault":item}));
                                }
                            }
                            if self.server_vaults.is_empty() {
                                ui.horizontal(|ui| {
                                    ui.add_space(12.0);
                                    ui.weak("No Cloud vaults yet.");
                                });
                            }
                        }
                    });
            });
    }

    pub fn show_top_bar(&mut self, ui: &mut egui::Ui) {
        let colors = palette(ui.visuals().dark_mode);
        egui::Panel::top("app-header")
            .exact_size(46.0)
            .frame(
                egui::Frame::new()
                    .fill(colors.elevated)
                    .stroke(Stroke::new(1.0, colors.line))
                    .inner_margin(egui::Margin::symmetric(12, 6)),
            )
            .show_separator_line(false)
            .show(ui, |ui| {
                ui.horizontal_centered(|ui| {
                    if !self.sidebar_open
                        && ui
                            .button("» Navigation")
                            .on_hover_text("Expand navigation sidebar (Ctrl+B)")
                            .clicked()
                    {
                        self.sidebar_open = true;
                    }
                    let title = match self.page {
                        Page::Workspace => "Workspace",
                        Page::Graph => "Graph",
                        Page::Canvas => "Canvas",
                        Page::Sync => "Sync",
                        Page::Account => "Account",
                        Page::Settings => "Settings",
                    };
                    ui.label(RichText::new(title).size(14.5).strong());
                    let in_vault = matches!(
                        self.page,
                        Page::Workspace | Page::Graph | Page::Canvas | Page::Sync
                    );
                    if in_vault && !self.vault.is_null() {
                        ui.weak("›");
                        ui.label(RichText::new(string(&self.vault, "name")).strong());
                        badge_pill(
                            ui,
                            if self.source == "local" {
                                "Local"
                            } else {
                                "Cloud"
                            },
                            if self.source == "local" {
                                colors.muted
                            } else {
                                colors.accent
                            },
                        );
                    }

                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        let account = if self.me.is_null() {
                            "Sign in".to_string()
                        } else {
                            let n = string(&self.me, "name");
                            if n.is_empty() {
                                string(&self.me, "email").to_string()
                            } else {
                                n.to_string()
                            }
                        };
                        if ui
                            .button(account)
                            .on_hover_text("Open your Helious account")
                            .clicked()
                        {
                            self.go(Page::Account);
                        }
                        if ui
                            .button("Search / Jump")
                            .on_hover_text("Open Quick Switcher and Command Palette (Ctrl+K)")
                            .clicked()
                        {
                            self.open_palette();
                        }
                        kbd_badge(ui, "Ctrl+K");
                        if self.pending.is_some() {
                            ui.spinner();
                        }
                    });
                });
            });
    }

    pub fn show_status_bar(&mut self, ui: &mut egui::Ui) {
        let colors = palette(ui.visuals().dark_mode);
        egui::Panel::bottom("status")
            .exact_size(28.0)
            .frame(
                egui::Frame::new()
                    .fill(colors.elevated)
                    .stroke(Stroke::new(1.0, colors.line))
                    .inner_margin(egui::Margin::symmetric(12, 4)),
            )
            .show_separator_line(false)
            .show(ui, |ui| {
                ui.horizontal_centered(|ui| {
                    if self.dirty() {
                        ui.colored_label(colors.warn, "• Unsaved draft");
                    } else {
                        ui.small(format!("Helious {}", env!("CARGO_PKG_VERSION")));
                    }
                    if !self.vault.is_null() {
                        ui.separator();
                        ui.small(format!("{} notes", self.notes.len()));
                    }
                    if !self.note.is_null() && self.page == Page::Workspace {
                        let words = helious_native::knowledge::word_count(&self.markdown);
                        let mins = words.div_ceil(200);
                        ui.separator();
                        ui.small(if mins > 0 {
                            format!("{words} words · ~{mins} min read")
                        } else {
                            "0 words".to_string()
                        });
                    }
                    if !self.message.is_empty() {
                        ui.separator();
                        ui.small(&self.message);
                    }
                    if !self.vault.is_null() && self.source == "local" {
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            if !self.sync_config.is_null() {
                                let last = string(&self.sync_config, "lastSync");
                                ui.small(if last.is_empty() {
                                    "Sync paired".to_string()
                                } else {
                                    format!("Last synced: {last}")
                                });
                            } else if self.me != Value::Null {
                                ui.small("Local only (not paired)");
                            }
                        });
                    }
                });
            });
    }
}
