import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

const FORMATS = [
  { id: "json", label: "JSON", lang: "json", ext: "json" },
  { id: "yaml", label: "YAML", lang: "yaml", ext: "yaml" },
  { id: "toml", label: "TOML", lang: "toml", ext: "toml" },
  { id: "xml", label: "XML", lang: "xml", ext: "xml" },
  { id: "properties", label: "Properties", lang: "properties", ext: "properties" },
  { id: "querystring", label: "QueryString", lang: "plaintext", ext: "txt" },
];

export default function FormatConvertTool({ locale, settings, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("format-convert", {
    from: "json",
    to: "yaml",
    input: '{\n  "server": {\n    "port": 8080,\n    "host": "localhost"\n  }\n}',
  });
  const [output, setOutput] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, input: initialInput }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const convert = async () => {
    setErr(null);
    try {
      const res = await bridge.rpc<{ result: string }>("format.convert", {
        text: saved.input,
        from: saved.from,
        to: saved.to,
        indent: settings.defaultIndent || "2",
      });
      setOutput(res.result);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const targetMeta = FORMATS.find((f) => f.id === saved.to);

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Format Converter", "数据格式互转")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, input: t }))}
          onPaste={(t) => setSaved((p) => ({ ...p, input: t }))}
          outputText={output}
          openTabTitle={`Converted (${saved.to.toUpperCase()})`}
          openTabLanguage={targetMeta?.lang}
          openTabFileName={`converted.${targetMeta?.ext || "txt"}`}
          onClear={() => {
            setSaved((p) => ({ ...p, input: "" }));
            setOutput("");
          }}
        />
      </div>

      <div className="ts-row">
        <select className="ts-select" style={{ width: 130 }} value={saved.from} onChange={(e) => setSaved((p) => ({ ...p, from: e.target.value }))}>
          {FORMATS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
        <span>→</span>
        <select className="ts-select" style={{ width: 130 }} value={saved.to} onChange={(e) => setSaved((p) => ({ ...p, to: e.target.value }))}>
          {FORMATS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="ts-btn"
          onClick={() => {
            setSaved((p) => ({ ...p, from: p.to, to: p.from, input: output || p.input }));
            setOutput("");
          }}
        >
          {tx(locale, "Swap", "交换")}
        </button>
        <button type="button" className="ts-btn primary" onClick={convert}>
          {tx(locale, "Convert", "转换")}
        </button>
      </div>

      <textarea className="ts-textarea mono" rows={7} value={saved.input} onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))} />
      {err && <div className="ts-err">{err}</div>}
      <textarea className="ts-textarea mono" rows={8} readOnly value={output} placeholder={tx(locale, "Converted result...", "转换结果...")} />
    </div>
  );
}
