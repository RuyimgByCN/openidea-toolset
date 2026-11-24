import { useEffect, useMemo, useRef, useState } from "react";
import { copyToClipboard, openHostFile, saveHostFile } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";
import { exportByteArray, inspectOffset, parseBytesInput } from "../utils/hexInspector";

const MAX_HEX_FILE_BYTES = 256 * 1024;
const PAGE_BYTES = 256;

export default function HexViewerTool({ tabId, locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState(`hex-${tabId}`, {
    mode: "utf8" as "utf8" | "hex" | "base64",
    input: "OpenIDEA Toolset 🚀 2026\n\x00\x01\x02\x7fABC",
    exportFmt: "c" as "dump" | "c" | "rust" | "go" | "python" | "hex" | "base64",
  });
  const [fileData, setFileData] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [selectedOffset, setSelectedOffset] = useState(0);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, mode: "utf8", input: initialInput }));
      setFileData(null);
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const { bytes, parseErr } = useMemo(() => {
    if (fileData) return { bytes: fileData.bytes, parseErr: null };
    try {
      return { bytes: parseBytesInput(saved.input, saved.mode), parseErr: null };
    } catch (e) {
      return { bytes: new Uint8Array(0), parseErr: (e as Error).message };
    }
  }, [fileData, saved.input, saved.mode]);

  const totalPages = Math.max(1, Math.ceil(bytes.length / PAGE_BYTES));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = safePage * PAGE_BYTES;
  const pageEnd = Math.min(bytes.length, pageStart + PAGE_BYTES);
  const clampedOffset = bytes.length > 0 ? Math.min(selectedOffset, bytes.length - 1) : -1;
  const inspection = clampedOffset >= 0 ? inspectOffset(bytes, clampedOffset) : null;

  const rows: number[] = [];
  for (let off = pageStart; off < pageEnd; off += 16) {
    rows.push(off);
  }

  const pickFile = async () => {
    const f = await openHostFile();
    if (f) {
      const sliced = f.data.byteLength > MAX_HEX_FILE_BYTES ? f.data.subarray(0, MAX_HEX_FILE_BYTES) : f.data;
      setFileData({ name: f.name, bytes: sliced });
      setPage(0);
      setSelectedOffset(0);
      if (f.data.byteLength > MAX_HEX_FILE_BYTES) {
        setStatus(tx(locale, `Truncated to first 256 KiB of ${f.name}`, `已截取文件前 256 KiB 预览`));
      }
    } else {
      fileRef.current?.click();
    }
  };

  const exportedText = useMemo(() => exportByteArray(bytes, saved.exportFmt), [bytes, saved.exportFmt]);

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Hex Viewer & Binary Inspector", "十六进制与二进制查看器")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => {
            setFileData(null);
            setSaved((p) => ({ ...p, mode: "utf8", input: t }));
          }}
          onPaste={(t) => {
            setFileData(null);
            setSaved((p) => ({ ...p, input: t }));
          }}
          outputText={exportedText}
          openTabTitle={tx(locale, "Hex Export", "十六进制导出")}
          onClear={() => {
            setFileData(null);
            setSaved((p) => ({ ...p, input: "" }));
            setSelectedOffset(0);
          }}
        />
      </div>

      <div className="ts-row" style={{ justifyContent: "space-between" }}>
        <div className="ts-row">
          {(["utf8", "hex", "base64"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`ts-pill ${!fileData && saved.mode === m ? "active" : ""}`}
              onClick={() => {
                setFileData(null);
                setSaved((p) => ({ ...p, mode: m }));
                setPage(0);
                setSelectedOffset(0);
              }}
            >
              {m === "utf8" ? "UTF-8" : m === "hex" ? "Hex" : "Base64"}
            </button>
          ))}
          <button type="button" className={`ts-pill ${fileData ? "active" : ""}`} onClick={pickFile}>
            {tx(locale, "Open File", "打开本地文件")}
          </button>
          <input
            ref={fileRef}
            type="file"
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const raw = new Uint8Array(await f.arrayBuffer());
              const sliced = raw.byteLength > MAX_HEX_FILE_BYTES ? raw.subarray(0, MAX_HEX_FILE_BYTES) : raw;
              setFileData({ name: f.name, bytes: sliced });
              setPage(0);
              setSelectedOffset(0);
              e.target.value = "";
            }}
          />
        </div>
        <div className="ts-row">
          <span className="ts-badge">{bytes.length} {tx(locale, "bytes", "字节")}</span>
          {status && <span className="ts-badge good">{status}</span>}
        </div>
      </div>

      {!fileData ? (
        <textarea
          className="ts-textarea mono"
          rows={3}
          value={saved.input}
          onChange={(e) => {
            setSaved((p) => ({ ...p, input: e.target.value }));
            setPage(0);
          }}
          placeholder={tx(locale, "Enter UTF-8 text, Hex bytes, or Base64...", "输入 UTF-8 文本、Hex 字节或 Base64...")}
        />
      ) : (
        <div className="ts-box ts-row" style={{ justifyContent: "space-between" }}>
          <span className="ts-mono">
            {tx(locale, "File (in-memory)", "本地文件（仅内存）")}: <strong>{fileData.name}</strong> ({fileData.bytes.length} B)
          </span>
          <button type="button" className="ts-btn sm" onClick={() => setFileData(null)}>
            {tx(locale, "Close File", "关闭文件")}
          </button>
        </div>
      )}

      {parseErr && <div className="ts-err">{parseErr}</div>}

      {totalPages > 1 && (
        <div className="ts-row">
          <button type="button" className="ts-btn sm" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            {tx(locale, "Prev 256B", "上一页")}
          </button>
          <span className="ts-badge">
            {tx(locale, "Page", "页")} {safePage + 1} / {totalPages} (0x{pageStart.toString(16)}..0x{Math.max(0, pageEnd - 1).toString(16)})
          </span>
          <button type="button" className="ts-btn sm" disabled={safePage + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
            {tx(locale, "Next 256B", "下一页")}
          </button>
        </div>
      )}

      <div className="ts-split" style={{ alignItems: "flex-start" }}>
        <div className="ts-box mono" style={{ flex: 2, overflowX: "auto", fontSize: 11.5, lineHeight: 1.65 }}>
          {rows.length === 0 ? (
            <span style={{ color: "var(--ts-fg-muted)" }}>{tx(locale, "No bytes", "无字节数据")}</span>
          ) : (
            rows.map((rowOff) => {
              const cells = Array.from({ length: 16 }, (_, idx) => rowOff + idx);
              return (
                <div key={rowOff} className="ts-row" style={{ flexWrap: "nowrap", gap: 6 }}>
                  <span style={{ color: "var(--ts-fg-muted)", minWidth: 68 }}>
                    {rowOff.toString(16).padStart(8, "0")}
                  </span>
                  <span style={{ display: "inline-flex", gap: 3 }}>
                    {cells.map((off, idx) => {
                      const has = off < bytes.length;
                      const sel = off === clampedOffset;
                      return (
                        <span
                          key={off}
                          onClick={() => has && setSelectedOffset(off)}
                          style={{
                            cursor: has ? "pointer" : "default",
                            padding: "0 2px",
                            marginRight: idx === 7 ? 5 : 0,
                            borderRadius: 2,
                            background: sel ? "var(--ts-accent)" : "transparent",
                            color: sel ? "#ffffff" : has ? "var(--ts-fg)" : "transparent",
                          }}
                        >
                          {has ? bytes[off].toString(16).padStart(2, "0") : "00"}
                        </span>
                      );
                    })}
                  </span>
                  <span style={{ borderLeft: "1px solid var(--ts-border)", paddingLeft: 6, whiteSpace: "pre" }}>
                    {cells.map((off) => {
                      if (off >= bytes.length) return " ";
                      const b = bytes[off];
                      const ch = b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".";
                      const sel = off === clampedOffset;
                      return (
                        <span
                          key={off}
                          onClick={() => setSelectedOffset(off)}
                          style={{
                            cursor: "pointer",
                            background: sel ? "var(--ts-accent)" : "transparent",
                            color: sel ? "#ffffff" : b >= 0x20 && b <= 0x7e ? "var(--ts-fg-strong)" : "var(--ts-fg-muted)",
                          }}
                        >
                          {ch}
                        </span>
                      );
                    })}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div className="ts-box ts-col" style={{ flex: 1, minWidth: 220, gap: 6 }}>
          <span className="ts-label">
            {tx(locale, "Data Inspector", "字节数值解析")}
            {inspection ? ` @ 0x${inspection.offset.toString(16).toUpperCase()} (${inspection.offset})` : ""}
          </span>
          {inspection ? (
            <table className="ts-table">
              <tbody>
                <tr><td>Hex / Bin</td><td className="ts-mono">0x{inspection.byteHex} / {inspection.binary}</td></tr>
                <tr><td>Oct / UTF-8</td><td className="ts-mono">0{inspection.octal} / {inspection.utf8Char}</td></tr>
                <tr><td>Int8 / UInt8</td><td className="ts-mono">{inspection.int8} / {inspection.uint8}</td></tr>
                <tr><td>Int16 (LE/BE)</td><td className="ts-mono">{inspection.int16Le} / {inspection.int16Be}</td></tr>
                <tr><td>UInt16 (LE/BE)</td><td className="ts-mono">{inspection.uint16Le} / {inspection.uint16Be}</td></tr>
                <tr><td>Int32 (LE/BE)</td><td className="ts-mono">{inspection.int32Le} / {inspection.int32Be}</td></tr>
                <tr><td>UInt32 (LE/BE)</td><td className="ts-mono">{inspection.uint32Le} / {inspection.uint32Be}</td></tr>
                <tr><td>Int64 LE</td><td className="ts-mono">{inspection.int64Le}</td></tr>
                <tr><td>UInt64 LE</td><td className="ts-mono">{inspection.uint64Le}</td></tr>
                <tr><td>Float32 (LE/BE)</td><td className="ts-mono">{inspection.float32Le} / {inspection.float32Be}</td></tr>
                <tr><td>Float64 (LE/BE)</td><td className="ts-mono">{inspection.float64Le} / {inspection.float64Be}</td></tr>
              </tbody>
            </table>
          ) : (
            <span style={{ fontSize: 11.5, color: "var(--ts-fg-muted)" }}>{tx(locale, "Click any byte above", "点击上方任意字节查看详情")}</span>
          )}
        </div>
      </div>

      <div className="ts-row">
        <select
          className="ts-select"
          style={{ width: 170 }}
          value={saved.exportFmt}
          onChange={(e) => setSaved((p) => ({ ...p, exportFmt: e.target.value as typeof p.exportFmt }))}
        >
          <option value="c">C Array (unsigned char[])</option>
          <option value="rust">Rust Array ([u8; N])</option>
          <option value="go">Go Slice ([]byte)</option>
          <option value="python">Python bytes([...])</option>
          <option value="dump">Hex Dump</option>
          <option value="hex">Hex Bytes</option>
          <option value="base64">Base64</option>
        </select>
        <button
          type="button"
          className="ts-btn sm"
          onClick={async () => {
            await copyToClipboard(exportedText);
            setStatus(tx(locale, "Copied export", "已复制导出代码"));
            setTimeout(() => setStatus(null), 1300);
          }}
        >
          {tx(locale, "Copy Export", "复制导出代码")}
        </button>
        <button
          type="button"
          className="ts-btn sm"
          onClick={async () => {
            const path = await saveHostFile("hex-export.txt", exportedText, [{ name: "Text", extensions: ["txt"] }]);
            if (path) setStatus(tx(locale, `Saved ${path}`, `已保存 ${path}`));
          }}
        >
          {tx(locale, "Save File", "保存文件")}
        </button>
      </div>
    </div>
  );
}
