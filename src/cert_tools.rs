use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use chrono::{NaiveDate, TimeZone, Utc};
use openidea_plugin::Error;
use serde_json::{Value, json};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use std::net::{Ipv4Addr, Ipv6Addr};

struct Tlv<'a> {
    tag: u8,
    content: &'a [u8],
    full: &'a [u8],
}

fn parse_tlv(data: &[u8]) -> Result<(Tlv<'_>, &[u8]), Error> {
    if data.is_empty() {
        return Err(Error::Invalid("Unexpected end of ASN.1 DER data".into()));
    }
    let first_tag = data[0];
    let mut idx = 1usize;
    if (first_tag & 0x1F) == 0x1F {
        while idx < data.len() {
            let b = data[idx];
            idx += 1;
            if (b & 0x80) == 0 {
                break;
            }
        }
    }
    if idx >= data.len() {
        return Err(Error::Invalid("Truncated ASN.1 length".into()));
    }
    let len_byte = data[idx];
    idx += 1;
    let len: usize = if len_byte < 0x80 {
        usize::from(len_byte)
    } else {
        let count = usize::from(len_byte & 0x7F);
        if count == 0 || count > 4 || idx + count > data.len() {
            return Err(Error::Invalid("Unsupported ASN.1 DER length encoding".into()));
        }
        let mut n = 0usize;
        for &b in &data[idx..idx + count] {
            n = (n << 8) | usize::from(b);
        }
        idx += count;
        n
    };
    let end = idx
        .checked_add(len)
        .ok_or_else(|| Error::Invalid("ASN.1 length overflow".into()))?;
    if end > data.len() {
        return Err(Error::Invalid("Truncated ASN.1 DER value".into()));
    }
    Ok((
        Tlv {
            tag: first_tag,
            content: &data[idx..end],
            full: &data[..end],
        },
        &data[end..],
    ))
}

fn parse_children(mut slice: &[u8]) -> Result<Vec<Tlv<'_>>, Error> {
    let mut out = Vec::new();
    while !slice.is_empty() {
        let (tlv, rest) = parse_tlv(slice)?;
        out.push(tlv);
        slice = rest;
    }
    Ok(out)
}

fn decode_oid(bytes: &[u8]) -> Result<String, Error> {
    if bytes.is_empty() {
        return Err(Error::Invalid("Empty OID".into()));
    }
    let first = bytes[0];
    let a = first / 40;
    let b = first % 40;
    let mut parts = vec![a.to_string(), b.to_string()];
    let mut val: u64 = 0;
    for &byte in &bytes[1..] {
        val = (val << 7) | u64::from(byte & 0x7F);
        if (byte & 0x80) == 0 {
            parts.push(val.to_string());
            val = 0;
        }
    }
    Ok(parts.join("."))
}

fn oid_name(oid: &str) -> &str {
    match oid {
        "2.5.4.3" => "CN",
        "2.5.4.6" => "C",
        "2.5.4.7" => "L",
        "2.5.4.8" => "ST",
        "2.5.4.10" => "O",
        "2.5.4.11" => "OU",
        "1.2.840.113549.1.9.1" => "emailAddress",
        "1.2.840.113549.1.1.1" => "RSA (rsaEncryption)",
        "1.2.840.113549.1.1.5" => "SHA1withRSA",
        "1.2.840.113549.1.1.11" => "SHA256withRSA",
        "1.2.840.113549.1.1.12" => "SHA384withRSA",
        "1.2.840.113549.1.1.13" => "SHA512withRSA",
        "1.2.840.10045.2.1" => "EC (id-ecPublicKey)",
        "1.2.840.10045.3.1.7" => "P-256 (prime256v1)",
        "1.3.132.0.34" => "P-384 (secp384r1)",
        "1.3.132.0.35" => "P-521 (secp521r1)",
        "1.2.156.10197.1.301" => "SM2 (sm2p256v1)",
        "1.2.156.10197.1.501" => "SM3withSM2",
        "1.2.840.10045.4.3.2" => "ECDSA-with-SHA256",
        "1.2.840.10045.4.3.3" => "ECDSA-with-SHA384",
        "1.2.840.10045.4.3.4" => "ECDSA-with-SHA512",
        "1.3.101.112" => "Ed25519",
        "2.5.29.17" => "subjectAltName",
        "2.5.29.19" => "basicConstraints",
        _ => oid,
    }
}

fn decode_string(tlv: &Tlv<'_>) -> String {
    match tlv.tag {
        0x1E => {
            // BMPString UTF-16BE
            let u16s: Vec<u16> = tlv
                .content
                .chunks_exact(2)
                .map(|c| u16::from_be_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16_lossy(&u16s)
        }
        _ => String::from_utf8_lossy(tlv.content).into_owned(),
    }
}

fn parse_name(tlv: &Tlv<'_>) -> Result<(String, Vec<(String, String)>), Error> {
    let rdns = parse_children(tlv.content)?;
    let mut pairs = Vec::new();
    for rdn in rdns {
        let attrs = parse_children(rdn.content)?;
        for attr in attrs {
            let parts = parse_children(attr.content)?;
            if parts.len() >= 2 && parts[0].tag == 0x06 {
                let oid = decode_oid(parts[0].content)?;
                let key = oid_name(&oid).to_owned();
                let val = decode_string(&parts[1]);
                pairs.push((key, val));
            }
        }
    }
    let summary = pairs
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join(", ");
    Ok((summary, pairs))
}

fn parse_asn1_time(tlv: &Tlv<'_>) -> Option<chrono::DateTime<Utc>> {
    let s = std::str::from_utf8(tlv.content).ok()?.trim();
    if tlv.tag == 0x17 && s.len() >= 13 && s.ends_with('Z') {
        // YYMMDDHHMMSSZ
        let yy: i32 = s[0..2].parse().ok()?;
        let year = if yy >= 50 { 1900 + yy } else { 2000 + yy };
        let mm: u32 = s[2..4].parse().ok()?;
        let dd: u32 = s[4..6].parse().ok()?;
        let hh: u32 = s[6..8].parse().ok()?;
        let mi: u32 = s[8..10].parse().ok()?;
        let ss: u32 = s[10..12].parse().ok()?;
        let dt = NaiveDate::from_ymd_opt(year, mm, dd)?.and_hms_opt(hh, mi, ss)?;
        return Some(Utc.from_utc_datetime(&dt));
    }
    if tlv.tag == 0x18 && s.len() >= 15 && s.ends_with('Z') {
        // YYYYMMDDHHMMSSZ
        let year: i32 = s[0..4].parse().ok()?;
        let mm: u32 = s[4..6].parse().ok()?;
        let dd: u32 = s[6..8].parse().ok()?;
        let hh: u32 = s[8..10].parse().ok()?;
        let mi: u32 = s[10..12].parse().ok()?;
        let ss: u32 = s[12..14].parse().ok()?;
        let dt = NaiveDate::from_ymd_opt(year, mm, dd)?.and_hms_opt(hh, mi, ss)?;
        return Some(Utc.from_utc_datetime(&dt));
    }
    None
}

fn parse_x509_certificate(der: &[u8]) -> Result<Value, Error> {
    let (cert_tlv, _) = parse_tlv(der)?;
    if cert_tlv.tag != 0x30 {
        return Err(Error::Invalid("Not an X.509 DER SEQUENCE".into()));
    }
    let outer = parse_children(cert_tlv.content)?;
    if outer.len() < 3 {
        return Err(Error::Invalid("Incomplete X.509 Certificate structure".into()));
    }
    let tbs = &outer[0];
    let sig_alg_tlv = &outer[1];
    let fields = parse_children(tbs.content)?;
    if fields.len() < 6 {
        return Err(Error::Invalid("Incomplete tbsCertificate fields".into()));
    }

    let mut idx = 0usize;
    let version = if fields[0].tag == 0xA0 {
        let ver_children = parse_children(fields[0].content)?;
        idx = 1;
        let v = ver_children.first().and_then(|c| c.content.first().copied()).unwrap_or(0);
        u32::from(v) + 1
    } else {
        1
    };

    let serial_hex = fields
        .get(idx)
        .map(|f| hex::encode_upper(f.content))
        .unwrap_or_default();
    idx += 1; // signature AlgorithmIdentifier in tbs
    idx += 1;

    let (issuer_str, issuer_fields) = parse_name(
        fields.get(idx).ok_or_else(|| Error::Invalid("Missing issuer".into()))?,
    )?;
    idx += 1;

    let validity_tlv = fields.get(idx).ok_or_else(|| Error::Invalid("Missing validity".into()))?;
    let validity_items = parse_children(validity_tlv.content)?;
    if validity_items.len() < 2 {
        return Err(Error::Invalid("Invalid validity dates".into()));
    }
    let not_before = parse_asn1_time(&validity_items[0]);
    let not_after = parse_asn1_time(&validity_items[1]);
    let now = Utc::now();
    let is_expired = not_after.map(|d| now > d).unwrap_or(false) || not_before.map(|d| now < d).unwrap_or(false);
    let days_remaining = not_after.map(|d| (d - now).num_days());
    idx += 1;

    let (subject_str, subject_fields) = parse_name(
        fields.get(idx).ok_or_else(|| Error::Invalid("Missing subject".into()))?,
    )?;
    idx += 1;

    let spki = fields.get(idx).ok_or_else(|| Error::Invalid("Missing subjectPublicKeyInfo".into()))?;
    let spki_children = parse_children(spki.content)?;
    let mut pub_alg = "Unknown".to_owned();
    let mut pub_bits: Option<usize> = None;
    if let Some(alg_seq) = spki_children.first() {
        let alg_parts = parse_children(alg_seq.content)?;
        if let Some(oid_tlv) = alg_parts.first() {
            let oid = decode_oid(oid_tlv.content)?;
            pub_alg = oid_name(&oid).to_owned();
            if let Some(param) = alg_parts.get(1) {
                if param.tag == 0x06 {
                    if let Ok(curve_oid) = decode_oid(param.content) {
                        pub_alg = format!("{pub_alg} / {}", oid_name(&curve_oid));
                    }
                }
            }
        }
    }
    if let Some(bit_tlv) = spki_children.get(1) {
        if bit_tlv.tag == 0x03 && bit_tlv.content.len() > 1 {
            let key_bytes = &bit_tlv.content[1..];
            if pub_alg.starts_with("RSA") {
                if let Ok((rsa_seq, _)) = parse_tlv(key_bytes) {
                    if let Ok(rsa_parts) = parse_children(rsa_seq.content) {
                        if let Some(modulus) = rsa_parts.first() {
                            let trimmed = modulus
                                .content
                                .iter()
                                .skip_while(|&&b| b == 0)
                                .count();
                            pub_bits = Some(trimmed * 8);
                        }
                    }
                }
            } else if pub_alg.contains("P-256") || pub_alg.contains("SM2") || pub_alg.contains("Ed25519") {
                pub_bits = Some(256);
            } else if pub_alg.contains("P-384") {
                pub_bits = Some(384);
            } else if pub_alg.contains("P-521") {
                pub_bits = Some(521);
            }
        }
    }
    idx += 1;

    // Parse optional extensions [3] EXPLICIT
    let mut sans = Vec::new();
    let mut is_ca: Option<bool> = None;
    for f in &fields[idx..] {
        if f.tag == 0xA3 {
            if let Ok(ext_seqs) = parse_children(f.content) {
                if let Some(ext_list_tlv) = ext_seqs.first() {
                    if let Ok(exts) = parse_children(ext_list_tlv.content) {
                        for ext in exts {
                            if let Ok(ep) = parse_children(ext.content) {
                                if let Some(oid_tlv) = ep.first() {
                                    let ext_oid = decode_oid(oid_tlv.content).unwrap_or_default();
                                    let octet = ep.last();
                                    if let Some(oct) = octet.filter(|o| o.tag == 0x04) {
                                        if ext_oid == "2.5.29.17" {
                                            if let Ok((san_seq, _)) = parse_tlv(oct.content) {
                                                if let Ok(names) = parse_children(san_seq.content) {
                                                    for n in names {
                                                        match n.tag {
                                                            0x81 => sans.push(format!("Email:{}", String::from_utf8_lossy(n.content))),
                                                            0x82 => sans.push(format!("DNS:{}", String::from_utf8_lossy(n.content))),
                                                            0x86 => sans.push(format!("URI:{}", String::from_utf8_lossy(n.content))),
                                                            0x87 if n.content.len() == 4 => {
                                                                let ip = Ipv4Addr::new(n.content[0], n.content[1], n.content[2], n.content[3]);
                                                                sans.push(format!("IP:{ip}"));
                                                            }
                                                            0x87 if n.content.len() == 16 => {
                                                                let arr: [u8; 16] = n.content.try_into().unwrap();
                                                                sans.push(format!("IP:{}", Ipv6Addr::from(arr)));
                                                            }
                                                            _ => {}
                                                        }
                                                    }
                                                }
                                            }
                                        } else if ext_oid == "2.5.29.19" {
                                            if let Ok((bc_seq, _)) = parse_tlv(oct.content) {
                                                if let Ok(bc_parts) = parse_children(bc_seq.content) {
                                                    let ca_flag = bc_parts
                                                        .first()
                                                        .filter(|b| b.tag == 0x01)
                                                        .map(|b| b.content.first().copied().unwrap_or(0) != 0)
                                                        .unwrap_or(false);
                                                    is_ca = Some(ca_flag);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let sig_alg = parse_children(sig_alg_tlv.content)
        .ok()
        .and_then(|p| p.first().and_then(|o| decode_oid(o.content).ok()))
        .map(|o| oid_name(&o).to_owned())
        .unwrap_or_else(|| "Unknown".into());

    let sha256_fp = format_colon_hex(&Sha256::digest(cert_tlv.full));
    let sha1_fp = format_colon_hex(&Sha1::digest(cert_tlv.full));

    Ok(json!({
        "kind": "X.509 Certificate",
        "version": version,
        "serialHex": serial_hex,
        "signatureAlgorithm": sig_alg,
        "issuer": issuer_str,
        "issuerFields": issuer_fields,
        "subject": subject_str,
        "subjectFields": subject_fields,
        "notBefore": not_before.map(|d| d.to_rfc3339()),
        "notAfter": not_after.map(|d| d.to_rfc3339()),
        "isExpired": is_expired,
        "daysRemaining": days_remaining,
        "publicKeyAlgorithm": pub_alg,
        "publicKeyBits": pub_bits,
        "sans": sans,
        "isCa": is_ca,
        "sha256Fingerprint": sha256_fp,
        "sha1Fingerprint": sha1_fp,
        "derSize": cert_tlv.full.len(),
        "derHex": hex::encode(cert_tlv.full),
        "derBase64": STANDARD.encode(cert_tlv.full),
        "pem": wrap_pem("CERTIFICATE", cert_tlv.full),
    }))
}

fn format_colon_hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

fn wrap_pem(label: &str, der: &[u8]) -> String {
    let b64 = STANDARD.encode(der);
    let mut out = format!("-----BEGIN {label}-----\n");
    for chunk in b64.as_bytes().chunks(64) {
        out.push_str(std::str::from_utf8(chunk).unwrap_or(""));
        out.push('\n');
    }
    out.push_str(&format!("-----END {label}-----"));
    out
}

pub fn inspect_pem_or_der(input: &str) -> Result<Value, Error> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(Error::Invalid("Input PEM or DER certificate is empty".into()));
    }

    let mut blocks: Vec<(String, Vec<u8>)> = Vec::new();
    let mut rest = trimmed;
    while let Some(start_idx) = rest.find("-----BEGIN ") {
        let after_begin = &rest[start_idx + 11..];
        let Some(end_header) = after_begin.find("-----") else { break };
        let label = after_begin[..end_header].trim().to_owned();
        let body_start = &after_begin[end_header + 5..];
        let end_marker = format!("-----END {label}-----");
        let Some(end_idx) = body_start.find(&end_marker) else {
            return Err(Error::Invalid(format!("Missing closing PEM marker {end_marker}")));
        };
        let b64: String = body_start[..end_idx].chars().filter(|c| !c.is_whitespace()).collect();
        let der = STANDARD
            .decode(&b64)
            .map_err(|e| Error::Invalid(format!("Invalid PEM Base64 body: {e}")))?;
        blocks.push((label, der));
        rest = &body_start[end_idx + end_marker.len()..];
    }

    if blocks.is_empty() {
        let compact: String = trimmed.chars().filter(|c| !c.is_whitespace() && *c != ':').collect();
        let der = if compact.len() >= 8 && compact.chars().all(|c| c.is_ascii_hexdigit()) && compact.len() % 2 == 0 {
            hex::decode(&compact).map_err(|e| Error::Invalid(format!("Invalid hex DER: {e}")))?
        } else {
            STANDARD
                .decode(&compact)
                .map_err(|e| Error::Invalid(format!("Could not parse as PEM, Base64 DER, or Hex DER: {e}")))?
        };
        blocks.push(("CERTIFICATE".to_owned(), der));
    }

    let mut items = Vec::new();
    for (label, der) in blocks {
        if label.eq_ignore_ascii_case("CERTIFICATE") {
            match parse_x509_certificate(&der) {
                Ok(v) => items.push(v),
                Err(e) => return Err(e),
            }
        } else {
            items.push(json!({
                "kind": label,
                "sha256Fingerprint": format_colon_hex(&Sha256::digest(&der)),
                "sha1Fingerprint": format_colon_hex(&Sha1::digest(&der)),
                "derSize": der.len(),
                "derHex": hex::encode(&der),
                "derBase64": STANDARD.encode(&der),
                "pem": wrap_pem(&label, &der),
            }));
        }
    }

    Ok(json!({ "items": items }))
}

// --- Minimal DER Builder for Sample X.509 v3 Certificate ---

fn der_tlv(tag: u8, content: &[u8]) -> Vec<u8> {
    let mut out = vec![tag];
    let len = content.len();
    if len < 0x80 {
        out.push(len as u8);
    } else if len <= 0xFF {
        out.push(0x81);
        out.push(len as u8);
    } else {
        out.push(0x82);
        out.extend_from_slice(&(len as u16).to_be_bytes());
    }
    out.extend_from_slice(content);
    out
}

fn der_seq(parts: &[Vec<u8>]) -> Vec<u8> {
    let joined: Vec<u8> = parts.iter().flat_map(|p| p.iter().copied()).collect();
    der_tlv(0x30, &joined)
}

fn der_set(parts: &[Vec<u8>]) -> Vec<u8> {
    let joined: Vec<u8> = parts.iter().flat_map(|p| p.iter().copied()).collect();
    der_tlv(0x31, &joined)
}

pub fn sample_certificate_pem() -> String {
    // OID 2.5.4.3 (CN), 2.5.4.10 (O), 2.5.4.6 (C)
    let cn_oid = der_tlv(0x06, &[0x55, 0x04, 0x03]);
    let o_oid = der_tlv(0x06, &[0x55, 0x04, 0x0A]);
    let c_oid = der_tlv(0x06, &[0x55, 0x04, 0x06]);
    let alg_sha256_rsa = der_seq(&[
        der_tlv(0x06, &[0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x0B]),
        der_tlv(0x05, &[]),
    ]);
    let rsa_oid = der_tlv(0x06, &[0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01]);

    let make_name = |cn: &str, org: &str, country: &str| {
        der_seq(&[
            der_set(&[der_seq(&[c_oid.clone(), der_tlv(0x13, country.as_bytes())])]),
            der_set(&[der_seq(&[o_oid.clone(), der_tlv(0x0C, org.as_bytes())])]),
            der_set(&[der_seq(&[cn_oid.clone(), der_tlv(0x0C, cn.as_bytes())])]),
        ])
    };

    let version = der_tlv(0xA0, &der_tlv(0x02, &[0x02])); // v3
    let serial = der_tlv(0x02, &[0x01, 0x20, 0x26, 0x01, 0x01]);
    let issuer = make_name("OpenIDEA Sample Root CA", "OpenIDEA", "CN");
    let subject = make_name("openidea.dev", "OpenIDEA Toolset", "CN");
    let validity = der_seq(&[
        der_tlv(0x17, b"250101000000Z"),
        der_tlv(0x17, b"351231235959Z"),
    ]);

    // RSA 2048-bit dummy SPKI modulus (256 bytes, MSB set -> 257 bytes with 0x00)
    let mut modulus = vec![0x00u8; 257];
    modulus[1] = 0xB4;
    modulus[256] = 0x55;
    let rsa_pub = der_seq(&[der_tlv(0x02, &modulus), der_tlv(0x02, &[0x01, 0x00, 0x01])]);
    let mut spki_bits = vec![0x00u8];
    spki_bits.extend_from_slice(&rsa_pub);
    let spki = der_seq(&[der_seq(&[rsa_oid, der_tlv(0x05, &[])]), der_tlv(0x03, &spki_bits)]);

    // Extensions: SAN (2.5.29.17) + BasicConstraints (2.5.29.19, CA=false)
    let san_val = der_seq(&[
        der_tlv(0x82, b"openidea.dev"),
        der_tlv(0x82, b"*.openidea.dev"),
        der_tlv(0x87, &[127, 0, 0, 1]),
    ]);
    let san_ext = der_seq(&[der_tlv(0x06, &[0x55, 0x1D, 0x11]), der_tlv(0x04, &san_val)]);
    let bc_ext = der_seq(&[
        der_tlv(0x06, &[0x55, 0x1D, 0x13]),
        der_tlv(0x01, &[0xFF]),
        der_tlv(0x04, &der_seq(&[])),
    ]);
    let exts = der_tlv(0xA3, &der_seq(&[san_ext, bc_ext]));

    let tbs = der_seq(&[version, serial, alg_sha256_rsa.clone(), issuer, validity, subject, spki, exts]);
    let fake_sig = vec![0x00u8, 0xAA, 0xBB, 0xCC, 0xDD];
    let cert = der_seq(&[tbs, alg_sha256_rsa, der_tlv(0x03, &fake_sig)]);
    wrap_pem("CERTIFICATE", &cert)
}
