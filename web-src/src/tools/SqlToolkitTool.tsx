import { useEffect, useState } from "react";
import { bridge, copyToClipboard } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

type JoinKind = "inner" | "left" | "left_excl" | "right" | "right_excl" | "full" | "full_excl" | "cross";

const JOINS: Array<{
  id: JoinKind;
  name: string;
  sql: string;
  descEn: string;
  descZh: string;
  rows: Array<[string, string]>;
}> = [
  {
    id: "inner",
    name: "INNER JOIN",
    sql: "SELECT a.*, b.*\nFROM table_a a\nINNER JOIN table_b b ON a.id = b.id;",
    descEn: "Matching rows present in BOTH A and B.",
    descZh: "仅返回 A 与 B 键值匹配的交集记录。",
    rows: [["2 (Alice)", "2 (Order#10)"], ["3 (Bob)", "3 (Order#11)"]],
  },
  {
    id: "left",
    name: "LEFT JOIN",
    sql: "SELECT a.*, b.*\nFROM table_a a\nLEFT JOIN table_b b ON a.id = b.id;",
    descEn: "All rows from A, with matching B (or NULL).",
    descZh: "返回 A 的全部记录及 B 中匹配记录（未匹配为 NULL）。",
    rows: [["1 (Eve)", "NULL"], ["2 (Alice)", "2 (Order#10)"], ["3 (Bob)", "3 (Order#11)"]],
  },
  {
    id: "left_excl",
    name: "LEFT EXCLUDING",
    sql: "SELECT a.*\nFROM table_a a\nLEFT JOIN table_b b ON a.id = b.id\nWHERE b.id IS NULL;",
    descEn: "Rows in A that have NO match in B.",
    descZh: "仅返回存在于 A 但不在 B 中的差集记录。",
    rows: [["1 (Eve)", "NULL"]],
  },
  {
    id: "right",
    name: "RIGHT JOIN",
    sql: "SELECT a.*, b.*\nFROM table_a a\nRIGHT JOIN table_b b ON a.id = b.id;",
    descEn: "All rows from B, with matching A (or NULL).",
    descZh: "返回 B 的全部记录及 A 中匹配记录（未匹配为 NULL）。",
    rows: [["2 (Alice)", "2 (Order#10)"], ["3 (Bob)", "3 (Order#11)"], ["NULL", "4 (Order#12)"]],
  },
  {
    id: "right_excl",
    name: "RIGHT EXCLUDING",
    sql: "SELECT b.*\nFROM table_a a\nRIGHT JOIN table_b b ON a.id = b.id\nWHERE a.id IS NULL;",
    descEn: "Rows in B that have NO match in A.",
    descZh: "仅返回存在于 B 但不在 A 中的差集记录。",
    rows: [["NULL", "4 (Order#12)"]],
  },
  {
    id: "full",
    name: "FULL OUTER JOIN",
    sql: "SELECT a.*, b.*\nFROM table_a a\nFULL OUTER JOIN table_b b ON a.id = b.id;",
    descEn: "Union of all rows from A and B, NULL where unmatched.",
    descZh: "返回 A 与 B 的全量并集，无匹配一侧补 NULL。",
    rows: [["1 (Eve)", "NULL"], ["2 (Alice)", "2 (Order#10)"], ["3 (Bob)", "3 (Order#11)"], ["NULL", "4 (Order#12)"]],
  },
  {
    id: "full_excl",
    name: "FULL EXCLUDING",
    sql: "SELECT a.*, b.*\nFROM table_a a\nFULL OUTER JOIN table_b b ON a.id = b.id\nWHERE a.id IS NULL OR b.id IS NULL;",
    descEn: "Symmetric difference: rows in A or B without a match.",
    descZh: "对称差集：仅返回只在 A 或只在 B 中的孤立记录。",
    rows: [["1 (Eve)", "NULL"], ["NULL", "4 (Order#12)"]],
  },
  {
    id: "cross",
    name: "CROSS JOIN",
    sql: "SELECT a.*, b.*\nFROM table_a a\nCROSS JOIN table_b b;",
    descEn: "Cartesian product A × B (every pair).",
    descZh: "笛卡尔积：A 与 B 所有记录的两两组合。",
    rows: [["A×B", "|A| × |B| = 9 pairs"]],
  },
];

function VennSvg({ kind, idPrefix }: { kind: JoinKind; idPrefix: string }) {
  const fill = "var(--ts-accent)";
  const dim = "rgba(128,128,128,0.14)";
  const leftClip = `${idPrefix}-l`;
  const rightClip = `${idPrefix}-r`;
  const showLeftOnly = kind === "left" || kind === "left_excl" || kind === "full" || kind === "full_excl";
  const showRightOnly = kind === "right" || kind === "right_excl" || kind === "full" || kind === "full_excl";
  const showMid = kind === "inner" || kind === "left" || kind === "right" || kind === "full";

  if (kind === "cross") {
    return (
      <svg width="78" height="44" viewBox="0 0 78 44">
        <rect x="6" y="7" width="26" height="30" rx="4" fill={fill} fillOpacity="0.45" stroke="currentColor" strokeOpacity="0.6" />
        <rect x="46" y="7" width="26" height="30" rx="4" fill={fill} fillOpacity="0.45" stroke="currentColor" strokeOpacity="0.6" />
        <path d="M32 14 L46 30 M32 30 L46 14" stroke="var(--ts-accent)" strokeWidth="2" />
        <text x="19" y="25" textAnchor="middle" fontSize="10" fill="currentColor">A</text>
        <text x="59" y="25" textAnchor="middle" fontSize="10" fill="currentColor">B</text>
      </svg>
    );
  }

  return (
    <svg width="78" height="44" viewBox="0 0 78 44">
      <defs>
        <clipPath id={leftClip}><circle cx="28" cy="22" r="16" /></clipPath>
        <clipPath id={rightClip}><circle cx="50" cy="22" r="16" /></clipPath>
      </defs>
      <circle cx="28" cy="22" r="16" fill={showLeftOnly ? fill : dim} fillOpacity={showLeftOnly ? 0.55 : 1} />
      <circle cx="50" cy="22" r="16" fill={showRightOnly ? fill : dim} fillOpacity={showRightOnly ? 0.55 : 1} />
      <g clipPath={`url(#${leftClip})`}>
        <circle
          cx="50"
          cy="22"
          r="16"
          fill={showMid ? fill : "var(--ts-bg-elevated)"}
          fillOpacity={showMid ? 0.85 : 1}
        />
      </g>
      <circle cx="28" cy="22" r="16" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.2" />
      <circle cx="50" cy="22" r="16" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.2" />
      <text x="19" y="25" fontSize="9" fill="currentColor">A</text>
      <text x="54" y="25" fontSize="9" fill="currentColor">B</text>
    </svg>
  );
}

const SAMPLE_DDL = `CREATE TABLE \`user_account\` (
  \`id\` BIGINT NOT NULL AUTO_INCREMENT COMMENT 'User ID',
  \`username\` VARCHAR(64) NOT NULL COMMENT 'Login handle',
  \`email\` VARCHAR(128) COMMENT 'Contact email',
  \`balance\` DECIMAL(12, 2) NOT NULL DEFAULT 0.00 COMMENT 'Account balance',
  \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
  \`created_at\` DATETIME NOT NULL,
  PRIMARY KEY (\`id\`)
);`;

export default function SqlToolkitTool({ tabId, locale, settings, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState(`sql-${tabId}`, {
    subtab: "joins" as "joins" | "ddl" | "binder" | "format",
    joinKind: "inner" as JoinKind,
    ddlSql: SAMPLE_DDL,
    ddlTarget: "java",
    ddlRoot: "",
    ddlLombok: true,
    bindSql: "SELECT u.`id`, u.`username` FROM db.`user_account` u WHERE u.id = ? AND u.username = ? AND u.is_active = ?",
    bindParams: "1001(Long), alice(String), true(Boolean)",
    fmtSql: "select id, username from user_account where is_active = 1 order by id desc;",
  });
  const [ddlOut, setDdlOut] = useState("");
  const [bindOut, setBindOut] = useState("");
  const [fmtOut, setFmtOut] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      const upper = initialInput.toUpperCase();
      if (upper.includes("CREATE TABLE")) {
        setSaved((p) => ({ ...p, subtab: "ddl", ddlSql: initialInput }));
      } else if (initialInput.includes("?")) {
        setSaved((p) => ({ ...p, subtab: "binder", bindSql: initialInput }));
      } else {
        setSaved((p) => ({ ...p, subtab: "format", fmtSql: initialInput }));
      }
      onConsumeInitial?.();
    }
  }, [initialInput]);

  useEffect(() => {
    if (!bridge.isHosted || saved.subtab !== "ddl") return;
    bridge
      .rpc<{ result: string }>("sql.ddlConvert", {
        sql: saved.ddlSql,
        target: saved.ddlTarget,
        rootName: saved.ddlRoot,
        lombok: saved.ddlLombok,
      })
      .then((r) => { setDdlOut(r.result); setErr(null); })
      .catch((e) => setErr((e as Error).message));
  }, [saved.subtab, saved.ddlSql, saved.ddlTarget, saved.ddlRoot, saved.ddlLombok]);

  const activeJoin = JOINS.find((j) => j.id === saved.joinKind) ?? JOINS[0];

  const runStrip = async () => {
    setErr(null);
    try {
      const r = await bridge.rpc<{ result: string }>("sql.stripQualifiers", { sql: saved.bindSql });
      setBindOut(r.result);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const runBind = async () => {
    setErr(null);
    try {
      const r = await bridge.rpc<{ result: string }>("sql.bindParams", { sql: saved.bindSql, params: saved.bindParams });
      setBindOut(r.result);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const runFmt = async (minify: boolean) => {
    setErr(null);
    try {
      const r = await bridge.rpc<{ result: string }>("format.code", {
        text: saved.fmtSql,
        lang: "sql",
        minify,
        indent: settings.defaultIndent || "2",
      });
      setFmtOut(r.result);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const activeOutput =
    saved.subtab === "joins"
      ? activeJoin.sql
      : saved.subtab === "ddl"
        ? ddlOut
        : saved.subtab === "binder"
          ? bindOut
          : fmtOut;

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "SQL Toolkit", "SQL 工具箱")}</span>
        <ToolActionBar
          locale={locale}
          outputText={activeOutput}
          openTabTitle={tx(locale, "SQL Output", "SQL 输出")}
          openTabLanguage={saved.ddlTarget === "markdown" && saved.subtab === "ddl" ? "markdown" : "sql"}
          onStatus={(m, isErr) => setErr(isErr ? m : null)}
        />
      </div>

      <div className="ts-row">
        <button type="button" className={`ts-pill ${saved.subtab === "joins" ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, subtab: "joins" }))}>
          {tx(locale, "SQL Joins Venn", "Joins 维恩图")}
        </button>
        <button type="button" className={`ts-pill ${saved.subtab === "ddl" ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, subtab: "ddl" }))}>
          {tx(locale, "DDL Converter", "DDL 建表转换")}
        </button>
        <button type="button" className={`ts-pill ${saved.subtab === "binder" ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, subtab: "binder" }))}>
          {tx(locale, "Strip Qualifiers / ? Binder", "去限定符与 ? 参数绑定")}
        </button>
        <button type="button" className={`ts-pill ${saved.subtab === "format" ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, subtab: "format" }))}>
          {tx(locale, "Format / Minify", "SQL 格式化")}
        </button>
      </div>

      {err && <div className="ts-err">{err}</div>}

      {saved.subtab === "joins" && (
        <div className="ts-col">
          <div className="ts-venn-grid">
            {JOINS.map((j) => (
              <button
                key={j.id}
                type="button"
                className={`ts-venn-card ${saved.joinKind === j.id ? "active" : ""}`}
                onClick={() => setSaved((p) => ({ ...p, joinKind: j.id }))}
              >
                <VennSvg kind={j.id} idPrefix={`venn-${tabId}-${j.id}`} />
                <strong>{j.name}</strong>
              </button>
            ))}
          </div>

          <div className="ts-box ts-col">
            <div className="ts-row" style={{ justifyContent: "space-between" }}>
              <strong>{activeJoin.name}</strong>
              <button type="button" className="ts-btn sm primary" onClick={() => copyToClipboard(activeJoin.sql)}>
                {tx(locale, "Copy SQL", "复制 SQL")}
              </button>
            </div>
            <div style={{ fontSize: 12, color: "var(--ts-fg-muted)" }}>
              {tx(locale, activeJoin.descEn, activeJoin.descZh)}
            </div>
            <pre className="ts-mono" style={{ margin: 0, fontSize: 12, background: "var(--ts-bg-input)", padding: 8, borderRadius: 5 }}>
              {activeJoin.sql}
            </pre>
            <div style={{ fontSize: 11.5, color: "var(--ts-fg-muted)" }}>
              {tx(
                locale,
                "Table A: [1: Eve, 2: Alice, 3: Bob] · Table B: [2: Order#10, 3: Order#11, 4: Order#12]",
                "表 A：[1: Eve, 2: Alice, 3: Bob] · 表 B：[2: Order#10, 3: Order#11, 4: Order#12]",
              )}
            </div>
            <table className="ts-table">
              <thead><tr><th>{tx(locale, "Table A", "表 A")}</th><th>{tx(locale, "Table B", "表 B")}</th></tr></thead>
              <tbody>
                {activeJoin.rows.map(([a, b], idx) => (
                  <tr key={idx}><td className="ts-mono">{a}</td><td className="ts-mono">{b}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {saved.subtab === "ddl" && (
        <div className="ts-col">
          <div className="ts-row">
            <select className="ts-select" style={{ width: 155 }} value={saved.ddlTarget} onChange={(e) => setSaved((p) => ({ ...p, ddlTarget: e.target.value }))}>
              <option value="json">{tx(locale, "JSON Sample", "JSON 示例")}</option>
              <option value="markdown">{tx(locale, "Column Markdown", "Markdown 字段表")}</option>
              <option value="java">Java POJO</option>
              <option value="java-record">Java Record</option>
              <option value="typescript">{tx(locale, "TypeScript Interface", "TypeScript 接口")}</option>
              <option value="go">{tx(locale, "Go Struct", "Go 结构体")}</option>
              <option value="rust">{tx(locale, "Rust Struct", "Rust 结构体")}</option>
            </select>
            <input
              className="ts-input"
              style={{ width: 140 }}
              value={saved.ddlRoot}
              onChange={(e) => setSaved((p) => ({ ...p, ddlRoot: e.target.value }))}
              placeholder={tx(locale, "Class / Type name", "自定义类名（可选）")}
            />
            {saved.ddlTarget === "java" && (
              <label className="ts-inline-check">
                <input type="checkbox" checked={saved.ddlLombok} onChange={(e) => setSaved((p) => ({ ...p, ddlLombok: e.target.checked }))} />
                Lombok @Data
              </label>
            )}
          </div>
          <div className="ts-split">
            <textarea className="ts-textarea mono" rows={10} value={saved.ddlSql} onChange={(e) => setSaved((p) => ({ ...p, ddlSql: e.target.value }))} />
            <textarea className="ts-textarea mono" rows={10} readOnly value={ddlOut} />
          </div>
        </div>
      )}

      {saved.subtab === "binder" && (
        <div className="ts-col">
          <label className="ts-label">
            {tx(locale, "SQL / MyBatis Preparing SQL", "原始 SQL / MyBatis 预编译语句")}
            <textarea className="ts-textarea mono" rows={4} value={saved.bindSql} onChange={(e) => setSaved((p) => ({ ...p, bindSql: e.target.value }))} />
          </label>
          <label className="ts-label">
            {tx(locale, "Parameters (MyBatis format e.g. 1(Long), a(String) OR JSON array [1, \"a\"])", "参数列表（支持 MyBatis 日志格式 1(Long), a(String) 或 JSON 数组）")}
            <input className="ts-input mono" value={saved.bindParams} onChange={(e) => setSaved((p) => ({ ...p, bindParams: e.target.value }))} />
          </label>
          <div className="ts-row">
            <button type="button" className="ts-btn primary" onClick={runBind}>
              {tx(locale, "Bind ? Params", "绑定 ? 参数")}
            </button>
            <button type="button" className="ts-btn" onClick={runStrip}>
              {tx(locale, "Strip Qualifiers (`t.col` → `col`)", "去除表前缀与反引号")}
            </button>
          </div>
          <textarea className="ts-textarea mono" rows={6} readOnly value={bindOut} />
        </div>
      )}

      {saved.subtab === "format" && (
        <div className="ts-col">
          <div className="ts-row">
            <button type="button" className="ts-btn primary" onClick={() => runFmt(false)}>{tx(locale, "Beautify SQL", "美化 SQL")}</button>
            <button type="button" className="ts-btn" onClick={() => runFmt(true)}>{tx(locale, "Minify SQL", "压缩 SQL")}</button>
          </div>
          <textarea className="ts-textarea mono" rows={6} value={saved.fmtSql} onChange={(e) => setSaved((p) => ({ ...p, fmtSql: e.target.value }))} />
          <textarea className="ts-textarea mono" rows={8} readOnly value={fmtOut} />
        </div>
      )}
    </div>
  );
}
