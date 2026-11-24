import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

const FONTS = ["Standard", "Big", "Slant", "Shadow", "Doom", "Banner", "Small", "Mini", "Block", "Bubble"];

const WRAPPERS = [
  { id: "", en: "No comment wrapper", zh: "无注释包装" },
  { id: "//", en: "// Line comment", zh: "// 单行注释" },
  { id: "#", en: "# Hash comment", zh: "# 井号注释" },
  { id: "--", en: "-- SQL / Lua", zh: "-- SQL / Lua 注释" },
  { id: "/*", en: "/* Block */", zh: "/* 块注释 */" },
  { id: "<!--", en: "<!-- XML/HTML -->", zh: "<!-- XML/HTML -->" },
];

export default function AsciiArtTool({ locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("ascii-art", {
    text: "OPENIDEA",
    font: "Slant",
    commentWrap: "",
  });
  const [output, setOutput] = useState("");

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, text: initialInput.slice(0, 64) }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  useEffect(() => {
    if (!bridge.isHosted) return;
    bridge
      .rpc<{ result: string }>("gen.asciiArt", { text: saved.text, font: saved.font, commentWrap: saved.commentWrap })
      .then((r) => setOutput(r.result))
      .catch(() => {});
  }, [saved.text, saved.font, saved.commentWrap]);

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "ASCII Art / FIGlet (10 Fonts)", "ASCII 艺术字 (10 种 FIGlet 字体)")}</span>
        <ToolActionBar locale={locale} outputText={output} openTabTitle={tx(locale, "ASCII Art", "ASCII 艺术字")} />
      </div>

      <div className="ts-row">
        <input className="ts-input mono" style={{ flex: 1 }} value={saved.text} onChange={(e) => setSaved((p) => ({ ...p, text: e.target.value }))} placeholder={tx(locale, "Text to render...", "输入要渲染的文字...")} />
        <select className="ts-select" style={{ width: 120 }} value={saved.font} onChange={(e) => setSaved((p) => ({ ...p, font: e.target.value }))}>
          {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className="ts-select" style={{ width: 145 }} value={saved.commentWrap} onChange={(e) => setSaved((p) => ({ ...p, commentWrap: e.target.value }))}>
          {WRAPPERS.map((w) => <option key={w.id} value={w.id}>{tx(locale, w.en, w.zh)}</option>)}
        </select>
      </div>

      <pre
        className="ts-box ts-mono"
        style={{
          margin: 0,
          overflowX: "auto",
          whiteSpace: "pre",
          fontSize: 11,
          lineHeight: 1.15,
          minHeight: 140,
        }}
      >
        {output}
      </pre>
    </div>
  );
}
