export type GroupKind =
  | "capture"
  | "named"
  | "noncap"
  | "lookahead"
  | "negLookahead"
  | "lookbehind"
  | "negLookbehind"
  | "flags";

export type RegexAstNode =
  | { type: "alt"; branches: RegexAstNode[] }
  | { type: "seq"; items: RegexAstNode[] }
  | { type: "literal"; text: string }
  | { type: "any" }
  | { type: "anchor"; raw: string; kind: "start" | "end" | "word" | "nonWord" }
  | { type: "escape"; raw: string; code: string }
  | { type: "charset"; raw: string; negated: boolean; items: string[] }
  | { type: "group"; kind: GroupKind; name?: string; index?: number; body: RegexAstNode }
  | { type: "quant"; min: number; max: number | null; greedy: boolean; target: RegexAstNode };

export interface RegexExplainItem {
  depth: number;
  token: string;
  descEn: string;
  descZh: string;
}

const MAX_DEPTH = 64;

export function parseRegexAst(pattern: string): { ast: RegexAstNode; error: string | null } {
  let pos = 0;
  let groupCounter = 0;

  function parseAlt(depth: number): RegexAstNode {
    if (depth > MAX_DEPTH) {
      throw new Error("Regex nesting exceeds maximum depth");
    }
    const branches: RegexAstNode[] = [parseSeq(depth + 1)];
    while (pos < pattern.length && pattern[pos] === "|") {
      pos++;
      branches.push(parseSeq(depth + 1));
    }
    return branches.length === 1 ? branches[0] : { type: "alt", branches };
  }

  function parseSeq(depth: number): RegexAstNode {
    const items: RegexAstNode[] = [];
    while (pos < pattern.length) {
      const ch = pattern[pos];
      if (ch === ")" || ch === "|") break;
      const before = pos;
      let atom = parseAtom(depth);
      atom = parseQuantifiers(atom);
      if (
        atom.type === "literal" &&
        items.length > 0 &&
        items[items.length - 1].type === "literal"
      ) {
        const prev = items[items.length - 1] as { type: "literal"; text: string };
        prev.text += atom.text;
      } else {
        items.push(atom);
      }
      if (pos === before) {
        pos++;
      }
    }
    if (items.length === 0) return { type: "seq", items: [] };
    if (items.length === 1) return items[0];
    return { type: "seq", items };
  }

  function parseAtom(depth: number): RegexAstNode {
    const ch = pattern[pos];
    if (ch === "(") {
      return parseGroup(depth);
    }
    if (ch === "[") {
      return parseCharset();
    }
    if (ch === "\\") {
      return parseEscape();
    }
    if (ch === ".") {
      pos++;
      return { type: "any" };
    }
    if (ch === "^") {
      pos++;
      return { type: "anchor", raw: "^", kind: "start" };
    }
    if (ch === "$") {
      pos++;
      return { type: "anchor", raw: "$", kind: "end" };
    }
    if (ch === "*" || ch === "+" || ch === "?" ) {
      // Unattached quantifier token; treat literally so parser recovers gracefully
      pos++;
      return { type: "literal", text: ch };
    }
    pos++;
    return { type: "literal", text: ch };
  }

  function parseGroup(depth: number): RegexAstNode {
    pos++; // consume '('
    let kind: GroupKind = "capture";
    let name: string | undefined;
    let index: number | undefined;

    if (pattern[pos] === "?") {
      if (pattern.startsWith("?:", pos)) {
        kind = "noncap";
        pos += 2;
      } else if (pattern.startsWith("?=", pos)) {
        kind = "lookahead";
        pos += 2;
      } else if (pattern.startsWith("?!", pos)) {
        kind = "negLookahead";
        pos += 2;
      } else if (pattern.startsWith("?<=", pos)) {
        kind = "lookbehind";
        pos += 3;
      } else if (pattern.startsWith("?<!", pos)) {
        kind = "negLookbehind";
        pos += 3;
      } else if (pattern.startsWith("?<", pos) || pattern.startsWith("?P<", pos)) {
        kind = "named";
        index = ++groupCounter;
        const startOffset = pattern.startsWith("?P<", pos) ? 3 : 2;
        pos += startOffset;
        const close = pattern.indexOf(">", pos);
        if (close === -1) {
          throw new Error("Unclosed named capture group");
        }
        name = pattern.slice(pos, close);
        pos = close + 1;
      } else {
        // Inline flags (?i), (?m:...), etc.
        let flagEnd = pos + 1;
        while (flagEnd < pattern.length && /[a-zA-Z-]/.test(pattern[flagEnd])) {
          flagEnd++;
        }
        if (pattern[flagEnd] === ":") {
          kind = "flags";
          name = pattern.slice(pos + 1, flagEnd);
          pos = flagEnd + 1;
        } else if (pattern[flagEnd] === ")") {
          kind = "flags";
          name = pattern.slice(pos + 1, flagEnd);
          pos = flagEnd + 1;
          return { type: "group", kind, name, body: { type: "seq", items: [] } };
        }
      }
    } else {
      index = ++groupCounter;
    }

    const body = parseAlt(depth + 1);
    if (pattern[pos] !== ")") {
      throw new Error("Unclosed '(' group");
    }
    pos++;
    return { type: "group", kind, name, index, body };
  }

  function parseCharset(): RegexAstNode {
    const start = pos;
    pos++; // consume '['
    let negated = false;
    if (pattern[pos] === "^") {
      negated = true;
      pos++;
    }
    const items: string[] = [];
    // Leading ']' right after '[' or '[^' is literal in PCRE/JS/Rust
    if (pattern[pos] === "]") {
      items.push("]");
      pos++;
    }
    while (pos < pattern.length && pattern[pos] !== "]") {
      if (pattern[pos] === "\\") {
        if (pos + 1 < pattern.length) {
          items.push(pattern.slice(pos, pos + 2));
          pos += 2;
        } else {
          pos++;
        }
      } else {
        const c = pattern[pos];
        if (pos + 2 < pattern.length && pattern[pos + 1] === "-" && pattern[pos + 2] !== "]") {
          let endToken = pattern[pos + 2];
          if (endToken === "\\" && pos + 3 < pattern.length) {
            endToken = pattern.slice(pos + 2, pos + 4);
            items.push(`${c}-${endToken}`);
            pos += 4;
          } else {
            items.push(`${c}-${endToken}`);
            pos += 3;
          }
        } else {
          items.push(c);
          pos++;
        }
      }
    }
    if (pattern[pos] !== "]") {
      throw new Error("Unclosed '[' character class");
    }
    pos++;
    return {
      type: "charset",
      raw: pattern.slice(start, pos),
      negated,
      items: items.slice(0, 12),
    };
  }

  function parseEscape(): RegexAstNode {
    pos++; // consume '\'
    if (pos >= pattern.length) {
      return { type: "literal", text: "\\" };
    }
    const ch = pattern[pos];
    pos++;
    if (ch === "b") return { type: "anchor", raw: "\\b", kind: "word" };
    if (ch === "B") return { type: "anchor", raw: "\\B", kind: "nonWord" };
    if ("dDwWsS".includes(ch)) {
      return { type: "escape", raw: `\\${ch}`, code: ch };
    }
    if (ch === "x" && /^[0-9a-fA-F]{2}/.test(pattern.slice(pos, pos + 2))) {
      const hex = pattern.slice(pos, pos + 2);
      pos += 2;
      return { type: "escape", raw: `\\x${hex}`, code: `x${hex}` };
    }
    if (ch === "u") {
      if (pattern[pos] === "{") {
        const end = pattern.indexOf("}", pos + 1);
        if (end !== -1) {
          const hex = pattern.slice(pos + 1, end);
          pos = end + 1;
          return { type: "escape", raw: `\\u{${hex}}`, code: `u{${hex}}` };
        }
      } else if (/^[0-9a-fA-F]{4}/.test(pattern.slice(pos, pos + 4))) {
        const hex = pattern.slice(pos, pos + 4);
        pos += 4;
        return { type: "escape", raw: `\\u${hex}`, code: `u${hex}` };
      }
    }
    if ("ntr0fv".includes(ch) || /[1-9]/.test(ch)) {
      return { type: "escape", raw: `\\${ch}`, code: ch };
    }
    return { type: "literal", text: ch };
  }

  function parseQuantifiers(node: RegexAstNode): RegexAstNode {
    let cur = node;
    while (pos < pattern.length) {
      const ch = pattern[pos];
      let min: number;
      let max: number | null;
      let consumed = 0;

      if (ch === "?") {
        min = 0;
        max = 1;
        consumed = 1;
      } else if (ch === "*") {
        min = 0;
        max = null;
        consumed = 1;
      } else if (ch === "+") {
        min = 1;
        max = null;
        consumed = 1;
      } else if (ch === "{") {
        const m = /^\{\s*(\d+)\s*(?:,\s*(\d*)\s*)?\}/.exec(pattern.slice(pos));
        if (!m) break;
        min = Number(m[1]);
        max = m[2] === undefined ? min : m[2] === "" ? null : Number(m[2]);
        consumed = m[0].length;
      } else {
        break;
      }

      pos += consumed;
      let greedy = true;
      if (pattern[pos] === "?" || pattern[pos] === "+") {
        if (pattern[pos] === "?") greedy = false;
        pos++;
      }
      cur = { type: "quant", min, max, greedy, target: cur };
    }
    return cur;
  }

  try {
    if (!pattern) {
      return { ast: { type: "seq", items: [] }, error: null };
    }
    const ast = parseAlt(0);
    if (pos < pattern.length) {
      throw new Error(`Unexpected '${pattern[pos]}' at position ${pos}`);
    }
    return { ast, error: null };
  } catch (e) {
    return { ast: { type: "seq", items: [] }, error: (e as Error).message };
  }
}

// --- Railroad SVG Renderer ---

interface BoxLayout {
  w: number;
  h: number;
  anchorY: number;
  draw: (x: number, y: number) => string;
}

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function measureText(s: string, pxPerChar = 7.6): number {
  let units = 0;
  for (const ch of s) {
    units += ch.charCodeAt(0) > 0x2e7f ? 1.85 : 1;
  }
  return Math.max(18, Math.ceil(units * pxPerChar));
}

function pillBox(
  label: string,
  fill: string,
  stroke: string,
  textFill: string,
  sub?: string,
  radius = 6,
): BoxLayout {
  const mainW = measureText(label) + 18;
  const subW = sub ? measureText(sub, 6.5) + 12 : 0;
  const w = Math.max(mainW, subW);
  const h = sub ? 34 : 26;
  const anchorY = sub ? 14 : 13;

  return {
    w,
    h,
    anchorY,
    draw(x: number, y: number) {
      const midX = x + w / 2;
      const boxH = 26;
      const svg = [
        `<rect x="${x}" y="${y}" width="${w}" height="${boxH}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>`,
        `<text x="${midX}" y="${y + 17}" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="11.5" font-weight="600" fill="${textFill}">${escXml(label)}</text>`,
      ];
      if (sub) {
        svg.push(
          `<text x="${midX}" y="${y + boxH + 10}" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="9.5" fill="#64748b">${escXml(sub)}</text>`,
        );
      }
      return svg.join("");
    },
  };
}

function escapeHuman(code: string): string {
  switch (code) {
    case "d": return "\\d  0-9";
    case "D": return "\\D  non-digit";
    case "w": return "\\w  word";
    case "W": return "\\W  non-word";
    case "s": return "\\s  space";
    case "S": return "\\S  non-space";
    case "n": return "\\n  LF";
    case "t": return "\\t  TAB";
    case "r": return "\\r  CR";
    default: return `\\${code}`;
  }
}

function anchorHuman(anchor: Extract<RegexAstNode, { type: "anchor" }>): string {
  switch (anchor.kind) {
    case "start": return "^ Start";
    case "end": return "$ End";
    case "word": return "\\b Boundary";
    case "nonWord": return "\\B Non-Bound";
  }
}

function quantBadge(min: number, max: number | null, greedy: boolean): string {
  const lazy = greedy ? "" : "? lazy";
  if (min === 0 && max === 1) return `0..1${lazy}`;
  if (min === 0 && max === null) return `0+${lazy}`;
  if (min === 1 && max === null) return `1+${lazy}`;
  if (max === null) return `{${min},+}${lazy}`;
  if (min === max) return `×${min}${lazy}`;
  return `${min}..${max}${lazy}`;
}

function layoutNode(node: RegexAstNode): BoxLayout {
  switch (node.type) {
    case "literal":
      return pillBox(JSON.stringify(node.text), "#eff6ff", "#3b82f6", "#1e3a8a");
    case "any":
      return pillBox(". any char", "#fef3c7", "#d97706", "#78350f");
    case "anchor":
      return pillBox(anchorHuman(node), "#f3e8ff", "#9333ea", "#581c87", undefined, 12);
    case "escape":
      return pillBox(escapeHuman(node.code), "#fef3c7", "#d97706", "#78350f");
    case "charset": {
      const preview = node.items.slice(0, 4).join(" ") + (node.items.length > 4 ? " …" : "");
      const title = node.negated ? `[^] NOT (${preview})` : `[${preview}]`;
      return pillBox(title, "#fff7ed", "#ea580c", "#7c2d12");
    }
    case "seq": {
      if (node.items.length === 0) {
        return {
          w: 24,
          h: 16,
          anchorY: 8,
          draw: (x, y) => `<line x1="${x}" y1="${y + 8}" x2="${x + 24}" y2="${y + 8}" stroke="#64748b" stroke-width="1.6"/>`,
        };
      }
      const children = node.items.map(layoutNode);
      const gap = 14;
      const w = children.reduce((a, b) => a + b.w, 0) + gap * (children.length - 1);
      const above = Math.max(...children.map((c) => c.anchorY));
      const below = Math.max(...children.map((c) => c.h - c.anchorY));
      const h = above + below;
      return {
        w,
        h,
        anchorY: above,
        draw(x, y) {
          const out: string[] = [];
          let cx = x;
          children.forEach((child, idx) => {
            const cy = y + above - child.anchorY;
            out.push(child.draw(cx, cy));
            if (idx < children.length - 1) {
              const lineY = y + above;
              out.push(
                `<line x1="${cx + child.w}" y1="${lineY}" x2="${cx + child.w + gap}" y2="${lineY}" stroke="#64748b" stroke-width="1.6"/>`,
              );
            }
            cx += child.w + gap;
          });
          return out.join("");
        },
      };
    }
    case "alt": {
      const branches = node.branches.map(layoutNode);
      const rail = 22;
      const vGap = 12;
      const innerW = Math.max(...branches.map((b) => b.w));
      const w = innerW + rail * 2;
      const h = branches.reduce((sum, b) => sum + b.h, 0) + vGap * (branches.length - 1);
      const anchorY = branches[0].anchorY;
      return {
        w,
        h,
        anchorY,
        draw(x, y) {
          const out: string[] = [];
          const trunkY = y + anchorY;
          let cy = y;
          branches.forEach((b, idx) => {
            const bx = x + (w - b.w) / 2;
            const by = cy + b.anchorY;
            out.push(b.draw(bx, cy));
            if (idx === 0) {
              out.push(`<line x1="${x}" y1="${trunkY}" x2="${bx}" y2="${by}" stroke="#64748b" stroke-width="1.6"/>`);
              out.push(`<line x1="${bx + b.w}" y1="${by}" x2="${x + w}" y2="${trunkY}" stroke="#64748b" stroke-width="1.6"/>`);
            } else {
              const c1 = x + rail * 0.55;
              const c2 = x + w - rail * 0.55;
              out.push(
                `<path d="M ${x} ${trunkY} C ${c1} ${trunkY}, ${c1} ${by}, ${bx} ${by}" fill="none" stroke="#64748b" stroke-width="1.6"/>`,
              );
              out.push(
                `<path d="M ${bx + b.w} ${by} C ${c2} ${by}, ${c2} ${trunkY}, ${x + w} ${trunkY}" fill="none" stroke="#64748b" stroke-width="1.6"/>`,
              );
            }
            cy += b.h + vGap;
          });
          return out.join("");
        },
      };
    }
    case "group": {
      const inner = layoutNode(node.body);
      const padX = 12;
      const padTop = 18;
      const padBot = 10;
      const titleMap: Record<GroupKind, string> = {
        capture: `Group #${node.index ?? "?"}`,
        named: `Group #${node.index ?? "?"} "${node.name ?? ""}"`,
        noncap: "Non-capturing (?:)",
        lookahead: "Lookahead (?=)",
        negLookahead: "Neg Lookahead (?!)",
        lookbehind: "Lookbehind (?<=)",
        negLookbehind: "Neg Lookbehind (?<!)",
        flags: `Flags (?${node.name ?? ""})`,
      };
      const title = titleMap[node.kind];
      const titleW = measureText(title, 6.8) + 12;
      const boxW = Math.max(inner.w + padX * 2, titleW);
      const boxH = inner.h + padTop + padBot;
      const anchorY = padTop + inner.anchorY;
      return {
        w: boxW,
        h: boxH,
        anchorY,
        draw(x, y) {
          const innerX = x + (boxW - inner.w) / 2;
          const innerY = y + padTop;
          const midY = y + anchorY;
          return [
            `<rect x="${x}" y="${y + 8}" width="${boxW}" height="${boxH - 8}" rx="6" fill="rgba(20,184,166,0.06)" stroke="#0d9488" stroke-width="1.2" stroke-dasharray="4 3"/>`,
            `<rect x="${x + 6}" y="${y}" width="${titleW - 6}" height="15" rx="3" fill="#0d9488"/>`,
            `<text x="${x + 6 + (titleW - 6) / 2}" y="${y + 11}" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="9.5" font-weight="600" fill="#ffffff">${escXml(title)}</text>`,
            `<line x1="${x}" y1="${midY}" x2="${innerX}" y2="${midY}" stroke="#64748b" stroke-width="1.6"/>`,
            inner.draw(innerX, innerY),
            `<line x1="${innerX + inner.w}" y1="${midY}" x2="${x + boxW}" y2="${midY}" stroke="#64748b" stroke-width="1.6"/>`,
          ].join("");
        },
      };
    }
    case "quant": {
      const target = layoutNode(node.target);
      const canSkip = node.min === 0;
      const canRepeat = node.max === null || node.max > 1;
      const badge = quantBadge(node.min, node.max, node.greedy);
      const badgeW = measureText(badge, 6.4) + 8;
      const rail = 18;
      const innerW = Math.max(target.w, badgeW);
      const w = innerW + rail * 2;
      const topPad = canSkip ? 18 : 4;
      const botPad = canRepeat ? 22 : 6;
      const h = topPad + target.h + botPad;
      const anchorY = topPad + target.anchorY;
      return {
        w,
        h,
        anchorY,
        draw(x, y) {
          const out: string[] = [];
          const tx = x + (w - target.w) / 2;
          const ty = y + topPad;
          const midY = y + anchorY;
          out.push(`<line x1="${x}" y1="${midY}" x2="${tx}" y2="${midY}" stroke="#64748b" stroke-width="1.6"/>`);
          out.push(target.draw(tx, ty));
          out.push(`<line x1="${tx + target.w}" y1="${midY}" x2="${x + w}" y2="${midY}" stroke="#64748b" stroke-width="1.6"/>`);
          if (canSkip) {
            const skipY = y + 8;
            out.push(
              `<path d="M ${x + 3} ${midY} C ${x + 3} ${skipY}, ${x + 12} ${skipY}, ${x + 18} ${skipY} L ${x + w - 18} ${skipY} C ${x + w - 12} ${skipY}, ${x + w - 3} ${skipY}, ${x + w - 3} ${midY}" fill="none" stroke="#94a3b8" stroke-width="1.4" stroke-dasharray="3 2"/>`,
            );
          }
          if (canRepeat) {
            const loopY = y + topPad + target.h + 10;
            const leftX = tx - 8;
            const rightX = tx + target.w + 8;
            out.push(
              `<path d="M ${rightX} ${midY} C ${rightX + 8} ${midY}, ${rightX + 8} ${loopY}, ${rightX - 4} ${loopY} L ${leftX + 4} ${loopY} C ${leftX - 8} ${loopY}, ${leftX - 8} ${midY}, ${leftX} ${midY}" fill="none" stroke="#0284c7" stroke-width="1.4"/>`,
            );
            // Tiny return arrowhead pointing left on the loop track
            const mx = x + w / 2;
            out.push(
              `<rect x="${mx - badgeW / 2}" y="${loopY - 7}" width="${badgeW}" height="14" rx="4" fill="#e0f2fe" stroke="#0284c7" stroke-width="1"/>`,
              `<text x="${mx}" y="${loopY + 3}" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="9.5" font-weight="600" fill="#0369a1">${escXml(badge)}</text>`,
            );
          } else {
            const mx = x + w / 2;
            out.push(
              `<rect x="${mx - badgeW / 2}" y="${y + 1}" width="${badgeW}" height="13" rx="4" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1"/>`,
              `<text x="${mx}" y="${y + 10.5}" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="9" font-weight="600" fill="#475569">${escXml(badge)}</text>`,
            );
          }
          return out.join("");
        },
      };
    }
  }
}

export function renderRegexRailroadSvg(
  pattern: string,
  flags = "",
): { svg: string; width: number; height: number; error: string | null } {
  const { ast, error } = parseRegexAst(pattern);
  if (error) {
    const msg = `Parse error: ${error}`;
    const width = Math.max(260, measureText(msg, 7.2) + 32);
    const height = 64;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" rx="8" fill="#fef2f2" stroke="#fca5a5"/><text x="16" y="37" font-family="ui-monospace,monospace" font-size="12" fill="#991b1b">${escXml(msg)}</text></svg>`;
    return { svg, width, height, error };
  }

  const content = layoutNode(ast);
  const padX = 32;
  const topHeader = flags ? 26 : 16;
  const padBot = 16;
  const width = Math.max(160, Math.ceil(content.w + padX * 2));
  const height = Math.max(72, Math.ceil(content.h + topHeader + padBot));
  const railY = topHeader + content.anchorY;
  const endX = width - padX;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" rx="8" fill="#f8fafc"/>`,
  ];
  if (flags) {
    parts.push(
      `<text x="12" y="16" font-family="ui-monospace,monospace" font-size="10.5" fill="#64748b">flags: /${escXml(flags)}/</text>`,
    );
  }
  parts.push(
    `<line x1="14" y1="${railY}" x2="${padX}" y2="${railY}" stroke="#475569" stroke-width="1.8"/>`,
    `<circle cx="14" cy="${railY}" r="4.5" fill="#475569"/>`,
    content.draw(padX, topHeader),
    `<line x1="${padX + content.w}" y1="${railY}" x2="${endX + 16}" y2="${railY}" stroke="#475569" stroke-width="1.8"/>`,
    `<circle cx="${endX + 16}" cy="${railY}" r="5.5" fill="#f8fafc" stroke="#475569" stroke-width="2"/>`,
    `<circle cx="${endX + 16}" cy="${railY}" r="2.2" fill="#475569"/>`,
    `</svg>`,
  );
  return { svg: parts.join(""), width, height, error: null };
}

export function explainRegexAst(pattern: string): RegexExplainItem[] {
  const { ast, error } = parseRegexAst(pattern);
  if (error) {
    return [{ depth: 0, token: pattern, descEn: `Syntax error: ${error}`, descZh: `语法错误：${error}` }];
  }
  const out: RegexExplainItem[] = [];
  function walk(node: RegexAstNode, depth: number) {
    switch (node.type) {
      case "seq":
        node.items.forEach((it) => walk(it, depth));
        break;
      case "alt":
        out.push({
          depth,
          token: `| (${node.branches.length} branches)`,
          descEn: `Match any one of ${node.branches.length} alternatives`,
          descZh: `多选一分支（共 ${node.branches.length} 路）`,
        });
        node.branches.forEach((b, i) => {
          out.push({ depth: depth + 1, token: `#${i + 1}`, descEn: `Branch ${i + 1}:`, descZh: `分支 ${i + 1}：` });
          walk(b, depth + 2);
        });
        break;
      case "literal":
        out.push({
          depth,
          token: JSON.stringify(node.text),
          descEn: `Literal text ${JSON.stringify(node.text)}`,
          descZh: `精确匹配文本 ${JSON.stringify(node.text)}`,
        });
        break;
      case "any":
        out.push({
          depth,
          token: ".",
          descEn: "Any single character (including newline if /s is set)",
          descZh: "任意单个字符（启用 /s 时包含换行）",
        });
        break;
      case "anchor": {
        const map: Record<typeof node.kind, [string, string]> = {
          start: ["Start of string (or line with /m)", "匹配字符串开头（/m 下匹配行首）"],
          end: ["End of string (or line with /m)", "匹配字符串结尾（/m 下匹配行尾）"],
          word: ["Word boundary between \\w and \\W", "匹配单词边界"],
          nonWord: ["Non-word boundary", "匹配非单词边界"],
        };
        out.push({ depth, token: node.raw, descEn: map[node.kind][0], descZh: map[node.kind][1] });
        break;
      }
      case "escape": {
        const map: Record<string, [string, string]> = {
          d: ["ASCII/Unicode digit [0-9]", "数字字符 [0-9]"],
          D: ["Non-digit character", "非数字字符"],
          w: ["Word character [a-zA-Z0-9_]", "单词字符（字母/数字/下划线）"],
          W: ["Non-word character", "非单词字符"],
          s: ["Whitespace (space, tab, newline)", "空白字符（空格/制表符/换行）"],
          S: ["Non-whitespace character", "非空白字符"],
          n: ["Line feed (\\n)", "换行符 (LF)"],
          t: ["Horizontal tab (\\t)", "制表符 (Tab)"],
          r: ["Carriage return (\\r)", "回车符 (CR)"],
        };
        const [en, zh] = map[node.code] ?? [`Escaped sequence ${node.raw}`, `转义序列 ${node.raw}`];
        out.push({ depth, token: node.raw, descEn: en, descZh: zh });
        break;
      }
      case "charset":
        out.push({
          depth,
          token: node.raw,
          descEn: node.negated ? `Any character NOT in ${node.raw}` : `Any character matching class ${node.raw}`,
          descZh: node.negated ? `排除字符集 ${node.raw} 之外的任意字符` : `匹配字符集 ${node.raw} 中的任意单字符`,
        });
        break;
      case "group": {
        const descMap: Record<GroupKind, [string, string]> = {
          capture: [`Capturing group #${node.index}`, `第 ${node.index} 捕获组`],
          named: [`Named capturing group #${node.index} (${node.name})`, `命名捕获组 #${node.index} (${node.name})`],
          noncap: ["Non-capturing group", "非捕获分组"],
          lookahead: ["Positive lookahead", "正向肯定先行断言"],
          negLookahead: ["Negative lookahead", "正向否定先行断言"],
          lookbehind: ["Positive lookbehind", "反向肯定后行断言"],
          negLookbehind: ["Negative lookbehind", "反向否定后行断言"],
          flags: [`Inline flags (?${node.name ?? ""})`, `内联修饰符 (?${node.name ?? ""})`],
        };
        const [en, zh] = descMap[node.kind];
        out.push({ depth, token: node.name ? `(?<${node.name}>...)` : "(...)", descEn: en, descZh: zh });
        walk(node.body, depth + 1);
        break;
      }
      case "quant": {
        const rangeEn =
          node.max === null
            ? `${node.min} or more times`
            : node.min === node.max
              ? `exactly ${node.min} times`
              : `${node.min} to ${node.max} times`;
        const rangeZh =
          node.max === null
            ? `重复至少 ${node.min} 次`
            : node.min === node.max
              ? `精确重复 ${node.min} 次`
              : `重复 ${node.min} 到 ${node.max} 次`;
        const modeEn = node.greedy ? "(greedy)" : "(lazy / non-greedy)";
        const modeZh = node.greedy ? "（贪婪）" : "（非贪婪）";
        out.push({
          depth,
          token: quantBadge(node.min, node.max, node.greedy),
          descEn: `Quantifier: ${rangeEn} ${modeEn}`,
          descZh: `量词：${rangeZh}${modeZh}`,
        });
        walk(node.target, depth + 1);
        break;
      }
    }
  }
  walk(ast, 0);
  return out;
}
