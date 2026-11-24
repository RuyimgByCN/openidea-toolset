import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

interface DecodedJwt {
  header: unknown;
  payload: unknown;
  signature: string;
  alg: string | null;
  expStatus: string | null;
}

export default function JwtTool({ locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("jwt", {
    token: "",
    header: '{\n  "alg": "HS256",\n  "typ": "JWT"\n}',
    payload: '{\n  "sub": "1234567890",\n  "name": "Ada Lovelace",\n  "iat": 1700000000\n}',
    alg: "HS256",
    secret: "your-256-bit-secret",
  });
  const [decoded, setDecoded] = useState<DecodedJwt | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, token: initialInput.trim() }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  useEffect(() => {
    if (!bridge.isHosted || !saved.token.trim()) {
      setDecoded(null);
      return;
    }
    bridge
      .rpc<DecodedJwt>("crypto.jwtDecode", { token: saved.token })
      .then((d) => {
        setDecoded(d);
        setErr(null);
      })
      .catch((e) => {
        setDecoded(null);
        setErr((e as Error).message);
      });
  }, [saved.token]);

  const sign = async () => {
    setErr(null);
    setVerified(null);
    try {
      const res = await bridge.rpc<{ token: string }>("crypto.jwtSign", {
        header: saved.header,
        payload: saved.payload,
        alg: saved.alg,
        secret: saved.secret,
      });
      setSaved((p) => ({ ...p, token: res.token }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const verify = async () => {
    setErr(null);
    try {
      const res = await bridge.rpc<{ valid: boolean }>("crypto.jwtVerify", {
        token: saved.token,
        secret: saved.secret,
      });
      setVerified(res.valid);
    } catch (e) {
      setVerified(null);
      setErr((e as Error).message);
    }
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "JWT Inspector & Signer", "JWT 解析与签发验证")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, token: t.trim() }))}
          onPaste={(t) => setSaved((p) => ({ ...p, token: t.trim() }))}
          outputText={saved.token}
        />
      </div>

      <textarea
        className="ts-textarea mono"
        rows={3}
        value={saved.token}
        onChange={(e) => { setSaved((p) => ({ ...p, token: e.target.value })); setVerified(null); }}
        placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
      />

      <div className="ts-row">
        <select className="ts-select" style={{ width: 105 }} value={saved.alg} onChange={(e) => setSaved((p) => ({ ...p, alg: e.target.value }))}>
          <option value="HS256">HS256</option>
          <option value="HS384">HS384</option>
          <option value="HS512">HS512</option>
          <option value="RS256">RS256</option>
        </select>
        <input
          className="ts-input mono"
          style={{ flex: 1 }}
          value={saved.secret}
          onChange={(e) => setSaved((p) => ({ ...p, secret: e.target.value }))}
          placeholder={saved.alg === "RS256" ? tx(locale, "RSA PEM key", "RSA PEM 密钥") : tx(locale, "HMAC secret", "HMAC 密钥")}
        />
        <button type="button" className="ts-btn primary" onClick={sign}>{tx(locale, "Sign", "签发")}</button>
        <button type="button" className="ts-btn" onClick={verify}>{tx(locale, "Verify", "验签")}</button>
        {verified !== null && (
          <span className={`ts-badge ${verified ? "good" : "bad"}`}>
            {verified ? tx(locale, "Valid", "签名有效") : tx(locale, "Invalid", "签名无效")}
          </span>
        )}
      </div>

      {err && <div className="ts-err">{err}</div>}

      {decoded && (
        <div className="ts-box ts-col">
          <div className="ts-row">
            {decoded.alg && <span className="ts-badge">alg: {decoded.alg}</span>}
            {decoded.expStatus && <span className="ts-badge">{decoded.expStatus}</span>}
          </div>
          <div className="ts-split">
            <pre className="ts-mono" style={{ margin: 0, fontSize: 11.5 }}>{JSON.stringify(decoded.header, null, 2)}</pre>
            <pre className="ts-mono" style={{ margin: 0, fontSize: 11.5 }}>{JSON.stringify(decoded.payload, null, 2)}</pre>
          </div>
        </div>
      )}

      <div className="ts-split">
        <label className="ts-label">
          {tx(locale, "Sign Header JSON", "签发 Header")}
          <textarea className="ts-textarea mono" rows={4} value={saved.header} onChange={(e) => setSaved((p) => ({ ...p, header: e.target.value }))} />
        </label>
        <label className="ts-label">
          {tx(locale, "Sign Payload JSON", "签发 Payload")}
          <textarea className="ts-textarea mono" rows={4} value={saved.payload} onChange={(e) => setSaved((p) => ({ ...p, payload: e.target.value }))} />
        </label>
      </div>
    </div>
  );
}
