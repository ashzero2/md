//! Pure markdown parsing for note indexing.
//!
//! Extracts the metadata the index needs (frontmatter, title, headings,
//! wikilinks, tags, searchable body text) from a raw `.md` source string.
//! Deliberately dependency-light: a line/fence state machine + regexes.
//!
//! See `docs/adr.md` D6 for the supported surface (CommonMark + GFM,
//! YAML frontmatter, `[[wikilinks]]`, `#tags`, callouts passthrough).

use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Heading {
    pub level: u32,
    pub text: String,
    pub pos: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Wikilink {
    /// Note target as written: `[[target#heading|alias]]`
    pub target: String,
    pub heading: Option<String>,
    pub alias: Option<String>,
    pub pos: usize,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ParsedNote {
    pub title: String,
    pub headings: Vec<Heading>,
    pub wikilinks: Vec<Wikilink>,
    pub tags: Vec<String>,
    /// Raw YAML frontmatter key/value pairs (tags lists flattened).
    pub frontmatter: Vec<(String, String)>,
    /// Body text with fenced code blocks and frontmatter removed (for FTS).
    pub body: String,
}

struct Regexes {
    frontmatter: Regex,
    heading: Regex,
    wikilink: Regex,
    inline_tag: Regex,
}

fn re() -> &'static Regexes {
    static RE: OnceLock<Regexes> = OnceLock::new();
    RE.get_or_init(|| Regexes {
        // YAML frontmatter: opening `---` line, block, closing `---` line.
        frontmatter: Regex::new(r"^\uFEFF?\s*---\s*\n([\s\S]*?)\n---\s*(\n|$)").unwrap(),
        heading: Regex::new(r"^(#{1,6})\s+(.+?)\s*$").unwrap(),
        // [[target]], [[target#heading]], [[target|alias]], [[target#heading|alias]]
        wikilink: Regex::new(r"\[\[([^\[\]\n]+)\]\]").unwrap(),
        // Inline tag: #word (plain — the `regex` crate has no lookbehind;
        // preceding-char filtering happens in the extraction loop).
        inline_tag: Regex::new(r"#([A-Za-z0-9_-]+)").unwrap(),
    })
}

/// Parse raw markdown. `fallback_title` is the filename stem used when the
/// document has no frontmatter title and no `# ` heading.
pub fn parse_markdown(raw: &str, fallback_title: &str) -> ParsedNote {
    let raw = raw.strip_prefix('\u{FEFF}').unwrap_or(raw);
    let fallback_title = fallback_title.strip_suffix(".md").unwrap_or(fallback_title);
    let regexes = re();
    let mut note = ParsedNote {
        title: fallback_title.to_string(),
        ..Default::default()
    };

    let (body_src, frontmatter) = split_frontmatter(raw, regexes);
    note.frontmatter = frontmatter;
    if let Some(t) = frontmatter_title(&note.frontmatter) {
        note.title = t;
    }
    parse_tags_list(&note.frontmatter, &mut note.tags);

    // Single pass over body lines with a fence state machine.
    let mut in_code = false;
    let mut fence_char = '`';
    let mut fence_len = 0usize;
    let mut body = String::new();
    let mut prev_blank = false;

    for (idx, line) in body_src.lines().enumerate() {
        let trimmed = line.trim_start();
        // Fence open/close detection: ``` or ~~~ (3+ chars, same char).
        if let Some(f) = fence_delimiter(trimmed) {
            if !in_code {
                in_code = true;
                fence_char = f.0;
                fence_len = f.1;
            } else if f.0 == fence_char && f.1 >= fence_len {
                in_code = false;
            }
            continue; // never index fence lines themselves
        }
        if in_code {
            continue; // skip code content
        }

        // Collapse runs of blank lines to a single paragraph break.
        if trimmed.is_empty() {
            if !prev_blank {
                body.push('\n');
                prev_blank = true;
            }
            continue;
        }
        prev_blank = false;

        // Headings.
        if let Some(caps) = regexes.heading.captures(trimmed) {
            let level = caps.get(1).unwrap().as_str().len() as u32;
            let text = caps.get(2).unwrap().as_str().trim().to_string();
            let pos = byte_pos(body_src, idx);
            if note.title == fallback_title && level == 1 {
                note.title = text.clone();
            }
            note.headings.push(Heading { level, text, pos });
        }

        // Wikilinks on this line.
        for caps in regexes.wikilink.captures_iter(trimmed) {
            let inner = caps.get(1).unwrap().as_str();
            let (target, heading, alias) = split_wikilink(inner);
            let pos = byte_pos(body_src, idx);
            note.wikilinks.push(Wikilink {
                target,
                heading,
                alias,
                pos,
            });
        }

        // Inline tags. Reject when preceded by a word char, `/`, or `#`
        // (the latter excludes `##` heading-style tags).
        for caps in regexes.inline_tag.captures_iter(trimmed) {
            let whole = caps.get(0).unwrap();
            let prev = trimmed[..whole.start()].chars().next_back();
            let ok = match prev {
                None => true,
                Some(c) => !(c.is_alphanumeric() || c == '_' || c == '/' || c == '#'),
            };
            if !ok {
                continue;
            }
            let tag = caps.get(1).unwrap().as_str().to_string();
            if !note.tags.contains(&tag) {
                note.tags.push(tag);
            }
        }

        body.push_str(trimmed);
        body.push('\n');
    }
    note.body = body;
    note
}

/// Returns `(code, fence_len)` for a fence delimiter line, else None.
fn fence_delimiter(trimmed: &str) -> Option<(char, usize)> {
    let c = trimmed.chars().next()?;
    if c != '`' && c != '~' {
        return None;
    }
    let n = trimmed.chars().take_while(|&ch| ch == c).count();
    (n >= 3).then_some((c, n))
}

/// Split `[[...]]` inner text into (target, heading, alias).
fn split_wikilink(inner: &str) -> (String, Option<String>, Option<String>) {
    let (path_part, alias) = match inner.split_once('|') {
        Some((p, a)) => {
            let a = a.trim();
            (p, if a.is_empty() { None } else { Some(a.to_string()) })
        }
        None => (inner, None),
    };
    match path_part.split_once('#') {
        Some((t, h)) => {
            let h = h.trim();
            (
                t.trim().to_string(),
                if h.is_empty() { None } else { Some(h.to_string()) },
                alias,
            )
        }
        None => (path_part.trim().to_string(), None, alias),
    }
}

/// Extract the YAML frontmatter block and return (body_without_frontmatter,
/// frontmatter key/value pairs). List values (`tags:\n  - a`) are flattened
/// into comma-joined values on the same key.
fn split_frontmatter<'a>(raw: &'a str, regexes: &Regexes) -> (&'a str, Vec<(String, String)>) {
    let Some(caps) = regexes.frontmatter.captures(raw) else {
        return (raw, Vec::new());
    };
    let block = caps.get(1).unwrap().as_str();
    let mut pairs: Vec<(String, String)> = Vec::new();
    for line in block.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            let k = k.trim().to_string();
            let v = v.trim().to_string();
            if !k.is_empty() {
                pairs.push((k, v));
            }
        } else if line.starts_with("- ") && !pairs.is_empty() {
            let val = line.trim_start_matches("- ").trim().to_string();
            let (_, v) = pairs.last_mut().unwrap();
            if v.is_empty() {
                *v = val;
            } else {
                v.push_str(", ");
                v.push_str(&val);
            }
        }
    }
    let end = caps.get(0).unwrap().as_str().len();
    (&raw[end..], pairs)
}

fn frontmatter_title(fm: &[(String, String)]) -> Option<String> {
    fm.iter()
        .find(|(k, _)| k == "title")
        .map(|(_, v)| v.trim_matches(|c| c == '"' || c == '\'').to_string())
}

/// Parse the `tags` frontmatter key: `[a, b]`, `a, b`, or flattened list form.
fn parse_tags_list(fm: &[(String, String)], out: &mut Vec<String>) {
    let Some((_, v)) = fm.iter().find(|(k, _)| k == "tags") else {
        return;
    };
    let cleaned = v.trim().trim_start_matches('[').trim_end_matches(']');
    for part in cleaned.split(',') {
        let tag = part.trim().trim_start_matches("- ").trim();
        if !tag.is_empty() && !out.contains(&tag.to_string()) {
            out.push(tag.to_string());
        }
    }
}

/// Approximate byte offset of the start of line `idx` within `src`.
fn byte_pos(src: &str, line_idx: usize) -> usize {
    let mut pos = 0usize;
    for (i, line) in src.split_inclusive('\n').enumerate() {
        if i == line_idx {
            return pos;
        }
        pos += line.len();
    }
    pos
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_frontmatter_title_and_tags() {
        let raw = "---\ntitle: My Note\ntags: [a, b]\n---\n# Hello\nbody text";
        let note = parse_markdown(raw, "file.md");
        assert_eq!(note.title, "My Note");
        assert!(note.tags.contains(&"a".to_string()));
        assert!(note.tags.contains(&"b".to_string()));
        assert_eq!(note.headings[0].level, 1);
        assert_eq!(note.headings[0].text, "Hello");
    }

    #[test]
    fn title_falls_back_to_first_h1_then_filename() {
        let note = parse_markdown("# Document Title\ncontent", "file.md");
        assert_eq!(note.title, "Document Title");
        let note = parse_markdown("no headings here", "my-note.md");
        assert_eq!(note.title, "my-note");
    }

    #[test]
    fn extracts_wikilinks_with_heading_and_alias() {
        let raw = "See [[Other Note#Sec|alias]] and [[Plain]].";
        let note = parse_markdown(raw, "f.md");
        assert_eq!(note.wikilinks.len(), 2);
        assert_eq!(note.wikilinks[0].target, "Other Note");
        assert_eq!(note.wikilinks[0].heading, Some("Sec".to_string()));
        assert_eq!(note.wikilinks[0].alias, Some("alias".to_string()));
        assert_eq!(note.wikilinks[1].target, "Plain");
        assert_eq!(note.wikilinks[1].heading, None);
    }

    #[test]
    fn extracts_inline_tags_and_merges() {
        let raw = "---\ntags: [a]\n---\n#topic and #topic again and #other-tag";
        let note = parse_markdown(raw, "f.md");
        assert!(note.tags.contains(&"topic".to_string()));
        assert!(note.tags.contains(&"other-tag".to_string()));
        assert!(note.tags.contains(&"a".to_string()));
        let count = note.tags.iter().filter(|t| **t == "topic").count();
        assert_eq!(count, 1);
    }

    #[test]
    fn ignores_code_fences() {
        let raw = "# H\n\n```md\n[[NotALink]] #notatag\n```\n\nafter";
        let note = parse_markdown(raw, "f.md");
        assert!(note.wikilinks.is_empty(), "wikilinks inside fences must be ignored");
        assert!(!note.tags.contains(&"notatag".to_string()));
        assert_eq!(note.body, "# H\n\nafter\n");
    }

    #[test]
    fn body_excludes_frontmatter() {
        let raw = "---\ntitle: T\n---\n# H\ntext `code` ok";
        let note = parse_markdown(raw, "f.md");
        assert!(!note.body.contains("title: T"));
        assert!(note.body.contains("text `code` ok"));
    }

    #[test]
    fn parses_list_form_tags() {
        let raw = "---\ntags:\n  - x\n  - y\n---\nbody";
        let note = parse_markdown(raw, "f.md");
        assert!(note.tags.contains(&"x".to_string()));
        assert!(note.tags.contains(&"y".to_string()));
    }

    #[test]
    fn unclosed_fence_does_not_panic() {
        let raw = "# H\n```\nnothing after\n";
        let note = parse_markdown(raw, "f.md");
        assert_eq!(note.title, "H");
    }
}