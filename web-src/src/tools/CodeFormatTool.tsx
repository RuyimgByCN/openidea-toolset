import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

export default function CodeFormatTool({ locale, settings, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("code-format", {
    lang: "sql",
    input: "select id, name, email from users where active = 1 and role = 'admin' order by id desc;",
  });
  const [output, setOutput] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, input: initialInput }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const run = async (minify: boolean) => {
    setErr(null);
    try {
      const res = await bridge.rpc<{ result: string }>("format.code", {
        text: saved.input,
        lang: saved.lang,
        minify,
        indent: settings.defaultIndent || "2",
      });
      setOutput(res.result);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "SQL / XML / HTML / CSS Formatter", "SQL / XML / HTML / CSS 格式化")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, input: t }))}
          onPaste={(t) => setSaved((p) => ({ ...p, input: t }))}
          outputText={output}
          openTabTitle={tx(locale, `Formatted ${saved.lang.toUpperCase()}`, `格式化 ${saved.lang.toUpperCase()}`)}
          openTabLanguage={saved.lang}
          openTabFileName={`formatted.${saved.lang}`}
          diffLeft={saved.input}
          diffRight={output}
        />
      </div>

      <div className="ts-row">
        <select className="ts-select" style={{ width: 120 }} value={saved.lang} onChange={(e) => setSaved((p) => ({ ...p, lang: e.target.value }))}>
          <option value="sql">SQL</option>
          <option value="xml">XML</option>
          <option value="html">HTML</option>
          <option value="css">CSS</option>
        </select>
        <button type="button" className="ts-btn primary" onClick={() => run(false)}>
          {tx(locale, "Beautify", "美化")}
        </button>
        <button type="button" className="ts-btn" onClick={() => run(true)}>
          {tx(locale, "Minify", "压缩")}
        </button>
      </div>

      <textarea className="ts-textarea mono" rows={6} value={saved.input} onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))} />
      {err && <div className="ts-err">{err}</div>}
      <textarea className="ts-textarea mono" rows={8} readOnly value={output} />
    </div>
  );
}
