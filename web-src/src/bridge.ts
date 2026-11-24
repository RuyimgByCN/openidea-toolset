import type { InitPayload } from "./types";
import { DEFAULT_POMODORO, DEFAULT_SETTINGS } from "./types";

export interface OpenIdeaTheme {
  dark: boolean;
  vars: Record<string, string>;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenIdeaApi {
  postMessage: (text: string) => void;
  onMessage: (fn: (text: string) => void) => void;
  theme?: OpenIdeaTheme | null;
  onThemeChange?: (fn: (theme: OpenIdeaTheme) => void) => void;
  openFile?: (opts?: { filters?: FileFilter[] }) => Promise<{ name: string; data: Uint8Array } | null>;
  saveFile?: (opts: { name: string; data: string | Uint8Array | Blob; filters?: FileFilter[] }) => Promise<string | null>;
}

declare global {
  interface Window {
    openidea?: OpenIdeaApi;
  }
}

export type PushListener = (msg: Record<string, unknown>) => void;

export class BridgeClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private pushListeners = new Set<PushListener>();
  private postFn: (text: string) => void;
  private hasHost: boolean;

  constructor(host?: Pick<OpenIdeaApi, "postMessage" | "onMessage"> | null) {
    if (host) {
      this.hasHost = true;
      this.postFn = (text) => host.postMessage(text);
      host.onMessage((raw) => this.handleIncoming(raw));
    } else {
      this.hasHost = false;
      this.postFn = () => {};
    }
  }

  get isHosted(): boolean {
    return this.hasHost;
  }

  handleIncoming(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    if (msg.op === "rpc-result" && typeof msg.id === "number") {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.ok) {
        entry.resolve(msg.data);
      } else {
        entry.reject(new Error(typeof msg.error === "string" ? msg.error : "RPC failed"));
      }
      return;
    }
    for (const fn of this.pushListeners) {
      fn(msg);
    }
  }

  onPush(fn: PushListener): () => void {
    this.pushListeners.add(fn);
    return () => {
      this.pushListeners.delete(fn);
    };
  }

  rpc<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> {
    if (!this.hasHost) {
      return Promise.reject(new Error(`Host unavailable in standalone preview (${method})`));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      this.postFn(JSON.stringify({ op: "rpc", id, method, params }));
    });
  }

  requestInit(timeoutMs = 5000): Promise<InitPayload> {
    if (!this.hasHost) {
      return Promise.resolve({
        op: "init",
        locale: "en",
        ideLocale: "en",
        languagePref: "auto",
        settings: DEFAULT_SETTINGS,
        workspace: { tabs: [], activeTabId: null },
        favorites: ["json-tools", "timestamp", "hash", "http-client"],
        recent: [],
        notes: [],
        regexRules: [],
        regexHistory: [],
        hostsProfiles: [],
        pomodoro: DEFAULT_POMODORO,
        pending: null,
      });
    }
    return new Promise<InitPayload>((resolve) => {
      let settled = false;
      const off = this.onPush((msg) => {
        if (msg.op === "init" && !settled) {
          settled = true;
          clearTimeout(timer);
          off();
          resolve(msg as unknown as InitPayload);
        }
      });
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          off();
          resolve({
            op: "init",
            locale: "en",
            ideLocale: "en",
            languagePref: "auto",
            settings: DEFAULT_SETTINGS,
            workspace: { tabs: [], activeTabId: null },
            favorites: [],
            recent: [],
            notes: [],
            regexRules: [],
            regexHistory: [],
            hostsProfiles: [],
            pomodoro: DEFAULT_POMODORO,
            pending: null,
          });
        }
      }, timeoutMs);
      this.postFn(JSON.stringify({ op: "ready" }));
    });
  }

  openDiff(opts: {
    left: string | null;
    right: string | null;
    leftLabel?: string;
    rightLabel?: string;
    title?: string;
    fileName?: string;
  }): void {
    this.postFn(JSON.stringify({ op: "open-diff", ...opts }));
  }

  openContentTab(opts: {
    key: string;
    title: string;
    fileName?: string;
    language?: string;
    content: string;
    readOnly?: boolean;
  }): void {
    this.postFn(
      JSON.stringify({
        op: "open-content-tab",
        readOnly: false,
        actions: [],
        ...opts,
      }),
    );
  }
}

const hostApi = typeof window !== "undefined" ? window.openidea : undefined;
export const bridge = new BridgeClient(hostApi);

export async function copyToClipboard(text: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fallback to host RPC below
  }
  if (bridge.isHosted) {
    await bridge.rpc("clipboard.copy", { text });
  }
}

export async function readClipboard(): Promise<{ text: string | null; imageBase64: string | null }> {
  if (bridge.isHosted) {
    try {
      return await bridge.rpc<{ text: string | null; imageBase64: string | null }>("clipboard.read", {});
    } catch (err) {
      // Fallback to browser text clipboard if optional clipboard.read capability was not granted
      if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
        try {
          const text = await navigator.clipboard.readText();
          return { text, imageBase64: null };
        } catch {
          throw err;
        }
      }
      throw err;
    }
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
    const text = await navigator.clipboard.readText();
    return { text, imageBase64: null };
  }
  return { text: null, imageBase64: null };
}

export async function openHostFile(filters?: FileFilter[]): Promise<{ name: string; data: Uint8Array } | null> {
  if (typeof window !== "undefined" && window.openidea?.openFile) {
    return window.openidea.openFile({ filters });
  }
  return null;
}

export async function saveHostFile(
  name: string,
  data: string | Uint8Array | Blob,
  filters?: FileFilter[],
): Promise<string | null> {
  if (typeof window !== "undefined" && window.openidea?.saveFile) {
    return window.openidea.saveFile({ name, data, filters });
  }
  return null;
}
