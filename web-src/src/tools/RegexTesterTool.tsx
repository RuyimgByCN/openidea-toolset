import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { bridge, copyToClipboard, saveHostFile } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";
import { explainRegexAst, renderRegexRailroadSvg } from "../utils/regexDiagram";

interface MatchItem {
  s: number;
  e: number;
  text: string;
  groups: Array<[number, number] | null>;
}

interface EvalResult {
  error: string | null;
  matches: MatchItem[];
  count: number;
  groups: Array<string | null>;
  replaced?: string | null;
}

const REGEX_PRESETS: Array<{ en: string; zh: string; pattern: string; flags: string }> = [
  { en: "Email Address", zh: "邮箱地址", pattern: String.raw`[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`, flags: "i" },
  { en: "HTTP/HTTPS URL", zh: "HTTP/HTTPS 网址", pattern: String.raw`https?://[^\s/$.?#].[^\s]*`, flags: "i" },
  { en: "IPv4 Address", zh: "IPv4 地址", pattern: String.raw`\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b`, flags: "" },
  { en: "IPv6 (Compressed/Full)", zh: "IPv6 地址", pattern: String.raw`([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|::1|([0-9a-fA-F]{1,4}:){1,7}:`, flags: "" },
  { en: "UUID (v1-v7)", zh: "UUID (v1-v7)", pattern: String.raw`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`, flags: "i" },
  { en: "ISO 8601 DateTime", zh: "ISO 8601 日期时间", pattern: String.raw`\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?`, flags: "" },
  { en: "Date (YYYY-MM-DD)", zh: "日期 (YYYY-MM-DD)", pattern: String.raw`\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])`, flags: "" },
  { en: "Time (HH:MM:SS)", zh: "时间 (HH:MM:SS)", pattern: String.raw`([01]\d|2[0-3]):[0-5]\d:[0-5]\d`, flags: "" },
  { en: "SemVer (v1.2.3)", zh: "语义化版本号 (SemVer)", pattern: String.raw`\bv?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9a-zA-Z.-]+)?(?:\+[0-9a-zA-Z.-]+)?\b`, flags: "" },
  { en: "JWT Token", zh: "JWT 令牌", pattern: String.raw`eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*`, flags: "" },
  { en: "Hex Color (#RGB/#RRGGBB)", zh: "十六进制颜色值", pattern: String.raw`#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3}|[A-Fa-f0-9]{8})\b`, flags: "" },
  { en: "MAC Address", zh: "MAC 物理地址", pattern: String.raw`([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}`, flags: "" },
  { en: "China Mobile Phone", zh: "中国大陆手机号", pattern: String.raw`\b1[3-9]\d{9}\b`, flags: "" },
  { en: "China ID Card (18 digits)", zh: "中国身份证号 (18位)", pattern: String.raw`\b[1-9]\d{5}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b`, flags: "" },
  { en: "Chinese Characters", zh: "中文字符", pattern: String.raw`[\u4e00-\u9fa5]+`, flags: "" },
  { en: "Slug / kebab-case", zh: "短横线命名 (kebab-case)", pattern: String.raw`[a-z0-9]+(?:-[a-z0-9]+)*`, flags: "" },
  { en: "Integer / Decimal Number", zh: "整数或浮点数", pattern: String.raw`-?\d+(?:\.\d+)?`, flags: "" },
  { en: "Domain Name", zh: "域名", pattern: String.raw`\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b`, flags: "" },
  { en: "Port (1..65535)", zh: "端口号 (1..65535)", pattern: String.raw`\b([1-9]\d{0,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])\b`, flags: "" },
  { en: "Quoted String (\"...\")", zh: "双引号字符串", pattern: String.raw`"([^"\\]*(\\.[^"\\]*)*)"`, flags: "" },
  { en: "Docker Image Tag", zh: "Docker 镜像标签", pattern: String.raw`[a-z0-9]+(?:[._-][a-z0-9]+)*/[a-z0-9._-]+:[a-zA-Z0-9._-]+`, flags: "" },
];

const QUICK_CHEAT: Array<[string, string, string]> = [
  ["\\d / \\D", "Digit / Non-digit", "数字 / 非数字"],
  ["\\w / \\W", "Word [a-zA-Z0-9_]", "单词字符"],
  ["\\s / \\S", "Whitespace / Non-WS", "空白 / 非空白"],
  ["\\b", "Word boundary", "单词边界"],
  ["*? / +?", "Lazy quantifiers", "非贪婪匹配"],
  ["(?<name>...)", "Named capture group", "命名捕获组"],
  ["(?:...)", "Non-capturing group", "非捕获组"],
  ["a|b", "Alternation", "逻辑或分支"],
];

export default function RegexTesterTool({
  tabId,
  locale,
  initialInput,
  onConsumeInitial,
  regexHistory,
  onSaveRegexHistory,
}: ToolProps) {
  const [saved, setSaved] = useToolState(`regex-${tabId}`, {
    pattern: String.raw`(?<name>\w+)@(\d+)`,
    flags: "m",
    text: "alice@100\nbob@200\ncharlie@300",
    replace: "$name -> #$2",
  });
  const [res, setRes] = useState<EvalResult | null>(null);
  const [showRef, setShowRef] = useState(false);
  const [showDiagram, setShowDiagram] = useState(true);
  const [showExplain, setShowExplain] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const diagram = useMemo(() => renderRegexRailroadSvg(saved.pattern, saved.flags), [saved.pattern, saved.flags]);
  const explanations = useMemo(() => explainRegexAst(saved.pattern), [saved.pattern]);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, text: initialInput }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  useEffect(() => {
    if (!bridge.isHosted) return;
    const t = setTimeout(() => {
      bridge
        .rpc<EvalResult>("regex.eval", {
          pattern: saved.pattern,
          flags: saved.flags,
          text: saved.text,
          replace: saved.replace,
        })
        .then(setRes)
        .catch(() => {});
    }, 90);
    return () => clearTimeout(t);
  }, [saved.pattern, saved.flags, saved.text, saved.replace]);

  const toggleFlag = (f: string) => {
    setSaved((p) => ({
      ...p,
      flags: p.flags.includes(f) ? p.flags.replace(f, "") : p.flags + f,
    }));
  };

  const saveToHistory = () => {
    if (!saved.pattern.trim()) return;
    const next = [
      { pattern: saved.pattern, flags: saved.flags, savedAt: Date.now() },
      ...regexHistory.filter((h) => h.pattern !== saved.pattern || h.flags !== saved.flags),
    ].slice(0, 30);
    onSaveRegexHistory(next);
  };

  const extractMatches = (asJson: boolean) => {
    const vals = (res?.matches ?? []).map((m) => m.text);
    const out = asJson ? JSON.stringify(vals, null, 2) : vals.join("\n");
    copyToClipboard(out);
  };

  const renderHighlighted = () => {
    const text = saved.text;
    const matches = res?.matches ?? [];
    if (!matches.length) return text;
    const nodes: ReactNode[] = [];
    let cursor = 0;
    matches.forEach((m, idx) => {
      if (m.s > cursor) nodes.push(text.slice(cursor, m.s));
      if (m.e >= m.s) {
        nodes.push(
          <mark key={idx} className="ts-hl-mark">
            {text.slice(m.s, m.e) || "∅"}
          </mark>,
        );
      }
      cursor = Math.max(cursor, m.e);
    });
    if (cursor < text.length) nodes.push(text.slice(cursor));
    return nodes;
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Regex Tester", "正则表达式测试")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, text: t }))}
          onPaste={(t) => setSaved((p) => ({ ...p, text: t }))}
          outputText={res?.replaced ?? ""}
          openTabTitle={tx(locale, "Regex Replaced", "正则替换结果")}
        />
      </div>

      <div className="ts-row">
        <select
          className="ts-select"
          style={{ width: 175 }}
          value=""
          onChange={(e) => {
            const p = REGEX_PRESETS[Number(e.target.value)];
            if (p) setSaved((prev) => ({ ...prev, pattern: p.pattern, flags: p.flags }));
          }}
        >
          <option value="">{tx(locale, "Presets (21)...", "常用正则预设 (21)...")}</option>
          {REGEX_PRESETS.map((p, idx) => (
            <option key={p.en} value={String(idx)}>{tx(locale, p.en, p.zh)}</option>
          ))}
        </select>

        <select
          className="ts-select"
          style={{ width: 145 }}
          value=""
          onChange={(e) => {
            const h = regexHistory[Number(e.target.value)];
            if (h) setSaved((prev) => ({ ...prev, pattern: h.pattern, flags: h.flags }));
          }}
        >
          <option value="">{tx(locale, `History (${regexHistory.length})`, `历史记录 (${regexHistory.length})`)}</option>
          {regexHistory.map((h, idx) => (
            <option key={`${h.pattern}-${h.flags}-${idx}`} value={String(idx)}>
              /{h.pattern.slice(0, 28)}/{h.flags}
            </option>
          ))}
        </select>

        <button type="button" className="ts-btn sm" onClick={saveToHistory}>
          {tx(locale, "Save History", "存历史")}
        </button>
        <button type="button" className={`ts-pill ${showDiagram ? "active" : ""}`} onClick={() => setShowDiagram((v) => !v)}>
          {tx(locale, "Railroad Diagram", "可视化轨道图")}
        </button>
        <button type="button" className={`ts-pill ${showExplain ? "active" : ""}`} onClick={() => setShowExplain((v) => !v)}>
          {tx(locale, "Explain", "逐段解释")}
        </button>
        <button type="button" className={`ts-pill ${showRef ? "active" : ""}`} onClick={() => setShowRef((v) => !v)}>
          {tx(locale, "Syntax Ref", "语法参考")}
        </button>
        {status && <span className="ts-badge good">{status}</span>}
      </div>

      {showRef && (
        <div className="ts-box ts-row" style={{ gap: 10 }}>
          {QUICK_CHEAT.map(([tok, descEn, descZh]) => (
            <span key={tok} className="ts-badge">
              <strong className="ts-mono" style={{ marginRight: 4 }}>{tok}</strong> {tx(locale, descEn, descZh)}
            </span>
          ))}
        </div>
      )}

      <div className="ts-row">
        <input
          className="ts-input mono"
          style={{ flex: 1 }}
          value={saved.pattern}
          onChange={(e) => setSaved((p) => ({ ...p, pattern: e.target.value }))}
          placeholder={tx(locale, "Regular expression...", "输入正则表达式...")}
        />
        {["i", "m", "s", "x"].map((f) => (
          <button
            key={f}
            type="button"
            className={`ts-pill ${saved.flags.includes(f) ? "active" : ""}`}
            onClick={() => toggleFlag(f)}
          >
            /{f}
          </button>
        ))}
        <span className="ts-badge">{res ? `${res.count} ${tx(locale, "matches", "匹配")}` : "..."}</span>
        {res && res.count > 0 && (
          <>
            <button type="button" className="ts-btn sm" onClick={() => extractMatches(false)}>
              {tx(locale, "Extract Lines", "提取匹配行")}
            </button>
            <button type="button" className="ts-btn sm" onClick={() => extractMatches(true)}>
              {tx(locale, "Extract JSON", "提取 JSON")}
            </button>
          </>
        )}
      </div>

      {res?.error && <div className="ts-err">{res.error}</div>}

      {showDiagram && (
        <div className="ts-box ts-col" style={{ gap: 6 }}>
          <div className="ts-row" style={{ justifyContent: "space-between" }}>
            <span className="ts-label">
              {tx(locale, "Railroad Diagram", "正则轨道图 (Railroad Diagram)")} ({diagram.width}×{diagram.height})
            </span>
            <div className="ts-row">
              <button
                type="button"
                className="ts-btn sm"
                onClick={async () => {
                  await copyToClipboard(diagram.svg);
                  setStatus(tx(locale, "SVG copied", "已复制 SVG"));
                  setTimeout(() => setStatus(null), 1500);
                }}
              >
                {tx(locale, "Copy SVG", "复制 SVG")}
              </button>
              <button
                type="button"
                className="ts-btn sm"
                onClick={async () => {
                  const savedPath = await saveHostFile("regex-railroad.svg", diagram.svg, [
                    { name: "SVG", extensions: ["svg"] },
                  ]);
                  if (savedPath) {
                    setStatus(tx(locale, `Saved ${savedPath}`, `已保存 ${savedPath}`));
                  }
                }}
              >
                {tx(locale, "Save SVG", "保存 SVG")}
              </button>
            </div>
          </div>
          <div style={{ overflowX: "auto", padding: "4px 0" }}>
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(diagram.svg)}`}
              alt={tx(locale, "Regex Railroad Diagram", "正则轨道图")}
              style={{ maxWidth: "100%", height: "auto", display: "block" }}
            />
          </div>
        </div>
      )}

      {showExplain && (
        <div className="ts-box ts-col" style={{ maxHeight: 185, overflowY: "auto", gap: 4 }}>
          <span className="ts-label">{tx(locale, "Pattern Breakdown", "正则结构逐段解析")}</span>
          {explanations.map((item, idx) => (
            <div key={idx} className="ts-row" style={{ paddingLeft: item.depth * 14, gap: 8 }}>
              <span className="ts-badge ts-mono">{item.token}</span>
              <span style={{ fontSize: 11.5 }}>{tx(locale, item.descEn, item.descZh)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="ts-split">
        <label className="ts-label">
          {tx(locale, "Sample Text", "测试文本")}
          <textarea
            className="ts-textarea mono"
            rows={5}
            value={saved.text}
            onChange={(e) => setSaved((p) => ({ ...p, text: e.target.value }))}
          />
        </label>
        <div className="ts-label">
          {tx(locale, "Highlighted Matches", "高亮预览")}
          <div className="ts-hl-preview">{renderHighlighted()}</div>
        </div>
      </div>

      <label className="ts-label">
        {tx(locale, "Replacement Template ($1, $name)", "替换模板（支持 $1、$name）")}
        <input
          className="ts-input mono"
          value={saved.replace}
          onChange={(e) => setSaved((p) => ({ ...p, replace: e.target.value }))}
        />
      </label>

      {res?.replaced != null && (
        <textarea className="ts-textarea mono" rows={4} readOnly value={res.replaced} />
      )}

      {res && res.matches.length > 0 && (
        <div className="ts-box" style={{ maxHeight: 160, overflowY: "auto" }}>
          <table className="ts-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{tx(locale, "Match", "匹配内容")}</th>
                <th>{tx(locale, "Range", "范围")}</th>
                <th>{tx(locale, "Groups", "捕获组")}</th>
              </tr>
            </thead>
            <tbody>
              {res.matches.slice(0, 50).map((m, idx) => (
                <tr key={idx}>
                  <td>{idx + 1}</td>
                  <td className="ts-mono">{m.text}</td>
                  <td className="ts-mono">[{m.s}, {m.e})</td>
                  <td className="ts-mono">
                    {m.groups
                      .map((g, gi) => {
                        const nm = res.groups[gi];
                        const val = g ? saved.text.slice(g[0], g[1]) : "null";
                        return `${nm ?? gi + 1}: ${val}`;
                      })
                      .join(" | ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
