import { useEffect, useState } from "react";
import { bridge, copyToClipboard } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { HttpPushResponse, ToolProps } from "../types";

interface KvRow {
  enabled: boolean;
  key: string;
  value: string;
}

type RespData = NonNullable<HttpPushResponse["data"]>;

function parseQueryRows(urlStr: string): KvRow[] {
  const qIdx = urlStr.indexOf("?");
  if (qIdx < 0) return [];
  const raw = urlStr.slice(qIdx + 1).split("#")[0];
  if (!raw) return [];
  return raw.split("&").map((pair) => {
    const eq = pair.indexOf("=");
    if (eq < 0) return { enabled: true, key: decodeURIComponent(pair.replace(/\+/g, " ")), value: "" };
    return {
      enabled: true,
      key: decodeURIComponent(pair.slice(0, eq).replace(/\+/g, " ")),
      value: decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " ")),
    };
  });
}

function applyQueryRows(urlStr: string, rows: KvRow[]): string {
  const base = urlStr.split("?")[0];
  const active = rows.filter((r) => r.enabled && r.key.trim() !== "");
  if (active.length === 0) return base;
  const qs = active.map((r) => `${encodeURIComponent(r.key)}=${encodeURIComponent(r.value)}`).join("&");
  return `${base}?${qs}`;
}

const SENSITIVE_HEADER_KEYS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "x-auth-token",
]);

function isSensitiveHeaderKey(key: string): boolean {
  return SENSITIVE_HEADER_KEYS.has(key.trim().toLowerCase());
}

export default function HttpClientTool({
  tabId,
  locale,
  initialInput,
  onConsumeInitial,
  httpPushResponse,
  onConsumeHttpPush,
}: ToolProps) {
  const [saved, setSaved] = useToolState(
    `http-${tabId}`,
    {
      method: "GET",
      url: "https://httpbin.org/get?source=openidea",
      headers: [
        { enabled: true, key: "Accept", value: "application/json" },
        { enabled: true, key: "User-Agent", value: "OpenIDEA-Toolset/0.2.0" },
      ] as KvRow[],
      authKind: "none" as "none" | "bearer" | "basic" | "apikey",
      authUser: "",
      apiKeyName: "X-API-Key",
      bodyKind: "none" as "none" | "json" | "raw",
      body: '{\n  "hello": "openidea"\n}',
      reqTab: "params" as "params" | "headers" | "auth" | "body" | "curl" | "export",
      exportFmt: "curl",
    },
    (state) => ({
      ...state,
      headers: state.headers.filter((h) => !isSensitiveHeaderKey(h.key)),
    }),
  );

  // Keep auth credentials and raw cURL imports strictly in memory; never persist to disk.
  const [authToken, setAuthToken] = useState("");
  const [authPass, setAuthPass] = useState("");
  const [curlImport, setCurlImport] = useState("");
  const [sending, setSending] = useState(false);
  const [resp, setResp] = useState<RespData | null>(null);
  const [respTab, setRespTab] = useState<"pretty" | "raw" | "headers">("pretty");
  const [exportedCode, setExportedCode] = useState("");
  const [needsConsentHint, setNeedsConsentHint] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const buildPayload = () => {
    const hdrs: Array<[string, string]> = saved.headers
      .filter((h) => h.enabled && h.key.trim())
      .map((h) => [h.key.trim(), h.value]);

    if (saved.authKind === "bearer" && authToken) {
      hdrs.push(["Authorization", `Bearer ${authToken}`]);
    } else if (saved.authKind === "basic" && (saved.authUser || authPass)) {
      hdrs.push(["Authorization", `Basic ${btoa(`${saved.authUser}:${authPass}`)}`]);
    } else if (saved.authKind === "apikey" && saved.apiKeyName && authToken) {
      hdrs.push([saved.apiKeyName, authToken]);
    }
    if (saved.bodyKind === "json" && !hdrs.some(([k]) => k.toLowerCase() === "content-type")) {
      hdrs.push(["Content-Type", "application/json"]);
    }

    return {
      tabId,
      method: saved.method,
      url: saved.url,
      headers: hdrs,
      body: saved.bodyKind === "none" ? null : saved.body,
      timeoutMs: 15000,
    };
  };

  useEffect(() => {
    if (initialInput != null) {
      const txt = initialInput.trim();
      if (txt.toLowerCase().startsWith("curl ")) {
        setCurlImport(txt);
        bridge
          .rpc<{ method: string; url: string; headers: Array<[string, string]>; body: string }>("http.parseCurl", { cmd: txt })
          .then((parsed) => {
            setSaved((p) => ({
              ...p,
              method: parsed.method || "GET",
              url: parsed.url || p.url,
              headers: parsed.headers.map(([key, value]) => ({ enabled: true, key, value })),
              bodyKind: parsed.body ? "json" : "none",
              body: parsed.body || p.body,
            }));
          })
          .catch(() => {
            setSaved((p) => ({ ...p, reqTab: "curl" }));
          });
      } else if (txt.startsWith("http://") || txt.startsWith("https://")) {
        setSaved((p) => ({ ...p, url: txt }));
      }
      onConsumeInitial?.();
    }
  }, [initialInput]);

  useEffect(() => {
    if (httpPushResponse && httpPushResponse.tabId === tabId) {
      setSending(false);
      setNeedsConsentHint(false);
      if (httpPushResponse.ok && httpPushResponse.data) {
        setResp(httpPushResponse.data);
        setErr(null);
      } else if (httpPushResponse.error) {
        setErr(httpPushResponse.error);
      }
      onConsumeHttpPush();
    }
  }, [httpPushResponse, tabId, onConsumeHttpPush]);

  useEffect(() => {
    if (!bridge.isHosted) return;
    const t = setTimeout(() => {
      bridge.rpc("http.setActive", buildPayload()).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [saved.method, saved.url, saved.headers, saved.authKind, authToken, saved.authUser, authPass, saved.apiKeyName, saved.bodyKind, saved.body, tabId]);

  useEffect(() => {
    if (!bridge.isHosted || saved.reqTab !== "export") return;
    const payload = buildPayload();
    bridge
      .rpc<{ result: string }>("http.export", {
        method: payload.method,
        url: payload.url,
        headers: payload.headers,
        body: payload.body ?? "",
        format: saved.exportFmt,
      })
      .then((r) => setExportedCode(r.result))
      .catch(() => {});
  }, [saved.reqTab, saved.exportFmt, saved.method, saved.url, saved.headers, saved.authKind, authToken, saved.authUser, authPass, saved.apiKeyName, saved.bodyKind, saved.body]);

  const sendNow = async () => {
    setErr(null);
    setNeedsConsentHint(false);
    setSending(true);
    try {
      const payload = buildPayload();
      const r = await bridge.rpc<RespData>("http.send", payload);
      setResp(r);
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg);
      if (msg.toLowerCase().includes("denied") || msg.toLowerCase().includes("net")) {
        setNeedsConsentHint(true);
      }
    } finally {
      setSending(false);
    }
  };

  const importCurl = async () => {
    setErr(null);
    try {
      const parsed = await bridge.rpc<{ method: string; url: string; headers: Array<[string, string]>; body: string }>("http.parseCurl", {
        cmd: curlImport,
      });
      setSaved((p) => ({
        ...p,
        method: parsed.method || "GET",
        url: parsed.url || p.url,
        headers: parsed.headers.map(([key, value]) => ({ enabled: true, key, value })),
        bodyKind: parsed.body ? "json" : "none",
        body: parsed.body || "",
        reqTab: "params",
      }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const queryRows = parseQueryRows(saved.url);
  const prettyBody = (() => {
    if (!resp) return "";
    if (respTab === "pretty") {
      try {
        return JSON.stringify(JSON.parse(resp.bodyText), null, 2);
      } catch {
        return resp.bodyText;
      }
    }
    if (respTab === "headers") {
      return resp.headers.map(([k, v]) => `${k}: ${v}`).join("\n");
    }
    return resp.bodyText;
  })();

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "HTTP Client & cURL", "HTTP 请求调试与 cURL")}</span>
        <ToolActionBar
          locale={locale}
          outputText={resp?.bodyText ?? ""}
          openTabTitle={tx(locale, "HTTP Response", "HTTP 响应")}
          openTabLanguage="json"
        />
      </div>

      <div className="ts-row">
        <select className="ts-select" style={{ width: 95 }} value={saved.method} onChange={(e) => setSaved((p) => ({ ...p, method: e.target.value }))}>
          {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <input
          className="ts-input mono"
          style={{ flex: 1 }}
          value={saved.url}
          onChange={(e) => setSaved((p) => ({ ...p, url: e.target.value }))}
          onKeyDown={(e) => { if (e.key === "Enter") sendNow(); }}
          placeholder="https://api.example.com/v1/resource"
        />
        <button type="button" className="ts-btn primary" disabled={sending} onClick={sendNow}>
          {sending ? tx(locale, "Sending...", "发送中...") : tx(locale, "Send", "发送")}
        </button>
      </div>

      {needsConsentHint && (
        <div className="ts-ok" style={{ borderColor: "var(--ts-warning)", color: "var(--ts-warning)" }}>
          {tx(
            locale,
            "First request to a new host requires interactive approval via optional `net:ask`: press Meta+Shift+H (macOS) / Alt+Shift+H, or run 'Toolset: Send Active HTTP Request' from the Command Palette / Status Bar.",
            "首次访问新域名需通过可选权限 `net:ask` 弹窗授权：请按 Meta+Shift+H (Mac) / Alt+Shift+H，或在命令面板/状态栏点击「发送当前 HTTP 请求」完成一次性或永久授权。",
          )}
        </div>
      )}

      {err && <div className="ts-err">{err}</div>}

      <div className="ts-row">
        {([
          ["params", tx(locale, `Params (${queryRows.length})`, `参数 (${queryRows.length})`)],
          ["headers", tx(locale, `Headers (${saved.headers.length})`, `请求头 (${saved.headers.length})`)],
          ["auth", tx(locale, "Auth", "鉴权")],
          ["body", tx(locale, "Body", "请求体")],
          ["curl", tx(locale, "Import cURL", "导入 cURL")],
          ["export", tx(locale, "Export Code", "导出代码")],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" className={`ts-pill ${saved.reqTab === id ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, reqTab: id }))}>
            {label}
          </button>
        ))}
      </div>

      {saved.reqTab === "params" && (
        <div className="ts-box ts-col">
          {queryRows.map((row, idx) => (
            <div key={idx} className="ts-row" style={{ flexWrap: "nowrap" }}>
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(e) => {
                  const next = queryRows.map((r, i) => (i === idx ? { ...r, enabled: e.target.checked } : r));
                  setSaved((p) => ({ ...p, url: applyQueryRows(p.url, next) }));
                }}
              />
              <input
                className="ts-input mono"
                value={row.key}
                onChange={(e) => {
                  const next = queryRows.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r));
                  setSaved((p) => ({ ...p, url: applyQueryRows(p.url, next) }));
                }}
                placeholder={tx(locale, "Param key", "参数名")}
              />
              <input
                className="ts-input mono"
                value={row.value}
                onChange={(e) => {
                  const next = queryRows.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r));
                  setSaved((p) => ({ ...p, url: applyQueryRows(p.url, next) }));
                }}
                placeholder={tx(locale, "Param value", "参数值")}
              />
              <button
                type="button"
                className="ts-btn sm"
                onClick={() => {
                  const next = queryRows.filter((_, i) => i !== idx);
                  setSaved((p) => ({ ...p, url: applyQueryRows(p.url, next) }));
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="ts-btn sm"
            onClick={() => setSaved((p) => ({ ...p, url: applyQueryRows(p.url, [...queryRows, { enabled: true, key: "param", value: "1" }]) }))}
          >
            + {tx(locale, "Add Query Param", "添加 Query 参数")}
          </button>
        </div>
      )}

      {saved.reqTab === "headers" && (
        <div className="ts-box ts-col">
          {saved.headers.map((row, idx) => (
            <div key={idx} className="ts-row" style={{ flexWrap: "nowrap" }}>
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(e) => setSaved((p) => ({ ...p, headers: p.headers.map((r, i) => (i === idx ? { ...r, enabled: e.target.checked } : r)) }))}
              />
              <input
                className="ts-input mono"
                value={row.key}
                onChange={(e) => setSaved((p) => ({ ...p, headers: p.headers.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r)) }))}
                placeholder={tx(locale, "Header", "请求头名称")}
              />
              <input
                className="ts-input mono"
                value={row.value}
                onChange={(e) => setSaved((p) => ({ ...p, headers: p.headers.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)) }))}
                placeholder={tx(locale, "Value", "请求头值")}
              />
              <button
                type="button"
                className="ts-btn sm"
                onClick={() => setSaved((p) => ({ ...p, headers: p.headers.filter((_, i) => i !== idx) }))}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="ts-btn sm"
            onClick={() => setSaved((p) => ({ ...p, headers: [...p.headers, { enabled: true, key: "", value: "" }] }))}
          >
            + {tx(locale, "Add Header", "添加请求头")}
          </button>
        </div>
      )}

      {saved.reqTab === "auth" && (
        <div className="ts-box ts-col">
          <select className="ts-select" style={{ width: 170 }} value={saved.authKind} onChange={(e) => setSaved((p) => ({ ...p, authKind: e.target.value as typeof p.authKind }))}>
            <option value="none">{tx(locale, "No Auth", "无鉴权")}</option>
            <option value="bearer">{tx(locale, "Bearer Token", "Bearer 令牌")}</option>
            <option value="basic">{tx(locale, "Basic Auth", "Basic 基础认证")}</option>
            <option value="apikey">{tx(locale, "API Key Header", "API Key 请求头")}</option>
          </select>
          {saved.authKind === "bearer" && (
            <input className="ts-input mono" value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder={tx(locale, "Token", "Bearer 令牌")} />
          )}
          {saved.authKind === "basic" && (
            <div className="ts-row">
              <input className="ts-input mono" style={{ flex: 1 }} value={saved.authUser} onChange={(e) => setSaved((p) => ({ ...p, authUser: e.target.value }))} placeholder={tx(locale, "Username", "用户名")} />
              <input type="password" className="ts-input mono" style={{ flex: 1 }} value={authPass} onChange={(e) => setAuthPass(e.target.value)} placeholder={tx(locale, "Password", "密码")} />
            </div>
          )}
          {saved.authKind === "apikey" && (
            <div className="ts-row">
              <input className="ts-input mono" style={{ width: 140 }} value={saved.apiKeyName} onChange={(e) => setSaved((p) => ({ ...p, apiKeyName: e.target.value }))} placeholder="X-API-Key" />
              <input className="ts-input mono" style={{ flex: 1 }} value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder={tx(locale, "Key value", "密钥值")} />
            </div>
          )}
        </div>
      )}

      {saved.reqTab === "body" && (
        <div className="ts-col">
          <div className="ts-row">
            {(["none", "json", "raw"] as const).map((bk) => (
              <button key={bk} type="button" className={`ts-pill ${saved.bodyKind === bk ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, bodyKind: bk }))}>
                {bk === "none" ? tx(locale, "NONE", "无 Body") : bk.toUpperCase()}
              </button>
            ))}
          </div>
          {saved.bodyKind !== "none" && (
            <textarea className="ts-textarea mono" rows={5} value={saved.body} onChange={(e) => setSaved((p) => ({ ...p, body: e.target.value }))} />
          )}
        </div>
      )}

      {saved.reqTab === "curl" && (
        <div className="ts-col">
          <textarea
            className="ts-textarea mono"
            rows={4}
            value={curlImport}
            onChange={(e) => setCurlImport(e.target.value)}
            placeholder="curl -X POST https://api.example.com/v1 -H 'Authorization: Bearer ...' -d '{...}'"
          />
          <button type="button" className="ts-btn primary" onClick={importCurl}>
            {tx(locale, "Parse & Load Request", "解析并填充请求")}
          </button>
        </div>
      )}

      {saved.reqTab === "export" && (
        <div className="ts-col">
          <div className="ts-row">
            <select className="ts-select" style={{ width: 155 }} value={saved.exportFmt} onChange={(e) => setSaved((p) => ({ ...p, exportFmt: e.target.value }))}>
              <option value="curl">cURL</option>
              <option value="fetch">JavaScript fetch()</option>
              <option value="httpie">HTTPie</option>
              <option value="http-file">{tx(locale, ".http file", ".http 请求文件")}</option>
            </select>
            <button type="button" className="ts-btn sm" onClick={() => copyToClipboard(exportedCode)}>
              {tx(locale, "Copy Code", "复制代码")}
            </button>
          </div>
          <textarea className="ts-textarea mono" rows={6} readOnly value={exportedCode} />
        </div>
      )}

      {resp && (
        <div className="ts-box ts-col">
          <div className="ts-row" style={{ justifyContent: "space-between" }}>
            <div className="ts-row">
              <span className={`ts-badge ${resp.status >= 200 && resp.status < 400 ? "good" : "bad"}`}>HTTP {resp.status}</span>
              <span className="ts-badge">{resp.elapsedMs} ms</span>
              <span className="ts-badge">{resp.bodyBytes} B</span>
            </div>
            <div className="ts-row">
              <button type="button" className={`ts-pill ${respTab === "pretty" ? "active" : ""}`} onClick={() => setRespTab("pretty")}>{tx(locale, "Pretty", "格式化")}</button>
              <button type="button" className={`ts-pill ${respTab === "raw" ? "active" : ""}`} onClick={() => setRespTab("raw")}>{tx(locale, "Raw", "原文")}</button>
              <button type="button" className={`ts-pill ${respTab === "headers" ? "active" : ""}`} onClick={() => setRespTab("headers")}>{tx(locale, `Headers (${resp.headers.length})`, `响应头 (${resp.headers.length})`)}</button>
            </div>
          </div>
          <textarea className="ts-textarea mono" rows={8} readOnly value={prettyBody} />
        </div>
      )}
    </div>
  );
}
