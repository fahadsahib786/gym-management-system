//! Check-ins (attendance).

use chrono::{Duration, NaiveDate};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::audit;
use crate::auth::{Actor, Permission};
use crate::clock::{add_days, fmt_date, fmt_ts, human_date, parse_date, parse_ts, Clock};
use crate::db::{self, Params};
use crate::error::{CoreError, CoreResult};
use crate::members;
use crate::model::{paging, quick_columns, CheckInMethod, MemberQuick, MemberStatus, Page};
use crate::settings::{self, Settings};
use crate::summary;
use crate::util::format_money;

#[derive(Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct CheckInInput {
    pub member_id: String,
    pub method: Option<CheckInMethod>,
}

#[derive(Serialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum CheckInOutcome {
    /// Checked in.
    Ok,
    /// Already checked in a few minutes ago; nothing recorded.
    Duplicate,
    /// Refused (expired/no plan and the gym blocks such check-ins).
    Blocked,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CheckInResult {
    pub outcome: CheckInOutcome,
    pub attendance_id: Option<i64>,
    pub checked_in_at: Option<String>,
    pub member: MemberQuick,
    /// Plain-language warnings to show the receptionist (expired, dues, frozen...).
    pub warnings: Vec<String>,
    pub visits_this_month: i64,
}

fn warnings_for(member: &MemberQuick, currency: &str) -> Vec<String> {
    let mut w = Vec::new();
    match member.status {
        MemberStatus::Expired => {
            let days = member.days_left.map(|d| -d).unwrap_or(0);
            w.push(format!("Membership expired {days} day(s) ago — please renew."));
        }
        MemberStatus::NoPlan => w.push("No membership plan yet.".into()),
        MemberStatus::Frozen => w.push("Membership is frozen (paused).".into()),
        MemberStatus::Archived => w.push("This member is archived (left the gym).".into()),
        MemberStatus::Upcoming => w.push("Membership has not started yet.".into()),
        MemberStatus::Expiring => {
            let d = member.days_left.unwrap_or(0);
            w.push(if d == 0 { "Membership expires TODAY.".into() } else { format!("Membership expires in {d} day(s).") });
        }
        MemberStatus::Active => {}
    }
    if member.balance > 0 {
        w.push(format!("Fee due: {}", format_money(currency, member.balance)));
    }
    w
}

pub fn check_in(conn: &mut Connection, actor: &Actor, clock: &Clock, input: CheckInInput) -> CoreResult<CheckInResult> {
    actor.require(Permission::CheckIn)?;
    let tx = db::write_tx(conn)?;
    let settings = settings::load(&tx)?;
    let member = members::quick(&tx, clock, &input.member_id)?;
    let now = clock.now();
    let month_start = format!("{}-01", &fmt_date(now.date())[..7]);
    let visits = |c: &Connection| -> CoreResult<i64> {
        Ok(c.query_row(
            "SELECT COUNT(*) FROM attendance WHERE member_id = ?1 AND checked_in_at >= ?2",
            (&input.member_id, &month_start),
            |r| r.get(0),
        )?)
    };
    let warnings = warnings_for(&member, &settings.billing.currency);

    let blocked = settings.membership.block_expired_checkin
        && matches!(member.status, MemberStatus::Expired | MemberStatus::NoPlan | MemberStatus::Archived | MemberStatus::Frozen);
    if blocked {
        let v = visits(&tx)?;
        tx.commit()?;
        return Ok(CheckInResult { outcome: CheckInOutcome::Blocked, attendance_id: None, checked_in_at: None, member, warnings, visits_this_month: v });
    }

    let cooldown = settings.membership.checkin_cooldown_minutes;
    if cooldown > 0 {
        let since = fmt_ts(now - Duration::minutes(cooldown));
        let recent: Option<String> = tx
            .query_row(
                "SELECT checked_in_at FROM attendance WHERE member_id = ?1 AND checked_in_at >= ?2 ORDER BY checked_in_at DESC LIMIT 1",
                (&input.member_id, &since),
                |r| r.get(0),
            )
            .optional()?;
        if let Some(at) = recent {
            let v = visits(&tx)?;
            tx.commit()?;
            return Ok(CheckInResult {
                outcome: CheckInOutcome::Duplicate,
                attendance_id: None,
                checked_in_at: Some(at),
                member,
                warnings,
                visits_this_month: v,
            });
        }
    }

    let at = fmt_ts(now);
    tx.execute(
        "INSERT INTO attendance(member_id, checked_in_at, method, created_by) VALUES (?1, ?2, ?3, ?4)",
        (&input.member_id, &at, input.method.unwrap_or(CheckInMethod::Manual), actor.db_user_id()),
    )?;
    let id = tx.last_insert_rowid();
    summary::refresh_member(&tx, &input.member_id)?;
    let member = members::quick(&tx, clock, &input.member_id)?;
    let v = visits(&tx)?;
    tx.commit()?;
    Ok(CheckInResult { outcome: CheckInOutcome::Ok, attendance_id: Some(id), checked_in_at: Some(at), member, warnings, visits_this_month: v })
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AttendanceRow {
    pub id: i64,
    pub checked_in_at: String,
    pub method: CheckInMethod,
    pub recorded_by: Option<String>,
    pub member: MemberQuick,
}

#[derive(Deserialize, TS, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct AttendanceQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    pub member_id: Option<String>,
    pub search: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

pub fn list(conn: &Connection, clock: &Clock, q: &AttendanceQuery) -> CoreResult<Page<AttendanceRow>> {
    let settings = settings::load(conn)?;
    let (page, size, offset) = paging(q.page, q.page_size, 100);
    let mut params = Params::new();
    params.add(":today", clock.today_str()).add(":soon_date", settings.membership.soon_date(clock.today()));
    let mut cond = String::new();
    if let Some(f) = q.from.as_deref().filter(|s| !s.is_empty()) {
        cond.push_str(" AND a.checked_in_at >= :from || ' 00:00:00'");
        params.add(":from", f.to_string());
    }
    if let Some(t) = q.to.as_deref().filter(|s| !s.is_empty()) {
        cond.push_str(" AND a.checked_in_at <= :to || ' 23:59:59'");
        params.add(":to", t.to_string());
    }
    if let Some(m) = q.member_id.as_deref().filter(|s| !s.is_empty()) {
        cond.push_str(" AND a.member_id = :member");
        params.add(":member", m.to_string());
    }
    if let Some(s) = q.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        cond.push_str(" AND (m.full_name LIKE :like ESCAPE '\\' OR m.member_code LIKE :like ESCAPE '\\')");
        params.add(":like", format!("%{}%", crate::util::escape_like(s)));
    }
    // Count without computing member statuses; members are joined only when searching by name.
    let count_join = if cond.contains("m.") { "CROSS JOIN members m ON m.id = a.member_id" } else { "" };
    let count_params: Vec<(&str, &dyn rusqlite::ToSql)> =
        params.named().into_iter().filter(|(k, _)| !matches!(*k, ":today" | ":soon_date")).collect();
    let total: i64 = conn
        .prepare_cached(&format!("SELECT COUNT(*) FROM attendance a {count_join} WHERE 1 = 1 {cond}"))?
        .query_row(count_params.as_slice(), |r| r.get(0))?;
    params.add(":limit", size).add(":offset", offset);
    let sql = format!(
        "SELECT a.id AS a_id, a.checked_in_at AS a_at, a.method AS a_method, u.name AS a_by, {}
         FROM attendance a
         CROSS JOIN members m ON m.id = a.member_id
         LEFT JOIN member_stats ms ON ms.member_id = m.id
         LEFT JOIN users u ON u.id = a.created_by
         WHERE 1 = 1 {cond}
         ORDER BY a.checked_in_at DESC LIMIT :limit OFFSET :offset",
        quick_columns!()
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let mut rows = stmt.query(params.named().as_slice())?;
    let mut items = Vec::new();
    while let Some(r) = rows.next()? {
        items.push(AttendanceRow {
            id: r.get("a_id")?,
            checked_in_at: r.get("a_at")?,
            method: r.get("a_method")?,
            recorded_by: r.get("a_by")?,
            member: MemberQuick::from_row(r)?,
        });
    }
    Ok(Page { items, total, page, page_size: size })
}

/// Today's check-ins, newest first.
pub fn today(conn: &Connection, clock: &Clock) -> CoreResult<Vec<AttendanceRow>> {
    let today = clock.today_str();
    Ok(list(conn, clock, &AttendanceQuery { from: Some(today.clone()), to: Some(today), page_size: Some(500), ..Default::default() })?.items)
}

/// Removes a check-in recorded by mistake (admin).
pub fn delete(conn: &mut Connection, actor: &Actor, clock: &Clock, id: i64) -> CoreResult<()> {
    actor.require(Permission::DeleteAttendance)?;
    let tx = db::write_tx(conn)?;
    let (member_id, at, name, code): (String, String, String, String) = tx
        .query_row(
            "SELECT a.member_id, a.checked_in_at, m.full_name, m.member_code FROM attendance a JOIN members m ON m.id = a.member_id WHERE a.id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?
        .ok_or_else(|| CoreError::not_found("Check-in"))?;
    tx.execute("DELETE FROM attendance WHERE id = ?1", [id])?;
    summary::refresh_member(&tx, &member_id)?;
    let when = parse_ts(&at).map(|t| format!("{} {}", human_date(t.date()), t.format("%I:%M %p"))).unwrap_or(at);
    audit::record(&tx, actor, clock, "attendance.delete", Some("attendance"), Some(id.to_string().as_str()), format!("Removed check-in of {name} ({code}) at {when}"), Some(serde_json::json!({ "memberId": member_id })))?;
    tx.commit()?;
    Ok(())
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DayCount {
    pub date: String,
    pub count: i64,
}

/// Visits per day for one member (calendar heatmap on the profile).
pub fn member_days(conn: &Connection, member_id: &str, from: &str, to: &str) -> CoreResult<Vec<DayCount>> {
    if parse_date(from).is_none() || parse_date(to).is_none() {
        return Err(CoreError::invalid("Invalid date range"));
    }
    let mut stmt = conn.prepare_cached(
        "SELECT substr(checked_in_at, 1, 10) AS d, COUNT(*) FROM attendance
         WHERE member_id = ?1 AND checked_in_at BETWEEN ?2 || ' 00:00:00' AND ?3 || ' 23:59:59'
         GROUP BY d ORDER BY d",
    )?;
    let rows = stmt.query_map((member_id, from, to), |r| Ok(DayCount { date: r.get(0)?, count: r.get(1)? }))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// When the gym started recording check-ins (the first one ever), if it has.
pub fn tracking_since(conn: &Connection) -> CoreResult<Option<String>> {
    Ok(conn.query_row("SELECT MIN(checked_in_at) FROM attendance", [], |r| r.get(0))?)
}

/// The "inactive" cutoff as (timestamp, date): members without a visit since then count as inactive.
///
/// `None` while attendance is switched off or has not been recorded for a full window yet - otherwise every
/// member would look inactive on the day a gym starts using check-ins (or forever, if it never does).
pub fn inactive_cutoff(conn: &Connection, settings: &Settings, today: NaiveDate) -> CoreResult<Option<(String, String)>> {
    if !settings.membership.track_attendance {
        return Ok(None);
    }
    let cutoff = add_days(today, -settings.membership.inactive_days);
    let cutoff_ts = fmt_ts(cutoff.and_hms_opt(0, 0, 0).expect("valid time"));
    Ok(match tracking_since(conn)? {
        Some(first) if first <= cutoff_ts => Some((cutoff_ts, fmt_date(cutoff))),
        _ => None,
    })
}
