# Toolset for OpenIDEA (v0.4.0)

An all-in-one, **43-tool** developer toolbox for [OpenIDEA](https://github.com/l0ng-ai/openidea), aligned with JetBrains IntelliJ Toolset (`#14384`). It features a collapsible toolset sidebar docked in the **Right Bottom** (`secondary = true`), native English / Simplified Chinese UI (auto-synced with OpenIDEA's locale or switched independently), editor selection integration, native Diff viewer tabs, Search Everywhere registration, status bar toggle, and multi-tab workspace persistence.

## Features (43 Tools across 7 Categories)

- **String & Text (5)**:
  - *String & Line Manipulation*: 12 case styles (`camelCase`, `PascalCase`, `snake_case`, `SCREAMING_SNAKE_CASE`, `kebab-case`, `dot.case`, `Space Case`, `slug-case`, `Title Case`, `UPPER`, `lower`, `tOGGLE`), quote wrap/unwrap/swap, multi-line command merge/split (`\`, `&&`, `;`), line sort/natural-sort/dedupe/freq/trim/grep/invert-grep/prefix/suffix/swap-delim/align-cols/number/inc/dec, text statistics.
  - *Escape / Unescape*: Java, JS, JSON, XML, HTML, SQL, PHP, Unicode.
  - *Regex Tester*: Linear-time regex engine, 21 built-in presets, persisted history, capture groups, match extractor (lines / JSON), syntax reference, replacement preview.
  - *Custom Regex Rules*: Reusable saved regex find/replace macros bound to `Alt+Shift+R` / `Meta+Shift+R`, Search Everywhere, and editor right-click menu.
  - *Text Diff*: Multi-tab inline diff viewer + one-click OpenIDEA native Diff view.
- **Format & SQL (7)**:
  - *JSON Toolkit*: Format, minify, key-sort (preserving `__proto__`), relaxed **JSON Repair**, **Flatten / Unflatten**, semantic **JSON Diff**, interactive tree view, JSONPath query, JSON Schema Draft-07 generator.
  - *Format Converter*: Bidirectional JSON, YAML, TOML, XML, Properties, QueryString.
  - *CSV / Table Converter*: Parse & preview CSV/TSV/JSON tables, custom delimiter, header toggle, transpose rows/columns, export JSON, Markdown, SQL `INSERT`, HTML table, and UTF-8 BOM CSV for Excel.
  - *SQL / XML / HTML / CSS Formatter*: Pretty-print & minify.
  - *JSON → POJO / Struct*: Java POJO/Lombok/Record, TypeScript, Go, Rust.
  - *SQL Toolkit*: Interactive SQL Joins Venn diagram (8 join types), `CREATE TABLE` DDL → JSON/Markdown/Java POJO/Record/TS/Go/Rust, Qualifier & identifier quote stripper, JDBC/MyBatis `?` parameter binder, SQL format/minify.
  - *Markup Converter*: Bidirectional Markdown ↔ HTML ↔ BBCode ↔ AsciiDoc with sanitized HTML live preview.
- **Convert & Calc (9)**:
  - *Timestamp & DateTime*, *Encoders & Decoders* (Base64, Base64URL, **Base32**, **Base58**, **Base85/ASCII85**, **Binary 8-bit**, URL, Hex, HTML, Unicode, Punycode, ROT13), *Radix & Byte Units* (BigInt bases, Byte..EiB, network bandwidth), *Path Converter* (Windows / POSIX / Git Bash / WSL / `file://` URI / Escaped + batch lines), *Full-Width / RMB Capitals / Roman / Morse Converter*, *Decimal & Expression Calculator* (exact `i128` 10¹² decimal precision `0.1 + 0.2 == 0.3`, scientific functions, `0x`/`0b`/`0o` & bitwise), *IP & CIDR Calculator*, *Color & WCAG Contrast*, *Image Format Converter & Base64*.
- **Crypto & Web3 (8)**:
  - *Hash & HMAC* (MD5, SHA-1/224/256/384/512, **BLAKE2s-256**, **BLAKE2b-512**, **Keccak-256**, **RIPEMD-160**, SM3, CRC32), *Symmetric Encryption* (AES/DES/3DES/RC4/SM4/XOR in CBC/ECB/CTR/GCM), *RSA & SM2 Asymmetric*, *JWT Inspector & Signer*, *TOTP / HOTP 2FA & Base32* (RFC 6238/4226 countdown codes, HOTP counter, random Base32 secret, `otpauth://` parser & QR code), *X.509 / PEM Certificate Inspector* (offline ASN.1 DER/PEM parser, Subject/Issuer, SANs, validity countdown, SHA-256/SHA-1 fingerprints), *File Checksum & Verification* (local multi-algorithm digest, expected auto-match, dual-file comparison), *Blockchain & HD Wallet (Offline)* (BIP-39 mnemonic, BIP-32/44 derivation for ETH/BTC SegWit/BTC Legacy/Tron/Solana/Sui, EIP-191 & Ed25519 sign/verify, token units).
- **Generators (7)**:
  - *ID Generator & Decoder* (UUID v1/v4/v7, ULID, NanoID, Snowflake, ObjectId), *Password & Secret Generator*, *Cron Parser & Schedule*, *QR Code Generator & Offline Scanner*, *1D Barcode Generator* (Code 128, Code 39, EAN-13, EAN-8, UPC-A, ITF, Codabar; batch mode & SVG/PNG export), *Offline Mock Data Generator* (16 field types, EN/ZH presets, 1–500 rows to JSON/CSV/SQL/Markdown), *ASCII Art / FIGlet* (10 fonts + code comment wrappers).
- **Network & Hosts (4)**:
  - *HTTP Client & cURL*: Multi-tab request builder, URL/query param two-way sync, Auth/Headers/Body, cURL importer, cURL/`fetch()`/HTTPie/`.http` exporter, and live HTTPS/loopback requests via opt-in `net:ask` (`Meta+Shift+H` / `Alt+Shift+H`).
  - *WebSocket Client*: Host-managed `ws://` / `wss://` debugger (`Alt+Shift+W` / `Cmd+Shift+W`) with custom handshake headers, subprotocol, periodic heartbeat auto-send, Text/JSON/Hex frames, and filterable message log.
  - *URL Parser & Query Builder*: Structured protocol, auth, host, port, path segments, hash, and interactive Query parameter editor/encoder.
  - *Hosts Profile Manager*: SwitchHosts-style multi-profile toggling, IPv4/IPv6 & hostname validation, conflict detection, and merged `hosts` export.
- **Productivity & Reference (3)**:
  - *Scratch Notes*, *Pomodoro Timer* (status bar synced), *Developer Cheatsheets* (Git, Docker, K8s, Linux, SQL, JVM, OpenSSL/Net, HTTP Status, MIME, Regex, Cron, ASCII + interactive Chmod Calculator).

## Permissions (Zero High-Risk Grants)

| Capability | Kind | Purpose |
| --- | --- | --- |
| `editor.read` | required (low) | Read focused editor text or selection when importing into tools. |
| `editor.write` | required (medium) | Apply multi-cursor text transforms back to the editor as one undoable edit. |
| `clipboard` | required (medium) | Copy results and read/write clipboard in web views. |
| `storage` | required (low) | Persist tabs, favorites, history, notes, regex rules/history, hosts profiles, Pomodoro state, and language preference. |
| `events` | required (low) | Observe `websocket-ready` events for the WebSocket Client and `settings-changed` for live settings/locale synchronization. |
| `clipboard.read` | optional (medium) | Power "Format Clipboard JSON" and "Decode Clipboard QR Code" commands. |
| `net:ask` | optional (medium) | Prompt per HTTPS / WSS / loopback host when using the HTTP Client or WebSocket Client. |

Toolset requests **no** `net.http:*`, `process:*`, `fs.read:*`, `fs.write:*`, `project.*`, or `ide.commands` permissions. Direct `/etc/hosts` root editing and local TCP listen/tunnel servers are intentionally excluded to stay strictly sandboxed with zero high-risk permissions.

## Building & Validating

```sh
cd web-src && pnpm install && pnpm test && pnpm build && cd ..
cargo test
cargo build --release --target wasm32-wasip2
cp target/wasm32-wasip2/release/openidea_toolset.wasm dist/plugin.wasm
openidea-plugin check .
openidea-plugin link .
```
