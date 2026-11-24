use openidea_plugin::Error;
use rand::RngExt;
use serde_json::{Map, Value, json};

const CJK_PUNCT_PAIRS: &[(char, char)] = &[
    ('，', ','),
    ('。', '.'),
    ('！', '!'),
    ('？', '?'),
    ('；', ';'),
    ('：', ':'),
    ('（', '('),
    ('）', ')'),
    ('【', '['),
    ('】', ']'),
    ('《', '<'),
    ('》', '>'),
    ('“', '"'),
    ('”', '"'),
    ('‘', '\''),
    ('’', '\''),
];

pub fn to_halfwidth(input: &str, include_cjk_punct: bool) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        if ch == '\u{3000}' {
            out.push(' ');
        } else if ('\u{FF01}'..='\u{FF5E}').contains(&ch) {
            if let Some(ascii) = char::from_u32(ch as u32 - 0xFEE0) {
                out.push(ascii);
            } else {
                out.push(ch);
            }
        } else if include_cjk_punct {
            if let Some(&(_, half)) = CJK_PUNCT_PAIRS.iter().find(|&&(full, _)| full == ch) {
                out.push(half);
            } else {
                out.push(ch);
            }
        } else {
            out.push(ch);
        }
    }
    out
}

pub fn to_fullwidth(input: &str, include_cjk_punct: bool) -> String {
    let mut out = String::with_capacity(input.len() * 2);
    for ch in input.chars() {
        if ch == ' ' {
            out.push('\u{3000}');
        } else if include_cjk_punct && matches!(ch, ',' | '.' | '!' | '?' | ';' | ':' | '(' | ')' | '[' | ']') {
            let full = match ch {
                ',' => '，',
                '.' => '。',
                '!' => '！',
                '?' => '？',
                ';' => '；',
                ':' => '：',
                '(' => '（',
                ')' => '）',
                '[' => '【',
                ']' => '】',
                _ => ch,
            };
            out.push(full);
        } else if ('!'..='~').contains(&ch) {
            if let Some(full) = char::from_u32(ch as u32 + 0xFEE0) {
                out.push(full);
            } else {
                out.push(ch);
            }
        } else {
            out.push(ch);
        }
    }
    out
}

pub fn number_to_rmb(input: &str) -> Result<Value, Error> {
    let clean = input.trim().replace([',', '_', ' '], "");
    if clean.is_empty() {
        return Err(Error::Invalid("Enter a numeric amount".into()));
    }
    let (negative, rest) = if let Some(r) = clean.strip_prefix('-') {
        (true, r)
    } else if let Some(r) = clean.strip_prefix('+') {
        (false, r)
    } else {
        (false, clean.as_str())
    };
    let (int_raw, frac_raw) = rest.split_once('.').unwrap_or((rest, ""));
    if int_raw.is_empty() || !int_raw.bytes().all(|b| b.is_ascii_digit()) || !frac_raw.bytes().all(|b| b.is_ascii_digit()) {
        return Err(Error::Invalid("Invalid numeric amount".into()));
    }
    let int_trimmed = int_raw.trim_start_matches('0');
    let int_digits = if int_trimmed.is_empty() { "0" } else { int_trimmed };
    if int_digits.len() > 16 {
        return Err(Error::Invalid("Integer part supports up to 16 digits".into()));
    }

    let jiao = frac_raw.chars().next().and_then(|c| c.to_digit(10)).unwrap_or(0) as usize;
    let fen = frac_raw.chars().nth(1).and_then(|c| c.to_digit(10)).unwrap_or(0) as usize;

    const CN_NUMS: [&str; 10] = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
    const CN_INT_RADICE: [&str; 4] = ["", "拾", "佰", "仟"];
    const CN_INT_UNITS: [&str; 4] = ["", "万", "亿", "兆"];

    let mut rmb = String::new();
    if negative && (int_digits != "0" || jiao > 0 || fen > 0) {
        rmb.push('负');
    }

    if int_digits == "0" && jiao == 0 && fen == 0 {
        return Ok(json!({
            "rmb": "零元整",
            "normalized": "0.00",
        }));
    }

    if int_digits != "0" {
        let chars: Vec<usize> = int_digits.bytes().map(|b| (b - b'0') as usize).collect();
        let len = chars.len();
        let mut zero_count = 0usize;
        for (i, &n) in chars.iter().enumerate() {
            let p = len - i - 1;
            let q = p / 4;
            let m = p % 4;
            if n == 0 {
                zero_count += 1;
            } else {
                if zero_count > 0 {
                    rmb.push_str(CN_NUMS[0]);
                }
                zero_count = 0;
                rmb.push_str(CN_NUMS[n]);
                rmb.push_str(CN_INT_RADICE[m]);
            }
            if m == 0 && zero_count < 4 {
                rmb.push_str(CN_INT_UNITS[q]);
            }
        }
        rmb.push('元');
    }

    if jiao == 0 && fen == 0 {
        rmb.push('整');
    } else {
        if jiao > 0 {
            rmb.push_str(CN_NUMS[jiao]);
            rmb.push('角');
        } else if int_digits != "0" {
            rmb.push('零');
        }
        if fen > 0 {
            rmb.push_str(CN_NUMS[fen]);
            rmb.push('分');
        }
    }

    Ok(json!({
        "rmb": rmb,
        "normalized": format!("{}{}.{jiao}{fen}", if negative { "-" } else { "" }, int_digits),
    }))
}

pub fn to_roman(num: u32) -> Result<String, Error> {
    if num == 0 || num > 3999 {
        return Err(Error::Invalid("Roman numerals require an integer in 1..=3999".into()));
    }
    const TABLE: &[(u32, &str)] = &[
        (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"),
        (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
        (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"),
    ];
    let mut n = num;
    let mut out = String::new();
    for &(val, sym) in TABLE {
        while n >= val {
            out.push_str(sym);
            n -= val;
        }
    }
    Ok(out)
}

pub fn from_roman(s: &str) -> Result<u32, Error> {
    let clean = s.trim().to_ascii_uppercase();
    if clean.is_empty() {
        return Err(Error::Invalid("Roman numeral input is empty".into()));
    }
    let vals: Vec<u32> = clean
        .bytes()
        .map(|b| match b {
            b'I' => Ok(1),
            b'V' => Ok(5),
            b'X' => Ok(10),
            b'L' => Ok(50),
            b'C' => Ok(100),
            b'D' => Ok(500),
            b'M' => Ok(1000),
            _ => Err(Error::Invalid(format!("Invalid Roman numeral symbol {:?}", b as char))),
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut sum = 0u32;
    for i in 0..vals.len() {
        if i + 1 < vals.len() && vals[i] < vals[i + 1] {
            sum = sum.saturating_sub(vals[i]);
        } else {
            sum = sum.saturating_add(vals[i]);
        }
    }
    // Canonical check
    if to_roman(sum).ok().as_deref() != Some(clean.as_str()) {
        return Err(Error::Invalid(format!("Non-canonical Roman numeral {clean:?}")));
    }
    Ok(sum)
}

const MORSE_TABLE: &[(char, &str)] = &[
    ('A', ".-"), ('B', "-..."), ('C', "-.-."), ('D', "-.."), ('E', "."),
    ('F', "..-."), ('G', "--."), ('H', "...."), ('I', ".."), ('J', ".---"),
    ('K', "-.-"), ('L', ".-.."), ('M', "--"), ('N', "-."), ('O', "---"),
    ('P', ".--."), ('Q', "--.-"), ('R', ".-."), ('S', "..."), ('T', "-"),
    ('U', "..-"), ('V', "...-"), ('W', ".--"), ('X', "-..-"), ('Y', "-.--"),
    ('Z', "--.."),
    ('0', "-----"), ('1', ".----"), ('2', "..---"), ('3', "...--"), ('4', "....-"),
    ('5', "....."), ('6', "-...."), ('7', "--..."), ('8', "---.."), ('9', "----."),
    ('.', ".-.-.-"), (',', "--..--"), ('?', "..--.."), ('!', "-.-.--"), ('/', "-..-."),
    ('-', "-....-"), ('@', ".--.-."), (':', "---..."), ('=', "-...-"),
];

pub fn morse_encode(s: &str) -> String {
    let mut parts = Vec::new();
    for ch in s.trim().chars() {
        if ch.is_whitespace() {
            if parts.last().map(String::as_str) != Some("/") {
                parts.push("/".into());
            }
            continue;
        }
        let upper = ch.to_ascii_uppercase();
        if let Some(&(_, code)) = MORSE_TABLE.iter().find(|&&(c, _)| c == upper) {
            parts.push(code.to_owned());
        }
    }
    parts.join(" ")
}

pub fn morse_decode(s: &str) -> String {
    let mut out = String::new();
    for tok in s.split_whitespace() {
        if tok == "/" {
            out.push(' ');
        } else if let Some(&(ch, _)) = MORSE_TABLE.iter().find(|&&(_, code)| code == tok) {
            out.push(ch);
        } else {
            out.push('?');
        }
    }
    out
}

pub fn generate_mock_data(
    fields: &[Value],
    count: usize,
    format: &str,
    table_name: &str,
    locale_zh: bool,
) -> Result<String, Error> {
    if fields.is_empty() {
        return Err(Error::Invalid("Define at least one mock field".into()));
    }
    let count = count.clamp(1, 500);
    let mut rng = rand::rng();

    const EN_FIRST: &[&str] = &["Alice", "Bob", "Carol", "David", "Eve", "Frank", "Grace", "Hank", "Ivy", "Jack"];
    const EN_LAST: &[&str] = &["Smith", "Johnson", "Chen", "Zhang", "Taylor", "Brown", "Miller", "Wilson", "Davis", "Lee"];
    const ZH_NAMES: &[&str] = &["张伟", "王芳", "李娜", "刘洋", "陈静", "杨明", "赵敏", "黄磊", "周杰", "吴敏"];
    const CITIES_EN: &[&str] = &["Shanghai", "Beijing", "Shenzhen", "Hangzhou", "Singapore", "Tokyo", "San Francisco", "London"];
    const CITIES_ZH: &[&str] = &["上海", "北京", "深圳", "杭州", "成都", "南京", "广州", "苏州"];
    const COMPANIES: &[&str] = &["OpenIDEA Labs", "CloudForge", "BytePulse", "NovaTech", "ApexSystems", "CoreData"];
    const WORDS: &[&str] = &["alpha", "bravo", "cloud", "delta", "edge", "fiber", "graph", "hyper", "index", "kernel"];

    let mut headers = Vec::with_capacity(fields.len());
    let mut specs = Vec::with_capacity(fields.len());
    for (idx, f) in fields.iter().enumerate() {
        let name = f.get("name").and_then(Value::as_str).unwrap_or("").trim();
        let field_name = if name.is_empty() { format!("field_{}", idx + 1) } else { name.to_owned() };
        let ftype = f.get("type").and_then(Value::as_str).unwrap_or("string");
        let opts = f.get("options").and_then(Value::as_str).unwrap_or("");
        headers.push(field_name.clone());
        specs.push((field_name, ftype.to_owned(), opts.to_owned()));
    }

    let mut records: Vec<Map<String, Value>> = Vec::with_capacity(count);
    for row_idx in 0..count {
        let mut obj = Map::new();
        for (name, ftype, opts) in &specs {
            let val = match ftype.as_str() {
                "sequence" => json!(row_idx as i64 + 1),
                "uuid" => json!(uuid::Uuid::new_v4().to_string()),
                "int" => {
                    let (min_v, max_v) = parse_range(opts, 1, 10000);
                    json!(rng.random_range(min_v..=max_v))
                }
                "float" => {
                    let v: i64 = rng.random_range(100..=99999);
                    json!((v as f64) / 100.0)
                }
                "bool" => json!(rng.random_bool(0.5)),
                "name" => {
                    if locale_zh {
                        json!(ZH_NAMES[rng.random_range(0..ZH_NAMES.len())])
                    } else {
                        json!(format!(
                            "{} {}",
                            EN_FIRST[rng.random_range(0..EN_FIRST.len())],
                            EN_LAST[rng.random_range(0..EN_LAST.len())]
                        ))
                    }
                }
                "email" => {
                    let u = EN_FIRST[rng.random_range(0..EN_FIRST.len())].to_ascii_lowercase();
                    let n: u32 = rng.random_range(10..999);
                    json!(format!("{u}{n}@example.com"))
                }
                "phone" => {
                    let mid: u32 = rng.random_range(1000..=9999);
                    let tail: u32 = rng.random_range(1000..=9999);
                    json!(format!("138{mid}{tail}"))
                }
                "ipv4" => json!(format!(
                    "{}.{}.{}.{}",
                    rng.random_range(10..220),
                    rng.random_range(0..255),
                    rng.random_range(0..255),
                    rng.random_range(1..254)
                )),
                "url" => json!(format!("https://api.example.com/v1/{}", WORDS[rng.random_range(0..WORDS.len())])),
                "date" => {
                    let y = rng.random_range(2023..=2026);
                    let m = rng.random_range(1..=12);
                    let d = rng.random_range(1..=28);
                    json!(format!("{y:04}-{m:02}-{d:02}"))
                }
                "datetime" => {
                    let y = rng.random_range(2024..=2026);
                    let m = rng.random_range(1..=12);
                    let d = rng.random_range(1..=28);
                    let hh = rng.random_range(0..24);
                    let mm = rng.random_range(0..60);
                    let ss = rng.random_range(0..60);
                    json!(format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z"))
                }
                "city" => {
                    let pool = if locale_zh { CITIES_ZH } else { CITIES_EN };
                    json!(pool[rng.random_range(0..pool.len())])
                }
                "company" => json!(COMPANIES[rng.random_range(0..COMPANIES.len())]),
                "enum" => {
                    let items: Vec<&str> = opts.split(',').map(str::trim).filter(|s| !s.is_empty()).collect();
                    if items.is_empty() {
                        json!("active")
                    } else {
                        json!(items[rng.random_range(0..items.len())])
                    }
                }
                _ => json!(format!(
                    "{}-{}-{}",
                    WORDS[rng.random_range(0..WORDS.len())],
                    WORDS[rng.random_range(0..WORDS.len())],
                    rng.random_range(10..99)
                )),
            };
            obj.insert(name.clone(), val);
        }
        records.push(obj);
    }

    let arr = Value::Array(records.into_iter().map(Value::Object).collect());
    let json_text = serde_json::to_string_pretty(&arr).map_err(|e| Error::Invalid(e.to_string()))?;
    match format {
        "json" => Ok(json_text),
        "csv" => crate::csv_tools::convert_table(&json_text, "json", "csv", ",", true, table_name, false),
        "sql" => crate::csv_tools::convert_table(&json_text, "json", "sql-insert", ",", true, table_name, false),
        "markdown" => crate::csv_tools::convert_table(&json_text, "json", "markdown", ",", true, table_name, false),
        other => Err(Error::Invalid(format!("Unsupported mock output format {other}"))),
    }
}

fn parse_range(opts: &str, def_min: i64, def_max: i64) -> (i64, i64) {
    if let Some((a, b)) = opts.split_once("..").or_else(|| opts.split_once('-')) {
        if let (Ok(lo), Ok(hi)) = (a.trim().parse::<i64>(), b.trim().parse::<i64>()) {
            if lo <= hi {
                return (lo, hi);
            }
        }
    }
    (def_min, def_max)
}
