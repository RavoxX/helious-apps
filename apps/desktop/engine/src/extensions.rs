pub const EXAMPLE: &str = include_str!("../../../../packages/core/examples/meeting-tools.json");
// Capability-limited, declarative extension API v1. There is no executable-code loader.
use crate::{authoring, vault::Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub api: u8,
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub permissions: Vec<String>,
    pub commands: Vec<Command>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Command {
    pub id: String,
    pub name: String,
    pub steps: Vec<Step>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "op", deny_unknown_fields)]
pub enum Step {
    #[serde(rename = "append")]
    Append { text: String },
    #[serde(rename = "prepend")]
    Prepend { text: String },
    #[serde(rename = "replace")]
    Replace { find: String, text: String },
    #[serde(rename = "setProperty")]
    SetProperty { key: String, value: Value },
    #[serde(rename = "countWords")]
    CountWords,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Installed {
    pub manifest: Manifest,
    pub enabled: bool,
    pub granted: Vec<String>,
}
pub fn validate(value: Value) -> Result<Manifest> {
    if value.to_string().len() > 65536 {
        return Err("Extension manifests are limited to 64 KiB.".into());
    }
    let manifest: Manifest = serde_json::from_value(value).map_err(|_| {
        "Unsupported extension fields or operations. Executable code is not supported."
    })?;
    let identifier = regex::Regex::new(r"^[a-z][a-z0-9-]{0,63}$").unwrap();
    if manifest.api != 1
        || !identifier.is_match(&manifest.id)
        || manifest.name.trim().is_empty()
        || manifest.name.len() > 80
        || manifest.version.len() > 40
        || !regex::Regex::new(r"^\d+\.\d+\.\d+(?:-[\w.-]+)?$")
            .unwrap()
            .is_match(&manifest.version)
        || manifest
            .description
            .as_ref()
            .is_some_and(|v| v.len() > 2000)
    {
        return Err("Use a valid API 1 extension identity, name and version.".into());
    }
    if !manifest.permissions.iter().any(|p| p == "editor:read")
        || manifest.permissions.len() > 2
        || manifest
            .permissions
            .iter()
            .any(|p| !["editor:read", "editor:write"].contains(&p.as_str()))
        || manifest
            .permissions
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != manifest.permissions.len()
    {
        return Err("Only explicit editor:read and editor:write permissions are supported.".into());
    }
    if manifest.commands.is_empty() || manifest.commands.len() > 20 {
        return Err("An extension needs 1–20 commands.".into());
    }
    let mut ids = std::collections::HashSet::new();
    for command in &manifest.commands {
        if !identifier.is_match(&command.id)
            || !ids.insert(&command.id)
            || command.name.trim().is_empty()
            || command.name.len() > 80
            || command.steps.is_empty()
            || command.steps.len() > 20
        {
            return Err("Use unique command IDs, labelled commands and 1–20 steps.".into());
        }
        for step in &command.steps {
            if !matches!(step, Step::CountWords)
                && !manifest.permissions.iter().any(|p| p == "editor:write")
            {
                return Err("Editing commands must declare editor:write.".into());
            }
            match step {
                Step::Append { text } | Step::Prepend { text } | Step::Replace { text, .. }
                    if text.len() > 20000 =>
                {
                    return Err("Step text is too large.".into())
                }
                Step::Replace { find, .. } if find.is_empty() || find.len() > 1000 => {
                    return Err("Use a nonempty literal replacement of at most 1,000 bytes.".into())
                }
                Step::SetProperty { key, value } => {
                    authoring::replace_properties("", &json!({(key):value}))?;
                }
                _ => {}
            }
        }
    }
    Ok(manifest)
}
pub fn run(
    manifest: &Manifest,
    command: &str,
    granted: &[String],
    source: &str,
    path: &str,
    clock: &chrono::DateTime<chrono::FixedOffset>,
) -> Result<Value> {
    let manifest = validate(serde_json::to_value(manifest).map_err(|_| "Invalid extension.")?)?;
    if manifest.permissions.iter().any(|p| !granted.contains(p)) {
        return Err("Grant the extension's declared permissions before running it.".into());
    }
    if source.len() > authoring::NOTE_LIMIT {
        return Err("Draft exceeds the extension size limit.".into());
    }
    let command = manifest
        .commands
        .iter()
        .find(|c| c.id == command)
        .ok_or("Extension command not found.")?;
    let title = path
        .rsplit('/')
        .next()
        .unwrap_or(path)
        .trim_end_matches(".md");
    let day = clock.format("%Y-%m-%d").to_string();
    let expand = |s: &str| authoring::expand(s, title, &day, clock);
    let mut source = source.to_string();
    let mut message =
        "Review the proposal, then apply it to your draft. Save explicitly to keep it.".to_string();
    for step in &command.steps {
        match step {
            Step::Append { text } => source += &expand(text)?,
            Step::Prepend { text } => source = format!("{}{}", expand(text)?, source),
            Step::Replace { find, text } => {
                if source.matches(find).count() > 1000 {
                    return Err("Replacement exceeds the 1,000-match limit.".into());
                }
                source = source.replace(find, &expand(text)?);
            }
            Step::SetProperty { key, value } => {
                let mut values = authoring::properties(&source)?;
                values[key] = value.clone();
                source = authoring::replace_properties(&source, &values)?;
            }
            Step::CountWords => message = format!("Words: {}", source.split_whitespace().count()),
        }
        if source.len() > authoring::NOTE_LIMIT {
            return Err("Extension output exceeds the draft size limit.".into());
        }
    }
    Ok(json!({"markdown":source,"message":message}))
}
pub fn run_now(
    manifest: &Manifest,
    command: &str,
    granted: &[String],
    source: &str,
    path: &str,
) -> Result<Value> {
    run(
        manifest,
        command,
        granted,
        source,
        path,
        &chrono::Local::now().fixed_offset(),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extensions_are_bounded_declarative_and_require_grants() {
        let value = json!({"api":1,"id":"meeting","name":"Meeting","version":"1.0.0","permissions":["editor:read","editor:write"],"commands":[{"id":"stamp","name":"Stamp","steps":[{"op":"append","text":"\n{{date}} {{secret:key}}"}]}]});
        let m = validate(value.clone()).unwrap();
        let clock = chrono::DateTime::parse_from_rfc3339("2026-10-31T12:00:00Z").unwrap();
        assert!(run(&m, "stamp", &[], "# Note", "Note.md", &clock).is_err());
        assert_eq!(
            run(&m, "stamp", &m.permissions, "# Note", "Note.md", &clock).unwrap()["markdown"],
            "# Note\n2026-10-31 {{secret:key}}"
        );
        let mut evil = value;
        evil["script"] = json!("fetch('https://example.com')");
        assert!(validate(evil).is_err());
    }
}
