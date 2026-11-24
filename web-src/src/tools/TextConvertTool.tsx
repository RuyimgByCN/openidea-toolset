import { useEffect, useState } from "react";
import { bridge, copyToClipboard } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

export default function TextConvertTool({ tabId, locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState(`textconv-${tabId}`, {
    sub: "width" as "width" | "rmb" | "roman" | "morse",
    widthText: "Ｈｅｌｌｏ　ＯｐｅｎＩＤＥＡ！，１２３４５",
    cjkPunct: true,
    rmbInput: "12345.67",
    romanInput: "2026",
    morseInput: "HELLO OPENIDEA",
  });
  const [output, setOutput] = useState("");
  const [rmbRes, setRmbRes] = useState<{ rmb: string; normalized: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({
        ...p,
        widthText: initialInput,
        rmbInput: initialInput,
        romanInput: initialInput,
        morseInput: initialInput,
      }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const runWidth = async (toFull: boolean) => {
    setErr(null);
    try {
      const res = await bridge.rpc<{ result: string }>("text.fullwidth", {
        text: saved.widthText,
        toFull,
        cjkPunct: saved.cjkPunct,
      });
      setOutput(res.result);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const runRmb = async (val = saved.rmbInput) => {
    setErr(null);
    try {
      const res = await bridge.rpc<{ rmb: string; normalized: string }>("text.rmb", { input: val });
      setRmbRes(res);
      setOutput(res.rmb);
    } catch (e) {
      setErr((e as Error).message);
      setRmbRes(null);
    }
  };

  const runRoman = async (toArabic: boolean) => {
    setErr(null);
    try {
      const res = await bridge.rpc<{ result: string }>("text.roman", {
        input: saved.romanInput,
        toArabic,
      });
      setOutput(res.result);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const runMorse = async (decode: boolean) => {
    setErr(null);
    try {
      const res = await bridge.rpc<{ result: string }>("text.morse", {
        text: saved.morseInput,
        decode,
      });
      setOutput(res.result);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Text, Width, RMB & Morse Converter", "全半角 / 人民币大写 / 罗马 / 摩斯")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => {
            if (saved.sub === "width") setSaved((p) => ({ ...p, widthText: t }));
            else if (saved.sub === "rmb") setSaved((p) => ({ ...p, rmbInput: t.trim() }));
            else if (saved.sub === "roman") setSaved((p) => ({ ...p, romanInput: t.trim() }));
            else setSaved((p) => ({ ...p, morseInput: t }));
          }}
          outputText={output}
          onClear={() => {
            setOutput("");
            setRmbRes(null);
            setErr(null);
          }}
          onStatus={(m) => setStatus(m)}
        />
      </div>

      <div className="ts-row">
        <button type="button" className={`ts-pill ${saved.sub === "width" ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, sub: "width" }))}>
          {tx(locale, "Full ↔ Half Width", "全角 ↔ 半角")}
        </button>
        <button type="button" className={`ts-pill ${saved.sub === "rmb" ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, sub: "rmb" }))}>
          {tx(locale, "RMB Capitals", "人民币财务大写")}
        </button>
        <button type="button" className={`ts-pill ${saved.sub === "roman" ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, sub: "roman" }))}>
          {tx(locale, "Roman Numerals", "罗马数字互转")}
        </button>
        <button type="button" className={`ts-pill ${saved.sub === "morse" ? "active" : ""}`} onClick={() => setSaved((p) => ({ ...p, sub: "morse" }))}>
          {tx(locale, "Morse Code", "摩斯电码")}
        </button>
      </div>

      {saved.sub === "width" && (
        <>
          <div className="ts-row">
            <button type="button" className="ts-btn primary" onClick={() => runWidth(false)}>
              {tx(locale, "To Half-Width (DBC)", "转半角 (DBC)")}
            </button>
            <button type="button" className="ts-btn" onClick={() => runWidth(true)}>
              {tx(locale, "To Full-Width (SBC)", "转全角 (SBC)")}
            </button>
            <label className="ts-inline-check">
              <input
                type="checkbox"
                checked={saved.cjkPunct}
                onChange={(e) => setSaved((p) => ({ ...p, cjkPunct: e.target.checked }))}
              />
              {tx(locale, "Convert CJK Punctuation", "转换中文标点（，。！？等）")}
            </label>
          </div>
          <textarea
            className="ts-textarea mono"
            rows={5}
            value={saved.widthText}
            onChange={(e) => setSaved((p) => ({ ...p, widthText: e.target.value }))}
            placeholder={tx(locale, "Enter full-width or half-width text...", "输入全角或半角文本...")}
          />
        </>
      )}

      {saved.sub === "rmb" && (
        <>
          <div className="ts-row">
            <input
              className="ts-input mono"
              style={{ flex: 1 }}
              value={saved.rmbInput}
              onChange={(e) => setSaved((p) => ({ ...p, rmbInput: e.target.value }))}
              placeholder={tx(locale, "Amount in CNY, e.g. 12345.67", "输入金额，如 12345.67")}
            />
            <button type="button" className="ts-btn primary" onClick={() => runRmb()}>
              {tx(locale, "To RMB Capitals", "转人民币大写")}
            </button>
          </div>
          <div className="ts-row">
            <span className="ts-label">{tx(locale, "Examples:", "示例:")}</span>
            {["12345.67", "1000000", "10020.08", "-50.05", "0.00"].map((ex) => (
              <button
                key={ex}
                type="button"
                className="ts-pill"
                onClick={() => {
                  setSaved((p) => ({ ...p, rmbInput: ex }));
                  runRmb(ex);
                }}
              >
                {ex}
              </button>
            ))}
          </div>
          {rmbRes && (
            <div className="ts-box ts-col" style={{ gap: 6 }}>
              <div className="ts-row" style={{ justifyContent: "space-between" }}>
                <span className="ts-label">
                  {tx(locale, `Normalized: ¥${rmbRes.normalized}`, `标准金额: ¥${rmbRes.normalized}`)}
                </span>
                <button
                  type="button"
                  className="ts-btn sm"
                  onClick={async () => {
                    await copyToClipboard(rmbRes.rmb);
                    setStatus(tx(locale, "Copied RMB string", "已复制人民币大写"));
                  }}
                >
                  {tx(locale, "Copy", "复制")}
                </button>
              </div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{rmbRes.rmb}</div>
            </div>
          )}
        </>
      )}

      {saved.sub === "roman" && (
        <div className="ts-row">
          <input
            className="ts-input mono"
            style={{ flex: 1 }}
            value={saved.romanInput}
            onChange={(e) => setSaved((p) => ({ ...p, romanInput: e.target.value }))}
            placeholder={tx(locale, "Integer (1..3999) or Roman numeral (e.g. MMXXVI)", "输入整数 (1..3999) 或罗马数字 (如 MMXXVI)")}
          />
          <button type="button" className="ts-btn primary" onClick={() => runRoman(false)}>
            {tx(locale, "Arabic → Roman", "阿拉伯 → 罗马")}
          </button>
          <button type="button" className="ts-btn" onClick={() => runRoman(true)}>
            {tx(locale, "Roman → Arabic", "罗马 → 阿拉伯")}
          </button>
        </div>
      )}

      {saved.sub === "morse" && (
        <>
          <div className="ts-row">
            <button type="button" className="ts-btn primary" onClick={() => runMorse(false)}>
              {tx(locale, "Encode → Morse", "编码为摩斯电码")}
            </button>
            <button type="button" className="ts-btn" onClick={() => runMorse(true)}>
              {tx(locale, "Decode Morse → Text", "摩斯电码解码")}
            </button>
            <span className="ts-label" style={{ color: "var(--ts-fg-muted)" }}>
              {tx(locale, "Words separated by '/' (e.g. ... --- ...)", "单词间用 / 分隔（例如 ... --- ...）")}
            </span>
          </div>
          <textarea
            className="ts-textarea mono"
            rows={4}
            value={saved.morseInput}
            onChange={(e) => setSaved((p) => ({ ...p, morseInput: e.target.value }))}
            placeholder={tx(locale, "Enter ASCII text or Morse dots/dashes...", "输入英文字母/数字或摩斯点划序列...")}
          />
        </>
      )}

      {err && <div className="ts-err">{err}</div>}
      {status && <div className="ts-ok">{status}</div>}

      <textarea
        className="ts-textarea mono"
        rows={5}
        readOnly
        value={output}
        placeholder={tx(locale, "Conversion result...", "转换结果...")}
      />
    </div>
  );
}
