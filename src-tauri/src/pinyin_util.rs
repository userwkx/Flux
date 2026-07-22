use pinyin::ToPinyin;

pub fn build_pinyin_fields(name: &str) -> (String, String, String) {
    let mut full_parts = Vec::new();
    let mut first_parts = Vec::new();
    let mut words = Vec::new();

    for ch in name.chars() {
        if let Some(py) = ch.to_pinyin() {
            let s = py.plain().to_string();
            full_parts.push(s.clone());
            words.push(s.clone());
            if let Some(c) = s.chars().next() {
                first_parts.push(c.to_string());
            }
        } else if ch.is_ascii_alphanumeric() {
            let s = ch.to_ascii_lowercase().to_string();
            full_parts.push(s.clone());
            first_parts.push(s.clone());
            words.push(s);
        }
    }

    let norm = |parts: &[String]| {
        parts
            .join("")
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
            .to_ascii_lowercase()
    };

    (
        norm(&full_parts),
        norm(&first_parts),
        words.join(" ").to_ascii_lowercase(),
    )
}
