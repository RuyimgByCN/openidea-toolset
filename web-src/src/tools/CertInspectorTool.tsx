import { useEffect, useState } from "react";
import { bridge, copyToClipboard, openHostFile } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

interface CertItem {
  kind: string;
  version?: string | number;
  serialHex?: string;
  signatureAlgorithm?: string;
  issuer?: string;
  issuerFields?: Array<[string, string]>;
  subject?: string;
  subjectFields?: Array<[string, string]>;
  notBefore?: string;
  notAfter?: string;
  isExpired?: boolean;
  daysRemaining?: number;
  publicKeyAlgorithm?: string;
  publicKeyBits?: number;
  sans?: string[];
  isCa?: boolean | null;
  sha256Fingerprint: string;
  sha1Fingerprint: string;
  derSize: number;
  derHex: string;
  derBase64: string;
  pem: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    let part = "";
    for (let j = 0; j < chunk.length; j += 1) {
      part += String.fromCharCode(chunk[j]);
    }
    binary += part;
  }
  return btoa(binary);
}

export default function CertInspectorTool({ tabId, locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState(`cert-${tabId}`, {
    input: "",
    rawTab: "pem" as "pem" | "base64" | "hex",
  });
  const [items, setItems] = useState<CertItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const inspectText = async (text: string) => {
    if (!text.trim()) {
      setItems([]);
      setErr(null);
      return;
    }
    setErr(null);
    try {
      const res = await bridge.rpc<{ items: CertItem[] }>("cert.inspect", { input: text });
      setItems(res.items || []);
    } catch (e) {
      setItems([]);
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, input: initialInput }));
      inspectText(initialInput);
      onConsumeInitial?.();
    }
  }, [initialInput]);

  useEffect(() => {
    if (saved.input.trim()) {
      inspectText(saved.input);
    }
  }, []);

  const loadSample = async () => {
    setErr(null);
    try {
      const res = await bridge.rpc<{ pem: string }>("cert.sample", {});
      setSaved((p) => ({ ...p, input: res.pem }));
      await inspectText(res.pem);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const openFile = async () => {
    try {
      const file = await openHostFile([
        { name: tx(locale, "Certificates", "证书文件"), extensions: ["pem", "crt", "cer", "der", "txt"] },
      ]);
      if (!file) return;
      const bytes = file.data;
      const content = bytes.length > 0 && bytes[0] === 0x30 ? bytesToBase64(bytes) : new TextDecoder().decode(bytes);
      setSaved((p) => ({ ...p, input: content }));
      await inspectText(content);
      setStatus(tx(locale, `Loaded ${file.name}`, `已读取 ${file.name}`));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const copyVal = async (val: string) => {
    await copyToClipboard(val);
    setStatus(tx(locale, "Copied to clipboard", "已复制到剪贴板"));
  };

  const first = items[0];
  const rawOutput = first
    ? saved.rawTab === "pem"
      ? first.pem
      : saved.rawTab === "base64"
        ? first.derBase64
        : first.derHex
    : "";

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "X.509 / PEM Certificate Inspector", "X.509 / PEM 证书解析器")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => {
            setSaved((p) => ({ ...p, input: t }));
            inspectText(t);
          }}
          onPaste={(t) => {
            setSaved((p) => ({ ...p, input: t }));
            inspectText(t);
          }}
          outputText={rawOutput || saved.input}
          openTabTitle="Certificate"
          openTabLanguage="text"
          openTabFileName="certificate.pem"
          onClear={() => {
            setSaved((p) => ({ ...p, input: "" }));
            setItems([]);
            setErr(null);
          }}
          onStatus={(m) => setStatus(m)}
        />
      </div>

      <div className="ts-row">
        <button type="button" className="ts-btn primary" onClick={() => inspectText(saved.input)}>
          {tx(locale, "Inspect", "解析证书")}
        </button>
        <button type="button" className="ts-btn" onClick={loadSample}>
          {tx(locale, "Sample Cert", "加载示例证书")}
        </button>
        <button type="button" className="ts-btn" onClick={openFile}>
          {tx(locale, "Open PEM/DER...", "打开 PEM/DER 文件...")}
        </button>
        {items.length > 0 && (
          <span className="ts-badge good">
            {tx(locale, `${items.length} certificate(s)`, `共解析 ${items.length} 张证书`)}
          </span>
        )}
      </div>

      <textarea
        className="ts-textarea mono"
        rows={6}
        value={saved.input}
        onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))}
        placeholder={tx(
          locale,
          "Paste -----BEGIN CERTIFICATE----- PEM block(s) or Base64 DER...",
          "粘贴 -----BEGIN CERTIFICATE----- PEM 证书或 Base64 编码的 DER 内容...",
        )}
      />

      {err && <div className="ts-err">{err}</div>}
      {status && <div className="ts-ok">{status}</div>}

      {items.map((cert, idx) => (
        <div key={idx} className="ts-box ts-col" style={{ gap: 8 }}>
          <div className="ts-row" style={{ justifyContent: "space-between" }}>
            <div className="ts-row">
              <span className="ts-badge">
                #{idx + 1} · {cert.kind}
                {cert.version != null ? ` v${cert.version}` : ""}
              </span>
              {cert.isExpired !== undefined && (
                <span className={`ts-badge ${cert.isExpired ? "bad" : "good"}`}>
                  {cert.isExpired
                    ? tx(locale, "Expired", "已过期")
                    : cert.daysRemaining != null
                      ? tx(locale, `Valid (${cert.daysRemaining}d left)`, `有效（剩余 ${cert.daysRemaining} 天）`)
                      : tx(locale, "Valid", "有效")}
                </span>
              )}
              {cert.isCa != null && (
                <span className="ts-badge">{cert.isCa ? tx(locale, "CA: Yes", "CA 证书: 是") : tx(locale, "CA: No", "CA 证书: 否")}</span>
              )}
            </div>
            <span className="ts-mono" style={{ fontSize: 11, color: "var(--ts-fg-muted)" }}>
              {cert.derSize} bytes
            </span>
          </div>

          <div className="ts-kv">
            {cert.subject && (
              <>
                <span className="ts-kv-key">{tx(locale, "Subject", "主体 (Subject)")}</span>
                <span className="ts-kv-val ts-mono">{cert.subject}</span>
              </>
            )}
            {cert.issuer && (
              <>
                <span className="ts-kv-key">{tx(locale, "Issuer", "颁发者 (Issuer)")}</span>
                <span className="ts-kv-val ts-mono">{cert.issuer}</span>
              </>
            )}
            {cert.serialHex && (
              <>
                <span className="ts-kv-key">{tx(locale, "Serial", "序列号")}</span>
                <span className="ts-kv-val ts-mono">{cert.serialHex}</span>
              </>
            )}
            {cert.notBefore && (
              <>
                <span className="ts-kv-key">{tx(locale, "Not Before", "生效时间")}</span>
                <span className="ts-kv-val ts-mono">{cert.notBefore}</span>
              </>
            )}
            {cert.notAfter && (
              <>
                <span className="ts-kv-key">{tx(locale, "Not After", "过期时间")}</span>
                <span className="ts-kv-val ts-mono">{cert.notAfter}</span>
              </>
            )}
            {cert.publicKeyAlgorithm && (
              <>
                <span className="ts-kv-key">{tx(locale, "Public Key", "公钥算法")}</span>
                <span className="ts-kv-val ts-mono">
                  {cert.publicKeyAlgorithm}
                  {cert.publicKeyBits ? ` (${cert.publicKeyBits} bit)` : ""}
                </span>
              </>
            )}
            {cert.signatureAlgorithm && (
              <>
                <span className="ts-kv-key">{tx(locale, "Signature Alg", "签名算法")}</span>
                <span className="ts-kv-val ts-mono">{cert.signatureAlgorithm}</span>
              </>
            )}
            <span className="ts-kv-key">SHA-256</span>
            <span className="ts-kv-val ts-mono" style={{ cursor: "pointer" }} onClick={() => copyVal(cert.sha256Fingerprint)}>
              {cert.sha256Fingerprint}
            </span>
            <span className="ts-kv-key">SHA-1</span>
            <span className="ts-kv-val ts-mono" style={{ cursor: "pointer" }} onClick={() => copyVal(cert.sha1Fingerprint)}>
              {cert.sha1Fingerprint}
            </span>
          </div>

          {cert.sans && cert.sans.length > 0 && (
            <div className="ts-col" style={{ gap: 4 }}>
              <span className="ts-label">{tx(locale, `Subject Alt Names (${cert.sans.length})`, `备用名称 SAN (${cert.sans.length})`)}</span>
              <div className="ts-row">
                {cert.sans.map((s, si) => (
                  <button key={si} type="button" className="ts-pill" onClick={() => copyVal(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {idx === 0 && (
            <div className="ts-col" style={{ gap: 4 }}>
              <div className="ts-row" style={{ justifyContent: "space-between" }}>
                <div className="ts-row">
                  {(["pem", "base64", "hex"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`ts-pill ${saved.rawTab === t ? "active" : ""}`}
                      onClick={() => setSaved((p) => ({ ...p, rawTab: t }))}
                    >
                      {t === "pem" ? "PEM" : t === "base64" ? "DER Base64" : "DER Hex"}
                    </button>
                  ))}
                </div>
                <button type="button" className="ts-btn sm" onClick={() => copyVal(rawOutput)}>
                  {tx(locale, "Copy Encoding", "复制当前编码")}
                </button>
              </div>
              <textarea className="ts-textarea mono" rows={4} readOnly value={rawOutput} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
