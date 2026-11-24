export interface NormalizedSig {
  canonical: string;
  name: string;
  types: string[];
}

export function normalizeSoliditySignature(raw: string): NormalizedSig {
  let s = raw.trim();
  s = s.replace(/^(?:function|event|error)\s+/i, "");
  // Strip trailing visibility/returns clause after top-level closing ')'
  const open = s.indexOf("(");
  if (open <= 0) {
    throw new Error("Signature must look like transfer(address,uint256)");
  }
  let depth = 0;
  let close = -1;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) {
    throw new Error("Unbalanced '(' in signature");
  }
  const name = s.slice(0, open).trim();
  const paramsRaw = s.slice(open + 1, close).trim();
  const types: string[] = [];

  if (paramsRaw) {
    const parts = splitTopCommas(paramsRaw);
    for (const part of parts) {
      const cleaned = normalizeParamType(part);
      if (!cleaned) throw new Error(`Invalid parameter '${part}'`);
      types.push(cleaned);
    }
  }
  return {
    canonical: `${name}(${types.join(",")})`,
    name,
    types,
  };
}

function splitTopCommas(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function normalizeParamType(raw: string): string {
  // Handle tuple `(uint256 a, address b)[]` or `uint256 indexed amount`
  const t = raw.trim();
  if (t.startsWith("(")) {
    const end = t.lastIndexOf(")");
    if (end === -1) return t;
    const inner = splitTopCommas(t.slice(1, end)).map(normalizeParamType).join(",");
    const suffix = t.slice(end + 1).trim().split(/\s+/)[0] ?? "";
    const arraySuffix = /^(\[\d*\])+/.test(suffix) ? suffix : "";
    return `(${inner})${arraySuffix}`;
  }
  const tokens = t
    .split(/\s+/)
    .filter((tok) => !["memory", "calldata", "storage", "indexed"].includes(tok));
  if (tokens.length === 0) return "";
  let ty = tokens[0];
  if (ty === "uint") ty = "uint256";
  if (ty === "int") ty = "int256";
  return ty;
}

export function encodeAbiWord(type: string, value: string): string {
  const t = type.trim();
  const v = value.trim();

  if (t === "address") {
    const clean = v.toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]{40}$/.test(clean)) {
      throw new Error(`Invalid address for '${t}': ${v}`);
    }
    return clean.padStart(64, "0");
  }

  if (t === "bool") {
    const norm = v.toLowerCase();
    if (norm === "true" || norm === "1") return "1".padStart(64, "0");
    if (norm === "false" || norm === "0") return "0".repeat(64);
    throw new Error(`Invalid bool value: ${v}`);
  }

  if (/^uint(\d+)?$/.test(t)) {
    const n = BigInt(v || "0");
    if (n < 0n || n >= 1n << 256n) {
      throw new Error(`Value out of range for ${t}: ${v}`);
    }
    return n.toString(16).padStart(64, "0");
  }

  if (/^int(\d+)?$/.test(t)) {
    let n = BigInt(v || "0");
    const min = -(1n << 255n);
    const max = (1n << 255n) - 1n;
    if (n < min || n > max) {
      throw new Error(`Signed value out of range for ${t}: ${v}`);
    }
    if (n < 0n) n = (1n << 256n) + n;
    return n.toString(16).padStart(64, "0");
  }

  const bytesMatch = /^bytes(\d+)$/.exec(t);
  if (bytesMatch) {
    const size = Number(bytesMatch[1]);
    if (size < 1 || size > 32) throw new Error(`Unsupported fixed bytes type: ${t}`);
    const clean = v.toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]*$/.test(clean) || clean.length > size * 2 || clean.length % 2 !== 0) {
      throw new Error(`Invalid ${t} hex: ${v}`);
    }
    return clean.padEnd(64, "0");
  }

  throw new Error(`Static ABI encoder supports address, bool, uint*, int*, bytes1..32 (got '${t}')`);
}

export function encodeCalldata(selectorHex: string, types: string[], values: string[]): string {
  const sel = selectorHex.toLowerCase().replace(/^0x/, "").slice(0, 8);
  if (!/^[0-9a-f]{8}$/.test(sel)) {
    throw new Error("Selector must be 4 bytes (8 hex chars)");
  }
  const words = types.map((t, idx) => encodeAbiWord(t, values[idx] ?? ""));
  return `0x${sel}${words.join("")}`;
}

export interface DecodedCalldata {
  selector: string;
  words: Array<{
    index: number;
    hex: string;
    uint256: string;
    address: string | null;
    ascii: string;
  }>;
}

export function decodeCalldataWords(hexInput: string): DecodedCalldata {
  const clean = hexInput.trim().toLowerCase().replace(/^0x/, "");
  if (!clean || clean.length < 8 || clean.length % 2 !== 0 || !/^[0-9a-f]+$/.test(clean)) {
    throw new Error("Calldata must be hex >= 4 bytes (e.g. 0xa9059cbb...)");
  }
  const selector = `0x${clean.slice(0, 8)}`;
  const body = clean.slice(8);
  const words: DecodedCalldata["words"] = [];
  for (let i = 0; i * 64 < body.length; i++) {
    const word = body.slice(i * 64, (i + 1) * 64).padEnd(64, "0");
    const uint256 = BigInt(`0x${word}`).toString(10);
    const address = /^0{24}[0-9a-f]{40}$/.test(word) ? `0x${word.slice(24)}` : null;
    let ascii = "";
    for (let j = 0; j < word.length; j += 2) {
      const b = parseInt(word.slice(j, j + 2), 16);
      if (b >= 0x20 && b <= 0x7e) ascii += String.fromCharCode(b);
      else if (b !== 0) ascii += ".";
    }
    words.push({ index: i, hex: `0x${word}`, uint256, address, ascii });
  }
  return { selector, words };
}

function formatUnitsBig(raw: bigint, decimals: number): string {
  const div = 10n ** BigInt(decimals);
  const whole = raw / div;
  const rem = raw % div;
  if (rem === 0n) return whole.toString();
  return `${whole}.${rem.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

export function formatRpcValue(method: string, result: unknown): string | null {
  if (typeof result !== "string" || !/^0x[0-9a-f]+$/i.test(result)) return null;
  const val = BigInt(result);
  if (method === "eth_getBalance") {
    return `${formatUnitsBig(val, 18)} ETH (${val.toString()} Wei)`;
  }
  if (method === "eth_gasPrice") {
    return `${formatUnitsBig(val, 9)} Gwei (${val.toString()} Wei)`;
  }
  if (["eth_blockNumber", "eth_chainId", "eth_getTransactionCount"].includes(method)) {
    return `${val.toString()} (${result})`;
  }
  return null;
}
