use crate::storage::{HostProfile, HttpActiveRequest};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use openidea_plugin::{Error, HttpRequest, host};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::net::IpAddr;

// ============================================================================
// 1. Path Converter (Windows / POSIX / Git Bash / WSL / file:// / Escaped)
// ============================================================================

pub fn convert_path(input: &str, wsl_distro: &str) -> Value {
    let trimmed = input.trim().trim_matches(|c| c == '"' || c == '\'');
    let distro = if wsl_distro.trim().is_empty() { "Ubuntu" } else { wsl_distro.trim() };

    // Decode file:// URI first if applicable
    let un_uri = if let Some(rest) = trimmed.strip_prefix("file:///") {
        // Windows drive e.g. file:///C:/foo -> C:/foo, POSIX e.g. file:///usr/bin -> /usr/bin
        let decoded = crate::converters::url_decode(rest);
        if decoded.as_bytes().get(1) == Some(&b':') {
            decoded
        } else {
            format!("/{decoded}")
        }
    } else if let Some(rest) = trimmed.strip_prefix("file://") {
        let decoded = crate::converters::url_decode(rest);
        format!("//{decoded}")
    } else {
        trimmed.replace("\\\\", "\\")
    };

    // Detect /mnt/<drive>/... (WSL), /<drive>/... (Git Bash / Cygwin), or <drive>:\...
    let mut drive: Option<char> = None;
    let mut rel_parts: Vec<String> = Vec::new();
    let mut is_abs = false;
    let slash_norm = un_uri.replace('\\', "/");

    if let Some(after_wsl) = slash_norm.strip_prefix("//wsl.localhost/").or_else(|| slash_norm.strip_prefix("//wsl$/")) {
        is_abs = true;
        let mut iter = after_wsl.split('/');
        let _distro_part = iter.next();
        for seg in iter {
            push_norm_seg(&mut rel_parts, seg);
        }
    } else if slash_norm.as_bytes().get(1) == Some(&b':') && slash_norm.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) {
        drive = Some(slash_norm.chars().next().unwrap().to_ascii_uppercase());
        is_abs = true;
        for seg in slash_norm[2..].split('/') {
            push_norm_seg(&mut rel_parts, seg);
        }
    } else if let Some(after_mnt) = slash_norm.strip_prefix("/mnt/") {
        let mut parts_iter = after_mnt.splitn(2, '/');
        if let Some(d) = parts_iter.next().filter(|d| d.len() == 1 && d.chars().all(|c| c.is_ascii_alphabetic())) {
            drive = Some(d.chars().next().unwrap().to_ascii_uppercase());
            is_abs = true;
            if let Some(tail) = parts_iter.next() {
                for seg in tail.split('/') {
                    push_norm_seg(&mut rel_parts, seg);
                }
            }
        }
    } else if slash_norm.starts_with('/') {
        let mut split = slash_norm[1..].splitn(2, '/');
        let first = split.next().unwrap_or("");
        if first.len() == 1 && first.chars().all(|c| c.is_ascii_alphabetic()) && slash_norm.len() >= 2 && (slash_norm.len() == 2 || slash_norm.as_bytes()[2] == b'/') {
            // Heuristic: /c/Users/... Git Bash drive path (only treat single-letter root when second char is end or /)
            if matches!(first.to_ascii_lowercase().as_str(), "c" | "d" | "e" | "f") {
                drive = Some(first.chars().next().unwrap().to_ascii_uppercase());
                is_abs = true;
                if let Some(tail) = split.next() {
                    for seg in tail.split('/') {
                        push_norm_seg(&mut rel_parts, seg);
                    }
                }
            } else {
                is_abs = true;
                for seg in slash_norm.split('/') {
                    push_norm_seg(&mut rel_parts, seg);
                }
            }
        } else {
            is_abs = true;
            for seg in slash_norm.split('/') {
                push_norm_seg(&mut rel_parts, seg);
            }
        }
    } else {
        for seg in slash_norm.split('/') {
            if seg == ".." {
                if rel_parts.last().is_some_and(|p| p != "..") {
                    rel_parts.pop();
                } else {
                    rel_parts.push("..".into());
                }
            } else {
                push_norm_seg(&mut rel_parts, seg);
            }
        }
    }

    let rel_joined_posix = rel_parts.join("/");
    let rel_joined_win = rel_parts.join("\\");

    let (windows, posix, git_bash, wsl, file_uri, root) = if let Some(d) = drive {
        let d_low = d.to_ascii_lowercase();
        let win = if rel_joined_win.is_empty() { format!("{d}:\\") } else { format!("{d}:\\{rel_joined_win}") };
        let px = if rel_joined_posix.is_empty() { format!("{d}:/") } else { format!("{d}:/{rel_joined_posix}") };
        let gb = if rel_joined_posix.is_empty() { format!("/{d_low}") } else { format!("/{d_low}/{rel_joined_posix}") };
        let ws = if rel_joined_posix.is_empty() { format!("/mnt/{d_low}") } else { format!("/mnt/{d_low}/{rel_joined_posix}") };
        let uri_tail: String = rel_parts.iter().map(|s| encode_path_seg(s)).collect::<Vec<_>>().join("/");
        let uri = if uri_tail.is_empty() { format!("file:///{d}:/") } else { format!("file:///{d}:/{uri_tail}") };
        (win, px, gb, ws, uri, format!("{d}:/"))
    } else if is_abs {
        let px = if rel_joined_posix.is_empty() { "/".into() } else { format!("/{rel_joined_posix}") };
        let win = format!("\\\\wsl.localhost\\{distro}\\{rel_joined_win}").trim_end_matches('\\').to_owned();
        let uri_tail: String = rel_parts.iter().map(|s| encode_path_seg(s)).collect::<Vec<_>>().join("/");
        let uri = format!("file:///{uri_tail}");
        (win, px.clone(), px.clone(), px, uri, "/".into())
    } else {
        let px = if rel_joined_posix.is_empty() { ".".into() } else { rel_joined_posix.clone() };
        let win = if rel_joined_win.is_empty() { ".".into() } else { rel_joined_win.clone() };
        (win, px.clone(), px.clone(), px, String::new(), String::new())
    };

    let base = rel_parts.last().cloned().unwrap_or_default();
    let (stem, ext) = match base.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_owned(), e.to_owned()),
        _ => (base.clone(), String::new()),
    };
    let dir = if rel_parts.len() > 1 {
        let parent = rel_parts[..rel_parts.len() - 1].join("/");
        if let Some(d) = drive {
            format!("{d}:/{parent}")
        } else if is_abs {
            format!("/{parent}")
        } else {
            parent
        }
    } else {
        root.clone()
    };

    json!({
        "windows": windows,
        "posix": posix,
        "gitBash": git_bash,
        "wsl": wsl,
        "fileUri": file_uri,
        "escaped": windows.replace('\\', "\\\\"),
        "normalized": posix,
        "root": root,
        "dir": dir,
        "base": base,
        "stem": stem,
        "ext": ext,
        "isAbsolute": is_abs,
    })
}

fn push_norm_seg(parts: &mut Vec<String>, seg: &str) {
    if seg.is_empty() || seg == "." {
        return;
    }
    if seg == ".." {
        parts.pop();
    } else {
        parts.push(seg.to_owned());
    }
}

fn encode_path_seg(seg: &str) -> String {
    crate::converters::url_encode(seg)
}

pub fn convert_paths_batch(input: &str, target: &str, wsl_distro: &str) -> String {
    input
        .lines()
        .map(|line| {
            if line.trim().is_empty() {
                String::new()
            } else {
                let obj = convert_path(line, wsl_distro);
                obj.get(target).and_then(Value::as_str).unwrap_or(line).to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn toggle_path_slashes(s: &str) -> String {
    if s.contains('\\') {
        s.replace("\\\\", "/").replace('\\', "/")
    } else {
        s.replace('/', "\\")
    }
}

// ============================================================================
// 2. Exact Decimal & Expression Calculator (Fixed-Point i128 10^12 + f64)
// ============================================================================

const SCALE_DEC: i128 = 1_000_000_000_000; // 12 decimal places exact

#[derive(Clone, Copy)]
enum CalcNum {
    Exact(i128), // value = inner / 10^12
    Float(f64),
}

impl CalcNum {
    fn as_f64(self) -> f64 {
        match self {
            CalcNum::Exact(v) => (v as f64) / (SCALE_DEC as f64),
            CalcNum::Float(f) => f,
        }
    }

    fn as_exact_int(self) -> Option<i128> {
        match self {
            CalcNum::Exact(v) if v % SCALE_DEC == 0 => Some(v / SCALE_DEC),
            CalcNum::Float(f) if f.is_finite() && f.fract() == 0.0 && f.abs() < 9e18 => Some(f as i128),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    ExactLit(i128),
    FloatLit(f64),
    Ident(String),
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    Caret,
    Bang,
    Tilde,
    Amp,
    Pipe,
    Shl,
    Shr,
    LParen,
    RParen,
    Comma,
}

pub fn eval_expression(expr: &str, mode: &str) -> Result<Value, Error> {
    let tokens = tokenize_expr(expr)?;
    if tokens.is_empty() {
        return Err(Error::Invalid("Empty expression".into()));
    }
    let force_float = mode == "float" || mode == "scientific";
    let mut parser = ExprParser {
        toks: &tokens,
        pos: 0,
        force_float,
    };
    let val = parser.parse_bitwise_or()?;
    if parser.pos < parser.toks.len() {
        return Err(Error::Invalid("Unexpected trailing tokens in expression".into()));
    }

    let (result_str, exact_flag, fval) = match val {
        CalcNum::Exact(scaled) if !force_float => (format_scaled(scaled), true, (scaled as f64) / (SCALE_DEC as f64)),
        other => {
            let f = other.as_f64();
            if !f.is_finite() {
                return Err(Error::Invalid("Result is NaN or Infinity".into()));
            }
            (format_f64_clean(f), false, f)
        }
    };

    let sci = format!("{fval:e}");
    let int_info = val.as_exact_int().map(|n| {
        json!({
            "dec": n.to_string(),
            "hex": if n < 0 { format!("-0x{:X}", n.unsigned_abs()) } else { format!("0x{:X}", n) },
            "bin": if n < 0 { format!("-0b{:b}", n.unsigned_abs()) } else { format!("0b{:b}", n) },
            "oct": if n < 0 { format!("-0o{:o}", n.unsigned_abs()) } else { format!("0o{:o}", n) },
        })
    });

    Ok(json!({
        "result": result_str,
        "exact": exact_flag,
        "modeUsed": if exact_flag { "exact-decimal" } else { "ieee754-f64" },
        "scientific": sci,
        "integer": int_info,
    }))
}

fn format_scaled(v: i128) -> String {
    if v == 0 {
        return "0".into();
    }
    let sign = if v < 0 { "-" } else { "" };
    let abs = v.unsigned_abs();
    let int_part = abs / (SCALE_DEC as u128);
    let frac_part = abs % (SCALE_DEC as u128);
    if frac_part == 0 {
        return format!("{sign}{int_part}");
    }
    let frac_padded = format!("{frac_part:012}");
    let frac_trimmed = frac_padded.trim_end_matches('0');
    format!("{sign}{int_part}.{frac_trimmed}")
}

fn format_f64_clean(v: f64) -> String {
    let rounded = if (v - v.round()).abs() < 1e-12 && v.abs() < 1e15 {
        v.round()
    } else {
        v
    };
    let s = format!("{rounded:.12}");
    if s.contains('.') {
        s.trim_end_matches('0').trim_end_matches('.').to_owned()
    } else {
        s
    }
}

fn tokenize_expr(expr: &str) -> Result<Vec<Tok>, Error> {
    let chars: Vec<char> = expr.chars().collect();
    let mut toks = Vec::new();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        // Hex / Bin / Oct integers
        if c == '0' && i + 1 < chars.len() && matches!(chars[i + 1], 'x' | 'X' | 'b' | 'B' | 'o' | 'O') {
            let radix = match chars[i + 1] {
                'x' | 'X' => 16,
                'b' | 'B' => 2,
                _ => 8,
            };
            i += 2;
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_hexdigit() || chars[i] == '_') {
                i += 1;
            }
            let raw: String = chars[start..i].iter().filter(|&&ch| ch != '_').collect();
            let int_val = i128::from_str_radix(&raw, radix)
                .map_err(|e| Error::Invalid(format!("Invalid radix-{radix} literal: {e}")))?;
            toks.push(match int_val.checked_mul(SCALE_DEC) {
                Some(scaled) => Tok::ExactLit(scaled),
                None => Tok::FloatLit(int_val as f64),
            });
            continue;
        }
        // Decimal / Float literal
        if c.is_ascii_digit() || (c == '.' && chars.get(i + 1).is_some_and(char::is_ascii_digit)) {
            let start = i;
            let mut has_exp = false;
            while i < chars.len() {
                let ch = chars[i];
                if ch.is_ascii_digit() || ch == '.' || ch == '_' {
                    i += 1;
                } else if (ch == 'e' || ch == 'E') && !has_exp {
                    has_exp = true;
                    i += 1;
                    if chars.get(i).is_some_and(|&s| s == '+' || s == '-') {
                        i += 1;
                    }
                } else {
                    break;
                }
            }
            let raw: String = chars[start..i].iter().filter(|&&ch| ch != '_').collect();
            if !has_exp {
                if let Some(scaled) = parse_decimal_scaled(&raw) {
                    toks.push(Tok::ExactLit(scaled));
                    continue;
                }
            }
            let f: f64 = raw.parse().map_err(|_| Error::Invalid(format!("Invalid number literal {raw}")))?;
            toks.push(Tok::FloatLit(f));
            continue;
        }
        if c.is_ascii_alphabetic() || c == '_' {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let ident: String = chars[start..i].iter().collect();
            if ident.eq_ignore_ascii_case("xor") {
                toks.push(Tok::Caret);
            } else {
                toks.push(Tok::Ident(ident));
            }
            continue;
        }
        if c == '<' && chars.get(i + 1) == Some(&'<') {
            toks.push(Tok::Shl);
            i += 2;
            continue;
        }
        if c == '>' && chars.get(i + 1) == Some(&'>') {
            toks.push(Tok::Shr);
            i += 2;
            continue;
        }
        if c == '*' && chars.get(i + 1) == Some(&'*') {
            toks.push(Tok::Caret);
            i += 2;
            continue;
        }
        let single = match c {
            '+' => Tok::Plus,
            '-' => Tok::Minus,
            '*' => Tok::Star,
            '/' => Tok::Slash,
            '%' => Tok::Percent,
            '^' => Tok::Caret,
            '!' => Tok::Bang,
            '~' => Tok::Tilde,
            '&' => Tok::Amp,
            '|' => Tok::Pipe,
            '(' => Tok::LParen,
            ')' => Tok::RParen,
            ',' => Tok::Comma,
            other => return Err(Error::Invalid(format!("Unexpected character '{other}' in expression"))),
        };
        toks.push(single);
        i += 1;
    }
    Ok(toks)
}

fn parse_decimal_scaled(raw: &str) -> Option<i128> {
    let (int_s, frac_s) = match raw.split_once('.') {
        Some((a, b)) => (a, b),
        None => (raw, ""),
    };
    if frac_s.len() > 12 || frac_s.contains('.') {
        return None;
    }
    let int_part: i128 = if int_s.is_empty() { 0 } else { int_s.parse().ok()? };
    let mut padded = frac_s.to_owned();
    while padded.len() < 12 {
        padded.push('0');
    }
    let frac_part: i128 = padded.parse().ok()?;
    int_part.checked_mul(SCALE_DEC)?.checked_add(frac_part)
}

struct ExprParser<'a> {
    toks: &'a [Tok],
    pos: usize,
    force_float: bool,
}

impl<'a> ExprParser<'a> {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.pos)
    }

    fn next(&mut self) -> Option<&Tok> {
        let t = self.toks.get(self.pos);
        if t.is_some() {
            self.pos += 1;
        }
        t
    }

    fn parse_bitwise_or(&mut self) -> Result<CalcNum, Error> {
        let mut lhs = self.parse_bitwise_and()?;
        while matches!(self.peek(), Some(Tok::Pipe)) {
            self.next();
            let rhs = self.parse_bitwise_and()?;
            let a = lhs.as_exact_int().ok_or_else(|| Error::Invalid("Bitwise '|' requires integers".into()))?;
            let b = rhs.as_exact_int().ok_or_else(|| Error::Invalid("Bitwise '|' requires integers".into()))?;
            lhs = CalcNum::Exact((a | b).checked_mul(SCALE_DEC).ok_or_else(|| Error::Invalid("Integer overflow".into()))?);
        }
        Ok(lhs)
    }

    fn parse_bitwise_and(&mut self) -> Result<CalcNum, Error> {
        let mut lhs = self.parse_shift()?;
        while matches!(self.peek(), Some(Tok::Amp)) {
            self.next();
            let rhs = self.parse_shift()?;
            let a = lhs.as_exact_int().ok_or_else(|| Error::Invalid("Bitwise '&' requires integers".into()))?;
            let b = rhs.as_exact_int().ok_or_else(|| Error::Invalid("Bitwise '&' requires integers".into()))?;
            lhs = CalcNum::Exact((a & b).checked_mul(SCALE_DEC).ok_or_else(|| Error::Invalid("Integer overflow".into()))?);
        }
        Ok(lhs)
    }

    fn parse_shift(&mut self) -> Result<CalcNum, Error> {
        let mut lhs = self.parse_add()?;
        while let Some(op) = self.peek().cloned() {
            if !matches!(op, Tok::Shl | Tok::Shr) {
                break;
            }
            self.next();
            let rhs = self.parse_add()?;
            let a = lhs.as_exact_int().ok_or_else(|| Error::Invalid("Shift requires integers".into()))?;
            let b = rhs.as_exact_int().ok_or_else(|| Error::Invalid("Shift amount must be integer".into()))?;
            if !(0..=127).contains(&b) {
                return Err(Error::Invalid("Shift amount out of range (0..127)".into()));
            }
            let res = if matches!(op, Tok::Shl) { a.wrapping_shl(b as u32) } else { a.wrapping_shr(b as u32) };
            lhs = CalcNum::Exact(res.checked_mul(SCALE_DEC).ok_or_else(|| Error::Invalid("Shift overflow".into()))?);
        }
        Ok(lhs)
    }

    fn parse_add(&mut self) -> Result<CalcNum, Error> {
        let mut lhs = self.parse_mul()?;
        while let Some(op) = self.peek().cloned() {
            if !matches!(op, Tok::Plus | Tok::Minus) {
                break;
            }
            self.next();
            let rhs = self.parse_mul()?;
            lhs = match (self.force_float, lhs, rhs, op) {
                (false, CalcNum::Exact(a), CalcNum::Exact(b), Tok::Plus) => match a.checked_add(b) {
                    Some(v) => CalcNum::Exact(v),
                    None => CalcNum::Float(lhs.as_f64() + rhs.as_f64()),
                },
                (false, CalcNum::Exact(a), CalcNum::Exact(b), Tok::Minus) => match a.checked_sub(b) {
                    Some(v) => CalcNum::Exact(v),
                    None => CalcNum::Float(lhs.as_f64() - rhs.as_f64()),
                },
                (_, _, _, Tok::Plus) => CalcNum::Float(lhs.as_f64() + rhs.as_f64()),
                _ => CalcNum::Float(lhs.as_f64() - rhs.as_f64()),
            };
        }
        Ok(lhs)
    }

    fn parse_mul(&mut self) -> Result<CalcNum, Error> {
        let mut lhs = self.parse_pow()?;
        while let Some(op) = self.peek().cloned() {
            if !matches!(op, Tok::Star | Tok::Slash | Tok::Percent) {
                break;
            }
            self.next();
            let rhs = self.parse_pow()?;
            match op {
                Tok::Star => {
                    lhs = match (self.force_float, lhs, rhs) {
                        (false, CalcNum::Exact(a), CalcNum::Exact(b)) => {
                            if let Some(scaled) = exact_mul(a, b) {
                                CalcNum::Exact(scaled)
                            } else {
                                CalcNum::Float(lhs.as_f64() * rhs.as_f64())
                            }
                        }
                        _ => CalcNum::Float(lhs.as_f64() * rhs.as_f64()),
                    };
                }
                Tok::Slash => {
                    let denom = rhs.as_f64();
                    if denom == 0.0 {
                        return Err(Error::Invalid("Division by zero".into()));
                    }
                    lhs = match (self.force_float, lhs, rhs) {
                        (false, CalcNum::Exact(a), CalcNum::Exact(b)) if b != 0 => {
                            if let Some(scaled) = exact_div(a, b) {
                                CalcNum::Exact(scaled)
                            } else {
                                CalcNum::Float(lhs.as_f64() / denom)
                            }
                        }
                        _ => CalcNum::Float(lhs.as_f64() / denom),
                    };
                }
                Tok::Percent => {
                    lhs = match (self.force_float, lhs, rhs) {
                        (false, CalcNum::Exact(a), CalcNum::Exact(b)) if b != 0 => CalcNum::Exact(a % b),
                        _ => {
                            let d = rhs.as_f64();
                            if d == 0.0 {
                                return Err(Error::Invalid("Modulo by zero".into()));
                            }
                            CalcNum::Float(lhs.as_f64() % d)
                        }
                    };
                }
                _ => unreachable!(),
            }
        }
        Ok(lhs)
    }

    fn parse_pow(&mut self) -> Result<CalcNum, Error> {
        let base = self.parse_unary()?;
        if matches!(self.peek(), Some(Tok::Caret)) {
            self.next();
            let exp = self.parse_pow()?;
            if !self.force_float {
                if let (CalcNum::Exact(a), Some(n)) = (base, exp.as_exact_int()) {
                    if (0..=12).contains(&n) && (a % SCALE_DEC == 0) {
                        let base_int = a / SCALE_DEC;
                        if let Some(p) = base_int.checked_pow(n as u32).and_then(|v| v.checked_mul(SCALE_DEC)) {
                            return Ok(CalcNum::Exact(p));
                        }
                    }
                }
            }
            return Ok(CalcNum::Float(base.as_f64().powf(exp.as_f64())));
        }
        Ok(base)
    }

    fn parse_unary(&mut self) -> Result<CalcNum, Error> {
        match self.peek().cloned() {
            Some(Tok::Plus) => {
                self.next();
                self.parse_unary()
            }
            Some(Tok::Minus) => {
                self.next();
                let v = self.parse_unary()?;
                Ok(match v {
                    CalcNum::Exact(x) => match x.checked_neg() {
                        Some(n) => CalcNum::Exact(n),
                        None => CalcNum::Float(-v.as_f64()),
                    },
                    CalcNum::Float(f) => CalcNum::Float(-f),
                })
            }
            Some(Tok::Tilde) => {
                self.next();
                let v = self.parse_unary()?;
                let n = v.as_exact_int().ok_or_else(|| Error::Invalid("Bitwise '~' requires an integer".into()))?;
                Ok(CalcNum::Exact(
                    (!n).checked_mul(SCALE_DEC)
                        .ok_or_else(|| Error::Invalid("Integer overflow".into()))?,
                ))
            }
            _ => self.parse_postfix(),
        }
    }

    fn parse_postfix(&mut self) -> Result<CalcNum, Error> {
        let mut val = self.parse_primary()?;
        while matches!(self.peek(), Some(Tok::Bang)) {
            self.next();
            let n = val.as_exact_int().ok_or_else(|| Error::Invalid("Factorial '!' requires integer".into()))?;
            if !(0..=34).contains(&n) {
                return Err(Error::Invalid("Factorial input must be between 0 and 34".into()));
            }
            let mut acc: i128 = 1;
            for k in 2..=n {
                acc = acc.saturating_mul(k);
            }
            val = match acc.checked_mul(SCALE_DEC) {
                Some(scaled) => CalcNum::Exact(scaled),
                None => CalcNum::Float(acc as f64),
            };
        }
        Ok(val)
    }

    fn parse_primary(&mut self) -> Result<CalcNum, Error> {
        match self.next().cloned() {
            Some(Tok::ExactLit(v)) => Ok(if self.force_float { CalcNum::Float((v as f64) / (SCALE_DEC as f64)) } else { CalcNum::Exact(v) }),
            Some(Tok::FloatLit(f)) => Ok(CalcNum::Float(f)),
            Some(Tok::LParen) => {
                let val = self.parse_bitwise_or()?;
                if !matches!(self.next(), Some(Tok::RParen)) {
                    return Err(Error::Invalid("Expected ')'".into()));
                }
                Ok(val)
            }
            Some(Tok::Ident(name)) => {
                let lower = name.to_ascii_lowercase();
                if matches!(self.peek(), Some(Tok::LParen)) {
                    self.next();
                    let mut args = Vec::new();
                    if !matches!(self.peek(), Some(Tok::RParen)) {
                        loop {
                            args.push(self.parse_bitwise_or()?);
                            if matches!(self.peek(), Some(Tok::Comma)) {
                                self.next();
                            } else {
                                break;
                            }
                        }
                    }
                    if !matches!(self.next(), Some(Tok::RParen)) {
                        return Err(Error::Invalid(format!("Expected ')' after {name}(...)")));
                    }
                    eval_math_fn(&lower, &args)
                } else {
                    match lower.as_str() {
                        "pi" => Ok(CalcNum::Float(std::f64::consts::PI)),
                        "e" => Ok(CalcNum::Float(std::f64::consts::E)),
                        "tau" => Ok(CalcNum::Float(std::f64::consts::TAU)),
                        _ => Err(Error::Invalid(format!("Unknown identifier {name}"))),
                    }
                }
            }
            _ => Err(Error::Invalid("Expected value or '('".into())),
        }
    }
}

fn exact_mul(a: i128, b: i128) -> Option<i128> {
    if a % SCALE_DEC == 0 {
        return (a / SCALE_DEC).checked_mul(b);
    }
    if b % SCALE_DEC == 0 {
        return a.checked_mul(b / SCALE_DEC);
    }
    a.checked_mul(b).map(|p| p / SCALE_DEC)
}

fn exact_div(a: i128, b: i128) -> Option<i128> {
    let scaled_num = a.checked_mul(SCALE_DEC)?;
    if scaled_num % b == 0 {
        Some(scaled_num / b)
    } else {
        None
    }
}

fn eval_math_fn(name: &str, args: &[CalcNum]) -> Result<CalcNum, Error> {
    let need1 = || {
        args.first()
            .copied()
            .ok_or_else(|| Error::Invalid(format!("{name}() requires 1 argument")))
    };
    let need2 = || {
        if args.len() < 2 {
            Err(Error::Invalid(format!("{name}() requires 2 arguments")))
        } else {
            Ok((args[0], args[1]))
        }
    };
    Ok(CalcNum::Float(match name {
        "sin" => need1()?.as_f64().sin(),
        "cos" => need1()?.as_f64().cos(),
        "tan" => need1()?.as_f64().tan(),
        "asin" => need1()?.as_f64().asin(),
        "acos" => need1()?.as_f64().acos(),
        "atan" => need1()?.as_f64().atan(),
        "sqrt" => need1()?.as_f64().sqrt(),
        "cbrt" => need1()?.as_f64().cbrt(),
        "ln" | "log" => need1()?.as_f64().ln(),
        "log10" => need1()?.as_f64().log10(),
        "log2" => need1()?.as_f64().log2(),
        "exp" => need1()?.as_f64().exp(),
        "abs" => {
            if let CalcNum::Exact(v) = need1()? {
                if let Some(a) = v.checked_abs() {
                    return Ok(CalcNum::Exact(a));
                }
            }
            need1()?.as_f64().abs()
        }
        "floor" => need1()?.as_f64().floor(),
        "ceil" => need1()?.as_f64().ceil(),
        "round" => need1()?.as_f64().round(),
        "pow" => {
            let (a, b) = need2()?;
            a.as_f64().powf(b.as_f64())
        }
        "min" => {
            if args.is_empty() {
                return Err(Error::Invalid("min() requires at least 1 argument".into()));
            }
            args.iter().map(|x| x.as_f64()).fold(f64::INFINITY, f64::min)
        }
        "max" => {
            if args.is_empty() {
                return Err(Error::Invalid("max() requires at least 1 argument".into()));
            }
            args.iter().map(|x| x.as_f64()).fold(f64::NEG_INFINITY, f64::max)
        }
        _ => return Err(Error::Invalid(format!("Unknown math function {name}()"))),
    }))
}

// ============================================================================
// 3. Hosts Profile Compiler (SwitchHosts-style validation & conflict check)
// ============================================================================

pub fn compile_hosts(profiles: &[HostProfile]) -> Value {
    let mut merged_lines = Vec::new();
    let mut active_entries = Vec::new();
    let mut errors = Vec::new();
    let mut host_map: BTreeMap<String, Vec<(String, String)>> = BTreeMap::new();

    for profile in profiles {
        if !profile.enabled {
            continue;
        }
        merged_lines.push(format!("# === [{}] ===", profile.name));
        for (line_idx, raw_line) in profile.content.lines().enumerate() {
            let line_no = line_idx + 1;
            let trimmed = raw_line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                merged_lines.push(raw_line.to_owned());
                continue;
            }
            let body = trimmed.split('#').next().unwrap_or(trimmed).trim();
            let mut parts = body.split_whitespace();
            let Some(ip_str) = parts.next() else {
                continue;
            };
            if ip_str.parse::<IpAddr>().is_err() {
                errors.push(json!({
                    "profile": profile.name,
                    "line": line_no,
                    "text": raw_line,
                    "message": format!("Invalid IP address '{ip_str}'"),
                }));
                merged_lines.push(format!("# [INVALID IP] {raw_line}"));
                continue;
            }
            let hosts: Vec<&str> = parts.collect();
            if hosts.is_empty() {
                errors.push(json!({
                    "profile": profile.name,
                    "line": line_no,
                    "text": raw_line,
                    "message": "Missing hostname(s) after IP address",
                }));
                merged_lines.push(format!("# [MISSING HOST] {raw_line}"));
                continue;
            }
            let mut line_valid = true;
            for h in &hosts {
                if !is_valid_hostname(h) {
                    errors.push(json!({
                        "profile": profile.name,
                        "line": line_no,
                        "text": raw_line,
                        "message": format!("Invalid hostname '{h}'"),
                    }));
                    line_valid = false;
                } else {
                    let h_low = h.to_ascii_lowercase();
                    host_map
                        .entry(h_low.clone())
                        .or_default()
                        .push((ip_str.to_owned(), profile.name.clone()));
                    active_entries.push(json!({
                        "ip": ip_str,
                        "host": h_low,
                        "profile": profile.name,
                        "line": line_no,
                    }));
                }
            }
            if line_valid {
                merged_lines.push(trimmed.to_owned());
            } else {
                merged_lines.push(format!("# [INVALID HOST] {raw_line}"));
            }
        }
        merged_lines.push(String::new());
    }

    let mut conflicts = Vec::new();
    for (host, defs) in host_map {
        if defs.len() > 1 {
            let distinct_ips: std::collections::BTreeSet<&str> = defs.iter().map(|(ip, _)| ip.as_str()).collect();
            conflicts.push(json!({
                "host": host,
                "differentIps": distinct_ips.len() > 1,
                "definitions": defs.into_iter().map(|(ip, prof)| json!({ "ip": ip, "profile": prof })).collect::<Vec<_>>(),
            }));
        }
    }

    json!({
        "merged": merged_lines.join("\n").trim_end(),
        "activeEntries": active_entries,
        "errors": errors,
        "conflicts": conflicts,
    })
}

fn is_valid_hostname(host: &str) -> bool {
    let h = host.trim_end_matches('.');
    !h.is_empty()
        && h.len() <= 253
        && h.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        })
}

// ============================================================================
// 4. HTTP Client Helpers (cURL parser/exporter & opt-in host::fetch wrapper)
// ============================================================================

pub fn parse_curl(cmd: &str) -> Result<Value, Error> {
    let collapsed = cmd.replace("\\\r\n", " ").replace("\\\n", " ");
    let tokens = split_shell_words(&collapsed)?;
    if tokens.is_empty() {
        return Err(Error::Invalid("Empty cURL command".into()));
    }

    let mut i = if tokens[0].eq_ignore_ascii_case("curl") { 1 } else { 0 };
    let mut method: Option<String> = None;
    let mut url = String::new();
    let mut headers: Vec<(String, String)> = Vec::new();
    let mut body_parts: Vec<String> = Vec::new();

    while i < tokens.len() {
        let tok = &tokens[i];
        match tok.as_str() {
            "-X" | "--request" => {
                i += 1;
                if let Some(m) = tokens.get(i) {
                    method = Some(m.to_ascii_uppercase());
                }
            }
            "-H" | "--header" => {
                i += 1;
                if let Some(h) = tokens.get(i) {
                    if let Some((k, v)) = h.split_once(':') {
                        headers.push((k.trim().to_owned(), v.trim().to_owned()));
                    }
                }
            }
            "-d" | "--data" | "--data-raw" | "--data-binary" | "--data-urlencode" => {
                i += 1;
                if let Some(d) = tokens.get(i) {
                    body_parts.push(d.clone());
                }
            }
            "-A" | "--user-agent" => {
                i += 1;
                if let Some(ua) = tokens.get(i) {
                    headers.push(("User-Agent".into(), ua.clone()));
                }
            }
            "-u" | "--user" => {
                i += 1;
                if let Some(creds) = tokens.get(i) {
                    let b64 = STANDARD.encode(creds.as_bytes());
                    headers.push(("Authorization".into(), format!("Basic {b64}")));
                }
            }
            "--url" => {
                i += 1;
                if let Some(u) = tokens.get(i) {
                    url = u.clone();
                }
            }
            "-I" | "--head" => {
                method = Some("HEAD".into());
            }
            "-k" | "--insecure" | "-L" | "--location" | "-s" | "--silent" | "-v" | "--verbose" | "--compressed" => {}
            other if !other.starts_with('-') && url.is_empty() => {
                url = other.to_owned();
            }
            other if other.starts_with("http://") || other.starts_with("https://") => {
                url = other.to_owned();
            }
            _ => {}
        }
        i += 1;
    }

    if url.is_empty() {
        return Err(Error::Invalid("No URL found in cURL command".into()));
    }
    let body = if body_parts.is_empty() { None } else { Some(body_parts.join("&")) };
    let final_method = method.unwrap_or_else(|| if body.is_some() { "POST".into() } else { "GET".into() });

    Ok(json!({
        "method": final_method,
        "url": url,
        "headers": headers,
        "body": body.unwrap_or_default(),
    }))
}

fn split_shell_words(input: &str) -> Result<Vec<String>, Error> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_word = false;
    let mut quote: Option<char> = None;
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if let Some(q) = quote {
            if c == q {
                quote = None;
            } else if c == '\\' && q == '"' {
                if let Some(next) = chars.next() {
                    cur.push(next);
                }
            } else {
                cur.push(c);
            }
        } else if c.is_whitespace() {
            if in_word {
                out.push(std::mem::take(&mut cur));
                in_word = false;
            }
        } else if c == '\'' || c == '"' {
            quote = Some(c);
            in_word = true;
        } else if c == '\\' {
            in_word = true;
            if let Some(next) = chars.next() {
                cur.push(next);
            }
        } else {
            in_word = true;
            cur.push(c);
        }
    }
    if quote.is_some() {
        return Err(Error::Invalid("Unclosed quote in cURL command".into()));
    }
    if in_word {
        out.push(cur);
    }
    Ok(out)
}

pub fn export_http_code(req: &Value, format: &str) -> Result<String, Error> {
    let method = req.get("method").and_then(Value::as_str).unwrap_or("GET").to_ascii_uppercase();
    let url = req.get("url").and_then(Value::as_str).unwrap_or("").trim();
    if url.is_empty() {
        return Err(Error::Invalid("URL cannot be empty".into()));
    }
    let body = req.get("body").and_then(Value::as_str).unwrap_or("");
    let headers: Vec<(String, String)> = req
        .get("headers")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let pair = item.as_array()?;
                    let k = pair.first()?.as_str()?.trim();
                    let v = pair.get(1)?.as_str()?.trim();
                    if k.is_empty() { None } else { Some((k.to_owned(), v.to_owned())) }
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(match format {
        "curl" => {
            let mut parts = vec![format!("curl -X {method} {}", shell_quote(url))];
            for (k, v) in &headers {
                parts.push(format!("  -H {}", shell_quote(&format!("{k}: {v}"))));
            }
            if !body.is_empty() && !matches!(method.as_str(), "GET" | "HEAD") {
                parts.push(format!("  -d {}", shell_quote(body)));
            }
            parts.join(" \\\n")
        }
        "fetch" => {
            let h_obj: serde_json::Map<String, Value> = headers
                .iter()
                .map(|(k, v)| (k.clone(), Value::String(v.clone())))
                .collect();
            let mut init = json!({ "method": method });
            if !h_obj.is_empty() {
                init["headers"] = Value::Object(h_obj);
            }
            if !body.is_empty() && !matches!(method.as_str(), "GET" | "HEAD") {
                init["body"] = Value::String(body.to_owned());
            }
            format!("const res = await fetch({}, {});", serde_json::to_string(url).unwrap(), serde_json::to_string_pretty(&init).unwrap())
        }
        "httpie" => {
            let mut parts = vec![format!("http {method} {}", shell_quote(url))];
            for (k, v) in &headers {
                parts.push(format!("  {}", shell_quote(&format!("{k}:{v}"))));
            }
            if !body.is_empty() && !matches!(method.as_str(), "GET" | "HEAD") {
                parts.push(format!("  --raw {}", shell_quote(body)));
            }
            parts.join(" \\\n")
        }
        "http-file" => {
            let mut lines = vec![format!("{method} {url}")];
            for (k, v) in &headers {
                lines.push(format!("{k}: {v}"));
            }
            if !body.is_empty() && !matches!(method.as_str(), "GET" | "HEAD") {
                lines.push(String::new());
                lines.push(body.to_owned());
            }
            lines.join("\n")
        }
        _ => return Err(Error::Invalid(format!("Unknown HTTP export format {format}"))),
    })
}

fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\"'\"'"))
}

pub fn execute_http_request(req: &HttpActiveRequest) -> Result<Value, Error> {
    let url = req.url.trim();
    if url.is_empty() {
        return Err(Error::Invalid("Request URL cannot be empty".into()));
    }
    let lower = url.to_ascii_lowercase();
    let is_https = lower.starts_with("https://");
    let is_loopback_http = lower.starts_with("http://localhost")
        || lower.starts_with("http://127.0.0.1")
        || lower.starts_with("http://[::1]");
    if !is_https && !is_loopback_http {
        return Err(Error::Invalid(
            "Only HTTPS URLs or loopback HTTP (localhost / 127.0.0.1) can be sent via optional net:ask.".into(),
        ));
    }

    let method = if req.method.trim().is_empty() {
        "GET".to_owned()
    } else {
        req.method.trim().to_ascii_uppercase()
    };

    let body = req
        .body
        .as_deref()
        .filter(|b| !b.is_empty() && !matches!(method.as_str(), "GET" | "HEAD"))
        .map(|b| b.as_bytes().to_vec());

    let http_req = HttpRequest {
        method,
        url: url.to_owned(),
        headers: req
            .headers
            .iter()
            .filter(|(k, _)| !k.trim().is_empty())
            .map(|(k, v)| (k.trim().to_owned(), v.clone()))
            .collect(),
        body,
        timeout_ms: Some(req.timeout_ms.unwrap_or(15_000).clamp(500, 30_000)),
    };

    let t0 = std::time::Instant::now();
    let resp = host::fetch(&http_req)?;
    let elapsed_ms = t0.elapsed().as_millis() as u64;

    let is_binary = std::str::from_utf8(&resp.body).is_err();
    let body_text = if is_binary {
        format!(
            "[Binary payload: {} bytes, Base64 preview]\n{}",
            resp.body.len(),
            STANDARD.encode(&resp.body[..resp.body.len().min(65536)])
        )
    } else {
        String::from_utf8_lossy(&resp.body).into_owned()
    };

    Ok(json!({
        "status": resp.status,
        "headers": resp.headers,
        "bodyText": body_text,
        "bodyBytes": resp.body.len(),
        "isBinary": is_binary,
        "elapsedMs": elapsed_ms,
    }))
}
