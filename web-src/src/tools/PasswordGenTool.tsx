import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

interface PwdBatch {
  items: string[];
  entropyBits: number;
  strength: string;
}

export default function PasswordGenTool({ locale }: ToolProps) {
  const [saved, setSaved] = useToolState("password-gen", {
    mode: "password",
    length: 16,
    count: 6,
    upper: true,
    lower: true,
    digits: true,
    symbols: true,
    excludeAmbiguous: false,
    separator: "-",
  });
  const [batch, setBatch] = useState<PwdBatch | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const generate = async () => {
    setErr(null);
    try {
      const res = await bridge.rpc<PwdBatch>("gen.password", {
        mode: saved.mode,
        length: saved.mode === "passphrase" ? Math.min(12, Math.max(3, saved.length)) : saved.length,
        count: saved.count,
        upper: saved.upper,
        lower: saved.lower,
        digits: saved.digits,
        symbols: saved.symbols,
        excludeAmbiguous: saved.excludeAmbiguous,
        separator: saved.separator,
      });
      setBatch(res);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    if (bridge.isHosted) void generate();
  }, []);

  const output = batch?.items.join("\n") ?? "";

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Password & Secret Generator", "随机密码与密钥生成")}</span>
        <ToolActionBar locale={locale} outputText={output} />
      </div>

      <div className="ts-row">
        <select
          className="ts-select"
          style={{ width: 130 }}
          value={saved.mode}
          onChange={(e) =>
            setSaved((p) => ({
              ...p,
              mode: e.target.value,
              length: e.target.value === "passphrase" ? 4 : 16,
            }))
          }
        >
          <option value="password">{tx(locale, "Password", "随机密码")}</option>
          <option value="passphrase">{tx(locale, "Passphrase", "词组密码")}</option>
        </select>
        <label className="ts-inline-check">
          {saved.mode === "passphrase" ? tx(locale, "Words", "词数") : tx(locale, "Length", "长度")}
          <input
            type="number"
            className="ts-input mono"
            style={{ width: 68 }}
            min={saved.mode === "passphrase" ? 3 : 4}
            max={saved.mode === "passphrase" ? 12 : 128}
            value={saved.length}
            onChange={(e) => setSaved((p) => ({ ...p, length: Number(e.target.value) || 8 }))}
          />
        </label>
        <label className="ts-inline-check">
          {tx(locale, "Count", "数量")}
          <input type="number" className="ts-input mono" style={{ width: 60 }} min={1} max={50} value={saved.count} onChange={(e) => setSaved((p) => ({ ...p, count: Number(e.target.value) || 1 }))} />
        </label>
        <button type="button" className="ts-btn primary" onClick={generate}>
          {tx(locale, "Generate", "生成")}
        </button>
      </div>

      {saved.mode === "password" ? (
        <div className="ts-row">
          <label className="ts-inline-check"><input type="checkbox" checked={saved.upper} onChange={(e) => setSaved((p) => ({ ...p, upper: e.target.checked }))} /> A-Z</label>
          <label className="ts-inline-check"><input type="checkbox" checked={saved.lower} onChange={(e) => setSaved((p) => ({ ...p, lower: e.target.checked }))} /> a-z</label>
          <label className="ts-inline-check"><input type="checkbox" checked={saved.digits} onChange={(e) => setSaved((p) => ({ ...p, digits: e.target.checked }))} /> 0-9</label>
          <label className="ts-inline-check"><input type="checkbox" checked={saved.symbols} onChange={(e) => setSaved((p) => ({ ...p, symbols: e.target.checked }))} /> !@#$</label>
          <label className="ts-inline-check">
            <input type="checkbox" checked={saved.excludeAmbiguous} onChange={(e) => setSaved((p) => ({ ...p, excludeAmbiguous: e.target.checked }))} />
            {tx(locale, "No 0O1lI", "排除易混字符")}
          </label>
        </div>
      ) : (
        <div className="ts-row">
          <label className="ts-inline-check">
            {tx(locale, "Word separator", "词分隔符")}
            <input className="ts-input mono" style={{ width: 70 }} value={saved.separator} onChange={(e) => setSaved((p) => ({ ...p, separator: e.target.value }))} />
          </label>
        </div>
      )}

      {batch && (
        <div className="ts-row">
          <span className="ts-badge">{tx(locale, "Entropy", "信息熵")}: {batch.entropyBits} bits</span>
          <span className={`ts-badge ${batch.entropyBits >= 60 ? "good" : ""}`}>{batch.strength}</span>
        </div>
      )}

      {err && <div className="ts-err">{err}</div>}
      <textarea className="ts-textarea mono" rows={8} readOnly value={output} />
    </div>
  );
}
