import { useEffect } from "react";
import { bridge } from "../bridge";
import { tx } from "../i18n";
import type { PomodoroState, ToolProps } from "../types";

export default function PomodoroTool({ locale, settings, pomodoro, onPomodoroChange }: ToolProps) {
  useEffect(() => {
    if (!pomodoro.running || pomodoro.endEpochMs == null) return;
    const tick = setInterval(() => {
      const rem = Math.max(0, Math.ceil((pomodoro.endEpochMs! - Date.now()) / 1000));
      if (rem === 0) {
        const nextCycles = pomodoro.phase === "focus" ? pomodoro.completedCycles + 1 : pomodoro.completedCycles;
        const nextPhase =
          pomodoro.phase === "focus"
            ? nextCycles % 4 === 0
              ? "longBreak"
              : "shortBreak"
            : "focus";
        const mins =
          nextPhase === "focus"
            ? settings.pomodoroFocusMinutes
            : nextPhase === "longBreak"
              ? settings.pomodoroLongBreakMinutes
              : settings.pomodoroBreakMinutes;
        const next: PomodoroState = {
          phase: nextPhase,
          running: false,
          remainingSeconds: mins * 60,
          completedCycles: nextCycles,
          endEpochMs: null,
        };
        void onPomodoroChange(next);
        if (bridge.isHosted) {
          bridge
            .rpc("notify", {
              level: "info",
              title: tx(locale, "Toolset Pomodoro", "Toolset 番茄钟"),
              body:
                pomodoro.phase === "focus"
                  ? tx(locale, "Focus session complete! Time for a break.", "专注周期完成！休息一下吧。")
                  : tx(locale, "Break finished! Ready to focus again.", "休息结束，准备开始下一轮专注！"),
            })
            .catch(() => {});
        }
      } else if (rem !== pomodoro.remainingSeconds) {
        void onPomodoroChange({ ...pomodoro, remainingSeconds: rem });
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [pomodoro, settings, locale, onPomodoroChange]);

  const toggle = () => {
    const now = Date.now();
    if (pomodoro.running) {
      const rem = pomodoro.endEpochMs ? Math.max(0, Math.ceil((pomodoro.endEpochMs - now) / 1000)) : pomodoro.remainingSeconds;
      void onPomodoroChange({ ...pomodoro, running: false, remainingSeconds: rem, endEpochMs: null });
    } else {
      const sec = pomodoro.remainingSeconds > 0 ? pomodoro.remainingSeconds : settings.pomodoroFocusMinutes * 60;
      void onPomodoroChange({ ...pomodoro, running: true, remainingSeconds: sec, endEpochMs: now + sec * 1000 });
    }
  };

  const switchPhase = (phase: "focus" | "shortBreak" | "longBreak") => {
    const mins =
      phase === "focus"
        ? settings.pomodoroFocusMinutes
        : phase === "longBreak"
          ? settings.pomodoroLongBreakMinutes
          : settings.pomodoroBreakMinutes;
    void onPomodoroChange({
      phase,
      running: false,
      remainingSeconds: mins * 60,
      completedCycles: pomodoro.completedCycles,
      endEpochMs: null,
    });
  };

  const mins = Math.floor(pomodoro.remainingSeconds / 60);
  const secs = pomodoro.remainingSeconds % 60;
  const display = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Pomodoro Timer", "番茄钟专注计时")}</span>
        <span className="ts-badge">{tx(locale, "Completed", "已完成")}: {pomodoro.completedCycles}</span>
      </div>

      <div className="ts-row">
        <button type="button" className={`ts-pill ${pomodoro.phase === "focus" ? "active" : ""}`} onClick={() => switchPhase("focus")}>
          {tx(locale, `Focus (${settings.pomodoroFocusMinutes}m)`, `专注 (${settings.pomodoroFocusMinutes}m)`)}
        </button>
        <button type="button" className={`ts-pill ${pomodoro.phase === "shortBreak" ? "active" : ""}`} onClick={() => switchPhase("shortBreak")}>
          {tx(locale, `Short Break (${settings.pomodoroBreakMinutes}m)`, `短休息 (${settings.pomodoroBreakMinutes}m)`)}
        </button>
        <button type="button" className={`ts-pill ${pomodoro.phase === "longBreak" ? "active" : ""}`} onClick={() => switchPhase("longBreak")}>
          {tx(locale, `Long Break (${settings.pomodoroLongBreakMinutes}m)`, `长休息 (${settings.pomodoroLongBreakMinutes}m)`)}
        </button>
      </div>

      <div className="ts-box" style={{ textAlign: "center", padding: "28px 16px" }}>
        <div className="ts-mono" style={{ fontSize: 44, fontWeight: 700, color: "var(--ts-fg-strong)", letterSpacing: 2 }}>
          {display}
        </div>
        <div style={{ color: "var(--ts-fg-muted)", marginBottom: 16 }}>
          {pomodoro.running
            ? tx(locale, "Running — synced to IDE status bar", "计时中 — 已同步至底部状态栏")
            : tx(locale, "Paused", "已暂停")}
        </div>
        <div className="ts-row" style={{ justifyContent: "center" }}>
          <button type="button" className="ts-btn primary" onClick={toggle}>
            {pomodoro.running ? tx(locale, "Pause", "暂停") : tx(locale, "Start", "开始")}
          </button>
          <button type="button" className="ts-btn" onClick={() => switchPhase(pomodoro.phase as "focus" | "shortBreak" | "longBreak")}>
            {tx(locale, "Reset", "重置")}
          </button>
        </div>
      </div>
    </div>
  );
}
