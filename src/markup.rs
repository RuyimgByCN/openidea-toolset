use crate::string_tools::escape_xml;
use openidea_plugin::Error;

pub fn convert_markup(input: &str, from: &str, to: &str) -> Result<String, Error> {
    let md = match from {
        "markdown" | "md" => normalize_newlines(input),
        "html" => html_to_markdown(input),
        "bbcode" => bbcode_to_markdown(input),
        "asciidoc" | "adoc" => asciidoc_to_markdown(input),
        _ => return Err(Error::Invalid(format!("Unsupported source markup format {from}"))),
    };

    match to {
        "markdown" | "md" => Ok(md.trim_end().to_owned()),
        "html" => Ok(markdown_to_html(&md)),
        "bbcode" => Ok(markdown_to_bbcode(&md)),
        "asciidoc" | "adoc" => Ok(markdown_to_asciidoc(&md)),
        _ => Err(Error::Invalid(format!("Unsupported target markup format {to}"))),
    }
}

fn normalize_newlines(s: &str) -> String {
    s.replace("\r\n", "\n").replace('\r', "\n")
}

fn sanitize_url(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "#".into();
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:")
        || trimmed.starts_with('/')
        || trimmed.starts_with("./")
        || trimmed.starts_with("../")
        || trimmed.starts_with('#')
    {
        trimmed.to_owned()
    } else if !lower.contains(':') {
        trimmed.to_owned()
    } else {
        "#".into()
    }
}

fn html_attr(raw: &str) -> String {
    escape_xml(raw, false)
}

#[derive(Debug)]
enum Block {
    Heading(u8, String),
    CodeBlock { lang: String, code: String },
    Quote(Vec<String>),
    UnorderedList(Vec<String>),
    OrderedList(Vec<String>),
    Hr,
    Paragraph(String),
}

fn parse_markdown_blocks(md: &str) -> Vec<Block> {
    let lines: Vec<&str> = md.lines().collect();
    let mut blocks = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();
        if trimmed.is_empty() {
            i += 1;
            continue;
        }
        // Fenced code block
        if let Some(after) = trimmed.strip_prefix("```") {
            let lang = after.trim().to_owned();
            i += 1;
            let mut code_lines = Vec::new();
            while i < lines.len() && !lines[i].trim_start().starts_with("```") {
                code_lines.push(lines[i]);
                i += 1;
            }
            if i < lines.len() {
                i += 1;
            }
            blocks.push(Block::CodeBlock {
                lang,
                code: code_lines.join("\n"),
            });
            continue;
        }
        // Horizontal rule
        if matches!(trimmed, "---" | "***" | "___") {
            blocks.push(Block::Hr);
            i += 1;
            continue;
        }
        // ATX Heading
        if trimmed.starts_with('#') {
            let hashes = trimmed.chars().take_while(|&c| c == '#').count();
            if (1..=6).contains(&hashes) && trimmed.chars().nth(hashes) == Some(' ') {
                let text = trimmed[hashes + 1..].trim().trim_end_matches('#').trim().to_owned();
                blocks.push(Block::Heading(hashes as u8, text));
                i += 1;
                continue;
            }
        }
        // Blockquote
        if trimmed.starts_with('>') {
            let mut q = Vec::new();
            while i < lines.len() && lines[i].trim_start().starts_with('>') {
                let t = lines[i].trim_start();
                q.push(t.strip_prefix("> ").or_else(|| t.strip_prefix('>')).unwrap_or("").to_owned());
                i += 1;
            }
            blocks.push(Block::Quote(q));
            continue;
        }
        // Unordered list
        if is_ul_item(trimmed) {
            let mut items = Vec::new();
            while i < lines.len() && is_ul_item(lines[i].trim()) {
                items.push(lines[i].trim()[2..].trim().to_owned());
                i += 1;
            }
            blocks.push(Block::UnorderedList(items));
            continue;
        }
        // Ordered list
        if is_ol_item(trimmed).is_some() {
            let mut items = Vec::new();
            while i < lines.len() {
                if let Some(rest) = is_ol_item(lines[i].trim()) {
                    items.push(rest.trim().to_owned());
                    i += 1;
                } else {
                    break;
                }
            }
            blocks.push(Block::OrderedList(items));
            continue;
        }
        // Paragraph
        let mut para = vec![trimmed];
        i += 1;
        while i < lines.len() {
            let nxt = lines[i].trim();
            if nxt.is_empty()
                || nxt.starts_with("```")
                || nxt.starts_with('#')
                || nxt.starts_with('>')
                || is_ul_item(nxt)
                || is_ol_item(nxt).is_some()
                || matches!(nxt, "---" | "***" | "___")
            {
                break;
            }
            para.push(nxt);
            i += 1;
        }
        blocks.push(Block::Paragraph(para.join(" ")));
    }
    blocks
}

fn is_ul_item(t: &str) -> bool {
    t.starts_with("- ") || t.starts_with("* ") || t.starts_with("+ ")
}

fn is_ol_item(t: &str) -> Option<&str> {
    let dot = t.find(". ")?;
    if dot > 0 && t[..dot].chars().all(|c| c.is_ascii_digit()) {
        Some(&t[dot + 2..])
    } else {
        None
    }
}

#[derive(Clone, Copy)]
enum InlineTarget {
    Html,
    Bbcode,
    Asciidoc,
}

fn render_inline(s: &str, target: InlineTarget) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::new();
    let mut i = 0;

    while i < chars.len() {
        // Escaped char in Markdown
        if chars[i] == '\\' && i + 1 < chars.len() {
            let next = chars[i + 1].to_string();
            out.push_str(&escape_inline_text(&next, target));
            i += 2;
            continue;
        }
        // Inline code `...`
        if chars[i] == '`' {
            if let Some(end) = find_char(&chars, i + 1, '`') {
                let code: String = chars[i + 1..end].iter().collect();
                match target {
                    InlineTarget::Html => out.push_str(&format!("<code>{}</code>", escape_xml(&code, false))),
                    InlineTarget::Bbcode => out.push_str(&format!("[code]{code}[/code]")),
                    InlineTarget::Asciidoc => out.push_str(&format!("`{code}`")),
                }
                i = end + 1;
                continue;
            }
        }
        // Image ![alt](url)
        if chars[i] == '!' && chars.get(i + 1) == Some(&'[') {
            if let Some((alt, url, next_i)) = parse_bracket_link(&chars, i + 1) {
                let clean = sanitize_url(&url);
                match target {
                    InlineTarget::Html => {
                        out.push_str(&format!("<img src=\"{}\" alt=\"{}\" />", html_attr(&clean), html_attr(&alt)))
                    }
                    InlineTarget::Bbcode => out.push_str(&format!("[img]{clean}[/img]")),
                    InlineTarget::Asciidoc => out.push_str(&format!("image::{clean}[{alt}]")),
                }
                i = next_i;
                continue;
            }
        }
        // Link [label](url)
        if chars[i] == '[' {
            if let Some((label, url, next_i)) = parse_bracket_link(&chars, i) {
                let clean = sanitize_url(&url);
                let inner = render_inline(&label, target);
                match target {
                    InlineTarget::Html => out.push_str(&format!("<a href=\"{}\">{inner}</a>", html_attr(&clean))),
                    InlineTarget::Bbcode => out.push_str(&format!("[url={clean}]{inner}[/url]")),
                    InlineTarget::Asciidoc => out.push_str(&format!("{clean}[{inner}]")),
                }
                i = next_i;
                continue;
            }
        }
        // Bold **...** or __...__
        if (chars[i] == '*' && chars.get(i + 1) == Some(&'*')) || (chars[i] == '_' && chars.get(i + 1) == Some(&'_')) {
            let marker = chars[i];
            if let Some(end) = find_double(&chars, i + 2, marker) {
                let inner_raw: String = chars[i + 2..end].iter().collect();
                let inner = render_inline(&inner_raw, target);
                match target {
                    InlineTarget::Html => out.push_str(&format!("<strong>{inner}</strong>")),
                    InlineTarget::Bbcode => out.push_str(&format!("[b]{inner}[/b]")),
                    InlineTarget::Asciidoc => out.push_str(&format!("*{inner}*")),
                }
                i = end + 2;
                continue;
            }
        }
        // Strikethrough ~~...~~
        if chars[i] == '~' && chars.get(i + 1) == Some(&'~') {
            if let Some(end) = find_double(&chars, i + 2, '~') {
                let inner_raw: String = chars[i + 2..end].iter().collect();
                let inner = render_inline(&inner_raw, target);
                match target {
                    InlineTarget::Html => out.push_str(&format!("<del>{inner}</del>")),
                    InlineTarget::Bbcode => out.push_str(&format!("[s]{inner}[/s]")),
                    InlineTarget::Asciidoc => out.push_str(&format!("[.line-through]#{inner}#")),
                }
                i = end + 2;
                continue;
            }
        }
        // Italic *...* or _..._
        if chars[i] == '*' || chars[i] == '_' {
            let marker = chars[i];
            if let Some(end) = find_char(&chars, i + 1, marker) {
                if end > i + 1 {
                    let inner_raw: String = chars[i + 1..end].iter().collect();
                    let inner = render_inline(&inner_raw, target);
                    match target {
                        InlineTarget::Html => out.push_str(&format!("<em>{inner}</em>")),
                        InlineTarget::Bbcode => out.push_str(&format!("[i]{inner}[/i]")),
                        InlineTarget::Asciidoc => out.push_str(&format!("_{inner}_")),
                    }
                    i = end + 1;
                    continue;
                }
            }
        }

        let ch = chars[i].to_string();
        out.push_str(&escape_inline_text(&ch, target));
        i += 1;
    }
    out
}

fn escape_inline_text(s: &str, target: InlineTarget) -> String {
    match target {
        InlineTarget::Html => escape_xml(s, false),
        InlineTarget::Bbcode | InlineTarget::Asciidoc => s.to_owned(),
    }
}

fn find_char(chars: &[char], from: usize, needle: char) -> Option<usize> {
    (from..chars.len()).find(|&idx| chars[idx] == needle)
}

fn find_double(chars: &[char], from: usize, needle: char) -> Option<usize> {
    (from..chars.len().saturating_sub(1)).find(|&idx| chars[idx] == needle && chars[idx + 1] == needle)
}

fn parse_bracket_link(chars: &[char], open_bracket: usize) -> Option<(String, String, usize)> {
    let close_bracket = find_char(chars, open_bracket + 1, ']')?;
    if chars.get(close_bracket + 1) != Some(&'(') {
        return None;
    }
    let close_paren = find_char(chars, close_bracket + 2, ')')?;
    let label: String = chars[open_bracket + 1..close_bracket].iter().collect();
    let url: String = chars[close_bracket + 2..close_paren].iter().collect();
    Some((label, url, close_paren + 1))
}

fn markdown_to_html(md: &str) -> String {
    let blocks = parse_markdown_blocks(md);
    let mut out = Vec::new();
    for b in blocks {
        match b {
            Block::Heading(lvl, text) => {
                out.push(format!("<h{lvl}>{}</h{lvl}>", render_inline(&text, InlineTarget::Html)));
            }
            Block::CodeBlock { lang, code } => {
                let cls = if lang.is_empty() {
                    String::new()
                } else {
                    format!(" class=\"language-{}\"", html_attr(&lang))
                };
                out.push(format!("<pre><code{cls}>{}</code></pre>", escape_xml(&code, false)));
            }
            Block::Quote(lines) => {
                let inner = lines
                    .into_iter()
                    .map(|l| format!("<p>{}</p>", render_inline(&l, InlineTarget::Html)))
                    .collect::<Vec<_>>()
                    .join("\n  ");
                out.push(format!("<blockquote>\n  {inner}\n</blockquote>"));
            }
            Block::UnorderedList(items) => {
                let lis = items
                    .into_iter()
                    .map(|it| format!("  <li>{}</li>", render_inline(&it, InlineTarget::Html)))
                    .collect::<Vec<_>>()
                    .join("\n");
                out.push(format!("<ul>\n{lis}\n</ul>"));
            }
            Block::OrderedList(items) => {
                let lis = items
                    .into_iter()
                    .map(|it| format!("  <li>{}</li>", render_inline(&it, InlineTarget::Html)))
                    .collect::<Vec<_>>()
                    .join("\n");
                out.push(format!("<ol>\n{lis}\n</ol>"));
            }
            Block::Hr => out.push("<hr />".into()),
            Block::Paragraph(text) => out.push(format!("<p>{}</p>", render_inline(&text, InlineTarget::Html))),
        }
    }
    out.join("\n")
}

fn markdown_to_bbcode(md: &str) -> String {
    let blocks = parse_markdown_blocks(md);
    let mut out = Vec::new();
    for b in blocks {
        match b {
            Block::Heading(lvl, text) => {
                let size = match lvl {
                    1 => 200,
                    2 => 160,
                    3 => 135,
                    _ => 115,
                };
                out.push(format!("[size={size}][b]{}[/b][/size]", render_inline(&text, InlineTarget::Bbcode)));
            }
            Block::CodeBlock { lang, code } => {
                let tag = if lang.is_empty() { "[code]".into() } else { format!("[code={lang}]") };
                out.push(format!("{tag}\n{code}\n[/code]"));
            }
            Block::Quote(lines) => {
                let inner = lines
                    .into_iter()
                    .map(|l| render_inline(&l, InlineTarget::Bbcode))
                    .collect::<Vec<_>>()
                    .join("\n");
                out.push(format!("[quote]\n{inner}\n[/quote]"));
            }
            Block::UnorderedList(items) => {
                let lis = items
                    .into_iter()
                    .map(|it| format!("[*] {}", render_inline(&it, InlineTarget::Bbcode)))
                    .collect::<Vec<_>>()
                    .join("\n");
                out.push(format!("[list]\n{lis}\n[/list]"));
            }
            Block::OrderedList(items) => {
                let lis = items
                    .into_iter()
                    .map(|it| format!("[*] {}", render_inline(&it, InlineTarget::Bbcode)))
                    .collect::<Vec<_>>()
                    .join("\n");
                out.push(format!("[list=1]\n{lis}\n[/list]"));
            }
            Block::Hr => out.push("[hr]".into()),
            Block::Paragraph(text) => out.push(render_inline(&text, InlineTarget::Bbcode)),
        }
    }
    out.join("\n\n")
}

fn markdown_to_asciidoc(md: &str) -> String {
    let blocks = parse_markdown_blocks(md);
    let mut out = Vec::new();
    for b in blocks {
        match b {
            Block::Heading(lvl, text) => {
                let eq = "=".repeat(lvl as usize);
                out.push(format!("{eq} {}", render_inline(&text, InlineTarget::Asciidoc)));
            }
            Block::CodeBlock { lang, code } => {
                let header = if lang.is_empty() { "[source]".into() } else { format!("[source,{lang}]") };
                out.push(format!("{header}\n----\n{code}\n----"));
            }
            Block::Quote(lines) => {
                let inner = lines
                    .into_iter()
                    .map(|l| render_inline(&l, InlineTarget::Asciidoc))
                    .collect::<Vec<_>>()
                    .join("\n");
                out.push(format!("[quote]\n____\n{inner}\n____"));
            }
            Block::UnorderedList(items) => {
                out.push(
                    items
                        .into_iter()
                        .map(|it| format!("* {}", render_inline(&it, InlineTarget::Asciidoc)))
                        .collect::<Vec<_>>()
                        .join("\n"),
                );
            }
            Block::OrderedList(items) => {
                out.push(
                    items
                        .into_iter()
                        .map(|it| format!(". {}", render_inline(&it, InlineTarget::Asciidoc)))
                        .collect::<Vec<_>>()
                        .join("\n"),
                );
            }
            Block::Hr => out.push("'''".into()),
            Block::Paragraph(text) => out.push(render_inline(&text, InlineTarget::Asciidoc)),
        }
    }
    out.join("\n\n")
}

fn html_to_markdown(html: &str) -> String {
    let s = normalize_newlines(html);
    let mut out = String::new();
    let mut i = 0;
    let mut in_pre = false;
    let mut in_ol = false;
    let mut ol_idx = 0usize;
    let mut link_href: Option<String> = None;

    while i < s.len() {
        if let Some(rel_lt) = s[i..].find('<') {
            let text = &s[i..i + rel_lt];
            if in_pre {
                out.push_str(&crate::string_tools::unescape_xml(text));
            } else {
                let decoded = crate::string_tools::unescape_xml(text);
                // Collapse HTML inter-tag formatting whitespace cleanly
                let collapsed = if decoded.trim().is_empty() && decoded.contains('\n') {
                    ""
                } else {
                    decoded.as_str()
                };
                out.push_str(collapsed);
            }
            i += rel_lt;
            let Some(rel_gt) = s[i..].find('>') else {
                out.push_str(&s[i..]);
                break;
            };
            let raw_tag = s[i + 1..i + rel_gt].trim();
            i += rel_gt + 1;

            let lower = raw_tag.to_ascii_lowercase();
            let tag_name = lower
                .trim_start_matches('/')
                .split(|c: char| c.is_whitespace() || c == '/')
                .next()
                .unwrap_or("");
            let is_close = lower.starts_with('/');

            match (tag_name, is_close) {
                ("h1" | "h2" | "h3" | "h4" | "h5" | "h6", false) => {
                    let lvl = tag_name[1..].parse::<usize>().unwrap_or(1);
                    ensure_blank_line(&mut out);
                    out.push_str(&"#".repeat(lvl));
                    out.push(' ');
                }
                ("h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p", true) => ensure_blank_line(&mut out),
                ("p", false) => {
                    if !out.is_empty() && !out.ends_with("\n\n") {
                        ensure_blank_line(&mut out);
                    }
                }
                ("br", _) => out.push('\n'),
                ("hr", _) => {
                    ensure_blank_line(&mut out);
                    out.push_str("---\n\n");
                }
                ("pre", false) => {
                    ensure_blank_line(&mut out);
                    in_pre = true;
                    out.push_str("```\n");
                }
                ("pre", true) => {
                    in_pre = false;
                    if !out.ends_with('\n') {
                        out.push('\n');
                    }
                    out.push_str("```\n\n");
                }
                ("code", false) => {
                    if !in_pre {
                        out.push('`');
                    }
                }
                ("code", true) => {
                    if !in_pre {
                        out.push('`');
                    }
                }
                ("strong" | "b", _) => out.push_str("**"),
                ("em" | "i", _) => out.push('*'),
                ("del" | "s", _) => out.push_str("~~"),
                ("ul", false) => {
                    in_ol = false;
                    ensure_blank_line(&mut out);
                }
                ("ol", false) => {
                    in_ol = true;
                    ol_idx = 0;
                    ensure_blank_line(&mut out);
                }
                ("ul" | "ol", true) => {
                    in_ol = false;
                    ensure_blank_line(&mut out);
                }
                ("li", false) => {
                    if !out.ends_with('\n') && !out.is_empty() {
                        out.push('\n');
                    }
                    if in_ol {
                        ol_idx += 1;
                        out.push_str(&format!("{ol_idx}. "));
                    } else {
                        out.push_str("- ");
                    }
                }
                ("blockquote", false) => {
                    ensure_blank_line(&mut out);
                    out.push_str("> ");
                }
                ("blockquote", true) => ensure_blank_line(&mut out),
                ("a", false) => {
                    link_href = extract_html_attr(raw_tag, "href");
                    out.push('[');
                }
                ("a", true) => {
                    let href = link_href.take().unwrap_or_else(|| "#".into());
                    out.push_str(&format!("]({href})"));
                }
                ("img", _) => {
                    let src = extract_html_attr(raw_tag, "src").unwrap_or_default();
                    let alt = extract_html_attr(raw_tag, "alt").unwrap_or_default();
                    out.push_str(&format!("![{alt}]({src})"));
                }
                _ => {}
            }
        } else {
            out.push_str(&crate::string_tools::unescape_xml(&s[i..]));
            break;
        }
    }
    out.trim().to_owned()
}

fn ensure_blank_line(out: &mut String) {
    if out.is_empty() {
        return;
    }
    while out.ends_with('\n') {
        out.pop();
    }
    out.push_str("\n\n");
}

fn extract_html_attr(tag: &str, attr: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let needle = format!("{attr}=");
    let pos = lower.find(&needle)?;
    let rest = tag[pos + needle.len()..].trim_start();
    let q = rest.chars().next()?;
    if q == '"' || q == '\'' {
        let end = rest[1..].find(q)?;
        Some(crate::string_tools::unescape_xml(&rest[1..1 + end]))
    } else {
        let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        Some(crate::string_tools::unescape_xml(&rest[..end]))
    }
}

fn bbcode_to_markdown(bb: &str) -> String {
    let mut s = normalize_newlines(bb);
    let pairs = [
        ("[b]", "**"), ("[/b]", "**"),
        ("[i]", "*"), ("[/i]", "*"),
        ("[s]", "~~"), ("[/s]", "~~"),
        ("[hr]", "---"),
        ("[quote]", "> "), ("[/quote]", ""),
        ("[list]", ""), ("[list=1]", ""), ("[/list]", ""),
    ];
    for (from, to) in pairs {
        s = replace_ci(&s, from, to);
    }
    // [size=N] headings
    let size_re = regex::Regex::new(r"(?is)\[size=\d+\](.*?)\[/size\]").unwrap();
    s = size_re.replace_all(&s, "## $1").into_owned();
    // [code=lang] or [code]
    let code_lang_re = regex::Regex::new(r"(?is)\[code=([^\]]+)\]\n?(.*?)\n?\[/code\]").unwrap();
    s = code_lang_re.replace_all(&s, "```$1\n$2\n```").into_owned();
    let code_re = regex::Regex::new(r"(?is)\[code\](.*?)\[/code\]").unwrap();
    s = code_re
        .replace_all(&s, |caps: &regex::Captures<'_>| {
            let inner = caps.get(1).map_or("", |m| m.as_str());
            if inner.contains('\n') {
                format!("```\n{}\n```", inner.trim_matches('\n'))
            } else {
                format!("`{inner}`")
            }
        })
        .into_owned();
    // [url=...]label[/url] & [img]url[/img]
    let url_re = regex::Regex::new(r"(?is)\[url=([^\]]+)\](.*?)\[/url\]").unwrap();
    s = url_re.replace_all(&s, "[$2]($1)").into_owned();
    let img_re = regex::Regex::new(r"(?is)\[img\](.*?)\[/img\]").unwrap();
    s = img_re.replace_all(&s, "![]($1)").into_owned();
    let li_re = regex::Regex::new(r"(?m)^\s*\[\*\]\s*").unwrap();
    s = li_re.replace_all(&s, "- ").into_owned();
    s.trim().to_owned()
}

fn asciidoc_to_markdown(adoc: &str) -> String {
    let lines: Vec<String> = normalize_newlines(adoc).lines().map(str::to_owned).collect();
    let mut out = Vec::new();
    let mut i = 0;
    let mut pending_lang = String::new();
    let mut in_code = false;

    while i < lines.len() {
        let line = &lines[i];
        let trimmed = line.trim();
        if trimmed == "----" {
            if !in_code {
                out.push(format!("```{pending_lang}"));
                pending_lang.clear();
                in_code = true;
            } else {
                out.push("```".into());
                in_code = false;
            }
            i += 1;
            continue;
        }
        if in_code {
            out.push(line.clone());
            i += 1;
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("[source,").and_then(|r| r.strip_suffix(']')) {
            pending_lang = rest.trim().to_owned();
            i += 1;
            continue;
        }
        if trimmed == "[source]" || trimmed == "[quote]" || trimmed == "____" {
            i += 1;
            continue;
        }
        if trimmed == "'''" {
            out.push("---".into());
            i += 1;
            continue;
        }
        // Headings `= Title`, `== Sub`
        if trimmed.starts_with('=') {
            let eqs = trimmed.chars().take_while(|&c| c == '=').count();
            if (1..=6).contains(&eqs) && trimmed.chars().nth(eqs) == Some(' ') {
                let text = convert_adoc_inline(&trimmed[eqs + 1..]);
                out.push(format!("{} {text}", "#".repeat(eqs)));
                i += 1;
                continue;
            }
        }
        if let Some(rest) = trimmed.strip_prefix("* ") {
            out.push(format!("- {}", convert_adoc_inline(rest)));
        } else if let Some(rest) = trimmed.strip_prefix(". ") {
            out.push(format!("1. {}", convert_adoc_inline(rest)));
        } else {
            out.push(convert_adoc_inline(line));
        }
        i += 1;
    }
    out.join("\n").trim().to_owned()
}

fn convert_adoc_inline(line: &str) -> String {
    let img_re = regex::Regex::new(r"image::([^\s\[]+)\[([^\]]*)\]").unwrap();
    let mut s = img_re.replace_all(line, "![$2]($1)").into_owned();
    let link_re = regex::Regex::new(r"(https?://[^\s\[]+)\[([^\]]+)\]").unwrap();
    s = link_re.replace_all(&s, "[$2]($1)").into_owned();
    let bold_re = regex::Regex::new(r"\*([^*\n]+)\*").unwrap();
    s = bold_re.replace_all(&s, "**$1**").into_owned();
    s
}

fn replace_ci(haystack: &str, needle: &str, rep: &str) -> String {
    let mut out = String::with_capacity(haystack.len());
    let h_lower = haystack.to_ascii_lowercase();
    let n_lower = needle.to_ascii_lowercase();
    let mut from = 0;
    while let Some(rel) = h_lower[from..].find(&n_lower) {
        out.push_str(&haystack[from..from + rel]);
        out.push_str(rep);
        from += rel + needle.len();
    }
    out.push_str(&haystack[from..]);
    out
}
