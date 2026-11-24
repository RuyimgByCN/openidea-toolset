import { useEffect, useMemo, useRef, useState } from "react";
import { copyToClipboard, openHostFile, saveHostFile } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";
import { formatSvg, inspectSvg, minifySvg, svgToJsx } from "../utils/svgTools";

const SAMPLE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" fill="none">
  <!-- OpenIDEA badge -->
  <rect x="8" y="8" width="80" height="80" rx="20" fill="#3574F0"/>
  <path d="M30 48L44 62L68 34" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="48" y="80" text-anchor="middle" font-size="11" fill="#E0EAFF">TOOLSET</text>
</svg>`;

export default function SvgStudioTool({ tabId, locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState(`svg-${tabId}`, {
    svg: SAMPLE_ICON,
    outTab: "min" as "min" | "fmt" | "datauri" | "jsx",
    bgMode: "checker" as "checker" | "light" | "dark",
    zoom: 100,
    compName: "ToolsetBadge",
  });
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, svg: initialInput }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const metrics = useMemo(() => inspectSvg(saved.svg), [saved.svg]);
  const minified = useMemo(() => minifySvg(saved.svg), [saved.svg]);
  const formatted = useMemo(() => formatSvg(saved.svg, 2), [saved.svg]);
  const jsxCode = useMemo(() => svgToJsx(saved.svg, saved.compName), [saved.svg, saved.compName]);

  const outputText =
    saved.outTab === "min"
      ? minified
      : saved.outTab === "fmt"
        ? formatted
        : saved.outTab === "jsx"
          ? jsxCode
          : [
              "# UTF-8 Data URL",
              metrics.dataUriUtf8,
              "",
              "# Base64 Data URL",
              metrics.dataUriBase64,
              "",
              "# CSS Background",
              metrics.cssBackground,
            ].join("\n");

  const loadSvgFile = async () => {
    const f = await openHostFile([{ name: "SVG", extensions: ["svg", "xml"] }]);
    if (f) {
      setSaved((p) => ({ ...p, svg: new TextDecoder("utf-8").decode(f.data) }));
    } else {
      fileRef.current?.click();
    }
  };

  const exportPng = async (scale: number) => {
    setErr(null);
    if (!metrics.dataUriUtf8) return;
    try {
      const img = new Image();
      const bytes = await new Promise<Uint8Array>((resolve, reject) => {
        img.onload = () => {
          const baseW = Math.max(16, img.naturalWidth || 96);
          const baseH = Math.max(16, img.naturalHeight || 96);
          const canvas = document.createElement("canvas");
          canvas.width = baseW * scale;
          canvas.height = baseH * scale;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Canvas unavailable"));
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(async (blob) => {
            if (!blob) {
              reject(new Error("Failed to render PNG"));
              return;
            }
            resolve(new Uint8Array(await blob.arrayBuffer()));
          }, "image/png");
        };
        img.onerror = () => reject(new Error(tx(locale, "Invalid SVG markup", "SVG 渲染失败")));
        img.src = metrics.dataUriUtf8;
      });
      const p = await saveHostFile(`${saved.compName || "icon"}-${scale}x.png`, bytes, [
        { name: "PNG", extensions: ["png"] },
      ]);
      if (p) setStatus(tx(locale, `Saved ${p}`, `已保存 ${p}`));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const canvasBg =
    saved.bgMode === "light"
      ? "#ffffff"
      : saved.bgMode === "dark"
        ? "#1e1f22"
        : "repeating-conic-gradient(rgba(128,128,128,0.16) 0% 25%, transparent 0% 50%) 50% / 14px 14px";

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "SVG Optimizer & JSX/CSS Studio", "SVG 压缩预览与 JSX/CSS 转换")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, svg: t }))}
          onPaste={(t) => setSaved((p) => ({ ...p, svg: t }))}
          outputText={outputText}
          openTabTitle={saved.outTab === "jsx" ? `${saved.compName || "SvgIcon"}.tsx` : "optimized.svg"}
          openTabLanguage={saved.outTab === "jsx" ? "typescriptreact" : "xml"}
          onClear={() => setSaved((p) => ({ ...p, svg: "" }))}
        />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".svg,image/svg+xml"
        style={{ display: "none" }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            const text = await f.text();
            setSaved((p) => ({ ...p, svg: text }));
          }
          e.target.value = "";
        }}
      />

      <div
        className={`ts-dropzone ${dragOver ? "active" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) {
            const text = await f.text();
            setSaved((p) => ({ ...p, svg: text }));
          }
        }}
        onClick={loadSvgFile}
      >
        <span style={{ fontSize: 11.5, color: "var(--ts-fg-muted)" }}>
          {tx(locale, "Drop an .svg file here or click to open from disk", "将 .svg 文件拖拽至此，或点击从本地打开")}
        </span>
      </div>

      <div className="ts-row">
        <span className="ts-badge">viewBox: {metrics.viewBox}</span>
        <span className="ts-badge">{metrics.width} × {metrics.height}</span>
        <span className="ts-badge">{metrics.totalElements} {tx(locale, "nodes", "个节点")}</span>
        <span className="ts-badge good">
          {metrics.originalBytes} B → {metrics.minifiedBytes} B (-{metrics.savedPct}%)
        </span>
        {status && <span className="ts-badge good">{status}</span>}
      </div>

      {err && <div className="ts-err">{err}</div>}

      <div className="ts-split" style={{ alignItems: "stretch" }}>
        <textarea
          className="ts-textarea mono"
          style={{ flex: 1 }}
          rows={8}
          value={saved.svg}
          onChange={(e) => setSaved((p) => ({ ...p, svg: e.target.value }))}
          placeholder="<svg ...>...</svg>"
        />

        <div className="ts-box ts-col" style={{ flex: 1, gap: 6 }}>
          <div className="ts-row" style={{ justifyContent: "space-between" }}>
            <div className="ts-row">
              {(["checker", "light", "dark"] as const).map((bg) => (
                <button
                  key={bg}
                  type="button"
                  className={`ts-pill ${saved.bgMode === bg ? "active" : ""}`}
                  onClick={() => setSaved((p) => ({ ...p, bgMode: bg }))}
                >
                  {bg === "checker"
                    ? tx(locale, "Grid", "网格")
                    : bg === "light"
                      ? tx(locale, "Light", "浅色")
                      : tx(locale, "Dark", "深色")}
                </button>
              ))}
            </div>
            <div className="ts-row">
              {[50, 100, 150, 200].map((z) => (
                <button
                  key={z}
                  type="button"
                  className={`ts-pill ${saved.zoom === z ? "active" : ""}`}
                  onClick={() => setSaved((p) => ({ ...p, zoom: z }))}
                >
                  {z}%
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 140,
              maxHeight: 220,
              overflow: "auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: canvasBg,
              borderRadius: 4,
              padding: 10,
            }}
          >
            {metrics.dataUriUtf8 ? (
              <img
                src={metrics.dataUriUtf8}
                alt={tx(locale, "SVG Preview", "SVG 预览")}
                style={{ width: `${saved.zoom}%`, maxWidth: saved.zoom <= 100 ? "100%" : "none", maxHeight: saved.zoom <= 100 ? 190 : "none", objectFit: "contain" }}
              />
            ) : (
              <span style={{ fontSize: 11.5, color: "var(--ts-fg-muted)" }}>{tx(locale, "Empty SVG", "空白 SVG")}</span>
            )}
          </div>
        </div>
      </div>

      <div className="ts-row">
        <button type="button" className={`ts-pill ${saved.outTab === "min" ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, outTab: "min" }))}>
          {tx(locale, "Minified SVG", "压缩优化")}
        </button>
        <button type="button" className={`ts-pill ${saved.outTab === "fmt" ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, outTab: "fmt" }))}>
          {tx(locale, "Formatted SVG", "格式化")}
        </button>
        <button type="button" className={`ts-pill ${saved.outTab === "datauri" ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, outTab: "datauri" }))}>
          Data URL & CSS
        </button>
        <button type="button" className={`ts-pill ${saved.outTab === "jsx" ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, outTab: "jsx" }))}>
          React JSX / TSX
        </button>
        {saved.outTab === "jsx" && (
          <input
            className="ts-input mono"
            style={{ width: 140 }}
            value={saved.compName}
            onChange={(e) => setSaved((p) => ({ ...p, compName: e.target.value }))}
            placeholder="SvgIcon"
          />
        )}
        <button type="button" className="ts-btn sm" onClick={() => copyToClipboard(outputText)}>
          {tx(locale, "Copy Output", "复制结果")}
        </button>
        <button type="button" className="ts-btn sm" onClick={() => exportPng(1)}>PNG 1x</button>
        <button type="button" className="ts-btn sm" onClick={() => exportPng(2)}>PNG 2x</button>
        <button type="button" className="ts-btn sm" onClick={() => exportPng(3)}>PNG 3x</button>
      </div>

      <textarea className="ts-textarea mono" rows={6} readOnly value={outputText} />
    </div>
  );
}
