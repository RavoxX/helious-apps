use crate::app::{string, HeliousApp};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use eframe::egui::{self, Color32};
use helious_native::reading::{Block, Span};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
pub struct ReadingState {
    pub key: String,
    pub blocks: Arc<Vec<Block>>,
    pub changed: Instant,
    pub requested: bool,
    pub assets: HashMap<String, Value>,
    pub bytes: HashMap<String, Arc<Vec<u8>>>,
    pub textures: HashMap<String, egui::TextureHandle>,
    pub audio: Option<(rodio::OutputStream, rodio::Sink, String)>,
}
impl Default for ReadingState {
    fn default() -> Self {
        Self {
            key: String::new(),
            blocks: Arc::new(vec![]),
            changed: Instant::now(),
            requested: false,
            assets: HashMap::new(),
            bytes: HashMap::new(),
            textures: HashMap::new(),
            audio: None,
        }
    }
}
impl ReadingState {
    pub fn asset(&mut self, mut data: Value, ctx: &egui::Context) -> Result<(), String> {
        let key = string(&data, "key").to_string();
        if !key.starts_with(&self.key) {
            return Ok(());
        }
        if self.assets.len() >= 20 {
            return Err("Clear previews before opening more attachments.".into());
        }
        if let Some(encoded) = data["data"].as_str() {
            let bytes = STANDARD
                .decode(encoded)
                .map_err(|_| "Invalid preview data.")?;
            if bytes.len() + self.bytes.values().map(|v| v.len()).sum::<usize>() > 32 * 1024 * 1024
            {
                return Err(
                    "Preview memory limit reached. Clear previews or download the original.".into(),
                );
            }
            if data["kind"] == "image" {
                let used: usize = self
                    .textures
                    .iter()
                    .filter(|(id, _)| *id != &key)
                    .map(|(_, t)| t.size()[0] * t.size()[1] * 4)
                    .sum();
                if used as u64 + data["pixelBytes"].as_u64().unwrap_or(64_000_001) > 64_000_000 {
                    return Err("Image memory limit reached. Clear previews first.".into());
                }
                let image = image::load_from_memory(&bytes)
                    .map_err(|_| "Cannot decode preview image.")?
                    .into_rgba8();
                self.textures.insert(
                    key.clone(),
                    ctx.load_texture(
                        &key,
                        egui::ColorImage::from_rgba_unmultiplied(
                            [image.width() as usize, image.height() as usize],
                            &image,
                        ),
                        egui::TextureOptions::LINEAR,
                    ),
                );
            } else {
                self.bytes.insert(key.clone(), Arc::new(bytes));
            }
            data.as_object_mut().expect("preview object").remove("data");
        }
        self.assets.insert(key, data);
        Ok(())
    }
}
fn color(value: &str, fallback: Color32) -> Color32 {
    if value.len() == 7 && value.starts_with('#') {
        if let Ok(rgb) = u32::from_str_radix(&value[1..], 16) {
            return Color32::from_rgb((rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8);
        }
    }
    fallback
}
fn text_job(spans: &[Span], size: f32, ui: &egui::Ui) -> egui::text::LayoutJob {
    let mut job = egui::text::LayoutJob::default();
    job.wrap.max_width = ui.available_width();
    for span in spans {
        let mut format = egui::TextFormat {
            font_id: if span.code {
                egui::FontId::monospace(size)
            } else {
                egui::FontId::proportional(size)
            },
            color: color(
                &span.color,
                if span.target.is_empty() {
                    ui.visuals().text_color()
                } else {
                    ui.visuals().hyperlink_color
                },
            ),
            italics: span.italic,
            ..Default::default()
        };
        if span.bold {
            format.font_id.size += 1.0;
        }
        if span.code {
            format.background = ui.visuals().faint_bg_color;
        }
        if span.strike {
            format.strikethrough = egui::Stroke::new(1.0, format.color);
        }
        job.append(&span.text, 0.0, format);
    }
    job
}
impl HeliousApp {
    pub fn reading_preview(&mut self, ui: &mut egui::Ui) {
        let key = helious_native::vault::hash(
            format!(
                "{}:{}:{}:{}:{}",
                self.source,
                self.vault["id"],
                self.note["id"],
                ui.visuals().dark_mode,
                self.markdown
            )
            .as_bytes(),
        );
        if self.reading.key != key {
            self.reading = ReadingState::default();
            self.reading.key = key;
        }
        if !self.reading.requested
            && self.reading.changed.elapsed() > Duration::from_millis(350)
            && self.pending.is_none()
        {
            self.reading.requested = true;
            self.request("reading_document",json!({"operation":"reading_document","markdown":self.markdown,"dark":ui.visuals().dark_mode,"key":self.reading.key}));
        }
        ui.ctx().request_repaint_after(Duration::from_millis(200));
        ui.horizontal(|ui| {
            ui.small("Reading · local renderers");
            if ui.small_button("Clear attachment previews").clicked() {
                self.reading.assets.clear();
                self.reading.bytes.clear();
                self.reading.textures.clear();
                self.reading.audio = None;
            }
        });
        let blocks = self.reading.blocks.clone();
        egui::ScrollArea::vertical()
            .id_salt("native-reader")
            .show(ui, |ui| {
                self.read_blocks(ui, &blocks, "root", false);
                if blocks.is_empty() {
                    ui.weak("Preparing reading preview…");
                }
            });
    }
    fn read_blocks(&mut self, ui: &mut egui::Ui, blocks: &[Block], path: &str, nested: bool) {
        for (index, block) in blocks.iter().enumerate() {
            let key = format!("{}/{path}/{index}", self.reading.key);
            match block.kind.as_str() {
                "rule" => {
                    ui.separator();
                }
                "code" => {
                    egui::Frame::group(ui.style()).show(ui, |ui| {
                        ui.horizontal(|ui| {
                            ui.small(if block.language.is_empty() {
                                "Plain text"
                            } else {
                                &block.language
                            });
                            if ui.small_button("Copy code").clicked() {
                                ui.ctx().copy_text(block.text.clone());
                            }
                        });
                        egui::ScrollArea::horizontal().id_salt(&key).show(ui, |ui| {
                            let mut job = text_job(&block.spans, self.font_size - 1.0, ui);
                            for section in &mut job.sections {
                                section.format.font_id.family = egui::FontFamily::Monospace;
                            }
                            ui.label(job);
                        });
                    });
                }
                "diagram" | "math" => {
                    egui::Frame::group(ui.style()).show(ui, |ui| {
                        ui.label(if block.kind == "diagram" {
                            "Mermaid diagram"
                        } else {
                            "Formula"
                        });
                        self.render_asset_button(
                            ui,
                            &key,
                            &block.text,
                            if block.kind == "diagram" {
                                "render_diagram"
                            } else {
                                "render_formula"
                            },
                            false,
                        );
                        egui::CollapsingHeader::new("Source")
                            .id_salt(format!("{key}-source"))
                            .show(ui, |ui| {
                                ui.monospace(&block.text);
                            });
                    });
                }
                "embed" => {
                    if nested {
                        ui.weak(format!(
                            "Embedded reference: {}. Open its note directly.",
                            block.target
                        ));
                        continue;
                    }
                    egui::Frame::group(ui.style()).show(ui, |ui| {
                        ui.label(if block.title.is_empty() {
                            &block.target
                        } else {
                            &block.title
                        });
                        if ui
                            .add_enabled(
                                self.pending.is_none(),
                                egui::Button::new("Download original attachment…"),
                            )
                            .clicked()
                        {
                            let mut req = self.scope("reading_download");
                            req["path"] = self.note["path"].clone();
                            req["spaceId"] = self.note["spaceId"].clone();
                            req["target"] = json!(block.target);
                            req["syntax"] = json!(block.syntax);
                            req["key"] = json!(key);
                            self.request("reading_download", req);
                        }
                        if let Some(asset) = self.reading.assets.get(&key).cloned() {
                            self.show_asset(ui, &key, &asset);
                        } else if ui
                            .add_enabled(
                                self.pending.is_none(),
                                egui::Button::new("Preview embedded note or attachment"),
                            )
                            .clicked()
                        {
                            let mut req = self.scope("reading_embed");
                            req["path"] = self.note["path"].clone();
                            req["spaceId"] = self.note["spaceId"].clone();
                            req["target"] = json!(block.target);
                            req["syntax"] = json!(block.syntax);
                            req["dark"] = json!(ui.visuals().dark_mode);
                            req["key"] = json!(key);
                            self.request("reading_asset", req);
                        }
                    });
                }
                "callout" => {
                    let title = if block.title.is_empty() {
                        "Note"
                    } else {
                        &block.title
                    };
                    if block.collapse.is_empty() {
                        egui::Frame::group(ui.style()).show(ui, |ui| {
                            ui.strong(title);
                            self.read_blocks(
                                ui,
                                &block.children,
                                &format!("{path}/{index}"),
                                nested,
                            );
                        });
                    } else {
                        egui::CollapsingHeader::new(title)
                            .id_salt(&key)
                            .default_open(block.collapse != "closed")
                            .show(ui, |ui| {
                                self.read_blocks(
                                    ui,
                                    &block.children,
                                    &format!("{path}/{index}"),
                                    nested,
                                )
                            });
                    }
                }
                "quote" => {
                    egui::Frame::group(ui.style()).show(ui, |ui| {
                        self.read_blocks(ui, &block.children, &format!("{path}/{index}"), nested)
                    });
                }
                "table" => {
                    egui::ScrollArea::horizontal().id_salt(&key).show(ui, |ui| {
                        egui::Grid::new(&key).striped(true).show(ui, |ui| {
                            for (row, child) in block.children.iter().enumerate() {
                                for (cell, item) in child.children.iter().enumerate() {
                                    ui.vertical(|ui| {
                                        ui.set_max_width(280.0);
                                        self.read_blocks(
                                            ui,
                                            std::slice::from_ref(item),
                                            &format!("{path}/{index}/{row}/{cell}"),
                                            nested,
                                        );
                                    });
                                }
                                ui.end_row();
                            }
                        });
                    });
                }
                "list" => {
                    for (item, child) in block.children.iter().enumerate() {
                        ui.horizontal_top(|ui| {
                            ui.label(if block.level == 0 {
                                "•".into()
                            } else {
                                format!("{}.", block.level + item as u32)
                            });
                            ui.vertical(|ui| {
                                self.read_blocks(
                                    ui,
                                    std::slice::from_ref(child),
                                    &format!("{path}/{index}/{item}"),
                                    nested,
                                )
                            });
                        });
                    }
                }
                _ => {
                    if block.kind == "footnote" {
                        ui.strong(format!("[{}]", block.title));
                    }
                    if !block.spans.is_empty() {
                        let size = if block.kind == "heading" {
                            (32.0 - block.level as f32 * 2.5).max(18.0)
                        } else {
                            self.font_size
                        };
                        ui.label(text_job(&block.spans, size, ui));
                        for (i, span) in block.spans.iter().enumerate() {
                            if !span.target.is_empty()
                                && ui.small_button(format!("Open {}", span.text)).clicked()
                            {
                                self.reading_link(&span.target, &span.syntax);
                            }
                            if span.math {
                                self.render_asset_button(
                                    ui,
                                    &format!("{key}-math-{i}"),
                                    &span.text,
                                    "render_formula",
                                    true,
                                );
                            }
                        }
                    }
                    self.read_blocks(ui, &block.children, &format!("{path}/{index}"), nested);
                }
            }
            ui.add_space(8.0);
        }
    }
    fn render_asset_button(
        &mut self,
        ui: &mut egui::Ui,
        key: &str,
        text: &str,
        operation: &str,
        inline: bool,
    ) {
        if let Some(texture) = self.reading.textures.get(key) {
            ui.add(
                egui::Image::from_texture(texture)
                    .fit_to_original_size(0.5)
                    .max_width(ui.available_width()),
            );
        } else if ui
            .add_enabled(
                self.pending.is_none(),
                egui::Button::new(if inline {
                    format!(
                        "Render formula: {}",
                        text.chars().take(60).collect::<String>()
                    )
                } else {
                    "Render preview".into()
                }),
            )
            .clicked()
        {
            self.request(
                "reading_asset",
                json!({"operation":operation,"text":text,"dark":ui.visuals().dark_mode,"key":key}),
            );
        }
    }
    fn show_asset(&mut self, ui: &mut egui::Ui, key: &str, asset: &Value) {
        match string(asset, "kind") {
            "image" => {
                if let Some(texture) = self.reading.textures.get(key) {
                    ui.add(egui::Image::from_texture(texture).max_width(ui.available_width()));
                }
            }
            "note" => {
                if ui
                    .small_button(format!("Open {}", string(asset, "path")))
                    .clicked()
                {
                    self.select_note(string(asset, "id"));
                }
                if let Ok(blocks) = serde_json::from_value::<Vec<Block>>(asset["blocks"].clone()) {
                    self.read_blocks(ui, &blocks, &format!("embedded/{key}"), true);
                }
            }
            "pdf" => {
                let image_key = format!("{key}-page");
                let meta = self
                    .reading
                    .assets
                    .get(&image_key)
                    .cloned()
                    .unwrap_or(Value::Null);
                let current = meta["page"].as_u64().unwrap_or(0);
                let pages = meta["pages"].as_u64().unwrap_or(0);
                ui.horizontal(|ui|{for (index,label,enabled)in [(current.saturating_sub(1),"Previous page",current>0),(current,"Render PDF page",pages==0),(current+1,"Next page",pages>0&&current+1<pages)]{if ui.add_enabled(self.pending.is_none()&&enabled,egui::Button::new(label)).clicked(){if let Some(bytes)=self.reading.bytes.get(key){self.request("reading_asset",json!({"operation":"render_pdf","data":STANDARD.encode(bytes.as_slice()),"page":index,"key":image_key}));}}}if pages>0{ui.label(format!("Page {} of {pages}",current+1));}});
                if let Some(texture) = self.reading.textures.get(&image_key) {
                    ui.add(egui::Image::from_texture(texture).max_width(ui.available_width()));
                }
            }
            "audio" => {
                ui.horizontal(|ui| {
                    if ui.button("Play audio").clicked() {
                        if let Some(bytes) = self.reading.bytes.get(key) {
                            let result = (|| -> Result<_, String> {
                                let mut stream = rodio::OutputStreamBuilder::open_default_stream()
                                    .map_err(|_| "Audio output is unavailable.")?;
                                stream.log_on_drop(false);
                                let sink = rodio::Sink::connect_new(stream.mixer());
                                let decoder = rodio::Decoder::try_from(std::io::Cursor::new(
                                    bytes.as_ref().clone(),
                                ))
                                .map_err(|_| "This audio format could not be decoded.")?;
                                sink.append(decoder);
                                Ok((stream, sink, key.to_string()))
                            })();
                            match result {
                                Ok(audio) => self.reading.audio = Some(audio),
                                Err(error) => self.error = error,
                            }
                        }
                    }
                    if ui.button("Pause / resume").clicked() {
                        if let Some((_, sink, playing)) = &self.reading.audio {
                            if playing == key {
                                if sink.is_paused() {
                                    sink.play()
                                } else {
                                    sink.pause()
                                }
                            }
                        }
                    }
                    if ui.button("Stop audio").clicked() {
                        self.reading.audio = None;
                    }
                });
            }
            _ => {}
        }
        if self.reading.bytes.contains_key(key)
            && ui.small_button("Save original attachment…").clicked()
        {
            if let Some(path) = rfd::FileDialog::new()
                .set_file_name(
                    string(asset, "path")
                        .rsplit('/')
                        .next()
                        .unwrap_or("attachment"),
                )
                .save_file()
            {
                if std::fs::write(path, self.reading.bytes[key].as_slice()).is_err() {
                    self.error = "Cannot save the attachment.".into();
                }
            }
        }
    }
    fn reading_link(&mut self, target: &str, syntax: &str) {
        if let Ok(url) = url::Url::parse(target) {
            if ["http", "https"].contains(&url.scheme())
                && url.username().is_empty()
                && url.password().is_none()
            {
                let _ = open::that(target);
                return;
            }
        }
        if let Some((note, _)) = helious_native::reading::resolve(
            string(&self.note, "path"),
            target,
            syntax,
            string(&self.note, "spaceId"),
            &self.notes,
        ) {
            let id = string(note, "id").to_string();
            self.select_note(&id);
        } else {
            self.error = "This note link is unavailable in the current Space.".into();
        }
    }
}
