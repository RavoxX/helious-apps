use crate::{
    authoring, canvas,
    vault::{self, Operation, Result},
    Engine,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
fn field<'a>(value: &'a Value, name: &str) -> Result<&'a str> {
    value[name]
        .as_str()
        .ok_or_else(|| format!("Missing {name}."))
}
impl Engine {
    pub(crate) fn authoring_operation(&mut self, req: Value) -> Result<Value> {
        let op = field(&req, "operation")?;
        match op {
            "properties" => {
                Ok(json!({"properties":authoring::properties(field(&req,"markdown")?)?}))
            }
            "replace_properties" => Ok(
                json!({"markdown":authoring::replace_properties(field(&req,"markdown")?,&req["properties"])?}),
            ),
            "edit_property" => {
                let source = field(&req, "markdown")?;
                let mut values = authoring::properties(source)?;
                let key = field(&req, "name")?;
                if req["remove"] == true {
                    values.as_object_mut().expect("properties map").remove(key);
                } else {
                    values[key] = req["value"].clone();
                }
                Ok(
                    json!({"markdown":authoring::replace_properties(source,&values)?,"properties":values}),
                )
            }
            "open_daily" | "new_from_template" => {
                let id = field(&req, "vaultId")?.to_string();
                let source = field(&req, "source")?.to_string();
                let space = field(&req, "spaceId")?.to_string();
                let clock = if let Some(clock) = req["clock"].as_str() {
                    chrono::DateTime::parse_from_rfc3339(clock).map_err(|_| "Invalid clock.")?
                } else {
                    chrono::Local::now().fixed_offset()
                };
                let day = req["day"]
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| clock.format("%Y-%m-%d").to_string());
                let path = if op == "open_daily" {
                    authoring::daily_path(&day)?
                } else {
                    authoring::note_path(field(&req, "path")?)?
                };
                let notes =
                    self.execute(json!({"operation":"notes","source":source,"vaultId":id}))?;
                if let Some(existing) = notes["notes"].as_array().and_then(|n| {
                    n.iter().find(|n| {
                        n["path"]
                            .as_str()
                            .is_some_and(|p| p.eq_ignore_ascii_case(&path))
                    })
                }) {
                    if existing["spaceId"] != space {
                        return Err(
                            "That path belongs to another Space. Choose another path.".into()
                        );
                    }
                    if op != "open_daily" {
                        return Err("A note already exists at this path.".into());
                    }
                    return self.execute(json!({"operation":"read_note","source":source,"vaultId":id,"id":existing["id"]}));
                }
                let mut template = if op == "open_daily" {
                    "# {{date}}\n\n".to_string()
                } else {
                    "# {{title}}\n\n".to_string()
                };
                if let Some(template_id) = req["templateId"].as_str().filter(|s| !s.is_empty()) {
                    let value=self.execute(json!({"operation":"read_note","source":source,"vaultId":id,"id":template_id}))?;
                    if value["note"]["spaceId"] != space
                        || !value["note"]["path"]
                            .as_str()
                            .is_some_and(|s| s.starts_with("Templates/"))
                    {
                        return Err("Choose a template in this Space's Templates folder.".into());
                    }
                    template = field(&value["note"], "markdown")?.into();
                }
                let title = path
                    .rsplit('/')
                    .next()
                    .unwrap_or(&path)
                    .trim_end_matches(".md");
                let markdown = authoring::expand(&template, title, &day, &clock)?;
                let created=self.execute(json!({"operation":"create_note","source":source,"vaultId":id,"body":{"path":path,"markdown":markdown,"spaceId":space}}));
                if created.is_err() && op == "open_daily" {
                    let refreshed =
                        self.execute(json!({"operation":"notes","source":source,"vaultId":id}))?;
                    if let Some(existing) = refreshed["notes"].as_array().and_then(|n| {
                        n.iter()
                            .find(|n| n["path"] == path && n["spaceId"] == space)
                    }) {
                        return self.execute(json!({"operation":"read_note","source":source,"vaultId":id,"id":existing["id"]}));
                    }
                }
                created
            }
            "canvas_list" => {
                let files = self.workspace_files(&req)?;
                Ok(
                    json!({"files":files.into_iter().filter(|f|f["path"].as_str().is_some_and(|p|p.to_lowercase().ends_with(".canvas"))).collect::<Vec<_>>()}),
                )
            }
            "canvas_read" => {
                let (file, bytes) = self.workspace_read(&req)?;
                let source = String::from_utf8(bytes).map_err(|_| "Canvas must be UTF-8.")?;
                let document = canvas::parse(&source)?;
                Ok(json!({"file":file,"source":source,"document":document}))
            }
            "canvas_save" | "canvas_delete" => {
                let id = field(&req, "vaultId")?;
                let path = vault::logical(field(&req, "path")?)?;
                if !path.to_lowercase().ends_with(".canvas") {
                    return Err("Canvas files must end with .canvas.".into());
                }
                let space = field(&req, "spaceId")?.to_string();
                let data = if op == "canvas_delete" {
                    None
                } else {
                    let text = field(&req, "text")?;
                    canvas::parse(text)?;
                    Some(STANDARD.encode(text.as_bytes()))
                };
                if req["source"] == "local" {
                    let vault = self.local(id)?;
                    vault.scan()?;
                    if !req["expected"].is_null() {
                        let previous = vault
                            .config
                            .files
                            .get(&path.to_lowercase())
                            .filter(|r| !r.deleted)
                            .ok_or("Canvas changed or was deleted. Your draft is preserved.")?;
                        if req["expected"]["id"] != previous.id
                            || req["expected"]["spaceId"] != previous.space_id
                            || req["expected"]["hash"] != previous.hash
                        {
                            return Err("Canvas changed elsewhere. Your draft is preserved; reload before saving.".into());
                        }
                    }
                    vault.commit(vec![Operation {
                        path: path.clone(),
                        expected_hash: req["expected"]["hash"].as_str().map(str::to_string),
                        data,
                        space_id: space,
                        source_id: None,
                    }])?;
                    Ok(json!({"file":vault.config.files.get(&path.to_lowercase()),"ok":true}))
                } else {
                    self.request(&format!("/api/vaults/{id}/sync/file"),"POST",json!({"path":path,"spaceId":space,"kind":"attachment","expected":req["expected"],"data":data}))
                }
            }
            _ => Err("Unknown authoring operation.".into()),
        }
    }
    pub(crate) fn workspace_files(&mut self, req: &Value) -> Result<Vec<Value>> {
        let id = field(req, "vaultId")?;
        let files = if req["source"] == "local" {
            self.local(id)?.scan()?["files"]
                .as_array()
                .cloned()
                .unwrap_or_default()
        } else {
            self.request(&format!("/api/vaults/{id}/attachments"), "GET", Value::Null)?
                ["attachments"]
                .as_array()
                .cloned()
                .unwrap_or_default()
        };
        Ok(files
            .into_iter()
            .filter(|f| {
                f["kind"] != "note"
                    && req["spaceId"]
                        .as_str()
                        .is_none_or(|s| s.is_empty() || f["spaceId"] == s)
            })
            .collect())
    }
    pub(crate) fn workspace_read(&mut self, req: &Value) -> Result<(Value, Vec<u8>)> {
        let id = field(req, "vaultId")?;
        let file = self
            .workspace_files(req)?
            .into_iter()
            .find(|f| f["id"] == req["id"])
            .ok_or("File unavailable in this Space.")?;
        if req["source"] == "local" {
            let bytes = vault::read(&self.local(id)?.root, field(&file, "path")?, false)?
                .ok_or("File was deleted.")?;
            if vault::hash(&bytes) != file["hash"].as_str().unwrap_or("") {
                return Err("File changed while reading. Retry.".into());
            }
            Ok((file, bytes))
        } else {
            let response = self.request(
                &format!(
                    "/api/vaults/{id}/sync/file?id={}&kind=attachment",
                    field(&file, "id")?
                ),
                "GET",
                Value::Null,
            )?;
            if response["file"]["spaceId"] != file["spaceId"] {
                return Err("File moved to another Space. Reload.".into());
            }
            let bytes = STANDARD
                .decode(field(&response, "data")?)
                .map_err(|_| "Invalid file data.")?;
            if bytes.len() > 20 * 1024 * 1024 {
                return Err("File exceeds the preview limit.".into());
            }
            Ok((response["file"].clone(), bytes))
        }
    }
}
