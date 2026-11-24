export interface ExpandOptions {
  mode: "delim" | "json";
  delimiter: string;
  hasHeader: boolean;
  skipEmpty: boolean;
  joinWith: string;
  header: string;
  footer: string;
}

export interface ExpandResult {
  output: string;
  rowCount: number;
  columns: string[];
  error: string | null;
}

function splitWordsForCase(val: string): string[] {
  return val
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9\u4e00-\u9fff]+/)
    .filter(Boolean);
}

function applyFilter(val: string, filterName: string): string {
  switch (filterName.trim().toLowerCase()) {
    case "trim":
      return val.trim();
    case "upper":
      return val.toUpperCase();
    case "lower":
      return val.toLowerCase();
    case "camel": {
      const w = splitWordsForCase(val);
      return w
        .map((p, i) =>
          i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(),
        )
        .join("");
    }
    case "pascal": {
      const w = splitWordsForCase(val);
      return w.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join("");
    }
    case "snake":
      return splitWordsForCase(val).map((w) => w.toLowerCase()).join("_");
    case "screaming":
      return splitWordsForCase(val).map((w) => w.toUpperCase()).join("_");
    case "kebab":
      return splitWordsForCase(val).map((w) => w.toLowerCase()).join("-");
    case "quote":
      return `'${val.replace(/'/g, "''")}'`;
    case "dquote":
      return `"${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    case "json":
      return JSON.stringify(val);
    case "url":
      return encodeURIComponent(val);
    case "b64":
      try {
        const bytes = new TextEncoder().encode(val);
        let bin = "";
        for (const b of bytes) bin += String.fromCharCode(b);
        return btoa(bin);
      } catch {
        return val;
      }
    case "pad2":
      return val.padStart(2, "0");
    case "pad4":
      return val.padStart(4, "0");
    default:
      return val;
  }
}

function parseCsvLine(line: string, delim: string): string[] {
  if (delim.length !== 1) {
    return line.split(delim).map((s) => s.trim());
  }
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      fields.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

export function expandTemplate(input: string, template: string, opts: ExpandOptions): ExpandResult {
  try {
    let headers: string[] = [];
    let rows: Array<{ cells: string[]; named: Record<string, string>; rawLine: string }> = [];

    if (opts.mode === "json") {
      const parsed = JSON.parse(input) as unknown;
      if (!Array.isArray(parsed)) {
        return { output: "", rowCount: 0, columns: [], error: "JSON input must be an array of objects or primitives" };
      }
      const keySet = new Set<string>();
      for (const item of parsed) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          Object.keys(item as Record<string, unknown>).forEach((k) => keySet.add(k));
        }
      }
      headers = Array.from(keySet);
      rows = parsed.map((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const obj = item as Record<string, unknown>;
          const named: Record<string, string> = {};
          const cells = headers.map((k) => {
            const v = obj[k];
            const s = v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
            named[k] = s;
            return s;
          });
          return { cells, named, rawLine: JSON.stringify(item) };
        }
        const s = item === null || item === undefined ? "" : String(item);
        return { cells: [s], named: {}, rawLine: s };
      });
    } else {
      const rawDelim = opts.delimiter === "\\t" ? "\t" : opts.delimiter;
      let lines = input.replace(/\r\n/g, "\n").split("\n");
      if (opts.skipEmpty) {
        lines = lines.filter((l) => l.trim().length > 0);
      }
      if (opts.hasHeader && lines.length > 0) {
        headers = parseCsvLine(lines[0], rawDelim || ",");
        lines = lines.slice(1);
      }
      rows = lines.map((line) => {
        const cells = rawDelim ? parseCsvLine(line, rawDelim) : line.trim().split(/\s+/);
        const named: Record<string, string> = {};
        headers.forEach((h, i) => {
          if (h) named[h] = cells[i] ?? "";
        });
        return { cells, named, rawLine: line };
      });
    }

    const total = rows.length;
    const rendered = rows.map((row, idx) =>
      template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr: string) => {
        const parts = expr.split("|");
        const key = parts[0].trim();
        let val = "";
        if (key === "0" || key === "line") {
          val = row.rawLine;
        } else if (key === "index") {
          val = String(idx);
        } else if (key === "index1") {
          val = String(idx + 1);
        } else if (key === "total") {
          val = String(total);
        } else if (/^\d+$/.test(key)) {
          const colIdx = Number(key) - 1;
          val = colIdx >= 0 ? (row.cells[colIdx] ?? "") : "";
        } else if (key in row.named) {
          val = row.named[key];
        }
        for (let i = 1; i < parts.length; i++) {
          val = applyFilter(val, parts[i]);
        }
        return val;
      }),
    );

    const joinStr = opts.joinWith
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
    const pieces: string[] = [];
    if (opts.header.trim()) pieces.push(opts.header);
    if (rendered.length > 0) pieces.push(rendered.join(joinStr));
    if (opts.footer.trim()) pieces.push(opts.footer);

    return {
      output: pieces.join("\n"),
      rowCount: total,
      columns: headers,
      error: null,
    };
  } catch (e) {
    return { output: "", rowCount: 0, columns: [], error: (e as Error).message };
  }
}
