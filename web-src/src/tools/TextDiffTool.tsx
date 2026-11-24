import { useEffect, useMemo } from "react";
import { bridge } from "../bridge";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";
import { computeLineDiff } from "../utils/math";

export default function TextDiffTool({ tabId, locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState(`diff-${tabId}`, {
    left: "line 1\nline 2\nline 3",
    right: "line 1\nline 2 modified\nline 3\nline 4",
    fileName: "compare.txt",
  });

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, left: initialInput }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const diff = useMemo(() => computeLineDiff(saved.left, saved.right), [saved.left, saved.right]);

  const openNative = () => {
    bridge.openDiff({
      left: saved.left,
      right: saved.right,
      leftLabel: tx(locale, "Left (Original)", "左侧（原文本）"),
      rightLabel: tx(locale, "Right (Modified)", "右侧（新文本）"),
      title: tx(locale, "Toolset Diff", "Toolset 文本比对"),
      fileName: saved.fileName || "compare.txt",
    });
  };

  const loadSelection = async (side: "left" | "right") => {
    try {
      const res = await bridge.rpc<{ text: string }>("editor.getSelection", {});
      setSaved((p) => ({ ...p, [side]: res.text }));
    } catch {
      // Ignore if no editor focused
    }
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Text Diff", "文本比对 (Diff)")}</span>
        <div className="ts-row">
          <input
            className="ts-input mono"
            style={{ width: 120 }}
            value={saved.fileName}
            onChange={(e) => setSaved((p) => ({ ...p, fileName: e.target.value }))}
            placeholder={tx(locale, "file.json", "文件名如 file.json")}
          />
          <button type="button" className="ts-btn primary" onClick={openNative}>
            {tx(locale, "Open Native IDE Diff", "打开原生 IDE Diff")}
          </button>
          <button
            type="button"
            className="ts-btn"
            onClick={() => setSaved((p) => ({ ...p, left: p.right, right: p.left }))}
          >
            {tx(locale, "Swap", "交换")}
          </button>
        </div>
      </div>

      <div className="ts-split">
        <div className="ts-col">
          <div className="ts-row" style={{ justifyContent: "space-between" }}>
            <span style={{ fontSize: 11.5, color: "var(--ts-fg-muted)" }}>{tx(locale, "Left", "左侧")}</span>
            <button type="button" className="ts-btn sm" onClick={() => loadSelection("left")}>
              {tx(locale, "From Editor", "取选区")}
            </button>
          </div>
          <textarea
            className="ts-textarea mono"
            rows={5}
            value={saved.left}
            onChange={(e) => setSaved((p) => ({ ...p, left: e.target.value }))}
          />
        </div>
        <div className="ts-col">
          <div className="ts-row" style={{ justifyContent: "space-between" }}>
            <span style={{ fontSize: 11.5, color: "var(--ts-fg-muted)" }}>{tx(locale, "Right", "右侧")}</span>
            <button type="button" className="ts-btn sm" onClick={() => loadSelection("right")}>
              {tx(locale, "From Editor", "取选区")}
            </button>
          </div>
          <textarea
            className="ts-textarea mono"
            rows={5}
            value={saved.right}
            onChange={(e) => setSaved((p) => ({ ...p, right: e.target.value }))}
          />
        </div>
      </div>

      <div className="ts-row">
        <span className="ts-badge good">+{diff.added}</span>
        <span className="ts-badge bad">-{diff.removed}</span>
      </div>

      <div className="ts-box ts-mono" style={{ maxHeight: 240, overflowY: "auto", fontSize: 11.5 }}>
        {diff.lines.map((line, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 8,
              padding: "1px 4px",
              background:
                line.kind === "add"
                  ? "rgba(87, 150, 92, 0.16)"
                  : line.kind === "del"
                    ? "rgba(247, 84, 100, 0.16)"
                    : "transparent",
            }}
          >
            <span style={{ width: 28, color: "var(--ts-fg-muted)", textAlign: "right" }}>{line.leftNo ?? ""}</span>
            <span style={{ width: 28, color: "var(--ts-fg-muted)", textAlign: "right" }}>{line.rightNo ?? ""}</span>
            <span style={{ width: 12 }}>{line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}</span>
            <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
