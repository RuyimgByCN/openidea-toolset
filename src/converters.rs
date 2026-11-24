use base64::Engine as _;
use base64::engine::general_purpose::{STANDARD, URL_SAFE, URL_SAFE_NO_PAD};
use chrono::{DateTime, Duration, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use openidea_plugin::Error;
use serde::Serialize;
use std::net::{Ipv4Addr, Ipv6Addr};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimestampInfo {
    pub seconds: i64,
    pub milliseconds: i64,
    pub microseconds: i64,
    pub nanoseconds: i128,
    pub iso_utc: String,
    pub local_formatted: String,
    pub timezone: String,
    pub weekday: String,
}

pub fn convert_timestamp(input: &str, tz_name: &str, pattern: &str, unit_hint: &str, offset_seconds: i64) -> Result<TimestampInfo, Error> {
    let tz: Tz = tz_name.parse().map_err(|_| Error::Invalid(format!("Unknown timezone {tz_name:?}")))?;
    let trimmed = input.trim();
    let dt_utc: DateTime<Utc> = if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("now") {
        Utc::now()
    } else if let Ok(num) = trimmed.parse::<i128>() {
        epoch_to_utc(num, unit_hint)?
    } else if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
        dt.with_timezone(&Utc)
    } else {
        let fmt = if pattern.trim().is_empty() { "%Y-%m-%d %H:%M:%S" } else { pattern.trim() };
        let parsed = NaiveDateTime::parse_from_str(trimmed, fmt)
            .or_else(|_| NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%d %H:%M:%S%.f"))
            .or_else(|_| NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%d %H:%M:%S"))
            .or_else(|_| NaiveDateTime::parse_from_str(trimmed, "%Y/%m/%d %H:%M:%S"))
            .or_else(|_| {
                chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
                    .map(|d| d.and_hms_opt(0, 0, 0).unwrap())
            })
            .map_err(|e| Error::Invalid(format!("Cannot parse timestamp or date: {e}")))?;
        tz.from_local_datetime(&parsed)
            .earliest()
            .ok_or_else(|| Error::Invalid("Ambiguous or invalid local datetime".into()))?
            .with_timezone(&Utc)
    };

    let adjusted = dt_utc + Duration::seconds(offset_seconds);
    let local = adjusted.with_timezone(&tz);
    let fmt = if pattern.trim().is_empty() { "%Y-%m-%d %H:%M:%S" } else { pattern.trim() };
    Ok(TimestampInfo {
        seconds: adjusted.timestamp(),
        milliseconds: adjusted.timestamp_millis(),
        microseconds: adjusted.timestamp_micros(),
        nanoseconds: adjusted.timestamp_nanos_opt().map(i128::from).unwrap_or_else(|| i128::from(adjusted.timestamp_millis()) * 1_000_000),
        iso_utc: adjusted.to_rfc3339(),
        local_formatted: local.format(fmt).to_string(),
        timezone: tz.name().to_owned(),
        weekday: local.format("%A").to_string(),
    })
}

fn epoch_to_utc(num: i128, hint: &str) -> Result<DateTime<Utc>, Error> {
    let abs = num.abs();
    let nanos = match hint {
        "seconds" if abs < 1_000_000_000_000 => num * 1_000_000_000,
        "milliseconds" if abs < 1_000_000_000_000_000 => num * 1_000_000,
        "microseconds" if abs < 1_000_000_000_000_000_000 => num * 1_000,
        "nanoseconds" => num,
        _ => {
            if abs >= 1_000_000_000_000_000_000 {
                num
            } else if abs >= 1_000_000_000_000_000 {
                num * 1_000
            } else if abs >= 1_000_000_000_000 {
                num * 1_000_000
            } else {
                num * 1_000_000_000
            }
        }
    };
    let secs = (nanos.div_euclid(1_000_000_000)) as i64;
    let sub_nanos = (nanos.rem_euclid(1_000_000_000)) as u32;
    DateTime::from_timestamp(secs, sub_nanos).ok_or_else(|| Error::Invalid("Timestamp out of range".into()))
}

pub fn codec_transform(input: &str, mode: &str, decode: bool) -> Result<String, Error> {
    match (mode, decode) {
        ("base64", false) => Ok(STANDARD.encode(input.as_bytes())),
        ("base64", true) => decode_b64(input, false),
        ("base64url", false) => Ok(URL_SAFE_NO_PAD.encode(input.as_bytes())),
        ("base64url", true) => decode_b64(input, true),
        ("url", false) => Ok(url_encode(input)),
        ("url", true) => Ok(url_decode(input)),
        ("hex", false) => Ok(hex::encode(input.as_bytes())),
        ("hex", true) => {
            let clean: String = input.chars().filter(|c| !c.is_whitespace()).collect();
            let bytes = hex::decode(clean).map_err(|e| Error::Invalid(format!("Invalid hex: {e}")))?;
            Ok(String::from_utf8_lossy(&bytes).into_owned())
        }
        ("html", false) => Ok(crate::string_tools::escape_xml(input, false)),
        ("html", true) => Ok(crate::string_tools::unescape_xml(input)),
        ("unicode", false) => Ok(crate::string_tools::escape_unicode(input)),
        ("unicode", true) => Ok(crate::string_tools::unescape_unicode(input)),
        ("punycode", false) => idna::domain_to_ascii(input.trim()).map_err(|e| Error::Invalid(format!("Punycode error: {e:?}"))),
        ("punycode", true) => {
            let (out, res) = idna::domain_to_unicode(input.trim());
            res.map_err(|e| Error::Invalid(format!("Punycode error: {e:?}")))?;
            Ok(out)
        }
        ("rot13", _) => Ok(rot13(input)),
        ("base32", false) => Ok(crate::totp_tools::encode_base32(input.as_bytes())),
        ("base32", true) => {
            let bytes = crate::totp_tools::decode_base32(input)?;
            Ok(String::from_utf8_lossy(&bytes).into_owned())
        }
        ("base58", false) => Ok(bs58::encode(input.as_bytes()).into_string()),
        ("base58", true) => {
            let bytes = bs58::decode(input.trim())
                .into_vec()
                .map_err(|e| Error::Invalid(format!("Invalid Base58: {e}")))?;
            Ok(String::from_utf8_lossy(&bytes).into_owned())
        }
        ("base85", false) => Ok(ascii85_encode(input.as_bytes())),
        ("base85", true) => {
            let bytes = ascii85_decode(input)?;
            Ok(String::from_utf8_lossy(&bytes).into_owned())
        }
        ("binary", false) => Ok(input
            .as_bytes()
            .iter()
            .map(|b| format!("{b:08b}"))
            .collect::<Vec<_>>()
            .join(" ")),
        ("binary", true) => decode_binary_bits(input),
        _ => Err(Error::Invalid(format!("Unknown codec mode {mode}"))),
    }
}

fn ascii85_encode(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }
    let mut out = String::with_capacity((bytes.len() * 5).div_ceil(4));
    for chunk in bytes.chunks(4) {
        let n = chunk.len();
        if n == 4 && chunk == [0, 0, 0, 0] {
            out.push('z');
            continue;
        }
        let mut val: u32 = 0;
        for i in 0..4 {
            val = (val << 8) | u32::from(*chunk.get(i).unwrap_or(&0));
        }
        let mut chars = [0u8; 5];
        for i in (0..5).rev() {
            chars[i] = ((val % 85) as u8) + 33;
            val /= 85;
        }
        for &c in &chars[..n + 1] {
            out.push(c as char);
        }
    }
    out
}

fn ascii85_decode(input: &str) -> Result<Vec<u8>, Error> {
    let mut s = input.trim();
    if let Some(inner) = s.strip_prefix("<~").and_then(|r| r.strip_suffix("~>")) {
        s = inner;
    }
    let clean: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    if clean.is_empty() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    let mut group: Vec<u32> = Vec::with_capacity(5);
    for b in clean.bytes() {
        if b == b'z' && group.is_empty() {
            out.extend_from_slice(&[0, 0, 0, 0]);
            continue;
        }
        if !(33..=117).contains(&b) {
            return Err(Error::Invalid(format!("Invalid ASCII85 character {:?}", b as char)));
        }
        group.push(u32::from(b - 33));
        if group.len() == 5 {
            let mut val: u64 = 0;
            for &g in &group {
                val = val * 85 + u64::from(g);
            }
            if val > u64::from(u32::MAX) {
                return Err(Error::Invalid("ASCII85 5-tuple overflow".into()));
            }
            out.extend_from_slice(&(val as u32).to_be_bytes());
            group.clear();
        }
    }
    if !group.is_empty() {
        if group.len() == 1 {
            return Err(Error::Invalid("Truncated trailing ASCII85 character".into()));
        }
        let orig_len = group.len();
        while group.len() < 5 {
            group.push(84);
        }
        let mut val: u64 = 0;
        for &g in &group {
            val = val * 85 + u64::from(g);
        }
        let bytes = (val as u32).to_be_bytes();
        out.extend_from_slice(&bytes[..orig_len - 1]);
    }
    Ok(out)
}

fn decode_binary_bits(input: &str) -> Result<String, Error> {
    let compact: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    if compact.is_empty() {
        return Ok(String::new());
    }
    if !compact.bytes().all(|b| b == b'0' || b == b'1') {
        return Err(Error::Invalid("Binary input may only contain 0, 1, and whitespace".into()));
    }
    let mut bytes = Vec::with_capacity(compact.len() / 8);
    for chunk in compact.as_bytes().chunks(8) {
        if chunk.len() != 8 {
            return Err(Error::Invalid("Binary bit length must be a multiple of 8".into()));
        }
        let s = std::str::from_utf8(chunk).unwrap();
        let b = u8::from_str_radix(s, 2).map_err(|e| Error::Invalid(e.to_string()))?;
        bytes.push(b);
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn decode_b64(input: &str, url_safe: bool) -> Result<String, Error> {
    let clean: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    let bytes = if url_safe {
        URL_SAFE_NO_PAD.decode(&clean).or_else(|_| URL_SAFE.decode(&clean))
    } else {
        STANDARD.decode(&clean).or_else(|_| URL_SAFE_NO_PAD.decode(&clean))
    }
    .map_err(|e| Error::Invalid(format!("Invalid Base64: {e}")))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

pub fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

pub fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        } else if bytes[i] == b'+' {
            out.push(b' ');
            i += 1;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn rot13(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'a'..='z' => (((c as u8 - b'a' + 13) % 26) + b'a') as char,
            'A'..='Z' => (((c as u8 - b'A' + 13) % 26) + b'A') as char,
            other => other,
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpCidrResult {
    pub version: u8,
    pub ip: String,
    pub integer: String,
    pub hex: String,
    pub binary: String,
    pub expanded: String,
    pub compressed: String,
    pub cidr: Option<CidrDetails>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CidrDetails {
    pub prefix: u8,
    pub network: String,
    pub broadcast: String,
    pub netmask: String,
    pub wildcard: String,
    pub first_host: String,
    pub last_host: String,
    pub total_addresses: String,
    pub usable_hosts: String,
}

pub fn analyze_ip_cidr(input: &str) -> Result<IpCidrResult, Error> {
    let trimmed = input.trim();
    if let Some((ip_part, prefix_part)) = trimmed.split_once('/') {
        let prefix: u8 = prefix_part.parse().map_err(|_| Error::Invalid("Invalid CIDR prefix".into()))?;
        if let Ok(ip) = ip_part.parse::<Ipv4Addr>() {
            return build_v4(ip, Some(prefix));
        }
        if let Ok(ip) = ip_part.parse::<Ipv6Addr>() {
            return build_v6(ip, Some(prefix));
        }
        return Err(Error::Invalid("Invalid IP address in CIDR".into()));
    }
    if let Ok(ip) = trimmed.parse::<Ipv4Addr>() {
        return build_v4(ip, None);
    }
    if let Ok(ip) = trimmed.parse::<Ipv6Addr>() {
        return build_v6(ip, None);
    }
    if let Some(hex_str) = trimmed.strip_prefix("0x").or_else(|| trimmed.strip_prefix("0X")) {
        if let Ok(n) = u32::from_str_radix(hex_str, 16) {
            return build_v4(Ipv4Addr::from(n), None);
        }
    }
    if let Ok(n) = trimmed.parse::<u32>() {
        return build_v4(Ipv4Addr::from(n), None);
    }
    Err(Error::Invalid("Enter an IPv4, IPv6, CIDR (e.g. 192.168.1.0/24), or 32-bit integer".into()))
}

fn build_v4(ip: Ipv4Addr, prefix: Option<u8>) -> Result<IpCidrResult, Error> {
    let u = u32::from(ip);
    let oct = ip.octets();
    let binary = format!("{:08b}.{:08b}.{:08b}.{:08b}", oct[0], oct[1], oct[2], oct[3]);
    let cidr = if let Some(p) = prefix {
        if p > 32 {
            return Err(Error::Invalid("IPv4 CIDR prefix must be 0..=32".into()));
        }
        let mask: u32 = if p == 0 { 0 } else { u32::MAX << (32 - p) };
        let wild = !mask;
        let net = u & mask;
        let bcast = net | wild;
        let total = 1u64 << (32 - p);
        let usable = if p >= 31 { if p == 32 { 1 } else { 2 } } else { total - 2 };
        let (first, last) = if p >= 31 { (net, bcast) } else { (net + 1, bcast - 1) };
        Some(CidrDetails {
            prefix: p,
            network: Ipv4Addr::from(net).to_string(),
            broadcast: Ipv4Addr::from(bcast).to_string(),
            netmask: Ipv4Addr::from(mask).to_string(),
            wildcard: Ipv4Addr::from(wild).to_string(),
            first_host: Ipv4Addr::from(first).to_string(),
            last_host: Ipv4Addr::from(last).to_string(),
            total_addresses: total.to_string(),
            usable_hosts: usable.to_string(),
        })
    } else {
        None
    };
    Ok(IpCidrResult {
        version: 4,
        ip: ip.to_string(),
        integer: u.to_string(),
        hex: format!("0x{u:08X}"),
        binary,
        expanded: ip.to_string(),
        compressed: ip.to_string(),
        cidr,
    })
}

fn build_v6(ip: Ipv6Addr, prefix: Option<u8>) -> Result<IpCidrResult, Error> {
    let u = u128::from(ip);
    let segs = ip.segments();
    let expanded = segs.iter().map(|s| format!("{s:04x}")).collect::<Vec<_>>().join(":");
    let cidr = if let Some(p) = prefix {
        if p > 128 {
            return Err(Error::Invalid("IPv6 CIDR prefix must be 0..=128".into()));
        }
        let mask: u128 = if p == 0 { 0 } else { u128::MAX << (128 - p) };
        let wild = !mask;
        let net = u & mask;
        let last = net | wild;
        let total = if p == 0 { "2^128".into() } else { (1u128 << (128 - p)).to_string() };
        Some(CidrDetails {
            prefix: p,
            network: Ipv6Addr::from(net).to_string(),
            broadcast: Ipv6Addr::from(last).to_string(),
            netmask: Ipv6Addr::from(mask).to_string(),
            wildcard: Ipv6Addr::from(wild).to_string(),
            first_host: Ipv6Addr::from(net).to_string(),
            last_host: Ipv6Addr::from(last).to_string(),
            total_addresses: total.clone(),
            usable_hosts: total,
        })
    } else {
        None
    };
    Ok(IpCidrResult {
        version: 6,
        ip: ip.to_string(),
        integer: u.to_string(),
        hex: format!("0x{u:032X}"),
        binary: format!("{u:0128b}"),
        expanded,
        compressed: ip.to_string(),
        cidr,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorResult {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: f64,
    pub hex: String,
    pub hexa: String,
    pub rgb: String,
    pub rgba: String,
    pub hsl: String,
    pub hsv: String,
    pub cmyk: String,
    pub contrast_white: f64,
    pub contrast_black: f64,
}

pub fn convert_color(input: &str, bg_input: Option<&str>) -> Result<(ColorResult, Option<f64>), Error> {
    let (r, g, b, a) = parse_color(input)?;
    let res = build_color(r, g, b, a);
    let custom_contrast = match bg_input.map(str::trim).filter(|s| !s.is_empty()) {
        Some(bg) => {
            let (br, bgc, bb, _) = parse_color(bg)?;
            Some(contrast_ratio((r, g, b), (br, bgc, bb)))
        }
        None => None,
    };
    Ok((res, custom_contrast))
}

fn parse_color(input: &str) -> Result<(u8, u8, u8, f64), Error> {
    let s = input.trim();
    if let Some(hex) = s.strip_prefix('#') {
        return parse_hex_color(hex);
    }
    let lower = s.to_ascii_lowercase();
    if let Some(inner) = lower.strip_prefix("rgb(").and_then(|v| v.strip_suffix(')')) {
        let parts: Vec<&str> = inner.split(',').collect();
        if parts.len() == 3 {
            return Ok((parse_u8(parts[0])?, parse_u8(parts[1])?, parse_u8(parts[2])?, 1.0));
        }
    }
    if let Some(inner) = lower.strip_prefix("rgba(").and_then(|v| v.strip_suffix(')')) {
        let parts: Vec<&str> = inner.split(',').collect();
        if parts.len() == 4 {
            let a = parts[3].trim().parse::<f64>().map_err(|_| Error::Invalid("Invalid alpha".into()))?.clamp(0.0, 1.0);
            return Ok((parse_u8(parts[0])?, parse_u8(parts[1])?, parse_u8(parts[2])?, a));
        }
    }
    if let Some(inner) = lower.strip_prefix("hsl(").and_then(|v| v.strip_suffix(')')) {
        let parts: Vec<&str> = inner.split(',').collect();
        if parts.len() == 3 {
            let h = parts[0].trim().trim_end_matches("deg").parse::<f64>().map_err(|_| Error::Invalid("Invalid hue".into()))?;
            let sat = parts[1].trim().trim_end_matches('%').parse::<f64>().map_err(|_| Error::Invalid("Invalid saturation".into()))? / 100.0;
            let lit = parts[2].trim().trim_end_matches('%').parse::<f64>().map_err(|_| Error::Invalid("Invalid lightness".into()))? / 100.0;
            let (r, g, b) = hsl_to_rgb(h, sat.clamp(0.0, 1.0), lit.clamp(0.0, 1.0));
            return Ok((r, g, b, 1.0));
        }
    }
    if s.len() == 6 || s.len() == 3 || s.len() == 8 {
        if let Ok(c) = parse_hex_color(s) {
            return Ok(c);
        }
    }
    Err(Error::Invalid("Unsupported color format (use #HEX, rgb(...), rgba(...), or hsl(...))".into()))
}

fn parse_u8(s: &str) -> Result<u8, Error> {
    s.trim().parse::<u8>().map_err(|_| Error::Invalid(format!("Invalid channel {s:?}")))
}

fn parse_hex_color(hex: &str) -> Result<(u8, u8, u8, f64), Error> {
    match hex.len() {
        3 => {
            let b = hex.as_bytes();
            let dup = |c: u8| -> Result<u8, Error> {
                let v = hex_val(c).ok_or_else(|| Error::Invalid("Invalid hex color".into()))?;
                Ok((v << 4) | v)
            };
            Ok((dup(b[0])?, dup(b[1])?, dup(b[2])?, 1.0))
        }
        6 => Ok((
            u8::from_str_radix(&hex[0..2], 16).map_err(|_| Error::Invalid("Invalid hex color".into()))?,
            u8::from_str_radix(&hex[2..4], 16).map_err(|_| Error::Invalid("Invalid hex color".into()))?,
            u8::from_str_radix(&hex[4..6], 16).map_err(|_| Error::Invalid("Invalid hex color".into()))?,
            1.0,
        )),
        8 => Ok((
            u8::from_str_radix(&hex[0..2], 16).map_err(|_| Error::Invalid("Invalid hex color".into()))?,
            u8::from_str_radix(&hex[2..4], 16).map_err(|_| Error::Invalid("Invalid hex color".into()))?,
            u8::from_str_radix(&hex[4..6], 16).map_err(|_| Error::Invalid("Invalid hex color".into()))?,
            u8::from_str_radix(&hex[6..8], 16).map_err(|_| Error::Invalid("Invalid hex color".into()))? as f64 / 255.0,
        )),
        _ => Err(Error::Invalid("Hex color must have 3, 6, or 8 digits".into())),
    }
}

fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (u8, u8, u8) {
    let h = ((h % 360.0) + 360.0) % 360.0;
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
    let m = l - c / 2.0;
    let (r1, g1, b1) = match h as u32 {
        0..=59 => (c, x, 0.0),
        60..=119 => (x, c, 0.0),
        120..=179 => (0.0, c, x),
        180..=239 => (0.0, x, c),
        240..=299 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    (
        ((r1 + m) * 255.0).round() as u8,
        ((g1 + m) * 255.0).round() as u8,
        ((b1 + m) * 255.0).round() as u8,
    )
}

fn build_color(r: u8, g: u8, b: u8, a: f64) -> ColorResult {
    let rf = r as f64 / 255.0;
    let gf = g as f64 / 255.0;
    let bf = b as f64 / 255.0;
    let max = rf.max(gf).max(bf);
    let min = rf.min(gf).min(bf);
    let d = max - min;
    let l = (max + min) / 2.0;
    let s_hsl = if d == 0.0 { 0.0 } else { d / (1.0 - (2.0 * l - 1.0).abs()) };
    let s_hsv = if max == 0.0 { 0.0 } else { d / max };
    let mut h = if d == 0.0 {
        0.0
    } else if (max - rf).abs() < f64::EPSILON {
        60.0 * (((gf - bf) / d) % 6.0)
    } else if (max - gf).abs() < f64::EPSILON {
        60.0 * (((bf - rf) / d) + 2.0)
    } else {
        60.0 * (((rf - gf) / d) + 4.0)
    };
    if h < 0.0 {
        h += 360.0;
    }
    let k = 1.0 - max;
    let (c, m, y) = if k >= 1.0 - f64::EPSILON {
        (0.0, 0.0, 0.0)
    } else {
        ((1.0 - rf - k) / (1.0 - k), (1.0 - gf - k) / (1.0 - k), (1.0 - bf - k) / (1.0 - k))
    };
    let a_byte = (a * 255.0).round() as u8;
    ColorResult {
        r,
        g,
        b,
        a,
        hex: format!("#{r:02X}{g:02X}{b:02X}"),
        hexa: format!("#{r:02X}{g:02X}{b:02X}{a_byte:02X}"),
        rgb: format!("rgb({r}, {g}, {b})"),
        rgba: format!("rgba({r}, {g}, {b}, {:.2})", a),
        hsl: format!("hsl({:.0}, {:.0}%, {:.0}%)", h.round(), s_hsl * 100.0, l * 100.0),
        hsv: format!("hsv({:.0}, {:.0}%, {:.0}%)", h.round(), s_hsv * 100.0, max * 100.0),
        cmyk: format!("cmyk({:.0}%, {:.0}%, {:.0}%, {:.0}%)", c * 100.0, m * 100.0, y * 100.0, k * 100.0),
        contrast_white: contrast_ratio((r, g, b), (255, 255, 255)),
        contrast_black: contrast_ratio((r, g, b), (0, 0, 0)),
    }
}

fn rel_luminance(rgb: (u8, u8, u8)) -> f64 {
    let lin = |c: u8| {
        let v = c as f64 / 255.0;
        if v <= 0.03928 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) }
    };
    0.2126 * lin(rgb.0) + 0.7152 * lin(rgb.1) + 0.0722 * lin(rgb.2)
}

fn contrast_ratio(a: (u8, u8, u8), b: (u8, u8, u8)) -> f64 {
    let la = rel_luminance(a);
    let lb = rel_luminance(b);
    let (hi, lo) = if la > lb { (la, lb) } else { (lb, la) };
    (((hi + 0.05) / (lo + 0.05)) * 100.0).round() / 100.0
}
