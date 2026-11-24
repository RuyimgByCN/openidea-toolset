import { useMemo, useState } from "react";
import { copyToClipboard, saveHostFile } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";
import { encodeBarcode, renderBarcodeSvg, type BarcodeFormat } from "../utils/barcode";

const FORMATS: Array<{ id: BarcodeFormat; label: string; sample: string; hintEn: string; hintZh: string }> = [
  { id: "code128", label: "Code 128", sample: "OpenIDEA-2026", hintEn: "Printable ASCII characters", hintZh: "支持全部可见 ASCII 字符" },
  { id: "code39", label: "Code 39", sample: "OPENIDEA-39", hintEn: "0-9, A-Z, - . $ / + % SPACE", hintZh: "支持 0-9、A-Z、-.$/+% 与空格" },
  { id: "ean13", label: "EAN-13", sample: "690123456789", hintEn: "12 or 13 digits (auto check digit)", hintZh: "12 位自动补校验位或 13 位数字" },
  { id: "ean8", label: "EAN-8", sample: "6901234", hintEn: "7 or 8 digits (auto check digit)", hintZh: "7 位自动补校验位或 8 位数字" },
  { id: "upca", label: "UPC-A", sample: "03600029145", hintEn: "11 or 12 digits (auto check digit)", hintZh: "11 位自动补校验位或 12 位数字" },
  { id: "itf", label: "ITF (2-of-5)", sample: "1234567890", hintEn: "Even number of digits (0-9)", hintZh: "偶数位纯数字 (0-9)" },
  { id: "codabar", label: "Codabar", sample: "A123456A", hintEn: "0-9 - $ : / . + wrapped in A-D", hintZh: "支持 0-9 -$:/.+，起止符 A-D" },
];

export default function BarcodeTool({ tabId, locale }: ToolProps) {
  const [saved, setSaved] = useToolState(`barcode-${tabId}`, {
    format: "code128" as BarcodeFormat,
    input: "OpenIDEA-2026",
    batchMode: false,
    barWidth: 2,
    height: 84,
    showText: true,
    fgColor: "#111111",
    bgColor: "#ffffff",
  });
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fmtMeta = FORMATS.find((f) => f.id === saved.format) || FORMATS[0];

  const items = useMemo(() => {
    const lines = saved.batchMode
      ? saved.input
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [saved.input];
    return lines.map((line) => {
      try {
        const res = encodeBarcode(saved.format, line);
        const svg = renderBarcodeSvg(res, {
          barWidth: saved.barWidth,
          height: saved.height,
          showText: saved.showText,
          fgColor: saved.fgColor,
          bgColor: saved.bgColor,
        });
        return {
          raw: line,
          value: res.value,
          svg,
          dataUri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
          error: null as string | null,
        };
      } catch (e) {
        return { raw: line, value: line, svg: "", dataUri: "", error: (e as Error).message };
      }
    });
  }, [saved]);

  const handleFormatChange = (nextFmt: BarcodeFormat) => {
    const prevSample = fmtMeta.sample;
    const nextMeta = FORMATS.find((f) => f.id === nextFmt) || FORMATS[0];
    setSaved((p) => ({
      ...p,
      format: nextFmt,
      input: !p.batchMode && (p.input === prevSample || !p.input.trim()) ? nextMeta.sample : p.input,
    }));
  };

  const handleSaveSvg = async (svg: string, name: string) => {
    setErr(null);
    try {
      const path = await saveHostFile(`${name}.svg`, svg, [{ name: "SVG", extensions: ["svg"] }]);
      if (path) setStatus(tx(locale, `Saved ${path}`, `已保存 ${path}`));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleSavePng = async (dataUri: string, name: string) => {
    setErr(null);
    try {
      const img = new Image();
      const bytes = await new Promise<Uint8Array>((resolve, reject) => {
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, img.naturalWidth || 320);
          canvas.height = Math.max(1, img.naturalHeight || 120);
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Canvas unavailable"));
            return;
          }
          ctx.fillStyle = saved.bgColor || "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          canvas.toBlob(async (blob) => {
            if (!blob) {
              reject(new Error("Failed to render PNG"));
              return;
            }
            const buf = await blob.arrayBuffer();
            resolve(new Uint8Array(buf));
          }, "image/png");
        };
        img.onerror = () => reject(new Error("Failed to decode barcode SVG"));
        img.src = dataUri;
      });
      const path = await saveHostFile(`${name}.png`, bytes, [{ name: "PNG", extensions: ["png"] }]);
      if (path) setStatus(tx(locale, `Saved ${path}`, `已保存 ${path}`));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const firstOk = items.find((i) => !i.error);

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "1D Barcode Generator", "一维条形码生成器")}</span>
        <ToolActionBar
          locale={locale}
          onPaste={(t) => setSaved((p) => ({ ...p, input: t }))}
          outputText={items.filter((i) => i.svg).map((i) => i.svg).join("\n")}
          openTabTitle="Barcode SVG"
          openTabLanguage="xml"
          openTabFileName={`${saved.format}.svg`}
          onStatus={(m) => setStatus(m)}
        />
      </div>

      <div className="ts-row">
        <select
          className="ts-select"
          value={saved.format}
          onChange={(e) => handleFormatChange(e.target.value as BarcodeFormat)}
        >
          {FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ts-btn sm"
          onClick={() => setSaved((p) => ({ ...p, input: fmtMeta.sample }))}
        >
          {tx(locale, "Sample", "示例值")}
        </button>
        <label className="ts-inline-check">
          <input
            type="checkbox"
            checked={saved.batchMode}
            onChange={(e) => setSaved((p) => ({ ...p, batchMode: e.target.checked }))}
          />
          {tx(locale, "Batch (one per line)", "批量模式（每行一条）")}
        </label>
        <label className="ts-inline-check">
          <input
            type="checkbox"
            checked={saved.showText}
            onChange={(e) => setSaved((p) => ({ ...p, showText: e.target.checked }))}
          />
          {tx(locale, "Show Text", "显示数字文本")}
        </label>
      </div>

      <div className="ts-row">
        <span className="ts-label">{tx(locale, "Bar Width", "条宽")}</span>
        <input
          type="number"
          min={1}
          max={5}
          className="ts-input mono"
          style={{ width: 56 }}
          value={saved.barWidth}
          onChange={(e) => setSaved((p) => ({ ...p, barWidth: Math.max(1, Math.min(5, Number(e.target.value) || 2)) }))}
        />
        <span className="ts-label">{tx(locale, "Height", "高度")}</span>
        <input
          type="number"
          min={24}
          max={220}
          className="ts-input mono"
          style={{ width: 64 }}
          value={saved.height}
          onChange={(e) => setSaved((p) => ({ ...p, height: Math.max(24, Math.min(220, Number(e.target.value) || 84)) }))}
        />
        <span className="ts-label">{tx(locale, "FG", "前景色")}</span>
        <input type="color" value={saved.fgColor} onChange={(e) => setSaved((p) => ({ ...p, fgColor: e.target.value }))} />
        <span className="ts-label">{tx(locale, "BG", "背景色")}</span>
        <input type="color" value={saved.bgColor} onChange={(e) => setSaved((p) => ({ ...p, bgColor: e.target.value }))} />
        <span className="ts-label" style={{ color: "var(--ts-fg-muted)" }}>
          {tx(locale, fmtMeta.hintEn, fmtMeta.hintZh)}
        </span>
      </div>

      {saved.batchMode ? (
        <textarea
          className="ts-textarea mono"
          rows={4}
          value={saved.input}
          onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))}
          placeholder={tx(locale, "One barcode value per line...", "每行输入一个条形码内容...")}
        />
      ) : (
        <input
          className="ts-input mono"
          value={saved.input}
          onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))}
          placeholder={fmtMeta.sample}
        />
      )}

      {firstOk && (
        <div className="ts-row">
          <button
            type="button"
            className="ts-btn"
            onClick={async () => {
              await copyToClipboard(firstOk.svg);
              setStatus(tx(locale, "Copied SVG markup", "已复制 SVG 代码"));
            }}
          >
            {tx(locale, "Copy SVG", "复制 SVG")}
          </button>
          <button type="button" className="ts-btn" onClick={() => handleSaveSvg(firstOk.svg, `${saved.format}-${firstOk.value}`)}>
            {tx(locale, "Save SVG", "导出 SVG")}
          </button>
          <button type="button" className="ts-btn primary" onClick={() => handleSavePng(firstOk.dataUri, `${saved.format}-${firstOk.value}`)}>
            {tx(locale, "Save PNG", "导出 PNG")}
          </button>
        </div>
      )}

      {err && <div className="ts-err">{err}</div>}
      {status && <div className="ts-ok">{status}</div>}

      <div className="ts-col" style={{ gap: 8 }}>
        {items.map((item, i) => (
          <div key={i} className="ts-box" style={{ textAlign: "center" }}>
            {item.error ? (
              <div className="ts-err">
                {item.raw || "(empty)"}: {item.error}
              </div>
            ) : (
              <div className="ts-col" style={{ alignItems: "center", gap: 6 }}>
                <img
                  src={item.dataUri}
                  alt={item.value}
                  style={{ maxWidth: "100%", height: "auto", borderRadius: 4, border: "1px solid var(--ts-border)" }}
                />
                {saved.batchMode && (
                  <div className="ts-row">
                    <span className="ts-mono" style={{ fontSize: 12 }}>
                      {item.value}
                    </span>
                    <button type="button" className="ts-btn sm" onClick={() => handleSaveSvg(item.svg, `${saved.format}-${item.value}`)}>
                      SVG
                    </button>
                    <button type="button" className="ts-btn sm" onClick={() => handleSavePng(item.dataUri, `${saved.format}-${item.value}`)}>
                      PNG
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
