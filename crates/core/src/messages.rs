//! WhatsApp message log and reminder queues.

use chrono::{Datelike, NaiveDate};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::auth::{Actor, Permission};
use crate::clock::{add_days, days_between, fmt_date, parse_date, Clock};
use crate::db::{self, Params};
use crate::error::{CoreError, CoreResult};
use crate::model::{quick_columns, MemberQuick};
use crate::settings;
use crate::util::{new_id, normalize_phone};

#[derive(Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct MessageLogInput {
    pub member_id: Option<String>,
    /// Template key (`welcome`, `receipt`, `expiryReminder`, ... or `custom`).
    pub template: String,
    pub phone: String,
    pub body: String,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MessageLogRow {
    pub id: String,
    pub member_id: Option<String>,
    pub member_name: Option<String>,
    pub member_code: Option<String>,
    pub template: String,
    pub phone: String,
    pub body: String,
    pub created_at: String,
    pub created_by_name: Option<String>,
}

/// Records that a WhatsApp message was opened for sending. Returns the normalised phone number.
pub fn log(conn: &mut Connection, actor: &Actor, clock: &Clock, input: MessageLogInput) -> CoreResult<String> {
    actor.require(Permission::SendMessages)?;
    let phone = normalize_phone(&input.phone).map_err(|m| CoreError::validation("phone", m))?;
    let body = input.body.trim();
    if body.is_empty() || body.chars().count() > 4000 {
        return Err(CoreError::validation("body", "Message is empty or too long"));
    }
    let template: String = input.template.chars().take(40).collect();
    let tx = db::write_tx(conn)?;
    tx.execute(
        "INSERT INTO message_log(id, member_id, template, channel, phone, body, created_by, created_at)
         VALUES (?1, ?2, ?3, 'whatsapp', ?4, ?5, ?6, ?7)",
        (new_id(), input.member_id.as_deref(), &template, &phone, body, actor.db_user_id(), clock.now_str()),
    )?;
    tx.commit()?;
    Ok(phone)
}

pub fn list(conn: &Connection, member_id: Option<&str>, limit: i64) -> CoreResult<Vec<MessageLogRow>> {
    let mut stmt = conn.prepare_cached(
        "SELECT l.id, l.member_id, m.full_name, m.member_code, l.template, l.phone, l.body, l.created_at, u.name
         FROM message_log l LEFT JOIN members m ON m.id = l.member_id LEFT JOIN users u ON u.id = l.created_by
         WHERE (?1 IS NULL OR l.member_id = ?1)
         ORDER BY l.created_at DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map((member_id, limit.clamp(1, 500)), |r| {
        Ok(MessageLogRow {
            id: r.get(0)?,
            member_id: r.get(1)?,
            member_name: r.get(2)?,
            member_code: r.get(3)?,
            template: r.get(4)?,
            phone: r.get(5)?,
            body: r.get(6)?,
            created_at: r.get(7)?,
            created_by_name: r.get(8)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[derive(Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ReminderKind {
    Expiring,
    Expired,
    Dues,
    Birthday,
    Inactive,
}

impl ReminderKind {
    pub fn template_key(&self) -> &'static str {
        match self {
            ReminderKind::Expiring => "expiryReminder",
            ReminderKind::Expired => "expiredReminder",
            ReminderKind::Dues => "duesReminder",
            ReminderKind::Birthday => "birthday",
            ReminderKind::Inactive => "inactive",
        }
    }
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReminderRow {
    pub member: MemberQuick,
    pub whatsapp: Option<String>,
    pub date_of_birth: Option<String>,
    /// Days until the next birthday (birthday queue only; 0 = today).
    pub birthday_in_days: Option<i64>,
    pub last_reminded_at: Option<String>,
}

#[derive(Serialize, TS, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReminderCounts {
    pub expiring: i64,
    pub expired: i64,
    pub dues: i64,
    pub birthday: i64,
    pub inactive: i64,
}

/// How many days back the "expired" queue looks (older lapses are treated as former members).
pub const EXPIRED_LOOKBACK_DAYS: i64 = 30;
pub const BIRTHDAY_LOOKAHEAD_DAYS: i64 = 7;

/// Days from `today` until the next birthday for a date of birth (Feb 29 → Feb 28 in common years).
pub fn days_until_birthday(dob: NaiveDate, today: NaiveDate) -> i64 {
    let next_in = |year: i32| {
        NaiveDate::from_ymd_opt(year, dob.month(), dob.day())
            .or_else(|| NaiveDate::from_ymd_opt(year, dob.month(), dob.day() - 1))
            .unwrap_or(today)
    };
    let this_year = next_in(today.year());
    let next = if this_year >= today { this_year } else { next_in(today.year() + 1) };
    days_between(today, next)
}

/// `MM-DD` strings for the next `days` days (and 02-29 when 28 Feb is included in a common year).
fn upcoming_month_days(today: NaiveDate, days: i64) -> Vec<String> {
    let mut out: Vec<String> = (0..=days).map(|i| add_days(today, i).format("%m-%d").to_string()).collect();
    if out.iter().any(|d| d == "02-28") && NaiveDate::from_ymd_opt(today.year(), 2, 29).is_none() {
        out.push("02-29".into());
    }
    out
}

fn queue_sql(kind: ReminderKind, today: NaiveDate) -> (String, &'static str) {
    let base = format!(
        "SELECT {}, m.whatsapp AS r_whatsapp, m.date_of_birth AS r_dob,
                (SELECT MAX(l.created_at) FROM message_log l WHERE l.member_id = m.id AND l.template = :tpl) AS r_last
         FROM members m LEFT JOIN member_stats ms ON ms.member_id = m.id
         WHERE m.deleted_at IS NULL AND m.status = 'active'",
        quick_columns!()
    );
    let birthday_filter = format!(
        "t.r_dob IS NOT NULL AND substr(t.r_dob, 6, 5) IN ({})",
        upcoming_month_days(today, BIRTHDAY_LOOKAHEAD_DAYS).iter().map(|d| format!("'{d}'")).collect::<Vec<_>>().join(", ")
    );
    let (filter, order): (&str, &str) = match kind {
        ReminderKind::Expiring => ("t.q_status = 'expiring'", "t.q_end ASC, t.q_name"),
        ReminderKind::Expired => ("t.q_status = 'expired' AND t.q_end >= :expired_from", "t.q_end DESC, t.q_name"),
        ReminderKind::Dues => ("t.q_balance > 0", "t.q_balance DESC, t.q_name"),
        ReminderKind::Birthday => (birthday_filter.as_str(), "t.q_name"),
        ReminderKind::Inactive => (
            "t.q_status IN ('active', 'expiring') AND COALESCE(t.q_last_visit, '') < :inactive_ts
             AND (SELECT join_date FROM members j WHERE j.id = t.q_id) <= :inactive_date",
            "t.q_last_visit ASC NULLS FIRST, t.q_name",
        ),
    };
    (format!("SELECT * FROM ({base}) t WHERE {filter} ORDER BY {order}"), order)
}

fn queue_params(clock: &Clock, soon: i64, inactive: Option<(String, String)>, kind: ReminderKind) -> Params {
    let today = clock.today();
    let mut p = Params::new();
    p.add(":today", fmt_date(today)).add(":soon_date", fmt_date(add_days(today, soon))).add(":tpl", kind.template_key());
    match kind {
        ReminderKind::Expired => {
            p.add(":expired_from", fmt_date(add_days(today, -EXPIRED_LOOKBACK_DAYS)));
        }
        ReminderKind::Inactive => {
            // Empty bounds match nobody while inactivity cannot be judged (see `attendance::inactive_cutoff`).
            let (ts, date) = inactive.unwrap_or_default();
            p.add(":inactive_ts", ts);
            p.add(":inactive_date", date);
        }
        _ => {}
    }
    p
}

pub fn reminder_queue(conn: &Connection, clock: &Clock, kind: ReminderKind, limit: i64) -> CoreResult<Vec<ReminderRow>> {
    let settings = settings::load(conn)?;
    let today = clock.today();
    let (sql, _) = queue_sql(kind, today);
    let inactive =
        if kind == ReminderKind::Inactive { crate::attendance::inactive_cutoff(conn, &settings, today)? } else { None };
    let params = queue_params(clock, settings.membership.expiring_soon_days, inactive, kind);
    let mut stmt = conn.prepare_cached(&sql)?;
    let rows = stmt.query_map(params.named().as_slice(), |r| {
        Ok(ReminderRow {
            member: MemberQuick::from_row(r)?,
            whatsapp: r.get("r_whatsapp")?,
            date_of_birth: r.get("r_dob")?,
            birthday_in_days: None,
            last_reminded_at: r.get("r_last")?,
        })
    })?;
    let mut out: Vec<ReminderRow> = rows.collect::<Result<Vec<_>, _>>()?;
    if kind == ReminderKind::Birthday {
        out = out
            .into_iter()
            .filter_map(|mut row| {
                let dob = row.date_of_birth.as_deref().and_then(parse_date)?;
                let days = days_until_birthday(dob, today);
                (days <= BIRTHDAY_LOOKAHEAD_DAYS).then(|| {
                    row.birthday_in_days = Some(days);
                    row
                })
            })
            .collect();
        out.sort_by_key(|r| r.birthday_in_days.unwrap_or(99));
    }
    out.truncate(limit.clamp(1, 1000) as usize);
    Ok(out)
}

pub fn reminder_counts(conn: &Connection, clock: &Clock) -> CoreResult<ReminderCounts> {
    let count = |kind| -> CoreResult<i64> { Ok(reminder_queue(conn, clock, kind, 1000)?.len() as i64) };
    Ok(ReminderCounts {
        expiring: count(ReminderKind::Expiring)?,
        expired: count(ReminderKind::Expired)?,
        dues: count(ReminderKind::Dues)?,
        birthday: count(ReminderKind::Birthday)?,
        inactive: count(ReminderKind::Inactive)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn birthday_maths() {
        let today = parse_date("2026-10-02").unwrap();
        assert_eq!(days_until_birthday(parse_date("1995-10-02").unwrap(), today), 0);
        assert_eq!(days_until_birthday(parse_date("1995-10-05").unwrap(), today), 3);
        assert_eq!(days_until_birthday(parse_date("1995-10-01").unwrap(), today), 364);
        // Leap-day birthday in a common year falls on 28 Feb.
        let t2 = parse_date("2027-02-27").unwrap();
        assert_eq!(days_until_birthday(parse_date("2004-02-29").unwrap(), t2), 1);
    }
}
