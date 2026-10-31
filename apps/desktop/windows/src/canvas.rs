use crate::app::{string, HeliousApp};
use eframe::egui::{self, Color32, Pos2, Rect, Stroke, Vec2};
use serde_json::{json, Value};
pub struct CanvasState {
    pub files: Vec<Value>,
    pub file: Value,
    pub document: Value,
    pub saved: Value,
    pub saving: Value,
    pub new_path: String,
    pub space: String,
    pub selected: String,
    pub kind: String,
    pub content: String,
    pub width: i64,
    pub height: i64,
    pub from: String,
    pub to: String,
    pub label: String,
    pub zoom: f32,
    pub pan: Vec2,
    pub history: helious_native::canvas::History,
    pub drag_origin: Option<Value>,
    pub confirm_delete: bool,
    pub fit: bool,
}
impl Default for CanvasState {
    fn default() -> Self {
        Self {
            files: vec![],
            file: Value::Null,
            document: json!({"nodes":[],"edges":[]}),
            saved: json!({"nodes":[],"edges":[]}),
            saving: Value::Null,
            new_path: String::new(),
            space: String::new(),
            selected: String::new(),
            kind: "text".into(),
            content: String::new(),
            width: 280,
            height: 180,
            from: String::new(),
            to: String::new(),
            label: String::new(),
            zoom: 1.0,
            pan: egui::vec2(50.0, 50.0),
            history: Default::default(),
            drag_origin: None,
            confirm_delete: false,
            fit: false,
        }
    }
}
impl CanvasState {
    pub fn dirty(&self) -> bool {
        !self.file.is_null() && self.document != self.saved
    }
    pub fn discard(&mut self) {
        self.document = self.saved.clone();
        self.history = Default::default();
    }
    pub fn load(&mut self, data: Value) {
        self.file = data["file"].clone();
        self.document = data["document"].clone();
        self.saved = self.document.clone();
        self.selected.clear();
        self.history = Default::default();
        self.pan = egui::vec2(50.0, 50.0);
        self.zoom = 1.0;
    }
    fn select(&mut self, id: &str) {
        self.selected = id.into();
        if let Some(n) = self.document["nodes"]
            .as_array()
            .and_then(|a| a.iter().find(|n| n["id"] == id))
        {
            self.kind = string(n, "type").into();
            self.content = string(
                n,
                match self.kind.as_str() {
                    "file" => "file",
                    "link" => "url",
                    "group" => "label",
                    _ => "text",
                },
            )
            .into();
            self.width = n["width"].as_i64().unwrap_or(280);
            self.height = n["height"].as_i64().unwrap_or(180);
        }
    }
    fn change(&mut self, next: Value) -> Result<(), String> {
        helious_native::canvas::validate(&next)?;
        self.history.record(&self.document);
        self.document = next;
        Ok(())
    }
}
impl HeliousApp {
    pub fn canvas_save(&mut self) {
        if self.canvas.file.is_null() {
            return;
        }
        self.canvas.saving = self.canvas.document.clone();
        let mut req = self.scope("canvas_save");
        req["path"] = self.canvas.file["path"].clone();
        req["spaceId"] = self.canvas.file["spaceId"].clone();
        req["expected"] = self.canvas.file.clone();
        req["text"] = json!(self.canvas.document.to_string());
        self.request("canvas_saved", req);
    }
    pub fn canvas_page(&mut self, ui: &mut egui::Ui) {
        if self.vault.is_null() {
            ui.heading("Open a vault to use Canvas.");
            return;
        }
        ui.heading("Canvas");
        ui.weak("Portable boards. Drag cards, pan the background, and use the wheel to zoom. Save explicitly.");
        ui.horizontal_wrapped(|ui| {
            if ui
                .add_enabled(self.pending.is_none(), egui::Button::new("Refresh boards"))
                .clicked()
            {
                self.request("canvas_list", self.scope("canvas_list"));
            }
            egui::ComboBox::from_id_salt("open-canvas")
                .selected_text(if self.canvas.file.is_null() {
                    "Choose board"
                } else {
                    string(&self.canvas.file, "path")
                })
                .show_ui(ui, |ui| {
                    for file in self.canvas.files.clone() {
                        if ui
                            .selectable_label(
                                self.canvas.file["id"] == file["id"],
                                string(&file, "path"),
                            )
                            .clicked()
                        {
                            if self.canvas.dirty() {
                                self.error =
                                    "Save or discard this board before opening another.".into();
                            } else {
                                let mut req = self.scope("canvas_read");
                                req["id"] = file["id"].clone();
                                self.request("canvas_read", req);
                            }
                        }
                    }
                });
            if self.canvas.space.is_empty() {
                self.canvas.space = self
                    .spaces
                    .iter()
                    .find(|s| s["kind"] == "personal")
                    .map(|s| string(s, "id").to_string())
                    .unwrap_or_default();
            }
            egui::ComboBox::from_id_salt("canvas-space")
                .selected_text(
                    self.spaces
                        .iter()
                        .find(|s| s["id"] == self.canvas.space)
                        .map(|s| string(s, "name"))
                        .unwrap_or("Space"),
                )
                .show_ui(ui, |ui| {
                    for space in &self.spaces {
                        ui.selectable_value(
                            &mut self.canvas.space,
                            string(space, "id").into(),
                            string(space, "name"),
                        );
                    }
                });
            ui.add(
                egui::TextEdit::singleline(&mut self.canvas.new_path)
                    .hint_text("Canvas/Plan.canvas")
                    .desired_width(170.0),
            );
            if ui
                .add_enabled(
                    self.pending.is_none() && !self.canvas.new_path.trim().is_empty(),
                    egui::Button::new("Create canvas"),
                )
                .clicked()
            {
                if self.dirty() {
                    self.error = "Save or discard drafts before creating a board.".into();
                } else {
                    let path = if self.canvas.new_path.to_lowercase().ends_with(".canvas") {
                        self.canvas.new_path.clone()
                    } else {
                        format!("{}.canvas", self.canvas.new_path)
                    };
                    let mut req = self.scope("canvas_save");
                    req["path"] = json!(path);
                    req["spaceId"] = json!(self.canvas.space);
                    req["expected"] = Value::Null;
                    req["text"] = json!("{\"nodes\":[],\"edges\":[]}");
                    self.request("canvas_created", req);
                }
            }
        });
        if self.canvas.file.is_null() {
            ui.add_space(60.0);
            ui.label("Create or choose a board, then add a text, file, link or group card.");
            return;
        }
        ui.horizontal_wrapped(|ui| {
            if ui
                .add_enabled(
                    self.pending.is_none(),
                    egui::Button::new("Save canvas  Ctrl+S"),
                )
                .clicked()
            {
                self.canvas_save();
            }
            if ui.button("Undo").clicked() {
                self.canvas.history.undo(&mut self.canvas.document);
            }
            if ui.button("Redo").clicked() {
                self.canvas.history.redo(&mut self.canvas.document);
            }
            if ui.button("Fit board").clicked() {
                self.canvas.fit = true;
            }
            ui.add(egui::Slider::new(&mut self.canvas.zoom, 0.15..=2.5).text("Zoom"));
            if ui.button("Export .canvas…").clicked() {
                if let Some(path) = rfd::FileDialog::new()
                    .set_file_name(
                        string(&self.canvas.file, "path")
                            .rsplit('/')
                            .next()
                            .unwrap_or("Board.canvas"),
                    )
                    .save_file()
                {
                    if std::fs::write(path, self.canvas.document.to_string()).is_err() {
                        self.error = "Cannot export this board.".into();
                    }
                }
            }
            if ui.button("Discard canvas draft").clicked() {
                self.canvas.discard();
            }
            if ui
                .add_enabled(
                    !self.canvas.dirty() && self.pending.is_none(),
                    egui::Button::new("Delete canvas…"),
                )
                .clicked()
            {
                self.canvas.confirm_delete = true;
            }
            if self.canvas.dirty() {
                ui.strong("Unsaved board");
            }
        });
        egui::CollapsingHeader::new("Cards & connections").default_open(true).show(ui,|ui|{
            ui.horizontal_wrapped(|ui|{egui::ComboBox::from_id_salt("card-kind").selected_text(&self.canvas.kind).show_ui(ui,|ui|{for kind in ["text","file","link","group"]{ui.selectable_value(&mut self.canvas.kind,kind.into(),kind);}});ui.add(egui::TextEdit::singleline(&mut self.canvas.content).hint_text("Card text, vault file path, URL or group label").desired_width(300.0));ui.add(egui::DragValue::new(&mut self.canvas.width).range(100..=4000).prefix("Width "));ui.add(egui::DragValue::new(&mut self.canvas.height).range(60..=4000).prefix("Height "));
                for (add,label) in [(true,"Add card"),(false,"Apply selected card")]{if ui.button(label).clicked(){let mut next=self.canvas.document.clone();let nodes=next["nodes"].as_array_mut().expect("cards");let id=if add{helious_native::vault::id()}else{self.canvas.selected.clone()};if !add{if let Some(n)=nodes.iter().find(|n|n["id"]==id){let(x,y)=(n["x"].clone(),n["y"].clone());nodes.retain(|n|n["id"]!=id);let n=self.canvas_card(&id,x,y);nodes.push(n);}}else{let i=nodes.len() as i64;let (x,y)=if self.canvas.kind=="group"{(-40,-40)}else{((i%4)*320,(i/4)*240)};nodes.push(self.canvas_card(&id,json!(x),json!(y)));}match self.canvas.change(next){Ok(())=>self.canvas.select(&id),Err(e)=>self.error=e}}}
                if ui.button("Delete selected card").clicked(){let mut next=self.canvas.document.clone();next["nodes"].as_array_mut().expect("cards").retain(|n|n["id"]!=self.canvas.selected);next["edges"].as_array_mut().expect("edges").retain(|e|e["fromNode"]!=self.canvas.selected&&e["toNode"]!=self.canvas.selected);if let Err(e)=self.canvas.change(next){self.error=e;}self.canvas.selected.clear();}
            });
            ui.horizontal_wrapped(|ui|{for (from,label) in [(true,"From card"),(false,"To card")]{let current=if from{&mut self.canvas.from}else{&mut self.canvas.to};egui::ComboBox::from_id_salt(label).selected_text(if current.is_empty(){label}else{current.as_str()}).show_ui(ui,|ui|{for n in self.canvas.document["nodes"].as_array().cloned().unwrap_or_default(){ui.selectable_value(current,string(&n,"id").into(),format!("{} · {}",string(&n,"type"),string(&n,"id")));}});}ui.add(egui::TextEdit::singleline(&mut self.canvas.label).hint_text("Connection label").desired_width(180.0));if ui.button("Connect cards").clicked(){let mut next=self.canvas.document.clone();next["edges"].as_array_mut().expect("edges").push(json!({"id":helious_native::vault::id(),"fromNode":self.canvas.from,"toNode":self.canvas.to,"label":self.canvas.label,"toEnd":"arrow"}));if let Err(e)=self.canvas.change(next){self.error=e;}}});
            for e in self.canvas.document["edges"].as_array().cloned().unwrap_or_default(){ui.horizontal(|ui|{ui.small(format!("{} → {} {}",string(&e,"fromNode"),string(&e,"toNode"),string(&e,"label")));if ui.small_button("Remove connection").clicked(){let mut next=self.canvas.document.clone();next["edges"].as_array_mut().expect("edges").retain(|edge|edge["id"]!=e["id"]);let _=self.canvas.change(next);}});}
        });
        let (rect, response) = ui.allocate_exact_size(
            egui::vec2(ui.available_width(), ui.available_height().max(280.0)),
            egui::Sense::click_and_drag(),
        );
        if self.canvas.fit {
            let nodes = self.canvas.document["nodes"].as_array().expect("cards");
            let minx = nodes
                .iter()
                .map(|n| n["x"].as_f64().unwrap_or(0.0))
                .fold(f64::INFINITY, f64::min);
            let miny = nodes
                .iter()
                .map(|n| n["y"].as_f64().unwrap_or(0.0))
                .fold(f64::INFINITY, f64::min);
            let maxx = nodes
                .iter()
                .map(|n| n["x"].as_f64().unwrap_or(0.0) + n["width"].as_f64().unwrap_or(0.0))
                .fold(f64::NEG_INFINITY, f64::max);
            let maxy = nodes
                .iter()
                .map(|n| n["y"].as_f64().unwrap_or(0.0) + n["height"].as_f64().unwrap_or(0.0))
                .fold(f64::NEG_INFINITY, f64::max);
            if !nodes.is_empty() {
                self.canvas.zoom = ((rect.width() - 60.0) / (maxx - minx).max(1.0) as f32)
                    .min((rect.height() - 60.0) / (maxy - miny).max(1.0) as f32)
                    .clamp(0.15, 2.5);
                self.canvas.pan = rect.size() / 2.0
                    - egui::vec2((minx + maxx) as f32 / 2.0, (miny + maxy) as f32 / 2.0)
                        * self.canvas.zoom;
            }
            self.canvas.fit = false;
        }
        let painter = ui.painter_at(rect);
        let dark = ui.visuals().dark_mode;
        painter.rect_filled(
            rect,
            6.0,
            if dark {
                Color32::from_gray(12)
            } else {
                Color32::from_gray(248)
            },
        );
        if response.hovered() {
            let delta = ui.input(|i| i.smooth_scroll_delta);
            if delta.y.abs() > 0.1 {
                self.canvas.zoom = (self.canvas.zoom * (delta.y * 0.002).exp()).clamp(0.15, 2.5);
            }
        }
        let (pan, zoom) = (self.canvas.pan, self.canvas.zoom);
        let screen = |x: f32, y: f32| {
            Pos2::new(
                rect.left() + pan.x + x * zoom,
                rect.top() + pan.y + y * zoom,
            )
        };
        for e in self.canvas.document["edges"]
            .as_array()
            .cloned()
            .unwrap_or_default()
        {
            let nodes = self.canvas.document["nodes"].as_array().expect("cards");
            let a = nodes.iter().find(|n| n["id"] == e["fromNode"]);
            let b = nodes.iter().find(|n| n["id"] == e["toNode"]);
            if let (Some(a), Some(b)) = (a, b) {
                let p = screen(
                    (a["x"].as_f64().unwrap_or(0.0) + a["width"].as_f64().unwrap_or(0.0) / 2.0)
                        as f32,
                    (a["y"].as_f64().unwrap_or(0.0) + a["height"].as_f64().unwrap_or(0.0) / 2.0)
                        as f32,
                );
                let q = screen(
                    (b["x"].as_f64().unwrap_or(0.0) + b["width"].as_f64().unwrap_or(0.0) / 2.0)
                        as f32,
                    (b["y"].as_f64().unwrap_or(0.0) + b["height"].as_f64().unwrap_or(0.0) / 2.0)
                        as f32,
                );
                painter.arrow(
                    p,
                    (q - p) * 0.95,
                    Stroke::new(1.5, ui.visuals().hyperlink_color),
                );
                painter.text(
                    p.lerp(q, 0.5),
                    egui::Align2::CENTER_BOTTOM,
                    string(&e, "label"),
                    egui::FontId::proportional(12.0),
                    ui.visuals().text_color(),
                );
            }
        }
        let mut nodes = self.canvas.document["nodes"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        nodes.sort_by_key(|n| n["type"] != "group");
        let mut dragging = false;
        for n in nodes {
            let p = screen(
                n["x"].as_f64().unwrap_or(0.0) as f32,
                n["y"].as_f64().unwrap_or(0.0) as f32,
            );
            let r = Rect::from_min_size(
                p,
                egui::vec2(
                    n["width"].as_f64().unwrap_or(280.0) as f32,
                    n["height"].as_f64().unwrap_or(180.0) as f32,
                ) * self.canvas.zoom,
            );
            if !r.intersects(rect) {
                continue;
            }
            let id = string(&n, "id");
            let hit = ui.interact(
                r.intersect(rect),
                ui.scope_id().with(id),
                egui::Sense::click_and_drag(),
            );
            painter.rect_filled(
                r,
                5.0,
                if n["type"] == "group" {
                    ui.visuals().faint_bg_color
                } else {
                    ui.visuals().panel_fill
                },
            );
            painter.rect_stroke(
                r,
                5.0,
                Stroke::new(
                    if self.canvas.selected == id { 2.0 } else { 1.0 },
                    if self.canvas.selected == id {
                        ui.visuals().hyperlink_color
                    } else {
                        ui.visuals().widgets.noninteractive.bg_stroke.color
                    },
                ),
                egui::StrokeKind::Inside,
            );
            let key = match string(&n, "type") {
                "file" => "file",
                "link" => "url",
                "group" => "label",
                _ => "text",
            };
            let label = helious_native::knowledge::mask_secrets(string(&n, key));
            let mut galley = egui::text::LayoutJob::simple(
                label,
                egui::FontId::proportional((15.0 * self.canvas.zoom).max(10.0)),
                ui.visuals().text_color(),
                (r.width() - 20.0).max(30.0),
            );
            galley.wrap.max_rows = 8;
            painter.galley(
                r.min + egui::vec2(10.0, 10.0),
                ui.fonts_mut(|f| f.layout_job(galley)),
                ui.visuals().text_color(),
            );
            hit.widget_info(|| {
                egui::WidgetInfo::labeled(
                    egui::accesskit::Role::Button,
                    true,
                    format!(
                        "Select {} card {}",
                        string(&n, "type"),
                        helious_native::knowledge::mask_secrets(string(&n, key))
                    ),
                )
            });
            if hit.clicked() {
                response.request_focus();
                self.canvas.select(id);
            }
            if hit.drag_started() {
                self.canvas.select(id);
                self.canvas.history.record(&self.canvas.document);
                self.canvas.drag_origin = Some(n.clone());
            }
            if hit.dragged() {
                dragging = true;
                if let Some(origin) = &self.canvas.drag_origin {
                    let delta = hit.total_drag_delta().unwrap_or_default() / self.canvas.zoom;
                    if let Some(item) = self.canvas.document["nodes"]
                        .as_array_mut()
                        .expect("cards")
                        .iter_mut()
                        .find(|n| n["id"] == id)
                    {
                        item["x"] = json!((origin["x"].as_f64().unwrap_or(0.0) + delta.x as f64)
                            .round()
                            .clamp(-100000.0, 100000.0)
                            as i64);
                        item["y"] = json!((origin["y"].as_f64().unwrap_or(0.0) + delta.y as f64)
                            .round()
                            .clamp(-100000.0, 100000.0)
                            as i64);
                    }
                }
            }
            if hit.double_clicked() {
                if n["type"] == "file" {
                    if let Some(note) = self.notes.iter().find(|note| {
                        note["path"] == n["file"] && note["spaceId"] == self.canvas.file["spaceId"]
                    }) {
                        let id = string(note, "id").to_string();
                        self.select_note(&id);
                    }
                } else if n["type"] == "link" {
                    let _ = open::that(string(&n, "url"));
                }
            }
        }
        if response.dragged() && !dragging {
            self.canvas.pan += ui.input(|i| i.pointer.delta());
        }
        if response.has_focus() && !self.canvas.selected.is_empty() {
            let mut dx = 0;
            let mut dy = 0;
            ui.input(|i| {
                let step = if i.modifiers.shift { 50 } else { 10 };
                if i.key_pressed(egui::Key::ArrowLeft) {
                    dx -= step;
                }
                if i.key_pressed(egui::Key::ArrowRight) {
                    dx += step;
                }
                if i.key_pressed(egui::Key::ArrowUp) {
                    dy -= step;
                }
                if i.key_pressed(egui::Key::ArrowDown) {
                    dy += step;
                }
            });
            if dx != 0 || dy != 0 {
                let mut next = self.canvas.document.clone();
                if let Some(n) = next["nodes"]
                    .as_array_mut()
                    .expect("cards")
                    .iter_mut()
                    .find(|n| n["id"] == self.canvas.selected)
                {
                    n["x"] = json!((n["x"].as_i64().unwrap_or(0) + dx).clamp(-100000, 100000));
                    n["y"] = json!((n["y"].as_i64().unwrap_or(0) + dy).clamp(-100000, 100000));
                }
                let _ = self.canvas.change(next);
            }
        }
        if self.canvas.confirm_delete {
            egui::Window::new("Delete this canvas?").collapsible(false).show(ui.ctx(),|ui|{ui.label("Delete the saved board? Local history is retained; the server retains only the latest attachment.");if ui.button("Cancel").clicked(){self.canvas.confirm_delete=false;}
if ui.button("Confirm canvas deletion").clicked(){let mut req=self.scope("canvas_delete");req["path"]=self.canvas.file["path"].clone();req["spaceId"]=self.canvas.file["spaceId"].clone();req["expected"]=self.canvas.file.clone();self.request("canvas_deleted",req);self.canvas.confirm_delete=false;}});
        }
    }
    fn canvas_card(&self, id: &str, x: Value, y: Value) -> Value {
        let key = match self.canvas.kind.as_str() {
            "file" => "file",
            "link" => "url",
            "group" => "label",
            _ => "text",
        };
        let mut value = self.canvas.document["nodes"]
            .as_array()
            .and_then(|a| {
                a.iter()
                    .find(|n| n["id"] == id && n["type"] == self.canvas.kind)
            })
            .cloned()
            .unwrap_or_else(|| json!({"id":id,"type":self.canvas.kind}));
        value["x"] = x;
        value["y"] = y;
        value["width"] = json!(self.canvas.width);
        value["height"] = json!(self.canvas.height);
        value[key] = json!(self.canvas.content);
        value
    }
}
