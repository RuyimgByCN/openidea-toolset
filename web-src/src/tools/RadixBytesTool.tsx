import { useEffect, useMemo, useState } from "react";
import { copyToClipboard } from "../bridge";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";
import { convertBandwidth, convertByteUnits, convertRadix } from "../utils/math";

const BYTE_UNITS = ["b", "B", "KB", "MB", "GB", "TB", "PB", "EB", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB"];
const BW_UNITS = ["bps", "Kbps", "Mbps", "Gbps", "KB/s", "MB/s", "GB/s"];

export default function RadixBytesTool({ locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("radix-bytes", {
    numInput: "255",
    fromRadix: 10,
    byteVal: "1",
    byteUnit: "GiB",
    bwVal: "100",
    bwUnit: "Mbps",
  });
  const [tab, setTab] = useState<"radix" | "bytes" | "bw">("radix");

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, numInput: initialInput.trim() }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const radixOut = useMemo(() => {
    try {
      return { ok: true as const, map: convertRadix(saved.numInput, saved.fromRadix) };
    } catch (e) {
      return { ok: false as const, err: (e as Error).message };
    }
  }, [saved.numInput, saved.fromRadix]);

  const bytesOut = useMemo(() => {
    try {
      return { ok: true as const, data: convertByteUnits(Number(saved.byteVal), saved.byteUnit) };
    } catch (e) {
      return { ok: false as const, err: (e as Error).message };
    }
  }, [saved.byteVal, saved.byteUnit]);

  const bwOut = useMemo(() => {
    try {
      return { ok: true as const, data: convertBandwidth(Number(saved.bwVal), saved.bwUnit) };
    } catch (e) {
      return { ok: false as const, err: (e as Error).message };
    }
  }, [saved.bwVal, saved.bwUnit]);

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Radix, Byte Units & Bandwidth", "进制、存储单位与带宽换算")}</span>
        <div className="ts-row">
          <button type="button" className={`ts-pill ${tab === "radix" ? "active" : ""}`} onClick={() => setTab("radix")}>
            {tx(locale, "Radix (BigInt)", "大数进制转换")}
          </button>
          <button type="button" className={`ts-pill ${tab === "bytes" ? "active" : ""}`} onClick={() => setTab("bytes")}>
            {tx(locale, "Byte Units (B..EiB)", "存储单位")}
          </button>
          <button type="button" className={`ts-pill ${tab === "bw" ? "active" : ""}`} onClick={() => setTab("bw")}>
            {tx(locale, "Throughput", "网络带宽")}
          </button>
        </div>
      </div>

      {tab === "radix" && (
        <div className="ts-col">
          <div className="ts-row">
            <select
              className="ts-select"
              style={{ width: 140 }}
              value={saved.fromRadix}
              onChange={(e) => setSaved((p) => ({ ...p, fromRadix: Number(e.target.value) }))}
            >
              <option value={2}>{tx(locale, "Base 2 (BIN)", "二进制 (Base 2)")}</option>
              <option value={8}>{tx(locale, "Base 8 (OCT)", "八进制 (Base 8)")}</option>
              <option value={10}>{tx(locale, "Base 10 (DEC)", "十进制 (Base 10)")}</option>
              <option value={16}>{tx(locale, "Base 16 (HEX)", "十六进制 (Base 16)")}</option>
              <option value={36}>{tx(locale, "Base 36", "36 进制")}</option>
            </select>
            <input
              className="ts-input mono"
              style={{ flex: 1 }}
              value={saved.numInput}
              onChange={(e) => setSaved((p) => ({ ...p, numInput: e.target.value }))}
              placeholder={tx(locale, "255 or 0xFF or 11111111", "输入 255、0xFF 或 11111111")}
            />
          </div>
          {!radixOut.ok ? (
            <div className="ts-err">{radixOut.err}</div>
          ) : (
            <div className="ts-box ts-kv">
              {[2, 8, 10, 16, 36].map((base) => (
                <div key={base} style={{ display: "contents" }}>
                  <span className="ts-kv-key">{tx(locale, `Base ${base}`, `${base} 进制`)}</span>
                  <div className="ts-row" style={{ justifyContent: "space-between" }}>
                    <span className="ts-kv-val">{radixOut.map[base]}</span>
                    <button type="button" className="ts-btn sm" onClick={() => copyToClipboard(radixOut.map[base])}>
                      {tx(locale, "Copy", "复制")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "bytes" && (
        <div className="ts-col">
          <div className="ts-row">
            <input
              type="number"
              className="ts-input mono"
              style={{ flex: 1 }}
              value={saved.byteVal}
              onChange={(e) => setSaved((p) => ({ ...p, byteVal: e.target.value }))}
            />
            <select
              className="ts-select"
              style={{ width: 110 }}
              value={saved.byteUnit}
              onChange={(e) => setSaved((p) => ({ ...p, byteUnit: e.target.value }))}
            >
              {BYTE_UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
          {!bytesOut.ok ? (
            <div className="ts-err">{bytesOut.err}</div>
          ) : (
            <div className="ts-box ts-kv">
              {Object.entries(bytesOut.data).map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <span className="ts-kv-key">{k.toUpperCase()}</span>
                  <div className="ts-row" style={{ justifyContent: "space-between" }}>
                    <span className="ts-kv-val">{v}</span>
                    <button type="button" className="ts-btn sm" onClick={() => copyToClipboard(v)}>
                      {tx(locale, "Copy", "复制")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "bw" && (
        <div className="ts-col">
          <div className="ts-row">
            <input
              type="number"
              className="ts-input mono"
              style={{ flex: 1 }}
              value={saved.bwVal}
              onChange={(e) => setSaved((p) => ({ ...p, bwVal: e.target.value }))}
            />
            <select
              className="ts-select"
              style={{ width: 110 }}
              value={saved.bwUnit}
              onChange={(e) => setSaved((p) => ({ ...p, bwUnit: e.target.value }))}
            >
              {BW_UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
          {!bwOut.ok ? (
            <div className="ts-err">{bwOut.err}</div>
          ) : (
            <div className="ts-box ts-kv">
              {Object.entries(bwOut.data).map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <span className="ts-kv-key">{k}</span>
                  <div className="ts-row" style={{ justifyContent: "space-between" }}>
                    <span className="ts-kv-val">{v}</span>
                    <button type="button" className="ts-btn sm" onClick={() => copyToClipboard(v)}>
                      {tx(locale, "Copy", "复制")}
                    </button>
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
