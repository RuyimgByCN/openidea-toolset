use serde::Serialize;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolMeta {
    pub id: &'static str,
    pub category: &'static str,
    pub title_en: &'static str,
    pub title_zh: &'static str,
    pub desc_en: &'static str,
    pub desc_zh: &'static str,
    pub aliases: &'static [&'static str],
}

pub const TOOLS: &[ToolMeta] = &[
    // --- String & Text (5) ---
    ToolMeta {
        id: "string-case",
        category: "string",
        title_en: "String & Line Manipulation",
        title_zh: "字符串与行处理",
        desc_en: "Case styles, quotes wrap/swap, multi-line cmd merge, sort/shuffle/dupes/column/wrap, stats",
        desc_zh: "命名风格互转、引号包裹/切换、多行命令合并、行排序/打乱/重复行/提取列/自动折行、字数统计",
        aliases: &["case", "camel", "snake", "pascal", "kebab", "sort", "lines", "string", "word", "merge", "shuffle", "column"],
    },
    ToolMeta {
        id: "escape",
        category: "string",
        title_en: "Escape / Unescape",
        title_zh: "多语言转义 / 反转义",
        desc_en: "Escape & unescape Java, JS, JSON, XML, HTML, SQL, PHP, Unicode",
        desc_zh: "支持 Java、JS、JSON、XML、HTML、SQL、PHP、Unicode 转义与反转义",
        aliases: &["escape", "unescape", "unicode", "java", "sql", "xml", "html", "json", "php"],
    },
    ToolMeta {
        id: "regex-tester",
        category: "string",
        title_en: "Regex Tester & Diagram",
        title_zh: "正则表达式测试与轨道图",
        desc_en: "Linear-time regex tester, Regulex railroad diagram SVG, EN/ZH explainer, 21 presets & extractor",
        desc_zh: "线性时间正则匹配、Regulex 可视化轨道图 (SVG)、中英结构解析、21 个预设与提取器",
        aliases: &["regex", "regexp", "match", "capture", "replace", "preset", "zhengze", "railroad", "diagram", "explain", "visualizer"],
    },
    ToolMeta {
        id: "regex-rules",
        category: "string",
        title_en: "Custom Regex Rules",
        title_zh: "自定义正则替换规则",
        desc_en: "Saved reusable regex find/replace rules for the editor & search",
        desc_zh: "保存常用正则查找替换规则，支持快捷键与编辑器右键一键应用",
        aliases: &["rule", "regex", "replace", "macro", "transform"],
    },
    ToolMeta {
        id: "text-diff",
        category: "string",
        title_en: "Text Diff",
        title_zh: "文本比对 (Diff)",
        desc_en: "Compare two texts inline or open directly in OpenIDEA native Diff viewer",
        desc_zh: "双栏文本对比，并支持一键打开 OpenIDEA 原生 Diff 编辑器",
        aliases: &["diff", "compare", "merge", "duibi"],
    },
    // --- Format & Parse (4) ---
    ToolMeta {
        id: "json-tools",
        category: "format",
        title_en: "JSON Toolkit",
        title_zh: "JSON 工具箱",
        desc_en: "Format, minify, repair, flatten, diff, tree with count hints/search/copy-JSONPath & Schema",
        desc_zh: "格式化、压缩、容错修复、扁平化、语义对比、带计数/搜索/复制路径的树视图与 Schema",
        aliases: &["json", "jsonpath", "schema", "tree", "minify", "format"],
    },
    ToolMeta {
        id: "format-convert",
        category: "format",
        title_en: "Format Converter",
        title_zh: "数据格式互转",
        desc_en: "Convert between JSON, YAML, TOML, XML, Properties, and QueryString",
        desc_zh: "JSON、YAML、TOML、XML、Properties 与 QueryString 双向互转",
        aliases: &["yaml", "toml", "xml", "properties", "querystring", "convert", "json"],
    },
    ToolMeta {
        id: "code-format",
        category: "format",
        title_en: "SQL / XML / HTML / CSS Formatter",
        title_zh: "SQL / XML / HTML / CSS 格式化",
        desc_en: "Pretty-print and minify SQL, XML, HTML, and CSS snippets",
        desc_zh: "美化或压缩 SQL、XML、HTML 与 CSS 代码片段",
        aliases: &["sql", "xml", "html", "css", "format", "minify", "beautify"],
    },
    ToolMeta {
        id: "pojo-gen",
        category: "format",
        title_en: "JSON → POJO / Struct",
        title_zh: "JSON 生成实体类",
        desc_en: "Generate Java POJO/Lombok/Record, TypeScript interface, Go & Rust structs",
        desc_zh: "从 JSON 生成 Java POJO/Lombok/Record、TypeScript、Go、Rust 结构体",
        aliases: &["pojo", "java", "lombok", "record", "typescript", "go", "rust", "struct", "dto"],
    },
    ToolMeta {
        id: "sql-toolkit",
        category: "format",
        title_en: "SQL Toolkit",
        title_zh: "SQL 工具箱",
        desc_en: "SQL Joins Venn diagram, CREATE TABLE DDL → JSON/MD/POJO/Struct, qualifier stripper & ? binder",
        desc_zh: "SQL Joins 维恩图、DDL 建表转 JSON/Markdown/实体类、限定符清理与 ? 参数绑定",
        aliases: &["sql", "ddl", "join", "joins", "venn", "mybatis", "binder", "table"],
    },
    ToolMeta {
        id: "markup-convert",
        category: "format",
        title_en: "Markup Converter",
        title_zh: "文档格式互转 (Markdown)",
        desc_en: "Bidirectional Markdown ↔ HTML ↔ BBCode ↔ AsciiDoc converter with safe live preview",
        desc_zh: "Markdown、HTML、BBCode 与 AsciiDoc 双向互转与安全实时预览",
        aliases: &["markdown", "md", "html", "bbcode", "asciidoc", "adoc", "markup", "wendang"],
    },
    // --- Encode & Convert (6) ---
    ToolMeta {
        id: "timestamp",
        category: "convert",
        title_en: "Timestamp & DateTime",
        title_zh: "时间戳与日期时间",
        desc_en: "Live clock, Unix s/ms/us/ns converter, timezones, custom patterns & offsets",
        desc_zh: "实时时钟、秒/毫秒/微秒/纳秒互转、多时区、自定义格式与时间加减",
        aliases: &["ts", "timestamp", "unix", "date", "time", "timezone", "shijianchuo"],
    },
    ToolMeta {
        id: "codec",
        category: "convert",
        title_en: "Encoders & Decoders",
        title_zh: "通用编解码",
        desc_en: "Base64 / Base64URL, URL, Hex, HTML, Unicode, Punycode, ROT13",
        desc_zh: "Base64 / URLSafe、URL、Hex、HTML 实体、Unicode、Punycode、ROT13",
        aliases: &["base64", "b64", "url", "hex", "html", "unicode", "punycode", "rot13"],
    },
    ToolMeta {
        id: "radix-bytes",
        category: "convert",
        title_en: "Radix & Byte Units",
        title_zh: "进制与存储单位换算",
        desc_en: "BigInt base 2/8/10/16/36, Byte..EiB unit converter & network throughput calculator",
        desc_zh: "大数 2/8/10/16/36 进制互转、Byte..EiB 存储单位与网络带宽换算",
        aliases: &["radix", "binary", "hex", "octal", "decimal", "bytes", "kb", "mb", "gb", "pb", "bandwidth"],
    },
    ToolMeta {
        id: "path-convert",
        category: "convert",
        title_en: "Path Converter",
        title_zh: "文件路径格式转换",
        desc_en: "Convert Windows, POSIX/Linux, Git Bash, WSL, file:// URI, escaped paths & batch lines",
        desc_zh: "Windows、Linux/POSIX、Git Bash、WSL、file:// URI 与转义路径互转，支持批量转换",
        aliases: &["path", "windows", "linux", "posix", "wsl", "uri", "slash", "lujing"],
    },
    ToolMeta {
        id: "calculator",
        category: "convert",
        title_en: "Decimal & Expression Calculator",
        title_zh: "高精度表达式计算器",
        desc_en: "Exact decimal arithmetic, scientific functions, 0x/0b/0o literals & bitwise calculator",
        desc_zh: "无浮点误差十进制计算、科学函数、0x/0b/0o 与位运算高精度表达式求值",
        aliases: &["calc", "calculator", "decimal", "math", "eval", "bitwise", "expression", "jisuan"],
    },
    ToolMeta {
        id: "ip-cidr",
        category: "convert",
        title_en: "IP & CIDR Calculator",
        title_zh: "IP 与 CIDR 子网计算",
        desc_en: "IPv4 integer/hex/binary conversion, IPv6 expand/compress, CIDR subnetting",
        desc_zh: "IPv4 整数/二进制互转、IPv6 压缩展开、CIDR 掩码与可用主机范围计算",
        aliases: &["ip", "ipv4", "ipv6", "cidr", "subnet", "netmask"],
    },
    ToolMeta {
        id: "color",
        category: "convert",
        title_en: "Color & Contrast",
        title_zh: "颜色转换与对比度",
        desc_en: "HEX / RGB / HSL / HSV / CMYK converter, picker & WCAG contrast checker",
        desc_zh: "HEX / RGB / HSL / HSV / CMYK 互转、取色器与 WCAG 对比度检测",
        aliases: &["color", "hex", "rgb", "hsl", "cmyk", "wcag", "yanse"],
    },
    ToolMeta {
        id: "image-convert",
        category: "convert",
        title_en: "Image Converter & Base64",
        title_zh: "图片格式转换与 Base64",
        desc_en: "Drag & drop PNG / JPEG / WebP / SVG converter, SVG source/Data URL/CSS, resize & zoom preview",
        desc_zh: "支持拖拽的 PNG / JPEG / WebP / SVG 互转、SVG 源码与 CSS/Data URL 导出、尺寸锁定与缩放预览",
        aliases: &["image", "png", "jpeg", "webp", "svg", "base64", "picture", "drag", "tupian"],
    },
    // --- Crypto & Security (4) ---
    ToolMeta {
        id: "hash",
        category: "crypto",
        title_en: "Hash & HMAC",
        title_zh: "哈希与 HMAC 摘要",
        desc_en: "MD5, SHA-1/224/256/384/512, CRC32, SM3 & keyed HMAC",
        desc_zh: "MD5、SHA-1/224/256/384/512、CRC32、国密 SM3 与 HMAC 计算",
        aliases: &["hash", "md5", "sha1", "sha256", "sha512", "sm3", "hmac", "crc32"],
    },
    ToolMeta {
        id: "symmetric",
        category: "crypto",
        title_en: "Symmetric Encryption",
        title_zh: "对称加解密",
        desc_en: "AES (CBC/ECB/CTR/GCM), DES/3DES, RC4, SM4 (CBC/ECB/CTR/GCM), XOR",
        desc_zh: "AES、DES/3DES、RC4、国密 SM4 (CBC/ECB/CTR/GCM) 与 XOR 加解密",
        aliases: &["aes", "sm4", "des", "3des", "rc4", "xor", "cbc", "gcm", "ecb", "ctr", "cipher"],
    },
    ToolMeta {
        id: "asymmetric",
        category: "crypto",
        title_en: "RSA & SM2 Asymmetric",
        title_zh: "RSA 与国密 SM2 非对称",
        desc_en: "RSA & SM2 keypair generation, encryption/decryption, signing & verification",
        desc_zh: "RSA 与国密 SM2 密钥对生成、加解密、数字签名与验签",
        aliases: &["rsa", "sm2", "pem", "keypair", "sign", "verify", "encrypt"],
    },
    ToolMeta {
        id: "jwt",
        category: "crypto",
        title_en: "JWT Inspector & Signer",
        title_zh: "JWT 解析与签发验证",
        desc_en: "Decode JWT claims/timestamps, verify & sign HS256/384/512 & RS256",
        desc_zh: "解码 JWT Header/Payload 与过期时间，支持 HS256/384/512 与 RS256 签发验签",
        aliases: &["jwt", "token", "hs256", "rs256", "bearer", "jws"],
    },
    ToolMeta {
        id: "file-verify",
        category: "crypto",
        title_en: "File Checksum & Verification",
        title_zh: "文件校验与比对",
        desc_en: "Compute local file MD5/SHA/SM3/CRC32 digests, verify checksums & compare two files",
        desc_zh: "本地文件 MD5/SHA/SM3/CRC32 摘要计算、期望值自动校验与双文件比对",
        aliases: &["file", "checksum", "verify", "verification", "digest", "compare", "jiaoyan"],
    },
    ToolMeta {
        id: "blockchain",
        category: "crypto",
        title_en: "Blockchain Wallet, ABI & RPC",
        title_zh: "区块链钱包 / ABI / RPC 调试",
        desc_en: "Offline BIP-39/44 HD wallet (ETH/BTC/TRON/SOL/SUI), EIP-191/Ed25519, EVM ABI & live RPC explorer (net:ask)",
        desc_zh: "离线 BIP-39/44 多链 HD 钱包、签名验签、EVM ABI 选择器/Calldata 编解码与链上 JSON-RPC 调试 (net:ask)",
        aliases: &["blockchain", "wallet", "bip39", "bip32", "bip44", "mnemonic", "eth", "btc", "tron", "sol", "sui", "web3", "abi", "rpc", "calldata"],
    },
    // --- Generators (5) ---
    ToolMeta {
        id: "id-gen",
        category: "generate",
        title_en: "ID Generator & Decoder",
        title_zh: "分布式 ID 生成与解析",
        desc_en: "UUID v1/v4/v7, ULID, NanoID, Snowflake & MongoDB ObjectId generate/decode",
        desc_zh: "UUID v1/v4/v7、ULID、NanoID、雪花 ID 与 MongoDB ObjectId 生成与反解",
        aliases: &["uuid", "ulid", "nanoid", "snowflake", "objectid", "id", "guid"],
    },
    ToolMeta {
        id: "password-gen",
        category: "generate",
        title_en: "Password & Secret Generator",
        title_zh: "随机密码与密钥生成",
        desc_en: "Cryptographic passwords, passphrases, API keys & entropy strength meter",
        desc_zh: "密码学安全随机密码、词组密码、API 密钥生成与熵值强度评估",
        aliases: &["password", "pwd", "secret", "random", "entropy", "mima"],
    },
    ToolMeta {
        id: "cron",
        category: "generate",
        title_en: "Cron Parser & Schedule",
        title_zh: "Cron 表达式解析与预览",
        desc_en: "Unix / Spring / Quartz Cron human description & next execution times",
        desc_zh: "支持 Unix / Spring / Quartz 方言的中英文释义与未来执行时间计算",
        aliases: &["cron", "crontab", "quartz", "spring", "schedule"],
    },
    ToolMeta {
        id: "qrcode",
        category: "generate",
        title_en: "QR Code Generator & Scanner",
        title_zh: "二维码生成与识别",
        desc_en: "Generate SVG/PNG/Data URL QR codes with zoom scroll pane & drag-and-drop / clipboard offline scanner",
        desc_zh: "生成 SVG/PNG/Data URL 二维码（支持尺寸缩放与滚动预览），支持拖拽图片与剪贴板离线扫码",
        aliases: &["qr", "qrcode", "barcode", "scan", "erweima"],
    },
    ToolMeta {
        id: "ascii-art",
        category: "generate",
        title_en: "ASCII Art / FIGlet",
        title_zh: "ASCII 艺术字 (FIGlet)",
        desc_en: "10 FIGlet fonts (Standard, Big, Slant, Shadow, Doom, Banner, Small, Mini, Block, Bubble) & comment banners",
        desc_zh: "10 种 FIGlet 字体 ASCII 艺术字与代码注释包装输出",
        aliases: &["ascii", "figlet", "banner", "art"],
    },
    // --- Network & Hosts (2) ---
    ToolMeta {
        id: "http-client",
        category: "network",
        title_en: "HTTP Client & cURL",
        title_zh: "HTTP 请求调试与 cURL",
        desc_en: "Multi-tab HTTP request builder, URL/query sync, cURL import/export & live fetch via opt-in net:ask",
        desc_zh: "多标签 HTTP 请求构建、参数同步、cURL 导入导出与可选 net:ask 实时请求测试",
        aliases: &["http", "rest", "api", "curl", "fetch", "httpie", "request", "postman", "network"],
    },
    ToolMeta {
        id: "hosts-manager",
        category: "network",
        title_en: "Hosts Profile Manager",
        title_zh: "Hosts 分组管理 (SwitchHosts)",
        desc_en: "SwitchHosts-style multi-profile grouping, IP/host validation, conflict detection & export",
        desc_zh: "SwitchHosts 风格多分组开关管理、IP/域名校验、冲突检测与 hosts 导出",
        aliases: &["hosts", "switchhosts", "dns", "etc", "profile", "domain"],
    },
    // --- Productivity & Reference (3) ---
    ToolMeta {
        id: "notes",
        category: "productivity",
        title_en: "Scratch Notes",
        title_zh: "多标签便签 (Notes)",
        desc_en: "Persistent scratchpad notes with Markdown preview & editor export",
        desc_zh: "持久化多标签草稿便签，支持 Markdown 预览与打开为编辑器标签页",
        aliases: &["note", "notes", "scratch", "memo", "markdown", "bianqian"],
    },
    ToolMeta {
        id: "pomodoro",
        category: "productivity",
        title_en: "Pomodoro Timer",
        title_zh: "番茄钟专注计时",
        desc_en: "Focus & break timer synchronized with the IDE status bar & notifications",
        desc_zh: "与状态栏和系统通知联动的番茄工作法专注计时器",
        aliases: &["pomodoro", "timer", "focus", "tomato", "fanqie"],
    },
    ToolMeta {
        id: "cheatsheet",
        category: "productivity",
        title_en: "Developer Cheatsheets",
        title_zh: "开发者速查表",
        desc_en: "27 searchable developer command categories (270+ commands) + HTTP status, ASCII & Chmod calculator",
        desc_zh: "27 大类可全局搜索开发者命令速查（270+ 命令）及 HTTP 状态码、ASCII 与 Chmod 权限计算器",
        aliases: &["cheatsheet", "http", "status", "ascii", "regex", "git", "docker", "k8s", "linux", "sql", "chmod", "reference"],
    },
    // --- 8 New IDEA Parity Tools (v0.4.0) ---
    ToolMeta {
        id: "csv-table",
        category: "format",
        title_en: "CSV / Table Converter",
        title_zh: "CSV 与表格互转",
        desc_en: "Parse & preview CSV/TSV/JSON tables and convert to JSON, Markdown, SQL INSERT & HTML",
        desc_zh: "CSV/TSV/JSON 解析预览，一键转 JSON、Markdown 表格、SQL INSERT 与 HTML，支持转置与导出",
        aliases: &["csv", "tsv", "table", "excel", "markdown", "sql", "transpose", "biaoge"],
    },
    ToolMeta {
        id: "text-convert",
        category: "convert",
        title_en: "Full-Width, RMB & Morse Converter",
        title_zh: "全半角 / 人民币大写 / 罗马 / 摩斯",
        desc_en: "Full↔Half-width text, Chinese financial RMB capitals, Arabic↔Roman numerals & Morse code",
        desc_zh: "全角半角转换、数字转人民币财务大写、阿拉伯数字↔罗马数字与摩斯电码互转",
        aliases: &["fullwidth", "halfwidth", "rmb", "currency", "roman", "morse", "quanjiao", "daxie"],
    },
    ToolMeta {
        id: "totp",
        category: "crypto",
        title_en: "TOTP / HOTP 2FA & Base32",
        title_zh: "TOTP / HOTP 双因素验证码",
        desc_en: "Live 6/8-digit TOTP countdown codes, HOTP counter, Base32 secret & otpauth:// QR builder",
        desc_zh: "实时 TOTP 倒计时动态口令、HOTP 计次验证、Base32 密钥生成与 otpauth:// 二维码导入导出",
        aliases: &["totp", "hotp", "2fa", "mfa", "otp", "authenticator", "base32", "lingpai"],
    },
    ToolMeta {
        id: "cert-inspector",
        category: "crypto",
        title_en: "X.509 / PEM Certificate Inspector",
        title_zh: "SSL 证书与 PEM/DER 解析",
        desc_en: "Decode X.509 PEM/DER certs, Subject/Issuer, SANs, validity countdown & SHA-256/SHA-1 fingerprints",
        desc_zh: "离线解析 X.509 SSL 证书与 PEM/DER 链，查看颁发者、SAN 域名、有效期与指纹",
        aliases: &["cert", "x509", "ssl", "tls", "pem", "der", "certificate", "zhengshu"],
    },
    ToolMeta {
        id: "barcode",
        category: "generate",
        title_en: "1D Barcode Generator",
        title_zh: "一维条形码生成 (7 种格式)",
        desc_en: "Generate & batch-export Code 128, Code 39, EAN-13, EAN-8, UPC-A, ITF & Codabar SVG/PNG",
        desc_zh: "生成 Code 128/39、EAN-13/8、UPC-A、ITF 与 Codabar 条形码，支持批量与 SVG/PNG 导出",
        aliases: &["barcode", "ean", "ean13", "upc", "code128", "code39", "itf", "codabar", "tiaoxingma"],
    },
    ToolMeta {
        id: "mock-data",
        category: "generate",
        title_en: "Offline Mock Data Generator",
        title_zh: "离线 Mock 测试数据生成",
        desc_en: "Generate realistic JSON/CSV/SQL/Markdown test datasets from custom field schemas",
        desc_zh: "按字段 Schema 批量生成仿真测试数据（姓名/邮箱/手机/UUID/IP/日期），支持 JSON/CSV/SQL/MD",
        aliases: &["mock", "fake", "faker", "seed", "dataset", "sql", "json", "shuju"],
    },
    ToolMeta {
        id: "websocket-client",
        category: "network",
        title_en: "WebSocket Client",
        title_zh: "WebSocket 客户端调试",
        desc_en: "Host-managed WSS client with custom headers, subprotocol, heartbeat auto-send & message log",
        desc_zh: "持久化 WebSocket 调试客户端，支持自定义请求头、子协议、定时自动发送与消息日志",
        aliases: &["ws", "wss", "websocket", "socket", "stream", "heartbeat"],
    },
    ToolMeta {
        id: "url-parser",
        category: "network",
        title_en: "URL Parser & Query Builder",
        title_zh: "URL 解析与参数构造器",
        desc_en: "Dissect protocol, auth, host, path segments & interactively edit/encode Query parameters",
        desc_zh: "结构化拆解协议、域名、端口、路径分段与编码细节，支持交互式增删 Query 参数",
        aliases: &["url", "uri", "query", "querystring", "params", "parser", "link"],
    },
    // --- 7 New IDEA Parity Tools (v0.5.0) ---
    ToolMeta {
        id: "text-template",
        category: "string",
        title_en: "Batch Template & Row Expander",
        title_zh: "批量模板展开器",
        desc_en: "Expand CSV/TSV/JSON rows via {{1}}, {{index1}} & pipe filters (camel/snake/quote/json) into SQL or code",
        desc_zh: "将多行文本、CSV/TSV 或 JSON 数组按 {{1}}、{{index1}} 与管道过滤器批量展开为 SQL/代码",
        aliases: &["template", "mustache", "batch", "expand", "sql", "rows", "macro", "moban"],
    },
    ToolMeta {
        id: "xpath-query",
        category: "format",
        title_en: "XPath & CSS Selector Tester",
        title_zh: "XPath 与 CSS 选择器测试",
        desc_en: "Evaluate XPath axes/predicates/count() and CSS selectors offline on XML & HTML documents",
        desc_zh: "离线对 XML 与 HTML 文档执行 XPath 路径/谓词/函数与 CSS 选择器查询提取",
        aliases: &["xpath", "css", "selector", "xml", "html", "dom", "query", "domtree"],
    },
    ToolMeta {
        id: "unit-convert",
        category: "convert",
        title_en: "Unit & CSS Converter",
        title_zh: "工程单位与 CSS 换算",
        desc_en: "Convert CSS (px/rem/em/vw/vh/%), duration/TTL, length, mass, temperature, area, volume & angle",
        desc_zh: "CSS 单位（px/rem/em/vw/vh/%）、时长、长度、质量、温度、面积、体积与角度实时换算",
        aliases: &["unit", "css", "px", "rem", "em", "vw", "vh", "duration", "length", "temperature", "huansuan"],
    },
    ToolMeta {
        id: "hex-viewer",
        category: "convert",
        title_en: "Hex Viewer & Binary Inspector",
        title_zh: "十六进制与二进制查看器",
        desc_en: "16-byte hex/ASCII dump, Int8..64 & Float32/64 LE/BE data inspector, C/Rust/Go/Python byte export",
        desc_zh: "经典 16 字节 Hex+ASCII 视图、点击字节实时查看大小端整数/浮点数，并导出 C/Rust/Go/Python 数组",
        aliases: &["hex", "binary", "dump", "bytes", "int32", "float", "endian", "inspector", "erjinzhi"],
    },
    ToolMeta {
        id: "ua-headers",
        category: "network",
        title_en: "UA & HTTP Header Security Inspector",
        title_zh: "UA 与 HTTP 请求/响应头分析",
        desc_en: "Offline User-Agent parser, Cache-Control/CSP/Set-Cookie explainer & security checklist (memory-only)",
        desc_zh: "离线解析 User-Agent、Cache-Control/CSP/Set-Cookie 与安全响应头体检（敏感头仅驻留内存）",
        aliases: &["ua", "user-agent", "header", "headers", "cookie", "set-cookie", "csp", "cors", "cache-control", "security"],
    },
    ToolMeta {
        id: "symbol-emoji",
        category: "productivity",
        title_en: "Symbols, Emojis & Unicode Inspector",
        title_zh: "符号表情与 Unicode 检查器",
        desc_en: "Searchable Git emojis, math/arrow/box symbols & per-scalar UTF-8/UTF-16/HTML/JS/Rust escape inspector",
        desc_zh: "可搜索 Git 表情、箭头/数学/制表符号速查，以及字符 UTF-8/UTF-16/HTML/JS/Rust 转义分析",
        aliases: &["symbol", "emoji", "unicode", "utf8", "utf16", "codepoint", "gitmoji", "arrow", "math", "fuhao"],
    },
    ToolMeta {
        id: "semver-tool",
        category: "productivity",
        title_en: "SemVer & Version Range Comparator",
        title_zh: "SemVer 语义化版本与范围对比",
        desc_en: "Parse & bump SemVer 2.0.0, sort version lists, and test NPM/Cargo (^/~/>=) & Maven ([1.0,2.0)) ranges",
        desc_zh: "解析与递增 SemVer 2.0.0、多版本号排序，以及 NPM/Cargo (^/~/>=) 与 Maven 区间范围测试",
        aliases: &["semver", "version", "npm", "cargo", "maven", "range", "compare", "bump", "banben"],
    },
    // --- 5 New IDEA Parity Tools (v0.6.0) ---
    ToolMeta {
        id: "stacktrace-tool",
        category: "string",
        title_en: "Stack Trace & Structured Log Analyzer",
        title_zh: "堆栈追踪与结构化日志分析",
        desc_en: "Unescape & fold Java/Node/Python/Go/Rust stack traces by app package + filter NDJSON logs by level",
        desc_zh: "反转义并按应用包名前缀折叠 Java/Node/Python/Go/Rust 异常堆栈，及 NDJSON 日志级别过滤",
        aliases: &["stacktrace", "stack", "trace", "exception", "log", "ndjson", "java", "error", "duizhan", "rizhi"],
    },
    ToolMeta {
        id: "glob-tester",
        category: "string",
        title_en: "Glob & .gitignore Pattern Matcher",
        title_zh: "Glob 与 .gitignore 规则测试",
        desc_en: "Test .gitignore negation (!), dir-only (/) & ** glob rules against file trees with line-level blame",
        desc_zh: "测试 .gitignore 反向规则 (!)、目录匹配与 ** 通配符对路径列表的命中详情",
        aliases: &["glob", "gitignore", "ignore", "wildcard", "pattern", "match", "lujing"],
    },
    ToolMeta {
        id: "spring-config",
        category: "format",
        title_en: ".env / Properties / YAML Config Diff",
        title_zh: "配置格式互转与环境比对",
        desc_en: "Convert .env / .properties / YAML / JSON (Spring relaxed binding) & memory-only masked config diff",
        desc_zh: "支持 .env / .properties / YAML / JSON 互转与 Spring 宽松键映射，敏感键默认脱敏的环境比对（仅驻留内存）",
        aliases: &["env", "dotenv", "properties", "spring", "yaml", "config", "diff", "application", "peizhi"],
    },
    ToolMeta {
        id: "protobuf-wire",
        category: "format",
        title_en: "Protobuf Wire & Varint Decoder",
        title_zh: "Protobuf 二进制与 Varint 解码",
        desc_en: "Schema-less offline Protobuf/gRPC wire hex/base64 decoder, nested sub-messages & Varint/ZigZag tool",
        desc_zh: "无需 .proto 文件离线解码 Protobuf/gRPC 二进制 Hex/Base64 帧、嵌套子消息及 Varint/ZigZag 编解码",
        aliases: &["protobuf", "proto", "grpc", "varint", "zigzag", "wire", "binary", "decode"],
    },
    ToolMeta {
        id: "svg-studio",
        category: "convert",
        title_en: "SVG Optimizer & JSX/CSS Studio",
        title_zh: "SVG 压缩预览与 JSX/CSS 转换",
        desc_en: "Lexical SVG minify/format, checkerboard preview, Data URL/CSS & React TSX converter + PNG 1x/2x/3x export",
        desc_zh: "词法安全 SVG 压缩与格式化、棋盘格预览、Data URL/CSS 与 React JSX/TSX 转换及多倍 PNG 导出",
        aliases: &["svg", "optimize", "minify", "jsx", "tsx", "react", "css", "icon", "vector", "shiliang"],
    },
];

pub fn find_tool(id: &str) -> Option<&'static ToolMeta> {
    TOOLS.iter().find(|t| t.id == id)
}

pub fn title_for_locale(meta: &ToolMeta, locale: &str) -> &'static str {
    if is_zh(locale) { meta.title_zh } else { meta.title_en }
}

pub fn desc_for_locale(meta: &ToolMeta, locale: &str) -> &'static str {
    if is_zh(locale) { meta.desc_zh } else { meta.desc_en }
}

pub fn is_zh(locale: &str) -> bool {
    locale.to_ascii_lowercase().starts_with("zh")
}

/// Scores a tool against a Search Everywhere query; `None` if no match.
pub fn score_tool(meta: &ToolMeta, query: &str) -> Option<i32> {
    let q = query.trim().to_ascii_lowercase();
    if q.is_empty() {
        return Some(0);
    }
    let id = meta.id.to_ascii_lowercase();
    let en = meta.title_en.to_ascii_lowercase();
    let zh = meta.title_zh.to_ascii_lowercase();
    let desc_en = meta.desc_en.to_ascii_lowercase();
    let desc_zh = meta.desc_zh.to_ascii_lowercase();

    if id == q || meta.aliases.iter().any(|a| *a == q) {
        return Some(1000);
    }
    if id.starts_with(&q) || en.starts_with(&q) || zh.starts_with(&q) {
        return Some(800);
    }
    if meta.aliases.iter().any(|a| a.starts_with(&q)) {
        return Some(700);
    }
    if id.contains(&q) || en.contains(&q) || zh.contains(&q) {
        return Some(500);
    }
    if meta.aliases.iter().any(|a| a.contains(&q)) {
        return Some(400);
    }
    if desc_en.contains(&q) || desc_zh.contains(&q) {
        return Some(200);
    }
    // Simple subsequence match on id + en title for fuzzy typing like "jtp" / "ts".
    if is_subsequence(&q, &id) || is_subsequence(&q, &en) {
        return Some(100);
    }
    None
}

fn is_subsequence(needle: &str, haystack: &str) -> bool {
    let mut chars = needle.chars();
    let Some(mut cur) = chars.next() else {
        return true;
    };
    for h in haystack.chars() {
        if h == cur {
            if let Some(next) = chars.next() {
                cur = next;
            } else {
                return true;
            }
        }
    }
    false
}
