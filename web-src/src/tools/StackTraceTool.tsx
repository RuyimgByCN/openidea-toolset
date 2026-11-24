import { useEffect, useMemo, useState } from "react";
import { copyToClipboard } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";
import { parseNdjsonLogs, parseStackTrace, unescapeLogTrace } from "../utils/stacktrace";

const SAMPLE_JAVA = `org.springframework.web.util.NestedServletException: Request processing failed
\tat org.springframework.web.servlet.FrameworkServlet.processRequest(FrameworkServlet.java:1014)
\tat java.base/java.lang.Thread.run(Thread.java:1583)
Caused by: java.lang.NullPointerException: Cannot invoke "User.getEmail()" because "user" is null
\tat com.myapp.service.OrderService.notifyUser(OrderService.java:84)
\tat com.myapp.controller.OrderController.create(OrderController.java:41)
\tat org.springframework.cglib.proxy.MethodProxy.invoke(MethodProxy.java:218)`;

const SAMPLE_NODE = `TypeError: Cannot read properties of undefined (reading 'id')
    at CheckoutService.placeOrder (/app/src/services/checkout.ts:42:19)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)
    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)
    at routes.post (/app/src/routes/orders.ts:18:11)`;

const SAMPLE_NDJSON = [
  '{"timestamp":"2026-11-24T10:15:01.201Z","level":"INFO","message":"HTTP server started","port":8080,"env":"prod"}',
  '{"timestamp":"2026-11-24T10:15:03.844Z","level":"WARN","message":"Slow database query detected","durationMs":412,"table":"orders"}',
  '{"timestamp":"2026-11-24T10:15:05.019Z","level":"ERROR","message":"Payment gateway timeout","orderId":"ORD-9921","retries":3}',
  '{"timestamp":"2026-11-24T10:15:06.100Z","level":"DEBUG","message":"Cache hit for session","userId":42}',
].join("\n");

export default function StackTraceTool({ tabId, locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState(`stacktrace-${tabId}`, {
    subtab: "trace" as "trace" | "ndjson",
    appPrefixes: "com.myapp, /app/src",
    hideFramework: false,
    traceInput: SAMPLE_JAVA,
    logInput: SAMPLE_NDJSON,
    levelFilter: "ALL",
    logQuery: "",
  });
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      const looksNdjson = initialInput
        .trim()
        .split("\n")
        .slice(0, 3)
        .every((l) => !l.trim() || l.trim().startsWith("{"));
      setSaved((p) => ({
        ...p,
        subtab: looksNdjson ? "ndjson" : "trace",
        ...(looksNdjson ? { logInput: initialInput } : { traceInput: initialInput }),
      }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const prefixes = useMemo(() => saved.appPrefixes.split(","), [saved.appPrefixes]);
  const traceParsed = useMemo(() => parseStackTrace(saved.traceInput, prefixes), [saved.traceInput, prefixes]);
  const visibleFrames = useMemo(
    () => (saved.hideFramework ? traceParsed.frames.filter((f) => f.isAppFrame) : traceParsed.frames),
    [traceParsed.frames, saved.hideFramework],
  );

  const ndjsonRows = useMemo(() => parseNdjsonLogs(saved.logInput), [saved.logInput]);
  const filteredLogs = useMemo(() => {
    const q = saved.logQuery.trim().toLowerCase();
    return ndjsonRows.filter((r) => {
      if (saved.levelFilter !== "ALL" && r.level !== saved.levelFilter) return false;
      if (!q) return true;
      return r.message.toLowerCase().includes(q) || r.extra.toLowerCase().includes(q) || r.timestamp.toLowerCase().includes(q);
    });
  }, [ndjsonRows, saved.levelFilter, saved.logQuery]);

  const exportCleanTrace = [...traceParsed.causes, ...visibleFrames.map((f) => `  ${f.raw}`)].join("\n");

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Stack Trace & Structured Log Analyzer", "堆栈追踪与结构化日志分析")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) =>
            setSaved((p) => (p.subtab === "trace" ? { ...p, traceInput: t } : { ...p, logInput: t }))
          }
          onPaste={(t) =>
            setSaved((p) => (p.subtab === "trace" ? { ...p, traceInput: t } : { ...p, logInput: t }))
          }
          outputText={saved.subtab === "trace" ? exportCleanTrace : filteredLogs.map((l) => l.raw).join("\n")}
          openTabTitle={tx(locale, "Cleaned Trace / Logs", "清洗后堆栈 / 日志")}
          onClear={() =>
            setSaved((p) => (p.subtab === "trace" ? { ...p, traceInput: "" } : { ...p, logInput: "" }))
          }
        />
      </div>

      <div className="ts-row" style={{ justifyContent: "space-between" }}>
        <div className="ts-row">
          <button
            type="button"
            className={`ts-pill ${saved.subtab === "trace" ? "active" : ""}`}
            onClick={() => setSaved((p) => ({ ...p, subtab: "trace" }))}
          >
            {tx(locale, "Stack Trace", "异常堆栈解析")}
          </button>
          <button
            type="button"
            className={`ts-pill ${saved.subtab === "ndjson" ? "active" : ""}`}
            onClick={() => setSaved((p) => ({ ...p, subtab: "ndjson" }))}
          >
            {tx(locale, "NDJSON Logs", "NDJSON 结构化日志")}
          </button>
        </div>
        {status && <span className="ts-badge good">{status}</span>}
      </div>

      {saved.subtab === "trace" ? (
        <>
          <div className="ts-row">
            <button
              type="button"
              className="ts-btn sm"
              onClick={() => setSaved((p) => ({ ...p, traceInput: SAMPLE_JAVA, appPrefixes: "com.myapp" }))}
            >
              Java / Spring
            </button>
            <button
              type="button"
              className="ts-btn sm"
              onClick={() => setSaved((p) => ({ ...p, traceInput: SAMPLE_NODE, appPrefixes: "/app/src" }))}
            >
              Node / TS
            </button>
            <button
              type="button"
              className="ts-btn sm primary"
              onClick={() => {
                setSaved((p) => ({ ...p, traceInput: unescapeLogTrace(p.traceInput) }));
                setStatus(tx(locale, "Unescaped \\n / \\t", "已反转义 \\n / \\t"));
                setTimeout(() => setStatus(null), 1300);
              }}
            >
              {tx(locale, "Unescape \\n / \\t", "反转义单行堆栈 (\\n/\\t)")}
            </button>
            <label className="ts-row" style={{ gap: 4, flex: 1 }}>
              <span className="ts-label">{tx(locale, "App Prefix:", "业务包前缀:")}</span>
              <input
                className="ts-input mono"
                style={{ flex: 1, minWidth: 120 }}
                value={saved.appPrefixes}
                onChange={(e) => setSaved((p) => ({ ...p, appPrefixes: e.target.value }))}
                placeholder="com.myapp, /app/src"
              />
            </label>
            <label className="ts-inline-check">
              <input
                type="checkbox"
                checked={saved.hideFramework}
                onChange={(e) => setSaved((p) => ({ ...p, hideFramework: e.target.checked }))}
              />
              {tx(locale, "App Frames Only", "仅看业务帧")}
            </label>
          </div>

          <textarea
            className="ts-textarea mono"
            rows={5}
            value={saved.traceInput}
            onChange={(e) => setSaved((p) => ({ ...p, traceInput: e.target.value }))}
            placeholder={tx(locale, "Paste raw or JSON-escaped exception stack trace...", "粘贴异常堆栈或转义后的单行日志堆栈...")}
          />

          <div className="ts-row">
            <span className="ts-badge">{traceParsed.language}</span>
            <span className="ts-badge good">{tx(locale, "App frames", "业务帧")}: {traceParsed.appFrameCount}</span>
            <span className="ts-badge">{tx(locale, "Framework/JDK", "框架/库帧")}: {traceParsed.frameworkFrameCount}</span>
            <button
              type="button"
              className="ts-btn sm"
              onClick={async () => {
                await copyToClipboard(exportCleanTrace);
                setStatus(tx(locale, "Clean trace copied", "已复制净化堆栈"));
                setTimeout(() => setStatus(null), 1300);
              }}
            >
              {tx(locale, "Copy Clean Trace", "复制高亮帧")}
            </button>
          </div>

          {traceParsed.causes.length > 0 && (
            <div className="ts-box ts-col" style={{ gap: 3 }}>
              <span className="ts-label">{tx(locale, "Exception & Root Cause Chain", "异常与根因链")}</span>
              {traceParsed.causes.map((c, idx) => (
                <div key={idx} className="ts-mono" style={{ fontSize: 11.5, color: idx === traceParsed.causes.length - 1 ? "var(--ts-error, #e06c75)" : "var(--ts-fg)" }}>
                  {c}
                </div>
              ))}
            </div>
          )}

          <div className="ts-box" style={{ maxHeight: 230, overflowY: "auto" }}>
            <table className="ts-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{tx(locale, "Scope", "归属")}</th>
                  <th>{tx(locale, "Symbol / Method", "方法 / 符号")}</th>
                  <th>{tx(locale, "Source Location", "文件位置")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleFrames.map((f) => (
                  <tr key={f.index} style={{ opacity: f.isAppFrame ? 1 : 0.68 }}>
                    <td>{f.index + 1}</td>
                    <td>
                      <span className={`ts-badge ${f.isAppFrame ? "good" : ""}`}>
                        {f.isAppFrame ? tx(locale, "App", "业务") : tx(locale, "Lib", "框架")}
                      </span>
                    </td>
                    <td className="ts-mono">{f.symbol}</td>
                    <td className="ts-mono">{f.location}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="ts-row">
            {(["ALL", "ERROR", "WARN", "INFO", "DEBUG"] as const).map((lvl) => (
              <button
                key={lvl}
                type="button"
                className={`ts-pill ${saved.levelFilter === lvl ? "active" : ""}`}
                onClick={() => setSaved((p) => ({ ...p, levelFilter: lvl }))}
              >
                {lvl}
              </button>
            ))}
            <input
              className="ts-input"
              style={{ flex: 1, minWidth: 140 }}
              value={saved.logQuery}
              onChange={(e) => setSaved((p) => ({ ...p, logQuery: e.target.value }))}
              placeholder={tx(locale, "Filter message or JSON field...", "按消息或字段值过滤...")}
            />
            <span className="ts-badge">{filteredLogs.length} / {ndjsonRows.length}</span>
          </div>

          <textarea
            className="ts-textarea mono"
            rows={5}
            value={saved.logInput}
            onChange={(e) => setSaved((p) => ({ ...p, logInput: e.target.value }))}
            placeholder={tx(locale, "Paste NDJSON / JSON-lines logs...", "粘贴逐行 JSON (NDJSON) 结构化日志...")}
          />

          <div className="ts-box" style={{ maxHeight: 260, overflowY: "auto" }}>
            <table className="ts-table">
              <thead>
                <tr>
                  <th>L#</th>
                  <th>{tx(locale, "Time", "时间")}</th>
                  <th>{tx(locale, "Level", "级别")}</th>
                  <th>{tx(locale, "Message & Fields", "日志内容与字段")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td className="ts-mono" style={{ fontSize: 11 }}>{r.timestamp || "—"}</td>
                    <td>
                      <span className={`ts-badge ${r.level === "ERROR" ? "bad" : r.level === "INFO" ? "good" : ""}`}>
                        {r.level}
                      </span>
                    </td>
                    <td>
                      <div>{r.message}</div>
                      {r.extra && <div className="ts-mono" style={{ fontSize: 10.5, color: "var(--ts-fg-muted)" }}>{r.extra}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
