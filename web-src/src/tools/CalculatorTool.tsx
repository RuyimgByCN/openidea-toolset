import { useEffect, useState } from "react";
import { bridge, copyToClipboard } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

interface CalcResult {
  result: string;
  exact: boolean;
  modeUsed: string;
  scientific: string;
  integer?: { dec: string; hex: string; bin: string; oct: string } | null;
}

const SNIPPETS = ["0x", "0b", "sqrt(", "pow(", "PI", "E", " << ", " & ", " | ", " xor "];

export default function CalculatorTool({ locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("calculator", {
    expr: "0.1 + 0.2",
    mode: "auto" as "auto" | "float",
    history: [] as Array<{ expr: string; result: string }>,
  });
  const [res, setRes] = useState<CalcResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, expr: initialInput.trim() }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  useEffect(() => {
    if (!bridge.isHosted) return;
    const t = setTimeout(() => {
      bridge
        .rpc<CalcResult>("calc.eval", { expr: saved.expr, mode: saved.mode })
        .then((r) => { setRes(r); setErr(null); })
        .catch((e) => { setRes(null); setErr((e as Error).message); });
    }, 60);
    return () => clearTimeout(t);
  }, [saved.expr, saved.mode]);

  const saveHistory = () => {
    if (!res) return;
    setSaved((p) => ({
      ...p,
      history: [{ expr: p.expr, result: res.result }, ...p.history.filter((h) => h.expr !== p.expr)].slice(0, 20),
    }));
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Decimal & Expression Calculator", "高精度表达式计算器")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, expr: t.trim() }))}
          onPaste={(t) => setSaved((p) => ({ ...p, expr: t.trim() }))}
          outputText={res?.result ?? ""}
        />
      </div>

      <div className="ts-row">
        <button type="button" className={`ts-pill ${saved.mode === "auto" ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, mode: "auto" }))}>
          {tx(locale, "Exact Decimal (0.1+0.2=0.3)", "精确十进制（无浮点误差）")}
        </button>
        <button type="button" className={`ts-pill ${saved.mode === "float" ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, mode: "float" }))}>
          {tx(locale, "IEEE-754 Scientific", "科学浮点")}
        </button>
        <button type="button" className="ts-btn sm" disabled={!res} onClick={saveHistory}>
          {tx(locale, "Record", "记入历史")}
        </button>
      </div>

      <div className="ts-row">
        <input
          className="ts-input mono"
          style={{ flex: 1 }}
          value={saved.expr}
          onChange={(e) => setSaved((p) => ({ ...p, expr: e.target.value }))}
          onKeyDown={(e) => { if (e.key === "Enter") saveHistory(); }}
          placeholder="(0xFF & 0x0F) << 4, 19.99 * 3, sqrt(2) * PI"
        />
      </div>

      <div className="ts-row">
        {SNIPPETS.map((s) => (
          <button key={s} type="button" className="ts-btn sm mono" onClick={() => setSaved((p) => ({ ...p, expr: `${p.expr}${s}` }))}>
            {s.trim()}
          </button>
        ))}
      </div>

      {err && <div className="ts-err">{err}</div>}

      {res && (
        <div className="ts-box ts-kv">
          <span className="ts-kv-key">{tx(locale, "Result", "结果")}</span>
          <div className="ts-row" style={{ justifyContent: "space-between" }}>
            <strong className="ts-kv-val" style={{ fontSize: 15 }}>{res.result}</strong>
            <div className="ts-row">
              <span className={`ts-badge ${res.exact ? "good" : ""}`}>{res.modeUsed}</span>
              <button type="button" className="ts-btn sm" onClick={() => copyToClipboard(res.result)}>{tx(locale, "Copy", "复制")}</button>
            </div>
          </div>

          <span className="ts-kv-key">{tx(locale, "Scientific", "科学记数法")}</span>
          <span className="ts-kv-val">{res.scientific}</span>

          {res.integer && (
            <>
              <span className="ts-kv-key">{tx(locale, "DEC / HEX", "十进制 / 十六进制")}</span>
              <span className="ts-kv-val">{res.integer.dec} · {res.integer.hex}</span>
              <span className="ts-kv-key">{tx(locale, "BIN / OCT", "二进制 / 八进制")}</span>
              <span className="ts-kv-val">{res.integer.bin} · {res.integer.oct}</span>
            </>
          )}
        </div>
      )}

      {saved.history.length > 0 && (
        <div className="ts-box ts-col" style={{ maxHeight: 160, overflowY: "auto" }}>
          <div className="ts-row" style={{ justifyContent: "space-between" }}>
            <span style={{ fontSize: 11.5, color: "var(--ts-fg-muted)" }}>{tx(locale, "History", "计算历史")}</span>
            <button type="button" className="ts-btn sm" onClick={() => setSaved((p) => ({ ...p, history: [] }))}>{tx(locale, "Clear", "清空")}</button>
          </div>
          {saved.history.map((h, idx) => (
            <button
              key={idx}
              type="button"
              className="ts-btn sm"
              style={{ justifyContent: "space-between" }}
              onClick={() => setSaved((p) => ({ ...p, expr: h.expr }))}
            >
              <span className="ts-mono">{h.expr}</span>
              <strong className="ts-mono">= {h.result}</strong>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
