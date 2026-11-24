export type ConfigFmt = "env" | "properties" | "yaml" | "json";

export interface ConfigDiffRow {
  key: string;
  status: "added" | "removed" | "changed" | "same";
  left: string;
  right: string;
  sensitive: boolean;
}

const SENSITIVE_KEY_RE =
  /pass(word)?|secret|token|api[_.-]?key|private[_.-]?key|pwd|credential|auth|dsn|jdbc|jwt|signing/i;

export function isSensitiveConfigKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key);
}

export function propKeyToEnvKey(key: string): string {
  return key
    .trim()
    .replace(/[-.[\]]+/g, "_")
    .replace(/_+$/, "")
    .replace(/^_+/, "")
    .toUpperCase();
}

export function envKeyToPropKey(key: string): string {
  return key.trim().toLowerCase().replace(/_+/g, ".");
}

function unquoteScalar(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}

function stripTrailingComment(s: string): string {
  let q: "'" | '"' | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === "\\" && q === '"') {
        i++;
        continue;
      }
      if (ch === q) q = null;
    } else if (ch === "'" || ch === '"') {
      q = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i).trimEnd();
    }
  }
  return s;
}

export function parseEnvToFlat(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of raw.replace(/\r\n/g, "\n").split("\n")) {
    let t = rawLine.trim();
    if (!t || t.startsWith("#")) continue;
    if (t.startsWith("export ")) t = t.slice(7).trimStart();
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    const v = unquoteScalar(stripTrailingComment(t.slice(eq + 1)));
    out[k] = v;
  }
  return out;
}

export function parsePropertiesToFlat(raw: string): Record<string, string> {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const logical: string[] = [];
  let buf = "";
  for (const line of lines) {
    const trimmedStart = line.trimStart();
    if (!buf && (!trimmedStart || trimmedStart.startsWith("#") || trimmedStart.startsWith("!"))) {
      continue;
    }
    if (line.endsWith("\\") && !line.endsWith("\\\\")) {
      buf += line.slice(0, -1);
    } else {
      buf += trimmedStart;
      logical.push(buf);
      buf = "";
    }
  }
  if (buf) logical.push(buf);

  const out: Record<string, string> = {};
  for (const entry of logical) {
    let sep = -1;
    for (let i = 0; i < entry.length; i++) {
      const ch = entry[i];
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === "=" || ch === ":") {
        sep = i;
        break;
      }
    }
    if (sep <= 0) continue;
    const k = entry.slice(0, sep).trim();
    const v = entry
      .slice(sep + 1)
      .trimStart()
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\:/g, ":")
      .replace(/\\=/g, "=")
      .replace(/\\\\/g, "\\");
    out[k] = v;
  }
  return out;
}

function flattenObject(val: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (val === null || val === undefined) {
    if (prefix) out[prefix] = "";
    return out;
  }
  if (Array.isArray(val)) {
    val.forEach((item, idx) => {
      flattenObject(item, prefix ? `${prefix}[${idx}]` : `[${idx}]`, out);
    });
    return out;
  }
  if (typeof val === "object") {
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (k === "__proto__" || k === "constructor") continue;
      const next = prefix ? `${prefix}.${k}` : k;
      flattenObject(v, next, out);
    }
    return out;
  }
  if (prefix) out[prefix] = String(val);
  return out;
}

export function parseYamlToFlat(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const stack: Array<{ indent: number; key: string }> = [];
  const listCounts = new Map<string, number>();

  for (const rawLine of raw.replace(/\r\n/g, "\n").split("\n")) {
    const clean = stripTrailingComment(rawLine);
    if (!clean.trim() || clean.trim() === "---" || clean.trim() === "...") continue;
    const indent = clean.length - clean.trimStart().length;
    const content = clean.trim();

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (content.startsWith("- ")) {
      const parentPath = stack.map((s) => s.key).join(".");
      const idx = listCounts.get(parentPath) ?? 0;
      listCounts.set(parentPath, idx + 1);
      const val = unquoteScalar(content.slice(2));
      out[parentPath ? `${parentPath}[${idx}]` : `[${idx}]`] = val;
      continue;
    }

    const colon = content.indexOf(":");
    if (colon <= 0) continue;
    const key = unquoteScalar(content.slice(0, colon));
    const rest = content.slice(colon + 1).trim();
    const fullKey = [...stack.map((s) => s.key), key].join(".");
    if (!rest) {
      stack.push({ indent, key });
    } else if (rest.startsWith("[") && rest.endsWith("]")) {
      const inner = rest.slice(1, -1).trim();
      if (!inner) {
        out[fullKey] = "[]";
      } else {
        inner.split(",").forEach((item, idx) => {
          out[`${fullKey}[${idx}]`] = unquoteScalar(item);
        });
      }
    } else {
      out[fullKey] = unquoteScalar(rest);
    }
  }
  return out;
}

export function parseConfigToFlat(raw: string, fmt: ConfigFmt): Record<string, string> {
  if (fmt === "env") return parseEnvToFlat(raw);
  if (fmt === "properties") return parsePropertiesToFlat(raw);
  if (fmt === "yaml") return parseYamlToFlat(raw);
  const parsed = JSON.parse(raw) as unknown;
  return flattenObject(parsed);
}

function unflattenToObject(flat: Record<string, string>): Record<string, unknown> {
  const root: Record<string, unknown> = Object.create(null);
  for (const [fullKey, val] of Object.entries(flat)) {
    const segs = fullKey.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
    if (segs.length === 0) continue;
    let cur: Record<string, unknown> | unknown[] = root;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (seg === "__proto__" || seg === "constructor" || seg === "prototype") break;
      const isLast = i + 1 === segs.length;
      if (isLast) {
        if (Array.isArray(cur)) cur[Number(seg)] = inferScalar(val);
        else cur[seg] = inferScalar(val);
      } else {
        const nextIsIdx = /^\d+$/.test(segs[i + 1]);
        if (Array.isArray(cur)) {
          const idx = Number(seg);
          if (!cur[idx] || typeof cur[idx] !== "object") {
            cur[idx] = nextIsIdx ? [] : {};
          }
          cur = cur[idx] as Record<string, unknown> | unknown[];
        } else {
          if (!cur[seg] || typeof cur[seg] !== "object") {
            cur[seg] = nextIsIdx ? [] : {};
          }
          cur = cur[seg] as Record<string, unknown> | unknown[];
        }
      }
    }
  }
  return JSON.parse(JSON.stringify(root)) as Record<string, unknown>;
}

function inferScalar(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw) && Math.abs(Number(raw)) <= Number.MAX_SAFE_INTEGER) return Number(raw);
  return raw;
}

function formatYamlNode(val: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(val)) {
    return val
      .map((item) =>
        typeof item === "object" && item !== null
          ? `${pad}-\n${formatYamlNode(item, indent + 1)}`
          : `${pad}- ${formatYamlScalar(item)}`,
      )
      .join("\n");
  }
  if (val && typeof val === "object") {
    return Object.entries(val as Record<string, unknown>)
      .map(([k, v]) => {
        if (v && typeof v === "object") {
          return `${pad}${k}:\n${formatYamlNode(v, indent + 1)}`;
        }
        return `${pad}${k}: ${formatYamlScalar(v)}`;
      })
      .join("\n");
  }
  return `${pad}${formatYamlScalar(val)}`;
}

function formatYamlScalar(v: unknown): string {
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  const s = String(v ?? "");
  if (!s || /[:#\[\]{}&*!|>'",]|^\s|\s$/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

export function serializeFlatConfig(flat: Record<string, string>, to: ConfigFmt): string {
  const entries = Object.entries(flat);
  if (to === "env") {
    return entries
      .map(([k, v]) => {
        const key = propKeyToEnvKey(k);
        const val = /[\s#"']/.test(v) ? JSON.stringify(v) : v;
        return `${key}=${val}`;
      })
      .join("\n");
  }
  if (to === "properties") {
    return entries.map(([k, v]) => `${k}=${v.replace(/\n/g, "\\n")}`).join("\n");
  }
  const tree = unflattenToObject(flat);
  if (to === "json") {
    return JSON.stringify(tree, null, 2);
  }
  return formatYamlNode(tree, 0);
}

export function convertConfig(
  input: string,
  from: ConfigFmt,
  to: ConfigFmt,
): { output: string; count: number; error: string | null } {
  try {
    const flat = parseConfigToFlat(input, from);
    return {
      output: serializeFlatConfig(flat, to),
      count: Object.keys(flat).length,
      error: null,
    };
  } catch (e) {
    return { output: "", count: 0, error: (e as Error).message };
  }
}

export function diffConfigs(
  leftRaw: string,
  leftFmt: ConfigFmt,
  rightRaw: string,
  rightFmt: ConfigFmt,
  maskSecrets = true,
): {
  summary: { added: number; removed: number; changed: number; same: number };
  rows: ConfigDiffRow[];
  error: string | null;
} {
  try {
    const leftMap = parseConfigToFlat(leftRaw, leftFmt);
    const rightMap = parseConfigToFlat(rightRaw, rightFmt);
    // Normalize ENV keys if comparing env vs dotted format
    const normalizeMap = (m: Record<string, string>, fmt: ConfigFmt, otherFmt: ConfigFmt) => {
      if (fmt === "env" && otherFmt !== "env") {
        const mapped: Record<string, string> = {};
        for (const [k, v] of Object.entries(m)) mapped[envKeyToPropKey(k)] = v;
        return mapped;
      }
      return m;
    };
    const normL = normalizeMap(leftMap, leftFmt, rightFmt);
    const normR = normalizeMap(rightMap, rightFmt, leftFmt);

    const allKeys = Array.from(new Set([...Object.keys(normL), ...Object.keys(normR)])).sort();
    const summary = { added: 0, removed: 0, changed: 0, same: 0 };
    const rows: ConfigDiffRow[] = allKeys.map((key) => {
      const hasL = key in normL;
      const hasR = key in normR;
      const sens = isSensitiveConfigKey(key);
      const mask = (v: string) => (maskSecrets && sens && v ? "••••••" : v);

      if (!hasL && hasR) {
        summary.added++;
        return { key, status: "added", left: "", right: mask(normR[key]), sensitive: sens };
      }
      if (hasL && !hasR) {
        summary.removed++;
        return { key, status: "removed", left: mask(normL[key]), right: "", sensitive: sens };
      }
      if (normL[key] !== normR[key]) {
        summary.changed++;
        return { key, status: "changed", left: mask(normL[key]), right: mask(normR[key]), sensitive: sens };
      }
      summary.same++;
      return { key, status: "same", left: mask(normL[key]), right: mask(normR[key]), sensitive: sens };
    });
    return { summary, rows, error: null };
  } catch (e) {
    return { summary: { added: 0, removed: 0, changed: 0, same: 0 }, rows: [], error: (e as Error).message };
  }
}
