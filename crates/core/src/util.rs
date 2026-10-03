//! Input normalisation helpers (Pakistani phone numbers, CNIC, names, text).

use uuid::Uuid;

/// New time-ordered globally unique id (UUIDv7).
pub fn new_id() -> String {
    Uuid::now_v7().to_string()
}

/// Normalises a phone number to digits in international format without `+`.
///
/// Accepts `0300-1234567`, `03001234567`, `3001234567`, `+92 300 1234567`, `0092...`, `92300...`
/// and international numbers written with a leading `+` (8–15 digits).
pub fn normalize_phone(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    let had_plus = trimmed.starts_with('+');
    let mut digits: String = trimmed.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return Err("Enter a mobile number like 0300-1234567".into());
    }
    if let Some(rest) = digits.strip_prefix("00") {
        digits = rest.to_string();
    }
    let pk = if digits.len() == 11 && digits.starts_with("03") {
        Some(format!("92{}", &digits[1..]))
    } else if digits.len() == 10 && digits.starts_with('3') {
        Some(format!("92{digits}"))
    } else if digits.len() == 12 && digits.starts_with("923") {
        Some(digits.clone())
    } else {
        None
    };
    if let Some(pk) = pk {
        return Ok(pk);
    }
    // Foreign numbers must be written with a country code (+ or 00 prefix).
    if (had_plus || input.trim().starts_with("00")) && (8..=15).contains(&digits.len()) && !digits.starts_with("92") {
        return Ok(digits);
    }
    Err("Enter a valid mobile number like 0300-1234567".into())
}

/// Display format for a normalised phone: `0300-1234567` for Pakistan, `+<digits>` otherwise.
pub fn display_phone(normalized: &str) -> String {
    if normalized.len() == 12 && normalized.starts_with("923") {
        format!("0{}-{}", &normalized[2..5], &normalized[5..])
    } else if normalized.is_empty() {
        String::new()
    } else {
        format!("+{normalized}")
    }
}

/// Normalises a CNIC to `XXXXX-XXXXXXX-X`. Empty input means "not provided".
pub fn normalize_cnic(input: Option<&str>) -> Result<Option<String>, String> {
    let Some(raw) = input else { return Ok(None) };
    let digits: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return Ok(None);
    }
    if digits.len() != 13 {
        return Err("CNIC must have 13 digits (e.g. 31303-1234567-1)".into());
    }
    Ok(Some(format!("{}-{}-{}", &digits[..5], &digits[5..12], &digits[12..])))
}

/// Trims, collapses inner whitespace and fixes ALL-CAPS / all-lowercase names to Title Case.
pub fn clean_name(input: &str) -> String {
    let collapsed = input.split_whitespace().collect::<Vec<_>>().join(" ");
    let has_lower = collapsed.chars().any(|c| c.is_lowercase());
    let has_upper = collapsed.chars().any(|c| c.is_uppercase());
    if has_lower && has_upper {
        return collapsed;
    }
    collapsed
        .split(' ')
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Trims an optional string; empty → `None`. Collapses runs of spaces on single-line values.
pub fn opt_text(value: Option<String>) -> Option<String> {
    value.and_then(|v| {
        let t = v.trim();
        if t.is_empty() { None } else { Some(t.to_string()) }
    })
}

/// Like [`opt_text`] but also limits the length (in characters).
pub fn opt_text_max(value: Option<String>, max: usize) -> Option<String> {
    opt_text(value).map(|v| v.chars().take(max).collect())
}

/// Escapes `%`, `_` and `\` for use inside `LIKE ... ESCAPE '\'`.
pub fn escape_like(term: &str) -> String {
    let mut out = String::with_capacity(term.len());
    for c in term.chars() {
        if matches!(c, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Digits of a search term turned into a phone fragment that matches stored `92XXXXXXXXXX` numbers.
pub fn phone_search_fragment(term: &str) -> Option<String> {
    let digits: String = term.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() < 3 {
        return None;
    }
    let fragment = if let Some(rest) = digits.strip_prefix('0') {
        rest.to_string()
    } else if digits.len() > 4 && digits.starts_with("92") {
        digits[2..].to_string()
    } else {
        digits
    };
    if fragment.is_empty() { None } else { Some(fragment) }
}

/// Formats an integer amount as `Rs 12,345` (Western grouping, as used on Pakistani receipts).
pub fn format_money(currency: &str, amount: i64) -> String {
    let negative = amount < 0;
    let digits = amount.unsigned_abs().to_string();
    let mut grouped = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(c);
    }
    format!("{}{} {}", if negative { "-" } else { "" }, currency, grouped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phone_normalisation() {
        assert_eq!(normalize_phone("0300-1234567").unwrap(), "923001234567");
        assert_eq!(normalize_phone("03001234567").unwrap(), "923001234567");
        assert_eq!(normalize_phone("3001234567").unwrap(), "923001234567");
        assert_eq!(normalize_phone("+92 300 1234567").unwrap(), "923001234567");
        assert_eq!(normalize_phone("0092-300-1234567").unwrap(), "923001234567");
        assert_eq!(normalize_phone("923001234567").unwrap(), "923001234567");
        assert_eq!(normalize_phone("+971 50 123 4567").unwrap(), "971501234567");
        assert!(normalize_phone("12345").is_err());
        assert!(normalize_phone("").is_err());
        assert!(normalize_phone("0423-1234567").is_err());
    }

    #[test]
    fn phone_display() {
        assert_eq!(display_phone("923001234567"), "0300-1234567");
        assert_eq!(display_phone("971501234567"), "+971501234567");
    }

    #[test]
    fn cnic_normalisation() {
        assert_eq!(normalize_cnic(Some("3130312345671")).unwrap().unwrap(), "31303-1234567-1");
        assert_eq!(normalize_cnic(Some("31303-1234567-1")).unwrap().unwrap(), "31303-1234567-1");
        assert_eq!(normalize_cnic(Some("  ")).unwrap(), None);
        assert_eq!(normalize_cnic(None).unwrap(), None);
        assert!(normalize_cnic(Some("12345")).is_err());
    }

    #[test]
    fn names() {
        assert_eq!(clean_name("  muhammad   ali "), "Muhammad Ali");
        assert_eq!(clean_name("USMAN TARIQ"), "Usman Tariq");
        assert_eq!(clean_name("McDonald Khan"), "McDonald Khan");
    }

    #[test]
    fn search_helpers() {
        assert_eq!(escape_like("50%_a\\"), "50\\%\\_a\\\\");
        assert_eq!(phone_search_fragment("0300-123").as_deref(), Some("300123"));
        assert_eq!(phone_search_fragment("923001").as_deref(), Some("3001"));
        assert_eq!(phone_search_fragment("ab"), None);
    }

    #[test]
    fn money() {
        assert_eq!(format_money("Rs", 1234567), "Rs 1,234,567");
        assert_eq!(format_money("Rs", 0), "Rs 0");
        assert_eq!(format_money("Rs", -2500), "-Rs 2,500");
    }
}
