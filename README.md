# Toolset for OpenIDEA (v0.6.3)

An all-in-one, **55-tool** developer toolbox for [OpenIDEA](https://github.com/l0ng-ai/openidea), aligned with JetBrains IntelliJ Toolset (`#14384`). It features a collapsible toolset sidebar docked in the **Right Bottom** (`secondary = true`), native English / Simplified Chinese UI (auto-synced with OpenIDEA's locale or switched independently), editor selection integration, native Diff viewer tabs, Search Everywhere registration, status bar toggle, and multi-tab workspace persistence.

## Features (55 Tools across 7 Categories)

- **String & Text (8)**:
  - *String & Line Manipulation*: 12 case styles (`camelCase`, `PascalCase`, `snake_case`, `SCREAMING_SNAKE_CASE`, `kebab-case`, `dot.case`, `Space Case`, `slug-case`, `Title Case`, `UPPER`, `lower`, `tOGGLE`), quote wrap/unwrap/swap, multi-line command merge/split (`\`, `&&`, `;`), line sort/natural-sort/shuffle/dedupe/duplicates-only/freq/trim/grep/invert-grep/prefix/suffix/swap-delim/swap-words/reverse-words/align-cols/extract-column/wrap-lines/number/inc/dec, text statistics.
  - *Escape / Unescape*: Java, JS, JSON, XML, HTML, SQL, PHP, Unicode.
  - *Regex Tester & Diagram*: Linear-time regex engine, **Regulex-style Railroad Diagram SVG** + Export/Copy, bilingual AST explainer, 21 built-in presets, persisted history, capture groups, match extractor (lines / JSON), syntax reference, replacement preview.
  - *Custom Regex Rules*: Reusable saved regex find/replace macros bound to `Alt+Shift+R` / `Meta+Shift+R`, Search Everywhere, and editor right-click menu.
  - *Batch Template & Row Expander*: Expand CSV/TSV/custom-delimiter rows or JSON arrays via `{{1}}`, `{{colName}}`, `{{index1}}` and pipe filters (`trim`, `upper`, `lower`, `camel`, `snake`, `screaming`, `quote`, `dquote`, `json`, `url`, `b64`, `pad2`/`pad4`).
  - *Stack Trace & Structured Log Analyzer*: Unescape `\n`/`\t` escaped exception traces, fold Java/JS/Python/Go/Rust frames by app package prefix, and filter NDJSON logs by level.
  - *Glob & .gitignore Pattern Matcher*: Simulate `.gitignore` precedence (`!negation`, `/` dir-only, `**`) and single glob rules against file paths.
  - *Text Diff*: Multi-tab inline diff viewer + one-click OpenIDEA native Diff view.
- **Format & SQL (10)**:
  - *JSON Toolkit*: Format, minify, key-sort (preserving `__proto__`), relaxed **JSON Repair**, **Flatten / Unflatten**, semantic **JSON Diff**, interactive tree view with **inline length/count hints, Expand/Collapse All, search filter & click-to-copy JSONPath**, JSONPath query, JSON Schema Draft-07 generator.
  - *Format Converter*: Bidirectional JSON, YAML, TOML, XML, Properties, QueryString.
  - *.env / Properties / YAML Config Diff*: Convert `.env` ↔ `.properties` ↔ YAML ↔ JSON (with Spring relaxed key mapping) & memory-only environment diff with sensitive-key masking.
  - *XPath & CSS Selector Tester*: Pure-Rust (`quick-xml`) offline XPath (`//tag`, `[@attr='v']`, `[last()]`, `count()`, `string()`, `contains()`, unions `|`, `/text()`, `/@attr`) and CSS selector (`tag`, `.class`, `#id`, `>`, `+`, `~`, `[attr*=v]`, `:first-child`, `:nth-child()`) evaluator with tolerant HTML mode.
  - *Protobuf Wire & Varint Decoder*: Schema-less offline Protobuf/gRPC wire hex/base64 decoder, nested sub-messages & Varint/ZigZag encoder/decoder.
  - *CSV / Table Converter*: Parse & preview CSV/TSV/JSON tables, custom delimiter, header toggle, transpose rows/columns, export JSON, Markdown, SQL `INSERT`, HTML table, and UTF-8 BOM CSV for Excel.
  - *SQL / XML / HTML / CSS Formatter*: Lexical pretty-print & minify preserving literals and comments.
  - *JSON → POJO / Struct*: Java POJO/Lombok/Record, TypeScript, Go, Rust.
  - *SQL Toolkit*: Interactive SQL Joins Venn diagram (8 join types), `CREATE TABLE` DDL → JSON/Markdown/Java POJO/Record/TS/Go/Rust, Qualifier & identifier quote stripper, JDBC/MyBatis `?` parameter binder, SQL format/minify.
  - *Markup Converter*: Bidirectional Markdown ↔ HTML ↔ BBCode ↔ AsciiDoc with sanitized HTML live preview.
- **Convert & Calc (12)**:
  - *Timestamp & DateTime*, *Encoders & Decoders* (Base64, Base64URL, **Base32**, **Base58**, **Base85/ASCII85**, **Binary 8-bit**, URL, Hex, HTML, Unicode, Punycode, ROT13), *Radix & Byte Units* (BigInt bases, Byte..EiB, network bandwidth), *Path Converter* (Windows / POSIX / Git Bash / WSL / `file://` URI / Escaped + batch lines), *Full-Width / RMB Capitals / Roman / Morse Converter*, *Unit & CSS Converter* (`px`/`rem`/`em`/`vw`/`vh`/`%`, Duration/TTL breakdown, Length, Mass, Temperature, Area, Volume, Angle), *Hex Viewer & Binary Inspector* (16-byte Hex/ASCII dump, LE/BE `Int8..Int64` & `Float32/64` inspector, local file preview, C/Rust/Go/Python array export), *Decimal & Expression Calculator*, *IP & CIDR Calculator*, *Color & WCAG Contrast*, *Image Format Converter & Base64* (drag & drop PNG/JPEG/WebP/SVG, SVG Data URL/CSS, locked-aspect resize & zoom preview), *SVG Optimizer & JSX/CSS Studio* (lexical SVG minify/format, Light/Dark/Grid zoom preview, React TSX converter & 1x/2x/3x PNG export).
- **Crypto & Web3 (8)**:
  - *Hash & HMAC* (MD5, SHA-1/224/256/384/512, **BLAKE2s-256**, **BLAKE2b-512**, **Keccak-256**, **RIPEMD-160**, SM3, CRC32), *Symmetric Encryption* (AES/DES/3DES/RC4/SM4/XOR in CBC/ECB/CTR/GCM), *RSA & SM2 Asymmetric*, *JWT Inspector & Signer*, *TOTP / HOTP 2FA & Base32*, *X.509 / PEM Certificate Inspector*, *File Checksum & Verification*, *Blockchain Wallet, ABI & RPC* (offline BIP-39/44 wallet, EIP-191/Ed25519 sign/verify, EVM ABI selector/calldata encoder & live JSON-RPC API Explorer via opt-in `net:ask`).
- **Generators (7)**:
  - *ID Generator & Decoder* (UUID v1/v4/v7, ULID, NanoID, Snowflake, ObjectId), *Password & Secret Generator*, *Cron Parser & Schedule*, *QR Code Generator & Scanner* (SVG/PNG/Data URL with size control, scroll preview & drag-and-drop scanner), *1D Barcode Generator*, *Offline Mock Data Generator*, *ASCII Art / FIGlet* (10 fonts + code comment wrappers).
- **Network & Hosts (5)**:
  - *HTTP Client & cURL*, *WebSocket Client*, *URL Parser & Query Builder*, *UA & HTTP Header Security Inspector* (offline User-Agent parser, `Cache-Control`/`CSP`/`Set-Cookie` explainer & security header audit kept strictly in memory), *Hosts Profile Manager*.
- **Productivity & Reference (5)**:
  - *Scratch Notes*, *Pomodoro Timer* (status bar synced), *Developer Cheatsheets* (**27 bilingual command categories / 270+ commands** with global search & category filter, HTTP status codes, ASCII & Chmod calculator), *Symbols, Emojis & Unicode Inspector* (Git commits, arrows, math, box drawing, currency + UTF-8/UTF-16/HTML/JS/Rust codepoint inspector), *SemVer & Version Range Comparator* (SemVer 2.0.0 parser/bumper/sorter + NPM/Cargo & Maven range matcher).

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

Toolset requests **no** `net.http:*`, `process:*`, `fs.read:*`, `fs.write:*`, `project.*`, or `ide.commands` permissions. Direct `/etc/hosts` root editing and local TCP listen/tunnel servers are intentionally excluded to stay strictly sandboxed with zero high-risk permissions. Wallet mnemonics, BIP-39 passphrases, private keys, TOTP/JWT/symmetric/HMAC secrets, URL passwords, raw `.env`/config files, raw HTTP headers/`Set-Cookie` payloads, and sensitive auth headers (`Authorization`, `Cookie`, `X-API-Key`, etc.) remain in memory only and are never written to plugin storage (and any previously saved fields from earlier versions are scrubbed on startup).

## Building & Validating

```sh
cd web-src && pnpm install && pnpm test && pnpm build && cd ..
cargo test
cargo build --release --target wasm32-wasip2
cp target/wasm32-wasip2/release/openidea_toolset.wasm dist/plugin.wasm
openidea-plugin check .
openidea-plugin link .
```
