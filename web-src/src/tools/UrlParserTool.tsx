import { useEffect, useMemo, useState } from "react";
import { copyToClipboard } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

interface QueryRow {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

const SAMPLE_URL = "https://api.example.com:8443/v2/users/profile?page=1&limit=20&filter=active&tag=dev%2Btools#section-1";

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function parseUrlParts(raw: string): {
  valid: boolean;
  error?: string;
  protocol: string;
  username: string;
  password: string;
  hostname: string;
  port: string;
  pathname: string;
  hash: string;
  origin: string;
  segments: string[];
  params: QueryRow[];
} {
  try {
    const u = new URL(raw.trim());
    const params: QueryRow[] = [];
    let idx = 0;
    u.searchParams.forEach((value, key) => {
      params.push({ id: `q-${idx++}-${key}`, key, value, enabled: true });
    });
    return {
      valid: true,
      protocol: u.protocol.replace(/:$/, ""),
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      hostname: u.hostname,
      port: u.port,
      pathname: u.pathname,
      hash: u.hash.replace(/^#/, ""),
      origin: u.origin,
      segments: u.pathname.split("/").filter(Boolean),
      params,
    };
  } catch (e) {
    return {
      valid: false,
      error: (e as Error).message,
      protocol: "https",
      username: "",
      password: "",
      hostname: "",
      port: "",
      pathname: "/",
      hash: "",
      origin: "",
      segments: [],
      params: [],
    };
  }
}

export default function UrlParserTool({ tabId, locale, initialInput, onConsumeInitial }: ToolProps) {
  const initialParsed = parseUrlParts(SAMPLE_URL);
  const [saved, setSaved] = useToolState(`urlparser-${tabId}`, {
    rawUrl: SAMPLE_URL,
    protocol: initialParsed.protocol,
    username: initialParsed.username,
    password: initialParsed.password,
    hostname: initialParsed.hostname,
    port: initialParsed.port,
    pathname: initialParsed.pathname,
    hash: initialParsed.hash,
    params: initialParsed.params as QueryRow[],
  });
  const [parseErr, setParseErr] = useState<string | null>(initialParsed.valid ? null : initialParsed.error || null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      syncFromRaw(initialInput);
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const syncFromRaw = (raw: string) => {
    const p = parseUrlParts(raw);
    if (p.valid) {
      setParseErr(null);
      setSaved({
        rawUrl: raw,
        protocol: p.protocol,
        username: p.username,
        password: p.password,
        hostname: p.hostname,
        port: p.port,
        pathname: p.pathname,
        hash: p.hash,
        params: p.params,
      });
    } else {
      setParseErr(p.error || tx(locale, "Invalid URL", "URL 格式无效"));
      setSaved((prev) => ({ ...prev, rawUrl: raw }));
    }
  };

  const buildFromParts = (next: typeof saved): string => {
    try {
      const proto = (next.protocol || "https").replace(/:$/, "");
      const u = new URL(`${proto}://${next.hostname || "localhost"}`);
      if (next.username) u.username = next.username;
      if (next.password) u.password = next.password;
      u.port = next.port;
      u.pathname = next.pathname.startsWith("/") ? next.pathname : `/${next.pathname}`;
      const sp = new URLSearchParams();
      for (const row of next.params) {
        if (row.enabled && row.key !== "") {
          sp.append(row.key, row.value);
        }
      }
      const q = sp.toString();
      u.search = q ? `?${q}` : "";
      u.hash = next.hash ? `#${next.hash.replace(/^#/, "")}` : "";
      return u.toString();
    } catch {
      return next.rawUrl;
    }
  };

  const updateParts = (patch: Partial<typeof saved>) => {
    setSaved((prev) => {
      const next = { ...prev, ...patch };
      const rebuilt = buildFromParts(next);
      setParseErr(null);
      return { ...next, rawUrl: rebuilt };
    });
  };

  const rebuiltUrl = useMemo(() => buildFromParts(saved), [saved]);
  const pathSegments = useMemo(() => saved.pathname.split("/").filter(Boolean), [saved.pathname]);

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "URL Parser & Query Builder", "URL 解析与参数构造器")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => syncFromRaw(t)}
          onPaste={(t) => syncFromRaw(t)}
          outputText={rebuiltUrl}
          openTabTitle="URL"
          openTabLanguage="text"
          openTabFileName="url.txt"
          onClear={() => syncFromRaw("")}
          onStatus={(m) => setStatus(m)}
        />
      </div>

      <div className="ts-row">
        <input
          className="ts-input mono"
          style={{ flex: 1 }}
          value={saved.rawUrl}
          onChange={(e) => syncFromRaw(e.target.value)}
          placeholder="https://example.com/path?foo=bar#hash"
        />
        <button type="button" className="ts-btn sm" onClick={() => syncFromRaw(SAMPLE_URL)}>
          {tx(locale, "Sample", "示例 URL")}
        </button>
        <button
          type="button"
          className="ts-btn sm primary"
          onClick={async () => {
            await copyToClipboard(rebuiltUrl);
            setStatus(tx(locale, "Copied rebuilt URL", "已复制重组后的 URL"));
          }}
        >
          {tx(locale, "Copy URL", "复制 URL")}
        </button>
      </div>

      {parseErr && <div className="ts-err">{parseErr}</div>}
      {status && <div className="ts-ok">{status}</div>}

      <div className="ts-box">
        <div className="ts-kv">
          <span className="ts-kv-key">{tx(locale, "Protocol", "协议")}</span>
          <input className="ts-input mono" value={saved.protocol} onChange={(e) => updateParts({ protocol: e.target.value })} />

          <span className="ts-kv-key">{tx(locale, "Hostname", "域名 / IP")}</span>
          <input className="ts-input mono" value={saved.hostname} onChange={(e) => updateParts({ hostname: e.target.value })} />

          <span className="ts-kv-key">{tx(locale, "Port", "端口")}</span>
          <input className="ts-input mono" value={saved.port} onChange={(e) => updateParts({ port: e.target.value })} placeholder={tx(locale, "(default)", "(默认端口)")} />

          <span className="ts-kv-key">{tx(locale, "Path", "路径")}</span>
          <input className="ts-input mono" value={saved.pathname} onChange={(e) => updateParts({ pathname: e.target.value })} />

          <span className="ts-kv-key">{tx(locale, "Hash (#)", "锚点 (#)")}</span>
          <input className="ts-input mono" value={saved.hash} onChange={(e) => updateParts({ hash: e.target.value })} />

          <span className="ts-kv-key">{tx(locale, "Username", "用户名")}</span>
          <input className="ts-input mono" value={saved.username} onChange={(e) => updateParts({ username: e.target.value })} />

          <span className="ts-kv-key">{tx(locale, "Password", "密码")}</span>
          <input className="ts-input mono" value={saved.password} onChange={(e) => updateParts({ password: e.target.value })} />
        </div>

        {pathSegments.length > 0 && (
          <div className="ts-row" style={{ marginTop: 8 }}>
            <span className="ts-label">{tx(locale, "Segments:", "路径分段:")}</span>
            {pathSegments.map((seg, i) => (
              <span key={i} className="ts-badge">
                /{seg}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="ts-box ts-col" style={{ gap: 6 }}>
        <div className="ts-row" style={{ justifyContent: "space-between" }}>
          <span className="ts-label">
            {tx(locale, `Query Parameters (${saved.params.length})`, `Query 查询参数 (${saved.params.length})`)}
          </span>
          <button
            type="button"
            className="ts-btn sm"
            onClick={() => updateParts({ params: [...saved.params, { id: newId(), key: "", value: "", enabled: true }] })}
          >
            {tx(locale, "+ Add Param", "+ 添加参数")}
          </button>
        </div>

        {saved.params.length === 0 ? (
          <span style={{ color: "var(--ts-fg-muted)" }}>{tx(locale, "No query parameters.", "暂无 Query 参数。")}</span>
        ) : (
          <table className="ts-table">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>{tx(locale, "Key", "参数名")}</th>
                <th>{tx(locale, "Value (Decoded)", "参数值（已解码）")}</th>
                <th>{tx(locale, "Encoded", "编码结果")}</th>
                <th style={{ width: 70 }}>{tx(locale, "Ops", "操作")}</th>
              </tr>
            </thead>
            <tbody>
              {saved.params.map((row, idx) => (
                <tr key={row.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(e) =>
                        updateParts({
                          params: saved.params.map((r) => (r.id === row.id ? { ...r, enabled: e.target.checked } : r)),
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="ts-input mono"
                      value={row.key}
                      onChange={(e) =>
                        updateParts({
                          params: saved.params.map((r) => (r.id === row.id ? { ...r, key: e.target.value } : r)),
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="ts-input mono"
                      value={row.value}
                      onChange={(e) =>
                        updateParts({
                          params: saved.params.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)),
                        })
                      }
                    />
                  </td>
                  <td className="ts-mono" style={{ fontSize: 11, wordBreak: "break-all" }}>
                    {encodeURIComponent(row.value)}
                  </td>
                  <td>
                    <div className="ts-row" style={{ gap: 2 }}>
                      <button
                        type="button"
                        className="ts-btn sm"
                        disabled={idx === 0}
                        onClick={() => {
                          const next = [...saved.params];
                          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                          updateParts({ params: next });
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="ts-btn sm"
                        onClick={() => updateParts({ params: saved.params.filter((r) => r.id !== row.id) })}
                      >
                        ×
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="ts-box ts-col" style={{ gap: 4 }}>
        <span className="ts-label">{tx(locale, "Rebuilt URL", "实时重组 URL")}</span>
        <textarea className="ts-textarea mono" rows={2} readOnly value={rebuiltUrl} />
      </div>
    </div>
  );
}
