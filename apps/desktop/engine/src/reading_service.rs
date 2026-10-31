use crate::{reading, vault::Result, Engine};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
fn field<'a>(req: &'a Value, key: &str) -> Result<&'a str> {
    req[key].as_str().ok_or_else(|| format!("Missing {key}."))
}
impl Engine {
    pub(crate) fn reading_operation(&mut self, req: Value) -> Result<Value> {
        let result = match field(&req, "operation")? {
            "render_pdf" => {
                #[cfg(windows)]
                {
                    let bytes = STANDARD
                        .decode(field(&req, "data")?)
                        .map_err(|_| "Invalid PDF data.")?;
                    crate::pdf_windows::render(
                        &bytes,
                        req["page"].as_u64().unwrap_or(0).min(500) as u32,
                    )?
                }
                #[cfg(not(windows))]
                {
                    return Err("Use the platform-native PDF viewer.".into());
                }
            }
            "reading_document" => {
                let mut blocks = reading::document(field(&req, "markdown")?)?;
                fn theme(blocks: &mut [reading::Block], dark: bool) {
                    for block in blocks {
                        if block.kind == "code" {
                            block.spans = reading::highlight(&block.text, &block.language, dark);
                        }
                        theme(&mut block.children, dark);
                    }
                }
                theme(&mut blocks, req["dark"] == true);
                json!({"blocks":blocks})
            }
            "reading_resolve" => {
                let notes = self.execute(
                    json!({"operation":"notes","source":req["source"],"vaultId":req["vaultId"]}),
                )?;
                let (note, _) = reading::resolve(
                    field(&req, "path")?,
                    field(&req, "target")?,
                    req["syntax"].as_str().unwrap_or("wiki"),
                    field(&req, "spaceId")?,
                    notes["notes"].as_array().ok_or("Invalid note index.")?,
                )
                .ok_or("This note link is unavailable in the current Space.")?;
                json!({"id":note["id"]})
            }
            "reading_download" => {
                let files = self.workspace_files(&req)?;
                let (file, _) = reading::resolve(
                    field(&req, "path")?,
                    field(&req, "target")?,
                    req["syntax"].as_str().unwrap_or("wiki"),
                    field(&req, "spaceId")?,
                    &files,
                )
                .ok_or("Attachment unavailable in this Space.")?;
                let mut request = req.clone();
                request["id"] = file["id"].clone();
                let (file, bytes) = self.workspace_read(&request)?;
                json!({"kind":"file","path":file["path"],"data":STANDARD.encode(bytes)})
            }
            "render_formula" => reading::png_reply(reading::render_formula(
                field(&req, "text")?,
                req["dark"] == true,
            )?),
            "render_diagram" => reading::png_reply(reading::render_diagram(
                field(&req, "text")?,
                req["dark"] == true,
            )?),
            "highlight_code" => {
                json!({"spans":reading::highlight(field(&req,"text")?,req["language"].as_str().unwrap_or(""),req["dark"]==true)})
            }
            "reading_embed" => {
                let vault = field(&req, "vaultId")?;
                let space = field(&req, "spaceId")?;
                let path = field(&req, "path")?;
                let target = field(&req, "target")?;
                let syntax = req["syntax"].as_str().unwrap_or("wiki");
                let notes = self
                    .execute(json!({"operation":"notes","source":req["source"],"vaultId":vault}))?;
                if let Some((note, fragment)) = reading::resolve(
                    path,
                    target,
                    syntax,
                    space,
                    notes["notes"].as_array().ok_or("Invalid note index.")?,
                ) {
                    let mut read = json!({"operation":"read_note","source":req["source"],"vaultId":vault,"id":note["id"]});
                    read["spaceId"] = json!(space);
                    let data = if req["source"] == "local" {
                        self.execute(read)?
                    } else {
                        self.request(
                            &format!(
                                "/api/vaults/{vault}/notes/{}?spaceId={space}",
                                field(note, "id")?
                            ),
                            "GET",
                            Value::Null,
                        )?
                    };
                    if data["note"]["spaceId"] != space {
                        return Err("Note moved to another Space. Reload it.".into());
                    }
                    let text = reading::fragment(field(&data["note"], "markdown")?, &fragment)?;
                    json!({"kind":"note","id":note["id"],"path":note["path"],"blocks":reading::document(&text)?})
                } else {
                    let files = self.workspace_files(&req)?;
                    let (file,_)=reading::resolve(path,target,syntax,space,&files).ok_or("Embedded reference is unavailable in this Space. Use a full vault path for ambiguous names.")?;
                    let mut request = req.clone();
                    request["id"] = file["id"].clone();
                    let (file, bytes) = self.workspace_read(&request)?;
                    let mut value = if image::guess_format(&bytes).is_ok() {
                        reading::png_reply(reading::image_preview(&bytes)?)
                    } else if bytes.starts_with(b"%PDF-") {
                        json!({"kind":"pdf","data":STANDARD.encode(&bytes)})
                    } else if bytes.starts_with(b"ID3")
                        || bytes.starts_with(b"OggS")
                        || (bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WAVE"))
                        || (bytes.first() == Some(&255)
                            && bytes.get(1).is_some_and(|b| b & 0xe0 == 0xe0))
                    {
                        json!({"kind":"audio","data":STANDARD.encode(&bytes)})
                    } else {
                        return Err("This file type has no inline preview. Open it from your vault or download the original.".into());
                    };
                    value["path"] = file["path"].clone();
                    value
                }
            }
            _ => return Err("Unknown reading operation.".into()),
        };
        let mut result = result;
        result["key"] = req["key"].clone();
        Ok(result)
    }
}
