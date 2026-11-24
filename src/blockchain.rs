use bip39::Mnemonic;
use blake2::{Blake2b, Digest as BlakeDigest, digest::consts::U32};
use ed25519_dalek::{Signature as EdSig, Signer, SigningKey as EdSigningKey, Verifier, VerifyingKey as EdVerifyingKey};
use hmac::{Hmac, KeyInit, Mac};
use k256::ecdsa::{RecoveryId, Signature as SecpSig, SigningKey as SecpSigningKey, VerifyingKey as SecpVerifyingKey};
use k256::elliptic_curve::sec1::ToEncodedPoint;
use k256::{NonZeroScalar, PublicKey as SecpPublicKey};
use openidea_plugin::Error;
use rand::Rng;
use ripemd::Ripemd160;
use serde_json::{Value, json};
use sha2::{Digest, Sha256, Sha512};
use tiny_keccak::{Hasher, Keccak};

fn hmac_sha512(key: &[u8], data: &[u8]) -> [u8; 64] {
    let mut mac = <Hmac<Sha512> as KeyInit>::new_from_slice(key).expect("HMAC key accepts any length");
    mac.update(data);
    let out = mac.finalize().into_bytes();
    let mut arr = [0u8; 64];
    arr.copy_from_slice(&out);
    arr
}

fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak::v256();
    hasher.update(data);
    let mut out = [0u8; 32];
    hasher.finalize(&mut out);
    out
}

fn hash160(data: &[u8]) -> [u8; 20] {
    let sha = Sha256::digest(data);
    let ripe = Ripemd160::digest(sha);
    let mut out = [0u8; 20];
    out.copy_from_slice(&ripe);
    out
}

fn base58check_encode(payload: &[u8]) -> String {
    let first = Sha256::digest(payload);
    let second = Sha256::digest(first);
    let mut buf = Vec::with_capacity(payload.len() + 4);
    buf.extend_from_slice(payload);
    buf.extend_from_slice(&second[..4]);
    bs58::encode(buf).into_string()
}

pub fn generate_mnemonic(word_count: usize) -> Result<Value, Error> {
    let entropy_bytes = match word_count {
        12 => 16,
        15 => 20,
        18 => 24,
        21 => 28,
        24 => 32,
        _ => return Err(Error::Invalid("Mnemonic word count must be 12, 15, 18, 21, or 24".into())),
    };
    let mut entropy = vec![0u8; entropy_bytes];
    rand::rng().fill_bytes(&mut entropy);
    let mnemonic = Mnemonic::from_entropy(&entropy)
        .map_err(|e| Error::Invalid(format!("Mnemonic generation error: {e}")))?;
    Ok(json!({ "mnemonic": mnemonic.to_string(), "wordCount": word_count }))
}

pub fn derive_wallet(mnemonic_str: &str, passphrase: &str, account: u32, index: u32) -> Result<Value, Error> {
    let mnemonic = Mnemonic::parse_normalized(mnemonic_str.trim())
        .map_err(|e| Error::Invalid(format!("Invalid BIP-39 mnemonic: {e}")))?;
    let seed = mnemonic.to_seed_normalized(passphrase);

    // 1. Ethereum / EVM: m/44'/60'/0'/0/{index}
    let eth_path = format!("m/44'/60'/{account}'/0/{index}");
    let eth_priv = bip32_derive_secp256k1(&seed, &[hard(44), hard(60), hard(account), 0, index])?;
    let eth_sk = SecpSigningKey::from_slice(&eth_priv)
        .map_err(|e| Error::Invalid(format!("secp256k1 key error: {e}")))?;
    let eth_pk_uncompressed = SecpPublicKey::from(eth_sk.verifying_key()).to_encoded_point(false);
    let eth_hash = keccak256(&eth_pk_uncompressed.as_bytes()[1..]);
    let mut eth_addr_bytes = [0u8; 20];
    eth_addr_bytes.copy_from_slice(&eth_hash[12..32]);
    let eth_addr = eip55_checksum(&eth_addr_bytes);
    let eth_pk_comp = hex::encode(SecpPublicKey::from(eth_sk.verifying_key()).to_encoded_point(true).as_bytes());

    // 2. Tron: m/44'/195'/0'/0/{index} (0x41 + last 20 bytes of keccak256(uncompressed_pub[1..]), Base58Check)
    let trx_path = format!("m/44'/195'/{account}'/0/{index}");
    let trx_priv = bip32_derive_secp256k1(&seed, &[hard(44), hard(195), hard(account), 0, index])?;
    let trx_sk = SecpSigningKey::from_slice(&trx_priv).map_err(|e| Error::Invalid(e.to_string()))?;
    let trx_pk_unc = SecpPublicKey::from(trx_sk.verifying_key()).to_encoded_point(false);
    let trx_hash = keccak256(&trx_pk_unc.as_bytes()[1..]);
    let mut trx_payload = [0u8; 21];
    trx_payload[0] = 0x41;
    trx_payload[1..].copy_from_slice(&trx_hash[12..32]);
    let trx_addr = base58check_encode(&trx_payload);
    let trx_pk_comp = hex::encode(SecpPublicKey::from(trx_sk.verifying_key()).to_encoded_point(true).as_bytes());

    // 3. Bitcoin Native SegWit (P2WPKH bc1q...): m/84'/0'/{account}'/0/{index}
    let btc84_path = format!("m/84'/0'/{account}'/0/{index}");
    let btc84_priv = bip32_derive_secp256k1(&seed, &[hard(84), hard(0), hard(account), 0, index])?;
    let btc84_sk = SecpSigningKey::from_slice(&btc84_priv).map_err(|e| Error::Invalid(e.to_string()))?;
    let btc84_pk_bytes = SecpPublicKey::from(btc84_sk.verifying_key()).to_encoded_point(true).as_bytes().to_vec();
    let btc84_h160 = hash160(&btc84_pk_bytes);
    let btc_bech32 = bech32_segwit_v0("bc", &btc84_h160)?;
    let btc84_wif = encode_btc_wif(&btc84_priv);

    // 4. Bitcoin Legacy (P2PKH 1...): m/44'/0'/{account}'/0/{index}
    let btc44_path = format!("m/44'/0'/{account}'/0/{index}");
    let btc44_priv = bip32_derive_secp256k1(&seed, &[hard(44), hard(0), hard(account), 0, index])?;
    let btc44_sk = SecpSigningKey::from_slice(&btc44_priv).map_err(|e| Error::Invalid(e.to_string()))?;
    let btc44_pk_bytes = SecpPublicKey::from(btc44_sk.verifying_key()).to_encoded_point(true).as_bytes().to_vec();
    let btc44_h160 = hash160(&btc44_pk_bytes);
    let mut legacy_payload = [0u8; 21];
    legacy_payload[0] = 0x00;
    legacy_payload[1..].copy_from_slice(&btc44_h160);
    let btc_legacy = base58check_encode(&legacy_payload);
    let btc44_wif = encode_btc_wif(&btc44_priv);

    // 5. Solana (SLIP-0010 Ed25519): m/44'/501'/{account}'/{index}'
    let sol_path = format!("m/44'/501'/{account}'/{index}'");
    let sol_priv = slip10_derive_ed25519(&seed, &[hard(44), hard(501), hard(account), hard(index)]);
    let sol_sk = EdSigningKey::from_bytes(&sol_priv);
    let sol_pk = sol_sk.verifying_key().to_bytes();
    let sol_addr = bs58::encode(sol_pk).into_string();

    // 6. Sui (SLIP-0010 Ed25519): m/44'/784'/{account}'/0'/{index}'
    let sui_path = format!("m/44'/784'/{account}'/0'/{index}'");
    let sui_priv = slip10_derive_ed25519(&seed, &[hard(44), hard(784), hard(account), hard(0), hard(index)]);
    let sui_sk = EdSigningKey::from_bytes(&sui_priv);
    let sui_pk = sui_sk.verifying_key().to_bytes();
    let mut sui_input = [0u8; 33];
    sui_input[0] = 0x00; // Ed25519 scheme flag
    sui_input[1..].copy_from_slice(&sui_pk);
    let sui_hash = Blake2b::<U32>::digest(sui_input);
    let sui_addr = format!("0x{}", hex::encode(sui_hash));

    Ok(json!({
        "valid": true,
        "wordCount": mnemonic.words().count(),
        "seedHex": hex::encode(seed),
        "chains": {
            "ethereum": {
                "name": "Ethereum / EVM",
                "path": eth_path,
                "address": eth_addr,
                "publicKey": format!("0x{eth_pk_comp}"),
                "privateKey": format!("0x{}", hex::encode(eth_priv)),
            },
            "bitcoinSegwit": {
                "name": "Bitcoin (Native SegWit)",
                "path": btc84_path,
                "address": btc_bech32,
                "publicKey": hex::encode(&btc84_pk_bytes),
                "privateKey": hex::encode(btc84_priv),
                "wif": btc84_wif,
            },
            "bitcoinLegacy": {
                "name": "Bitcoin (Legacy P2PKH)",
                "path": btc44_path,
                "address": btc_legacy,
                "publicKey": hex::encode(&btc44_pk_bytes),
                "privateKey": hex::encode(btc44_priv),
                "wif": btc44_wif,
            },
            "tron": {
                "name": "Tron (TRX / TRC-20)",
                "path": trx_path,
                "address": trx_addr,
                "publicKey": trx_pk_comp,
                "privateKey": hex::encode(trx_priv),
            },
            "solana": {
                "name": "Solana (SOL)",
                "path": sol_path,
                "address": sol_addr,
                "publicKey": hex::encode(sol_pk),
                "privateKey": hex::encode(sol_priv),
            },
            "sui": {
                "name": "Sui (SUI)",
                "path": sui_path,
                "address": sui_addr,
                "publicKey": format!("0x{}", hex::encode(sui_pk)),
                "privateKey": format!("0x{}", hex::encode(sui_priv)),
            },
        }
    }))
}

const fn hard(i: u32) -> u32 {
    i | 0x8000_0000
}

fn bip32_derive_secp256k1(seed: &[u8], path: &[u32]) -> Result<[u8; 32], Error> {
    let i0 = hmac_sha512(b"Bitcoin seed", seed);
    let mut k_bytes = [0u8; 32];
    k_bytes.copy_from_slice(&i0[..32]);
    let mut c_bytes = [0u8; 32];
    c_bytes.copy_from_slice(&i0[32..]);

    let mut scalar = *Option::<NonZeroScalar>::from(NonZeroScalar::from_repr(k_bytes.into()))
        .ok_or_else(|| Error::Invalid("Invalid BIP-32 master key".into()))?;

    for &child_idx in path {
        let mut data = Vec::with_capacity(37);
        if child_idx & 0x8000_0000 != 0 {
            data.push(0x00);
            data.extend_from_slice(&scalar.to_bytes());
        } else {
            let nz = NonZeroScalar::new(scalar)
                .into_option()
                .ok_or_else(|| Error::Invalid("Zero scalar in BIP-32 path".into()))?;
            let sk = SecpSigningKey::from(nz);
            let comp = SecpPublicKey::from(sk.verifying_key()).to_encoded_point(true);
            data.extend_from_slice(comp.as_bytes());
        }
        data.extend_from_slice(&child_idx.to_be_bytes());

        let derived = hmac_sha512(&c_bytes, &data);
        let mut il = [0u8; 32];
        il.copy_from_slice(&derived[..32]);
        let il_nz = Option::<NonZeroScalar>::from(NonZeroScalar::from_repr(il.into()))
            .ok_or_else(|| Error::Invalid("BIP-32 derived tweak >= order".into()))?;
        let child_scalar = *il_nz + scalar;
        if bool::from(child_scalar.is_zero()) {
            return Err(Error::Invalid("BIP-32 derived child key is zero".into()));
        }
        scalar = child_scalar;
        c_bytes.copy_from_slice(&derived[32..]);
    }

    let mut out = [0u8; 32];
    out.copy_from_slice(&scalar.to_bytes());
    Ok(out)
}

fn slip10_derive_ed25519(seed: &[u8], path: &[u32]) -> [u8; 32] {
    let i0 = hmac_sha512(b"ed25519 seed", seed);
    let mut k = [0u8; 32];
    k.copy_from_slice(&i0[..32]);
    let mut c = [0u8; 32];
    c.copy_from_slice(&i0[32..]);

    for &idx in path {
        let hardened = idx | 0x8000_0000;
        let mut data = Vec::with_capacity(37);
        data.push(0x00);
        data.extend_from_slice(&k);
        data.extend_from_slice(&hardened.to_be_bytes());
        let d = hmac_sha512(&c, &data);
        k.copy_from_slice(&d[..32]);
        c.copy_from_slice(&d[32..]);
    }
    k
}

fn encode_btc_wif(priv32: &[u8; 32]) -> String {
    let mut payload = [0u8; 34];
    payload[0] = 0x80; // Mainnet
    payload[1..33].copy_from_slice(priv32);
    payload[33] = 0x01; // Compressed pubkey flag
    base58check_encode(&payload)
}

pub fn eip55_checksum(addr20: &[u8; 20]) -> String {
    let lower = hex::encode(addr20);
    let hash = keccak256(lower.as_bytes());
    let mut out = String::with_capacity(42);
    out.push_str("0x");
    for (idx, ch) in lower.chars().enumerate() {
        let nibble = if idx % 2 == 0 { hash[idx / 2] >> 4 } else { hash[idx / 2] & 0x0f };
        if nibble >= 8 && ch.is_ascii_alphabetic() {
            out.push(ch.to_ascii_uppercase());
        } else {
            out.push(ch);
        }
    }
    out
}

/// Pure BIP-173 Bech32 witness v0 encoder (P2WPKH / P2WSH).
pub fn bech32_segwit_v0(hrp: &str, program: &[u8]) -> Result<String, Error> {
    const CHARSET: &[u8; 32] = b"qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    let mut data5 = Vec::with_capacity(1 + (program.len() * 8 + 4) / 5);
    data5.push(0u8); // witness version 0
    convert_bits_8_to_5(program, &mut data5);
    let mut values = bech32_hrp_expand(hrp);
    values.extend_from_slice(&data5);
    values.extend_from_slice(&[0u8; 6]);
    let polymod = bech32_polymod(&values) ^ 1;

    let mut out = String::with_capacity(hrp.len() + 1 + data5.len() + 6);
    out.push_str(hrp);
    out.push('1');
    for d in data5 {
        out.push(CHARSET[d as usize] as char);
    }
    for p in 0..6 {
        let v = (polymod >> (5 * (5 - p))) & 31;
        out.push(CHARSET[v as usize] as char);
    }
    Ok(out)
}

fn convert_bits_8_to_5(input: &[u8], out: &mut Vec<u8>) {
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    for &b in input {
        acc = (acc << 8) | u32::from(b);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(((acc >> bits) & 31) as u8);
        }
    }
    if bits > 0 {
        out.push(((acc << (5 - bits)) & 31) as u8);
    }
}

fn bech32_hrp_expand(hrp: &str) -> Vec<u8> {
    let mut v = Vec::with_capacity(hrp.len() * 2 + 1);
    for b in hrp.bytes() {
        v.push(b >> 5);
    }
    v.push(0);
    for b in hrp.bytes() {
        v.push(b & 31);
    }
    v
}

fn bech32_polymod(values: &[u8]) -> u32 {
    const GEN: [u32; 5] = [0x3b6a_57b2, 0x2650_8e6d, 0x1ea1_19fa, 0x3d42_33dd, 0x2a14_62b3];
    let mut chk = 1u32;
    for &v in values {
        let top = chk >> 25;
        chk = ((chk & 0x1ff_ffff) << 5) ^ u32::from(v);
        for (i, &g) in GEN.iter().enumerate() {
            if (top >> i) & 1 != 0 {
                chk ^= g;
            }
        }
    }
    chk
}

// ============================================================================
// Offline Message Signing & Verification (EIP-191 EVM + Ed25519)
// ============================================================================

fn eip191_digest(message: &str) -> [u8; 32] {
    let prefix = format!("\x19Ethereum Signed Message:\n{}", message.len());
    let mut buf = Vec::with_capacity(prefix.len() + message.len());
    buf.extend_from_slice(prefix.as_bytes());
    buf.extend_from_slice(message.as_bytes());
    keccak256(&buf)
}

fn decode_hex_32(raw: &str, label: &str) -> Result<[u8; 32], Error> {
    let clean = raw.trim().strip_prefix("0x").or_else(|| raw.trim().strip_prefix("0X")).unwrap_or(raw.trim());
    let bytes = hex::decode(clean).map_err(|e| Error::Invalid(format!("Invalid {label} hex: {e}")))?;
    if bytes.len() != 32 {
        return Err(Error::Invalid(format!("{label} must be 32 bytes (64 hex chars), got {}", bytes.len())));
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

pub fn sign_message(chain: &str, private_key_hex: &str, message: &str) -> Result<Value, Error> {
    let key32 = decode_hex_32(private_key_hex, "private key")?;
    match chain {
        "evm" | "ethereum" => {
            let sk = SecpSigningKey::from_slice(&key32)
                .map_err(|e| Error::Invalid(format!("Invalid secp256k1 private key: {e}")))?;
            let digest = eip191_digest(message);
            let (sig, recid) = sk
                .sign_prehash_recoverable(&digest)
                .map_err(|e| Error::Invalid(format!("Signing failed: {e}")))?;
            let mut full = Vec::with_capacity(65);
            full.extend_from_slice(&sig.to_bytes());
            full.push(27 + recid.to_byte());

            let pk_unc = SecpPublicKey::from(sk.verifying_key()).to_encoded_point(false);
            let h = keccak256(&pk_unc.as_bytes()[1..]);
            let mut addr = [0u8; 20];
            addr.copy_from_slice(&h[12..]);
            Ok(json!({
                "signature": format!("0x{}", hex::encode(full)),
                "signerAddress": eip55_checksum(&addr),
                "digest": format!("0x{}", hex::encode(digest)),
            }))
        }
        "ed25519" | "solana" | "sui" => {
            let sk = EdSigningKey::from_bytes(&key32);
            let sig = sk.sign(message.as_bytes());
            Ok(json!({
                "signature": format!("0x{}", hex::encode(sig.to_bytes())),
                "publicKey": format!("0x{}", hex::encode(sk.verifying_key().to_bytes())),
                "signatureBase58": bs58::encode(sig.to_bytes()).into_string(),
            }))
        }
        _ => Err(Error::Invalid(format!("Unsupported signing chain {chain}"))),
    }
}

pub fn verify_message(chain: &str, address_or_pubkey: &str, message: &str, signature: &str) -> Result<Value, Error> {
    match chain {
        "evm" | "ethereum" => {
            let sig_clean = signature.trim().strip_prefix("0x").or_else(|| signature.trim().strip_prefix("0X")).unwrap_or(signature.trim());
            let sig_bytes = hex::decode(sig_clean).map_err(|e| Error::Invalid(format!("Invalid EVM signature hex: {e}")))?;
            if sig_bytes.len() != 65 {
                return Err(Error::Invalid("EIP-191 signature must be 65 bytes (r + s + v)".into()));
            }
            let sig = SecpSig::from_slice(&sig_bytes[..64])
                .map_err(|e| Error::Invalid(format!("Invalid ECDSA signature: {e}")))?;
            let raw_v = sig_bytes[64];
            let rec_byte = match raw_v {
                0 | 1 => raw_v,
                27 | 28 => raw_v - 27,
                _ => return Err(Error::Invalid(format!("Invalid recovery v={raw_v}; expected 27/28 or 0/1"))),
            };
            let recid = RecoveryId::from_byte(rec_byte).ok_or_else(|| Error::Invalid("Invalid RecoveryId".into()))?;
            let digest = eip191_digest(message);
            let recovered_vk = SecpVerifyingKey::recover_from_prehash(&digest, &sig, recid)
                .map_err(|e| Error::Invalid(format!("Key recovery failed: {e}")))?;
            let pk_unc = SecpPublicKey::from(recovered_vk).to_encoded_point(false);
            let h = keccak256(&pk_unc.as_bytes()[1..]);
            let mut addr = [0u8; 20];
            addr.copy_from_slice(&h[12..]);
            let recovered_addr = eip55_checksum(&addr);
            let expected = address_or_pubkey.trim();
            let valid = if expected.is_empty() {
                true
            } else {
                recovered_addr.eq_ignore_ascii_case(expected)
            };
            Ok(json!({ "valid": valid, "recoveredAddress": recovered_addr }))
        }
        "ed25519" | "solana" | "sui" => {
            let target = address_or_pubkey.trim();
            let pk_bytes = if target.starts_with("0x") || (target.len() == 64 && target.chars().all(|c| c.is_ascii_hexdigit())) {
                decode_hex_32(target, "public key")?
            } else {
                let decoded = bs58::decode(target).into_vec().map_err(|e| Error::Invalid(format!("Invalid Base58 pubkey: {e}")))?;
                if decoded.len() != 32 {
                    return Err(Error::Invalid("Ed25519 public key must be 32 bytes".into()));
                }
                let mut arr = [0u8; 32];
                arr.copy_from_slice(&decoded);
                arr
            };
            let sig_str = signature.trim();
            let sig_vec = if sig_str.starts_with("0x") || (sig_str.len() == 128 && sig_str.chars().all(|c| c.is_ascii_hexdigit())) {
                hex::decode(sig_str.strip_prefix("0x").unwrap_or(sig_str))
                    .map_err(|e| Error::Invalid(format!("Invalid signature hex: {e}")))?
            } else {
                bs58::decode(sig_str).into_vec().map_err(|e| Error::Invalid(format!("Invalid signature Base58: {e}")))?
            };
            let sig = EdSig::from_slice(&sig_vec).map_err(|e| Error::Invalid(format!("Invalid Ed25519 signature: {e}")))?;
            let vk = EdVerifyingKey::from_bytes(&pk_bytes).map_err(|e| Error::Invalid(format!("Invalid Ed25519 public key: {e}")))?;
            let valid = vk.verify(message.as_bytes(), &sig).is_ok();
            Ok(json!({ "valid": valid }))
        }
        _ => Err(Error::Invalid(format!("Unsupported verification chain {chain}"))),
    }
}
