export type ConfigFmt = "env" | "properties" | "yaml" | "json";

export type ConfigValue =
  | null
  | boolean
  | number
  | string
  | ConfigValue[]
  | { [key: string]: ConfigValue };

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

function unescapeDoubleQuoted(inner: string): string {
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    i++;
    if (i >= inner.length) throw new Error("Trailing backslash in double-quoted string");
    const esc = inner[i];
    switch (esc) {
      case "n":
        out += "\n";
        break;
      case "r":
        out += "\r";
        break;
      case "t":
        out += "\t";
        break;
      case "b":
        out += "\b";
        break;
      case "f":
        out += "\f";
        break;
      case '"':
        out += '"';
        break;
      case "\\":
        out += "\\";
        break;
      case "/":
        out += "/";
        break;
      case "0":
        out += "\0";
        break;
      case "u": {
        const hex = inner.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error(`Invalid \\u escape: \\u${hex}`);
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 4;
        break;
      }
      case "x": {
        const hex = inner.slice(i + 1, i + 3);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new Error(`Invalid \\x escape: \\x${hex}`);
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 2;
        break;
      }
      default:
        out += esc;
    }
  }
  return out;
}

function parseQuotedSpan(s: string): { value: string; rest: string } {
  const q = s[0];
  if (q === '"') {
    for (let i = 1; i < s.length; i++) {
      if (s[i] === "\\") {
        i++;
        continue;
      }
      if (s[i] === '"') {
        return {
          value: unescapeDoubleQuoted(s.slice(1, i)),
          rest: s.slice(i + 1),
        };
      }
    }
    throw new Error("Unterminated double-quoted YAML scalar");
  }
  for (let i = 1; i < s.length; i++) {
    if (s[i] === "'") {
      if (s[i + 1] === "'") {
        i++;
        continue;
      }
      return {
        value: s.slice(1, i).replace(/''/g, "'"),
        rest: s.slice(i + 1),
      };
    }
  }
  throw new Error("Unterminated single-quoted YAML scalar");
}

function stripTrailingComment(s: string): string {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (quote === '"' && ch === "\\") {
        i++;
        continue;
      }
      if (quote === "'" && ch === "'" && s[i + 1] === "'") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i).trimEnd();
    }
  }
  return s;
}

function findUnquotedMappingColon(s: string): number {
  let quote: "'" | '"' | null = null;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (quote === '"' && ch === "\\") {
        i++;
        continue;
      }
      if (quote === "'" && ch === "'" && s[i + 1] === "'") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (ch === "{") braceDepth++;
    else if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (ch === ":" && bracketDepth === 0 && braceDepth === 0) {
      if (i + 1 === s.length || /\s/.test(s[i + 1])) return i;
    }
  }
  return -1;
}

function rejectUnsupportedYamlIndicator(token: string, context: string): void {
  const t = token.trim();
  if (!t) return;
  if (t.startsWith("&") || t.startsWith("*")) {
    throw new Error(`Unsupported YAML anchor/alias (${t}) near ${context}`);
  }
  if (t.startsWith("!")) {
    throw new Error(`Unsupported YAML explicit tag (${t}) near ${context}`);
  }
  if (t.startsWith("@") || t.startsWith("`")) {
    throw new Error(`Invalid reserved YAML indicator in ${context}: ${t}`);
  }
}

function findMatchingFlowEnd(s: string, openCh: "[" | "{", closeCh: "]" | "}"): number {
  let quote: "'" | '"' | null = null;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (quote === '"' && ch === "\\") {
        i++;
        continue;
      }
      if (quote === "'" && ch === "'" && s[i + 1] === "'") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevelFlow(inner: string): string[] {
  const parts: string[] = [];
  let quote: "'" | '"' | null = null;
  let bracket = 0;
  let brace = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      if (quote === '"' && ch === "\\") {
        i++;
        continue;
      }
      if (quote === "'" && ch === "'" && inner[i + 1] === "'") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === "[") {
      bracket++;
    } else if (ch === "]") {
      bracket--;
      if (bracket < 0) throw new Error("Unmatched ']' in YAML flow collection");
    } else if (ch === "{") {
      brace++;
    } else if (ch === "}") {
      brace--;
      if (brace < 0) throw new Error("Unmatched '}' in YAML flow collection");
    } else if (ch === "," && bracket === 0 && brace === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  if (quote || bracket !== 0 || brace !== 0) {
    throw new Error("Unterminated YAML flow collection");
  }
  parts.push(inner.slice(start));
  return parts;
}

function parseYamlNumberOrString(t: string): ConfigValue {
  if (/^(null|Null|NULL|~)$/.test(t)) return null;
  if (/^(true|True|TRUE)$/.test(t)) return true;
  if (/^(false|False|FALSE)$/.test(t)) return false;
  if (/^-?(0|[1-9][0-9]*)$/.test(t)) {
    const n = Number(t);
    if (Number.isSafeInteger(n)) return n;
    return t;
  }
  if (/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(t) && (t.includes(".") || /[eE]/.test(t))) {
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return t;
}

function parseYamlInlineValue(raw: string, lineNo: number): ConfigValue {
  const t = raw.trim();
  if (!t) return null;

  if (t[0] === '"' || t[0] === "'") {
    const { value, rest } = parseQuotedSpan(t);
    if (rest.trim().length > 0) {
      throw new Error(`Unexpected trailing characters after quoted string at line ${lineNo}: ${rest.trim()}`);
    }
    return value;
  }

  rejectUnsupportedYamlIndicator(t, `line ${lineNo}`);

  if (t.startsWith("[")) {
    const end = findMatchingFlowEnd(t, "[", "]");
    if (end < 0) throw new Error(`Unterminated YAML flow sequence at line ${lineNo}`);
    if (t.slice(end + 1).trim().length > 0) {
      throw new Error(`Unexpected content after flow sequence at line ${lineNo}`);
    }
    const inner = t.slice(1, end).trim();
    if (!inner) return [];
    const items = splitTopLevelFlow(inner);
    if (items.length > 0 && !items[items.length - 1].trim()) items.pop();
    return items.map((part) => {
      if (!part.trim()) throw new Error(`Empty element in YAML flow sequence at line ${lineNo}`);
      return parseYamlInlineValue(part, lineNo);
    });
  }

  if (t.startsWith("{")) {
    const end = findMatchingFlowEnd(t, "{", "}");
    if (end < 0) throw new Error(`Unterminated YAML flow mapping at line ${lineNo}`);
    if (t.slice(end + 1).trim().length > 0) {
      throw new Error(`Unexpected content after flow mapping at line ${lineNo}`);
    }
    const inner = t.slice(1, end).trim();
    const obj: Record<string, ConfigValue> = Object.create(null);
    if (!inner) return JSON.parse(JSON.stringify(obj)) as ConfigValue;
    const entries = splitTopLevelFlow(inner);
    if (entries.length > 0 && !entries[entries.length - 1].trim()) entries.pop();
    for (const entry of entries) {
      const colon = findUnquotedMappingColon(entry.trim());
      if (colon <= 0) throw new Error(`Invalid entry in YAML flow mapping at line ${lineNo}: ${entry}`);
      const trimmedEntry = entry.trim();
      const rawK = trimmedEntry.slice(0, colon).trim();
      const k = rawK.startsWith('"') || rawK.startsWith("'") ? parseQuotedSpanOrKey(rawK, lineNo) : rawK;
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      const valStr = trimmedEntry.slice(colon + 1).trim();
      obj[k] = valStr ? parseYamlInlineValue(valStr, lineNo) : null;
    }
    return JSON.parse(JSON.stringify(obj)) as ConfigValue;
  }

  return parseYamlNumberOrString(t);
}

function parseQuotedSpanOrKey(rawK: string, lineNo: number): string {
  const t = rawK.trim();
  if (t.startsWith('"') || t.startsWith("'")) {
    const { value, rest } = parseQuotedSpan(t);
    if (rest.trim()) throw new Error(`Unexpected characters in YAML key at line ${lineNo}`);
    return value;
  }
  rejectUnsupportedYamlIndicator(t, `key at line ${lineNo}`);
  return t;
}

interface YamlLine {
  lineNo: number;
  indent: number;
  raw: string;
  content: string;
}

const BLOCK_SCALAR_RE = /^([|>])([+-]?[1-9]?|[1-9]?[+-]?)$/;

function isSeqItemLine(content: string): boolean {
  return content === "-" || content.startsWith("- ");
}

function preprocessYamlLines(raw: string): YamlLine[] {
  const srcLines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: YamlLine[] = [];
  let docIndex = 0;
  let seenContentInCurrentDoc = false;
  let inBlockScalarIndent = -1;

  for (let i = 0; i < srcLines.length; i++) {
    const lineRaw = srcLines[i];
    const leadMatch = /^ */.exec(lineRaw);
    const indent = leadMatch ? leadMatch[0].length : 0;
    if (inBlockScalarIndent >= 0) {
      if (lineRaw.trim().length === 0 || indent > inBlockScalarIndent) {
        out.push({ lineNo: i + 1, indent, raw: lineRaw, content: lineRaw.trimStart() });
        continue;
      }
      inBlockScalarIndent = -1;
    }
    if (lineRaw[indent] === "\t") {
      throw new Error(`Tab characters cannot be used for YAML indentation (line ${i + 1})`);
    }
    const clean = stripTrailingComment(lineRaw);
    const content = clean.trim();
    if (!content) continue;
    if (content === "---" || content.startsWith("--- ")) {
      if (seenContentInCurrentDoc || docIndex > 0) {
        throw new Error(`Multi-document YAML streams are not supported (line ${i + 1})`);
      }
      docIndex++;
      const trailing = content.slice(3).trim();
      if (trailing) {
        out.push({ lineNo: i + 1, indent: indent + 4, raw: lineRaw, content: trailing });
        seenContentInCurrentDoc = true;
      }
      continue;
    }
    if (content === "...") {
      docIndex++;
      continue;
    }
    if (docIndex > 1) {
      throw new Error(`Multi-document YAML streams are not supported (line ${i + 1})`);
    }
    seenContentInCurrentDoc = true;
    out.push({ lineNo: i + 1, indent, raw: lineRaw, content });

    const colon = findUnquotedMappingColon(content);
    const valPart = colon >= 0 ? content.slice(colon + 1).trim() : content.startsWith("- ") ? content.slice(2).trim() : "";
    if (BLOCK_SCALAR_RE.test(valPart)) {
      inBlockScalarIndent = indent;
    }
  }
  return out;
}

function readBlockScalar(lines: YamlLine[], startIdx: number, header: string, parentIndent: number): { value: string; nextIdx: number } {
  const folded = header.startsWith(">");
  const chomp = header.includes("-") ? "strip" : header.includes("+") ? "keep" : "clip";
  const collected: string[] = [];
  let blockIndent: number | null = null;
  let i = startIdx;

  while (i < lines.length) {
    const ln = lines[i];
    if (ln.raw.trim().length === 0) {
      collected.push("");
      i++;
      continue;
    }
    if (ln.indent <= parentIndent) break;
    if (blockIndent === null) blockIndent = ln.indent;
    if (ln.indent < blockIndent) break;
    collected.push(ln.raw.slice(blockIndent));
    i++;
  }

  let end = collected.length;
  if (chomp !== "keep") {
    while (end > 0 && collected[end - 1] === "") end--;
  }
  const active = collected.slice(0, end);
  let text = folded ? active.join(" ") : active.join("\n");
  if (chomp === "clip" && active.length > 0) text += "\n";
  if (chomp === "keep") text = collected.join("\n") + "\n";
  return { value: text, nextIdx: i };
}

function parseYamlSequence(lines: YamlLine[], startIdx: number, seqIndent: number): { value: ConfigValue[]; nextIdx: number } {
  const arr: ConfigValue[] = [];
  let i = startIdx;

  while (i < lines.length) {
    const ln = lines[i];
    if (ln.indent < seqIndent) break;
    if (ln.indent > seqIndent || !isSeqItemLine(ln.content)) break;

    if (ln.content === "-") {
      i++;
      if (i < lines.length && lines[i].indent > seqIndent) {
        const child = parseYamlBlock(lines, i);
        arr.push(child.value);
        i = child.nextIdx;
      } else {
        arr.push(null);
      }
      continue;
    }

    const afterDashRaw = ln.content.slice(1);
    const leadingAfterDash = afterDashRaw.length - afterDashRaw.trimStart().length;
    const itemCol = ln.indent + 1 + leadingAfterDash;
    const rest = afterDashRaw.trimStart();

    if (isSeqItemLine(rest)) {
      const synthetic: YamlLine[] = [{ lineNo: ln.lineNo, indent: itemCol, raw: ln.raw, content: rest }];
      let j = i + 1;
      while (j < lines.length && lines[j].indent >= itemCol) {
        synthetic.push(lines[j]);
        j++;
      }
      const nestedSeq = parseYamlSequence(synthetic, 0, itemCol);
      arr.push(nestedSeq.value);
      i += nestedSeq.nextIdx;
      continue;
    }

    const colon = findUnquotedMappingColon(rest);
    if (colon > 0) {
      // Compact YAML mapping inside sequence item (`- host: api\n  port: 8080`)
      const obj: Record<string, ConfigValue> = Object.create(null);
      const firstKey = parseQuotedSpanOrKey(rest.slice(0, colon), ln.lineNo);
      if (firstKey === "<<" || firstKey.startsWith("&") || firstKey.startsWith("*")) {
        throw new Error(`Unsupported YAML construct '${firstKey}' at line ${ln.lineNo}`);
      }
      const firstValStr = rest.slice(colon + 1).trim();
      i++;
      let firstVal: ConfigValue;
      if (!firstValStr) {
        if (i < lines.length && (lines[i].indent > itemCol || (lines[i].indent === itemCol && isSeqItemLine(lines[i].content)))) {
          const child = parseYamlBlock(lines, i);
          firstVal = child.value;
          i = child.nextIdx;
        } else {
          firstVal = null;
        }
      } else if (BLOCK_SCALAR_RE.test(firstValStr)) {
        const bs = readBlockScalar(lines, i, firstValStr, itemCol);
        firstVal = bs.value;
        i = bs.nextIdx;
      } else {
        firstVal = parseYamlInlineValue(firstValStr, ln.lineNo);
      }
      if (firstKey !== "__proto__" && firstKey !== "constructor" && firstKey !== "prototype") {
        obj[firstKey] = firstVal;
      }
      if (i < lines.length && lines[i].indent === itemCol && !isSeqItemLine(lines[i].content)) {
        const restMap = parseYamlMapping(lines, i, itemCol);
        Object.assign(obj, restMap.value);
        i = restMap.nextIdx;
      }
      arr.push(JSON.parse(JSON.stringify(obj)) as ConfigValue);
      continue;
    }

    if (BLOCK_SCALAR_RE.test(rest)) {
      i++;
      const bs = readBlockScalar(lines, i, rest, seqIndent);
      arr.push(bs.value);
      i = bs.nextIdx;
      continue;
    }

    arr.push(parseYamlInlineValue(rest, ln.lineNo));
    i++;
  }

  return { value: arr, nextIdx: i };
}

function parseYamlMapping(
  lines: YamlLine[],
  startIdx: number,
  mapIndent: number,
): { value: Record<string, ConfigValue>; nextIdx: number } {
  const obj: Record<string, ConfigValue> = Object.create(null);
  let i = startIdx;

  while (i < lines.length) {
    const ln = lines[i];
    if (ln.indent < mapIndent) break;
    if (ln.indent > mapIndent) {
      throw new Error(`Unexpected YAML indentation at line ${ln.lineNo}`);
    }
    if (isSeqItemLine(ln.content)) break;

    const colon = findUnquotedMappingColon(ln.content);
    if (colon <= 0) {
      throw new Error(`Expected 'key: value' mapping entry at line ${ln.lineNo}: ${ln.content}`);
    }
    const key = parseQuotedSpanOrKey(ln.content.slice(0, colon), ln.lineNo);
    if (key === "<<") {
      throw new Error(`Unsupported YAML merge key '<<' at line ${ln.lineNo}`);
    }
    const valStr = ln.content.slice(colon + 1).trim();
    i++;

    let val: ConfigValue;
    if (!valStr) {
      if (
        i < lines.length &&
        (lines[i].indent > mapIndent || (lines[i].indent === mapIndent && isSeqItemLine(lines[i].content)))
      ) {
        const child = parseYamlBlock(lines, i);
        val = child.value;
        i = child.nextIdx;
      } else {
        val = null;
      }
    } else if (BLOCK_SCALAR_RE.test(valStr)) {
      const bs = readBlockScalar(lines, i, valStr, mapIndent);
      val = bs.value;
      i = bs.nextIdx;
    } else {
      val = parseYamlInlineValue(valStr, ln.lineNo);
    }

    if (key !== "__proto__" && key !== "constructor" && key !== "prototype") {
      obj[key] = val;
    }
  }

  return { value: JSON.parse(JSON.stringify(obj)) as Record<string, ConfigValue>, nextIdx: i };
}

function parseYamlBlock(lines: YamlLine[], startIdx: number): { value: ConfigValue; nextIdx: number } {
  const ln = lines[startIdx];
  if (isSeqItemLine(ln.content)) {
    return parseYamlSequence(lines, startIdx, ln.indent);
  }
  const colon = findUnquotedMappingColon(ln.content);
  if (colon > 0) {
    return parseYamlMapping(lines, startIdx, ln.indent);
  }
  return { value: parseYamlInlineValue(ln.content, ln.lineNo), nextIdx: startIdx + 1 };
}

export function parseYamlToTree(raw: string): ConfigValue {
  const lines = preprocessYamlLines(raw);
  if (lines.length === 0) return {};
  const res = parseYamlBlock(lines, 0);
  if (res.nextIdx < lines.length) {
    const leftover = lines[res.nextIdx];
    throw new Error(`Unexpected YAML content at line ${leftover.lineNo}: ${leftover.content}`);
  }
  return res.value;
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
    const cleaned = stripTrailingComment(t.slice(eq + 1)).trim();
    let v = cleaned;
    if (cleaned.startsWith('"') || cleaned.startsWith("'")) {
      v = parseQuotedSpan(cleaned).value;
    }
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
    if (val.length === 0 && prefix) {
      out[prefix] = "[]";
      return out;
    }
    val.forEach((item, idx) => {
      flattenObject(item, prefix ? `${prefix}[${idx}]` : `[${idx}]`, out);
    });
    return out;
  }
  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length === 0 && prefix) {
      out[prefix] = "{}";
      return out;
    }
    for (const [k, v] of entries) {
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
  return flattenObject(parseYamlToTree(raw));
}

export function parseConfigToTree(raw: string, fmt: ConfigFmt): ConfigValue {
  if (fmt === "yaml") return parseYamlToTree(raw);
  if (fmt === "json") return JSON.parse(raw) as ConfigValue;
  return unflattenToObject(parseConfigToFlat(raw, fmt));
}

export function parseConfigToFlat(raw: string, fmt: ConfigFmt): Record<string, string> {
  if (fmt === "env") return parseEnvToFlat(raw);
  if (fmt === "properties") return parsePropertiesToFlat(raw);
  if (fmt === "yaml") return parseYamlToFlat(raw);
  const parsed = JSON.parse(raw) as unknown;
  return flattenObject(parsed);
}

function unflattenToObject(flat: Record<string, string>): ConfigValue {
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
        const decoded = inferScalar(val);
        if (Array.isArray(cur)) cur[Number(seg)] = decoded;
        else cur[seg] = decoded;
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
  return JSON.parse(JSON.stringify(root)) as ConfigValue;
}

function inferScalar(raw: string): ConfigValue {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?(0|[1-9][0-9]*)$/.test(raw) && Math.abs(Number(raw)) <= Number.MAX_SAFE_INTEGER) {
    return Number(raw);
  }
  return raw;
}

function formatYamlKey(key: string): string {
  if (!key || /[:#\[\]{}&*!|>'",@\s`]|^-/.test(key)) {
    return JSON.stringify(key);
  }
  return key;
}

function formatYamlNode(val: ConfigValue, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(val)) {
    if (val.length === 0) return `${pad}[]`;
    return val
      .map((item) => {
        if (Array.isArray(item)) {
          if (item.length === 0) return `${pad}- []`;
          return `${pad}-\n${formatYamlNode(item, indent + 1)}`;
        }
        if (item !== null && typeof item === "object") {
          const entries = Object.entries(item);
          if (entries.length === 0) return `${pad}- {}`;
          const innerPad = "  ".repeat(indent + 1);
          const lines = entries.map(([k, v], idx) => {
            const prefix = idx === 0 ? `${pad}- ` : innerPad;
            if (v !== null && typeof v === "object") {
              if (Array.isArray(v) && v.length === 0) return `${prefix}${formatYamlKey(k)}: []`;
              if (!Array.isArray(v) && Object.keys(v).length === 0) return `${prefix}${formatYamlKey(k)}: {}`;
              return `${prefix}${formatYamlKey(k)}:\n${formatYamlNode(v, indent + 2)}`;
            }
            return `${prefix}${formatYamlKey(k)}: ${formatYamlScalar(v)}`;
          });
          return lines.join("\n");
        }
        return `${pad}- ${formatYamlScalar(item)}`;
      })
      .join("\n");
  }
  if (val !== null && typeof val === "object") {
    const entries = Object.entries(val);
    if (entries.length === 0) return `${pad}{}`;
    return entries
      .map(([k, v]) => {
        if (v !== null && typeof v === "object") {
          if (Array.isArray(v) && v.length === 0) return `${pad}${formatYamlKey(k)}: []`;
          if (!Array.isArray(v) && Object.keys(v).length === 0) return `${pad}${formatYamlKey(k)}: {}`;
          return `${pad}${formatYamlKey(k)}:\n${formatYamlNode(v, indent + 1)}`;
        }
        return `${pad}${formatYamlKey(k)}: ${formatYamlScalar(v)}`;
      })
      .join("\n");
  }
  return `${pad}${formatYamlScalar(val)}`;
}

function formatYamlScalar(v: ConfigValue): string {
  if (v === null) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  const s = String(v);
  if (
    !s ||
    /^(true|false|null|~)$/i.test(s) ||
    /^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(s) ||
    /[:#\[\]{}&*!|>'",`\n\r\t@]|^\s|\s$/.test(s)
  ) {
    return JSON.stringify(s);
  }
  return s;
}

function countTreeLeaves(val: ConfigValue): number {
  if (Array.isArray(val)) {
    return val.reduce<number>((sum, item) => sum + countTreeLeaves(item), 0);
  }
  if (val !== null && typeof val === "object") {
    return Object.values(val).reduce<number>((sum, item) => sum + countTreeLeaves(item), 0);
  }
  return 1;
}

export function serializeTreeConfig(tree: ConfigValue, to: ConfigFmt): string {
  if (to === "json") return JSON.stringify(tree, null, 2);
  if (to === "yaml") return formatYamlNode(tree, 0);
  return serializeFlatConfig(flattenObject(tree), to);
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
  return serializeTreeConfig(tree, to);
}

export function convertConfig(
  input: string,
  from: ConfigFmt,
  to: ConfigFmt,
): { output: string; count: number; error: string | null } {
  if (!input.trim()) {
    return { output: "", count: 0, error: null };
  }
  try {
    const tree = parseConfigToTree(input, from);
    const output = serializeTreeConfig(tree, to);
    const count = from === "yaml" || from === "json" ? countTreeLeaves(tree) : Object.keys(flattenObject(tree)).length;
    return { output, count, error: null };
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
