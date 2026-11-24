import { Fragment, useEffect, useMemo } from "react";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";
import {
  decodeProtobufHexOrBase64,
  encodeVarint,
  type ProtoDecodedField,
  zigzagDecode,
  zigzagEncode,
} from "../utils/protobufWire";

// Sample Protobuf payload:
// field #1 (varint) = 150
// field #2 (string) = "OpenIDEA"
// field #3 (nested msg) -> { #1 = 42, #2 = "gRPC" }
// field #4 (fixed32/float) = 3.5 (0x40600000)
const SAMPLE_PROTO_HEX = "08 96 01 12 08 4f 70 65 6e 49 44 45 41 1a 08 08 2a 12 04 67 52 50 43 25 00 00 60 40";

function FieldRows({ fields, depth = 0 }: { fields: ProtoDecodedField[]; depth?: number }) {
  return (
    <>
      {fields.map((f, idx) => {
        const valSummary =
          f.wireType === 0
            ? `uint64=${f.uint64} | int64=${f.int64} | sint64(ZigZag)=${f.sint64}`
            : f.wireType === 1
              ? `fixed64=${f.fixed64} | double=${f.float64}`
              : f.wireType === 5
                ? `fixed32=${f.fixed32} | float=${f.float32}`
                : f.utf8 !== undefined
                  ? `${JSON.stringify(f.utf8)}  [${f.hex}]`
                  : `bytes(${f.length})  [${f.hex}]`;
        return (
          <Fragment key={`${depth}-${f.offset}-${idx}`}>
            <tr>
              <td className="ts-mono" style={{ paddingLeft: 6 + depth * 16 }}>
                #{f.fieldNumber}
              </td>
              <td>
                <span className="ts-badge">
                  {f.wireType} ({f.wireTypeName})
                </span>
              </td>
              <td className="ts-mono" style={{ overflowWrap: "anywhere" }}>{valSummary}</td>
            </tr>
            {f.nested && <FieldRows fields={f.nested} depth={depth + 1} />}
          </Fragment>
        );
      })}
    </>
  );
}

export default function ProtobufWireTool({ tabId, locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState(`proto-${tabId}`, {
    subtab: "decode" as "decode" | "varint",
    encoding: "hex" as "hex" | "base64",
    stripGrpc: true,
    input: SAMPLE_PROTO_HEX,
    intInput: "-150",
    varintHexInput: "ac 02",
  });

  useEffect(() => {
    if (initialInput != null) {
      const t = initialInput.trim();
      const isHex = /^[0-9a-fA-F\s]+$/.test(t);
      setSaved((p) => ({
        ...p,
        subtab: "decode",
        encoding: isHex ? "hex" : "base64",
        input: t,
      }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const decoded = useMemo(
    () => decodeProtobufHexOrBase64(saved.input, saved.encoding, saved.stripGrpc),
    [saved.input, saved.encoding, saved.stripGrpc],
  );

  const varintComputed = useMemo(() => {
    try {
      const n = BigInt(saved.intInput.trim() || "0");
      const zz = zigzagEncode(n);
      return {
        rawHex: encodeVarint(n),
        zzDec: zz.toString(),
        zzHex: encodeVarint(zz),
        err: null as string | null,
      };
    } catch (e) {
      return { rawHex: "", zzDec: "", zzHex: "", err: (e as Error).message };
    }
  }, [saved.intInput]);

  const varintDecoded = useMemo(() => {
    try {
      const clean = saved.varintHexInput.replace(/0x/gi, "").replace(/[^0-9a-fA-F]/g, "");
      if (!clean || clean.length % 2 !== 0) throw new Error("Enter even hex bytes (e.g. 96 01)");
      let res = 0n;
      let shift = 0n;
      for (let i = 0; i < clean.length; i += 2) {
        const b = BigInt(parseInt(clean.slice(i, i + 2), 16));
        res |= (b & 0x7fn) << shift;
        if ((b & 0x80n) === 0n) break;
        shift += 7n;
      }
      const u64 = BigInt.asUintN(64, res);
      return {
        uint64: u64.toString(),
        int64: BigInt.asIntN(64, u64).toString(),
        sint64: zigzagDecode(u64).toString(),
        err: null as string | null,
      };
    } catch (e) {
      return { uint64: "", int64: "", sint64: "", err: (e as Error).message };
    }
  }, [saved.varintHexInput]);

  const jsonOutput = JSON.stringify(decoded.fields, null, 2);

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Protobuf Wire & Varint Decoder", "Protobuf 二进制与 Varint 解码")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, input: t }))}
          onPaste={(t) => setSaved((p) => ({ ...p, input: t }))}
          outputText={jsonOutput}
          openTabTitle="protobuf-decoded.json"
          openTabLanguage="json"
          onClear={() => setSaved((p) => ({ ...p, input: "" }))}
        />
      </div>

      <div className="ts-row">
        <button
          type="button"
          className={`ts-pill ${saved.subtab === "decode" ? "active" : ""}`}
          onClick={() => setSaved((p) => ({ ...p, subtab: "decode" }))}
        >
          {tx(locale, "Schema-less Wire Decoder", "无 .proto 帧解码")}
        </button>
        <button
          type="button"
          className={`ts-pill ${saved.subtab === "varint" ? "active" : ""}`}
          onClick={() => setSaved((p) => ({ ...p, subtab: "varint" }))}
        >
          Varint & ZigZag
        </button>
      </div>

      {saved.subtab === "decode" ? (
        <>
          <div className="ts-row">
            <button
              type="button"
              className={`ts-pill ${saved.encoding === "hex" ? "active" : ""}`}
              onClick={() => setSaved((p) => ({ ...p, encoding: "hex" }))}
            >
              Hex
            </button>
            <button
              type="button"
              className={`ts-pill ${saved.encoding === "base64" ? "active" : ""}`}
              onClick={() => setSaved((p) => ({ ...p, encoding: "base64" }))}
            >
              Base64
            </button>
            <label className="ts-inline-check">
              <input
                type="checkbox"
                checked={saved.stripGrpc}
                onChange={(e) => setSaved((p) => ({ ...p, stripGrpc: e.target.checked }))}
              />
              {tx(locale, "Strip 5-byte gRPC frame prefix", "自动剥离 5 字节 gRPC 帧头")}
            </label>
            <button
              type="button"
              className="ts-btn sm"
              onClick={() => setSaved((p) => ({ ...p, encoding: "hex", input: SAMPLE_PROTO_HEX }))}
            >
              {tx(locale, "Load Sample", "加载示例帧")}
            </button>
          </div>

          <textarea
            className="ts-textarea mono"
            rows={4}
            value={saved.input}
            onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))}
            placeholder={tx(locale, "Paste Protobuf/gRPC Hex bytes or Base64 payload...", "粘贴 Protobuf/gRPC Hex 字节或 Base64 载荷...")}
          />

          <div className="ts-row">
            <span className="ts-badge">{decoded.byteLength} B</span>
            <span className="ts-badge good">{decoded.fields.length} {tx(locale, "top fields", "个顶层字段")}</span>
            {decoded.grpcStripped && (
              <span className="ts-badge good">
                gRPC frame stripped (compressed={String(decoded.grpcCompressed)})
              </span>
            )}
          </div>

          {decoded.error && <div className="ts-err">{decoded.error}</div>}

          <div className="ts-box" style={{ maxHeight: 260, overflowY: "auto" }}>
            <table className="ts-table">
              <thead>
                <tr>
                  <th>{tx(locale, "Field", "字段号")}</th>
                  <th>Wire Type</th>
                  <th>{tx(locale, "Decoded Interpretations", "解码推演值")}</th>
                </tr>
              </thead>
              <tbody>
                <FieldRows fields={decoded.fields} />
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="ts-col">
          <div className="ts-box ts-col" style={{ gap: 6 }}>
            <span className="ts-label">{tx(locale, "Integer → Varint & ZigZag", "整数编码为 Varint / ZigZag")}</span>
            <input
              className="ts-input mono"
              value={saved.intInput}
              onChange={(e) => setSaved((p) => ({ ...p, intInput: e.target.value }))}
              placeholder="-150"
            />
            {varintComputed.err ? (
              <div className="ts-err">{varintComputed.err}</div>
            ) : (
              <table className="ts-table">
                <tbody>
                  <tr><td>{tx(locale, "Standard Varint (uint64/int64)", "标准 Varint Hex")}</td><td className="ts-mono">{varintComputed.rawHex}</td></tr>
                  <tr><td>ZigZag Unsigned Value</td><td className="ts-mono">{varintComputed.zzDec}</td></tr>
                  <tr><td>ZigZag Varint Hex (sint64)</td><td className="ts-mono">{varintComputed.zzHex}</td></tr>
                </tbody>
              </table>
            )}
          </div>

          <div className="ts-box ts-col" style={{ gap: 6 }}>
            <span className="ts-label">{tx(locale, "Varint Hex Bytes → Integer", "Varint Hex 字节解码为整数")}</span>
            <input
              className="ts-input mono"
              value={saved.varintHexInput}
              onChange={(e) => setSaved((p) => ({ ...p, varintHexInput: e.target.value }))}
              placeholder="ac 02"
            />
            {varintDecoded.err ? (
              <div className="ts-err">{varintDecoded.err}</div>
            ) : (
              <table className="ts-table">
                <tbody>
                  <tr><td>uint64</td><td className="ts-mono">{varintDecoded.uint64}</td></tr>
                  <tr><td>int64</td><td className="ts-mono">{varintDecoded.int64}</td></tr>
                  <tr><td>sint64 (ZigZag)</td><td className="ts-mono">{varintDecoded.sint64}</td></tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
