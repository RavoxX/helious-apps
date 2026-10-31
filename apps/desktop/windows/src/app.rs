use crate::{
    chrome::palette,
    graph::Graph,
    state::{EditorToolsState, ExplorerState, InspectorState, OpenTab, PaletteState, ThemeCache},
    worker::Worker,
};
use eframe::egui::{self, Stroke};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    path::PathBuf,
    time::{Duration, Instant},
};

#[derive(Clone, Copy, PartialEq, Eq)]
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
    pub polling_status: bool,
    pub error: String,
    pub message: String,
    pub page: Page,
    pub sidebar_open: bool,
    pub status: Value,
    pub me: Value,
    pub source: String,
    pub vault: Value,
    pub notes: Vec<Value>,
    pub spaces: Vec<Value>,
    pub server_vaults: Vec<Value>,
    pub note: Value,
    pub tabs: Vec<OpenTab>,
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
    pub after_save_navigation: Option<Value>,
    pub confirm_close: bool,
    pub pending_quit: bool,
    pub after_save_quit: bool,
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
    pub inspector: bool,
    pub explorer: ExplorerState,
    pub editor_tools: EditorToolsState,
    pub inspector_state: InspectorState,
    pub palette: PaletteState,
    pub theme_cache: ThemeCache,
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
            polling_status: false,
            error: String::new(),
            message: String::new(),
            page: Page::Workspace,
            sidebar_open: true,
            status: Value::Null,
            me: Value::Null,
            source: "local".into(),
            vault: Value::Null,
            notes: vec![],
            spaces: vec![],
            server_vaults: vec![],
            note: Value::Null,
            tabs: vec![],
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
            after_save_navigation: None,
            confirm_close: false,
            pending_quit: false,
            after_save_quit: false,
            confirm_delete: false,
            sync_config: Value::Null,
            sync_vault: String::new(),
            remote_spaces: vec![],
            mappings: json!({}),
            personal_confirm: false,
            next_poll: Instant::now() + Duration::from_secs(3),
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
            inspector: true,
            explorer: ExplorerState::default(),
            editor_tools: EditorToolsState::default(),
            inspector_state: InspectorState::default(),
            palette: PaletteState::default(),
            theme_cache: ThemeCache::default(),
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
            if tag != "status" && self.queued.len() < 16 {
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

    pub fn send_background(&mut self, tag: &str, value: Value) {
        let _ = self.worker.send.send((tag.into(), value));
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

    pub fn perform_navigation(&mut self, value: Value) {
        let tag = value["operation"].as_str().unwrap_or("").to_string();
        if tag == "open_server" {
            self.source = "server".into();
            self.reset_vault_state();
            self.vault = value["vault"].clone();
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

    fn reset_vault_state(&mut self) {
        self.reading = crate::reading::ReadingState::default();
        self.extensions.proposal = None;
        self.canvas = crate::canvas::CanvasState::default();
        self.authoring = crate::authoring::AuthoringState::default();
        self.explorer = ExplorerState::default();
        self.editor_tools = EditorToolsState::default();
        self.inspector_state = InspectorState::default();
        self.tabs.clear();
        self.notes.clear();
        self.note = Value::Null;
        self.markdown.clear();
        self.saved.clear();
        self.spaces.clear();
    }

    pub fn select_note(&mut self, id: &str) {
        if id.is_empty() {
            return;
        }
        let mut req = self.scope("read_note");
        req["id"] = json!(id);
        self.navigate(req);
    }

    pub fn close_tab(&mut self, id: &str) {
        let active = string(&self.note, "id") == id;
        if active && self.dirty() {
            self.error = "Save or discard your draft before closing this tab.".into();
            return;
        }
        let idx = self.tabs.iter().position(|t| t.id == id);
        self.tabs.retain(|t| t.id != id);
        if active {
            if let Some(next) = idx
                .and_then(|i| self.tabs.get(i.saturating_sub(1)))
                .or_else(|| self.tabs.first())
                .cloned()
            {
                self.select_note(&next.id);
            } else {
                self.note = Value::Null;
                self.markdown.clear();
                self.saved.clear();
            }
        }
    }

    fn sync_tab_for_active_note(&mut self) {
        if self.note.is_null() {
            return;
        }
        let id = string(&self.note, "id").to_string();
        if id.is_empty() {
            return;
        }
        let path = string(&self.note, "path").to_string();
        let filename = path.rsplit('/').next().unwrap_or(&path).to_string();
        if let Some(existing) = self.tabs.iter_mut().find(|t| t.id == id) {
            existing.path = path;
            existing.title = filename;
        } else {
            if self.tabs.len() >= 12 {
                self.tabs.remove(0);
            }
            self.tabs.push(OpenTab {
                id,
                path,
                title: filename,
            });
        }
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

    pub fn apply_theme_if_needed(&mut self, ctx: &egui::Context) {
        let dark = ctx.global_style().visuals.dark_mode;
        if self.theme_cache.applied_pref == self.theme
            && self.theme_cache.applied_dark == Some(dark)
        {
            return;
        }
        ctx.set_theme(match self.theme.as_str() {
            "light" => egui::ThemePreference::Light,
            "system" => egui::ThemePreference::System,
            _ => egui::ThemePreference::Dark,
        });
        let updated_dark = ctx.global_style().visuals.dark_mode;
        let mut style = (*ctx.global_style()).clone();
        crate::chrome::style(&mut style);
        ctx.set_global_style(style);
        self.theme_cache.applied_pref = self.theme.clone();
        self.theme_cache.applied_dark = Some(updated_dark);
    }

    pub fn go(&mut self, page: Page) {
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

    fn receive(&mut self, ctx: &egui::Context) {
        while let Ok((tag, result)) = self.worker.receive.try_recv() {
            let is_background = matches!(tag.as_str(), "status_poll" | "bg_note_context");
            if tag == "status_poll" {
                self.polling_status = false;
            }
            if !is_background {
                self.pending = None;
            }

            let data = match result {
                Ok(v) => v,
                Err(e) => {
                    if tag == "search_notes" {
                        self.explorer.searching = false;
                    }
                    if !is_background {
                        self.error = e;
                        self.after_save_navigation = None;
                        self.after_save_quit = false;
                    }
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
                    self.finish_post_save(ctx);
                }
                "canvas_deleted" => {
                    self.reading = crate::reading::ReadingState::default();
                    self.extensions.proposal = None;
                    self.canvas = crate::canvas::CanvasState::default();
                    self.request("canvas_list", self.scope("canvas_list"));
                }
                "properties" | "edit_property" => {
                    if self.authoring.base != self.markdown {
                        self.error = "Your draft changed while editing properties. Read them again before applying changes.".into();
                    } else {
                        self.authoring.properties = data["properties"].clone();
                        if tag == "edit_property" {
                            self.markdown = string(&data, "markdown").into();
                            self.message = "Properties updated in draft. Save to keep them.".into();
                        }
                    }
                }
                "status" | "status_poll" => {
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
                            self.message = "This folder changed elsewhere. Your draft is preserved; save may require reloading.".into();
                        } else {
                            self.refresh_notes();
                        }
                    }
                }
                "open_local" | "open_recent" => {
                    self.reset_vault_state();
                    self.source = "local".into();
                    self.vault = json!({"id":data["id"],"name":data["name"],"path":data["path"]});
                    self.spaces = data["spaces"].as_array().cloned().unwrap_or_default();
                    self.sync_config = data["sync"].clone();
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
                "read_note" | "save_note" | "create_note" | "rename_note" => {
                    self.reading = crate::reading::ReadingState::default();
                    self.editor_tools.rename_open = false;
                    self.note = data["note"].clone();
                    self.markdown = string(&self.note, "markdown").into();
                    self.saved = self.markdown.clone();
                    self.space = string(&self.note, "spaceId").into();
                    self.history = Value::Null;
                    self.version = Value::Null;
                    self.sync_tab_for_active_note();
                    self.trigger_background_context();
                    if tag == "rename_note" {
                        let links = data["updatedLinks"].as_u64().unwrap_or(0);
                        self.message = if links > 0 {
                            format!(
                                "Moved to {} ({links} inbound links updated).",
                                string(&self.note, "path")
                            )
                        } else {
                            format!("Moved to {}.", string(&self.note, "path"))
                        };
                        self.refresh_notes();
                    } else if tag != "read_note" {
                        self.message = "Note saved.".into();
                        self.new_path.clear();
                        self.refresh_notes();
                        if tag == "save_note" {
                            self.finish_post_save(ctx);
                        }
                    } else {
                        self.page = Page::Workspace;
                    }
                }
                "search_notes" => {
                    self.explorer.searching = false;
                    self.explorer.search_results =
                        data["results"].as_array().cloned().unwrap_or_default();
                }
                "note_context" | "bg_note_context" => {
                    self.inspector_state.context = data;
                }
                "delete_note" => {
                    let deleted_id = string(&self.note, "id").to_string();
                    self.tabs.retain(|t| t.id != deleted_id);
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
                        self.reset_vault_state();
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

    fn trigger_background_context(&mut self) {
        if self.vault.is_null() || self.note.is_null() {
            return;
        }
        let id = string(&self.note, "id").to_string();
        if id.is_empty() {
            return;
        }
        self.inspector_state.context_note_id = id.clone();
        let mut req = self.scope("note_context");
        req["id"] = json!(id);
        req["markdown"] = json!(self.markdown);
        self.send_background("bg_note_context", req);
    }

    fn finish_post_save(&mut self, ctx: &egui::Context) {
        if self.after_save_quit {
            self.after_save_quit = false;
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        } else if let Some(nav) = self.after_save_navigation.take() {
            self.queued.push_back((
                nav["operation"].as_str().unwrap_or("").to_string(),
                nav.clone(),
            ));
            if nav["operation"] == "open_server" {
                self.queued.pop_back();
                self.perform_navigation(nav);
            }
        }
    }
}

impl eframe::App for HeliousApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        self.receive(&ctx);
        self.apply_theme_if_needed(&ctx);
        ui.set_style(ctx.global_style());

        if self.installing && !self.dirty() {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }
        if ctx.input(|i| i.viewport().close_requested()) && self.dirty() {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            self.pending_quit = true;
            self.confirm_close = true;
        }

        if ctx.input_mut(|i| {
            i.consume_key(egui::Modifiers::CTRL, egui::Key::K)
                || i.consume_key(egui::Modifiers::CTRL, egui::Key::P)
        }) {
            if self.palette.open {
                self.palette.open = false;
            } else {
                self.open_palette();
            }
        }
        if ctx.input_mut(|i| i.consume_key(egui::Modifiers::CTRL, egui::Key::S)) {
            self.save();
        }
        if ctx.input_mut(|i| i.consume_key(egui::Modifiers::CTRL, egui::Key::O)) {
            self.open_folder();
        }
        if ctx.input_mut(|i| i.consume_key(egui::Modifiers::CTRL, egui::Key::B)) {
            self.sidebar_open = !self.sidebar_open;
        }
        if ctx.input_mut(|i| i.consume_key(egui::Modifiers::CTRL, egui::Key::F))
            && self.page == Page::Workspace
            && !self.note.is_null()
        {
            self.editor_tools.find_open = !self.editor_tools.find_open;
        }
        if ctx.input_mut(|i| i.consume_key(egui::Modifiers::NONE, egui::Key::F2))
            && self.page == Page::Workspace
            && !self.note.is_null()
        {
            self.toggle_rename_bar();
        }
        if ctx.input_mut(|i| i.consume_key(egui::Modifiers::CTRL, egui::Key::Comma)) {
            self.go(Page::Settings);
        }

        if !self.polling_status && self.pending.is_none() && Instant::now() >= self.next_poll {
            self.next_poll = Instant::now() + Duration::from_secs(3);
            self.polling_status = true;
            self.send_background("status_poll", json!({"operation":"status"}));
        }
        if self.automatic_checks && self.pending.is_none() && Instant::now() >= self.next_update {
            self.next_update = Instant::now() + Duration::from_secs(86400);
            self.request("check_update", json!({"operation":"check_update"}));
        }
        ctx.request_repaint_after(Duration::from_secs(3));

        let colors = palette(ctx.global_style().visuals.dark_mode);
        self.show_sidebar(ui);
        self.show_top_bar(ui);
        self.show_status_bar(ui);

        if !self.error.is_empty() {
            egui::Panel::top("error-banner")
                .frame(
                    egui::Frame::new()
                        .fill(colors.card)
                        .stroke(Stroke::new(1.0, colors.danger))
                        .inner_margin(egui::Margin::symmetric(14, 8)),
                )
                .show_separator_line(false)
                .show(ui, |ui| {
                    ui.horizontal_wrapped(|ui| {
                        ui.colored_label(colors.danger, &self.error);
                        if ui.small_button("Dismiss").clicked() {
                            self.error.clear();
                        }
                    });
                });
        }

        match self.page {
            Page::Workspace => self.workspace(ui),
            Page::Canvas => {
                egui::CentralPanel::default().show(ui, |ui| {
                    self.canvas_page(ui);
                });
            }
            Page::Graph => {
                egui::CentralPanel::default().show(ui, |ui| {
                    if let Some(id) = self.graph.show(ui) {
                        self.select_note(&id);
                    }
                });
            }
            Page::Account | Page::Settings | Page::Sync => {
                egui::CentralPanel::default().show(ui, |ui| {
                    egui::ScrollArea::vertical()
                        .id_salt("destination-page")
                        .show(ui, |ui| {
                            egui::Frame::new()
                                .inner_margin(egui::Margin::symmetric(32, 12))
                                .show(ui, |ui| {
                                    ui.set_max_width(780.0);
                                    match self.page {
                                        Page::Account => self.account(ui),
                                        Page::Settings => self.settings(ui),
                                        Page::Sync => self.sync(ui),
                                        _ => {}
                                    }
                                });
                        });
                });
            }
        }

        self.show_palette_modal(&ctx);

        if self.confirm_delete {
            egui::Window::new("Delete this note?")
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
                .show(&ctx, |ui| {
                    ui.label(format!(
                        "Remove {} from this vault?",
                        string(&self.note, "path")
                    ));
                    ui.label("Saved history is retained. A paired vault will sync this deletion.");
                    ui.horizontal(|ui| {
                        if ui.button("Cancel").clicked() {
                            self.confirm_delete = false;
                        }
                        if ui
                            .add_enabled(
                                !self.dirty() && self.pending.is_none(),
                                egui::Button::new("Confirm deletion"),
                            )
                            .clicked()
                        {
                            let mut req = self.scope("delete_note");
                            req["id"] = self.note["id"].clone();
                            req["body"] = json!({"path":self.note["path"],"hash":self.note["hash"],"revision":self.note["revision"]});
                            self.request("delete_note", req);
                            self.confirm_delete = false;
                        }
                    });
                });
        }

        if self.confirm_close {
            egui::Window::new("Keep your draft")
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
                .show(&ctx, |ui| {
                    ui.label(
                        "This note has unsaved changes. Save it before leaving, or discard the draft.",
                    );
                    ui.horizontal(|ui| {
                        if ui.button("Keep editing").clicked() {
                            self.confirm_close = false;
                            self.pending_quit = false;
                            self.pending_navigation = None;
                        }
                        if ui.button("Save draft").clicked() {
                            self.after_save_quit = self.pending_quit;
                            self.after_save_navigation = self.pending_navigation.take();
                            self.pending_quit = false;
                            self.confirm_close = false;
                            self.save();
                        }
                        if ui.button("Discard and continue").clicked() {
                            self.canvas.discard();
                            self.markdown = self.saved.clone();
                            self.space = string(&self.note, "spaceId").into();
                            self.confirm_close = false;
                            if self.pending_quit {
                                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                            } else if let Some(value) = self.pending_navigation.take() {
                                self.perform_navigation(value);
                            }
                        }
                    });
                });
        }
    }
}
