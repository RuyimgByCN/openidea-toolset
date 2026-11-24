import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

export default function SymmetricTool({ locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("symmetric", {
    alg: "aes-128",
    mode: "cbc",
    padding: "pkcs7",
    key: "0123456789abcdef",
    keyEncoding: "utf8",
    iv: "fedcba9876543210",
    ivEncoding: "utf8",
    inputEncoding: "utf8",
    outputEncoding: "base64",
    input: "Hello Symmetric Cipher",
  });
  const [output, setOutput] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, input: initialInput }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const run = async (encrypt: boolean) => {
    setErr(null);
    try {
      const res = await bridge.rpc<{ result: string }>("crypto.symmetric", {
        alg: saved.alg,
        mode: saved.mode,
        padding: saved.padding,
        encrypt,
        text: saved.input,
        inputEncoding: encrypt ? saved.inputEncoding : saved.outputEncoding,
        key: saved.key,
        keyEncoding: saved.keyEncoding,
        iv: saved.iv,
        ivEncoding: saved.ivEncoding,
        outputEncoding: encrypt ? saved.outputEncoding : "utf8",
      });
      setOutput(res.result);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const needsMode = !["rc4", "xor"].includes(saved.alg);
  const needsIv = needsMode && saved.mode !== "ecb";

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Symmetric Encryption", "对称加解密")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, input: t }))}
          onPaste={(t) => setSaved((p) => ({ ...p, input: t }))}
          outputText={output}
        />
      </div>

      <div className="ts-row">
        <select className="ts-select" style={{ width: 120 }} value={saved.alg} onChange={(e) => setSaved((p) => ({ ...p, alg: e.target.value }))}>
          <option value="aes-128">AES-128</option>
          <option value="aes-192">AES-192</option>
          <option value="aes-256">AES-256</option>
          <option value="sm4">{tx(locale, "SM4", "SM4 (国密)")}</option>
          <option value="des">DES</option>
          <option value="3des">3DES</option>
          <option value="rc4">RC4</option>
          <option value="xor">XOR</option>
        </select>
        {needsMode && (
          <select className="ts-select" style={{ width: 90 }} value={saved.mode} onChange={(e) => setSaved((p) => ({ ...p, mode: e.target.value }))}>
            <option value="cbc">CBC</option>
            <option value="ecb">ECB</option>
            {!["des", "3des"].includes(saved.alg) && <option value="ctr">CTR</option>}
            {["aes-128", "aes-256", "sm4"].includes(saved.alg) && <option value="gcm">GCM</option>}
          </select>
        )}
        {needsMode && (saved.mode === "cbc" || saved.mode === "ecb") && (
          <select className="ts-select" style={{ width: 115 }} value={saved.padding} onChange={(e) => setSaved((p) => ({ ...p, padding: e.target.value }))}>
            <option value="pkcs7">PKCS7</option>
            <option value="zero">ZeroPadding</option>
            <option value="nopadding">NoPadding</option>
          </select>
        )}
        <select className="ts-select" style={{ width: 120 }} value={saved.outputEncoding} onChange={(e) => setSaved((p) => ({ ...p, outputEncoding: e.target.value }))}>
          <option value="base64">{tx(locale, "Cipher: Base64", "密文: Base64")}</option>
          <option value="hex">{tx(locale, "Cipher: Hex", "密文: Hex")}</option>
        </select>
      </div>

      <div className="ts-split">
        <div className="ts-row">
          <input className="ts-input mono" style={{ flex: 1 }} value={saved.key} onChange={(e) => setSaved((p) => ({ ...p, key: e.target.value }))} placeholder={tx(locale, "Key", "密钥 (Key)")} />
          <select className="ts-select" style={{ width: 85 }} value={saved.keyEncoding} onChange={(e) => setSaved((p) => ({ ...p, keyEncoding: e.target.value }))}>
            <option value="utf8">UTF-8</option>
            <option value="hex">Hex</option>
            <option value="base64">Base64</option>
          </select>
        </div>
        {needsIv && (
          <div className="ts-row">
            <input
              className="ts-input mono"
              style={{ flex: 1 }}
              value={saved.iv}
              onChange={(e) => setSaved((p) => ({ ...p, iv: e.target.value }))}
              placeholder={
                saved.mode === "gcm"
                  ? tx(locale, "12-byte Nonce", "12 字节 Nonce")
                  : tx(locale, "IV (16B or 8B)", "初始向量 IV (16B/8B)")
              }
            />
            <select className="ts-select" style={{ width: 85 }} value={saved.ivEncoding} onChange={(e) => setSaved((p) => ({ ...p, ivEncoding: e.target.value }))}>
              <option value="utf8">UTF-8</option>
              <option value="hex">Hex</option>
              <option value="base64">Base64</option>
            </select>
          </div>
        )}
      </div>

      <div className="ts-row">
        <button type="button" className="ts-btn primary" onClick={() => run(true)}>{tx(locale, "Encrypt →", "加密 →")}</button>
        <button type="button" className="ts-btn" onClick={() => run(false)}>{tx(locale, "← Decrypt", "← 解密")}</button>
        <button type="button" className="ts-btn" onClick={() => { if (output) { setSaved((p) => ({ ...p, input: output })); setOutput(""); } }}>
          {tx(locale, "Output → Input", "结果填回输入")}
        </button>
      </div>

      <textarea className="ts-textarea mono" rows={5} value={saved.input} onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))} />
      {err && <div className="ts-err">{err}</div>}
      <textarea className="ts-textarea mono" rows={5} readOnly value={output} />
    </div>
  );
}
