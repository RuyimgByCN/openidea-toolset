import { useEffect, useMemo, useState } from "react";
import { bridge, copyToClipboard } from "../bridge";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

interface ChainDerived {
  name: string;
  path: string;
  address: string;
  publicKey: string;
  privateKey: string;
  wif?: string;
}

interface WalletResult {
  valid: boolean;
  wordCount: number;
  seedHex: string;
  chains: Record<string, ChainDerived>;
}

const DEFAULT_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

function convertScaledDecimals(raw: string, factors: Array<[string, number]>): Record<string, string> {
  const s = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Enter a non-negative decimal number");
  const [intP, fracP = ""] = s.split(".");
  // Scale to max decimals using BigInt
  const maxDec = Math.max(...factors.map((f) => f[1]));
  const fracPad = (fracP + "0".repeat(maxDec)).slice(0, maxDec);
  return { raw: `${intP}${fracPad}`, ...Object.fromEntries(factors.map(([name]) => [name, ""])) };
}

function scaleUnits(valStr: string, fromExp: number, table: Array<[string, number]>): Record<string, string> {
  const s = valStr.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Invalid non-negative number");
  const [intPart, fracPart = ""] = s.split(".");
  if (fracPart.length > fromExp) throw new Error(`Too many decimal places (max ${fromExp} for selected unit)`);
  const baseBig = BigInt(intPart || "0") * 10n ** BigInt(fromExp) + BigInt((fracPart + "0".repeat(fromExp)).slice(0, fromExp));

  const out: Record<string, string> = {};
  for (const [label, exp] of table) {
    if (exp === 0) {
      out[label] = baseBig.toString();
      continue;
    }
    const div = 10n ** BigInt(exp);
    const whole = baseBig / div;
    const rem = baseBig % div;
    if (rem === 0n) {
      out[label] = whole.toString();
    } else {
      const remStr = rem.toString().padStart(exp, "0").replace(/0+$/, "");
      out[label] = `${whole}.${remStr}`;
    }
  }
  return out;
}

const UNIT_GROUPS: Record<string, Array<[string, number]>> = {
  ETH: [["Wei", 0], ["Gwei", 9], ["Finney", 15], ["ETH", 18]],
  BTC: [["Satoshi", 0], ["uBTC", 2], ["mBTC", 5], ["BTC", 8]],
  TRX: [["Sun", 0], ["TRX", 6]],
  SOL: [["Lamport", 0], ["SOL", 9]],
};

export default function BlockchainTool({ locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("blockchain", {
    subtab: "wallet" as "wallet" | "sign" | "units",
    wordCount: 12,
    mnemonic: DEFAULT_MNEMONIC,
    passphrase: "",
    account: 0,
    index: 0,
    showSecrets: false,
    signChain: "evm",
    privKey: "",
    verifyTarget: "",
    message: "OpenIDEA Toolset Offline Signature",
    signature: "",
    unitAsset: "ETH",
    unitVal: "1",
    unitSelected: "ETH",
  });
  const [wallet, setWallet] = useState<WalletResult | null>(null);
  const [signInfo, setSignInfo] = useState<string | null>(null);
  const [verifyRes, setVerifyRes] = useState<{ valid: boolean; recoveredAddress?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, subtab: "wallet", mnemonic: initialInput.trim() }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  useEffect(() => {
    if (!bridge.isHosted || saved.subtab !== "wallet") return;
    const t = setTimeout(() => {
      bridge
        .rpc<WalletResult>("blockchain.derive", {
          mnemonic: saved.mnemonic,
          passphrase: saved.passphrase,
          account: saved.account,
          index: saved.index,
        })
        .then((r) => { setWallet(r); setErr(null); })
        .catch((e) => { setWallet(null); setErr((e as Error).message); });
    }, 100);
    return () => clearTimeout(t);
  }, [saved.subtab, saved.mnemonic, saved.passphrase, saved.account, saved.index]);

  const genMnemonic = async () => {
    setErr(null);
    try {
      const r = await bridge.rpc<{ mnemonic: string }>("blockchain.generateMnemonic", { wordCount: saved.wordCount });
      setSaved((p) => ({ ...p, mnemonic: r.mnemonic }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const runSign = async () => {
    setErr(null);
    setVerifyRes(null);
    try {
      const r = await bridge.rpc<{ signature: string; signatureBase58?: string; signerAddress?: string; publicKey?: string }>(
        "blockchain.sign",
        { chain: saved.signChain, privateKey: saved.privKey, message: saved.message },
      );
      setSaved((p) => ({
        ...p,
        signature: r.signature,
        verifyTarget: r.signerAddress ?? r.publicKey ?? p.verifyTarget,
      }));
      setSignInfo(
        r.signatureBase58
          ? `Base58: ${r.signatureBase58}`
          : `${tx(locale, "Signer", "签名地址")}: ${r.signerAddress}`,
      );
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const runVerify = async () => {
    setErr(null);
    try {
      const r = await bridge.rpc<{ valid: boolean; recoveredAddress?: string }>("blockchain.verify", {
        chain: saved.signChain,
        target: saved.verifyTarget,
        message: saved.message,
        signature: saved.signature,
      });
      setVerifyRes(r);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const unitResult = useMemo(() => {
    const tbl = UNIT_GROUPS[saved.unitAsset] ?? UNIT_GROUPS.ETH;
    const found = tbl.find(([n]) => n === saved.unitSelected) ?? tbl[tbl.length - 1];
    try {
      return { ok: true as const, map: scaleUnits(saved.unitVal, found[1], tbl) };
    } catch (e) {
      return { ok: false as const, err: (e as Error).message };
    }
  }, [saved.unitAsset, saved.unitVal, saved.unitSelected]);

  void convertScaledDecimals;

  const translateUnitErr = (msg: string) => {
    if (msg === "Invalid non-negative number") {
      return tx(locale, msg, "请输入有效的非负数字");
    }
    const m = /^Too many decimal places \(max (\d+) for selected unit\)$/.exec(msg);
    if (m) {
      return tx(locale, msg, `小数位过多（所选单位最多支持 ${m[1]} 位小数）`);
    }
    return msg;
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Blockchain & HD Wallet (Offline)", "区块链与 HD 钱包 (离线)")}</span>
        <span className="ts-badge good">{tx(locale, "100% Offline · Zero Network", "纯离线 · 无网络请求")}</span>
      </div>

      <div className="ts-row">
        <button type="button" className={`ts-pill ${saved.subtab === "wallet" ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, subtab: "wallet" }))}>
          {tx(locale, "HD Wallet (BIP-39/44)", "HD 钱包派生")}
        </button>
        <button type="button" className={`ts-pill ${saved.subtab === "sign" ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, subtab: "sign" }))}>
          {tx(locale, "Sign & Verify (EIP-191 / Ed25519)", "消息签名与验签")}
        </button>
        <button type="button" className={`ts-pill ${saved.subtab === "units" ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, subtab: "units" }))}>
          {tx(locale, "Crypto Units", "代币单位换算")}
        </button>
      </div>

      {err && <div className="ts-err">{err}</div>}

      {saved.subtab === "wallet" && (
        <div className="ts-col">
          <div className="ts-row">
            <select className="ts-select" style={{ width: 105 }} value={saved.wordCount} onChange={(e) => setSaved((p) => ({ ...p, wordCount: Number(e.target.value) }))}>
              {[12, 15, 18, 21, 24].map((w) => <option key={w} value={w}>{w} {tx(locale, "words", "词")}</option>)}
            </select>
            <button type="button" className="ts-btn primary" onClick={genMnemonic}>
              {tx(locale, "Generate Mnemonic", "随机生成助记词")}
            </button>
            <input
              type="password"
              className="ts-input"
              style={{ width: 130 }}
              value={saved.passphrase}
              onChange={(e) => setSaved((p) => ({ ...p, passphrase: e.target.value }))}
              placeholder={tx(locale, "BIP39 passphrase", "可选密码短语")}
            />
            <label className="ts-row" style={{ gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--ts-fg-muted)" }}>{tx(locale, "Acct", "账户")}</span>
              <input type="number" className="ts-input mono" style={{ width: 55 }} min={0} value={saved.account} onChange={(e) => setSaved((p) => ({ ...p, account: Number(e.target.value) || 0 }))} />
            </label>
            <label className="ts-row" style={{ gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--ts-fg-muted)" }}>{tx(locale, "Idx", "索引")}</span>
              <input type="number" className="ts-input mono" style={{ width: 55 }} min={0} value={saved.index} onChange={(e) => setSaved((p) => ({ ...p, index: Number(e.target.value) || 0 }))} />
            </label>
            <label className="ts-inline-check">
              <input type="checkbox" checked={saved.showSecrets} onChange={(e) => setSaved((p) => ({ ...p, showSecrets: e.target.checked }))} />
              {tx(locale, "Reveal Keys", "显示私钥")}
            </label>
          </div>

          <textarea
            className="ts-textarea mono"
            rows={2}
            value={saved.mnemonic}
            onChange={(e) => setSaved((p) => ({ ...p, mnemonic: e.target.value }))}
            placeholder={tx(locale, "12 or 24 BIP-39 words...", "输入 12 或 24 个 BIP-39 助记词...")}
          />

          {wallet && (
            <div className="ts-col">
              {Object.entries(wallet.chains).map(([cid, ch]) => (
                <div key={cid} className="ts-box ts-col" style={{ gap: 4 }}>
                  <div className="ts-row" style={{ justifyContent: "space-between" }}>
                    <strong>{ch.name}</strong>
                    <div className="ts-row">
                      <span className="ts-badge ts-mono">{ch.path}</span>
                      {(cid === "ethereum" || cid === "solana") && (
                        <button
                          type="button"
                          className="ts-btn sm"
                          onClick={() =>
                            setSaved((p) => ({
                              ...p,
                              subtab: "sign",
                              signChain: cid === "ethereum" ? "evm" : "ed25519",
                              privKey: ch.privateKey,
                              verifyTarget: cid === "ethereum" ? ch.address : ch.publicKey,
                            }))
                          }
                        >
                          {tx(locale, "Use to Sign", "去签名")}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="ts-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                    <span className="ts-mono" style={{ fontSize: 11.5, wordBreak: "break-all" }}>{ch.address}</span>
                    <button type="button" className="ts-btn sm" onClick={() => copyToClipboard(ch.address)}>
                      {tx(locale, "Copy", "复制")}
                    </button>
                  </div>
                  {saved.showSecrets && (
                    <div className="ts-kv" style={{ fontSize: 11 }}>
                      <span className="ts-kv-key">{tx(locale, "Private Key", "私钥")}</span>
                      <span className="ts-kv-val">{ch.privateKey}{ch.wif ? ` (WIF: ${ch.wif})` : ""}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {saved.subtab === "sign" && (
        <div className="ts-col">
          <div className="ts-row">
            <select className="ts-select" style={{ width: 185 }} value={saved.signChain} onChange={(e) => setSaved((p) => ({ ...p, signChain: e.target.value }))}>
              <option value="evm">{tx(locale, "Ethereum / EVM (EIP-191)", "以太坊 / EVM (EIP-191)")}</option>
              <option value="ed25519">Solana / Sui (Ed25519)</option>
            </select>
            <button type="button" className="ts-btn primary" onClick={runSign}>{tx(locale, "Sign Message", "签名")}</button>
            <button type="button" className="ts-btn" onClick={runVerify}>{tx(locale, "Verify", "验签")}</button>
          </div>
          <input
            className="ts-input mono"
            value={saved.privKey}
            onChange={(e) => setSaved((p) => ({ ...p, privKey: e.target.value }))}
            placeholder={tx(locale, "32-byte hex private key (for signing)", "32 字节十六进制私钥（用于签名）")}
          />
          <input
            className="ts-input mono"
            value={saved.verifyTarget}
            onChange={(e) => setSaved((p) => ({ ...p, verifyTarget: e.target.value }))}
            placeholder={tx(locale, "Expected EVM address (0x...) or Ed25519 public key", "期望 EVM 地址 (0x...) 或 Ed25519 公钥")}
          />
          <textarea className="ts-textarea mono" rows={3} value={saved.message} onChange={(e) => setSaved((p) => ({ ...p, message: e.target.value }))} />
          <textarea
            className="ts-textarea mono"
            rows={2}
            value={saved.signature}
            onChange={(e) => setSaved((p) => ({ ...p, signature: e.target.value }))}
            placeholder={tx(locale, "Signature (0x... or Base58)", "签名值 (0x... 或 Base58)")}
          />
          {signInfo && <div className="ts-ok ts-mono">{signInfo}</div>}
          {verifyRes && (
            <div className={verifyRes.valid ? "ts-ok" : "ts-err"}>
              {verifyRes.valid ? tx(locale, "Signature VALID", "签名验证通过") : tx(locale, "Signature INVALID", "签名无效")}
              {verifyRes.recoveredAddress ? ` (${tx(locale, "Recovered", "恢复地址")}: ${verifyRes.recoveredAddress})` : ""}
            </div>
          )}
        </div>
      )}

      {saved.subtab === "units" && (
        <div className="ts-col">
          <div className="ts-row">
            <select
              className="ts-select"
              style={{ width: 110 }}
              value={saved.unitAsset}
              onChange={(e) => {
                const asset = e.target.value;
                const tbl = UNIT_GROUPS[asset];
                setSaved((p) => ({ ...p, unitAsset: asset, unitSelected: tbl[tbl.length - 1][0] }));
              }}
            >
              {Object.keys(UNIT_GROUPS).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <input className="ts-input mono" style={{ flex: 1 }} value={saved.unitVal} onChange={(e) => setSaved((p) => ({ ...p, unitVal: e.target.value }))} />
            <select className="ts-select" style={{ width: 115 }} value={saved.unitSelected} onChange={(e) => setSaved((p) => ({ ...p, unitSelected: e.target.value }))}>
              {(UNIT_GROUPS[saved.unitAsset] ?? []).map(([name]) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          {!unitResult.ok ? (
            <div className="ts-err">{translateUnitErr(unitResult.err)}</div>
          ) : (
            <div className="ts-box ts-kv">
              {Object.entries(unitResult.map).map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <span className="ts-kv-key">{k}</span>
                  <div className="ts-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                    <span className="ts-kv-val">{v}</span>
                    <button type="button" className="ts-btn sm" onClick={() => copyToClipboard(v)}>{tx(locale, "Copy", "复制")}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
