import { useEffect, useMemo, useState } from "react";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";
import {
  type ConfigFmt,
  convertConfig,
  diffConfigs,
  envKeyToPropKey,
  propKeyToEnvKey,
} from "../utils/configTools";

const SAMPLE_PROPS = [
  "server.port=8080",
  "server.servlet.context-path=/api",
  "spring.application.name=openidea-demo",
  "spring.datasource.url=jdbc:postgresql://localhost:5432/dev_db",
  "feature.cache.enabled=true",
].join("\n");

const SAMPLE_LEFT_ENV = [
  "SERVER_PORT=8080",
  "SPRING_APPLICATION_NAME=openidea-demo",
  "DB_HOST=localhost",
  "DB_PASSWORD=dev-only-sample",
  "FEATURE_BETA=true",
].join("\n");

const SAMPLE_RIGHT_YAML = [
  "server:",
  "  port: 8443",
  "spring:",
  "  application:",
  "    name: openidea-demo",
  "db:",
  "  host: prod.db.internal",
  "  password: prod-only-sample",
  "metrics:",
  "  enabled: true",
].join("\n");

export default function SpringConfigTool({ locale, initialInput, onConsumeInitial }: ToolProps) {
  // Security rule: keep raw config / .env / secret values strictly in memory, never persist to storage.
  const [saved, setSaved] = useToolState("spring-config", {
    tab: "diff" as "convert" | "diff",
    fromFmt: "properties" as ConfigFmt,
    toFmt: "yaml" as ConfigFmt,
    leftFmt: "env" as ConfigFmt,
    rightFmt: "yaml" as ConfigFmt,
    maskSecrets: true,
    diffOnly: false,
  });
  const [convertInput, setConvertInput] = useState(SAMPLE_PROPS);
  const [leftText, setLeftText] = useState(SAMPLE_LEFT_ENV);
  const [rightText, setRightText] = useState(SAMPLE_RIGHT_YAML);
  const [relaxedKey, setRelaxedKey] = useState("server.servlet.context-path");

  useEffect(() => {
    if (initialInput != null) {
      const trimmed = initialInput.trim();
      const guessed: ConfigFmt = trimmed.startsWith("{")
        ? "json"
        : /^[A-Z0-9_]+\s*=/.test(trimmed)
          ? "env"
          : trimmed.includes(":\n") || trimmed.includes(": ")
            ? "yaml"
            : "properties";
      setSaved((p) => ({ ...p, tab: "convert", fromFmt: guessed }));
      setConvertInput(initialInput);
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const converted = useMemo(
    () => convertConfig(convertInput, saved.fromFmt, saved.toFmt),
    [convertInput, saved.fromFmt, saved.toFmt],
  );

  const diffed = useMemo(
    () => diffConfigs(leftText, saved.leftFmt, rightText, saved.rightFmt, saved.maskSecrets),
    [leftText, saved.leftFmt, rightText, saved.rightFmt, saved.maskSecrets],
  );

  const visibleDiffRows = useMemo(
    () => (saved.diffOnly ? diffed.rows.filter((r) => r.status !== "same") : diffed.rows),
    [diffed.rows, saved.diffOnly],
  );

  const diffReport = visibleDiffRows
    .map((r) => `[${r.status.toUpperCase()}] ${r.key}: ${r.left || "∅"} -> ${r.right || "∅"}`)
    .join("\n");

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, ".env / Properties / YAML Config Diff", "配置格式互转与环境比对")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => {
            if (saved.tab === "convert") setConvertInput(t);
            else setLeftText(t);
          }}
          onPaste={(t) => {
            if (saved.tab === "convert") setConvertInput(t);
            else setLeftText(t);
          }}
          outputText={saved.tab === "convert" ? converted.output : diffReport}
          openTabTitle={saved.tab === "convert" ? "config-converted" : "config-diff-report.txt"}
          onClear={() => {
            if (saved.tab === "convert") setConvertInput("");
            else {
              setLeftText("");
              setRightText("");
            }
          }}
        />
      </div>

      <div className="ts-box" style={{ fontSize: 11.5, color: "var(--ts-fg-muted)" }}>
        {tx(
          locale,
          "Security note: Config contents stay strictly in memory (never written to disk), and sensitive keys (password/secret/token) are masked in Diff by default.",
          "安全提示：配置原文仅保留在内存中（绝不写入本地持久化），比对视图默认对密码/密钥/Token 等敏感键自动脱敏。",
        )}
      </div>

      <div className="ts-row">
        <button
          type="button"
          className={`ts-pill ${saved.tab === "diff" ? "active" : ""}`}
          onClick={() => setSaved((p) => ({ ...p, tab: "diff" }))}
        >
          {tx(locale, "Environment Config Diff", "多环境配置语义比对")}
        </button>
        <button
          type="button"
          className={`ts-pill ${saved.tab === "convert" ? "active" : ""}`}
          onClick={() => setSaved((p) => ({ ...p, tab: "convert" }))}
        >
          {tx(locale, "Format Convert & Relaxed Binding", "格式互转与 Spring 键名映射")}
        </button>
      </div>

      {saved.tab === "diff" ? (
        <>
          <div className="ts-row">
            <label className="ts-inline-check">
              <input
                type="checkbox"
                checked={saved.maskSecrets}
                onChange={(e) => setSaved((p) => ({ ...p, maskSecrets: e.target.checked }))}
              />
              {tx(locale, "Mask Sensitive Values", "敏感字段脱敏")}
            </label>
            <label className="ts-inline-check">
              <input
                type="checkbox"
                checked={saved.diffOnly}
                onChange={(e) => setSaved((p) => ({ ...p, diffOnly: e.target.checked }))}
              />
              {tx(locale, "Differences Only", "仅看差异项")}
            </label>
            <span className="ts-badge good">+{diffed.summary.added}</span>
            <span className="ts-badge bad">-{diffed.summary.removed}</span>
            <span className="ts-badge">~{diffed.summary.changed}</span>
            <span className="ts-badge">={diffed.summary.same}</span>
          </div>

          <div className="ts-split">
            <div className="ts-col" style={{ flex: 1 }}>
              <div className="ts-row">
                <span className="ts-label">{tx(locale, "Left (e.g. dev)", "左侧 (如 dev)")}</span>
                <select
                  className="ts-select"
                  style={{ width: 120 }}
                  value={saved.leftFmt}
                  onChange={(e) => setSaved((p) => ({ ...p, leftFmt: e.target.value as ConfigFmt }))}
                >
                  <option value="env">.env</option>
                  <option value="properties">.properties</option>
                  <option value="yaml">YAML</option>
                  <option value="json">JSON</option>
                </select>
              </div>
              <textarea
                className="ts-textarea mono"
                rows={7}
                value={leftText}
                onChange={(e) => setLeftText(e.target.value)}
              />
            </div>

            <div className="ts-col" style={{ flex: 1 }}>
              <div className="ts-row">
                <span className="ts-label">{tx(locale, "Right (e.g. prod)", "右侧 (如 prod)")}</span>
                <select
                  className="ts-select"
                  style={{ width: 120 }}
                  value={saved.rightFmt}
                  onChange={(e) => setSaved((p) => ({ ...p, rightFmt: e.target.value as ConfigFmt }))}
                >
                  <option value="env">.env</option>
                  <option value="properties">.properties</option>
                  <option value="yaml">YAML</option>
                  <option value="json">JSON</option>
                </select>
              </div>
              <textarea
                className="ts-textarea mono"
                rows={7}
                value={rightText}
                onChange={(e) => setRightText(e.target.value)}
              />
            </div>
          </div>

          {diffed.error && <div className="ts-err">{diffed.error}</div>}

          <div className="ts-box" style={{ maxHeight: 220, overflowY: "auto" }}>
            <table className="ts-table">
              <thead>
                <tr>
                  <th>{tx(locale, "Key", "配置键")}</th>
                  <th>{tx(locale, "Status", "状态")}</th>
                  <th>{tx(locale, "Left", "左侧值")}</th>
                  <th>{tx(locale, "Right", "右侧值")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleDiffRows.map((r) => (
                  <tr key={r.key}>
                    <td className="ts-mono">{r.key}</td>
                    <td>
                      <span className={`ts-badge ${r.status === "added" ? "good" : r.status === "removed" ? "bad" : ""}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="ts-mono">{r.left || "—"}</td>
                    <td className="ts-mono">{r.right || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="ts-row">
            <select
              className="ts-select"
              style={{ width: 130 }}
              value={saved.fromFmt}
              onChange={(e) => setSaved((p) => ({ ...p, fromFmt: e.target.value as ConfigFmt }))}
            >
              <option value="properties">.properties</option>
              <option value="yaml">YAML</option>
              <option value="env">.env</option>
              <option value="json">JSON</option>
            </select>
            <span>→</span>
            <select
              className="ts-select"
              style={{ width: 130 }}
              value={saved.toFmt}
              onChange={(e) => setSaved((p) => ({ ...p, toFmt: e.target.value as ConfigFmt }))}
            >
              <option value="yaml">YAML</option>
              <option value="properties">.properties</option>
              <option value="env">.env</option>
              <option value="json">JSON</option>
            </select>
            <span className="ts-badge good">{converted.count} {tx(locale, "keys", "个配置项")}</span>
          </div>

          <div className="ts-split">
            <textarea
              className="ts-textarea mono"
              rows={9}
              value={convertInput}
              onChange={(e) => setConvertInput(e.target.value)}
            />
            <textarea className="ts-textarea mono" rows={9} readOnly value={converted.output} />
          </div>

          {converted.error && <div className="ts-err">{converted.error}</div>}

          <div className="ts-box ts-row" style={{ gap: 8 }}>
            <span className="ts-label">{tx(locale, "Spring Relaxed Key:", "Spring 环境变量映射:")}</span>
            <input
              className="ts-input mono"
              style={{ width: 220 }}
              value={relaxedKey}
              onChange={(e) => setRelaxedKey(e.target.value)}
            />
            <span className="ts-badge ts-mono">ENV: {propKeyToEnvKey(relaxedKey)}</span>
            <span className="ts-badge ts-mono">Prop: {envKeyToPropKey(relaxedKey)}</span>
          </div>
        </>
      )}
    </div>
  );
}
