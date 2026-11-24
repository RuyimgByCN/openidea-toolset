import { useEffect, useMemo, useState } from "react";
import { copyToClipboard } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";
import { inspectHttpHeaders, parseUserAgent } from "../utils/httpInspect";

const SAMPLE_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SAMPLE_SAFE_HEADERS = [
  "HTTP/1.1 200 OK",
  "Cache-Control: private, max-age=300, stale-while-revalidate=60",
  "Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.example.com; img-src * data:",
  "Strict-Transport-Security: max-age=31536000; includeSubDomains",
  "X-Content-Type-Options: nosniff",
  "X-Frame-Options: SAMEORIGIN",
  "Referrer-Policy: strict-origin-when-cross-origin",
  "Set-Cookie: theme=dark; Path=/; Max-Age=86400; Secure; HttpOnly; SameSite=Lax",
].join("\n");

const SAMPLE_INSECURE_HEADERS = [
  "HTTP/1.1 200 OK",
  "Cache-Control: public, max-age=86400",
  "Access-Control-Allow-Origin: *",
  "Access-Control-Allow-Credentials: true",
  "Set-Cookie: sid=sample_demo_value; Path=/; SameSite=None",
].join("\n");

const UA_PRESETS: Array<{ label: string; ua: string }> = [
  { label: "Chrome macOS", ua: SAMPLE_UA },
  {
    label: "Safari iOS",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  },
  {
    label: "Firefox Linux",
    ua: "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
  },
  {
    label: "Edge Windows",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  },
  {
    label: "Googlebot",
    ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  },
  { label: "curl", ua: "curl/8.7.1" },
];

export default function UaHeadersTool({ locale, initialInput, onConsumeInitial }: ToolProps) {
  // Security rule: never persist raw HTTP headers / Set-Cookie values in storage.
  const [saved, setSaved] = useToolState("ua-headers", {
    tab: "headers" as "headers" | "ua",
    ua: SAMPLE_UA,
  });
  const [rawHeaders, setRawHeaders] = useState(SAMPLE_SAFE_HEADERS);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      const looksLikeHeaders = initialInput.includes(":") && initialInput.includes("\n");
      if (looksLikeHeaders) {
        setSaved((p) => ({ ...p, tab: "headers" }));
        setRawHeaders(initialInput);
      } else {
        setSaved((p) => ({ ...p, tab: "ua", ua: initialInput }));
      }
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const parsedUa = useMemo(() => parseUserAgent(saved.ua), [saved.ua]);
  const headerReport = useMemo(() => inspectHttpHeaders(rawHeaders), [rawHeaders]);

  const exportJson =
    saved.tab === "ua" ? JSON.stringify(parsedUa, null, 2) : JSON.stringify(headerReport, null, 2);

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "UA & HTTP Header Security Inspector", "UA 与 HTTP 请求/响应头分析")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => {
            if (saved.tab === "headers") setRawHeaders(t);
            else setSaved((p) => ({ ...p, ua: t }));
          }}
          onPaste={(t) => {
            if (saved.tab === "headers") setRawHeaders(t);
            else setSaved((p) => ({ ...p, ua: t }));
          }}
          outputText={exportJson}
          openTabTitle={tx(locale, "Header Analysis", "请求头分析结果")}
          openTabLanguage="json"
          onClear={() => {
            if (saved.tab === "headers") setRawHeaders("");
            else setSaved((p) => ({ ...p, ua: "" }));
          }}
        />
      </div>

      <div className="ts-row" style={{ justifyContent: "space-between" }}>
        <div className="ts-row">
          <button
            type="button"
            className={`ts-pill ${saved.tab === "headers" ? "active" : ""}`}
            onClick={() => setSaved((p) => ({ ...p, tab: "headers" }))}
          >
            {tx(locale, "HTTP Headers & Security", "HTTP 请求/响应头审计")}
          </button>
          <button
            type="button"
            className={`ts-pill ${saved.tab === "ua" ? "active" : ""}`}
            onClick={() => setSaved((p) => ({ ...p, tab: "ua" }))}
          >
            {tx(locale, "User-Agent Parser", "User-Agent 解析")}
          </button>
        </div>
        {status && <span className="ts-badge good">{status}</span>}
      </div>

      {saved.tab === "headers" ? (
        <>
          <div className="ts-box" style={{ fontSize: 11.5, color: "var(--ts-fg-muted)" }}>
            {tx(
              locale,
              "Security note: Raw headers, cookies, and tokens stay strictly in memory and are never persisted to plugin storage.",
              "安全提示：原始请求头、Cookie 与凭证内容仅在当前内存会话中解析，绝不会写入磁盘持久化。",
            )}
          </div>

          <div className="ts-row">
            <button type="button" className="ts-btn sm" onClick={() => setRawHeaders(SAMPLE_SAFE_HEADERS)}>
              {tx(locale, "Hardened Sample", "规范安全响应头示例")}
            </button>
            <button type="button" className="ts-btn sm" onClick={() => setRawHeaders(SAMPLE_INSECURE_HEADERS)}>
              {tx(locale, "Risky Cookie / CORS Sample", "风险 Cookie / CORS 示例")}
            </button>
            <span className="ts-badge">{headerReport.headers.length} {tx(locale, "headers", "个 Header")}</span>
          </div>

          <textarea
            className="ts-textarea mono"
            rows={6}
            value={rawHeaders}
            onChange={(e) => setRawHeaders(e.target.value)}
            placeholder={tx(
              locale,
              "Paste raw HTTP request or response headers (Key: Value)...",
              "粘贴原始 HTTP 请求或响应头 (Key: Value)...",
            )}
          />

          <div className="ts-box ts-col" style={{ gap: 6 }}>
            <span className="ts-label">{tx(locale, "Security Header Checklist", "安全响应头体检")}</span>
            <table className="ts-table">
              <thead>
                <tr>
                  <th>Header</th>
                  <th>{tx(locale, "Status", "状态")}</th>
                  <th>{tx(locale, "Assessment", "评估建议")}</th>
                </tr>
              </thead>
              <tbody>
                {headerReport.audit.map((a) => (
                  <tr key={a.header}>
                    <td className="ts-mono">{a.header}</td>
                    <td>
                      <span className={`ts-badge ${a.status === "pass" ? "good" : a.status === "warn" ? "bad" : ""}`}>
                        {a.status === "pass"
                          ? tx(locale, "Pass", "通过")
                          : a.status === "warn"
                            ? tx(locale, "Warn", "警告")
                            : tx(locale, "Missing", "缺失")}
                      </span>
                    </td>
                    <td>
                      <div>{tx(locale, a.noteEn, a.noteZh)}</div>
                      {a.value && <div className="ts-mono" style={{ fontSize: 10.5, color: "var(--ts-fg-muted)" }}>{a.value}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {headerReport.cookies.length > 0 && (
            <div className="ts-box ts-col" style={{ gap: 6 }}>
              <span className="ts-label">{tx(locale, "Set-Cookie Inspector", "Set-Cookie 属性与安全检查")}</span>
              {headerReport.cookies.map((c, idx) => (
                <div key={idx} className="ts-col" style={{ gap: 4, borderTop: idx > 0 ? "1px solid var(--ts-border)" : "none", paddingTop: idx > 0 ? 6 : 0 }}>
                  <div className="ts-row">
                    <span className="ts-mono"><strong>{c.name}</strong> = {c.valueMasked}</span>
                    <span className={`ts-badge ${c.secure ? "good" : "bad"}`}>Secure: {c.secure ? "Yes" : "No"}</span>
                    <span className={`ts-badge ${c.httpOnly ? "good" : "bad"}`}>HttpOnly: {c.httpOnly ? "Yes" : "No"}</span>
                    {c.sameSite && <span className="ts-badge">SameSite: {c.sameSite}</span>}
                    {c.maxAge && <span className="ts-badge">Max-Age: {c.maxAge}s</span>}
                    {c.path && <span className="ts-badge">Path: {c.path}</span>}
                  </div>
                  {(locale.startsWith("zh") ? c.warningsZh : c.warningsEn).map((w, wi) => (
                    <div key={wi} style={{ fontSize: 11, color: "var(--ts-warning)" }}>⚠ {w}</div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {headerReport.cacheControl.length > 0 && (
            <div className="ts-box ts-col" style={{ gap: 6 }}>
              <span className="ts-label">{tx(locale, "Cache-Control Directives", "Cache-Control 缓存指令解释")}</span>
              <table className="ts-table">
                <tbody>
                  {headerReport.cacheControl.map((d, i) => (
                    <tr key={i}>
                      <td className="ts-mono"><strong>{d.name}</strong> = {d.value}</td>
                      <td>{tx(locale, d.descEn, d.descZh)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {headerReport.csp.length > 0 && (
            <div className="ts-box ts-col" style={{ gap: 6 }}>
              <span className="ts-label">{tx(locale, "Content-Security-Policy (CSP)", "内容安全策略 (CSP) 拆解")}</span>
              <table className="ts-table">
                <tbody>
                  {headerReport.csp.map((d, i) => (
                    <tr key={i}>
                      <td className="ts-mono"><strong>{d.directive}</strong></td>
                      <td className="ts-mono">
                        {d.sources.join(" ")}
                        {d.riskEn && (
                          <div style={{ color: "var(--ts-warning)", fontSize: 11 }}>
                            ⚠ {tx(locale, d.riskEn, d.riskZh ?? d.riskEn)}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="ts-row">
            {UA_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="ts-btn sm"
                onClick={() => setSaved((prev) => ({ ...prev, ua: p.ua }))}
              >
                {p.label}
              </button>
            ))}
          </div>

          <textarea
            className="ts-textarea mono"
            rows={4}
            value={saved.ua}
            onChange={(e) => setSaved((p) => ({ ...p, ua: e.target.value }))}
            placeholder={tx(locale, "Paste a User-Agent string...", "输入或粘贴 User-Agent 字符串...")}
          />

          <div className="ts-box ts-col" style={{ gap: 6 }}>
            <div className="ts-row" style={{ justifyContent: "space-between" }}>
              <span className="ts-label">{tx(locale, "Parsed Breakdown", "User-Agent 识别结果")}</span>
              <button
                type="button"
                className="ts-btn sm"
                onClick={async () => {
                  await copyToClipboard(JSON.stringify(parsedUa, null, 2));
                  setStatus(tx(locale, "JSON copied", "已复制 JSON"));
                  setTimeout(() => setStatus(null), 1200);
                }}
              >
                {tx(locale, "Copy JSON", "复制 JSON")}
              </button>
            </div>
            <table className="ts-table">
              <tbody>
                <tr><td>{tx(locale, "Browser", "浏览器")}</td><td className="ts-mono">{parsedUa.browser} {parsedUa.browserVersion}</td></tr>
                <tr><td>{tx(locale, "Rendering Engine", "内核引擎")}</td><td className="ts-mono">{parsedUa.engine} {parsedUa.engineVersion}</td></tr>
                <tr><td>{tx(locale, "Operating System", "操作系统")}</td><td className="ts-mono">{parsedUa.os} {parsedUa.osVersion}</td></tr>
                <tr><td>{tx(locale, "Device Type", "设备类型")}</td><td className="ts-mono">{parsedUa.deviceType}</td></tr>
                <tr><td>{tx(locale, "Architecture", "架构")}</td><td className="ts-mono">{parsedUa.arch}</td></tr>
                <tr>
                  <td>{tx(locale, "Bot / Crawler", "爬虫 / 客户端")}</td>
                  <td className="ts-mono">
                    {parsedUa.isBot ? `Yes (${parsedUa.botName})` : tx(locale, "No", "否")}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
