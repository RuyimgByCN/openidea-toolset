export interface SvgMetrics {
  viewBox: string;
  width: string;
  height: string;
  originalBytes: number;
  minifiedBytes: number;
  savedPct: number;
  totalElements: number;
  tagCounts: Array<[string, number]>;
  dataUriUtf8: string;
  dataUriBase64: string;
  cssBackground: string;
}

const EDITOR_NS_ATTRS = new Set(["xmlns:inkscape", "xmlns:sodipodi"]);

function cleanTagAttributes(tagBody: string): string {
  // Lexical scan of attributes inside a single `<...>` tag body
  let out = "";
  let i = 0;
  let quote: '"' | "'" | null = null;
  while (i < tagBody.length) {
    const ch = tagBody[i];
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      while (i < tagBody.length && /\s/.test(tagBody[i])) i++;
      if (i < tagBody.length && !tagBody.startsWith("/>", i) && tagBody[i] !== ">") {
        // Check if upcoming attribute is inkscape:/sodipodi: metadata
        const rest = tagBody.slice(i);
        const attrMatch = /^([A-Za-z_][\w:-]*)\s*=\s*(?:"[^"]*"|'[^']*')/.exec(rest);
        if (attrMatch && (attrMatch[1].startsWith("inkscape:") || attrMatch[1].startsWith("sodipodi:") || EDITOR_NS_ATTRS.has(attrMatch[1]))) {
          i += attrMatch[0].length;
          continue;
        }
        out += " ";
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export function minifySvg(raw: string): string {
  const input = raw.trim();
  if (!input) return "";
  let out = "";
  let i = 0;
  let preserveTextDepth = 0;

  while (i < input.length) {
    if (input.startsWith("<!--", i)) {
      const end = input.indexOf("-->", i + 4);
      i = end === -1 ? input.length : end + 3;
      continue;
    }
    if (input.startsWith("<?", i)) {
      const end = input.indexOf("?>", i + 2);
      i = end === -1 ? input.length : end + 2;
      continue;
    }
    if (input.startsWith("<!DOCTYPE", i) || input.startsWith("<!doctype", i)) {
      const end = input.indexOf(">", i + 9);
      i = end === -1 ? input.length : end + 1;
      continue;
    }
    if (input.startsWith("<![CDATA[", i)) {
      const end = input.indexOf("]]>", i + 9);
      const stop = end === -1 ? input.length : end + 3;
      out += input.slice(i, stop);
      i = stop;
      continue;
    }
    if (input[i] === "<") {
      // Lexically find matching '>' outside quotes
      let j = i + 1;
      let q: '"' | "'" | null = null;
      while (j < input.length) {
        const ch = input[j];
        if (q) {
          if (ch === q) q = null;
        } else if (ch === '"' || ch === "'") {
          q = ch;
        } else if (ch === ">") {
          j++;
          break;
        }
        j++;
      }
      const rawTag = input.slice(i, j);
      const cleanedTag = cleanTagAttributes(rawTag);
      const tagNameMatch = /^<\s*(\/)?\s*([A-Za-z_][\w:-]*)/.exec(cleanedTag);
      if (tagNameMatch) {
        const isClosing = Boolean(tagNameMatch[1]);
        const name = tagNameMatch[2].toLowerCase();
        const isSelfClosing = cleanedTag.endsWith("/>");
        if (name === "text" || name === "tspan" || name === "style" || name === "script") {
          if (isClosing) preserveTextDepth = Math.max(0, preserveTextDepth - 1);
          else if (!isSelfClosing) preserveTextDepth++;
        }
      }
      out += cleanedTag;
      i = j;
      continue;
    }

    const nextTag = input.indexOf("<", i);
    const textChunk = input.slice(i, nextTag === -1 ? input.length : nextTag);
    i = nextTag === -1 ? input.length : nextTag;
    if (preserveTextDepth > 0) {
      out += textChunk;
    } else if (textChunk.trim()) {
      out += textChunk.replace(/\s+/g, " ");
    }
  }
  return out.trim();
}

export function formatSvg(raw: string, indentSize = 2): string {
  const min = minifySvg(raw);
  if (!min) return "";
  const lines: string[] = [];
  let depth = 0;
  let i = 0;
  const pad = (d: number) => " ".repeat(Math.max(0, d) * indentSize);

  while (i < min.length) {
    if (min[i] === "<") {
      let j = i + 1;
      let q: '"' | "'" | null = null;
      while (j < min.length) {
        const c = min[j];
        if (q) {
          if (c === q) q = null;
        } else if (c === '"' || c === "'") {
          q = c;
        } else if (c === ">") {
          j++;
          break;
        }
        j++;
      }
      const tag = min.slice(i, j);
      const isClose = tag.startsWith("</");
      const isSelf = tag.endsWith("/>");
      if (isClose) depth = Math.max(0, depth - 1);
      lines.push(`${pad(depth)}${tag}`);
      if (!isClose && !isSelf) depth++;
      i = j;
    } else {
      const next = min.indexOf("<", i);
      const chunk = min.slice(i, next === -1 ? min.length : next).trim();
      i = next === -1 ? min.length : next;
      if (chunk) lines.push(`${pad(depth)}${chunk}`);
    }
  }
  return lines.join("\n");
}

const SVG_ATTR_TO_JSX: Record<string, string> = {
  "class": "className",
  "for": "htmlFor",
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "stroke-miterlimit": "strokeMiterlimit",
  "stroke-opacity": "strokeOpacity",
  "fill-rule": "fillRule",
  "fill-opacity": "fillOpacity",
  "clip-rule": "clipRule",
  "clip-path": "clipPath",
  "stop-color": "stopColor",
  "stop-opacity": "stopOpacity",
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "font-weight": "fontWeight",
  "text-anchor": "textAnchor",
  "dominant-baseline": "dominantBaseline",
  "marker-start": "markerStart",
  "marker-mid": "markerMid",
  "marker-end": "markerEnd",
  "xlink:href": "href",
  "xmlns:xlink": "",
};

export function svgToJsx(raw: string, componentName = "SvgIcon"): string {
  const formatted = formatSvg(raw, 2);
  if (!formatted) return "";
  const safeName = /^[A-Z][A-Za-z0-9_]*$/.test(componentName.trim()) ? componentName.trim() : "SvgIcon";

  let jsx = formatted.replace(/<([A-Za-z][\w:-]*)([^<>]*?)(\s*\/?)>/g, (_full, tag: string, attrs: string, closeSlash: string) => {
    const cleanAttrs = attrs.replace(/\s+([a-zA-Z_:][\w:-]*)\s*=\s*("[^"]*"|'[^']*')/g, (_m, attr: string, val: string) => {
      const mapped = SVG_ATTR_TO_JSX[attr.toLowerCase()];
      if (mapped === "") return "";
      if (mapped) return ` ${mapped}=${val}`;
      if (attr.includes("-") && !attr.startsWith("data-") && !attr.startsWith("aria-")) {
        const camel = attr.replace(/-([a-z])/g, (_x, c: string) => c.toUpperCase());
        return ` ${camel}=${val}`;
      }
      return ` ${attr}=${val}`;
    });
    return `<${tag}${cleanAttrs}${closeSlash}>`;
  });
  jsx = jsx.replace(/^<svg\b([^>]*)>/, (_m, attrs: string) => `<svg${attrs} {...props}>`);
  const body = jsx
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
  return `import type { SVGProps } from "react";\n\nexport function ${safeName}(props: SVGProps<SVGSVGElement>) {\n  return (\n${body}\n  );\n}`;
}

export function inspectSvg(raw: string): SvgMetrics {
  const min = minifySvg(raw);
  const viewBox = /viewBox\s*=\s*["']([^"']+)["']/i.exec(raw)?.[1] ?? "—";
  const width = /\bwidth\s*=\s*["']([^"']+)["']/i.exec(raw)?.[1] ?? "—";
  const height = /\bheight\s*=\s*["']([^"']+)["']/i.exec(raw)?.[1] ?? "—";

  const counts = new Map<string, number>();
  const tagRe = /<\s*([a-zA-Z][\w:-]*)(?=[\s/>])/g;
  let m: RegExpExecArray | null;
  let totalElements = 0;
  while ((m = tagRe.exec(min)) !== null) {
    const t = m[1].toLowerCase();
    totalElements++;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const tagCounts = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);

  const enc = new TextEncoder();
  const originalBytes = enc.encode(raw).length;
  const minifiedBytes = enc.encode(min).length;
  const savedPct = originalBytes > 0 ? Math.max(0, Math.round(((originalBytes - minifiedBytes) / originalBytes) * 100)) : 0;

  const dataUriUtf8 = min ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(min)}` : "";
  let bin = "";
  for (const b of enc.encode(min)) bin += String.fromCharCode(b);
  const dataUriBase64 = min ? `data:image/svg+xml;base64,${btoa(bin)}` : "";
  const cssBackground = dataUriUtf8 ? `background-image: url("${dataUriUtf8}");` : "";

  return {
    viewBox,
    width,
    height,
    originalBytes,
    minifiedBytes,
    savedPct,
    totalElements,
    tagCounts,
    dataUriUtf8,
    dataUriBase64,
    cssBackground,
  };
}
