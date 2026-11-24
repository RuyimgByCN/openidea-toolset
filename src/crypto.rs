use aes::{Aes128, Aes192, Aes256};
use aes_gcm::aead::consts::U12;
use aes_gcm::aead::{Aead, KeyInit as AeadKeyInit};
use aes_gcm::{Aes256Gcm, AesGcm, Nonce};
use base64::Engine as _;
use base64::engine::general_purpose::{STANDARD, URL_SAFE, URL_SAFE_NO_PAD};
use blake2::{Blake2b512, Blake2s256, Digest as LegacyDigest};
use cipher::block_padding::{NoPadding, Pkcs7, ZeroPadding};
use cipher::{BlockModeDecrypt, BlockModeEncrypt, KeyInit as CipherKeyInit, KeyIvInit, StreamCipher};
use des::{Des, TdesEde3};
use hmac::{Hmac, KeyInit as HmacKeyInit, Mac};
use md5::Md5;
use openidea_plugin::{Error, host};
use rc4::Rc4;
use ripemd::Ripemd160;
use rsa::pkcs1::{DecodeRsaPrivateKey, DecodeRsaPublicKey};
use rsa::pkcs8::{DecodePrivateKey, DecodePublicKey, EncodePrivateKey, EncodePublicKey, LineEnding};
use rsa::{PrivateKey as RsaPrivateKey, PublicKey as RsaPublicKey};
use serde::Serialize;
use serde_json::Value;
use sha1::Sha1;
use sha2::{Digest, Sha224, Sha256, Sha384, Sha512};
use sm2::dsa::{Signature as Sm2Sig, SigningKey as Sm2SigningKey, VerifyingKey as Sm2VerifyingKey};
use sm2::elliptic_curve::Generate;
use sm2::pke::{DecryptingKey as Sm2DecKey, EncryptingKey, Mode as Sm2Mode};
use sm2::{PublicKey as Sm2PublicKey, SecretKey as Sm2SecretKey};
use sm3::Sm3;
use sm4::Sm4;
use tiny_keccak::{Hasher, Keccak};

pub fn decode_input(text: &str, encoding: &str) -> Result<Vec<u8>, Error> {
    match encoding {
        "utf8" | "text" => Ok(text.as_bytes().to_vec()),
        "hex" => {
            let clean: String = text.chars().filter(|c| !c.is_whitespace()).collect();
            hex::decode(clean).map_err(|e| Error::Invalid(format!("Invalid hex input: {e}")))
        }
        "base64" => {
            let clean: String = text.chars().filter(|c| !c.is_whitespace()).collect();
            STANDARD
                .decode(&clean)
                .or_else(|_| URL_SAFE_NO_PAD.decode(&clean))
                .map_err(|e| Error::Invalid(format!("Invalid Base64 input: {e}")))
        }
        _ => Err(Error::Invalid(format!("Unknown input encoding {encoding}"))),
    }
}

pub fn encode_output(bytes: &[u8], encoding: &str) -> Result<String, Error> {
    match encoding {
        "hex" => Ok(hex::encode(bytes)),
        "hex-upper" => Ok(hex::encode_upper(bytes)),
        "base64" => Ok(STANDARD.encode(bytes)),
        "base64url" => Ok(URL_SAFE_NO_PAD.encode(bytes)),
        "utf8" | "text" => Ok(String::from_utf8_lossy(bytes).into_owned()),
        _ => Err(Error::Invalid(format!("Unknown output encoding {encoding}"))),
    }
}

pub fn hash_digest(
    input: &str,
    input_encoding: &str,
    alg: &str,
    hmac_key: Option<&str>,
    key_encoding: &str,
    output_encoding: &str,
) -> Result<String, Error> {
    let data = decode_input(input, input_encoding)?;
    let bytes: Vec<u8> = if let Some(key_str) = hmac_key.filter(|k| !k.is_empty()) {
        let key = decode_input(key_str, key_encoding)?;
        match alg {
            "md5" => hmac_bytes::<Md5>(&key, &data)?,
            "sha1" => hmac_bytes::<Sha1>(&key, &data)?,
            "sha224" => hmac_bytes::<Sha224>(&key, &data)?,
            "sha256" => hmac_bytes::<Sha256>(&key, &data)?,
            "sha384" => hmac_bytes::<Sha384>(&key, &data)?,
            "sha512" => hmac_bytes::<Sha512>(&key, &data)?,
            "sm3" => hmac_bytes::<Sm3>(&key, &data)?,
            _ => return Err(Error::Invalid(format!("HMAC unsupported for {alg}"))),
        }
    } else {
        match alg {
            "md5" => Md5::digest(&data).to_vec(),
            "sha1" => Sha1::digest(&data).to_vec(),
            "sha224" => Sha224::digest(&data).to_vec(),
            "sha256" => Sha256::digest(&data).to_vec(),
            "sha384" => Sha384::digest(&data).to_vec(),
            "sha512" => Sha512::digest(&data).to_vec(),
            "sm3" => Sm3::digest(&data).to_vec(),
            "blake2s256" => Blake2s256::digest(&data).to_vec(),
            "blake2b512" => Blake2b512::digest(&data).to_vec(),
            "ripemd160" => Ripemd160::digest(&data).to_vec(),
            "keccak256" => {
                let mut h = Keccak::v256();
                let mut out = [0u8; 32];
                h.update(&data);
                h.finalize(&mut out);
                out.to_vec()
            }
            "crc32" => crc32fast::hash(&data).to_be_bytes().to_vec(),
            _ => return Err(Error::Invalid(format!("Unknown hash algorithm {alg}"))),
        }
    };
    encode_output(&bytes, output_encoding)
}

pub fn hash_bytes_all(data: &[u8]) -> Result<Value, Error> {
    const MAX_FILE_BYTES: usize = 12 * 1024 * 1024;
    if data.len() > MAX_FILE_BYTES {
        return Err(Error::Invalid("File exceeds 12 MiB verification limit".into()));
    }
    let crc = crc32fast::hash(data);
    let mut kec = Keccak::v256();
    let mut kec_out = [0u8; 32];
    kec.update(data);
    kec.finalize(&mut kec_out);
    Ok(serde_json::json!({
        "size": data.len(),
        "md5": hex::encode(Md5::digest(data)),
        "sha1": hex::encode(Sha1::digest(data)),
        "sha224": hex::encode(Sha224::digest(data)),
        "sha256": hex::encode(Sha256::digest(data)),
        "sha384": hex::encode(Sha384::digest(data)),
        "sha512": hex::encode(Sha512::digest(data)),
        "sm3": hex::encode(Sm3::digest(data)),
        "blake2s256": hex::encode(Blake2s256::digest(data)),
        "blake2b512": hex::encode(Blake2b512::digest(data)),
        "ripemd160": hex::encode(Ripemd160::digest(data)),
        "keccak256": hex::encode(kec_out),
        "crc32": format!("{crc:08x}"),
    }))
}

pub fn hash_file_base64(b64: &str) -> Result<Value, Error> {
    let bytes = decode_input(b64, "base64")?;
    hash_bytes_all(&bytes)
}

fn hmac_bytes<D>(key: &[u8], data: &[u8]) -> Result<Vec<u8>, Error>
where
    D: hmac::EagerHash,
{
    let mut mac = <Hmac<D> as HmacKeyInit>::new_from_slice(key).map_err(|e| Error::Invalid(format!("Invalid HMAC key: {e}")))?;
    mac.update(data);
    Ok(mac.finalize().into_bytes().to_vec())
}

pub fn symmetric_crypt(
    alg: &str,
    mode: &str,
    padding: &str,
    encrypt: bool,
    input: &str,
    input_enc: &str,
    key_str: &str,
    key_enc: &str,
    iv_str: &str,
    iv_enc: &str,
    output_enc: &str,
) -> Result<String, Error> {
    let data = decode_input(input, input_enc)?;
    let key = decode_input(key_str, key_enc)?;
    let iv = if iv_str.is_empty() { Vec::new() } else { decode_input(iv_str, iv_enc)? };

    let out = match alg {
        "xor" => {
            if key.is_empty() {
                return Err(Error::Invalid("XOR key cannot be empty".into()));
            }
            data.iter().enumerate().map(|(i, b)| b ^ key[i % key.len()]).collect()
        }
        "rc4" => {
            let mut cipher = Rc4::new_from_slice(&key).map_err(|_| Error::Invalid("RC4 key must be 1..=256 bytes".into()))?;
            let mut buf = data;
            cipher.apply_keystream(&mut buf);
            buf
        }
        "aes-128" => run_block_16::<Aes128>(mode, padding, encrypt, &data, &key, &iv, 16)?,
        "aes-192" => run_block_16::<Aes192>(mode, padding, encrypt, &data, &key, &iv, 24)?,
        "aes-256" => run_block_16::<Aes256>(mode, padding, encrypt, &data, &key, &iv, 32)?,
        "sm4" => run_block_16::<Sm4>(mode, padding, encrypt, &data, &key, &iv, 16)?,
        "des" => run_block_8::<Des>(mode, padding, encrypt, &data, &key, &iv, 8)?,
        "3des" => run_block_8::<TdesEde3>(mode, padding, encrypt, &data, &key, &iv, 24)?,
        _ => return Err(Error::Invalid(format!("Unsupported symmetric algorithm {alg}"))),
    };

    encode_output(&out, output_enc)
}

fn run_block_16<C>(
    mode: &str,
    padding: &str,
    encrypt: bool,
    data: &[u8],
    key: &[u8],
    iv: &[u8],
    expected_key_len: usize,
) -> Result<Vec<u8>, Error>
where
    C: cipher::BlockCipherEncrypt + cipher::BlockCipherDecrypt + cipher::BlockSizeUser<BlockSize = cipher::consts::U16> + CipherKeyInit + Clone,
{
    if key.len() != expected_key_len {
        return Err(Error::Invalid(format!("Key must be {expected_key_len} bytes (got {})", key.len())));
    }
    match mode {
        "cbc" => {
            if iv.len() != 16 {
                return Err(Error::Invalid(format!("CBC IV must be 16 bytes (got {})", iv.len())));
            }
            if encrypt {
                let enc = cbc::Encryptor::<C>::new_from_slices(key, iv).map_err(|e| Error::Invalid(e.to_string()))?;
                pad_encrypt(enc, padding, data, 16)
            } else {
                let dec = cbc::Decryptor::<C>::new_from_slices(key, iv).map_err(|e| Error::Invalid(e.to_string()))?;
                pad_decrypt(dec, padding, data)
            }
        }
        "ecb" => {
            if encrypt {
                let enc = ecb::Encryptor::<C>::new_from_slice(key).map_err(|e| Error::Invalid(e.to_string()))?;
                pad_encrypt(enc, padding, data, 16)
            } else {
                let dec = ecb::Decryptor::<C>::new_from_slice(key).map_err(|e| Error::Invalid(e.to_string()))?;
                pad_decrypt(dec, padding, data)
            }
        }
        "ctr" => {
            if iv.len() != 16 {
                return Err(Error::Invalid(format!("CTR IV/nonce must be 16 bytes (got {})", iv.len())));
            }
            let mut c = ctr::Ctr128BE::<C>::new_from_slices(key, iv).map_err(|e| Error::Invalid(e.to_string()))?;
            let mut buf = data.to_vec();
            c.apply_keystream(&mut buf);
            Ok(buf)
        }
        "gcm" => {
            if iv.len() != 12 {
                return Err(Error::Invalid(format!("GCM nonce must be 12 bytes (got {})", iv.len())));
            }
            let nonce = Nonce::<U12>::try_from(iv).map_err(|_| Error::Invalid("GCM nonce must be 12 bytes".into()))?;
            match expected_key_len {
                16 => {
                    // Handles both AES-128-GCM and SM4-GCM via generic AesGcm<C, U12>.
                    let cipher = AesGcm::<C, U12>::new_from_slice(key).map_err(|e| Error::Invalid(e.to_string()))?;
                    if encrypt {
                        cipher.encrypt(&nonce, data).map_err(|e| Error::Invalid(e.to_string()))
                    } else {
                        cipher.decrypt(&nonce, data).map_err(|_| Error::Invalid("GCM authentication failed".into()))
                    }
                }
                32 => {
                    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| Error::Invalid(e.to_string()))?;
                    if encrypt {
                        cipher.encrypt(&nonce, data).map_err(|e| Error::Invalid(e.to_string()))
                    } else {
                        cipher.decrypt(&nonce, data).map_err(|_| Error::Invalid("GCM authentication failed".into()))
                    }
                }
                _ => Err(Error::Invalid("GCM requires a 16-byte (AES-128 / SM4) or 32-byte (AES-256) key".into())),
            }
        }
        _ => Err(Error::Invalid(format!("Unsupported mode {mode}"))),
    }
}

fn run_block_8<C>(
    mode: &str,
    padding: &str,
    encrypt: bool,
    data: &[u8],
    key: &[u8],
    iv: &[u8],
    expected_key_len: usize,
) -> Result<Vec<u8>, Error>
where
    C: cipher::BlockCipherEncrypt + cipher::BlockCipherDecrypt + cipher::BlockSizeUser<BlockSize = cipher::consts::U8> + CipherKeyInit + Clone,
{
    if key.len() != expected_key_len {
        return Err(Error::Invalid(format!("Key must be {expected_key_len} bytes (got {})", key.len())));
    }
    match mode {
        "cbc" => {
            if iv.len() != 8 {
                return Err(Error::Invalid(format!("DES/3DES CBC IV must be 8 bytes (got {})", iv.len())));
            }
            if encrypt {
                let enc = cbc::Encryptor::<C>::new_from_slices(key, iv).map_err(|e| Error::Invalid(e.to_string()))?;
                pad_encrypt(enc, padding, data, 8)
            } else {
                let dec = cbc::Decryptor::<C>::new_from_slices(key, iv).map_err(|e| Error::Invalid(e.to_string()))?;
                pad_decrypt(dec, padding, data)
            }
        }
        "ecb" => {
            if encrypt {
                let enc = ecb::Encryptor::<C>::new_from_slice(key).map_err(|e| Error::Invalid(e.to_string()))?;
                pad_encrypt(enc, padding, data, 8)
            } else {
                let dec = ecb::Decryptor::<C>::new_from_slice(key).map_err(|e| Error::Invalid(e.to_string()))?;
                pad_decrypt(dec, padding, data)
            }
        }
        _ => Err(Error::Invalid(format!("DES/3DES only supports CBC and ECB modes (got {mode})"))),
    }
}

fn pad_encrypt<E: BlockModeEncrypt>(enc: E, padding: &str, data: &[u8], block_size: usize) -> Result<Vec<u8>, Error> {
    match padding {
        "pkcs7" => Ok(enc.encrypt_padded_vec::<Pkcs7>(data)),
        "zero" => Ok(enc.encrypt_padded_vec::<ZeroPadding>(data)),
        "nopadding" => {
            if data.is_empty() || data.len() % block_size != 0 {
                return Err(Error::Invalid(format!("Data length must be a non-empty multiple of {block_size} bytes for NoPadding")));
            }
            Ok(enc.encrypt_padded_vec::<NoPadding>(data))
        }
        _ => Err(Error::Invalid(format!("Unknown padding {padding}"))),
    }
}

fn pad_decrypt<D: BlockModeDecrypt>(dec: D, padding: &str, data: &[u8]) -> Result<Vec<u8>, Error> {
    match padding {
        "pkcs7" => dec.decrypt_padded_vec::<Pkcs7>(data).map_err(|_| Error::Invalid("PKCS7 decryption/unpadding failed".into())),
        "zero" => dec.decrypt_padded_vec::<ZeroPadding>(data).map_err(|_| Error::Invalid("ZeroPadding decryption failed".into())),
        "nopadding" => dec.decrypt_padded_vec::<NoPadding>(data).map_err(|_| Error::Invalid("NoPadding decryption failed".into())),
        _ => Err(Error::Invalid(format!("Unknown padding {padding}"))),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyPairResult {
    pub private_key: String,
    pub public_key: String,
    pub private_hex: Option<String>,
    pub public_hex: Option<String>,
}

pub fn rsa_keygen(bits: usize) -> Result<KeyPairResult, Error> {
    if !matches!(bits, 1024 | 2048) {
        return Err(Error::Invalid("RSA keygen supports 1024 or 2048 bits".into()));
    }
    let task = (bits >= 2048).then(|| host::begin_task("Generating RSA key pair", false));
    if let Some(t) = &task {
        t.report(0, None, Some("Generating primes..."));
    }
    let priv_key = RsaPrivateKey::new(&mut getrandom::SysRng, bits)
        .map_err(|e| Error::Failed(format!("RSA keygen failed: {e}")))?;
    let pub_key = priv_key.to_public_key();
    let priv_pem = priv_key.to_pkcs8_pem(LineEnding::LF).map_err(|e| Error::Failed(e.to_string()))?;
    let pub_pem = pub_key.to_public_key_pem(LineEnding::LF).map_err(|e| Error::Failed(e.to_string()))?;
    drop(task);
    Ok(KeyPairResult {
        private_key: priv_pem.to_string(),
        public_key: pub_pem,
        private_hex: None,
        public_hex: None,
    })
}

fn parse_rsa_pub(pem: &str) -> Result<RsaPublicKey, Error> {
    let p = pem.trim();
    RsaPublicKey::from_public_key_pem(p)
        .or_else(|_| RsaPublicKey::from_pkcs1_pem(p))
        .map_err(|e| Error::Invalid(format!("Invalid RSA public key PEM: {e}")))
}

fn parse_rsa_priv(pem: &str) -> Result<RsaPrivateKey, Error> {
    let p = pem.trim();
    RsaPrivateKey::from_pkcs8_pem(p)
        .or_else(|_| RsaPrivateKey::from_pkcs1_pem(p))
        .map_err(|e| Error::Invalid(format!("Invalid RSA private key PEM: {e}")))
}

pub fn rsa_encrypt(pub_pem: &str, plaintext: &str, padding: &str, out_enc: &str) -> Result<String, Error> {
    let pk = parse_rsa_pub(pub_pem)?;
    let ct = match padding {
        "oaep" => pk.oaep_encrypt::<Sha256>(plaintext.as_bytes()),
        _ => pk.pkcs1v15_encrypt(plaintext.as_bytes()),
    }
    .map_err(|e| Error::Invalid(format!("RSA encrypt failed: {e}")))?;
    encode_output(&ct, out_enc)
}

pub fn rsa_decrypt(priv_pem: &str, ciphertext: &str, in_enc: &str, padding: &str) -> Result<String, Error> {
    let sk = parse_rsa_priv(priv_pem)?;
    let ct = decode_input(ciphertext, in_enc)?;
    let pt = match padding {
        "oaep" => sk.oaep_decrypt::<Sha256>(&ct),
        _ => sk.pkcs1v15_decrypt(&ct),
    }
    .map_err(|e| Error::Invalid(format!("RSA decrypt failed: {e}")))?;
    Ok(String::from_utf8_lossy(&pt).into_owned())
}

pub fn rsa_sign(priv_pem: &str, message: &str, out_enc: &str) -> Result<String, Error> {
    let sk = parse_rsa_priv(priv_pem)?;
    let sig = sk.pkcs1v15_sign::<Sha256>(message.as_bytes()).map_err(|e| Error::Invalid(format!("RSA sign failed: {e}")))?;
    encode_output(&sig, out_enc)
}

pub fn rsa_verify(pub_pem: &str, message: &str, sig_str: &str, sig_enc: &str) -> Result<bool, Error> {
    let pk = parse_rsa_pub(pub_pem)?;
    let sig = decode_input(sig_str, sig_enc)?;
    Ok(pk.pkcs1v15_verify::<Sha256>(message.as_bytes(), &sig).is_ok())
}

pub fn sm2_keygen() -> Result<KeyPairResult, Error> {
    let sk = Sm2SecretKey::generate();
    let pk = sk.public_key();
    let priv_pem = sk.to_pkcs8_pem(LineEnding::LF).map_err(|e| Error::Failed(e.to_string()))?;
    let pub_pem = pk.to_public_key_pem(LineEnding::LF).map_err(|e| Error::Failed(e.to_string()))?;
    Ok(KeyPairResult {
        private_key: priv_pem.to_string(),
        public_key: pub_pem,
        private_hex: Some(hex::encode(sk.to_bytes())),
        public_hex: Some(hex::encode(pk.to_sec1_bytes())),
    })
}

fn parse_sm2_priv(input: &str) -> Result<Sm2SecretKey, Error> {
    let s = input.trim();
    if s.contains("BEGIN ") {
        Sm2SecretKey::from_pkcs8_pem(s).map_err(|e| Error::Invalid(format!("Invalid SM2 private PEM: {e}")))
    } else {
        let clean: String = s.chars().filter(|c| !c.is_whitespace()).collect();
        let bytes = hex::decode(clean).map_err(|e| Error::Invalid(format!("Invalid SM2 private hex: {e}")))?;
        Sm2SecretKey::from_slice(&bytes).map_err(|e| Error::Invalid(format!("Invalid SM2 scalar: {e}")))
    }
}

fn parse_sm2_pub(input: &str) -> Result<Sm2PublicKey, Error> {
    let s = input.trim();
    if s.contains("BEGIN ") {
        Sm2PublicKey::from_public_key_pem(s).map_err(|e| Error::Invalid(format!("Invalid SM2 public PEM: {e}")))
    } else {
        let clean: String = s.chars().filter(|c| !c.is_whitespace()).collect();
        let bytes = hex::decode(clean).map_err(|e| Error::Invalid(format!("Invalid SM2 public hex: {e}")))?;
        let sec1 = if bytes.len() == 64 {
            let mut prefixed = Vec::with_capacity(65);
            prefixed.push(0x04);
            prefixed.extend_from_slice(&bytes);
            prefixed
        } else {
            bytes
        };
        Sm2PublicKey::from_sec1_bytes(&sec1).map_err(|e| Error::Invalid(format!("Invalid SM2 public key: {e}")))
    }
}

fn sm2_mode(mode: &str) -> Sm2Mode {
    if mode.eq_ignore_ascii_case("C1C2C3") { Sm2Mode::C1C2C3 } else { Sm2Mode::C1C3C2 }
}

pub fn sm2_encrypt(pub_key: &str, plaintext: &str, mode: &str, out_enc: &str) -> Result<String, Error> {
    let pk = parse_sm2_pub(pub_key)?;
    let enc = EncryptingKey::new_with_mode(pk, sm2_mode(mode));
    let mut rng = sm2::elliptic_curve::common::getrandom::SysRng;
    let ct = enc.encrypt(&mut rng, plaintext.as_bytes()).map_err(|_| Error::Failed("SM2 encryption failed".into()))?;
    encode_output(&ct, out_enc)
}

pub fn sm2_decrypt(priv_key: &str, ciphertext: &str, in_enc: &str, mode: &str) -> Result<String, Error> {
    let sk = parse_sm2_priv(priv_key)?;
    let ct = decode_input(ciphertext, in_enc)?;
    let dec = Sm2DecKey::new_with_mode(sk.to_nonzero_scalar(), sm2_mode(mode));
    let pt = dec.decrypt(&ct).map_err(|_| Error::Invalid("SM2 decryption failed (check key, mode, or ciphertext)".into()))?;
    Ok(String::from_utf8_lossy(&pt).into_owned())
}

pub fn sm2_sign(priv_key: &str, message: &str, distid: &str, out_enc: &str) -> Result<String, Error> {
    let sk = parse_sm2_priv(priv_key)?;
    let id = if distid.is_empty() { "1234567812345678" } else { distid };
    let signing = Sm2SigningKey::new(id, &sk).map_err(|e| Error::Invalid(format!("SM2 signing key init failed: {e}")))?;
    use sm2::dsa::signature::Signer;
    let sig: Sm2Sig = signing.sign(message.as_bytes());
    encode_output(&sig.to_bytes(), out_enc)
}

pub fn sm2_verify(pub_key: &str, message: &str, distid: &str, sig_str: &str, sig_enc: &str) -> Result<bool, Error> {
    let pk = parse_sm2_pub(pub_key)?;
    let id = if distid.is_empty() { "1234567812345678" } else { distid };
    let verifying = Sm2VerifyingKey::new(id, pk).map_err(|e| Error::Invalid(format!("SM2 verifying key failed: {e}")))?;
    let bytes = decode_input(sig_str, sig_enc)?;
    let sig = Sm2Sig::from_slice(&bytes).map_err(|_| Error::Invalid("SM2 signature must be 64 bytes (r||s)".into()))?;
    use sm2::dsa::signature::Verifier;
    Ok(verifying.verify(message.as_bytes(), &sig).is_ok())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JwtDecoded {
    pub header: Value,
    pub payload: Value,
    pub signature: String,
    pub alg: Option<String>,
    pub exp_status: Option<String>,
}

pub fn jwt_decode(token: &str) -> Result<JwtDecoded, Error> {
    let parts: Vec<&str> = token.trim().split('.').collect();
    if parts.len() != 3 {
        return Err(Error::Invalid("JWT must have 3 dot-separated parts".into()));
    }
    let hdr_bytes = URL_SAFE_NO_PAD.decode(parts[0]).or_else(|_| URL_SAFE.decode(parts[0])).map_err(|e| Error::Invalid(format!("Invalid JWT header base64: {e}")))?;
    let pay_bytes = URL_SAFE_NO_PAD.decode(parts[1]).or_else(|_| URL_SAFE.decode(parts[1])).map_err(|e| Error::Invalid(format!("Invalid JWT payload base64: {e}")))?;
    let header: Value = serde_json::from_slice(&hdr_bytes).map_err(|e| Error::Invalid(format!("Invalid JWT header JSON: {e}")))?;
    let payload: Value = serde_json::from_slice(&pay_bytes).map_err(|e| Error::Invalid(format!("Invalid JWT payload JSON: {e}")))?;
    let alg = header.get("alg").and_then(Value::as_str).map(str::to_owned);
    let now = chrono::Utc::now().timestamp();
    let exp_status = payload.get("exp").and_then(Value::as_i64).map(|exp| {
        if exp < now { format!("Expired {}s ago", now - exp) } else { format!("Valid ({}s remaining)", exp - now) }
    });
    Ok(JwtDecoded {
        header,
        payload,
        signature: parts[2].to_owned(),
        alg,
        exp_status,
    })
}

pub fn jwt_sign(header_json: &str, payload_json: &str, alg: &str, secret_or_pem: &str) -> Result<String, Error> {
    let mut header: Value = serde_json::from_str(header_json).map_err(|e| Error::Invalid(format!("Invalid header JSON: {e}")))?;
    let payload: Value = serde_json::from_str(payload_json).map_err(|e| Error::Invalid(format!("Invalid payload JSON: {e}")))?;
    if let Some(obj) = header.as_object_mut() {
        obj.insert("alg".into(), Value::String(alg.to_owned()));
        obj.entry("typ").or_insert_with(|| Value::String("JWT".into()));
    }
    let h_b64 = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&header).map_err(|e| Error::Invalid(e.to_string()))?);
    let p_b64 = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).map_err(|e| Error::Invalid(e.to_string()))?);
    let signing_input = format!("{h_b64}.{p_b64}");
    let sig_bytes = match alg {
        "HS256" => hmac_bytes::<Sha256>(secret_or_pem.as_bytes(), signing_input.as_bytes())?,
        "HS384" => hmac_bytes::<Sha384>(secret_or_pem.as_bytes(), signing_input.as_bytes())?,
        "HS512" => hmac_bytes::<Sha512>(secret_or_pem.as_bytes(), signing_input.as_bytes())?,
        "RS256" => {
            let sk = parse_rsa_priv(secret_or_pem)?;
            sk.pkcs1v15_sign::<Sha256>(signing_input.as_bytes()).map_err(|e| Error::Invalid(e.to_string()))?
        }
        "none" => Vec::new(),
        _ => return Err(Error::Invalid(format!("Unsupported JWT algorithm {alg}"))),
    };
    let s_b64 = URL_SAFE_NO_PAD.encode(&sig_bytes);
    Ok(format!("{signing_input}.{s_b64}"))
}

pub fn jwt_verify(token: &str, secret_or_pem: &str) -> Result<bool, Error> {
    let decoded = jwt_decode(token)?;
    let parts: Vec<&str> = token.trim().split('.').collect();
    let signing_input = format!("{}.{}", parts[0], parts[1]);
    let sig_bytes = URL_SAFE_NO_PAD.decode(parts[2]).or_else(|_| URL_SAFE.decode(parts[2])).map_err(|e| Error::Invalid(format!("Invalid JWT signature base64: {e}")))?;
    match decoded.alg.as_deref() {
        Some("HS256") => Ok(hmac_bytes::<Sha256>(secret_or_pem.as_bytes(), signing_input.as_bytes())? == sig_bytes),
        Some("HS384") => Ok(hmac_bytes::<Sha384>(secret_or_pem.as_bytes(), signing_input.as_bytes())? == sig_bytes),
        Some("HS512") => Ok(hmac_bytes::<Sha512>(secret_or_pem.as_bytes(), signing_input.as_bytes())? == sig_bytes),
        Some("RS256") => {
            let pk = parse_rsa_pub(secret_or_pem)?;
            Ok(pk.pkcs1v15_verify::<Sha256>(signing_input.as_bytes(), &sig_bytes).is_ok())
        }
        Some(other) => Err(Error::Invalid(format!("Verification unsupported for JWT alg {other}"))),
        None => Err(Error::Invalid("JWT header missing alg".into())),
    }
}
