use openidea_plugin::Error;
use serde_json::{Map, Value, json};

pub fn resolve_delimiter(delim_spec: &str, text: &str) -> char {
    match delim_spec.trim() {
        "," | "comma" => ',',
        "\\t" | "\t" | "tab" | "tsv" => '\t',
        ";" | "semi" => ';',
        "|" | "pipe" => '|',
        _ => {
            let sample: String = text.lines().take(5).collect::<Vec<_>>().join("\n");
            let candidates = [('\t', sample.matches('\t').count()), (',', sample.matches(',').count()), (';', sample.matches(';').count()), ('|', sample.matches('|').count())];
            candidates
                .into_iter()
                .max_by_key(|(_, cnt)| *cnt)
                .filter(|(_, cnt)| *cnt > 0)
                .map_or(',', |(c, _)| c)
        }
    }
}

pub fn parse_csv_rows(text: &str, delim: char) -> Result<Vec<Vec<String>>, Error> {
    let clean = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    if clean.trim().is_empty() {
        return Ok(Vec::new());
    }
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut current_row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let chars: Vec<char> = clean.chars().collect();
    let mut i = 0usize;

    while i < chars.len() {
        let ch = chars[i];
        if in_quotes {
            if ch == '"' {
                if i + 1 < chars.len() && chars[i + 1] == '"' {
                    field.push('"');
                    i += 2;
                    continue;
                }
                in_quotes = false;
            } else {
                field.push(ch);
            }
        } else if ch == '"' && field.is_empty() {
            in_quotes = true;
        } else if ch == delim {
            current_row.push(std::mem::take(&mut field));
        } else if ch == '\r' {
            current_row.push(std::mem::take(&mut field));
            rows.push(std::mem::take(&mut current_row));
            if i + 1 < chars.len() && chars[i + 1] == '\n' {
                i += 1;
            }
        } else if ch == '\n' {
            current_row.push(std::mem::take(&mut field));
            rows.push(std::mem::take(&mut current_row));
        } else {
            field.push(ch);
        }
        i += 1;
    }
    if in_quotes {
        return Err(Error::Invalid("Unclosed quoted field in CSV input".into()));
    }
    if !field.is_empty() || !current_row.is_empty() {
        current_row.push(field);
        rows.push(current_row);
    }
    Ok(rows)
}

fn normalize_table(text: &str, from: &str, delimiter: &str, has_header: bool) -> Result<(char, Vec<String>, Vec<Vec<String>>), Error> {
    if from.eq_ignore_ascii_case("json") {
        let val: Value = serde_json::from_str(text).map_err(|e| Error::Invalid(format!("Invalid JSON input: {e}")))?;
        let arr = val.as_array().ok_or_else(|| Error::Invalid("JSON table input must be an array".into()))?;
        if arr.is_empty() {
            return Ok((',', Vec::new(), Vec::new()));
        }
        if let Some(first_arr) = arr[0].as_array() {
            let col_count = first_arr.len();
            let headers: Vec<String> = if has_header {
                first_arr.iter().map(scalar_str).collect()
            } else {
                (1..=col_count).map(|i| format!("col_{i}")).collect()
            };
            let start = if has_header { 1 } else { 0 };
            let rows = arr[start..]
                .iter()
                .map(|r| {
                    let row = r.as_array().map(|a| a.iter().map(scalar_str).collect()).unwrap_or_default();
                    pad_row(row, headers.len())
                })
                .collect();
            return Ok((',', headers, rows));
        }
        // Array of objects
        let mut headers = Vec::new();
        for item in arr {
            if let Some(obj) = item.as_object() {
                for k in obj.keys() {
                    if !headers.contains(k) {
                        headers.push(k.clone());
                    }
                }
            }
        }
        let rows = arr
            .iter()
            .map(|item| {
                let obj = item.as_object();
                headers
                    .iter()
                    .map(|h| obj.and_then(|m| m.get(h)).map(scalar_str).unwrap_or_default())
                    .collect()
            })
            .collect();
        return Ok((',', headers, rows));
    }

    let delim = if from.eq_ignore_ascii_case("tsv") {
        '\t'
    } else {
        resolve_delimiter(delimiter, text)
    };
    let raw_rows = parse_csv_rows(text, delim)?;
    if raw_rows.is_empty() {
        return Ok((delim, Vec::new(), Vec::new()));
    }
    let width = raw_rows.iter().map(Vec::len).max().unwrap_or(0);
    if has_header {
        let headers = pad_row(raw_rows[0].clone(), width);
        let rows = raw_rows[1..].iter().map(|r| pad_row(r.clone(), width)).collect();
        Ok((delim, headers, rows))
    } else {
        let headers = (1..=width).map(|i| format!("col_{i}")).collect();
        let rows = raw_rows.into_iter().map(|r| pad_row(r, width)).collect();
        Ok((delim, headers, rows))
    }
}

fn pad_row(mut r: Vec<String>, width: usize) -> Vec<String> {
    if r.len() < width {
        r.resize(width, String::new());
    }
    r
}

fn scalar_str(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        other => other.to_string(),
    }
}

fn transpose_table(headers: Vec<String>, rows: Vec<Vec<String>>) -> (Vec<String>, Vec<Vec<String>>) {
    if headers.is_empty() {
        return (headers, rows);
    }
    let mut matrix = vec![headers];
    matrix.extend(rows);
    let max_cols = matrix.iter().map(Vec::len).max().unwrap_or(0);
    let mut transposed = Vec::with_capacity(max_cols);
    for c in 0..max_cols {
        transposed.push(matrix.iter().map(|r| r.get(c).cloned().unwrap_or_default()).collect::<Vec<_>>());
    }
    let new_headers = transposed.first().cloned().unwrap_or_default();
    let new_rows = if transposed.len() > 1 { transposed[1..].to_vec() } else { Vec::new() };
    (new_headers, new_rows)
}

pub fn parse_table_preview(text: &str, from: &str, delimiter: &str, has_header: bool) -> Result<Value, Error> {
    let (delim, headers, rows) = normalize_table(text, from, delimiter, has_header)?;
    let total = rows.len();
    let preview: Vec<Vec<String>> = rows.into_iter().take(200).collect();
    Ok(json!({
        "delimiter": delim.to_string(),
        "headers": headers,
        "rows": preview,
        "rowCount": total,
        "colCount": headers.len(),
    }))
}

pub fn convert_table(
    text: &str,
    from: &str,
    to: &str,
    delimiter: &str,
    has_header: bool,
    table_name: &str,
    transpose: bool,
) -> Result<String, Error> {
    let (_, mut headers, mut rows) = normalize_table(text, from, delimiter, has_header)?;
    if transpose {
        (headers, rows) = transpose_table(headers, rows);
    }
    if headers.is_empty() {
        return Ok(String::new());
    }

    match to {
        "json-objects" => {
            let objs: Vec<Value> = rows
                .into_iter()
                .map(|r| {
                    let mut m = Map::new();
                    for (i, h) in headers.iter().enumerate() {
                        m.insert(h.clone(), infer_json_scalar(r.get(i).map(String::as_str).unwrap_or("")));
                    }
                    Value::Object(m)
                })
                .collect();
            serde_json::to_string_pretty(&objs).map_err(|e| Error::Invalid(e.to_string()))
        }
        "json-arrays" => {
            let mut all = vec![headers];
            all.extend(rows);
            serde_json::to_string_pretty(&all).map_err(|e| Error::Invalid(e.to_string()))
        }
        "csv" => Ok(render_delimited(&headers, &rows, ',')),
        "tsv" => Ok(render_delimited(&headers, &rows, '\t')),
        "markdown" => {
            let mut lines = Vec::with_capacity(rows.len() + 2);
            lines.push(format!("| {} |", headers.iter().map(|s| s.replace('|', "\\|")).collect::<Vec<_>>().join(" | ")));
            lines.push(format!("| {} |", headers.iter().map(|_| "---").collect::<Vec<_>>().join(" | ")));
            for r in &rows {
                lines.push(format!("| {} |", r.iter().map(|s| s.replace('|', "\\|")).collect::<Vec<_>>().join(" | ")));
            }
            Ok(lines.join("\n"))
        }
        "sql-insert" => {
            let tbl = if table_name.trim().is_empty() { "data_table" } else { table_name.trim() };
            let cols = headers
                .iter()
                .map(|h| format!("`{}`", h.replace('`', "")))
                .collect::<Vec<_>>()
                .join(", ");
            let stmts: Vec<String> = rows
                .iter()
                .map(|r| {
                    let vals = r
                        .iter()
                        .map(|v| format_sql_literal(v))
                        .collect::<Vec<_>>()
                        .join(", ");
                    format!("INSERT INTO `{}` ({cols}) VALUES ({vals});", tbl.replace('`', ""))
                })
                .collect();
            Ok(stmts.join("\n"))
        }
        "html" => {
            let mut out = String::from("<table>\n  <thead>\n    <tr>");
            for h in &headers {
                out.push_str(&format!("<th>{}</th>", escape_html(h)));
            }
            out.push_str("</tr>\n  </thead>\n  <tbody>\n");
            for r in &rows {
                out.push_str("    <tr>");
                for cell in r {
                    out.push_str(&format!("<td>{}</td>", escape_html(cell)));
                }
                out.push_str("</tr>\n");
            }
            out.push_str("  </tbody>\n</table>");
            Ok(out)
        }
        other => Err(Error::Invalid(format!("Unsupported target table format {other}"))),
    }
}

fn infer_json_scalar(s: &str) -> Value {
    let t = s.trim();
    if t.eq_ignore_ascii_case("true") {
        return Value::Bool(true);
    }
    if t.eq_ignore_ascii_case("false") {
        return Value::Bool(false);
    }
    if let Ok(n) = t.parse::<i64>() {
        return Value::Number(n.into());
    }
    if let Ok(f) = t.parse::<f64>() {
        if let Some(num) = serde_json::Number::from_f64(f) {
            return Value::Number(num);
        }
    }
    Value::String(s.to_owned())
}

fn format_sql_literal(s: &str) -> String {
    let t = s.trim();
    if t.is_empty() || t.eq_ignore_ascii_case("null") {
        "NULL".into()
    } else if t.eq_ignore_ascii_case("true") || t.eq_ignore_ascii_case("false") {
        t.to_ascii_uppercase()
    } else if t.parse::<i64>().is_ok() || t.parse::<f64>().is_ok() {
        t.to_owned()
    } else {
        format!("'{}'", s.replace('\'', "''"))
    }
}

fn escape_delim_field(s: &str, delim: char) -> String {
    if s.contains(delim) || s.contains('"') || s.contains('\n') || s.contains('\r') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_owned()
    }
}

fn render_delimited(headers: &[String], rows: &[Vec<String>], delim: char) -> String {
    let mut lines = Vec::with_capacity(rows.len() + 1);
    let sep = delim.to_string();
    lines.push(headers.iter().map(|h| escape_delim_field(h, delim)).collect::<Vec<_>>().join(&sep));
    for r in rows {
        lines.push(r.iter().map(|c| escape_delim_field(c, delim)).collect::<Vec<_>>().join(&sep));
    }
    lines.join("\n")
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
