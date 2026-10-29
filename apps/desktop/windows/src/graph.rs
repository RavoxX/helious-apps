use eframe::egui::{self, Color32, Stroke, Vec2};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
struct Node {
    id: String,
    title: String,
    position: Vec2,
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
    filter: String,
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
            filter: String::new(),
        }
    }
}
impl Graph {
    pub fn load(&mut self, value: &Value) {
        let palette = [
            Color32::from_rgb(110, 173, 240),
            Color32::from_rgb(152, 137, 224),
            Color32::from_rgb(103, 191, 157),
            Color32::from_rgb(220, 166, 96),
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
                    * 18.0;
                Node {
                    id,
                    title: n["title"]
                        .as_str()
                        .or(n["path"].as_str())
                        .unwrap_or("Note")
                        .into(),
                    position: egui::vec2(angle.cos() * radius, angle.sin() * radius),
                    degree: n["incoming"].as_f64().unwrap_or(0.0) as f32
                        + n["outgoing"].as_f64().unwrap_or(0.0) as f32
                        + n["degree"].as_f64().unwrap_or(0.0) as f32,
                    color: palette[seed as usize % palette.len()],
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
        self.pan = Vec2::ZERO;
        self.zoom = (500.0 / (self.nodes.len() as f32).sqrt().max(8.0) / 18.0).min(1.8);
    }
    fn step(&mut self) {
        let mut grid: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
        let cell = 70.0;
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
                            delta[i] += offset / d * 15.0;
                        }
                    }
                }
            }
            delta[i] -= n.position * 0.0008;
        }
        for (a, b) in &self.edges {
            let offset = self.nodes[*b].position - self.nodes[*a].position;
            let d = offset.length().max(1.0);
            let force = offset / d * (d - 75.0) * 0.012;
            delta[*a] += force;
            delta[*b] -= force;
        }
        for (n, d) in self.nodes.iter_mut().zip(delta) {
            n.position += d / (d.length() / 5.0).max(1.0);
        }
        self.iterations += 1;
    }
    pub fn show(&mut self, ui: &mut egui::Ui) -> Option<String> {
        ui.heading("Your connected knowledge");
        ui.horizontal(|ui| {
            ui.label(format!(
                "{} notes · {} links",
                self.nodes.len(),
                self.edges.len()
            ));
            ui.separator();
            ui.text_edit_singleline(&mut self.filter);
            ui.checkbox(&mut self.pause, "Pause layout");
            if ui.button("Fit").clicked() {
                self.pan = Vec2::ZERO;
                self.zoom = (500.0 / (self.nodes.len() as f32).sqrt().max(8.0) / 18.0).min(1.8);
            }
            if ui.button("−").clicked() {
                self.zoom = (self.zoom / 1.2).max(0.02);
            }
            if ui.button("+").clicked() {
                self.zoom = (self.zoom * 1.2).min(5.0);
            }
        });
        if self.nodes.is_empty() {
            ui.add_space(40.0);
            ui.label("Open a vault and choose Graph to see links between its saved notes.");
            return None;
        }
        let (rect, response) =
            ui.allocate_exact_size(ui.available_size(), egui::Sense::click_and_drag());
        if response.dragged() {
            self.pan += response.drag_delta();
        }
        if response.hovered() {
            let delta = ui.input(|i| i.smooth_scroll_delta.y);
            if delta != 0.0 {
                self.zoom = (self.zoom * (delta * 0.002).exp()).clamp(0.02, 5.0);
            }
        }
        if !self.pause && self.iterations < 700 {
            self.step();
            ui.ctx()
                .request_repaint_after(std::time::Duration::from_millis(32));
        }
        let point = |n: &Node| rect.center() + self.pan + n.position * self.zoom;
        let hover = response.hover_pos().and_then(|p| {
            self.nodes
                .iter()
                .enumerate()
                .filter_map(|(i, n)| {
                    let d = point(n).distance(p);
                    (d < 12.0).then_some((i, d))
                })
                .min_by(|a, b| a.1.total_cmp(&b.1))
                .map(|(i, _)| i)
        });
        let mut neighbors = HashSet::new();
        if let Some(h) = hover {
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
        let visible: Vec<_> = self
            .nodes
            .iter()
            .map(|n| {
                self.filter.is_empty()
                    || n.title.to_lowercase().contains(&self.filter.to_lowercase())
            })
            .collect();
        let painter = ui.painter_at(rect);
        painter.rect_filled(rect, 0.0, Color32::from_rgb(16, 17, 18));
        for (a, b) in &self.edges {
            if visible[*a] && visible[*b] {
                let highlighted = hover.is_some_and(|h| h == *a || h == *b);
                let color = if highlighted {
                    Color32::from_rgb(108, 160, 216)
                } else {
                    Color32::from_rgba_unmultiplied(
                        115,
                        125,
                        140,
                        if hover.is_some() { 14 } else { 55 },
                    )
                };
                painter.line_segment(
                    [point(&self.nodes[*a]), point(&self.nodes[*b])],
                    Stroke::new(if highlighted { 1.2 } else { 0.65 }, color),
                );
            }
        }
        for (i, n) in self.nodes.iter().enumerate() {
            if !visible[i] {
                continue;
            }
            let p = point(n);
            if !rect.expand(10.0).contains(p) {
                continue;
            }
            let color = if hover.is_some() && !neighbors.contains(&i) {
                n.color.gamma_multiply(0.2)
            } else {
                n.color
            };
            painter.circle_filled(p, (2.0 + n.degree.sqrt() * 0.7).clamp(2.0, 10.0), color);
            if hover == Some(i) {
                painter.text(
                    p + egui::vec2(9.0, 0.0),
                    egui::Align2::LEFT_CENTER,
                    &n.title,
                    egui::FontId::proportional(13.0),
                    Color32::WHITE,
                );
            }
        }
        if response.clicked() {
            hover.map(|i| self.nodes[i].id.clone())
        } else {
            None
        }
    }
}
