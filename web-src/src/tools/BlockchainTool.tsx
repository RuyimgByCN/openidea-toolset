import { useEffect, useMemo, useState } from "react";
import { bridge, copyToClipboard } from "../bridge";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";
import { stripUrlPassword } from "../utils/urlSanitize";
import {
  decodeCalldataWords,
  encodeCalldata,
  formatRpcValue,
  normalizeSoliditySignature,
} from "../utils/evmAbi";

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

const RPC_CHAINS: Array<{ id: string; label: string; url: string; sampleMethod: string; sampleParams: string }> = [
  { id: "eth", label: "Ethereum Mainnet", url: "https://ethereum-rpc.publicnode.com", sampleMethod: "eth_blockNumber", sampleParams: "[]" },
  { id: "sepolia", label: "Ethereum Sepolia", url: "https://ethereum-sepolia-rpc.publicnode.com", sampleMethod: "eth_blockNumber", sampleParams: "[]" },
  { id: "polygon", label: "Polygon PoS", url: "https://polygon-bor-rpc.publicnode.com", sampleMethod: "eth_blockNumber", sampleParams: "[]" },
  { id: "arbitrum", label: "Arbitrum One", url: "https://arbitrum-one-rpc.publicnode.com", sampleMethod: "eth_blockNumber", sampleParams: "[]" },
  { id: "optimism", label: "Optimism", url: "https://optimism-rpc.publicnode.com", sampleMethod: "eth_blockNumber", sampleParams: "[]" },
  { id: "base", label: "Base", url: "https://base-rpc.publicnode.com", sampleMethod: "eth_blockNumber", sampleParams: "[]" },
  { id: "bsc", label: "BNB Smart Chain", url: "https://bsc-rpc.publicnode.com", sampleMethod: "eth_blockNumber", sampleParams: "[]" },
  { id: "solana", label: "Solana Mainnet", url: "https://api.mainnet-beta.solana.com", sampleMethod: "getSlot", sampleParams: "[]" },
];

const ABI_PRESETS = [
  "transfer(address,uint256)",
  "balanceOf(address)",
  "approve(address,uint256)",
  "transferFrom(address,address,uint256)",
  "Transfer(address indexed from, address indexed to, uint256 value)",
];

const RPC_METHOD_TEMPLATES: Array<{ method: string; params: string }> = [
  { method: "eth_blockNumber", params: "[]" },
  { method: "eth_gasPrice", params: "[]" },
  { method: "eth_chainId", params: "[]" },
  { method: "eth_getBalance", params: '["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "latest"]' },
  { method: "eth_getTransactionCount", params: '["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "latest"]' },
  { method: "eth_getTransactionByHash", params: '["0x..."]' },
  { method: "eth_call", params: '[{"to":"0x...","data":"0x..."}, "latest"]' },
  { method: "getSlot", params: "[]" },
  { method: "getBalance", params: '["11111111111111111111111111111111"]' },
];

export default function BlockchainTool({ locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState(
    "blockchain",
    {
      subtab: "wallet" as "wallet" | "sign" | "units" | "explorer",
      wordCount: 12,
      account: 0,
      index: 0,
      signChain: "evm",
      verifyTarget: "",
      message: "OpenIDEA Toolset Offline Signature",
      unitAsset: "ETH",
      unitVal: "1",
      unitSelected: "ETH",
      abiSig: "transfer(address,uint256)",
      abiArgs: ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "1000000000000000000"],
      calldataHex: "",
      rpcChain: "eth",
      rpcUrl: "https://ethereum-rpc.publicnode.com",
      rpcMethod: "eth_blockNumber",
      rpcParams: "[]",
    },
    (state) => ({
      ...state,
      rpcUrl: stripUrlPassword(state.rpcUrl),
    }),
  );
  // Keep sensitive wallet credentials and private keys strictly in memory; never persist them.
  const [mnemonic, setMnemonic] = useState(DEFAULT_MNEMONIC);
  const [passphrase, setPassphrase] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);
  const [privKey, setPrivKey] = useState("");
  const [signature, setSignature] = useState("");
  const [wallet, setWallet] = useState<WalletResult | null>(null);
  const [signInfo, setSignInfo] = useState<string | null>(null);
  const [verifyRes, setVerifyRes] = useState<{ valid: boolean; recoveredAddress?: string } | null>(null);
  const [abiHash, setAbiHash] = useState<{ canonical: string; selector: string; topic0: string; types: string[] } | null>(null);
  const [encodedCalldata, setEncodedCalldata] = useState("");
  const [decodedCalldata, setDecodedCalldata] = useState<ReturnType<typeof decodeCalldataWords> | null>(null);
  const [rpcBusy, setRpcBusy] = useState(false);
  const [rpcResp, setRpcResp] = useState<{ status: number; elapsedMs: number; summary: string | null; raw: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, subtab: "wallet" }));
      setMnemonic(initialInput.trim());
      onConsumeInitial?.();
    }
  }, [initialInput]);

  useEffect(() => {
    if (!bridge.isHosted || saved.subtab !== "wallet") return;
    const t = setTimeout(() => {
      bridge
        .rpc<WalletResult>("blockchain.derive", {
          mnemonic,
          passphrase,
          account: saved.account,
          index: saved.index,
        })
        .then((r) => { setWallet(r); setErr(null); })
        .catch((e) => { setWallet(null); setErr((e as Error).message); });
    }, 100);
    return () => clearTimeout(t);
  }, [saved.subtab, mnemonic, passphrase, saved.account, saved.index]);

  const genMnemonic = async () => {
    setErr(null);
    try {
      const r = await bridge.rpc<{ mnemonic: string }>("blockchain.generateMnemonic", { wordCount: saved.wordCount });
      setMnemonic(r.mnemonic);
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
        { chain: saved.signChain, privateKey: privKey, message: saved.message },
      );
      setSignature(r.signature);
      setSaved((p) => ({
        ...p,
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
        signature,
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

  useEffect(() => {
    if (!bridge.isHosted || saved.subtab !== "explorer") return;
    let cancelled = false;
    try {
      const norm = normalizeSoliditySignature(saved.abiSig);
      bridge
        .rpc<{ result: string }>("crypto.hash", {
          text: norm.canonical,
          inputEncoding: "utf8",
          alg: "keccak256",
          outputEncoding: "hex",
        })
        .then((r) => {
          if (cancelled) return;
          const hex = r.result.toLowerCase();
          setAbiHash({
            canonical: norm.canonical,
            selector: `0x${hex.slice(0, 8)}`,
            topic0: `0x${hex}`,
            types: norm.types,
          });
        })
        .catch(() => {
          if (!cancelled) setAbiHash(null);
        });
    } catch {
      setAbiHash(null);
    }
    return () => { cancelled = true; };
  }, [saved.subtab, saved.abiSig]);

  const runEncodeAbi = () => {
    setErr(null);
    if (!abiHash) return;
    try {
      const data = encodeCalldata(abiHash.selector, abiHash.types, saved.abiArgs);
      setEncodedCalldata(data);
      setSaved((p) => ({ ...p, calldataHex: data }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const runDecodeAbi = (hexInput = saved.calldataHex) => {
    setErr(null);
    try {
      setDecodedCalldata(decodeCalldataWords(hexInput));
    } catch (e) {
      setDecodedCalldata(null);
      setErr((e as Error).message);
    }
  };

  const runRpcQuery = async () => {
    setErr(null);
    setRpcBusy(true);
    try {
      const parsedParams = JSON.parse(saved.rpcParams || "[]") as unknown;
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: saved.rpcMethod.trim(),
        params: parsedParams,
      });
      const res = await bridge.rpc<{ status: number; elapsedMs: number; bodyText: string }>("http.send", {
        tabId: "blockchain-rpc",
        method: "POST",
        url: saved.rpcUrl.trim(),
        headers: [["Content-Type", "application/json"]],
        body,
        timeoutMs: 15000,
      });
      let summary: string | null = null;
      let pretty = res.bodyText;
      try {
        const parsed = JSON.parse(res.bodyText) as { result?: unknown };
        pretty = JSON.stringify(parsed, null, 2);
        summary = formatRpcValue(saved.rpcMethod.trim(), parsed.result);
      } catch {
        // Keep raw body text if non-JSON
      }
      setRpcResp({ status: res.status, elapsedMs: res.elapsedMs, summary, raw: pretty });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRpcBusy(false);
    }
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Blockchain Wallet, ABI & RPC", "区块链钱包 / ABI / RPC 调试")}</span>
        <span className="ts-badge good">{tx(locale, "Keys in memory only · RPC uses net:ask", "助记词/私钥仅存内存 · 链上 RPC 需 net:ask 授权")}</span>
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
        <button type="button" className={`ts-pill ${saved.subtab === "explorer" ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, subtab: "explorer" }))}>
          {tx(locale, "ABI & RPC Explorer", "ABI 与链上 RPC 调试")}
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
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
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
              <input type="checkbox" checked={showSecrets} onChange={(e) => setShowSecrets(e.target.checked)} />
              {tx(locale, "Reveal Keys", "显示私钥")}
            </label>
          </div>

          <textarea
            className="ts-textarea mono"
            rows={2}
            value={mnemonic}
            onChange={(e) => setMnemonic(e.target.value)}
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
                          onClick={() => {
                            setPrivKey(ch.privateKey);
                            setSaved((p) => ({
                              ...p,
                              subtab: "sign",
                              signChain: cid === "ethereum" ? "evm" : "ed25519",
                              verifyTarget: cid === "ethereum" ? ch.address : ch.publicKey,
                            }));
                          }}
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
                  {showSecrets && (
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
            value={privKey}
            onChange={(e) => setPrivKey(e.target.value)}
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
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
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

      {saved.subtab === "explorer" && (
        <div className="ts-col">
          <div className="ts-box ts-col" style={{ gap: 6 }}>
            <span className="ts-label">{tx(locale, "Offline EVM ABI Selector & Calldata", "离线 EVM ABI 选择器与 Calldata 编解码")}</span>
            <div className="ts-row">
              {ABI_PRESETS.map((sig) => (
                <button key={sig} type="button" className="ts-btn sm mono" onClick={() => setSaved((p) => ({ ...p, abiSig: sig }))}>
                  {sig.split("(")[0]}
                </button>
              ))}
            </div>
            <input
              className="ts-input mono"
              value={saved.abiSig}
              onChange={(e) => setSaved((p) => ({ ...p, abiSig: e.target.value }))}
              placeholder="function transfer(address to, uint256 amount)"
            />
            {abiHash && (
              <div className="ts-row">
                <span className="ts-badge">Canonical: {abiHash.canonical}</span>
                <button type="button" className="ts-btn sm mono" onClick={() => copyToClipboard(abiHash.selector)}>
                  Selector: {abiHash.selector}
                </button>
                <button type="button" className="ts-btn sm mono" onClick={() => copyToClipboard(abiHash.topic0)}>
                  Topic0: {abiHash.topic0.slice(0, 18)}…
                </button>
              </div>
            )}
            {abiHash && abiHash.types.length > 0 && (
              <div className="ts-col" style={{ gap: 4 }}>
                {abiHash.types.map((ty, idx) => (
                  <div key={idx} className="ts-row">
                    <span className="ts-badge ts-mono" style={{ minWidth: 82 }}>{ty}</span>
                    <input
                      className="ts-input mono"
                      style={{ flex: 1 }}
                      value={saved.abiArgs[idx] ?? ""}
                      onChange={(e) => {
                        const next = [...saved.abiArgs];
                        next[idx] = e.target.value;
                        setSaved((p) => ({ ...p, abiArgs: next }));
                      }}
                      placeholder={`${ty} #${idx + 1}`}
                    />
                  </div>
                ))}
                <div className="ts-row">
                  <button type="button" className="ts-btn primary" onClick={runEncodeAbi}>
                    {tx(locale, "Encode Calldata", "编码 Calldata")}
                  </button>
                  {encodedCalldata && (
                    <button type="button" className="ts-btn sm" onClick={() => copyToClipboard(encodedCalldata)}>
                      {tx(locale, "Copy Encoded", "复制编码结果")}
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="ts-row">
              <input
                className="ts-input mono"
                style={{ flex: 1 }}
                value={saved.calldataHex}
                onChange={(e) => setSaved((p) => ({ ...p, calldataHex: e.target.value }))}
                placeholder={tx(locale, "Paste raw 0x... calldata to decode words...", "粘贴 0x... Calldata 原始字节解码参数槽位...")}
              />
              <button type="button" className="ts-btn sm" onClick={() => runDecodeAbi()}>
                {tx(locale, "Decode Words", "解码 Calldata")}
              </button>
            </div>
            {decodedCalldata && (
              <div className="ts-col" style={{ gap: 4 }}>
                <span className="ts-badge good">Selector: {decodedCalldata.selector}</span>
                {decodedCalldata.words.map((w) => (
                  <div key={w.index} className="ts-mono" style={{ fontSize: 11, borderTop: "1px solid var(--ts-border)", paddingTop: 3 }}>
                    <strong>[{w.index}]</strong> uint256={w.uint256}
                    {w.address ? ` | addr=${w.address}` : ""}
                    {w.ascii ? ` | ascii="${w.ascii}"` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="ts-box ts-col" style={{ gap: 6 }}>
            <span className="ts-label">{tx(locale, "Live JSON-RPC API Explorer (requires opt-in net:ask)", "链上 JSON-RPC API 调试器（需可选 net:ask 域名授权）")}</span>
            <div className="ts-row">
              <select
                className="ts-select"
                style={{ width: 175 }}
                value={saved.rpcChain}
                onChange={(e) => {
                  const ch = RPC_CHAINS.find((c) => c.id === e.target.value);
                  if (ch) {
                    setSaved((p) => ({
                      ...p,
                      rpcChain: ch.id,
                      rpcUrl: ch.url,
                      rpcMethod: ch.sampleMethod,
                      rpcParams: ch.sampleParams,
                    }));
                  }
                }}
              >
                {RPC_CHAINS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <input
                className="ts-input mono"
                style={{ flex: 1 }}
                value={saved.rpcUrl}
                onChange={(e) => setSaved((p) => ({ ...p, rpcUrl: e.target.value }))}
                placeholder="https://..."
              />
            </div>
            <div className="ts-row">
              <select
                className="ts-select"
                style={{ width: 205 }}
                value={saved.rpcMethod}
                onChange={(e) => {
                  const tmpl = RPC_METHOD_TEMPLATES.find((m) => m.method === e.target.value);
                  setSaved((p) => ({
                    ...p,
                    rpcMethod: e.target.value,
                    rpcParams: tmpl ? tmpl.params : p.rpcParams,
                  }));
                }}
              >
                {RPC_METHOD_TEMPLATES.map((m) => <option key={m.method} value={m.method}>{m.method}</option>)}
              </select>
              <input
                className="ts-input mono"
                style={{ flex: 1 }}
                value={saved.rpcParams}
                onChange={(e) => setSaved((p) => ({ ...p, rpcParams: e.target.value }))}
                placeholder="[]"
              />
              <button type="button" className="ts-btn primary" disabled={rpcBusy} onClick={runRpcQuery}>
                {rpcBusy ? tx(locale, "Sending...", "请求中...") : tx(locale, "Send RPC", "发送 RPC")}
              </button>
            </div>
            {rpcResp && (
              <>
                <div className="ts-row">
                  <span className={`ts-badge ${rpcResp.status >= 200 && rpcResp.status < 300 ? "good" : "bad"}`}>
                    HTTP {rpcResp.status} · {rpcResp.elapsedMs}ms
                  </span>
                  {rpcResp.summary && <span className="ts-badge good">{rpcResp.summary}</span>}
                </div>
                <textarea className="ts-textarea mono" rows={6} readOnly value={rpcResp.raw} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
