import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BridgeClient } from "../bridge";
import { isZhLocale, tx } from "../i18n";
import { CATEGORIES, searchTools, TOOL_REGISTRY } from "../registry";
import { eanCheckDigit, encodeBarcode, renderBarcodeSvg } from "../utils/barcode";
import { computeLineDiff, convertBandwidth, convertByteUnits, convertRadix } from "../utils/math";

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

  it("declares secondary = true (Right Bottom), events capability, and version 0.4.0 in plugin.toml", () => {
    const manifest = fs.readFileSync(path.resolve(import.meta.dirname, "../../../plugin.toml"), "utf8");
    expect(manifest).toMatch(/version\s*=\s*"0\.4\.0"/);
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
});
