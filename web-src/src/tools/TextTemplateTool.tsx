import { useEffect, useMemo } from "react";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";
import { expandTemplate } from "../utils/templateExpander";

const PRESETS = [
  {
    id: "sql-insert",
    en: "SQL INSERT",
    zh: "SQL INSERT 批量语句",
    mode: "delim" as const,
    delimiter: ",",
    hasHeader: true,
    joinWith: "\\n",
    header: "",
    footer: "",
    input: "id,name,role\n101,Alice,admin\n102,Bob,developer\n103,Carol,reviewer",
    template: "INSERT INTO users (id, username, role) VALUES ({{id}}, {{name | quote}}, {{role | quote}});",
  },
  {
    id: "sql-in",
    en: "SQL IN (...)",
    zh: "SQL IN 列表",
    mode: "delim" as const,
    delimiter: ",",
    hasHeader: false,
    joinWith: ", ",
    header: "SELECT * FROM orders WHERE order_no IN (",
    footer: ");",
    input: "ORD-2026-001\nORD-2026-002\nORD-2026-003",
    template: "{{1 | quote}}",
  },
  {
    id: "java-enum",
    en: "Java Enum Constants",
    zh: "Java 枚举常量",
    mode: "delim" as const,
    delimiter: ",",
    hasHeader: true,
    joinWith: ",\\n",
    header: "public enum ErrorCode {",
    footer: ";\n}",
    input: "code,key,msg\n4001,invalid_token,Invalid authentication token\n4003,rate_limited,Too many requests",
    template: "  {{key | screaming}}({{code}}, {{msg | dquote}})",
  },
  {
    id: "ts-union",
    en: "TypeScript Type Union",
    zh: "TypeScript 联合类型",
    mode: "delim" as const,
    delimiter: ",",
    hasHeader: false,
    joinWith: " | ",
    header: "export type FeatureFlag =",
    footer: ";",
    input: "dark_mode\nbeta_ui\nstrict_csp",
    template: "{{1 | dquote}}",
  },
  {
    id: "json-curl",
    en: "JSON Array → cURL",
    zh: "JSON 数组转 cURL",
    mode: "json" as const,
    delimiter: ",",
    hasHeader: false,
    joinWith: "\\n",
    header: "",
    footer: "",
    input: '[{"id": 1, "name": "alpha"}, {"id": 2, "name": "beta"}]',
    template: "curl -s https://api.example.com/v1/items/{{id}} -d '{\"name\":{{name | json}}}'",
  },
];

const PLACEHOLDER_CHIPS = [
  "{{1}}",
  "{{2}}",
  "{{0}}",
  "{{index1}}",
  "{{1 | trim}}",
  "{{1 | upper}}",
  "{{1 | lower}}",
  "{{1 | camel}}",
  "{{1 | snake}}",
  "{{1 | quote}}",
  "{{1 | json}}",
];

export default function TextTemplateTool({ tabId, locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState(`template-${tabId}`, {
    mode: "delim" as "delim" | "json",
    delimiter: ",",
    hasHeader: true,
    skipEmpty: true,
    joinWith: "\\n",
    header: "",
    footer: "",
    input: PRESETS[0].input,
    template: PRESETS[0].template,
  });

  useEffect(() => {
    if (initialInput != null) {
      const looksJson = initialInput.trim().startsWith("[");
      setSaved((p) => ({
        ...p,
        mode: looksJson ? "json" : "delim",
        input: initialInput,
      }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const result = useMemo(
    () =>
      expandTemplate(saved.input, saved.template, {
        mode: saved.mode,
        delimiter: saved.delimiter,
        hasHeader: saved.hasHeader,
        skipEmpty: saved.skipEmpty,
        joinWith: saved.joinWith,
        header: saved.header,
        footer: saved.footer,
      }),
    [saved],
  );

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Batch Template & Row Expander", "批量模板展开器")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, input: t }))}
          onPaste={(t) => setSaved((p) => ({ ...p, input: t }))}
          outputText={result.output}
          openTabTitle={tx(locale, "Expanded Output", "模板展开结果")}
          onClear={() => setSaved((p) => ({ ...p, input: "", header: "", footer: "" }))}
        />
      </div>

      <div className="ts-row">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="ts-btn sm"
            onClick={() =>
              setSaved((prev) => ({
                ...prev,
                mode: p.mode,
                delimiter: p.delimiter,
                hasHeader: p.hasHeader,
                joinWith: p.joinWith,
                header: p.header,
                footer: p.footer,
                input: p.input,
                template: p.template,
              }))
            }
          >
            {tx(locale, p.en, p.zh)}
          </button>
        ))}
      </div>

      <div className="ts-box ts-row" style={{ gap: 8 }}>
        <button
          type="button"
          className={`ts-pill ${saved.mode === "delim" ? "active" : ""}`}
          onClick={() => setSaved((p) => ({ ...p, mode: "delim" }))}
        >
          {tx(locale, "CSV / Delimited Rows", "分隔符文本行")}
        </button>
        <button
          type="button"
          className={`ts-pill ${saved.mode === "json" ? "active" : ""}`}
          onClick={() => setSaved((p) => ({ ...p, mode: "json" }))}
        >
          JSON Array
        </button>

        {saved.mode === "delim" && (
          <>
            <label className="ts-row" style={{ gap: 4 }}>
              <span className="ts-label">{tx(locale, "Delim:", "分隔符:")}</span>
              <select
                className="ts-select"
                style={{ width: 92 }}
                value={[",", "\\t", "|", ";", ""].includes(saved.delimiter) ? saved.delimiter : "__custom__"}
                onChange={(e) => {
                  if (e.target.value !== "__custom__") {
                    setSaved((p) => ({ ...p, delimiter: e.target.value }));
                  }
                }}
              >
                <option value=",">{tx(locale, "Comma (,)", "逗号 (,)")}</option>
                <option value="\t">{tx(locale, "Tab (\\t)", "制表符")}</option>
                <option value="|">{tx(locale, "Pipe (|)", "竖线 (|)")}</option>
                <option value=";">{tx(locale, "Semi (;)", "分号 (;)")}</option>
                <option value="">{tx(locale, "Whitespace", "空白符")}</option>
              </select>
            </label>
            <label className="ts-row" style={{ gap: 4, fontSize: 11.5 }}>
              <input
                type="checkbox"
                checked={saved.hasHeader}
                onChange={(e) => setSaved((p) => ({ ...p, hasHeader: e.target.checked }))}
              />
              {tx(locale, "Header Row", "首行为表头")}
            </label>
            <label className="ts-row" style={{ gap: 4, fontSize: 11.5 }}>
              <input
                type="checkbox"
                checked={saved.skipEmpty}
                onChange={(e) => setSaved((p) => ({ ...p, skipEmpty: e.target.checked }))}
              />
              {tx(locale, "Skip Empty", "跳过空行")}
            </label>
          </>
        )}

        <label className="ts-row" style={{ gap: 4 }}>
          <span className="ts-label">{tx(locale, "Join:", "连接符:")}</span>
          <input
            className="ts-input mono"
            style={{ width: 62 }}
            value={saved.joinWith}
            onChange={(e) => setSaved((p) => ({ ...p, joinWith: e.target.value }))}
            placeholder="\\n"
          />
        </label>
      </div>

      <div className="ts-split">
        <label className="ts-label">
          {tx(locale, "Input Rows / JSON Array", "输入数据行或 JSON 数组")}
          <textarea
            className="ts-textarea mono"
            rows={7}
            value={saved.input}
            onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))}
          />
        </label>
        <div className="ts-col" style={{ flex: 1 }}>
          <label className="ts-label">
            {tx(locale, "Row Template", "单行模板")}
            <textarea
              className="ts-textarea mono"
              rows={4}
              value={saved.template}
              onChange={(e) => setSaved((p) => ({ ...p, template: e.target.value }))}
            />
          </label>
          <div className="ts-split">
            <label className="ts-label">
              {tx(locale, "Header Wrapper (Optional)", "头部包裹（可选）")}
              <input
                className="ts-input mono"
                value={saved.header}
                onChange={(e) => setSaved((p) => ({ ...p, header: e.target.value }))}
              />
            </label>
            <label className="ts-label">
              {tx(locale, "Footer Wrapper (Optional)", "尾部包裹（可选）")}
              <input
                className="ts-input mono"
                value={saved.footer}
                onChange={(e) => setSaved((p) => ({ ...p, footer: e.target.value }))}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="ts-row">
        <span className="ts-label">{tx(locale, "Insert:", "插入占位符:")}</span>
        {result.columns.slice(0, 6).map((c) => (
          <button
            key={c}
            type="button"
            className="ts-btn sm mono"
            onClick={() => setSaved((p) => ({ ...p, template: `${p.template}{{${c}}}` }))}
          >
            {`{{${c}}}`}
          </button>
        ))}
        {PLACEHOLDER_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            className="ts-btn sm mono"
            onClick={() => setSaved((p) => ({ ...p, template: `${p.template}${chip}` }))}
          >
            {chip}
          </button>
        ))}
        <span className="ts-badge good">{result.rowCount} {tx(locale, "rows", "行")}</span>
      </div>

      {result.error && <div className="ts-err">{result.error}</div>}

      <textarea
        className="ts-textarea mono"
        rows={8}
        readOnly
        value={result.output}
        placeholder={tx(locale, "Expanded result...", "批量生成结果...")}
      />
    </div>
  );
}
