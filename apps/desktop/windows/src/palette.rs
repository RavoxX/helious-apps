//! Ctrl+K / Ctrl+P Quick Switcher & Command Palette for Helious Windows.
use crate::{
    app::{string, HeliousApp, Page},
    chrome::{kbd_badge, nav_item_indented, palette},
};
use eframe::egui::{self, Stroke};

enum PaletteAction {
    OpenNote(String),
    GoPage(Page),
    OpenDaily,
    OpenFolder,
    ToggleTheme,
    ToggleInspector,
    ToggleSidebar,
    SetMode(u8),
}

impl HeliousApp {
    pub fn open_palette(&mut self) {
        self.palette.open = true;
        self.palette.just_opened = true;
        self.palette.query.clear();
        self.palette.selected = 0;
    }

    pub fn show_palette_modal(&mut self, ctx: &egui::Context) {
        if !self.palette.open {
            return;
        }
        let colors = palette(ctx.global_style().visuals.dark_mode);
        let mut chosen: Option<PaletteAction> = None;
        let mut should_close = false;

        egui::Window::new("Quick Switcher & Commands")
            .collapsible(false)
            .resizable(false)
            .title_bar(false)
            .fixed_size([540.0, 380.0])
            .anchor(egui::Align2::CENTER_TOP, [0.0, 84.0])
            .frame(
                egui::Frame::new()
                    .fill(colors.elevated)
                    .stroke(Stroke::new(1.0, colors.strong_line))
                    .corner_radius(10)
                    .inner_margin(egui::Margin::same(14)),
            )
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    ui.strong("Jump to note or run command");
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.small_button("Esc").clicked() {
                            should_close = true;
                        }
                        kbd_badge(ui, "Up/Down · Enter");
                    });
                });
                ui.add_space(4.0);
                let input = ui.add(
                    egui::TextEdit::singleline(&mut self.palette.query)
                        .hint_text("Type a note title, folder path, or > command…")
                        .desired_width(f32::INFINITY),
                );
                if self.palette.just_opened {
                    input.request_focus();
                    self.palette.just_opened = false;
                }
                if input.changed() {
                    self.palette.selected = 0;
                }

                let raw = self.palette.query.trim();
                let command_only = raw.starts_with('>');
                let q = raw.trim_start_matches('>').trim().to_lowercase();

                let mut entries: Vec<(String, String, PaletteAction)> = Vec::new();
                if !command_only {
                    for note in &self.notes {
                        let title = string(note, "title");
                        let path = string(note, "path");
                        if q.is_empty()
                            || title.to_lowercase().contains(&q)
                            || path.to_lowercase().contains(&q)
                        {
                            let label = if title.is_empty() {
                                path.to_string()
                            } else {
                                format!("{title}  —  {path}")
                            };
                            entries.push((
                                label,
                                "Note".into(),
                                PaletteAction::OpenNote(string(note, "id").to_string()),
                            ));
                        }
                        if entries.len() >= 25 {
                            break;
                        }
                    }
                }

                let commands: [(&str, &str, PaletteAction); 11] = [
                    (
                        "Command: Open today's daily note",
                        "Daily",
                        PaletteAction::OpenDaily,
                    ),
                    (
                        "Command: Open local folder…",
                        "Ctrl+O",
                        PaletteAction::OpenFolder,
                    ),
                    (
                        "Command: Switch appearance (Dark / Light)",
                        "Theme",
                        PaletteAction::ToggleTheme,
                    ),
                    (
                        "Command: Toggle right Inspector",
                        "Panel",
                        PaletteAction::ToggleInspector,
                    ),
                    (
                        "Command: Toggle left Navigation rail",
                        "Ctrl+B",
                        PaletteAction::ToggleSidebar,
                    ),
                    (
                        "Command: Editor Source mode",
                        "View",
                        PaletteAction::SetMode(0),
                    ),
                    (
                        "Command: Editor Reading mode",
                        "View",
                        PaletteAction::SetMode(1),
                    ),
                    (
                        "Command: Editor Split mode",
                        "View",
                        PaletteAction::SetMode(2),
                    ),
                    (
                        "Go to: Knowledge Graph",
                        "Graph",
                        PaletteAction::GoPage(Page::Graph),
                    ),
                    (
                        "Go to: Canvas boards",
                        "Canvas",
                        PaletteAction::GoPage(Page::Canvas),
                    ),
                    (
                        "Go to: Settings",
                        "Ctrl+,",
                        PaletteAction::GoPage(Page::Settings),
                    ),
                ];
                for (name, hint, act) in commands {
                    if q.is_empty() || name.to_lowercase().contains(&q) {
                        entries.push((name.to_string(), hint.to_string(), act));
                    }
                }

                let count = entries.len();
                if count > 0 {
                    self.palette.selected = self.palette.selected.min(count - 1);
                }

                ui.input(|i| {
                    if i.key_pressed(egui::Key::Escape) {
                        should_close = true;
                    } else if i.key_pressed(egui::Key::ArrowDown) && count > 0 {
                        self.palette.selected = (self.palette.selected + 1) % count;
                    } else if i.key_pressed(egui::Key::ArrowUp) && count > 0 {
                        self.palette.selected = (self.palette.selected + count - 1) % count;
                    } else if i.key_pressed(egui::Key::Enter) && count > 0 {
                        // Handled below via index capture
                    }
                });
                let pressed_enter = ui.input(|i| i.key_pressed(egui::Key::Enter));

                ui.separator();
                egui::ScrollArea::vertical()
                    .id_salt("palette-results")
                    .max_height(280.0)
                    .show(ui, |ui| {
                        if entries.is_empty() {
                            ui.weak("No matching notes or commands.");
                        }
                        for (idx, (label, badge, action)) in entries.into_iter().enumerate() {
                            let selected = idx == self.palette.selected;
                            if (pressed_enter && selected)
                                || nav_item_indented(ui, selected, &label, 0.0, Some(&badge))
                                    .clicked()
                            {
                                chosen = Some(action);
                            }
                        }
                    });
            });

        if should_close {
            self.palette.open = false;
            return;
        }
        if let Some(action) = chosen {
            self.palette.open = false;
            match action {
                PaletteAction::OpenNote(id) => self.select_note(&id),
                PaletteAction::GoPage(p) => self.go(p),
                PaletteAction::OpenDaily => self.open_today_daily(),
                PaletteAction::OpenFolder => self.open_folder(),
                PaletteAction::ToggleTheme => {
                    self.theme = if self.theme == "light" {
                        "dark".into()
                    } else {
                        "light".into()
                    };
                    self.settings_dirty = true;
                }
                PaletteAction::ToggleInspector => self.inspector = !self.inspector,
                PaletteAction::ToggleSidebar => self.sidebar_open = !self.sidebar_open,
                PaletteAction::SetMode(m) => {
                    self.page = Page::Workspace;
                    self.mode = m;
                }
            }
        }
    }
}
