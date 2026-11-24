use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use hmac::{Hmac, KeyInit, Mac};
use openidea_plugin::Error;
use rand::Rng;
use serde_json::{Value, json};
use sha1::Sha1;
use sha2::{Sha256, Sha512};

const B32_ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

pub fn encode_base32(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }
    let mut out = String::with_capacity((bytes.len() * 8).div_ceil(5));
    let mut buffer: u32 = 0;
    let mut bits: u8 = 0;
    for &b in bytes {
        buffer = (buffer << 8) | u32::from(b);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            let idx = ((buffer >> bits) & 0x1F) as usize;
            out.push(B32_ALPHABET[idx] as char);
        }
    }
    if bits > 0 {
        let idx = ((buffer << (5 - bits)) & 0x1F) as usize;
        out.push(B32_ALPHABET[idx] as char);
    }
    out
}

pub fn decode_base32(input: &str) -> Result<Vec<u8>, Error> {
    let clean: String = input
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-' && *c != '=')
        .map(|c| c.to_ascii_uppercase())
        .collect();
    if clean.is_empty() {
        return Err(Error::Invalid("Base32 input is empty".into()));
    }
    let mut out = Vec::with_capacity((clean.len() * 5) / 8);
    let mut buffer: u32 = 0;
    let mut bits: u8 = 0;
    for ch in clean.bytes() {
        let val = match ch {
            b'A'..=b'Z' => ch - b'A',
            b'2'..=b'7' => ch - b'2' + 26,
            _ => return Err(Error::Invalid(format!("Invalid Base32 character {:?}", ch as char))),
        };
        buffer = (buffer << 5) | u32::from(val);
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xFF) as u8);
        }
    }
    Ok(out)
}

pub fn generate_secret(num_bytes: usize) -> String {
    let len = num_bytes.clamp(10, 64);
    let mut buf = vec![0u8; len];
    rand::rng().fill_bytes(&mut buf);
    encode_base32(&buf)
}

pub fn compute_hotp(secret_b32: &str, counter: u64, digits: u32, alg: &str) -> Result<String, Error> {
    let digits = digits.clamp(6, 8);
    let key = decode_base32(secret_b32)?;
    let msg = counter.to_be_bytes();
    let digest = match alg.trim().to_ascii_uppercase().as_str() {
        "" | "SHA1" | "SHA-1" => hmac_digest::<Sha1>(&key, &msg)?,
        "SHA256" | "SHA-256" => hmac_digest::<Sha256>(&key, &msg)?,
        "SHA512" | "SHA-512" => hmac_digest::<Sha512>(&key, &msg)?,
        other => return Err(Error::Invalid(format!("Unsupported TOTP/HOTP algorithm {other}"))),
    };
    let offset = (digest[digest.len() - 1] & 0x0F) as usize;
    let bin_code = ((u32::from(digest[offset]) & 0x7F) << 24)
        | (u32::from(digest[offset + 1]) << 16)
        | (u32::from(digest[offset + 2]) << 8)
        | u32::from(digest[offset + 3]);
    let modulo = 10u32.pow(digits);
    let otp = bin_code % modulo;
    Ok(format!("{otp:0width$}", width = digits as usize))
}

fn hmac_digest<D>(key: &[u8], msg: &[u8]) -> Result<Vec<u8>, Error>
where
    D: hmac::EagerHash,
{
    let mut mac = <Hmac<D> as KeyInit>::new_from_slice(key)
        .map_err(|e| Error::Invalid(format!("Invalid HMAC key: {e}")))?;
    mac.update(msg);
    Ok(mac.finalize().into_bytes().to_vec())
}

pub fn compute_totp(
    secret_b32: &str,
    period: u64,
    digits: u32,
    alg: &str,
    epoch_secs: Option<u64>,
) -> Result<Value, Error> {
    let period = period.clamp(5, 3600);
    let digits = digits.clamp(6, 8);
    let now = epoch_secs.unwrap_or_else(|| chrono::Utc::now().timestamp().max(0) as u64);
    let counter = now / period;
    let remaining = period - (now % period);
    let code = compute_hotp(secret_b32, counter, digits, alg)?;
    let prev_code = compute_hotp(secret_b32, counter.saturating_sub(1), digits, alg)?;
    let next_code = compute_hotp(secret_b32, counter + 1, digits, alg)?;
    let secret_bytes = decode_base32(secret_b32)?;
    Ok(json!({
        "code": code,
        "prevCode": prev_code,
        "nextCode": next_code,
        "period": period,
        "remaining": remaining,
        "counter": counter,
        "epoch": now,
        "digits": digits,
        "algorithm": alg.to_ascii_uppercase(),
        "secretHex": hex::encode(&secret_bytes),
        "secretBase64": STANDARD.encode(&secret_bytes),
    }))
}

pub fn build_otpauth_uri(
    kind: &str,
    issuer: &str,
    account: &str,
    secret: &str,
    alg: &str,
    digits: u32,
    period: u64,
    counter: u64,
) -> String {
    let kind_norm = if kind.eq_ignore_ascii_case("hotp") { "hotp" } else { "totp" };
    let issuer_clean = issuer.trim();
    let acct_clean = account.trim();
    let label = if issuer_clean.is_empty() {
        crate::converters::url_encode(if acct_clean.is_empty() { "user@example.com" } else { acct_clean })
    } else {
        format!(
            "{}:{}",
            crate::converters::url_encode(issuer_clean),
            crate::converters::url_encode(if acct_clean.is_empty() { "user" } else { acct_clean })
        )
    };
    let secret_clean: String = secret
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| c.to_ascii_uppercase())
        .collect();
    let mut uri = format!(
        "otpauth://{kind_norm}/{label}?secret={secret_clean}&algorithm={}&digits={}",
        alg.trim().to_ascii_uppercase(),
        digits.clamp(6, 8)
    );
    if !issuer_clean.is_empty() {
        uri.push_str("&issuer=");
        uri.push_str(&crate::converters::url_encode(issuer_clean));
    }
    if kind_norm == "hotp" {
        uri.push_str(&format!("&counter={counter}"));
    } else {
        uri.push_str(&format!("&period={}", period.clamp(5, 3600)));
    }
    uri
}

pub fn parse_otpauth_uri(uri: &str) -> Result<Value, Error> {
    let trimmed = uri.trim();
    let rest = trimmed
        .strip_prefix("otpauth://")
        .ok_or_else(|| Error::Invalid("URI must start with otpauth://".into()))?;
    let (kind_raw, after_kind) = rest
        .split_once('/')
        .ok_or_else(|| Error::Invalid("Missing otpauth type or label".into()))?;
    let kind = kind_raw.to_ascii_lowercase();
    if kind != "totp" && kind != "hotp" {
        return Err(Error::Invalid(format!("Unsupported otpauth type {kind:?}")));
    }
    let (label_raw, query_raw) = after_kind.split_once('?').unwrap_or((after_kind, ""));
    let label = crate::converters::url_decode(label_raw);
    let (mut issuer, account) = if let Some((iss, acct)) = label.split_once(':') {
        (iss.trim().to_owned(), acct.trim().to_owned())
    } else {
        (String::new(), label.trim().to_owned())
    };

    let mut secret = String::new();
    let mut algorithm = "SHA1".to_owned();
    let mut digits = 6u32;
    let mut period = 30u64;
    let mut counter = 0u64;

    for pair in query_raw.split('&').filter(|s| !s.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let val = crate::converters::url_decode(v);
        match k.to_ascii_lowercase().as_str() {
            "secret" => secret = val,
            "issuer" if !val.is_empty() => issuer = val,
            "algorithm" if !val.is_empty() => algorithm = val.to_ascii_uppercase(),
            "digits" => digits = val.parse::<u32>().unwrap_or(6).clamp(6, 8),
            "period" => period = val.parse::<u64>().unwrap_or(30).clamp(5, 3600),
            "counter" => counter = val.parse::<u64>().unwrap_or(0),
            _ => {}
        }
    }
    if secret.is_empty() {
        return Err(Error::Invalid("otpauth URI is missing secret parameter".into()));
    }
    // Validate secret is valid Base32
    let _ = decode_base32(&secret)?;

    Ok(json!({
        "kind": kind,
        "issuer": issuer,
        "account": account,
        "secret": secret,
        "algorithm": algorithm,
        "digits": digits,
        "period": period,
        "counter": counter,
    }))
}
