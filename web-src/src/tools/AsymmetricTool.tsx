import { useState } from "react";
import { bridge } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

export default function AsymmetricTool({ locale }: ToolProps) {
  const [saved, setSaved] = useToolState("asymmetric", {
    alg: "sm2" as "rsa" | "sm2",
    rsaBits: 2048,
    rsaPadding: "oaep",
    sm2Mode: "C1C3C2",
    sm2DistId: "1234567812345678",
    encoding: "base64",
    publicKey: "",
    privateKey: "",
    input: "Secret asymmetric message",
    signature: "",
  });
  const [output, setOutput] = useState("");
  const [verifyRes, setVerifyRes] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const keygen = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (saved.alg === "rsa") {
        const res = await bridge.rpc<{ privateKey: string; publicKey: string }>("crypto.rsaKeygen", { bits: saved.rsaBits }, 30000);
        setSaved((p) => ({ ...p, privateKey: res.privateKey, publicKey: res.publicKey }));
      } else {
        const res = await bridge.rpc<{ privateKey: string; publicKey: string }>("crypto.sm2Keygen", {});
        setSaved((p) => ({ ...p, privateKey: res.privateKey, publicKey: res.publicKey }));
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runOp = async (op: "encrypt" | "decrypt" | "sign" | "verify") => {
    setErr(null);
    setVerifyRes(null);
    try {
      if (saved.alg === "rsa") {
        if (op === "encrypt") {
          const r = await bridge.rpc<{ result: string }>("crypto.rsaEncrypt", {
            publicKey: saved.publicKey,
            text: saved.input,
            padding: saved.rsaPadding,
            outputEncoding: saved.encoding,
          });
          setOutput(r.result);
        } else if (op === "decrypt") {
          const r = await bridge.rpc<{ result: string }>("crypto.rsaDecrypt", {
            privateKey: saved.privateKey,
            text: saved.input,
            inputEncoding: saved.encoding,
            padding: saved.rsaPadding,
          });
          setOutput(r.result);
        } else if (op === "sign") {
          const r = await bridge.rpc<{ result: string }>("crypto.rsaSign", {
            privateKey: saved.privateKey,
            text: saved.input,
            outputEncoding: saved.encoding,
          });
          setSaved((p) => ({ ...p, signature: r.result }));
          setOutput(r.result);
        } else {
          const r = await bridge.rpc<{ valid: boolean }>("crypto.rsaVerify", {
            publicKey: saved.publicKey,
            text: saved.input,
            signature: saved.signature,
            inputEncoding: saved.encoding,
          });
          setVerifyRes(r.valid);
        }
      } else {
        if (op === "encrypt") {
          const r = await bridge.rpc<{ result: string }>("crypto.sm2Encrypt", {
            publicKey: saved.publicKey,
            text: saved.input,
            mode: saved.sm2Mode,
            outputEncoding: saved.encoding,
          });
          setOutput(r.result);
        } else if (op === "decrypt") {
          const r = await bridge.rpc<{ result: string }>("crypto.sm2Decrypt", {
            privateKey: saved.privateKey,
            text: saved.input,
            inputEncoding: saved.encoding,
            mode: saved.sm2Mode,
          });
          setOutput(r.result);
        } else if (op === "sign") {
          const r = await bridge.rpc<{ result: string }>("crypto.sm2Sign", {
            privateKey: saved.privateKey,
            text: saved.input,
            distId: saved.sm2DistId,
            outputEncoding: saved.encoding,
          });
          setSaved((p) => ({ ...p, signature: r.result }));
          setOutput(r.result);
        } else {
          const r = await bridge.rpc<{ valid: boolean }>("crypto.sm2Verify", {
            publicKey: saved.publicKey,
            text: saved.input,
            distId: saved.sm2DistId,
            signature: saved.signature,
            inputEncoding: saved.encoding,
          });
          setVerifyRes(r.valid);
        }
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "RSA & SM2 Asymmetric", "RSA 与国密 SM2 非对称")}</span>
        <ToolActionBar locale={locale} outputText={output} />
      </div>

      <div className="ts-row">
        <select className="ts-select" style={{ width: 120 }} value={saved.alg} onChange={(e) => setSaved((p) => ({ ...p, alg: e.target.value as "rsa" | "sm2" }))}>
          <option value="sm2">{tx(locale, "SM2", "SM2 (国密)")}</option>
          <option value="rsa">RSA</option>
        </select>
        {saved.alg === "rsa" ? (
          <>
            <select className="ts-select" style={{ width: 95 }} value={saved.rsaBits} onChange={(e) => setSaved((p) => ({ ...p, rsaBits: Number(e.target.value) }))}>
              <option value={1024}>1024 bit</option>
              <option value={2048}>2048 bit</option>
            </select>
            <select className="ts-select" style={{ width: 135 }} value={saved.rsaPadding} onChange={(e) => setSaved((p) => ({ ...p, rsaPadding: e.target.value }))}>
              <option value="oaep">OAEP-SHA256</option>
              <option value="pkcs1v15">PKCS1 v1.5</option>
            </select>
          </>
        ) : (
          <>
            <select className="ts-select" style={{ width: 105 }} value={saved.sm2Mode} onChange={(e) => setSaved((p) => ({ ...p, sm2Mode: e.target.value }))}>
              <option value="C1C3C2">C1C3C2</option>
              <option value="C1C2C3">C1C2C3</option>
            </select>
            <input className="ts-input mono" style={{ width: 140 }} value={saved.sm2DistId} onChange={(e) => setSaved((p) => ({ ...p, sm2DistId: e.target.value }))} placeholder={tx(locale, "User ID", "用户标识 (User ID)")} />
          </>
        )}
        <select className="ts-select" style={{ width: 95 }} value={saved.encoding} onChange={(e) => setSaved((p) => ({ ...p, encoding: e.target.value }))}>
          <option value="base64">Base64</option>
          <option value="hex">Hex</option>
        </select>
        <button type="button" className="ts-btn primary" disabled={busy} onClick={keygen}>
          {busy ? tx(locale, "Generating...", "生成中...") : tx(locale, "Generate Keypair", "生成密钥对")}
        </button>
      </div>

      <div className="ts-split">
        <label className="ts-label">
          {tx(locale, "Public Key (PEM or SM2 Hex)", "公钥（PEM 或 SM2 Hex）")}
          <textarea className="ts-textarea mono" rows={4} value={saved.publicKey} onChange={(e) => setSaved((p) => ({ ...p, publicKey: e.target.value }))} />
        </label>
        <label className="ts-label">
          {tx(locale, "Private Key (PEM or SM2 Hex)", "私钥（PEM 或 SM2 Hex）")}
          <textarea className="ts-textarea mono" rows={4} value={saved.privateKey} onChange={(e) => setSaved((p) => ({ ...p, privateKey: e.target.value }))} />
        </label>
      </div>

      <div className="ts-row">
        <button type="button" className="ts-btn primary" onClick={() => runOp("encrypt")}>{tx(locale, "Encrypt", "公钥加密")}</button>
        <button type="button" className="ts-btn" onClick={() => runOp("decrypt")}>{tx(locale, "Decrypt", "私钥解密")}</button>
        <button type="button" className="ts-btn" onClick={() => runOp("sign")}>{tx(locale, "Sign", "私钥签名")}</button>
        <button type="button" className="ts-btn" onClick={() => runOp("verify")}>{tx(locale, "Verify", "公钥验签")}</button>
        {verifyRes !== null && (
          <span className={`ts-badge ${verifyRes ? "good" : "bad"}`}>
            {verifyRes ? tx(locale, "Signature Valid", "验签通过") : tx(locale, "Signature Invalid", "验签失败")}
          </span>
        )}
      </div>

      <textarea className="ts-textarea mono" rows={3} value={saved.input} onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))} placeholder={tx(locale, "Plaintext / Ciphertext / Message", "明文 / 密文 / 原文")} />
      <input className="ts-input mono" value={saved.signature} onChange={(e) => setSaved((p) => ({ ...p, signature: e.target.value }))} placeholder={tx(locale, "Signature (for Verify)", "签名串（验签用）")} />
      {err && <div className="ts-err">{err}</div>}
      <textarea className="ts-textarea mono" rows={4} readOnly value={output} />
    </div>
  );
}
