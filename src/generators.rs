use chrono::{Datelike, Duration, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
use openidea_plugin::Error;
use rand::RngExt;
use regex::RegexBuilder;
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::sync::atomic::{AtomicU32, Ordering};
use ulid::Ulid;
use uuid::Uuid;

static OBJ_COUNTER: AtomicU32 = AtomicU32::new(1);
static SNOW_SEQ: AtomicU32 = AtomicU32::new(0);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdBatch {
    pub ids: Vec<String>,
}

pub fn generate_ids(
    kind: &str,
    count: usize,
    uppercase: bool,
    no_hyphens: bool,
    nanoid_len: usize,
    nanoid_alphabet: &str,
    sf_epoch_ms: i64,
    sf_dc: u64,
    sf_worker: u64,
) -> Result<Vec<String>, Error> {
    let n = count.clamp(1, 100);
    let mut out = Vec::with_capacity(n);
    for _ in 0..n {
        let mut s = match kind {
            "uuid-v4" => Uuid::new_v4().to_string(),
            "uuid-v7" => Uuid::now_v7().to_string(),
            "uuid-v1" => {
                let ts = uuid::Timestamp::now(uuid::NoContext);
                let mut node = [0u8; 6];
                getrandom::fill(&mut node).map_err(|e| Error::Failed(e.to_string()))?;
                node[0] |= 0x01;
                Uuid::new_v1(ts, &node).to_string()
            }
            "ulid" => Ulid::generate().to_string(),
            "nanoid" => gen_nanoid(nanoid_len.clamp(4, 128), nanoid_alphabet)?,
            "snowflake" => {
                let now_ms = Utc::now().timestamp_millis();
                let delta = (now_ms - sf_epoch_ms).max(0) as u64;
                let seq = (SNOW_SEQ.fetch_add(1, Ordering::Relaxed) & 0x0FFF) as u64;
                let id = (delta << 22) | ((sf_dc & 0x1F) << 17) | ((sf_worker & 0x1F) << 12) | seq;
                id.to_string()
            }
            "objectid" => {
                let ts = (Utc::now().timestamp() as u32).to_be_bytes();
                let mut rand5 = [0u8; 5];
                getrandom::fill(&mut rand5).map_err(|e| Error::Failed(e.to_string()))?;
                let cnt = OBJ_COUNTER.fetch_add(1, Ordering::Relaxed).to_be_bytes();
                let mut raw = [0u8; 12];
                raw[..4].copy_from_slice(&ts);
                raw[4..9].copy_from_slice(&rand5);
                raw[9..12].copy_from_slice(&cnt[1..4]);
                hex::encode(raw)
            }
            _ => return Err(Error::Invalid(format!("Unknown ID kind {kind}"))),
        };
        if no_hyphens && kind.starts_with("uuid") {
            s = s.replace('-', "");
        }
        if uppercase {
            s = s.to_uppercase();
        }
        out.push(s);
    }
    Ok(out)
}

fn gen_nanoid(len: usize, alphabet: &str) -> Result<String, Error> {
    let chars: Vec<char> = if alphabet.trim().is_empty() {
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-".chars().collect()
    } else {
        alphabet.chars().collect()
    };
    if chars.len() < 2 {
        return Err(Error::Invalid("NanoID alphabet needs at least 2 characters".into()));
    }
    let mut rng = rand::rng();
    Ok((0..len).map(|_| chars[rng.random_range(0..chars.len())]).collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedId {
    pub kind: String,
    pub timestamp_ms: i64,
    pub iso_utc: String,
    pub details: Value,
}

pub fn decode_id(raw: &str, kind: &str, sf_epoch_ms: i64) -> Result<DecodedId, Error> {
    let s = raw.trim();
    match kind {
        "snowflake" => {
            let id: u64 = s.parse().map_err(|_| Error::Invalid("Invalid Snowflake integer".into()))?;
            let delta = (id >> 22) as i64;
            let dc = (id >> 17) & 0x1F;
            let worker = (id >> 12) & 0x1F;
            let seq = id & 0x0FFF;
            let ts_ms = sf_epoch_ms + delta;
            let iso = chrono::DateTime::from_timestamp_millis(ts_ms)
                .map(|d| d.to_rfc3339())
                .unwrap_or_else(|| "Out of range".into());
            Ok(DecodedId {
                kind: "Snowflake".into(),
                timestamp_ms: ts_ms,
                iso_utc: iso,
                details: json!({ "datacenterId": dc, "workerId": worker, "sequence": seq, "epochMs": sf_epoch_ms }),
            })
        }
        "objectid" => {
            let bytes = hex::decode(s).map_err(|_| Error::Invalid("ObjectId must be 24 hex characters".into()))?;
            if bytes.len() != 12 {
                return Err(Error::Invalid("ObjectId must be 12 bytes (24 hex chars)".into()));
            }
            let ts = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as i64;
            let ts_ms = ts * 1000;
            let iso = chrono::DateTime::from_timestamp_millis(ts_ms)
                .map(|d| d.to_rfc3339())
                .unwrap_or_else(|| "Out of range".into());
            Ok(DecodedId {
                kind: "MongoDB ObjectId".into(),
                timestamp_ms: ts_ms,
                iso_utc: iso,
                details: json!({
                    "randomBytes": hex::encode(&bytes[4..9]),
                    "counter": u32::from_be_bytes([0, bytes[9], bytes[10], bytes[11]]),
                }),
            })
        }
        "ulid" => {
            let u = Ulid::from_string(s).map_err(|e| Error::Invalid(format!("Invalid ULID: {e}")))?;
            let ts_ms = u.timestamp_ms() as i64;
            let iso = chrono::DateTime::from_timestamp_millis(ts_ms).map(|d| d.to_rfc3339()).unwrap_or_default();
            Ok(DecodedId {
                kind: "ULID".into(),
                timestamp_ms: ts_ms,
                iso_utc: iso,
                details: json!({ "uuid": Uuid::from_u128(u.0).to_string(), "random": format!("{:x}", u.random()) }),
            })
        }
        "uuid" => {
            let u = Uuid::parse_str(s).map_err(|e| Error::Invalid(format!("Invalid UUID: {e}")))?;
            let ver = u.get_version_num();
            let ts_ms = if let Some(ts) = u.get_timestamp() {
                let (secs, nanos) = ts.to_unix();
                (secs as i64) * 1000 + (nanos as i64) / 1_000_000
            } else {
                0
            };
            let iso = if ts_ms > 0 {
                chrono::DateTime::from_timestamp_millis(ts_ms).map(|d| d.to_rfc3339()).unwrap_or_default()
            } else {
                "N/A (random/name-based UUID)".into()
            };
            Ok(DecodedId {
                kind: format!("UUID v{ver}"),
                timestamp_ms: ts_ms,
                iso_utc: iso,
                details: json!({ "version": ver, "variant": format!("{:?}", u.get_variant()) }),
            })
        }
        _ => Err(Error::Invalid(format!("Unsupported decode kind {kind}"))),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordBatch {
    pub items: Vec<String>,
    pub entropy_bits: f64,
    pub strength: String,
}

const WORDS: &[&str] = &[
    "alpha", "amber", "anchor", "atlas", "aurora", "beacon", "binary", "blossom", "breeze", "bridge",
    "cactus", "canyon", "carbon", "castle", "cedar", "cipher", "cloud", "cobalt", "comet", "compass",
    "coral", "cosmos", "crane", "crystal", "delta", "desert", "echo", "ember", "emerald", "engine",
    "falcon", "fiber", "fjord", "flame", "forest", "forge", "fossil", "frost", "galaxy", "garden",
    "glacier", "granite", "harbor", "horizon", "indigo", "island", "ivory", "jade", "jasper", "kernel",
    "kinetic", "lagoon", "lantern", "laser", "lattice", "legend", "lemon", "lunar", "magnet", "maple",
    "matrix", "meadow", "mercury", "meteor", "mirage", "monarch", "monsoon", "mosaic", "nebula", "nectar",
    "nimbus", "nova", "oasis", "obsidian", "ocean", "olive", "omega", "onyx", "oracle", "orbit",
    "orchid", "osprey", "oxide", "oxygen", "pacific", "panda", "paradox", "pebble", "phoenix", "photon",
    "pillar", "pine", "pixel", "planet", "plasma", "prism", "pulsar", "quartz", "quest", "quiver",
    "radar", "radius", "raptor", "raven", "reactor", "redwood", "ripple", "river", "rocket", "ruby",
    "saffron", "sage", "sapphire", "saturn", "scarlet", "sculpt", "shadow", "shield", "sierra", "signal",
    "silver", "solstice", "sonar", "spark", "spectrum", "sphinx", "spiral", "spruce", "starlight", "stellar",
    "stone", "storm", "strata", "summit", "sunset", "swift", "symbol", "synergy", "tango", "tempest",
    "terra", "thistle", "thunder", "tiger", "timber", "titan", "topaz", "torch", "torrent", "tracer",
    "trident", "tundra", "tunnel", "turbine", "twilight", "typhoon", "umbra", "vector", "velvet", "vertex",
    "vortex", "voyager", "walnut", "whisper", "willow", "winter", "xenon", "yonder", "zenith", "zephyr",
];

pub fn generate_passwords(
    mode: &str,
    length: usize,
    count: usize,
    upper: bool,
    lower: bool,
    digits: bool,
    symbols: bool,
    exclude_ambiguous: bool,
    separator: &str,
) -> Result<PasswordBatch, Error> {
    let n = count.clamp(1, 50);
    let mut rng = rand::rng();
    if mode == "passphrase" {
        let words_n = length.clamp(3, 12);
        let sep = if separator.is_empty() { "-" } else { separator };
        let items = (0..n)
            .map(|_| (0..words_n).map(|_| WORDS[rng.random_range(0..WORDS.len())]).collect::<Vec<_>>().join(sep))
            .collect();
        let entropy = (WORDS.len() as f64).log2() * (words_n as f64);
        return Ok(PasswordBatch {
            items,
            entropy_bits: (entropy * 10.0).round() / 10.0,
            strength: strength_label(entropy),
        });
    }

    let len = length.clamp(4, 128);
    let mut pool = String::new();
    let filter = |s: &str| -> String {
        if exclude_ambiguous {
            s.chars().filter(|c| !"0O1lI".contains(*c)).collect()
        } else {
            s.to_owned()
        }
    };
    let mut required_sets: Vec<Vec<char>> = Vec::new();
    for (enabled, chars) in [
        (upper, "ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
        (lower, "abcdefghijklmnopqrstuvwxyz"),
        (digits, "0123456789"),
        (symbols, "!@#$%^&*()-_=+[]{};:,.?/|~"),
    ] {
        if enabled {
            let f = filter(chars);
            pool.push_str(&f);
            required_sets.push(f.chars().collect());
        }
    }
    let pool_chars: Vec<char> = pool.chars().collect();
    if pool_chars.is_empty() {
        return Err(Error::Invalid("Select at least one character set".into()));
    }
    let mut items = Vec::with_capacity(n);
    for _ in 0..n {
        let mut pwd: Vec<char> = Vec::with_capacity(len);
        for set in &required_sets {
            if pwd.len() < len && !set.is_empty() {
                pwd.push(set[rng.random_range(0..set.len())]);
            }
        }
        while pwd.len() < len {
            pwd.push(pool_chars[rng.random_range(0..pool_chars.len())]);
        }
        for i in (1..pwd.len()).rev() {
            let j = rng.random_range(0..=i);
            pwd.swap(i, j);
        }
        items.push(pwd.into_iter().collect());
    }
    let entropy = (pool_chars.len() as f64).log2() * (len as f64);
    Ok(PasswordBatch {
        items,
        entropy_bits: (entropy * 10.0).round() / 10.0,
        strength: strength_label(entropy),
    })
}

fn strength_label(bits: f64) -> String {
    if bits < 40.0 {
        "Weak"
    } else if bits < 60.0 {
        "Fair"
    } else if bits < 80.0 {
        "Strong"
    } else {
        "Very Strong"
    }
    .into()
}

// --- Cron Parser (5-field Unix, 6/7-field Spring & Quartz) ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronResult {
    pub dialect: String,
    pub description_en: String,
    pub description_zh: String,
    pub next_runs: Vec<String>,
}

#[derive(Clone, Debug)]
enum FieldSpec {
    Any,
    Values(BTreeSet<u32>),
    LastDom(i32),
    NearestWeekday(u32),
    LastDow(Option<u32>),
    NthDow(u32, u32),
}

pub fn analyze_cron(expr: &str, tz_name: &str, count: usize) -> Result<CronResult, Error> {
    let tz: Tz = tz_name.parse().map_err(|_| Error::Invalid(format!("Unknown timezone {tz_name:?}")))?;
    let parts: Vec<&str> = expr.split_whitespace().collect();
    let (dialect, sec_s, min_s, hour_s, dom_s, mon_s, dow_s, year_s) = match parts.len() {
        5 => ("Unix (5 fields)", "0", parts[0], parts[1], parts[2], parts[3], parts[4], None),
        6 => ("Spring / Quartz (6 fields)", parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], None),
        7 => ("Quartz (7 fields)", parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], Some(parts[6])),
        _ => return Err(Error::Invalid("Cron expression must have 5, 6, or 7 space-separated fields".into())),
    };

    let secs = parse_num_field(sec_s, 0, 59, false)?;
    let mins = parse_num_field(min_s, 0, 59, false)?;
    let hours = parse_num_field(hour_s, 0, 23, false)?;
    let dom = parse_dom_field(dom_s)?;
    let months = parse_month_field(mon_s)?;
    let dow = parse_dow_field(dow_s)?;
    let years = year_s.map(|y| parse_num_field(y, 1970, 2099, false)).transpose()?;

    let desc_en = describe_cron_en(sec_s, min_s, hour_s, dom_s, mon_s, dow_s, year_s);
    let desc_zh = describe_cron_zh(sec_s, min_s, hour_s, dom_s, mon_s, dow_s, year_s);

    let want = count.clamp(1, 20);
    let mut next_runs = Vec::with_capacity(want);
    let now = Utc::now().with_timezone(&tz);
    let mut cur = tz
        .with_ymd_and_hms(now.year(), now.month(), now.day(), now.hour(), now.minute(), now.second())
        .earliest()
        .unwrap_or(now)
        + Duration::seconds(1);

    let has_sec_step = sec_s != "0";
    let mut guard = 0usize;
    let max_iters = 525_960; // ~1 year of minutes, or ~6 days of seconds if stepping seconds
    while next_runs.len() < want && guard < max_iters {
        guard += 1;
        if let Some(FieldSpec::Values(ys)) = &years {
            if !ys.contains(&(cur.year() as u32)) {
                cur = cur + Duration::days(1);
                continue;
            }
        }
        if !matches_set(&months, cur.month()) {
            let next_m = if cur.month() == 12 {
                tz.with_ymd_and_hms(cur.year() + 1, 1, 1, 0, 0, 0).earliest()
            } else {
                tz.with_ymd_and_hms(cur.year(), cur.month() + 1, 1, 0, 0, 0).earliest()
            };
            if let Some(nm) = next_m {
                cur = nm;
                continue;
            }
        }
        if !matches_day(&dom, &dow, cur.year(), cur.month(), cur.day(), cur.weekday().num_days_from_sunday()) {
            cur = (cur + Duration::days(1))
                .date_naive()
                .and_hms_opt(0, 0, 0)
                .and_then(|n| tz.from_local_datetime(&n).earliest())
                .unwrap_or(cur + Duration::days(1));
            continue;
        }
        if !matches_set(&hours, cur.hour()) {
            cur = cur + Duration::hours(1);
            cur = cur
                .date_naive()
                .and_hms_opt(cur.hour(), 0, 0)
                .and_then(|n| tz.from_local_datetime(&n).earliest())
                .unwrap_or(cur);
            continue;
        }
        if !matches_set(&mins, cur.minute()) {
            cur = cur + Duration::minutes(1);
            cur = cur
                .date_naive()
                .and_hms_opt(cur.hour(), cur.minute(), 0)
                .and_then(|n| tz.from_local_datetime(&n).earliest())
                .unwrap_or(cur);
            continue;
        }
        if !matches_set(&secs, cur.second()) {
            cur = cur + Duration::seconds(if has_sec_step { 1 } else { 60 - cur.second() as i64 });
            continue;
        }
        next_runs.push(cur.format("%Y-%m-%d %H:%M:%S %Z").to_string());
        cur = cur + Duration::seconds(if has_sec_step { 1 } else { 60 });
    }

    Ok(CronResult {
        dialect: dialect.into(),
        description_en: desc_en,
        description_zh: desc_zh,
        next_runs,
    })
}

fn matches_set(spec: &FieldSpec, val: u32) -> bool {
    match spec {
        FieldSpec::Any => true,
        FieldSpec::Values(s) => s.contains(&val),
        _ => false,
    }
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let (ny, nm) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    let first_next = chrono::NaiveDate::from_ymd_opt(ny, nm, 1).unwrap();
    first_next.pred_opt().unwrap().day()
}

fn matches_day(dom: &FieldSpec, dow: &FieldSpec, year: i32, month: u32, day: u32, sun0: u32) -> bool {
    let dom_ok = match dom {
        FieldSpec::Any => true,
        FieldSpec::Values(s) => s.contains(&day),
        FieldSpec::LastDom(offset) => {
            let last = days_in_month(year, month) as i32;
            day as i32 == (last - offset).max(1)
        }
        FieldSpec::NearestWeekday(target) => {
            let last = days_in_month(year, month);
            let t = (*target).min(last);
            let wd = chrono::NaiveDate::from_ymd_opt(year, month, t).unwrap().weekday().num_days_from_sunday();
            let actual = match wd {
                6 => if t > 1 { t - 1 } else { t + 2 },
                0 => if t < last { t + 1 } else { t - 2 },
                _ => t,
            };
            day == actual
        }
        _ => false,
    };
    let dow_ok = match dow {
        FieldSpec::Any => true,
        FieldSpec::Values(s) => s.contains(&sun0) || (sun0 == 0 && s.contains(&7)),
        FieldSpec::LastDow(None) => sun0 == 6,
        FieldSpec::LastDow(Some(target)) => {
            let t = target % 7;
            let last = days_in_month(year, month);
            sun0 == t && day + 7 > last
        }
        FieldSpec::NthDow(target, nth) => {
            let t = target % 7;
            sun0 == t && ((day - 1) / 7 + 1) == *nth
        }
        _ => false,
    };
    if matches!(dom, FieldSpec::Any) {
        dow_ok
    } else if matches!(dow, FieldSpec::Any) {
        dom_ok
    } else {
        dom_ok && dow_ok
    }
}

fn parse_num_field(raw: &str, min: u32, max: u32, allow_q: bool) -> Result<FieldSpec, Error> {
    if raw == "*" || (allow_q && raw == "?") {
        return Ok(FieldSpec::Any);
    }
    let mut out = BTreeSet::new();
    for part in raw.split(',') {
        let (range_part, step) = match part.split_once('/') {
            Some((r, st)) => (r, st.parse::<u32>().ok().filter(|&v| v > 0).ok_or_else(|| Error::Invalid(format!("Invalid step {part:?}")))?),
            None => (part, 1),
        };
        let (start, end) = if range_part == "*" {
            (min, max)
        } else if let Some((a, b)) = range_part.split_once('-') {
            let sa = a.parse::<u32>().map_err(|_| Error::Invalid(format!("Invalid value {a:?}")))?;
            let sb = b.parse::<u32>().map_err(|_| Error::Invalid(format!("Invalid value {b:?}")))?;
            (sa, sb)
        } else {
            let v = range_part.parse::<u32>().map_err(|_| Error::Invalid(format!("Invalid value {range_part:?}")))?;
            (v, if part.contains('/') { max } else { v })
        };
        if start < min || end > max || start > end {
            return Err(Error::Invalid(format!("Cron value {part:?} out of bounds {min}..={max}")));
        }
        let mut cur = start;
        while cur <= end {
            out.insert(cur);
            cur += step;
        }
    }
    Ok(FieldSpec::Values(out))
}

fn parse_month_field(raw: &str) -> Result<FieldSpec, Error> {
    let mapped = replace_names(raw, &[
        ("JAN", "1"), ("FEB", "2"), ("MAR", "3"), ("APR", "4"), ("MAY", "5"), ("JUN", "6"),
        ("JUL", "7"), ("AUG", "8"), ("SEP", "9"), ("OCT", "10"), ("NOV", "11"), ("DEC", "12"),
    ]);
    parse_num_field(&mapped, 1, 12, false)
}

fn parse_dom_field(raw: &str) -> Result<FieldSpec, Error> {
    let up = raw.to_ascii_uppercase();
    if up == "L" {
        return Ok(FieldSpec::LastDom(0));
    }
    if let Some(off) = up.strip_prefix("L-") {
        let n = off.parse::<i32>().map_err(|_| Error::Invalid("Invalid L-N day of month".into()))?;
        return Ok(FieldSpec::LastDom(n));
    }
    if let Some(day_s) = up.strip_suffix('W') {
        let d = day_s.parse::<u32>().map_err(|_| Error::Invalid("Invalid NW weekday".into()))?;
        if (1..=31).contains(&d) {
            return Ok(FieldSpec::NearestWeekday(d));
        }
    }
    parse_num_field(&up, 1, 31, true)
}

fn parse_dow_field(raw: &str) -> Result<FieldSpec, Error> {
    let up = replace_names(&raw.to_ascii_uppercase(), &[
        ("SUN", "0"), ("MON", "1"), ("TUE", "2"), ("WED", "3"), ("THU", "4"), ("FRI", "5"), ("SAT", "6"),
    ]);
    if up == "L" {
        return Ok(FieldSpec::LastDow(None));
    }
    if let Some(d_s) = up.strip_suffix('L') {
        let d = d_s.parse::<u32>().map_err(|_| Error::Invalid("Invalid NL last weekday".into()))?;
        return Ok(FieldSpec::LastDow(Some(d)));
    }
    if let Some((d_s, n_s)) = up.split_once('#') {
        let d = d_s.parse::<u32>().map_err(|_| Error::Invalid("Invalid day in #".into()))?;
        let n = n_s.parse::<u32>().map_err(|_| Error::Invalid("Invalid nth in #".into()))?;
        if (1..=5).contains(&n) {
            return Ok(FieldSpec::NthDow(d, n));
        }
        return Err(Error::Invalid("Nth weekday must be 1..=5".into()));
    }
    parse_num_field(&up, 0, 7, true)
}

fn replace_names(s: &str, map: &[(&str, &str)]) -> String {
    let mut out = s.to_ascii_uppercase();
    for (k, v) in map {
        out = out.replace(k, v);
    }
    out
}

fn describe_cron_en(sec: &str, min: &str, hour: &str, dom: &str, mon: &str, dow: &str, year: Option<&str>) -> String {
    let mut parts = Vec::new();
    if sec != "0" {
        parts.push(if let Some(s) = sec.strip_prefix("*/") { format!("every {s} seconds") } else { format!("at second {sec}") });
    }
    parts.push(if min == "*" { "every minute".into() } else if let Some(s) = min.strip_prefix("*/") { format!("every {s} minutes") } else { format!("at minute {min}") });
    if hour != "*" {
        parts.push(if let Some(s) = hour.strip_prefix("*/") { format!("every {s} hours") } else { format!("past hour {hour}") });
    }
    if dom != "*" && dom != "?" {
        parts.push(format!("on day {dom} of month"));
    }
    if mon != "*" {
        parts.push(format!("in month {mon}"));
    }
    if dow != "*" && dow != "?" {
        parts.push(format!("on weekday {dow}"));
    }
    if let Some(y) = year {
        if y != "*" {
            parts.push(format!("in year {y}"));
        }
    }
    parts.join(", ")
}

fn describe_cron_zh(sec: &str, min: &str, hour: &str, dom: &str, mon: &str, dow: &str, year: Option<&str>) -> String {
    let mut parts = Vec::new();
    if let Some(y) = year {
        if y != "*" {
            parts.push(format!("{y}年"));
        }
    }
    if mon != "*" {
        parts.push(format!("{mon}月"));
    }
    if dom != "*" && dom != "?" {
        parts.push(if dom == "L" { "每月最后一天".into() } else { format!("每月第 {dom} 日") });
    }
    if dow != "*" && dow != "?" {
        parts.push(format!("周({dow})"));
    }
    if hour == "*" {
        parts.push("每小时".into());
    } else if let Some(s) = hour.strip_prefix("*/") {
        parts.push(format!("每 {s} 小时"));
    } else {
        parts.push(format!("{hour} 点"));
    }
    if min == "*" {
        parts.push("每分钟".into());
    } else if let Some(s) = min.strip_prefix("*/") {
        parts.push(format!("每 {s} 分钟"));
    } else {
        parts.push(format!("{min} 分"));
    }
    if sec != "0" {
        if sec == "*" {
            parts.push("每秒".into());
        } else if let Some(s) = sec.strip_prefix("*/") {
            parts.push(format!("每 {s} 秒"));
        } else {
            parts.push(format!("{sec} 秒"));
        }
    }
    parts.push("执行".into());
    parts.join(" ")
}

// --- Linear-time Regex Evaluator (UTF-16 offsets) ---

pub fn eval_regex(pattern: &str, flags: &str, text: &str, replace: Option<&str>) -> Value {
    const MAX_TEXT: usize = 1 << 20;
    const MAX_MATCHES: usize = 1000;
    const MAX_REPLACED: usize = 256 << 10;

    if text.len() > MAX_TEXT {
        return json!({ "error": "Input text exceeds 1 MiB limit", "matches": [], "count": 0, "groups": [] });
    }
    if pattern.is_empty() {
        return json!({ "error": Value::Null, "matches": [], "count": 0, "groups": [], "replaced": Value::Null });
    }
    let has = |c: char| flags.contains(c);
    let re = match RegexBuilder::new(pattern)
        .case_insensitive(has('i'))
        .multi_line(has('m'))
        .dot_matches_new_line(has('s'))
        .ignore_whitespace(has('x'))
        .size_limit(8 << 20)
        .build()
    {
        Ok(r) => r,
        Err(e) => return json!({ "error": e.to_string(), "matches": [], "count": 0, "groups": [] }),
    };

    let mut at = vec![0u32; text.len() + 1];
    let mut u16_pos = 0u32;
    for (idx, ch) in text.char_indices() {
        at[idx] = u16_pos;
        u16_pos += ch.len_utf16() as u32;
    }
    at[text.len()] = u16_pos;

    let names: Vec<Value> = re.capture_names().skip(1).map(|n| n.map_or(Value::Null, |s| json!(s))).collect();
    let mut matches = Vec::new();
    let mut count = 0usize;
    for caps in re.captures_iter(text) {
        count += 1;
        if matches.len() < MAX_MATCHES {
            let groups: Vec<Value> = (1..caps.len())
                .map(|i| caps.get(i).map_or(Value::Null, |g| json!([at[g.start()], at[g.end()]])))
                .collect();
            let m = caps.get(0).unwrap();
            matches.push(json!({ "s": at[m.start()], "e": at[m.end()], "text": m.as_str(), "groups": groups }));
        }
    }

    let replaced = replace.map(|r| {
        let mut out = String::new();
        let mut last = 0;
        for caps in re.captures_iter(text) {
            let m = caps.get(0).unwrap();
            out.push_str(&text[last..m.start()]);
            caps.expand(r, &mut out);
            last = m.end();
            if out.len() > MAX_REPLACED {
                break;
            }
        }
        if out.len() <= MAX_REPLACED {
            out.push_str(&text[last..]);
        }
        if out.len() > MAX_REPLACED {
            let mut cut = MAX_REPLACED;
            while !out.is_char_boundary(cut) {
                cut -= 1;
            }
            out.truncate(cut);
            out.push('…');
        }
        out
    });

    json!({
        "error": Value::Null,
        "matches": matches,
        "count": count,
        "groups": names,
        "replaced": replaced,
    })
}

pub fn apply_regex_replace(pattern: &str, flags: &str, replacement: &str, text: &str) -> Result<String, Error> {
    let has = |c: char| flags.contains(c);
    let re = RegexBuilder::new(pattern)
        .case_insensitive(has('i'))
        .multi_line(has('m'))
        .dot_matches_new_line(has('s'))
        .ignore_whitespace(has('x'))
        .size_limit(8 << 20)
        .build()
        .map_err(|e| Error::Invalid(format!("Invalid regex: {e}")))?;
    Ok(re.replace_all(text, replacement).into_owned())
}

// --- Built-in 10-font FIGlet / ASCII Art Renderer ---

pub fn render_ascii_art(text: &str, font: &str) -> String {
    render_ascii_art_with_wrap(text, font, "")
}

pub fn render_ascii_art_with_wrap(text: &str, font: &str, comment_wrap: &str) -> String {
    let lines_in: Vec<&str> = text.lines().take(6).collect();
    if lines_in.is_empty() {
        return String::new();
    }
    let mut blocks = Vec::new();
    for line in lines_in {
        blocks.push(render_line_figlet(line, font));
    }
    let raw = blocks.join("\n");
    wrap_ascii_comment(&raw, comment_wrap)
}

fn wrap_ascii_comment(raw: &str, wrap: &str) -> String {
    match wrap {
        "//" | "#" | "--" => raw
            .lines()
            .map(|l| format!("{wrap} {l}"))
            .collect::<Vec<_>>()
            .join("\n"),
        "/*" => {
            let body: Vec<String> = raw.lines().map(|l| format!(" * {l}")).collect();
            format!("/*\n{}\n */", body.join("\n"))
        }
        "<!--" => format!("<!--\n{raw}\n-->"),
        _ => raw.to_owned(),
    }
}

fn render_line_figlet(line: &str, font: &str) -> String {
    let glyphs: Vec<Vec<String>> = line.chars().take(64).map(|c| glyph_for(c, font)).collect();
    if glyphs.is_empty() {
        return String::new();
    }
    let rows = glyphs[0].len();
    let mut out = Vec::with_capacity(rows);
    for r in 0..rows {
        let row: String = glyphs.iter().map(|g| g[r].as_str()).collect();
        out.push(row.trim_end().to_owned());
    }
    out.join("\n")
}

/// Renders each character from a crisp 5x5 bitmap into 10 distinct FIGlet-inspired styles.
fn glyph_for(c: char, font: &str) -> Vec<String> {
    let bmp = bitmap_5x5(c.to_ascii_uppercase());
    match font {
        "Big" => {
            let mut rows = vec![String::new(); 7];
            for (r, bits) in bmp.iter().enumerate() {
                for bit in (0..5).rev() {
                    let on = (bits >> bit) & 1 == 1;
                    let ch = if on { "##" } else { "  " };
                    rows[r].push_str(ch);
                    if r == 4 && on {
                        rows[5].push_str("==");
                    } else if r == 4 {
                        rows[5].push_str("  ");
                    }
                }
                rows[r].push(' ');
            }
            rows[5].push(' ');
            rows[6] = " ".repeat(rows[0].len());
            rows
        }
        "Slant" => bmp
            .iter()
            .enumerate()
            .map(|(r, bits)| {
                let pad = " ".repeat(4 - r);
                let mut s = pad;
                for bit in (0..5).rev() {
                    s.push_str(if (bits >> bit) & 1 == 1 { "//" } else { "  " });
                }
                s.push_str(&" ".repeat(r + 1));
                s
            })
            .collect(),
        "Shadow" => {
            let mut grid = vec![vec![' '; 8]; 6];
            for (r, bits) in bmp.iter().enumerate() {
                for (col, bit) in (0..5).rev().enumerate() {
                    if (bits >> bit) & 1 == 1 {
                        grid[r][col] = '█';
                        if grid[r + 1][col + 1] == ' ' {
                            grid[r + 1][col + 1] = '░';
                        }
                    }
                }
            }
            grid.into_iter().map(|row| row.into_iter().collect()).collect()
        }
        "Doom" => {
            let mut rows: Vec<String> = bmp
                .iter()
                .map(|bits| {
                    let mut s = String::new();
                    for bit in (0..5).rev() {
                        s.push_str(if (bits >> bit) & 1 == 1 { "[]" } else { "  " });
                    }
                    s.push(' ');
                    s
                })
                .collect();
            rows.push(" ".repeat(11));
            rows
        }
        "Banner" => {
            let mut rows = Vec::with_capacity(7);
            for bits in bmp {
                let mut s = String::new();
                for bit in (0..5).rev() {
                    s.push_str(if (bits >> bit) & 1 == 1 { "#" } else { " " });
                }
                s.push(' ');
                rows.push(s);
            }
            rows.push(" ".repeat(6));
            rows.push(" ".repeat(6));
            rows
        }
        "Small" => {
            let mut rows = Vec::with_capacity(3);
            let pairs = [(0, 1), (2, 3), (4, 4)];
            for (r_hi, r_lo) in pairs {
                let mut s = String::new();
                for bit in (0..5).rev() {
                    let top = (bmp[r_hi] >> bit) & 1 == 1;
                    let bot = r_hi != r_lo && ((bmp[r_lo] >> bit) & 1 == 1);
                    s.push(match (top, bot) {
                        (true, true) => '█',
                        (true, false) => '▀',
                        (false, true) => '▄',
                        (false, false) => ' ',
                    });
                }
                s.push(' ');
                rows.push(s);
            }
            rows
        }
        "Mini" => {
            let mut rows = Vec::with_capacity(3);
            for idx in [0usize, 2, 4] {
                let bits = bmp[idx];
                let mut s = String::new();
                for bit in [4usize, 2, 0] {
                    s.push(if (bits >> bit) & 1 == 1 { '+' } else { ' ' });
                }
                s.push(' ');
                rows.push(s);
            }
            rows
        }
        "Block" => {
            let mut rows: Vec<String> = bmp
                .iter()
                .map(|bits| {
                    let mut s = String::new();
                    for bit in (0..5).rev() {
                        s.push_str(if (bits >> bit) & 1 == 1 { "██" } else { "  " });
                    }
                    s.push(' ');
                    s
                })
                .collect();
            rows.push(" ".repeat(11));
            rows
        }
        "Bubble" => {
            let ch_up = if c == ' ' { ' ' } else { c };
            let w = 3;
            vec![
                format!(" .{}. ", "-".repeat(w)),
                format!("( {ch_up} ) "),
                format!(" '{}-' ", "-".repeat(w - 1)),
            ]
        }
        // Standard
        _ => bmp
            .iter()
            .map(|bits| {
                let mut s = String::new();
                for bit in (0..5).rev() {
                    s.push(if (bits >> bit) & 1 == 1 { '#' } else { ' ' });
                }
                s.push(' ');
                s
            })
            .collect(),
    }
}

fn bitmap_5x5(c: char) -> [u8; 5] {
    match c {
        'A' => [0b01110, 0b10001, 0b11111, 0b10001, 0b10001],
        'B' => [0b11110, 0b10001, 0b11110, 0b10001, 0b11110],
        'C' => [0b01111, 0b10000, 0b10000, 0b10000, 0b01111],
        'D' => [0b11110, 0b10001, 0b10001, 0b10001, 0b11110],
        'E' => [0b11111, 0b10000, 0b11110, 0b10000, 0b11111],
        'F' => [0b11111, 0b10000, 0b11110, 0b10000, 0b10000],
        'G' => [0b01111, 0b10000, 0b10111, 0b10001, 0b01110],
        'H' => [0b10001, 0b10001, 0b11111, 0b10001, 0b10001],
        'I' => [0b11111, 0b00100, 0b00100, 0b00100, 0b11111],
        'J' => [0b00111, 0b00010, 0b00010, 0b10010, 0b01100],
        'K' => [0b10001, 0b10010, 0b11100, 0b10010, 0b10001],
        'L' => [0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
        'M' => [0b10001, 0b11011, 0b10101, 0b10001, 0b10001],
        'N' => [0b10001, 0b11001, 0b10101, 0b10011, 0b10001],
        'O' => [0b01110, 0b10001, 0b10001, 0b10001, 0b01110],
        'P' => [0b11110, 0b10001, 0b11110, 0b10000, 0b10000],
        'Q' => [0b01110, 0b10001, 0b10101, 0b10010, 0b01101],
        'R' => [0b11110, 0b10001, 0b11110, 0b10010, 0b10001],
        'S' => [0b01111, 0b10000, 0b01110, 0b00001, 0b11110],
        'T' => [0b11111, 0b00100, 0b00100, 0b00100, 0b00100],
        'U' => [0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
        'V' => [0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
        'W' => [0b10001, 0b10001, 0b10101, 0b11011, 0b10001],
        'X' => [0b10001, 0b01010, 0b00100, 0b01010, 0b10001],
        'Y' => [0b10001, 0b01010, 0b00100, 0b00100, 0b00100],
        'Z' => [0b11111, 0b00010, 0b00100, 0b01000, 0b11111],
        '0' => [0b01110, 0b10011, 0b10101, 0b11001, 0b01110],
        '1' => [0b00100, 0b01100, 0b00100, 0b00100, 0b01110],
        '2' => [0b11110, 0b00001, 0b01110, 0b10000, 0b11111],
        '3' => [0b11110, 0b00001, 0b01110, 0b00001, 0b11110],
        '4' => [0b10010, 0b10010, 0b11111, 0b00010, 0b00010],
        '5' => [0b11111, 0b10000, 0b11110, 0b00001, 0b11110],
        '6' => [0b01111, 0b10000, 0b11110, 0b10001, 0b01110],
        '7' => [0b11111, 0b00001, 0b00010, 0b00100, 0b00100],
        '8' => [0b01110, 0b10001, 0b01110, 0b10001, 0b01110],
        '9' => [0b01110, 0b10001, 0b01111, 0b00001, 0b11110],
        '-' => [0b00000, 0b00000, 0b11111, 0b00000, 0b00000],
        '_' => [0b00000, 0b00000, 0b00000, 0b00000, 0b11111],
        '.' => [0b00000, 0b00000, 0b00000, 0b00000, 0b00100],
        '!' => [0b00100, 0b00100, 0b00100, 0b00000, 0b00100],
        '?' => [0b01110, 0b10001, 0b00110, 0b00000, 0b00100],
        ':' => [0b00000, 0b00100, 0b00000, 0b00100, 0b00000],
        '/' => [0b00001, 0b00010, 0b00100, 0b01000, 0b10000],
        ' ' => [0b00000, 0b00000, 0b00000, 0b00000, 0b00000],
        _ => [0b11111, 0b10001, 0b10101, 0b10001, 0b11111],
    }
}
