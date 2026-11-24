use openidea_plugin::{Error, host};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const KEY_WORKSPACE: &str = "state:workspace";
pub const KEY_FAVORITES: &str = "state:favorites";
pub const KEY_RECENT: &str = "state:recent";
pub const KEY_NOTES: &str = "state:notes";
pub const KEY_REGEX_RULES: &str = "state:regex_rules";
pub const KEY_REGEX_HISTORY: &str = "state:regex_history";
pub const KEY_HOSTS_PROFILES: &str = "state:hosts_profiles";
pub const KEY_HTTP_ACTIVE: &str = "state:http_active";
pub const KEY_WS_ACTIVE: &str = "state:ws_active";
pub const KEY_POMODORO: &str = "state:pomodoro";
pub const KEY_LANGUAGE: &str = "state:language";
const TOOL_PREFIX: &str = "tool:";
const MAX_VALUE_BYTES: usize = 2 * 1024 * 1024;
const MAX_TOOL_KEYS: usize = 128;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LanguagePrefState {
    pub value: String,
    #[serde(default)]
    pub last_seen_setting: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTab {
    pub tab_id: String,
    pub tool_id: String,
    pub title: String,
    #[serde(default)]
    pub custom_title: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    pub tabs: Vec<WorkspaceTab>,
    pub active_tab_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteEntry {
    pub id: String,
    pub title: String,
    pub content: String,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegexRule {
    pub id: String,
    pub name: String,
    pub pattern: String,
    pub replacement: String,
    pub flags: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegexHistoryEntry {
    pub pattern: String,
    pub flags: String,
    pub saved_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostProfile {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub content: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HttpActiveRequest {
    pub tab_id: String,
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u32>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WsActiveConfig {
    pub tab_id: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub subprotocol: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroState {
    pub phase: String,
    pub running: bool,
    pub remaining_seconds: u32,
    pub completed_cycles: u32,
    pub end_epoch_ms: Option<i64>,
}

impl Default for PomodoroState {
    fn default() -> Self {
        Self {
            phase: "focus".into(),
            running: false,
            remaining_seconds: 25 * 60,
            completed_cycles: 0,
            end_epoch_ms: None,
        }
    }
}

pub fn load_json<T: serde::de::DeserializeOwned>(key: &str) -> Result<Option<T>, Error> {
    let Some(raw) = host::storage::get(key)? else {
        return Ok(None);
    };
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|e| Error::Invalid(format!("corrupt storage entry {key}: {e}")))
}

pub fn save_json<T: Serialize>(key: &str, value: &T) -> Result<(), Error> {
    let json = serde_json::to_string(value).map_err(|e| Error::Invalid(e.to_string()))?;
    if json.len() > MAX_VALUE_BYTES {
        return Err(Error::Invalid(format!("storage payload for {key} exceeds 2 MiB")));
    }
    host::storage::set(key, &json)
}

pub fn load_favorites() -> Vec<String> {
    load_json::<Vec<String>>(KEY_FAVORITES).ok().flatten().unwrap_or_default()
}

pub fn load_recent() -> Vec<String> {
    load_json::<Vec<String>>(KEY_RECENT).ok().flatten().unwrap_or_default()
}

pub fn push_recent(tool_id: &str, limit: usize) -> Result<Vec<String>, Error> {
    let mut recent = load_recent();
    recent.retain(|id| id != tool_id);
    recent.insert(0, tool_id.to_owned());
    recent.truncate(limit.clamp(1, 50));
    save_json(KEY_RECENT, &recent)?;
    Ok(recent)
}

pub fn load_workspace() -> WorkspaceState {
    load_json::<WorkspaceState>(KEY_WORKSPACE).ok().flatten().unwrap_or_default()
}

pub fn load_notes() -> Vec<NoteEntry> {
    load_json::<Vec<NoteEntry>>(KEY_NOTES).ok().flatten().unwrap_or_default()
}

pub fn load_regex_rules() -> Vec<RegexRule> {
    load_json::<Vec<RegexRule>>(KEY_REGEX_RULES).ok().flatten().unwrap_or_default()
}

pub fn load_regex_history() -> Vec<RegexHistoryEntry> {
    load_json::<Vec<RegexHistoryEntry>>(KEY_REGEX_HISTORY).ok().flatten().unwrap_or_default()
}

pub fn load_hosts_profiles() -> Vec<HostProfile> {
    load_json::<Vec<HostProfile>>(KEY_HOSTS_PROFILES).ok().flatten().unwrap_or_default()
}

pub fn load_active_http() -> Option<HttpActiveRequest> {
    load_json::<HttpActiveRequest>(KEY_HTTP_ACTIVE).ok().flatten()
}

pub fn load_active_ws() -> Option<WsActiveConfig> {
    load_json::<WsActiveConfig>(KEY_WS_ACTIVE).ok().flatten()
}

pub fn load_pomodoro() -> PomodoroState {
    load_json::<PomodoroState>(KEY_POMODORO).ok().flatten().unwrap_or_default()
}

pub fn normalize_language_pref(raw: Option<&str>) -> String {
    match raw.map(|s| s.trim().to_ascii_lowercase()) {
        Some(s) if s == "zh" || s.starts_with("zh-") || s.starts_with("zh_") => "zh-CN".into(),
        Some(s) if s == "en" || s.starts_with("en-") || s.starts_with("en_") => "en".into(),
        _ => "auto".into(),
    }
}

pub fn resolve_language_pref(current_setting: Option<&str>) -> String {
    let setting = normalize_language_pref(current_setting);
    if let Ok(Some(saved)) = load_json::<LanguagePrefState>(KEY_LANGUAGE) {
        if normalize_language_pref(Some(&saved.last_seen_setting)) == setting {
            return normalize_language_pref(Some(&saved.value));
        }
    }
    setting
}

pub fn save_language_pref(value: &str, current_setting: Option<&str>) -> Result<String, Error> {
    let normalized = normalize_language_pref(Some(value));
    let setting = normalize_language_pref(current_setting);
    save_json(
        KEY_LANGUAGE,
        &LanguagePrefState {
            value: normalized.clone(),
            last_seen_setting: setting,
        },
    )?;
    Ok(normalized)
}

pub fn load_tool_state(tool_id: &str) -> Result<Option<Value>, Error> {
    let key = tool_key(tool_id)?;
    load_json::<Value>(&key)
}

pub fn save_tool_state(tool_id: &str, state: &Value) -> Result<(), Error> {
    let key = tool_key(tool_id)?;
    let existing = host::storage::keys(TOOL_PREFIX)?;
    if !existing.contains(&key) && existing.len() >= MAX_TOOL_KEYS {
        if let Some(oldest) = existing.first() {
            let _ = host::storage::delete(oldest);
        }
    }
    save_json(&key, state)
}

fn tool_key(tool_id: &str) -> Result<String, Error> {
    if tool_id.is_empty() || tool_id.len() > 64 || !tool_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(Error::Invalid("invalid tool state id".into()));
    }
    Ok(format!("{TOOL_PREFIX}{tool_id}"))
}
