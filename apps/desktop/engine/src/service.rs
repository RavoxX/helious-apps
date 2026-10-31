use crate::{
    knowledge, remote, sync,
    vault::{Operation, Result, Vault},
    CLOUD_ORIGIN,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use notify::Watcher;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, fs, path::PathBuf, sync::mpsc};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct Registry {
    recent: Vec<Value>,
    server: Option<String>,
    settings: Value,
    extensions: Vec<crate::extensions::Installed>,
}

pub struct Engine {
    folder: PathBuf,
    registry: Registry,
    vaults: HashMap<String, Vault>,
    watchers: HashMap<String, notify::RecommendedWatcher>,
    changes: mpsc::Receiver<String>,
    change_sender: mpsc::Sender<String>,
    runtime: tokio::runtime::Runtime,
    pending_update: Option<crate::updater::PreparedUpdate>,
}

fn field<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v[key].as_str().ok_or_else(|| format!("Missing {}.", key))
}

impl Engine {
    pub fn new(folder: PathBuf) -> Result<Self> {
        fs::create_dir_all(&folder).map_err(|_| "Cannot open desktop settings folder.")?;
        let registry = match fs::read(folder.join("registry.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| {
                "Cannot read desktop settings; preserve registry.json and restore its backup."
            })?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Registry::default(),
            Err(_) => return Err("Cannot read desktop settings.".into()),
        };
        let (tx, rx) = mpsc::channel();
        Ok(Self {
            folder,
            registry,
            vaults: HashMap::new(),
            watchers: HashMap::new(),
            changes: rx,
            change_sender: tx,
            runtime: tokio::runtime::Runtime::new().map_err(|_| "Cannot start network worker.")?,
            pending_update: None,
        })
    }

    fn persist(&self) -> Result<()> {
        use std::io::Write;
        let mut file = tempfile::NamedTempFile::new_in(&self.folder)
            .map_err(|_| "Cannot stage desktop settings.")?;
        file.write_all(&serde_json::to_vec(&self.registry).map_err(|_| "Cannot encode settings.")?)
            .map_err(|_| "Cannot save settings.")?;
        file.as_file()
            .sync_all()
            .map_err(|_| "Cannot flush settings.")?;
        file.persist(self.folder.join("registry.json"))
            .map_err(|_| "Cannot replace settings.")?;
        Ok(())
    }

    pub fn server(&self) -> Result<String> {
        self.registry
            .server
            .clone()
            .ok_or("Sign in to Helious Cloud or your server first.".into())
    }

    pub fn request(&self, path: &str, method: &str, body: Value) -> Result<Value> {
        let reply = self
            .runtime
            .block_on(remote::request(&self.server()?, path, method, body))?;
        if !(200..300).contains(&reply.status) {
            return Err(reply.data["error"]
                .as_str()
                .unwrap_or("The server refused this request.")
                .to_string());
        }
        Ok(reply.data)
    }

    pub fn local(&mut self, id: &str) -> Result<&mut Vault> {
        self.vaults
            .get_mut(id)
            .ok_or("Open this local vault first.".into())
    }

    fn open(&mut self, path: PathBuf) -> Result<Value> {
        let canonical = fs::canonicalize(&path).map_err(|_| "Cannot open that folder.")?;
        let existing = self
            .vaults
            .values()
            .find(|v| v.root == canonical)
            .map(|v| v.config.id.clone());
        let id = if let Some(id) = existing {
            id
        } else {
            let vault = Vault::open(path)?;
            let id = vault.config.id.clone();
            if self.vaults.contains_key(&id) {
                return Err("A different folder with this vault ID is already open.".into());
            }
            let sender = self.change_sender.clone();
            let changed = id.clone();
            let mut watcher =
                notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                    if let Ok(event) = event {
                        if !matches!(event.kind, notify::EventKind::Access(_))
                            && event
                                .paths
                                .iter()
                                .any(|p| !p.components().any(|s| s.as_os_str() == ".helious"))
                        {
                            let _ = sender.send(changed.clone());
                        }
                    }
                })
                .map_err(|_| "Cannot start folder watcher.")?;
            watcher
                .watch(&vault.root, notify::RecursiveMode::Recursive)
                .map_err(|_| "Cannot watch this folder.")?;
            self.watchers.insert(id.clone(), watcher);
            self.vaults.insert(id.clone(), vault);
            id
        };
        let vault = self.local(&id)?;
        let snapshot = vault.scan()?;
        let recent = json!({"id":id,"name":vault.config.name,"path":vault.root.to_string_lossy()});
        self.registry.recent.retain(|r| r["id"] != id);
        self.registry.recent.insert(0, recent);
        self.registry.recent.truncate(20);
        self.persist()?;
        Ok(snapshot)
    }

    fn enrich_local_note(n: &Value) -> Value {
        let mut note = n.clone();
        let path = n["path"].as_str().unwrap_or("");
        let md = n["markdown"].as_str().unwrap_or("");
        note["title"] = json!(knowledge::title(path, md));
        note["tags"] = json!(knowledge::extract_tags(md));
        note["wordCount"] = json!(knowledge::word_count(md));
        note
    }

    fn local_notes(&mut self, id: &str) -> Result<Vec<Value>> {
        let vault = self.local(id)?;
        let snapshot = vault.scan()?;
        Ok(snapshot["files"]
            .as_array()
            .ok_or("Cannot list local files.")?
            .iter()
            .filter(|n| n["kind"] == "note")
            .map(Self::enrich_local_note)
            .collect())
    }

    fn move_local_note(
        &mut self,
        vault_id: &str,
        note_id: &str,
        new_path: &str,
        markdown_override: Option<&str>,
        expected_hash: Option<&str>,
        space_override: Option<&str>,
    ) -> Result<Value> {
        let new_path = crate::vault::logical(new_path)?;
        if !new_path.to_lowercase().ends_with(".md") {
            return Err("Notes must end with .md.".into());
        }
        let notes = self.local_notes(vault_id)?;
        let current = notes
            .iter()
            .find(|n| n["id"].as_str() == Some(note_id))
            .ok_or("Note not found.")?
            .clone();
        let old_path = current["path"].as_str().ok_or("Invalid note path.")?;
        let current_hash = current["hash"].as_str().ok_or("Missing note hash.")?;
        if let Some(expected) = expected_hash {
            if expected != current_hash {
                return Err(
                    "CONFLICT: This file changed outside Helious. Reload it before renaming."
                        .into(),
                );
            }
        }
        let space = space_override
            .or_else(|| current["spaceId"].as_str())
            .ok_or("Choose a Space.")?
            .to_string();
        let markdown = markdown_override
            .or_else(|| current["markdown"].as_str())
            .unwrap_or("");
        if old_path == new_path {
            let vault = self.local(vault_id)?;
            vault.commit(vec![Operation {
                path: new_path.clone(),
                expected_hash: Some(current_hash.to_string()),
                data: Some(STANDARD.encode(markdown.as_bytes())),
                space_id: space,
                source_id: None,
            }])?;
            let saved = self.local(vault_id)?.read_note(note_id)?;
            return Ok(json!({
                "note": Self::enrich_local_note(&saved),
                "updatedLinks": 0,
                "changedNotes": 1,
                "ok": true,
            }));
        }
        let rewrites = knowledge::plan_local_move(&notes, note_id, &new_path)?;
        let total_links: usize = rewrites.iter().map(|(_, _, _, count)| *count).sum();
        let mut ops = Vec::new();
        if old_path.eq_ignore_ascii_case(&new_path) {
            ops.push(Operation {
                path: new_path.clone(),
                expected_hash: Some(current_hash.to_string()),
                data: Some(STANDARD.encode(markdown.as_bytes())),
                space_id: space,
                source_id: Some(note_id.to_string()),
            });
        } else {
            ops.push(Operation {
                path: new_path.clone(),
                expected_hash: None,
                data: Some(STANDARD.encode(markdown.as_bytes())),
                space_id: space,
                source_id: Some(note_id.to_string()),
            });
            ops.push(Operation {
                path: old_path.to_string(),
                expected_hash: Some(current_hash.to_string()),
                data: None,
                space_id: current["spaceId"].as_str().unwrap_or_default().to_string(),
                source_id: None,
            });
        }
        for (sib_id, sib_path, updated_md, _) in &rewrites {
            if let Some(sib) = notes.iter().find(|n| n["id"].as_str() == Some(sib_id)) {
                ops.push(Operation {
                    path: sib_path.clone(),
                    expected_hash: sib["hash"].as_str().map(str::to_string),
                    data: Some(STANDARD.encode(updated_md.as_bytes())),
                    space_id: sib["spaceId"].as_str().unwrap_or_default().to_string(),
                    source_id: None,
                });
            }
        }
        let changed_notes = 1 + rewrites.len();
        self.local(vault_id)?.commit(ops)?;
        let saved = self.local(vault_id)?.read_note(note_id)?;
        Ok(json!({
            "note": Self::enrich_local_note(&saved),
            "updatedLinks": total_links,
            "changedNotes": changed_notes,
            "ok": true,
        }))
    }

    pub fn execute(&mut self, req: Value) -> Result<Value> {
        let op = field(&req, "operation")?;
        match op {
            "validate_extension" => {
                Ok(json!({"manifest":crate::extensions::validate(req["manifest"].clone())?}))
            }
            "extension_example" => Ok(
                json!({"manifest":serde_json::from_str::<Value>(crate::extensions::EXAMPLE).map_err(|_|"Invalid built-in example.")?}),
            ),
            "extensions" => Ok(json!({"extensions":self.registry.extensions})),
            "install_extension" => {
                if req["consent"] != true {
                    return Err("Review and grant the requested editor permissions first.".into());
                }
                let manifest = crate::extensions::validate(req["manifest"].clone())?;
                if self.registry.extensions.len() >= 10
                    && !self
                        .registry
                        .extensions
                        .iter()
                        .any(|e| e.manifest.id == manifest.id)
                {
                    return Err("Install at most ten extensions.".into());
                }
                self.registry
                    .extensions
                    .retain(|e| e.manifest.id != manifest.id);
                self.registry.extensions.push(crate::extensions::Installed {
                    granted: manifest.permissions.clone(),
                    manifest,
                    enabled: true,
                });
                self.persist()?;
                Ok(json!({"extensions":self.registry.extensions}))
            }
            "remove_extension" | "enable_extension" => {
                let id = field(&req, "id")?;
                if op == "remove_extension" {
                    self.registry.extensions.retain(|e| e.manifest.id != id);
                } else {
                    let installed = self
                        .registry
                        .extensions
                        .iter_mut()
                        .find(|e| e.manifest.id == id)
                        .ok_or("Extension not found.")?;
                    installed.enabled = req["enabled"] == true;
                }
                self.persist()?;
                Ok(json!({"extensions":self.registry.extensions}))
            }
            "run_extension" => {
                let installed = self
                    .registry
                    .extensions
                    .iter()
                    .find(|e| e.manifest.id == req["id"].as_str().unwrap_or("") && e.enabled)
                    .ok_or("Enable the extension before running it.")?;
                crate::extensions::run(
                    &installed.manifest,
                    field(&req, "command")?,
                    &installed.granted,
                    field(&req, "markdown")?,
                    field(&req, "path")?,
                    &chrono::Local::now().fixed_offset(),
                )
            }
            "reading_document" | "render_formula" | "render_diagram" | "reading_embed"
            | "highlight_code" | "render_pdf" | "reading_resolve" | "reading_download" => {
                self.reading_operation(req)
            }
            "validate_canvas" => {
                let document = crate::canvas::parse(field(&req, "text")?)?;
                Ok(json!({"document":document}))
            }
            "properties" | "replace_properties" | "edit_property" | "open_daily"
            | "new_from_template" | "canvas_list" | "canvas_read" | "canvas_save"
            | "canvas_delete" => self.authoring_operation(req),
            "check_update" => self.runtime.block_on(crate::updater::check()),
            "download_update" => {
                self.pending_update = Some(self.runtime.block_on(crate::updater::prepare())?);
                Ok(json!({"ready":true}))
            }
            "install_update" => {
                crate::updater::install(
                    self.pending_update
                        .take()
                        .ok_or("Download a verified update first.")?,
                )?;
                Ok(json!({"installing":true}))
            }
            "status" => {
                let mut changed = vec![];
                while let Ok(id) = self.changes.try_recv() {
                    if !changed.contains(&id) {
                        changed.push(id);
                    }
                }
                Ok(
                    json!({"recent":self.registry.recent,"server":self.registry.server,"cloudOrigin":CLOUD_ORIGIN,"settings":self.registry.settings,"changedVaults":changed,"version":env!("CARGO_PKG_VERSION")}),
                )
            }
            "open_local" => self.open(field(&req, "path")?.into()),
            "open_recent" => {
                let path = self
                    .registry
                    .recent
                    .iter()
                    .find(|r| r["id"] == req["id"])
                    .and_then(|r| r["path"].as_str())
                    .ok_or("Recent folder not found.")?
                    .to_string();
                self.open(path.into())
            }
            "close_local" => {
                let id = field(&req, "vaultId")?;
                self.watchers.remove(id);
                self.vaults.remove(id);
                Ok(json!({"ok":true}))
            }
            "settings" => {
                let prev = &self.registry.settings;
                let settings = &req["settings"];
                let theme = settings["theme"]
                    .as_str()
                    .or_else(|| prev["theme"].as_str())
                    .unwrap_or("dark");
                if !["dark", "light", "system"].contains(&theme) {
                    return Err("Invalid appearance.".into());
                }
                let size = settings["fontSize"]
                    .as_u64()
                    .or_else(|| prev["fontSize"].as_u64())
                    .unwrap_or(16)
                    .clamp(12, 28);
                let wrap = settings["wrap"]
                    .as_bool()
                    .or_else(|| prev["wrap"].as_bool())
                    .unwrap_or(true);
                let auto_checks = settings["automaticChecks"]
                    .as_bool()
                    .or_else(|| prev["automaticChecks"].as_bool())
                    .unwrap_or(true);
                let auto_install = settings["automaticInstall"]
                    .as_bool()
                    .or_else(|| prev["automaticInstall"].as_bool())
                    .unwrap_or(false);
                self.registry.settings = json!({
                    "theme": theme,
                    "fontSize": size,
                    "wrap": wrap,
                    "automaticChecks": auto_checks,
                    "automaticInstall": auto_install,
                });
                self.persist()?;
                Ok(self.registry.settings.clone())
            }
            "login" => {
                let origin = remote::origin(req["origin"].as_str().unwrap_or(CLOUD_ORIGIN))?;
                let response = self.runtime.block_on(remote::connect(
                    &origin,
                    field(&req, "email")?,
                    field(&req, "password")?,
                    req["code"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .map(str::to_string),
                ))?;
                if response.status != 200 {
                    return Err(response.data["error"]
                        .as_str()
                        .unwrap_or("Sign-in failed. Check your details and email verification.")
                        .into());
                }
                self.registry.server = Some(origin);
                self.persist()?;
                Ok(response.data)
            }
            "logout" => {
                let server = self.server()?;
                let revoked = self.request("/api/auth/logout", "POST", json!({})).is_ok();
                remote::forget(&server)?;
                self.registry.server = None;
                self.persist()?;
                Ok(json!({"serverRevoked":revoked}))
            }
            "api" => self.request(
                field(&req, "path")?,
                req["method"].as_str().unwrap_or("GET"),
                req["body"].clone(),
            ),
            "local_snapshot" => self.local(field(&req, "vaultId")?)?.scan(),
            "local_config" => {
                let id = field(&req, "vaultId")?;
                if let Some(config) = req["value"].get("sync").filter(|v| !v.is_null()) {
                    let local = self.local(id)?.scan()?;
                    if config["schema"] != 1 || config["serverOrigin"] != self.server()? {
                        return Err("Pair with the connected server origin.".into());
                    }
                    let me = self.request("/api/auth/me", "GET", Value::Null)?;
                    if me["user"]["id"] != config["ownerId"] {
                        return Err("Pair with the currently signed-in account.".into());
                    }
                    let vault_id = field(config, "vaultId")?;
                    if !crate::vault::valid_id(vault_id) {
                        return Err("Invalid server vault.".into());
                    }
                    let remote = self.request(
                        &format!("/api/vaults/{}/spaces", vault_id),
                        "GET",
                        Value::Null,
                    )?;
                    let mappings = config["mappings"]
                        .as_object()
                        .filter(|m| !m.is_empty() && m.len() <= 100)
                        .ok_or("Choose Spaces to sync.")?;
                    let mut selected = std::collections::HashSet::new();
                    for (key, target) in mappings {
                        let target = target
                            .as_str()
                            .filter(|v| crate::vault::valid_id(v))
                            .ok_or("Invalid mapped Space.")?;
                        if !selected.insert(target) {
                            return Err("Each server Space may be mapped only once.".into());
                        }
                        let source = local["spaces"]
                            .as_array()
                            .and_then(|s| s.iter().find(|s| s["id"] == *key))
                            .ok_or("Local Space not found.")?;
                        let destination = remote["spaces"]
                            .as_array()
                            .and_then(|s| s.iter().find(|s| s["id"] == target))
                            .ok_or("Server Space not found.")?;
                        if (source["kind"] == "personal" || destination["kind"] == "personal")
                            && req["confirmPersonal"] != true
                        {
                            return Err("Explicitly confirm Personal Space sharing.".into());
                        }
                    }
                }
                self.local(id)?.configure(req["value"].clone())?;
                Ok(json!({"ok":true,"sync":self.local(id)?.config.sync}))
            }
            "notes" => {
                if req["source"] == "local" {
                    Ok(json!({"notes":self.local_notes(field(&req,"vaultId")?)?}))
                } else {
                    let id = field(&req, "vaultId")?;
                    let mut all = vec![];
                    loop {
                        let page = self.request(
                            &format!("/api/vaults/{}/notes?limit=100&offset={}", id, all.len()),
                            "GET",
                            Value::Null,
                        )?;
                        let batch = page["notes"].as_array().ok_or("Invalid note list.")?;
                        if batch.is_empty() {
                            break;
                        }
                        all.extend(batch.clone());
                        if all.len() >= page["total"].as_u64().unwrap_or(0) as usize
                            || all.len() >= 10000
                        {
                            break;
                        }
                    }
                    Ok(json!({"notes":all}))
                }
            }
            "read_note" => {
                if req["source"] == "local" {
                    let raw = self
                        .local(field(&req, "vaultId")?)?
                        .read_note(field(&req, "id")?)?;
                    Ok(json!({"note": Self::enrich_local_note(&raw)}))
                } else {
                    self.request(
                        &format!(
                            "/api/vaults/{}/notes/{}",
                            field(&req, "vaultId")?,
                            field(&req, "id")?
                        ),
                        "GET",
                        Value::Null,
                    )
                }
            }
            "rename_note" => {
                let vault_id = field(&req, "vaultId")?;
                let note_id = field(&req, "id")?;
                let new_path = field(&req, "path")?;
                if req["source"] == "local" {
                    self.move_local_note(
                        vault_id,
                        note_id,
                        new_path,
                        req["markdown"].as_str(),
                        req["hash"].as_str(),
                        req["spaceId"].as_str(),
                    )
                } else {
                    let revision = req["revision"]
                        .as_u64()
                        .ok_or("Missing expected note revision.")?;
                    let mut body = json!({
                        "revision": revision,
                        "path": new_path,
                    });
                    if let Some(md) = req["markdown"].as_str() {
                        body["markdown"] = json!(md);
                    }
                    if let Some(space) = req["spaceId"].as_str().filter(|s| !s.is_empty()) {
                        body["spaceId"] = json!(space);
                    }
                    self.request(
                        &format!("/api/vaults/{vault_id}/notes/{note_id}"),
                        "PATCH",
                        body,
                    )
                }
            }
            "save_note" | "create_note" | "delete_note" => {
                let id = field(&req, "vaultId")?;
                if req["source"] != "local" {
                    let suffix = if op == "create_note" {
                        String::new()
                    } else {
                        format!("/{}", field(&req, "id")?)
                    };
                    return self.request(
                        &format!("/api/vaults/{}/notes{}", id, suffix),
                        if op == "create_note" {
                            "POST"
                        } else if op == "delete_note" {
                            "DELETE"
                        } else {
                            "PATCH"
                        },
                        req["body"].clone(),
                    );
                }
                let body = &req["body"];
                if op == "save_note" {
                    let note_id = field(&req, "id")?;
                    let existing_path = self
                        .local(id)?
                        .config
                        .files
                        .values()
                        .find(|r| !r.deleted && r.id == note_id)
                        .map(|r| r.path.clone());
                    if let (Some(old_path), Some(new_path)) = (existing_path, body["path"].as_str())
                    {
                        if new_path != old_path {
                            return self.move_local_note(
                                id,
                                note_id,
                                new_path,
                                body["markdown"].as_str(),
                                body["hash"].as_str(),
                                body["spaceId"].as_str(),
                            );
                        }
                    }
                }
                let vault = self.local(id)?;
                vault.scan()?;
                let previous = if op == "create_note" {
                    None
                } else {
                    Some(
                        vault
                            .config
                            .files
                            .values()
                            .find(|r| !r.deleted && r.id == req["id"].as_str().unwrap_or(""))
                            .cloned()
                            .ok_or("Note not found.")?,
                    )
                };
                let path = previous
                    .as_ref()
                    .map(|r| r.path.as_str())
                    .unwrap_or(field(body, "path")?);
                if !path.to_lowercase().ends_with(".md") {
                    return Err("Notes must end with .md.".into());
                }
                let space = body["spaceId"]
                    .as_str()
                    .or_else(|| previous.as_ref().map(|r| r.space_id.as_str()))
                    .or_else(|| {
                        vault
                            .config
                            .spaces
                            .iter()
                            .find(|s| s.kind == "personal")
                            .map(|s| s.id.as_str())
                    })
                    .ok_or("Choose a Space.")?
                    .to_string();
                let expected = if op == "create_note" {
                    None
                } else {
                    Some(field(body, "hash")?.to_string())
                };
                let data = if op == "delete_note" {
                    None
                } else {
                    Some(STANDARD.encode(field(body, "markdown")?.as_bytes()))
                };
                let path = path.to_string();
                vault.commit(vec![Operation {
                    path: path.clone(),
                    expected_hash: expected,
                    data,
                    space_id: space,
                    source_id: None,
                }])?;
                let note = self
                    .local_notes(id)?
                    .into_iter()
                    .find(|n| n["path"] == path);
                Ok(json!({"note":note,"ok":true}))
            }
            "search_notes" => {
                let vault_id = field(&req, "vaultId")?;
                let query = req["query"].as_str().unwrap_or("");
                let space_id = req["spaceId"].as_str().filter(|s| !s.is_empty());
                let limit = req["limit"].as_u64().unwrap_or(50).clamp(1, 100) as usize;
                if req["source"] == "local" {
                    let notes = self.local_notes(vault_id)?;
                    Ok(json!({
                        "results": knowledge::search_local(&notes, query, space_id, limit)?
                    }))
                } else {
                    let encoded = utf8_percent_encode(query, NON_ALPHANUMERIC);
                    let space_param = space_id
                        .filter(|s| crate::vault::valid_id(s))
                        .map(|s| format!("&spaceId={s}"))
                        .unwrap_or_default();
                    let mut reply = self.request(
                        &format!(
                            "/api/vaults/{vault_id}/search?q={encoded}&limit={limit}{space_param}"
                        ),
                        "GET",
                        Value::Null,
                    )?;
                    if let Some(items) = reply["results"].as_array_mut() {
                        for item in items {
                            if let Some(snippet) = item["snippet"].as_str() {
                                item["snippet"] = json!(knowledge::mask_secrets(snippet));
                            }
                            if let Some(t) = item["title"].as_str() {
                                item["title"] = json!(knowledge::mask_secrets(t));
                            }
                        }
                    }
                    Ok(reply)
                }
            }
            "note_context" => {
                let vault_id = field(&req, "vaultId")?;
                let note_id = field(&req, "id")?;
                if req["source"] == "local" {
                    let notes = self.local_notes(vault_id)?;
                    knowledge::note_context_local(&notes, note_id, req["markdown"].as_str())
                } else {
                    let md = match req["markdown"].as_str() {
                        Some(draft) => draft.to_string(),
                        None => {
                            let fetched = self.request(
                                &format!("/api/vaults/{vault_id}/notes/{note_id}"),
                                "GET",
                                Value::Null,
                            )?;
                            fetched["note"]["markdown"]
                                .as_str()
                                .unwrap_or("")
                                .to_string()
                        }
                    };
                    let masked = knowledge::mask_secrets(&md);
                    let words = knowledge::word_count(&masked);
                    let chars = masked.chars().count();
                    let reading_minutes = words.div_ceil(200);
                    let headings = knowledge::extract_headings(&masked);
                    let tags = knowledge::extract_tags(&masked);
                    let links = self.request(
                        &format!("/api/vaults/{vault_id}/notes/{note_id}/links"),
                        "GET",
                        Value::Null,
                    )?;
                    let outgoing: Vec<Value> = links["outgoing"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|l| {
                            let resolved_id = l["resolution"]["noteId"].clone();
                            let resolved_path = l["resolution"]["path"].clone();
                            let raw_target =
                                knowledge::mask_secrets(l["target"].as_str().unwrap_or(""));
                            json!({
                                "target": raw_target,
                                "id": resolved_id,
                                "path": resolved_path,
                                "title": resolved_path
                                    .as_str()
                                    .map(|p| p.rsplit('/').next().unwrap_or(p).trim_end_matches(".md").to_string())
                                    .unwrap_or(raw_target),
                                "resolved": resolved_id.is_string(),
                            })
                        })
                        .collect();
                    let sanitize_items = |arr: Option<&Vec<Value>>| -> Vec<Value> {
                        arr.into_iter()
                            .flatten()
                            .map(|item| {
                                json!({
                                    "id": item["id"],
                                    "path": item["path"],
                                    "title": knowledge::mask_secrets(item["title"].as_str().unwrap_or("")),
                                    "snippet": knowledge::mask_secrets(item["snippet"].as_str().unwrap_or("")),
                                })
                            })
                            .collect()
                    };
                    Ok(json!({
                        "wordCount": words,
                        "charCount": chars,
                        "readingMinutes": reading_minutes,
                        "headings": headings,
                        "tags": tags,
                        "outgoing": outgoing,
                        "backlinks": sanitize_items(links["backlinks"].as_array()),
                        "unlinkedMentions": sanitize_items(links["unlinkedMentions"].as_array()),
                    }))
                }
            }
            "graph" => {
                let id = field(&req, "vaultId")?;
                if req["source"] == "local" {
                    Ok(knowledge::graph(&self.local_notes(id)?))
                } else {
                    self.request(&format!("/api/vaults/{}/graph", id), "GET", Value::Null)
                }
            }
            "history" => {
                if req["source"] == "local" {
                    self.local(field(&req, "vaultId")?)?
                        .history(field(&req, "id")?, req["revision"].as_u64())
                } else {
                    let suffix = req["revision"]
                        .as_u64()
                        .map(|r| format!("/{}", r))
                        .unwrap_or_default();
                    self.request(
                        &format!(
                            "/api/vaults/{}/notes/{}/history{}",
                            field(&req, "vaultId")?,
                            field(&req, "id")?,
                            suffix
                        ),
                        "GET",
                        Value::Null,
                    )
                }
            }
            "sync" => sync::run(self, field(&req, "vaultId")?, None),
            "resolve_sync" => sync::run(
                self,
                field(&req, "vaultId")?,
                Some((field(&req, "path")?.into(), field(&req, "choice")?.into())),
            ),
            _ => Err("Unknown native operation.".into()),
        }
    }
}
