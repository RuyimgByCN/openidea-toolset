export type BarcodeFormat = "code128" | "code39" | "ean13" | "ean8" | "upca" | "itf" | "codabar";

export interface BarcodeResult {
  format: BarcodeFormat;
  value: string;
  bits: string; // '1' = black module, '0' = white module
  totalModules: number;
  guardModules?: number[]; // indices of long guard bars for EAN/UPC
}

export interface BarcodeSvgOptions {
  barWidth?: number;
  height?: number;
  margin?: number;
  showText?: boolean;
  fgColor?: string;
  bgColor?: string;
}

// ISO/IEC 15417 Code 128 patterns (values 0..105 = 11 modules each, 106 = Stop = 13 modules)
const CODE128_PATTERNS: readonly string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

function widthsToBits(widths: string): string {
  let out = "";
  for (let i = 0; i < widths.length; i++) {
    const count = Number(widths[i]);
    const ch = i % 2 === 0 ? "1" : "0";
    out += ch.repeat(count);
  }
  return out;
}

// Code 39 patterns (n=1, w=3, alternating bar/space for 9 elements)
const CODE39_MAP: Record<string, string> = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn", "4": "nnnwwnnnw",
  "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn", "9": "nnwwnnwnn",
  A: "wnnnnwnnw", B: "nnwnnwnnw", C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn",
  F: "nnwnwwnnn", G: "nnnnnwwnw", H: "wnnnnwwnn", I: "nnwnnwwnn", J: "nnnnwwwnn",
  K: "wnnnnnnww", L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww", O: "wnnnwnnwn",
  P: "nnwnwnnwn", Q: "nnnnnnwww", R: "wnnnnnwwn", S: "nnwnnnwwn", T: "nnnnwnwwn",
  U: "wwnnnnnnw", V: "nwwnnnnnw", W: "wwwnnnnnn", X: "nwnnwnnnw", Y: "wwnnwnnnn",
  Z: "nwwnwnnnn", "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", $: "nwnwnwnnn",
  "/": "nwnwnnnwn", "+": "nwnnnwnwn", "%": "nnnwnwnwn", "*": "nwnnwnwnn",
};

function code39PatternToBits(pat: string): string {
  let out = "";
  for (let i = 0; i < pat.length; i++) {
    const w = pat[i] === "w" ? 3 : 1;
    out += (i % 2 === 0 ? "1" : "0").repeat(w);
  }
  return out;
}

// EAN / UPC patterns (7 bits each)
const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const EAN_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const EAN_R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const EAN13_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

// ITF (2-of-5) digit weights (w=3, n=1)
const ITF_DIGITS = [
  "nnwwn", "wnnnw", "nwnnw", "wwnnn", "nnwnw",
  "wnwnn", "nwwnn", "nnnww", "wnnwn", "nwnwn",
];

// Codabar: widths strings of 7 elements (bar, space, bar, space, bar, space, bar), n=1, w=3
const CODABAR_MAP: Record<string, string> = {
  "0": "nnnnnww", "1": "nnnnwwn", "2": "nnnwnnw", "3": "wwnnnnn",
  "4": "nnwnnwn", "5": "wnnnnwn", "6": "nwnnnnw", "7": "nwnnwnn",
  "8": "nwwnnnn", "9": "wnnwnnn", "-": "nnnwwnn", "$": "nnwwnnn",
  ":": "wnnnwnw", "/": "wnwnnnw", ".": "wnwnwnn", "+": "nnwnwnw",
  A: "nnwwnwn", B: "nwnwnnw", C: "nnnwnww", D: "nnnwwwn",
};

export function eanCheckDigit(digitsWithoutCheck: string): number {
  let sum = 0;
  // Standard GS1 weight from right to left: rightmost digit before check has weight 3, then 1, 3, 1...
  for (let i = 0; i < digitsWithoutCheck.length; i++) {
    const d = Number(digitsWithoutCheck[digitsWithoutCheck.length - 1 - i]);
    sum += d * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function encodeBarcode(format: BarcodeFormat, rawValue: string): BarcodeResult {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    throw new Error("Input value cannot be empty");
  }

  switch (format) {
    case "code128": {
      // Code 128 Set B supports ASCII 32..126
      const values: number[] = [104]; // Start B
      let checksum = 104;
      for (let i = 0; i < rawValue.length; i++) {
        const code = rawValue.charCodeAt(i);
        if (code < 32 || code > 126) {
          throw new Error(`Code 128 Set B only supports printable ASCII (got char code ${code})`);
        }
        const v = code - 32;
        values.push(v);
        checksum += v * (i + 1);
      }
      values.push(checksum % 103);
      values.push(106); // Stop
      const bits = values.map((v) => widthsToBits(CODE128_PATTERNS[v])).join("");
      return { format, value: rawValue, bits, totalModules: bits.length };
    }

    case "code39": {
      const upper = trimmed.toUpperCase().replace(/^\*|\*$/g, "");
      if (!upper) throw new Error("Code 39 input cannot be empty");
      for (const ch of upper) {
        if (!CODE39_MAP[ch]) {
          throw new Error(`Unsupported Code 39 character: '${ch}'`);
        }
      }
      const seq = `*${upper}*`;
      const parts = Array.from(seq).map((ch) => code39PatternToBits(CODE39_MAP[ch]));
      const bits = parts.join("0");
      return { format, value: upper, bits, totalModules: bits.length };
    }

    case "ean13": {
      if (!/^\d+$/.test(trimmed)) throw new Error("EAN-13 must contain only digits");
      if (trimmed.length !== 12 && trimmed.length !== 13) {
        throw new Error("EAN-13 expects 12 digits (auto check digit) or 13 digits");
      }
      const expected = eanCheckDigit(trimmed.slice(0, 12));
      if (trimmed.length === 13 && Number(trimmed[12]) !== expected) {
        throw new Error(`Invalid EAN-13 check digit: expected ${expected}, got ${trimmed[12]}`);
      }
      const full = trimmed.slice(0, 12) + String(expected);
      const parity = EAN13_PARITY[Number(full[0])];
      let bits = "101"; // left guard: modules 0,2
      const guards: number[] = [0, 2];
      for (let i = 0; i < 6; i++) {
        const d = Number(full[i + 1]);
        bits += parity[i] === "L" ? EAN_L[d] : EAN_G[d];
      }
      const midStart = bits.length;
      bits += "01010";
      guards.push(midStart + 1, midStart + 3);
      for (let i = 7; i < 13; i++) {
        bits += EAN_R[Number(full[i])];
      }
      const rightStart = bits.length;
      bits += "101";
      guards.push(rightStart, rightStart + 2);
      return { format, value: full, bits, totalModules: bits.length, guardModules: guards };
    }

    case "ean8": {
      if (!/^\d+$/.test(trimmed)) throw new Error("EAN-8 must contain only digits");
      if (trimmed.length !== 7 && trimmed.length !== 8) {
        throw new Error("EAN-8 expects 7 digits (auto check digit) or 8 digits");
      }
      const expected = eanCheckDigit(trimmed.slice(0, 7));
      if (trimmed.length === 8 && Number(trimmed[7]) !== expected) {
        throw new Error(`Invalid EAN-8 check digit: expected ${expected}, got ${trimmed[7]}`);
      }
      const full = trimmed.slice(0, 7) + String(expected);
      let bits = "101";
      const guards: number[] = [0, 2];
      for (let i = 0; i < 4; i++) bits += EAN_L[Number(full[i])];
      const midStart = bits.length;
      bits += "01010";
      guards.push(midStart + 1, midStart + 3);
      for (let i = 4; i < 8; i++) bits += EAN_R[Number(full[i])];
      const rightStart = bits.length;
      bits += "101";
      guards.push(rightStart, rightStart + 2);
      return { format, value: full, bits, totalModules: bits.length, guardModules: guards };
    }

    case "upca": {
      if (!/^\d+$/.test(trimmed)) throw new Error("UPC-A must contain only digits");
      if (trimmed.length !== 11 && trimmed.length !== 12) {
        throw new Error("UPC-A expects 11 digits (auto check digit) or 12 digits");
      }
      const expected = eanCheckDigit(trimmed.slice(0, 11));
      if (trimmed.length === 12 && Number(trimmed[11]) !== expected) {
        throw new Error(`Invalid UPC-A check digit: expected ${expected}, got ${trimmed[11]}`);
      }
      const full = trimmed.slice(0, 11) + String(expected);
      let bits = "101";
      const guards: number[] = [0, 2];
      for (let i = 0; i < 6; i++) bits += EAN_L[Number(full[i])];
      const midStart = bits.length;
      bits += "01010";
      guards.push(midStart + 1, midStart + 3);
      for (let i = 6; i < 12; i++) bits += EAN_R[Number(full[i])];
      const rightStart = bits.length;
      bits += "101";
      guards.push(rightStart, rightStart + 2);
      return { format, value: full, bits, totalModules: bits.length, guardModules: guards };
    }

    case "itf": {
      if (!/^\d+$/.test(trimmed)) throw new Error("ITF must contain only digits");
      if (trimmed.length % 2 !== 0) {
        throw new Error("ITF (Interleaved 2 of 5) requires an even number of digits");
      }
      let bits = "1010"; // start
      for (let i = 0; i < trimmed.length; i += 2) {
        const pBar = ITF_DIGITS[Number(trimmed[i])];
        const pSpc = ITF_DIGITS[Number(trimmed[i + 1])];
        for (let k = 0; k < 5; k++) {
          bits += "1".repeat(pBar[k] === "w" ? 3 : 1);
          bits += "0".repeat(pSpc[k] === "w" ? 3 : 1);
        }
      }
      bits += "11101"; // stop
      return { format, value: trimmed, bits, totalModules: bits.length };
    }

    case "codabar": {
      let seq = trimmed.toUpperCase();
      if (!/^[A-D]/.test(seq)) seq = `A${seq}`;
      if (!/[A-D]$/.test(seq) || seq.length < 2) seq = `${seq}A`;
      for (const ch of seq) {
        if (!CODABAR_MAP[ch]) {
          throw new Error(`Unsupported Codabar character: '${ch}'`);
        }
      }
      const parts = Array.from(seq).map((ch) => code39PatternToBits(CODABAR_MAP[ch]));
      const bits = parts.join("0");
      return { format, value: seq, bits, totalModules: bits.length };
    }
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderBarcodeSvg(result: BarcodeResult, opts: BarcodeSvgOptions = {}): string {
  const barWidth = Math.max(1, opts.barWidth ?? 2);
  const height = Math.max(24, opts.height ?? 84);
  const margin = Math.max(0, opts.margin ?? 12);
  const showText = opts.showText ?? true;
  const fg = opts.fgColor ?? "#111111";
  const bg = opts.bgColor ?? "#ffffff";

  const textHeight = showText ? 22 : 0;
  const guardExtra = result.guardModules && showText ? 8 : 0;
  const totalWidth = result.totalModules * barWidth + margin * 2;
  const totalHeight = height + textHeight + margin * 2;
  const guardSet = new Set(result.guardModules || []);

  // Group contiguous 1-bits except when guard height differs
  const rects: string[] = [];
  let x = 0;
  while (x < result.bits.length) {
    if (result.bits[x] !== "1") {
      x += 1;
      continue;
    }
    const isGuard = guardSet.has(x);
    let len = 1;
    while (x + len < result.bits.length && result.bits[x + len] === "1" && guardSet.has(x + len) === isGuard) {
      len += 1;
    }
    const barH = isGuard ? height + guardExtra : height;
    rects.push(
      `<rect x="${margin + x * barWidth}" y="${margin}" width="${len * barWidth}" height="${barH}" fill="${fg}"/>`,
    );
    x += len;
  }

  const textEl = showText
    ? `<text x="${totalWidth / 2}" y="${margin + height + 17}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="14" fill="${fg}">${escapeXml(result.value)}</text>`
    : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}" shape-rendering="crispEdges">`,
    `<rect x="0" y="0" width="100%" height="100%" fill="${bg}"/>`,
    ...rects,
    textEl,
    `</svg>`,
  ].join("");
}
