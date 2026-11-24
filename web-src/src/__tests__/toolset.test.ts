import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BridgeClient } from "../bridge";
import { pickAllowedKeys } from "../hooks/useToolState";
import { isZhLocale, tx } from "../i18n";
import { CATEGORIES, searchTools, TOOL_REGISTRY } from "../registry";
import { COMMAND_SHEETS, HTTP_CODES } from "../tools/CheatsheetTool";
import { stripUrlPassword } from "../tools/UrlParserTool";
import { eanCheckDigit, encodeBarcode, renderBarcodeSvg } from "../utils/barcode";
import { convertConfig, diffConfigs, envKeyToPropKey, propKeyToEnvKey } from "../utils/configTools";
import { decodeCalldataWords, encodeCalldata, formatRpcValue, normalizeSoliditySignature } from "../utils/evmAbi";
import { evaluateGitignore, matchSingleGlob } from "../utils/globMatcher";
import { exportByteArray, inspectOffset, parseBytesInput } from "../utils/hexInspector";
import { inspectHttpHeaders, parseUserAgent } from "../utils/httpInspect";
import { computeLineDiff, convertBandwidth, convertByteUnits, convertRadix } from "../utils/math";
import { decodeProtobufHexOrBase64, encodeVarint, zigzagDecode, zigzagEncode } from "../utils/protobufWire";
import { explainRegexAst, parseRegexAst, renderRegexRailroadSvg } from "../utils/regexDiagram";
import { bumpSemver, compareSemver, parseSemver, satisfiesRange, sortSemverList } from "../utils/semver";
import { parseNdjsonLogs, parseStackTrace, unescapeLogTrace } from "../utils/stacktrace";
import { stripUrlPassword as stripUrlPasswordDirect } from "../utils/urlSanitize";
import { formatSvg, inspectSvg, minifySvg, svgToJsx } from "../utils/svgTools";
import { expandTemplate } from "../utils/templateExpander";
import { convertUnits, formatDurationBreakdown } from "../utils/units";

describe("registry parity with Rust catalog", () => {
  it("contains all 55 unique tools matching src/catalog.rs categories and ids", () => {
    expect(TOOL_REGISTRY).toHaveLength(55);
    const ids = new Set(TOOL_REGISTRY.map((t) => t.id));
    expect(ids.size).toBe(55);

    const validCats = new Set(CATEGORIES.map((c) => c.id).filter((id) => id !== "all"));
    for (const t of TOOL_REGISTRY) {
      expect(validCats.has(t.category)).toBe(true);
    }

    const catalogRs = fs.readFileSync(path.resolve(import.meta.dirname, "../../../src/catalog.rs"), "utf8");
    const rustMatches = [...catalogRs.matchAll(/ToolMeta\s*\{[\s\S]*?id:\s*"([^"]+)"[\s\S]*?category:\s*"([^"]+)"/g)];
    expect(rustMatches).toHaveLength(55);
    const rustCatById = new Map(rustMatches.map((m) => [m[1], m[2]]));
    expect(new Set(rustCatById.keys())).toEqual(ids);
    for (const t of TOOL_REGISTRY) {
      expect(t.category).toBe(rustCatById.get(t.id));
    }
  });

  it("matches tools by alias, id, English and Chinese titles", () => {
    expect(searchTools("ts")[0]?.id).toBe("timestamp");
    expect(searchTools("sm3")[0]?.id).toBe("hash");
    expect(searchTools("时间戳")[0]?.id).toBe("timestamp");
    expect(searchTools("cron")[0]?.id).toBe("cron");
    expect(searchTools("ddl")[0]?.id).toBe("sql-toolkit");
    expect(searchTools("curl")[0]?.id).toBe("http-client");
    expect(searchTools("bip39")[0]?.id).toBe("blockchain");
    expect(searchTools("hosts")[0]?.id).toBe("hosts-manager");
    expect(searchTools("wsl")[0]?.id).toBe("path-convert");
    expect(searchTools("calc")[0]?.id).toBe("calculator");
    expect(searchTools("checksum")[0]?.id).toBe("file-verify");
    expect(searchTools("bbcode")[0]?.id).toBe("markup-convert");
    expect(searchTools("biaoge")[0]?.id).toBe("csv-table");
    expect(searchTools("rmb")[0]?.id).toBe("text-convert");
    expect(searchTools("totp")[0]?.id).toBe("totp");
    expect(searchTools("x509")[0]?.id).toBe("cert-inspector");
    expect(searchTools("ean13")[0]?.id).toBe("barcode");
    expect(searchTools("faker")[0]?.id).toBe("mock-data");
    expect(searchTools("websocket")[0]?.id).toBe("websocket-client");
    expect(searchTools("url parser")[0]?.id).toBe("url-parser");
    expect(searchTools("querystring").map((t) => t.id)).toContain("url-parser");
    expect(searchTools("emoji")[0]?.id).toBe("symbol-emoji");
    expect(searchTools("unit")[0]?.id).toBe("unit-convert");
    expect(searchTools("xpath")[0]?.id).toBe("xpath-query");
    expect(searchTools("hex viewer")[0]?.id).toBe("hex-viewer");
    expect(searchTools("template")[0]?.id).toBe("text-template");
    expect(searchTools("user-agent")[0]?.id).toBe("ua-headers");
    expect(searchTools("semver")[0]?.id).toBe("semver-tool");
    expect(searchTools("stacktrace")[0]?.id).toBe("stacktrace-tool");
    expect(searchTools("gitignore")[0]?.id).toBe("glob-tester");
    expect(searchTools("spring")[0]?.id).toBe("spring-config");
    expect(searchTools("protobuf")[0]?.id).toBe("protobuf-wire");
    expect(searchTools("svg-studio")[0]?.id).toBe("svg-studio");
    expect(searchTools("jsx")[0]?.id).toBe("svg-studio");
  });
});

describe("1D Barcode generator", () => {
  it("encodes all 7 symbologies and renders SVG markup", () => {
    const samples = [
      ["code128", "OpenIDEA-2026"],
      ["code39", "OPENIDEA-39"],
      ["ean13", "690123456789"],
      ["ean8", "6901234"],
      ["upca", "03600029145"],
      ["itf", "1234567890"],
      ["codabar", "A123456A"],
    ] as const;

    for (const [fmt, val] of samples) {
      const encoded = encodeBarcode(fmt, val);
      expect(encoded.bits.length).toBeGreaterThan(20);
      expect(/^[01]+$/.test(encoded.bits)).toBe(true);
      const svg = renderBarcodeSvg(encoded);
      expect(svg).toContain("<svg");
      expect(svg).toContain("<rect");
      expect(svg).toContain(encoded.value);
    }

    expect(eanCheckDigit("690123456789")).toBe(2);
    expect(() => encodeBarcode("ean13", "6901234567890")).toThrow(/check digit/i);
    expect(() => encodeBarcode("itf", "123")).toThrow(/even/i);
  });
});

describe("BridgeClient RPC correlation", () => {
  it("correlates request ids and handles push notifications", async () => {
    let incoming: ((text: string) => void) | null = null;
    const posted: string[] = [];
    const client = new BridgeClient({
      postMessage: (t) => posted.push(t),
      onMessage: (fn) => {
        incoming = fn;
      },
    });

    const pushed: unknown[] = [];
    client.onPush((msg) => pushed.push(msg));

    const promise = client.rpc<{ result: string }>("crypto.hash", { text: "abc" });
    expect(posted).toHaveLength(1);
    const req = JSON.parse(posted[0]);
    expect(req.op).toBe("rpc");
    expect(req.method).toBe("crypto.hash");

    incoming!(JSON.stringify({ op: "pomodoro-sync", pomodoro: { running: true } }));
    incoming!(JSON.stringify({ op: "http-response", tabId: "http-1", ok: true, data: { status: 200 } }));
    expect(pushed).toHaveLength(2);

    incoming!(JSON.stringify({ op: "rpc-result", id: req.id, ok: true, data: { result: "ok" } }));
    await expect(promise).resolves.toEqual({ result: "ok" });
  });
});

describe("Radix, Bytes, and Diff helpers", () => {
  it("converts arbitrary-precision BigInt across bases", () => {
    const big = convertRadix("18446744073709551616", 10);
    expect(big[16]).toBe("10000000000000000");
    expect(big[2]).toBe(`1${"0".repeat(64)}`);
    expect(convertRadix("0xff", 16)[10]).toBe("255");
  });

  it("converts SI and IEC byte units through PB/PiB/EB and network bandwidth", () => {
    const res = convertByteUnits(1, "GiB");
    expect(res.bytes).toBe(String(1024 ** 3));
    expect(res.mib).toBe("1024");
    expect(convertByteUnits(1, "TiB").gib).toBe("1024");
    expect(convertByteUnits(1, "PiB").tib).toBe("1024");
    expect(convertBandwidth(100, "Mbps")["MB/s"]).toBe("12.5");
  });

  it("computes line diffs", () => {
    const diff = computeLineDiff("a\nb\nc", "a\nx\nc\nd");
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(1);
  });
});

describe("Localization, manifest placement, and language setting", () => {
  it("resolves zh and en locales cleanly via isZhLocale and tx", () => {
    expect(isZhLocale("zh")).toBe(true);
    expect(isZhLocale("zh-CN")).toBe(true);
    expect(isZhLocale("zh-TW")).toBe(true);
    expect(isZhLocale("en")).toBe(false);
    expect(isZhLocale("en-US")).toBe(false);
    expect(tx("zh-CN", "Copy", "复制")).toBe("复制");
    expect(tx("en-US", "Copy", "复制")).toBe("Copy");
  });

  it("declares secondary = true (Right Bottom), events capability, and version 0.6.1 in plugin.toml", () => {
    const manifest = fs.readFileSync(path.resolve(import.meta.dirname, "../../../plugin.toml"), "utf8");
    expect(manifest).toMatch(/version\s*=\s*"0\.6\.1"/);
    expect(manifest).toMatch(/location\s*=\s*"right"\s*\nsecondary\s*=\s*true/);
    expect(manifest).toContain('"events"');
    expect(manifest).toContain('"on-event:websocket-ready"');
  });

  it("declares language setting defaulting to auto with zh-CN and en options", () => {
    const schema = JSON.parse(
      fs.readFileSync(path.resolve(import.meta.dirname, "../../../settings.schema.json"), "utf8"),
    ) as { properties: { language: { default: string; enum: string[] } } };
    expect(schema.properties.language.default).toBe("auto");
    expect(schema.properties.language.enum).toEqual(["auto", "zh-CN", "en"]);
  });

  it("localizes every command sheet entry and HTTP status description in English and Chinese", () => {
    const sheets = Object.values(COMMAND_SHEETS);
    expect(sheets).toHaveLength(27);
    let totalCommands = 0;
    for (const entries of sheets) {
      expect(entries.length).toBeGreaterThanOrEqual(10);
      totalCommands += entries.length;
      for (const item of entries) {
        expect(item.cmd.trim().length).toBeGreaterThan(0);
        expect(item.descEn.trim().length).toBeGreaterThan(0);
        expect(item.descZh.trim().length).toBeGreaterThan(0);
        expect(item.descZh).not.toBe(item.descEn);
        expect(item.descZh).toMatch(/[\u4e00-\u9fff]/);
      }
    }
    expect(totalCommands).toBeGreaterThanOrEqual(270);
    expect(HTTP_CODES.length).toBeGreaterThan(0);
    for (const [code, phrase, meaningEn, meaningZh] of HTTP_CODES) {
      expect(code).toMatch(/^\d{3}$/);
      expect(phrase.trim().length).toBeGreaterThan(0);
      expect(meaningEn.trim().length).toBeGreaterThan(0);
      expect(meaningZh.trim().length).toBeGreaterThan(0);
      expect(meaningZh).toMatch(/[\u4e00-\u9fff]/);
    }
  });
});

describe("Secret persistence hygiene", () => {
  it("drops legacy secret fields via pickAllowedKeys and strips passwords from persisted URLs", () => {
    const legacy = {
      subtab: "wallet",
      wordCount: 24,
      mnemonic: "abandon abandon about",
      passphrase: "secret-pass",
      privKey: "0xabc",
      showSecrets: true,
    };
    const safe = pickAllowedKeys(legacy, { subtab: "wallet", wordCount: 12, account: 0 });
    expect(safe).toEqual({ subtab: "wallet", wordCount: 24 });
    expect("mnemonic" in safe).toBe(false);
    expect("passphrase" in safe).toBe(false);
    expect("privKey" in safe).toBe(false);

    expect(stripUrlPassword("https://alice:hunter2@example.com/v1?x=1")).toBe("https://alice@example.com/v1?x=1");
    expect(stripUrlPasswordDirect("wss://alice:SYNTHETIC-WS-PASSWORD@echo.websocket.org/socket")).toBe(
      "wss://alice@echo.websocket.org/socket",
    );
    expect(stripUrlPasswordDirect("https://:SYNTHETIC-HTTP-PASSWORD@example.test/private")).toBe(
      "https://example.test/private",
    );
    expect(stripUrlPasswordDirect("wss://:secret@[::1")).toBe("wss://[::1");

    const toolsDir = path.resolve(import.meta.dirname, "../tools");
    for (const [file, field] of [
      ["HttpClientTool.tsx", "url: stripUrlPassword(state.url)"],
      ["WebSocketClientTool.tsx", "url: stripUrlPassword(state.url)"],
      ["UrlParserTool.tsx", "rawUrl: stripUrlPassword(state.rawUrl)"],
      ["BlockchainTool.tsx", "rpcUrl: stripUrlPassword(state.rpcUrl)"],
    ]) {
      const src = fs.readFileSync(path.join(toolsDir, file), "utf8");
      expect(src).toContain(field);
    }
  });

  it("never places wallet or cryptographic secret fields inside useToolState defaults", () => {
    const toolsDir = path.resolve(import.meta.dirname, "../tools");
    const checks: Array<[string, string[]]> = [
      ["BlockchainTool.tsx", ["mnemonic:", "passphrase:", "privKey:", "privateKey:", "showSecrets:", "signature:"]],
      ["TotpTool.tsx", ["secret:", "uriInput:"]],
      ["AsymmetricTool.tsx", ["privateKey:"]],
      ["SymmetricTool.tsx", ["key:", "iv:"]],
      ["JwtTool.tsx", ["secret:", "token:"]],
      ["HashTool.tsx", ["hmacKey:"]],
      ["HttpClientTool.tsx", ["authToken:", "authPass:", "curlImport:"]],
      ["WebSocketClientTool.tsx", ["headers:"]],
      ["UrlParserTool.tsx", ["password:"]],
      ["UaHeadersTool.tsx", ["rawHeaders:", "headers:", "cookie:", "cookies:"]],
      ["SpringConfigTool.tsx", ["left:", "right:", "input:", "rawConfig:", "envText:"]],
    ];
    for (const [file, forbiddenKeys] of checks) {
      const src = fs.readFileSync(path.join(toolsDir, file), "utf8");
      const m = src.match(/useToolState[\s\S]*?\(\s*[^,]+,\s*(\{[\s\S]*?\})\s*(?:,|\))/);
      expect(m, `Missing useToolState defaults in ${file}`).not.toBeNull();
      const defaultsBlock = m![1];
      for (const k of forbiddenKeys) {
        expect(defaultsBlock).not.toContain(k);
      }
    }

    expect(fs.readFileSync(path.join(toolsDir, "QrCodeTool.tsx"), "utf8")).not.toContain("dangerouslySetInnerHTML");
    expect(fs.readFileSync(path.join(toolsDir, "SvgStudioTool.tsx"), "utf8")).not.toContain("dangerouslySetInnerHTML");
  });
});

describe("v0.5.0 IDEA parity utilities", () => {
  it("parses regex AST, renders Regulex-style railroad SVG, and builds EN/ZH explanation", () => {
    const { ast, error } = parseRegexAst(String.raw`^(?<user>\w+?)@(?:dev|prod)+\.\d{2,4}$`);
    expect(error).toBeNull();
    expect(ast.type).toBe("seq");
    const svgRes = renderRegexRailroadSvg(String.raw`^(foo|bar)+\d{2}$`, "im");
    expect(svgRes.error).toBeNull();
    expect(svgRes.svg).toContain("<svg");
    expect(svgRes.svg).toContain("Group #1");
    expect(svgRes.width).toBeGreaterThan(150);

    const exp = explainRegexAst(String.raw`^\d+$`);
    expect(exp.length).toBeGreaterThanOrEqual(4);
    expect(exp.some((e) => e.descZh.includes("数字"))).toBe(true);

    const bad = renderRegexRailroadSvg("(unclosed");
    expect(bad.error).not.toBeNull();
    expect(bad.svg).toContain("Parse error");
  });

  it("converts CSS, Temperature, and Duration units accurately", () => {
    const css = convertUnits("css", 32, "px", { rootPx: 16, parentPx: 16, vwPx: 1280, vhPx: 800 });
    expect(css.find((r) => r.id === "rem")?.formatted).toBe("2");
    expect(css.find((r) => r.id === "vw")?.formatted).toBe("2.5");

    const temp = convertUnits("temperature", 100, "c");
    expect(temp.find((r) => r.id === "f")?.formatted).toBe("212");
    expect(temp.find((r) => r.id === "k")?.formatted).toBe("373.15");

    expect(formatDurationBreakdown(3661000, false)).toBe("1h 1m 1s");
  });

  it("parses bytes, inspects LE/BE scalars, and exports code arrays", () => {
    const bytes = parseBytesInput("01 02 03 04 41 42", "hex");
    expect(bytes.length).toBe(6);
    const info = inspectOffset(bytes, 0)!;
    expect(info.byteHex).toBe("01");
    expect(info.uint16Be).toBe(String(0x0102));
    expect(info.uint32Be).toBe(String(0x01020304));
    expect(exportByteArray(bytes, "rust")).toContain("const PAYLOAD: [u8; 6]");
    expect(exportByteArray(bytes, "dump")).toContain("00000000");
  });

  it("expands CSV/TSV/JSON templates with pipe filters", () => {
    const res = expandTemplate("id,name\n1,Alice Bob\n2,Carol", "({{index1}}) {{id}}={{name | snake | quote}}", {
      mode: "delim",
      delimiter: ",",
      hasHeader: true,
      skipEmpty: true,
      joinWith: "\\n",
      header: "",
      footer: "",
    });
    expect(res.error).toBeNull();
    expect(res.rowCount).toBe(2);
    expect(res.output).toBe("(1) 1='alice_bob'\n(2) 2='carol'");
  });

  it("parses User-Agent strings and audits HTTP response headers & Set-Cookie", () => {
    const ua = parseUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    );
    expect(ua.browser).toBe("Google Chrome");
    expect(ua.engine).toBe("Blink");
    expect(ua.os).toBe("macOS");
    expect(ua.isBot).toBe(false);

    const bot = parseUserAgent("Googlebot/2.1 (+http://www.google.com/bot.html)");
    expect(bot.isBot).toBe(true);
    expect(bot.deviceType).toBe("Bot");

    const rep = inspectHttpHeaders(
      "Cache-Control: public, max-age=60\nStrict-Transport-Security: max-age=31536000\nSet-Cookie: sid=secret123; Path=/; HttpOnly",
    );
    expect(rep.cacheControl).toHaveLength(2);
    expect(rep.cookies[0].httpOnly).toBe(true);
    expect(rep.cookies[0].secure).toBe(false);
    expect(rep.cookies[0].valueMasked).not.toContain("secret123");
    expect(rep.audit.find((a) => a.header === "Strict-Transport-Security")?.status).toBe("pass");
  });

  it("parses, bumps, sorts, and evaluates NPM/Cargo & Maven SemVer ranges", () => {
    const v = parseSemver("v1.2.3-alpha.1")!;
    expect(compareSemver(v, parseSemver("1.2.3")!)).toBe(-1);
    expect(bumpSemver(parseSemver("1.2.3")!, "minor")).toBe("1.3.0");
    expect(sortSemverList(["1.2.0", "1.2.0-beta.1", "2.0.0"]).sorted).toEqual(["1.2.0-beta.1", "1.2.0", "2.0.0"]);

    expect(satisfiesRange("1.5.0", "^1.2.3").matched).toBe(true);
    expect(satisfiesRange("2.0.0", "^1.2.3").matched).toBe(false);
    expect(satisfiesRange("1.2.9", "~1.2.3").matched).toBe(true);
    expect(satisfiesRange("1.3.0", "~1.2.3").matched).toBe(false);
    expect(satisfiesRange("2.0.0", "[1.0.0,2.0.0)").matched).toBe(false);
    expect(satisfiesRange("1.9.0", "[1.0.0,2.0.0)").matched).toBe(true);
  });
});

describe("v0.6.0 IDEA Toolset 2026.4.1 upgrades & 5 new tools", () => {
  it("normalizes Solidity ABI signatures, encodes/decodes calldata, and formats RPC hex results", () => {
    const norm = normalizeSoliditySignature("function transfer(address to, uint amount) external returns (bool)");
    expect(norm.canonical).toBe("transfer(address,uint256)");
    expect(norm.types).toEqual(["address", "uint256"]);

    const encoded = encodeCalldata("0xa9059cbb", norm.types, [
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      "1000000000000000000",
    ]);
    expect(encoded.length).toBe(2 + 8 + 128);
    const decoded = decodeCalldataWords(encoded);
    expect(decoded.selector).toBe("0xa9059cbb");
    expect(decoded.words[0].address).toBe("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
    expect(decoded.words[1].uint256).toBe("1000000000000000000");

    expect(formatRpcValue("eth_getBalance", "0xde0b6b3a7640000")).toContain("1 ETH");
    expect(formatRpcValue("eth_gasPrice", "0x3b9aca00")).toContain("1 Gwei");
  });

  it("unescapes and parses Java/Node stack traces and filters NDJSON logs", () => {
    const unesc = unescapeLogTrace("java.lang.NullPointerException\\n\\tat com.myapp.Main.run(Main.java:10)\\n\\tat java.base/java.lang.Thread.run(Thread.java:1)");
    const parsed = parseStackTrace(unesc, ["com.myapp"]);
    expect(parsed.language).toBe("Java / JVM");
    expect(parsed.causes).toHaveLength(1);
    expect(parsed.appFrameCount).toBe(1);
    expect(parsed.frameworkFrameCount).toBe(1);

    const logs = parseNdjsonLogs('{"timestamp":"2026-11-24T00:00:00Z","level":"ERROR","message":"boom","code":500}\nplain info line');
    expect(logs).toHaveLength(2);
    expect(logs[0].level).toBe("ERROR");
    expect(logs[0].extra).toContain("code=500");
  });

  it("evaluates .gitignore negation, directory-only rules, and glob patterns", () => {
    const res = evaluateGitignore("target/\n!target/keep.log\n*.log\n!ok.log", "target/app.bin\ntarget/keep.log\nfoo.log\nok.log\nsrc/main.rs");
    expect(res.find((r) => r.path === "target/app.bin")?.ignored).toBe(true);
    expect(res.find((r) => r.path === "target/keep.log")?.ignored).toBe(true); // directory ignored ignores children in gitignore
    expect(res.find((r) => r.path === "foo.log")?.ignored).toBe(true);
    expect(res.find((r) => r.path === "ok.log")?.ignored).toBe(false);
    expect(res.find((r) => r.path === "src/main.rs")?.ignored).toBe(false);

    const globs = matchSingleGlob("src/**/*.{ts,rs}", "src/lib/a.ts\nsrc/main.rs\ntests/a.ts");
    expect(globs.map((g) => g.matched)).toEqual([true, true, false]);
  });

  it("converts .properties/.env/YAML/JSON with Spring relaxed binding and masks sensitive diff keys", () => {
    expect(propKeyToEnvKey("server.servlet.context-path")).toBe("SERVER_SERVLET_CONTEXT_PATH");
    expect(envKeyToPropKey("SERVER_PORT")).toBe("server.port");

    const conv = convertConfig("server.port=8080\nspring.application.name=demo", "properties", "yaml");
    expect(conv.error).toBeNull();
    expect(conv.output).toContain("port: 8080");

    const diff = diffConfigs("SERVER_PORT=8080\nDB_PASSWORD=dev-pass", "env", "server:\n  port: 8443\ndb:\n  password: prod-pass", "yaml", true);
    expect(diff.error).toBeNull();
    expect(diff.summary.changed).toBe(2);
    const pwdRow = diff.rows.find((r) => r.key === "db.password")!;
    expect(pwdRow.sensitive).toBe(true);
    expect(pwdRow.left).toBe("••••••");
    expect(pwdRow.right).toBe("••••••");
  });

  it("decodes schema-less Protobuf & gRPC wire payloads and encodes/decodes Varint/ZigZag", () => {
    const sampleHex = "08 96 01 12 08 4f 70 65 6e 49 44 45 41 1a 08 08 2a 12 04 67 52 50 43";
    const dec = decodeProtobufHexOrBase64(sampleHex, "hex", false);
    expect(dec.error).toBeNull();
    expect(dec.fields).toHaveLength(3);
    expect(dec.fields[0].uint64).toBe("150");
    expect(dec.fields[1].utf8).toBe("OpenIDEA");
    expect(dec.fields[2].nested?.[0].uint64).toBe("42");
    expect(dec.fields[2].nested?.[1].utf8).toBe("gRPC");

    // Wrap in 5-byte gRPC frame (compressed=0, len=23=0x17)
    const grpcRes = decodeProtobufHexOrBase64("00 00 00 00 17 " + sampleHex, "hex", true);
    expect(grpcRes.grpcStripped).toBe(true);
    expect(grpcRes.fields).toHaveLength(3);

    expect(zigzagEncode(-150n)).toBe(299n);
    expect(zigzagDecode(299n)).toBe(-150n);
    expect(encodeVarint(299n)).toBe("ab 02");
  });

  it("lexically minifies SVG preserving <text> spaces, formats, inspects metrics, and converts to JSX", () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
      <!-- sample comment -->
      <path d="M2 12 L22 12" stroke-width="2" fill-rule="evenodd" />
      <text x="12" y="18">keep  spaces</text>
    </svg>`;
    const min = minifySvg(raw);
    expect(min).not.toContain("sample comment");
    expect(min).toContain(">keep  spaces</text>");
    expect(formatSvg(min, 2)).toContain("\n  <path");
    const m = inspectSvg(raw);
    expect(m.viewBox).toBe("0 0 24 24");
    expect(m.dataUriUtf8).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    const jsx = svgToJsx(raw, "CheckIcon");
    expect(jsx).toContain("export function CheckIcon");
    expect(jsx).toContain("strokeWidth=");
    expect(jsx).toContain("fillRule=");
  });
});
