import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { bridge, copyToClipboard } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

interface TotpResult {
  code: string;
  prevCode: string;
  nextCode: string;
  period: number;
  remaining: number;
  counter: number;
  epoch: number;
  digits: number;
  algorithm: string;
  secretHex: string;
  secretBase64: string;
}

export default function TotpTool({ tabId, locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState(`totp-${tabId}`, {
    kind: "totp" as "totp" | "hotp",
    issuer: "OpenIDEA",
    account: "dev@openidea.local",
    secret: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA1" as "SHA1" | "SHA256" | "SHA512",
    digits: 6 as 6 | 8,
    period: 30,
    counter: 0,
    keyBytes: 20,
    uriInput: "",
  });

  const [totpRes, setTotpRes] = useState<TotpResult | null>(null);
  const [hotpCode, setHotpCode] = useState<string>("");
  const [builtUri, setBuiltUri] = useState<string>("");
  const [qrUrl, setQrUrl] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (initialInput != null) {
      const s = initialInput.trim();
      if (s.toLowerCase().startsWith("otpauth://")) {
        setSaved((p) => ({ ...p, uriInput: s }));
        parseUri(s);
      } else if (s) {
        setSaved((p) => ({ ...p, secret: s }));
      }
      onConsumeInitial?.();
    }
  }, [initialInput]);

  useEffect(() => {
    if (saved.kind !== "totp") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [saved.kind]);

  useEffect(() => {
    let active = true;
    const secret = saved.secret.trim();
    if (!secret) {
      setTotpRes(null);
      setHotpCode("");
      return;
    }
    const run = async () => {
      try {
        if (saved.kind === "totp") {
          const res = await bridge.rpc<TotpResult>("totp.generate", {
            secret,
            period: saved.period,
            digits: saved.digits,
            algorithm: saved.algorithm,
          });
          if (active) {
            setTotpRes(res);
            setErr(null);
          }
        } else {
          const res = await bridge.rpc<{ code: string }>("totp.hotp", {
            secret,
            counter: saved.counter,
            digits: saved.digits,
            algorithm: saved.algorithm,
          });
          if (active) {
            setHotpCode(res.code);
            setErr(null);
          }
        }
      } catch (e) {
        if (active) setErr((e as Error).message);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [saved.kind, saved.secret, saved.period, saved.digits, saved.algorithm, saved.counter, tick]);

  useEffect(() => {
    let active = true;
    const secret = saved.secret.trim();
    if (!secret) {
      setBuiltUri("");
      setQrUrl("");
      return;
    }
    bridge
      .rpc<{ uri: string }>("totp.buildUri", {
        kind: saved.kind,
        issuer: saved.issuer,
        account: saved.account,
        secret,
        algorithm: saved.algorithm,
        digits: saved.digits,
        period: saved.period,
        counter: saved.counter,
      })
      .then(async (res) => {
        if (!active) return;
        setBuiltUri(res.uri);
        try {
          const pngUrl = await QRCode.toDataURL(res.uri, { width: 176, margin: 1 });
          if (active) setQrUrl(pngUrl);
        } catch {
          if (active) setQrUrl("");
        }
      })
      .catch(() => {
        if (active) {
          setBuiltUri("");
          setQrUrl("");
        }
      });
    return () => {
      active = false;
    };
  }, [saved.kind, saved.issuer, saved.account, saved.secret, saved.algorithm, saved.digits, saved.period, saved.counter]);

  const generateNewSecret = async () => {
    setErr(null);
    try {
      const res = await bridge.rpc<{ secret: string }>("totp.newSecret", { bytes: saved.keyBytes });
      setSaved((p) => ({ ...p, secret: res.secret }));
      setStatus(tx(locale, "Generated new Base32 secret", "已生成新 Base32 密钥"));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const parseUri = async (rawUri = saved.uriInput) => {
    setErr(null);
    try {
      const res = await bridge.rpc<{
        kind: "totp" | "hotp";
        issuer: string;
        account: string;
        secret: string;
        algorithm: "SHA1" | "SHA256" | "SHA512";
        digits: number;
        period: number;
        counter: number;
      }>("totp.parseUri", { uri: rawUri });
      setSaved((p) => ({
        ...p,
        kind: res.kind === "hotp" ? "hotp" : "totp",
        issuer: res.issuer || p.issuer,
        account: res.account || p.account,
        secret: res.secret,
        algorithm: res.algorithm === "SHA256" || res.algorithm === "SHA512" ? res.algorithm : "SHA1",
        digits: res.digits === 8 ? 8 : 6,
        period: res.period || 30,
        counter: res.counter || 0,
      }));
      setStatus(tx(locale, "Parsed otpauth:// URI", "已解析 otpauth:// 链接"));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const copyCode = async (code: string) => {
    if (!code) return;
    await copyToClipboard(code);
    setStatus(tx(locale, `Copied ${code}`, `已复制 ${code}`));
  };

  const currentCode = saved.kind === "totp" ? totpRes?.code || "------" : hotpCode || "------";
  const progressPct =
    saved.kind === "totp" && totpRes
      ? Math.max(0, Math.min(100, Math.round((totpRes.remaining / Math.max(1, totpRes.period)) * 100)))
      : 0;

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "TOTP / HOTP 2FA & Base32", "TOTP / HOTP 两步验证")}</span>
        <ToolActionBar
          locale={locale}
          onPaste={(t) => {
            if (t.trim().toLowerCase().startsWith("otpauth://")) {
              setSaved((p) => ({ ...p, uriInput: t.trim() }));
              parseUri(t.trim());
            } else {
              setSaved((p) => ({ ...p, secret: t.trim() }));
            }
          }}
          outputText={builtUri || currentCode}
          openTabTitle="otpauth"
          openTabLanguage="text"
          openTabFileName="otpauth.txt"
          onStatus={(m) => setStatus(m)}
        />
      </div>

      <div className="ts-row">
        <button
          type="button"
          className={`ts-pill ${saved.kind === "totp" ? "active" : ""}`}
          onClick={() => setSaved((p) => ({ ...p, kind: "totp" }))}
        >
          {tx(locale, "TOTP (Time-based)", "TOTP（基于时间）")}
        </button>
        <button
          type="button"
          className={`ts-pill ${saved.kind === "hotp" ? "active" : ""}`}
          onClick={() => setSaved((p) => ({ ...p, kind: "hotp" }))}
        >
          {tx(locale, "HOTP (Counter-based)", "HOTP（基于计数器）")}
        </button>
        <select
          className="ts-select"
          value={saved.algorithm}
          onChange={(e) => setSaved((p) => ({ ...p, algorithm: e.target.value as "SHA1" | "SHA256" | "SHA512" }))}
        >
          <option value="SHA1">HMAC-SHA1</option>
          <option value="SHA256">HMAC-SHA256</option>
          <option value="SHA512">HMAC-SHA512</option>
        </select>
        <select
          className="ts-select"
          value={saved.digits}
          onChange={(e) => setSaved((p) => ({ ...p, digits: Number(e.target.value) === 8 ? 8 : 6 }))}
        >
          <option value={6}>{tx(locale, "6 digits", "6 位")}</option>
          <option value={8}>{tx(locale, "8 digits", "8 位")}</option>
        </select>
        {saved.kind === "totp" ? (
          <div className="ts-row">
            <span className="ts-label">{tx(locale, "Period(s)", "周期(秒)")}</span>
            <input
              type="number"
              min={5}
              max={300}
              className="ts-input mono"
              style={{ width: 68 }}
              value={saved.period}
              onChange={(e) => setSaved((p) => ({ ...p, period: Math.max(5, Number(e.target.value) || 30) }))}
            />
          </div>
        ) : (
          <div className="ts-row">
            <span className="ts-label">{tx(locale, "Counter", "计数")}</span>
            <input
              type="number"
              min={0}
              className="ts-input mono"
              style={{ width: 90 }}
              value={saved.counter}
              onChange={(e) => setSaved((p) => ({ ...p, counter: Math.max(0, Number(e.target.value) || 0) }))}
            />
            <button
              type="button"
              className="ts-btn sm"
              onClick={() => setSaved((p) => ({ ...p, counter: p.counter + 1 }))}
            >
              +1
            </button>
          </div>
        )}
      </div>

      <div className="ts-split">
        <div className="ts-box ts-col" style={{ gap: 8 }}>
          <span className="ts-label">{tx(locale, "Current One-Time Password", "当前动态口令（点击复制）")}</span>
          <button
            type="button"
            className="ts-btn primary"
            style={{ fontSize: 28, letterSpacing: 4, padding: "10px 14px", fontFamily: "ui-monospace, monospace" }}
            onClick={() => copyCode(currentCode)}
          >
            {currentCode}
          </button>

          {saved.kind === "totp" && totpRes && (
            <>
              <div
                style={{
                  height: 6,
                  borderRadius: 3,
                  background: "var(--ts-border)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${progressPct}%`,
                    height: "100%",
                    background: totpRes.remaining <= 5 ? "var(--ts-danger, #e5484d)" : "var(--ts-accent, #3574f0)",
                    transition: "width 0.3s linear",
                  }}
                />
              </div>
              <div className="ts-row" style={{ justifyContent: "space-between" }}>
                <span className="ts-label">
                  {tx(locale, `Expires in ${totpRes.remaining}s`, `剩余 ${totpRes.remaining} 秒刷新`)}
                </span>
                <span className="ts-mono" style={{ fontSize: 11, color: "var(--ts-fg-muted)" }}>
                  {tx(locale, `Step #${totpRes.counter}`, `步进 #${totpRes.counter}`)}
                </span>
              </div>
              <div className="ts-row" style={{ justifyContent: "space-between" }}>
                <button type="button" className="ts-btn sm" onClick={() => copyCode(totpRes.prevCode)}>
                  {tx(locale, `Prev: ${totpRes.prevCode}`, `上一个: ${totpRes.prevCode}`)}
                </button>
                <button type="button" className="ts-btn sm" onClick={() => copyCode(totpRes.nextCode)}>
                  {tx(locale, `Next: ${totpRes.nextCode}`, `下一个: ${totpRes.nextCode}`)}
                </button>
              </div>
            </>
          )}

          {totpRes && (
            <div className="ts-col" style={{ gap: 2, fontSize: 11 }}>
              <span className="ts-label">Hex / Base64:</span>
              <span className="ts-mono" style={{ wordBreak: "break-all" }}>
                {totpRes.secretHex}
              </span>
              <span className="ts-mono" style={{ wordBreak: "break-all", color: "var(--ts-fg-muted)" }}>
                {totpRes.secretBase64}
              </span>
            </div>
          )}
        </div>

        <div className="ts-box ts-col" style={{ alignItems: "center", justifyContent: "center", gap: 8 }}>
          <span className="ts-label">{tx(locale, "Authenticator QR Code", "验证器扫码绑定")}</span>
          {qrUrl ? (
            <img
              src={qrUrl}
              alt="otpauth QR"
              style={{ width: 168, height: 168, background: "#fff", padding: 4, borderRadius: 4 }}
            />
          ) : (
            <span style={{ color: "var(--ts-fg-muted)" }}>{tx(locale, "Enter valid Base32 secret", "请输入有效 Base32 密钥")}</span>
          )}
          {builtUri && (
            <button
              type="button"
              className="ts-btn sm"
              onClick={async () => {
                await copyToClipboard(builtUri);
                setStatus(tx(locale, "Copied otpauth:// URI", "已复制 otpauth:// 链接"));
              }}
            >
              {tx(locale, "Copy otpauth:// URI", "复制 otpauth:// 链接")}
            </button>
          )}
        </div>
      </div>

      <div className="ts-box ts-col" style={{ gap: 6 }}>
        <div className="ts-row">
          <span className="ts-label" style={{ width: 88 }}>
            {tx(locale, "Base32 Secret", "Base32 密钥")}
          </span>
          <input
            className="ts-input mono"
            style={{ flex: 1 }}
            value={saved.secret}
            onChange={(e) => setSaved((p) => ({ ...p, secret: e.target.value }))}
            placeholder="JBSWY3DPEHPK3PXP"
          />
          <select
            className="ts-select"
            value={saved.keyBytes}
            onChange={(e) => setSaved((p) => ({ ...p, keyBytes: Number(e.target.value) || 20 }))}
          >
            <option value={16}>{tx(locale, "128-bit", "128 位")}</option>
            <option value={20}>{tx(locale, "160-bit", "160 位")}</option>
            <option value={32}>{tx(locale, "256-bit", "256 位")}</option>
          </select>
          <button type="button" className="ts-btn" onClick={generateNewSecret}>
            {tx(locale, "Random Secret", "随机密钥")}
          </button>
        </div>

        <div className="ts-row">
          <span className="ts-label" style={{ width: 88 }}>
            {tx(locale, "Issuer / Label", "签发方 / 账号")}
          </span>
          <input
            className="ts-input"
            style={{ flex: 1 }}
            value={saved.issuer}
            onChange={(e) => setSaved((p) => ({ ...p, issuer: e.target.value }))}
            placeholder={tx(locale, "Issuer (e.g. GitHub)", "签发方（如 GitHub）")}
          />
          <input
            className="ts-input"
            style={{ flex: 1 }}
            value={saved.account}
            onChange={(e) => setSaved((p) => ({ ...p, account: e.target.value }))}
            placeholder={tx(locale, "Account email/name", "账户名或邮箱")}
          />
        </div>

        <div className="ts-row">
          <span className="ts-label" style={{ width: 88 }}>
            otpauth://
          </span>
          <input
            className="ts-input mono"
            style={{ flex: 1 }}
            value={saved.uriInput}
            onChange={(e) => setSaved((p) => ({ ...p, uriInput: e.target.value }))}
            placeholder="otpauth://totp/OpenIDEA:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=OpenIDEA"
          />
          <button type="button" className="ts-btn" onClick={() => parseUri()}>
            {tx(locale, "Parse URI", "解析导入")}
          </button>
        </div>
      </div>

      {err && <div className="ts-err">{err}</div>}
      {status && <div className="ts-ok">{status}</div>}
    </div>
  );
}
