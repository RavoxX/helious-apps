//! Offline authoring. All mutations return drafts; normal guarded saves own persistence.
use crate::vault::{logical, Result};
use chrono::{DateTime, Datelike, FixedOffset, NaiveDate, Timelike};
use serde_json::{json, Value};
use std::str::FromStr;
use yaml_edit::{Document, YamlFile};
pub const NOTE_LIMIT: usize = 1_000_000;
pub fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

pub fn daily_path(day: &str) -> Result<String> {
    let date =
        NaiveDate::parse_from_str(day, "%Y-%m-%d").map_err(|_| "Choose a valid calendar date.")?;
    if day.len() != 10 || date.format("%Y-%m-%d").to_string() != day || date.year() < 1 {
        return Err("Choose a valid calendar date.".into());
    }
    Ok(format!("Daily/{day}.md"))
}
pub fn note_path(path: &str) -> Result<String> {
    let path = if path.to_lowercase().ends_with(".md") {
        path.to_string()
    } else {
        format!("{path}.md")
    };
    logical(&path)
}
pub fn expand(
    source: &str,
    title: &str,
    day: &str,
    clock: &DateTime<FixedOffset>,
) -> Result<String> {
    daily_path(day)?;
    if source.len() > NOTE_LIMIT || title.len() > 1024 {
        return Err("Template or title exceeds the size limit.".into());
    }
    let time = format!("{:02}:{:02}", clock.hour(), clock.minute());
    let datetime = clock
        .with_timezone(&chrono::Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let expression = regex::Regex::new(r"\{\{(title|date|time|datetime|cursor)\}\}")
        .expect("template expression");
    let result = expression
        .replace_all(source, |c: &regex::Captures<'_>| match &c[1] {
            "title" => title,
            "date" => day,
            "time" => &time,
            "datetime" => &datetime,
            _ => "",
        })
        .into_owned();
    if result.len() > NOTE_LIMIT {
        return Err("Expanded template exceeds the note size limit.".into());
    }
    Ok(result)
}
fn front(source: &str) -> Result<(&str, &str, &str)> {
    if source.len() > NOTE_LIMIT {
        return Err("Note exceeds the size limit.".into());
    }
    let source = source.strip_prefix('\u{feff}').unwrap_or(source);
    if !source.starts_with("---\n") && !source.starts_with("---\r\n") {
        return Ok(("", source, "\n"));
    }
    let newline = if source.starts_with("---\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let start = 3 + newline.len();
    let mut offset = start;
    for line in source[start..].split_inclusive('\n') {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            let yaml = &source[start..offset];
            if yaml.len() > 65_536 {
                return Err("Properties exceed the 64 KiB limit.".into());
            }
            return Ok((yaml, &source[offset + line.len()..], newline));
        }
        offset += line.len();
    }
    Err("Fix the unclosed frontmatter in Source mode first.".into())
}
fn validate(value: &Value, depth: usize) -> Result<()> {
    if depth > 16 {
        return Err("Properties are nested too deeply.".into());
    }
    if let Some(map) = value.as_object() {
        if map.len() > 1000 {
            return Err("Too many properties.".into());
        }
        for (key, child) in map {
            if ["__proto__", "constructor", "prototype"].contains(&key.as_str())
                || key.len() > 100
                || key.trim().is_empty()
            {
                return Err("Invalid property name.".into());
            }
            validate(child, depth + 1)?;
        }
    } else if let Some(items) = value.as_array() {
        if items.len() > 1000 {
            return Err("Property collection is too large.".into());
        }
        for child in items {
            validate(child, depth + 1)?;
        }
    }
    Ok(())
}
pub fn properties(source: &str) -> Result<Value> {
    let (yaml, _, _) = front(source)?;
    if regex::Regex::new(r"(?m)(?:^|[\s:])(?:[&*][\w-]+|![^\s]+)")
        .expect("yaml features")
        .is_match(yaml)
    {
        return Err("Edit YAML anchors, aliases and tags in Source mode.".into());
    }
    let mut values: Value = if yaml.trim().is_empty() {
        json!({})
    } else {
        let parsed: serde_yaml_ng::Value = serde_yaml_ng::from_str(yaml)
            .map_err(|_| "Fix unsupported or invalid properties in Source mode first.")?;
        serde_json::to_value(parsed)
            .map_err(|_| "Use JSON-compatible property values and string keys.")?
    };
    if values.is_null() {
        values = json!({});
    }
    if !values.is_object() {
        return Err("Properties must be a YAML mapping.".into());
    }
    validate(&values, 0)?;
    Ok(values)
}
pub fn replace_properties(source: &str, values: &Value) -> Result<String> {
    let old = properties(source)?;
    if !values.is_object() {
        return Err("Properties must be an object.".into());
    }
    validate(values, 0)?;
    if old == *values {
        return Ok(source.to_string());
    }
    let (yaml, body, newline) = front(source)?;
    let seed = if yaml
        .lines()
        .all(|line| line.trim().is_empty() || line.trim_start().starts_with('#'))
    {
        format!("{yaml}{{}}\n")
    } else {
        yaml.to_string()
    };
    let file =
        YamlFile::from_str(&seed).map_err(|_| "Cannot edit this frontmatter. Use Source mode.")?;
    let doc = file
        .document()
        .ok_or("Cannot read the property document.")?;
    for name in old.as_object().expect("mapping").keys() {
        if values.get(name).is_none() {
            doc.remove(name.as_str());
        }
    }
    for (name, value) in values.as_object().expect("mapping") {
        if old.get(name) != Some(value) {
            let child = Document::from_str(&json!({"value":value}).to_string())
                .map_err(|_| "Cannot encode property.")?;
            if !doc.set(
                name.as_str(),
                child.get("value").ok_or("Cannot encode property value.")?,
            ) {
                return Err("Cannot update property.".into());
            }
        }
    }
    let yaml = file
        .to_string()
        .replace("\r\n", "\n")
        .replace('\n', newline);
    if yaml.len() > 65_536 {
        return Err("Properties exceed the 64 KiB limit.".into());
    }
    let bom = if source.starts_with('\u{feff}') {
        "\u{feff}"
    } else {
        ""
    };
    let result = format!(
        "{bom}---{newline}{}{newline}---{newline}{body}",
        yaml.trim_end_matches(['\r', '\n'])
    );
    if result.len() > NOTE_LIMIT {
        return Err("Note exceeds the size limit.".into());
    }
    // Refuse a lossless-editor result that does not mean precisely what the caller requested.
    if properties(&result)? != *values {
        return Err("Could not preserve properties safely. Edit in Source mode.".into());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn calendar_and_literal_variables() {
        assert!(daily_path("2025-02-29").is_err());
        assert!(daily_path("2026-2-03").is_err());
        assert_eq!(daily_path("2024-02-29").unwrap(), "Daily/2024-02-29.md");
        let clock = DateTime::parse_from_rfc3339("2026-10-30T19:04:02+01:00").unwrap();
        assert_eq!(
            expand(
                "{{title}} {{date}} {{time}} {{datetime}} {{cursor}} {{secret:key}} {{unknown}}",
                "$name",
                "2026-10-30",
                &clock
            )
            .unwrap(),
            "$name 2026-10-30 19:04 2026-10-30T18:04:02.000Z  {{secret:key}} {{unknown}}"
        );
    }
    #[test]
    fn typed_properties_preserve_body_comments_and_unchanged_source() {
        let source = "---\n# Keep this comment\nstatus: draft # workflow\nother: keep # unchanged\n---\n# Body\n{{secret:key}}";
        let old = properties(source).unwrap();
        assert_eq!(replace_properties(source, &old).unwrap(), source);
        let changed = replace_properties(source, &json!({"status":"done","other":"keep","count":4,"approved":true,"tags":["a","b"],"object":{"x":null}})).unwrap();
        assert!(changed.contains("# Keep this comment"));
        assert!(changed.contains("other: keep # unchanged"));
        assert!(changed.ends_with("# Body\n{{secret:key}}"));
        assert!(properties("---\nx: &x [1]\ny: *x\n---\nBody").is_err());
        assert!(properties("---\nx: 1\nx: 2\n---\nBody").is_err());
    }
}
