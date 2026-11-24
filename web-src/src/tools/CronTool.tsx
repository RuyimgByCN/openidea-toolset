import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { isZhLocale, tx } from "../i18n";
import type { ToolProps } from "../types";

interface CronRes {
  dialect: string;
  descriptionEn: string;
  descriptionZh: string;
  nextRuns: string[];
}

const PRESETS = [
  { en: "Every 5m (Unix)", zh: "每 5 分钟 (Unix)", expr: "*/5 * * * *" },
  { en: "Workdays 9am (Spring)", zh: "工作日 9 点 (Spring)", expr: "0 0 9 * * MON-FRI" },
  { en: "Last Day 23:30 (Quartz)", zh: "月末 23:30 (Quartz)", expr: "0 30 23 L * ?" },
  { en: "Every 15s (Quartz)", zh: "每 15 秒 (Quartz)", expr: "*/15 * * * * ?" },
];

export default function CronTool({ locale, settings, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("cron", {
    expr: "0 */15 9-18 ? * MON-FRI",
    timezone: settings.defaultTimezone || "Asia/Shanghai",
    count: 8,
  });
  const [res, setRes] = useState<CronRes | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, expr: initialInput.trim() }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  useEffect(() => {
    if (!bridge.isHosted) return;
    bridge
      .rpc<CronRes>("gen.cron", { expr: saved.expr, timezone: saved.timezone, count: saved.count })
      .then((r) => { setRes(r); setErr(null); })
      .catch((e) => { setRes(null); setErr((e as Error).message); });
  }, [saved.expr, saved.timezone, saved.count]);

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Cron Parser & Schedule", "Cron 表达式解析与预览")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, expr: t.trim() }))}
          outputText={saved.expr}
        />
      </div>

      <div className="ts-row">
        <input className="ts-input mono" style={{ flex: 1 }} value={saved.expr} onChange={(e) => setSaved((p) => ({ ...p, expr: e.target.value }))} />
        <select className="ts-select" style={{ width: 140 }} value={saved.timezone} onChange={(e) => setSaved((p) => ({ ...p, timezone: e.target.value }))}>
          {["Asia/Shanghai", "UTC", "America/New_York", "Europe/London", "Asia/Tokyo"].map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
      </div>

      <div className="ts-row">
        {PRESETS.map((p) => (
          <button key={p.expr} type="button" className="ts-btn sm" onClick={() => setSaved((s) => ({ ...s, expr: p.expr }))}>
            {tx(locale, p.en, p.zh)}
          </button>
        ))}
      </div>

      {err && <div className="ts-err">{err}</div>}
      {res && (
        <div className="ts-col">
          <div className="ts-box ts-col">
            <span className="ts-badge">{res.dialect}</span>
            <strong style={{ color: "var(--ts-fg-strong)" }}>
              {isZhLocale(locale) ? res.descriptionZh : res.descriptionEn}
            </strong>
          </div>
          <div className="ts-box">
            <div style={{ fontSize: 11.5, color: "var(--ts-fg-muted)", marginBottom: 6 }}>
              {tx(locale, "Next Execution Times:", "接下来执行时间：")}
            </div>
            {res.nextRuns.length === 0 ? (
              <span style={{ color: "var(--ts-fg-muted)" }}>{tx(locale, "No matching execution within search horizon.", "近期无匹配执行时间")}</span>
            ) : (
              res.nextRuns.map((t, i) => (
                <div key={i} className="ts-mono" style={{ padding: "2px 0" }}>
                  {i + 1}. {t}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
