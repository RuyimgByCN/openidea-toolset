export interface StackFrame {
  raw: string;
  index: number;
  symbol: string;
  location: string;
  isAppFrame: boolean;
}

export interface ParsedStackTrace {
  language: "Java / JVM" | "JS / TypeScript" | "Python" | "Go" | "Rust" | "Generic";
  causes: string[];
  frames: StackFrame[];
  appFrameCount: number;
  frameworkFrameCount: number;
}

export interface NdjsonLogRow {
  line: number;
  timestamp: string;
  level: "ERROR" | "WARN" | "INFO" | "DEBUG" | "TRACE" | "OTHER";
  message: string;
  extra: string;
  raw: string;
}

const DEFAULT_FRAMEWORK_PREFIXES = [
  "java.",
  "javax.",
  "jakarta.",
  "sun.",
  "com.sun.",
  "jdk.",
  "org.springframework.",
  "org.apache.",
  "io.netty.",
  "org.hibernate.",
  "org.junit.",
  "kotlin.",
  "kotlinx.",
  "scala.",
  "node:internal",
  "internal/",
  "node_modules/",
  "std::",
  "core::",
  "tokio::",
];

export function unescapeLogTrace(raw: string): string {
  return raw
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"');
}

function classifyAppFrame(text: string, appPrefixes: string[]): boolean {
  const lower = text.toLowerCase();
  const custom = appPrefixes.map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (custom.length > 0) {
    return custom.some((pfx) => lower.includes(pfx));
  }
  return !DEFAULT_FRAMEWORK_PREFIXES.some((fw) => lower.includes(fw));
}

export function parseStackTrace(raw: string, appPrefixes: string[] = []): ParsedStackTrace {
  const lines = raw.replace(/\r\n/g, "\n").split("\n").map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);

  let language: ParsedStackTrace["language"] = "Generic";
  if (lines.some((l) => /^\s*Caused by:|^\s*at [\w.$]+\(.*\.java:\d+\)/.test(l))) {
    language = "Java / JVM";
  } else if (lines.some((l) => /^Traceback \(most recent call last\)/.test(l) || /^\s*File ".*", line \d+/.test(l))) {
    language = "Python";
  } else if (lines.some((l) => /^\s*\d+:.*0x[0-9a-f]+|at .*\.rs:\d+:\d+/.test(l))) {
    language = "Rust";
  } else if (lines.some((l) => /^goroutine \d+|^\s*.*\.go:\d+/.test(l))) {
    language = "Go";
  } else if (lines.some((l) => /^\s*at .*:\d+:\d+/.test(l))) {
    language = "JS / TypeScript";
  }

  const causes: string[] = [];
  const frames: StackFrame[] = [];

  for (const line of lines) {
    const t = line.trim();
    const javaFrame = /^at\s+([^\s(]+)\(([^)]+)\)/.exec(t);
    const jsFrame = /^at\s+(?:async\s+)?([^\s(]+)\s+\(([^)]+:\d+:\d+)\)/.exec(t) ?? /^at\s+([^(\s]+:\d+:\d+)$/.exec(t);
    const pyFrame = /^File\s+"([^"]+)",\s+line\s+(\d+)(?:,\s+in\s+(.*))?$/.exec(t);
    const goOrRustLoc = /^(?:at\s+)?([^\s]+?\.(?:go|rs):\d+(?::\d+)?)/.exec(t);

    if (javaFrame && (language === "Java / JVM" || !javaFrame[2].includes("://"))) {
      const symbol = javaFrame[1];
      const location = javaFrame[2];
      frames.push({
        raw: t,
        index: frames.length,
        symbol,
        location,
        isAppFrame: classifyAppFrame(`${symbol} ${location}`, appPrefixes),
      });
    } else if (jsFrame) {
      const symbol = jsFrame.length >= 3 ? jsFrame[1] : "<anonymous>";
      const location = jsFrame.length >= 3 ? jsFrame[2] : jsFrame[1];
      frames.push({
        raw: t,
        index: frames.length,
        symbol,
        location,
        isAppFrame: classifyAppFrame(`${symbol} ${location}`, appPrefixes),
      });
    } else if (pyFrame) {
      const location = `${pyFrame[1]}:${pyFrame[2]}`;
      const symbol = pyFrame[3] ?? "<module>";
      frames.push({
        raw: t,
        index: frames.length,
        symbol,
        location,
        isAppFrame: classifyAppFrame(`${symbol} ${location}`, appPrefixes) && !location.includes("site-packages"),
      });
    } else if (goOrRustLoc) {
      frames.push({
        raw: t,
        index: frames.length,
        symbol: t,
        location: goOrRustLoc[1],
        isAppFrame: classifyAppFrame(t, appPrefixes),
      });
    } else if (/^(Caused by:|[\w.$]*(Exception|Error|Panic|Traceback)|panic:|thread '.*' panicked)/.test(t)) {
      causes.push(t);
    }
  }

  const appFrameCount = frames.filter((f) => f.isAppFrame).length;
  return {
    language,
    causes,
    frames,
    appFrameCount,
    frameworkFrameCount: frames.length - appFrameCount,
  };
}

function normLevel(raw: unknown): NdjsonLogRow["level"] {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "ERR" || s === "ERROR" || s === "FATAL" || s === "CRITICAL" || s === "50" || s === "60") return "ERROR";
  if (s === "WARN" || s === "WARNING" || s === "40") return "WARN";
  if (s === "INFO" || s === "30") return "INFO";
  if (s === "DEBUG" || s === "20") return "DEBUG";
  if (s === "TRACE" || s === "10") return "TRACE";
  return "OTHER";
}

export function parseNdjsonLogs(raw: string): NdjsonLogRow[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const rows: NdjsonLogRow[] = [];

  lines.forEach((line, idx) => {
    const t = line.trim();
    if (!t) return;
    try {
      const obj = JSON.parse(t) as unknown;
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        const rec = obj as Record<string, unknown>;
        const tsKey = ["timestamp", "time", "ts", "@timestamp", "date"].find((k) => k in rec);
        const lvlKey = ["level", "lvl", "severity"].find((k) => k in rec);
        const msgKey = ["message", "msg", "err", "error"].find((k) => k in rec);

        const skip = new Set([tsKey, lvlKey, msgKey].filter(Boolean));
        const extraPairs = Object.entries(rec)
          .filter(([k]) => !skip.has(k))
          .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);

        rows.push({
          line: idx + 1,
          timestamp: tsKey ? String(rec[tsKey] ?? "") : "",
          level: lvlKey ? normLevel(rec[lvlKey]) : "INFO",
          message: msgKey ? String(rec[msgKey] ?? "") : t,
          extra: extraPairs.join("  "),
          raw: t,
        });
        return;
      }
    } catch {
      // Fall through to plain-text line parsing
    }
    const levelGuess = /\b(ERROR|FATAL|Exception)\b/i.test(t)
      ? "ERROR"
      : /\bWARN(ING)?\b/i.test(t)
        ? "WARN"
        : /\bDEBUG\b/i.test(t)
          ? "DEBUG"
          : /\bINFO\b/i.test(t)
            ? "INFO"
            : "OTHER";
    rows.push({ line: idx + 1, timestamp: "", level: levelGuess, message: t, extra: "", raw: t });
  });
  return rows;
}
