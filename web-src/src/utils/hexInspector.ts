export interface OffsetInspection {
  offset: number;
  byteHex: string;
  binary: string;
  octal: string;
  ascii: string;
  utf8Char: string;
  int8: number;
  uint8: number;
  int16Le: string;
  int16Be: string;
  uint16Le: string;
  uint16Be: string;
  int32Le: string;
  int32Be: string;
  uint32Le: string;
  uint32Be: string;
  int64Le: string;
  int64Be: string;
  uint64Le: string;
  uint64Be: string;
  float32Le: string;
  float32Be: string;
  float64Le: string;
  float64Be: string;
}

export function parseBytesInput(input: string, mode: "utf8" | "hex" | "base64"): Uint8Array {
  if (mode === "utf8") {
    return new TextEncoder().encode(input);
  }
  if (mode === "hex") {
    const clean = input.replace(/0x/gi, "").replace(/[^0-9a-fA-F]/g, "");
    if (clean.length % 2 !== 0) {
      throw new Error("Hex input length must be even (pairs of hex digits)");
    }
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  // base64 / base64url
  const norm = input.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!norm) return new Uint8Array(0);
  const padded = norm + "=".repeat((4 - (norm.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function formatHexDump(bytes: Uint8Array, bytesPerRow = 16): string {
  const lines: string[] = [];
  for (let off = 0; off < bytes.length; off += bytesPerRow) {
    const slice = bytes.subarray(off, off + bytesPerRow);
    const addr = off.toString(16).padStart(8, "0");
    const hexParts: string[] = [];
    for (let i = 0; i < bytesPerRow; i++) {
      if (i === 8) hexParts.push("");
      hexParts.push(i < slice.length ? slice[i].toString(16).padStart(2, "0") : "  ");
    }
    let ascii = "";
    for (let i = 0; i < slice.length; i++) {
      const b = slice[i];
      ascii += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".";
    }
    lines.push(`${addr}  ${hexParts.join(" ")}  |${ascii}|`);
  }
  return lines.join("\n");
}

function fmtFloat(v: number): string {
  if (Number.isNaN(v)) return "NaN";
  if (!Number.isFinite(v)) return v > 0 ? "+Inf" : "-Inf";
  return Number(v.toPrecision(8)).toString();
}

export function inspectOffset(bytes: Uint8Array, offset: number): OffsetInspection | null {
  if (offset < 0 || offset >= bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rem = bytes.length - offset;
  const b = bytes[offset];
  const ascii = b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "·";

  let utf8Char = "—";
  try {
    const dec = new TextDecoder("utf-8", { fatal: true });
    for (let len = 1; len <= Math.min(4, rem); len++) {
      try {
        const s = dec.decode(bytes.subarray(offset, offset + len));
        if (s) {
          utf8Char = JSON.stringify(s);
          break;
        }
      } catch {
        // Try longer multi-byte UTF-8 sequence
      }
    }
  } catch {
    utf8Char = "—";
  }

  return {
    offset,
    byteHex: b.toString(16).toUpperCase().padStart(2, "0"),
    binary: b.toString(2).padStart(8, "0"),
    octal: b.toString(8).padStart(3, "0"),
    ascii,
    utf8Char,
    int8: view.getInt8(offset),
    uint8: b,
    int16Le: rem >= 2 ? String(view.getInt16(offset, true)) : "—",
    int16Be: rem >= 2 ? String(view.getInt16(offset, false)) : "—",
    uint16Le: rem >= 2 ? String(view.getUint16(offset, true)) : "—",
    uint16Be: rem >= 2 ? String(view.getUint16(offset, false)) : "—",
    int32Le: rem >= 4 ? String(view.getInt32(offset, true)) : "—",
    int32Be: rem >= 4 ? String(view.getInt32(offset, false)) : "—",
    uint32Le: rem >= 4 ? String(view.getUint32(offset, true)) : "—",
    uint32Be: rem >= 4 ? String(view.getUint32(offset, false)) : "—",
    int64Le: rem >= 8 ? view.getBigInt64(offset, true).toString() : "—",
    int64Be: rem >= 8 ? view.getBigInt64(offset, false).toString() : "—",
    uint64Le: rem >= 8 ? view.getBigUint64(offset, true).toString() : "—",
    uint64Be: rem >= 8 ? view.getBigUint64(offset, false).toString() : "—",
    float32Le: rem >= 4 ? fmtFloat(view.getFloat32(offset, true)) : "—",
    float32Be: rem >= 4 ? fmtFloat(view.getFloat32(offset, false)) : "—",
    float64Le: rem >= 8 ? fmtFloat(view.getFloat64(offset, true)) : "—",
    float64Be: rem >= 8 ? fmtFloat(view.getFloat64(offset, false)) : "—",
  };
}

export function exportByteArray(
  bytes: Uint8Array,
  format: "dump" | "c" | "rust" | "go" | "python" | "hex" | "base64",
): string {
  if (format === "dump") return formatHexDump(bytes);
  if (format === "hex") {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
  }
  if (format === "base64") {
    const CHUNK = 0x8000;
    let bin = "";
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }
  const hexItems = Array.from(bytes, (b) => `0x${b.toString(16).padStart(2, "0")}`);
  const rows: string[] = [];
  for (let i = 0; i < hexItems.length; i += 12) {
    rows.push("  " + hexItems.slice(i, i + 12).join(", "));
  }
  if (format === "c") {
    return `const unsigned char PAYLOAD[${bytes.length}] = {\n${rows.join(",\n")}\n};`;
  }
  if (format === "rust") {
    return `const PAYLOAD: [u8; ${bytes.length}] = [\n${rows.join(",\n")}\n];`;
  }
  if (format === "go") {
    return `var payload = []byte{\n${rows.join(",\n")},\n}`;
  }
  return `payload = bytes([\n${rows.join(",\n")}\n])`;
}
