export interface CompiledGlob {
  raw: string;
  regex: RegExp;
  dirOnly: boolean;
  negated: boolean;
  anchored: boolean;
}

export interface GitignoreResultRow {
  path: string;
  isDir: boolean;
  ignored: boolean;
  matchedLine: number | null;
  matchedRule: string | null;
  negated: boolean;
}

function globBodyToRegexSource(glob: string): string {
  let out = "";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        const next = glob[i + 2];
        if (next === "/") {
          out += "(?:.+/)?";
          i += 3;
          continue;
        }
        out += ".*";
        i += 2;
        continue;
      }
      out += "[^/]*";
      i++;
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      i++;
      continue;
    }
    if (ch === "[") {
      const close = glob.indexOf("]", i + 1);
      if (close !== -1) {
        let body = glob.slice(i + 1, close);
        if (body.startsWith("!")) body = "^" + body.slice(1);
        out += `[${body}]`;
        i = close + 1;
        continue;
      }
    }
    if (ch === "{") {
      const close = glob.indexOf("}", i + 1);
      if (close !== -1) {
        const alts = glob
          .slice(i + 1, close)
          .split(",")
          .map((alt) => globBodyToRegexSource(alt));
        out += `(?:${alts.join("|")})`;
        i = close + 1;
        continue;
      }
    }
    if ("\\^$.|+()".includes(ch)) {
      out += "\\" + ch;
    } else {
      out += ch;
    }
    i++;
  }
  return out;
}

export function compileGlobToRegex(pattern: string, isGitignore = true): CompiledGlob {
  let raw = pattern.trim();
  let negated = false;
  if (isGitignore && raw.startsWith("!")) {
    negated = true;
    raw = raw.slice(1);
  }
  let dirOnly = false;
  if (isGitignore && raw.endsWith("/") && raw.length > 1) {
    dirOnly = true;
    raw = raw.slice(0, -1);
  }
  const hasLeadingSlash = raw.startsWith("/");
  if (hasLeadingSlash) raw = raw.slice(1);
  const anchored = hasLeadingSlash || raw.includes("/");

  const bodySrc = globBodyToRegexSource(raw);
  const regexStr = isGitignore
    ? anchored
      ? `^${bodySrc}(?:/.*)?$`
      : `(?:^|/)${bodySrc}(?:/.*)?$`
    : `^${bodySrc}$`;

  return {
    raw: pattern.trim(),
    regex: new RegExp(regexStr),
    dirOnly,
    negated,
    anchored,
  };
}

export function evaluateGitignore(rulesText: string, pathsText: string): GitignoreResultRow[] {
  const rules: Array<{ line: number; compiled: CompiledGlob }> = [];
  rulesText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((rawLine, idx) => {
      const t = rawLine.trim();
      if (!t || t.startsWith("#")) return;
      try {
        rules.push({ line: idx + 1, compiled: compileGlobToRegex(t, true) });
      } catch {
        // Ignore invalid user pattern lines safely
      }
    });

  const paths = pathsText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const evalSinglePath = (clean: string, isDir: boolean) => {
    let ignored = false;
    let matchedLine: number | null = null;
    let matchedRule: string | null = null;
    let matchedNeg = false;

    for (const r of rules) {
      if (r.compiled.dirOnly && !isDir) {
        continue;
      }
      if (r.compiled.regex.test(clean)) {
        ignored = !r.compiled.negated;
        matchedLine = r.line;
        matchedRule = r.compiled.raw;
        matchedNeg = r.compiled.negated;
      }
    }
    return { ignored, matchedLine, matchedRule, negated: matchedNeg };
  };

  return paths.map((rawPath) => {
    const isDir = rawPath.endsWith("/");
    const clean = rawPath.replace(/^\/+/, "").replace(/\/+$/, "");
    const segs = clean.split("/").filter(Boolean);

    // Git semantics: if a parent directory is ignored, files inside it cannot be re-included via !pattern.
    const maxAncestors = isDir ? Math.max(0, segs.length - 1) : Math.max(0, segs.length - 1);
    for (let k = 1; k <= maxAncestors; k++) {
      const anc = segs.slice(0, k).join("/");
      const ancRes = evalSinglePath(anc, true);
      if (ancRes.ignored) {
        return {
          path: rawPath,
          isDir,
          ignored: true,
          matchedLine: ancRes.matchedLine,
          matchedRule: ancRes.matchedRule,
          negated: false,
        };
      }
    }

    const res = evalSinglePath(clean, isDir);
    return {
      path: rawPath,
      isDir,
      ignored: res.ignored,
      matchedLine: res.matchedLine,
      matchedRule: res.matchedRule,
      negated: res.negated,
    };
  });
}

export function matchSingleGlob(pattern: string, pathsText: string): Array<{ path: string; matched: boolean }> {
  const compiled = compileGlobToRegex(pattern || "*", false);
  return pathsText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((p) => ({
      path: p,
      matched: compiled.regex.test(p.replace(/^\/+/, "")),
    }));
}
