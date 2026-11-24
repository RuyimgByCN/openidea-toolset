import { useEffect, useMemo, useState } from "react";
import { copyToClipboard } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

type SymCat = "all" | "git" | "arrows" | "math" | "punct" | "box" | "currency" | "greek" | "status";

interface SymEntry {
  ch: string;
  cat: Exclude<SymCat, "all">;
  en: string;
  zh: string;
  kw: string;
}

const SYM_CATS: Array<{ id: SymCat; en: string; zh: string }> = [
  { id: "all", en: "All", zh: "全部" },
  { id: "git", en: "Git / Commit", zh: "Git 提交表情" },
  { id: "arrows", en: "Arrows", zh: "箭头" },
  { id: "math", en: "Math & Logic", zh: "数学与逻辑" },
  { id: "punct", en: "Typography", zh: "标点与排版" },
  { id: "box", en: "Box Drawing", zh: "制表符" },
  { id: "currency", en: "Currency", zh: "货币" },
  { id: "greek", en: "Greek", zh: "希腊字母" },
  { id: "status", en: "Status & UI", zh: "状态符号" },
];

const SYMBOLS: SymEntry[] = [
  // Git / Commit Emojis
  { ch: "✨", cat: "git", en: "feat: new feature", zh: "feat: 新功能", kw: "sparkles feat feature" },
  { ch: "🐛", cat: "git", en: "fix: bug fix", zh: "fix: 修复缺陷", kw: "bug fix" },
  { ch: "📝", cat: "git", en: "docs: documentation", zh: "docs: 文档更新", kw: "docs memo readme" },
  { ch: "♻️", cat: "git", en: "refactor: code refactor", zh: "refactor: 代码重构", kw: "refactor recycle" },
  { ch: "⚡", cat: "git", en: "perf: performance", zh: "perf: 性能优化", kw: "zap perf speed" },
  { ch: "✅", cat: "git", en: "test: passing tests", zh: "test: 添加或通过测试", kw: "check test pass" },
  { ch: "🎨", cat: "git", en: "style: formatting / UI", zh: "style: 格式与样式", kw: "art style format" },
  { ch: "🔧", cat: "git", en: "chore: config files", zh: "chore: 配置文件", kw: "wrench config chore" },
  { ch: "📦", cat: "git", en: "build: dependencies/pkg", zh: "build: 打包与依赖", kw: "package build deps" },
  { ch: "🚀", cat: "git", en: "deploy / release", zh: "发布与部署", kw: "rocket deploy release" },
  { ch: "🔒", cat: "git", en: "security fix", zh: "安全修复", kw: "lock security" },
  { ch: "🚨", cat: "git", en: "fix compiler/lint", zh: "消除编译器或 Lint 警告", kw: "lint warning siren" },
  { ch: "🏷️", cat: "git", en: "types / version tag", zh: "类型或版本标签", kw: "label types tag" },
  { ch: "🔥", cat: "git", en: "remove dead code/files", zh: "删除无用代码或文件", kw: "fire delete remove" },
  { ch: "🚧", cat: "git", en: "work in progress (WIP)", zh: "进行中 (WIP)", kw: "construction wip" },
  { ch: "💚", cat: "git", en: "fix CI build", zh: "修复 CI 构建", kw: "ci green heart" },
  { ch: "⬆️", cat: "git", en: "upgrade dependencies", zh: "升级依赖版本", kw: "upgrade deps arrow" },
  { ch: "⬇️", cat: "git", en: "downgrade dependencies", zh: "降级依赖版本", kw: "downgrade deps" },
  { ch: "🔀", cat: "git", en: "merge branches", zh: "合并分支", kw: "merge branch" },
  { ch: "🔖", cat: "git", en: "release bookmark tag", zh: "发布版本标签", kw: "tag bookmark release" },
  { ch: "💡", cat: "git", en: "add comments / idea", zh: "添加注释与思路", kw: "bulb comment idea" },
  { ch: "🗃️", cat: "git", en: "database changes", zh: "数据库变更", kw: "db sql migration" },
  { ch: "🧪", cat: "git", en: "add failing test / experiment", zh: "实验性测试", kw: "test tube lab" },
  { ch: "🦺", cat: "git", en: "validation / safety", zh: "校验与安全代码", kw: "validation safety" },
  // Arrows
  { ch: "→", cat: "arrows", en: "Rightwards Arrow", zh: "右箭头", kw: "right arrow" },
  { ch: "←", cat: "arrows", en: "Leftwards Arrow", zh: "左箭头", kw: "left arrow" },
  { ch: "↑", cat: "arrows", en: "Upwards Arrow", zh: "上箭头", kw: "up arrow" },
  { ch: "↓", cat: "arrows", en: "Downwards Arrow", zh: "下箭头", kw: "down arrow" },
  { ch: "↔", cat: "arrows", en: "Left Right Arrow", zh: "双向水平箭头", kw: "bidirectional swap" },
  { ch: "↕", cat: "arrows", en: "Up Down Arrow", zh: "双向垂直箭头", kw: "vertical arrow" },
  { ch: "⇒", cat: "arrows", en: "Double Right Arrow / Implies", zh: "双线右箭头 / 蕴含", kw: "implies double right" },
  { ch: "⇔", cat: "arrows", en: "If and Only If (IFF)", zh: "等价双向双箭头", kw: "iff double" },
  { ch: "➜", cat: "arrows", en: "Heavy Round-Tipped Arrow", zh: "粗右箭头", kw: "heavy arrow" },
  { ch: "↩", cat: "arrows", en: "Return / Enter Arrow", zh: "回车折返箭头", kw: "return enter" },
  { ch: "↻", cat: "arrows", en: "Clockwise Refresh", zh: "顺时针刷新", kw: "refresh reload" },
  { ch: "↺", cat: "arrows", en: "Counter-Clockwise Undo", zh: "逆时针撤销", kw: "undo revert" },
  { ch: "↗", cat: "arrows", en: "North East External Link", zh: "右上角外链箭头", kw: "external link" },
  { ch: "↘", cat: "arrows", en: "South East Arrow", zh: "右下箭头", kw: "south east" },
  // Math & Logic
  { ch: "≠", cat: "math", en: "Not Equal To", zh: "不等于", kw: "not equal neq" },
  { ch: "≈", cat: "math", en: "Approximately Equal", zh: "约等于", kw: "approx" },
  { ch: "≡", cat: "math", en: "Identical To / Mod", zh: "恒等于 / 同余", kw: "identical congruent" },
  { ch: "≤", cat: "math", en: "Less-Than or Equal", zh: "小于等于", kw: "le less equal" },
  { ch: "≥", cat: "math", en: "Greater-Than or Equal", zh: "大于等于", kw: "ge greater equal" },
  { ch: "±", cat: "math", en: "Plus-Minus", zh: "正负号", kw: "plus minus" },
  { ch: "×", cat: "math", en: "Multiplication Sign", zh: "乘号", kw: "times multiply" },
  { ch: "÷", cat: "math", en: "Division Sign", zh: "除号", kw: "divide div" },
  { ch: "∞", cat: "math", en: "Infinity", zh: "无穷大", kw: "infinity" },
  { ch: "√", cat: "math", en: "Square Root", zh: "平方根", kw: "sqrt root" },
  { ch: "∑", cat: "math", en: "N-Ary Summation", zh: "求和符号", kw: "sum sigma" },
  { ch: "∏", cat: "math", en: "N-Ary Product", zh: "连乘符号", kw: "product" },
  { ch: "∫", cat: "math", en: "Integral", zh: "积分号", kw: "integral" },
  { ch: "∂", cat: "math", en: "Partial Differential", zh: "偏导数", kw: "partial deriv" },
  { ch: "∈", cat: "math", en: "Element Of", zh: "属于集合", kw: "in element set" },
  { ch: "∉", cat: "math", en: "Not Element Of", zh: "不属于", kw: "not in" },
  { ch: "⊆", cat: "math", en: "Subset Of or Equal", zh: "子集", kw: "subset" },
  { ch: "∪", cat: "math", en: "Set Union", zh: "并集", kw: "union" },
  { ch: "∩", cat: "math", en: "Set Intersection", zh: "交集", kw: "intersection" },
  { ch: "∅", cat: "math", en: "Empty Set", zh: "空集", kw: "empty null set" },
  { ch: "∀", cat: "math", en: "For All", zh: "全称量词 / 任意", kw: "forall" },
  { ch: "∃", cat: "math", en: "There Exists", zh: "存在量词", kw: "exists" },
  { ch: "∧", cat: "math", en: "Logical AND", zh: "逻辑与", kw: "and logic" },
  { ch: "∨", cat: "math", en: "Logical OR", zh: "逻辑或", kw: "or logic" },
  { ch: "¬", cat: "math", en: "Logical NOT", zh: "逻辑非", kw: "not logic" },
  { ch: "⊕", cat: "math", en: "Circled Plus / XOR", zh: "异或 / 直和", kw: "xor circled plus" },
  { ch: "∴", cat: "math", en: "Therefore", zh: "所以", kw: "therefore" },
  { ch: "∵", cat: "math", en: "Because", zh: "因为", kw: "because" },
  { ch: "°", cat: "math", en: "Degree Sign", zh: "度数符号", kw: "degree angle temp" },
  { ch: "‰", cat: "math", en: "Per Mille Sign", zh: "千分号", kw: "permille" },
  // Typography & Punctuation
  { ch: "—", cat: "punct", en: "Em Dash", zh: "长破折号", kw: "em dash" },
  { ch: "–", cat: "punct", en: "En Dash", zh: "短连接号", kw: "en dash" },
  { ch: "…", cat: "punct", en: "Horizontal Ellipsis", zh: "省略号", kw: "ellipsis" },
  { ch: "•", cat: "punct", en: "Bullet", zh: "实心圆点", kw: "bullet dot" },
  { ch: "·", cat: "punct", en: "Middle Dot", zh: "间隔号", kw: "middle dot interpunct" },
  { ch: "§", cat: "punct", en: "Section Sign", zh: "章节号", kw: "section" },
  { ch: "¶", cat: "punct", en: "Pilcrow / Paragraph", zh: "段落符号", kw: "paragraph" },
  { ch: "©", cat: "punct", en: "Copyright Sign", zh: "版权符号", kw: "copyright" },
  { ch: "®", cat: "punct", en: "Registered Trademark", zh: "注册商标", kw: "registered" },
  { ch: "™", cat: "punct", en: "Trade Mark Sign", zh: "商标符号", kw: "trademark tm" },
  { ch: "‹", cat: "punct", en: "Single Left Angle Quote", zh: "单左尖引号", kw: "angle quote" },
  { ch: "›", cat: "punct", en: "Single Right Angle Quote", zh: "单右尖引号", kw: "angle quote" },
  { ch: "«", cat: "punct", en: "Left Guillemet", zh: "双左尖引号", kw: "guillemet" },
  { ch: "»", cat: "punct", en: "Right Guillemet", zh: "双右尖引号", kw: "guillemet" },
  { ch: "⌘", cat: "punct", en: "macOS Command Key", zh: "macOS Command 键", kw: "cmd mac command" },
  { ch: "⌥", cat: "punct", en: "macOS Option / Alt Key", zh: "macOS Option 键", kw: "option alt mac" },
  { ch: "⇧", cat: "punct", en: "Shift Key", zh: "Shift 键", kw: "shift key" },
  { ch: "⌃", cat: "punct", en: "Control Key", zh: "Control 键", kw: "ctrl control key" },
  { ch: "⌫", cat: "punct", en: "Backspace / Delete", zh: "退格删除键", kw: "backspace delete" },
  { ch: "\u00A0", cat: "punct", en: "Non-Breaking Space (NBSP)", zh: "不换行空格 (NBSP)", kw: "nbsp space" },
  { ch: "\u200B", cat: "punct", en: "Zero Width Space (ZWSP)", zh: "零宽空格 (ZWSP)", kw: "zwsp zero width" },
  // Box Drawing
  { ch: "─", cat: "box", en: "Box Horizontal", zh: "水平制表线", kw: "box horizontal" },
  { ch: "│", cat: "box", en: "Box Vertical", zh: "垂直制表线", kw: "box vertical" },
  { ch: "┌", cat: "box", en: "Box Top-Left", zh: "左上角", kw: "box corner" },
  { ch: "┐", cat: "box", en: "Box Top-Right", zh: "右上角", kw: "box corner" },
  { ch: "└", cat: "box", en: "Box Bottom-Left", zh: "左下角", kw: "box corner" },
  { ch: "┘", cat: "box", en: "Box Bottom-Right", zh: "右下角", kw: "box corner" },
  { ch: "├", cat: "box", en: "Box Tree Branch", zh: "树形分支线", kw: "tree branch" },
  { ch: "┬", cat: "box", en: "Box T-Down", zh: "T 形下分支", kw: "box tee" },
  { ch: "┴", cat: "box", en: "Box T-Up", zh: "T 形上分支", kw: "box tee" },
  { ch: "┼", cat: "box", en: "Box Cross", zh: "十字交叉线", kw: "box cross" },
  { ch: "═", cat: "box", en: "Double Horizontal", zh: "双横线", kw: "double box" },
  { ch: "║", cat: "box", en: "Double Vertical", zh: "双竖线", kw: "double box" },
  { ch: "╔", cat: "box", en: "Double Top-Left", zh: "双线左上角", kw: "double corner" },
  { ch: "╗", cat: "box", en: "Double Top-Right", zh: "双线右上角", kw: "double corner" },
  { ch: "╚", cat: "box", en: "Double Bottom-Left", zh: "双线左下角", kw: "double corner" },
  { ch: "╝", cat: "box", en: "Double Bottom-Right", zh: "双线右下角", kw: "double corner" },
  // Currency
  { ch: "$", cat: "currency", en: "US Dollar", zh: "美元", kw: "usd dollar" },
  { ch: "¥", cat: "currency", en: "CNY / JPY Yen", zh: "人民币 / 日元", kw: "cny rmb yen" },
  { ch: "€", cat: "currency", en: "Euro", zh: "欧元", kw: "eur euro" },
  { ch: "£", cat: "currency", en: "Pound Sterling", zh: "英镑", kw: "gbp pound" },
  { ch: "₹", cat: "currency", en: "Indian Rupee", zh: "印度卢比", kw: "inr rupee" },
  { ch: "₩", cat: "currency", en: "Korean Won", zh: "韩元", kw: "krw won" },
  { ch: "₽", cat: "currency", en: "Russian Ruble", zh: "卢布", kw: "rub ruble" },
  { ch: "₿", cat: "currency", en: "Bitcoin", zh: "比特币", kw: "btc bitcoin" },
  { ch: "Ξ", cat: "currency", en: "Ethereum Ξ", zh: "以太坊", kw: "eth ethereum" },
  // Greek
  { ch: "α", cat: "greek", en: "alpha (lower)", zh: "小写 alpha", kw: "alpha" },
  { ch: "β", cat: "greek", en: "beta (lower)", zh: "小写 beta", kw: "beta" },
  { ch: "γ", cat: "greek", en: "gamma (lower)", zh: "小写 gamma", kw: "gamma" },
  { ch: "δ", cat: "greek", en: "delta (lower)", zh: "小写 delta", kw: "delta" },
  { ch: "Δ", cat: "greek", en: "Delta (upper)", zh: "大写 Delta / 增量", kw: "delta diff" },
  { ch: "ε", cat: "greek", en: "epsilon", zh: "epsilon 极小正数", kw: "epsilon" },
  { ch: "θ", cat: "greek", en: "theta", zh: "theta 角度", kw: "theta" },
  { ch: "λ", cat: "greek", en: "lambda", zh: "lambda 匿名函数", kw: "lambda" },
  { ch: "μ", cat: "greek", en: "mu / micro", zh: "微 / mu", kw: "mu micro" },
  { ch: "π", cat: "greek", en: "pi (3.14159)", zh: "圆周率 pi", kw: "pi" },
  { ch: "σ", cat: "greek", en: "sigma / std dev", zh: "标准差 sigma", kw: "sigma" },
  { ch: "Ω", cat: "greek", en: "Omega / Ohm", zh: "欧姆 / Omega", kw: "omega ohm" },
  // Status & UI
  { ch: "✓", cat: "status", en: "Check Mark", zh: "对勾", kw: "check tick ok" },
  { ch: "✕", cat: "status", en: "Cross / Close", zh: "叉号 / 关闭", kw: "cross close" },
  { ch: "⚠", cat: "status", en: "Warning Sign", zh: "警告三角", kw: "warning alert" },
  { ch: "ℹ", cat: "status", en: "Information Source", zh: "信息提示", kw: "info" },
  { ch: "★", cat: "status", en: "Black Star", zh: "实心星标", kw: "star fav" },
  { ch: "☆", cat: "status", en: "White Star", zh: "空心星标", kw: "star" },
  { ch: "▸", cat: "status", en: "Right Triangle", zh: "右展开三角", kw: "triangle expand" },
  { ch: "▾", cat: "status", en: "Down Triangle", zh: "下展开三角", kw: "triangle collapse" },
  { ch: "⏳", cat: "status", en: "Hourglass Loading", zh: "等待沙漏", kw: "hourglass wait" },
  { ch: "📌", cat: "status", en: "Pushpin", zh: "图钉固定", kw: "pin" },
  { ch: "🔍", cat: "status", en: "Magnifying Glass", zh: "放大镜搜索", kw: "search find" },
  { ch: "🛡️", cat: "status", en: "Shield Security", zh: "安全盾牌", kw: "shield security" },
];

type CopyFmt = "char" | "unicode" | "html" | "utf8";

function formatCharAs(ch: string, fmt: CopyFmt): string {
  if (fmt === "char") return ch;
  const cp = ch.codePointAt(0) ?? 0;
  if (fmt === "unicode") {
    return cp <= 0xffff ? `\\u${cp.toString(16).toUpperCase().padStart(4, "0")}` : `\\u{${cp.toString(16).toUpperCase()}}`;
  }
  if (fmt === "html") {
    return `&#x${cp.toString(16).toUpperCase()};`;
  }
  const bytes = new TextEncoder().encode(ch);
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

function inspectScalar(ch: string) {
  const cp = ch.codePointAt(0) ?? 0;
  const hex = cp.toString(16).toUpperCase().padStart(4, "0");
  const utf8 = Array.from(new TextEncoder().encode(ch), (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
  const utf16Units: string[] = [];
  for (let i = 0; i < ch.length; i++) {
    utf16Units.push(ch.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0"));
  }
  const jsEscape = utf16Units.map((u) => `\\u${u}`).join("");
  const rustEscape = `\\u{${cp.toString(16)}}`;
  const urlEncoded = Array.from(new TextEncoder().encode(ch), (b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join("");
  return {
    ch,
    codepoint: `U+${hex}`,
    dec: String(cp),
    utf8,
    utf16: utf16Units.join(" "),
    html: `&#x${cp.toString(16).toUpperCase()};`,
    jsEscape,
    rustEscape,
    urlEncoded,
  };
}

export default function SymbolEmojiTool({ locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("symbol-emoji", {
    tab: "picker" as "picker" | "inspect",
    cat: "all" as SymCat,
    query: "",
    copyFmt: "char" as CopyFmt,
    inspectText: "OpenIDEA ✨ 工具箱 ∑→",
  });
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, tab: "inspect", inspectText: initialInput }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const filtered = useMemo(() => {
    const q = saved.query.trim().toLowerCase();
    return SYMBOLS.filter((item) => {
      if (saved.cat !== "all" && item.cat !== saved.cat) return false;
      if (!q) return true;
      return (
        item.ch.includes(q) ||
        item.en.toLowerCase().includes(q) ||
        item.zh.toLowerCase().includes(q) ||
        item.kw.toLowerCase().includes(q) ||
        formatCharAs(item.ch, "unicode").toLowerCase().includes(q)
      );
    });
  }, [saved.cat, saved.query]);

  const scalars = useMemo(() => Array.from(saved.inspectText).slice(0, 128).map(inspectScalar), [saved.inspectText]);

  const handleCopy = async (val: string) => {
    await copyToClipboard(val);
    setStatus(tx(locale, `Copied: ${val}`, `已复制: ${val}`));
    setTimeout(() => setStatus(null), 1500);
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Symbols, Emojis & Unicode Inspector", "符号表情与 Unicode 检查器")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, tab: "inspect", inspectText: t }))}
          onPaste={(t) => setSaved((p) => ({ ...p, tab: "inspect", inspectText: t }))}
          outputText={saved.tab === "inspect" ? scalars.map((s) => `${s.ch}\t${s.codepoint}\tUTF-8:${s.utf8}`).join("\n") : ""}
          onClear={() => setSaved((p) => ({ ...p, query: "", inspectText: "" }))}
        />
      </div>

      <div className="ts-row" style={{ justifyContent: "space-between" }}>
        <div className="ts-row">
          <button type="button" className={`ts-pill ${saved.tab === "picker" ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, tab: "picker" }))}>
            {tx(locale, "Symbols & Emojis", "符号与表情速查")} ({SYMBOLS.length})
          </button>
          <button type="button" className={`ts-pill ${saved.tab === "inspect" ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, tab: "inspect" }))}>
            {tx(locale, "Unicode Inspector", "Unicode 码点分析")}
          </button>
        </div>
        {status && <span className="ts-badge good">{status}</span>}
      </div>

      {saved.tab === "picker" ? (
        <>
          <div className="ts-row">
            <input
              className="ts-input"
              style={{ flex: 1, minWidth: 160 }}
              value={saved.query}
              onChange={(e) => setSaved((p) => ({ ...p, query: e.target.value }))}
              placeholder={tx(locale, "Search symbol, gitmoji, U+XXXX...", "搜索符号、Git 表情、关键字或码点...")}
            />
            <select
              className="ts-select"
              style={{ width: 155 }}
              value={saved.copyFmt}
              onChange={(e) => setSaved((p) => ({ ...p, copyFmt: e.target.value as CopyFmt }))}
            >
              <option value="char">{tx(locale, "Copy: Character", "复制：原字符")}</option>
              <option value="unicode">{tx(locale, "Copy: \\uXXXX Escape", "复制：\\uXXXX 转义")}</option>
              <option value="html">{tx(locale, "Copy: HTML Entity", "复制：HTML 实体")}</option>
              <option value="utf8">{tx(locale, "Copy: UTF-8 Hex", "复制：UTF-8 Hex")}</option>
            </select>
          </div>

          <div className="ts-row">
            {SYM_CATS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`ts-pill ${saved.cat === c.id ? "active" : ""}`}
                onClick={() => setSaved((p) => ({ ...p, cat: c.id }))}
              >
                {tx(locale, c.en, c.zh)}
              </button>
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(126px, 1fr))",
              gap: 6,
              maxHeight: 360,
              overflowY: "auto",
            }}
          >
            {filtered.map((item, idx) => {
              const displayChar = item.ch === "\u00A0" ? "NBSP" : item.ch === "\u200B" ? "ZWSP" : item.ch;
              const codeLabel = formatCharAs(item.ch, "unicode");
              return (
                <button
                  key={`${item.cat}-${idx}`}
                  type="button"
                  className="ts-venn-card"
                  style={{ alignItems: "flex-start", textAlign: "left", padding: "6px 8px" }}
                  onClick={() => handleCopy(formatCharAs(item.ch, saved.copyFmt))}
                >
                  <div className="ts-row" style={{ justifyContent: "space-between", width: "100%" }}>
                    <span style={{ fontSize: item.ch === "\u00A0" || item.ch === "\u200B" ? 11 : 17, fontWeight: 600 }}>
                      {displayChar}
                    </span>
                    <span className="ts-mono" style={{ fontSize: 10, color: "var(--ts-fg-muted)" }}>
                      {codeLabel}
                    </span>
                  </div>
                  <span style={{ fontSize: 10.5, color: "var(--ts-fg-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
                    {tx(locale, item.en, item.zh)}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <textarea
            className="ts-textarea mono"
            rows={3}
            value={saved.inspectText}
            onChange={(e) => setSaved((p) => ({ ...p, inspectText: e.target.value }))}
            placeholder={tx(locale, "Enter characters or emojis to inspect codepoints...", "输入任意文字或 Emoji 查看每个字符的 Unicode 编码...")}
          />
          <div className="ts-row">
            <span className="ts-badge">{tx(locale, "Scalars", "码点数")}: {Array.from(saved.inspectText).length}</span>
            <span className="ts-badge">UTF-16: {saved.inspectText.length}</span>
            <span className="ts-badge">UTF-8: {new TextEncoder().encode(saved.inspectText).length} B</span>
          </div>
          <div className="ts-box" style={{ maxHeight: 300, overflow: "auto" }}>
            <table className="ts-table">
              <thead>
                <tr>
                  <th>{tx(locale, "Char", "字符")}</th>
                  <th>Unicode</th>
                  <th>Dec</th>
                  <th>UTF-8</th>
                  <th>UTF-16</th>
                  <th>HTML</th>
                  <th>JS/Java</th>
                  <th>Rust</th>
                  <th>URL</th>
                </tr>
              </thead>
              <tbody>
                {scalars.map((s, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 15 }}>{s.ch === " " ? "␠" : s.ch === "\n" ? "⏎" : s.ch === "\t" ? "⇥" : s.ch}</td>
                    <td className="ts-mono" style={{ cursor: "pointer" }} onClick={() => handleCopy(s.codepoint)}>{s.codepoint}</td>
                    <td className="ts-mono" style={{ cursor: "pointer" }} onClick={() => handleCopy(s.dec)}>{s.dec}</td>
                    <td className="ts-mono" style={{ cursor: "pointer" }} onClick={() => handleCopy(s.utf8)}>{s.utf8}</td>
                    <td className="ts-mono" style={{ cursor: "pointer" }} onClick={() => handleCopy(s.utf16)}>{s.utf16}</td>
                    <td className="ts-mono" style={{ cursor: "pointer" }} onClick={() => handleCopy(s.html)}>{s.html}</td>
                    <td className="ts-mono" style={{ cursor: "pointer" }} onClick={() => handleCopy(s.jsEscape)}>{s.jsEscape}</td>
                    <td className="ts-mono" style={{ cursor: "pointer" }} onClick={() => handleCopy(s.rustEscape)}>{s.rustEscape}</td>
                    <td className="ts-mono" style={{ cursor: "pointer" }} onClick={() => handleCopy(s.urlEncoded)}>{s.urlEncoded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
