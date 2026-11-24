import { useEffect, useMemo, useState } from "react";
import { bridge, copyToClipboard } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";
import { stripUrlPassword } from "../utils/urlSanitize";

interface HeaderRow {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

interface WsLogEntry {
  id: string;
  time: string;
  dir: "in" | "out" | "sys";
  text: string;
  hex?: string;
  bytes?: number;
  isBinary?: boolean;
}

function nowStamp(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

function newRowId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function WebSocketClientTool({
  tabId,
  locale,
  initialInput,
  onConsumeInitial,
  wsPushEvent,
  onConsumeWsPush,
}: ToolProps) {
  const [saved, setSaved] = useToolState(
    `ws-${tabId}`,
    {
      url: "wss://echo.websocket.org",
      subprotocol: "",
      message: '{\n  "type": "ping",\n  "ts": 1\n}',
      sendMode: "json" as "text" | "json" | "hex",
      heartbeatEnabled: false,
      heartbeatSec: 30,
      heartbeatMsg: "ping",
      logFilter: "all" as "all" | "in" | "out" | "sys",
      showHex: false,
    },
    (state) => ({
      ...state,
      url: stripUrlPassword(state.url),
    }),
  );
  // Keep custom handshake headers in memory only; never persist potentially sensitive auth headers.
  const [headers, setHeaders] = useState<HeaderRow[]>([{ id: "h1", key: "", value: "", enabled: true }]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [logs, setLogs] = useState<WsLogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const enabledHeaders = useMemo(
    () =>
      headers
        .filter((h) => h.enabled && h.key.trim())
        .map((h) => [h.key.trim(), h.value] as [string, string]),
    [headers],
  );

  const appendLog = (entry: Omit<WsLogEntry, "id" | "time">) => {
    setLogs((prev) => [{ id: newRowId(), time: nowStamp(), ...entry }, ...prev].slice(0, 500));
  };

  useEffect(() => {
    if (initialInput != null) {
      const trimmed = initialInput.trim();
      if (/^wss?:\/\//i.test(trimmed)) {
        setSaved((p) => ({ ...p, url: trimmed }));
      } else {
        setSaved((p) => ({ ...p, message: initialInput }));
      }
      onConsumeInitial?.();
    }
  }, [initialInput]);

  // Query connection status on mount
  useEffect(() => {
    if (!bridge.isHosted) return;
    bridge
      .rpc<{ connected: boolean }>("ws.status", { tabId })
      .then((res) => setConnected(Boolean(res?.connected)))
      .catch(() => {});
  }, [tabId]);

  // Sync active WS config to host so ws-connect command uses current URL
  useEffect(() => {
    if (!bridge.isHosted) return;
    const t = setTimeout(() => {
      bridge
        .rpc("ws.setActive", {
          tabId,
          url: saved.url,
          headers: enabledHeaders,
          subprotocol: saved.subprotocol,
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [tabId, saved.url, saved.subprotocol, enabledHeaders]);

  // Handle host push events for this tab
  useEffect(() => {
    if (!wsPushEvent || wsPushEvent.tabId !== tabId) return;
    if (wsPushEvent.op === "ws-status") {
      const isConn = Boolean(wsPushEvent.connected);
      setConnected(isConn);
      setConnecting(false);
      if (wsPushEvent.error) {
        setErr(wsPushEvent.error);
        appendLog({ dir: "sys", text: wsPushEvent.error });
      } else {
        setErr(null);
        appendLog({
          dir: "sys",
          text: isConn
            ? tx(locale, `Connected to ${wsPushEvent.url || saved.url}`, `已连接到 ${wsPushEvent.url || saved.url}`)
            : tx(locale, "Connection closed", "连接已关闭"),
        });
      }
    } else if (wsPushEvent.op === "ws-event") {
      if (wsPushEvent.messages?.length) {
        const nextEntries: WsLogEntry[] = wsPushEvent.messages.map((m) => ({
          id: newRowId(),
          time: nowStamp(),
          dir: "in",
          text: m.text,
          hex: m.hex,
          bytes: m.bytes,
          isBinary: m.isBinary,
        }));
        setLogs((prev) => [...nextEntries.reverse(), ...prev].slice(0, 500));
      }
      if (wsPushEvent.closed) {
        setConnected(false);
        setConnecting(false);
        appendLog({ dir: "sys", text: tx(locale, "Remote closed connection", "远端已关闭连接") });
      }
    }
    onConsumeWsPush?.();
  }, [wsPushEvent, tabId, locale]);

  // Heartbeat auto-sender
  useEffect(() => {
    if (!connected || !saved.heartbeatEnabled) return;
    const sec = Math.max(1, Number(saved.heartbeatSec) || 30);
    const id = setInterval(() => {
      const msg = saved.heartbeatMsg || "ping";
      bridge
        .rpc("ws.send", { tabId, message: msg, isHex: false })
        .then(() => {
          appendLog({
            dir: "out",
            text: `[Heartbeat] ${msg}`,
            bytes: new TextEncoder().encode(msg).length,
          });
        })
        .catch((e) => {
          setErr((e as Error).message);
        });
    }, sec * 1000);
    return () => clearInterval(id);
  }, [connected, saved.heartbeatEnabled, saved.heartbeatSec, saved.heartbeatMsg, tabId]);

  const formatConnectError = (raw: string): string => {
    if (/capab|net:|permission|denied/i.test(raw)) {
      return tx(
        locale,
        `${raw} — Grant network host permission in OpenIDEA (net:<host>) when prompted or allow the host in plugin permissions.`,
        `${raw} —— 请在 OpenIDEA 插件权限中授权目标域名访问权限（net:<host>）。`,
      );
    }
    return raw;
  };

  const handleConnect = async () => {
    setErr(null);
    setStatusNote(null);
    const targetUrl = saved.url.trim();
    if (!/^wss?:\/\//i.test(targetUrl)) {
      setErr(tx(locale, "URL must start with ws:// or wss://", "连接地址必须以 ws:// 或 wss:// 开头"));
      return;
    }
    setConnecting(true);
    try {
      await bridge.rpc("ws.connect", {
        tabId,
        url: targetUrl,
        headers: enabledHeaders,
        subprotocol: saved.subprotocol.trim(),
      });
      setConnected(true);
      setConnecting(false);
      appendLog({ dir: "sys", text: tx(locale, `Connected to ${targetUrl}`, `已连接到 ${targetUrl}`) });
    } catch (e) {
      setConnecting(false);
      setConnected(false);
      const msg = formatConnectError((e as Error).message);
      setErr(msg);
      appendLog({ dir: "sys", text: msg });
    }
  };

  const handleDisconnect = async () => {
    setErr(null);
    try {
      await bridge.rpc("ws.disconnect", { tabId });
      setConnected(false);
      setConnecting(false);
      appendLog({ dir: "sys", text: tx(locale, "Disconnected", "已主动断开连接") });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleSend = async () => {
    setErr(null);
    setStatusNote(null);
    if (!connected) {
      setErr(tx(locale, "Connect to a WebSocket endpoint first", "请先连接 WebSocket 服务端"));
      return;
    }
    try {
      const res = await bridge.rpc<{ bytes: number }>("ws.send", {
        tabId,
        message: saved.message,
        isHex: saved.sendMode === "hex",
      });
      appendLog({
        dir: "out",
        text: saved.message,
        bytes: res.bytes,
        isBinary: saved.sendMode === "hex",
      });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const formatJsonMessage = (compact: boolean) => {
    setErr(null);
    try {
      const parsed = JSON.parse(saved.message);
      setSaved((p) => ({ ...p, message: JSON.stringify(parsed, null, compact ? 0 : 2) }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((entry) => {
      if (saved.logFilter !== "all" && entry.dir !== saved.logFilter) return false;
      if (!q) return true;
      return entry.text.toLowerCase().includes(q) || (entry.hex || "").toLowerCase().includes(q);
    });
  }, [logs, saved.logFilter, search]);

  const exportedLogText = useMemo(
    () =>
      logs
        .slice()
        .reverse()
        .map((l) => `[${l.time}] [${l.dir.toUpperCase()}] ${l.text}`)
        .join("\n"),
    [logs],
  );

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <div className="ts-row">
          <span className="ts-tool-title">{tx(locale, "WebSocket Client", "WebSocket 客户端")}</span>
          <span className={`ts-badge ${connected ? "good" : ""}`}>
            {connected
              ? tx(locale, "Connected", "已连接")
              : connecting
                ? tx(locale, "Connecting...", "连接中...")
                : tx(locale, "Disconnected", "未连接")}
          </span>
        </div>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, message: t }))}
          onPaste={(t) => setSaved((p) => ({ ...p, message: t }))}
          outputText={exportedLogText}
          openTabTitle={tx(locale, "WS Log", "WS 日志")}
          openTabLanguage="log"
          openTabFileName="websocket.log"
          onClear={() => setLogs([])}
        />
      </div>

      <div className="ts-row">
        <input
          className="ts-input mono"
          style={{ flex: 1, minWidth: 200 }}
          value={saved.url}
          onChange={(e) => setSaved((p) => ({ ...p, url: e.target.value }))}
          placeholder="wss://echo.websocket.org"
        />
        <input
          className="ts-input mono"
          style={{ width: 140 }}
          value={saved.subprotocol}
          onChange={(e) => setSaved((p) => ({ ...p, subprotocol: e.target.value }))}
          placeholder={tx(locale, "Subprotocol", "子协议（可选）")}
        />
        {connected ? (
          <button type="button" className="ts-btn danger" onClick={handleDisconnect}>
            {tx(locale, "Disconnect", "断开连接")}
          </button>
        ) : (
          <button type="button" className="ts-btn primary" disabled={connecting} onClick={handleConnect}>
            {connecting ? tx(locale, "Connecting...", "连接中...") : tx(locale, "Connect", "连接")}
          </button>
        )}
      </div>

      <div className="ts-box">
        <div className="ts-row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <span className="ts-label">{tx(locale, "Handshake Headers", "握手请求头")}</span>
          <button
            type="button"
            className="ts-btn sm"
            onClick={() => setHeaders((prev) => [...prev, { id: newRowId(), key: "", value: "", enabled: true }])}
          >
            {tx(locale, "+ Add Header", "+ 添加请求头")}
          </button>
        </div>
        <div className="ts-col" style={{ gap: 4 }}>
          {headers.map((h) => (
            <div key={h.id} className="ts-row">
              <input
                type="checkbox"
                checked={h.enabled}
                onChange={(e) =>
                  setHeaders((prev) => prev.map((x) => (x.id === h.id ? { ...x, enabled: e.target.checked } : x)))
                }
              />
              <input
                className="ts-input mono"
                style={{ flex: 1 }}
                value={h.key}
                onChange={(e) =>
                  setHeaders((prev) => prev.map((x) => (x.id === h.id ? { ...x, key: e.target.value } : x)))
                }
                placeholder={tx(locale, "Header name", "请求头名称")}
              />
              <input
                className="ts-input mono"
                style={{ flex: 1 }}
                value={h.value}
                onChange={(e) =>
                  setHeaders((prev) => prev.map((x) => (x.id === h.id ? { ...x, value: e.target.value } : x)))
                }
                placeholder={tx(locale, "Value", "请求头值")}
              />
              <button
                type="button"
                className="ts-btn sm"
                onClick={() =>
                  setHeaders((prev) => (prev.length > 1 ? prev.filter((x) => x.id !== h.id) : prev))
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="ts-box">
        <div className="ts-row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <div className="ts-row">
            <span className="ts-label">{tx(locale, "Payload", "发送消息体")}</span>
            {(["text", "json", "hex"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`ts-pill ${saved.sendMode === m ? "active" : ""}`}
                onClick={() => setSaved((p) => ({ ...p, sendMode: m }))}
              >
                {m === "text" ? tx(locale, "Text", "文本") : m === "json" ? "JSON" : "Hex"}
              </button>
            ))}
          </div>
          <div className="ts-row">
            {saved.sendMode === "json" && (
              <>
                <button type="button" className="ts-btn sm" onClick={() => formatJsonMessage(false)}>
                  {tx(locale, "Pretty", "格式化")}
                </button>
                <button type="button" className="ts-btn sm" onClick={() => formatJsonMessage(true)}>
                  {tx(locale, "Minify", "压缩")}
                </button>
              </>
            )}
            <button type="button" className="ts-btn sm primary" disabled={!connected} onClick={handleSend}>
              {tx(locale, "Send", "发送")}
            </button>
          </div>
        </div>
        <textarea
          className="ts-textarea mono"
          rows={4}
          value={saved.message}
          onChange={(e) => setSaved((p) => ({ ...p, message: e.target.value }))}
          placeholder={
            saved.sendMode === "hex"
              ? tx(locale, "Hex bytes, e.g. 48 65 6c 6c 6f", "十六进制字节，例如 48 65 6c 6c 6f")
              : tx(locale, "Message text or JSON frame...", "输入文本或 JSON 消息...")
          }
        />
        <div className="ts-row" style={{ marginTop: 6 }}>
          <label className="ts-inline-check">
            <input
              type="checkbox"
              checked={saved.heartbeatEnabled}
              onChange={(e) => setSaved((p) => ({ ...p, heartbeatEnabled: e.target.checked }))}
            />
            {tx(locale, "Auto heartbeat", "自动心跳发送")}
          </label>
          <span className="ts-label">{tx(locale, "Interval (s):", "间隔(秒):")}</span>
          <input
            type="number"
            min={1}
            max={3600}
            className="ts-input mono"
            style={{ width: 66 }}
            value={saved.heartbeatSec}
            onChange={(e) => setSaved((p) => ({ ...p, heartbeatSec: Math.max(1, Number(e.target.value) || 30) }))}
          />
          <input
            className="ts-input mono"
            style={{ flex: 1, minWidth: 100 }}
            value={saved.heartbeatMsg}
            onChange={(e) => setSaved((p) => ({ ...p, heartbeatMsg: e.target.value }))}
            placeholder={tx(locale, "Heartbeat payload", "心跳内容")}
          />
        </div>
      </div>

      {err && <div className="ts-err">{err}</div>}
      {statusNote && <div className="ts-ok">{statusNote}</div>}

      <div className="ts-box">
        <div className="ts-row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <div className="ts-row">
            <span className="ts-label">
              {tx(locale, `Messages (${filteredLogs.length})`, `消息日志 (${filteredLogs.length})`)}
            </span>
            {(["all", "in", "out", "sys"] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`ts-pill ${saved.logFilter === f ? "active" : ""}`}
                onClick={() => setSaved((p) => ({ ...p, logFilter: f }))}
              >
                {f === "all"
                  ? tx(locale, "All", "全部")
                  : f === "in"
                    ? tx(locale, "Recv", "接收")
                    : f === "out"
                      ? tx(locale, "Sent", "发送")
                      : tx(locale, "Sys", "系统")}
              </button>
            ))}
          </div>
          <div className="ts-row">
            <label className="ts-inline-check">
              <input
                type="checkbox"
                checked={saved.showHex}
                onChange={(e) => setSaved((p) => ({ ...p, showHex: e.target.checked }))}
              />
              Hex
            </label>
            <input
              className="ts-input"
              style={{ width: 130 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tx(locale, "Filter log...", "过滤消息...")}
            />
          </div>
        </div>

        <div className="ts-col" style={{ maxHeight: 250, overflowY: "auto", gap: 6 }}>
          {filteredLogs.length === 0 ? (
            <span style={{ color: "var(--ts-fg-muted)" }}>
              {tx(locale, "No WebSocket frames yet.", "暂无收发记录。")}
            </span>
          ) : (
            filteredLogs.map((l) => (
              <div
                key={l.id}
                style={{
                  borderBottom: "1px solid var(--ts-border)",
                  paddingBottom: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <div className="ts-row" style={{ justifyContent: "space-between" }}>
                  <div className="ts-row">
                    <span className={`ts-badge ${l.dir === "in" ? "good" : ""}`}>
                      {l.dir === "in" ? "← IN" : l.dir === "out" ? "→ OUT" : "SYS"}
                    </span>
                    <span className="ts-mono" style={{ fontSize: 11, color: "var(--ts-fg-muted)" }}>
                      {l.time}
                      {l.bytes != null ? ` · ${l.bytes} B` : ""}
                      {l.isBinary ? ` · ${tx(locale, "Binary", "二进制")}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="ts-btn sm"
                    onClick={async () => {
                      await copyToClipboard(saved.showHex && l.hex ? l.hex : l.text);
                      setStatusNote(tx(locale, "Message copied", "消息已复制"));
                    }}
                  >
                    {tx(locale, "Copy", "复制")}
                  </button>
                </div>
                <pre className="ts-mono" style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {saved.showHex && l.hex ? l.hex : l.text}
                </pre>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
