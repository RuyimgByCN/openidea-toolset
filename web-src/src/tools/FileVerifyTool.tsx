import { useRef, useState } from "react";
import { bridge, copyToClipboard, openHostFile } from "../bridge";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

interface FileHashes {
  name: string;
  size: number;
  md5: string;
  sha1: string;
  sha224: string;
  sha256: string;
  sha384: string;
  sha512: string;
  sm3: string;
  crc32: string;
}

const MAX_FILE_BYTES = 12 * 1024 * 1024;

function encodeBase64Chunked(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

const ALGS: Array<[keyof Omit<FileHashes, "name" | "size">, string]> = [
  ["md5", "MD5"],
  ["sha1", "SHA-1"],
  ["sha224", "SHA-224"],
  ["sha256", "SHA-256"],
  ["sha384", "SHA-384"],
  ["sha512", "SHA-512"],
  ["sm3", "SM3"],
  ["crc32", "CRC32"],
];

export default function FileVerifyTool({ locale }: ToolProps) {
  const [subtab, setSubtab] = useState<"single" | "compare">("single");
  const [fileA, setFileA] = useState<FileHashes | null>(null);
  const [fileB, setFileB] = useState<FileHashes | null>(null);
  const [expected, setExpected] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRefA = useRef<HTMLInputElement>(null);
  const inputRefB = useRef<HTMLInputElement>(null);

  const hashBytes = async (name: string, bytes: Uint8Array, setter: (v: FileHashes) => void) => {
    setErr(null);
    if (bytes.byteLength > MAX_FILE_BYTES) {
      setErr(tx(locale, `File '${name}' exceeds 12 MiB limit.`, `文件 '${name}' 超过 12 MiB 限制。`));
      return;
    }
    setBusy(true);
    try {
      const dataBase64 = encodeBase64Chunked(bytes);
      const res = await bridge.rpc<Omit<FileHashes, "name">>("crypto.hashFile", { dataBase64 });
      setter({ name, ...res });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pickHost = async (target: "a" | "b") => {
    const setter = target === "a" ? setFileA : setFileB;
    const f = await openHostFile();
    if (f) {
      await hashBytes(f.name, f.data, setter);
    } else {
      (target === "a" ? inputRefA : inputRefB).current?.click();
    }
  };

  const onBrowserFile = async (file: File | undefined, target: "a" | "b") => {
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    await hashBytes(file.name, buf, target === "a" ? setFileA : setFileB);
  };

  const expectedNorm = expected.trim().toLowerCase().replace(/^sha256:|^md5:|^sha1:|^sha512:/, "");
  const matchedAlg = fileA && expectedNorm
    ? ALGS.find(([k]) => fileA[k].toLowerCase() === expectedNorm)?.[1] ?? null
    : null;

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "File Checksum & Verification", "文件校验与比对")}</span>
        <div className="ts-row">
          <button type="button" className={`ts-pill ${subtab === "single" ? "active" : ""}`} onClick={() => setSubtab("single")}>
            {tx(locale, "File Checksums", "文件摘要校验")}
          </button>
          <button type="button" className={`ts-pill ${subtab === "compare" ? "active" : ""}`} onClick={() => setSubtab("compare")}>
            {tx(locale, "Compare Two Files", "双文件比对")}
          </button>
        </div>
      </div>

      <input ref={inputRefA} type="file" hidden onChange={(e) => onBrowserFile(e.target.files?.[0], "a")} />
      <input ref={inputRefB} type="file" hidden onChange={(e) => onBrowserFile(e.target.files?.[0], "b")} />

      {err && <div className="ts-err">{err}</div>}

      {subtab === "single" ? (
        <div className="ts-col">
          <div
            className={`ts-dropzone ${dragOver ? "active" : ""}`}
            onClick={() => pickHost("a")}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              onBrowserFile(e.dataTransfer.files?.[0], "a");
            }}
          >
            {busy
              ? tx(locale, "Hashing file...", "正在计算文件摘要...")
              : fileA
                ? `${fileA.name} (${fileA.size.toLocaleString()} bytes) — ${tx(locale, "Click or drop to replace", "点击或拖拽更换文件")}`
                : tx(locale, "Click to pick a local file or drag & drop here (max 12 MiB)", "点击选择本地文件或拖拽到此区域（最大 12 MiB）")}
          </div>

          <div className="ts-row">
            <input
              className="ts-input mono"
              style={{ flex: 1 }}
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              placeholder={tx(locale, "Expected checksum (auto-matches MD5/SHA1/SHA256/SHA512/SM3/CRC32)...", "输入期望校验值（自动匹配所有算法）...")}
            />
            {expectedNorm && fileA && (
              <span className={`ts-badge ${matchedAlg ? "good" : "bad"}`}>
                {matchedAlg ? tx(locale, `MATCH (${matchedAlg})`, `匹配 (${matchedAlg})`) : tx(locale, "MISMATCH", "不匹配")}
              </span>
            )}
          </div>

          {fileA && (
            <div className="ts-box ts-kv">
              {ALGS.map(([k, label]) => (
                <div key={k} style={{ display: "contents" }}>
                  <span className="ts-kv-key">{label}</span>
                  <div className="ts-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                    <span className="ts-kv-val">{fileA[k]}</span>
                    <button type="button" className="ts-btn sm" onClick={() => copyToClipboard(fileA[k])}>
                      {tx(locale, "Copy", "复制")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="ts-col">
          <div className="ts-row">
            <button type="button" className="ts-btn primary" onClick={() => pickHost("a")}>
              {fileA ? `A: ${fileA.name}` : tx(locale, "Pick File A", "选择文件 A")}
            </button>
            <button type="button" className="ts-btn primary" onClick={() => pickHost("b")}>
              {fileB ? `B: ${fileB.name}` : tx(locale, "Pick File B", "选择文件 B")}
            </button>
            {fileA && fileB && (
              <span className={`ts-badge ${fileA.sha256 === fileB.sha256 ? "good" : "bad"}`}>
                {fileA.sha256 === fileB.sha256
                  ? tx(locale, "IDENTICAL (SHA-256 Match)", "完全一致（SHA-256 相同）")
                  : tx(locale, "DIFFERENT", "文件内容不一致")}
              </span>
            )}
          </div>
          {fileA && fileB && (
            <div className="ts-box ts-kv">
              <span className="ts-kv-key">{tx(locale, "Size A / B", "大小 A / B")}</span>
              <span className="ts-kv-val">{fileA.size} B / {fileB.size} B</span>
              <span className="ts-kv-key">SHA-256 A</span>
              <span className="ts-kv-val">{fileA.sha256}</span>
              <span className="ts-kv-key">SHA-256 B</span>
              <span className="ts-kv-val">{fileB.sha256}</span>
              <span className="ts-kv-key">MD5 A / B</span>
              <span className="ts-kv-val">{fileA.md5} / {fileB.md5}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
