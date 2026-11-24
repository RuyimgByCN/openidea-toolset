export type LanguagePref = "auto" | "zh-CN" | "en";

export interface SettingsSnapshot {
  language: LanguagePref | string;
  defaultIndent: "2" | "4" | "tab" | string;
  defaultTimezone: string;
  timestampUnit: "seconds" | "milliseconds" | string;
  maxHistoryItems: number;
  pomodoroFocusMinutes: number;
  pomodoroBreakMinutes: number;
  pomodoroLongBreakMinutes: number;
  restoreLastTabs: boolean;
}

export interface WorkspaceTab {
  tabId: string;
  toolId: string;
  title: string;
  customTitle?: string | null;
}

export interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
}

export interface NoteEntry {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
}

export interface RegexRule {
  id: string;
  name: string;
  pattern: string;
  replacement: string;
  flags: string;
  description: string;
}

export interface RegexHistoryEntry {
  pattern: string;
  flags: string;
  savedAt: number;
}

export interface HostProfile {
  id: string;
  name: string;
  enabled: boolean;
  content: string;
}

export interface HttpPushResponse {
  tabId: string;
  ok: boolean;
  data?: {
    status: number;
    headers: Array<[string, string]>;
    bodyText: string;
    bodyBytes: number;
    isBinary: boolean;
    elapsedMs: number;
  };
  error?: string;
}

export interface PomodoroState {
  phase: "focus" | "shortBreak" | "longBreak" | string;
  running: boolean;
  remainingSeconds: number;
  completedCycles: number;
  endEpochMs: number | null;
}

export interface PendingOpen {
  toolId: string;
  inputText?: string | null;
  imageBase64?: string | null;
}

export interface InitPayload {
  op: "init";
  locale: string;
  ideLocale?: string;
  languagePref?: LanguagePref | string;
  settings: SettingsSnapshot;
  workspace: WorkspaceState;
  favorites: string[];
  recent: string[];
  notes: NoteEntry[];
  regexRules: RegexRule[];
  regexHistory?: RegexHistoryEntry[];
  hostsProfiles?: HostProfile[];
  pomodoro: PomodoroState;
  pending: PendingOpen | null;
}

export interface WsPushEvent {
  op: "ws-event" | "ws-status";
  tabId: string;
  connected?: boolean;
  url?: string;
  error?: string;
  closed?: boolean;
  messages?: Array<{
    text: string;
    hex: string;
    bytes: number;
    isBinary: boolean;
  }>;
}

export interface ToolProps {
  tabId: string;
  locale: string;
  settings: SettingsSnapshot;
  initialInput?: string | null;
  initialImageBase64?: string | null;
  onConsumeInitial?: () => void;
  notes: NoteEntry[];
  onSaveNotes: (notes: NoteEntry[]) => Promise<void>;
  regexRules: RegexRule[];
  onSaveRegexRules: (rules: RegexRule[]) => Promise<void>;
  regexHistory: RegexHistoryEntry[];
  onSaveRegexHistory: (history: RegexHistoryEntry[]) => Promise<void>;
  hostsProfiles: HostProfile[];
  onSaveHostsProfiles: (profiles: HostProfile[]) => Promise<void>;
  httpPushResponse: HttpPushResponse | null;
  onConsumeHttpPush: () => void;
  wsPushEvent?: WsPushEvent | null;
  onConsumeWsPush?: () => void;
  pomodoro: PomodoroState;
  onPomodoroChange: (next: PomodoroState) => Promise<void>;
}

export const DEFAULT_SETTINGS: SettingsSnapshot = {
  language: "auto",
  defaultIndent: "2",
  defaultTimezone: "Asia/Shanghai",
  timestampUnit: "milliseconds",
  maxHistoryItems: 50,
  pomodoroFocusMinutes: 25,
  pomodoroBreakMinutes: 5,
  pomodoroLongBreakMinutes: 15,
  restoreLastTabs: true,
};

export const DEFAULT_POMODORO: PomodoroState = {
  phase: "focus",
  running: false,
  remainingSeconds: 25 * 60,
  completedCycles: 0,
  endEpochMs: null,
};
