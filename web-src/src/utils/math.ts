const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

export function parseBigIntRadix(raw: string, radix: number): bigint {
  if (!Number.isInteger(radix) || radix < 2 || radix > 36) {
    throw new Error("Radix must be between 2 and 36");
  }
  let s = raw.trim().replaceAll("_", "");
  if (!s) throw new Error("Empty number");
  let neg = false;
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (radix === 16 && (s.startsWith("0x") || s.startsWith("0X"))) s = s.slice(2);
  if (radix === 2 && (s.startsWith("0b") || s.startsWith("0B"))) s = s.slice(2);
  if (radix === 8 && (s.startsWith("0o") || s.startsWith("0O"))) s = s.slice(2);
  if (!s) throw new Error("Invalid number");

  const base = BigInt(radix);
  let acc = 0n;
  for (const ch of s.toLowerCase()) {
    const idx = DIGITS.indexOf(ch);
    if (idx < 0 || idx >= radix) {
      throw new Error(`Invalid digit '${ch}' for base ${radix}`);
    }
    acc = acc * base + BigInt(idx);
  }
  return neg ? -acc : acc;
}

export function convertRadix(raw: string, fromRadix: number): Record<number, string> {
  const value = parseBigIntRadix(raw, fromRadix);
  return {
    2: value.toString(2),
    8: value.toString(8),
    10: value.toString(10),
    16: value.toString(16).toUpperCase(),
    36: value.toString(36).toUpperCase(),
  };
}

export interface ByteUnitsResult {
  bits: string;
  bytes: string;
  kb: string;
  mb: string;
  gb: string;
  tb: string;
  pb: string;
  eb: string;
  kib: string;
  mib: string;
  gib: string;
  tib: string;
  pib: string;
  eib: string;
}

const UNIT_FACTORS: Record<string, number> = {
  b: 0.125,
  B: 1,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
  PB: 1e15,
  EB: 1e18,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
  PiB: 1024 ** 5,
  EiB: 1024 ** 6,
};

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return "0";
  if (Number.isInteger(v) && Math.abs(v) < 1e16) return v.toString();
  return Number(v.toPrecision(10)).toString();
}

export function convertByteUnits(amount: number, unit: string): ByteUnitsResult {
  const factor = UNIT_FACTORS[unit];
  if (!factor) throw new Error(`Unknown byte unit ${unit}`);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Value must be non-negative");
  const bytes = amount * factor;
  return {
    bits: fmtNum(bytes * 8),
    bytes: fmtNum(bytes),
    kb: fmtNum(bytes / 1e3),
    mb: fmtNum(bytes / 1e6),
    gb: fmtNum(bytes / 1e9),
    tb: fmtNum(bytes / 1e12),
    pb: fmtNum(bytes / 1e15),
    eb: fmtNum(bytes / 1e18),
    kib: fmtNum(bytes / 1024),
    mib: fmtNum(bytes / 1024 ** 2),
    gib: fmtNum(bytes / 1024 ** 3),
    tib: fmtNum(bytes / 1024 ** 4),
    pib: fmtNum(bytes / 1024 ** 5),
    eib: fmtNum(bytes / 1024 ** 6),
  };
}

const BANDWIDTH_BPS: Record<string, number> = {
  bps: 1,
  Kbps: 1e3,
  Mbps: 1e6,
  Gbps: 1e9,
  "KB/s": 8e3,
  "MB/s": 8e6,
  "GB/s": 8e9,
};

export function convertBandwidth(amount: number, unit: string): Record<string, string> {
  const factor = BANDWIDTH_BPS[unit];
  if (!factor) throw new Error(`Unknown bandwidth unit ${unit}`);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Value must be non-negative");
  const bps = amount * factor;
  return {
    bps: fmtNum(bps),
    Kbps: fmtNum(bps / 1e3),
    Mbps: fmtNum(bps / 1e6),
    Gbps: fmtNum(bps / 1e9),
    "KB/s": fmtNum(bps / 8e3),
    "MB/s": fmtNum(bps / 8e6),
    "GB/s": fmtNum(bps / 8e9),
    "1 GiB transfer": bps > 0 ? `${fmtNum((1024 ** 3 * 8) / bps)} s` : "∞",
  };
}

export interface DiffLine {
  kind: "same" | "add" | "del";
  leftNo: number | null;
  rightNo: number | null;
  text: string;
}

export function computeLineDiff(leftText: string, rightText: string): { lines: DiffLine[]; added: number; removed: number } {
  const a = leftText === "" ? [] : leftText.split("\n");
  const b = rightText === "" ? [] : rightText.split("\n");
  const m = a.length;
  const n = b.length;
  // Cap DP table for huge inputs to stay fast in UI thread (native open-diff handles arbitrary sizes).
  if (m * n > 400_000) {
    const out: DiffLine[] = [
      ...a.map((text, idx) => ({ kind: "del" as const, leftNo: idx + 1, rightNo: null, text })),
      ...b.map((text, idx) => ({ kind: "add" as const, leftNo: null, rightNo: idx + 1, text })),
    ];
    return { lines: out, added: b.length, removed: a.length };
  }
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", leftNo: i + 1, rightNo: j + 1, text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", leftNo: i + 1, rightNo: null, text: a[i] });
      removed++;
      i++;
    } else {
      out.push({ kind: "add", leftNo: null, rightNo: j + 1, text: b[j] });
      added++;
      j++;
    }
  }
  while (i < m) {
    out.push({ kind: "del", leftNo: i + 1, rightNo: null, text: a[i] });
    removed++;
    i++;
  }
  while (j < n) {
    out.push({ kind: "add", leftNo: null, rightNo: j + 1, text: b[j] });
    added++;
    j++;
  }
  return { lines: out, added, removed };
}
