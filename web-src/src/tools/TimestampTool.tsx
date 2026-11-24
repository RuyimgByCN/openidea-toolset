import { useEffect, useState } from "react";
import { bridge, copyToClipboard } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

interface TsInfo {
  seconds: number;
  milliseconds: number;
  microseconds: number;
  nanoseconds: string | number;
  isoUtc: string;
  localFormatted: string;
  timezone: string;
  weekday: string;
}

const TIMEZONES = [
  "Asia/Shanghai",
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Singapore",
];

export default function TimestampTool({ locale, settings, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("timestamp", {
    input: "",
    timezone: settings.defaultTimezone || "Asia/Shanghai",
    unit: settings.timestampUnit || "milliseconds",
    pattern: "%Y-%m-%d %H:%M:%S",
    offsetSeconds: 0,
  });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);
  const [info, setInfo] = useState<TsInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, input: initialInput }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [paused]);

  const convert = async (overrideInput?: string) => {
    setErr(null);
    try {
      const res = await bridge.rpc<TsInfo>("convert.timestamp", {
        input: overrideInput ?? saved.input,
        timezone: saved.timezone,
        pattern: saved.pattern,
        unit: saved.unit,
        offsetSeconds: Number(saved.offsetSeconds) || 0,
      });
      setInfo(res);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    if (bridge.isHosted) void convert();
  }, [saved.timezone, saved.unit, saved.offsetSeconds]);

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Timestamp & DateTime", "时间戳与日期时间")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => { setSaved((p) => ({ ...p, input: t })); void convert(t); }}
          onPaste={(t) => { setSaved((p) => ({ ...p, input: t })); void convert(t); }}
          outputText={info ? info.localFormatted : undefined}
        />
      </div>

      <div className="ts-box ts-row" style={{ justifyContent: "space-between" }}>
        <div>
          <span style={{ color: "var(--ts-fg-muted)", marginRight: 6 }}>{tx(locale, "Now (ms):", "当前毫秒:")}</span>
          <strong className="ts-mono">{nowMs}</strong>
          <span style={{ color: "var(--ts-fg-muted)", marginLeft: 10 }}>({Math.floor(nowMs / 1000)}s)</span>
        </div>
        <div className="ts-row">
          <button type="button" className="ts-btn sm" onClick={() => setPaused((p) => !p)}>
            {paused ? tx(locale, "Resume", "继续") : tx(locale, "Pause", "暂停")}
          </button>
          <button type="button" className="ts-btn sm" onClick={() => copyToClipboard(String(nowMs))}>
            {tx(locale, "Copy ms", "复制毫秒")}
          </button>
          <button type="button" className="ts-btn sm" onClick={() => { const s = String(nowMs); setSaved((p) => ({ ...p, input: s })); void convert(s); }}>
            {tx(locale, "Use Now", "填入当前")}
          </button>
        </div>
      </div>

      <div className="ts-split">
        <label className="ts-label">
          {tx(locale, "Timestamp or Date String (blank = now)", "时间戳或日期字符串（留空取当前时间）")}
          <input
            className="ts-input mono"
            value={saved.input}
            onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))}
            placeholder={tx(locale, "1700000000000 or 2026-01-01 12:00:00", "如 1700000000000 或 2026-01-01 12:00:00")}
          />
        </label>
        <label className="ts-label">
          {tx(locale, "Timezone (IANA)", "时区")}
          <select className="ts-select" value={saved.timezone} onChange={(e) => setSaved((p) => ({ ...p, timezone: e.target.value }))}>
            {TIMEZONES.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
      </div>

      <div className="ts-row">
        <select className="ts-select" style={{ width: 140 }} value={saved.unit} onChange={(e) => setSaved((p) => ({ ...p, unit: e.target.value }))}>
          <option value="seconds">{tx(locale, "Seconds (s)", "秒 (s)")}</option>
          <option value="milliseconds">{tx(locale, "Millis (ms)", "毫秒 (ms)")}</option>
          <option value="microseconds">{tx(locale, "Micros (µs)", "微秒 (µs)")}</option>
          <option value="nanoseconds">{tx(locale, "Nanos (ns)", "纳秒 (ns)")}</option>
        </select>
        <input
          className="ts-input mono"
          style={{ width: 165 }}
          value={saved.pattern}
          onChange={(e) => setSaved((p) => ({ ...p, pattern: e.target.value }))}
          placeholder="%Y-%m-%d %H:%M:%S"
        />
        <input
          type="number"
          className="ts-input mono"
          style={{ width: 110 }}
          value={saved.offsetSeconds}
          onChange={(e) => setSaved((p) => ({ ...p, offsetSeconds: Number(e.target.value) || 0 }))}
          title={tx(locale, "Offset seconds", "偏移秒数")}
        />
        <button type="button" className="ts-btn primary" onClick={() => convert()}>
          {tx(locale, "Convert", "转换")}
        </button>
      </div>

      {err && <div className="ts-err">{err}</div>}
      {info && (
        <div className="ts-box ts-kv">
          <span className="ts-kv-key">{tx(locale, "Local", "本地时间")}</span>
          <span className="ts-kv-val">{info.localFormatted} ({info.weekday})</span>
          <span className="ts-kv-key">ISO 8601 (UTC)</span>
          <span className="ts-kv-val">{info.isoUtc}</span>
          <span className="ts-kv-key">{tx(locale, "Seconds", "秒 (s)")}</span>
          <span className="ts-kv-val">{info.seconds}</span>
          <span className="ts-kv-key">{tx(locale, "Millis", "毫秒 (ms)")}</span>
          <span className="ts-kv-val">{info.milliseconds}</span>
          <span className="ts-kv-key">{tx(locale, "Micros", "微秒 (µs)")}</span>
          <span className="ts-kv-val">{info.microseconds}</span>
          <span className="ts-kv-key">{tx(locale, "Nanos", "纳秒 (ns)")}</span>
          <span className="ts-kv-val">{String(info.nanoseconds)}</span>
        </div>
      )}
    </div>
  );
}
