use regex::Regex;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashSet},
    sync::OnceLock,
};
pub fn title(path: &str, markdown: &str) -> String {
    markdown
        .lines()
        .find_map(|line| line.strip_prefix("# ").map(str::trim))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            path.rsplit('/')
                .next()
                .unwrap_or(path)
                .trim_end_matches(".md")
        })
        .to_string()
}
pub fn targets(markdown: &str) -> Vec<String> {
    static WIKI: OnceLock<Regex> = OnceLock::new();
    let expression =
        WIKI.get_or_init(|| Regex::new(r"\[\[([^\]\n|#]+)(?:[^\]\n]*)\]\]").expect("static regex"));
    let mut output = vec![];
    let mut fenced = false;
    for line in markdown.lines() {
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
    let mut names = BTreeMap::new();
    let mut ambiguous = HashSet::new();
    for note in notes {
        let path = note["path"].as_str().unwrap_or("").to_lowercase();
        names.insert(path.clone(), note["id"].clone());
        let base = path
            .rsplit('/')
            .next()
            .unwrap_or(&path)
            .trim_end_matches(".md")
            .to_string();
        if names.contains_key(&base) {
            ambiguous.insert(base.clone());
        }
        names.insert(base, note["id"].clone());
    }
    let mut edges = vec![];
    let mut degrees = BTreeMap::<String, usize>::new();
    for note in notes {
        for target in targets(note["markdown"].as_str().unwrap_or("")) {
            let target = target.to_lowercase();
            let path = if target.ends_with(".md") {
                target.clone()
            } else {
                format!("{}.md", target)
            };
            let resolved = names.get(&path).or_else(|| {
                if ambiguous.contains(&target) {
                    None
                } else {
                    names.get(&target)
                }
            });
            if let Some(id) = resolved {
                if *id != note["id"] {
                    edges.push(json!({"source":note["id"],"target":id}));
                    for node in [&note["id"], id] {
                        *degrees
                            .entry(node.as_str().unwrap_or("").into())
                            .or_default() += 1;
                    }
                }
            }
        }
    }
    json!({"nodes":notes.iter().map(|n|json!({"id":n["id"],"path":n["path"],"title":n["title"],"spaceId":n["spaceId"],"degree":degrees.get(n["id"].as_str().unwrap_or("")).copied().unwrap_or(0)})).collect::<Vec<_>>(),"edges":edges})
}
pub fn mask_secrets(source: &str) -> String {
    static SECRET: OnceLock<Regex> = OnceLock::new();
    SECRET
        .get_or_init(|| Regex::new(r"\{\{secret:[^}\n]+\}\}").expect("static regex"))
        .replace_all(source, "[secret reference]")
        .into_owned()
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
}
