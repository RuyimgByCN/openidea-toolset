use openidea_plugin::Error;
use quick_xml::events::{BytesEnd, BytesStart, BytesText, Event};
use quick_xml::{Reader, Writer, XmlVersion};
use serde_json::{Map, Value};
use std::collections::BTreeSet;
use std::io::Cursor;

pub fn format_json(input: &str, indent: &str, sort_keys: bool) -> Result<String, Error> {
    let mut val: Value = serde_json::from_str(input).map_err(|e| Error::Invalid(format!("Invalid JSON: {e}")))?;
    if sort_keys {
        val = sort_value(val);
    }
    let indent_bytes = match indent {
        "4" => b"    ".as_slice(),
        "tab" => b"\t".as_slice(),
        _ => b"  ".as_slice(),
    };
    let mut buf = Vec::new();
    let formatter = serde_json::ser::PrettyFormatter::with_indent(indent_bytes);
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, formatter);
    serde::Serialize::serialize(&val, &mut ser).map_err(|e| Error::Invalid(e.to_string()))?;
    String::from_utf8(buf).map_err(|e| Error::Invalid(e.to_string()))
}

pub fn minify_json(input: &str) -> Result<String, Error> {
    let val: Value = serde_json::from_str(input).map_err(|e| Error::Invalid(format!("Invalid JSON: {e}")))?;
    serde_json::to_string(&val).map_err(|e| Error::Invalid(e.to_string()))
}

pub fn sort_value(v: Value) -> Value {
    match v {
        Value::Object(map) => {
            let mut entries: Vec<(String, Value)> = map.into_iter().map(|(k, val)| (k, sort_value(val))).collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            let mut sorted = Map::with_capacity(entries.len());
            for (k, val) in entries {
                sorted.insert(k, val);
            }
            Value::Object(sorted)
        }
        Value::Array(arr) => Value::Array(arr.into_iter().map(sort_value).collect()),
        other => other,
    }
}

pub fn eval_jsonpath(input: &str, path: &str) -> Result<Value, Error> {
    let root: Value = serde_json::from_str(input).map_err(|e| Error::Invalid(format!("Invalid JSON: {e}")))?;
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "$" {
        return Ok(root);
    }
    let tokens = parse_jsonpath(trimmed)?;
    let mut current = vec![&root];
    for tok in tokens {
        let mut next = Vec::new();
        for item in current {
            apply_token(item, &tok, &mut next);
        }
        current = next;
    }
    Ok(Value::Array(current.into_iter().cloned().collect()))
}

#[derive(Debug)]
enum PathToken {
    Key(String),
    Wildcard,
    Index(isize),
    Slice(Option<isize>, Option<isize>),
    Descendant(String),
    Filter { field: String, op: String, rhs: String },
}

fn parse_jsonpath(path: &str) -> Result<Vec<PathToken>, Error> {
    let mut s = path.strip_prefix('$').ok_or_else(|| Error::Invalid("JSONPath must start with $".into()))?;
    let mut tokens = Vec::new();
    while !s.is_empty() {
        if let Some(rest) = s.strip_prefix("..") {
            let (name, rem) = take_ident(rest);
            if name.is_empty() {
                return Err(Error::Invalid("Empty recursive descent key after ..".into()));
            }
            tokens.push(PathToken::Descendant(name.to_owned()));
            s = rem;
        } else if let Some(rest) = s.strip_prefix('.') {
            if let Some(rem) = rest.strip_prefix('*') {
                tokens.push(PathToken::Wildcard);
                s = rem;
            } else {
                let (name, rem) = take_ident(rest);
                if name.is_empty() {
                    return Err(Error::Invalid(format!("Invalid JSONPath segment near {s:?}")));
                }
                tokens.push(PathToken::Key(name.to_owned()));
                s = rem;
            }
        } else if let Some(rest) = s.strip_prefix('[') {
            let close = rest.find(']').ok_or_else(|| Error::Invalid("Unclosed [ in JSONPath".into()))?;
            let inner = rest[..close].trim();
            s = &rest[close + 1..];
            if inner == "*" {
                tokens.push(PathToken::Wildcard);
            } else if inner.starts_with("?(") && inner.ends_with(')') {
                let expr = inner[2..inner.len() - 1].trim();
                tokens.push(parse_filter(expr)?);
            } else if (inner.starts_with('\'') && inner.ends_with('\''))
                || (inner.starts_with('"') && inner.ends_with('"'))
            {
                tokens.push(PathToken::Key(inner[1..inner.len() - 1].to_owned()));
            } else if let Some((a, b)) = inner.split_once(':') {
                let start = if a.trim().is_empty() { None } else { Some(a.trim().parse::<isize>().map_err(|_| Error::Invalid("Invalid slice start".into()))?) };
                let end = if b.trim().is_empty() { None } else { Some(b.trim().parse::<isize>().map_err(|_| Error::Invalid("Invalid slice end".into()))?) };
                tokens.push(PathToken::Slice(start, end));
            } else {
                let idx = inner.parse::<isize>().map_err(|_| Error::Invalid(format!("Invalid index [{inner}]")))?;
                tokens.push(PathToken::Index(idx));
            }
        } else {
            return Err(Error::Invalid(format!("Unexpected JSONPath token at {s:?}")));
        }
    }
    Ok(tokens)
}

fn take_ident(s: &str) -> (&str, &str) {
    let end = s.find(['.', '[']).unwrap_or(s.len());
    (&s[..end], &s[end..])
}

fn parse_filter(expr: &str) -> Result<PathToken, Error> {
    let expr = expr.strip_prefix("@.").ok_or_else(|| Error::Invalid("Filter must start with @.<field>".into()))?;
    for op in ["==", "!=", ">=", "<=", ">", "<"] {
        if let Some((lhs, rhs)) = expr.split_once(op) {
            return Ok(PathToken::Filter {
                field: lhs.trim().to_owned(),
                op: op.to_owned(),
                rhs: rhs.trim().trim_matches('\'').trim_matches('"').to_owned(),
            });
        }
    }
    Ok(PathToken::Filter {
        field: expr.trim().to_owned(),
        op: "exists".into(),
        rhs: String::new(),
    })
}

fn apply_token<'a>(val: &'a Value, tok: &PathToken, out: &mut Vec<&'a Value>) {
    match tok {
        PathToken::Key(k) => {
            if let Some(v) = val.as_object().and_then(|m| m.get(k)) {
                out.push(v);
            }
        }
        PathToken::Wildcard => match val {
            Value::Object(m) => out.extend(m.values()),
            Value::Array(a) => out.extend(a.iter()),
            _ => {}
        },
        PathToken::Index(idx) => {
            if let Some(a) = val.as_array() {
                let len = a.len() as isize;
                let resolved = if *idx < 0 { len + *idx } else { *idx };
                if resolved >= 0 && (resolved as usize) < a.len() {
                    out.push(&a[resolved as usize]);
                }
            }
        }
        PathToken::Slice(start, end) => {
            if let Some(a) = val.as_array() {
                let len = a.len() as isize;
                let s = start.map(|v| if v < 0 { (len + v).max(0) } else { v.min(len) }).unwrap_or(0) as usize;
                let e = end.map(|v| if v < 0 { (len + v).max(0) } else { v.min(len) }).unwrap_or(len) as usize;
                if s < e {
                    out.extend(&a[s..e]);
                }
            }
        }
        PathToken::Descendant(k) => collect_descendants(val, k, out),
        PathToken::Filter { field, op, rhs } => {
            let items: Vec<&Value> = match val {
                Value::Array(a) => a.iter().collect(),
                _ => vec![val],
            };
            for item in items {
                if let Some(fv) = item.as_object().and_then(|m| m.get(field)) {
                    if match_filter(fv, op, rhs) {
                        out.push(item);
                    }
                }
            }
        }
    }
}

fn collect_descendants<'a>(val: &'a Value, key: &str, out: &mut Vec<&'a Value>) {
    match val {
        Value::Object(m) => {
            if let Some(v) = m.get(key) {
                out.push(v);
            }
            for v in m.values() {
                collect_descendants(v, key, out);
            }
        }
        Value::Array(a) => {
            for v in a {
                collect_descendants(v, key, out);
            }
        }
        _ => {}
    }
}

fn match_filter(v: &Value, op: &str, rhs: &str) -> bool {
    if op == "exists" {
        return !v.is_null();
    }
    if let (Some(lv), Ok(rv)) = (v.as_f64(), rhs.parse::<f64>()) {
        return match op {
            "==" => (lv - rv).abs() < f64::EPSILON,
            "!=" => (lv - rv).abs() >= f64::EPSILON,
            ">" => lv > rv,
            "<" => lv < rv,
            ">=" => lv >= rv,
            "<=" => lv <= rv,
            _ => false,
        };
    }
    let ls = match v {
        Value::String(s) => s.as_str(),
        Value::Bool(true) => "true",
        Value::Bool(false) => "false",
        Value::Null => "null",
        _ => return false,
    };
    match op {
        "==" => ls == rhs,
        "!=" => ls != rhs,
        _ => false,
    }
}

pub fn json_to_schema(input: &str, title: Option<&str>) -> Result<String, Error> {
    let val: Value = serde_json::from_str(input).map_err(|e| Error::Invalid(format!("Invalid JSON: {e}")))?;
    let mut schema = infer_schema(&val);
    if let Some(obj) = schema.as_object_mut() {
        let mut ordered = Map::new();
        ordered.insert("$schema".into(), Value::String("http://json-schema.org/draft-07/schema#".into()));
        if let Some(t) = title.filter(|s| !s.trim().is_empty()) {
            ordered.insert("title".into(), Value::String(t.trim().to_owned()));
        }
        for (k, v) in std::mem::take(obj) {
            ordered.insert(k, v);
        }
        *obj = ordered;
    }
    serde_json::to_string_pretty(&schema).map_err(|e| Error::Invalid(e.to_string()))
}

fn infer_schema(val: &Value) -> Value {
    let mut m = Map::new();
    match val {
        Value::Null => {
            m.insert("type".into(), Value::String("null".into()));
        }
        Value::Bool(_) => {
            m.insert("type".into(), Value::String("boolean".into()));
        }
        Value::Number(n) => {
            m.insert("type".into(), Value::String(if n.is_i64() || n.is_u64() { "integer" } else { "number" }.into()));
        }
        Value::String(_) => {
            m.insert("type".into(), Value::String("string".into()));
        }
        Value::Array(arr) => {
            m.insert("type".into(), Value::String("array".into()));
            if let Some(first) = arr.first() {
                m.insert("items".into(), infer_schema(first));
            }
        }
        Value::Object(obj) => {
            m.insert("type".into(), Value::String("object".into()));
            let mut props = Map::new();
            let mut required = Vec::new();
            for (k, v) in obj {
                props.insert(k.clone(), infer_schema(v));
                if !v.is_null() {
                    required.push(Value::String(k.clone()));
                }
            }
            m.insert("properties".into(), Value::Object(props));
            if !required.is_empty() {
                m.insert("required".into(), Value::Array(required));
            }
        }
    }
    Value::Object(m)
}

pub fn convert_format(input: &str, from: &str, to: &str, indent: &str) -> Result<String, Error> {
    let val = parse_format(input, from)?;
    emit_format(&val, to, indent)
}

fn parse_format(input: &str, from: &str) -> Result<Value, Error> {
    match from {
        "json" => serde_json::from_str(input).map_err(|e| Error::Invalid(format!("Invalid JSON: {e}"))),
        "yaml" => serde_yaml_ng::from_str(input).map_err(|e| Error::Invalid(format!("Invalid YAML: {e}"))),
        "toml" => {
            let tv: toml::Value = toml::from_str(input).map_err(|e| Error::Invalid(format!("Invalid TOML: {e}")))?;
            serde_json::to_value(tv).map_err(|e| Error::Invalid(e.to_string()))
        }
        "xml" => xml_to_json(input),
        "properties" => properties_to_json(input),
        "querystring" => querystring_to_json(input),
        _ => Err(Error::Invalid(format!("Unsupported source format {from}"))),
    }
}

fn emit_format(val: &Value, to: &str, indent: &str) -> Result<String, Error> {
    match to {
        "json" => {
            let json_str = serde_json::to_string(val).map_err(|e| Error::Invalid(e.to_string()))?;
            format_json(&json_str, indent, false)
        }
        "yaml" => serde_yaml_ng::to_string(val).map_err(|e| Error::Invalid(e.to_string())),
        "toml" => {
            let tv: toml::Value = serde_json::from_value(val.clone())
                .map_err(|e| Error::Invalid(format!("Cannot serialize to TOML (null/top-level primitive unsupported): {e}")))?;
            toml::to_string_pretty(&tv).map_err(|e| Error::Invalid(e.to_string()))
        }
        "xml" => json_to_xml(val, indent),
        "properties" => json_to_properties(val),
        "querystring" => json_to_querystring(val),
        _ => Err(Error::Invalid(format!("Unsupported target format {to}"))),
    }
}

fn xml_to_json(input: &str) -> Result<Value, Error> {
    let mut reader = Reader::from_str(input);
    reader.config_mut().trim_text(true);
    #[derive(Default)]
    struct Frame {
        name: String,
        attrs: Map<String, Value>,
        children: Map<String, Value>,
        text: String,
    }
    let mut stack: Vec<Frame> = Vec::new();
    let mut root: Option<(String, Value)> = None;

    let finish_frame = |f: Frame| -> Value {
        if f.attrs.is_empty() && f.children.is_empty() {
            return Value::String(f.text);
        }
        let mut obj = Map::new();
        for (k, v) in f.attrs {
            obj.insert(format!("@{k}"), v);
        }
        for (k, v) in f.children {
            obj.insert(k, v);
        }
        if !f.text.is_empty() {
            obj.insert("#text".into(), Value::String(f.text));
        }
        Value::Object(obj)
    };

    let push_child = |parent: &mut Frame, name: String, val: Value| {
        if let Some(existing) = parent.children.get_mut(&name) {
            if let Value::Array(arr) = existing {
                arr.push(val);
            } else {
                let prev = std::mem::replace(existing, Value::Null);
                *existing = Value::Array(vec![prev, val]);
            }
        } else {
            parent.children.insert(name, val);
        }
    };

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = e.name().as_ref().to_owned();
                let mut attrs = Map::new();
                for a in e.attributes().flatten() {
                    let k = a.key.as_ref().to_owned();
                    let v = a.normalized_value(XmlVersion::Implicit1_0).map_err(|err| Error::Invalid(err.to_string()))?.into_owned();
                    attrs.insert(k, Value::String(v));
                }
                stack.push(Frame { name, attrs, ..Default::default() });
            }
            Ok(Event::Empty(e)) => {
                let name = e.name().as_ref().to_owned();
                let mut attrs = Map::new();
                for a in e.attributes().flatten() {
                    let k = a.key.as_ref().to_owned();
                    let v = a.normalized_value(XmlVersion::Implicit1_0).map_err(|err| Error::Invalid(err.to_string()))?.into_owned();
                    attrs.insert(k, Value::String(v));
                }
                let val = finish_frame(Frame { name: name.clone(), attrs, ..Default::default() });
                if let Some(parent) = stack.last_mut() {
                    push_child(parent, name, val);
                } else {
                    root = Some((name, val));
                }
            }
            Ok(Event::Text(e)) => {
                let txt = quick_xml::escape::unescape(e.as_ref()).map_err(|err| Error::Invalid(err.to_string()))?.into_owned();
                if let Some(top) = stack.last_mut() {
                    top.text.push_str(&txt);
                }
            }
            Ok(Event::CData(e)) => {
                let txt = e.as_ref().to_owned();
                if let Some(top) = stack.last_mut() {
                    top.text.push_str(&txt);
                }
            }
            Ok(Event::End(_)) => {
                if let Some(done) = stack.pop() {
                    let name = done.name.clone();
                    let val = finish_frame(done);
                    if let Some(parent) = stack.last_mut() {
                        push_child(parent, name, val);
                    } else {
                        root = Some((name, val));
                    }
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err(Error::Invalid(format!("Invalid XML: {e}"))),
        }
    }
    let Some((name, val)) = root else {
        return Err(Error::Invalid("Empty XML document".into()));
    };
    let mut obj = Map::new();
    obj.insert(name, val);
    Ok(Value::Object(obj))
}

fn json_to_xml(val: &Value, indent: &str) -> Result<String, Error> {
    let indent_len = if indent == "4" { 4 } else { 2 };
    let mut writer = Writer::new_with_indent(Cursor::new(Vec::new()), b' ', indent_len);
    match val {
        Value::Object(map) if map.len() == 1 => {
            let (root_name, root_val) = map.iter().next().unwrap();
            write_xml_node(&mut writer, root_name, root_val)?;
        }
        _ => write_xml_node(&mut writer, "root", val)?,
    }
    let bytes = writer.into_inner().into_inner();
    String::from_utf8(bytes).map_err(|e| Error::Invalid(e.to_string()))
}

fn write_xml_node<W: std::io::Write>(w: &mut Writer<W>, name: &str, val: &Value) -> Result<(), Error> {
    match val {
        Value::Array(arr) => {
            for item in arr {
                write_xml_node(w, name, item)?;
            }
        }
        Value::Object(map) => {
            let mut start = BytesStart::new(name);
            for (k, v) in map {
                if let Some(attr_name) = k.strip_prefix('@') {
                    let attr_val = scalar_str(v);
                    start.push_attribute((attr_name, attr_val.as_str()));
                }
            }
            let has_children = map.iter().any(|(k, _)| !k.starts_with('@'));
            if !has_children {
                w.write_event(Event::Empty(start)).map_err(|e| Error::Invalid(e.to_string()))?;
                return Ok(());
            }
            w.write_event(Event::Start(start)).map_err(|e| Error::Invalid(e.to_string()))?;
            for (k, v) in map {
                if k.starts_with('@') {
                    continue;
                }
                if k == "#text" {
                    w.write_event(Event::Text(BytesText::new(&scalar_str(v))))
                        .map_err(|e| Error::Invalid(e.to_string()))?;
                } else {
                    write_xml_node(w, k, v)?;
                }
            }
            w.write_event(Event::End(BytesEnd::new(name))).map_err(|e| Error::Invalid(e.to_string()))?;
        }
        other => {
            w.write_event(Event::Start(BytesStart::new(name))).map_err(|e| Error::Invalid(e.to_string()))?;
            if !other.is_null() {
                w.write_event(Event::Text(BytesText::new(&scalar_str(other))))
                    .map_err(|e| Error::Invalid(e.to_string()))?;
            }
            w.write_event(Event::End(BytesEnd::new(name))).map_err(|e| Error::Invalid(e.to_string()))?;
        }
    }
    Ok(())
}

fn scalar_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn count_trailing_backslashes(s: &str) -> usize {
    s.bytes().rev().take_while(|b| *b == b'\\').count()
}

fn escape_properties_key(key: &str) -> String {
    let mut out = String::with_capacity(key.len());
    for ch in key.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\x0c' => out.push_str("\\f"),
            '=' => out.push_str("\\="),
            ':' => out.push_str("\\:"),
            ' ' => out.push_str("\\ "),
            '#' => out.push_str("\\#"),
            '!' => out.push_str("\\!"),
            c if (c as u32) < 0x20 || (c as u32) == 0x7f => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out
}

fn escape_properties_value(val: &str) -> String {
    let mut out = String::with_capacity(val.len());
    let mut leading = true;
    for ch in val.chars() {
        if ch == ' ' && leading {
            out.push_str("\\ ");
            continue;
        }
        leading = false;
        match ch {
            '\\' => out.push_str("\\\\"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\x0c' => out.push_str("\\f"),
            c if (c as u32) < 0x20 || (c as u32) == 0x7f => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out
}

fn unescape_properties_token(raw: &str) -> Result<String, Error> {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        let Some(esc) = chars.next() else {
            break;
        };
        match esc {
            't' => out.push('\t'),
            'n' => out.push('\n'),
            'r' => out.push('\r'),
            'f' => out.push('\x0c'),
            'u' => {
                let mut hex = String::with_capacity(4);
                for _ in 0..4 {
                    if let Some(h) = chars.next() {
                        hex.push(h);
                    }
                }
                if hex.len() != 4 {
                    return Err(Error::Invalid(format!("Invalid \\uXXXX escape in .properties: \\u{hex}")));
                }
                let code = u32::from_str_radix(&hex, 16)
                    .map_err(|_| Error::Invalid(format!("Invalid \\uXXXX escape in .properties: \\u{hex}")))?;
                let c = char::from_u32(code)
                    .ok_or_else(|| Error::Invalid(format!("Invalid Unicode scalar \\u{hex}")))?;
                out.push(c);
            }
            other => out.push(other),
        }
    }
    Ok(out)
}

fn properties_to_json(input: &str) -> Result<Value, Error> {
    let norm = input.replace("\r\n", "\n").replace('\r', "\n");
    let mut logical = Vec::new();
    let mut buf = String::new();
    let mut in_cont = false;
    for raw_line in norm.split('\n') {
        let stripped = raw_line.trim_start_matches([' ', '\t', '\x0c']);
        if !in_cont {
            if stripped.is_empty() || stripped.starts_with('#') || stripped.starts_with('!') {
                continue;
            }
            if count_trailing_backslashes(stripped) % 2 == 1 {
                buf.clear();
                buf.push_str(&stripped[..stripped.len() - 1]);
                in_cont = true;
            } else {
                logical.push(stripped.to_owned());
            }
        } else if count_trailing_backslashes(stripped) % 2 == 1 {
            buf.push_str(&stripped[..stripped.len() - 1]);
        } else {
            buf.push_str(stripped);
            logical.push(std::mem::take(&mut buf));
            in_cont = false;
        }
    }
    if in_cont {
        logical.push(buf);
    }

    let mut root = Value::Object(Map::new());
    for entry in logical {
        let bytes = entry.as_bytes();
        let mut i = 0usize;
        let mut key_end = bytes.len();
        let mut val_start = bytes.len();
        while i < bytes.len() {
            if bytes[i] == b'\\' {
                i += 2;
                continue;
            }
            if bytes[i] == b'=' || bytes[i] == b':' {
                key_end = i;
                let mut j = i + 1;
                while j < bytes.len() && matches!(bytes[j], b' ' | b'\t' | b'\x0c') {
                    j += 1;
                }
                val_start = j;
                break;
            }
            if matches!(bytes[i], b' ' | b'\t' | b'\x0c') {
                key_end = i;
                let mut j = i + 1;
                while j < bytes.len() && matches!(bytes[j], b' ' | b'\t' | b'\x0c') {
                    j += 1;
                }
                if j < bytes.len() && (bytes[j] == b'=' || bytes[j] == b':') {
                    j += 1;
                    while j < bytes.len() && matches!(bytes[j], b' ' | b'\t' | b'\x0c') {
                        j += 1;
                    }
                }
                val_start = j;
                break;
            }
            i += 1;
        }
        let k = unescape_properties_token(&entry[..key_end])?;
        if k.is_empty() {
            continue;
        }
        let v = unescape_properties_token(&entry[val_start..])?;
        let parts: Vec<&str> = k.split('.').collect();
        insert_nested(&mut root, &parts, Value::String(v));
    }
    Ok(root)
}

fn insert_nested(cur: &mut Value, path: &[&str], leaf: Value) {
    if path.is_empty() {
        return;
    }
    if !cur.is_object() {
        *cur = Value::Object(Map::new());
    }
    let map = cur.as_object_mut().unwrap();
    if path.len() == 1 {
        map.insert(path[0].to_owned(), leaf);
    } else {
        let child = map.entry(path[0].to_owned()).or_insert_with(|| Value::Object(Map::new()));
        insert_nested(child, &path[1..], leaf);
    }
}

fn json_to_properties(val: &Value) -> Result<String, Error> {
    let mut out = Vec::new();
    flatten_props("", val, &mut out);
    Ok(out.join("\n"))
}

fn flatten_props(prefix: &str, val: &Value, out: &mut Vec<String>) {
    match val {
        Value::Object(m) => {
            for (k, v) in m {
                let next = if prefix.is_empty() { k.clone() } else { format!("{prefix}.{k}") };
                flatten_props(&next, v, out);
            }
        }
        Value::Array(a) => {
            for (i, v) in a.iter().enumerate() {
                let next = format!("{prefix}[{i}]");
                flatten_props(&next, v, out);
            }
        }
        Value::Null => {
            if !prefix.is_empty() {
                out.push(format!("{}=", escape_properties_key(prefix)));
            }
        }
        Value::String(s) => {
            if !prefix.is_empty() {
                out.push(format!("{}={}", escape_properties_key(prefix), escape_properties_value(s)));
            }
        }
        other => {
            if !prefix.is_empty() {
                out.push(format!(
                    "{}={}",
                    escape_properties_key(prefix),
                    escape_properties_value(&other.to_string())
                ));
            }
        }
    }
}

fn querystring_to_json(input: &str) -> Result<Value, Error> {
    let raw = input.trim().trim_start_matches('?');
    let raw = raw.split_once('?').map_or(raw, |(_, q)| q);
    let mut map = Map::new();
    for pair in raw.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let key = crate::converters::url_decode(k);
        let val = crate::converters::url_decode(v);
        if let Some(existing) = map.get_mut(&key) {
            if let Value::Array(arr) = existing {
                arr.push(Value::String(val));
            } else {
                let prev = std::mem::replace(existing, Value::Null);
                *existing = Value::Array(vec![prev, Value::String(val)]);
            }
        } else {
            map.insert(key, Value::String(val));
        }
    }
    Ok(Value::Object(map))
}

fn json_to_querystring(val: &Value) -> Result<String, Error> {
    let Some(map) = val.as_object() else {
        return Err(Error::Invalid("QueryString target requires a JSON object".into()));
    };
    let mut pairs = Vec::new();
    for (k, v) in map {
        match v {
            Value::Array(arr) => {
                for item in arr {
                    pairs.push(format!("{}={}", crate::converters::url_encode(k), crate::converters::url_encode(&scalar_str(item))));
                }
            }
            _ => {
                pairs.push(format!("{}={}", crate::converters::url_encode(k), crate::converters::url_encode(&scalar_str(v))));
            }
        }
    }
    Ok(pairs.join("&"))
}

pub fn format_code(input: &str, lang: &str, minify: bool, indent: &str) -> Result<String, Error> {
    match lang {
        "xml" | "html" => format_markup(input, minify, indent),
        "sql" => Ok(if minify { minify_sql(input) } else { format_sql(input, indent) }),
        "css" => Ok(if minify { minify_css(input) } else { format_css(input, indent) }),
        _ => Err(Error::Invalid(format!("Unsupported language {lang}"))),
    }
}

fn indent_unit(indent: &str) -> &'static str {
    match indent {
        "4" => "    ",
        "tab" => "\t",
        _ => "  ",
    }
}

fn format_markup(input: &str, minify: bool, indent: &str) -> Result<String, Error> {
    let mut reader = Reader::from_str(input);
    reader.config_mut().trim_text(true);
    let mut writer = if minify {
        Writer::new(Cursor::new(Vec::new()))
    } else {
        let len = if indent == "4" { 4 } else { 2 };
        Writer::new_with_indent(Cursor::new(Vec::new()), b' ', len)
    };
    loop {
        match reader.read_event() {
            Ok(Event::Eof) => break,
            Ok(ev) => writer.write_event(ev).map_err(|e| Error::Invalid(e.to_string()))?,
            Err(e) => return Err(Error::Invalid(format!("Markup parse error: {e}"))),
        }
    }
    let bytes = writer.into_inner().into_inner();
    String::from_utf8(bytes).map_err(|e| Error::Invalid(e.to_string()))
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum SqlTokKind {
    Word,
    StringOrIdent,
    Punct,
    LineComment,
    BlockComment,
}

struct SqlTok {
    kind: SqlTokKind,
    text: String,
}

fn parse_dollar_tag(chars: &[char], start: usize) -> Option<String> {
    if chars.get(start) != Some(&'$') {
        return None;
    }
    let mut j = start + 1;
    while j < chars.len() {
        let ch = chars[j];
        if ch == '$' {
            return Some(chars[start..=j].iter().collect());
        }
        if j == start + 1 {
            if !(ch.is_ascii_alphabetic() || ch == '_') {
                return None;
            }
        } else if !(ch.is_ascii_alphanumeric() || ch == '_') {
            return None;
        }
        j += 1;
    }
    None
}

fn consume_sql_quoted(chars: &[char], start: usize) -> (String, usize) {
    let quote = chars[start];
    let mut buf = String::from(quote);
    let mut i = start + 1;
    while i < chars.len() {
        let c = chars[i];
        buf.push(c);
        if c == '\\' && i + 1 < chars.len() {
            i += 1;
            buf.push(chars[i]);
            i += 1;
            continue;
        }
        if c == quote {
            if chars.get(i + 1) == Some(&quote) {
                i += 1;
                buf.push(chars[i]);
            } else {
                i += 1;
                break;
            }
        }
        i += 1;
    }
    (buf, i)
}

fn parse_sql_prefixed_literal(chars: &[char], start: usize) -> Option<(String, usize)> {
    let first = *chars.get(start)?;
    if first.eq_ignore_ascii_case(&'u')
        && chars.get(start + 1) == Some(&'&')
        && matches!(chars.get(start + 2), Some('\'' | '"'))
    {
        let (quoted, next) = consume_sql_quoted(chars, start + 2);
        let prefix: String = chars[start..start + 2].iter().collect();
        return Some((format!("{prefix}{quoted}"), next));
    }
    if matches!(first.to_ascii_lowercase(), 'x' | 'b' | 'n' | 'e' | 'r' | 'q')
        && chars.get(start + 1) == Some(&'\'')
    {
        let (quoted, next) = consume_sql_quoted(chars, start + 1);
        return Some((format!("{first}{quoted}"), next));
    }
    if first == '_' {
        let mut j = start + 1;
        while j < chars.len() && (chars[j].is_ascii_alphanumeric() || chars[j] == '_') {
            j += 1;
        }
        if j > start + 1 && chars.get(j) == Some(&'\'') {
            let prefix: String = chars[start..j].iter().collect();
            let (quoted, next) = consume_sql_quoted(chars, j);
            return Some((format!("{prefix}{quoted}"), next));
        }
    }
    None
}

fn tokenize_sql(input: &str) -> Vec<SqlTok> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if (c == '-' && chars.get(i + 1) == Some(&'-')) || c == '#' {
            let mut buf = String::new();
            while i < chars.len() && chars[i] != '\n' && chars[i] != '\r' {
                buf.push(chars[i]);
                i += 1;
            }
            while buf.ends_with([' ', '\t']) {
                buf.pop();
            }
            tokens.push(SqlTok { kind: SqlTokKind::LineComment, text: buf });
            continue;
        }
        if c == '/' && chars.get(i + 1) == Some(&'*') {
            let mut buf = String::from("/*");
            i += 2;
            while i < chars.len() {
                buf.push(chars[i]);
                if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                    i += 1;
                    buf.push('/');
                    i += 1;
                    break;
                }
                i += 1;
            }
            tokens.push(SqlTok { kind: SqlTokKind::BlockComment, text: buf });
            continue;
        }
        if let Some((buf, next)) = parse_sql_prefixed_literal(&chars, i) {
            tokens.push(SqlTok { kind: SqlTokKind::StringOrIdent, text: buf });
            i = next;
            continue;
        }
        if c == '\'' || c == '"' || c == '`' {
            let (buf, next) = consume_sql_quoted(&chars, i);
            tokens.push(SqlTok { kind: SqlTokKind::StringOrIdent, text: buf });
            i = next;
            continue;
        }
        if let Some(tag) = parse_dollar_tag(&chars, i) {
            let tag_chars: Vec<char> = tag.chars().collect();
            let mut j = i + tag_chars.len();
            let mut closed = false;
            while j + tag_chars.len() <= chars.len() {
                if chars[j..j + tag_chars.len()] == tag_chars[..] {
                    let end = j + tag_chars.len();
                    let text: String = chars[i..end].iter().collect();
                    tokens.push(SqlTok { kind: SqlTokKind::StringOrIdent, text });
                    i = end;
                    closed = true;
                    break;
                }
                j += 1;
            }
            if closed {
                continue;
            }
        }
        if matches!(c, ',' | ';' | '(' | ')' | '.') {
            tokens.push(SqlTok { kind: SqlTokKind::Punct, text: c.to_string() });
            i += 1;
            continue;
        }
        let mut buf = String::new();
        while i < chars.len()
            && !chars[i].is_whitespace()
            && !matches!(chars[i], ',' | ';' | '(' | ')' | '.' | '\'' | '"' | '`' | '#')
            && !(chars[i] == '-' && chars.get(i + 1) == Some(&'-'))
            && !(chars[i] == '/' && chars.get(i + 1) == Some(&'*'))
            && !(!buf.is_empty()
                && buf.chars().last().is_some_and(|ch| !(ch.is_ascii_alphanumeric() || ch == '_'))
                && parse_sql_prefixed_literal(&chars, i).is_some())
        {
            buf.push(chars[i]);
            i += 1;
        }
        tokens.push(SqlTok { kind: SqlTokKind::Word, text: buf });
    }
    tokens
}

fn minify_sql(input: &str) -> String {
    let tokens = tokenize_sql(input);
    let mut out = String::with_capacity(input.len());
    let mut need_newline = false;
    let mut prev_kind: Option<SqlTokKind> = None;
    let mut prev_text = String::new();

    for tok in tokens {
        let text = tok.text.as_str();
        if need_newline {
            out.push('\n');
            need_newline = false;
        } else if !out.is_empty() {
            let no_space = match tok.kind {
                SqlTokKind::Punct => matches!(text, "," | ";" | ")" | ".")
                    || (text == "(" && prev_kind == Some(SqlTokKind::Punct) && matches!(prev_text.as_str(), "(" | ".")),
                _ => prev_kind == Some(SqlTokKind::Punct) && matches!(prev_text.as_str(), "(" | "."),
            };
            if !no_space {
                out.push(' ');
            }
        }
        out.push_str(text);
        if tok.kind == SqlTokKind::LineComment {
            need_newline = true;
        }
        prev_kind = Some(tok.kind);
        prev_text = tok.text;
    }
    out
}

fn format_sql(input: &str, indent: &str) -> String {
    let unit = indent_unit(indent);
    let newline_kw = [
        "SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET",
        "INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL JOIN", "CROSS JOIN", "JOIN",
        "UNION ALL", "UNION", "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE FROM",
        "ON", "AND", "OR",
    ];
    let tokens = tokenize_sql(input);
    let mut out = String::new();
    let mut i = 0;
    let mut after_line_comment = false;
    while i < tokens.len() {
        let tok = &tokens[i];
        if tok.kind == SqlTokKind::LineComment {
            if after_line_comment {
                out.push('\n');
            } else if !out.is_empty() && !out.ends_with([' ', '\n']) {
                out.push(' ');
            }
            out.push_str(&tok.text);
            after_line_comment = true;
            i += 1;
            continue;
        }
        if tok.kind == SqlTokKind::Word {
            let cur_upper = tok.text.to_ascii_uppercase();
            let two_upper = tokens
                .get(i + 1)
                .filter(|n| n.kind == SqlTokKind::Word)
                .map(|n| format!("{cur_upper} {}", n.text.to_ascii_uppercase()));
            let matched_two = two_upper.as_deref().filter(|t| newline_kw.contains(t));
            if let Some(kw) = matched_two {
                after_line_comment = false;
                if !out.is_empty() && !out.ends_with('\n') {
                    out.push('\n');
                }
                if matches!(kw, "AND" | "OR" | "ON") {
                    out.push_str(unit);
                }
                out.push_str(kw);
                i += 2;
                continue;
            }
            if newline_kw.contains(&cur_upper.as_str()) {
                after_line_comment = false;
                if !out.is_empty() && !out.ends_with('\n') {
                    out.push('\n');
                }
                if matches!(cur_upper.as_str(), "AND" | "OR" | "ON") {
                    out.push_str(unit);
                }
                out.push_str(&cur_upper);
                i += 1;
                continue;
            }
        }
        if after_line_comment {
            out.push('\n');
            after_line_comment = false;
        }
        if tok.kind == SqlTokKind::Punct && tok.text == "," {
            out.push(',');
            out.push('\n');
            out.push_str(unit);
        } else if tok.kind == SqlTokKind::Punct && tok.text == ";" {
            out.push_str(";\n");
        } else if tok.kind == SqlTokKind::Punct && (tok.text == "(" || tok.text == ")") {
            if tok.text == "(" && !out.ends_with([' ', '\n', '(']) {
                out.push(' ');
            }
            out.push_str(&tok.text);
        } else {
            if !out.is_empty() && !out.ends_with([' ', '\n', '(', '.']) && tok.text != "." {
                out.push(' ');
            }
            out.push_str(&tok.text);
        }
        i += 1;
    }
    out.trim().to_owned()
}

fn looks_like_declaration_colon(chars: &[char], colon_idx: usize) -> bool {
    let mut in_str: Option<char> = None;
    let mut i = colon_idx + 1;
    while i < chars.len() {
        let c = chars[i];
        if let Some(q) = in_str {
            if c == '\\' && i + 1 < chars.len() {
                i += 2;
                continue;
            }
            if c == q {
                in_str = None;
            }
            i += 1;
            continue;
        }
        if c == '/' && chars.get(i + 1) == Some(&'*') {
            i += 2;
            while i < chars.len() {
                if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                    i += 2;
                    break;
                }
                i += 1;
            }
            continue;
        }
        if c == '"' || c == '\'' {
            in_str = Some(c);
            i += 1;
            continue;
        }
        match c {
            ';' | '}' => return true,
            '{' => return false,
            _ => i += 1,
        }
    }
    false
}

fn minify_css(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    let mut depth = 0usize;
    let mut pending_space = false;

    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            pending_space = true;
            i += 1;
            continue;
        }
        if c == '/' && chars.get(i + 1) == Some(&'*') {
            i += 2;
            while i < chars.len() {
                if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                    i += 2;
                    break;
                }
                i += 1;
            }
            pending_space = true;
            continue;
        }
        if c == '"' || c == '\'' {
            if pending_space && !out.is_empty() && !out.ends_with(['{', '}', ':', ';', ',']) {
                out.push(' ');
            }
            pending_space = false;
            out.push(c);
            i += 1;
            while i < chars.len() {
                let sc = chars[i];
                out.push(sc);
                if sc == '\\' && i + 1 < chars.len() {
                    i += 1;
                    out.push(chars[i]);
                    i += 1;
                    continue;
                }
                if sc == c {
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }

        let is_decl_colon = c == ':' && depth > 0 && looks_like_declaration_colon(&chars, i);
        let suppress_before = matches!(c, '{' | '}' | ';' | ',') || is_decl_colon;
        if pending_space && !suppress_before && !out.is_empty() && !out.ends_with(['{', '}', ':', ';', ',']) {
            out.push(' ');
        }
        pending_space = false;
        if c == '{' {
            depth += 1;
        } else if c == '}' {
            depth = depth.saturating_sub(1);
        }
        out.push(c);
        i += 1;
    }
    out
}

fn format_css(input: &str, indent: &str) -> String {
    let unit = indent_unit(indent);
    let mut out = String::new();
    let mut depth = 0usize;
    let mut in_str: Option<char> = None;
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if let Some(q) = in_str {
            out.push(ch);
            if ch == '\\' && i + 1 < chars.len() {
                i += 1;
                out.push(chars[i]);
                i += 1;
                continue;
            }
            if ch == q {
                in_str = None;
            }
            i += 1;
            continue;
        }
        if ch == '/' && chars.get(i + 1) == Some(&'*') {
            if !out.is_empty() && !out.ends_with([' ', '\t', '\n']) {
                out.push(' ');
            }
            out.push_str("/*");
            i += 2;
            while i < chars.len() {
                out.push(chars[i]);
                if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                    i += 1;
                    out.push('/');
                    i += 1;
                    break;
                }
                i += 1;
            }
            out.push('\n');
            for _ in 0..depth {
                out.push_str(unit);
            }
            continue;
        }
        if ch == '"' || ch == '\'' {
            in_str = Some(ch);
            out.push(ch);
            i += 1;
            continue;
        }
        match ch {
            '{' => {
                while out.ends_with(' ') {
                    out.pop();
                }
                out.push_str(" {\n");
                depth += 1;
                for _ in 0..depth {
                    out.push_str(unit);
                }
            }
            '}' => {
                while out.ends_with([' ', '\t']) {
                    out.pop();
                }
                if !out.ends_with('\n') {
                    out.push('\n');
                }
                depth = depth.saturating_sub(1);
                for _ in 0..depth {
                    out.push_str(unit);
                }
                out.push_str("}\n");
            }
            ';' => {
                out.push_str(";\n");
                for _ in 0..depth {
                    out.push_str(unit);
                }
            }
            c if c.is_whitespace() => {
                if !out.ends_with([' ', '\t', '\n']) {
                    out.push(' ');
                }
            }
            other => out.push(other),
        }
        i += 1;
    }
    out.lines().map(str::trim_end).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n")
}

pub fn json_to_code(input: &str, target: &str, root_name: &str, lombok: bool) -> Result<String, Error> {
    let val: Value = serde_json::from_str(input).map_err(|e| Error::Invalid(format!("Invalid JSON: {e}")))?;
    let root = if root_name.trim().is_empty() { "Root" } else { root_name.trim() };
    let mut classes: Vec<String> = Vec::new();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    gen_type(root, &val, target, lombok, &mut seen, &mut classes);
    classes.reverse();
    Ok(classes.join("\n\n"))
}

fn pascal_ident(raw: &str) -> String {
    let p = crate::string_tools::convert_case(raw, crate::string_tools::CaseStyle::Pascal);
    if p.is_empty() { "Item".into() } else { p }
}

fn camel_ident(raw: &str) -> String {
    let c = crate::string_tools::convert_case(raw, crate::string_tools::CaseStyle::Camel);
    if c.is_empty() { "field".into() } else { c }
}

fn snake_ident(raw: &str) -> String {
    let s = crate::string_tools::convert_case(raw, crate::string_tools::CaseStyle::Snake);
    if s.is_empty() { "field".into() } else { s }
}

fn gen_type(name: &str, val: &Value, target: &str, lombok: bool, seen: &mut BTreeSet<String>, out: &mut Vec<String>) -> String {
    match val {
        Value::Null => match target {
            "java" | "java-record" => "Object".into(),
            "typescript" => "unknown | null".into(),
            "go" => "any".into(),
            "rust" => "Option<serde_json::Value>".into(),
            _ => "Object".into(),
        },
        Value::Bool(_) => match target {
            "java" | "java-record" => "Boolean".into(),
            "typescript" => "boolean".into(),
            "go" => "bool".into(),
            "rust" => "bool".into(),
            _ => "boolean".into(),
        },
        Value::Number(n) => {
            let is_int = n.is_i64() || n.is_u64();
            let big = n.as_i64().is_some_and(|v| v > i32::MAX as i64 || v < i32::MIN as i64);
            match target {
                "java" | "java-record" => if is_int { if big { "Long" } else { "Integer" } } else { "Double" }.into(),
                "typescript" => "number".into(),
                "go" => if is_int { "int64" } else { "float64" }.into(),
                "rust" => if is_int { "i64" } else { "f64" }.into(),
                _ => "number".into(),
            }
        }
        Value::String(_) => match target {
            "java" | "java-record" => "String".into(),
            "typescript" => "string".into(),
            "go" => "string".into(),
            "rust" => "String".into(),
            _ => "string".into(),
        },
        Value::Array(arr) => {
            let elem = arr.first().map(|v| gen_type(&format!("{name}Item"), v, target, lombok, seen, out));
            let elem_ty = elem.unwrap_or_else(|| match target {
                "java" | "java-record" => "Object".into(),
                "typescript" => "unknown".into(),
                "go" => "any".into(),
                "rust" => "serde_json::Value".into(),
                _ => "Object".into(),
            });
            match target {
                "java" | "java-record" => format!("List<{elem_ty}>"),
                "typescript" => format!("{elem_ty}[]"),
                "go" => format!("[]{elem_ty}"),
                "rust" => format!("Vec<{elem_ty}>"),
                _ => elem_ty,
            }
        }
        Value::Object(map) => {
            let class_name = pascal_ident(name);
            if seen.insert(class_name.clone()) {
                let mut fields = Vec::new();
                for (k, v) in map {
                    let sub_name = pascal_ident(k);
                    let ty = gen_type(&sub_name, v, target, lombok, seen, out);
                    fields.push((k.clone(), ty));
                }
                out.push(render_struct(&class_name, &fields, target, lombok));
            }
            class_name
        }
    }
}

fn render_struct(name: &str, fields: &[(String, String)], target: &str, lombok: bool) -> String {
    match target {
        "java-record" => {
            let params: Vec<String> = fields.iter().map(|(k, ty)| format!("    {ty} {}", camel_ident(k))).collect();
            format!("public record {name}(\n{}\n) {{}}", params.join(",\n"))
        }
        "java" => {
            let mut s = String::new();
            if lombok {
                s.push_str("@Data\n");
            }
            s.push_str(&format!("public class {name} {{\n"));
            for (k, ty) in fields {
                let field_name = camel_ident(k);
                if field_name != *k {
                    s.push_str(&format!("    @JsonProperty(\"{k}\")\n"));
                }
                s.push_str(&format!("    private {ty} {field_name};\n"));
            }
            if !lombok {
                for (k, ty) in fields {
                    let field_name = camel_ident(k);
                    let method_name = pascal_ident(k);
                    s.push_str(&format!(
                        "\n    public {ty} get{method_name}() {{ return {field_name}; }}\n    public void set{method_name}({ty} {field_name}) {{ this.{field_name} = {field_name}; }}\n"
                    ));
                }
            }
            s.push('}');
            s
        }
        "typescript" => {
            let mut s = format!("export interface {name} {{\n");
            for (k, ty) in fields {
                s.push_str(&format!("  {k}: {ty};\n"));
            }
            s.push('}');
            s
        }
        "go" => {
            let mut s = format!("type {name} struct {{\n");
            for (k, ty) in fields {
                s.push_str(&format!("\t{} {ty} `json:\"{k}\"`\n", pascal_ident(k)));
            }
            s.push('}');
            s
        }
        "rust" => {
            let mut s = format!("#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]\npub struct {name} {{\n");
            for (k, ty) in fields {
                let field_name = snake_ident(k);
                if field_name != *k {
                    s.push_str(&format!("    #[serde(rename = \"{k}\")]\n"));
                }
                s.push_str(&format!("    pub {field_name}: {ty},\n"));
            }
            s.push('}');
            s
        }
        _ => String::new(),
    }
}

pub fn repair_json(input: &str, indent: &str) -> Result<String, Error> {
    let cleaned = relax_to_strict_json(input);
    let val: Value = serde_json::from_str(&cleaned)
        .map_err(|e| Error::Invalid(format!("Unable to repair JSON: {e}")))?;
    let canonical = serde_json::to_string(&val).map_err(|e| Error::Invalid(e.to_string()))?;
    format_json(&canonical, indent, false)
}

fn relax_to_strict_json(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut tokens: Vec<String> = Vec::new();
    let mut i = 0usize;

    while i < chars.len() {
        let ch = chars[i];
        if ch.is_whitespace() {
            i += 1;
            continue;
        }
        // Line comment //
        if ch == '/' && i + 1 < chars.len() && chars[i + 1] == '/' {
            i += 2;
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        // Block comment /* ... */
        if ch == '/' && i + 1 < chars.len() && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i = (i + 2).min(chars.len());
            continue;
        }
        // Double or single quoted string
        if ch == '"' || ch == '\'' {
            let quote = ch;
            i += 1;
            let mut s = String::from('"');
            while i < chars.len() {
                let c = chars[i];
                if c == '\\' && i + 1 < chars.len() {
                    let next = chars[i + 1];
                    if quote == '\'' && next == '\'' {
                        s.push('\'');
                    } else if quote == '\'' && next == '"' {
                        s.push_str("\\\"");
                    } else {
                        s.push('\\');
                        s.push(next);
                    }
                    i += 2;
                    continue;
                }
                if c == quote {
                    i += 1;
                    break;
                }
                match c {
                    '"' => s.push_str("\\\""),
                    '\n' => s.push_str("\\n"),
                    '\r' => s.push_str("\\r"),
                    '\t' => s.push_str("\\t"),
                    other => s.push(other),
                }
                i += 1;
            }
            s.push('"');
            tokens.push(s);
            continue;
        }
        if matches!(ch, '{' | '}' | '[' | ']' | ':' | ',') {
            // Strip trailing comma before closing bracket/brace
            if matches!(ch, '}' | ']') && tokens.last().map(String::as_str) == Some(",") {
                tokens.pop();
            }
            tokens.push(ch.to_string());
            i += 1;
            continue;
        }
        // Bare identifier / number / literal
        let start = i;
        while i < chars.len()
            && !chars[i].is_whitespace()
            && !matches!(chars[i], '{' | '}' | '[' | ']' | ':' | ',' | '"' | '\'' | '/')
        {
            i += 1;
        }
        let word: String = chars[start..i].iter().collect();
        // Check if followed by ':' -> quote unquoted object key
        let mut peek = i;
        while peek < chars.len() && chars[peek].is_whitespace() {
            peek += 1;
        }
        if peek < chars.len() && chars[peek] == ':' {
            let escaped = word.replace('\\', "\\\\").replace('"', "\\\"");
            tokens.push(format!("\"{escaped}\""));
        } else {
            let normalized = match word.as_str() {
                "True" | "TRUE" => "true".into(),
                "False" | "FALSE" => "false".into(),
                "None" | "none" | "undefined" | "NaN" | "Infinity" | "-Infinity" => "null".into(),
                _ => word,
            };
            tokens.push(normalized);
        }
    }
    tokens.join(" ")
}

pub fn flatten_json(input: &str, sep: &str) -> Result<String, Error> {
    let val: Value = serde_json::from_str(input).map_err(|e| Error::Invalid(format!("Invalid JSON: {e}")))?;
    let sep = if sep.is_empty() { "." } else { sep };
    let mut out = Map::new();
    flatten_rec(&val, String::new(), sep, &mut out);
    serde_json::to_string_pretty(&Value::Object(out)).map_err(|e| Error::Invalid(e.to_string()))
}

fn flatten_rec(val: &Value, prefix: String, sep: &str, out: &mut Map<String, Value>) {
    match val {
        Value::Object(map) if !map.is_empty() => {
            for (k, v) in map {
                let next_key = if prefix.is_empty() { k.clone() } else { format!("{prefix}{sep}{k}") };
                flatten_rec(v, next_key, sep, out);
            }
        }
        Value::Array(arr) if !arr.is_empty() => {
            for (idx, v) in arr.iter().enumerate() {
                let next_key = if prefix.is_empty() { idx.to_string() } else { format!("{prefix}{sep}{idx}") };
                flatten_rec(v, next_key, sep, out);
            }
        }
        other => {
            let key = if prefix.is_empty() { "$".into() } else { prefix };
            out.insert(key, other.clone());
        }
    }
}

pub fn unflatten_json(input: &str, sep: &str) -> Result<String, Error> {
    let val: Value = serde_json::from_str(input).map_err(|e| Error::Invalid(format!("Invalid JSON: {e}")))?;
    let obj = val.as_object().ok_or_else(|| Error::Invalid("Unflatten expects a JSON object".into()))?;
    let sep = if sep.is_empty() { "." } else { sep };
    let mut root = Value::Object(Map::new());
    for (k, v) in obj {
        let segs: Vec<&str> = k.split(sep).collect();
        insert_path(&mut root, &segs, v.clone());
    }
    serde_json::to_string_pretty(&root).map_err(|e| Error::Invalid(e.to_string()))
}

fn insert_path(target: &mut Value, segs: &[&str], leaf: Value) {
    if segs.is_empty() {
        return;
    }
    if segs.len() == 1 {
        if let Some(m) = target.as_object_mut() {
            m.insert(segs[0].to_owned(), leaf);
        }
        return;
    }
    let key = segs[0];
    if let Some(m) = target.as_object_mut() {
        let entry = m.entry(key.to_owned()).or_insert_with(|| Value::Object(Map::new()));
        if !entry.is_object() {
            *entry = Value::Object(Map::new());
        }
        insert_path(entry, &segs[1..], leaf);
    }
}

pub fn diff_json(left: &str, right: &str) -> Result<Value, Error> {
    let lval: Value = serde_json::from_str(left).map_err(|e| Error::Invalid(format!("Invalid left JSON: {e}")))?;
    let rval: Value = serde_json::from_str(right).map_err(|e| Error::Invalid(format!("Invalid right JSON: {e}")))?;
    let mut changes: Vec<Value> = Vec::new();
    diff_rec(&lval, &rval, "$", &mut changes);
    let added = changes.iter().filter(|c| c["kind"] == "added").count();
    let removed = changes.iter().filter(|c| c["kind"] == "removed").count();
    let changed = changes.iter().filter(|c| c["kind"] == "changed").count();
    Ok(serde_json::json!({
        "equal": changes.is_empty(),
        "summary": { "added": added, "removed": removed, "changed": changed },
        "changes": changes,
    }))
}

fn diff_rec(left: &Value, right: &Value, path: &str, out: &mut Vec<Value>) {
    match (left, right) {
        (Value::Object(lm), Value::Object(rm)) => {
            let mut keys: BTreeSet<&String> = lm.keys().collect();
            keys.extend(rm.keys());
            for k in keys {
                let next_path = format!("{path}.{k}");
                match (lm.get(k), rm.get(k)) {
                    (Some(lv), Some(rv)) => diff_rec(lv, rv, &next_path, out),
                    (None, Some(rv)) => out.push(serde_json::json!({ "path": next_path, "kind": "added", "right": rv })),
                    (Some(lv), None) => out.push(serde_json::json!({ "path": next_path, "kind": "removed", "left": lv })),
                    (None, None) => {}
                }
            }
        }
        (Value::Array(la), Value::Array(ra)) => {
            let max_len = la.len().max(ra.len());
            for idx in 0..max_len {
                let next_path = format!("{path}[{idx}]");
                match (la.get(idx), ra.get(idx)) {
                    (Some(lv), Some(rv)) => diff_rec(lv, rv, &next_path, out),
                    (None, Some(rv)) => out.push(serde_json::json!({ "path": next_path, "kind": "added", "right": rv })),
                    (Some(lv), None) => out.push(serde_json::json!({ "path": next_path, "kind": "removed", "left": lv })),
                    (None, None) => {}
                }
            }
        }
        _ if left != right => {
            out.push(serde_json::json!({ "path": path, "kind": "changed", "left": left, "right": right }));
        }
        _ => {}
    }
}
