pub mod blockchain;
pub mod catalog;
pub mod cert_tools;
pub mod converters;
pub mod crypto;
pub mod csv_tools;
pub mod extra_tools;
pub mod formats;
pub mod generators;
pub mod markup;
pub mod sql_tools;
pub mod storage;
pub mod string_tools;
pub mod text_convert;
pub mod totp_tools;
pub mod xml_query;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use openidea_plugin::search::{SearchItem, SearchPage, SearchProvider, SearchTarget};
use openidea_plugin::text::{offset, position};
use openidea_plugin::views::{Body, View, ViewEvent, Viewport, Views};
use openidea_plugin::{
    Context, Error, Event, EventKind, Invocation, NotificationLevel, PickItem, Plugin, Range, StatusItem,
    StatusMenuEntry, TextEdit, TextEditor, host, register_plugin,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;

pub const VIEW: &str = "toolset";
pub const STATUS_ID: &str = "toolset";
const MAX_EDITOR_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingOpen {
    pub tool_id: String,
    pub input_text: Option<String>,
    pub image_base64: Option<String>,
}

#[derive(Default)]
pub struct Toolset {
    pub pending_open: Option<PendingOpen>,
    pub ws_conns: HashMap<String, host::WebSocket>,
    pub active_http: Option<storage::HttpActiveRequest>,
    pub active_ws: Option<storage::WsActiveConfig>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsSnapshot {
    language: String,
    default_indent: String,
    default_timezone: String,
    timestamp_unit: String,
    max_history_items: usize,
    pomodoro_focus_minutes: u32,
    pomodoro_break_minutes: u32,
    pomodoro_long_break_minutes: u32,
    restore_last_tabs: bool,
}

fn read_settings() -> SettingsSnapshot {
    SettingsSnapshot {
        language: storage::normalize_language_pref(host::setting_string("language").as_deref()),
        default_indent: host::setting_string("defaultIndent").unwrap_or_else(|| "2".into()),
        default_timezone: host::setting_string("defaultTimezone").unwrap_or_else(|| "Asia/Shanghai".into()),
        timestamp_unit: host::setting_string("timestampUnit").unwrap_or_else(|| "milliseconds".into()),
        max_history_items: host::setting_number("maxHistoryItems").map_or(50, |n| (n as usize).clamp(5, 200)),
        pomodoro_focus_minutes: host::setting_number("pomodoroFocusMinutes").map_or(25, |n| (n as u32).clamp(1, 180)),
        pomodoro_break_minutes: host::setting_number("pomodoroBreakMinutes").map_or(5, |n| (n as u32).clamp(1, 60)),
        pomodoro_long_break_minutes: host::setting_number("pomodoroLongBreakMinutes").map_or(15, |n| (n as u32).clamp(1, 90)),
        restore_last_tabs: host::setting_bool("restoreLastTabs").unwrap_or(true),
    }
}

fn effective_locale_info() -> (String, String, String) {
    let raw_ide = host::locale();
    let ide_locale = if raw_ide.trim().is_empty() {
        "en".to_owned()
    } else {
        raw_ide
    };
    let setting = host::setting_string("language");
    let pref = storage::resolve_language_pref(setting.as_deref());
    let effective = if pref == "auto" {
        ide_locale.clone()
    } else {
        pref.clone()
    };
    (effective, ide_locale, pref)
}

fn effective_locale() -> String {
    effective_locale_info().0
}

fn refresh_status_menu() {
    let locale = effective_locale();
    let zh = catalog::is_zh(&locale);
    let pomo = storage::load_pomodoro();
    let status_text = if pomo.running {
        let m = pomo.remaining_seconds / 60;
        let s = pomo.remaining_seconds % 60;
        let tag = match pomo.phase.as_str() {
            "shortBreak" | "longBreak" => if zh { "休息" } else { "Break" },
            _ => if zh { "专注" } else { "Focus" },
        };
        format!("{tag} {m:02}:{s:02}")
    } else {
        "Toolset".into()
    };

    let item = StatusItem {
        text: status_text,
        tooltip: Some(if zh { "Toolset — 开发者工具箱" } else { "Toolset — Developer Utilities" }.into()),
        command: Some("open".into()),
    };

    let mut menu: Vec<StatusMenuEntry> = Vec::new();
    menu.push(StatusMenuEntry::action(
        if zh { "打开工具箱面板" } else { "Open Toolset Panel" },
        "open",
    ));

    let favs = storage::load_favorites();
    if !favs.is_empty() {
        menu.push(StatusMenuEntry::Separator);
        menu.push(StatusMenuEntry::Header(if zh { "收藏工具" } else { "Favorites" }.into()));
        for id in favs.iter().take(10) {
            if let Some(meta) = catalog::find_tool(id) {
                menu.push(
                    StatusMenuEntry::action(catalog::title_for_locale(meta, &locale), "open-tool")
                        .with_argument(meta.id),
                );
            }
        }
    }

    let recent = storage::load_recent();
    let recent_items: Vec<&str> = recent.iter().map(String::as_str).filter(|id| !favs.contains(&(*id).to_owned())).take(6).collect();
    if !recent_items.is_empty() {
        menu.push(StatusMenuEntry::Separator);
        menu.push(StatusMenuEntry::Header(if zh { "最近使用" } else { "Recent" }.into()));
        for id in recent_items {
            if let Some(meta) = catalog::find_tool(id) {
                menu.push(
                    StatusMenuEntry::action(catalog::title_for_locale(meta, &locale), "open-tool")
                        .with_argument(meta.id),
                );
            }
        }
    }

    menu.push(StatusMenuEntry::Separator);
    menu.push(StatusMenuEntry::Header(if zh { "快捷操作" } else { "Quick Actions" }.into()));
    menu.push(StatusMenuEntry::action(
        if zh { "格式化剪贴板 JSON" } else { "Format Clipboard JSON" },
        "format-clipboard-json",
    ));
    menu.push(StatusMenuEntry::action(
        if zh { "识别剪贴板二维码" } else { "Decode Clipboard QR Code" },
        "decode-clipboard-qr",
    ));
    menu.push(StatusMenuEntry::action(
        if zh { "应用自定义正则规则" } else { "Apply Custom Regex Rule" },
        "apply-regex-rule",
    ));
    menu.push(StatusMenuEntry::action(
        if zh { "发送当前 HTTP 请求" } else { "Send Active HTTP Request" },
        "http-send",
    ));
    menu.push(StatusMenuEntry::action(
        if zh { "连接当前 WebSocket" } else { "Connect Active WebSocket" },
        "ws-connect",
    ));
    menu.push(StatusMenuEntry::action(
        if pomo.running {
            if zh { "暂停番茄钟" } else { "Pause Pomodoro" }
        } else if zh {
            "开始番茄钟"
        } else {
            "Start Pomodoro"
        },
        "pomodoro-toggle",
    ));

    let _ = host::set_status_item_menu(STATUS_ID, &item, &menu);
}

impl Plugin for Toolset {
    fn activate(&mut self, _ctx: &Context) -> Result<(), Error> {
        storage::scrub_persisted_secrets();
        let _ = host::subscribe(EventKind::WebsocketReady);
        let _ = host::subscribe(EventKind::SettingsChanged);
        refresh_status_menu();
        Ok(())
    }

    fn handle_events(&mut self, events: &[Event], _ctx: &Invocation) {
        for ev in events {
            match ev {
                Event::WebSocketReady(ready) => {
                    let tab_id = self
                        .ws_conns
                        .iter()
                        .find(|(_, ws)| ws.id() == ready.connection)
                        .map(|(k, _)| k.clone());
                    if let Some(tid) = tab_id {
                        let (msgs, closed) = if let Some(ws) = self.ws_conns.get(&tid) {
                            match ws.drain(64) {
                                Ok(batch) => {
                                    let mapped: Vec<Value> = batch
                                        .messages
                                        .into_iter()
                                        .map(|bytes| {
                                            let is_binary = std::str::from_utf8(&bytes).is_err();
                                            let text = String::from_utf8_lossy(&bytes).into_owned();
                                            json!({
                                                "text": text,
                                                "hex": hex::encode(&bytes),
                                                "bytes": bytes.len(),
                                                "isBinary": is_binary,
                                            })
                                        })
                                        .collect();
                                    (mapped, batch.closed)
                                }
                                Err(_) => (Vec::new(), true),
                            }
                        } else {
                            (Vec::new(), true)
                        };
                        if closed {
                            self.ws_conns.remove(&tid);
                        }
                        let _ = host::post_view_message(
                            VIEW,
                            &json!({
                                "op": "ws-event",
                                "tabId": tid,
                                "messages": msgs,
                                "closed": closed,
                            })
                            .to_string(),
                        );
                    }
                }
                Event::Other { kind, .. } if kind == "settings-changed" => {
                    refresh_status_menu();
                    let settings = read_settings();
                    let (locale, ide_locale, language_pref) = effective_locale_info();
                    let _ = host::post_view_message(
                        VIEW,
                        &json!({
                            "op": "settings-sync",
                            "settings": settings,
                            "locale": locale,
                            "ideLocale": ide_locale,
                            "languagePref": language_pref,
                        })
                        .to_string(),
                    );
                }
                _ => {}
            }
        }
    }

    fn run_command(&mut self, id: &str, ctx: &Invocation, arg: Option<&str>) -> Result<Option<String>, Error> {
        match id {
            "open" => {
                host::reveal_view(VIEW)?;
                Ok(None)
            }
            "open-tool" => {
                let pending = parse_open_arg(arg)?;
                self.open_tool_with(pending)?;
                Ok(None)
            }
            "send-selection" => {
                let editor = ctx.editor().ok_or_else(|| Error::Invalid("Focus an editor first".into()))?;
                let text = read_editor_selection_or_all(&editor)?;
                let tool_id = if let Some(a) = arg.map(str::trim).filter(|s| !s.is_empty()) {
                    if catalog::find_tool(a).is_none() {
                        return Err(Error::Invalid(format!("Unknown tool id {a:?}")));
                    }
                    a.to_owned()
                } else {
                    let locale = effective_locale();
                    let items: Vec<PickItem> = catalog::TOOLS
                        .iter()
                        .map(|m| {
                            PickItem::new(m.id, catalog::title_for_locale(m, &locale))
                                .description(catalog::desc_for_locale(m, &locale))
                        })
                        .collect();
                    let prompt = if catalog::is_zh(&locale) {
                        "发送选区到工具"
                    } else {
                        "Send selection to Toolset tool"
                    };
                    let Some(chosen) = host::pick(prompt, &items)? else {
                        return Err(Error::Cancelled);
                    };
                    chosen
                };
                self.open_tool_with(PendingOpen {
                    tool_id,
                    input_text: Some(text),
                    image_base64: None,
                })?;
                Ok(None)
            }
            "apply-regex-rule" => {
                let rules = storage::load_regex_rules();
                let zh = catalog::is_zh(&effective_locale());
                if rules.is_empty() {
                    host::notify(
                        NotificationLevel::Info,
                        "Toolset",
                        if zh {
                            "暂无已保存的正则规则，正在打开自定义正则规则工具。"
                        } else {
                            "No saved regex rules yet. Opening Custom Regex Rules to create one."
                        },
                    );
                    self.open_tool_with(PendingOpen {
                        tool_id: "regex-rules".into(),
                        input_text: None,
                        image_base64: None,
                    })?;
                    return Ok(None);
                }
                let rule = if let Some(rule_id) = arg.map(str::trim).filter(|s| !s.is_empty()) {
                    rules
                        .into_iter()
                        .find(|r| r.id == rule_id || r.name == rule_id)
                        .ok_or_else(|| Error::NotFound(format!("regex rule {rule_id:?}")))?
                } else {
                    let items: Vec<PickItem> = rules
                        .iter()
                        .map(|r| {
                            PickItem::new(&r.id, &r.name)
                                .description(&format!("/{}/{}/ -> {}", r.pattern, r.flags, r.replacement))
                        })
                        .collect();
                    let prompt = if zh { "应用自定义正则规则" } else { "Apply Custom Regex Rule" };
                    let Some(chosen) = host::pick(prompt, &items)? else {
                        return Err(Error::Cancelled);
                    };
                    rules.into_iter().find(|r| r.id == chosen).ok_or(Error::Cancelled)?
                };
                let editor = ctx.editor().ok_or_else(|| Error::Invalid("Focus an editor first".into()))?;
                let pattern = rule.pattern.clone();
                let flags = rule.flags.clone();
                let replacement = rule.replacement.clone();
                apply_editor_transform(&editor, TransformScope::SelectionOrAll, |s| {
                    generators::apply_regex_replace(&pattern, &flags, &replacement, s)
                })?;
                Ok(None)
            }
            "format-clipboard-json" => {
                let zh = catalog::is_zh(&effective_locale());
                let clip = match host::read_clipboard() {
                    Ok(c) => c,
                    Err(Error::Denied(_)) => {
                        host::notify(
                            NotificationLevel::Warning,
                            "Toolset",
                            if zh {
                                "请在 设置 › 插件 中授予可选权限 'clipboard.read' 以读取剪贴板。"
                            } else {
                                "Enable optional capability 'clipboard.read' in Settings › Plugins to read the clipboard."
                            },
                        );
                        return Err(Error::Denied("clipboard.read".into()));
                    }
                    Err(e) => return Err(e),
                };
                let raw = clip.text.ok_or_else(|| Error::Invalid("Clipboard does not contain text".into()))?;
                let indent = read_settings().default_indent;
                let formatted = formats::format_json(&raw, &indent, false)?;
                let _ = host::copy_to_clipboard(&formatted);
                host::notify(
                    NotificationLevel::Info,
                    "Toolset",
                    if zh {
                        "已格式化剪贴板 JSON 并复制回剪贴板。"
                    } else {
                        "Formatted clipboard JSON and copied back."
                    },
                );
                self.open_tool_with(PendingOpen {
                    tool_id: "json-tools".into(),
                    input_text: Some(formatted),
                    image_base64: None,
                })?;
                Ok(None)
            }
            "decode-clipboard-qr" => {
                let zh = catalog::is_zh(&effective_locale());
                let clip = match host::read_clipboard() {
                    Ok(c) => c,
                    Err(Error::Denied(_)) => {
                        host::notify(
                            NotificationLevel::Warning,
                            "Toolset",
                            if zh {
                                "请在 设置 › 插件 中授予可选权限 'clipboard.read' 以读取剪贴板图片。"
                            } else {
                                "Enable optional capability 'clipboard.read' in Settings › Plugins to read clipboard images."
                            },
                        );
                        return Err(Error::Denied("clipboard.read".into()));
                    }
                    Err(e) => return Err(e),
                };
                if let Some(img) = clip.image {
                    let b64 = STANDARD.encode(&img);
                    self.open_tool_with(PendingOpen {
                        tool_id: "qrcode".into(),
                        input_text: None,
                        image_base64: Some(b64),
                    })?;
                    Ok(None)
                } else if let Some(txt) = clip.text {
                    self.open_tool_with(PendingOpen {
                        tool_id: "qrcode".into(),
                        input_text: Some(txt),
                        image_base64: None,
                    })?;
                    Ok(None)
                } else {
                    Err(Error::Invalid("Clipboard is empty".into()))
                }
            }
            "pomodoro-toggle" => {
                let mut pomo = storage::load_pomodoro();
                let now_ms = chrono::Utc::now().timestamp_millis();
                if pomo.running {
                    if let Some(end) = pomo.end_epoch_ms {
                        let rem = ((end - now_ms).max(0) / 1000) as u32;
                        pomo.remaining_seconds = rem;
                    }
                    pomo.running = false;
                    pomo.end_epoch_ms = None;
                } else {
                    if pomo.remaining_seconds == 0 {
                        pomo.remaining_seconds = read_settings().pomodoro_focus_minutes * 60;
                    }
                    pomo.running = true;
                    pomo.end_epoch_ms = Some(now_ms + i64::from(pomo.remaining_seconds) * 1000);
                }
                storage::save_json(storage::KEY_POMODORO, &pomo)?;
                refresh_status_menu();
                let _ = host::post_view_message(VIEW, &json!({ "op": "pomodoro-sync", "pomodoro": pomo }).to_string());
                Ok(None)
            }
            "pomodoro-reset" => {
                let pomo = storage::PomodoroState {
                    phase: "focus".into(),
                    running: false,
                    remaining_seconds: read_settings().pomodoro_focus_minutes * 60,
                    completed_cycles: 0,
                    end_epoch_ms: None,
                };
                storage::save_json(storage::KEY_POMODORO, &pomo)?;
                refresh_status_menu();
                let _ = host::post_view_message(VIEW, &json!({ "op": "pomodoro-sync", "pomodoro": pomo }).to_string());
                Ok(None)
            }
            "http-send" => {
                let req = self
                    .active_http
                    .clone()
                    .or_else(storage::load_active_http)
                    .ok_or_else(|| Error::Invalid("Open HTTP Client and configure a request first".into()))?;
                let payload = match extra_tools::execute_http_request(&req) {
                    Ok(data) => json!({ "op": "http-response", "tabId": req.tab_id, "ok": true, "data": data }),
                    Err(err) => json!({ "op": "http-response", "tabId": req.tab_id, "ok": false, "error": err.to_string() }),
                };
                let _ = host::reveal_view(VIEW);
                let _ = host::post_view_message(VIEW, &payload.to_string());
                if payload["ok"] == true {
                    Ok(None)
                } else {
                    Err(Error::Invalid(payload["error"].as_str().unwrap_or("HTTP request failed").to_owned()))
                }
            }
            "ws-connect" => {
                let cfg = self
                    .active_ws
                    .clone()
                    .or_else(storage::load_active_ws)
                    .ok_or_else(|| Error::Invalid("Open WebSocket Client and configure a URL first".into()))?;
                let res = connect_ws_tab(self, ctx, cfg.clone());
                let _ = host::reveal_view(VIEW);
                match res {
                    Ok(()) => {
                        let _ = host::post_view_message(
                            VIEW,
                            &json!({ "op": "ws-status", "tabId": cfg.tab_id, "connected": true, "url": cfg.url }).to_string(),
                        );
                        Ok(None)
                    }
                    Err(err) => {
                        let _ = host::post_view_message(
                            VIEW,
                            &json!({ "op": "ws-status", "tabId": cfg.tab_id, "connected": false, "error": err.to_string() }).to_string(),
                        );
                        Err(err)
                    }
                }
            }
            "send-to-diff" => {
                let editor = ctx.editor().ok_or_else(|| Error::Invalid("Focus an editor first".into()))?;
                let text = read_editor_selection_or_all(&editor)?;
                self.open_tool_with(PendingOpen {
                    tool_id: "text-diff".into(),
                    input_text: Some(text),
                    image_base64: None,
                })?;
                Ok(None)
            }
            "send-to-http-curl" => {
                let editor = ctx.editor().ok_or_else(|| Error::Invalid("Focus an editor first".into()))?;
                let text = read_editor_selection_or_all(&editor)?;
                self.open_tool_with(PendingOpen {
                    tool_id: "http-client".into(),
                    input_text: Some(text),
                    image_base64: None,
                })?;
                Ok(None)
            }
            "decode-jwt-selection" => {
                let editor = ctx.editor().ok_or_else(|| Error::Invalid("Focus an editor first".into()))?;
                let text = read_editor_selection_or_all(&editor)?;
                self.open_tool_with(PendingOpen {
                    tool_id: "jwt".into(),
                    input_text: Some(text.trim().to_owned()),
                    image_base64: None,
                })?;
                Ok(None)
            }
            _ => run_editor_command(id, ctx),
        }
    }
}

impl Toolset {
    fn open_tool_with(&mut self, pending: PendingOpen) -> Result<(), Error> {
        if catalog::find_tool(&pending.tool_id).is_none() {
            return Err(Error::Invalid(format!("Unknown tool {:?}", pending.tool_id)));
        }
        let max_recent = read_settings().max_history_items;
        let _ = storage::push_recent(&pending.tool_id, max_recent);
        self.pending_open = Some(pending.clone());
        refresh_status_menu();
        host::reveal_view(VIEW)?;
        let _ = host::post_view_message(VIEW, &json!({ "op": "open-tool", "pending": pending }).to_string());
        Ok(())
    }
}

fn parse_open_arg(arg: Option<&str>) -> Result<PendingOpen, Error> {
    let raw = arg.map(str::trim).filter(|s| !s.is_empty());
    match raw {
        None => {
            let locale = effective_locale();
            let items: Vec<PickItem> = catalog::TOOLS
                .iter()
                .map(|m| {
                    PickItem::new(m.id, catalog::title_for_locale(m, &locale))
                        .description(catalog::desc_for_locale(m, &locale))
                })
                .collect();
            let prompt = if catalog::is_zh(&locale) {
                "打开工具箱工具"
            } else {
                "Open Toolset Tool"
            };
            let Some(chosen) = host::pick(prompt, &items)? else {
                return Err(Error::Cancelled);
            };
            Ok(PendingOpen {
                tool_id: chosen,
                input_text: None,
                image_base64: None,
            })
        }
        Some(s) if s.starts_with('{') => {
            serde_json::from_str(s).map_err(|e| Error::Invalid(format!("Invalid open-tool payload: {e}")))
        }
        Some(tool_id) => Ok(PendingOpen {
            tool_id: tool_id.to_owned(),
            input_text: None,
            image_base64: None,
        }),
    }
}

impl SearchProvider for Toolset {
    fn search(&mut self, _category: &str, query: &str, limit: u32, _ctx: &Invocation) -> Result<SearchPage, Error> {
        let locale = effective_locale();
        let zh = catalog::is_zh(&locale);
        let mut ranked: Vec<(i32, SearchItem)> = Vec::new();

        for meta in catalog::TOOLS {
            if let Some(score) = catalog::score_tool(meta, query) {
                ranked.push((
                    score,
                    SearchItem {
                        id: format!("tool:{}", meta.id),
                        title: catalog::title_for_locale(meta, &locale).to_owned(),
                        description: Some(catalog::desc_for_locale(meta, &locale).to_owned()),
                        target: SearchTarget::Command {
                            id: "open-tool".into(),
                            arg: Some(meta.id.into()),
                        },
                    },
                ));
            }
        }

        let q_lower = query.trim().to_ascii_lowercase();
        for rule in storage::load_regex_rules() {
            let name_l = rule.name.to_ascii_lowercase();
            let desc_l = rule.description.to_ascii_lowercase();
            let matched = q_lower.is_empty()
                || name_l.contains(&q_lower)
                || desc_l.contains(&q_lower)
                || rule.pattern.to_ascii_lowercase().contains(&q_lower);
            if matched {
                let score = if name_l == q_lower { 900 } else if name_l.starts_with(&q_lower) { 650 } else { 350 };
                let prefix = if zh { "正则规则: " } else { "Regex Rule: " };
                ranked.push((
                    score,
                    SearchItem {
                        id: format!("rule:{}", rule.id),
                        title: format!("{prefix}{}", rule.name),
                        description: Some(format!("/{}/{}/ → {}", rule.pattern, rule.flags, rule.replacement)),
                        target: SearchTarget::Command {
                            id: "apply-regex-rule".into(),
                            arg: Some(rule.id),
                        },
                    },
                ));
            }
        }

        ranked.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.title.cmp(&b.1.title)));
        let cap = (limit as usize).min(200);
        let has_more = ranked.len() > cap;
        let items = ranked.into_iter().take(cap).map(|(_, item)| item).collect();
        Ok(SearchPage { items, has_more })
    }
}

impl Views for Toolset {
    fn render(&mut self, view: &str, _viewport: Option<Viewport>, _ctx: &Invocation) -> Result<View, Error> {
        if view != VIEW {
            return Err(Error::NotFound(view.into()));
        }
        Ok(View::new(Body::Message("Toolset is shown in its web view.".into())))
    }

    fn handle(&mut self, view: &str, event: ViewEvent, ctx: &Invocation) -> Result<(), Error> {
        if view != VIEW {
            return Err(Error::NotFound(view.into()));
        }
        let ViewEvent::Message(raw) = event else {
            return Ok(());
        };
        let Ok(msg) = serde_json::from_str::<Value>(&raw) else {
            return Ok(());
        };
        match msg.get("op").and_then(Value::as_str) {
            Some("ready") => {
                let settings = read_settings();
                let (locale, ide_locale, language_pref) = effective_locale_info();
                let init = json!({
                    "op": "init",
                    "locale": locale,
                    "ideLocale": ide_locale,
                    "languagePref": language_pref,
                    "settings": settings,
                    "workspace": storage::load_workspace(),
                    "favorites": storage::load_favorites(),
                    "recent": storage::load_recent(),
                    "notes": storage::load_notes(),
                    "regexRules": storage::load_regex_rules(),
                    "regexHistory": storage::load_regex_history(),
                    "hostsProfiles": storage::load_hosts_profiles(),
                    "pomodoro": storage::load_pomodoro(),
                    "pending": self.pending_open.take(),
                });
                let _ = host::post_view_message(VIEW, &init.to_string());
            }
            Some("rpc") => {
                let id = msg.get("id").cloned().unwrap_or(Value::Null);
                let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
                let params = msg.get("params").cloned().unwrap_or_else(|| json!({}));
                let reply = match handle_rpc(self, method, &params, ctx) {
                    Ok(data) => json!({ "op": "rpc-result", "id": id, "ok": true, "data": data }),
                    Err(err) => json!({ "op": "rpc-result", "id": id, "ok": false, "error": err.to_string() }),
                };
                let _ = host::post_view_message(VIEW, &reply.to_string());
            }
            _ => {}
        }
        Ok(())
    }
}

register_plugin!(Toolset, views, search);

// --- Editor Selection & Transform Helpers ---

#[derive(Clone, Copy)]
enum TransformScope {
    WordIfEmpty,
    WholeLines,
    SelectionOrAll,
}

fn read_editor_selection_or_all(editor: &TextEditor) -> Result<String, Error> {
    let doc = editor.document()?;
    let sels = editor.selections()?;
    let selected: Vec<String> = sels
        .into_iter()
        .filter(|r| !r.is_empty())
        .filter_map(|r| doc.text_in(r).map(str::to_owned))
        .filter(|s| !s.is_empty())
        .collect();
    let text = if selected.is_empty() { doc.text } else { selected.join("\n") };
    if text.len() > MAX_EDITOR_BYTES {
        return Err(Error::Invalid("Selected text exceeds 4 MiB limit".into()));
    }
    Ok(text)
}

fn apply_editor_transform(
    editor: &TextEditor,
    scope: TransformScope,
    mut f: impl FnMut(&str) -> Result<String, Error>,
) -> Result<u64, Error> {
    let selections = editor.selections()?;
    let all_empty = selections.iter().all(Range::is_empty);
    for _ in 0..2 {
        let doc = editor.document()?;
        let mut edits = Vec::new();
        if matches!(scope, TransformScope::SelectionOrAll) && all_empty {
            let end = position(&doc.text, doc.text.len());
            let range = Range::new(openidea_plugin::Position::new(0, 0), end);
            let next = f(&doc.text)?;
            if next != doc.text {
                edits.push(TextEdit { range, text: next });
            }
        } else {
            for r in &selections {
                let range = match scope {
                    TransformScope::WordIfEmpty => word_range(&doc.text, *r),
                    TransformScope::WholeLines => line_range(&doc.text, *r),
                    TransformScope::SelectionOrAll => {
                        if r.is_empty() { word_range(&doc.text, *r) } else { *r }
                    }
                };
                let Some(old) = doc.text_in(range) else { continue };
                let new = f(old)?;
                if new != old {
                    edits.push(TextEdit { range, text: new });
                }
            }
            edits.sort_by_key(|e| e.range);
            edits.dedup_by(|b, a| b.range.start < a.range.end);
        }
        match editor.apply_edits(doc.version, &edits) {
            Err(Error::Stale) => continue,
            other => return other,
        }
    }
    Err(Error::Stale)
}

fn word_range(text: &str, r: Range) -> Range {
    if !r.is_empty() {
        return r;
    }
    let Some(at) = offset(text, r.start) else { return r };
    let word = |c: char| c.is_alphanumeric() || c == '_' || c == '-' || c == '.';
    let start = text[..at].char_indices().rev().take_while(|(_, c)| word(*c)).last().map_or(at, |(i, _)| i);
    let end = text[at..].char_indices().find(|(_, c)| !word(*c)).map_or(text.len(), |(i, _)| at + i);
    Range::new(position(text, start), position(text, end))
}

fn line_range(text: &str, r: Range) -> Range {
    let start = openidea_plugin::Position::new(r.start.line, 0);
    let end_line = if r.end.character == 0 && r.end.line > r.start.line { r.end.line - 1 } else { r.end.line };
    let line_end = text.split('\n').nth(end_line as usize).map_or(0, |l| l.encode_utf16().count() as u32);
    Range::new(start, openidea_plugin::Position::new(end_line, line_end))
}

fn run_editor_command(id: &str, ctx: &Invocation) -> Result<Option<String>, Error> {
    let editor = ctx.editor().ok_or_else(|| Error::Invalid("Focus an editor first".into()))?;
    let indent = read_settings().default_indent;
    match id {
        "camel-case" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| Ok(string_tools::convert_case(s, string_tools::CaseStyle::Camel)))?,
        "pascal-case" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| Ok(string_tools::convert_case(s, string_tools::CaseStyle::Pascal)))?,
        "snake-case" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| Ok(string_tools::convert_case(s, string_tools::CaseStyle::Snake)))?,
        "screaming-snake-case" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| Ok(string_tools::convert_case(s, string_tools::CaseStyle::ScreamingSnake)))?,
        "kebab-case" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| Ok(string_tools::convert_case(s, string_tools::CaseStyle::Kebab)))?,
        "dot-case" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| Ok(string_tools::convert_case(s, string_tools::CaseStyle::Dot)))?,
        "upper-case" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| Ok(string_tools::convert_case(s, string_tools::CaseStyle::Upper)))?,
        "lower-case" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| Ok(string_tools::convert_case(s, string_tools::CaseStyle::Lower)))?,
        "swap-quotes" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| Ok(string_tools::swap_quotes(s)))?,
        "base64-encode" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| converters::codec_transform(s, "base64", false))?,
        "base64-decode" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| converters::codec_transform(s, "base64", true))?,
        "url-encode" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| converters::codec_transform(s, "url", false))?,
        "url-decode" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| converters::codec_transform(s, "url", true))?,
        "unicode-escape" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| string_tools::escape_text(s, "unicode"))?,
        "unicode-unescape" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| string_tools::unescape_text(s, "unicode"))?,
        "json-format" => apply_editor_transform(&editor, TransformScope::SelectionOrAll, |s| formats::format_json(s, &indent, false))?,
        "json-minify" => apply_editor_transform(&editor, TransformScope::SelectionOrAll, formats::minify_json)?,
        "sort-lines" => apply_editor_transform(&editor, TransformScope::WholeLines, |s| string_tools::line_op(s, "sort", None))?,
        "unique-lines" => apply_editor_transform(&editor, TransformScope::WholeLines, |s| string_tools::line_op(s, "unique", None))?,
        "trim-lines" => apply_editor_transform(&editor, TransformScope::WholeLines, |s| string_tools::line_op(s, "trim", None))?,
        "toggle-case" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| Ok(string_tools::convert_case(s, string_tools::CaseStyle::Toggle)))?,
        "title-case" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| Ok(string_tools::convert_case(s, string_tools::CaseStyle::Title)))?,
        "reverse-text" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| Ok(string_tools::reverse_text(s)))?,
        "increment-numbers" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| Ok(string_tools::step_numbers(s, 1)))?,
        "decrement-numbers" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| Ok(string_tools::step_numbers(s, -1)))?,
        "remove-empty-lines" => apply_editor_transform(&editor, TransformScope::WholeLines, |s| string_tools::line_op(s, "remove-empty", None))?,
        "merge-multiline-cmd" => apply_editor_transform(&editor, TransformScope::SelectionOrAll, |s| Ok(string_tools::merge_multiline_cmd(s, "continuation")))?,
        "convert-path-slash" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| Ok(extra_tools::toggle_path_slashes(s)))?,
        "json-repair" => apply_editor_transform(&editor, TransformScope::SelectionOrAll, |s| formats::repair_json(s, &indent))?,
        "fullwidth-to-halfwidth" => apply_editor_transform(&editor, TransformScope::SelectionOrAll, |s| Ok(text_convert::to_halfwidth(s, true)))?,
        "halfwidth-to-fullwidth" => apply_editor_transform(&editor, TransformScope::SelectionOrAll, |s| Ok(text_convert::to_fullwidth(s, true)))?,
        "base58-encode" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| converters::codec_transform(s, "base58", false))?,
        "base58-decode" => apply_editor_transform(&editor, TransformScope::WordIfEmpty, |s| converters::codec_transform(s, "base58", true))?,
        _ => return Err(Error::NotFound(format!("command {id}"))),
    };
    Ok(None)
}

fn connect_ws_tab(plugin: &mut Toolset, ctx: &Invocation, cfg: storage::WsActiveConfig) -> Result<(), Error> {
    let project = ctx.project().ok_or_else(|| {
        Error::Invalid("Open a project folder in OpenIDEA before connecting WebSocket".into())
    })?;
    let req = host::WebSocketRequest {
        url: cfg.url.clone(),
        headers: cfg.headers.clone(),
        subprotocol: cfg.subprotocol.clone(),
    };
    let ws = host::WebSocket::connect(&project, &req)?;
    plugin.ws_conns.insert(cfg.tab_id, ws);
    Ok(())
}

// --- JSON-RPC Handler ---

fn p_str<'a>(p: &'a Value, key: &str) -> &'a str {
    p.get(key).and_then(Value::as_str).unwrap_or("")
}

fn p_bool(p: &Value, key: &str, default: bool) -> bool {
    p.get(key).and_then(Value::as_bool).unwrap_or(default)
}

fn p_usize(p: &Value, key: &str, default: usize) -> usize {
    p.get(key).and_then(Value::as_u64).map_or(default, |v| v as usize)
}

fn p_i64(p: &Value, key: &str, default: i64) -> i64 {
    p.get(key).and_then(Value::as_i64).unwrap_or(default)
}

pub fn handle_rpc(plugin: &mut Toolset, method: &str, params: &Value, ctx: &Invocation) -> Result<Value, Error> {
    match method {
        // --- String & Text ---
        "string.stats" => Ok(serde_json::to_value(string_tools::text_stats(p_str(params, "text"))).unwrap()),
        "string.case" => {
            let s = p_str(params, "text");
            let style = match p_str(params, "style") {
                "camel" => string_tools::CaseStyle::Camel,
                "pascal" => string_tools::CaseStyle::Pascal,
                "snake" => string_tools::CaseStyle::Snake,
                "screaming_snake" => string_tools::CaseStyle::ScreamingSnake,
                "kebab" => string_tools::CaseStyle::Kebab,
                "dot" => string_tools::CaseStyle::Dot,
                "space" => string_tools::CaseStyle::Space,
                "slug" => string_tools::CaseStyle::Slug,
                "title" => string_tools::CaseStyle::Title,
                "upper" => string_tools::CaseStyle::Upper,
                "lower" => string_tools::CaseStyle::Lower,
                "toggle" => string_tools::CaseStyle::Toggle,
                other => return Err(Error::Invalid(format!("Unknown case style {other}"))),
            };
            Ok(json!({ "result": string_tools::convert_case(s, style) }))
        }
        "string.op" => {
            let s = p_str(params, "text");
            let op = p_str(params, "op");
            let arg = params.get("arg").and_then(Value::as_str);
            let out = match op {
                "swap-quotes" => string_tools::swap_quotes(s),
                "wrap-single" => string_tools::wrap_quotes(s, '\''),
                "wrap-double" => string_tools::wrap_quotes(s, '"'),
                "wrap-backtick" => string_tools::wrap_quotes(s, '`'),
                "unwrap-quotes" => string_tools::unwrap_quotes(s),
                "reverse-text" => string_tools::reverse_text(s),
                "increment" => string_tools::step_numbers(s, 1),
                "decrement" => string_tools::step_numbers(s, -1),
                _ => string_tools::line_op(s, op, arg)?,
            };
            Ok(json!({ "result": out }))
        }
        "string.escape" => {
            let s = p_str(params, "text");
            let lang = p_str(params, "lang");
            let unescape = p_bool(params, "unescape", false);
            let res = if unescape {
                string_tools::unescape_text(s, lang)?
            } else {
                string_tools::escape_text(s, lang)?
            };
            Ok(json!({ "result": res }))
        }
        "regex.eval" => Ok(generators::eval_regex(
            p_str(params, "pattern"),
            p_str(params, "flags"),
            p_str(params, "text"),
            params.get("replace").and_then(Value::as_str),
        )),
        "regex.applyToEditor" => {
            let editor = ctx.editor().ok_or_else(|| Error::Invalid("Focus an editor first".into()))?;
            let pattern = p_str(params, "pattern").to_owned();
            let flags = p_str(params, "flags").to_owned();
            let replacement = p_str(params, "replacement").to_owned();
            apply_editor_transform(&editor, TransformScope::SelectionOrAll, |s| {
                generators::apply_regex_replace(&pattern, &flags, &replacement, s)
            })?;
            Ok(json!({ "applied": true }))
        }

        // --- Formats ---
        "format.json" => {
            let s = p_str(params, "text");
            let action = p_str(params, "action");
            let indent = p_str(params, "indent");
            let res = match action {
                "minify" => formats::minify_json(s)?,
                "sort" => formats::format_json(s, indent, true)?,
                "escape" => openidea_plugin::text::escape_json(s),
                "unescape" => openidea_plugin::text::unescape_json(s),
                "schema" => formats::json_to_schema(s, params.get("title").and_then(Value::as_str))?,
                _ => formats::format_json(s, indent, false)?,
            };
            Ok(json!({ "result": res }))
        }
        "format.jsonPath" => {
            let val = formats::eval_jsonpath(p_str(params, "text"), p_str(params, "path"))?;
            let formatted = serde_json::to_string_pretty(&val).map_err(|e| Error::Invalid(e.to_string()))?;
            Ok(json!({ "result": formatted, "value": val }))
        }
        "format.jsonRepair" => {
            let res = formats::repair_json(p_str(params, "text"), p_str(params, "indent"))?;
            Ok(json!({ "result": res }))
        }
        "format.jsonFlatten" => {
            let res = formats::flatten_json(p_str(params, "text"), p_str(params, "sep"))?;
            Ok(json!({ "result": res }))
        }
        "format.jsonUnflatten" => {
            let res = formats::unflatten_json(p_str(params, "text"), p_str(params, "sep"))?;
            Ok(json!({ "result": res }))
        }
        "format.jsonDiff" => formats::diff_json(p_str(params, "left"), p_str(params, "right")),
        "format.convert" => {
            let res = formats::convert_format(
                p_str(params, "text"),
                p_str(params, "from"),
                p_str(params, "to"),
                p_str(params, "indent"),
            )?;
            Ok(json!({ "result": res }))
        }
        "format.code" => {
            let res = formats::format_code(
                p_str(params, "text"),
                p_str(params, "lang"),
                p_bool(params, "minify", false),
                p_str(params, "indent"),
            )?;
            Ok(json!({ "result": res }))
        }
        "format.pojo" => {
            let res = formats::json_to_code(
                p_str(params, "text"),
                p_str(params, "target"),
                p_str(params, "rootName"),
                p_bool(params, "lombok", false),
            )?;
            Ok(json!({ "result": res }))
        }

        // --- Converters ---
        "convert.timestamp" => {
            let info = converters::convert_timestamp(
                p_str(params, "input"),
                p_str(params, "timezone"),
                p_str(params, "pattern"),
                p_str(params, "unit"),
                p_i64(params, "offsetSeconds", 0),
            )?;
            Ok(serde_json::to_value(info).unwrap())
        }
        "convert.codec" => {
            let res = converters::codec_transform(
                p_str(params, "text"),
                p_str(params, "mode"),
                p_bool(params, "decode", false),
            )?;
            Ok(json!({ "result": res }))
        }
        "convert.ipCidr" => {
            let res = converters::analyze_ip_cidr(p_str(params, "input"))?;
            Ok(serde_json::to_value(res).unwrap())
        }
        "convert.color" => {
            let (color, contrast) = converters::convert_color(
                p_str(params, "color"),
                params.get("background").and_then(Value::as_str),
            )?;
            Ok(json!({ "color": color, "customContrast": contrast }))
        }

        // --- Crypto ---
        "crypto.hash" => {
            let res = crypto::hash_digest(
                p_str(params, "text"),
                p_str(params, "inputEncoding"),
                p_str(params, "alg"),
                params.get("hmacKey").and_then(Value::as_str),
                p_str(params, "keyEncoding"),
                p_str(params, "outputEncoding"),
            )?;
            Ok(json!({ "result": res }))
        }
        "crypto.symmetric" => {
            let res = crypto::symmetric_crypt(
                p_str(params, "alg"),
                p_str(params, "mode"),
                p_str(params, "padding"),
                p_bool(params, "encrypt", true),
                p_str(params, "text"),
                p_str(params, "inputEncoding"),
                p_str(params, "key"),
                p_str(params, "keyEncoding"),
                p_str(params, "iv"),
                p_str(params, "ivEncoding"),
                p_str(params, "outputEncoding"),
            )?;
            Ok(json!({ "result": res }))
        }
        "crypto.rsaKeygen" => {
            let kp = crypto::rsa_keygen(p_usize(params, "bits", 2048))?;
            Ok(serde_json::to_value(kp).unwrap())
        }
        "crypto.rsaEncrypt" => Ok(json!({
            "result": crypto::rsa_encrypt(p_str(params, "publicKey"), p_str(params, "text"), p_str(params, "padding"), p_str(params, "outputEncoding"))?
        })),
        "crypto.rsaDecrypt" => Ok(json!({
            "result": crypto::rsa_decrypt(p_str(params, "privateKey"), p_str(params, "text"), p_str(params, "inputEncoding"), p_str(params, "padding"))?
        })),
        "crypto.rsaSign" => Ok(json!({
            "result": crypto::rsa_sign(p_str(params, "privateKey"), p_str(params, "text"), p_str(params, "outputEncoding"))?
        })),
        "crypto.rsaVerify" => Ok(json!({
            "valid": crypto::rsa_verify(p_str(params, "publicKey"), p_str(params, "text"), p_str(params, "signature"), p_str(params, "inputEncoding"))?
        })),
        "crypto.sm2Keygen" => {
            let kp = crypto::sm2_keygen()?;
            Ok(serde_json::to_value(kp).unwrap())
        }
        "crypto.sm2Encrypt" => Ok(json!({
            "result": crypto::sm2_encrypt(p_str(params, "publicKey"), p_str(params, "text"), p_str(params, "mode"), p_str(params, "outputEncoding"))?
        })),
        "crypto.sm2Decrypt" => Ok(json!({
            "result": crypto::sm2_decrypt(p_str(params, "privateKey"), p_str(params, "text"), p_str(params, "inputEncoding"), p_str(params, "mode"))?
        })),
        "crypto.sm2Sign" => Ok(json!({
            "result": crypto::sm2_sign(p_str(params, "privateKey"), p_str(params, "text"), p_str(params, "distId"), p_str(params, "outputEncoding"))?
        })),
        "crypto.sm2Verify" => Ok(json!({
            "valid": crypto::sm2_verify(p_str(params, "publicKey"), p_str(params, "text"), p_str(params, "distId"), p_str(params, "signature"), p_str(params, "inputEncoding"))?
        })),
        "crypto.jwtDecode" => Ok(serde_json::to_value(crypto::jwt_decode(p_str(params, "token"))?).unwrap()),
        "crypto.jwtSign" => Ok(json!({
            "token": crypto::jwt_sign(p_str(params, "header"), p_str(params, "payload"), p_str(params, "alg"), p_str(params, "secret"))?
        })),
        "crypto.jwtVerify" => Ok(json!({
            "valid": crypto::jwt_verify(p_str(params, "token"), p_str(params, "secret"))?
        })),

        // --- Generators ---
        "gen.id" => {
            let ids = generators::generate_ids(
                p_str(params, "kind"),
                p_usize(params, "count", 5),
                p_bool(params, "uppercase", false),
                p_bool(params, "noHyphens", false),
                p_usize(params, "nanoidLength", 21),
                p_str(params, "nanoidAlphabet"),
                p_i64(params, "snowflakeEpochMs", 1288834974657),
                p_usize(params, "snowflakeDc", 1) as u64,
                p_usize(params, "snowflakeWorker", 1) as u64,
            )?;
            Ok(json!({ "ids": ids }))
        }
        "gen.decodeId" => {
            let decoded = generators::decode_id(
                p_str(params, "input"),
                p_str(params, "kind"),
                p_i64(params, "snowflakeEpochMs", 1288834974657),
            )?;
            Ok(serde_json::to_value(decoded).unwrap())
        }
        "gen.password" => {
            let batch = generators::generate_passwords(
                p_str(params, "mode"),
                p_usize(params, "length", 16),
                p_usize(params, "count", 5),
                p_bool(params, "upper", true),
                p_bool(params, "lower", true),
                p_bool(params, "digits", true),
                p_bool(params, "symbols", true),
                p_bool(params, "excludeAmbiguous", false),
                p_str(params, "separator"),
            )?;
            Ok(serde_json::to_value(batch).unwrap())
        }
        "gen.cron" => {
            let res = generators::analyze_cron(
                p_str(params, "expr"),
                p_str(params, "timezone"),
                p_usize(params, "count", 8),
            )?;
            Ok(serde_json::to_value(res).unwrap())
        }
        "gen.asciiArt" => Ok(json!({
            "result": generators::render_ascii_art_with_wrap(
                p_str(params, "text"),
                p_str(params, "font"),
                p_str(params, "commentWrap"),
            )
        })),

        // --- SQL, Markup, Path, Calculator ---
        "sql.ddlConvert" => Ok(json!({
            "result": sql_tools::ddl_convert(
                p_str(params, "sql"),
                p_str(params, "target"),
                p_str(params, "rootName"),
                p_bool(params, "lombok", false),
            )?
        })),
        "sql.stripQualifiers" => Ok(json!({
            "result": sql_tools::strip_qualifiers(p_str(params, "sql"))
        })),
        "sql.bindParams" => Ok(json!({
            "result": sql_tools::bind_sql_params(p_str(params, "sql"), p_str(params, "params"))?
        })),
        "markup.convert" => Ok(json!({
            "result": markup::convert_markup(p_str(params, "text"), p_str(params, "from"), p_str(params, "to"))?
        })),
        "path.convert" => Ok(extra_tools::convert_path(p_str(params, "input"), p_str(params, "wslDistro"))),
        "path.batch" => Ok(json!({
            "result": extra_tools::convert_paths_batch(p_str(params, "input"), p_str(params, "target"), p_str(params, "wslDistro"))
        })),
        "calc.eval" => extra_tools::eval_expression(p_str(params, "expr"), p_str(params, "mode")),
        "xml.query" => xml_query::query_xml(
            p_str(params, "xml"),
            p_str(params, "query"),
            p_str(params, "mode"),
            p_bool(params, "html", false),
        ),

        // --- File Verification & Blockchain ---
        "crypto.hashFile" => crypto::hash_file_base64(p_str(params, "dataBase64")),
        "blockchain.generateMnemonic" => blockchain::generate_mnemonic(p_usize(params, "wordCount", 12)),
        "blockchain.derive" => blockchain::derive_wallet(
            p_str(params, "mnemonic"),
            p_str(params, "passphrase"),
            p_usize(params, "account", 0) as u32,
            p_usize(params, "index", 0) as u32,
        ),
        "blockchain.sign" => blockchain::sign_message(p_str(params, "chain"), p_str(params, "privateKey"), p_str(params, "message")),
        "blockchain.verify" => blockchain::verify_message(
            p_str(params, "chain"),
            p_str(params, "target"),
            p_str(params, "message"),
            p_str(params, "signature"),
        ),

        // --- Hosts & HTTP Client ---
        "hosts.compile" => {
            let profiles: Vec<storage::HostProfile> = serde_json::from_value(params.get("profiles").cloned().unwrap_or(json!([])))
                .map_err(|e| Error::Invalid(e.to_string()))?;
            Ok(extra_tools::compile_hosts(&profiles))
        }
        "storage.saveHosts" => {
            let profiles: Vec<storage::HostProfile> = serde_json::from_value(params.get("profiles").cloned().unwrap_or(json!([])))
                .map_err(|e| Error::Invalid(e.to_string()))?;
            storage::save_json(storage::KEY_HOSTS_PROFILES, &profiles)?;
            Ok(json!({ "saved": true }))
        }
        "storage.saveRegexHistory" => {
            let mut history: Vec<storage::RegexHistoryEntry> =
                serde_json::from_value(params.get("history").cloned().unwrap_or(json!([])))
                    .map_err(|e| Error::Invalid(e.to_string()))?;
            history.truncate(30);
            storage::save_json(storage::KEY_REGEX_HISTORY, &history)?;
            Ok(json!({ "saved": true }))
        }
        "http.parseCurl" => extra_tools::parse_curl(p_str(params, "cmd")),
        "http.export" => Ok(json!({
            "result": extra_tools::export_http_code(params, p_str(params, "format"))?
        })),
        "http.setActive" => {
            let req: storage::HttpActiveRequest = serde_json::from_value(params.clone())
                .map_err(|e| Error::Invalid(format!("Invalid HTTP request payload: {e}")))?;
            plugin.active_http = Some(req.clone());
            let (clean, _) = storage::sanitize_http_active(&req);
            storage::save_json(storage::KEY_HTTP_ACTIVE, &clean)?;
            Ok(json!({ "saved": true }))
        }
        "http.send" => {
            let req: storage::HttpActiveRequest = serde_json::from_value(params.clone())
                .map_err(|e| Error::Invalid(format!("Invalid HTTP request payload: {e}")))?;
            plugin.active_http = Some(req.clone());
            let (clean, _) = storage::sanitize_http_active(&req);
            storage::save_json(storage::KEY_HTTP_ACTIVE, &clean)?;
            extra_tools::execute_http_request(&req)
        }

        // --- TOTP, Certs, CSV/Table, Text Convert, Mock & WebSocket (v0.4.0) ---
        "totp.newSecret" => Ok(json!({ "secret": totp_tools::generate_secret(p_usize(params, "bytes", 20)) })),
        "totp.generate" => {
            let epoch = params.get("epoch").and_then(Value::as_u64);
            totp_tools::compute_totp(
                p_str(params, "secret"),
                p_usize(params, "period", 30) as u64,
                p_usize(params, "digits", 6) as u32,
                p_str(params, "algorithm"),
                epoch,
            )
        }
        "totp.hotp" => {
            let code = totp_tools::compute_hotp(
                p_str(params, "secret"),
                params.get("counter").and_then(Value::as_u64).unwrap_or(0),
                p_usize(params, "digits", 6) as u32,
                p_str(params, "algorithm"),
            )?;
            Ok(json!({ "code": code }))
        }
        "totp.parseUri" => totp_tools::parse_otpauth_uri(p_str(params, "uri")),
        "totp.buildUri" => Ok(json!({
            "uri": totp_tools::build_otpauth_uri(
                p_str(params, "kind"),
                p_str(params, "issuer"),
                p_str(params, "account"),
                p_str(params, "secret"),
                p_str(params, "algorithm"),
                p_usize(params, "digits", 6) as u32,
                p_usize(params, "period", 30) as u64,
                params.get("counter").and_then(Value::as_u64).unwrap_or(0),
            )
        })),
        "cert.inspect" => cert_tools::inspect_pem_or_der(p_str(params, "input")),
        "cert.sample" => Ok(json!({ "pem": cert_tools::sample_certificate_pem() })),
        "csv.parse" => csv_tools::parse_table_preview(
            p_str(params, "text"),
            p_str(params, "from"),
            p_str(params, "delimiter"),
            p_bool(params, "hasHeader", true),
        ),
        "csv.convert" => Ok(json!({
            "result": csv_tools::convert_table(
                p_str(params, "text"),
                p_str(params, "from"),
                p_str(params, "to"),
                p_str(params, "delimiter"),
                p_bool(params, "hasHeader", true),
                p_str(params, "tableName"),
                p_bool(params, "transpose", false),
            )?
        })),
        "text.fullwidth" => {
            let to_full = p_bool(params, "toFull", false);
            let cjk = p_bool(params, "cjkPunct", true);
            let res = if to_full {
                text_convert::to_fullwidth(p_str(params, "text"), cjk)
            } else {
                text_convert::to_halfwidth(p_str(params, "text"), cjk)
            };
            Ok(json!({ "result": res }))
        }
        "text.rmb" => text_convert::number_to_rmb(p_str(params, "input")),
        "text.roman" => {
            let to_arabic = p_bool(params, "toArabic", false);
            if to_arabic {
                let n = text_convert::from_roman(p_str(params, "input"))?;
                Ok(json!({ "result": n.to_string(), "number": n }))
            } else {
                let n: u32 = p_str(params, "input")
                    .trim()
                    .parse()
                    .map_err(|_| Error::Invalid("Enter an integer 1..=3999".into()))?;
                Ok(json!({ "result": text_convert::to_roman(n)? }))
            }
        }
        "text.morse" => {
            let decode = p_bool(params, "decode", false);
            let res = if decode {
                text_convert::morse_decode(p_str(params, "text"))
            } else {
                text_convert::morse_encode(p_str(params, "text"))
            };
            Ok(json!({ "result": res }))
        }
        "mock.generate" => {
            let fields = params.get("fields").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
            let res = text_convert::generate_mock_data(
                fields,
                p_usize(params, "count", 10),
                p_str(params, "format"),
                p_str(params, "tableName"),
                p_bool(params, "localeZh", false),
            )?;
            Ok(json!({ "result": res }))
        }
        "ws.setActive" => {
            let cfg: storage::WsActiveConfig = serde_json::from_value(params.clone())
                .map_err(|e| Error::Invalid(format!("Invalid WebSocket config payload: {e}")))?;
            plugin.active_ws = Some(cfg.clone());
            let (clean, _) = storage::sanitize_ws_active(&cfg);
            storage::save_json(storage::KEY_WS_ACTIVE, &clean)?;
            Ok(json!({ "saved": true }))
        }
        "ws.connect" => {
            let cfg: storage::WsActiveConfig = serde_json::from_value(params.clone())
                .map_err(|e| Error::Invalid(format!("Invalid WebSocket config payload: {e}")))?;
            plugin.active_ws = Some(cfg.clone());
            let (clean, _) = storage::sanitize_ws_active(&cfg);
            storage::save_json(storage::KEY_WS_ACTIVE, &clean)?;
            connect_ws_tab(plugin, ctx, cfg.clone())?;
            Ok(json!({ "connected": true, "url": cfg.url }))
        }
        "ws.send" => {
            let tab_id = p_str(params, "tabId");
            let ws = plugin
                .ws_conns
                .get(tab_id)
                .ok_or_else(|| Error::Invalid("WebSocket is not connected".into()))?;
            let data = if p_bool(params, "isHex", false) {
                let clean: String = p_str(params, "message").chars().filter(|c| !c.is_whitespace()).collect();
                hex::decode(clean).map_err(|e| Error::Invalid(format!("Invalid hex frame: {e}")))?
            } else {
                p_str(params, "message").as_bytes().to_vec()
            };
            ws.send(&data)?;
            Ok(json!({ "sent": true, "bytes": data.len() }))
        }
        "ws.disconnect" => {
            let tab_id = p_str(params, "tabId");
            if let Some(ws) = plugin.ws_conns.remove(tab_id) {
                let _ = ws.close();
            }
            Ok(json!({ "connected": false }))
        }
        "ws.status" => {
            let tab_id = p_str(params, "tabId");
            Ok(json!({ "connected": plugin.ws_conns.contains_key(tab_id) }))
        }

        // --- Storage & Workspace ---
        "storage.saveWorkspace" => {
            let ws: storage::WorkspaceState = serde_json::from_value(params.clone())
                .map_err(|e| Error::Invalid(format!("Invalid workspace payload: {e}")))?;
            storage::save_json(storage::KEY_WORKSPACE, &ws)?;
            Ok(json!({ "saved": true }))
        }
        "storage.saveFavorites" => {
            let favs: Vec<String> = serde_json::from_value(params.get("favorites").cloned().unwrap_or(json!([])))
                .map_err(|e| Error::Invalid(e.to_string()))?;
            storage::save_json(storage::KEY_FAVORITES, &favs)?;
            refresh_status_menu();
            Ok(json!({ "saved": true }))
        }
        "storage.recordRecent" => {
            let tool_id = p_str(params, "toolId");
            if catalog::find_tool(tool_id).is_some() {
                let limit = read_settings().max_history_items;
                let recent = storage::push_recent(tool_id, limit)?;
                refresh_status_menu();
                return Ok(json!({ "recent": recent }));
            }
            Ok(json!({ "recent": storage::load_recent() }))
        }
        "storage.saveNotes" => {
            let notes: Vec<storage::NoteEntry> = serde_json::from_value(params.get("notes").cloned().unwrap_or(json!([])))
                .map_err(|e| Error::Invalid(e.to_string()))?;
            storage::save_json(storage::KEY_NOTES, &notes)?;
            Ok(json!({ "saved": true }))
        }
        "storage.saveRegexRules" => {
            let rules: Vec<storage::RegexRule> = serde_json::from_value(params.get("rules").cloned().unwrap_or(json!([])))
                .map_err(|e| Error::Invalid(e.to_string()))?;
            storage::save_json(storage::KEY_REGEX_RULES, &rules)?;
            Ok(json!({ "saved": true }))
        }
        "storage.getToolState" => {
            let state = storage::load_tool_state(p_str(params, "toolId"))?;
            Ok(json!({ "state": state }))
        }
        "storage.setToolState" => {
            let tool_id = p_str(params, "toolId");
            let state = params.get("state").cloned().unwrap_or(Value::Null);
            storage::save_tool_state(tool_id, &state)?;
            Ok(json!({ "saved": true }))
        }
        "locale.get" => {
            let (locale, ide_locale, language_pref) = effective_locale_info();
            Ok(json!({
                "locale": locale,
                "ideLocale": ide_locale,
                "languagePref": language_pref,
            }))
        }
        "storage.setLanguage" => {
            let lang = p_str(params, "language");
            let setting = host::setting_string("language");
            storage::save_language_pref(lang, setting.as_deref())?;
            refresh_status_menu();
            let (locale, ide_locale, language_pref) = effective_locale_info();
            Ok(json!({
                "locale": locale,
                "ideLocale": ide_locale,
                "languagePref": language_pref,
            }))
        }

        // --- IDE Integration ---
        "editor.getSelection" => {
            let editor = ctx.editor().ok_or_else(|| Error::Invalid("No editor is focused".into()))?;
            let text = read_editor_selection_or_all(&editor)?;
            Ok(json!({ "text": text, "language": editor.language(), "path": editor.path() }))
        }
        "editor.applyText" => {
            let editor = ctx.editor().ok_or_else(|| Error::Invalid("No editor is focused".into()))?;
            let replacement = p_str(params, "text").to_owned();
            apply_editor_transform(&editor, TransformScope::SelectionOrAll, |_| Ok(replacement.clone()))?;
            Ok(json!({ "applied": true }))
        }
        "clipboard.read" => {
            let clip = host::read_clipboard()?;
            Ok(json!({
                "text": clip.text,
                "imageBase64": clip.image.map(|b| STANDARD.encode(b)),
            }))
        }
        "clipboard.copy" => {
            host::copy_to_clipboard(p_str(params, "text"))?;
            Ok(json!({ "copied": true }))
        }
        "status.pomodoro" => {
            let pomo: storage::PomodoroState = serde_json::from_value(params.clone())
                .map_err(|e| Error::Invalid(format!("Invalid pomodoro state: {e}")))?;
            storage::save_json(storage::KEY_POMODORO, &pomo)?;
            refresh_status_menu();
            Ok(json!({ "saved": true }))
        }
        "notify" => {
            let level = match p_str(params, "level") {
                "warning" => NotificationLevel::Warning,
                "error" => NotificationLevel::Error,
                _ => NotificationLevel::Info,
            };
            host::notify(level, p_str(params, "title"), p_str(params, "body"));
            Ok(json!({ "sent": true }))
        }
        _ => Err(Error::NotFound(format!("unknown rpc method {method}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use openidea_plugin::mock::MockHost;

    #[test]
    fn catalog_has_55_unique_tools() {
        assert_eq!(catalog::TOOLS.len(), 55);
        let mut ids = std::collections::HashSet::new();
        for t in catalog::TOOLS {
            assert!(ids.insert(t.id), "duplicate tool id {}", t.id);
        }
    }

    #[test]
    fn string_and_escape_roundtrip() {
        assert_eq!(string_tools::convert_case("hello_world_test", string_tools::CaseStyle::Camel), "helloWorldTest");
        assert_eq!(string_tools::convert_case("helloWorldTest", string_tools::CaseStyle::ScreamingSnake), "HELLO_WORLD_TEST");
        assert_eq!(string_tools::swap_quotes("'a' \"b\" `c`"), "\"a\" `b` 'c'");
        assert_eq!(string_tools::step_numbers("v1 item-2 x9", 1), "v2 item-1 x10");
        assert_eq!(
            string_tools::line_op("item10\nitem2\nitem1", "natural-sort", None).unwrap(),
            "item1\nitem2\nitem10"
        );
        for lang in ["json", "java", "xml", "sql", "unicode"] {
            let src = "Hello 'World' & <中文> 😀\nline2";
            let esc = string_tools::escape_text(src, lang).unwrap();
            let back = string_tools::unescape_text(&esc, lang).unwrap();
            assert_eq!(back, src, "roundtrip failed for {lang}");
        }
    }

    #[test]
    fn json_format_sort_jsonpath_schema_and_pojo() {
        let raw = r#"{"b":1,"__proto__":{"x":true},"items":[{"name":"a","score":10},{"name":"b","score":30}]}"#;
        let sorted = formats::format_json(raw, "2", true).unwrap();
        assert!(sorted.contains("\"__proto__\""), "__proto__ must be preserved");
        assert!(sorted.find("\"__proto__\"").unwrap() < sorted.find("\"b\"").unwrap());

        let hit = formats::eval_jsonpath(raw, "$.items[?(@.score > 20)].name").unwrap();
        assert_eq!(hit, json!(["b"]));

        let schema = formats::json_to_schema(raw, Some("Sample")).unwrap();
        assert!(schema.contains("draft-07"));

        let yaml = formats::convert_format(raw, "json", "yaml", "2").unwrap();
        let back = formats::convert_format(&yaml, "yaml", "json", "2").unwrap();
        assert!(back.contains("\"items\""));

        let xml = formats::convert_format(r#"{"user":{"@id":"7","name":"Ada"}}"#, "json", "xml", "2").unwrap();
        let xml_back = formats::convert_format(&xml, "xml", "json", "2").unwrap();
        assert!(xml_back.contains("\"@id\": \"7\""));

        let java = formats::json_to_code(r#"{"user_id":42,"active":true}"#, "java", "UserDto", true).unwrap();
        assert!(java.contains("@Data") && java.contains("@JsonProperty(\"user_id\")"));
    }

    #[test]
    fn converters_timestamp_ip_color_codec() {
        let ts = converters::convert_timestamp("1700000000", "UTC", "%Y-%m-%d %H:%M:%S", "seconds", 0).unwrap();
        assert_eq!(ts.seconds, 1700000000);
        assert!(ts.local_formatted.starts_with("2023-11-14"));

        let ip = converters::analyze_ip_cidr("192.168.1.10/24").unwrap();
        let cidr = ip.cidr.unwrap();
        assert_eq!(cidr.network, "192.168.1.0");
        assert_eq!(cidr.broadcast, "192.168.1.255");
        assert_eq!(cidr.usable_hosts, "254");

        let (col, contrast) = converters::convert_color("#3574F0", Some("#FFFFFF")).unwrap();
        assert_eq!(col.rgb, "rgb(53, 116, 240)");
        assert!(contrast.unwrap() > 4.0);

        let puny = converters::codec_transform("中文.com", "punycode", false).unwrap();
        assert!(puny.starts_with("xn--"));
        assert_eq!(converters::codec_transform(&puny, "punycode", true).unwrap(), "中文.com");
    }

    #[test]
    fn crypto_hashes_symmetric_sm2_rsa_and_jwt() {
        // SM3 official standard vector for "abc"
        let sm3_abc = crypto::hash_digest("abc", "utf8", "sm3", None, "utf8", "hex").unwrap();
        assert_eq!(sm3_abc, "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0");

        let sha_hmac = crypto::hash_digest("hello", "utf8", "sha256", Some("secret"), "utf8", "hex").unwrap();
        assert_eq!(sha_hmac.len(), 64);

        // AES-128-GCM & SM4-CBC roundtrips
        let ct_aes = crypto::symmetric_crypt(
            "aes-128", "gcm", "pkcs7", true,
            "hello gcm", "utf8",
            "0123456789abcdef", "utf8",
            "123456789012", "utf8",
            "base64",
        ).unwrap();
        let pt_aes = crypto::symmetric_crypt(
            "aes-128", "gcm", "pkcs7", false,
            &ct_aes, "base64",
            "0123456789abcdef", "utf8",
            "123456789012", "utf8",
            "utf8",
        ).unwrap();
        assert_eq!(pt_aes, "hello gcm");

        let ct_sm4 = crypto::symmetric_crypt(
            "sm4", "cbc", "pkcs7", true,
            "国密SM4测试", "utf8",
            "0123456789abcdef", "utf8",
            "fedcba9876543210", "utf8",
            "hex",
        ).unwrap();
        let pt_sm4 = crypto::symmetric_crypt(
            "sm4", "cbc", "pkcs7", false,
            &ct_sm4, "hex",
            "0123456789abcdef", "utf8",
            "fedcba9876543210", "utf8",
            "utf8",
        ).unwrap();
        assert_eq!(pt_sm4, "国密SM4测试");

        let ct_sm4_gcm = crypto::symmetric_crypt(
            "sm4", "gcm", "pkcs7", true,
            "sm4-gcm-ok", "utf8",
            "0123456789abcdef", "utf8",
            "123456789012", "utf8",
            "base64",
        ).unwrap();
        let pt_sm4_gcm = crypto::symmetric_crypt(
            "sm4", "gcm", "pkcs7", false,
            &ct_sm4_gcm, "base64",
            "0123456789abcdef", "utf8",
            "123456789012", "utf8",
            "utf8",
        ).unwrap();
        assert_eq!(pt_sm4_gcm, "sm4-gcm-ok");

        // SM2 keygen + encrypt/decrypt + sign/verify
        let sm2_kp = crypto::sm2_keygen().unwrap();
        let sm2_ct = crypto::sm2_encrypt(&sm2_kp.public_key, "SM2 payload", "C1C3C2", "base64").unwrap();
        let sm2_pt = crypto::sm2_decrypt(&sm2_kp.private_key, &sm2_ct, "base64", "C1C3C2").unwrap();
        assert_eq!(sm2_pt, "SM2 payload");
        let sm2_sig = crypto::sm2_sign(&sm2_kp.private_key, "msg", "", "hex").unwrap();
        assert!(crypto::sm2_verify(&sm2_kp.public_key, "msg", "", &sm2_sig, "hex").unwrap());

        // RSA 1024 keygen + encrypt/decrypt + sign/verify + JWT RS256/HS256
        let rsa_kp = crypto::rsa_keygen(1024).unwrap();
        let rsa_ct = crypto::rsa_encrypt(&rsa_kp.public_key, "rsa secret", "oaep", "base64").unwrap();
        let rsa_pt = crypto::rsa_decrypt(&rsa_kp.private_key, &rsa_ct, "base64", "oaep").unwrap();
        assert_eq!(rsa_pt, "rsa secret");
        let rsa_sig = crypto::rsa_sign(&rsa_kp.private_key, "sign-me", "base64").unwrap();
        assert!(crypto::rsa_verify(&rsa_kp.public_key, "sign-me", &rsa_sig, "base64").unwrap());

        let token = crypto::jwt_sign(r#"{"typ":"JWT"}"#, r#"{"sub":"42"}"#, "HS256", "my-secret").unwrap();
        assert!(crypto::jwt_verify(&token, "my-secret").unwrap());
        assert!(!crypto::jwt_verify(&token, "wrong-secret").unwrap());
        let decoded = crypto::jwt_decode(&token).unwrap();
        assert_eq!(decoded.payload["sub"], "42");
    }

    #[test]
    fn generators_ids_cron_regex_figlet() {
        let snow = generators::generate_ids("snowflake", 1, false, false, 21, "", 1288834974657, 3, 7).unwrap();
        let dec_snow = generators::decode_id(&snow[0], "snowflake", 1288834974657).unwrap();
        assert_eq!(dec_snow.details["datacenterId"], 3);
        assert_eq!(dec_snow.details["workerId"], 7);

        let oid = generators::generate_ids("objectid", 1, false, false, 21, "", 0, 0, 0).unwrap();
        let dec_oid = generators::decode_id(&oid[0], "objectid", 0).unwrap();
        assert_eq!(dec_oid.kind, "MongoDB ObjectId");

        let cron = generators::analyze_cron("0 */15 9-18 ? * MON-FRI", "Asia/Shanghai", 5).unwrap();
        assert_eq!(cron.next_runs.len(), 5);
        assert!(cron.description_zh.contains("15"));

        let re = generators::eval_regex(r"(?P<k>\w+)=(\d+)", "", "é a=10 b=20", Some("$1:$2"));
        assert_eq!(re["count"], 2);
        assert_eq!(re["matches"][0]["s"], 2);
        assert_eq!(re["replaced"], "é a:10 b:20");

        let art = generators::render_ascii_art("HI", "Slant");
        assert!(!art.is_empty());
        for font in ["Standard", "Big", "Slant", "Shadow", "Doom", "Banner", "Small", "Mini", "Block", "Bubble"] {
            let banner = generators::render_ascii_art_with_wrap("OK", font, "//");
            assert!(banner.starts_with("// "), "font {font} failed");
        }
    }

    #[test]
    fn sql_markup_path_calc_hosts_and_curl() {
        // String new ops
        assert_eq!(string_tools::convert_case("foo_bar", string_tools::CaseStyle::Space), "Foo Bar");
        assert_eq!(string_tools::convert_case("Hello World!", string_tools::CaseStyle::Slug), "hello-world");
        assert_eq!(string_tools::wrap_quotes("'abc'", '"'), "\"abc\"");
        assert_eq!(
            string_tools::merge_multiline_cmd("docker run \\\n  --rm \\\n  alpine", "continuation"),
            "docker run --rm alpine"
        );
        assert_eq!(string_tools::line_op("a=1\nlong_key=2", "align-delim", Some("=")).unwrap(), "a        = 1\nlong_key = 2");
        assert_eq!(string_tools::line_op("x\ny\nx", "freq", None).unwrap(), "2\tx\n1\ty");

        // SQL Toolkit
        let ddl = r#"CREATE TABLE `user_profile` (
            `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT 'Primary Key',
            `user_name` VARCHAR(64) NOT NULL,
            `balance` DECIMAL(10, 2) DEFAULT 0.00,
            PRIMARY KEY (`id`)
        );"#;
        let ddl_json = sql_tools::ddl_convert(ddl, "json", "", false).unwrap();
        assert!(ddl_json.contains("\"user_name\""));
        let ddl_md = sql_tools::ddl_convert(ddl, "markdown", "", false).unwrap();
        assert!(ddl_md.contains("| `id` | `BIGINT` | NO | PK | Primary Key |"));
        let ddl_java = sql_tools::ddl_convert(ddl, "java", "", true).unwrap();
        assert!(ddl_java.contains("@Data") && ddl_java.contains("userName"));
        let ddl_ts = sql_tools::ddl_convert(ddl, "typescript", "", false).unwrap();
        assert!(ddl_ts.contains("balance?: number;"));
        let ddl_go = sql_tools::ddl_convert(ddl, "go", "", false).unwrap();
        assert!(ddl_go.contains("Balance *float64"));
        let ddl_rust = sql_tools::ddl_convert(ddl, "rust", "", false).unwrap();
        assert!(ddl_rust.contains("pub balance: Option<f64>"));

        assert_eq!(
            sql_tools::strip_qualifiers("SELECT u.`id`, t.amount * 1.5 FROM db.`orders` t WHERE u.note = 'a.b'"),
            "SELECT id, amount * 1.5 FROM orders t WHERE note = 'a.b'"
        );
        assert_eq!(
            sql_tools::bind_sql_params("SELECT * FROM users WHERE id = ? AND name = ? AND active = ?", "42(Long), Alice(String), true(Boolean)").unwrap(),
            "SELECT * FROM users WHERE id = 42 AND name = 'Alice' AND active = true"
        );

        // Markup converter + XSS escaping
        let html = markup::convert_markup("# Hello\n\n[Click](javascript:alert(1)) & `<script>`", "markdown", "html").unwrap();
        assert!(html.contains("<h1>Hello</h1>"));
        assert!(html.contains("href=\"#\"") && html.contains("&lt;script&gt;"));
        let bb = markup::convert_markup("**Bold** and `code`", "markdown", "bbcode").unwrap();
        assert_eq!(bb, "[b]Bold[/b] and [code]code[/code]");
        let back_md = markup::convert_markup(&bb, "bbcode", "markdown").unwrap();
        assert_eq!(back_md, "**Bold** and `code`");
        let adoc = markup::convert_markup("## Sub\n\n- item", "markdown", "asciidoc").unwrap();
        assert!(adoc.contains("== Sub") && adoc.contains("* item"));

        // Path converter
        let win_p = extra_tools::convert_path(r"C:\Users\alice\proj\main.rs", "Ubuntu");
        assert_eq!(win_p["posix"], "C:/Users/alice/proj/main.rs");
        assert_eq!(win_p["wsl"], "/mnt/c/Users/alice/proj/main.rs");
        assert_eq!(win_p["gitBash"], "/c/Users/alice/proj/main.rs");
        assert_eq!(win_p["fileUri"], "file:///C:/Users/alice/proj/main.rs");
        assert_eq!(extra_tools::toggle_path_slashes(r"foo\bar\baz"), "foo/bar/baz");

        // Decimal & Expression calculator
        let exact = extra_tools::eval_expression("0.1 + 0.2", "auto").unwrap();
        assert_eq!(exact["result"], "0.3");
        assert_eq!(exact["exact"], true);
        let bit = extra_tools::eval_expression("(0xFF & 0x0F) << 4", "auto").unwrap();
        assert_eq!(bit["integer"]["dec"], "240");
        assert_eq!(bit["integer"]["hex"], "0xF0");

        // Hosts validation + conflicts
        let compiled = extra_tools::compile_hosts(&[
            storage::HostProfile { id: "1".into(), name: "Dev".into(), enabled: true, content: "127.0.0.1 api.local\nbad_ip foo.local".into() },
            storage::HostProfile { id: "2".into(), name: "Stage".into(), enabled: true, content: "10.0.0.2 api.local".into() },
        ]);
        assert_eq!(compiled["errors"].as_array().unwrap().len(), 1);
        assert_eq!(compiled["conflicts"][0]["differentIps"], true);

        // File hashing
        let all_h = crypto::hash_bytes_all(b"abc").unwrap();
        assert_eq!(all_h["sm3"], "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0");

        // cURL parser & exporter
        let parsed = extra_tools::parse_curl("curl -X POST 'https://api.example.com/v1/items?a=1' \\\n  -H 'Content-Type: application/json' -d '{\"k\":1}'").unwrap();
        assert_eq!(parsed["method"], "POST");
        assert_eq!(parsed["url"], "https://api.example.com/v1/items?a=1");
        let exported = extra_tools::export_http_code(&parsed, "fetch").unwrap();
        assert!(exported.contains("fetch(\"https://api.example.com/v1/items?a=1\""));
    }

    #[test]
    fn blockchain_bip39_bip32_bip44_signing_vectors() {
        // Official BIP-39 / BIP-44 / BIP-84 vector for "abandon ... about"
        let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let wallet = blockchain::derive_wallet(mnemonic, "", 0, 0).unwrap();
        assert_eq!(wallet["wordCount"], 12);
        assert_eq!(wallet["chains"]["ethereum"]["address"], "0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
        assert_eq!(wallet["chains"]["bitcoinSegwit"]["address"], "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
        assert!(wallet["chains"]["bitcoinLegacy"]["address"].as_str().unwrap().starts_with('1'));
        assert!(wallet["chains"]["tron"]["address"].as_str().unwrap().starts_with('T'));
        assert!(!wallet["chains"]["solana"]["address"].as_str().unwrap().is_empty());
        assert!(wallet["chains"]["sui"]["address"].as_str().unwrap().starts_with("0x"));

        // EIP-191 sign + ecrecover verify roundtrip
        let eth_priv = wallet["chains"]["ethereum"]["privateKey"].as_str().unwrap();
        let eth_addr = wallet["chains"]["ethereum"]["address"].as_str().unwrap();
        let sig_res = blockchain::sign_message("evm", eth_priv, "OpenIDEA Toolset").unwrap();
        assert_eq!(sig_res["signerAddress"], eth_addr);
        let ver_res = blockchain::verify_message("evm", eth_addr, "OpenIDEA Toolset", sig_res["signature"].as_str().unwrap()).unwrap();
        assert_eq!(ver_res["valid"], true);

        // Ed25519 sign + verify roundtrip
        let sol_priv = wallet["chains"]["solana"]["privateKey"].as_str().unwrap();
        let sol_addr = wallet["chains"]["solana"]["address"].as_str().unwrap();
        let ed_sig = blockchain::sign_message("ed25519", sol_priv, "Solana hello").unwrap();
        let ed_ver = blockchain::verify_message("ed25519", sol_addr, "Solana hello", ed_sig["signatureBase58"].as_str().unwrap()).unwrap();
        assert_eq!(ed_ver["valid"], true);
    }

    #[test]
    fn mock_host_commands_views_search_and_status_menu() {
        let host = MockHost::install()
            .with_capabilities(&["editor.read", "editor.write", "clipboard", "clipboard.read", "storage", "net:api.example.com"]);
        let mut plugin = Toolset::default();
        plugin.activate(&host.context("ruyimg.toolset")).unwrap();
        let menu = host.status_menu(STATUS_ID);
        assert!(!menu.is_empty());

        // Editor in-place multi-cursor transform
        host.open_editor("/proj/demo.txt", "plaintext", "foo_bar baz_qux", &[(0, 0, 0, 7), (0, 8, 0, 15)]);
        plugin.run_command("camel-case", &host.invocation(), None).unwrap();
        assert_eq!(host.editor_text(), "fooBar bazQux");

        // Search Everywhere tools + saved regex rules
        let rules = vec![storage::RegexRule {
            id: "r1".into(),
            name: "Strip Trailing Spaces".into(),
            pattern: "[ \\t]+$".into(),
            replacement: "".into(),
            flags: "m".into(),
            description: "Trim line ends".into(),
        }];
        storage::save_json(storage::KEY_REGEX_RULES, &rules).unwrap();
        let page = plugin.search("tools", "strip", 20, &host.invocation()).unwrap();
        assert!(page.items.iter().any(|i| i.id == "rule:r1"));
        let ts_page = plugin.search("tools", "ts", 10, &host.invocation()).unwrap();
        assert_eq!(ts_page.items[0].id, "tool:timestamp");

        // WebView ready + RPC roundtrip + open-tool handoff
        plugin.run_command("open-tool", &host.invocation(), Some("json-tools")).unwrap();
        plugin
            .handle(VIEW, ViewEvent::Message(json!({ "op": "ready" }).to_string()), &host.invocation())
            .unwrap();
        let (_, init_raw) = host.view_messages().pop().unwrap();
        let init: Value = serde_json::from_str(&init_raw).unwrap();
        assert_eq!(init["op"], "init");
        assert_eq!(init["pending"]["toolId"], "json-tools");

        let rpc_req = json!({
            "op": "rpc",
            "id": 99,
            "method": "crypto.hash",
            "params": { "text": "abc", "inputEncoding": "utf8", "alg": "sm3", "outputEncoding": "hex" }
        });
        plugin
            .handle(VIEW, ViewEvent::Message(rpc_req.to_string()), &host.invocation())
            .unwrap();
        let (_, rpc_raw) = host.view_messages().pop().unwrap();
        let rpc_res: Value = serde_json::from_str(&rpc_raw).unwrap();
        assert_eq!(rpc_res["id"], 99);
        assert_eq!(rpc_res["ok"], true);
        assert_eq!(
            rpc_res["data"]["result"],
            "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0"
        );

        // Apply custom regex rule directly to editor
        host.open_editor("/proj/demo2.txt", "plaintext", "foo   \nbar\t \n", &[(0, 0, 0, 0)]);
        plugin.run_command("apply-regex-rule", &host.invocation(), Some("r1")).unwrap();
        assert_eq!(host.editor_text(), "foo\nbar\n");

        // Clipboard JSON format + Pomodoro status update
        host.set_clipboard(Some(r#"{"a":1,"b":[2,3]}"#), None);
        plugin.run_command("format-clipboard-json", &host.invocation(), None).unwrap();
        assert!(host.clipboard().is_some_and(|c| c.contains("  \"a\": 1")));

        plugin.run_command("pomodoro-toggle", &host.invocation(), None).unwrap();
        assert!(storage::load_pomodoro().running);

        // HTTP send command + host::fetch mock roundtrip
        host.on_fetch(|req| {
            Ok(openidea_plugin::HttpResponse {
                status: 200,
                headers: vec![("content-type".into(), "application/json".into())],
                body: format!(r#"{{"method":"{}"}}"#, req.method).into_bytes(),
            })
        });
        let http_req = storage::HttpActiveRequest {
            tab_id: "tab-http-1".into(),
            method: "POST".into(),
            url: "https://api.example.com/ping".into(),
            headers: vec![("X-Test".into(), "1".into())],
            body: Some("{}".into()),
            timeout_ms: Some(5000),
        };
        storage::save_json(storage::KEY_HTTP_ACTIVE, &http_req).unwrap();
        plugin.run_command("http-send", &host.invocation(), None).unwrap();
        let (_, push_raw) = host.view_messages().pop().unwrap();
        let push_val: Value = serde_json::from_str(&push_raw).unwrap();
        assert_eq!(push_val["op"], "http-response");
        assert_eq!(push_val["data"]["status"], 200);
    }

    #[test]
    fn language_pref_follows_ide_and_overrides() {
        let host = MockHost::install();
        host.set_locale("zh-CN");
        let mut plugin = Toolset::default();
        plugin.activate(&host.context("ruyimg.toolset")).unwrap();

        // Default is auto -> follows OpenIDEA's zh-CN locale.
        assert_eq!(storage::resolve_language_pref(None), "auto");
        let loc_res = handle_rpc(&mut plugin, "locale.get", &json!({}), &host.invocation()).unwrap();
        assert_eq!(loc_res["languagePref"], "auto");
        assert_eq!(loc_res["ideLocale"], "zh-CN");
        assert_eq!(loc_res["locale"], "zh-CN");

        // Independent override -> force English even though IDE is zh-CN.
        let set_en = handle_rpc(&mut plugin, "storage.setLanguage", &json!({ "language": "en" }), &host.invocation()).unwrap();
        assert_eq!(set_en["languagePref"], "en");
        assert_eq!(set_en["locale"], "en");
        let menu_en = host.status_menu(STATUS_ID);
        assert!(matches!(&menu_en[0], StatusMenuEntry::Action { label, .. } if label == "Open Toolset Panel"));

        // Independent override -> force zh-CN even when IDE switches to English.
        host.set_locale("en");
        let set_zh = handle_rpc(&mut plugin, "storage.setLanguage", &json!({ "language": "zh-CN" }), &host.invocation()).unwrap();
        assert_eq!(set_zh["languagePref"], "zh-CN");
        assert_eq!(set_zh["ideLocale"], "en");
        assert_eq!(set_zh["locale"], "zh-CN");
        let menu_zh = host.status_menu(STATUS_ID);
        assert!(matches!(&menu_zh[0], StatusMenuEntry::Action { label, .. } if label == "打开工具箱面板"));

        // Switch back to auto -> resumes following OpenIDEA locale.
        let set_auto = handle_rpc(&mut plugin, "storage.setLanguage", &json!({ "language": "auto" }), &host.invocation()).unwrap();
        assert_eq!(set_auto["languagePref"], "auto");
        assert_eq!(set_auto["locale"], "en");

        // Changing IDE plugin setting supersedes previous in-panel choice.
        host.set_setting("language", "\"zh-CN\"");
        let after_setting = handle_rpc(&mut plugin, "locale.get", &json!({}), &host.invocation()).unwrap();
        assert_eq!(after_setting["languagePref"], "zh-CN");
        assert_eq!(after_setting["locale"], "zh-CN");
    }

    #[test]
    fn parity_tools_totp_cert_csv_text_json_codecs_hashes_and_ws() {
        // RFC 6238 TOTP / RFC 4226 HOTP official SHA1 test vectors
        // Secret "12345678901234567890" = Base32 "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
        let rfc_secret = totp_tools::encode_base32(b"12345678901234567890");
        assert_eq!(rfc_secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
        assert_eq!(totp_tools::compute_hotp(&rfc_secret, 0, 6, "SHA1").unwrap(), "755224");
        assert_eq!(totp_tools::compute_hotp(&rfc_secret, 1, 6, "SHA1").unwrap(), "287082");
        let totp = totp_tools::compute_totp(&rfc_secret, 30, 8, "SHA1", Some(59)).unwrap();
        assert_eq!(totp["code"], "94287082");
        let uri = totp_tools::build_otpauth_uri("totp", "OpenIDEA", "alice@dev", &rfc_secret, "SHA1", 6, 30, 0);
        let parsed_uri = totp_tools::parse_otpauth_uri(&uri).unwrap();
        assert_eq!(parsed_uri["issuer"], "OpenIDEA");
        assert_eq!(parsed_uri["account"], "alice@dev");

        // X.509 certificate inspector with dynamically generated valid DER sample
        let pem = cert_tools::sample_certificate_pem();
        let inspected = cert_tools::inspect_pem_or_der(&pem).unwrap();
        let cert = &inspected["items"][0];
        assert_eq!(cert["version"], 3);
        assert!(cert["subject"].as_str().unwrap().contains("CN=openidea.dev"));
        assert!(cert["sans"].as_array().unwrap().iter().any(|s| s == "DNS:openidea.dev"));
        assert_eq!(cert["isCa"], false);
        assert_eq!(cert["publicKeyBits"], 2048);

        // CSV & table converter
        let csv_in = "id,name,active\n1,\"Alice, Jr.\",true\n2,Bob,false";
        let md = csv_tools::convert_table(csv_in, "csv", "markdown", ",", true, "users", false).unwrap();
        assert!(md.contains("| id | name | active |"));
        assert!(md.contains("| 1 | Alice, Jr. | true |"));
        let sql = csv_tools::convert_table(csv_in, "csv", "sql-insert", ",", true, "users", false).unwrap();
        assert!(sql.contains("INSERT INTO `users` (`id`, `name`, `active`) VALUES (1, 'Alice, Jr.', TRUE);"));

        // Text conversions: Full/Half width, RMB capital, Roman, Morse, Mock
        assert_eq!(text_convert::to_halfwidth("Ｈｅｌｌｏ，　１２３！", true), "Hello, 123!");
        assert_eq!(text_convert::to_fullwidth("AB 12", false), "ＡＢ\u{3000}１２");
        assert_eq!(text_convert::number_to_rmb("12345.67").unwrap()["rmb"], "壹万贰仟叁佰肆拾伍元陆角柒分");
        assert_eq!(text_convert::number_to_rmb("100").unwrap()["rmb"], "壹佰元整");
        assert_eq!(text_convert::to_roman(2026).unwrap(), "MMXXVI");
        assert_eq!(text_convert::from_roman("MMXXVI").unwrap(), 2026);
        let morse = text_convert::morse_encode("SOS 2026");
        assert_eq!(text_convert::morse_decode(&morse), "SOS 2026");
        let mock_json = text_convert::generate_mock_data(
            &[json!({"name": "id", "type": "sequence"}), json!({"name": "role", "type": "enum", "options": "admin,dev"})],
            3,
            "json",
            "t",
            false,
        )
        .unwrap();
        let mock_arr: Value = serde_json::from_str(&mock_json).unwrap();
        assert_eq!(mock_arr.as_array().unwrap().len(), 3);

        // Relaxed JSON repair, flatten/unflatten & semantic diff
        let dirty = "{ // comment\n  name: 'OpenIDEA', 'items': [1, 2,], flag: undefined, }";
        let repaired = formats::repair_json(dirty, "2").unwrap();
        assert!(repaired.contains("\"name\": \"OpenIDEA\""));
        assert!(repaired.contains("\"flag\": null"));
        let flat = formats::flatten_json(r#"{"a":{"b":1,"c":[true,"x"]}}"#, ".").unwrap();
        assert!(flat.contains("\"a.b\": 1") && flat.contains("\"a.c.1\": \"x\""));
        let unflat = formats::unflatten_json(&flat, ".").unwrap();
        assert!(unflat.contains("\"b\": 1"));
        let diff = formats::diff_json(r#"{"a":1,"b":2}"#, r#"{"b":3,"a":1,"c":4}"#).unwrap();
        assert_eq!(diff["equal"], false);
        assert_eq!(diff["summary"]["added"], 1);
        assert_eq!(diff["summary"]["changed"], 1);

        // New codecs (Base32, Base58, Base85, Binary) & hashes (BLAKE2s256, BLAKE2b512, Keccak-256, RIPEMD-160)
        for mode in ["base32", "base58", "base85", "binary"] {
            let enc = converters::codec_transform("OpenIDEA-Toolset!", mode, false).unwrap();
            let dec = converters::codec_transform(&enc, mode, true).unwrap();
            assert_eq!(dec, "OpenIDEA-Toolset!", "roundtrip failed for {mode}");
        }
        assert_eq!(crypto::hash_digest("", "utf8", "keccak256", None, "utf8", "hex").unwrap(), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
        assert_eq!(crypto::hash_digest("abc", "utf8", "blake2s256", None, "utf8", "hex").unwrap().len(), 64);
        assert_eq!(crypto::hash_digest("abc", "utf8", "blake2b512", None, "utf8", "hex").unwrap().len(), 128);
        assert_eq!(crypto::hash_digest("abc", "utf8", "ripemd160", None, "utf8", "hex").unwrap().len(), 40);

        // MockHost WebSocket connect -> send -> push_websocket_message -> handle_events -> disconnect
        let host = MockHost::install().with_capabilities(&[
            "project.read",
            "events",
            "storage",
            "net:ws.example.com",
        ]);
        let mut plugin = Toolset::default();
        plugin.activate(&host.context("ruyimg.toolset")).unwrap();
        handle_rpc(
            &mut plugin,
            "ws.connect",
            &json!({ "tabId": "ws-1", "url": "wss://ws.example.com/stream", "headers": [], "subprotocol": "" }),
            &host.invocation(),
        )
        .unwrap();
        handle_rpc(
            &mut plugin,
            "ws.send",
            &json!({ "tabId": "ws-1", "message": "ping", "isHex": false }),
            &host.invocation(),
        )
        .unwrap();
        let socks = host.websockets();
        assert_eq!(socks.len(), 1);
        assert_eq!(socks[0].sent, vec![b"ping".to_vec()]);
        host.push_websocket_message(socks[0].id, b"pong").unwrap();
        plugin.handle_events(
            &[Event::WebSocketReady(openidea_plugin::WebSocketReady {
                plugin_id: "ruyimg.toolset".into(),
                connection: socks[0].id,
            })],
            &host.invocation(),
        );
        let (_, ws_msg_raw) = host.view_messages().pop().unwrap();
        let ws_msg: Value = serde_json::from_str(&ws_msg_raw).unwrap();
        assert_eq!(ws_msg["op"], "ws-event");
        assert_eq!(ws_msg["messages"][0]["text"], "pong");
        handle_rpc(&mut plugin, "ws.disconnect", &json!({ "tabId": "ws-1" }), &host.invocation()).unwrap();
    }

    fn call_view_rpc(plugin: &mut Toolset, host: &MockHost, id: i64, method: &str, params: Value) -> Value {
        let req = json!({ "op": "rpc", "id": id, "method": method, "params": params });
        plugin
            .handle(VIEW, ViewEvent::Message(req.to_string()), &host.invocation())
            .unwrap();
        let (_, raw) = host.view_messages().pop().unwrap();
        let reply: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(reply["id"], id);
        assert_eq!(reply["ok"], true, "RPC {method} failed: {reply}");
        reply["data"].clone()
    }

    #[test]
    fn sql_and_css_minify_and_editor_apply_preserve_literals_and_comments() {
        let host = MockHost::install().with_capabilities(&["editor.read", "editor.write", "storage"]);
        let mut plugin = Toolset::default();
        plugin.activate(&host.context("ruyimg.toolset")).unwrap();

        // 1. SQL string literal whitespace preservation + Apply to Editor
        let sql_literal = "SELECT 'a  b' AS label;";
        host.open_editor("/proj/q.sql", "sql", sql_literal, &[(0, 0, 0, 0)]);
        let min_lit = call_view_rpc(
            &mut plugin,
            &host,
            1,
            "format.code",
            json!({ "text": sql_literal, "lang": "sql", "minify": true, "indent": "2" }),
        );
        assert_eq!(min_lit["result"], "SELECT 'a  b' AS label;");
        call_view_rpc(
            &mut plugin,
            &host,
            2,
            "editor.applyText",
            json!({ "text": min_lit["result"] }),
        );
        assert_eq!(host.editor_text(), "SELECT 'a  b' AS label;");

        // 2. SQL line comment terminator preservation across LF & CRLF
        let min_comment = call_view_rpc(
            &mut plugin,
            &host,
            3,
            "format.code",
            json!({ "text": "SELECT 1 -- note\nFROM items;", "lang": "sql", "minify": true, "indent": "2" }),
        );
        assert_eq!(min_comment["result"], "SELECT 1 -- note\nFROM items;");

        let min_crlf = call_view_rpc(
            &mut plugin,
            &host,
            4,
            "format.code",
            json!({ "text": "SELECT 1 -- note  \r\n   FROM   items ;", "lang": "sql", "minify": true, "indent": "2" }),
        );
        assert_eq!(min_crlf["result"], "SELECT 1 -- note\nFROM items;");

        // 3. SQL escaped quotes, # line comments, dollar-quoting & beautify safety
        let min_escaped = call_view_rpc(
            &mut plugin,
            &host,
            5,
            "format.code",
            json!({ "text": "SELECT 'it''s  -- ok', 'x\\'  y', $$keep  --  $$ # end\nFROM t;", "lang": "sql", "minify": true, "indent": "2" }),
        );
        let min_escaped_s = min_escaped["result"].as_str().unwrap();
        assert!(min_escaped_s.contains("'it''s  -- ok'"));
        assert!(min_escaped_s.contains(r"'x\'  y'"));
        assert!(min_escaped_s.contains("$$keep  --  $$"));
        assert!(min_escaped_s.contains("# end\nFROM t;"));

        let fmt_sql_comment = call_view_rpc(
            &mut plugin,
            &host,
            6,
            "format.code",
            json!({ "text": "select 'a  b' -- c\nfrom items;", "lang": "sql", "minify": false, "indent": "2" }),
        );
        assert_eq!(fmt_sql_comment["result"], "SELECT 'a  b' -- c\nFROM items;");

        // 4. CSS quoted comment markers, escapes, real comment stripping & selector spacing
        let css_quoted = ".x::before { content: \"/* visible */\"; }";
        host.open_editor("/proj/s.css", "css", css_quoted, &[(0, 0, 0, 0)]);
        let min_css = call_view_rpc(
            &mut plugin,
            &host,
            7,
            "format.code",
            json!({ "text": css_quoted, "lang": "css", "minify": true, "indent": "2" }),
        );
        assert_eq!(min_css["result"], ".x::before{content:\"/* visible */\";}");
        call_view_rpc(
            &mut plugin,
            &host,
            8,
            "editor.applyText",
            json!({ "text": min_css["result"] }),
        );
        assert_eq!(host.editor_text(), ".x::before{content:\"/* visible */\";}");

        let css_complex = "/* header */ div :hover { margin: 10px/*c*/20px; content: \"a \\\"/* s */\\\"  b\"; color : red ; }";
        let min_css_complex = call_view_rpc(
            &mut plugin,
            &host,
            9,
            "format.code",
            json!({ "text": css_complex, "lang": "css", "minify": true, "indent": "2" }),
        );
        assert_eq!(
            min_css_complex["result"],
            "div :hover{margin:10px 20px;content:\"a \\\"/* s */\\\"  b\";color:red;}"
        );
    }

    #[test]
    fn secrets_never_persisted_and_legacy_secrets_scrubbed_on_upgrade() {
        let host = MockHost::install().with_capabilities(&["storage", "events", "net:api.example.com"]);

        // Seed legacy plaintext secrets across all sensitive tools prior to activation (upgrade scenario)
        let _ = host::storage::set(
            "tool:blockchain",
            &json!({
                "subtab": "wallet",
                "wordCount": 24,
                "mnemonic": "test legacy seed words should vanish",
                "passphrase": "legacy-bip39-passphrase",
                "privKey": "0xdeadbeefdeadbeef",
                "showSecrets": true,
                "signature": "0xsig",
                "account": 2,
                "index": 1
            })
            .to_string(),
        );
        let _ = host::storage::set(
            "tool:totp-1",
            &json!({ "kind": "totp", "issuer": "Acme", "secret": "LEGACYBASE32SECRET", "uriInput": "otpauth://totp/Acme?secret=LEGACY" }).to_string(),
        );
        let _ = host::storage::set(
            "tool:asymmetric",
            &json!({ "alg": "rsa", "publicKey": "PUB", "privateKey": "-----BEGIN PRIVATE KEY-----SECRET" }).to_string(),
        );
        let _ = host::storage::set(
            "tool:symmetric",
            &json!({ "alg": "aes-256", "key": "super-secret-aes-key", "iv": "secret-iv" }).to_string(),
        );
        let _ = host::storage::set(
            "tool:jwt",
            &json!({ "alg": "HS256", "secret": "jwt-hmac-secret", "token": "eyJ.secret.jwt" }).to_string(),
        );
        let _ = host::storage::set(
            "tool:hash",
            &json!({ "outputEncoding": "hex", "hmacKey": "legacy-hmac-key" }).to_string(),
        );
        let _ = host::storage::set(
            "tool:http-1",
            &json!({
                "method": "GET",
                "url": "https://api.example.com/v1",
                "authToken": "bearer-secret",
                "authPass": "basic-pass",
                "curlImport": "curl -H 'Authorization: Bearer x'",
                "headers": [
                    { "enabled": true, "key": "Authorization", "value": "Bearer header-secret" },
                    { "enabled": true, "key": "Accept", "value": "application/json" }
                ]
            })
            .to_string(),
        );
        let _ = host::storage::set(
            "tool:urlparser-1",
            &json!({
                "rawUrl": "https://alice:hunter2@example.com/path?a=1",
                "username": "alice",
                "password": "hunter2"
            })
            .to_string(),
        );
        let _ = host::storage::set(
            "tool:ua-headers",
            &json!({
                "tab": "headers",
                "ua": "Mozilla/5.0",
                "rawHeaders": "Set-Cookie: session=top-secret-cookie\nAuthorization: Bearer secret-hdr"
            })
            .to_string(),
        );
        let _ = host::storage::set(
            "tool:spring-config",
            &json!({
                "tab": "diff",
                "left": "DB_PASSWORD=top-secret-db-pass",
                "right": "API_KEY=prod-api-key-999"
            })
            .to_string(),
        );
        let _ = host::storage::set(
            storage::KEY_HTTP_ACTIVE,
            &json!({
                "tabId": "http-1",
                "method": "GET",
                "url": "https://api.example.com/v1",
                "headers": [["Authorization", "Bearer top-secret"], ["X-Trace", "123"]],
                "body": null,
                "timeoutMs": 5000
            })
            .to_string(),
        );

        let mut plugin = Toolset::default();
        plugin.activate(&host.context("ruyimg.toolset")).unwrap();

        let store = host.storage();
        for forbidden in [
            "test legacy seed words should vanish",
            "legacy-bip39-passphrase",
            "0xdeadbeefdeadbeef",
            "LEGACYBASE32SECRET",
            "-----BEGIN PRIVATE KEY-----SECRET",
            "super-secret-aes-key",
            "secret-iv",
            "jwt-hmac-secret",
            "eyJ.secret.jwt",
            "legacy-hmac-key",
            "bearer-secret",
            "basic-pass",
            "header-secret",
            "hunter2",
            "Bearer top-secret",
            "top-secret-cookie",
            "Bearer secret-hdr",
            "top-secret-db-pass",
            "prod-api-key-999",
        ] {
            for (k, v) in &store {
                assert!(!v.contains(forbidden), "storage key {k} still contains scrubbed secret {forbidden:?}");
            }
        }
        // Non-sensitive preferences survived upgrade scrubbing
        let bc: Value = serde_json::from_str(&store["tool:blockchain"]).unwrap();
        assert_eq!(bc["wordCount"], 24);
        assert_eq!(bc["account"], 2);
        let url_st: Value = serde_json::from_str(&store["tool:urlparser-1"]).unwrap();
        assert_eq!(url_st["rawUrl"], "https://alice@example.com/path?a=1");

        // Attempting to persist secrets via storage.setToolState strips secrets before storage write
        call_view_rpc(
            &mut plugin,
            &host,
            10,
            "storage.setToolState",
            json!({
                "toolId": "blockchain",
                "state": {
                    "wordCount": 18,
                    "mnemonic": "fresh sensitive mnemonic",
                    "passphrase": "fresh pass",
                    "privKey": "0x11223344",
                    "showSecrets": true,
                    "account": 3
                }
            }),
        );
        let raw_bc = host.storage().get("tool:blockchain").cloned().unwrap();
        assert!(!raw_bc.contains("fresh sensitive mnemonic"));
        assert!(!raw_bc.contains("fresh pass"));
        assert!(!raw_bc.contains("0x11223344"));
        let saved_bc: Value = serde_json::from_str(&raw_bc).unwrap();
        assert_eq!(saved_bc["wordCount"], 18);
        assert_eq!(saved_bc["account"], 3);

        // In-memory active_http keeps Authorization header for live http-send while persisted state omits it
        host.on_fetch(|req| {
            assert!(req.headers.iter().any(|(k, v)| k == "Authorization" && v == "Bearer live-only-token"));
            Ok(openidea_plugin::HttpResponse {
                status: 200,
                headers: vec![],
                body: b"ok".to_vec(),
            })
        });
        call_view_rpc(
            &mut plugin,
            &host,
            11,
            "http.setActive",
            json!({
                "tabId": "http-1",
                "method": "GET",
                "url": "https://api.example.com/live",
                "headers": [["Authorization", "Bearer live-only-token"], ["Accept", "application/json"]],
                "body": null,
                "timeoutMs": 5000
            }),
        );
        assert!(!host.storage()[storage::KEY_HTTP_ACTIVE].contains("live-only-token"));
        assert!(host.storage()[storage::KEY_HTTP_ACTIVE].contains("Accept"));
        plugin.run_command("http-send", &host.invocation(), None).unwrap();

        // Attempting to persist rawHeaders in ua-headers strips sensitive headers
        call_view_rpc(
            &mut plugin,
            &host,
            12,
            "storage.setToolState",
            json!({
                "toolId": "ua-headers",
                "state": {
                    "tab": "headers",
                    "ua": "CustomUA/1.0",
                    "rawHeaders": "Cookie: session=fresh-cookie-secret"
                }
            }),
        );
        let raw_ua = host.storage().get("tool:ua-headers").cloned().unwrap();
        assert!(!raw_ua.contains("fresh-cookie-secret"));
        let saved_ua: Value = serde_json::from_str(&raw_ua).unwrap();
        assert_eq!(saved_ua["ua"], "CustomUA/1.0");

        // Attempting to persist spring-config raw contents strips left/right/envText
        call_view_rpc(
            &mut plugin,
            &host,
            13,
            "storage.setToolState",
            json!({
                "toolId": "spring-config",
                "state": {
                    "tab": "diff",
                    "left": "SECRET_KEY=fresh-spring-secret",
                    "right": "TOKEN=fresh-prod-token",
                    "maskSecrets": true
                }
            }),
        );
        let raw_cfg = host.storage().get("tool:spring-config").cloned().unwrap();
        assert!(!raw_cfg.contains("fresh-spring-secret"));
        assert!(!raw_cfg.contains("fresh-prod-token"));
        let saved_cfg: Value = serde_json::from_str(&raw_cfg).unwrap();
        assert_eq!(saved_cfg["tab"], "diff");
        assert_eq!(saved_cfg["maskSecrets"], true);
    }

    #[test]
    fn v050_xml_query_and_new_string_ops() {
        // New string_tools::line_op transforms
        assert_eq!(
            string_tools::line_op("alpha\nbeta\nalpha\ngamma\nbeta", "duplicates-only", None).unwrap(),
            "alpha\nbeta"
        );
        assert_eq!(
            string_tools::line_op("one two three\na b", "reverse-words", None).unwrap(),
            "three two one\nb a"
        );
        assert_eq!(
            string_tools::line_op("first second third\nx", "swap-words", None).unwrap(),
            "second first third\nx"
        );
        assert_eq!(
            string_tools::line_op("alice,admin,20\nbob,user,30", "extract-column", Some(",:2")).unwrap(),
            "admin\nuser"
        );
        assert_eq!(
            string_tools::line_op("10\tdev\tfoo\n20\tops\tbar", "extract-column", Some(r"\t:3")).unwrap(),
            "foo\nbar"
        );
        assert_eq!(
            string_tools::line_op("alpha beta gamma delta", "wrap-lines", Some("11")).unwrap(),
            "alpha beta\ngamma delta"
        );
        let shuffled = string_tools::line_op("a\nb\nc\nd", "shuffle", None).unwrap();
        let mut s_lines: Vec<&str> = shuffled.split('\n').collect();
        s_lines.sort();
        assert_eq!(s_lines, vec!["a", "b", "c", "d"]);

        // XPath queries
        let pom = r#"<project>
            <dependencies>
                <dependency scope="compile"><groupId>org.acme</groupId><artifactId>core</artifactId><version>1.0</version></dependency>
                <dependency scope="test"><groupId>org.junit</groupId><artifactId>junit</artifactId><version>5.10</version></dependency>
            </dependencies>
        </project>"#;
        let xp_text = xml_query::query_xml(pom, "//dependency/artifactId/text()", "xpath", false).unwrap();
        assert_eq!(xp_text["count"], 2);
        assert_eq!(xp_text["matches"][0]["value"], "core");
        assert_eq!(xp_text["matches"][1]["value"], "junit");

        let xp_attr = xml_query::query_xml(pom, "//dependency[@scope='test']/artifactId", "xpath", false).unwrap();
        assert_eq!(xp_attr["count"], 1);
        assert_eq!(xp_attr["matches"][0]["value"], "junit");

        let xp_count = xml_query::query_xml(pom, "count(//dependency)", "xpath", false).unwrap();
        assert_eq!(xp_count["scalar"], 2);

        let xp_pos = xml_query::query_xml(pom, "//dependency[2]/version", "xpath", false).unwrap();
        assert_eq!(xp_pos["matches"][0]["value"], "5.10");

        let xp_union = xml_query::query_xml(pom, "//groupId | //artifactId", "xpath", false).unwrap();
        assert_eq!(xp_union["count"], 4);

        // CSS selectors on XML & tolerant HTML
        let css_res = xml_query::query_xml(pom, "dependencies > dependency[scope=\"test\"] artifactId", "css", false).unwrap();
        assert_eq!(css_res["count"], 1);
        assert_eq!(css_res["matches"][0]["value"], "junit");

        let html = "<div id=\"app\"><meta charset=\"utf-8\"><div class=\"card active\"><span data-role=\"title\">Hello</span><br><span>World</span></div></div>";
        let html_css = xml_query::query_xml(html, ".card.active > span:first-child", "css", true).unwrap();
        assert_eq!(html_css["count"], 1);
        assert_eq!(html_css["matches"][0]["value"], "Hello");
    }
}
