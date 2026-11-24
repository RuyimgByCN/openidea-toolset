use openidea_plugin::Error;
use quick_xml::events::Event;
use quick_xml::{Reader, XmlVersion};
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;

const MAX_XML_BYTES: usize = 2 * 1024 * 1024;
const MAX_MATCHES: usize = 500;
const MAX_OUTER_PREVIEW: usize = 1200;

#[derive(Clone, Debug)]
struct XmlNode {
    parent: Option<usize>,
    tag: String,
    attrs: Vec<(String, String)>,
    children: Vec<XmlChild>,
    xpath: String,
}

#[derive(Clone, Debug)]
enum XmlChild {
    Element(usize),
    Text(String),
}

struct XmlDoc {
    nodes: Vec<XmlNode>,
    roots: Vec<usize>,
}

impl XmlDoc {
    fn node(&self, id: usize) -> &XmlNode {
        &self.nodes[id]
    }

    fn text_content(&self, id: usize) -> String {
        let mut buf = String::new();
        self.collect_text(id, &mut buf);
        buf
    }

    fn collect_text(&self, id: usize, buf: &mut String) {
        for ch in &self.nodes[id].children {
            match ch {
                XmlChild::Text(t) => buf.push_str(t),
                XmlChild::Element(cid) => self.collect_text(*cid, buf),
            }
        }
    }

    fn attr(&self, id: usize, name: &str) -> Option<&str> {
        self.nodes[id]
            .attrs
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }

    fn child_elements(&self, id: usize) -> Vec<usize> {
        self.nodes[id]
            .children
            .iter()
            .filter_map(|c| match c {
                XmlChild::Element(cid) => Some(*cid),
                XmlChild::Text(_) => None,
            })
            .collect()
    }

    fn descendants(&self, id: usize, out: &mut Vec<usize>) {
        for cid in self.child_elements(id) {
            out.push(cid);
            self.descendants(cid, out);
        }
    }

    fn element_siblings_index(&self, id: usize) -> (usize, usize) {
        let sibs = match self.nodes[id].parent {
            Some(pid) => self.child_elements(pid),
            None => self.roots.clone(),
        };
        let pos = sibs.iter().position(|&x| x == id).unwrap_or(0);
        (pos, sibs.len())
    }

    fn serialize_outer(&self, id: usize, limit: usize) -> String {
        let mut buf = String::new();
        self.write_outer(id, &mut buf, limit);
        if buf.len() > limit {
            let mut end = limit;
            while end > 0 && !buf.is_char_boundary(end) {
                end -= 1;
            }
            buf.truncate(end);
            buf.push_str("...");
        }
        buf
    }

    fn write_outer(&self, id: usize, out: &mut String, limit: usize) {
        if out.len() > limit {
            return;
        }
        let n = &self.nodes[id];
        out.push('<');
        out.push_str(&n.tag);
        for (k, v) in &n.attrs {
            out.push(' ');
            out.push_str(k);
            out.push_str("=\"");
            out.push_str(&escape_attr(v));
            out.push('"');
        }
        if n.children.is_empty() {
            out.push_str("/>");
            return;
        }
        out.push('>');
        for ch in &n.children {
            if out.len() > limit {
                break;
            }
            match ch {
                XmlChild::Text(t) => out.push_str(t),
                XmlChild::Element(cid) => self.write_outer(*cid, out, limit),
            }
        }
        out.push_str("</");
        out.push_str(&n.tag);
        out.push('>');
    }
}

fn escape_attr(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn is_html_void(tag: &str) -> bool {
    matches!(
        tag.to_ascii_lowercase().as_str(),
        "area" | "base" | "br" | "col" | "embed" | "hr" | "img" | "input" | "link" | "meta" | "param" | "source" | "track" | "wbr"
    )
}

fn parse_doc(input: &str, html_mode: bool) -> Result<XmlDoc, Error> {
    if input.len() > MAX_XML_BYTES {
        return Err(Error::Invalid("XML/HTML input exceeds 2 MiB limit".into()));
    }
    if input.trim().is_empty() {
        return Err(Error::Invalid("XML/HTML input is empty".into()));
    }

    let mut reader = Reader::from_str(input);
    reader.config_mut().trim_text(false);
    if html_mode {
        reader.config_mut().check_end_names = false;
        reader.config_mut().allow_unmatched_ends = true;
    }

    let mut doc = XmlDoc {
        nodes: Vec::new(),
        roots: Vec::new(),
    };
    let mut stack: Vec<usize> = Vec::new();

    let alloc_node = |doc: &mut XmlDoc, parent: Option<usize>, tag: String, attrs: Vec<(String, String)>| -> usize {
        let id = doc.nodes.len();
        let parent_prefix = parent.map(|p| doc.nodes[p].xpath.clone()).unwrap_or_default();
        let same_tag_sibs = match parent {
            Some(pid) => doc.nodes[pid]
                .children
                .iter()
                .filter(|c| matches!(c, XmlChild::Element(cid) if doc.nodes[*cid].tag == tag))
                .count(),
            None => doc
                .roots
                .iter()
                .filter(|&&cid| doc.nodes[cid].tag == tag)
                .count(),
        };
        let total_sibs_note = same_tag_sibs + 1;
        let xpath = format!("{parent_prefix}/{tag}[{total_sibs_note}]");
        doc.nodes.push(XmlNode {
            parent,
            tag,
            attrs,
            children: Vec::new(),
            xpath,
        });
        if let Some(pid) = parent {
            doc.nodes[pid].children.push(XmlChild::Element(id));
        } else {
            doc.roots.push(id);
        }
        id
    };

    let read_attrs = |e: &quick_xml::events::BytesStart<'_>| -> Result<Vec<(String, String)>, Error> {
        let mut attrs = Vec::new();
        for a in e.attributes().flatten() {
            let k = a.key.as_ref().to_owned();
            let v = a
                .normalized_value(XmlVersion::Implicit1_0)
                .map_err(|err| Error::Invalid(err.to_string()))?
                .into_owned();
            attrs.push((k, v));
        }
        Ok(attrs)
    };

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let tag = e.name().as_ref().to_owned();
                let attrs = read_attrs(&e)?;
                let parent = stack.last().copied();
                let id = alloc_node(&mut doc, parent, tag.clone(), attrs);
                if !(html_mode && is_html_void(&tag)) {
                    stack.push(id);
                }
            }
            Ok(Event::Empty(e)) => {
                let tag = e.name().as_ref().to_owned();
                let attrs = read_attrs(&e)?;
                let parent = stack.last().copied();
                alloc_node(&mut doc, parent, tag, attrs);
            }
            Ok(Event::Text(e)) => {
                let txt = quick_xml::escape::unescape(e.as_ref())
                    .map_err(|err| Error::Invalid(err.to_string()))?
                    .into_owned();
                if !txt.is_empty()
                    && let Some(&top) = stack.last()
                {
                    doc.nodes[top].children.push(XmlChild::Text(txt));
                }
            }
            Ok(Event::CData(e)) => {
                let txt = e.as_ref().to_owned();
                if !txt.is_empty()
                    && let Some(&top) = stack.last()
                {
                    doc.nodes[top].children.push(XmlChild::Text(txt));
                }
            }
            Ok(Event::End(e)) => {
                let end_tag = e.name().as_ref().to_owned();
                if html_mode {
                    if is_html_void(&end_tag) {
                        continue;
                    }
                    if let Some(pos) = stack.iter().rposition(|&id| doc.nodes[id].tag.eq_ignore_ascii_case(&end_tag)) {
                        stack.truncate(pos);
                    }
                } else {
                    stack.pop();
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err(Error::Invalid(format!("Invalid XML/HTML syntax: {e}"))),
        }
    }

    if doc.roots.is_empty() {
        return Err(Error::Invalid("No root XML/HTML elements found".into()));
    }
    Ok(doc)
}

#[derive(Clone, Debug)]
enum QueryResultItem {
    Element(usize),
    Attr { node_id: usize, name: String, value: String },
    Text { node_id: usize, value: String },
}

pub fn query_xml(input: &str, query: &str, mode: &str, html_mode: bool) -> Result<Value, Error> {
    let doc = parse_doc(input, html_mode)?;
    let q_trimmed = query.trim();
    if q_trimmed.is_empty() {
        return Err(Error::Invalid("Query expression cannot be empty".into()));
    }

    let normalized_mode = if mode.eq_ignore_ascii_case("css") { "css" } else { "xpath" };

    let mut scalar: Option<Value> = None;
    let items: Vec<QueryResultItem> = if normalized_mode == "css" {
        eval_css_query(&doc, q_trimmed)?
            .into_iter()
            .map(QueryResultItem::Element)
            .collect()
    } else if let Some(inner) = strip_fn_call(q_trimmed, "count") {
        let matched = eval_xpath_union(&doc, inner)?;
        scalar = Some(json!(matched.len()));
        Vec::new()
    } else if let Some(inner) = strip_fn_call(q_trimmed, "string") {
        let matched = eval_xpath_union(&doc, inner)?;
        let txt = matched
            .first()
            .map(|item| item_text(&doc, item))
            .unwrap_or_default();
        scalar = Some(Value::String(txt));
        Vec::new()
    } else {
        eval_xpath_union(&doc, q_trimmed)?
    };

    let total_matches = if scalar.is_some() {
        scalar.as_ref().and_then(Value::as_u64).unwrap_or(1) as usize
    } else {
        items.len()
    };
    let truncated = items.len() > MAX_MATCHES;
    let matches_json: Vec<Value> = items
        .into_iter()
        .take(MAX_MATCHES)
        .map(|item| match item {
            QueryResultItem::Element(id) => {
                let n = doc.node(id);
                let mut attr_map = Map::new();
                for (k, v) in &n.attrs {
                    attr_map.insert(k.clone(), Value::String(v.clone()));
                }
                let txt = doc.text_content(id);
                json!({
                    "kind": "element",
                    "path": n.xpath,
                    "tag": n.tag,
                    "value": txt.trim(),
                    "text": txt,
                    "attrs": attr_map,
                    "outerXml": doc.serialize_outer(id, MAX_OUTER_PREVIEW),
                })
            }
            QueryResultItem::Attr { node_id, name, value } => {
                let n = doc.node(node_id);
                json!({
                    "kind": "attr",
                    "path": format!("{}/@{name}", n.xpath),
                    "tag": n.tag,
                    "name": name,
                    "value": value,
                    "text": value,
                    "attrs": {},
                    "outerXml": format!("@{name}=\"{value}\""),
                })
            }
            QueryResultItem::Text { node_id, value } => {
                let n = doc.node(node_id);
                json!({
                    "kind": "text",
                    "path": format!("{}/text()", n.xpath),
                    "tag": n.tag,
                    "value": value.trim(),
                    "text": value,
                    "attrs": {},
                    "outerXml": value.trim(),
                })
            }
        })
        .collect();

    Ok(json!({
        "mode": normalized_mode,
        "query": q_trimmed,
        "count": total_matches,
        "totalMatches": total_matches,
        "truncated": truncated,
        "scalar": scalar,
        "rootTag": doc.roots.first().map(|&id| doc.node(id).tag.clone()).unwrap_or_default(),
        "elementCount": doc.nodes.len(),
        "matches": matches_json,
    }))
}

fn item_text(doc: &XmlDoc, item: &QueryResultItem) -> String {
    match item {
        QueryResultItem::Element(id) => doc.text_content(*id),
        QueryResultItem::Attr { value, .. } => value.clone(),
        QueryResultItem::Text { value, .. } => value.clone(),
    }
}

fn strip_fn_call<'a>(expr: &'a str, fn_name: &str) -> Option<&'a str> {
    let t = expr.trim();
    let prefix = format!("{fn_name}(");
    if t.starts_with(&prefix) && t.ends_with(')') {
        Some(t[prefix.len()..t.len() - 1].trim())
    } else {
        None
    }
}

fn split_top_level(input: &str, sep: char) -> Vec<String> {
    let mut parts = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut bracket_depth = 0usize;
    let mut paren_depth = 0usize;

    for ch in input.chars() {
        if let Some(q) = quote {
            cur.push(ch);
            if ch == q {
                quote = None;
            }
            continue;
        }
        match ch {
            '\'' | '"' => {
                quote = Some(ch);
                cur.push(ch);
            }
            '[' => {
                bracket_depth += 1;
                cur.push(ch);
            }
            ']' => {
                bracket_depth = bracket_depth.saturating_sub(1);
                cur.push(ch);
            }
            '(' => {
                paren_depth += 1;
                cur.push(ch);
            }
            ')' => {
                paren_depth = paren_depth.saturating_sub(1);
                cur.push(ch);
            }
            c if c == sep && bracket_depth == 0 && paren_depth == 0 => {
                if !cur.trim().is_empty() {
                    parts.push(cur.trim().to_owned());
                }
                cur.clear();
            }
            _ => cur.push(ch),
        }
    }
    if !cur.trim().is_empty() {
        parts.push(cur.trim().to_owned());
    }
    parts
}

// --- XPath Engine ---

#[derive(Clone, Debug)]
struct XPathStep {
    descendant: bool,
    test: String,
    predicates: Vec<String>,
}

fn eval_xpath_union(doc: &XmlDoc, expr: &str) -> Result<Vec<QueryResultItem>, Error> {
    let branches = split_top_level(expr, '|');
    if branches.is_empty() {
        return Err(Error::Invalid("Empty XPath expression".into()));
    }
    let mut out = Vec::new();
    let mut seen_elems = BTreeSet::new();
    for branch in branches {
        for item in eval_xpath_single(doc, &branch)? {
            match &item {
                QueryResultItem::Element(id) => {
                    if seen_elems.insert(*id) {
                        out.push(item);
                    }
                }
                _ => out.push(item),
            }
        }
    }
    Ok(out)
}

fn parse_xpath_steps(expr: &str) -> Result<Vec<XPathStep>, Error> {
    let bytes = expr.as_bytes();
    let mut i = 0;
    let mut steps = Vec::new();
    while i < bytes.len() {
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let mut descendant = false;
        if expr[i..].starts_with("//") {
            descendant = true;
            i += 2;
        } else if expr[i..].starts_with('/') {
            i += 1;
        }
        let mut test = String::new();
        let mut quote: Option<char> = None;
        while i < bytes.len() {
            let ch = expr[i..].chars().next().unwrap();
            if let Some(q) = quote {
                test.push(ch);
                i += ch.len_utf8();
                if ch == q {
                    quote = None;
                }
                continue;
            }
            if ch == '/' || ch == '[' {
                break;
            }
            if ch == '\'' || ch == '"' {
                quote = Some(ch);
            }
            test.push(ch);
            i += ch.len_utf8();
        }
        let test = test.trim().to_owned();
        if test.is_empty() {
            return Err(Error::Invalid(format!("Invalid XPath step near byte {i}")));
        }

        let mut predicates = Vec::new();
        while i < bytes.len() && bytes[i] == b'[' {
            i += 1;
            let start = i;
            let mut depth = 1usize;
            let mut q: Option<char> = None;
            while i < bytes.len() && depth > 0 {
                let ch = expr[i..].chars().next().unwrap();
                if let Some(qc) = q {
                    if ch == qc {
                        q = None;
                    }
                } else {
                    match ch {
                        '\'' | '"' => q = Some(ch),
                        '[' => depth += 1,
                        ']' => depth -= 1,
                        _ => {}
                    }
                }
                i += ch.len_utf8();
            }
            if depth != 0 {
                return Err(Error::Invalid("Unclosed '[' predicate in XPath".into()));
            }
            let pred = expr[start..i - 1].trim().to_owned();
            if !pred.is_empty() {
                predicates.push(pred);
            }
        }
        steps.push(XPathStep {
            descendant,
            test,
            predicates,
        });
    }
    if steps.is_empty() {
        return Err(Error::Invalid("Empty XPath steps".into()));
    }
    Ok(steps)
}

fn eval_xpath_single(doc: &XmlDoc, expr: &str) -> Result<Vec<QueryResultItem>, Error> {
    let steps = parse_xpath_steps(expr)?;
    let first_absolute = expr.trim_start().starts_with('/');

    // Track candidates as node IDs until a terminal attr/text step if present.
    let mut current: Option<Vec<usize>> = if first_absolute {
        None // meaning document root context
    } else {
        Some(doc.roots.clone())
    };

    for (idx, step) in steps.iter().enumerate() {
        let is_last = idx + 1 == steps.len();
        let test = step.test.as_str();

        if test == "text()" {
            if !is_last {
                return Err(Error::Invalid("text() is only supported as the final step".into()));
            }
            let base = resolve_bases(doc, &current, step.descendant);
            let mut results = Vec::new();
            for nid in base {
                let txt = doc.text_content(nid);
                if !txt.trim().is_empty() {
                    results.push(QueryResultItem::Text { node_id: nid, value: txt });
                }
            }
            return Ok(results);
        }

        if let Some(attr_name) = test.strip_prefix('@') {
            if !is_last {
                return Err(Error::Invalid("@attribute is only supported as the final step".into()));
            }
            let base = resolve_bases(doc, &current, step.descendant);
            let mut results = Vec::new();
            for nid in base {
                if attr_name == "*" {
                    for (k, v) in &doc.node(nid).attrs {
                        results.push(QueryResultItem::Attr {
                            node_id: nid,
                            name: k.clone(),
                            value: v.clone(),
                        });
                    }
                } else if let Some(val) = doc.attr(nid, attr_name) {
                    results.push(QueryResultItem::Attr {
                        node_id: nid,
                        name: attr_name.to_owned(),
                        value: val.to_owned(),
                    });
                }
            }
            return Ok(results);
        }

        let next_nodes: Vec<usize> = match (&current, step.descendant) {
            (None, false) => {
                // Step `/tag` directly matches root element(s)
                if test == "." {
                    doc.roots.clone()
                } else {
                    doc.roots
                        .iter()
                        .copied()
                        .filter(|&id| match_tag(&doc.node(id).tag, test))
                        .collect()
                }
            }
            (None, true) => {
                // Step `//tag` searches roots + all descendants
                let mut pool = Vec::new();
                for &r in &doc.roots {
                    pool.push(r);
                    doc.descendants(r, &mut pool);
                }
                pool.into_iter()
                    .filter(|&id| match_tag(&doc.node(id).tag, test))
                    .collect()
            }
            (Some(prev), false) => {
                if test == "." {
                    prev.clone()
                } else if test == ".." {
                    let mut seen = BTreeSet::new();
                    prev.iter()
                        .filter_map(|&id| doc.node(id).parent)
                        .filter(|pid| seen.insert(*pid))
                        .collect()
                } else {
                    let mut out = Vec::new();
                    for &pid in prev {
                        for cid in doc.child_elements(pid) {
                            if match_tag(&doc.node(cid).tag, test) {
                                out.push(cid);
                            }
                        }
                    }
                    out
                }
            }
            (Some(prev), true) => {
                let mut seen = BTreeSet::new();
                let mut out = Vec::new();
                for &pid in prev {
                    let mut pool = Vec::new();
                    pool.push(pid);
                    doc.descendants(pid, &mut pool);
                    for cid in pool {
                        if match_tag(&doc.node(cid).tag, test) && seen.insert(cid) {
                            out.push(cid);
                        }
                    }
                }
                out
            }
        };

        let filtered = apply_xpath_predicates(doc, next_nodes, &step.predicates)?;
        current = Some(filtered);
    }

    Ok(current
        .unwrap_or_default()
        .into_iter()
        .map(QueryResultItem::Element)
        .collect())
}

fn resolve_bases(doc: &XmlDoc, current: &Option<Vec<usize>>, descendant: bool) -> Vec<usize> {
    let base = match current {
        None => doc.roots.clone(),
        Some(v) => v.clone(),
    };
    if !descendant {
        return base;
    }
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for id in base {
        if seen.insert(id) {
            out.push(id);
        }
        let mut desc = Vec::new();
        doc.descendants(id, &mut desc);
        for d in desc {
            if seen.insert(d) {
                out.push(d);
            }
        }
    }
    out
}

fn match_tag(actual: &str, expected: &str) -> bool {
    expected == "*" || actual == expected || actual.rsplit(':').next() == Some(expected)
}

fn apply_xpath_predicates(doc: &XmlDoc, mut nodes: Vec<usize>, predicates: &[String]) -> Result<Vec<usize>, Error> {
    for pred in predicates {
        let p = pred.trim();
        if p == "last()" {
            if let Some(&last) = nodes.last() {
                nodes = vec![last];
            } else {
                nodes.clear();
            }
            continue;
        }
        if let Some(rest) = p.strip_prefix("last()-") {
            let offset: usize = rest
                .trim()
                .parse()
                .map_err(|_| Error::Invalid(format!("Invalid last() offset in [{p}]")))?;
            let target = nodes.len().checked_sub(offset + 1).and_then(|idx| nodes.get(idx).copied());
            nodes = target.into_iter().collect();
            continue;
        }
        if let Ok(pos) = p.parse::<usize>() {
            if pos == 0 {
                return Err(Error::Invalid("XPath position index is 1-based (>= 1)".into()));
            }
            nodes = nodes.get(pos - 1).copied().into_iter().collect();
            continue;
        }
        nodes.retain(|&id| eval_xpath_predicate(doc, id, p));
    }
    Ok(nodes)
}

fn eval_xpath_predicate(doc: &XmlDoc, id: usize, pred: &str) -> bool {
    // Support simple `and` combinations
    if let Some((lhs, rhs)) = split_predicate_and(pred) {
        return eval_xpath_predicate(doc, id, lhs) && eval_xpath_predicate(doc, id, rhs);
    }

    if let Some(inner) = strip_fn_call(pred, "contains")
        && let Some((a, b)) = split_two_args(inner)
    {
        let hay = eval_xpath_operand(doc, id, a);
        let needle = unquote_literal(b);
        return hay.contains(&needle);
    }
    if let Some(inner) = strip_fn_call(pred, "starts-with")
        && let Some((a, b)) = split_two_args(inner)
    {
        let hay = eval_xpath_operand(doc, id, a);
        let prefix = unquote_literal(b);
        return hay.starts_with(&prefix);
    }
    if let Some((lhs, rhs)) = pred.split_once("!=") {
        let val = eval_xpath_operand(doc, id, lhs.trim());
        let target = unquote_literal(rhs.trim());
        return val != target;
    }
    if let Some((lhs, rhs)) = pred.split_once('=') {
        let val = eval_xpath_operand(doc, id, lhs.trim());
        let target = unquote_literal(rhs.trim());
        return val == target;
    }
    if let Some(attr_name) = pred.strip_prefix('@') {
        return doc.attr(id, attr_name.trim()).is_some();
    }
    false
}

fn split_predicate_and(pred: &str) -> Option<(&str, &str)> {
    let mut quote: Option<char> = None;
    let mut paren = 0usize;
    let bytes = pred.as_bytes();
    for (i, ch) in pred.char_indices() {
        if let Some(q) = quote {
            if ch == q {
                quote = None;
            }
            continue;
        }
        match ch {
            '\'' | '"' => quote = Some(ch),
            '(' => paren += 1,
            ')' => paren = paren.saturating_sub(1),
            _ if paren == 0 && pred[i..].starts_with(" and ") && i > 0 => {
                return Some((&pred[..i], &pred[i + 5..]));
            }
            _ => {
                let _ = bytes;
            }
        }
    }
    None
}

fn split_two_args(inner: &str) -> Option<(&str, &str)> {
    let mut quote: Option<char> = None;
    let mut paren = 0usize;
    for (i, ch) in inner.char_indices() {
        if let Some(q) = quote {
            if ch == q {
                quote = None;
            }
            continue;
        }
        match ch {
            '\'' | '"' => quote = Some(ch),
            '(' => paren += 1,
            ')' => paren = paren.saturating_sub(1),
            ',' if paren == 0 => return Some((inner[..i].trim(), inner[i + 1..].trim())),
            _ => {}
        }
    }
    None
}

fn eval_xpath_operand(doc: &XmlDoc, id: usize, op: &str) -> String {
    if let Some(attr) = op.strip_prefix('@') {
        return doc.attr(id, attr.trim()).unwrap_or("").to_owned();
    }
    if op == "text()" || op == "." {
        return doc.text_content(id).trim().to_owned();
    }
    doc.child_elements(id)
        .into_iter()
        .find(|&cid| match_tag(&doc.node(cid).tag, op))
        .map(|cid| doc.text_content(cid).trim().to_owned())
        .unwrap_or_default()
}

fn unquote_literal(raw: &str) -> String {
    let t = raw.trim();
    if t.len() >= 2 && ((t.starts_with('\'') && t.ends_with('\'')) || (t.starts_with('"') && t.ends_with('"'))) {
        t[1..t.len() - 1].to_owned()
    } else {
        t.to_owned()
    }
}

// --- CSS Selector Engine ---

#[derive(Clone, Copy, PartialEq, Eq)]
enum CssComb {
    Descendant,
    Child,
    NextSibling,
    FollowingSibling,
}

struct CssPart {
    comb: Option<CssComb>,
    simple: CssSimple,
}

#[derive(Default)]
struct CssSimple {
    tag: Option<String>,
    id: Option<String>,
    classes: Vec<String>,
    attrs: Vec<(String, String, String)>, // (name, op, val)
    pseudos: Vec<String>,
}

fn eval_css_query(doc: &XmlDoc, query: &str) -> Result<Vec<usize>, Error> {
    let groups = split_top_level(query, ',');
    if groups.is_empty() {
        return Err(Error::Invalid("Empty CSS selector".into()));
    }
    let mut matched_ids = BTreeSet::new();
    for g in groups {
        let chain = parse_css_chain(&g)?;
        for id in 0..doc.nodes.len() {
            if matches_css_chain(doc, id, &chain, chain.len() - 1) {
                matched_ids.insert(id);
            }
        }
    }
    Ok(matched_ids.into_iter().collect())
}

fn parse_css_chain(sel: &str) -> Result<Vec<CssPart>, Error> {
    let mut parts: Vec<CssPart> = Vec::new();
    let mut i = 0;
    let bytes = sel.as_bytes();
    let mut pending_comb: Option<CssComb> = None;

    while i < bytes.len() {
        let mut saw_space = false;
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            saw_space = true;
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        if !parts.is_empty() && saw_space && pending_comb.is_none() {
            pending_comb = Some(CssComb::Descendant);
        }
        match bytes[i] {
            b'>' => {
                pending_comb = Some(CssComb::Child);
                i += 1;
                continue;
            }
            b'+' => {
                pending_comb = Some(CssComb::NextSibling);
                i += 1;
                continue;
            }
            b'~' => {
                pending_comb = Some(CssComb::FollowingSibling);
                i += 1;
                continue;
            }
            _ => {}
        }

        let start = i;
        let mut bracket = 0usize;
        let mut paren = 0usize;
        let mut quote: Option<char> = None;
        while i < bytes.len() {
            let ch = sel[i..].chars().next().unwrap();
            if let Some(q) = quote {
                if ch == q {
                    quote = None;
                }
                i += ch.len_utf8();
                continue;
            }
            match ch {
                '\'' | '"' => quote = Some(ch),
                '[' => bracket += 1,
                ']' => bracket = bracket.saturating_sub(1),
                '(' => paren += 1,
                ')' => paren = paren.saturating_sub(1),
                c if bracket == 0 && paren == 0 && (c.is_ascii_whitespace() || c == '>' || c == '+' || c == '~') => {
                    break;
                }
                _ => {}
            }
            i += ch.len_utf8();
        }
        let chunk = sel[start..i].trim();
        let simple = parse_css_simple(chunk)?;
        parts.push(CssPart {
            comb: if parts.is_empty() { None } else { pending_comb.or(Some(CssComb::Descendant)) },
            simple,
        });
        pending_comb = None;
    }

    if parts.is_empty() {
        return Err(Error::Invalid("Empty CSS selector chain".into()));
    }
    Ok(parts)
}

fn parse_css_simple(chunk: &str) -> Result<CssSimple, Error> {
    let mut s = CssSimple::default();
    let mut i = 0;
    let bytes = chunk.as_bytes();
    while i < bytes.len() {
        match bytes[i] {
            b'#' => {
                i += 1;
                let st = i;
                while i < bytes.len() && !matches!(bytes[i], b'.' | b'#' | b'[' | b':') {
                    i += 1;
                }
                s.id = Some(chunk[st..i].to_owned());
            }
            b'.' => {
                i += 1;
                let st = i;
                while i < bytes.len() && !matches!(bytes[i], b'.' | b'#' | b'[' | b':') {
                    i += 1;
                }
                s.classes.push(chunk[st..i].to_owned());
            }
            b'[' => {
                i += 1;
                let st = i;
                let mut q: Option<u8> = None;
                while i < bytes.len() {
                    let b = bytes[i];
                    if let Some(qc) = q {
                        if b == qc {
                            q = None;
                        }
                    } else if b == b'\'' || b == b'"' {
                        q = Some(b);
                    } else if b == b']' {
                        break;
                    }
                    i += 1;
                }
                if i >= bytes.len() {
                    return Err(Error::Invalid("Unclosed '[' in CSS selector".into()));
                }
                let inner = chunk[st..i].trim();
                i += 1;
                let (name, op, val) = parse_css_attr_expr(inner);
                s.attrs.push((name, op, val));
            }
            b':' => {
                i += 1;
                let st = i;
                let mut paren = 0usize;
                while i < bytes.len() {
                    let b = bytes[i];
                    if b == b'(' {
                        paren += 1;
                    } else if b == b')' {
                        paren = paren.saturating_sub(1);
                    } else if paren == 0 && matches!(b, b'.' | b'#' | b'[' | b':') {
                        break;
                    }
                    i += 1;
                }
                s.pseudos.push(chunk[st..i].trim().to_owned());
            }
            _ => {
                let st = i;
                while i < bytes.len() && !matches!(bytes[i], b'.' | b'#' | b'[' | b':') {
                    i += 1;
                }
                s.tag = Some(chunk[st..i].to_owned());
            }
        }
    }
    Ok(s)
}

fn parse_css_attr_expr(inner: &str) -> (String, String, String) {
    for op in ["^=", "$=", "*=", "~=", "|=", "="] {
        if let Some((k, v)) = inner.split_once(op) {
            return (k.trim().to_owned(), op.to_owned(), unquote_literal(v));
        }
    }
    (inner.trim().to_owned(), String::new(), String::new())
}

fn matches_css_simple(doc: &XmlDoc, id: usize, s: &CssSimple) -> bool {
    let n = doc.node(id);
    if let Some(tag) = &s.tag
        && tag != "*"
        && !n.tag.eq_ignore_ascii_case(tag)
    {
        return false;
    }
    if let Some(want_id) = &s.id
        && doc.attr(id, "id") != Some(want_id.as_str())
    {
        return false;
    }
    if !s.classes.is_empty() {
        let cls = doc.attr(id, "class").unwrap_or("");
        let tokens: Vec<&str> = cls.split_whitespace().collect();
        for c in &s.classes {
            if !tokens.contains(&c.as_str()) {
                return false;
            }
        }
    }
    for (name, op, want) in &s.attrs {
        let Some(actual) = doc.attr(id, name) else {
            return false;
        };
        let ok = match op.as_str() {
            "" => true,
            "=" => actual == want,
            "^=" => actual.starts_with(want.as_str()),
            "$=" => actual.ends_with(want.as_str()),
            "*=" => actual.contains(want.as_str()),
            "~=" => actual.split_whitespace().any(|w| w == want),
            "|=" => actual == want || actual.starts_with(&format!("{want}-")),
            _ => false,
        };
        if !ok {
            return false;
        }
    }
    for p in &s.pseudos {
        let (pos, len) = doc.element_siblings_index(id);
        let pl = p.to_ascii_lowercase();
        if pl == "first-child" && pos != 0 {
            return false;
        } else if pl == "last-child" && pos + 1 != len {
            return false;
        } else if let Some(inner) = strip_fn_call(&pl, "nth-child") {
            let one_based = pos + 1;
            let matched = match inner {
                "odd" => one_based % 2 == 1,
                "even" => one_based % 2 == 0,
                num => num.parse::<usize>().ok().is_some_and(|n| n == one_based),
            };
            if !matched {
                return false;
            }
        }
    }
    true
}

fn matches_css_chain(doc: &XmlDoc, id: usize, chain: &[CssPart], idx: usize) -> bool {
    if !matches_css_simple(doc, id, &chain[idx].simple) {
        return false;
    }
    if idx == 0 {
        return true;
    }
    let comb = chain[idx].comb.unwrap_or(CssComb::Descendant);
    match comb {
        CssComb::Child => doc
            .node(id)
            .parent
            .is_some_and(|pid| matches_css_chain(doc, pid, chain, idx - 1)),
        CssComb::Descendant => {
            let mut cur = doc.node(id).parent;
            while let Some(pid) = cur {
                if matches_css_chain(doc, pid, chain, idx - 1) {
                    return true;
                }
                cur = doc.node(pid).parent;
            }
            false
        }
        CssComb::NextSibling => {
            let sibs = match doc.node(id).parent {
                Some(pid) => doc.child_elements(pid),
                None => doc.roots.clone(),
            };
            let pos = sibs.iter().position(|&x| x == id).unwrap_or(0);
            pos > 0 && matches_css_chain(doc, sibs[pos - 1], chain, idx - 1)
        }
        CssComb::FollowingSibling => {
            let sibs = match doc.node(id).parent {
                Some(pid) => doc.child_elements(pid),
                None => doc.roots.clone(),
            };
            let pos = sibs.iter().position(|&x| x == id).unwrap_or(0);
            sibs[..pos]
                .iter()
                .rev()
                .any(|&sid| matches_css_chain(doc, sid, chain, idx - 1))
        }
    }
}
