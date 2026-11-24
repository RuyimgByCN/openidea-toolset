import { useEffect, useMemo, useState } from "react";
import { copyToClipboard } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { isZhLocale, tx } from "../i18n";
import type { ToolProps } from "../types";
import {
  convertUnits,
  formatDurationBreakdown,
  listUnitsForCategory,
  UNIT_CATEGORY_META,
  type UnitCategory,
} from "../utils/units";

const CATEGORIES: UnitCategory[] = [
  "css",
  "duration",
  "length",
  "mass",
  "temperature",
  "area",
  "volume",
  "angle",
];

const DURATION_PRESETS: Array<{ label: string; value: string; unit: string }> = [
  { label: "5 min", value: "5", unit: "min" },
  { label: "1 hour", value: "1", unit: "h" },
  { label: "24 hours", value: "24", unit: "h" },
  { label: "7 days", value: "7", unit: "d" },
  { label: "30 days", value: "30", unit: "d" },
  { label: "86400 s", value: "86400", unit: "s" },
];

export default function UnitConvertTool({ locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("unit-convert", {
    category: "css" as UnitCategory,
    value: "16",
    fromUnit: "px",
    rootPx: 16,
    parentPx: 16,
    vwPx: 1440,
    vhPx: 900,
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      const m = /^\s*(-?[\d.]+)\s*([a-zA-Z%]*)\s*$/.exec(initialInput);
      if (m) {
        const val = m[1];
        const unit = m[2]?.toLowerCase() || "";
        const cssMatches = ["px", "rem", "em", "vw", "vh", "pt", "pc", "cm", "mm", "in"];
        const durMatches = ["ns", "us", "ms", "s", "min", "h", "d", "wk", "mo", "yr"];
        if (unit === "%") {
          setSaved((p) => ({ ...p, category: "css", value: val, fromUnit: "pct" }));
        } else if (cssMatches.includes(unit)) {
          setSaved((p) => ({ ...p, category: "css", value: val, fromUnit: unit }));
        } else if (durMatches.includes(unit)) {
          setSaved((p) => ({ ...p, category: "duration", value: val, fromUnit: unit }));
        } else {
          setSaved((p) => ({ ...p, value: val }));
        }
      }
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const ctx = useMemo(
    () => ({ rootPx: saved.rootPx, parentPx: saved.parentPx, vwPx: saved.vwPx, vhPx: saved.vhPx }),
    [saved.rootPx, saved.parentPx, saved.vwPx, saved.vhPx],
  );
  const unitDefs = useMemo(() => listUnitsForCategory(saved.category, ctx), [saved.category, ctx]);
  const numericVal = Number(saved.value);
  const rows = useMemo(
    () => (saved.value.trim() === "" || Number.isNaN(numericVal) ? [] : convertUnits(saved.category, numericVal, saved.fromUnit, ctx)),
    [saved.category, saved.value, numericVal, saved.fromUnit, ctx],
  );

  const durationSummary = useMemo(() => {
    if (saved.category !== "duration") return "";
    const msRow = rows.find((r) => r.id === "ms");
    return msRow ? formatDurationBreakdown(msRow.raw, isZhLocale(locale)) : "";
  }, [saved.category, rows, locale]);

  const summaryText = rows.map((r) => `${r.formatted} ${r.symbol} (${tx(locale, r.labelEn, r.labelZh)})`).join("\n");

  const handleSelectCat = (cat: UnitCategory) => {
    const meta = UNIT_CATEGORY_META[cat];
    setSaved((p) => ({ ...p, category: cat, fromUnit: meta.defaultUnit, value: meta.defaultValue }));
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Unit & CSS Converter", "工程单位与 CSS 换算")}</span>
        <ToolActionBar
          locale={locale}
          onPaste={(t) => {
            const num = parseFloat(t.trim());
            if (!Number.isNaN(num)) setSaved((p) => ({ ...p, value: String(num) }));
          }}
          outputText={summaryText}
          onClear={() => setSaved((p) => ({ ...p, value: "" }))}
        />
      </div>

      <div className="ts-row">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className={`ts-pill ${saved.category === c ? "active" : ""}`}
            onClick={() => handleSelectCat(c)}
          >
            {tx(locale, UNIT_CATEGORY_META[c].labelEn, UNIT_CATEGORY_META[c].labelZh)}
          </button>
        ))}
      </div>

      <div className="ts-row">
        <input
          className="ts-input mono"
          style={{ width: 170 }}
          value={saved.value}
          onChange={(e) => setSaved((p) => ({ ...p, value: e.target.value }))}
          placeholder={tx(locale, "Enter value...", "输入数值...")}
        />
        <select
          className="ts-select"
          style={{ flex: 1, minWidth: 180 }}
          value={saved.fromUnit}
          onChange={(e) => setSaved((p) => ({ ...p, fromUnit: e.target.value }))}
        >
          {unitDefs.map((u) => (
            <option key={u.id} value={u.id}>
              {u.symbol} — {tx(locale, u.labelEn, u.labelZh)}
            </option>
          ))}
        </select>
        {copiedId && <span className="ts-badge good">{tx(locale, "Copied", "已复制")}</span>}
      </div>

      {saved.category === "css" && (
        <div className="ts-box ts-row" style={{ gap: 8 }}>
          <label className="ts-row" style={{ gap: 4 }}>
            <span className="ts-label">root(rem):</span>
            <input
              type="number"
              className="ts-input mono"
              style={{ width: 62 }}
              value={saved.rootPx}
              onChange={(e) => setSaved((p) => ({ ...p, rootPx: Number(e.target.value) || 16 }))}
            />
          </label>
          <label className="ts-row" style={{ gap: 4 }}>
            <span className="ts-label">parent(em/%):</span>
            <input
              type="number"
              className="ts-input mono"
              style={{ width: 62 }}
              value={saved.parentPx}
              onChange={(e) => setSaved((p) => ({ ...p, parentPx: Number(e.target.value) || 16 }))}
            />
          </label>
          <label className="ts-row" style={{ gap: 4 }}>
            <span className="ts-label">vw(px):</span>
            <input
              type="number"
              className="ts-input mono"
              style={{ width: 72 }}
              value={saved.vwPx}
              onChange={(e) => setSaved((p) => ({ ...p, vwPx: Number(e.target.value) || 1440 }))}
            />
          </label>
          <label className="ts-row" style={{ gap: 4 }}>
            <span className="ts-label">vh(px):</span>
            <input
              type="number"
              className="ts-input mono"
              style={{ width: 72 }}
              value={saved.vhPx}
              onChange={(e) => setSaved((p) => ({ ...p, vhPx: Number(e.target.value) || 900 }))}
            />
          </label>
        </div>
      )}

      {saved.category === "duration" && (
        <div className="ts-row">
          {DURATION_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="ts-btn sm"
              onClick={() => setSaved((prev) => ({ ...prev, value: p.value, fromUnit: p.unit }))}
            >
              {p.label}
            </button>
          ))}
          {durationSummary && (
            <span className="ts-badge good">
              {tx(locale, "Breakdown", "自然时长")}: {durationSummary}
            </span>
          )}
        </div>
      )}

      <div className="ts-box" style={{ maxHeight: 330, overflowY: "auto" }}>
        <table className="ts-table">
          <thead>
            <tr>
              <th>{tx(locale, "Unit", "单位")}</th>
              <th>{tx(locale, "Value", "换算结果")}</th>
              <th style={{ width: 70 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.symbol}</strong>{" "}
                  <span style={{ color: "var(--ts-fg-muted)" }}>{tx(locale, r.labelEn, r.labelZh)}</span>
                </td>
                <td className="ts-mono">
                  {r.formatted} {saved.category === "css" ? r.symbol : ""}
                </td>
                <td>
                  <button
                    type="button"
                    className="ts-btn sm"
                    onClick={async () => {
                      const out = saved.category === "css" ? `${r.formatted}${r.symbol}` : r.formatted;
                      await copyToClipboard(out);
                      setCopiedId(r.id);
                      setTimeout(() => setCopiedId(null), 1200);
                    }}
                  >
                    {copiedId === r.id ? "✓" : tx(locale, "Copy", "复制")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
