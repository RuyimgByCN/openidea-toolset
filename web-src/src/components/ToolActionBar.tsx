import { useState } from "react";
import { bridge, copyToClipboard, readClipboard } from "../bridge";
import { tx } from "../i18n";

export interface ToolActionBarProps {
  locale: string;
  onImportEditor?: (text: string) => void;
  onPaste?: (text: string) => void;
  outputText?: string;
  onApplyEditor?: (text: string) => void;
  openTabTitle?: string;
  openTabLanguage?: string;
  openTabFileName?: string;
  diffLeft?: string;
  diffRight?: string;
  diffFileName?: string;
  onClear?: () => void;
  onStatus?: (msg: string, isError?: boolean) => void;
}

export function ToolActionBar({
  locale,
  onImportEditor,
  onPaste,
  outputText,
  onApplyEditor,
  openTabTitle,
  openTabLanguage,
  openTabFileName,
  diffLeft,
  diffRight,
  diffFileName,
  onClear,
  onStatus,
}: ToolActionBarProps) {
  const [copied, setCopied] = useState(false);

  const importSelection = async () => {
    try {
      const res = await bridge.rpc<{ text: string }>("editor.getSelection", {});
      onImportEditor?.(res.text);
      onStatus?.(tx(locale, "Imported from editor", "已从编辑器导入"));
    } catch (err) {
      onStatus?.((err as Error).message, true);
    }
  };

  const pasteClip = async () => {
    try {
      const res = await readClipboard();
      if (res.text != null) {
        onPaste?.(res.text);
      } else {
        onStatus?.(tx(locale, "Clipboard has no text", "剪贴板中没有文本"), true);
      }
    } catch (err) {
      onStatus?.((err as Error).message, true);
    }
  };

  const copyOut = async () => {
    if (!outputText) return;
    try {
      await copyToClipboard(outputText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      onStatus?.((err as Error).message, true);
    }
  };

  const writeBack = async () => {
    if (outputText == null) return;
    try {
      if (onApplyEditor) {
        onApplyEditor(outputText);
        return;
      }
      await bridge.rpc("editor.applyText", { text: outputText });
      onStatus?.(tx(locale, "Applied to active editor", "已写回当前编辑器"));
    } catch (err) {
      onStatus?.((err as Error).message, true);
    }
  };

  const openEditorTab = () => {
    if (!outputText) return;
    bridge.openContentTab({
      key: `toolset:${openTabTitle || "output"}`,
      title: openTabTitle || tx(locale, "Toolset Output", "Toolset 输出"),
      fileName: openTabFileName,
      language: openTabLanguage,
      content: outputText,
      readOnly: false,
    });
  };

  const openNativeDiff = () => {
    bridge.openDiff({
      left: diffLeft ?? "",
      right: diffRight ?? outputText ?? "",
      leftLabel: tx(locale, "Input", "输入"),
      rightLabel: tx(locale, "Output", "输出"),
      title: openTabTitle ? `${openTabTitle} Diff` : "Toolset Diff",
      fileName: diffFileName || openTabFileName || "diff.txt",
    });
  };

  return (
    <div className="ts-row">
      {onImportEditor && (
        <button type="button" className="ts-btn sm" onClick={importSelection}>
          {tx(locale, "From Editor", "取编辑器选区")}
        </button>
      )}
      {onPaste && (
        <button type="button" className="ts-btn sm" onClick={pasteClip}>
          {tx(locale, "Paste", "粘贴")}
        </button>
      )}
      {outputText !== undefined && (
        <>
          <button type="button" className="ts-btn sm" disabled={!outputText} onClick={copyOut}>
            {copied ? tx(locale, "Copied!", "已复制") : tx(locale, "Copy", "复制")}
          </button>
          <button type="button" className="ts-btn sm" disabled={!outputText} onClick={writeBack}>
            {tx(locale, "Apply to Editor", "写回编辑器")}
          </button>
          {openTabTitle && (
            <button type="button" className="ts-btn sm" disabled={!outputText} onClick={openEditorTab}>
              {tx(locale, "Open Tab", "编辑器打开")}
            </button>
          )}
          {diffLeft !== undefined && (
            <button type="button" className="ts-btn sm" onClick={openNativeDiff}>
              {tx(locale, "IDE Diff", "原生对比")}
            </button>
          )}
        </>
      )}
      {onClear && (
        <button type="button" className="ts-btn sm" onClick={onClear}>
          {tx(locale, "Clear", "清空")}
        </button>
      )}
    </div>
  );
}
