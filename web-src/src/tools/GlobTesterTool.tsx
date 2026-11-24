import { useEffect, useMemo } from "react";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";
import { evaluateGitignore, matchSingleGlob } from "../utils/globMatcher";

const SAMPLE_PATHS = [
  "src/main.rs",
  "src/lib/helper.ts",
  "target/debug/app",
  "target/important.log",
  "dist/bundle.js",
  "node_modules/vite/index.js",
  "logs/app.log",
  "logs/keep.log",
  ".env",
  ".env.example",
  "build/out/",
  "docs/guide.md",
].join("\n");

const PRESETS: Array<{ id: string; label: string; rules: string }> = [
  {
    id: "mixed",
    label: "Java / Node / Rust",
    rules: [
      "# Build outputs",
      "target/",
      "!target/important.log",
      "dist/",
      "node_modules/",
      "*.log",
      "!logs/keep.log",
      ".env*",
      "!.env.example",
    ].join("\n"),
  },
  {
    id: "maven",
    label: "Maven / Gradle",
    rules: ["target/", "build/", ".gradle/", "*.class", "*.jar", "!gradle/wrapper/gradle-wrapper.jar"].join("\n"),
  },
  {
    id: "python",
    label: "Python",
    rules: ["__pycache__/", "*.py[cod]", ".venv/", "dist/", "*.egg-info/"].join("\n"),
  },
];

export default function GlobTesterTool({ tabId, locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState(`glob-${tabId}`, {
    mode: "gitignore" as "gitignore" | "glob",
    rules: PRESETS[0].rules,
    singlePattern: "src/**/*.{ts,rs}",
    paths: SAMPLE_PATHS,
  });

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, rules: initialInput, mode: "gitignore" }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const gitignoreRows = useMemo(
    () => (saved.mode === "gitignore" ? evaluateGitignore(saved.rules, saved.paths) : []),
    [saved.mode, saved.rules, saved.paths],
  );

  const globRows = useMemo(() => {
    if (saved.mode !== "glob") return { rows: [], error: null as string | null };
    try {
      return { rows: matchSingleGlob(saved.singlePattern, saved.paths), error: null };
    } catch (e) {
      return { rows: [], error: (e as Error).message };
    }
  }, [saved.mode, saved.singlePattern, saved.paths]);

  const trackedPaths =
    saved.mode === "gitignore"
      ? gitignoreRows.filter((r) => !r.ignored).map((r) => r.path).join("\n")
      : globRows.rows.filter((r) => r.matched).map((r) => r.path).join("\n");

  const ignoredCount = gitignoreRows.filter((r) => r.ignored).length;
  const trackedCount = gitignoreRows.length - ignoredCount;

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Glob & .gitignore Pattern Matcher", "Glob 与 .gitignore 规则测试")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, rules: t, mode: "gitignore" }))}
          onPaste={(t) => setSaved((p) => ({ ...p, paths: t }))}
          outputText={trackedPaths}
          openTabTitle={tx(locale, "Matched Paths", "路径匹配结果")}
          onClear={() => setSaved((p) => ({ ...p, paths: "" }))}
        />
      </div>

      <div className="ts-row">
        <button
          type="button"
          className={`ts-pill ${saved.mode === "gitignore" ? "active" : ""}`}
          onClick={() => setSaved((p) => ({ ...p, mode: "gitignore" }))}
        >
          {tx(locale, ".gitignore Rules", ".gitignore 规则模拟")}
        </button>
        <button
          type="button"
          className={`ts-pill ${saved.mode === "glob" ? "active" : ""}`}
          onClick={() => setSaved((p) => ({ ...p, mode: "glob" }))}
        >
          {tx(locale, "Single Glob Pattern", "单 Glob 模式匹配")}
        </button>
        {saved.mode === "gitignore" &&
          PRESETS.map((pr) => (
            <button
              key={pr.id}
              type="button"
              className="ts-btn sm"
              onClick={() => setSaved((p) => ({ ...p, rules: pr.rules }))}
            >
              {pr.label}
            </button>
          ))}
      </div>

      <div className="ts-split">
        <div className="ts-col" style={{ flex: 1 }}>
          {saved.mode === "gitignore" ? (
            <label className="ts-label">
              {tx(locale, ".gitignore Rules (last match wins, ! negates)", ".gitignore 规则（后者覆盖前者，! 反向排除）")}
              <textarea
                className="ts-textarea mono"
                rows={9}
                value={saved.rules}
                onChange={(e) => setSaved((p) => ({ ...p, rules: e.target.value }))}
              />
            </label>
          ) : (
            <label className="ts-label">
              {tx(locale, "Glob Pattern (supports *, **, ?, [a-z], {a,b})", "Glob 表达式（支持 *、**、?、[a-z]、{a,b}）")}
              <input
                className="ts-input mono"
                value={saved.singlePattern}
                onChange={(e) => setSaved((p) => ({ ...p, singlePattern: e.target.value }))}
                placeholder="src/**/*.{ts,tsx}"
              />
            </label>
          )}
        </div>
        <label className="ts-label" style={{ flex: 1 }}>
          {tx(locale, "Test Paths (append / for directories)", "待测文件路径（目录末尾加 /）")}
          <textarea
            className="ts-textarea mono"
            rows={9}
            value={saved.paths}
            onChange={(e) => setSaved((p) => ({ ...p, paths: e.target.value }))}
          />
        </label>
      </div>

      {globRows.error && <div className="ts-err">{globRows.error}</div>}

      <div className="ts-row">
        {saved.mode === "gitignore" ? (
          <>
            <span className="ts-badge bad">{tx(locale, "Ignored", "已忽略")}: {ignoredCount}</span>
            <span className="ts-badge good">{tx(locale, "Tracked", "保留跟踪")}: {trackedCount}</span>
          </>
        ) : (
          <span className="ts-badge good">
            {tx(locale, "Matched", "命中数")}: {globRows.rows.filter((r) => r.matched).length} / {globRows.rows.length}
          </span>
        )}
      </div>

      <div className="ts-box" style={{ maxHeight: 230, overflowY: "auto" }}>
        <table className="ts-table">
          <thead>
            <tr>
              <th>{tx(locale, "Path", "路径")}</th>
              <th>{tx(locale, "Status", "判定")}</th>
              {saved.mode === "gitignore" && <th>{tx(locale, "Winning Rule", "命中规则行")}</th>}
            </tr>
          </thead>
          <tbody>
            {saved.mode === "gitignore"
              ? gitignoreRows.map((r, i) => (
                  <tr key={i}>
                    <td className="ts-mono">{r.path}</td>
                    <td>
                      <span className={`ts-badge ${r.ignored ? "bad" : "good"}`}>
                        {r.ignored
                          ? tx(locale, "Ignored", "已忽略")
                          : r.negated
                            ? tx(locale, "Re-included (!)", "已恢复跟踪 (!)")
                            : tx(locale, "Tracked", "保留跟踪")}
                      </span>
                    </td>
                    <td className="ts-mono" style={{ fontSize: 11, color: "var(--ts-fg-muted)" }}>
                      {r.matchedLine ? `L${r.matchedLine}: ${r.matchedRule}` : "—"}
                    </td>
                  </tr>
                ))
              : globRows.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="ts-mono">{r.path}</td>
                    <td>
                      <span className={`ts-badge ${r.matched ? "good" : ""}`}>
                        {r.matched ? tx(locale, "Match", "匹配") : tx(locale, "No Match", "不匹配")}
                      </span>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
