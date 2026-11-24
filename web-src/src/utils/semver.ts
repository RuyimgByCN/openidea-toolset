export interface ParsedSemver {
  raw: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  build: string[];
}

const SEMVER_RE =
  /^[vV=]?\s*(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parseSemver(raw: string): ParsedSemver | null {
  const m = SEMVER_RE.exec(raw.trim());
  if (!m) return null;
  return {
    raw: raw.trim(),
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split(".") : [],
    build: m[5] ? m[5].split(".") : [],
  };
}

export function formatSemver(v: ParsedSemver): string {
  let base = `${v.major}.${v.minor}.${v.patch}`;
  if (v.prerelease.length > 0) base += `-${v.prerelease.join(".")}`;
  if (v.build.length > 0) base += `+${v.build.join(".")}`;
  return base;
}

export function compareSemver(a: ParsedSemver, b: ParsedSemver): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;

  const ap = a.prerelease;
  const bp = b.prerelease;
  if (ap.length === 0 && bp.length === 0) return 0;
  if (ap.length === 0) return 1;
  if (bp.length === 0) return -1;

  const len = Math.max(ap.length, bp.length);
  for (let i = 0; i < len; i++) {
    if (i >= ap.length) return -1;
    if (i >= bp.length) return 1;
    const x = ap[i];
    const y = bp[i];
    if (x === y) continue;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const xn = Number(x);
      const yn = Number(y);
      return xn < yn ? -1 : 1;
    }
    if (xNum !== yNum) return xNum ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export function bumpSemver(
  v: ParsedSemver,
  kind: "major" | "minor" | "patch" | "prerelease" | "release",
): string {
  if (kind === "major") {
    const nextMajor = v.prerelease.length > 0 && v.minor === 0 && v.patch === 0 ? v.major : v.major + 1;
    return `${nextMajor}.0.0`;
  }
  if (kind === "minor") {
    const nextMinor = v.prerelease.length > 0 && v.patch === 0 ? v.minor : v.minor + 1;
    return `${v.major}.${nextMinor}.0`;
  }
  if (kind === "patch") {
    const nextPatch = v.prerelease.length > 0 ? v.patch : v.patch + 1;
    return `${v.major}.${v.minor}.${nextPatch}`;
  }
  if (kind === "release") {
    return `${v.major}.${v.minor}.${v.patch}`;
  }
  // prerelease
  if (v.prerelease.length === 0) {
    return `${v.major}.${v.minor}.${v.patch + 1}-alpha.0`;
  }
  const pre = [...v.prerelease];
  const last = pre[pre.length - 1];
  if (/^\d+$/.test(last)) {
    pre[pre.length - 1] = String(Number(last) + 1);
  } else {
    pre.push("0");
  }
  return `${v.major}.${v.minor}.${v.patch}-${pre.join(".")}`;
}

export function sortSemverList(lines: string[], desc = false): { sorted: string[]; invalid: string[] } {
  const valid: ParsedSemver[] = [];
  const invalid: string[] = [];
  for (const raw of lines.map((l) => l.trim()).filter(Boolean)) {
    const p = parseSemver(raw);
    if (p) valid.push(p);
    else invalid.push(raw);
  }
  valid.sort((a, b) => (desc ? compareSemver(b, a) : compareSemver(a, b)));
  return { sorted: valid.map((v) => v.raw), invalid };
}

// --- Range Evaluation (NPM/Cargo + Maven) ---

interface Bound {
  op: ">=" | ">" | "<=" | "<" | "=";
  ver: ParsedSemver;
}

function makeVer(major: number, minor = 0, patch = 0): ParsedSemver {
  return { raw: `${major}.${minor}.${patch}`, major, minor, patch, prerelease: [], build: [] };
}

function parsePartialTuple(raw: string): { major: number | null; minor: number | null; patch: number | null } | null {
  const cleaned = raw.trim().replace(/^[vV=]/, "");
  if (cleaned === "*" || cleaned.toLowerCase() === "x") {
    return { major: null, minor: null, patch: null };
  }
  const parts = cleaned.split(".");
  if (parts.length > 3) return null;
  const nums = parts.map((p) => (p === "*" || p.toLowerCase() === "x" ? null : /^\d+$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => typeof n === "number" && Number.isNaN(n))) return null;
  return {
    major: nums[0] ?? null,
    minor: nums[1] ?? null,
    patch: nums[2] ?? null,
  };
}

function expandComparator(token: string): Bound[] {
  const t = token.trim();
  if (!t || t === "*" || t.toLowerCase() === "x") {
    return [{ op: ">=", ver: makeVer(0, 0, 0) }];
  }

  if (t.startsWith("^")) {
    const full = parseSemver(t.slice(1));
    if (full) {
      let upper: ParsedSemver;
      if (full.major > 0) upper = makeVer(full.major + 1, 0, 0);
      else if (full.minor > 0) upper = makeVer(0, full.minor + 1, 0);
      else upper = makeVer(0, 0, full.patch + 1);
      return [
        { op: ">=", ver: full },
        { op: "<", ver: upper },
      ];
    }
    const p = parsePartialTuple(t.slice(1));
    if (!p || p.major === null) throw new Error(`Invalid ^ range: ${t}`);
    const min = makeVer(p.major, p.minor ?? 0, p.patch ?? 0);
    const upper =
      p.major > 0 || p.minor === null
        ? makeVer(p.major + 1, 0, 0)
        : makeVer(0, p.minor + 1, 0);
    return [{ op: ">=", ver: min }, { op: "<", ver: upper }];
  }

  if (t.startsWith("~")) {
    const rawRest = t.slice(1).trim();
    const full = parseSemver(rawRest);
    if (full) {
      return [
        { op: ">=", ver: full },
        { op: "<", ver: makeVer(full.major, full.minor + 1, 0) },
      ];
    }
    const p = parsePartialTuple(rawRest);
    if (!p || p.major === null) throw new Error(`Invalid ~ range: ${t}`);
    const min = makeVer(p.major, p.minor ?? 0, p.patch ?? 0);
    const upper =
      p.minor === null ? makeVer(p.major + 1, 0, 0) : makeVer(p.major, p.minor + 1, 0);
    return [{ op: ">=", ver: min }, { op: "<", ver: upper }];
  }

  const opMatch = /^(>=|<=|>|<|=)\s*(.+)$/.exec(t);
  if (opMatch) {
    const op = opMatch[1] as Bound["op"];
    const rhs = opMatch[2].trim();
    const full = parseSemver(rhs);
    if (full) return [{ op, ver: full }];
    const p = parsePartialTuple(rhs);
    if (!p || p.major === null) throw new Error(`Invalid comparator: ${t}`);
    const lo = makeVer(p.major, p.minor ?? 0, p.patch ?? 0);
    if (op === ">=") return [{ op: ">=", ver: lo }];
    if (op === "<") return [{ op: "<", ver: lo }];
    if (op === ">") {
      const hi = p.minor === null ? makeVer(p.major + 1, 0, 0) : p.patch === null ? makeVer(p.major, p.minor + 1, 0) : lo;
      return [{ op: p.minor === null || p.patch === null ? ">=" : ">", ver: hi }];
    }
    if (op === "<=") {
      const hi = p.minor === null ? makeVer(p.major + 1, 0, 0) : p.patch === null ? makeVer(p.major, p.minor + 1, 0) : lo;
      return [{ op: p.minor === null || p.patch === null ? "<" : "<=", ver: hi }];
    }
    return [{ op: "=", ver: lo }];
  }

  // Exact or wildcard tuple like `1.2.x` or `1.*` or `1.2.3`
  const full = parseSemver(t);
  if (full) return [{ op: "=", ver: full }];
  const p = parsePartialTuple(t);
  if (!p) throw new Error(`Invalid version token: ${t}`);
  if (p.major === null) return [{ op: ">=", ver: makeVer(0, 0, 0) }];
  if (p.minor === null) {
    return [
      { op: ">=", ver: makeVer(p.major, 0, 0) },
      { op: "<", ver: makeVer(p.major + 1, 0, 0) },
    ];
  }
  if (p.patch === null) {
    return [
      { op: ">=", ver: makeVer(p.major, p.minor, 0) },
      { op: "<", ver: makeVer(p.major, p.minor + 1, 0) },
    ];
  }
  return [{ op: "=", ver: makeVer(p.major, p.minor, p.patch) }];
}

function satisfiesBound(ver: ParsedSemver, bound: Bound): boolean {
  // Prerelease versions only satisfy explicit prerelease comparators on the same [major, minor, patch]
  if (ver.prerelease.length > 0 && bound.ver.prerelease.length === 0) {
    if (
      ver.major !== bound.ver.major ||
      ver.minor !== bound.ver.minor ||
      ver.patch !== bound.ver.patch
    ) {
      return false;
    }
  }
  const cmp = compareSemver(ver, bound.ver);
  switch (bound.op) {
    case ">=": return cmp >= 0;
    case ">": return cmp > 0;
    case "<=": return cmp <= 0;
    case "<": return cmp < 0;
    case "=": return cmp === 0;
  }
}

function evalMavenPart(ver: ParsedSemver, part: string): boolean {
  const t = part.trim();
  if ((t.startsWith("[") || t.startsWith("(")) && (t.endsWith("]") || t.endsWith(")"))) {
    const incLo = t.startsWith("[");
    const incHi = t.endsWith("]");
    const inner = t.slice(1, -1).trim();
    if (!inner.includes(",")) {
      const p = parseSemver(inner);
      if (!p) throw new Error(`Invalid Maven version ${inner}`);
      return incLo && incHi && compareSemver(ver, p) === 0;
    }
    const [loStr, hiStr] = inner.split(",").map((s) => s.trim());
    if (loStr) {
      const lo = parseSemver(loStr) ?? (() => {
        const pt = parsePartialTuple(loStr);
        return pt && pt.major !== null ? makeVer(pt.major, pt.minor ?? 0, pt.patch ?? 0) : null;
      })();
      if (!lo) throw new Error(`Invalid Maven lower bound ${loStr}`);
      const c = compareSemver(ver, lo);
      if (incLo ? c < 0 : c <= 0) return false;
    }
    if (hiStr) {
      const hi = parseSemver(hiStr) ?? (() => {
        const pt = parsePartialTuple(hiStr);
        return pt && pt.major !== null ? makeVer(pt.major, pt.minor ?? 0, pt.patch ?? 0) : null;
      })();
      if (!hi) throw new Error(`Invalid Maven upper bound ${hiStr}`);
      const c = compareSemver(ver, hi);
      if (incHi ? c > 0 : c >= 0) return false;
    }
    return true;
  }
  const soft = parseSemver(t);
  if (!soft) throw new Error(`Invalid Maven requirement ${t}`);
  return compareSemver(ver, soft) === 0;
}

export function satisfiesRange(
  versionRaw: string,
  rangeRaw: string,
): { matched: boolean; dialect: "npm-cargo" | "maven"; error?: string } {
  const ver = parseSemver(versionRaw);
  const range = rangeRaw.trim();
  const isMaven = /^[(\[]/.test(range);
  const dialect: "npm-cargo" | "maven" = isMaven ? "maven" : "npm-cargo";
  if (!ver) {
    return { matched: false, dialect, error: "Invalid SemVer" };
  }
  if (!range) {
    return { matched: false, dialect, error: "Empty range" };
  }
  try {
    if (isMaven) {
      // Split Maven OR ranges like `[1.0,1.5),[2.0,)` outside brackets
      const parts: string[] = [];
      let cur = "";
      let inBracket = false;
      for (const ch of range) {
        if (ch === "[" || ch === "(") inBracket = true;
        else if (ch === "]" || ch === ")") inBracket = false;
        if (ch === "," && !inBracket) {
          if (cur.trim()) parts.push(cur.trim());
          cur = "";
        } else {
          cur += ch;
        }
      }
      if (cur.trim()) parts.push(cur.trim());
      return { matched: parts.some((p) => evalMavenPart(ver, p)), dialect };
    }

    const orClauses = range.split("||").map((s) => s.trim()).filter(Boolean);
    for (const clause of orClauses) {
      // Handle hyphen range `1.2.3 - 2.3.4`
      const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(clause);
      if (hyphen) {
        const loBounds = expandComparator(`>=${hyphen[1]}`);
        const hiParsed = parsePartialTuple(hyphen[2]);
        const hiBounds = parseSemver(hyphen[2])
          ? expandComparator(`<=${hyphen[2]}`)
          : hiParsed
            ? expandComparator(`<=${hyphen[2]}`)
            : [];
        if ([...loBounds, ...hiBounds].every((b) => satisfiesBound(ver, b))) {
          return { matched: true, dialect };
        }
        continue;
      }

      // Normalize Cargo-style `,` separators and space after operators (`>= 1.0`)
      const norm = clause
        .replace(/,/g, " ")
        .replace(/(>=|<=|>|<|=)\s+/g, "$1")
        .trim();
      const tokens = norm.split(/\s+/).filter(Boolean);
      const bounds = tokens.flatMap(expandComparator);
      if (bounds.length > 0 && bounds.every((b) => satisfiesBound(ver, b))) {
        return { matched: true, dialect };
      }
    }
    return { matched: false, dialect };
  } catch (e) {
    return { matched: false, dialect, error: (e as Error).message };
  }
}
