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
import { computeLineDiff, convertBandwidth, convertByteUnits, convertRadix } from "../utils/math";
import { stripUrlPassword as stripUrlPasswordDirect } from "../utils/urlSanitize";

describe("registry parity with Rust catalog", () => {
  it("contains all 43 unique tools matching src/catalog.rs categories and ids", () => {
    expect(TOOL_REGISTRY).toHaveLength(43);
    const ids = new Set(TOOL_REGISTRY.map((t) => t.id));
    expect(ids.size).toBe(43);

    const validCats = new Set(CATEGORIES.map((c) => c.id).filter((id) => id !== "all"));
    for (const t of TOOL_REGISTRY) {
      expect(validCats.has(t.category)).toBe(true);
    }

    const catalogRs = fs.readFileSync(path.resolve(import.meta.dirname, "../../../src/catalog.rs"), "utf8");
    const rustMatches = [...catalogRs.matchAll(/ToolMeta\s*\{[\s\S]*?id:\s*"([^"]+)"[\s\S]*?category:\s*"([^"]+)"/g)];
    expect(rustMatches).toHaveLength(43);
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

  it("declares secondary = true (Right Bottom), events capability, and version 0.4.3 in plugin.toml", () => {
    const manifest = fs.readFileSync(path.resolve(import.meta.dirname, "../../../plugin.toml"), "utf8");
    expect(manifest).toMatch(/version\s*=\s*"0\.4\.3"/);
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
    expect(sheets).toHaveLength(10);
    for (const entries of sheets) {
      expect(entries.length).toBeGreaterThan(0);
      for (const item of entries) {
        expect(item.cmd.trim().length).toBeGreaterThan(0);
        expect(item.descEn.trim().length).toBeGreaterThan(0);
        expect(item.descZh.trim().length).toBeGreaterThan(0);
        expect(item.descZh).not.toBe(item.descEn);
        expect(item.descZh).toMatch(/[\u4e00-\u9fff]/);
      }
    }
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
  });
});
