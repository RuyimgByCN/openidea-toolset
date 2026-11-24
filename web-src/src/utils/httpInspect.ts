export interface ParsedUa {
  raw: string;
  browser: string;
  browserVersion: string;
  engine: string;
  engineVersion: string;
  os: string;
  osVersion: string;
  deviceType: "Desktop" | "Mobile" | "Tablet" | "Bot" | "CLI" | "Unknown";
  arch: string;
  isBot: boolean;
  botName: string;
}

export interface HeaderEntry {
  name: string;
  value: string;
  sensitive: boolean;
}

export interface CacheDirective {
  name: string;
  value: string;
  descEn: string;
  descZh: string;
}

export interface ParsedCookie {
  name: string;
  valueMasked: string;
  domain: string;
  path: string;
  expires: string;
  maxAge: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  warningsEn: string[];
  warningsZh: string[];
}

export interface CspDirective {
  directive: string;
  sources: string[];
  riskEn?: string;
  riskZh?: string;
}

export interface SecurityCheckItem {
  header: string;
  status: "pass" | "warn" | "missing";
  value: string;
  noteEn: string;
  noteZh: string;
}

export interface HttpHeaderInspection {
  headers: HeaderEntry[];
  cacheControl: CacheDirective[];
  cookies: ParsedCookie[];
  csp: CspDirective[];
  audit: SecurityCheckItem[];
}

const SENSITIVE_HEADER_SET = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "x-auth-token",
]);

function cap(re: RegExp, text: string): string {
  return re.exec(text)?.[1] ?? "";
}

export function parseUserAgent(ua: string): ParsedUa {
  const s = ua.trim();
  if (!s) {
    return {
      raw: "",
      browser: "Unknown",
      browserVersion: "",
      engine: "Unknown",
      engineVersion: "",
      os: "Unknown",
      osVersion: "",
      deviceType: "Unknown",
      arch: "Unknown",
      isBot: false,
      botName: "",
    };
  }

  let isBot = false;
  let botName = "";
  const botMatch = /(Googlebot|Bingbot|Baiduspider|DuckDuckBot|YandexBot|Slurp|facebookexternalhit|Twitterbot|GPTBot|ClaudeBot|Bytespider|curl|Wget|HTTPie|PostmanRuntime|python-requests|Go-http-client|okhttp|axios)\/?([\d.]*)/i.exec(s);
  if (botMatch) {
    isBot = true;
    botName = botMatch[2] ? `${botMatch[1]} ${botMatch[2]}` : botMatch[1];
  } else if (/\b(bot|spider|crawler|slurp|headless)\b/i.test(s)) {
    isBot = true;
    botName = "Automated Bot / Crawler";
  }

  const isCli = /^(curl|Wget|HTTPie|PostmanRuntime|python-requests|Go-http-client|okhttp|axios)/i.test(s);

  let browser = "Unknown";
  let browserVersion = "";
  if (/EdgA?|EdgiOS|Edg\//.test(s)) {
    browser = "Microsoft Edge";
    browserVersion = cap(/Edg(?:A|iOS)?\/([\d.]+)/, s);
  } else if (/OPR\/|Opera/.test(s)) {
    browser = "Opera";
    browserVersion = cap(/(?:OPR|Version)\/([\d.]+)/, s);
  } else if (/MicroMessenger\//.test(s)) {
    browser = "WeChat WebView";
    browserVersion = cap(/MicroMessenger\/([\d.]+)/, s);
  } else if (/Firefox\/|FxiOS\//.test(s)) {
    browser = "Mozilla Firefox";
    browserVersion = cap(/(?:Firefox|FxiOS)\/([\d.]+)/, s);
  } else if (/CriOS\/|Chrome\//.test(s) && !/Edg/.test(s)) {
    browser = "Google Chrome";
    browserVersion = cap(/(?:Chrome|CriOS)\/([\d.]+)/, s);
  } else if (/Safari\//.test(s) && /Version\//.test(s)) {
    browser = "Safari";
    browserVersion = cap(/Version\/([\d.]+)/, s);
  } else if (isBot && botMatch) {
    browser = botMatch[1];
    browserVersion = botMatch[2] || "";
  }

  let engine = "Unknown";
  let engineVersion = "";
  if (/AppleWebKit\//.test(s) && (/Chrome\//.test(s) || /Edg\//.test(s) || /CriOS\//.test(s))) {
    engine = "Blink";
    engineVersion = cap(/AppleWebKit\/([\d.]+)/, s);
  } else if (/AppleWebKit\//.test(s)) {
    engine = "WebKit";
    engineVersion = cap(/AppleWebKit\/([\d.]+)/, s);
  } else if (/Gecko\//.test(s) || /Firefox\//.test(s)) {
    engine = "Gecko";
    engineVersion = cap(/rv:([\d.]+)/, s);
  } else if (isCli) {
    engine = "CLI / HTTP Client";
  }

  let os = "Unknown";
  let osVersion = "";
  if (/Windows NT ([\d.]+)/.test(s)) {
    os = "Windows";
    const nt = cap(/Windows NT ([\d.]+)/, s);
    osVersion = nt === "10.0" ? "10/11 (NT 10.0)" : nt === "6.3" ? "8.1" : nt === "6.1" ? "7" : nt;
  } else if (/Android ([\d.]+)/.test(s)) {
    os = "Android";
    osVersion = cap(/Android ([\d.]+)/, s);
  } else if (/iPhone OS ([\d_]+)|iPad; CPU OS ([\d_]+)/.test(s)) {
    os = /iPad/.test(s) ? "iPadOS" : "iOS";
    osVersion = (cap(/(?:iPhone OS|CPU OS) ([\d_]+)/, s) || "").replace(/_/g, ".");
  } else if (/Mac OS X ([\d_]+)/.test(s)) {
    os = "macOS";
    osVersion = cap(/Mac OS X ([\d_]+)/, s).replace(/_/g, ".");
  } else if (/CrOS/.test(s)) {
    os = "ChromeOS";
  } else if (/Linux/.test(s)) {
    os = "Linux";
  }

  let deviceType: ParsedUa["deviceType"] = "Desktop";
  if (isCli) deviceType = "CLI";
  else if (isBot) deviceType = "Bot";
  else if (/iPad|Tablet|PlayBook|Silk/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s))) {
    deviceType = "Tablet";
  } else if (/Mobi|iPhone|iPod|Android.*Mobile/i.test(s)) {
    deviceType = "Mobile";
  } else if (browser === "Unknown" && os === "Unknown") {
    deviceType = "Unknown";
  }

  let arch = "Unknown";
  if (/arm64|aarch64/i.test(s)) arch = "ARM64";
  else if (/x86_64|x64|Win64|WOW64|amd64/i.test(s)) arch = "x86_64";
  else if (/i[36]86|x86/i.test(s)) arch = "x86";
  else if (/Mac OS X/.test(s)) arch = "Apple Silicon / x86_64";

  return {
    raw: s,
    browser,
    browserVersion,
    engine,
    engineVersion,
    os,
    osVersion,
    deviceType,
    arch,
    isBot,
    botName,
  };
}

const CACHE_DIR_DOCS: Record<string, [string, string]> = {
  "public": ["May be cached by any shared/proxy CDN cache", "允许任何代理与 CDN 公共缓存"],
  "private": ["Browser-only cache; shared CDNs must not store", "仅限用户浏览器缓存，禁止 CDN 共享缓存"],
  "no-cache": ["Must revalidate with origin (ETag/Last-Modified) before reuse", "使用缓存前必须向源站校验新鲜度 (ETag)"],
  "no-store": ["Do not store any part of request or response in cache", "完全禁止浏览器与代理存储响应内容"],
  "must-revalidate": ["Expired responses must never be served without revalidation", "过期后必须向源站重新校验"],
  "immutable": ["Response body will not change during max-age lifetime", "有效期内内容永不变更，跳过刷新校验"],
  "max-age": ["Freshness lifetime in seconds from generation", "缓存最大有效秒数 (TTL)"],
  "s-maxage": ["Shared CDN/proxy cache TTL in seconds (overrides max-age)", "CDN/共享代理缓存有效秒数"],
  "stale-while-revalidate": ["Serve stale response temporarily while revalidating async", "异步后台回源更新期间允许短暂返回旧缓存"],
};

function maskSecretValue(val: string): string {
  const t = val.trim();
  if (t.length <= 6) return "••••••";
  return `${t.slice(0, 3)}•••${t.slice(-2)} (${t.length} chars)`;
}

export function inspectHttpHeaders(raw: string): HttpHeaderInspection {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const headers: HeaderEntry[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(HTTP\/|GET |POST |PUT |DELETE |PATCH |HEAD |OPTIONS )/i.test(trimmed) && !trimmed.includes(": ")) {
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    headers.push({
      name,
      value,
      sensitive: SENSITIVE_HEADER_SET.has(name.toLowerCase()),
    });
  }

  const getFirst = (target: string) =>
    headers.find((h) => h.name.toLowerCase() === target.toLowerCase())?.value ?? "";

  // Parse Cache-Control
  const cacheControl: CacheDirective[] = [];
  const ccRaw = getFirst("cache-control");
  if (ccRaw) {
    for (const token of ccRaw.split(",").map((t) => t.trim()).filter(Boolean)) {
      const [k, v] = token.split("=", 2);
      const kl = k.trim().toLowerCase();
      const doc = CACHE_DIR_DOCS[kl] ?? ["Custom or extension cache directive", "扩展或自定义缓存指令"];
      cacheControl.push({
        name: kl,
        value: v?.trim() ?? "true",
        descEn: doc[0],
        descZh: doc[1],
      });
    }
  }

  // Parse Set-Cookie
  const cookies: ParsedCookie[] = [];
  for (const h of headers.filter((item) => item.name.toLowerCase() === "set-cookie")) {
    const parts = h.value.split(";").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const [nv, ...attrs] = parts;
    const eq = nv.indexOf("=");
    const cName = eq >= 0 ? nv.slice(0, eq).trim() : nv;
    const cVal = eq >= 0 ? nv.slice(eq + 1).trim() : "";

    let domain = "";
    let path = "";
    let expires = "";
    let maxAge = "";
    let secure = false;
    let httpOnly = false;
    let sameSite = "";

    for (const attr of attrs) {
      const aEq = attr.indexOf("=");
      const ak = (aEq >= 0 ? attr.slice(0, aEq) : attr).trim().toLowerCase();
      const av = aEq >= 0 ? attr.slice(aEq + 1).trim() : "";
      if (ak === "domain") domain = av;
      else if (ak === "path") path = av;
      else if (ak === "expires") expires = av;
      else if (ak === "max-age") maxAge = av;
      else if (ak === "secure") secure = true;
      else if (ak === "httponly") httpOnly = true;
      else if (ak === "samesite") sameSite = av;
    }

    const warningsEn: string[] = [];
    const warningsZh: string[] = [];
    if (!secure) {
      warningsEn.push("Missing Secure flag (transmitted over plain HTTP)");
      warningsZh.push("缺少 Secure 标记（可能经由明文 HTTP 传输）");
    }
    if (!httpOnly) {
      warningsEn.push("Missing HttpOnly (accessible via document.cookie / XSS)");
      warningsZh.push("缺少 HttpOnly 标记（JS 可读取，存在 XSS 盗取风险）");
    }
    if (!sameSite) {
      warningsEn.push("SameSite not explicitly specified");
      warningsZh.push("未显式声明 SameSite 策略");
    } else if (sameSite.toLowerCase() === "none" && !secure) {
      warningsEn.push("SameSite=None requires Secure attribute");
      warningsZh.push("SameSite=None 必须同时启用 Secure");
    }

    cookies.push({
      name: cName,
      valueMasked: maskSecretValue(cVal),
      domain,
      path,
      expires,
      maxAge,
      secure,
      httpOnly,
      sameSite,
      warningsEn,
      warningsZh,
    });
  }

  // Parse Content-Security-Policy
  const csp: CspDirective[] = [];
  const cspRaw = getFirst("content-security-policy");
  if (cspRaw) {
    for (const seg of cspRaw.split(";").map((s) => s.trim()).filter(Boolean)) {
      const tokens = seg.split(/\s+/);
      const directive = tokens[0].toLowerCase();
      const sources = tokens.slice(1);
      let riskEn: string | undefined;
      let riskZh: string | undefined;
      if (sources.includes("'unsafe-inline'") || sources.includes("'unsafe-eval'")) {
        riskEn = "Contains unsafe-inline or unsafe-eval (weakens XSS protection)";
        riskZh = "包含 unsafe-inline 或 unsafe-eval，会削弱 XSS 防护";
      } else if (sources.includes("*")) {
        riskEn = "Wildcard source '*' allows loading from any origin";
        riskZh = "包含通配符 '*'，允许从任意源加载";
      }
      csp.push({ directive, sources, riskEn, riskZh });
    }
  }

  // Security Header Checklist
  const hsts = getFirst("strict-transport-security");
  const xcto = getFirst("x-content-type-options");
  const xfo = getFirst("x-frame-options");
  const refPol = getFirst("referrer-policy");
  const corsOrigin = getFirst("access-control-allow-origin");
  const corsCreds = getFirst("access-control-allow-credentials");

  const audit: SecurityCheckItem[] = [
    hsts
      ? {
          header: "Strict-Transport-Security",
          status: /max-age=\d+/.test(hsts) ? "pass" : "warn",
          value: hsts,
          noteEn: "Enforces HTTPS transport (HSTS)",
          noteZh: "已配置 HTTPS 强制传输 (HSTS)",
        }
      : {
          header: "Strict-Transport-Security",
          status: "missing",
          value: "",
          noteEn: "Consider max-age=31536000; includeSubDomains",
          noteZh: "建议配置 max-age=31536000; includeSubDomains",
        },
    cspRaw
      ? {
          header: "Content-Security-Policy",
          status: csp.some((d) => d.riskEn) ? "warn" : "pass",
          value: cspRaw,
          noteEn: csp.some((d) => d.riskEn) ? "CSP present but uses unsafe-* or wildcard" : "CSP mitigates XSS & injection",
          noteZh: csp.some((d) => d.riskZh) ? "已配置 CSP 但包含 unsafe-* 或 *" : "已配置 CSP 防护 XSS 注入",
        }
      : {
          header: "Content-Security-Policy",
          status: "missing",
          value: "",
          noteEn: "Missing CSP header",
          noteZh: "缺少 CSP 内容安全策略头",
        },
    xcto.toLowerCase() === "nosniff"
      ? {
          header: "X-Content-Type-Options",
          status: "pass",
          value: xcto,
          noteEn: "Prevents MIME-type sniffing",
          noteZh: "已禁用 MIME 类型嗅探",
        }
      : {
          header: "X-Content-Type-Options",
          status: xcto ? "warn" : "missing",
          value: xcto,
          noteEn: "Recommended value: nosniff",
          noteZh: "建议设为 nosniff",
        },
    xfo
      ? {
          header: "X-Frame-Options",
          status: "pass",
          value: xfo,
          noteEn: "Clickjacking protection enabled",
          noteZh: "已配置防点击劫持 (Clickjacking)",
        }
      : {
          header: "X-Frame-Options",
          status: cspRaw.includes("frame-ancestors") ? "pass" : "missing",
          value: cspRaw.includes("frame-ancestors") ? "(via CSP frame-ancestors)" : "",
          noteEn: cspRaw.includes("frame-ancestors") ? "Covered by CSP frame-ancestors" : "Consider DENY or SAMEORIGIN",
          noteZh: cspRaw.includes("frame-ancestors") ? "已由 CSP frame-ancestors 覆盖" : "建议设为 DENY 或 SAMEORIGIN",
        },
    refPol
      ? {
          header: "Referrer-Policy",
          status: "pass",
          value: refPol,
          noteEn: "Referrer leakage controlled",
          noteZh: "已限制 Referrer 信息泄露",
        }
      : {
          header: "Referrer-Policy",
          status: "missing",
          value: "",
          noteEn: "Consider strict-origin-when-cross-origin",
          noteZh: "建议设为 strict-origin-when-cross-origin",
        },
  ];

  if (corsOrigin) {
    const risky = corsOrigin === "*" && corsCreds.toLowerCase() === "true";
    audit.push({
      header: "CORS Policy",
      status: risky || corsOrigin === "*" ? "warn" : "pass",
      value: `${corsOrigin}${corsCreds ? ` (creds=${corsCreds})` : ""}`,
      noteEn: risky
        ? "Wildcard Access-Control-Allow-Origin * with Allow-Credentials is unsafe/invalid"
        : corsOrigin === "*"
          ? "Allows any origin (*); verify this endpoint is public"
          : "Origin-restricted CORS",
      noteZh: risky
        ? "通配符 * 与 Allow-Credentials=true 同时存在，不安全且不合规"
        : corsOrigin === "*"
          ? "允许任意源 (*) 跨域访问，请确认接口公开性"
          : "已限定特定跨域源",
    });
  }

  return { headers, cacheControl, cookies, csp, audit };
}
