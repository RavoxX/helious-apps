//! Native Markdown AST and passive renderers. No HTML, browser, scripts or remote resources.
use crate::{knowledge::mask_secrets, vault::Result};
use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{Arc, OnceLock};
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Span {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
    pub code: bool,
    pub strike: bool,
    pub target: String,
    pub syntax: String,
    pub math: bool,
    pub color: String,
}
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Block {
    pub kind: String,
    pub text: String,
    pub spans: Vec<Span>,
    pub children: Vec<Block>,
    pub target: String,
    pub syntax: String,
    pub language: String,
    pub level: u32,
    pub title: String,
    pub collapse: String,
}
fn block(kind: &str) -> Block {
    Block {
        kind: kind.into(),
        ..Default::default()
    }
}
pub fn document(source: &str) -> Result<Vec<Block>> {
    if source.len() > 250_000 {
        return Err(
            "Reading previews are limited to 250,000 bytes. Use Source for this note.".into(),
        );
    }
    let source = mask_secrets(source);
    let source = source.trim_start_matches('\u{feff}');
    let source = if source.starts_with("---\n") || source.starts_with("---\r\n") {
        let start = source.find('\n').unwrap() + 1;
        let mut offset = start;
        let mut body = source;
        for line in source[start..].split_inclusive('\n') {
            offset += line.len();
            if line.trim_end_matches(['\n', '\r']) == "---" {
                body = &source[offset..];
                break;
            }
        }
        body
    } else {
        source
    };
    let mut options = Options::empty();
    options.insert(
        Options::ENABLE_TABLES
            | Options::ENABLE_FOOTNOTES
            | Options::ENABLE_TASKLISTS
            | Options::ENABLE_STRIKETHROUGH
            | Options::ENABLE_MATH,
    );
    let mut stack = vec![block("root")];
    let mut bold = 0u32;
    let mut italic = 0u32;
    let mut strike = 0u32;
    let mut links: Vec<String> = vec![];
    let mut image: Option<Block> = None;
    let mut count = 0;
    let mut formulas = 0;
    let mut math_bytes = 0;
    let mut embeds = 0;
    let wiki = regex::Regex::new(r"(!?)\[\[([^\]\n]+)\]\]").expect("wiki expression");
    let callout_marker =
        regex::Regex::new(r"^\[!(\w+)\]([+-])?[\t ]*([^\n]*)").expect("callout marker");
    for (event, range) in pulldown_cmark::TextMergeWithOffset::new(
        Parser::new_ext(source, options).into_offset_iter(),
    ) {
        count += 1;
        if count > 25000 || stack.len() > 40 {
            return Err("This preview is too complex. Use Source mode.".into());
        }
        match event {
            Event::Start(Tag::Strong) => bold += 1,
            Event::End(TagEnd::Strong) => bold = bold.saturating_sub(1),
            Event::Start(Tag::Emphasis) => italic += 1,
            Event::End(TagEnd::Emphasis) => italic = italic.saturating_sub(1),
            Event::Start(Tag::Strikethrough) => strike += 1,
            Event::End(TagEnd::Strikethrough) => strike = strike.saturating_sub(1),
            Event::Start(Tag::Link { dest_url, .. }) => links.push(dest_url.to_string()),
            Event::End(TagEnd::Link) => {
                links.pop();
            }
            Event::Start(Tag::Image { dest_url, .. }) => {
                let mut b = block("embed");
                b.target = dest_url.to_string();
                b.syntax = "markdown".into();
                image = Some(b);
            }
            Event::End(TagEnd::Image) => {
                if let Some(b) = image.take() {
                    embeds += 1;
                    if embeds <= 12 {
                        stack.last_mut().unwrap().children.push(b);
                    }
                }
            }
            Event::Start(tag) => {
                let b = match tag {
                    Tag::Paragraph => Some(block("paragraph")),
                    Tag::Heading { level, .. } => {
                        let mut b = block("heading");
                        b.level = level as u32;
                        Some(b)
                    }
                    Tag::CodeBlock(kind) => {
                        let mut b = block("code");
                        if let CodeBlockKind::Fenced(lang) = kind {
                            b.language = lang.split_whitespace().next().unwrap_or("").into();
                        }
                        Some(b)
                    }
                    Tag::BlockQuote(_) => Some(block("quote")),
                    Tag::List(start) => {
                        let mut b = block("list");
                        b.level = start.unwrap_or(0) as u32;
                        Some(b)
                    }
                    Tag::Item => Some(block("item")),
                    Tag::Table(_) => Some(block("table")),
                    Tag::TableHead | Tag::TableRow => Some(block("row")),
                    Tag::TableCell => Some(block("cell")),
                    Tag::FootnoteDefinition(label) => {
                        let mut b = block("footnote");
                        b.title = label.to_string();
                        Some(b)
                    }
                    Tag::HtmlBlock => Some(block("ignored")),
                    _ => None,
                };
                if let Some(b) = b {
                    stack.push(b);
                }
            }
            Event::End(end) => {
                if matches!(
                    end,
                    TagEnd::Paragraph
                        | TagEnd::Heading(_)
                        | TagEnd::CodeBlock
                        | TagEnd::BlockQuote(_)
                        | TagEnd::List(_)
                        | TagEnd::Item
                        | TagEnd::Table
                        | TagEnd::TableHead
                        | TagEnd::TableRow
                        | TagEnd::TableCell
                        | TagEnd::FootnoteDefinition
                        | TagEnd::HtmlBlock
                ) && stack.len() > 1
                {
                    let mut b = stack.pop().unwrap();
                    if b.kind == "code" {
                        if b.language == "mermaid" {
                            b.kind = "diagram".into();
                        } else {
                            b.spans = highlight(&b.text, &b.language, false);
                        }
                    }
                    if b.kind == "quote" {
                        if let Some(first) = b.children.first_mut() {
                            let text = first
                                .spans
                                .iter()
                                .map(|s| s.text.as_str())
                                .collect::<String>();
                            let marker = &callout_marker;
                            if let Some(c) = marker.captures(&text) {
                                let kind = c[1].to_lowercase();
                                if [
                                    "note", "info", "tip", "warning", "danger", "success",
                                    "question", "example", "quote", "bug",
                                ]
                                .contains(&kind.as_str())
                                {
                                    b.kind = "callout".into();
                                    b.language = kind.clone();
                                    b.title = if c[3].trim().is_empty() {
                                        kind
                                    } else {
                                        c[3].trim().into()
                                    };
                                    b.collapse = match c.get(2).map(|m| m.as_str()) {
                                        Some("-") => "closed",
                                        Some("+") => "open",
                                        _ => "",
                                    }
                                    .into();
                                    let mut skip = c.get(0).unwrap().end();
                                    while text[skip..].starts_with('\n') {
                                        skip += 1;
                                    }
                                    first.spans = first
                                        .spans
                                        .drain(..)
                                        .filter_map(|mut span| {
                                            if skip >= span.text.len() {
                                                skip -= span.text.len();
                                                None
                                            } else {
                                                span.text = span.text[skip..].to_string();
                                                skip = 0;
                                                Some(span)
                                            }
                                        })
                                        .collect();
                                }
                            }
                        }
                    }
                    if b.kind != "ignored" {
                        stack.last_mut().unwrap().children.push(b);
                    }
                }
            }
            Event::Text(value) => {
                if let Some(image) = image.as_mut() {
                    image.title.push_str(&value);
                    continue;
                }
                let current = stack.last_mut().unwrap();
                if current.kind == "code" {
                    current.text.push_str(&value);
                    continue;
                }
                if current.kind == "ignored" {
                    continue;
                }
                let base = Span {
                    bold: bold > 0,
                    italic: italic > 0,
                    strike: strike > 0,
                    target: links.last().cloned().unwrap_or_default(),
                    syntax: "markdown".into(),
                    ..Default::default()
                };
                let mut end = 0;
                let raw = &source[range];
                let mut raw_cursor = 0;
                for capture in wiki.captures_iter(&value) {
                    let whole = capture.get(0).unwrap();
                    let Some(raw_index) = raw[raw_cursor..]
                        .find(whole.as_str())
                        .map(|i| i + raw_cursor)
                    else {
                        continue;
                    };
                    raw_cursor = raw_index + whole.as_str().len();
                    if raw[..raw_index]
                        .chars()
                        .rev()
                        .take_while(|c| *c == '\\')
                        .count()
                        % 2
                        != 0
                    {
                        continue;
                    }
                    if whole.start() > end {
                        current.spans.push(Span {
                            text: value[end..whole.start()].into(),
                            ..base.clone()
                        });
                    }
                    let (target, title) = capture[2]
                        .split_once('|')
                        .unwrap_or((&capture[2], &capture[2]));
                    if &capture[1] == "!" {
                        embeds += 1;
                        if embeds <= 12 {
                            let mut b = block("embed");
                            b.target = target.trim().into();
                            b.title = title.trim().into();
                            b.syntax = "wiki".into();
                            current.children.push(b);
                        }
                    } else {
                        current.spans.push(Span {
                            text: title.trim().into(),
                            target: target.trim().into(),
                            syntax: "wiki".into(),
                            ..base.clone()
                        });
                    }
                    end = whole.end();
                }
                if end < value.len() {
                    current.spans.push(Span {
                        text: value[end..].into(),
                        ..base
                    });
                }
            }
            Event::Code(value) => stack.last_mut().unwrap().spans.push(Span {
                text: value.into_string(),
                code: true,
                ..Default::default()
            }),
            Event::InlineMath(value) => {
                formulas += 1;
                math_bytes += value.len();
                stack.last_mut().unwrap().spans.push(Span {
                    text: value.into_string(),
                    math: formulas <= 80 && math_bytes <= 20000,
                    ..Default::default()
                });
            }
            Event::DisplayMath(value) => {
                formulas += 1;
                math_bytes += value.len();
                let mut b = block(if formulas <= 80 && math_bytes <= 20000 {
                    "math"
                } else {
                    "code"
                });
                b.text = value.into_string();
                stack.last_mut().unwrap().children.push(b);
            }
            Event::SoftBreak | Event::HardBreak => stack.last_mut().unwrap().spans.push(Span {
                text: "\n".into(),
                ..Default::default()
            }),
            Event::TaskListMarker(done) => stack.last_mut().unwrap().spans.push(Span {
                text: if done { "☑ " } else { "☐ " }.into(),
                ..Default::default()
            }),
            Event::FootnoteReference(label) => stack.last_mut().unwrap().spans.push(Span {
                text: format!("[{label}]"),
                ..Default::default()
            }),
            Event::Rule => stack.last_mut().unwrap().children.push(block("rule")),
            _ => {}
        }
    }
    Ok(stack.remove(0).children)
}
pub fn highlight(source: &str, language: &str, dark: bool) -> Vec<Span> {
    if source.len() > 20000 {
        return vec![Span {
            text: source.into(),
            ..Default::default()
        }];
    }
    use syntect::{easy::HighlightLines, highlighting::ThemeSet, parsing::SyntaxSet};
    static SYNTAX: OnceLock<SyntaxSet> = OnceLock::new();
    static THEMES: OnceLock<ThemeSet> = OnceLock::new();
    let syntaxes = SYNTAX.get_or_init(SyntaxSet::load_defaults_newlines);
    let themes = THEMES.get_or_init(ThemeSet::load_defaults);
    let syntax = syntaxes
        .find_syntax_by_token(language)
        .unwrap_or_else(|| syntaxes.find_syntax_plain_text());
    let mut highlighter = HighlightLines::new(
        syntax,
        &themes.themes[if dark {
            "base16-ocean.dark"
        } else {
            "InspiredGitHub"
        }],
    );
    let mut spans = vec![];
    for line in source.split_inclusive('\n') {
        match highlighter.highlight_line(line, syntaxes) {
            Ok(tokens) => {
                for (style, text) in tokens {
                    spans.push(Span {
                        text: text.into(),
                        color: format!(
                            "#{:02x}{:02x}{:02x}",
                            style.foreground.r, style.foreground.g, style.foreground.b
                        ),
                        ..Default::default()
                    });
                }
            }
            Err(_) => spans.push(Span {
                text: line.into(),
                ..Default::default()
            }),
        }
    }
    spans
}
fn raster(svg: &str) -> Result<Vec<u8>> {
    if svg.len() > 2_000_000 {
        return Err("Rendered output is too large.".into());
    }
    let mut options = resvg::usvg::Options::default();
    static FONTS: OnceLock<Arc<resvg::usvg::fontdb::Database>> = OnceLock::new();
    options.fontdb = FONTS
        .get_or_init(|| {
            let mut fonts = resvg::usvg::fontdb::Database::new();
            fonts.load_system_fonts();
            Arc::new(fonts)
        })
        .clone();
    // No filesystem/base-URL resolution, even if an upstream SVG emitter changes.
    options.image_href_resolver = resvg::usvg::ImageHrefResolver {
        resolve_data: Box::new(|_, _, _| None),
        resolve_string: Box::new(|_, _| None),
    };
    let tree = resvg::usvg::Tree::from_str(svg, &options)
        .map_err(|_| "Cannot decode the generated diagram.")?;
    let size = tree.size();
    let scale = (1600.0 / size.width()).min(1600.0 / size.height()).min(2.0);
    let w = (size.width() * scale).ceil() as u32;
    let h = (size.height() * scale).ceil() as u32;
    if w == 0 || h == 0 || w > 1600 || h > 1600 {
        return Err("Rendered image geometry is unsupported.".into());
    }
    let mut pixels = resvg::tiny_skia::Pixmap::new(w, h).ok_or("Cannot allocate preview image.")?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale, scale),
        &mut pixels.as_mut(),
    );
    pixels
        .encode_png()
        .map_err(|_| "Cannot encode preview image.".into())
}
pub fn render_formula(source: &str, dark: bool) -> Result<Vec<u8>> {
    if source.len() > 4000
        || source.matches('{').count() > 100
        || regex::Regex::new(
            r"\\(?:def|gdef|newcommand|renewcommand|href|url|include|html|input|write|special)\b",
        )
        .unwrap()
        .is_match(source)
    {
        return Err("Formula uses unsupported commands or exceeds preview limits.".into());
    }
    std::panic::catch_unwind(|| {
        let font =
            latex_rust::MathFont::stix_two_math().map_err(|_| "Cannot load bundled math font.")?;
        let mut opts = latex_rust::SvgOptions::new();
        opts.display = true;
        opts.font_size_pt = latex_rust::Dim::from_i64(18);
        opts.color = if dark {
            latex_rust::Color::rgb(230, 230, 230)
        } else {
            latex_rust::Color::rgb(20, 20, 20)
        };
        let svg = latex_rust::latex_to_svg(source, &font, &opts)
            .map_err(|_| "Unsupported formula. Its source is preserved.")?;
        raster(&svg)
    })
    .map_err(|_| "Cannot render this formula.")?
}
pub fn render_diagram(source: &str, dark: bool) -> Result<Vec<u8>> {
    if source.len()>16000||source.lines().count()>500||!regex::Regex::new(r"^\s*(?:%%[^\n]*\n\s*)*(?:flowchart|graph|sequenceDiagram|stateDiagram-v2|classDiagram)\b").unwrap().is_match(source)||regex::Regex::new(r"(?im)%%\s*\{|(?:^|\n)\s*---|@\s*\{|@import|url\s*\(|<[a-z!/]|(?:^|[;\n])\s*(?:click|style|classDef|linkStyle|cssClass)\b").unwrap().is_match(source){return Err("Use a bounded flowchart, sequence, state or class diagram without directives, HTML, images, links or CSS.".into());}
    std::panic::catch_unwind(|| {
        let parsed = mermaid_rs_renderer::parse_mermaid_strict(source)
            .map_err(|_| "Invalid or unsupported diagram syntax.")?;
        if parsed.graph.nodes.len() > 200 || parsed.graph.edges.len() > 150 {
            return Err("Diagrams support up to 200 nodes and 150 edges.".into());
        }
        let theme = if dark {
            mermaid_rs_renderer::Theme::dark()
        } else {
            mermaid_rs_renderer::Theme::modern()
        };
        let config = mermaid_rs_renderer::LayoutConfig::default();
        let layout = mermaid_rs_renderer::compute_layout(&parsed.graph, &theme, &config);
        let svg = mermaid_rs_renderer::render_svg(&layout, &theme, &config);
        raster(&svg)
    })
    .map_err(|_| "Cannot render this diagram.")?
}
pub fn image_preview(bytes: &[u8]) -> Result<Vec<u8>> {
    use std::io::{Cursor, Write};
    let format = image::guess_format(bytes).map_err(|_| "Unsupported raster image.")?;
    if ![
        image::ImageFormat::Png,
        image::ImageFormat::Jpeg,
        image::ImageFormat::Gif,
        image::ImageFormat::WebP,
    ]
    .contains(&format)
    {
        return Err("Use PNG, JPEG, GIF or WebP images.".into());
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(64_000_000);
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|_| "Image dimensions, format or memory exceed the preview limits.")?;
    if u64::from(image.width()) * u64::from(image.height()) > 16_000_000 {
        return Err("Image exceeds 16 million pixels.".into());
    }
    let image = image.thumbnail(1600, 1600);
    let mut out = Cursor::new(vec![]);
    image
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|_| "Cannot encode image preview.")?;
    out.flush().map_err(|_| "Cannot finish image preview.")?;
    Ok(out.into_inner())
}
pub fn png_reply(bytes: Vec<u8>) -> Value {
    use base64::Engine as _;
    let pixels = bytes
        .get(16..24)
        .map(|size| {
            u64::from(u32::from_be_bytes(size[..4].try_into().expect("PNG width")))
                * u64::from(u32::from_be_bytes(
                    size[4..].try_into().expect("PNG height"),
                ))
        })
        .unwrap_or(0);
    json!({"kind":"image","data":base64::engine::general_purpose::STANDARD.encode(bytes),"pixelBytes":pixels*4})
}
pub fn resolve<'a>(
    from: &str,
    raw: &str,
    syntax: &str,
    space: &str,
    files: &'a [Value],
) -> Option<(&'a Value, String)> {
    let decoded = if syntax == "markdown" {
        percent_encoding::percent_decode_str(raw)
            .decode_utf8()
            .ok()?
            .into_owned()
    } else {
        raw.to_string()
    };
    let (target, fragment) = decoded.split_once('#').unwrap_or((&decoded, ""));
    if regex::Regex::new(r"^(?:[a-zA-Z][\w+.-]*:|//)")
        .unwrap()
        .is_match(target)
    {
        return None;
    }
    let mut joined = vec![];
    if !target.starts_with('/') {
        joined.extend(
            from.rsplit_once('/')
                .map(|(p, _)| p)
                .unwrap_or("")
                .split('/')
                .filter(|s| !s.is_empty()),
        );
    }
    for part in target.trim_start_matches('/').split('/') {
        match part {
            "" | "." => {}
            ".." => {
                joined.pop()?;
            }
            _ => joined.push(part),
        }
    }
    let relative = if target.is_empty() {
        from.to_string()
    } else {
        joined.join("/")
    };
    let root = target.trim_start_matches('/');
    let candidates: Vec<_> = files.iter().filter(|f| f["spaceId"] == space).collect();
    for path in [&relative, root] {
        for wanted in [path.to_lowercase(), format!("{}.md", path.to_lowercase())] {
            if let Some(file) = candidates.iter().find(|f| {
                f["path"]
                    .as_str()
                    .is_some_and(|p| p.to_lowercase() == wanted)
            }) {
                return Some((*file, fragment.to_string()));
            }
        }
    }
    if !target.contains('/') {
        let matching: Vec<_> = candidates
            .iter()
            .filter(|f| {
                f["path"].as_str().is_some_and(|p| {
                    let base = p.rsplit('/').next().unwrap_or(p).to_lowercase();
                    base == target.to_lowercase() || base == format!("{}.md", target.to_lowercase())
                })
            })
            .collect();
        if matching.len() == 1 {
            return Some((*matching[0], fragment.to_string()));
        }
    }
    None
}
pub fn fragment(source: &str, fragment: &str) -> Result<String> {
    if source.len() > 100000 {
        return Err(
            "Open this large note directly. Inline notes are limited to 100,000 bytes.".into(),
        );
    }
    if fragment.is_empty() {
        return Ok(source.into());
    }
    let slug = |s: &str| {
        s.to_lowercase()
            .chars()
            .filter(|c| c.is_alphanumeric() || c.is_whitespace() || ['_', '-'].contains(c))
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join("-")
    };
    let events: Vec<_> =
        Parser::new_ext(source, Options::ENABLE_TABLES | Options::ENABLE_FOOTNOTES)
            .into_offset_iter()
            .collect();
    if let Some(id) = fragment.strip_prefix('^') {
        if id.is_empty()
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err("Invalid block identifier.".into());
        }
        let blocks: Vec<_> = events
            .iter()
            .filter_map(|(event, range)| match event {
                Event::Start(
                    Tag::Paragraph
                    | Tag::Item
                    | Tag::CodeBlock(_)
                    | Tag::BlockQuote(_)
                    | Tag::List(_)
                    | Tag::Table(_),
                ) => Some((event, range.clone())),
                _ => None,
            })
            .collect();
        let marker = regex::Regex::new(&format!(r"[\t ]*\^{id}\s*$")).unwrap();
        let mut selected = vec![];
        for (event, range) in &blocks {
            if !matches!(event, Event::Start(Tag::Paragraph | Tag::Item)) {
                continue;
            }
            let raw = &source[range.clone()];
            if !marker.is_match(raw) {
                continue;
            }
            let chosen = if raw.trim() == format!("^{id}") {
                blocks
                    .iter()
                    .filter(|(_, r)| r.end <= range.start)
                    .max_by(|(_, a), (_, b)| a.end.cmp(&b.end).then_with(|| b.start.cmp(&a.start)))
                    .map(|(_, r)| r.clone())
            } else {
                // A marker in a tight or loose list selects its nearest list item.
                blocks
                    .iter()
                    .filter(|(e, r)| {
                        matches!(e, Event::Start(Tag::Item))
                            && r.start <= range.start
                            && r.end >= range.end
                    })
                    .min_by_key(|(_, r)| r.end - r.start)
                    .map(|(_, r)| r.clone())
                    .or_else(|| Some(range.clone()))
            };
            if let Some(chosen) = chosen {
                if !selected.contains(&chosen) {
                    selected.push(chosen);
                }
            }
        }
        // Parent list items containing a nested marked item are not separate matches.
        let selected: Vec<_> = selected
            .iter()
            .filter(|a| {
                !selected
                    .iter()
                    .any(|b| a != &b && a.start <= b.start && a.end >= b.end)
            })
            .cloned()
            .collect();
        let mut ranges: Vec<_> = selected
            .into_iter()
            .map(|r| marker.replace(&source[r], "").to_string())
            .collect();
        if ranges.len() == 1 {
            return Ok(ranges.remove(0));
        }
        return Err("Block is missing or ambiguous.".into());
    }
    let mut headings = vec![];
    let mut current: Option<(usize, u32, String)> = None;
    for (event, range) in &events {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                current = Some((range.start, *level as u32, String::new()))
            }
            Event::Text(text) | Event::Code(text) => {
                if let Some((_, _, s)) = current.as_mut() {
                    s.push_str(text)
                }
            }
            Event::End(TagEnd::Heading(_)) => {
                if let Some(h) = current.take() {
                    headings.push(h);
                }
            }
            _ => {}
        }
    }
    if let Some(i) = headings
        .iter()
        .position(|(_, _, text)| slug(text) == slug(fragment))
    {
        let (start, level, _) = &headings[i];
        let end = headings[i + 1..]
            .iter()
            .find(|(_, depth, _)| depth <= level)
            .map(|h| h.0)
            .unwrap_or(source.len());
        return Ok(source[*start..end].into());
    }
    Err("Heading is unavailable.".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wiki_tokens_merge_parser_text_but_preserve_escaped_and_code_literals() {
        let blocks=document(r"Visible [[Runbook|Guide]] and ![[Plan#Decision]]. Escaped \[[Literal]] and `[[Code]]`.").unwrap();
        let spans: Vec<_> = blocks.iter().flat_map(|b| b.spans.iter()).collect();
        assert!(spans
            .iter()
            .any(|s| s.target == "Runbook" && s.text == "Guide"));
        assert!(!spans
            .iter()
            .any(|s| s.target == "Literal" || s.target == "Code"));
        assert!(blocks
            .iter()
            .flat_map(|b| b.children.iter())
            .any(|b| b.kind == "embed" && b.target == "Plan#Decision"));
    }
    #[test]
    fn fragments_select_sections_list_items_and_standalone_blocks() {
        assert_eq!(
            fragment(
                "# Main\n\n## Decision\nKeep.\n\n## Other\nSkip.",
                "Decision"
            )
            .unwrap(),
            "## Decision\nKeep.\n\n"
        );
        assert_eq!(
            fragment("- First ^one\n- Second\n", "^one").unwrap(),
            "- First"
        );
        assert!(fragment("Paragraph ^same\n\nOther ^same", "^same").is_err());
        assert_eq!(
            fragment("```rust\nlet n=1;\n```\n\n^code\n", "^code")
                .unwrap()
                .trim(),
            "```rust\nlet n=1;\n```"
        );
    }
    #[test]
    fn native_ast_skips_html_and_preserves_structures() {
        let blocks=document("---\nsecret: hidden\n---\n# Title\n\n> [!TIP]- Remember\n> Keep body\n\n- [x] Done\n\n```rust\nlet n = 4;\n```\n\n![[Plan#Heading]]\n\n<script>not rendered</script>\n\n$E=mc^2$ {{secret:key}}").unwrap();
        let encoded = serde_json::to_string(&blocks).unwrap();
        assert!(!encoded.contains("hidden"));
        assert!(!encoded.contains("not rendered"));
        assert!(!encoded.contains("{{secret:"));
        let linked = document("> [!TIP]- Context\n> Keep **bold** and [[Runbook]].").unwrap();
        assert!(linked[0].children[0]
            .spans
            .iter()
            .any(|s| s.target == "Runbook"));
        assert!(linked[0].children[0]
            .spans
            .iter()
            .any(|s| s.bold && s.text == "bold"));
        assert!(encoded.contains("callout"));
        assert!(encoded.contains("Plan#Heading"));
        assert!(encoded.contains("☑"));
    }
    #[test]
    fn native_renderers_are_offline_bounded_and_real_pngs() {
        for result in [
            render_formula(r"\frac{a}{b}=\sqrt{c}", false),
            render_diagram("flowchart LR\nA[Notes] --> B[Context]", true),
        ] {
            let bytes = result.unwrap();
            assert!(bytes.starts_with(b"\x89PNG"));
            let image = image::load_from_memory(&bytes).unwrap();
            assert!(image.width() > 10);
            assert!(image.height() > 10);
        }
        assert!(render_formula(r"\href{https://example.com}{x}", false).is_err());
        // Within Helious's byte/brace limits, but beyond the parser's stack
        // budget. RUSTSEC-2026-0311 must produce an error, never abort the app.
        let nested = format!("{}1{}", r"\frac{1}{".repeat(35), "}".repeat(35));
        assert!(render_formula(&nested, false).is_err());
        assert!(render_diagram("graph LR\n%%{init:{}}%%\nA-->B", false).is_err());
        assert!(image_preview(b"<svg onload='x'/>").is_err());
    }
}
