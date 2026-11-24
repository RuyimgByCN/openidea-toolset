import { useState } from "react";
import { bridge } from "../bridge";
import { tx } from "../i18n";
import type { RegexRule, ToolProps } from "../types";

export default function RegexRulesTool({ locale, regexRules, onSaveRegexRules }: ToolProps) {
  const [editing, setEditing] = useState<RegexRule>({
    id: "",
    name: "",
    pattern: "",
    replacement: "",
    flags: "m",
    description: "",
  });
  const [sample, setSample] = useState("line one   \nline two\t \n");
  const [preview, setPreview] = useState("");
  const [status, setStatus] = useState<{ msg: string; err?: boolean } | null>(null);

  const saveRule = async () => {
    if (!editing.name.trim() || !editing.pattern) {
      setStatus({ msg: tx(locale, "Name and pattern are required", "规则名称与正则表达式不能为空"), err: true });
      return;
    }
    const id = editing.id || `rule-${Date.now()}`;
    const nextRule: RegexRule = { ...editing, id, name: editing.name.trim() };
    const exists = regexRules.some((r) => r.id === id);
    const updated = exists ? regexRules.map((r) => (r.id === id ? nextRule : r)) : [...regexRules, nextRule];
    try {
      await onSaveRegexRules(updated);
      setEditing({ id: "", name: "", pattern: "", replacement: "", flags: "m", description: "" });
      setStatus({ msg: tx(locale, "Saved! Available via Double-Shift Search & Alt/Meta+Shift+R.", "已保存！可通过双击 Shift 搜索或快捷键直接应用到编辑器。") });
    } catch (e) {
      setStatus({ msg: (e as Error).message, err: true });
    }
  };

  const removeRule = async (id: string) => {
    await onSaveRegexRules(regexRules.filter((r) => r.id !== id));
  };

  const testRule = async (rule: RegexRule) => {
    setStatus(null);
    try {
      const res = await bridge.rpc<{ error: string | null; replaced: string | null }>("regex.eval", {
        pattern: rule.pattern,
        flags: rule.flags,
        text: sample,
        replace: rule.replacement,
      });
      if (res.error) setStatus({ msg: res.error, err: true });
      else setPreview(res.replaced ?? "");
    } catch (e) {
      setStatus({ msg: (e as Error).message, err: true });
    }
  };

  const applyToEditor = async (rule: RegexRule) => {
    setStatus(null);
    try {
      await bridge.rpc("regex.applyToEditor", {
        pattern: rule.pattern,
        flags: rule.flags,
        replacement: rule.replacement,
      });
      setStatus({ msg: tx(locale, `Applied "${rule.name}" to active editor`, `已将规则「${rule.name}」应用到当前编辑器`) });
    } catch (e) {
      setStatus({ msg: (e as Error).message, err: true });
    }
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Custom Regex Replace Rules", "自定义正则替换规则")}</span>
      </div>

      <div className="ts-box ts-col">
        <div className="ts-split">
          <label className="ts-label">
            {tx(locale, "Rule Name", "规则名称")}
            <input
              className="ts-input"
              value={editing.name}
              onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))}
              placeholder={tx(locale, "e.g. Strip trailing whitespace", "例如：去除行尾空白")}
            />
          </label>
          <label className="ts-label">
            {tx(locale, "Flags (i/m/s/x)", "修饰符 (i/m/s/x)")}
            <input
              className="ts-input mono"
              value={editing.flags}
              onChange={(e) => setEditing((p) => ({ ...p, flags: e.target.value }))}
            />
          </label>
        </div>
        <div className="ts-split">
          <label className="ts-label">
            {tx(locale, "Find Pattern", "查找正则")}
            <input
              className="ts-input mono"
              value={editing.pattern}
              onChange={(e) => setEditing((p) => ({ ...p, pattern: e.target.value }))}
              placeholder={String.raw`[ \t]+$`}
            />
          </label>
          <label className="ts-label">
            {tx(locale, "Replacement ($1, $name)", "替换为（支持 $1、$name）")}
            <input
              className="ts-input mono"
              value={editing.replacement}
              onChange={(e) => setEditing((p) => ({ ...p, replacement: e.target.value }))}
            />
          </label>
        </div>
        <div className="ts-row">
          <button type="button" className="ts-btn primary" onClick={saveRule}>
            {editing.id ? tx(locale, "Update Rule", "更新规则") : tx(locale, "Save Rule", "保存规则")}
          </button>
          {editing.id && (
            <button
              type="button"
              className="ts-btn"
              onClick={() => setEditing({ id: "", name: "", pattern: "", replacement: "", flags: "m", description: "" })}
            >
              {tx(locale, "Cancel", "取消")}
            </button>
          )}
        </div>
      </div>

      {status && <div className={status.err ? "ts-err" : "ts-ok"}>{status.msg}</div>}

      <div className="ts-col" style={{ gap: 6 }}>
        {regexRules.length === 0 ? (
          <div className="ts-box" style={{ color: "var(--ts-fg-muted)" }}>
            {tx(locale, "No custom rules saved yet. Create one above.", "暂无保存的正则规则，可在上方创建。")}
          </div>
        ) : (
          regexRules.map((rule) => (
            <div key={rule.id} className="ts-box ts-row" style={{ justifyContent: "space-between" }}>
              <div className="ts-col" style={{ gap: 2, flex: 1 }}>
                <strong>{rule.name}</strong>
                <span className="ts-mono" style={{ fontSize: 11, color: "var(--ts-fg-muted)" }}>
                  /{rule.pattern}/{rule.flags} → {JSON.stringify(rule.replacement)}
                </span>
              </div>
              <div className="ts-row">
                <button type="button" className="ts-btn sm primary" onClick={() => applyToEditor(rule)}>
                  {tx(locale, "Apply to Editor", "应用到编辑器")}
                </button>
                <button type="button" className="ts-btn sm" onClick={() => testRule(rule)}>
                  {tx(locale, "Test", "测试")}
                </button>
                <button type="button" className="ts-btn sm" onClick={() => setEditing(rule)}>
                  {tx(locale, "Edit", "编辑")}
                </button>
                <button type="button" className="ts-btn sm danger" onClick={() => removeRule(rule.id)}>
                  {tx(locale, "Delete", "删除")}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="ts-split">
        <label className="ts-label">
          {tx(locale, "Test Input", "测试输入")}
          <textarea className="ts-textarea mono" rows={4} value={sample} onChange={(e) => setSample(e.target.value)} />
        </label>
        <label className="ts-label">
          {tx(locale, "Test Preview", "测试输出")}
          <textarea className="ts-textarea mono" rows={4} readOnly value={preview} />
        </label>
      </div>
    </div>
  );
}
