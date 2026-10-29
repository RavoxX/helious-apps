use crate::{
    service::Engine,
    vault::{self, Operation, Result},
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
fn same(a: &Value, b: &Value) -> bool {
    if a.is_null() || b.is_null() {
        return a.is_null() && b.is_null();
    }
    ["path", "hash", "spaceId", "kind"]
        .iter()
        .all(|k| a[k] == b[k])
}
fn fingerprint(file: &Value, mappings: &Value) -> Value {
    json!({"id":file["id"],"path":file["path"],"hash":file["hash"],"spaceId":mappings[file["spaceId"].as_str().unwrap_or("")],"kind":file["kind"],"revision":file["revision"]})
}
fn selected(snapshot: &Value, config: &Value) -> BTreeMap<String, Value> {
    snapshot["files"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|f| {
            config["mappings"][f["spaceId"].as_str().unwrap_or("")].is_string()
                && !f["path"].as_str().unwrap_or("").contains(".conflict-")
        })
        .map(|f| {
            (
                f["path"].as_str().unwrap_or("").to_lowercase(),
                fingerprint(f, &config["mappings"]),
            )
        })
        .collect()
}
fn manifest(engine: &Engine, config: &Value) -> Result<BTreeMap<String, Value>> {
    let ids = config["mappings"]
        .as_object()
        .ok_or("Choose Spaces to sync.")?
        .values()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>()
        .join(",");
    if ids.is_empty() {
        return Err("Choose Spaces to sync.".into());
    }
    let result = engine.request(
        &format!(
            "/api/vaults/{}/sync/manifest?spaceIds={}",
            config["vaultId"].as_str().ok_or("Missing server vault.")?,
            ids
        ),
        "GET",
        Value::Null,
    )?;
    Ok(result["files"]
        .as_array()
        .ok_or("Invalid server manifest.")?
        .iter()
        .filter(|f| !f["path"].as_str().unwrap_or("").contains(".conflict-"))
        .map(|f| (f["path"].as_str().unwrap_or("").to_lowercase(), f.clone()))
        .collect())
}
fn remote_bytes(engine: &Engine, config: &Value, file: &Value) -> Result<Value> {
    let result = engine.request(
        &format!(
            "/api/vaults/{}/sync/file?id={}&kind={}",
            config["vaultId"].as_str().unwrap_or(""),
            file["id"].as_str().unwrap_or(""),
            file["kind"].as_str().unwrap_or("")
        ),
        "GET",
        Value::Null,
    )?;
    if !same(&result["file"], file)
        || result["file"]["revision"] != file["revision"]
        || result["file"]["id"] != file["id"]
    {
        return Err("Server file changed during sync. Run sync again.".into());
    }
    Ok(result["data"].clone())
}
fn local_space(config: &Value, remote: &Value) -> Result<String> {
    config["mappings"]
        .as_object()
        .and_then(|m| m.iter().find(|(_, v)| *v == remote))
        .map(|(k, _)| k.clone())
        .ok_or("This Space is not mapped.".into())
}
fn push(
    engine: &mut Engine,
    id: &str,
    config: &Value,
    path: &str,
    local: &Value,
    remote: &Value,
) -> Result<Value> {
    let source = if local.is_null() { remote } else { local };
    let data = if local.is_null() {
        Value::Null
    } else {
        let vault = engine.local(id)?;
        let bytes = vault::read(&vault.root, path, false)?.ok_or("Local file disappeared.")?;
        if vault::hash(&bytes) != local["hash"].as_str().unwrap_or("") {
            return Err("Local file changed during sync. Run sync again.".into());
        }
        json!(STANDARD.encode(bytes))
    };
    let result=engine.request(&format!("/api/vaults/{}/sync/file",config["vaultId"].as_str().unwrap_or("")),"POST",json!({"path":path,"kind":source["kind"],"spaceId":source["spaceId"],"expected":remote,"data":data}))?;
    Ok(json!({"local":local,"remote":result["file"]}))
}
fn pull(
    engine: &mut Engine,
    id: &str,
    config: &Value,
    path: &str,
    local: &Value,
    remote: &Value,
) -> Result<Value> {
    let source = if remote.is_null() { local } else { remote };
    let space = local_space(config, &source["spaceId"])?;
    let data = if remote.is_null() {
        None
    } else {
        Some(
            remote_bytes(engine, config, remote)?
                .as_str()
                .ok_or("Invalid file encoding.")?
                .to_string(),
        )
    };
    let snapshot = engine.local(id)?.commit(vec![Operation {
        path: path.into(),
        expected_hash: local["hash"].as_str().map(str::to_string),
        data,
        space_id: space,
        source_id: None,
    }])?;
    let current = selected(&snapshot, config)
        .get(&path.to_lowercase())
        .cloned()
        .unwrap_or(Value::Null);
    if !same(&current, remote) {
        return Err("Local file changed during sync. Its checkpoint was retained.".into());
    }
    Ok(json!({"local":current,"remote":remote}))
}
pub fn run(engine: &mut Engine, id: &str, choice: Option<(String, String)>) -> Result<Value> {
    let snapshot = engine.local(id)?.scan()?;
    let mut config = snapshot["sync"].clone();
    if config["schema"] != 1 || config["serverOrigin"] != engine.server()? {
        return Err("Pair this vault with the signed-in server first.".into());
    }
    let me = engine.request("/api/auth/me", "GET", Value::Null)?;
    if me["user"]["id"] != config["ownerId"] {
        return Err("Reconnect the original sync account.".into());
    }
    let local = selected(&snapshot, &config);
    let remote = manifest(engine, &config)?;
    let private: BTreeSet<_> = snapshot["files"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|f| config["mappings"][f["spaceId"].as_str().unwrap_or("")].is_null())
        .filter_map(|f| f["path"].as_str().map(str::to_lowercase))
        .collect();
    if remote.keys().any(|p| private.contains(p)) {
        return Err("A server file collides with an unselected local Space. Rename it or explicitly map that Space.".into());
    }
    let mut changed = 0;
    if let Some((path, which)) = choice {
        if !["local", "server"].contains(&which.as_str()) {
            return Err("Choose local or server.".into());
        }
        let key = path.to_lowercase();
        let saved = config["conflicts"][&key].clone();
        let l = local.get(&key).cloned().unwrap_or(Value::Null);
        let r = remote.get(&key).cloned().unwrap_or(Value::Null);
        if saved.is_null()
            || !same(&l, &saved["local"])
            || !same(&r, &saved["remote"])
            || r["revision"] != saved["remote"]["revision"]
        {
            // A stale choice must not leave an unresolvable checkpoint forever.
            // Preserve existing copies; the next sync creates a fresh conflict.
            config["base"]
                .as_object_mut()
                .ok_or("Invalid sync checkpoint.")?
                .remove(&key);
            config["conflicts"]
                .as_object_mut()
                .ok_or("Invalid sync conflicts.")?
                .remove(&key);
            engine.local(id)?.configure(json!({"sync":config}))?;
            return Err("A copy changed after this conflict. Sync and review again.".into());
        }
        config["base"][&key] = if which == "local" {
            push(engine, id, &config, &path, &l, &r)?
        } else {
            pull(engine, id, &config, &path, &l, &r)?
        };
        config["conflicts"]
            .as_object_mut()
            .ok_or("Invalid sync conflicts.")?
            .remove(&key);
        engine.local(id)?.configure(json!({"sync":config}))?;
        return Ok(config);
    }
    let keys: BTreeSet<_> = local
        .keys()
        .chain(remote.keys())
        .chain(
            config["base"]
                .as_object()
                .ok_or("Invalid sync checkpoint.")?
                .keys(),
        )
        .cloned()
        .collect();
    for key in keys {
        let l = local.get(&key).cloned().unwrap_or(Value::Null);
        let r = remote.get(&key).cloned().unwrap_or(Value::Null);
        let b = config["base"][&key].clone();
        let path = l["path"]
            .as_str()
            .or_else(|| r["path"].as_str())
            .unwrap_or(&key)
            .to_string();
        if same(&l, &r) {
            if l.is_null() {
                config["base"]
                    .as_object_mut()
                    .ok_or("Invalid checkpoint.")?
                    .remove(&key);
            } else {
                config["base"][&key] = json!({"local":l,"remote":r});
            }
            config["conflicts"]
                .as_object_mut()
                .ok_or("Invalid conflicts.")?
                .remove(&key);
        } else if b["conflict"] == true {
            continue;
        } else if (b.is_null() && r.is_null()) || (!b.is_null() && same(&r, &b["remote"])) {
            config["base"][&key] = push(engine, id, &config, &path, &l, &r)?;
            changed += 1;
        } else if (b.is_null() && l.is_null()) || (!b.is_null() && same(&l, &b["local"])) {
            config["base"][&key] = pull(engine, id, &config, &path, &l, &r)?;
            changed += 1;
        } else {
            let source = if r.is_null() { &l } else { &r };
            let data = if !r.is_null() {
                remote_bytes(engine, &config, &r)?
                    .as_str()
                    .ok_or("Invalid remote copy.")?
                    .to_string()
            } else {
                let vault = engine.local(id)?;
                STANDARD.encode(
                    vault::read(&vault.root, &path, false)?.ok_or("Local copy disappeared.")?,
                )
            };
            let dot = path
                .rfind('.')
                .filter(|d| *d > path.rfind('/').unwrap_or(0))
                .unwrap_or(path.len());
            let copy = format!(
                "{}.conflict-{}-server-{}{}",
                &path[..dot],
                chrono::Utc::now().format("%Y%m%dT%H%M%SZ"),
                &vault::id()[..8],
                &path[dot..]
            );
            let space = local_space(&config, &source["spaceId"])?;
            engine.local(id)?.commit(vec![Operation {
                path: copy.clone(),
                expected_hash: None,
                data: Some(data),
                space_id: space,
                source_id: None,
            }])?;
            config["conflicts"][&key] = json!({"path":path,"copy":copy,"local":l,"remote":r});
            config["base"][&key] = json!({"local":l,"remote":r,"conflict":true});
            changed += 1;
        }
        engine.local(id)?.configure(json!({"sync":config}))?;
    }
    config["lastSync"] = json!(vault::now());
    engine.local(id)?.configure(json!({"sync":config}))?;
    Ok(json!({"configuration":config,"changed":changed}))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn checkpoint_comparison_distinguishes_delete_space_and_case() {
        assert!(same(&Value::Null, &Value::Null));
        let f = json!({"path":"A.md","hash":"a","spaceId":"code","kind":"note"});
        assert!(!same(&f, &Value::Null));
        assert!(!same(
            &f,
            &json!({"path":"a.md","hash":"a","spaceId":"code","kind":"note"})
        ));
    }
}
