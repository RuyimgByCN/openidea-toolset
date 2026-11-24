use openidea_plugin::Error;
use rand::RngExt;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy)]
pub enum CaseStyle {
    Camel,
    Pascal,
    Snake,
    ScreamingSnake,
    Kebab,
    Dot,
    Space,
    Slug,
    Title,
    Upper,
    Lower,
    Toggle,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextStats {
    pub chars: usize,
    pub chars_no_whitespace: usize,
    pub utf8_bytes: usize,
    pub utf16_units: usize,
    pub lines: usize,
    pub words: usize,
}

pub fn text_stats(s: &str) -> TextStats {
    TextStats {
        chars: s.chars().count(),
        chars_no_whitespace: s.chars().filter(|c| !c.is_whitespace()).count(),
        utf8_bytes: s.len(),
        utf16_units: s.encode_utf16().count(),
        lines: if s.is_empty() { 0 } else { s.split('\n').count() },
        words: s.split_whitespace().count(),
    }
}

pub fn convert_case(s: &str, style: CaseStyle) -> String {
    match style {
        CaseStyle::Camel => join_words(s, style),
        CaseStyle::Pascal => join_words(s, style),
        CaseStyle::Snake => join_words(s, style),
        CaseStyle::ScreamingSnake => join_words(s, style),
        CaseStyle::Kebab => join_words(s, style),
        CaseStyle::Dot => join_words(s, style),
        CaseStyle::Space => join_words(s, style),
        CaseStyle::Slug => slugify(s),
        CaseStyle::Title => title_case(s),
        CaseStyle::Upper => s.to_uppercase(),
        CaseStyle::Lower => s.to_lowercase(),
        CaseStyle::Toggle => toggle_case(s),
    }
}

fn slugify(s: &str) -> String {
    let words = split_words(s);
    let ascii_words: Vec<String> = words
        .into_iter()
        .map(|w| w.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase())
        .filter(|w| !w.is_empty())
        .collect();
    if ascii_words.is_empty() {
        String::new()
    } else {
        ascii_words.join("-")
    }
}

fn split_words(s: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut cur = String::new();
    let chars: Vec<char> = s.chars().collect();
    for (i, &c) in chars.iter().enumerate() {
        if !c.is_alphanumeric() {
            if !cur.is_empty() {
                words.push(std::mem::take(&mut cur));
            }
            continue;
        }
        let prev = i.checked_sub(1).and_then(|j| chars.get(j)).copied();
        let next = chars.get(i + 1).copied();
        let boundary = c.is_uppercase()
            && prev.is_some_and(|p| p.is_lowercase() || p.is_ascii_digit() || (p.is_uppercase() && next.is_some_and(char::is_lowercase)))
            && !cur.is_empty();
        if boundary {
            words.push(std::mem::take(&mut cur));
        }
        cur.push(c);
    }
    if !cur.is_empty() {
        words.push(cur);
    }
    words
}

fn join_words(s: &str, style: CaseStyle) -> String {
    let words = split_words(s);
    if words.is_empty() {
        return s.to_owned();
    }
    match style {
        CaseStyle::Camel => words
            .iter()
            .enumerate()
            .map(|(i, w)| if i == 0 { w.to_lowercase() } else { cap_first(w) })
            .collect(),
        CaseStyle::Pascal => words.iter().map(|w| cap_first(w)).collect(),
        CaseStyle::Snake => words.iter().map(|w| w.to_lowercase()).collect::<Vec<_>>().join("_"),
        CaseStyle::ScreamingSnake => words.iter().map(|w| w.to_uppercase()).collect::<Vec<_>>().join("_"),
        CaseStyle::Kebab => words.iter().map(|w| w.to_lowercase()).collect::<Vec<_>>().join("-"),
        CaseStyle::Dot => words.iter().map(|w| w.to_lowercase()).collect::<Vec<_>>().join("."),
        CaseStyle::Space => words.iter().map(|w| cap_first(w)).collect::<Vec<_>>().join(" "),
        _ => unreachable!(),
    }
}

fn cap_first(w: &str) -> String {
    let mut chars = w.chars();
    let Some(first) = chars.next() else {
        return String::new();
    };
    let mut out: String = first.to_uppercase().collect();
    out.push_str(&chars.as_str().to_lowercase());
    out
}

fn title_case(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut at_start = true;
    for c in s.chars() {
        if c.is_alphanumeric() {
            if at_start {
                out.extend(c.to_uppercase());
            } else {
                out.extend(c.to_lowercase());
            }
            at_start = false;
        } else {
            out.push(c);
            at_start = true;
        }
    }
    out
}

fn toggle_case(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if c.is_uppercase() {
            out.extend(c.to_lowercase());
        } else if c.is_lowercase() {
            out.extend(c.to_uppercase());
        } else {
            out.push(c);
        }
    }
    out
}

/// Cycles single quotes `'` -> double quotes `"` -> backticks `` ` `` -> `'`.
pub fn swap_quotes(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '\'' => '"',
            '"' => '`',
            '`' => '\'',
            other => other,
        })
        .collect()
}

pub fn wrap_quotes(s: &str, quote: char) -> String {
    let trimmed = s.trim();
    format!("{quote}{}{quote}", unwrap_quotes(trimmed))
}

pub fn unwrap_quotes(s: &str) -> String {
    let t = s.trim();
    for q in ['\'', '"', '`'] {
        if t.len() >= 2 && t.starts_with(q) && t.ends_with(q) {
            return t[1..t.len() - 1].to_owned();
        }
    }
    t.to_owned()
}

pub fn merge_multiline_cmd(s: &str, mode: &str) -> String {
    match mode {
        "and" => s
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .map(|l| l.trim_end_matches('\\').trim_end())
            .collect::<Vec<_>>()
            .join(" && "),
        "semi" => s
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .map(|l| l.trim_end_matches('\\').trim_end())
            .collect::<Vec<_>>()
            .join("; "),
        "split" => {
            let normalized = merge_multiline_cmd(s, "continuation");
            let with_and = normalized.replace(" && ", " \\\n  && ");
            // Split long option flags onto indented continuation lines
            let mut out = String::new();
            for (idx, part) in with_and.split('\n').enumerate() {
                if idx > 0 {
                    out.push('\n');
                }
                let mut cur = String::new();
                for token in part.split_whitespace() {
                    if token.starts_with("--") && !cur.is_empty() && cur != "&&" && !cur.ends_with('\\') {
                        out.push_str(&cur);
                        out.push_str(" \\\n  ");
                        cur.clear();
                    } else if !cur.is_empty() {
                        cur.push(' ');
                    }
                    cur.push_str(token);
                }
                out.push_str(&cur);
            }
            out
        }
        // "continuation": collapse backslash-newline continuations cleanly into one line
        _ => {
            let normalized = s.replace("\r\n", "\n");
            let mut out = String::new();
            for line in normalized.lines() {
                let t = line.trim();
                if t.is_empty() {
                    continue;
                }
                let piece = t.strip_suffix('\\').unwrap_or(t).trim();
                if !out.is_empty() && !piece.is_empty() {
                    out.push(' ');
                }
                out.push_str(piece);
            }
            out
        }
    }
}

pub fn reverse_text(s: &str) -> String {
    s.chars().rev().collect()
}

pub fn step_numbers(s: &str, delta: i64) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let neg = bytes[i] == b'-' && bytes.get(i + 1).is_some_and(u8::is_ascii_digit);
        if bytes[i].is_ascii_digit() || neg {
            let start = i;
            i += usize::from(neg);
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            if let Ok(n) = s[start..i].parse::<i64>() {
                out.push_str(&n.saturating_add(delta).to_string());
            } else {
                out.push_str(&s[start..i]);
            }
        } else {
            let ch = s[i..].chars().next().expect("valid utf-8 boundary");
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

pub fn line_op(s: &str, op: &str, arg: Option<&str>) -> Result<String, Error> {
    let trailing = s.ends_with('\n');
    let body = s.strip_suffix('\n').unwrap_or(s);
    let mut lines: Vec<&str> = if body.is_empty() { Vec::new() } else { body.split('\n').collect() };
    let out = match op {
        "sort" => {
            lines.sort();
            lines.join("\n")
        }
        "sort-desc" => {
            lines.sort_by(|a, b| b.cmp(a));
            lines.join("\n")
        }
        "natural-sort" => {
            lines.sort_by(|a, b| natural_cmp(a, b));
            lines.join("\n")
        }
        "reverse" => {
            lines.reverse();
            lines.join("\n")
        }
        "unique" => {
            let mut seen = HashSet::new();
            lines.retain(|l| seen.insert(*l));
            lines.join("\n")
        }
        "trim" => lines.into_iter().map(str::trim).collect::<Vec<_>>().join("\n"),
        "remove-empty" => lines.into_iter().filter(|l| !l.trim().is_empty()).collect::<Vec<_>>().join("\n"),
        "grep" => {
            let pat = arg.unwrap_or("");
            if pat.is_empty() {
                lines.join("\n")
            } else {
                let re = regex::Regex::new(pat).map_err(|e| Error::Invalid(e.to_string()))?;
                lines.into_iter().filter(|l| re.is_match(l)).collect::<Vec<_>>().join("\n")
            }
        }
        "join" => {
            let sep = arg.unwrap_or(", ");
            lines.join(sep)
        }
        "split" => {
            let sep = arg.unwrap_or(",");
            if sep.is_empty() {
                s.to_owned()
            } else {
                return Ok(s.split(sep).map(str::trim).collect::<Vec<_>>().join("\n"));
            }
        }
        "number-lines" => lines
            .into_iter()
            .enumerate()
            .map(|(i, l)| format!("{}. {l}", i + 1))
            .collect::<Vec<_>>()
            .join("\n"),
        "invert-grep" => {
            let pat = arg.unwrap_or("");
            if pat.is_empty() {
                lines.join("\n")
            } else {
                let re = regex::Regex::new(pat).map_err(|e| Error::Invalid(e.to_string()))?;
                lines.into_iter().filter(|l| !re.is_match(l)).collect::<Vec<_>>().join("\n")
            }
        }
        "prefix" => {
            let pfx = arg.unwrap_or("");
            lines.into_iter().map(|l| format!("{pfx}{l}")).collect::<Vec<_>>().join("\n")
        }
        "suffix" => {
            let sfx = arg.unwrap_or("");
            lines.into_iter().map(|l| format!("{l}{sfx}")).collect::<Vec<_>>().join("\n")
        }
        "freq" => {
            let mut counts: std::collections::BTreeMap<&str, usize> = std::collections::BTreeMap::new();
            for l in &lines {
                *counts.entry(l).or_insert(0) += 1;
            }
            let mut ranked: Vec<(&str, usize)> = counts.into_iter().collect();
            ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
            ranked
                .into_iter()
                .map(|(l, n)| format!("{n}\t{l}"))
                .collect::<Vec<_>>()
                .join("\n")
        }
        "swap-delim" => {
            let delim = arg.filter(|d| !d.is_empty()).unwrap_or("=");
            lines
                .into_iter()
                .map(|l| match l.split_once(delim) {
                    Some((left, right)) => format!("{} {delim} {}", right.trim(), left.trim()),
                    None => l.to_owned(),
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
        "align-delim" => {
            let delim = arg.filter(|d| !d.is_empty()).unwrap_or("=");
            let parsed: Vec<Option<(&str, &str)>> = lines.iter().map(|l| l.split_once(delim)).collect();
            let max_left = parsed
                .iter()
                .filter_map(|p| p.map(|(l, _)| l.trim_end().chars().count()))
                .max()
                .unwrap_or(0);
            lines
                .into_iter()
                .zip(parsed)
                .map(|(raw, pair)| match pair {
                    Some((l, r)) => {
                        let lt = l.trim_end();
                        let pad = max_left.saturating_sub(lt.chars().count());
                        format!("{lt}{} {delim} {}", " ".repeat(pad), r.trim_start())
                    }
                    None => raw.to_owned(),
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
        "merge-cmd" => return Ok(merge_multiline_cmd(s, arg.unwrap_or("continuation"))),
        "duplicates-only" => {
            let mut counts: HashMap<&str, usize> = HashMap::new();
            for l in &lines {
                *counts.entry(l).or_insert(0) += 1;
            }
            let mut emitted = HashSet::new();
            lines
                .into_iter()
                .filter(|l| counts.get(l).copied().unwrap_or(0) >= 2 && emitted.insert(*l))
                .collect::<Vec<_>>()
                .join("\n")
        }
        "shuffle" => {
            let mut rng = rand::rng();
            for i in (1..lines.len()).rev() {
                let j = rng.random_range(0..=i);
                lines.swap(i, j);
            }
            lines.join("\n")
        }
        "reverse-words" => lines
            .into_iter()
            .map(|l| l.split_whitespace().rev().collect::<Vec<_>>().join(" "))
            .collect::<Vec<_>>()
            .join("\n"),
        "swap-words" => lines
            .into_iter()
            .map(|l| {
                let mut words: Vec<&str> = l.split_whitespace().collect();
                if words.len() >= 2 {
                    words.swap(0, 1);
                    words.join(" ")
                } else {
                    l.to_owned()
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        "extract-column" => {
            let raw_arg = arg.unwrap_or("1").trim();
            let (delim, col_str) = if let Some((d, c)) = raw_arg.rsplit_once(':') {
                let resolved = if d == r"\t" { "\t" } else { d };
                (resolved, c.trim())
            } else {
                ("", raw_arg)
            };
            let col_idx = if col_str.is_empty() {
                1usize
            } else {
                col_str
                    .parse::<usize>()
                    .map_err(|_| Error::Invalid("Column index must be a positive integer (e.g. 2 or ,:2)".into()))?
            };
            if col_idx == 0 {
                return Err(Error::Invalid("Column index is 1-based (>= 1)".into()));
            }
            lines
                .into_iter()
                .map(|l| {
                    if delim.is_empty() {
                        l.split_whitespace().nth(col_idx - 1).unwrap_or("").to_owned()
                    } else {
                        l.split(delim).nth(col_idx - 1).map(|cell| cell.trim().to_owned()).unwrap_or_default()
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
        "wrap-lines" => {
            let raw_width = arg.unwrap_or("80").trim();
            let width = if raw_width.is_empty() {
                80usize
            } else {
                raw_width
                    .parse::<usize>()
                    .map_err(|_| Error::Invalid("Line wrap width must be a positive integer".into()))?
            }
            .clamp(10, 1000);
            lines
                .into_iter()
                .map(|l| wrap_single_line(l, width))
                .collect::<Vec<_>>()
                .join("\n")
        }
        _ => return Err(Error::Invalid(format!("unknown line op {op}"))),
    };
    if trailing && !out.is_empty() && op != "join" {
        Ok(format!("{out}\n"))
    } else {
        Ok(out)
    }
}

fn wrap_single_line(line: &str, width: usize) -> String {
    let words: Vec<&str> = line.split_whitespace().collect();
    if words.is_empty() {
        return String::new();
    }
    let mut out_lines: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut cur_len = 0usize;

    for word in words {
        let wlen = word.chars().count();
        if wlen > width {
            if !current.is_empty() {
                out_lines.push(std::mem::take(&mut current));
                cur_len = 0;
            }
            let mut chunk = String::new();
            let mut clen = 0usize;
            for ch in word.chars() {
                chunk.push(ch);
                clen += 1;
                if clen == width {
                    out_lines.push(std::mem::take(&mut chunk));
                    clen = 0;
                }
            }
            if !chunk.is_empty() {
                current = chunk;
                cur_len = clen;
            }
        } else if current.is_empty() {
            current.push_str(word);
            cur_len = wlen;
        } else if cur_len + 1 + wlen <= width {
            current.push(' ');
            current.push_str(word);
            cur_len += 1 + wlen;
        } else {
            out_lines.push(std::mem::take(&mut current));
            current.push_str(word);
            cur_len = wlen;
        }
    }
    if !current.is_empty() {
        out_lines.push(current);
    }
    out_lines.join("\n")
}

fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let mut ia = 0;
    let mut ib = 0;
    let ba = a.as_bytes();
    let bb = b.as_bytes();
    while ia < ba.len() && ib < bb.len() {
        if ba[ia].is_ascii_digit() && bb[ib].is_ascii_digit() {
            let sa = ia;
            while ia < ba.len() && ba[ia].is_ascii_digit() {
                ia += 1;
            }
            let sb = ib;
            while ib < bb.len() && bb[ib].is_ascii_digit() {
                ib += 1;
            }
            let na = a[sa..ia].trim_start_matches('0');
            let nb = b[sb..ib].trim_start_matches('0');
            let ord = na.len().cmp(&nb.len()).then_with(|| na.cmp(nb));
            if ord != std::cmp::Ordering::Equal {
                return ord;
            }
        } else {
            let ca = a[ia..].chars().next().unwrap();
            let cb = b[ib..].chars().next().unwrap();
            let ord = ca.cmp(&cb);
            if ord != std::cmp::Ordering::Equal {
                return ord;
            }
            ia += ca.len_utf8();
            ib += cb.len_utf8();
        }
    }
    ba.len().cmp(&bb.len())
}

pub fn escape_text(s: &str, lang: &str) -> Result<String, Error> {
    Ok(match lang {
        "json" => openidea_plugin::text::escape_json(s),
        "java" | "javascript" | "js" | "php" => escape_c_style(s, lang == "java"),
        "xml" | "html" => escape_xml(s, lang == "xml"),
        "sql" => s.replace('\'', "''"),
        "unicode" => escape_unicode(s),
        _ => return Err(Error::Invalid(format!("unsupported escape language {lang}"))),
    })
}

pub fn unescape_text(s: &str, lang: &str) -> Result<String, Error> {
    Ok(match lang {
        "json" | "java" | "javascript" | "js" | "php" => unescape_c_style(s),
        "xml" | "html" => unescape_xml(s),
        "sql" => s.replace("''", "'"),
        "unicode" => unescape_unicode(s),
        _ => return Err(Error::Invalid(format!("unsupported unescape language {lang}"))),
    })
}

fn escape_c_style(s: &str, java_u_only: bool) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0C}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 || (!c.is_ascii() && java_u_only) => {
                if (c as u32) <= 0xFFFF {
                    out.push_str(&format!("\\u{:04x}", c as u32));
                } else {
                    let mut buf = [0u16; 2];
                    for u in c.encode_utf16(&mut buf) {
                        out.push_str(&format!("\\u{u:04x}"));
                    }
                }
            }
            c => out.push(c),
        }
    }
    out
}

fn unescape_c_style(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            Some('b') => out.push('\u{08}'),
            Some('f') => out.push('\u{0C}'),
            Some('\\') => out.push('\\'),
            Some('"') => out.push('"'),
            Some('\'') => out.push('\''),
            Some('u') => {
                let rest = chars.as_str();
                if let Some(braced) = rest.strip_prefix('{').and_then(|r| r.split_once('}')) {
                    if let Ok(code) = u32::from_str_radix(braced.0, 16) {
                        if let Some(ch) = char::from_u32(code) {
                            out.push(ch);
                            for _ in 0..(braced.0.len() + 2) {
                                chars.next();
                            }
                            continue;
                        }
                    }
                }
                let hex: String = chars.by_ref().take(4).collect();
                if let Ok(mut code) = u32::from_str_radix(&hex, 16) {
                    if (0xD800..=0xDBFF).contains(&code) {
                        let tail = chars.as_str();
                        if tail.starts_with("\\u") && tail.len() >= 6 {
                            if let Ok(low) = u32::from_str_radix(&tail[2..6], 16) {
                                if (0xDC00..=0xDFFF).contains(&low) {
                                    code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                                    for _ in 0..6 {
                                        chars.next();
                                    }
                                }
                            }
                        }
                    }
                    out.push(char::from_u32(code).unwrap_or('\u{FFFD}'));
                } else {
                    out.push_str("\\u");
                    out.push_str(&hex);
                }
            }
            Some('x') => {
                let hex: String = chars.by_ref().take(2).collect();
                if let Ok(code) = u32::from_str_radix(&hex, 16) {
                    out.push(char::from_u32(code).unwrap_or('\u{FFFD}'));
                } else {
                    out.push_str("\\x");
                    out.push_str(&hex);
                }
            }
            Some(other) => out.push(other),
            None => out.push('\\'),
        }
    }
    out
}

pub fn escape_unicode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if c.is_ascii() && !c.is_control() {
            out.push(c);
        } else {
            let mut buf = [0u16; 2];
            for u in c.encode_utf16(&mut buf) {
                out.push_str(&format!("\\u{u:04x}"));
            }
        }
    }
    out
}

pub fn unescape_unicode(s: &str) -> String {
    unescape_c_style(s)
}

pub fn escape_xml(s: &str, apos: bool) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str(if apos { "&apos;" } else { "&#39;" }),
            other => out.push(other),
        }
    }
    out
}

pub fn unescape_xml(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while let Some(amp) = s[i..].find('&') {
        out.push_str(&s[i..i + amp]);
        let rest = &s[i + amp..];
        if let Some(semi) = rest.find(';').filter(|&p| p <= 12) {
            let entity = &rest[1..semi];
            let decoded = match entity {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some('\u{00A0}'),
                _ if entity.starts_with("#x") || entity.starts_with("#X") => {
                    u32::from_str_radix(&entity[2..], 16).ok().and_then(char::from_u32)
                }
                _ if entity.starts_with('#') => entity[1..].parse::<u32>().ok().and_then(char::from_u32),
                _ => None,
            };
            if let Some(ch) = decoded {
                out.push(ch);
                i += amp + semi + 1;
                continue;
            }
        }
        out.push('&');
        i += amp + 1;
    }
    out.push_str(&s[i..]);
    out
}
