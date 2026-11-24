import { useEffect, useState } from "react";
import { bridge, openHostFile, saveHostFile } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

interface TablePreview {
  delimiter: string;
  headers: string[];
  rows: string[][];
  rowCount: number;
  colCount: number;
}

const SAMPLE_CSV = `id,name,role,score
1,Alice Chen,Architect,98.5
2,Bob Li,Maintainer,91.0
3,Carol Wu,Contributor,87.5`;

export default function CsvTableTool({ tabId, locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState(`csv-${tabId}`, {
    input: SAMPLE_CSV,
    from: "csv" as "csv" | "tsv" | "json",
    to: "markdown" as "json-objects" | "json-arrays" | "csv" | "tsv" | "markdown" | "sql-insert" | "html",
    delimiter: "auto",
    hasHeader: true,
    transpose: false,
    tableName: "records",
    viewTab: "both" as "both" | "table" | "output",
  });
  const [preview, setPreview] = useState<TablePreview | null>(null);
  const [output, setOutput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      const t = initialInput.trim();
      const guessed = t.startsWith("[") || t.startsWith("{") ? "json" : t.includes("\t") ? "tsv" : "csv";
      setSaved((p) => ({ ...p, input: initialInput, from: guessed }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  useEffect(() => {
    let active = true;
    if (!saved.input.trim()) {
      setPreview(null);
      setOutput("");
      setErr(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const [parsed, converted] = await Promise.all([
          bridge.rpc<TablePreview>("csv.parse", {
            text: saved.input,
            from: saved.from,
            delimiter: saved.delimiter,
            hasHeader: saved.hasHeader,
          }),
          bridge.rpc<{ result: string }>("csv.convert", {
            text: saved.input,
            from: saved.from,
            to: saved.to,
            delimiter: saved.delimiter,
            hasHeader: saved.hasHeader,
            tableName: saved.tableName || "records",
            transpose: saved.transpose,
          }),
        ]);
        if (active) {
          setPreview(parsed);
          setOutput(converted.result);
          setErr(null);
        }
      } catch (e) {
        if (active) setErr((e as Error).message);
      }
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [saved.input, saved.from, saved.to, saved.delimiter, saved.hasHeader, saved.transpose, saved.tableName]);

  const handleOpenFile = async () => {
    try {
      const f = await openHostFile([{ name: tx(locale, "Tables", "表格文件"), extensions: ["csv", "tsv", "json", "txt"] }]);
      if (!f) return;
      const text = new TextDecoder().decode(f.data);
      const ext = f.name.toLowerCase();
      const from = ext.endsWith(".json") ? "json" : ext.endsWith(".tsv") ? "tsv" : "csv";
      setSaved((p) => ({ ...p, input: text, from }));
      setStatus(tx(locale, `Loaded ${f.name}`, `已导入 ${f.name}`));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleExportBomCsv = async () => {
    try {
      const res = await bridge.rpc<{ result: string }>("csv.convert", {
        text: saved.input,
        from: saved.from,
        to: "csv",
        delimiter: saved.delimiter,
        hasHeader: saved.hasHeader,
        tableName: saved.tableName || "records",
        transpose: saved.transpose,
      });
      const p = await saveHostFile(`${saved.tableName || "export"}.csv`, `\uFEFF${res.result}`, [
        { name: "CSV", extensions: ["csv"] },
      ]);
      if (p) setStatus(tx(locale, `Exported Excel BOM CSV: ${p}`, `已导出带 BOM 的 Excel CSV: ${p}`));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const outLang =
    saved.to.startsWith("json") ? "json" : saved.to === "sql-insert" ? "sql" : saved.to === "html" ? "html" : saved.to === "markdown" ? "markdown" : "text";

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "CSV / Table Converter", "CSV 与表格互转")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, input: t }))}
          onPaste={(t) => setSaved((p) => ({ ...p, input: t }))}
          outputText={output}
          openTabTitle={`Table (${saved.to})`}
          openTabLanguage={outLang}
          openTabFileName={`table.${outLang === "markdown" ? "md" : outLang === "text" ? "csv" : outLang}`}
          onClear={() => {
            setSaved((p) => ({ ...p, input: "" }));
            setPreview(null);
            setOutput("");
          }}
          onStatus={(m) => setStatus(m)}
        />
      </div>

      <div className="ts-row">
        <span className="ts-label">{tx(locale, "Input", "输入")}</span>
        <select className="ts-select" value={saved.from} onChange={(e) => setSaved((p) => ({ ...p, from: e.target.value as "csv" | "tsv" | "json" }))}>
          <option value="csv">CSV</option>
          <option value="tsv">TSV</option>
          <option value="json">JSON</option>
        </select>

        <span className="ts-label">→</span>
        <select
          className="ts-select"
          value={saved.to}
          onChange={(e) =>
            setSaved((p) => ({
              ...p,
              to: e.target.value as "json-objects" | "json-arrays" | "csv" | "tsv" | "markdown" | "sql-insert" | "html",
            }))
          }
        >
          <option value="markdown">{tx(locale, "Markdown Table", "Markdown 表格")}</option>
          <option value="json-objects">{tx(locale, "JSON (Array of Objects)", "JSON 对象数组")}</option>
          <option value="json-arrays">{tx(locale, "JSON (2D Arrays)", "JSON 二维数组")}</option>
          <option value="sql-insert">SQL INSERT</option>
          <option value="html">{tx(locale, "HTML Table", "HTML 表格")}</option>
          <option value="csv">CSV</option>
          <option value="tsv">TSV</option>
        </select>

        {saved.from === "csv" && (
          <select className="ts-select" value={saved.delimiter} onChange={(e) => setSaved((p) => ({ ...p, delimiter: e.target.value }))}>
            <option value="auto">{tx(locale, "Delimiter: Auto", "分隔符: 自动")}</option>
            <option value=",">{tx(locale, "Comma (,)", "逗号 (,)")}</option>
            <option value=";">{tx(locale, "Semicolon (;)", "分号 (;)")}</option>
            <option value="&#9;">{tx(locale, "Tab (\\t)", "制表符 (\\t)")}</option>
            <option value="|">{tx(locale, "Pipe (|)", "竖线 (|)")}</option>
          </select>
        )}
      </div>

      <div className="ts-row">
        <label className="ts-inline-check">
          <input
            type="checkbox"
            checked={saved.hasHeader}
            onChange={(e) => setSaved((p) => ({ ...p, hasHeader: e.target.checked }))}
          />
          {tx(locale, "First row is header", "首行为表头")}
        </label>
        <label className="ts-inline-check">
          <input
            type="checkbox"
            checked={saved.transpose}
            onChange={(e) => setSaved((p) => ({ ...p, transpose: e.target.checked }))}
          />
          {tx(locale, "Transpose rows/cols", "行列转置")}
        </label>
        {saved.to === "sql-insert" && (
          <input
            className="ts-input mono"
            style={{ width: 120 }}
            value={saved.tableName}
            onChange={(e) => setSaved((p) => ({ ...p, tableName: e.target.value }))}
            placeholder={tx(locale, "Table name", "SQL 表名")}
          />
        )}
        <button type="button" className="ts-btn sm" onClick={handleOpenFile}>
          {tx(locale, "Open File...", "导入文件...")}
        </button>
        <button type="button" className="ts-btn sm" onClick={handleExportBomCsv}>
          {tx(locale, "Excel BOM CSV", "导出 Excel CSV (BOM)")}
        </button>
        {preview && (
          <span className="ts-badge good">
            {tx(locale, `${preview.rowCount} rows × ${preview.colCount} cols`, `${preview.rowCount} 行 × ${preview.colCount} 列`)}
          </span>
        )}
      </div>

      <textarea
        className="ts-textarea mono"
        rows={6}
        value={saved.input}
        onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))}
        placeholder={tx(locale, "Paste CSV, TSV or JSON table data...", "粘贴 CSV、TSV 或 JSON 数组数据...")}
      />

      {err && <div className="ts-err">{err}</div>}
      {status && <div className="ts-ok">{status}</div>}

      <div className="ts-row">
        {(["both", "table", "output"] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={`ts-pill ${saved.viewTab === v ? "active" : ""}`}
            onClick={() => setSaved((p) => ({ ...p, viewTab: v }))}
          >
            {v === "both" ? tx(locale, "Preview + Output", "表格与文本") : v === "table" ? tx(locale, "Table Preview", "仅表格预览") : tx(locale, "Output Text", "仅输出文本")}
          </button>
        ))}
      </div>

      {(saved.viewTab === "both" || saved.viewTab === "table") && preview && (
        <div className="ts-box" style={{ maxHeight: 240, overflow: "auto" }}>
          <table className="ts-table">
            <thead>
              <tr>
                {preview.headers.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.slice(0, 200).map((row, ri) => (
                <tr key={ri}>
                  {preview.headers.map((_, ci) => (
                    <td key={ci} className="ts-mono">
                      {row[ci] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {preview.rows.length > 200 && (
            <div className="ts-label" style={{ marginTop: 4 }}>
              {tx(locale, `Showing first 200 of ${preview.rows.length} rows`, `仅预览前 200 行（共 ${preview.rows.length} 行）`)}
            </div>
          )}
        </div>
      )}

      {(saved.viewTab === "both" || saved.viewTab === "output") && (
        <textarea
          className="ts-textarea mono"
          rows={8}
          readOnly
          value={output}
          placeholder={tx(locale, "Converted table output...", "转换结果...")}
        />
      )}
    </div>
  );
}
