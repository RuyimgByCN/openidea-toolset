use crate::string_tools::{CaseStyle, convert_case};
use openidea_plugin::Error;
use serde_json::{Map, Value};

#[derive(Clone, Debug)]
pub struct ColumnDef {
    pub name: String,
    pub sql_type: String,
    pub nullable: bool,
    pub primary_key: bool,
    pub default_val: Option<String>,
    pub comment: String,
}

#[derive(Clone, Debug)]
pub struct ParsedTable {
    pub table_name: String,
    pub columns: Vec<ColumnDef>,
}

pub fn parse_ddl(sql: &str) -> Result<ParsedTable, Error> {
    let cleaned = strip_sql_comments_preserving_strings(sql);
    let upper = cleaned.to_ascii_uppercase();
    let create_pos = find_keyword(&upper, "CREATE")
        .ok_or_else(|| Error::Invalid("Expected a CREATE TABLE DDL statement".into()))?;
    let after_create = &cleaned[create_pos..];
    let after_upper = &upper[create_pos..];
    let table_kw = find_keyword(after_upper, "TABLE")
        .ok_or_else(|| Error::Invalid("Expected CREATE TABLE statement".into()))?;

    let mut header = after_create[table_kw + 5..].trim_start();
    let open_paren = find_outside_quotes(header, '(')
        .ok_or_else(|| Error::Invalid("Missing '(' in CREATE TABLE column definition".into()))?;
    let before_paren = header[..open_paren].trim();
    header = &header[open_paren + 1..];

    let close_paren = find_matching_paren(header)
        .ok_or_else(|| Error::Invalid("Unclosed '(' in CREATE TABLE".into()))?;
    let body = &header[..close_paren];

    // Extract table name (strip IF NOT EXISTS and schema prefix)
    let table_tokens: Vec<&str> = before_paren.split_whitespace().collect();
    let raw_table = table_tokens.last().copied().unwrap_or("Table");
    let raw_table_part = raw_table.rsplit('.').next().unwrap_or(raw_table);
    let table_name = unquote_ident(raw_table_part);
    if table_name.is_empty() {
        return Err(Error::Invalid("Could not parse table name from DDL".into()));
    }

    let items = split_top_level_commas(body);
    let mut pk_cols: Vec<String> = Vec::new();
    let mut columns = Vec::new();

    for item in items {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            continue;
        }
        let u = trimmed.to_ascii_uppercase();
        if starts_with_kw(&u, "PRIMARY") {
            if let Some(cols) = extract_paren_cols(trimmed) {
                pk_cols.extend(cols);
            }
            continue;
        }
        if starts_with_kw(&u, "UNIQUE")
            || starts_with_kw(&u, "KEY")
            || starts_with_kw(&u, "INDEX")
            || starts_with_kw(&u, "FULLTEXT")
            || starts_with_kw(&u, "SPATIAL")
            || starts_with_kw(&u, "CONSTRAINT")
            || starts_with_kw(&u, "FOREIGN")
            || starts_with_kw(&u, "CHECK")
            || starts_with_kw(&u, "PARTITION")
            || starts_with_kw(&u, "LIKE")
        {
            continue;
        }

        if let Some(col) = parse_column_def(trimmed) {
            columns.push(col);
        }
    }

    for col in &mut columns {
        if pk_cols.iter().any(|p| p.eq_ignore_ascii_case(&col.name)) {
            col.primary_key = true;
            col.nullable = false;
        }
    }

    if columns.is_empty() {
        return Err(Error::Invalid("No columns found inside CREATE TABLE (...)".into()));
    }

    Ok(ParsedTable { table_name, columns })
}

fn parse_column_def(raw: &str) -> Option<ColumnDef> {
    let (col_name_raw, rest) = take_first_ident(raw)?;
    let name = unquote_ident(col_name_raw);
    if name.is_empty() {
        return None;
    }
    let rest = rest.trim_start();
    let (sql_type, tail) = take_type_spec(rest);
    if sql_type.is_empty() {
        return None;
    }

    let tail_upper = tail.to_ascii_uppercase();
    let primary_key = contains_kw(&tail_upper, "PRIMARY") && contains_kw(&tail_upper, "KEY");
    let nullable = !contains_kw(&tail_upper, "NOT NULL") && !primary_key;
    let default_val = extract_default_clause(tail);
    let comment = extract_comment_clause(tail);

    Some(ColumnDef {
        name,
        sql_type,
        nullable,
        primary_key,
        default_val,
        comment,
    })
}

fn extract_comment_clause(tail: &str) -> String {
    let upper = tail.to_ascii_uppercase();
    if let Some(pos) = find_keyword(&upper, "COMMENT") {
        let after = tail[pos + 7..].trim_start();
        if let Some(quoted) = extract_quoted_string(after) {
            return quoted;
        }
    }
    String::new()
}

fn extract_default_clause(tail: &str) -> Option<String> {
    let upper = tail.to_ascii_uppercase();
    let pos = find_keyword(&upper, "DEFAULT")?;
    let after = tail[pos + 7..].trim_start();
    if let Some(q) = extract_quoted_string(after) {
        return Some(format!("'{q}'"));
    }
    let tok = after.split_whitespace().next()?;
    Some(tok.trim_end_matches(',').to_owned())
}

fn extract_quoted_string(s: &str) -> Option<String> {
    let q = s.chars().next()?;
    if q != '\'' && q != '"' {
        return None;
    }
    let mut out = String::new();
    let mut chars = s[q.len_utf8()..].chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(esc) = chars.next() {
                out.push(esc);
            }
        } else if c == q {
            if chars.peek() == Some(&q) {
                chars.next();
                out.push(q);
            } else {
                return Some(out);
            }
        } else {
            out.push(c);
        }
    }
    None
}

fn extract_paren_cols(s: &str) -> Option<Vec<String>> {
    let open = s.find('(')?;
    let close = s[open + 1..].find(')')?;
    let inner = &s[open + 1..open + 1 + close];
    Some(
        inner
            .split(',')
            .map(|c| {
                let first = c.trim().split('(').next().unwrap_or("");
                unquote_ident(first.trim())
            })
            .filter(|c| !c.is_empty())
            .collect(),
    )
}

fn take_first_ident(s: &str) -> Option<(&str, &str)> {
    let s = s.trim_start();
    let first = s.chars().next()?;
    if matches!(first, '`' | '"' | '[') {
        let close = if first == '[' { ']' } else { first };
        if let Some(idx) = s[1..].find(close) {
            let end = 1 + idx + close.len_utf8();
            return Some((&s[..end], &s[end..]));
        }
    }
    let end = s.find(char::is_whitespace)?;
    Some((&s[..end], &s[end..]))
}

fn take_type_spec(s: &str) -> (String, &str) {
    let bytes = s.as_bytes();
    let mut i = 0;
    let mut depth = 0usize;
    while i < bytes.len() {
        let c = bytes[i] as char;
        if c == '(' {
            depth += 1;
        } else if c == ')' {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                i += 1;
                break;
            }
        } else if c.is_whitespace() && depth == 0 {
            // Keep `(precision, scale)` if immediately following whitespace before `(`
            let rest = s[i..].trim_start();
            if rest.starts_with('(') {
                i = s.len() - rest.len();
                continue;
            }
            break;
        }
        i += 1;
    }
    let ty = s[..i].split_whitespace().collect::<Vec<_>>().join("");
    (ty, &s[i..])
}

pub fn ddl_convert(sql: &str, target: &str, root_name: &str, lombok: bool) -> Result<String, Error> {
    let parsed = parse_ddl(sql)?;
    let class_name = if root_name.trim().is_empty() {
        convert_case(&parsed.table_name, CaseStyle::Pascal)
    } else {
        root_name.trim().to_owned()
    };
    let class_name = if class_name.is_empty() { "Entity".into() } else { class_name };

    match target {
        "json" => {
            let mut map = Map::new();
            for col in &parsed.columns {
                map.insert(col.name.clone(), sample_json_value(&col.sql_type, &col.name));
            }
            serde_json::to_string_pretty(&Value::Object(map)).map_err(|e| Error::Invalid(e.to_string()))
        }
        "markdown" => {
            let mut lines = vec![
                format!("### `{}`", parsed.table_name),
                String::new(),
                "| Column | Type | Nullable | Default | Comment |".to_owned(),
                "| --- | --- | --- | --- | --- |".to_owned(),
            ];
            for col in &parsed.columns {
                let mut key_info = if col.primary_key { "PK".to_owned() } else { String::new() };
                if let Some(def) = &col.default_val {
                    if !key_info.is_empty() {
                        key_info.push_str(", ");
                    }
                    key_info.push_str(def);
                }
                let comment = col.comment.replace('|', "\\|");
                lines.push(format!(
                    "| `{}` | `{}` | {} | {} | {} |",
                    col.name,
                    col.sql_type,
                    if col.nullable { "YES" } else { "NO" },
                    if key_info.is_empty() { "-" } else { &key_info },
                    if comment.is_empty() { "-" } else { &comment },
                ));
            }
            Ok(lines.join("\n"))
        }
        "java" => {
            let mut lines = Vec::new();
            if lombok {
                lines.push("import lombok.Data;".into());
                lines.push(String::new());
                lines.push("@Data".into());
            }
            lines.push(format!("public class {class_name} {{"));
            for col in &parsed.columns {
                if !col.comment.is_empty() {
                    lines.push(format!("    /** {} */", col.comment));
                }
                let field = camel_field(&col.name);
                if field != col.name {
                    lines.push(format!("    @JsonProperty(\"{}\")", col.name));
                }
                let jtype = sql_type_to_java(&col.sql_type);
                lines.push(format!("    private {jtype} {field};"));
            }
            if !lombok {
                lines.push(String::new());
                for col in &parsed.columns {
                    let field = camel_field(&col.name);
                    let pascal = pascal_field(&col.name);
                    let jtype = sql_type_to_java(&col.sql_type);
                    lines.push(format!("    public {jtype} get{pascal}() {{ return {field}; }}"));
                    lines.push(format!("    public void set{pascal}({jtype} {field}) {{ this.{field} = {field}; }}"));
                }
            }
            lines.push("}".into());
            Ok(lines.join("\n"))
        }
        "java-record" => {
            let params: Vec<String> = parsed
                .columns
                .iter()
                .map(|c| {
                    let jtype = sql_type_to_java(&c.sql_type);
                    let field = camel_field(&c.name);
                    format!("    {jtype} {field}")
                })
                .collect();
            Ok(format!("public record {class_name}(\n{}\n) {{}}", params.join(",\n")))
        }
        "typescript" => {
            let mut lines = vec![format!("export interface {class_name} {{")];
            for col in &parsed.columns {
                if !col.comment.is_empty() {
                    lines.push(format!("  /** {} */", col.comment));
                }
                let opt = if col.nullable { "?" } else { "" };
                lines.push(format!("  {}{opt}: {};", col.name, sql_type_to_ts(&col.sql_type)));
            }
            lines.push("}".into());
            Ok(lines.join("\n"))
        }
        "go" => {
            let mut lines = vec![format!("type {class_name} struct {{")];
            for col in &parsed.columns {
                let pascal = pascal_field(&col.name);
                let gtype = sql_type_to_go(&col.sql_type, col.nullable);
                let comment = if col.comment.is_empty() {
                    String::new()
                } else {
                    format!(" // {}", col.comment)
                };
                lines.push(format!("\t{pascal} {gtype} `json:\"{}\" db:\"{}\"`{comment}", col.name, col.name));
            }
            lines.push("}".into());
            Ok(lines.join("\n"))
        }
        "rust" => {
            let mut lines = vec![
                "#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]".to_owned(),
                format!("pub struct {class_name} {{"),
            ];
            for col in &parsed.columns {
                if !col.comment.is_empty() {
                    lines.push(format!("    /// {}", col.comment));
                }
                let snake = convert_case(&col.name, CaseStyle::Snake);
                let rtype = sql_type_to_rust(&col.sql_type);
                let wrapped = if col.nullable { format!("Option<{rtype}>") } else { rtype.into() };
                if snake != col.name {
                    lines.push(format!("    #[serde(rename = \"{}\")]", col.name));
                }
                lines.push(format!("    pub {snake}: {wrapped},"));
            }
            lines.push("}".into());
            Ok(lines.join("\n"))
        }
        _ => Err(Error::Invalid(format!("Unsupported DDL target {target}"))),
    }
}

fn base_sql_type(sql_type: &str) -> String {
    sql_type
        .split('(')
        .next()
        .unwrap_or(sql_type)
        .trim()
        .to_ascii_uppercase()
}

fn sample_json_value(sql_type: &str, name: &str) -> Value {
    let base = base_sql_type(sql_type);
    if sql_type.eq_ignore_ascii_case("tinyint(1)") || matches!(base.as_str(), "BOOL" | "BOOLEAN" | "BIT") {
        return Value::Bool(true);
    }
    match base.as_str() {
        "BIGINT" | "INT8" | "SERIAL" | "BIGSERIAL" => Value::Number(1.into()),
        "INT" | "INTEGER" | "SMALLINT" | "MEDIUMINT" | "TINYINT" | "INT2" | "INT4" => Value::Number(0.into()),
        "DECIMAL" | "NUMERIC" | "FLOAT" | "DOUBLE" | "REAL" => serde_json::json!(0.0),
        "DATE" => Value::String("2026-01-01".into()),
        "DATETIME" | "TIMESTAMP" | "TIMESTAMPTZ" => Value::String("2026-01-01T00:00:00Z".into()),
        "JSON" | "JSONB" => serde_json::json!({}),
        _ => Value::String(if name.contains("email") { "user@example.com".into() } else { format!("{name}_sample") }),
    }
}

fn sql_type_to_java(sql_type: &str) -> &'static str {
    if sql_type.eq_ignore_ascii_case("tinyint(1)") {
        return "Boolean";
    }
    match base_sql_type(sql_type).as_str() {
        "BIGINT" | "INT8" | "BIGSERIAL" => "Long",
        "INT" | "INTEGER" | "SMALLINT" | "MEDIUMINT" | "TINYINT" | "INT2" | "INT4" | "SERIAL" => "Integer",
        "DECIMAL" | "NUMERIC" => "java.math.BigDecimal",
        "DOUBLE" | "FLOAT8" => "Double",
        "FLOAT" | "REAL" | "FLOAT4" => "Float",
        "BOOL" | "BOOLEAN" | "BIT" => "Boolean",
        "DATE" => "java.time.LocalDate",
        "TIME" => "java.time.LocalTime",
        "DATETIME" | "TIMESTAMP" | "TIMESTAMPTZ" => "java.time.LocalDateTime",
        "BLOB" | "LONGBLOB" | "BYTEA" | "BINARY" | "VARBINARY" => "byte[]",
        _ => "String",
    }
}

fn sql_type_to_ts(sql_type: &str) -> &'static str {
    if sql_type.eq_ignore_ascii_case("tinyint(1)") {
        return "boolean";
    }
    match base_sql_type(sql_type).as_str() {
        "INT" | "INTEGER" | "BIGINT" | "SMALLINT" | "TINYINT" | "DECIMAL" | "NUMERIC" | "FLOAT" | "DOUBLE" | "REAL" => "number",
        "BOOL" | "BOOLEAN" | "BIT" => "boolean",
        "JSON" | "JSONB" => "Record<string, unknown>",
        _ => "string",
    }
}

fn sql_type_to_go(sql_type: &str, nullable: bool) -> &'static str {
    let base = if sql_type.eq_ignore_ascii_case("tinyint(1)") {
        "bool"
    } else {
        match base_sql_type(sql_type).as_str() {
            "BIGINT" | "INT8" | "BIGSERIAL" => "int64",
            "INT" | "INTEGER" | "SMALLINT" | "MEDIUMINT" | "TINYINT" | "INT2" | "INT4" | "SERIAL" => "int",
            "DECIMAL" | "NUMERIC" | "DOUBLE" | "FLOAT" | "REAL" => "float64",
            "BOOL" | "BOOLEAN" | "BIT" => "bool",
            "DATE" | "DATETIME" | "TIMESTAMP" | "TIMESTAMPTZ" => "time.Time",
            "BLOB" | "BYTEA" | "BINARY" | "VARBINARY" => "[]byte",
            _ => "string",
        }
    };
    if !nullable {
        return base;
    }
    match base {
        "int64" => "*int64",
        "int" => "*int",
        "float64" => "*float64",
        "bool" => "*bool",
        "time.Time" => "*time.Time",
        "string" => "*string",
        other => other,
    }
}

fn sql_type_to_rust(sql_type: &str) -> &'static str {
    if sql_type.eq_ignore_ascii_case("tinyint(1)") {
        return "bool";
    }
    match base_sql_type(sql_type).as_str() {
        "BIGINT" | "INT8" | "BIGSERIAL" => "i64",
        "INT" | "INTEGER" | "SMALLINT" | "MEDIUMINT" | "TINYINT" | "INT2" | "INT4" | "SERIAL" => "i32",
        "DECIMAL" | "NUMERIC" | "DOUBLE" | "FLOAT" | "REAL" => "f64",
        "BOOL" | "BOOLEAN" | "BIT" => "bool",
        "JSON" | "JSONB" => "serde_json::Value",
        "BLOB" | "BYTEA" | "BINARY" | "VARBINARY" => "Vec<u8>",
        _ => "String",
    }
}

fn camel_field(name: &str) -> String {
    let c = convert_case(name, CaseStyle::Camel);
    if c.is_empty() { "field".into() } else { c }
}

fn pascal_field(name: &str) -> String {
    let p = convert_case(name, CaseStyle::Pascal);
    if p.is_empty() { "Field".into() } else { p }
}

/// Strips backtick / double-quote / bracket identifier delimiters and leading `table.` / `schema.` qualifiers.
pub fn strip_qualifiers(sql: &str) -> String {
    let chars: Vec<char> = sql.chars().collect();
    let mut out = String::with_capacity(sql.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        // Preserve single-quoted SQL string literals verbatim
        if c == '\'' {
            out.push(c);
            i += 1;
            while i < chars.len() {
                out.push(chars[i]);
                if chars[i] == '\'' {
                    if chars.get(i + 1) == Some(&'\'') {
                        i += 1;
                        out.push(chars[i]);
                    } else {
                        i += 1;
                        break;
                    }
                }
                i += 1;
            }
            continue;
        }
        // Preserve comments
        if c == '-' && chars.get(i + 1) == Some(&'-') {
            while i < chars.len() && chars[i] != '\n' {
                out.push(chars[i]);
                i += 1;
            }
            continue;
        }
        if c == '/' && chars.get(i + 1) == Some(&'*') {
            out.push_str("/*");
            i += 2;
            while i < chars.len() {
                out.push(chars[i]);
                if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                    out.push('/');
                    i += 2;
                    break;
                }
                i += 1;
            }
            continue;
        }

        // Handle identifier chain `a`.`b`.`c` or "a"."b" or [a].[b]
        if is_ident_or_quoted_start(&chars, i) {
            let start = i;
            let mut segs = Vec::new();
            let mut cur = i;
            let mut all_numeric = true;
            loop {
                let (seg, next, quoted) = read_ident_segment(&chars, cur);
                if seg.is_empty() {
                    break;
                }
                if quoted || !seg.chars().all(|ch| ch.is_ascii_digit()) {
                    all_numeric = false;
                }
                segs.push(seg);
                cur = next;
                if chars.get(cur) == Some(&'.') {
                    if chars.get(cur + 1).is_some_and(|ch| ch.is_alphanumeric() || matches!(ch, '_' | '`' | '"' | '[' | '*')) {
                        cur += 1;
                        continue;
                    }
                }
                break;
            }
            if !segs.is_empty() {
                if all_numeric && segs.len() > 1 {
                    // Decimal number like 12.34: keep raw!
                    for ch in &chars[start..cur] {
                        out.push(*ch);
                    }
                } else {
                    out.push_str(segs.last().unwrap());
                }
                i = cur;
                continue;
            }
        }

        out.push(c);
        i += 1;
    }
    out
}

fn is_ident_or_quoted_start(chars: &[char], i: usize) -> bool {
    let c = chars[i];
    c.is_alphanumeric() || matches!(c, '_' | '`' | '"' | '[' | '*')
}

fn read_ident_segment(chars: &[char], start: usize) -> (String, usize, bool) {
    let Some(&first) = chars.get(start) else {
        return (String::new(), start, false);
    };
    if matches!(first, '`' | '"' | '[') {
        let close = if first == '[' { ']' } else { first };
        let mut i = start + 1;
        let mut buf = String::new();
        while i < chars.len() {
            if chars[i] == close {
                return (buf, i + 1, true);
            }
            buf.push(chars[i]);
            i += 1;
        }
        return (chars[start..].iter().collect(), chars.len(), true);
    }
    if first == '*' {
        return ("*".into(), start + 1, false);
    }
    let mut i = start;
    let mut buf = String::new();
    while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
        buf.push(chars[i]);
        i += 1;
    }
    (buf, i, false)
}

/// Binds JDBC / MyBatis `?` parameters into SQL.
pub fn bind_sql_params(sql: &str, params_raw: &str) -> Result<String, Error> {
    let params = parse_sql_param_list(params_raw)?;
    let chars: Vec<char> = sql.chars().collect();
    let mut out = String::with_capacity(sql.len() + 32);
    let mut i = 0;
    let mut p_idx = 0usize;

    while i < chars.len() {
        let c = chars[i];
        if matches!(c, '\'' | '"' | '`') {
            let q = c;
            out.push(c);
            i += 1;
            while i < chars.len() {
                out.push(chars[i]);
                if chars[i] == q {
                    if chars.get(i + 1) == Some(&q) {
                        i += 1;
                        out.push(chars[i]);
                    } else {
                        i += 1;
                        break;
                    }
                }
                i += 1;
            }
            continue;
        }
        if c == '-' && chars.get(i + 1) == Some(&'-') {
            while i < chars.len() && chars[i] != '\n' {
                out.push(chars[i]);
                i += 1;
            }
            continue;
        }
        if c == '?' {
            if let Some(val) = params.get(p_idx) {
                out.push_str(val);
            } else {
                out.push('?');
            }
            p_idx += 1;
            i += 1;
            continue;
        }
        out.push(c);
        i += 1;
    }
    Ok(out)
}

fn parse_sql_param_list(raw: &str) -> Result<Vec<String>, Error> {
    let mut cleaned = raw.trim();
    for prefix in ["Parameters:", "parameters:", "==> Parameters:"] {
        if let Some(rest) = cleaned.strip_prefix(prefix) {
            cleaned = rest.trim();
        }
    }
    if cleaned.is_empty() {
        return Ok(Vec::new());
    }
    if cleaned.starts_with('[') && cleaned.ends_with(']') {
        let arr: Vec<Value> = serde_json::from_str(cleaned)
            .map_err(|e| Error::Invalid(format!("Invalid JSON parameter array: {e}")))?;
        return Ok(arr
            .into_iter()
            .map(|v| match v {
                Value::Null => "NULL".into(),
                Value::Bool(b) => if b { "true".into() } else { "false".into() },
                Value::Number(n) => n.to_string(),
                Value::String(s) => format!("'{}'", s.replace('\'', "''")),
                other => format!("'{}'", other.to_string().replace('\'', "''")),
            })
            .collect());
    }

    // Split by comma (or newline if no commas), ignoring commas inside parentheses if MyBatis format
    let parts: Vec<&str> = if cleaned.contains(',') {
        cleaned.split(',').collect()
    } else {
        cleaned.lines().collect()
    };

    let mut out = Vec::new();
    for part in parts {
        let item = part.trim();
        if item.is_empty() {
            continue;
        }
        if item.eq_ignore_ascii_case("null") {
            out.push("NULL".into());
            continue;
        }
        if let Some(open) = item.rfind('(') {
            if item.ends_with(')') && open > 0 {
                let val = item[..open].trim();
                let ty = item[open + 1..item.len() - 1].trim().to_ascii_lowercase();
                let formatted = match ty.as_str() {
                    "integer" | "int" | "long" | "short" | "byte" | "bigdecimal" | "double" | "float" | "number"
                    | "boolean" | "bool" => val.to_owned(),
                    _ => format!("'{}'", val.replace('\'', "''")),
                };
                out.push(formatted);
                continue;
            }
        }
        // Heuristic: unquoted integer/decimal/boolean/null stays unquoted
        if item.eq_ignore_ascii_case("true") || item.eq_ignore_ascii_case("false") || item.parse::<f64>().is_ok() {
            out.push(item.to_owned());
        } else if (item.starts_with('\'') && item.ends_with('\'')) || (item.starts_with('"') && item.ends_with('"')) {
            let inner = &item[1..item.len() - 1];
            out.push(format!("'{}'", inner.replace('\'', "''")));
        } else {
            out.push(format!("'{}'", item.replace('\'', "''")));
        }
    }
    Ok(out)
}

fn unquote_ident(s: &str) -> String {
    let t = s.trim();
    if (t.starts_with('`') && t.ends_with('`'))
        || (t.starts_with('"') && t.ends_with('"'))
        || (t.starts_with('[') && t.ends_with(']'))
    {
        t[1..t.len() - 1].to_owned()
    } else {
        t.to_owned()
    }
}

fn strip_sql_comments_preserving_strings(sql: &str) -> String {
    let chars: Vec<char> = sql.chars().collect();
    let mut out = String::with_capacity(sql.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\'' || c == '"' || c == '`' {
            let q = c;
            out.push(c);
            i += 1;
            while i < chars.len() {
                out.push(chars[i]);
                if chars[i] == q {
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }
        if c == '-' && chars.get(i + 1) == Some(&'-') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
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
            out.push(' ');
            continue;
        }
        out.push(c);
        i += 1;
    }
    out
}

fn find_keyword(upper: &str, kw: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(rel) = upper[from..].find(kw) {
        let pos = from + rel;
        let left_ok = pos == 0 || !upper[..pos].chars().last().unwrap().is_alphanumeric();
        let after = pos + kw.len();
        let right_ok = after >= upper.len() || !upper[after..].chars().next().unwrap().is_alphanumeric();
        if left_ok && right_ok {
            return Some(pos);
        }
        from = after;
    }
    None
}

fn contains_kw(upper: &str, kw: &str) -> bool {
    find_keyword(upper, kw).is_some()
}

fn starts_with_kw(upper: &str, kw: &str) -> bool {
    upper.starts_with(kw) && upper[kw.len()..].chars().next().is_none_or(|c| !c.is_alphanumeric() && c != '_')
}

fn find_outside_quotes(s: &str, target: char) -> Option<usize> {
    let mut q: Option<char> = None;
    for (idx, c) in s.char_indices() {
        if let Some(quote) = q {
            if c == quote {
                q = None;
            }
        } else if matches!(c, '\'' | '"' | '`') {
            q = Some(c);
        } else if c == target {
            return Some(idx);
        }
    }
    None
}

fn find_matching_paren(s: &str) -> Option<usize> {
    let mut depth = 1usize;
    let mut q: Option<char> = None;
    for (idx, c) in s.char_indices() {
        if let Some(quote) = q {
            if c == quote {
                q = None;
            }
            continue;
        }
        match c {
            '\'' | '"' | '`' => q = Some(c),
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(idx);
                }
            }
            _ => {}
        }
    }
    None
}

fn split_top_level_commas(s: &str) -> Vec<&str> {
    let mut items = Vec::new();
    let mut start = 0;
    let mut depth = 0usize;
    let mut q: Option<char> = None;
    let chars: Vec<(usize, char)> = s.char_indices().collect();
    let mut idx = 0;
    while idx < chars.len() {
        let (pos, c) = chars[idx];
        if let Some(quote) = q {
            if c == '\\' {
                idx += 2;
                continue;
            }
            if c == quote {
                if chars.get(idx + 1).is_some_and(|(_, nc)| *nc == quote) {
                    idx += 2;
                    continue;
                }
                q = None;
            }
        } else {
            match c {
                '\'' | '"' | '`' => q = Some(c),
                '(' => depth += 1,
                ')' => depth = depth.saturating_sub(1),
                ',' if depth == 0 => {
                    items.push(&s[start..pos]);
                    start = pos + 1;
                }
                _ => {}
            }
        }
        idx += 1;
    }
    items.push(&s[start..]);
    items
}
