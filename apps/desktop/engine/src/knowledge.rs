use crate::{
    reading,
    vault::{logical, Result},
};
use regex::Regex;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    sync::OnceLock,
};

pub fn strip_frontmatter(markdown: &str) -> (&str, usize) {
    let clean = markdown.trim_start_matches('\u{feff}');
    if !(clean.starts_with("---\n") || clean.starts_with("---\r\n")) {
        return (clean, 0);
    }
    let first_nl = match clean.find('\n') {
        Some(idx) => idx + 1,
        None => return (clean, 0),
    };
    let mut offset = first_nl;
    let mut lines = 1usize;
    for line in clean[first_nl..].split_inclusive('\n') {
        offset += line.len();
        lines += 1;
        if line.trim_end_matches(['\n', '\r']) == "---" {
            return (&clean[offset..], lines);
        }
    }
    (clean, 0)
}

pub fn title(path: &str, markdown: &str) -> String {
    let (body, _) = strip_frontmatter(markdown);
    body.lines()
        .find_map(|line| line.strip_prefix("# ").map(str::trim))
        .filter(|s| !s.is_empty())
        .map(mask_secrets)
        .unwrap_or_else(|| {
            path.rsplit('/')
                .next()
                .unwrap_or(path)
                .trim_end_matches(".md")
                .to_string()
        })
}

pub fn word_count(markdown: &str) -> usize {
    let masked = mask_secrets(markdown);
    let (body, _) = strip_frontmatter(&masked);
    body.split_whitespace().count()
}

pub fn extract_tags(markdown: &str) -> Vec<String> {
    static INLINE_TAG: OnceLock<Regex> = OnceLock::new();
    let tag_re = INLINE_TAG.get_or_init(|| {
        Regex::new(r"(?:^|[\s(\[{])#([a-zA-Z][\w/-]{0,63})\b").expect("static tag regex")
    });
    let masked = mask_secrets(markdown);
    let mut tags = BTreeSet::new();
    let clean = masked.trim_start_matches('\u{feff}');
    let (body, fm_lines) = strip_frontmatter(clean);
    if fm_lines > 0 {
        if let Ok(props) = crate::authoring::properties(clean) {
            if let Some(arr) = props["tags"].as_array() {
                for item in arr {
                    if let Some(t) = item.as_str() {
                        let norm = t.trim().trim_start_matches('#').to_lowercase();
                        if !norm.is_empty() {
                            tags.insert(norm);
                        }
                    }
                }
            } else if let Some(single) = props["tags"].as_str() {
                for part in single.split([',', ' ']) {
                    let norm = part.trim().trim_start_matches('#').to_lowercase();
                    if !norm.is_empty() {
                        tags.insert(norm);
                    }
                }
            }
        }
    }
    let mut fenced = false;
    for line in body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            continue;
        }
        for cap in tag_re.captures_iter(line) {
            tags.insert(cap[1].to_lowercase());
        }
    }
    tags.into_iter().collect()
}

pub fn extract_headings(markdown: &str) -> Vec<Value> {
    let (body, skipped_lines) = strip_frontmatter(markdown);
    let mut headings = Vec::new();
    let mut fenced = false;
    for (idx, line) in body.lines().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            continue;
        }
        let hashes = trimmed.bytes().take_while(|b| *b == b'#').count();
        if (1..=6).contains(&hashes) && trimmed.as_bytes().get(hashes) == Some(&b' ') {
            let text = mask_secrets(trimmed[hashes + 1..].trim());
            if !text.is_empty() {
                headings.push(json!({
                    "level": hashes,
                    "text": text,
                    "line": skipped_lines + idx + 1,
                }));
            }
        }
    }
    headings
}

pub fn targets(markdown: &str) -> Vec<String> {
    static WIKI: OnceLock<Regex> = OnceLock::new();
    let expression =
        WIKI.get_or_init(|| Regex::new(r"\[\[([^\]\n|#]+)(?:[^\]\n]*)\]\]").expect("static regex"));
    let (body, _) = strip_frontmatter(markdown);
    let mut output = vec![];
    let mut fenced = false;
    for line in body.lines() {
        if line.trim_start().starts_with("```") || line.trim_start().starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            continue;
        }
        for capture in expression.captures_iter(line) {
            output.push(capture[1].trim().trim_start_matches('/').to_string());
        }
    }
    output
}

pub fn graph(notes: &[Value]) -> Value {
    let mut names: BTreeMap<(String, String), Value> = BTreeMap::new();
    let mut ambiguous: HashSet<(String, String)> = HashSet::new();
    for note in notes {
        let space = note["spaceId"].as_str().unwrap_or("").to_string();
        let path = note["path"].as_str().unwrap_or("").to_lowercase();
        names.insert((space.clone(), path.clone()), note["id"].clone());
        let base = path
            .rsplit('/')
            .next()
            .unwrap_or(&path)
            .trim_end_matches(".md")
            .to_string();
        if names.contains_key(&(space.clone(), base.clone())) {
            ambiguous.insert((space.clone(), base.clone()));
        }
        names.insert((space, base), note["id"].clone());
    }
    let mut edges = vec![];
    let mut seen_edges = HashSet::new();
    let mut incoming = BTreeMap::<String, usize>::new();
    let mut outgoing = BTreeMap::<String, usize>::new();
    for note in notes {
        let space = note["spaceId"].as_str().unwrap_or("").to_string();
        let source_id = note["id"].as_str().unwrap_or("").to_string();
        for target in targets(note["markdown"].as_str().unwrap_or("")) {
            let target = target.to_lowercase();
            let path = if target.ends_with(".md") {
                target.clone()
            } else {
                format!("{}.md", target)
            };
            let resolved = names.get(&(space.clone(), path)).or_else(|| {
                if ambiguous.contains(&(space.clone(), target.clone())) {
                    None
                } else {
                    names.get(&(space.clone(), target))
                }
            });
            if let Some(id) = resolved {
                let target_id = id.as_str().unwrap_or("").to_string();
                if !target_id.is_empty()
                    && target_id != source_id
                    && seen_edges.insert((source_id.clone(), target_id.clone()))
                {
                    edges.push(json!({"source":note["id"],"target":id,"count":1}));
                    *outgoing.entry(source_id.clone()).or_default() += 1;
                    *incoming.entry(target_id).or_default() += 1;
                }
            }
        }
    }
    let nodes: Vec<Value> = notes
        .iter()
        .map(|n| {
            let id = n["id"].as_str().unwrap_or("");
            let md = n["markdown"].as_str().unwrap_or("");
            let inc = incoming.get(id).copied().unwrap_or(0);
            let out = outgoing.get(id).copied().unwrap_or(0);
            json!({
                "id": n["id"],
                "path": n["path"],
                "title": n["title"].as_str().map(str::to_string).unwrap_or_else(|| title(n["path"].as_str().unwrap_or(""), md)),
                "spaceId": n["spaceId"],
                "incoming": inc,
                "outgoing": out,
                "degree": inc + out,
                "tags": extract_tags(md),
                "wordCount": word_count(md),
            })
        })
        .collect();
    json!({"nodes": nodes, "edges": edges})
}

pub fn mask_secrets(source: &str) -> String {
    static SECRET: OnceLock<Regex> = OnceLock::new();
    SECRET
        .get_or_init(|| Regex::new(r"\{\{secret:[^}\n]+\}\}").expect("static regex"))
        .replace_all(source, "[secret reference]")
        .into_owned()
}

#[derive(Default)]
pub struct SearchQuery {
    pub terms: Vec<String>,
    pub tags: Vec<String>,
    pub excluded_tags: Vec<String>,
    pub paths: Vec<String>,
    pub files: Vec<String>,
}

pub fn parse_search_query(value: &str) -> Result<SearchQuery> {
    if value.len() > 256 {
        return Err("Search queries are limited to 256 characters.".into());
    }
    static TOKEN: OnceLock<Regex> = OnceLock::new();
    static FILTER: OnceLock<Regex> = OnceLock::new();
    let token_re =
        TOKEN.get_or_init(|| Regex::new(r#"(?i)(?:-?[a-z]+:)?"[^"]*"|\S+"#).expect("token regex"));
    let filter_re =
        FILTER.get_or_init(|| Regex::new(r"(?i)^(-?)([a-z]+):(.*)$").expect("filter regex"));
    let tokens: Vec<&str> = token_re.find_iter(value).map(|m| m.as_str()).collect();
    if tokens.len() > 16 {
        return Err("Use at most 16 search terms.".into());
    }
    let mut query = SearchQuery::default();
    let unquote = |text: &str| text.trim_matches('"').to_string();
    for token in tokens {
        if let Some(cap) = filter_re.captures(token) {
            let negative = &cap[1] == "-";
            let op = cap[2].to_lowercase();
            let term = unquote(&cap[3]);
            if term.is_empty() {
                return Err("Search filters need a value.".into());
            }
            match (op.as_str(), negative) {
                ("tag", false) => query.tags.push(term.trim_start_matches('#').to_lowercase()),
                ("tag", true) => query
                    .excluded_tags
                    .push(term.trim_start_matches('#').to_lowercase()),
                ("path", false) => query.paths.push(term.to_lowercase()),
                ("file", false) => query.files.push(term.to_lowercase()),
                _ => return Err(format!("Unsupported search filter: {}{}", &cap[1], op)),
            }
        } else {
            let term = unquote(token);
            if !term.is_empty() {
                query.terms.push(term.to_lowercase());
            }
        }
    }
    Ok(query)
}

fn safe_snippet(masked_text: &str, needle: Option<&str>) -> String {
    let collapsed: String = masked_text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if collapsed.is_empty() {
        return String::new();
    }
    let chars: Vec<char> = collapsed.chars().collect();
    let start_char = needle
        .and_then(|term| {
            let lower = collapsed.to_lowercase();
            let byte_idx = lower.find(&term.to_lowercase())?;
            Some(lower[..byte_idx].chars().count().saturating_sub(48))
        })
        .unwrap_or(0);
    let end_char = (start_char + 180).min(chars.len());
    let mut snippet: String = chars[start_char..end_char].iter().collect();
    if start_char > 0 {
        snippet.insert(0, '…');
    }
    if end_char < chars.len() {
        snippet.push('…');
    }
    snippet
}

pub fn search_local(
    notes: &[Value],
    raw_query: &str,
    space_id: Option<&str>,
    limit: usize,
) -> Result<Vec<Value>> {
    let query = parse_search_query(raw_query)?;
    let limit = limit.clamp(1, 100);
    let mut scored: Vec<(i32, String, Value)> = Vec::new();
    for note in notes {
        if let Some(space) = space_id.filter(|s| !s.is_empty()) {
            if note["spaceId"].as_str() != Some(space) {
                continue;
            }
        }
        let path = note["path"].as_str().unwrap_or("");
        let path_lower = path.to_lowercase();
        let file_lower = path.rsplit('/').next().unwrap_or(path).to_lowercase();
        let raw_md = note["markdown"].as_str().unwrap_or("");
        let masked_md = mask_secrets(raw_md);
        let (masked_body, _) = strip_frontmatter(&masked_md);
        let note_title = note["title"]
            .as_str()
            .map(mask_secrets)
            .unwrap_or_else(|| title(path, &masked_md));
        let title_lower = note_title.to_lowercase();
        let note_tags = extract_tags(&masked_md);

        if !query.tags.iter().all(|t| note_tags.contains(t)) {
            continue;
        }
        if query.excluded_tags.iter().any(|t| note_tags.contains(t)) {
            continue;
        }
        if !query.paths.iter().all(|p| path_lower.contains(p)) {
            continue;
        }
        if !query.files.iter().all(|f| file_lower.contains(f)) {
            continue;
        }
        let body_lower = masked_body.to_lowercase();
        let mut score = 0i32;
        let mut matched = true;
        for term in &query.terms {
            let in_title = title_lower.contains(term);
            let in_path = path_lower.contains(term);
            let in_body = body_lower.contains(term);
            if !(in_title || in_path || in_body) {
                matched = false;
                break;
            }
            if in_title {
                score += 10;
            }
            if in_path {
                score += 6;
            }
            if in_body {
                score += 2;
            }
        }
        if !matched {
            continue;
        }
        let snippet = safe_snippet(masked_body, query.terms.first().map(String::as_str));
        let updated = note["updatedAt"].as_str().unwrap_or("").to_string();
        scored.push((
            score,
            updated.clone(),
            json!({
                "id": note["id"],
                "spaceId": note["spaceId"],
                "path": path,
                "title": note_title,
                "tags": note_tags,
                "wordCount": word_count(&masked_md),
                "revision": note["revision"],
                "updatedAt": updated,
                "snippet": snippet,
            }),
        ));
    }
    scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    Ok(scored
        .into_iter()
        .take(limit)
        .map(|(_, _, item)| item)
        .collect())
}

fn wiki_spans(markdown: &str) -> Vec<(usize, usize, String)> {
    static WIKI_SPAN: OnceLock<Regex> = OnceLock::new();
    let re = WIKI_SPAN
        .get_or_init(|| Regex::new(r"\[\[([^\]\n|#]+)(?:[^\]\n]*)\]\]").expect("wiki span regex"));
    let clean = markdown.trim_start_matches('\u{feff}');
    let bom_len = markdown.len() - clean.len();
    let (body, _) = strip_frontmatter(clean);
    let body_offset = bom_len + (clean.len() - body.len());
    let mut spans = Vec::new();
    let mut fenced = false;
    let mut cursor = 0usize;
    for line in body.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            fenced = !fenced;
            cursor += line.len();
            continue;
        }
        if !fenced {
            for cap in re.captures_iter(line) {
                if let Some(m) = cap.get(1) {
                    spans.push((
                        body_offset + cursor + m.start(),
                        body_offset + cursor + m.end(),
                        m.as_str().trim().to_string(),
                    ));
                }
            }
        }
        cursor += line.len();
    }
    spans
}

pub fn note_context_local(
    notes: &[Value],
    note_id: &str,
    draft_override: Option<&str>,
) -> Result<Value> {
    let target_note = notes
        .iter()
        .find(|n| n["id"].as_str() == Some(note_id))
        .ok_or("Note not found.")?;
    let path = target_note["path"].as_str().unwrap_or("");
    let space = target_note["spaceId"].as_str().unwrap_or("");
    let markdown = draft_override
        .or_else(|| target_note["markdown"].as_str())
        .unwrap_or("");
    let masked = mask_secrets(markdown);
    let words = word_count(&masked);
    let chars = masked.chars().count();
    let reading_minutes = words.div_ceil(200);
    let headings = extract_headings(&masked);
    let tags = extract_tags(&masked);
    let note_title = title(path, &masked);
    let stem = path
        .rsplit('/')
        .next()
        .unwrap_or(path)
        .trim_end_matches(".md");

    let mut outgoing = Vec::new();
    let mut seen_out = HashSet::new();
    for raw_target in targets(markdown) {
        if !seen_out.insert(raw_target.to_lowercase()) {
            continue;
        }
        if let Some((resolved, _)) = reading::resolve(path, &raw_target, "wiki", space, notes) {
            outgoing.push(json!({
                "target": mask_secrets(&raw_target),
                "id": resolved["id"],
                "path": resolved["path"],
                "title": resolved["title"],
                "resolved": true,
            }));
        } else {
            outgoing.push(json!({
                "target": mask_secrets(&raw_target),
                "id": Value::Null,
                "path": Value::Null,
                "title": mask_secrets(&raw_target),
                "resolved": false,
            }));
        }
    }

    let mut backlinks = Vec::new();
    let mut backlink_ids = HashSet::new();
    for candidate in notes {
        let cand_id = candidate["id"].as_str().unwrap_or("");
        if cand_id == note_id || candidate["spaceId"].as_str() != Some(space) {
            continue;
        }
        let cand_path = candidate["path"].as_str().unwrap_or("");
        let cand_md = candidate["markdown"].as_str().unwrap_or("");
        let links_here = targets(cand_md).into_iter().any(|t| {
            reading::resolve(cand_path, &t, "wiki", space, notes)
                .is_some_and(|(res, _)| res["id"].as_str() == Some(note_id))
        });
        if links_here {
            backlink_ids.insert(cand_id.to_string());
            let masked_cand = mask_secrets(cand_md);
            let (cand_body, _) = strip_frontmatter(&masked_cand);
            backlinks.push(json!({
                "id": cand_id,
                "path": cand_path,
                "title": candidate["title"],
                "snippet": safe_snippet(cand_body, Some(stem)),
            }));
        }
    }

    let mut unlinked = Vec::new();
    let mention_term = if note_title.trim().len() >= 3 {
        Some(note_title.trim().to_string())
    } else if stem.trim().len() >= 3 {
        Some(stem.trim().to_string())
    } else {
        None
    };
    if let Some(needle) = mention_term {
        let needle_lower = needle.to_lowercase();
        for candidate in notes {
            if unlinked.len() >= 50 {
                break;
            }
            let cand_id = candidate["id"].as_str().unwrap_or("");
            if cand_id == note_id
                || backlink_ids.contains(cand_id)
                || candidate["spaceId"].as_str() != Some(space)
            {
                continue;
            }
            let cand_md = mask_secrets(candidate["markdown"].as_str().unwrap_or(""));
            let (cand_body, _) = strip_frontmatter(&cand_md);
            if cand_body.to_lowercase().contains(&needle_lower) {
                unlinked.push(json!({
                    "id": cand_id,
                    "path": candidate["path"],
                    "title": candidate["title"],
                    "snippet": safe_snippet(cand_body, Some(&needle)),
                }));
            }
        }
    }

    Ok(json!({
        "wordCount": words,
        "charCount": chars,
        "readingMinutes": reading_minutes,
        "headings": headings,
        "tags": tags,
        "outgoing": outgoing,
        "backlinks": backlinks,
        "unlinkedMentions": unlinked,
    }))
}

/// Plans Space-scoped inbound wikilink rewrites when moving/renaming a local note.
/// Returns `Vec<(id, path, updated_markdown, rewrite_count)>` for sibling notes that changed.
pub fn plan_local_move(
    notes: &[Value],
    note_id: &str,
    new_path: &str,
) -> Result<Vec<(String, String, String, usize)>> {
    let normalized = logical(new_path)?;
    if !normalized.to_lowercase().ends_with(".md") {
        return Err("Notes must end with .md.".into());
    }
    let source = notes
        .iter()
        .find(|n| n["id"].as_str() == Some(note_id))
        .ok_or("Note not found.")?;
    if notes.iter().any(|n| {
        n["id"].as_str() != Some(note_id)
            && n["path"]
                .as_str()
                .is_some_and(|p| p.eq_ignore_ascii_case(&normalized))
    }) {
        return Err("A note already exists at this path.".into());
    }
    let space = source["spaceId"].as_str().unwrap_or("");
    let after_notes: Vec<Value> = notes
        .iter()
        .map(|n| {
            if n["id"].as_str() == Some(note_id) {
                let mut moved = n.clone();
                moved["path"] = json!(normalized);
                moved
            } else {
                n.clone()
            }
        })
        .collect();
    let replacement = format!("/{}", normalized.trim_end_matches(".md"));
    let mut updates = Vec::new();
    for candidate in notes {
        let cand_id = candidate["id"].as_str().unwrap_or("");
        if cand_id == note_id || candidate["spaceId"].as_str() != Some(space) {
            continue;
        }
        let cand_path = candidate["path"].as_str().unwrap_or("");
        let cand_md = candidate["markdown"].as_str().unwrap_or("");
        let mut edits = Vec::new();
        for (start, end, raw_target) in wiki_spans(cand_md) {
            let before_target = reading::resolve(cand_path, &raw_target, "wiki", space, notes)
                .and_then(|(n, _)| n["id"].as_str());
            let after_target =
                reading::resolve(cand_path, &raw_target, "wiki", space, &after_notes)
                    .and_then(|(n, _)| n["id"].as_str());
            if before_target == Some(note_id) && after_target != Some(note_id) {
                edits.push((start, end, replacement.clone()));
            } else if let Some(other_id) = before_target {
                if after_target != Some(other_id) {
                    if let Some(other_note) =
                        notes.iter().find(|n| n["id"].as_str() == Some(other_id))
                    {
                        let explicit = format!(
                            "/{}",
                            other_note["path"]
                                .as_str()
                                .unwrap_or("")
                                .trim_end_matches(".md")
                        );
                        edits.push((start, end, explicit));
                    }
                }
            }
        }
        if !edits.is_empty() {
            let mut updated = cand_md.to_string();
            for (start, end, value) in edits.iter().rev() {
                updated.replace_range(*start..*end, value);
            }
            updates.push((
                cand_id.to_string(),
                cand_path.to_string(),
                updated,
                edits.len(),
            ));
        }
    }
    if updates.len() > 98 {
        return Err("Local coordinated moves can update up to 98 linking notes at once.".into());
    }
    Ok(updates)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn graph_uses_real_notes_and_ignores_fenced_examples() {
        let result = graph(&[
            json!({"id":"a","path":"A.md","title":"A","markdown":"[[B]]\n```\n[[C]]\n```"}),
            json!({"id":"b","path":"B.md","title":"B","markdown":""}),
        ]);
        assert_eq!(result["edges"].as_array().unwrap().len(), 1);
        assert_eq!(mask_secrets("{{secret:deploy}}"), "[secret reference]");
    }

    #[test]
    fn search_context_and_move_preserve_space_boundaries_and_mask_secrets() {
        let notes = vec![
            json!({
                "id": "n1",
                "spaceId": "code",
                "path": "Projects/Architecture.md",
                "title": "Architecture",
                "revision": 1,
                "updatedAt": "2026-10-31T10:00:00Z",
                "markdown": "---\ntags:\n  - design\n---\n# Architecture\n\nToken {{secret:prod_api}} and [[Roadmap|Q4 Plan]].\n## Storage\nDetails #rust",
            }),
            json!({
                "id": "n2",
                "spaceId": "code",
                "path": "Roadmap.md",
                "title": "Roadmap",
                "revision": 1,
                "updatedAt": "2026-10-31T11:00:00Z",
                "markdown": "# Roadmap\n\nSee Architecture notes before launch.",
            }),
            json!({
                "id": "n3",
                "spaceId": "personal",
                "path": "Private.md",
                "title": "Private",
                "revision": 1,
                "updatedAt": "2026-10-31T12:00:00Z",
                "markdown": "# Private\n\n[[Roadmap]] and Architecture mention in personal space.",
            }),
        ];

        // Secret names must never match search or appear in snippets.
        let leak = search_local(&notes, "prod_api", None, 20).unwrap();
        assert!(leak.is_empty());

        let tagged = search_local(&notes, "tag:design tag:rust Storage", Some("code"), 20).unwrap();
        assert_eq!(tagged.len(), 1);
        assert_eq!(tagged[0]["id"], "n1");
        assert!(!tagged[0]["snippet"].as_str().unwrap().contains("prod_api"));

        // Context for Roadmap (`n2`) includes backlink from `n1` (`code`), NOT `n3` (`personal`)!
        let ctx = note_context_local(&notes, "n2", None).unwrap();
        assert_eq!(ctx["backlinks"].as_array().unwrap().len(), 1);
        assert_eq!(ctx["backlinks"][0]["id"], "n1");

        // Context for Architecture (`n1`) finds unlinked mention in `n2`, NOT `n3`, and extracts headings!
        let ctx1 = note_context_local(&notes, "n1", None).unwrap();
        assert_eq!(ctx1["headings"].as_array().unwrap().len(), 2);
        assert_eq!(ctx1["headings"][1]["text"], "Storage");
        assert_eq!(ctx1["headings"][1]["line"], 8);
        assert_eq!(ctx1["unlinkedMentions"].as_array().unwrap().len(), 1);
        assert_eq!(ctx1["unlinkedMentions"][0]["id"], "n2");

        // Moving `Roadmap.md` to `Plans/2027-Roadmap.md` rewrites `[[Roadmap|Q4 Plan]]` in `n1`, NOT `n3`!
        let rewrites = plan_local_move(&notes, "n2", "Plans/2027-Roadmap.md").unwrap();
        assert_eq!(rewrites.len(), 1);
        assert_eq!(rewrites[0].0, "n1");
        assert!(rewrites[0].2.contains("[[/Plans/2027-Roadmap|Q4 Plan]]"));
    }
}
