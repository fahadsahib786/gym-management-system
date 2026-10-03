//! Time source and date helpers.
//!
//! Business dates are local calendar dates (`YYYY-MM-DD`) and timestamps are local wall-clock times
//! (`YYYY-MM-DD HH:MM:SS`). Pakistan has no daylight saving, so local time maps to UTC+05:00 exactly.
//! The clock is injectable so tests can pin "today".

use chrono::{Datelike, Duration, Local, Months, NaiveDate, NaiveDateTime, NaiveTime, Timelike};

pub const DATE_FMT: &str = "%Y-%m-%d";
pub const TS_FMT: &str = "%Y-%m-%d %H:%M:%S";

#[derive(Clone, Debug, Default)]
pub enum Clock {
    /// The PC's local time.
    #[default]
    System,
    /// A fixed instant (tests, demos).
    Fixed(NaiveDateTime),
}

impl Clock {
    pub fn fixed(date: &str, time: &str) -> Clock {
        let d = parse_date(date).expect("valid date");
        let t = NaiveTime::parse_from_str(time, "%H:%M:%S").expect("valid time");
        Clock::Fixed(NaiveDateTime::new(d, t))
    }

    pub fn now(&self) -> NaiveDateTime {
        match self {
            Clock::System => {
                let now = Local::now().naive_local();
                now.with_nanosecond(0).unwrap_or(now)
            }
            Clock::Fixed(t) => *t,
        }
    }

    pub fn today(&self) -> NaiveDate {
        self.now().date()
    }

    pub fn now_str(&self) -> String {
        fmt_ts(self.now())
    }

    pub fn today_str(&self) -> String {
        fmt_date(self.today())
    }
}

pub fn fmt_date(d: NaiveDate) -> String {
    d.format(DATE_FMT).to_string()
}

pub fn fmt_ts(t: NaiveDateTime) -> String {
    t.format(TS_FMT).to_string()
}

pub fn parse_date(s: &str) -> Option<NaiveDate> {
    let s = s.trim();
    let head = s.get(..10).unwrap_or(s);
    NaiveDate::parse_from_str(head, DATE_FMT).ok()
}

/// Parses `YYYY-MM-DD HH:MM:SS`, `YYYY-MM-DDTHH:MM[:SS]` or `YYYY-MM-DD HH:MM`.
pub fn parse_ts(s: &str) -> Option<NaiveDateTime> {
    let s = s.trim().replace('T', " ");
    let s = s.get(..19).unwrap_or(&s).to_string();
    NaiveDateTime::parse_from_str(&s, TS_FMT)
        .or_else(|_| NaiveDateTime::parse_from_str(&s, "%Y-%m-%d %H:%M"))
        .ok()
}

pub fn add_days(d: NaiveDate, days: i64) -> NaiveDate {
    d + Duration::days(days)
}

/// Calendar-month addition with end-of-month clamping (31 Jan + 1 month = 28/29 Feb).
pub fn add_months(d: NaiveDate, months: u32) -> NaiveDate {
    d.checked_add_months(Months::new(months)).unwrap_or(d)
}

pub fn sub_months(d: NaiveDate, months: u32) -> NaiveDate {
    d.checked_sub_months(Months::new(months)).unwrap_or(d)
}

/// `b - a` in whole days.
pub fn days_between(a: NaiveDate, b: NaiveDate) -> i64 {
    (b - a).num_days()
}

pub fn month_start(d: NaiveDate) -> NaiveDate {
    NaiveDate::from_ymd_opt(d.year(), d.month(), 1).unwrap_or(d)
}

pub fn month_end(d: NaiveDate) -> NaiveDate {
    add_days(add_months(month_start(d), 1), -1)
}

/// `YYYY-MM` key for grouping.
pub fn month_key(d: NaiveDate) -> String {
    d.format("%Y-%m").to_string()
}

/// Short month label, e.g. `Oct`, plus the year when it is not the reference year (`Dec 25`).
pub fn month_label(d: NaiveDate, reference_year: i32) -> String {
    if d.year() == reference_year {
        d.format("%b").to_string()
    } else {
        d.format("%b %y").to_string()
    }
}

/// Human date used in messages and receipts: `02 Oct 2026`.
pub fn human_date(d: NaiveDate) -> String {
    d.format("%d %b %Y").to_string()
}

/// [`human_date`] for a stored `YYYY-MM-DD` value (returned unchanged when it is not a date).
pub fn human_date_str(s: &str) -> String {
    parse_date(s).map(human_date).unwrap_or_else(|| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn month_maths() {
        let d = parse_date("2026-01-31").unwrap();
        assert_eq!(fmt_date(add_months(d, 1)), "2026-02-28");
        assert_eq!(fmt_date(month_end(parse_date("2028-02-10").unwrap())), "2028-02-29");
        assert_eq!(fmt_date(month_start(parse_date("2026-10-02").unwrap())), "2026-10-01");
        assert_eq!(days_between(parse_date("2026-10-01").unwrap(), parse_date("2026-10-31").unwrap()), 30);
    }

    #[test]
    fn parsing() {
        assert!(parse_ts("2026-10-02 11:20:00").is_some());
        assert!(parse_ts("2026-10-02T11:20").is_some());
        assert!(parse_date("2026-13-01").is_none());
        assert_eq!(human_date(parse_date("2026-10-02").unwrap()), "02 Oct 2026");
    }
}
