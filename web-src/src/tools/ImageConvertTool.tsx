import { useState } from "react";
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
  const [targetMime, setTargetMime] = useState("image/png");
  const [quality, setQuality] = useState(0.92);
  const [scalePct, setScalePct] = useState(100);
  const [b64Input, setB64Input] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const loadFromFile = async () => {
    setErr(null);
    const file = await openHostFile([{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "svg", "gif"] }]);
    if (!file) return;
    setSrcName(file.name);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
    const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
    const dataUrl = `data:${mime};base64,${bytesToBase64(file.data)}`;
    loadDataUrl(dataUrl);
  };

  const loadDataUrl = (url: string) => {
    const img = new Image();
    img.onload = () => {
      setDims({ w: img.naturalWidth || 256, h: img.naturalHeight || 256 });
      setSrcUrl(url);
      setB64Input(url);
      setErr(null);
    };
    img.onerror = () => setErr(tx(locale, "Could not decode image", "无法解析该图片"));
    img.src = url.startsWith("data:") ? url : `data:image/png;base64,${url.trim()}`;
  };

  const convertAndSave = async () => {
    if (!srcUrl || !dims) return;
    setErr(null);
    const img = new Image();
    img.onload = async () => {
      const w = Math.max(1, Math.round((dims.w * scalePct) / 100));
      const h = Math.max(1, Math.round((dims.h * scalePct) / 100));
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
          await saveHostFile(`${base}.${ext}`, blob, [{ name: ext.toUpperCase(), extensions: [ext] }]);
        },
        targetMime,
        quality,
      );
    };
    img.src = srcUrl;
  };

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
          <button type="button" className="ts-btn" disabled={!b64Input} onClick={() => copyToClipboard(b64Input)}>
            {tx(locale, "Copy Data URL", "复制 Data URL")}
          </button>
        </div>
      </div>

      <div className="ts-row">
        <select className="ts-select" style={{ width: 135 }} value={targetMime} onChange={(e) => setTargetMime(e.target.value)}>
          <option value="image/png">PNG</option>
          <option value="image/jpeg">JPEG</option>
          <option value="image/webp">WebP</option>
        </select>
        <label className="ts-inline-check">
          {tx(locale, "Scale %", "缩放 %")}
          <input type="number" className="ts-input mono" style={{ width: 70 }} min={5} max={400} value={scalePct} onChange={(e) => setScalePct(Number(e.target.value) || 100)} />
        </label>
        {targetMime !== "image/png" && (
          <label className="ts-inline-check">
            {tx(locale, "Quality", "质量")}
            <input type="number" className="ts-input mono" style={{ width: 65 }} min={0.1} max={1} step={0.05} value={quality} onChange={(e) => setQuality(Number(e.target.value) || 0.92)} />
          </label>
        )}
        {dims && <span className="ts-badge">{dims.w} × {dims.h}</span>}
      </div>

      {err && <div className="ts-err">{err}</div>}
      {srcUrl && (
        <div className="ts-box" style={{ textAlign: "center", maxHeight: 200, overflow: "auto" }}>
          <img src={srcUrl} alt="Preview" style={{ maxWidth: "100%", maxHeight: 180, objectFit: "contain" }} />
        </div>
      )}

      <label className="ts-label">
        {tx(locale, "Data URL / Base64 (paste to preview)", "Data URL / Base64（粘贴可预览）")}
        <textarea
          className="ts-textarea mono"
          rows={5}
          value={b64Input}
          onChange={(e) => { setB64Input(e.target.value); if (e.target.value.trim()) loadDataUrl(e.target.value); }}
        />
      </label>
    </div>
  );
}
