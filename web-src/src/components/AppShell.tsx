import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "../bridge";
import { isZhLocale, tx } from "../i18n";
import { CATEGORIES, findToolMeta, searchTools, TOOL_REGISTRY, type ToolMeta } from "../registry";
import type {
  HostProfile,
  HttpPushResponse,
  LanguagePref,
  NoteEntry,
  PendingOpen,
  PomodoroState,
  RegexHistoryEntry,
  RegexRule,
  SettingsSnapshot,
  WorkspaceTab,
  WsPushEvent,
} from "../types";
import { DEFAULT_POMODORO, DEFAULT_SETTINGS } from "../types";
import { IconChevron, IconGlobe, IconPlus, IconSearch, IconSidebar, IconStar, IconToolbox } from "./Icons";

const NARROW_BREAKPOINT = 560;
const DEFAULT_STARTUP_TOOL = "json-tools";

function normalizeLanguagePref(raw: string | undefined | null): LanguagePref {
  const s = (raw || "").trim().toLowerCase();
  if (s === "zh" || s.startsWith("zh-") || s.startsWith("zh_")) return "zh-CN";
  if (s === "en" || s.startsWith("en-") || s.startsWith("en_")) return "en";
  return "auto";
}

function makeTabId(toolId: string): string {
  return `${toolId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function AppShell() {
  const [locale, setLocale] = useState("en");
  const [ideLocale, setIdeLocale] = useState("en");
  const [languagePref, setLanguagePref] = useState<LanguagePref>("auto");
  const [settings, setSettings] = useState<SettingsSnapshot>(DEFAULT_SETTINGS);
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [regexRules, setRegexRules] = useState<RegexRule[]>([]);
  const [regexHistory, setRegexHistory] = useState<RegexHistoryEntry[]>([]);
  const [hostsProfiles, setHostsProfiles] = useState<HostProfile[]>([]);
  const [httpPush, setHttpPush] = useState<HttpPushResponse | null>(null);
  const [wsPush, setWsPush] = useState<WsPushEvent | null>(null);
  const [pomodoro, setPomodoro] = useState<PomodoroState>(DEFAULT_POMODORO);

  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < NARROW_BREAKPOINT : false,
  );
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= NARROW_BREAKPOINT : true,
  );
  const [treeFilter, setTreeFilter] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIdx, setSearchIdx] = useState(0);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [tabMenu, setTabMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const [pendingPayload, setPendingPayload] = useState<Record<string, { input?: string | null; imageBase64?: string | null }>>({});

  const appRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastLocaleSyncRef = useRef(0);
  const prevNarrowRef = useRef(isNarrow);

  const zh = isZhLocale(locale);

  const persistWorkspace = useCallback((nextTabs: WorkspaceTab[], nextActive: string | null) => {
    if (!bridge.isHosted) return;
    bridge.rpc("storage.saveWorkspace", { tabs: nextTabs, activeTabId: nextActive }).catch(() => {});
  }, []);

  const syncLocaleFromHost = useCallback((force = false) => {
    if (!bridge.isHosted) return;
    const now = Date.now();
    if (!force && now - lastLocaleSyncRef.current < 1500) return;
    lastLocaleSyncRef.current = now;
    bridge
      .rpc<{ locale: string; ideLocale: string; languagePref: string }>("locale.get", {})
      .then((res) => {
        if (res?.locale) setLocale(res.locale);
        if (res?.ideLocale) setIdeLocale(res.ideLocale);
        if (res?.languagePref) setLanguagePref(normalizeLanguagePref(res.languagePref));
      })
      .catch(() => {});
  }, []);

  const handleLanguageChange = useCallback(
    async (next: LanguagePref) => {
      setLanguagePref(next);
      if (next === "auto") {
        setLocale(ideLocale || "en");
      } else {
        setLocale(next);
      }
      if (!bridge.isHosted) return;
      try {
        const res = await bridge.rpc<{ locale: string; ideLocale: string; languagePref: string }>("storage.setLanguage", {
          language: next,
        });
        if (res?.locale) setLocale(res.locale);
        if (res?.ideLocale) setIdeLocale(res.ideLocale);
        if (res?.languagePref) setLanguagePref(normalizeLanguagePref(res.languagePref));
      } catch {
        // Keep optimistic selection
      }
    },
    [ideLocale],
  );

  const openTool = useCallback(
    (toolId: string, opts?: { inputText?: string | null; imageBase64?: string | null; duplicate?: boolean }) => {
      const meta = findToolMeta(toolId);
      if (!meta) return;
      const title = zh ? meta.titleZh : meta.titleEn;

      setTabs((prev) => {
        const existing = !opts?.duplicate ? prev.find((t) => t.toolId === toolId) : undefined;
        let nextTabs: WorkspaceTab[];
        let targetTabId: string;
        if (existing) {
          targetTabId = existing.tabId;
          nextTabs = prev;
        } else {
          const sameCount = prev.filter((t) => t.toolId === toolId).length;
          targetTabId = makeTabId(toolId);
          const customTitle = sameCount > 0 ? `${title} #${sameCount + 1}` : null;
          nextTabs = [...prev, { tabId: targetTabId, toolId, title, customTitle }];
        }
        setActiveTabId(targetTabId);
        persistWorkspace(nextTabs, targetTabId);
        if (opts?.inputText != null || opts?.imageBase64 != null) {
          setPendingPayload((p) => ({
            ...p,
            [targetTabId]: { input: opts.inputText, imageBase64: opts.imageBase64 },
          }));
        }
        return nextTabs;
      });

      if (bridge.isHosted) {
        bridge
          .rpc<{ recent: string[] }>("storage.recordRecent", { toolId })
          .then((res) => {
            if (Array.isArray(res?.recent)) setRecent(res.recent);
          })
          .catch(() => {});
      } else {
        setRecent((prev) => [toolId, ...prev.filter((id) => id !== toolId)].slice(0, 20));
      }
      setSearchOpen(false);
      if (isNarrow) {
        setSidebarOpen(false);
      }
    },
    [zh, persistWorkspace, isNarrow],
  );

  useEffect(() => {
    const off = bridge.onPush((msg) => {
      if (msg.op === "open-tool" && msg.pending && typeof msg.pending === "object") {
        const p = msg.pending as PendingOpen;
        openTool(p.toolId, { inputText: p.inputText, imageBase64: p.imageBase64 });
      } else if (msg.op === "pomodoro-sync" && msg.pomodoro) {
        setPomodoro(msg.pomodoro as PomodoroState);
      } else if (msg.op === "http-response" && typeof msg.tabId === "string") {
        setHttpPush({
          tabId: msg.tabId,
          ok: Boolean(msg.ok),
          data: msg.data as HttpPushResponse["data"],
          error: typeof msg.error === "string" ? msg.error : undefined,
        });
      } else if ((msg.op === "ws-event" || msg.op === "ws-status") && typeof msg.tabId === "string") {
        setWsPush({
          op: msg.op,
          tabId: msg.tabId,
          connected: typeof msg.connected === "boolean" ? msg.connected : undefined,
          url: typeof msg.url === "string" ? msg.url : undefined,
          error: typeof msg.error === "string" ? msg.error : undefined,
          closed: typeof msg.closed === "boolean" ? msg.closed : undefined,
          messages: Array.isArray(msg.messages) ? (msg.messages as WsPushEvent["messages"]) : undefined,
        });
      } else if (msg.op === "settings-sync") {
        if (msg.settings && typeof msg.settings === "object") {
          setSettings(msg.settings as SettingsSnapshot);
        }
        if (typeof msg.locale === "string" && msg.locale) {
          setLocale(msg.locale);
        }
        if (typeof msg.ideLocale === "string" && msg.ideLocale) {
          setIdeLocale(msg.ideLocale);
        }
        if (typeof msg.languagePref === "string" && msg.languagePref) {
          setLanguagePref(normalizeLanguagePref(msg.languagePref));
        }
      }
    });

    let t1: ReturnType<typeof setTimeout> | undefined;
    let t2: ReturnType<typeof setTimeout> | undefined;

    if (!readyRef.current) {
      readyRef.current = true;
      bridge.requestInit().then((init) => {
        const initLocale = init.locale || "en";
        setLocale(initLocale);
        setIdeLocale(init.ideLocale || initLocale);
        setLanguagePref(normalizeLanguagePref(init.languagePref ?? init.settings?.language));
        setSettings(init.settings || DEFAULT_SETTINGS);
        setFavorites(init.favorites || []);
        setRecent(init.recent || []);
        setNotes(init.notes || []);
        setRegexRules(init.regexRules || []);
        setRegexHistory(init.regexHistory || []);
        setHostsProfiles(init.hostsProfiles || []);
        setPomodoro(init.pomodoro || DEFAULT_POMODORO);

        const initZh = isZhLocale(initLocale);
        let initialTabs: WorkspaceTab[] = [];
        let initialActive: string | null = null;

        if (init.settings?.restoreLastTabs && init.workspace?.tabs?.length) {
          initialTabs = init.workspace.tabs.filter((t) => Boolean(findToolMeta(t.toolId)));
          initialActive = initialTabs.some((t) => t.tabId === init.workspace.activeTabId)
            ? init.workspace.activeTabId
            : (initialTabs[0]?.tabId ?? null);
        }

        if (init.pending) {
          const p = init.pending;
          const meta = findToolMeta(p.toolId);
          if (meta) {
            const existing = initialTabs.find((t) => t.toolId === p.toolId);
            if (existing) {
              initialActive = existing.tabId;
              setPendingPayload((m) => ({
                ...m,
                [existing.tabId]: { input: p.inputText, imageBase64: p.imageBase64 },
              }));
            } else {
              const tabId = makeTabId(p.toolId);
              const title = initZh ? meta.titleZh : meta.titleEn;
              initialTabs = [...initialTabs, { tabId, toolId: p.toolId, title, customTitle: null }];
              initialActive = tabId;
              setPendingPayload((m) => ({
                ...m,
                [tabId]: { input: p.inputText, imageBase64: p.imageBase64 },
              }));
            }
          }
        }

        // Open directly into a working tool tab rather than a web card-grid dashboard.
        if (initialTabs.length === 0) {
          const defMeta = findToolMeta(DEFAULT_STARTUP_TOOL) || TOOL_REGISTRY[0];
          if (defMeta) {
            const tabId = makeTabId(defMeta.id);
            const title = initZh ? defMeta.titleZh : defMeta.titleEn;
            initialTabs = [{ tabId, toolId: defMeta.id, title, customTitle: null }];
            initialActive = tabId;
          }
        }

        setTabs(initialTabs);
        setActiveTabId(initialActive);

        // Follow up shortly after startup in case OpenIDEA updates pluginSetUiLocale asynchronously.
        if (bridge.isHosted) {
          t1 = setTimeout(() => syncLocaleFromHost(true), 500);
          t2 = setTimeout(() => syncLocaleFromHost(true), 2000);
        }
      });
    }
    return () => {
      off();
      if (t1) clearTimeout(t1);
      if (t2) clearTimeout(t2);
    };
  }, [openTool, syncLocaleFromHost]);

  // Responsive width observer for docked sidebar vs narrow drawer mode
  useEffect(() => {
    const el = appRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const handleWidth = (w: number) => {
      if (w <= 0) return;
      const narrow = w < NARROW_BREAKPOINT;
      setIsNarrow(narrow);
      if (narrow !== prevNarrowRef.current) {
        prevNarrowRef.current = narrow;
        setSidebarOpen(!narrow);
      }
    };
    handleWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        handleWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Re-sync OpenIDEA UI locale on window focus / visibility regain
  useEffect(() => {
    const onFocus = () => syncLocaleFromHost(false);
    const onVis = () => {
      if (document.visibilityState === "visible") syncLocaleFromHost(false);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [syncLocaleFromHost]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
        setSearchQuery("");
        setSearchIdx(0);
      } else if (e.key === "Escape") {
        if (searchOpen) setSearchOpen(false);
        if (tabMenu) setTabMenu(null);
        if (isNarrow && sidebarOpen) setSidebarOpen(false);
      }
    };
    const onGlobalClick = () => {
      if (tabMenu) setTabMenu(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", onGlobalClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onGlobalClick);
    };
  }, [searchOpen, tabMenu, isNarrow, sidebarOpen]);

  useEffect(() => {
    if (searchOpen) setTimeout(() => searchInputRef.current?.focus(), 20);
  }, [searchOpen]);

  const closeTab = (tabId: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.tabId === tabId);
      const next = prev.filter((t) => t.tabId !== tabId);
      const nextActive =
        activeTabId === tabId
          ? (next[idx]?.tabId ?? next[idx - 1]?.tabId ?? null)
          : activeTabId;
      setActiveTabId(nextActive);
      persistWorkspace(next, nextActive);
      return next;
    });
  };

  const closeOtherTabs = (keepTabId: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.tabId === keepTabId);
      setActiveTabId(next[0]?.tabId ?? null);
      persistWorkspace(next, next[0]?.tabId ?? null);
      return next;
    });
  };

  const closeAllTabs = () => {
    setTabs([]);
    setActiveTabId(null);
    persistWorkspace([], null);
  };

  const startRename = (tab: WorkspaceTab) => {
    const meta = findToolMeta(tab.toolId);
    const curLabel = tab.customTitle || (meta ? (zh ? meta.titleZh : meta.titleEn) : tab.title);
    setRenamingTabId(tab.tabId);
    setRenameDraft(curLabel);
    setTabMenu(null);
  };

  const commitRename = () => {
    if (!renamingTabId) return;
    const trimmed = renameDraft.trim();
    setTabs((prev) => {
      const next = prev.map((t) => (t.tabId === renamingTabId ? { ...t, customTitle: trimmed || null } : t));
      persistWorkspace(next, activeTabId);
      return next;
    });
    setRenamingTabId(null);
  };

  const toggleFavorite = (toolId: string) => {
    setFavorites((prev) => {
      const next = prev.includes(toolId) ? prev.filter((id) => id !== toolId) : [...prev, toolId];
      if (bridge.isHosted) {
        bridge.rpc("storage.saveFavorites", { favorites: next }).catch(() => {});
      }
      return next;
    });
  };

  const handleSaveNotes = async (next: NoteEntry[]) => {
    setNotes(next);
    if (bridge.isHosted) await bridge.rpc("storage.saveNotes", { notes: next });
  };

  const handleSaveRegexRules = async (next: RegexRule[]) => {
    setRegexRules(next);
    if (bridge.isHosted) await bridge.rpc("storage.saveRegexRules", { rules: next });
  };

  const handleSaveRegexHistory = async (next: RegexHistoryEntry[]) => {
    setRegexHistory(next);
    if (bridge.isHosted) await bridge.rpc("storage.saveRegexHistory", { history: next });
  };

  const handleSaveHostsProfiles = async (next: HostProfile[]) => {
    setHostsProfiles(next);
    if (bridge.isHosted) await bridge.rpc("storage.saveHosts", { profiles: next });
  };

  const handlePomodoroChange = async (next: PomodoroState) => {
    setPomodoro(next);
    if (bridge.isHosted) {
      await bridge.rpc("status.pomodoro", next as unknown as Record<string, unknown>).catch(() => {});
    }
  };

  const activeTab = tabs.find((t) => t.tabId === activeTabId) ?? null;
  const activeMeta = activeTab ? findToolMeta(activeTab.toolId) : undefined;

  const treeMatchingIds = useMemo(() => {
    const q = treeFilter.trim();
    if (!q) return null;
    return new Set(searchTools(q).map((t) => t.id));
  }, [treeFilter]);

  const favoriteMetas = useMemo(() => {
    const list = favorites
      .map((id) => findToolMeta(id))
      .filter((m): m is ToolMeta => Boolean(m));
    return treeMatchingIds ? list.filter((m) => treeMatchingIds.has(m.id)) : list;
  }, [favorites, treeMatchingIds]);

  const categoryGroups = useMemo(() => {
    return CATEGORIES.filter((c) => c.id !== "all")
      .map((cat) => {
        const items = TOOL_REGISTRY.filter(
          (t) => t.category === cat.id && (!treeMatchingIds || treeMatchingIds.has(t.id)),
        );
        return { cat, items };
      })
      .filter((g) => g.items.length > 0);
  }, [treeMatchingIds]);

  const modalResults = useMemo(() => searchTools(searchQuery), [searchQuery]);
  const menuTab = tabMenu ? tabs.find((t) => t.tabId === tabMenu.tabId) : undefined;
  const ideLangShort = isZhLocale(ideLocale) ? "中文" : "EN";

  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div ref={appRef} className="ts-app" onMouseEnter={() => syncLocaleFromHost(false)}>
      <header className="ts-header">
        <button
          type="button"
          className={`ts-icon-btn ${sidebarOpen ? "active" : ""}`}
          onClick={() => setSidebarOpen((v) => !v)}
          title={tx(locale, "Toggle Tools Sidebar", "展开 / 收起工具导航栏")}
          aria-expanded={sidebarOpen}
        >
          <IconSidebar />
        </button>

        <button
          type="button"
          className="ts-brand"
          onClick={() => setSidebarOpen((v) => !v)}
          title={tx(locale, "Toolset — Toggle Tool Tree", "Toolset — 切换工具树")}
        >
          <IconToolbox />
          <span>Toolset</span>
        </button>

        {activeMeta && (
          <button
            type="button"
            className={`ts-star ${favorites.includes(activeMeta.id) ? "on" : ""}`}
            onClick={() => toggleFavorite(activeMeta.id)}
            title={
              favorites.includes(activeMeta.id)
                ? tx(locale, "Remove from favorites", "取消收藏当前工具")
                : tx(locale, "Add to favorites", "收藏当前工具")
            }
          >
            <IconStar filled={favorites.includes(activeMeta.id)} />
          </button>
        )}

        <button
          type="button"
          className="ts-search-trigger"
          onClick={() => {
            setSearchOpen(true);
            setSearchQuery("");
            setSearchIdx(0);
          }}
        >
          <span className="ts-search-left">
            <IconSearch />
            <span className="ts-search-placeholder">
              {tx(locale, `Jump to tool (${TOOL_REGISTRY.length})...`, `快速跳转工具 (${TOOL_REGISTRY.length})...`)}
            </span>
          </span>
          <span className="ts-kbd">⌘K</span>
        </button>

        {pomodoro.running && (
          <button
            type="button"
            className="ts-btn sm primary"
            onClick={() => openTool("pomodoro")}
            title={tx(locale, "Open Pomodoro Timer", "打开番茄钟")}
          >
            {String(Math.floor(pomodoro.remainingSeconds / 60)).padStart(2, "0")}:
            {String(pomodoro.remainingSeconds % 60).padStart(2, "0")}
          </button>
        )}

        <label
          className="ts-lang-wrap"
          title={tx(locale, "Toolset display language", "切换 Toolset 界面语言")}
        >
          <IconGlobe />
          <select
            aria-label={tx(locale, "Language", "界面语言")}
            className="ts-lang-select"
            value={languagePref}
            onChange={(e) => handleLanguageChange(e.target.value as LanguagePref)}
          >
            <option value="auto">
              {zh ? `跟随 IDE (${ideLangShort})` : `Auto (${ideLangShort})`}
            </option>
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </label>
      </header>

      <div className="ts-workbench">
        {isNarrow && sidebarOpen && (
          <div className="ts-sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        )}

        {sidebarOpen && (
          <aside className={`ts-sidebar ${isNarrow ? "drawer" : ""}`}>
            <div className="ts-tree-filter-wrap">
              <input
                className="ts-input ts-tree-filter"
                value={treeFilter}
                onChange={(e) => setTreeFilter(e.target.value)}
                placeholder={tx(locale, "Filter tools...", "过滤工具...")}
              />
              {treeFilter && (
                <button
                  type="button"
                  className="ts-tree-filter-clear"
                  onClick={() => setTreeFilter("")}
                  title={tx(locale, "Clear filter", "清除过滤")}
                >
                  ×
                </button>
              )}
            </div>

            <div className="ts-tree-list">
              {favoriteMetas.length > 0 && (
                <div className="ts-tree-group">
                  <button
                    type="button"
                    className="ts-tree-group-head"
                    onClick={() => toggleGroup("__fav")}
                  >
                    <IconChevron open={Boolean(treeMatchingIds) || !collapsedGroups.__fav} />
                    <span>{tx(locale, "Favorites", "常用收藏")}</span>
                    <span className="ts-tree-count">{favoriteMetas.length}</span>
                  </button>
                  {(Boolean(treeMatchingIds) || !collapsedGroups.__fav) &&
                    favoriteMetas.map((m) => (
                      <SidebarToolRow
                        key={`fav-${m.id}`}
                        meta={m}
                        locale={locale}
                        zh={zh}
                        active={activeTab?.toolId === m.id}
                        starred
                        onOpen={(dup) => openTool(m.id, { duplicate: dup })}
                        onStar={() => toggleFavorite(m.id)}
                      />
                    ))}
                </div>
              )}

              {categoryGroups.map(({ cat, items }) => {
                const open = Boolean(treeMatchingIds) || !collapsedGroups[cat.id];
                return (
                  <div key={cat.id} className="ts-tree-group">
                    <button
                      type="button"
                      className="ts-tree-group-head"
                      onClick={() => toggleGroup(cat.id)}
                    >
                      <IconChevron open={open} />
                      <span>{zh ? cat.labelZh : cat.labelEn}</span>
                      <span className="ts-tree-count">{items.length}</span>
                    </button>
                    {open &&
                      items.map((m) => (
                        <SidebarToolRow
                          key={m.id}
                          meta={m}
                          locale={locale}
                          zh={zh}
                          active={activeTab?.toolId === m.id}
                          starred={favorites.includes(m.id)}
                          onOpen={(dup) => openTool(m.id, { duplicate: dup })}
                          onStar={() => toggleFavorite(m.id)}
                        />
                      ))}
                  </div>
                );
              })}

              {favoriteMetas.length === 0 && categoryGroups.length === 0 && (
                <div className="ts-tree-empty">{tx(locale, "No matching tools", "没有匹配工具")}</div>
              )}
            </div>
          </aside>
        )}

        <section className="ts-workspace">
          <div className="ts-tabbar">
            {tabs.map((tab) => {
              const meta = findToolMeta(tab.toolId);
              const label = tab.customTitle || (meta ? (zh ? meta.titleZh : meta.titleEn) : tab.title);
              const isRenaming = renamingTabId === tab.tabId;
              return (
                <div
                  key={tab.tabId}
                  className={`ts-tab ${activeTabId === tab.tabId ? "active" : ""}`}
                  onClick={() => {
                    if (!isRenaming) {
                      setActiveTabId(tab.tabId);
                      persistWorkspace(tabs, tab.tabId);
                    }
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startRename(tab);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setTabMenu({ tabId: tab.tabId, x: e.clientX, y: e.clientY });
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) closeTab(tab.tabId);
                  }}
                  title={tx(
                    locale,
                    `${label} (Double-click to rename, Right-click for menu)`,
                    `${label}（双击重命名，右键打开菜单）`,
                  )}
                >
                  {isRenaming ? (
                    <input
                      className="ts-tab-rename"
                      autoFocus
                      value={renameDraft}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        else if (e.key === "Escape") setRenamingTabId(null);
                      }}
                    />
                  ) : (
                    <span className="ts-tab-title">{label}</span>
                  )}
                  <span
                    className="ts-tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.tabId);
                    }}
                  >
                    ×
                  </span>
                </div>
              );
            })}
            <button
              type="button"
              className="ts-tab-add"
              title={
                activeTab
                  ? tx(locale, "Open another tab of this tool", "新建当前工具的独立标签页")
                  : tx(locale, "Open a tool (⌘K)", "打开工具 (⌘K)")
              }
              onClick={() => {
                if (activeTab) {
                  openTool(activeTab.toolId, { duplicate: true });
                } else {
                  setSearchOpen(true);
                  setSearchQuery("");
                  setSearchIdx(0);
                }
              }}
            >
              <IconPlus />
            </button>
          </div>

          <main className="ts-main">
            {activeTab && activeMeta ? (
              <Suspense
                fallback={
                  <div style={{ color: "var(--ts-fg-muted)" }}>{tx(locale, "Loading tool...", "加载工具中...")}</div>
                }
              >
                <activeMeta.component
                  key={activeTab.tabId}
                  tabId={activeTab.tabId}
                  locale={locale}
                  settings={settings}
                  initialInput={pendingPayload[activeTab.tabId]?.input}
                  initialImageBase64={pendingPayload[activeTab.tabId]?.imageBase64}
                  onConsumeInitial={() =>
                    setPendingPayload((p) => {
                      const copy = { ...p };
                      delete copy[activeTab.tabId];
                      return copy;
                    })
                  }
                  notes={notes}
                  onSaveNotes={handleSaveNotes}
                  regexRules={regexRules}
                  onSaveRegexRules={handleSaveRegexRules}
                  regexHistory={regexHistory}
                  onSaveRegexHistory={handleSaveRegexHistory}
                  hostsProfiles={hostsProfiles}
                  onSaveHostsProfiles={handleSaveHostsProfiles}
                  httpPushResponse={httpPush && httpPush.tabId === activeTab.tabId ? httpPush : null}
                  onConsumeHttpPush={() => setHttpPush(null)}
                  wsPushEvent={wsPush && wsPush.tabId === activeTab.tabId ? wsPush : null}
                  onConsumeWsPush={() => setWsPush(null)}
                  pomodoro={pomodoro}
                  onPomodoroChange={handlePomodoroChange}
                />
              </Suspense>
            ) : (
              <div className="ts-empty-state">
                <div className="ts-empty-title">
                  {tx(locale, "No open tool tab", "当前无打开的工具标签页")}
                </div>
                <div className="ts-empty-sub">
                  {tx(
                    locale,
                    "Pick a utility from the left sidebar or press ⌘K / Ctrl+K to jump directly to any of the 35 tools.",
                    "从左侧工具栏选择，或按 ⌘K / Ctrl+K 快速打开任意工具。",
                  )}
                </div>
                <div className="ts-row" style={{ justifyContent: "center" }}>
                  <button
                    type="button"
                    className="ts-btn primary"
                    onClick={() => openTool(DEFAULT_STARTUP_TOOL)}
                  >
                    {tx(locale, "Open JSON Toolkit", "打开 JSON 工具箱")}
                  </button>
                  <button
                    type="button"
                    className="ts-btn"
                    onClick={() => setSidebarOpen(true)}
                  >
                    {tx(locale, "Browse All Tools", "浏览全部工具")}
                  </button>
                </div>
                {(favorites.length > 0 || recent.length > 0) && (
                  <div className="ts-row" style={{ justifyContent: "center", marginTop: 6 }}>
                    {(favorites.length > 0 ? favorites : recent).slice(0, 6).map((id) => {
                      const m = findToolMeta(id);
                      if (!m) return null;
                      return (
                        <button key={`quick-${id}`} type="button" className="ts-btn sm" onClick={() => openTool(id)}>
                          {zh ? m.titleZh : m.titleEn}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </main>
        </section>
      </div>

      {tabMenu && menuTab && (
        <div
          className="ts-ctx-menu"
          style={{
            left: Math.min(tabMenu.x, window.innerWidth - 155),
            top: Math.min(tabMenu.y, window.innerHeight - 170),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" className="ts-ctx-item" onClick={() => startRename(menuTab)}>
            {tx(locale, "Rename Tab", "重命名标签")}
          </button>
          <button
            type="button"
            className="ts-ctx-item"
            onClick={() => {
              setTabMenu(null);
              openTool(menuTab.toolId, { duplicate: true });
            }}
          >
            {tx(locale, "Duplicate Tab", "多开同工具标签")}
          </button>
          <button
            type="button"
            className="ts-ctx-item"
            onClick={() => {
              setTabMenu(null);
              closeTab(menuTab.tabId);
            }}
          >
            {tx(locale, "Close Tab", "关闭标签")}
          </button>
          <button
            type="button"
            className="ts-ctx-item"
            onClick={() => {
              setTabMenu(null);
              closeOtherTabs(menuTab.tabId);
            }}
          >
            {tx(locale, "Close Other Tabs", "关闭其他标签")}
          </button>
          <button
            type="button"
            className="ts-ctx-item"
            onClick={() => {
              setTabMenu(null);
              closeAllTabs();
            }}
          >
            {tx(locale, "Close All Tabs", "关闭全部标签")}
          </button>
        </div>
      )}

      {searchOpen && (
        <div className="ts-modal-backdrop" onClick={() => setSearchOpen(false)}>
          <div className="ts-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: 6, borderBottom: "1px solid var(--ts-border)" }}>
              <input
                ref={searchInputRef}
                className="ts-input"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSearchIdx((i) => Math.min(modalResults.length - 1, i + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSearchIdx((i) => Math.max(0, i - 1));
                  } else if (e.key === "Enter" && modalResults[searchIdx]) {
                    e.preventDefault();
                    openTool(modalResults[searchIdx].id, { duplicate: e.shiftKey });
                  }
                }}
                placeholder={tx(
                  locale,
                  "Type tool name or alias (e.g. ddl, curl, bip39, hosts, sm2)...",
                  "输入工具名称或拼音/别名（如 ddl、curl、bip39、hosts、sm2）...",
                )}
              />
            </div>
            <div className="ts-modal-list">
              {modalResults.map((tool, i) => (
                <button
                  key={tool.id}
                  type="button"
                  className={`ts-modal-item ${i === searchIdx ? "selected" : ""}`}
                  onClick={(e) => openTool(tool.id, { duplicate: e.shiftKey })}
                >
                  <strong style={{ fontSize: 12 }}>{zh ? tool.titleZh : tool.titleEn}</strong>
                  <span style={{ fontSize: 11, color: "var(--ts-fg-muted)" }}>{zh ? tool.descZh : tool.descEn}</span>
                </button>
              ))}
              {modalResults.length === 0 && (
                <div style={{ padding: 12, color: "var(--ts-fg-muted)", textAlign: "center" }}>
                  {tx(locale, "No matching tools", "没有找到匹配工具")}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarToolRow({
  meta,
  locale,
  zh,
  active,
  starred,
  onOpen,
  onStar,
}: {
  meta: ToolMeta;
  locale: string;
  zh: boolean;
  active: boolean;
  starred: boolean;
  onOpen: (duplicate: boolean) => void;
  onStar: () => void;
}) {
  const title = zh ? meta.titleZh : meta.titleEn;
  const desc = zh ? meta.descZh : meta.descEn;
  return (
    <div
      className={`ts-tree-item ${active ? "active" : ""}`}
      role="button"
      tabIndex={0}
      title={`${title}\n${desc}`}
      onClick={(e) => onOpen(e.shiftKey)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(e.shiftKey);
      }}
    >
      <span className="ts-tree-item-label">{title}</span>
      <span className="ts-tree-item-actions">
        <button
          type="button"
          className="ts-tree-act-btn"
          title={tx(locale, "Open in new tab", "在新标签页打开")}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(true);
          }}
        >
          <IconPlus />
        </button>
        <button
          type="button"
          className={`ts-tree-act-btn ts-star ${starred ? "on" : ""}`}
          title={starred ? tx(locale, "Unfavorite", "取消收藏") : tx(locale, "Favorite", "收藏")}
          onClick={(e) => {
            e.stopPropagation();
            onStar();
          }}
        >
          <IconStar filled={starred} />
        </button>
      </span>
    </div>
  );
}
