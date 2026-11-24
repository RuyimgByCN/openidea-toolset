import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

interface Stats {
  chars: number;
  charsNoWhitespace: number;
  utf8Bytes: number;
  utf16Units: number;
  lines: number;
  words: number;
}

const CASE_BTNS = [
  { id: "camel", label: "camelCase" },
  { id: "pascal", label: "PascalCase" },
  { id: "snake", label: "snake_case" },
  { id: "screaming_snake", label: "SCREAMING_SNAKE" },
  { id: "kebab", label: "kebab-case" },
  { id: "dot", label: "dot.case" },
  { id: "space", label: "Space Case" },
  { id: "slug", label: "slug-case" },
  { id: "title", label: "Title Case" },
  { id: "upper", label: "UPPER" },
  { id: "lower", label: "lower" },
  { id: "toggle", label: "tOGGLE" },
];

export default function StringCaseTool({ locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("string-case", {
    input: "hello_world_example\nfooBarBaz\nitem10\nitem2",
    arg: ", ",
  });
  const [output, setOutput] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, input: initialInput }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  useEffect(() => {
    if (!bridge.isHosted) return;
    bridge
      .rpc<Stats>("string.stats", { text: saved.input })
      .then(setStats)
      .catch(() => {});
  }, [saved.input]);

  const runCase = async (style: string) => {
    setErr(null);
    try {
      const res = await bridge.rpc<{ result: string }>("string.case", { text: saved.input, style });
      setOutput(res.result);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const runOp = async (op: string) => {
    setErr(null);
    try {
      const res = await bridge.rpc<{ result: string }>("string.op", { text: saved.input, op, arg: saved.arg });
      setOutput(res.result);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "String & Line Manipulation", "字符串与行处理")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, input: t }))}
          onPaste={(t) => setSaved((p) => ({ ...p, input: t }))}
          outputText={output}
          openTabTitle={tx(locale, "String Result", "文本处理结果")}
          diffLeft={saved.input}
          diffRight={output}
          onClear={() => {
            setSaved((p) => ({ ...p, input: "" }));
            setOutput("");
          }}
          onStatus={(m, isErr) => setErr(isErr ? m : null)}
        />
      </div>

      <textarea
        className="ts-textarea mono"
        rows={5}
        value={saved.input}
        onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))}
        placeholder={tx(locale, "Enter text or import from editor...", "输入文本或从编辑器选区导入...")}
      />

      {stats && (
        <div className="ts-row">
          <span className="ts-badge">{tx(locale, "Chars", "字符")}: {stats.chars}</span>
          <span className="ts-badge">{tx(locale, "No WS", "非空")}: {stats.charsNoWhitespace}</span>
          <span className="ts-badge">UTF-8: {stats.utf8Bytes}B</span>
          <span className="ts-badge">UTF-16: {stats.utf16Units}</span>
          <span className="ts-badge">{tx(locale, "Words", "词数")}: {stats.words}</span>
          <span className="ts-badge">{tx(locale, "Lines", "行数")}: {stats.lines}</span>
        </div>
      )}

      <div className="ts-box ts-col">
        <div className="ts-row">
          {CASE_BTNS.map((b) => (
            <button key={b.id} type="button" className="ts-btn sm" onClick={() => runCase(b.id)}>
              {b.label}
            </button>
          ))}
        </div>
        <div className="ts-row">
          <button type="button" className="ts-btn sm" onClick={() => runOp("swap-quotes")}>{tx(locale, "Swap Quotes", "切换引号")}</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("wrap-single")}>'Wrap'</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("wrap-double")}>"Wrap"</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("wrap-backtick")}>`Wrap`</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("unwrap-quotes")}>{tx(locale, "Unwrap Quotes", "去引号")}</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("sort")}>{tx(locale, "Sort A→Z", "升序")}</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("sort-desc")}>{tx(locale, "Sort Z→A", "降序")}</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("natural-sort")}>{tx(locale, "Natural Sort", "自然排序")}</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("unique")}>{tx(locale, "Dedupe Lines", "去重")}</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("freq")}>{tx(locale, "Line Freq", "行频统计")}</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("trim")}>{tx(locale, "Trim Lines", "去首尾空")}</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("remove-empty")}>{tx(locale, "Drop Empty", "删空行")}</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("reverse")}>{tx(locale, "Reverse Lines", "行倒序")}</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("reverse-text")}>{tx(locale, "Reverse Chars", "字符倒序")}</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("number-lines")}>{tx(locale, "Number Lines", "加行号")}</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("increment")}>{tx(locale, "Num +1", "数字+1")}</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("decrement")}>{tx(locale, "Num -1", "数字-1")}</button>
        </div>
        <div className="ts-row">
          <button type="button" className="ts-btn sm" onClick={() => runOp("merge-cmd")}>{tx(locale, "Merge \\ Cmd", "合并 \\ 命令")}</button>
          <button type="button" className="ts-btn sm" onClick={() => bridge.rpc<{ result: string }>("string.op", { text: saved.input, op: "merge-cmd", arg: "and" }).then((r) => setOutput(r.result)).catch((e) => setErr((e as Error).message))}>{tx(locale, "Join &&", "用 && 合并")}</button>
          <button type="button" className="ts-btn sm" onClick={() => bridge.rpc<{ result: string }>("string.op", { text: saved.input, op: "merge-cmd", arg: "semi" }).then((r) => setOutput(r.result)).catch((e) => setErr((e as Error).message))}>{tx(locale, "Join ;", "用 ; 合并")}</button>
          <button type="button" className="ts-btn sm" onClick={() => bridge.rpc<{ result: string }>("string.op", { text: saved.input, op: "merge-cmd", arg: "split" }).then((r) => setOutput(r.result)).catch((e) => setErr((e as Error).message))}>{tx(locale, "Split \\ Cmd", "拆分为多行 \\")}</button>
        </div>
        <div className="ts-row">
          <input
            className="ts-input mono"
            style={{ width: 140 }}
            value={saved.arg}
            onChange={(e) => setSaved((p) => ({ ...p, arg: e.target.value }))}
            placeholder={tx(locale, "Arg / Delim / Regex", "分隔符/前缀/正则")}
          />
          <button type="button" className="ts-btn sm" onClick={() => runOp("join")}>{tx(locale, "Join", "合并行")}</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("split")}>{tx(locale, "Split", "拆分")}</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("prefix")}>{tx(locale, "Prefix", "加前缀")}</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("suffix")}>{tx(locale, "Suffix", "加后缀")}</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("grep")}>{tx(locale, "Grep", "正则保留")}</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("invert-grep")}>{tx(locale, "Invert Grep", "正则排除")}</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("swap-delim")}>{tx(locale, "Swap Delim", "左右互换")}</button>
          <button type="button" className="ts-btn sm" onClick={() => runOp("align-delim")}>{tx(locale, "Align Cols", "列对齐")}</button>
        </div>
      </div>

      {err && <div className="ts-err">{err}</div>}
      <textarea
        className="ts-textarea mono"
        rows={6}
        readOnly
        value={output}
        placeholder={tx(locale, "Result...", "转换结果...")}
      />
    </div>
  );
}
