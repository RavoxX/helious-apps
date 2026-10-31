//! Portable JSON Canvas validation, shared by the two native interfaces.
use crate::vault::{logical, Result};
use serde_json::{json, Value};
use std::collections::HashSet;
fn identifier(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        !s.is_empty()
            && s.len() <= 100
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    })
}
fn text(v: &Value, max: usize) -> bool {
    v.as_str().is_some_and(|s| s.len() <= max)
}
fn color(v: &Value) -> bool {
    v.is_null()
        || v.as_str().is_some_and(|s| {
            ["1", "2", "3", "4", "5", "6"].contains(&s)
                || (s.len() == 7
                    && s.starts_with('#')
                    && s[1..].bytes().all(|b| b.is_ascii_hexdigit()))
        })
}
pub fn parse(source: &str) -> Result<Value> {
    if source.len() > 1_000_000 {
        return Err("Canvas files are limited to 1,000,000 bytes.".into());
    }
    let value: Value = serde_json::from_str(source)
        .map_err(|_| "Invalid JSON Canvas file. The original has not been changed.")?;
    validate(&value)?;
    Ok(
        json!({"nodes":value.get("nodes").cloned().unwrap_or(json!([])),"edges":value.get("edges").cloned().unwrap_or(json!([]))}),
    )
}
pub fn validate(value: &Value) -> Result<()> {
    let root = value.as_object().ok_or("Use a JSON Canvas object.")?;
    if root
        .keys()
        .any(|k| !["nodes", "edges"].contains(&k.as_str()))
    {
        return Err("Unsupported canvas fields. The original has not been changed.".into());
    }
    let empty = vec![];
    let nodes = match value.get("nodes") {
        Some(v) => v.as_array().ok_or("Cards must be an array.")?,
        None => &empty,
    };
    let edges = match value.get("edges") {
        Some(v) => v.as_array().ok_or("Connections must be an array.")?,
        None => &empty,
    };
    if nodes.len() > 500 || edges.len() > 1000 {
        return Err("A canvas supports 500 cards and 1,000 connections.".into());
    }
    let mut ids = HashSet::new();
    for n in nodes {
        let obj = n.as_object().ok_or("Invalid canvas card.")?;
        if !identifier(&n["id"]) || !ids.insert(n["id"].as_str().unwrap()) || !color(&n["color"]) {
            return Err("Invalid card identifier or color.".into());
        }
        for key in ["x", "y", "width", "height"] {
            let v = n[key].as_i64().ok_or("Use integer card geometry.")?;
            if v.unsigned_abs() > 100000
                || (key == "width" && !(100..=4000).contains(&v))
                || (key == "height" && !(60..=4000).contains(&v))
            {
                return Err("Invalid card geometry.".into());
            }
        }
        let specific: &[&str] = match n["type"].as_str() {
            Some("text") if text(&n["text"], 20000) => &["text"],
            Some("file") if text(&n["file"], 1024) => {
                logical(n["file"].as_str().unwrap())?;
                if !n["subpath"].is_null()
                    && (!text(&n["subpath"], 200)
                        || !n["subpath"].as_str().unwrap().starts_with('#'))
                {
                    return Err("Invalid file fragment.".into());
                }
                &["file", "subpath"]
            }
            Some("link") if text(&n["url"], 2048) => {
                let url = url::Url::parse(n["url"].as_str().unwrap())
                    .map_err(|_| "Invalid link card.")?;
                if !["http", "https"].contains(&url.scheme())
                    || !url.username().is_empty()
                    || url.password().is_some()
                {
                    return Err("Use HTTP(S) links without credentials.".into());
                }
                &["url"]
            }
            Some("group") if n["label"].is_null() || text(&n["label"], 200) => &["label"],
            _ => return Err("Unsupported or invalid card type/content.".into()),
        };
        if obj.keys().any(|k| {
            !["id", "type", "x", "y", "width", "height", "color"].contains(&k.as_str())
                && !specific.contains(&k.as_str())
        }) {
            return Err("Unsupported card fields. The original has not been changed.".into());
        }
    }
    let mut edge_ids = HashSet::new();
    for e in edges {
        let obj = e.as_object().ok_or("Invalid connection.")?;
        if !identifier(&e["id"])
            || !edge_ids.insert(e["id"].as_str().unwrap())
            || !ids.contains(e["fromNode"].as_str().unwrap_or(""))
            || !ids.contains(e["toNode"].as_str().unwrap_or(""))
            || !color(&e["color"])
            || (!e["label"].is_null() && !text(&e["label"], 200))
            || obj.keys().any(|k| {
                ![
                    "id", "fromNode", "toNode", "fromSide", "toSide", "fromEnd", "toEnd", "label",
                    "color",
                ]
                .contains(&k.as_str())
            })
        {
            return Err("Invalid canvas connection.".into());
        }
        for key in ["fromSide", "toSide"] {
            if !e[key].is_null()
                && !e[key]
                    .as_str()
                    .is_some_and(|s| ["top", "right", "bottom", "left"].contains(&s))
            {
                return Err("Invalid connection side.".into());
            }
        }
        for key in ["fromEnd", "toEnd"] {
            if !e[key].is_null()
                && !e[key]
                    .as_str()
                    .is_some_and(|s| ["none", "arrow"].contains(&s))
            {
                return Err("Invalid connection end.".into());
            }
        }
    }
    if serde_json::to_vec(value)
        .map_err(|_| "Invalid canvas.")?
        .len()
        > 1_000_000
    {
        return Err("Canvas exceeds the file size limit.".into());
    }
    Ok(())
}
#[derive(Default)]
pub struct History {
    undo: Vec<Value>,
    redo: Vec<Value>,
    bytes: usize,
}
impl History {
    pub fn record(&mut self, old: &Value) {
        let size = old.to_string().len();
        while self.undo.len() >= 50 || self.bytes + size > 8_000_000 {
            if self.undo.is_empty() {
                break;
            }
            self.bytes = self
                .bytes
                .saturating_sub(self.undo.remove(0).to_string().len());
        }
        self.undo.push(old.clone());
        self.bytes += size;
        self.redo.clear();
    }
    pub fn undo(&mut self, current: &mut Value) {
        if let Some(v) = self.undo.pop() {
            self.bytes = self.bytes.saturating_sub(v.to_string().len());
            self.redo.push(current.clone());
            *current = v;
        }
    }
    pub fn redo(&mut self, current: &mut Value) {
        if let Some(v) = self.redo.pop() {
            self.bytes += current.to_string().len();
            self.undo.push(current.clone());
            *current = v;
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unknown_fields_paths_and_stale_edges() {
        for s in [
            r#"{"nodes":[{"id":"a","type":"file","file":"../secret","x":0,"y":0,"width":200,"height":100}]}"#,
            r#"{"nodes":[],"edges":[{"id":"e","fromNode":"missing","toNode":"missing"}]}"#,
            r#"{"nodes":[],"pluginCode":"x"}"#,
        ] {
            assert!(parse(s).is_err());
        }
        let v=parse(r#"{"nodes":[{"id":"a","type":"text","text":"hello","x":0,"y":0,"width":200,"height":100}],"edges":[]}"#).unwrap();
        let mut changed = v.clone();
        changed["nodes"][0]["text"] = json!("new");
        let mut h = History::default();
        h.record(&v);
        h.undo(&mut changed);
        assert_eq!(v, changed);
        h.redo(&mut changed);
        assert_eq!(changed["nodes"][0]["text"], "new");
    }
}
