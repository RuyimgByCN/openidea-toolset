import { parseBytesInput } from "./hexInspector";

export interface ProtoDecodedField {
  fieldNumber: number;
  wireType: number;
  wireTypeName: string;
  offset: number;
  length: number;
  uint64?: string;
  int64?: string;
  sint64?: string;
  fixed32?: string;
  float32?: string;
  fixed64?: string;
  float64?: string;
  utf8?: string;
  hex?: string;
  nested?: ProtoDecodedField[];
}

export interface ProtoDecodeResult {
  fields: ProtoDecodedField[];
  byteLength: number;
  grpcStripped: boolean;
  grpcCompressed?: boolean;
  error: string | null;
}

const MAX_PROTO_DEPTH = 6;
const WIRE_TYPE_NAMES: Record<number, string> = {
  0: "Varint",
  1: "64-bit",
  2: "Length-delimited",
  3: "Start group",
  4: "End group",
  5: "32-bit",
};

export function zigzagEncode(n: bigint): bigint {
  return n >= 0n ? n << 1n : ((-n) << 1n) - 1n;
}

export function zigzagDecode(n: bigint): bigint {
  return (n >> 1n) ^ -(n & 1n);
}

export function encodeVarint(n: bigint): string {
  let v = BigInt.asUintN(64, n);
  const bytes: number[] = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) b |= 0x80;
    bytes.push(b);
  } while (v !== 0n && bytes.length < 10);
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

function readVarint(bytes: Uint8Array, start: number): { val: bigint; next: number } | null {
  let result = 0n;
  let shift = 0n;
  for (let i = 0; i < 10 && start + i < bytes.length; i++) {
    const b = BigInt(bytes[start + i]);
    result |= (b & 0x7fn) << shift;
    if ((b & 0x80n) === 0n) {
      return { val: result, next: start + i + 1 };
    }
    shift += 7n;
  }
  return null;
}

function isLikelyPrintableUtf8(slice: Uint8Array): string | undefined {
  if (slice.length === 0) return "";
  try {
    const txt = new TextDecoder("utf-8", { fatal: true }).decode(slice);
    for (const ch of txt) {
      const c = ch.charCodeAt(0);
      if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) {
        return undefined;
      }
    }
    return txt;
  } catch {
    return undefined;
  }
}

export function decodeProtobufWire(bytes: Uint8Array, depth = 0): { fields: ProtoDecodedField[]; complete: boolean } {
  const fields: ProtoDecodedField[] = [];
  let pos = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  while (pos < bytes.length) {
    const start = pos;
    const tagRes = readVarint(bytes, pos);
    if (!tagRes) return { fields, complete: false };
    pos = tagRes.next;

    const tag = tagRes.val;
    const wireType = Number(tag & 0x7n);
    const fieldNumBig = tag >> 3n;
    if (fieldNumBig <= 0n || fieldNumBig > 536_870_911n) {
      return { fields, complete: false };
    }
    const fieldNumber = Number(fieldNumBig);
    const wireTypeName = WIRE_TYPE_NAMES[wireType] ?? `Wire(${wireType})`;

    if (wireType === 0) {
      const valRes = readVarint(bytes, pos);
      if (!valRes) return { fields, complete: false };
      pos = valRes.next;
      const u64 = BigInt.asUintN(64, valRes.val);
      const i64 = BigInt.asIntN(64, u64);
      const s64 = zigzagDecode(u64);
      fields.push({
        fieldNumber,
        wireType,
        wireTypeName,
        offset: start,
        length: pos - start,
        uint64: u64.toString(),
        int64: i64.toString(),
        sint64: s64.toString(),
      });
    } else if (wireType === 1) {
      if (pos + 8 > bytes.length) return { fields, complete: false };
      const u64 = view.getBigUint64(pos, true);
      const f64 = view.getFloat64(pos, true);
      pos += 8;
      fields.push({
        fieldNumber,
        wireType,
        wireTypeName,
        offset: start,
        length: pos - start,
        fixed64: u64.toString(),
        float64: Number.isFinite(f64) ? String(Number(f64.toPrecision(10))) : String(f64),
      });
    } else if (wireType === 2) {
      const lenRes = readVarint(bytes, pos);
      if (!lenRes) return { fields, complete: false };
      const len = Number(lenRes.val);
      pos = lenRes.next;
      if (len < 0 || pos + len > bytes.length) return { fields, complete: false };
      const slice = bytes.subarray(pos, pos + len);
      pos += len;
      const hex = Array.from(slice, (b) => b.toString(16).padStart(2, "0")).join(" ");
      const utf8 = isLikelyPrintableUtf8(slice);
      let nested: ProtoDecodedField[] | undefined;
      if (len >= 2 && depth < MAX_PROTO_DEPTH) {
        const sub = decodeProtobufWire(slice, depth + 1);
        if (sub.complete && sub.fields.length > 0) {
          nested = sub.fields;
        }
      }
      fields.push({
        fieldNumber,
        wireType,
        wireTypeName,
        offset: start,
        length: pos - start,
        utf8,
        hex,
        nested,
      });
    } else if (wireType === 5) {
      if (pos + 4 > bytes.length) return { fields, complete: false };
      const u32 = view.getUint32(pos, true);
      const f32 = view.getFloat32(pos, true);
      pos += 4;
      fields.push({
        fieldNumber,
        wireType,
        wireTypeName,
        offset: start,
        length: pos - start,
        fixed32: u32.toString(),
        float32: Number.isFinite(f32) ? String(Number(f32.toPrecision(7))) : String(f32),
      });
    } else {
      return { fields, complete: false };
    }
  }
  return { fields, complete: true };
}

export function decodeProtobufHexOrBase64(
  input: string,
  encoding: "hex" | "base64",
  stripGrpcFrame = true,
): ProtoDecodeResult {
  try {
    let bytes = parseBytesInput(input, encoding);
    let grpcStripped = false;
    let grpcCompressed: boolean | undefined;

    if (stripGrpcFrame && bytes.length >= 5) {
      const comp = bytes[0];
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const declaredLen = view.getUint32(1, false);
      if ((comp === 0 || comp === 1) && 5 + declaredLen === bytes.length) {
        grpcStripped = true;
        grpcCompressed = comp === 1;
        bytes = bytes.subarray(5);
      }
    }

    const res = decodeProtobufWire(bytes, 0);
    if (!res.complete) {
      return {
        fields: res.fields,
        byteLength: bytes.length,
        grpcStripped,
        grpcCompressed,
        error: "Truncated or invalid Protobuf wire payload",
      };
    }
    return {
      fields: res.fields,
      byteLength: bytes.length,
      grpcStripped,
      grpcCompressed,
      error: null,
    };
  } catch (e) {
    return { fields: [], byteLength: 0, grpcStripped: false, error: (e as Error).message };
  }
}
