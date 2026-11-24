import jsQR from "jsqr";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { copyToClipboard, openHostFile, readClipboard, saveHostFile } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

export default function QrCodeTool({ locale, initialInput, initialImageBase64, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("qrcode", {
    text: "https://github.com/l0ng-ai/openidea",
    size: 240,
    ecl: "M" as "L" | "M" | "Q" | "H",
  });
  const [svg, setSvg] = useState("");
  const [decoded, setDecoded] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, text: initialInput }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  useEffect(() => {
    if (initialImageBase64) {
      decodeBase64Png(initialImageBase64);
      onConsumeInitial?.();
    }
  }, [initialImageBase64]);

  useEffect(() => {
    QRCode.toString(saved.text || " ", { type: "svg", width: saved.size, margin: 2, errorCorrectionLevel: saved.ecl })
      .then((s) => { setSvg(s); setErr(null); })
      .catch((e: Error) => setErr(e.message));
  }, [saved.text, saved.size, saved.ecl]);

  const decodeBase64Png = (b64: string) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, canvas.width, canvas.height);
      if (code) {
        setDecoded(code.data);
        setErr(null);
      } else {
        setErr(tx(locale, "No QR code detected in image", "未在图片中识别到二维码"));
      }
    };
    img.onerror = () => setErr(tx(locale, "Could not load QR image", "无法读取图片"));
    img.src = b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
  };

  const scanFile = async () => {
    const file = await openHostFile([{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]);
    if (!file) return;
    let bin = "";
    for (let i = 0; i < file.data.length; i++) bin += String.fromCharCode(file.data[i]);
    decodeBase64Png(btoa(bin));
  };

  const scanClipboard = async () => {
    try {
      const clip = await readClipboard();
      if (clip.imageBase64) {
        decodeBase64Png(clip.imageBase64);
      } else if (clip.text) {
        setSaved((p) => ({ ...p, text: clip.text ?? "" }));
      } else {
        setErr(tx(locale, "Clipboard has no image or text", "剪贴板中没有图片或文本"));
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const savePng = async () => {
    const dataUrl = await QRCode.toDataURL(saved.text || " ", { width: saved.size * 2, margin: 2, errorCorrectionLevel: saved.ecl });
    const bin = atob(dataUrl.split(",")[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await saveHostFile("qrcode.png", bytes, [{ name: "PNG", extensions: ["png"] }]);
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "QR Code Generator & Scanner", "二维码生成与识别")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, text: t }))}
          outputText={decoded || saved.text}
        />
      </div>

      <textarea className="ts-textarea mono" rows={3} value={saved.text} onChange={(e) => setSaved((p) => ({ ...p, text: e.target.value }))} />

      <div className="ts-row">
        <select className="ts-select" style={{ width: 95 }} value={saved.ecl} onChange={(e) => setSaved((p) => ({ ...p, ecl: e.target.value as "L" | "M" | "Q" | "H" }))}>
          <option value="L">{tx(locale, "ECL: L", "容错: L")}</option>
          <option value="M">{tx(locale, "ECL: M", "容错: M")}</option>
          <option value="Q">{tx(locale, "ECL: Q", "容错: Q")}</option>
          <option value="H">{tx(locale, "ECL: H", "容错: H")}</option>
        </select>
        <button type="button" className="ts-btn sm" onClick={() => saveHostFile("qrcode.svg", svg, [{ name: "SVG", extensions: ["svg"] }])}>
          {tx(locale, "Save SVG", "保存 SVG")}
        </button>
        <button type="button" className="ts-btn sm" onClick={savePng}>
          {tx(locale, "Save PNG", "保存 PNG")}
        </button>
        <button type="button" className="ts-btn sm primary" onClick={scanFile}>
          {tx(locale, "Scan Image...", "扫码图片...")}
        </button>
        <button type="button" className="ts-btn sm" onClick={scanClipboard}>
          {tx(locale, "Scan Clipboard", "识别剪贴板")}
        </button>
      </div>

      {err && <div className="ts-err">{err}</div>}
      {svg && (
        <div className="ts-box" style={{ display: "flex", justifyContent: "center", background: "#ffffff" }}>
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      )}

      {decoded && (
        <div className="ts-box ts-col">
          <div className="ts-row" style={{ justifyContent: "space-between" }}>
            <strong>{tx(locale, "Decoded QR Content", "识别结果")}</strong>
            <button type="button" className="ts-btn sm" onClick={() => copyToClipboard(decoded)}>
              {tx(locale, "Copy", "复制")}
            </button>
          </div>
          <textarea className="ts-textarea mono" rows={3} readOnly value={decoded} />
        </div>
      )}
    </div>
  );
}
