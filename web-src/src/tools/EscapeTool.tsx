import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

const LANGS = [
  { id: "json", label: "JSON" },
  { id: "java", label: "Java" },
  { id: "javascript", label: "JavaScript" },
  { id: "xml", label: "XML" },
  { id: "html", label: "HTML" },
  { id: "sql", label: "SQL" },
  { id: "php", label: "PHP" },
  { id: "unicode", label: "Unicode (\\uXXXX)" },
];

export default function EscapeTool({ locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("escape", {
    lang: "json",
    input: 'Hello "OpenIDEA"\n中文 & <tag>',
  });
  const [output, setOutput] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, input: initialInput }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const run = async (unescape: boolean) => {
    setErr(null);
    try {
      const res = await bridge.rpc<{ result: string }>("string.escape", {
        text: saved.input,
        lang: saved.lang,
        unescape,
      });
      setOutput(res.result);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Escape / Unescape", "多语言转义 / 反转义")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, input: t }))}
          onPaste={(t) => setSaved((p) => ({ ...p, input: t }))}
          outputText={output}
          openTabTitle={`Escape (${saved.lang})`}
          diffLeft={saved.input}
          diffRight={output}
          onClear={() => {
            setSaved((p) => ({ ...p, input: "" }));
            setOutput("");
          }}
        />
      </div>

      <div className="ts-row">
        <select
          className="ts-select"
          style={{ width: 170 }}
          value={saved.lang}
          onChange={(e) => setSaved((p) => ({ ...p, lang: e.target.value }))}
        >
          {LANGS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <button type="button" className="ts-btn primary" onClick={() => run(false)}>
          {tx(locale, "Escape →", "转义 →")}
        </button>
        <button type="button" className="ts-btn" onClick={() => run(true)}>
          {tx(locale, "← Unescape", "← 反转义")}
        </button>
      </div>

      <textarea
        className="ts-textarea mono"
        rows={6}
        value={saved.input}
        onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))}
      />
      {err && <div className="ts-err">{err}</div>}
      <textarea
        className="ts-textarea mono"
        rows={6}
        readOnly
        value={output}
        placeholder={tx(locale, "Output...", "输出...")}
      />
    </div>
  );
}
