import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

function JsonTreeNode({ name, value, depth = 0 }: { name?: string; value: unknown; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  const isArr = Array.isArray(value);
  const isObj = value !== null && typeof value === "object" && !isArr;
  const label = name !== undefined ? `${name}: ` : "";

  if (!isArr && !isObj) {
    const color =
      typeof value === "string"
        ? "var(--ts-success)"
        : typeof value === "number"
          ? "var(--ts-info)"
          : typeof value === "boolean"
            ? "var(--ts-warning)"
            : "var(--ts-fg-muted)";
    return (
      <div className="ts-tree-node">
        <span>{label}</span>
        <span style={{ color }}>{JSON.stringify(value)}</span>
      </div>
    );
  }

  const entries = isArr ? (value as unknown[]).map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
  return (
    <div className="ts-tree-node">
      <span className="ts-tree-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "▾" : "▸"} {label}
        {isArr ? `Array[${entries.length}]` : `Object{${entries.length}}`}
      </span>
      {open && entries.map(([k, v]) => <JsonTreeNode key={k} name={k} value={v} depth={depth + 1} />)}
    </div>
  );
}

interface JsonDiffChange {
  path: string;
  kind: "added" | "removed" | "changed" | string;
  left?: unknown;
  right?: unknown;
}

interface JsonDiffResult {
  equal: boolean;
  summary: { added: number; removed: number; changed: number };
  changes: JsonDiffChange[];
}

export default function JsonTool({ tabId, locale, settings, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState(`json-${tabId}`, {
    input: '{\n  "name": "OpenIDEA",\n  "version": "1.14",\n  "features": ["WASM", "Toolset", "Diff"]\n}',
    rightInput: '{\n  "name": "OpenIDEA",\n  "version": "1.14.1",\n  "features": ["WASM", "Toolset", "Diff", "TOTP"]\n}',
    indent: settings.defaultIndent || "2",
    jsonPath: "$.features[*]",
    mode: "text" as "text" | "tree" | "jsonpath" | "schema" | "diff",
    schemaTitle: "Root",
    sep: ".",
  });
  const [output, setOutput] = useState("");
  const [diffRes, setDiffRes] = useState<JsonDiffResult | null>(null);
  const [parsedTree, setParsedTree] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, input: initialInput }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  useEffect(() => {
    try {
      setParsedTree(JSON.parse(saved.input));
      if (saved.mode === "tree") setErr(null);
    } catch (e) {
      setParsedTree(null);
      if (saved.mode === "tree") setErr((e as Error).message);
    }
  }, [saved.input, saved.mode]);

  const runAction = async (action: string) => {
    setErr(null);
    try {
      const res = await bridge.rpc<{ result: string }>("format.json", {
        text: saved.input,
        action,
        indent: saved.indent,
        title: saved.schemaTitle,
      });
      setOutput(res.result);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const runRpcResult = async (method: string, extra: Record<string, unknown>) => {
    setErr(null);
    setSaved((p) => ({ ...p, mode: "text" }));
    try {
      const res = await bridge.rpc<{ result: string }>(method, extra);
      setOutput(res.result);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const runDiff = async (left = saved.input, right = saved.rightInput) => {
    setErr(null);
    try {
      const res = await bridge.rpc<JsonDiffResult>("format.jsonDiff", { left, right });
      setDiffRes(res);
    } catch (e) {
      setDiffRes(null);
      setErr((e as Error).message);
    }
  };

  const runJsonPath = async () => {
    setErr(null);
    try {
      const res = await bridge.rpc<{ result: string }>("format.jsonPath", {
        text: saved.input,
        path: saved.jsonPath,
      });
      setOutput(res.result);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const formatDiffVal = (v: unknown): string => {
    if (v === undefined) return "—";
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "JSON Toolkit", "JSON 工具箱")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, input: t }))}
          onPaste={(t) => setSaved((p) => ({ ...p, input: t }))}
          outputText={output || saved.input}
          openTabTitle="JSON"
          openTabLanguage="json"
          openTabFileName="toolset.json"
          diffLeft={saved.input}
          diffRight={output || saved.input}
          diffFileName="compare.json"
          onClear={() => {
            setSaved((p) => ({ ...p, input: "" }));
            setOutput("");
          }}
        />
      </div>

      <div className="ts-row">
        <select
          className="ts-select"
          style={{ width: 105 }}
          value={saved.indent}
          onChange={(e) => setSaved((p) => ({ ...p, indent: e.target.value }))}
        >
          <option value="2">{tx(locale, "2 spaces", "2 空格")}</option>
          <option value="4">{tx(locale, "4 spaces", "4 空格")}</option>
          <option value="tab">{tx(locale, "Tab", "Tab 制表符")}</option>
        </select>
        <button type="button" className="ts-btn primary" onClick={() => { setSaved((p) => ({ ...p, mode: "text" })); runAction("format"); }}>
          {tx(locale, "Format", "格式化")}
        </button>
        <button type="button" className="ts-btn" onClick={() => { setSaved((p) => ({ ...p, mode: "text" })); runAction("minify"); }}>
          {tx(locale, "Minify", "压缩")}
        </button>
        <button type="button" className="ts-btn" onClick={() => { setSaved((p) => ({ ...p, mode: "text" })); runAction("sort"); }}>
          {tx(locale, "Sort Keys", "键排序")}
        </button>
        <button type="button" className="ts-btn" onClick={() => { setSaved((p) => ({ ...p, mode: "text" })); runAction("escape"); }}>
          {tx(locale, "Escape", "转义")}
        </button>
        <button type="button" className="ts-btn" onClick={() => { setSaved((p) => ({ ...p, mode: "text" })); runAction("unescape"); }}>
          {tx(locale, "Unescape", "去转义")}
        </button>
        <button type="button" className="ts-btn" onClick={() => runRpcResult("format.jsonRepair", { text: saved.input, indent: saved.indent })}>
          {tx(locale, "Repair", "容错修复")}
        </button>
        <button type="button" className="ts-btn" onClick={() => runRpcResult("format.jsonFlatten", { text: saved.input, sep: saved.sep || "." })}>
          {tx(locale, "Flatten", "扁平化")}
        </button>
        <button type="button" className="ts-btn" onClick={() => runRpcResult("format.jsonUnflatten", { text: saved.input, sep: saved.sep || "." })}>
          {tx(locale, "Unflatten", "反扁平化")}
        </button>
        <button type="button" className={`ts-btn ${saved.mode === "tree" ? "primary" : ""}`} onClick={() => setSaved((p) => ({ ...p, mode: "tree" }))}>
          {tx(locale, "Tree", "树视图")}
        </button>
        <button type="button" className={`ts-btn ${saved.mode === "jsonpath" ? "primary" : ""}`} onClick={() => setSaved((p) => ({ ...p, mode: "jsonpath" }))}>
          JSONPath
        </button>
        <button type="button" className={`ts-btn ${saved.mode === "schema" ? "primary" : ""}`} onClick={() => { setSaved((p) => ({ ...p, mode: "schema" })); runAction("schema"); }}>
          Schema
        </button>
        <button type="button" className={`ts-btn ${saved.mode === "diff" ? "primary" : ""}`} onClick={() => { setSaved((p) => ({ ...p, mode: "diff" })); runDiff(); }}>
          {tx(locale, "Diff", "语义对比")}
        </button>
      </div>

      {saved.mode === "text" && (
        <div className="ts-row">
          <span className="ts-label">{tx(locale, "Flatten Key Sep:", "扁平键分隔符:")}</span>
          <input
            className="ts-input mono"
            style={{ width: 64 }}
            value={saved.sep}
            onChange={(e) => setSaved((p) => ({ ...p, sep: e.target.value }))}
            placeholder="."
          />
        </div>
      )}

      {saved.mode === "jsonpath" && (
        <div className="ts-row">
          <input
            className="ts-input mono"
            style={{ flex: 1 }}
            value={saved.jsonPath}
            onChange={(e) => setSaved((p) => ({ ...p, jsonPath: e.target.value }))}
            placeholder="$.items[?(@.score > 10)].name"
          />
          <button type="button" className="ts-btn primary" onClick={runJsonPath}>
            {tx(locale, "Query", "查询")}
          </button>
        </div>
      )}

      {saved.mode === "schema" && (
        <div className="ts-row">
          <input
            className="ts-input"
            style={{ width: 180 }}
            value={saved.schemaTitle}
            onChange={(e) => setSaved((p) => ({ ...p, schemaTitle: e.target.value }))}
            placeholder={tx(locale, "Root title", "根 Schema 标题")}
          />
          <button type="button" className="ts-btn primary" onClick={() => runAction("schema")}>
            {tx(locale, "Generate Schema", "生成 JSON Schema")}
          </button>
        </div>
      )}

      {saved.mode === "diff" ? (
        <>
          <div className="ts-row">
            <button type="button" className="ts-btn primary" onClick={() => runDiff()}>
              {tx(locale, "Compare JSON", "执行语义对比")}
            </button>
            <button
              type="button"
              className="ts-btn"
              onClick={() => {
                const nextLeft = saved.rightInput;
                const nextRight = saved.input;
                setSaved((p) => ({ ...p, input: nextLeft, rightInput: nextRight }));
                runDiff(nextLeft, nextRight);
              }}
            >
              {tx(locale, "Swap Left/Right", "左右交换")}
            </button>
            {diffRes && (
              <div className="ts-row">
                {diffRes.equal ? (
                  <span className="ts-badge good">{tx(locale, "Semantically Identical", "语义完全一致")}</span>
                ) : (
                  <>
                    <span className="ts-badge good">{tx(locale, `+${diffRes.summary.added} added`, `+${diffRes.summary.added} 新增`)}</span>
                    <span className="ts-badge bad">{tx(locale, `-${diffRes.summary.removed} removed`, `-${diffRes.summary.removed} 删除`)}</span>
                    <span className="ts-badge">{tx(locale, `~${diffRes.summary.changed} changed`, `~${diffRes.summary.changed} 变更`)}</span>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="ts-split">
            <div className="ts-col">
              <span className="ts-label">{tx(locale, "Left JSON", "左侧 JSON")}</span>
              <textarea
                className="ts-textarea mono"
                rows={7}
                value={saved.input}
                onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))}
                placeholder={tx(locale, "Left JSON...", "左侧 JSON...")}
              />
            </div>
            <div className="ts-col">
              <span className="ts-label">{tx(locale, "Right JSON", "右侧 JSON")}</span>
              <textarea
                className="ts-textarea mono"
                rows={7}
                value={saved.rightInput}
                onChange={(e) => setSaved((p) => ({ ...p, rightInput: e.target.value }))}
                placeholder={tx(locale, "Right JSON...", "右侧 JSON...")}
              />
            </div>
          </div>
          {err && <div className="ts-err">{err}</div>}
          {diffRes && !diffRes.equal && (
            <div className="ts-box" style={{ maxHeight: 240, overflow: "auto" }}>
              <table className="ts-table">
                <thead>
                  <tr>
                    <th>{tx(locale, "Path", "路径")}</th>
                    <th>{tx(locale, "Kind", "变更类型")}</th>
                    <th>{tx(locale, "Left", "左侧值")}</th>
                    <th>{tx(locale, "Right", "右侧值")}</th>
                  </tr>
                </thead>
                <tbody>
                  {diffRes.changes.map((c, idx) => (
                    <tr key={idx}>
                      <td className="ts-mono">{c.path}</td>
                      <td>
                        <span className={`ts-badge ${c.kind === "added" ? "good" : c.kind === "removed" ? "bad" : ""}`}>
                          {c.kind === "added" ? tx(locale, "Added", "新增") : c.kind === "removed" ? tx(locale, "Removed", "删除") : tx(locale, "Changed", "变更")}
                        </span>
                      </td>
                      <td className="ts-mono">{formatDiffVal(c.left)}</td>
                      <td className="ts-mono">{formatDiffVal(c.right)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <textarea
            className="ts-textarea mono"
            rows={6}
            value={saved.input}
            onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))}
            placeholder={tx(locale, "Paste JSON...", "粘贴 JSON...")}
          />

          {err && <div className="ts-err">{err}</div>}

          {saved.mode === "tree" ? (
            <div className="ts-box ts-tree" style={{ maxHeight: 280, overflowY: "auto" }}>
              {parsedTree !== null ? (
                <JsonTreeNode value={parsedTree} />
              ) : (
                <span style={{ color: "var(--ts-fg-muted)" }}>{tx(locale, "Invalid JSON", "无效的 JSON 格式")}</span>
              )}
            </div>
          ) : (
            <textarea
              className="ts-textarea mono"
              rows={8}
              readOnly
              value={output}
              placeholder={tx(locale, "Formatted output / query result...", "输出结果...")}
            />
          )}
        </>
      )}
    </div>
  );
}
