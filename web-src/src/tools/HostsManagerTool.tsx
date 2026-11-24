import { useEffect, useState } from "react";
import { bridge, copyToClipboard, saveHostFile } from "../bridge";
import { tx } from "../i18n";
import type { HostProfile, ToolProps } from "../types";

interface CompiledHosts {
  merged: string;
  activeEntries: Array<{ ip: string; host: string; profile: string; line: number }>;
  errors: Array<{ profile: string; line: number; text: string; message: string }>;
  conflicts: Array<{ host: string; differentIps: boolean; definitions: Array<{ ip: string; profile: string }> }>;
}

const DEFAULT_PROFILES: HostProfile[] = [
  { id: "sys-local", name: "Localhost", enabled: true, content: "127.0.0.1 localhost\n::1 localhost\n" },
  { id: "dev-api", name: "Dev Microservices", enabled: true, content: "127.0.0.1 api.dev.local auth.dev.local\n192.168.10.20 db.dev.local\n" },
  { id: "staging", name: "Staging Env", enabled: false, content: "10.0.20.15 api.dev.local\n" },
];

export default function HostsManagerTool({ locale, hostsProfiles, onSaveHostsProfiles }: ToolProps) {
  const profiles = hostsProfiles.length > 0 ? hostsProfiles : DEFAULT_PROFILES;
  const [selectedId, setSelectedId] = useState(profiles[0].id);
  const [compiled, setCompiled] = useState<CompiledHosts | null>(null);
  const [viewMode, setViewMode] = useState<"edit" | "merged">("edit");

  const active = profiles.find((p) => p.id === selectedId) ?? profiles[0];

  useEffect(() => {
    if (hostsProfiles.length === 0 && bridge.isHosted) {
      onSaveHostsProfiles(DEFAULT_PROFILES);
    }
  }, [hostsProfiles.length]);

  useEffect(() => {
    if (!bridge.isHosted) return;
    const t = setTimeout(() => {
      bridge.rpc<CompiledHosts>("hosts.compile", { profiles }).then(setCompiled).catch(() => {});
    }, 80);
    return () => clearTimeout(t);
  }, [profiles]);

  const saveAll = (next: HostProfile[]) => {
    onSaveHostsProfiles(next);
  };

  const addProfile = () => {
    const id = `prof-${Date.now()}`;
    const next = [
      ...profiles,
      { id, name: tx(locale, `Profile ${profiles.length + 1}`, `分组 ${profiles.length + 1}`), enabled: true, content: "127.0.0.1 example.local\n" },
    ];
    saveAll(next);
    setSelectedId(id);
  };

  const deleteProfile = (id: string) => {
    if (profiles.length <= 1) return;
    const next = profiles.filter((p) => p.id !== id);
    saveAll(next);
    if (selectedId === id) setSelectedId(next[0].id);
  };

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Hosts Profile Manager", "Hosts 分组管理 (SwitchHosts)")}</span>
        <div className="ts-row">
          <button type="button" className="ts-btn sm primary" onClick={addProfile}>+ {tx(locale, "New Profile", "新建分组")}</button>
          <button type="button" className={`ts-pill ${viewMode === "edit" ? "active" : ""}`} onClick={() => setViewMode("edit")}>
            {tx(locale, "Editor", "编辑分组")}
          </button>
          <button type="button" className={`ts-pill ${viewMode === "merged" ? "active" : ""}`} onClick={() => setViewMode("merged")}>
            {tx(locale, "Merged Output", "合并预览")}
          </button>
          <button type="button" className="ts-btn sm" disabled={!compiled?.merged} onClick={() => compiled && copyToClipboard(compiled.merged)}>
            {tx(locale, "Copy Hosts", "复制 Hosts")}
          </button>
          <button type="button" className="ts-btn sm" disabled={!compiled?.merged} onClick={() => compiled && saveHostFile("hosts", compiled.merged)}>
            {tx(locale, "Export File", "导出文件")}
          </button>
        </div>
      </div>

      {compiled && (
        <div className="ts-row">
          <span className="ts-badge good">{compiled.activeEntries.length} {tx(locale, "entries", "条生效")}</span>
          {compiled.errors.length > 0 && (
            <span className="ts-badge bad">{compiled.errors.length} {tx(locale, "syntax errors", "处格式错误")}</span>
          )}
          {compiled.conflicts.length > 0 && (
            <span className="ts-badge" style={{ borderColor: "var(--ts-warning)", color: "var(--ts-warning)" }}>
              {compiled.conflicts.length} {tx(locale, "duplicate hostnames", "处重复域名冲突")}
            </span>
          )}
        </div>
      )}

      <div className="ts-split" style={{ gridTemplateColumns: "185px 1fr", flex: 1 }}>
        <div className="ts-box ts-col" style={{ overflowY: "auto" }}>
          {profiles.map((p) => (
            <div
              key={p.id}
              className="ts-row"
              style={{
                justifyContent: "space-between",
                flexWrap: "nowrap",
                padding: "4px 6px",
                borderRadius: 5,
                cursor: "pointer",
                background: p.id === active.id ? "var(--ts-bg-selected)" : "transparent",
              }}
              onClick={() => setSelectedId(p.id)}
            >
              <label className="ts-inline-check" style={{ flex: 1, minWidth: 0 }} onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={(e) => saveAll(profiles.map((item) => (item.id === p.id ? { ...item, enabled: e.target.checked } : item)))}
                />
                <span className="ts-tab-title">{p.name}</span>
              </label>
              {profiles.length > 1 && (
                <button
                  type="button"
                  className="ts-btn sm"
                  onClick={(e) => { e.stopPropagation(); deleteProfile(p.id); }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="ts-col">
          {viewMode === "edit" ? (
            <>
              <input
                className="ts-input"
                value={active.name}
                onChange={(e) => saveAll(profiles.map((p) => (p.id === active.id ? { ...p, name: e.target.value } : p)))}
              />
              <textarea
                className="ts-textarea mono"
                rows={10}
                value={active.content}
                onChange={(e) => saveAll(profiles.map((p) => (p.id === active.id ? { ...p, content: e.target.value } : p)))}
                placeholder="127.0.0.1 api.example.local"
              />
            </>
          ) : (
            <textarea className="ts-textarea mono" rows={12} readOnly value={compiled?.merged ?? ""} />
          )}

          {compiled && (compiled.errors.length > 0 || compiled.conflicts.length > 0) && (
            <div className="ts-box ts-col" style={{ maxHeight: 130, overflowY: "auto", fontSize: 11.5 }}>
              {compiled.errors.map((e, i) => (
                <div key={`e-${i}`} className="ts-err">[{e.profile}:{e.line}] {e.message}</div>
              ))}
              {compiled.conflicts.map((c) => (
                <div key={`c-${c.host}`} style={{ color: c.differentIps ? "var(--ts-warning)" : "var(--ts-fg-muted)" }}>
                  {c.differentIps ? tx(locale, "⚠ Conflict", "⚠ 冲突") : tx(locale, "ℹ Duplicate", "ℹ 重复")}: <strong>{c.host}</strong> →{" "}
                  {c.definitions.map((d) => `${d.ip} (${d.profile})`).join(" vs ")}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
