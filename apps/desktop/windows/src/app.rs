use crate::{graph::Graph, worker::Worker};
use eframe::egui::{self, Color32, RichText};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};
#[derive(Clone, Copy, PartialEq)]
pub enum Page {
    Workspace,
    Graph,
    Canvas,
    Sync,
    Account,
    Settings,
}
pub struct HeliousApp {
    pub worker: Worker,
    pub pending: Option<String>,
    pub error: String,
    pub message: String,
    pub page: Page,
    pub status: Value,
    pub me: Value,
    pub source: String,
    pub vault: Value,
    pub notes: Vec<Value>,
    pub spaces: Vec<Value>,
    pub server_vaults: Vec<Value>,
    pub note: Value,
    pub markdown: String,
    pub saved: String,
    pub space: String,
    pub filter: String,
    pub new_path: String,
    pub mode: u8,
    pub history: Value,
    pub version: Value,
    pub email: String,
    pub password: String,
    pub factor: String,
    pub origin: String,
    pub custom_server: bool,
    pub show_password: bool,
    pub theme: String,
    pub font_size: f32,
    pub wrap: bool,
    pub logo: egui::TextureHandle,
    pub graph: Graph,
    pub pending_navigation: Option<Value>,
    pub confirm_close: bool,
    pub pending_quit: bool,
    pub confirm_delete: bool,
    pub sync_config: Value,
    pub sync_vault: String,
    pub remote_spaces: Vec<Value>,
    pub mappings: Value,
    pub personal_confirm: bool,
    pub next_poll: Instant,
    pub data_folder: PathBuf,
    pub settings_dirty: bool,
    pub automatic_checks: bool,
    pub automatic_install: bool,
    pub update: Value,
    pub update_ready: bool,
    pub installing: bool,
    pub next_update: Instant,
    pub queued: VecDeque<(String, Value)>,
    pub authoring: crate::authoring::AuthoringState,
    pub canvas: crate::canvas::CanvasState,
    pub reading: crate::reading::ReadingState,
    pub extensions: crate::extensions::ExtensionState,
}
pub fn string<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}
impl HeliousApp {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        Self::with_folder(
            cc,
            dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("com.helious.desktop"),
        )
    }
    pub fn with_folder(cc: &eframe::CreationContext<'_>, folder: PathBuf) -> Self {
        let context = &cc.egui_ctx;
        context.set_theme(egui::ThemePreference::Dark);
        let mut fonts = egui::FontDefinitions::default();
        if let Ok(bytes) = std::fs::read("C:/Windows/Fonts/segoeui.ttf") {
            fonts
                .font_data
                .insert("system".into(), egui::FontData::from_owned(bytes).into());
            fonts
                .families
                .entry(egui::FontFamily::Proportional)
                .or_default()
                .insert(0, "system".into());
            context.set_fonts(fonts);
        }
        let logo = image::load_from_memory(include_bytes!("../../assets/icons/128x128.png"))
            .expect("logo")
            .into_rgba8();
        let logo = context.load_texture(
            "helious-logo",
            egui::ColorImage::from_rgba_unmultiplied(
                [logo.width() as usize, logo.height() as usize],
                &logo,
            ),
            egui::TextureOptions::LINEAR,
        );
        let worker = Worker::new(folder.clone(), context.clone());
        let mut app = Self {
            worker,
            pending: None,
            error: String::new(),
            message: String::new(),
            page: Page::Workspace,
            status: Value::Null,
            me: Value::Null,
            source: "local".into(),
            vault: Value::Null,
            notes: vec![],
            spaces: vec![],
            server_vaults: vec![],
            note: Value::Null,
            markdown: String::new(),
            saved: String::new(),
            space: String::new(),
            filter: String::new(),
            new_path: String::new(),
            mode: 0,
            history: Value::Null,
            version: Value::Null,
            email: String::new(),
            password: String::new(),
            factor: String::new(),
            origin: helious_native::CLOUD_ORIGIN.into(),
            custom_server: false,
            show_password: false,
            theme: "dark".into(),
            font_size: 16.0,
            wrap: true,
            logo,
            graph: Graph::default(),
            pending_navigation: None,
            confirm_close: false,
            pending_quit: false,
            confirm_delete: false,
            sync_config: Value::Null,
            sync_vault: String::new(),
            remote_spaces: vec![],
            mappings: json!({}),
            personal_confirm: false,
            next_poll: Instant::now(),
            data_folder: folder,
            settings_dirty: false,
            automatic_checks: true,
            automatic_install: false,
            update: Value::Null,
            update_ready: false,
            installing: false,
            next_update: Instant::now() + Duration::from_secs(20),
            queued: VecDeque::new(),
            authoring: crate::authoring::AuthoringState::default(),
            canvas: crate::canvas::CanvasState::default(),
            reading: crate::reading::ReadingState::default(),
            extensions: crate::extensions::ExtensionState::default(),
        };
        app.request("status", json!({"operation":"status"}));
        app
    }
    pub fn dirty(&self) -> bool {
        self.canvas.dirty()
            || (!self.note.is_null()
                && (self.markdown != self.saved || self.space != string(&self.note, "spaceId")))
    }
    pub fn request(&mut self, tag: &str, value: Value) {
        if self.pending.is_some() {
            if tag != "status" && self.queued.len() < 8 {
                self.queued.push_back((tag.into(), value));
            }
            return;
        }
        self.pending = Some(tag.into());
        if self.worker.send.send((tag.into(), value)).is_err() {
            self.pending = None;
            self.error =
                "The native worker stopped. Restart Helious after saving your draft elsewhere."
                    .into();
        }
    }
    pub fn scope(&self, operation: &str) -> Value {
        json!({"operation":operation,"source":self.source,"vaultId":self.vault["id"]})
    }
    pub fn api(&mut self, tag: &str, path: String, method: &str, body: Value) {
        self.request(
            tag,
            json!({"operation":"api","path":path,"method":method,"body":body}),
        );
    }
    pub fn refresh_notes(&mut self) {
        if !self.vault.is_null() {
            self.request("notes", self.scope("notes"));
        }
    }
    pub fn navigate(&mut self, value: Value) {
        if self.pending.is_some() {
            self.error = "Wait for the current operation before changing notes or vaults.".into();
            return;
        }
        if self.dirty() {
            self.pending_navigation = Some(value);
            self.confirm_close = true;
            return;
        }
        self.perform_navigation(value);
    }
    fn perform_navigation(&mut self, value: Value) {
        let tag = value["operation"].as_str().unwrap_or("").to_string();
        if tag == "open_server" {
            self.source = "server".into();
            self.reading = crate::reading::ReadingState::default();
            self.extensions.proposal = None;
            self.canvas = crate::canvas::CanvasState::default();
            self.authoring = crate::authoring::AuthoringState::default();
            self.vault = value["vault"].clone();
            self.note = Value::Null;
            self.markdown.clear();
            self.saved.clear();
            self.spaces.clear();
            self.page = Page::Workspace;
            self.api(
                "spaces",
                format!("/api/vaults/{}/spaces", string(&self.vault, "id")),
                "GET",
                Value::Null,
            );
        } else {
            self.request(&tag, value);
        }
    }
    pub fn select_note(&mut self, id: &str) {
        let mut req = self.scope("read_note");
        req["id"] = json!(id);
        self.navigate(req);
    }
    pub fn save(&mut self) {
        if self.canvas.dirty() {
            self.canvas_save();
            return;
        }
        if self.note.is_null() {
            return;
        }
        let mut request = self.scope("save_note");
        request["id"] = self.note["id"].clone();
        request["body"] = json!({"path":self.note["path"],"markdown":self.markdown,"spaceId":self.space,"revision":self.note["revision"],"hash":self.note["hash"]});
        self.request("save_note", request);
    }
    pub fn open_folder(&mut self) {
        if self.dirty() {
            self.error = "Save or discard your draft before opening another folder.".into();
            return;
        }
        if let Some(path) = rfd::FileDialog::new()
            .set_title("Open or create a Helious vault")
            .pick_folder()
        {
            self.navigate(json!({"operation":"open_local","path":path.to_string_lossy()}));
        }
    }
    pub fn apply_theme(&self, ctx: &egui::Context) {
        ctx.set_theme(match self.theme.as_str() {
            "light" => egui::ThemePreference::Light,
            "system" => egui::ThemePreference::System,
            _ => egui::ThemePreference::Dark,
        });
        let mut style = (*ctx.global_style()).clone();
        style.spacing.item_spacing = egui::vec2(10.0, 10.0);
        style.spacing.button_padding = egui::vec2(12.0, 8.0);
        style
            .text_styles
            .insert(egui::TextStyle::Body, egui::FontId::proportional(15.0));
        style
            .text_styles
            .insert(egui::TextStyle::Heading, egui::FontId::proportional(25.0));
        style
            .text_styles
            .insert(egui::TextStyle::Button, egui::FontId::proportional(14.0));
        if style.visuals.dark_mode {
            style.visuals.panel_fill = Color32::from_rgb(16, 16, 16);
            style.visuals.window_fill = Color32::from_rgb(21, 21, 21);
            style.visuals.extreme_bg_color = Color32::from_rgb(10, 10, 10);
            style.visuals.faint_bg_color = Color32::from_rgb(26, 26, 26);
            style.visuals.widgets.noninteractive.bg_stroke.color = Color32::from_gray(48);
            style.visuals.selection.bg_fill = Color32::from_rgb(29, 70, 110);
            style.visuals.hyperlink_color = Color32::from_rgb(115, 185, 255);
            style.visuals.weak_text_color = Some(Color32::from_gray(164));
        }
        ctx.set_global_style(style);
    }
    fn receive(&mut self) {
        while let Ok((tag, result)) = self.worker.receive.try_recv() {
            self.pending = None;
            let data = match result {
                Ok(v) => v,
                Err(e) => {
                    self.error = e;
                    continue;
                }
            };
            match tag.as_str() {
                "extensions" => {
                    self.extensions.installed =
                        serde_json::from_value(data["extensions"].clone()).unwrap_or_default();
                }
                "reading_document" => {
                    if data["key"] == self.reading.key {
                        match serde_json::from_value(data["blocks"].clone()) {
                            Ok(blocks) => {
                                self.reading.blocks = std::sync::Arc::new(blocks);
                                self.reading.loaded = true;
                            }
                            Err(_) => self.error = "Cannot display this reading preview.".into(),
                        }
                    }
                }
                "reading_download" => {
                    if string(&data, "key").starts_with(&self.reading.key)
                        && !self.reading.key.is_empty()
                    {
                        use base64::Engine as _;
                        if let Ok(bytes) =
                            base64::engine::general_purpose::STANDARD.decode(string(&data, "data"))
                        {
                            if let Some(path) = rfd::FileDialog::new()
                                .set_file_name(
                                    string(&data, "path")
                                        .rsplit('/')
                                        .next()
                                        .unwrap_or("attachment"),
                                )
                                .save_file()
                            {
                                if std::fs::write(path, bytes).is_err() {
                                    self.error = "Cannot save the attachment.".into();
                                }
                            }
                        }
                    }
                }
                "reading_asset" => {
                    if let Err(error) = self.reading.asset(data, &self.worker.context) {
                        self.error = error;
                    }
                }
                "canvas_list" => {
                    self.canvas.files = data["files"].as_array().cloned().unwrap_or_default()
                }
                "canvas_read" => self.canvas.load(data),
                "canvas_created" => {
                    self.canvas
                        .load(json!({"file":data["file"],"document":{"nodes":[],"edges":[]}}));
                    self.canvas.new_path.clear();
                    self.request("canvas_list", self.scope("canvas_list"));
                }
                "canvas_saved" => {
                    self.canvas.file = data["file"].clone();
                    self.canvas.saved = self.canvas.saving.clone();
                    self.message = "Canvas saved.".into();
                    self.request("canvas_list", self.scope("canvas_list"));
                }
                "canvas_deleted" => {
                    self.reading = crate::reading::ReadingState::default();
                    self.extensions.proposal = None;
                    self.canvas = crate::canvas::CanvasState::default();
                    self.request("canvas_list", self.scope("canvas_list"));
                }
                "properties" | "edit_property" => {
                    if self.authoring.base != self.markdown {
                        self.error="Your draft changed while editing properties. Read them again before applying changes.".into();
                    } else {
                        self.authoring.properties = data["properties"].clone();
                        if tag == "edit_property" {
                            self.markdown = string(&data, "markdown").into();
                            self.message = "Properties updated in draft. Save to keep them.".into();
                        }
                    }
                }
                "status" => {
                    let first = self.status.is_null();
                    if first {
                        self.queued
                            .push_back(("extensions".into(), json!({"operation":"extensions"})));
                    }
                    let changed = data["changedVaults"]
                        .as_array()
                        .is_some_and(|a| a.contains(&self.vault["id"]));
                    self.status = data;
                    if first {
                        self.theme = self.status["settings"]["theme"]
                            .as_str()
                            .unwrap_or("dark")
                            .into();
                        self.font_size =
                            self.status["settings"]["fontSize"].as_f64().unwrap_or(16.0) as f32;
                        self.wrap = self.status["settings"]["wrap"].as_bool().unwrap_or(true);
                        self.automatic_checks = self.status["settings"]["automaticChecks"]
                            .as_bool()
                            .unwrap_or(true);
                        self.automatic_install = self.status["settings"]["automaticInstall"]
                            .as_bool()
                            .unwrap_or(false);
                        if self.status["server"].is_string() {
                            self.origin = string(&self.status, "server").into();
                            self.api("me", "/api/auth/me".into(), "GET", Value::Null);
                        }
                    } else if changed && self.source == "local" {
                        if self.dirty() {
                            self.message="This folder changed elsewhere. Your draft is preserved; save may require reloading.".into();
                        } else {
                            self.refresh_notes();
                        }
                    }
                }
                "open_local" | "open_recent" => {
                    self.reading = crate::reading::ReadingState::default();
                    self.extensions.proposal = None;
                    self.reading = crate::reading::ReadingState::default();
                    self.extensions.proposal = None;
                    self.canvas = crate::canvas::CanvasState::default();
                    self.authoring = crate::authoring::AuthoringState::default();
                    self.source = "local".into();
                    self.vault = json!({"id":data["id"],"name":data["name"],"path":data["path"]});
                    self.spaces = data["spaces"].as_array().cloned().unwrap_or_default();
                    self.sync_config = data["sync"].clone();
                    self.notes.clear();
                    self.note = Value::Null;
                    self.markdown.clear();
                    self.saved.clear();
                    self.page = Page::Workspace;
                    self.refresh_notes();
                }
                "notes" => {
                    self.notes = data["notes"].as_array().cloned().unwrap_or_default();
                    if self.page == Page::Workspace && !self.note.is_null() && !self.dirty() {
                        let id = string(&self.note, "id").to_string();
                        let mut req = self.scope("read_note");
                        req["id"] = json!(id);
                        self.request("read_note", req);
                    }
                }
                "read_note" | "save_note" | "create_note" => {
                    self.reading = crate::reading::ReadingState::default();
                    self.note = data["note"].clone();
                    self.markdown = string(&self.note, "markdown").into();
                    self.saved = self.markdown.clone();
                    self.space = string(&self.note, "spaceId").into();
                    self.history = Value::Null;
                    self.version = Value::Null;
                    if tag != "read_note" {
                        self.message = "Note saved.".into();
                        self.new_path.clear();
                        self.refresh_notes();
                    } else {
                        self.page = Page::Workspace;
                    }
                }
                "delete_note" => {
                    self.note = Value::Null;
                    self.markdown.clear();
                    self.saved.clear();
                    self.confirm_delete = false;
                    self.refresh_notes();
                }
                "login" | "me" => {
                    self.me = data["user"].clone();
                    self.status["server"] = json!(self.origin);
                    self.error.clear();
                    self.message =
                        "Signed in. Choose a Cloud vault or keep working locally.".into();
                    self.api("server_vaults", "/api/vaults".into(), "GET", Value::Null);
                }
                "server_vaults" => {
                    self.server_vaults = data["vaults"].as_array().cloned().unwrap_or_default();
                }
                "spaces" => {
                    self.spaces = data["spaces"].as_array().cloned().unwrap_or_default();
                    self.refresh_notes();
                }
                "remote_spaces" => {
                    self.remote_spaces = data["spaces"].as_array().cloned().unwrap_or_default();
                }
                "logout" => {
                    self.reading = crate::reading::ReadingState::default();
                    self.me = Value::Null;
                    self.status["server"] = Value::Null;
                    self.server_vaults.clear();
                    if self.source == "server" {
                        self.vault = Value::Null;
                        self.note = Value::Null;
                        self.notes.clear();
                        self.markdown.clear();
                        self.saved.clear();
                    }
                    self.message = if data["serverRevoked"] == true {
                        "Signed out.".into()
                    } else {
                        "Signed out on this device. Revoke the old session on the server when it is available.".into()
                    };
                }
                "graph" => self.graph.load(&data),
                "history" => self.history = data,
                "version" => self.version = data["version"].clone(),
                "settings" => {
                    self.message = "Settings saved.".into();
                    self.settings_dirty = false;
                }
                "check_update" => {
                    self.update = data;
                    self.message = if self.update["available"] == true {
                        format!("Helious {} is available.", string(&self.update, "version"))
                    } else {
                        "You have the latest signed release.".into()
                    };
                    if self.update["available"] == true && self.automatic_install && !self.dirty() {
                        self.request("download_update", json!({"operation":"download_update"}));
                    }
                }
                "download_update" => {
                    self.update_ready = true;
                    self.message =
                        "Verified update downloaded. Save your drafts before restarting.".into();
                    if self.automatic_install && !self.dirty() {
                        self.request("install_update", json!({"operation":"install_update"}));
                    }
                }
                "install_update" => {
                    self.installing = true;
                    self.message = "Installing verified update…".into();
                }
                "local_config" => {
                    self.message =
                        "Sync pairing saved. Personal is shared only when explicitly mapped."
                            .into();
                    self.sync_config = data["sync"].clone();
                }
                "sync" | "resolve_sync" => {
                    self.sync_config = data.get("configuration").cloned().unwrap_or(data);
                    self.message =
                        "Sync finished. Review any preserved conflict copies below.".into();
                }
                "create_vault" => {
                    self.message = "Cloud vault created.".into();
                    self.new_path.clear();
                    self.api("server_vaults", "/api/vaults".into(), "GET", Value::Null);
                }
                _ => {}
            }
        }
        if self.pending.is_none() {
            if let Some((tag, value)) = self.queued.pop_front() {
                self.request(&tag, value);
            }
        }
    }
}
impl eframe::App for HeliousApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.receive();
        let ctx = ui.ctx().clone();
        self.apply_theme(&ctx);
        ui.set_style(ctx.global_style());
        if self.installing && !self.dirty() {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }
        if ctx.input(|i| i.viewport().close_requested()) && self.dirty() {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            self.pending_quit = true;
            self.confirm_close = true;
        }
        if ctx.input_mut(|i| i.consume_key(egui::Modifiers::CTRL, egui::Key::S)) {
            self.save();
        }
        if ctx.input_mut(|i| i.consume_key(egui::Modifiers::CTRL, egui::Key::O)) {
            self.open_folder();
        }
        if ctx.input_mut(|i| i.consume_key(egui::Modifiers::CTRL, egui::Key::Comma)) {
            self.page = Page::Settings;
        }
        if self.pending.is_none() && Instant::now() >= self.next_poll {
            self.next_poll = Instant::now() + Duration::from_secs(3);
            self.request("status", json!({"operation":"status"}));
        }
        if self.automatic_checks && self.pending.is_none() && Instant::now() >= self.next_update {
            self.next_update = Instant::now() + Duration::from_secs(86400);
            self.request("check_update", json!({"operation":"check_update"}));
        }
        ctx.request_repaint_after(Duration::from_secs(1));
        egui::Panel::top("app-header")
            .exact_size(66.0)
            .show(ui, |ui| {
                ui.horizontal_centered(|ui| {
                    ui.add_space(14.0);
                    ui.image((self.logo.id(), egui::vec2(30.0, 30.0)));
                    ui.label(RichText::new("helious.").size(23.0).strong());
                    ui.add_space(25.0);
                    ui.label(if self.vault.is_null() {
                        "Your knowledge workspace"
                    } else {
                        string(&self.vault, "name")
                    });
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.add_space(14.0);
                        if ui
                            .button(if self.me.is_null() {
                                "Sign in"
                            } else {
                                string(&self.me, "name")
                            })
                            .clicked()
                        {
                            self.page = Page::Account;
                        }
                        if ui.button("Settings").clicked() {
                            self.page = Page::Settings;
                        }
                        if self.pending.is_some() {
                            ui.spinner();
                        } else {
                            ui.weak(if self.source == "local" {
                                "On this device"
                            } else {
                                "Cloud workspace"
                            });
                        }
                    });
                });
            });
        egui::Panel::bottom("status").show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.small(if self.dirty() {
                    "Unsaved draft"
                } else {
                    "Helious native · 0.9.0"
                });
                if !self.message.is_empty() {
                    ui.separator();
                    ui.small(&self.message);
                }
            });
        });
        egui::Panel::left("navigation")
            .exact_size(206.0)
            .show(ui, |ui| {
                ui.add_space(18.0);
                for (page, label) in [
                    (Page::Workspace, "Workspace"),
                    (Page::Graph, "Graph"),
                    (Page::Canvas, "Canvas"),
                    (Page::Sync, "Sync"),
                    (Page::Account, "Account"),
                    (Page::Settings, "Settings"),
                ] {
                    if ui
                        .add_sized(
                            [182.0, 38.0],
                            egui::Button::selectable(self.page == page, label),
                        )
                        .clicked()
                    {
                        self.page = page;
                        if page == Page::Canvas && !self.vault.is_null() {
                            self.request("canvas_list", self.scope("canvas_list"));
                        }
                        if page == Page::Graph && !self.vault.is_null() {
                            self.request("graph", self.scope("graph"));
                        }
                        if page == Page::Sync && !self.me.is_null() {
                            self.api("server_vaults", "/api/vaults".into(), "GET", Value::Null);
                        }
                    }
                }
                ui.add_space(22.0);
                ui.weak("LOCAL VAULTS");
                if ui.button("Open folder…").clicked() {
                    self.open_folder();
                }
                let recent = self.status["recent"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
                for item in recent.iter().take(8) {
                    if ui
                        .selectable_label(
                            self.source == "local" && self.vault["id"] == item["id"],
                            string(item, "name"),
                        )
                        .on_hover_text(string(item, "path"))
                        .clicked()
                    {
                        self.navigate(json!({"operation":"open_recent","id":item["id"]}));
                    }
                }
                ui.add_space(20.0);
                ui.weak("CLOUD VAULTS");
                if self.me.is_null() {
                    if ui.button("Sign in to Helious Cloud").clicked() {
                        self.page = Page::Account;
                    }
                } else {
                    for item in self.server_vaults.clone() {
                        if ui
                            .selectable_label(
                                self.source == "server" && self.vault["id"] == item["id"],
                                string(&item, "name"),
                            )
                            .clicked()
                        {
                            self.navigate(json!({"operation":"open_server","vault":item}));
                        }
                    }
                }
                ui.with_layout(egui::Layout::bottom_up(egui::Align::LEFT), |ui| {
                    if ui.link("Help & documentation").clicked() {
                        let _ =
                            open::that(format!("{}/docs/desktop", helious_native::CLOUD_ORIGIN));
                    }
                });
            });
        egui::CentralPanel::default().show(ui, |ui| {
            if !self.error.is_empty() {
                egui::Frame::group(ui.style()).show(ui, |ui| {
                    ui.horizontal_wrapped(|ui| {
                        ui.colored_label(Color32::from_rgb(235, 125, 125), &self.error);
                        if ui.small_button("Dismiss").clicked() {
                            self.error.clear();
                        }
                    });
                });
                ui.add_space(12.0);
            }
            match self.page {
                Page::Workspace => self.workspace(ui),
                Page::Canvas => self.canvas_page(ui),
                Page::Graph => {
                    if let Some(id) = self.graph.show(ui) {
                        self.select_note(&id);
                    }
                }
                Page::Account | Page::Settings | Page::Sync => {
                    egui::ScrollArea::vertical()
                        .id_salt("destination-page")
                        .show(ui, |ui| {
                            egui::Frame::new()
                                .inner_margin(egui::Margin::symmetric(26, 12))
                                .show(ui, |ui| match self.page {
                                    Page::Account => self.account(ui),
                                    Page::Settings => self.settings(ui),
                                    Page::Sync => self.sync(ui),
                                    _ => {}
                                });
                        });
                }
            }
        });
        if self.confirm_delete {
            egui::Window::new("Delete this note?").collapsible(false).resizable(false).anchor(egui::Align2::CENTER_CENTER,[0.0,0.0]).show(&ctx,|ui|{
                ui.label(format!("Remove {} from this vault?",string(&self.note,"path")));
                ui.label("Saved history is retained. A paired vault will sync this deletion.");
                ui.horizontal(|ui|{
                    if ui.button("Cancel").clicked(){self.confirm_delete=false;}
                    if ui.add_enabled(!self.dirty()&&self.pending.is_none(),egui::Button::new("Confirm deletion")).clicked(){
                        let mut req=self.scope("delete_note");req["id"]=self.note["id"].clone();req["body"]=json!({"path":self.note["path"],"hash":self.note["hash"],"revision":self.note["revision"]});self.request("delete_note",req);self.confirm_delete=false;
                    }
                });
            });
        }
        if self.confirm_close {
            egui::Window::new("Keep your draft").collapsible(false).resizable(false).anchor(egui::Align2::CENTER_CENTER,[0.0,0.0]).show(&ctx,|ui|{
            ui.label("This note has unsaved changes. Save it before leaving, or discard the draft.");
            ui.horizontal(|ui|{if ui.button("Keep editing").clicked(){self.confirm_close=false;self.pending_quit=false;self.pending_navigation=None;}
if ui.button("Save draft").clicked(){self.save();self.confirm_close=false;self.pending_quit=false;self.pending_navigation=None;}
if ui.button("Discard and continue").clicked(){self.canvas.discard();self.markdown=self.saved.clone();self.space=string(&self.note,"spaceId").into();self.confirm_close=false;if self.pending_quit{ctx.send_viewport_cmd(egui::ViewportCommand::Close);}else if let Some(value)=self.pending_navigation.take(){self.perform_navigation(value);}}});
        });
        }
    }
}
