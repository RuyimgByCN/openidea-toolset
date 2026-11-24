import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

export default function IdGenTool({ locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("id-gen", {
    kind: "uuid-v4",
    count: 5,
    uppercase: false,
    noHyphens: false,
    nanoidLength: 21,
    nanoidAlphabet: "",
    snowflakeEpochMs: 1288834974657,
    snowflakeDc: 1,
    snowflakeWorker: 1,
    decodeInput: "",
    decodeKind: "snowflake",
  });
  const [output, setOutput] = useState("");
  const [decoded, setDecoded] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, decodeInput: initialInput.trim() }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const generate = async () => {
    setErr(null);
    try {
      const res = await bridge.rpc<{ ids: string[] }>("gen.id", {
        kind: saved.kind,
        count: saved.count,
        uppercase: saved.uppercase,
        noHyphens: saved.noHyphens,
        nanoidLength: saved.nanoidLength,
        nanoidAlphabet: saved.nanoidAlphabet,
        snowflakeEpochMs: Number(saved.snowflakeEpochMs),
        snowflakeDc: saved.snowflakeDc,
        snowflakeWorker: saved.snowflakeWorker,
      });
      setOutput(res.ids.join("\n"));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const decode = async () => {
    setErr(null);
    try {
      const res = await bridge.rpc<Record<string, unknown>>("gen.decodeId", {
        input: saved.decodeInput,
        kind: saved.decodeKind,
        snowflakeEpochMs: Number(saved.snowflakeEpochMs),
      });
      setDecoded(res);
    } catch (e) {
      setDecoded(null);
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    if (bridge.isHosted) void generate();
  }, []);

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "ID Generator & Decoder", "分布式 ID 生成与解析")}</span>
        <ToolActionBar locale={locale} outputText={output} />
      </div>

      <div className="ts-row">
        <select className="ts-select" style={{ width: 150 }} value={saved.kind} onChange={(e) => setSaved((p) => ({ ...p, kind: e.target.value }))}>
          <option value="uuid-v4">{tx(locale, "UUID v4 (Random)", "UUID v4 (随机)")}</option>
          <option value="uuid-v7">{tx(locale, "UUID v7 (Time-ordered)", "UUID v7 (有序时间戳)")}</option>
          <option value="uuid-v1">UUID v1</option>
          <option value="ulid">ULID</option>
          <option value="nanoid">NanoID</option>
          <option value="snowflake">{tx(locale, "Snowflake", "雪花 ID (Snowflake)")}</option>
          <option value="objectid">MongoDB ObjectId</option>
        </select>
        <input
          type="number"
          className="ts-input mono"
          style={{ width: 65 }}
          min={1}
          max={100}
          value={saved.count}
          onChange={(e) => setSaved((p) => ({ ...p, count: Number(e.target.value) || 1 }))}
        />
        <label className="ts-inline-check">
          <input type="checkbox" checked={saved.uppercase} onChange={(e) => setSaved((p) => ({ ...p, uppercase: e.target.checked }))} />
          {tx(locale, "UPPER", "全大写")}
        </label>
        {saved.kind.startsWith("uuid") && (
          <label className="ts-inline-check">
            <input type="checkbox" checked={saved.noHyphens} onChange={(e) => setSaved((p) => ({ ...p, noHyphens: e.target.checked }))} />
            {tx(locale, "No hyphens", "去连字符")}
          </label>
        )}
        <button type="button" className="ts-btn primary" onClick={generate}>
          {tx(locale, "Generate", "生成")}
        </button>
      </div>

      {saved.kind === "nanoid" && (
        <div className="ts-row">
          <input type="number" className="ts-input mono" style={{ width: 80 }} value={saved.nanoidLength} onChange={(e) => setSaved((p) => ({ ...p, nanoidLength: Number(e.target.value) || 21 }))} />
          <input className="ts-input mono" style={{ flex: 1 }} value={saved.nanoidAlphabet} onChange={(e) => setSaved((p) => ({ ...p, nanoidAlphabet: e.target.value }))} placeholder={tx(locale, "Custom alphabet (optional)", "自定义字符集（可选）")} />
        </div>
      )}

      {saved.kind === "snowflake" && (
        <div className="ts-row">
          <label className="ts-label" style={{ flex: 1 }}>
            {tx(locale, "Epoch (ms)", "起始纪元 (毫秒)")}
            <input type="number" className="ts-input mono" value={saved.snowflakeEpochMs} onChange={(e) => setSaved((p) => ({ ...p, snowflakeEpochMs: Number(e.target.value) || 0 }))} />
          </label>
          <label className="ts-label" style={{ width: 80 }}>
            {tx(locale, "DC (0-31)", "机房 ID (0-31)")}
            <input type="number" className="ts-input mono" min={0} max={31} value={saved.snowflakeDc} onChange={(e) => setSaved((p) => ({ ...p, snowflakeDc: Number(e.target.value) || 0 }))} />
          </label>
          <label className="ts-label" style={{ width: 90 }}>
            {tx(locale, "Worker (0-31)", "机器 ID (0-31)")}
            <input type="number" className="ts-input mono" min={0} max={31} value={saved.snowflakeWorker} onChange={(e) => setSaved((p) => ({ ...p, snowflakeWorker: Number(e.target.value) || 0 }))} />
          </label>
        </div>
      )}

      <textarea className="ts-textarea mono" rows={6} readOnly value={output} />

      <div className="ts-box ts-col">
        <span style={{ fontWeight: 600, fontSize: 12 }}>{tx(locale, "Reverse Decode ID", "反解 ID 时间与元信息")}</span>
        <div className="ts-row">
          <select className="ts-select" style={{ width: 130 }} value={saved.decodeKind} onChange={(e) => setSaved((p) => ({ ...p, decodeKind: e.target.value }))}>
            <option value="snowflake">Snowflake</option>
            <option value="objectid">ObjectId</option>
            <option value="ulid">ULID</option>
            <option value="uuid">UUID</option>
          </select>
          <input
            className="ts-input mono"
            style={{ flex: 1 }}
            value={saved.decodeInput}
            onChange={(e) => setSaved((p) => ({ ...p, decodeInput: e.target.value }))}
            placeholder={tx(locale, "Paste ID to inspect...", "粘贴 ID 进行解析...")}
          />
          <button type="button" className="ts-btn primary" onClick={decode}>
            {tx(locale, "Decode", "解析")}
          </button>
        </div>
        {err && <div className="ts-err">{err}</div>}
        {decoded && <pre className="ts-mono" style={{ margin: 0, fontSize: 11.5 }}>{JSON.stringify(decoded, null, 2)}</pre>}
      </div>
    </div>
  );
}
