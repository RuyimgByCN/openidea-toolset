import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

const CODECS = [
  { id: "base64", en: "Base64", zh: "Base64" },
  { id: "base64url", en: "Base64 URL-Safe", zh: "Base64 (URL 安全)" },
  { id: "base32", en: "Base32 (RFC 4648)", zh: "Base32 (RFC 4648)" },
  { id: "base58", en: "Base58 (Bitcoin)", zh: "Base58 (比特币)" },
  { id: "base85", en: "Base85 (ASCII85)", zh: "Base85 (ASCII85)" },
  { id: "binary", en: "Binary (8-bit)", zh: "二进制 (8 位字节)" },
  { id: "url", en: "URL Percent", zh: "URL 百分比编码" },
  { id: "hex", en: "Hex", zh: "十六进制 (Hex)" },
  { id: "html", en: "HTML Entities", zh: "HTML 实体" },
  { id: "unicode", en: "Unicode (\\uXXXX)", zh: "Unicode (\\uXXXX)" },
  { id: "punycode", en: "Punycode (IDNA)", zh: "Punycode (国际化域名)" },
  { id: "rot13", en: "ROT13", zh: "ROT13 移位" },
];

export default function CodecTool({ locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("codec", {
    mode: "base64",
    input: "Hello, OpenIDEA 工具箱!",
  });
  const [output, setOutput] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, input: initialInput }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const run = async (decode: boolean) => {
    setErr(null);
    try {
      const res = await bridge.rpc<{ result: string }>("convert.codec", {
        text: saved.input,
        mode: saved.mode,
        decode,
      });
      setOutput(res.result);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Encoders & Decoders", "通用编解码")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, input: t }))}
          onPaste={(t) => setSaved((p) => ({ ...p, input: t }))}
          outputText={output}
          openTabTitle={`Codec (${saved.mode})`}
          diffLeft={saved.input}
          diffRight={output}
        />
      </div>

      <div className="ts-row">
        <select className="ts-select" style={{ width: 175 }} value={saved.mode} onChange={(e) => setSaved((p) => ({ ...p, mode: e.target.value }))}>
          {CODECS.map((c) => <option key={c.id} value={c.id}>{tx(locale, c.en, c.zh)}</option>)}
        </select>
        <button type="button" className="ts-btn primary" onClick={() => run(false)}>
          {tx(locale, "Encode →", "编码 →")}
        </button>
        <button type="button" className="ts-btn" onClick={() => run(true)}>
          {tx(locale, "← Decode", "← 解码")}
        </button>
        <button type="button" className="ts-btn" onClick={() => { if (output) { setSaved((p) => ({ ...p, input: output })); setOutput(""); } }}>
          {tx(locale, "Output → Input", "结果填回输入")}
        </button>
      </div>

      <textarea className="ts-textarea mono" rows={6} value={saved.input} onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))} />
      {err && <div className="ts-err">{err}</div>}
      <textarea className="ts-textarea mono" rows={6} readOnly value={output} />
    </div>
  );
}
