import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

interface IpResult {
  version: number;
  ip: string;
  integer: string;
  hex: string;
  binary: string;
  expanded: string;
  compressed: string;
  cidr: {
    prefix: number;
    network: string;
    broadcast: string;
    netmask: string;
    wildcard: string;
    firstHost: string;
    lastHost: string;
    totalAddresses: string;
    usableHosts: string;
  } | null;
}

export default function IpCidrTool({ locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("ip-cidr", { input: "192.168.1.42/24" });
  const [res, setRes] = useState<IpResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved({ input: initialInput.trim() });
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const run = async (val?: string) => {
    setErr(null);
    try {
      const r = await bridge.rpc<IpResult>("convert.ipCidr", { input: val ?? saved.input });
      setRes(r);
    } catch (e) {
      setErr((e as Error).message);
      setRes(null);
    }
  };

  useEffect(() => {
    if (bridge.isHosted) void run();
  }, []);

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "IP & CIDR Calculator", "IP 与 CIDR 子网计算")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => { const s = t.trim(); setSaved({ input: s }); void run(s); }}
          onPaste={(t) => { const s = t.trim(); setSaved({ input: s }); void run(s); }}
          outputText={res ? JSON.stringify(res, null, 2) : undefined}
        />
      </div>

      <div className="ts-row">
        <input
          className="ts-input mono"
          style={{ flex: 1 }}
          value={saved.input}
          onChange={(e) => setSaved({ input: e.target.value })}
          placeholder="192.168.1.0/24, 3232235777, 0xC0A80101, 2001:db8::/64"
        />
        <button type="button" className="ts-btn primary" onClick={() => run()}>
          {tx(locale, "Calculate", "计算")}
        </button>
      </div>

      {err && <div className="ts-err">{err}</div>}
      {res && (
        <div className="ts-col">
          <div className="ts-box ts-kv">
            <span className="ts-kv-key">IP (v{res.version})</span>
            <span className="ts-kv-val">{res.ip}</span>
            <span className="ts-kv-key">{tx(locale, "Integer", "整数")}</span>
            <span className="ts-kv-val">{res.integer}</span>
            <span className="ts-kv-key">Hex</span>
            <span className="ts-kv-val">{res.hex}</span>
            <span className="ts-kv-key">{tx(locale, "Binary", "二进制")}</span>
            <span className="ts-kv-val">{res.binary}</span>
            {res.version === 6 && (
              <>
                <span className="ts-kv-key">{tx(locale, "Expanded", "完整展开")}</span>
                <span className="ts-kv-val">{res.expanded}</span>
                <span className="ts-kv-key">{tx(locale, "Compressed", "压缩")}</span>
                <span className="ts-kv-val">{res.compressed}</span>
              </>
            )}
          </div>
          {res.cidr && (
            <div className="ts-box ts-kv">
              <span className="ts-kv-key">{tx(locale, "Network", "网络地址")}</span>
              <span className="ts-kv-val">{res.cidr.network}/{res.cidr.prefix}</span>
              <span className="ts-kv-key">{tx(locale, "Netmask", "子网掩码")}</span>
              <span className="ts-kv-val">{res.cidr.netmask}</span>
              <span className="ts-kv-key">{tx(locale, "Wildcard", "通配符掩码")}</span>
              <span className="ts-kv-val">{res.cidr.wildcard}</span>
              <span className="ts-kv-key">{tx(locale, "Broadcast", "广播地址")}</span>
              <span className="ts-kv-val">{res.cidr.broadcast}</span>
              <span className="ts-kv-key">{tx(locale, "Host Range", "可用范围")}</span>
              <span className="ts-kv-val">{res.cidr.firstHost} ~ {res.cidr.lastHost}</span>
              <span className="ts-kv-key">{tx(locale, "Usable / Total", "可用 / 总数")}</span>
              <span className="ts-kv-val">{res.cidr.usableHosts} / {res.cidr.totalAddresses}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
