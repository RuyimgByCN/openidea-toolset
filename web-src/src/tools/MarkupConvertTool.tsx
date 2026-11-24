import { useEffect, useState } from "react";
import { bridge, saveHostFile } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

const SAMPLE_MD = `# OpenIDEA Toolset

All-in-one **offline** developer toolbox with *zero high-risk permissions*.

- Supports \`Markdown\`, \`HTML\`, \`BBCode\`, and \`AsciiDoc\`
- [OpenIDEA Repo](https://github.com/l0ng-ai/openidea)

\`\`\`rust
fn main() {
    println!("Hello Toolset!");
}
\`\`\``;

export default function MarkupConvertTool({ tabId, locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState(`markup-${tabId}`, {
    from: "markdown",
    to: "html",
    input: SAMPLE_MD,
    previewHtml: false,
  });
  const [output, setOutput] = useState("");
  const [safePreviewHtml, setSafePreviewHtml] = useState("");
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
        const res = await bridge.rpc<{ result: string }>("markup.convert", {
          text: saved.input,
          from: saved.from,
          to: saved.to,
        });
        setOutput(res.result);
        if (saved.previewHtml) {
          const prevRes =
            saved.to === "html"
              ? res
              : await bridge.rpc<{ result: string }>("markup.convert", {
                  text: saved.input,
                  from: saved.from,
                  to: "html",
                });
          setSafePreviewHtml(prevRes.result);
        }
        setErr(null);
      } catch (e) {
        setErr((e as Error).message);
      }
    }, 90);
    return () => clearTimeout(t);
  }, [saved.input, saved.from, saved.to, saved.previewHtml]);

  const swap = () => {
    setSaved((p) => ({ ...p, from: p.to, to: p.from, input: output || p.input }));
  };

  const extFor = (f: string) => (f === "markdown" ? "md" : f === "asciidoc" ? "adoc" : f === "bbcode" ? "txt" : "html");

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Markup Converter", "文档格式互转")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, input: t }))}
          onPaste={(t) => setSaved((p) => ({ ...p, input: t }))}
          outputText={output}
          openTabTitle={tx(locale, `Converted ${saved.to}`, `转换结果 (${saved.to})`)}
          openTabLanguage={saved.to === "html" ? "html" : "markdown"}
          openTabFileName={`converted.${extFor(saved.to)}`}
          diffLeft={saved.input}
          diffRight={output}
        />
      </div>

      <div className="ts-row">
        <select className="ts-select" style={{ width: 130 }} value={saved.from} onChange={(e) => setSaved((p) => ({ ...p, from: e.target.value }))}>
          <option value="markdown">Markdown</option>
          <option value="html">HTML</option>
          <option value="bbcode">BBCode</option>
          <option value="asciidoc">AsciiDoc</option>
        </select>
        <button type="button" className="ts-btn" onClick={swap}>⇄ {tx(locale, "Swap", "互换")}</button>
        <select className="ts-select" style={{ width: 130 }} value={saved.to} onChange={(e) => setSaved((p) => ({ ...p, to: e.target.value }))}>
          <option value="markdown">Markdown</option>
          <option value="html">HTML</option>
          <option value="bbcode">BBCode</option>
          <option value="asciidoc">AsciiDoc</option>
        </select>
        <button
          type="button"
          className={`ts-pill ${saved.previewHtml ? "active" : ""}`}
          onClick={() => setSaved((p) => ({ ...p, previewHtml: !p.previewHtml }))}
        >
          {tx(locale, "Safe HTML Preview", "安全 HTML 预览")}
        </button>
        <button
          type="button"
          className="ts-btn sm"
          disabled={!output}
          onClick={() => saveHostFile(`converted.${extFor(saved.to)}`, output)}
        >
          {tx(locale, "Save File", "保存文件")}
        </button>
      </div>

      {err && <div className="ts-err">{err}</div>}

      <div className="ts-split">
        <textarea className="ts-textarea mono" rows={11} value={saved.input} onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))} />
        {saved.previewHtml ? (
          <div className="ts-preview-html" dangerouslySetInnerHTML={{ __html: safePreviewHtml }} />
        ) : (
          <textarea className="ts-textarea mono" rows={11} readOnly value={output} />
        )}
      </div>
    </div>
  );
}
