import { useEffect, useState } from "react";
import { bridge, copyToClipboard } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

interface PathInfo {
  windows: string;
  posix: string;
  gitBash: string;
  wsl: string;
  fileUri: string;
  escaped: string;
  normalized: string;
  root: string;
  dir: string;
  base: string;
  stem: string;
  ext: string;
  isAbsolute: boolean;
}

export default function PathConvertTool({ locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("path-convert", {
    input: String.raw`C:\Users\developer\Projects\openidea\src\main.rs`,
    wslDistro: "Ubuntu",
    batchMode: false,
    batchTarget: "posix",
  });
  const [info, setInfo] = useState<PathInfo | null>(null);
  const [batchOut, setBatchOut] = useState("");

  useEffect(() => {
    if (initialInput != null) {
      const multi = initialInput.includes("\n");
      setSaved((p) => ({ ...p, input: initialInput.trim(), batchMode: multi }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  useEffect(() => {
    if (!bridge.isHosted) return;
    if (saved.batchMode) {
      bridge
        .rpc<{ result: string }>("path.batch", {
          input: saved.input,
          target: saved.batchTarget,
          wslDistro: saved.wslDistro,
        })
        .then((r) => setBatchOut(r.result))
        .catch(() => {});
    } else {
      bridge
        .rpc<PathInfo>("path.convert", { input: saved.input, wslDistro: saved.wslDistro })
        .then(setInfo)
        .catch(() => {});
    }
  }, [saved.input, saved.wslDistro, saved.batchMode, saved.batchTarget]);

  const rows: Array<[string, string | undefined]> = info
    ? [
        ["Windows", info.windows],
        [tx(locale, "POSIX / URL Slash", "POSIX / 正斜杠"), info.posix],
        ["WSL (/mnt/...)", info.wsl],
        ["Git Bash (/c/...)", info.gitBash],
        ["file:// URI", info.fileUri],
        [tx(locale, "Java / JSON Escaped", "Java / JSON 转义路径"), info.escaped],
      ]
    : [];

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Path Converter", "文件路径格式转换")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, input: t.trim(), batchMode: t.includes("\n") }))}
          onPaste={(t) => setSaved((p) => ({ ...p, input: t.trim(), batchMode: t.includes("\n") }))}
          outputText={saved.batchMode ? batchOut : (info?.posix ?? "")}
        />
      </div>

      <div className="ts-row">
        <button
          type="button"
          className={`ts-pill ${!saved.batchMode ? "active" : ""}`}
          onClick={() => setSaved((p) => ({ ...p, batchMode: false }))}
        >
          {tx(locale, "Single Path", "单路径")}
        </button>
        <button
          type="button"
          className={`ts-pill ${saved.batchMode ? "active" : ""}`}
          onClick={() => setSaved((p) => ({ ...p, batchMode: true }))}
        >
          {tx(locale, "Batch Lines", "批量行转换")}
        </button>
        <input
          className="ts-input"
          style={{ width: 130 }}
          value={saved.wslDistro}
          onChange={(e) => setSaved((p) => ({ ...p, wslDistro: e.target.value }))}
          placeholder={tx(locale, "WSL Distro", "WSL 发行版名称")}
        />
        {saved.batchMode && (
          <select className="ts-select" style={{ width: 130 }} value={saved.batchTarget} onChange={(e) => setSaved((p) => ({ ...p, batchTarget: e.target.value }))}>
            <option value="posix">POSIX (/)</option>
            <option value="windows">Windows (\)</option>
            <option value="wsl">WSL (/mnt/)</option>
            <option value="gitBash">Git Bash</option>
            <option value="fileUri">file:// URI</option>
            <option value="escaped">{tx(locale, "Escaped (\\\\)", "双反斜杠转义 (\\\\)")}</option>
          </select>
        )}
      </div>

      {saved.batchMode ? (
        <div className="ts-split">
          <textarea className="ts-textarea mono" rows={8} value={saved.input} onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))} />
          <textarea className="ts-textarea mono" rows={8} readOnly value={batchOut} />
        </div>
      ) : (
        <div className="ts-col">
          <input
            className="ts-input mono"
            value={saved.input}
            onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))}
            placeholder={tx(locale, "C:\\Users\\... or /mnt/c/... or file:///...", "输入路径，如 C:\\Users\\...、/mnt/c/... 或 file:///...")}
          />
          {info && (
            <>
              <div className="ts-row">
                <span className="ts-badge">{tx(locale, "Root", "根目录")}: {info.root || tx(locale, "(relative)", "(相对路径)")}</span>
                <span className="ts-badge">{tx(locale, "Dir", "目录")}: {info.dir || "-"}</span>
                <span className="ts-badge">{tx(locale, "Base", "文件名")}: {info.base || "-"}</span>
                <span className="ts-badge">{tx(locale, "Stem", "主名")}: {info.stem || "-"}</span>
                <span className="ts-badge">{tx(locale, "Ext", "扩展名")}: {info.ext || "-"}</span>
              </div>
              <div className="ts-box ts-kv">
                {rows.map(([label, val]) => (
                  <div key={label} style={{ display: "contents" }}>
                    <span className="ts-kv-key">{label}</span>
                    <div className="ts-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                      <span className="ts-kv-val">{val || "-"}</span>
                      <button type="button" className="ts-btn sm" disabled={!val} onClick={() => val && copyToClipboard(val)}>
                        {tx(locale, "Copy", "复制")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
