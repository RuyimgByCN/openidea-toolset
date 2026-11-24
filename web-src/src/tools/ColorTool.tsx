import { useEffect, useState } from "react";
import { bridge, copyToClipboard } from "../bridge";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

interface ColorData {
  color: {
    hex: string;
    hexa: string;
    rgb: string;
    rgba: string;
    hsl: string;
    hsv: string;
    cmyk: string;
    contrastWhite: number;
    contrastBlack: number;
  };
  customContrast: number | null;
}

export default function ColorTool({ locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("color", {
    color: "#3574F0",
    background: "#1E1F22",
  });
  const [res, setRes] = useState<ColorData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, color: initialInput.trim() }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  useEffect(() => {
    if (!bridge.isHosted) return;
    bridge
      .rpc<ColorData>("convert.color", { color: saved.color, background: saved.background })
      .then((d) => { setRes(d); setErr(null); })
      .catch((e) => setErr((e as Error).message));
  }, [saved.color, saved.background]);

  const wcag = (ratio: number) =>
    ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? tx(locale, "AA Large", "AA 大号") : tx(locale, "Fail", "不达标");

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Color & Contrast", "颜色转换与对比度")}</span>
      </div>

      <div className="ts-row">
        <input
          type="color"
          value={res?.color.hex ?? "#3574F0"}
          onChange={(e) => setSaved((p) => ({ ...p, color: e.target.value.toUpperCase() }))}
          style={{ width: 40, height: 28, padding: 0, border: "1px solid var(--ts-border)", background: "transparent", cursor: "pointer" }}
        />
        <input
          className="ts-input mono"
          style={{ flex: 1 }}
          value={saved.color}
          onChange={(e) => setSaved((p) => ({ ...p, color: e.target.value }))}
          placeholder="#3574F0, rgb(53,116,240), hsl(220,86%,57%)"
        />
        <input
          className="ts-input mono"
          style={{ width: 120 }}
          value={saved.background}
          onChange={(e) => setSaved((p) => ({ ...p, background: e.target.value }))}
          placeholder={tx(locale, "BG #1E1F22", "背景色 #1E1F22")}
        />
      </div>

      {err && <div className="ts-err">{err}</div>}
      {res && (
        <div className="ts-col">
          <div
            className="ts-box"
            style={{
              background: saved.background || "#1E1F22",
              color: res.color.hex,
              fontWeight: 600,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>{tx(locale, "Sample Preview Text AaBbCc 123", "对比度预览文本 AaBbCc 123")}</span>
            {res.customContrast != null && (
              <span className={`ts-badge ${res.customContrast >= 4.5 ? "good" : "bad"}`}>
                {res.customContrast}:1 ({wcag(res.customContrast)})
              </span>
            )}
          </div>

          <div className="ts-box ts-kv">
            {[
              ["HEX", res.color.hex],
              ["HEXA", res.color.hexa],
              ["RGB", res.color.rgb],
              ["RGBA", res.color.rgba],
              ["HSL", res.color.hsl],
              ["HSV", res.color.hsv],
              ["CMYK", res.color.cmyk],
              [tx(locale, "vs White", "对比白色"), `${res.color.contrastWhite}:1 (${wcag(res.color.contrastWhite)})`],
              [tx(locale, "vs Black", "对比黑色"), `${res.color.contrastBlack}:1 (${wcag(res.color.contrastBlack)})`],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <span className="ts-kv-key">{k}</span>
                <div className="ts-row" style={{ justifyContent: "space-between" }}>
                  <span className="ts-kv-val">{v}</span>
                  <button type="button" className="ts-btn sm" onClick={() => copyToClipboard(v)}>
                    {tx(locale, "Copy", "复制")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
