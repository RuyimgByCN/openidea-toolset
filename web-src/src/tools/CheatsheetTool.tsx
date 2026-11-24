import { useMemo, useState } from "react";
import { copyToClipboard } from "../bridge";
import { tx } from "../i18n";
import type { ToolProps } from "../types";
import {
  CHEAT_CATEGORIES,
  COMMAND_SHEETS,
  type CheatEntry,
  type CommandSheetId,
} from "../utils/cheatsheetData";

export { COMMAND_SHEETS, type CheatEntry };

type SheetId = "all" | CommandSheetId | "http" | "ascii" | "chmod";

export const HTTP_CODES: Array<[string, string, string, string]> = [
  ["100", "Continue", "Client may continue sending request body", "客户端可继续发送剩余请求体"],
  ["101", "Switching Protocols", "Server upgrades protocol (e.g. WebSocket)", "服务器同意切换协议（例如升级到 WebSocket）"],
  ["200", "OK", "Request succeeded", "请求成功并正常返回"],
  ["201", "Created", "Resource created successfully", "请求成功且已创建新资源"],
  ["204", "No Content", "Succeeded with no response body", "处理成功，响应体为空"],
  ["206", "Partial Content", "Range request fulfilled", "已成功返回断点续传/分片 Range 请求内容"],
  ["301", "Moved Permanently", "Permanent redirect (cacheable)", "永久重定向（浏览器/CDN 可缓存）"],
  ["302", "Found", "Temporary redirect", "临时重定向"],
  ["304", "Not Modified", "Cached representation is still valid", "资源未修改，可使用本地缓存版本"],
  ["307", "Temporary Redirect", "Temporary redirect preserving HTTP method", "临时重定向且保持原 HTTP 请求方法与请求体"],
  ["308", "Permanent Redirect", "Permanent redirect preserving HTTP method", "永久重定向且保持原 HTTP 请求方法与请求体"],
  ["400", "Bad Request", "Malformed syntax or invalid parameters", "请求语法错误或参数校验失败"],
  ["401", "Unauthorized", "Missing or invalid authentication credentials", "未认证或认证凭据缺失/已失效"],
  ["403", "Forbidden", "Authenticated but lacks permission", "已认证但无权访问目标资源"],
  ["404", "Not Found", "Requested resource does not exist", "请求的资源或接口路径不存在"],
  ["405", "Method Not Allowed", "HTTP method unsupported on this endpoint", "目标接口不支持当前使用的 HTTP 方法"],
  ["408", "Request Timeout", "Server timed out waiting for client", "服务器等待客户端请求超时"],
  ["409", "Conflict", "Request conflicts with current resource state", "请求与资源当前状态存在冲突"],
  ["413", "Payload Too Large", "Request body exceeds server limit", "请求体大小超出服务端限制"],
  ["415", "Unsupported Media Type", "Content-Type not accepted", "服务端不支持当前请求的 Content-Type"],
  ["422", "Unprocessable Content", "Semantically invalid request body", "请求格式合法但语义/业务字段校验未通过"],
  ["429", "Too Many Requests", "Rate limit exceeded", "请求过于频繁，触发限流策略"],
  ["500", "Internal Server Error", "Unexpected server failure", "服务端内部发生未预期异常"],
  ["502", "Bad Gateway", "Invalid response from upstream server", "网关或代理从上游服务器收到无效响应"],
  ["503", "Service Unavailable", "Server overloaded or under maintenance", "服务暂不可用（过载或正在维护）"],
  ["504", "Gateway Timeout", "Upstream server failed to respond in time", "网关或代理等待上游服务器响应超时"],
];

const ASCII_CTRL: Record<number, string> = {
  0: "NUL", 7: "BEL", 8: "BS", 9: "TAB", 10: "LF", 13: "CR", 27: "ESC", 32: "SPACE", 127: "DEL",
};

const QUICK_PILLS: Array<{ id: SheetId; labelEn: string; labelZh: string }> = [
  { id: "all", labelEn: "All 27 (270)", labelZh: "全部 27 类 (270)" },
  { id: "git", labelEn: "Git", labelZh: "Git" },
  { id: "docker", labelEn: "Docker", labelZh: "Docker" },
  { id: "k8s", labelEn: "K8s", labelZh: "K8s" },
  { id: "linux", labelEn: "Linux", labelZh: "Linux" },
  { id: "sql", labelEn: "SQL", labelZh: "SQL" },
  { id: "curl", labelEn: "cURL", labelZh: "cURL" },
  { id: "http", labelEn: "HTTP Codes", labelZh: "HTTP 状态码" },
  { id: "ascii", labelEn: "ASCII", labelZh: "ASCII 码表" },
  { id: "chmod", labelEn: "Chmod", labelZh: "Chmod 权限" },
];

export default function CheatsheetTool({ locale }: ToolProps) {
  const [sheet, setSheet] = useState<SheetId>("all");
  const [q, setQ] = useState("");
  const [chmodBits, setChmodBits] = useState([true, true, true, true, false, true, true, false, true]); // 0755
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const lower = q.trim().toLowerCase();

  const totalCommands = useMemo(
    () => CHEAT_CATEGORIES.reduce((acc, c) => acc + COMMAND_SHEETS[c.id].length, 0),
    [],
  );

  const handleCopy = async (text: string) => {
    await copyToClipboard(text);
    setCopiedCmd(text);
    setTimeout(() => setCopiedCmd((cur) => (cur === text ? null : cur)), 1500);
  };

  const asciiRows = useMemo(() => {
    const list: Array<{ dec: number; hex: string; ch: string }> = [];
    for (let i = 0; i < 128; i++) {
      const ch = ASCII_CTRL[i] ?? (i < 32 ? `CTRL-${i}` : String.fromCharCode(i));
      list.push({ dec: i, hex: `0x${i.toString(16).toUpperCase().padStart(2, "0")}`, ch });
    }
    if (!lower) return list;
    return list.filter((r) => String(r.dec) === lower || r.hex.toLowerCase().includes(lower) || r.ch.toLowerCase().includes(lower));
  }, [lower]);

  const commandRows = useMemo(() => {
    if (sheet === "http" || sheet === "ascii" || sheet === "chmod") return [];
    const catMeta = new Map(CHEAT_CATEGORIES.map((c) => [c.id, c]));
    const keys: CommandSheetId[] = sheet === "all" ? CHEAT_CATEGORIES.map((c) => c.id) : [sheet];
    const items: Array<{ catId: CommandSheetId; catEn: string; catZh: string; entry: CheatEntry }> = [];
    for (const cid of keys) {
      const meta = catMeta.get(cid)!;
      for (const entry of COMMAND_SHEETS[cid]) {
        if (
          !lower ||
          entry.cmd.toLowerCase().includes(lower) ||
          entry.descEn.toLowerCase().includes(lower) ||
          entry.descZh.toLowerCase().includes(lower) ||
          meta.labelEn.toLowerCase().includes(lower) ||
          meta.labelZh.toLowerCase().includes(lower)
        ) {
          items.push({ catId: cid, catEn: meta.labelEn, catZh: meta.labelZh, entry });
        }
      }
    }
    return items;
  }, [sheet, lower]);

  const chmodOctal = [0, 3, 6]
    .map((off) => (chmodBits[off] ? 4 : 0) + (chmodBits[off + 1] ? 2 : 0) + (chmodBits[off + 2] ? 1 : 0))
    .join("");
  const chmodSym = chmodBits
    .map((on, idx) => (on ? ["r", "w", "x"][idx % 3] : "-"))
    .join("");

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">
          {tx(locale, `Developer Cheatsheets (27 Categories · ${totalCommands})`, `开发者速查表 (27 分类 · ${totalCommands} 条命令)`)}
        </span>
        {copiedCmd !== null && <span className="ts-badge good">{tx(locale, "Copied", "已复制")}</span>}
      </div>

      <div className="ts-row">
        <select
          className="ts-select"
          style={{ width: 210 }}
          value={sheet}
          onChange={(e) => setSheet(e.target.value as SheetId)}
        >
          <option value="all">
            {tx(locale, `All Command Categories (${totalCommands})`, `全部分类 (${totalCommands})`)}
          </option>
          {CHEAT_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {tx(locale, c.labelEn, c.labelZh)} ({COMMAND_SHEETS[c.id].length})
            </option>
          ))}
          <option value="http">{tx(locale, `HTTP Status Codes (${HTTP_CODES.length})`, `HTTP 状态码 (${HTTP_CODES.length})`)}</option>
          <option value="ascii">{tx(locale, "ASCII Table (128)", "ASCII 码表 (128)")}</option>
          <option value="chmod">{tx(locale, "Chmod Permission Calculator", "Chmod 权限计算器")}</option>
        </select>

        {sheet !== "chmod" && (
          <input
            className="ts-input"
            style={{ flex: 1, minWidth: 160 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tx(locale, "Search across commands, descriptions, or categories...", "搜索命令、说明、分类或 HTTP 状态码...")}
          />
        )}
      </div>

      <div className="ts-row">
        {QUICK_PILLS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`ts-pill ${sheet === s.id ? "active" : ""}`}
            onClick={() => setSheet(s.id)}
          >
            {tx(locale, s.labelEn, s.labelZh)}
          </button>
        ))}
      </div>

      <div className="ts-box" style={{ flex: 1, overflowY: "auto" }}>
        {sheet === "chmod" && (
          <div className="ts-col">
            <div className="ts-row">
              <span className="ts-badge">chmod {chmodOctal}</span>
              <span className="ts-badge ts-mono">{chmodSym}</span>
              <button type="button" className="ts-btn sm" onClick={() => handleCopy(`chmod ${chmodOctal} `)}>
                {tx(locale, "Copy Command", "复制命令")}
              </button>
            </div>
            <table className="ts-table">
              <thead>
                <tr>
                  <th>{tx(locale, "Role", "角色")}</th>
                  <th>{tx(locale, "Read (4)", "读 (4)")}</th>
                  <th>{tx(locale, "Write (2)", "写 (2)")}</th>
                  <th>{tx(locale, "Execute (1)", "执行 (1)")}</th>
                </tr>
              </thead>
              <tbody>
                {[
                  tx(locale, "Owner (User)", "所有者 (Owner)"),
                  tx(locale, "Group", "所属组 (Group)"),
                  tx(locale, "Others (Public)", "其他用户 (Others)"),
                ].map((role, ri) => (
                  <tr key={ri}>
                    <td>{role}</td>
                    {[0, 1, 2].map((ci) => {
                      const idx = ri * 3 + ci;
                      return (
                        <td key={ci}>
                          <input
                            type="checkbox"
                            checked={chmodBits[idx]}
                            onChange={(e) =>
                              setChmodBits((prev) => prev.map((v, i) => (i === idx ? e.target.checked : v)))
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {sheet === "http" && (
          <table className="ts-table">
            <thead>
              <tr>
                <th>{tx(locale, "Code", "状态码")}</th>
                <th>{tx(locale, "Phrase", "短语")}</th>
                <th>{tx(locale, "Meaning", "说明")}</th>
              </tr>
            </thead>
            <tbody>
              {HTTP_CODES.filter((r) => !lower || r.some((c) => c.toLowerCase().includes(lower))).map(([c, p, dEn, dZh]) => (
                <tr key={c}>
                  <td className="ts-mono"><strong>{c}</strong></td>
                  <td>{p}</td>
                  <td style={{ color: "var(--ts-fg-muted)" }}>{tx(locale, dEn, dZh)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {sheet === "ascii" && (
          <table className="ts-table">
            <thead>
              <tr>
                <th>{tx(locale, "DEC", "十进制")}</th>
                <th>{tx(locale, "HEX", "十六进制")}</th>
                <th>{tx(locale, "CHAR", "字符")}</th>
              </tr>
            </thead>
            <tbody>
              {asciiRows.map((r) => (
                <tr key={r.dec}>
                  <td className="ts-mono">{r.dec}</td>
                  <td className="ts-mono">{r.hex}</td>
                  <td className="ts-mono"><strong>{r.ch}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {sheet !== "http" && sheet !== "ascii" && sheet !== "chmod" && (
          <table className="ts-table">
            <thead>
              <tr>
                {sheet === "all" && <th>{tx(locale, "Category", "分类")}</th>}
                <th>{tx(locale, "Command / Pattern", "命令 / 语法")}</th>
                <th>{tx(locale, "Description", "说明")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {commandRows.map((row, idx) => (
                <tr key={`${row.catId}-${idx}`}>
                  {sheet === "all" && (
                    <td>
                      <button
                        type="button"
                        className="ts-btn sm"
                        onClick={() => setSheet(row.catId)}
                      >
                        {tx(locale, row.catEn, row.catZh)}
                      </button>
                    </td>
                  )}
                  <td className="ts-mono" style={{ fontSize: 11.5 }}>{row.entry.cmd}</td>
                  <td style={{ color: "var(--ts-fg-muted)" }}>{tx(locale, row.entry.descEn, row.entry.descZh)}</td>
                  <td>
                    <button type="button" className="ts-btn sm" onClick={() => handleCopy(row.entry.cmd)}>
                      {copiedCmd === row.entry.cmd ? tx(locale, "Copied", "已复制") : tx(locale, "Copy", "复制")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
