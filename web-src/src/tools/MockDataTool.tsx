import { useEffect, useState } from "react";
import { bridge, saveHostFile } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { isZhLocale, tx } from "../i18n";
import type { ToolProps } from "../types";

interface FieldDef {
  id: string;
  name: string;
  type: string;
  options: string;
}

const FIELD_TYPES: Array<{ id: string; en: string; zh: string; optHintEn: string; optHintZh: string }> = [
  { id: "sequence", en: "Sequence (1, 2, 3...)", zh: "自增序号 (sequence)", optHintEn: "Start, e.g. 1", optHintZh: "起始值，如 1" },
  { id: "uuid", en: "UUID v4", zh: "UUID v4", optHintEn: "", optHintZh: "" },
  { id: "int", en: "Integer (min..max)", zh: "随机整数 (min..max)", optHintEn: "0..1000", optHintZh: "范围如 0..1000" },
  { id: "float", en: "Float (min..max)", zh: "随机小数 (min..max)", optHintEn: "10..999", optHintZh: "范围如 10..999" },
  { id: "bool", en: "Boolean", zh: "布尔值 (true/false)", optHintEn: "", optHintZh: "" },
  { id: "name", en: "Full Name", zh: "姓名 (name)", optHintEn: "", optHintZh: "" },
  { id: "email", en: "Email", zh: "邮箱 (email)", optHintEn: "", optHintZh: "" },
  { id: "phone", en: "Phone Number", zh: "手机号 (phone)", optHintEn: "", optHintZh: "" },
  { id: "ipv4", en: "IPv4 Address", zh: "IPv4 地址", optHintEn: "", optHintZh: "" },
  { id: "url", en: "URL", zh: "URL 网址", optHintEn: "", optHintZh: "" },
  { id: "date", en: "Date (YYYY-MM-DD)", zh: "日期 (YYYY-MM-DD)", optHintEn: "", optHintZh: "" },
  { id: "datetime", en: "DateTime (RFC 3339)", zh: "日期时间 (datetime)", optHintEn: "", optHintZh: "" },
  { id: "city", en: "City", zh: "城市 (city)", optHintEn: "", optHintZh: "" },
  { id: "company", en: "Company", zh: "公司名称 (company)", optHintEn: "", optHintZh: "" },
  { id: "enum", en: "Enum (comma list)", zh: "枚举 (逗号分隔)", optHintEn: "a,b,c", optHintZh: "候选值如 a,b,c" },
  { id: "lorem", en: "Lorem Words", zh: "占位词句 (lorem)", optHintEn: "Word count, e.g. 5", optHintZh: "词数，如 5" },
];

const PRESETS: Record<string, { tableName: string; fields: Omit<FieldDef, "id">[] }> = {
  users: {
    tableName: "mock_users",
    fields: [
      { name: "id", type: "sequence", options: "1" },
      { name: "name", type: "name", options: "" },
      { name: "email", type: "email", options: "" },
      { name: "phone", type: "phone", options: "" },
      { name: "city", type: "city", options: "" },
      { name: "role", type: "enum", options: "admin,editor,viewer" },
      { name: "active", type: "bool", options: "" },
    ],
  },
  orders: {
    tableName: "mock_orders",
    fields: [
      { name: "order_id", type: "uuid", options: "" },
      { name: "customer", type: "name", options: "" },
      { name: "company", type: "company", options: "" },
      { name: "amount", type: "float", options: "10..5000" },
      { name: "status", type: "enum", options: "pending,paid,shipped,completed" },
      { name: "created_at", type: "datetime", options: "" },
    ],
  },
  logs: {
    tableName: "access_logs",
    fields: [
      { name: "ts", type: "datetime", options: "" },
      { name: "client_ip", type: "ipv4", options: "" },
      { name: "endpoint", type: "url", options: "" },
      { name: "status", type: "enum", options: "200,201,400,404,500" },
      { name: "latency_ms", type: "int", options: "5..800" },
    ],
  },
};

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export default function MockDataTool({ tabId, locale }: ToolProps) {
  const [saved, setSaved] = useToolState(`mock-${tabId}`, {
    fields: PRESETS.users.fields.map((f, i) => ({ ...f, id: `f-${i}` })) as FieldDef[],
    count: 10,
    format: "json" as "json" | "csv" | "sql" | "markdown",
    tableName: "mock_users",
    localeZh: isZhLocale(locale),
  });
  const [output, setOutput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const generate = async (cfg = saved) => {
    setErr(null);
    try {
      const res = await bridge.rpc<{ result: string }>("mock.generate", {
        fields: cfg.fields.map(({ name, type, options }) => ({ name, type, options })),
        count: Math.max(1, Math.min(500, Number(cfg.count) || 10)),
        format: cfg.format,
        tableName: cfg.tableName || "mock_data",
        localeZh: cfg.localeZh,
      });
      setOutput(res.result);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    if (bridge.isHosted) {
      generate();
    }
  }, []);

  const applyPreset = (key: keyof typeof PRESETS) => {
    const p = PRESETS[key];
    const next = {
      ...saved,
      tableName: p.tableName,
      fields: p.fields.map((f) => ({ ...f, id: makeId() })),
    };
    setSaved(next);
    if (bridge.isHosted) generate(next);
  };

  const extForFmt = saved.format === "sql" ? "sql" : saved.format === "csv" ? "csv" : saved.format === "markdown" ? "md" : "json";

  const handleSave = async () => {
    if (!output) return;
    try {
      const p = await saveHostFile(`${saved.tableName || "mock_data"}.${extForFmt}`, saved.format === "csv" ? `\uFEFF${output}` : output);
      if (p) setStatus(tx(locale, `Saved ${p}`, `已保存 ${p}`));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Offline Mock Data Generator", "离线 Mock 测试数据生成")}</span>
        <ToolActionBar
          locale={locale}
          outputText={output}
          openTabTitle={`Mock (${saved.format.toUpperCase()})`}
          openTabLanguage={saved.format === "markdown" ? "markdown" : saved.format}
          openTabFileName={`${saved.tableName || "mock_data"}.${extForFmt}`}
          onClear={() => setOutput("")}
          onStatus={(m) => setStatus(m)}
        />
      </div>

      <div className="ts-row">
        <span className="ts-label">{tx(locale, "Presets:", "快捷模板:")}</span>
        <button type="button" className="ts-pill" onClick={() => applyPreset("users")}>
          {tx(locale, "Users", "用户表")}
        </button>
        <button type="button" className="ts-pill" onClick={() => applyPreset("orders")}>
          {tx(locale, "Orders", "订单表")}
        </button>
        <button type="button" className="ts-pill" onClick={() => applyPreset("logs")}>
          {tx(locale, "Access Logs", "访问日志")}
        </button>
        <label className="ts-inline-check">
          <input
            type="checkbox"
            checked={saved.localeZh}
            onChange={(e) => setSaved((p) => ({ ...p, localeZh: e.target.checked }))}
          />
          {tx(locale, "Chinese Names/Cities", "中文姓名与城市")}
        </label>
      </div>

      <div className="ts-row">
        <span className="ts-label">{tx(locale, "Rows", "行数")}</span>
        <input
          type="number"
          min={1}
          max={500}
          className="ts-input mono"
          style={{ width: 72 }}
          value={saved.count}
          onChange={(e) => setSaved((p) => ({ ...p, count: Math.max(1, Math.min(500, Number(e.target.value) || 10)) }))}
        />
        <span className="ts-label">{tx(locale, "Format", "输出格式")}</span>
        <select
          className="ts-select"
          value={saved.format}
          onChange={(e) => setSaved((p) => ({ ...p, format: e.target.value as "json" | "csv" | "sql" | "markdown" }))}
        >
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
          <option value="sql">SQL INSERT</option>
          <option value="markdown">Markdown</option>
        </select>
        {saved.format === "sql" && (
          <input
            className="ts-input mono"
            style={{ width: 130 }}
            value={saved.tableName}
            onChange={(e) => setSaved((p) => ({ ...p, tableName: e.target.value }))}
            placeholder={tx(locale, "Table name", "SQL 表名")}
          />
        )}
        <button type="button" className="ts-btn primary" onClick={() => generate()}>
          {tx(locale, "Generate", "生成数据")}
        </button>
        <button type="button" className="ts-btn" disabled={!output} onClick={handleSave}>
          {tx(locale, "Export File", "导出文件")}
        </button>
      </div>

      <div className="ts-box ts-col" style={{ gap: 6 }}>
        <div className="ts-row" style={{ justifyContent: "space-between" }}>
          <span className="ts-label">{tx(locale, `Schema Fields (${saved.fields.length})`, `字段 Schema (${saved.fields.length})`)}</span>
          <button
            type="button"
            className="ts-btn sm"
            onClick={() =>
              setSaved((p) => ({
                ...p,
                fields: [...p.fields, { id: makeId(), name: `field_${p.fields.length + 1}`, type: "lorem", options: "3" }],
              }))
            }
          >
            {tx(locale, "+ Add Field", "+ 添加字段")}
          </button>
        </div>

        <div className="ts-col" style={{ gap: 4 }}>
          {saved.fields.map((f) => {
            const meta = FIELD_TYPES.find((t) => t.id === f.type);
            return (
              <div key={f.id} className="ts-row">
                <input
                  className="ts-input mono"
                  style={{ width: 135 }}
                  value={f.name}
                  onChange={(e) =>
                    setSaved((p) => ({
                      ...p,
                      fields: p.fields.map((x) => (x.id === f.id ? { ...x, name: e.target.value } : x)),
                    }))
                  }
                  placeholder={tx(locale, "Field name", "字段名")}
                />
                <select
                  className="ts-select"
                  style={{ flex: 1, minWidth: 150 }}
                  value={f.type}
                  onChange={(e) =>
                    setSaved((p) => ({
                      ...p,
                      fields: p.fields.map((x) => (x.id === f.id ? { ...x, type: e.target.value } : x)),
                    }))
                  }
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {tx(locale, t.en, t.zh)}
                    </option>
                  ))}
                </select>
                <input
                  className="ts-input mono"
                  style={{ flex: 1, minWidth: 110 }}
                  value={f.options}
                  onChange={(e) =>
                    setSaved((p) => ({
                      ...p,
                      fields: p.fields.map((x) => (x.id === f.id ? { ...x, options: e.target.value } : x)),
                    }))
                  }
                  placeholder={meta ? tx(locale, meta.optHintEn || "Options (optional)", meta.optHintZh || "可选参数") : ""}
                />
                <button
                  type="button"
                  className="ts-btn sm"
                  onClick={() =>
                    setSaved((p) => ({
                      ...p,
                      fields: p.fields.length > 1 ? p.fields.filter((x) => x.id !== f.id) : p.fields,
                    }))
                  }
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {err && <div className="ts-err">{err}</div>}
      {status && <div className="ts-ok">{status}</div>}

      <textarea
        className="ts-textarea mono"
        rows={11}
        readOnly
        value={output}
        placeholder={tx(locale, "Generated mock dataset...", "点击生成后在此查看 Mock 数据...")}
      />
    </div>
  );
}
