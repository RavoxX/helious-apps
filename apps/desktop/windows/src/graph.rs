//! Theme-aware native force-directed Knowledge Graph with node inspector and orphan filter.
use crate::chrome::palette;
use eframe::egui::{self, Color32, RichText, Stroke, Vec2};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

struct Node {
    id: String,
    title: String,
    path: String,
    tags: Vec<String>,
    position: Vec2,
    incoming: usize,
    outgoing: usize,
    degree: f32,
    color: Color32,
}

pub struct Graph {
    nodes: Vec<Node>,
    edges: Vec<(usize, usize)>,
    pan: Vec2,
    zoom: f32,
    iterations: usize,
    pause: bool,
    show_orphans: bool,
    filter: String,
    selected: Option<usize>,
}

impl Default for Graph {
    fn default() -> Self {
        Self {
            nodes: vec![],
            edges: vec![],
            pan: Vec2::ZERO,
            zoom: 1.0,
            iterations: 0,
            pause: false,
            show_orphans: true,
            filter: String::new(),
            selected: None,
        }
    }
}

impl Graph {
    pub fn load(&mut self, value: &Value) {
        let accents = [
            Color32::from_rgb(84, 156, 248),
            Color32::from_rgb(142, 124, 232),
            Color32::from_rgb(76, 184, 144),
            Color32::from_rgb(224, 158, 78),
        ];
        self.nodes = value["nodes"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|n| n["kind"] != "missing" && n["kind"] != "attachment")
            .take(10000)
            .enumerate()
            .map(|(i, n)| {
                let id = n["id"].as_str().unwrap_or("").to_string();
                let seed = id.bytes().fold(i as u64 + 1, |a, b| {
                    a.wrapping_mul(31).wrapping_add(b as u64)
                });
                let angle = (seed % 62831) as f32 / 10000.0;
                let radius = ((seed / 62831 % 10000) as f32 / 10000.0).sqrt()
                    * (value["nodes"].as_array().map_or(1, Vec::len) as f32).sqrt()
                    * 20.0;
                let inc = n["incoming"].as_u64().unwrap_or(0) as usize;
                let out = n["outgoing"].as_u64().unwrap_or(0) as usize;
                let deg = if inc + out > 0 {
                    (inc + out) as f32
                } else {
                    n["degree"].as_f64().unwrap_or(0.0) as f32
                };
                let tags = n["tags"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default();
                Node {
                    id,
                    title: n["title"]
                        .as_str()
                        .or(n["path"].as_str())
                        .unwrap_or("Note")
                        .into(),
                    path: n["path"].as_str().unwrap_or("").into(),
                    tags,
                    position: egui::vec2(angle.cos() * radius, angle.sin() * radius),
                    incoming: inc,
                    outgoing: out,
                    degree: deg,
                    color: accents[seed as usize % accents.len()],
                }
            })
            .collect();
        let lookup: HashMap<_, _> = self
            .nodes
            .iter()
            .enumerate()
            .map(|(i, n)| (n.id.clone(), i))
            .collect();
        self.edges = value["edges"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|e| {
                Some((
                    *lookup.get(e["source"].as_str()?)?,
                    *lookup.get(e["target"].as_str()?)?,
                ))
            })
            .take(40000)
            .collect();
        self.iterations = 0;
        self.selected = None;
        self.pan = Vec2::ZERO;
        self.zoom = (500.0 / (self.nodes.len() as f32).sqrt().max(8.0) / 18.0).min(1.8);
    }

    fn step(&mut self) {
        let mut grid: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
        let cell = 72.0;
        for (i, n) in self.nodes.iter().enumerate() {
            grid.entry((
                (n.position.x / cell).floor() as i32,
                (n.position.y / cell).floor() as i32,
            ))
            .or_default()
            .push(i);
        }
        let mut delta = vec![Vec2::ZERO; self.nodes.len()];
        for (i, n) in self.nodes.iter().enumerate() {
            let x = (n.position.x / cell).floor() as i32;
            let y = (n.position.y / cell).floor() as i32;
            let mut interactions = 0;
            for dx in -1..=1 {
                for dy in -1..=1 {
                    if let Some(neighbors) = grid.get(&(x + dx, y + dy)) {
                        for j in neighbors.iter().take(96) {
                            if *j == i || interactions >= 96 {
                                continue;
                            }
                            interactions += 1;
                            let offset = n.position - self.nodes[*j].position;
                            let d = offset.length_sq().max(25.0);
                            delta[i] += offset / d * 16.0;
                        }
                    }
                }
            }
            delta[i] -= n.position * 0.0008;
        }
        for (a, b) in &self.edges {
            let offset = self.nodes[*b].position - self.nodes[*a].position;
            let d = offset.length().max(1.0);
            let force = offset / d * (d - 78.0) * 0.012;
            delta[*a] += force;
            delta[*b] -= force;
        }
        for (n, d) in self.nodes.iter_mut().zip(delta) {
            n.position += d / (d.length() / 5.0).max(1.0);
        }
        self.iterations += 1;
    }

    pub fn show(&mut self, ui: &mut egui::Ui) -> Option<String> {
        let dark = ui.visuals().dark_mode;
        let colors = palette(dark);
        let mut open_note: Option<String> = None;

        egui::Frame::new()
            .inner_margin(egui::Margin::symmetric(14, 10))
            .show(ui, |ui| {
                ui.horizontal_wrapped(|ui| {
                    ui.label(RichText::new("Connected knowledge").size(19.0).strong());
                    ui.weak(format!(
                        "{} notes · {} links",
                        self.nodes.len(),
                        self.edges.len()
                    ));
                    ui.separator();
                    ui.add(
                        egui::TextEdit::singleline(&mut self.filter)
                            .hint_text("Filter nodes by title, path or #tag…")
                            .desired_width(220.0),
                    );
                    ui.checkbox(&mut self.show_orphans, "Orphans");
                    ui.checkbox(&mut self.pause, "Pause layout");
                    if ui.button("Fit graph").clicked() {
                        self.pan = Vec2::ZERO;
                        self.zoom =
                            (500.0 / (self.nodes.len() as f32).sqrt().max(8.0) / 18.0).min(1.8);
                    }
                    if ui.button("Zoom out").clicked() {
                        self.zoom = (self.zoom / 1.2).max(0.05);
                    }
                    if ui.button("Zoom in").clicked() {
                        self.zoom = (self.zoom * 1.2).min(5.0);
                    }
                });
            });

        if self.nodes.is_empty() {
            ui.add_space(48.0);
            ui.vertical_centered(|ui| {
                ui.label("Open a vault with saved Markdown notes to explore its real link graph.");
            });
            return None;
        }

        if let Some(sel_idx) = self.selected.filter(|i| *i < self.nodes.len()) {
            let sel = &self.nodes[sel_idx];
            egui::Frame::new()
                .fill(colors.card)
                .stroke(Stroke::new(1.0, colors.line))
                .corner_radius(6)
                .inner_margin(egui::Margin::symmetric(12, 8))
                .show(ui, |ui| {
                    ui.horizontal_wrapped(|ui| {
                        ui.strong(&sel.title);
                        ui.weak(&sel.path);
                        ui.small(format!(
                            "{} incoming · {} outgoing",
                            sel.incoming, sel.outgoing
                        ));
                        if ui.button("Open selected note").clicked() {
                            open_note = Some(sel.id.clone());
                        }
                        if ui.small_button("Clear selection").clicked() {
                            self.selected = None;
                        }
                    });
                });
            ui.add_space(4.0);
        }

        let (rect, response) =
            ui.allocate_exact_size(ui.available_size(), egui::Sense::click_and_drag());
        response.widget_info(|| {
            egui::WidgetInfo::labeled(egui::Role::Canvas, true, "Knowledge graph canvas")
        });

        if response.dragged() {
            self.pan += response.drag_delta();
        }
        if response.hovered() {
            let delta = ui.input(|i| i.smooth_scroll_delta.y);
            if delta != 0.0 {
                self.zoom = (self.zoom * (delta * 0.002).exp()).clamp(0.05, 5.0);
            }
        }
        if !self.pause && self.iterations < 700 {
            self.step();
            ui.ctx()
                .request_repaint_after(std::time::Duration::from_millis(32));
        }

        let point = |n: &Node| rect.center() + self.pan + n.position * self.zoom;
        let query = self.filter.trim().trim_start_matches('#').to_lowercase();
        let visible: Vec<bool> = self
            .nodes
            .iter()
            .map(|n| {
                (self.show_orphans || n.degree > 0.0)
                    && (query.is_empty()
                        || n.title.to_lowercase().contains(&query)
                        || n.path.to_lowercase().contains(&query)
                        || n.tags.iter().any(|t| t.contains(&query)))
            })
            .collect();

        let hover = response.hover_pos().and_then(|p| {
            self.nodes
                .iter()
                .enumerate()
                .filter(|(i, _)| visible[*i])
                .filter_map(|(i, n)| {
                    let d = point(n).distance(p);
                    (d < 14.0).then_some((i, d))
                })
                .min_by(|a, b| a.1.total_cmp(&b.1))
                .map(|(i, _)| i)
        });

        let focus_node = hover.or(self.selected);
        let mut neighbors = HashSet::new();
        if let Some(h) = focus_node {
            neighbors.insert(h);
            for (a, b) in &self.edges {
                if *a == h {
                    neighbors.insert(*b);
                }
                if *b == h {
                    neighbors.insert(*a);
                }
            }
        }

        let canvas_bg = if dark {
            Color32::from_rgb(11, 12, 15)
        } else {
            Color32::from_rgb(246, 248, 251)
        };
        let painter = ui.painter_at(rect);
        painter.rect_filled(rect, 8.0, canvas_bg);
        painter.rect_stroke(
            rect,
            8.0,
            Stroke::new(1.0, colors.line),
            egui::StrokeKind::Inside,
        );

        for (a, b) in &self.edges {
            if visible[*a] && visible[*b] {
                let highlighted = focus_node.is_some_and(|h| h == *a || h == *b);
                let edge_color = if highlighted {
                    colors.accent
                } else if dark {
                    Color32::from_rgba_unmultiplied(
                        130,
                        142,
                        162,
                        if focus_node.is_some() { 18 } else { 68 },
                    )
                } else {
                    Color32::from_rgba_unmultiplied(
                        92,
                        105,
                        126,
                        if focus_node.is_some() { 26 } else { 88 },
                    )
                };
                painter.line_segment(
                    [point(&self.nodes[*a]), point(&self.nodes[*b])],
                    Stroke::new(if highlighted { 1.4 } else { 0.8 }, edge_color),
                );
            }
        }

        let show_all_labels = self.nodes.len() <= 28 || self.zoom > 1.35;
        for (i, n) in self.nodes.iter().enumerate() {
            if !visible[i] {
                continue;
            }
            let p = point(n);
            if !rect.expand(16.0).contains(p) {
                continue;
            }
            let dimmed = focus_node.is_some() && !neighbors.contains(&i);
            let node_color = if dimmed {
                n.color.gamma_multiply(0.24)
            } else {
                n.color
            };
            let radius = (3.2 + n.degree.sqrt() * 1.1).clamp(3.2, 11.0);
            if self.selected == Some(i) || hover == Some(i) {
                painter.circle_stroke(p, radius + 3.0, Stroke::new(1.5, colors.accent));
            }
            painter.circle_filled(p, radius, node_color);
            if hover == Some(i) || self.selected == Some(i) || (show_all_labels && !dimmed) {
                painter.text(
                    p + egui::vec2(radius + 6.0, 0.0),
                    egui::Align2::LEFT_CENTER,
                    &n.title,
                    egui::FontId::proportional(12.5),
                    colors.text,
                );
            }
        }

        if response.double_clicked() {
            if let Some(i) = hover {
                return Some(self.nodes[i].id.clone());
            }
        } else if response.clicked() {
            self.selected = hover;
        }
        open_note
    }
}
