import { useEffect, useState } from "react";
import { bridge, copyToClipboard } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

const ALGS = [
  "md5",
  "sha1",
  "sha224",
  "sha256",
  "sha384",
  "sha512",
  "sm3",
  "blake2s256",
  "blake2b512",
  "keccak256",
  "ripemd160",
  "crc32",
];
const NON_HMAC_ALGS = new Set(["crc32", "blake2s256", "blake2b512", "keccak256", "ripemd160"]);

export default function HashTool({ locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("hash", {
    input: "Hello OpenIDEA",
    inputEncoding: "utf8",
    hmacKey: "",
    keyEncoding: "utf8",
    outputEncoding: "hex",
  });
  const [results, setResults] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, input: initialInput }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  useEffect(() => {
    if (!bridge.isHosted) return;
    const t = setTimeout(async () => {
      try {
        const list = saved.hmacKey ? ALGS.filter((a) => !NON_HMAC_ALGS.has(a)) : ALGS;
        const pairs = await Promise.all(
          list.map(async (alg) => {
            const res = await bridge.rpc<{ result: string }>("crypto.hash", {
              text: saved.input,
              inputEncoding: saved.inputEncoding,
              alg,
              hmacKey: saved.hmacKey || null,
              keyEncoding: saved.keyEncoding,
              outputEncoding: saved.outputEncoding,
            });
            return [alg, res.result] as const;
          }),
        );
        setResults(Object.fromEntries(pairs));
        setErr(null);
      } catch (e) {
        setErr((e as Error).message);
      }
    }, 80);
    return () => clearTimeout(t);
  }, [saved.input, saved.inputEncoding, saved.hmacKey, saved.keyEncoding, saved.outputEncoding]);

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Hash & HMAC", "哈希与 HMAC 摘要")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, input: t }))}
          onPaste={(t) => setSaved((p) => ({ ...p, input: t }))}
          outputText={results.sha256}
        />
      </div>

      <div className="ts-row">
        <select className="ts-select" style={{ width: 110 }} value={saved.inputEncoding} onChange={(e) => setSaved((p) => ({ ...p, inputEncoding: e.target.value }))}>
          <option value="utf8">UTF-8</option>
          <option value="hex">Hex</option>
          <option value="base64">Base64</option>
        </select>
        <select className="ts-select" style={{ width: 130 }} value={saved.outputEncoding} onChange={(e) => setSaved((p) => ({ ...p, outputEncoding: e.target.value }))}>
          <option value="hex">{tx(locale, "Hex (lower)", "Hex (小写)")}</option>
          <option value="hex-upper">{tx(locale, "HEX (UPPER)", "HEX (大写)")}</option>
          <option value="base64">Base64</option>
        </select>
        <input
          className="ts-input mono"
          style={{ flex: 1 }}
          value={saved.hmacKey}
          onChange={(e) => setSaved((p) => ({ ...p, hmacKey: e.target.value }))}
          placeholder={tx(locale, "Optional HMAC key (blank = plain hash)", "可选 HMAC 密钥（留空为普通摘要）")}
        />
        {saved.hmacKey && (
          <select className="ts-select" style={{ width: 95 }} value={saved.keyEncoding} onChange={(e) => setSaved((p) => ({ ...p, keyEncoding: e.target.value }))}>
            <option value="utf8">UTF-8</option>
            <option value="hex">Hex</option>
            <option value="base64">Base64</option>
          </select>
        )}
      </div>

      <textarea className="ts-textarea mono" rows={4} value={saved.input} onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))} />

      {err && <div className="ts-err">{err}</div>}

      <div className="ts-box ts-kv">
        {Object.entries(results).map(([alg, val]) => (
          <div key={alg} style={{ display: "contents" }}>
            <span className="ts-kv-key">{saved.hmacKey ? `HMAC-${alg.toUpperCase()}` : alg.toUpperCase()}</span>
            <div className="ts-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
              <span className="ts-kv-val">{val}</span>
              <button type="button" className="ts-btn sm" onClick={() => copyToClipboard(val)}>
                {tx(locale, "Copy", "复制")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
