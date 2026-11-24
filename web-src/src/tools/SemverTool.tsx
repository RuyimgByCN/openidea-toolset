import { useEffect, useMemo, useState } from "react";
import { copyToClipboard } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";
import { bumpSemver, compareSemver, parseSemver, satisfiesRange, sortSemverList } from "../utils/semver";

const RANGE_EXAMPLES = [
  "^1.2.3",
  "~1.2.3",
  ">=1.2.0 <2.0.0",
  "1.x || ^2.4.0",
  "1.0.0 - 1.5.0",
  "[1.0.0,2.0.0)",
];

export default function SemverTool({ tabId, locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState(`semver-${tabId}`, {
    subtab: "range" as "parse" | "compare" | "range",
    version: "1.4.2-beta.1+build.42",
    verA: "1.10.0",
    verB: "1.2.0-rc.1",
    listInput: "v2.0.0\n1.2.0\n1.2.0-beta.2\n1.2.0-beta.11\n1.2.0-alpha\n0.9.5",
    rangeExpr: "^1.2.3",
    candidates: "1.2.2\n1.2.3\n1.5.0\n2.0.0-alpha.1\n2.0.0\n1.9.9",
  });
  const [sortDesc, setSortDesc] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      const trimmed = initialInput.trim();
      if (trimmed.includes("\n")) {
        setSaved((p) => ({ ...p, subtab: "compare", listInput: trimmed }));
      } else if (parseSemver(trimmed)) {
        setSaved((p) => ({ ...p, subtab: "parse", version: trimmed }));
      } else {
        setSaved((p) => ({ ...p, subtab: "range", rangeExpr: trimmed }));
      }
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const parsed = useMemo(() => parseSemver(saved.version), [saved.version]);
  const parsedA = useMemo(() => parseSemver(saved.verA), [saved.verA]);
  const parsedB = useMemo(() => parseSemver(saved.verB), [saved.verB]);
  const cmpRes = useMemo(() => (parsedA && parsedB ? compareSemver(parsedA, parsedB) : null), [parsedA, parsedB]);
  const sortedRes = useMemo(() => sortSemverList(saved.listInput.split("\n"), sortDesc), [saved.listInput, sortDesc]);

  const rangeRows = useMemo(() => {
    const lines = saved.candidates
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return lines.map((ver) => ({
      ver,
      res: satisfiesRange(ver, saved.rangeExpr),
    }));
  }, [saved.candidates, saved.rangeExpr]);

  const highestMatch = useMemo(() => {
    const passing = rangeRows
      .filter((r) => r.res.matched)
      .map((r) => parseSemver(r.ver))
      .filter((v): v is NonNullable<typeof v> => v !== null);
    if (passing.length === 0) return null;
    passing.sort((a, b) => compareSemver(b, a));
    return passing[0].raw;
  }, [rangeRows]);

  const copyText = async (t: string) => {
    await copyToClipboard(t);
    setStatus(tx(locale, `Copied ${t}`, `已复制 ${t}`));
    setTimeout(() => setStatus(null), 1200);
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "SemVer & Version Range Comparator", "SemVer 语义化版本与范围对比")}</span>
        <ToolActionBar
          locale={locale}
          onPaste={(t) => {
            if (saved.subtab === "parse") setSaved((p) => ({ ...p, version: t }));
            else if (saved.subtab === "compare") setSaved((p) => ({ ...p, listInput: t }));
            else setSaved((p) => ({ ...p, candidates: t }));
          }}
          outputText={
            saved.subtab === "compare"
              ? sortedRes.sorted.join("\n")
              : saved.subtab === "range"
                ? rangeRows.filter((r) => r.res.matched).map((r) => r.ver).join("\n")
                : saved.version
          }
        />
      </div>

      <div className="ts-row" style={{ justifyContent: "space-between" }}>
        <div className="ts-row">
          <button
            type="button"
            className={`ts-pill ${saved.subtab === "range" ? "active" : ""}`}
            onClick={() => setSaved((p) => ({ ...p, subtab: "range" }))}
          >
            {tx(locale, "Range Tester (NPM/Cargo/Maven)", "范围匹配测试")}
          </button>
          <button
            type="button"
            className={`ts-pill ${saved.subtab === "compare" ? "active" : ""}`}
            onClick={() => setSaved((p) => ({ ...p, subtab: "compare" }))}
          >
            {tx(locale, "Compare & Sort", "对比与排序")}
          </button>
          <button
            type="button"
            className={`ts-pill ${saved.subtab === "parse" ? "active" : ""}`}
            onClick={() => setSaved((p) => ({ ...p, subtab: "parse" }))}
          >
            {tx(locale, "Parse & Bump", "解析与递增")}
          </button>
        </div>
        {status && <span className="ts-badge good">{status}</span>}
      </div>

      {saved.subtab === "parse" && (
        <>
          <input
            className="ts-input mono"
            value={saved.version}
            onChange={(e) => setSaved((p) => ({ ...p, version: e.target.value }))}
            placeholder="1.2.3-alpha.1+build.42"
          />
          {parsed ? (
            <>
              <div className="ts-row">
                <span className="ts-badge good">Major: {parsed.major}</span>
                <span className="ts-badge good">Minor: {parsed.minor}</span>
                <span className="ts-badge good">Patch: {parsed.patch}</span>
                <span className="ts-badge">Pre: {parsed.prerelease.length ? parsed.prerelease.join(".") : "—"}</span>
                <span className="ts-badge">Build: {parsed.build.length ? parsed.build.join(".") : "—"}</span>
              </div>
              <div className="ts-box ts-col" style={{ gap: 6 }}>
                <span className="ts-label">{tx(locale, "Next Version Suggestions", "版本递增建议（点击应用/复制）")}</span>
                <div className="ts-row">
                  {(["patch", "minor", "major", "prerelease", "release"] as const).map((kind) => {
                    const nextV = bumpSemver(parsed, kind);
                    return (
                      <button
                        key={kind}
                        type="button"
                        className="ts-btn sm mono"
                        onClick={() => {
                          setSaved((p) => ({ ...p, version: nextV }));
                          void copyText(nextV);
                        }}
                      >
                        +{kind}: {nextV}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="ts-err">{tx(locale, "Invalid SemVer 2.0.0 string", "无效的 SemVer 2.0.0 版本号")}</div>
          )}
        </>
      )}

      {saved.subtab === "compare" && (
        <>
          <div className="ts-row">
            <input
              className="ts-input mono"
              style={{ flex: 1 }}
              value={saved.verA}
              onChange={(e) => setSaved((p) => ({ ...p, verA: e.target.value }))}
              placeholder="Version A"
            />
            <span className="ts-badge good" style={{ fontSize: 13 }}>
              {cmpRes === null ? "?" : cmpRes < 0 ? "<" : cmpRes > 0 ? ">" : "="}
            </span>
            <input
              className="ts-input mono"
              style={{ flex: 1 }}
              value={saved.verB}
              onChange={(e) => setSaved((p) => ({ ...p, verB: e.target.value }))}
              placeholder="Version B"
            />
          </div>

          <div className="ts-row" style={{ justifyContent: "space-between" }}>
            <span className="ts-label">{tx(locale, "Batch Sort Versions (one per line)", "批量版本号排序（每行一个）")}</span>
            <button type="button" className="ts-btn sm" onClick={() => setSortDesc((v) => !v)}>
              {sortDesc ? tx(locale, "Order: Descending", "排序：从高到低") : tx(locale, "Order: Ascending", "排序：从低到高")}
            </button>
          </div>
          <div className="ts-split">
            <textarea
              className="ts-textarea mono"
              rows={7}
              value={saved.listInput}
              onChange={(e) => setSaved((p) => ({ ...p, listInput: e.target.value }))}
            />
            <textarea
              className="ts-textarea mono"
              rows={7}
              readOnly
              value={sortedRes.sorted.join("\n")}
            />
          </div>
          {sortedRes.invalid.length > 0 && (
            <div className="ts-err">
              {tx(locale, "Ignored invalid versions:", "已忽略无效版本号:")} {sortedRes.invalid.join(", ")}
            </div>
          )}
        </>
      )}

      {saved.subtab === "range" && (
        <>
          <div className="ts-row">
            <input
              className="ts-input mono"
              style={{ flex: 1 }}
              value={saved.rangeExpr}
              onChange={(e) => setSaved((p) => ({ ...p, rangeExpr: e.target.value }))}
              placeholder="^1.2.3 or [1.0,2.0)"
            />
            <span className="ts-badge">
              {/^[(\[]/.test(saved.rangeExpr.trim()) ? "Maven Range" : "NPM / Cargo"}
            </span>
            {highestMatch && (
              <span className="ts-badge good">
                {tx(locale, "Highest match", "最高匹配版本")}: {highestMatch}
              </span>
            )}
          </div>
          <div className="ts-row">
            {RANGE_EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                className="ts-btn sm mono"
                onClick={() => setSaved((p) => ({ ...p, rangeExpr: ex }))}
              >
                {ex}
              </button>
            ))}
          </div>
          <div className="ts-split">
            <label className="ts-label">
              {tx(locale, "Candidate Versions (one per line)", "待测候选版本列表")}
              <textarea
                className="ts-textarea mono"
                rows={7}
                value={saved.candidates}
                onChange={(e) => setSaved((p) => ({ ...p, candidates: e.target.value }))}
              />
            </label>
            <div className="ts-box" style={{ flex: 1, maxHeight: 210, overflowY: "auto" }}>
              <table className="ts-table">
                <thead>
                  <tr>
                    <th>{tx(locale, "Version", "版本")}</th>
                    <th>{tx(locale, "Result", "匹配结果")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rangeRows.map((r, i) => (
                    <tr key={i}>
                      <td className="ts-mono">{r.ver}</td>
                      <td>
                        {r.res.error ? (
                          <span className="ts-badge bad">{r.res.error}</span>
                        ) : r.res.matched ? (
                          <span className="ts-badge good">{tx(locale, "Match", "满足")}</span>
                        ) : (
                          <span className="ts-badge">{tx(locale, "No Match", "不满足")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
