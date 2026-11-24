import { useMemo, useRef, useState } from "react";
import { copyToClipboard, openHostFile, saveHostFile } from "../bridge";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export default function ImageConvertTool({ locale }: ToolProps) {
  const [srcUrl, setSrcUrl] = useState<string>("");
  const [srcName, setSrcName] = useState("image.png");
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [targetW, setTargetW] = useState(0);
  const [targetH, setTargetH] = useState(0);
  const [lockAspect, setLockAspect] = useState(true);
  const [targetMime, setTargetMime] = useState("image/png");
  const [quality, setQuality] = useState(0.92);
  const [zoomPct, setZoomPct] = useState(100);
  const [dataUrlMode, setDataUrlMode] = useState<"base64" | "svgUtf8" | "css">("base64");
  const [b64Input, setB64Input] = useState("");
  const [svgSource, setSvgSource] = useState("");
  const [showSvgInput, setShowSvgInput] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDataUrl = (url: string, rawSvg?: string) => {
    const t = url.trim();
    const effective =
      t.startsWith("<svg") || t.startsWith("<?xml")
        ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(t)}`
        : t.startsWith("data:")
          ? t
          : `data:image/png;base64,${t}`;
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 256;
      const h = img.naturalHeight || 256;
      setDims({ w, h });
      setTargetW(w);
      setTargetH(h);
      setSrcUrl(effective);
      setB64Input(effective);
      if (rawSvg !== undefined) setSvgSource(rawSvg);
      setErr(null);
    };
    img.onerror = () => setErr(tx(locale, "Could not decode image", "无法解析该图片"));
    img.src = effective;
  };

  const ingestFileBytes = (name: string, bytes: Uint8Array) => {
    setSrcName(name);
    const ext = name.split(".").pop()?.toLowerCase() ?? "png";
    const mime =
      ext === "svg"
        ? "image/svg+xml"
        : ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : ext === "webp"
            ? "image/webp"
            : ext === "gif"
              ? "image/gif"
              : "image/png";
    const rawSvg = ext === "svg" ? new TextDecoder("utf-8").decode(bytes) : "";
    const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
    loadDataUrl(dataUrl, rawSvg);
  };

  const loadFromFile = async () => {
    setErr(null);
    const file = await openHostFile([{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "svg", "gif"] }]);
    if (file) {
      ingestFileBytes(file.name, file.data);
    } else {
      fileRef.current?.click();
    }
  };

  const handleWidthChange = (nextW: number) => {
    const w = Math.max(1, Math.min(8192, nextW || 1));
    setTargetW(w);
    if (lockAspect && dims && dims.w > 0) {
      setTargetH(Math.max(1, Math.round((w * dims.h) / dims.w)));
    }
  };

  const handleHeightChange = (nextH: number) => {
    const h = Math.max(1, Math.min(8192, nextH || 1));
    setTargetH(h);
    if (lockAspect && dims && dims.h > 0) {
      setTargetW(Math.max(1, Math.round((h * dims.w) / dims.h)));
    }
  };

  const convertAndSave = async () => {
    if (!srcUrl || !dims) return;
    setErr(null);
    const img = new Image();
    img.onload = async () => {
      const w = Math.max(1, targetW || dims.w);
      const h = Math.max(1, targetH || dims.h);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (targetMime === "image/jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        async (blob) => {
          if (!blob) {
            setErr(tx(locale, "Format conversion failed", "格式转换失败"));
            return;
          }
          const ext = targetMime === "image/jpeg" ? "jpg" : targetMime === "image/webp" ? "webp" : "png";
          const base = srcName.replace(/\.[^.]+$/, "") || "converted";
          const savedPath = await saveHostFile(`${base}.${ext}`, blob, [{ name: ext.toUpperCase(), extensions: [ext] }]);
          if (savedPath) setStatus(tx(locale, `Saved ${savedPath}`, `已保存 ${savedPath}`));
        },
        targetMime,
        quality,
      );
    };
    img.src = srcUrl;
  };

  const formattedOutput = useMemo(() => {
    if (!b64Input) return "";
    if (dataUrlMode === "base64") return b64Input;
    if (dataUrlMode === "svgUtf8" && svgSource.trim()) {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgSource.trim())}`;
    }
    if (dataUrlMode === "css") {
      return `background-image: url("${b64Input}");`;
    }
    return b64Input;
  }, [b64Input, dataUrlMode, svgSource]);

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Image Converter & Base64", "图片格式转换与 Base64")}</span>
        <div className="ts-row">
          <button type="button" className="ts-btn primary" onClick={loadFromFile}>
            {tx(locale, "Open Image...", "打开图片...")}
          </button>
          <button type="button" className="ts-btn" disabled={!srcUrl} onClick={convertAndSave}>
            {tx(locale, "Export Converted...", "导出转换图片...")}
          </button>
          <button
            type="button"
            className="ts-btn"
            disabled={!formattedOutput}
            onClick={async () => {
              await copyToClipboard(formattedOutput);
              setStatus(tx(locale, "Copied", "已复制"));
              setTimeout(() => setStatus(null), 1300);
            }}
          >
            {tx(locale, "Copy Output", "复制结果")}
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) ingestFileBytes(f.name, new Uint8Array(await f.arrayBuffer()));
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
          if (f) ingestFileBytes(f.name, new Uint8Array(await f.arrayBuffer()));
        }}
        onClick={loadFromFile}
      >
        <span style={{ fontSize: 11.5, color: "var(--ts-fg-muted)" }}>
          {srcUrl
            ? `${srcName}${dims ? ` (${dims.w} × ${dims.h})` : ""} — ${tx(locale, "Drop another image or click to replace", "拖拽图片至此或点击替换")}`
            : tx(locale, "Drop PNG / JPEG / WebP / SVG / GIF image here or click to browse", "将 PNG / JPEG / WebP / SVG 图片拖拽至此，或点击选择文件")}
        </span>
      </div>

      <div className="ts-row">
        <select className="ts-select" style={{ width: 95 }} value={targetMime} onChange={(e) => setTargetMime(e.target.value)}>
          <option value="image/png">PNG</option>
          <option value="image/jpeg">JPEG</option>
          <option value="image/webp">WebP</option>
        </select>
        <label className="ts-row" style={{ gap: 4 }}>
          <span className="ts-label">W:</span>
          <input type="number" className="ts-input mono" style={{ width: 64 }} min={1} max={8192} value={targetW || ""} onChange={(e) => handleWidthChange(Number(e.target.value))} />
        </label>
        <label className="ts-row" style={{ gap: 4 }}>
          <span className="ts-label">H:</span>
          <input type="number" className="ts-input mono" style={{ width: 64 }} min={1} max={8192} value={targetH || ""} onChange={(e) => handleHeightChange(Number(e.target.value))} />
        </label>
        <label className="ts-inline-check">
          <input type="checkbox" checked={lockAspect} onChange={(e) => setLockAspect(e.target.checked)} />
          {tx(locale, "Lock Ratio", "锁定比例")}
        </label>
        {targetMime !== "image/png" && (
          <label className="ts-inline-check">
            {tx(locale, "Quality", "质量")}
            <input type="number" className="ts-input mono" style={{ width: 58 }} min={0.1} max={1} step={0.05} value={quality} onChange={(e) => setQuality(Number(e.target.value) || 0.92)} />
          </label>
        )}
        <button type="button" className={`ts-pill ${showSvgInput ? "active" : ""}`} onClick={() => setShowSvgInput((v) => !v)}>
          {tx(locale, "Paste SVG Source", "粘贴 SVG 源码")}
        </button>
        {status && <span className="ts-badge good">{status}</span>}
      </div>

      {showSvgInput && (
        <textarea
          className="ts-textarea mono"
          rows={4}
          value={svgSource}
          onChange={(e) => {
            setSvgSource(e.target.value);
            if (e.target.value.includes("<svg")) {
              setSrcName("pasted.svg");
              loadDataUrl(e.target.value, e.target.value);
            }
          }}
          placeholder='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">...</svg>'
        />
      )}

      {err && <div className="ts-err">{err}</div>}

      {srcUrl && (
        <div className="ts-box ts-col" style={{ gap: 6 }}>
          <div className="ts-row" style={{ justifyContent: "space-between" }}>
            <span className="ts-label">{tx(locale, "Scrollable Zoom Preview", "可滚动缩放预览")}</span>
            <div className="ts-row">
              {[50, 100, 150, 200].map((z) => (
                <button key={z} type="button" className={`ts-pill ${zoomPct === z ? "active" : ""}`} onClick={() => setZoomPct(z)}>
                  {z}%
                </button>
              ))}
            </div>
          </div>
          <div style={{ maxHeight: 260, overflow: "auto", textAlign: "center", padding: 8, background: "repeating-conic-gradient(rgba(128,128,128,0.12) 0% 25%, transparent 0% 50%) 50% / 14px 14px" }}>
            <img
              src={srcUrl}
              alt={tx(locale, "Image Preview", "图片预览")}
              style={{
                width: dims ? `${Math.max(16, Math.round((dims.w * zoomPct) / 100))}px` : "auto",
                height: "auto",
                maxWidth: zoomPct <= 100 ? "100%" : "none",
              }}
            />
          </div>
        </div>
      )}

      <div className="ts-row">
        <span className="ts-label">{tx(locale, "Data URL / Snippet:", "输出格式:")}</span>
        <button type="button" className={`ts-pill ${dataUrlMode === "base64" ? "active" : ""}`} onClick={() => setDataUrlMode("base64")}>
          Base64 Data URL
        </button>
        {svgSource && (
          <button type="button" className={`ts-pill ${dataUrlMode === "svgUtf8" ? "active" : ""}`} onClick={() => setDataUrlMode("svgUtf8")}>
            SVG UTF-8 Data URL
          </button>
        )}
        <button type="button" className={`ts-pill ${dataUrlMode === "css" ? "active" : ""}`} onClick={() => setDataUrlMode("css")}>
          CSS background-image
        </button>
      </div>

      <textarea
        className="ts-textarea mono"
        rows={4}
        value={formattedOutput || b64Input}
        onChange={(e) => {
          setB64Input(e.target.value);
          if (e.target.value.trim()) loadDataUrl(e.target.value);
        }}
        placeholder={tx(locale, "Data URL / Base64 / <svg> source...", "粘贴 Data URL / Base64 / SVG 文本...")}
      />
    </div>
  );
}
