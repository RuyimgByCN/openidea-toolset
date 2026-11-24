import { useEffect, useState } from "react";
import { bridge, copyToClipboard } from "../bridge";
import { tx } from "../i18n";
import type { NoteEntry, ToolProps } from "../types";

export default function NotesTool({ locale, notes, onSaveNotes, initialInput, onConsumeInitial }: ToolProps) {
  const [activeId, setActiveId] = useState<string>(notes[0]?.id ?? "");

  useEffect(() => {
    if (!activeId && notes.length > 0) setActiveId(notes[0].id);
  }, [notes, activeId]);

  useEffect(() => {
    if (initialInput != null) {
      const id = `note-${Date.now()}`;
      const created: NoteEntry = {
        id,
        title: tx(locale, `Snippet ${notes.length + 1}`, `片段 ${notes.length + 1}`),
        content: initialInput,
        updatedAt: Date.now(),
      };
      onSaveNotes([created, ...notes]).catch(() => {});
      setActiveId(id);
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const current = notes.find((n) => n.id === activeId) ?? notes[0];

  const createNote = async () => {
    const id = `note-${Date.now()}`;
    const next: NoteEntry = {
      id,
      title: tx(locale, `Note ${notes.length + 1}`, `便签 ${notes.length + 1}`),
      content: "",
      updatedAt: Date.now(),
    };
    await onSaveNotes([next, ...notes]);
    setActiveId(id);
  };

  const updateCurrent = (patch: Partial<NoteEntry>) => {
    if (!current) return;
    const updated = notes.map((n) => (n.id === current.id ? { ...n, ...patch, updatedAt: Date.now() } : n));
    void onSaveNotes(updated);
  };

  const deleteCurrent = async () => {
    if (!current) return;
    const filtered = notes.filter((n) => n.id !== current.id);
    await onSaveNotes(filtered);
    setActiveId(filtered[0]?.id ?? "");
  };

  const openAsMarkdown = () => {
    if (!current) return;
    bridge.openContentTab({
      key: `note:${current.id}`,
      title: `${current.title}.md`,
      fileName: `${current.title}.md`,
      language: "markdown",
      content: current.content,
      readOnly: false,
    });
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Scratch Notes", "多标签便签 (Notes)")}</span>
        <div className="ts-row">
          <button type="button" className="ts-btn sm primary" onClick={createNote}>
            {tx(locale, "+ New Note", "+ 新建便签")}
          </button>
          {current && (
            <>
              <button type="button" className="ts-btn sm" onClick={() => copyToClipboard(current.content)}>
                {tx(locale, "Copy", "复制")}
              </button>
              <button type="button" className="ts-btn sm" onClick={openAsMarkdown}>
                {tx(locale, "Open Markdown Tab", "以 Markdown 打开")}
              </button>
              <button type="button" className="ts-btn sm danger" onClick={deleteCurrent}>
                {tx(locale, "Delete", "删除")}
              </button>
            </>
          )}
        </div>
      </div>

      {notes.length === 0 ? (
        <div className="ts-box" style={{ color: "var(--ts-fg-muted)" }}>
          {tx(locale, "No notes yet. Click '+ New Note' to start jotting down snippets.", "暂无便签，点击「+ 新建便签」开始记录。")}
        </div>
      ) : (
        <div className="ts-col" style={{ flex: 1 }}>
          <div className="ts-row" style={{ overflowX: "auto" }}>
            {notes.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`ts-pill ${current?.id === n.id ? "active" : ""}`}
                onClick={() => setActiveId(n.id)}
              >
                {n.title || tx(locale, "Untitled", "无标题")}
              </button>
            ))}
          </div>
          {current && (
            <>
              <input
                className="ts-input"
                value={current.title}
                onChange={(e) => updateCurrent({ title: e.target.value })}
                placeholder={tx(locale, "Note title...", "便签标题...")}
              />
              <textarea
                className="ts-textarea mono"
                style={{ flex: 1, minHeight: 240 }}
                value={current.content}
                onChange={(e) => updateCurrent({ content: e.target.value })}
                placeholder={tx(locale, "Markdown or scratch text (saved automatically)...", "输入 Markdown 或临时笔记（自动保存）...")}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
