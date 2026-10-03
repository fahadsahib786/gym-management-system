//! Dashboard and reports. Everything is computed from the ledger, subscriptions, attendance and expenses.

use std::collections::HashMap;

use chrono::{Datelike, NaiveDate};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::attendance::{self, AttendanceQuery, AttendanceRow};
use crate::auth::{Actor, Permission};
use crate::billing::{self, MethodTotal, PaymentQuery, PaymentRow};
use crate::clock::{add_days, add_months, days_between, fmt_date, month_end, month_key, month_label, month_start, parse_date, sub_months, Clock};
use crate::error::{CoreError, CoreResult};
use crate::expenses::{CategoryTotal, Expense, ExpenseQuery};
use crate::members;
use crate::messages::{self, ReminderKind};
use crate::model::{quick_columns, MemberQuick, NameCount, NameTotal};
use crate::settings::{self, Settings};

#[derive(Serialize, TS, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Kpis {
    pub total_members: i64,
    pub active_members: i64,
    pub active_members_30d_ago: i64,
    pub new_members_month: i64,
    pub new_members_prev_period: i64,
    pub renewals_month: i64,
    pub renewals_prev_period: i64,
    pub expiring_soon: i64,
    pub expired_recent: i64,
    pub frozen: i64,
    pub no_plan: i64,
    pub inactive: i64,
    pub dues_total: i64,
    pub dues_members: i64,
    pub advance_total: i64,
    pub collected_today: i64,
    pub collected_today_count: i64,
    pub collected_yesterday: i64,
    pub collected_month: i64,
    pub collected_prev_period: i64,
    pub collected_prev_month: i64,
    pub expenses_month: i64,
    pub expenses_prev_period: i64,
    pub profit_month: i64,
    pub check_ins_today: i64,
    pub check_ins_yesterday: i64,
    pub avg_daily_check_ins: f64,
    pub unique_visitors_30d: i64,
    pub ended_last_30d: i64,
    pub renewed_of_ended: i64,
    /// Share (0–100) of memberships that ended in the last 30 days and were renewed.
    pub retention_rate: Option<f64>,
    pub avg_revenue_per_member: i64,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MonthPoint {
    pub month: String,
    pub label: String,
    pub collected: i64,
    pub expenses: i64,
    pub profit: i64,
    pub new_members: i64,
    pub renewals: i64,
    /// Memberships that ended in the month and were not renewed (churn).
    pub lapsed: i64,
    pub active_at_end: i64,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DayPoint {
    pub date: String,
    pub collected: i64,
    pub check_ins: i64,
    pub new_members: i64,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HeatCell {
    /// 0 = Sunday … 6 = Saturday.
    pub dow: i64,
    pub hour: i64,
    pub count: i64,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BirthdayRow {
    pub member: MemberQuick,
    pub date_of_birth: String,
    pub in_days: i64,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Dashboard {
    pub generated_at: String,
    pub today: String,
    pub show_revenue: bool,
    pub show_expenses: bool,
    pub kpis: Kpis,
    pub months: Vec<MonthPoint>,
    pub days: Vec<DayPoint>,
    pub methods_month: Vec<MethodTotal>,
    pub plan_mix: Vec<NameCount>,
    pub gender_mix: Vec<NameCount>,
    pub age_groups: Vec<NameCount>,
    pub timing_mix: Vec<NameCount>,
    pub source_mix: Vec<NameCount>,
    pub area_mix: Vec<NameCount>,
    pub heatmap: Vec<HeatCell>,
    pub expense_categories_month: Vec<CategoryTotal>,
    pub expiring: Vec<MemberQuick>,
    pub expired_recent: Vec<MemberQuick>,
    pub top_dues: Vec<MemberQuick>,
    pub inactive: Vec<MemberQuick>,
    /// False while check-ins are off, or have not been recorded for a full "not visiting" window yet.
    pub inactivity_tracked: bool,
    pub birthdays: Vec<BirthdayRow>,
    pub recent_payments: Vec<PaymentRow>,
    pub recent_check_ins: Vec<AttendanceRow>,
}

/// Section timings printed to stderr when `DF_PROFILE` is set (diagnosing slow PCs and benchmarks).
struct Prof {
    on: bool,
    last: std::time::Instant,
}

impl Prof {
    fn new() -> Self {
        Prof { on: std::env::var_os("DF_PROFILE").is_some(), last: std::time::Instant::now() }
    }
    fn mark(&mut self, label: &str) {
        if self.on {
            eprintln!("    {label:<26} {:>7.2} ms", self.last.elapsed().as_secs_f64() * 1000.0);
            self.last = std::time::Instant::now();
        }
    }
}

/// Check-ins on one day (`?1` = YYYY-MM-DD) — index-friendly range on `checked_in_at`.
pub(crate) const AT_DAY: &str = "checked_in_at BETWEEN ?1 || ' 00:00:00' AND ?1 || ' 23:59:59'";
/// Check-ins between two days inclusive (`?1`, `?2` = YYYY-MM-DD).
pub(crate) const AT_RANGE: &str = "checked_in_at BETWEEN ?1 || ' 00:00:00' AND ?2 || ' 23:59:59'";

/// Streams check-in timestamps in `[from_ts, to_ts]` (index-only) as `(date, weekday from Sunday 0–6, hour)`.
fn scan_checkins(conn: &Connection, from_ts: &str, to_ts: &str, mut f: impl FnMut(&str, usize, usize)) -> CoreResult<()> {
    let mut stmt = conn.prepare_cached(
        "SELECT checked_in_at FROM attendance WHERE checked_in_at BETWEEN ?1 AND ?2 ORDER BY checked_in_at",
    )?;
    let mut rows = stmt.query((from_ts, to_ts))?;
    let mut current_date = String::new();
    let mut current_dow = 0usize;
    while let Some(r) = rows.next()? {
        let Ok(ts) = r.get_ref(0)?.as_str() else { continue };
        if ts.len() < 13 {
            continue;
        }
        let (date, hour) = (&ts[..10], ts[11..13].parse::<usize>().unwrap_or(0).min(23));
        if date != current_date {
            current_date = date.to_string();
            current_dow = parse_date(date).map(|d| d.weekday().num_days_from_sunday() as usize).unwrap_or(0);
        }
        f(&current_date, current_dow, hour);
    }
    Ok(())
}

fn scalar_i64(conn: &Connection, sql: &str, params: impl rusqlite::Params) -> CoreResult<i64> {
    Ok(conn.query_row(sql, params, |r| r.get::<_, Option<i64>>(0))?.unwrap_or(0))
}

fn collected(conn: &Connection, from: &str, to: &str) -> CoreResult<i64> {
    scalar_i64(conn, "SELECT SUM(amount) FROM payments WHERE voided_at IS NULL AND paid_on BETWEEN ?1 AND ?2", (from, to))
}

fn expenses_between(conn: &Connection, from: &str, to: &str) -> CoreResult<i64> {
    scalar_i64(conn, "SELECT SUM(amount) FROM expenses WHERE deleted_at IS NULL AND expense_date BETWEEN ?1 AND ?2", (from, to))
}

/// Every valid membership, loaded once so date-based counts (active on a day, renewals, lapses) are computed
/// in memory instead of one scan per date.
struct SubIndex {
    /// (member index, start, end, is renewal, created on)
    subs: Vec<(usize, String, String, bool, String)>,
    /// Latest start date per member index (a membership "lapsed" if nothing starts after it ends).
    max_start: Vec<String>,
}

impl SubIndex {
    fn load(conn: &Connection) -> CoreResult<SubIndex> {
        let mut stmt = conn.prepare_cached(
            "SELECT s.member_id, s.start_date, s.end_date, s.kind = 'renewal', substr(s.created_at, 1, 10)
             FROM subscriptions s WHERE s.cancelled_at IS NULL
               AND s.member_id IN (SELECT id FROM members WHERE deleted_at IS NULL)",
        )?;
        let mut ids: HashMap<String, usize> = HashMap::new();
        let mut subs = Vec::new();
        let mut max_start: Vec<String> = Vec::new();
        let mut rows = stmt.query([])?;
        while let Some(r) = rows.next()? {
            let member: String = r.get(0)?;
            let next = ids.len();
            let idx = *ids.entry(member).or_insert(next);
            let start: String = r.get(1)?;
            if idx == max_start.len() {
                max_start.push(start.clone());
            } else if start > max_start[idx] {
                max_start[idx] = start.clone();
            }
            subs.push((idx, start, r.get(2)?, r.get(3)?, r.get(4)?));
        }
        Ok(SubIndex { subs, max_start })
    }

    fn distinct(&self, pred: impl Fn(&(usize, String, String, bool, String)) -> bool) -> i64 {
        let mut seen = vec![false; self.max_start.len()];
        let mut n = 0;
        for s in &self.subs {
            if !seen[s.0] && pred(s) {
                seen[s.0] = true;
                n += 1;
            }
        }
        n
    }

    /// Members with a membership covering `date`.
    fn active_on(&self, date: &str) -> i64 {
        self.distinct(|s| s.1.as_str() <= date && s.2.as_str() >= date)
    }

    fn renewals_between(&self, from: &str, to: &str) -> i64 {
        self.subs.iter().filter(|s| s.3 && s.4.as_str() >= from && s.4.as_str() <= to).count() as i64
    }

    /// Members whose membership ended in [from, to] and nothing started after it.
    fn lapsed_between(&self, from: &str, to: &str) -> i64 {
        self.distinct(|s| s.2.as_str() >= from && s.2.as_str() <= to && self.max_start[s.0] <= s.2)
    }

    /// (members whose membership ended in [from, to], of those who renewed).
    fn ended_and_renewed(&self, from: &str, to: &str) -> (i64, i64) {
        let ended = self.distinct(|s| s.2.as_str() >= from && s.2.as_str() <= to);
        let renewed = self.distinct(|s| s.2.as_str() >= from && s.2.as_str() <= to && self.max_start[s.0] > s.2);
        (ended, renewed)
    }
}

/// Same period of the previous month: (1st of last month, same day-of-month clamped).
fn prev_period(today: NaiveDate) -> (String, String) {
    let prev_start = sub_months(month_start(today), 1);
    let prev_end = month_end(prev_start);
    let same_day = NaiveDate::from_ymd_opt(prev_start.year(), prev_start.month(), today.day()).unwrap_or(prev_end).min(prev_end);
    (fmt_date(prev_start), fmt_date(same_day))
}

fn quick_list(conn: &Connection, settings: &Settings, today: &str, filter: &str, order: &str, limit: i64) -> CoreResult<Vec<MemberQuick>> {
    let sql = format!(
        "SELECT * FROM (SELECT {} FROM members m LEFT JOIN member_stats ms ON ms.member_id = m.id WHERE m.deleted_at IS NULL) t
         WHERE {filter} ORDER BY {order} LIMIT {limit}",
        quick_columns!()
    );
    let expired_from = fmt_date(add_days(parse_date(today).unwrap_or_default(), -30));
    let mut stmt = conn.prepare_cached(&sql)?;
    let soon_date = settings.membership.soon_date(parse_date(today).unwrap_or_default());
    let mut params: Vec<(&str, &dyn rusqlite::ToSql)> = vec![(":today", &today), (":soon_date", &soon_date)];
    if filter.contains(":expired_from") {
        params.push((":expired_from", &expired_from));
    }
    let rows = stmt.query_map(params.as_slice(), MemberQuick::from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn name_counts(conn: &Connection, sql: &str, params: impl rusqlite::Params) -> CoreResult<Vec<NameCount>> {
    let mut stmt = conn.prepare_cached(sql)?;
    let rows = stmt.query_map(params, |r| Ok(NameCount { name: r.get(0)?, count: r.get(1)? }))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Keeps the top `n` entries and folds the rest into "Other".
fn top_n(mut items: Vec<NameCount>, n: usize) -> Vec<NameCount> {
    items.sort_by_key(|i| std::cmp::Reverse(i.count));
    if items.len() > n {
        let rest: i64 = items[n..].iter().map(|i| i.count).sum();
        items.truncate(n);
        if rest > 0 {
            items.push(NameCount { name: "Other".into(), count: rest });
        }
    }
    items
}

/// Members with a valid membership today, as a SQL condition on `members m` / `member_stats ms`.
const ACTIVE_COND: &str = "m.deleted_at IS NULL AND m.status = 'active' AND ms.end_date >= ?1
     AND (ms.start_date <= ?1 OR EXISTS (SELECT 1 FROM subscriptions sx WHERE sx.member_id = m.id AND sx.cancelled_at IS NULL
                                          AND sx.start_date <= ?1 AND sx.end_date >= ?1))";

pub fn dashboard(conn: &Connection, actor: &Actor, clock: &Clock) -> CoreResult<Dashboard> {
    let settings = settings::load(conn)?;
    let show_revenue = actor.can(Permission::ViewRevenue);
    let show_expenses = actor.can(Permission::ViewExpenses);
    let today = clock.today();
    let today_s = fmt_date(today);
    let yesterday = fmt_date(add_days(today, -1));
    let m_start = fmt_date(month_start(today));
    let (prev_start, prev_same) = prev_period(today);
    let prev_month_end = fmt_date(month_end(sub_months(month_start(today), 1)));
    let d30 = fmt_date(add_days(today, -29));

    let mut prof = Prof::new();
    // ---- KPIs
    let counts = members::counts(conn, clock, None)?;
    let mut k = Kpis {
        total_members: counts.all,
        active_members: counts.active,
        expiring_soon: counts.expiring,
        frozen: counts.frozen,
        no_plan: counts.no_plan,
        inactive: counts.inactive,
        dues_members: counts.dues,
        ..Default::default()
    };
    prof.mark("counts");
    let subs = SubIndex::load(conn)?;
    k.active_members_30d_ago = subs.active_on(&fmt_date(add_days(today, -30)));
    k.expired_recent = scalar_i64(
        conn,
        "SELECT COUNT(*) FROM members m JOIN member_stats ms ON ms.member_id = m.id
         WHERE m.deleted_at IS NULL AND m.status = 'active' AND ms.end_date < ?1 AND ms.end_date >= ?2",
        (&today_s, fmt_date(add_days(today, -30))),
    )?;
    prof.mark("active 30d + expired");
    k.new_members_month = scalar_i64(conn, "SELECT COUNT(*) FROM members WHERE deleted_at IS NULL AND join_date BETWEEN ?1 AND ?2", (&m_start, &today_s))?;
    k.new_members_prev_period =
        scalar_i64(conn, "SELECT COUNT(*) FROM members WHERE deleted_at IS NULL AND join_date BETWEEN ?1 AND ?2", (&prev_start, &prev_same))?;
    k.renewals_month = subs.renewals_between(&m_start, &today_s);
    k.renewals_prev_period = subs.renewals_between(&prev_start, &prev_same);
    k.dues_total = scalar_i64(
        conn,
        "SELECT SUM(ms.balance) FROM member_stats ms JOIN members m ON m.id = ms.member_id
         WHERE ms.balance > 0 AND m.deleted_at IS NULL AND m.status = 'active'",
        [],
    )?;
    k.advance_total = scalar_i64(
        conn,
        "SELECT -SUM(ms.balance) FROM member_stats ms JOIN members m ON m.id = ms.member_id WHERE ms.balance < 0 AND m.deleted_at IS NULL",
        [],
    )?;
    prof.mark("new/renewals/dues");
    k.collected_today = collected(conn, &today_s, &today_s)?;
    k.collected_today_count =
        scalar_i64(conn, "SELECT COUNT(*) FROM payments WHERE voided_at IS NULL AND paid_on = ?1", [&today_s])?;
    k.collected_yesterday = collected(conn, &yesterday, &yesterday)?;
    k.collected_month = collected(conn, &m_start, &today_s)?;
    k.collected_prev_period = collected(conn, &prev_start, &prev_same)?;
    k.collected_prev_month = collected(conn, &prev_start, &prev_month_end)?;
    k.expenses_month = expenses_between(conn, &m_start, &today_s)?;
    k.expenses_prev_period = expenses_between(conn, &prev_start, &prev_same)?;
    k.profit_month = k.collected_month - k.expenses_month;
    k.check_ins_today = scalar_i64(conn, &format!("SELECT COUNT(*) FROM attendance WHERE {AT_DAY}"), [&today_s])?;
    k.check_ins_yesterday = scalar_i64(conn, &format!("SELECT COUNT(*) FROM attendance WHERE {AT_DAY}"), [&yesterday])?;
    let last30 = scalar_i64(conn, &format!("SELECT COUNT(*) FROM attendance WHERE {AT_RANGE}"), (&d30, &today_s))?;
    k.avg_daily_check_ins = (last30 as f64 / 30.0 * 10.0).round() / 10.0;
    k.unique_visitors_30d = scalar_i64(
        conn,
        "SELECT COUNT(*) FROM members m WHERE EXISTS (SELECT 1 FROM attendance a WHERE a.member_id = m.id
             AND a.checked_in_at BETWEEN ?1 || ' 00:00:00' AND ?2 || ' 23:59:59')",
        (&d30, &today_s),
    )?;
    prof.mark("money + check-ins");
    let (ended, renewed) = subs.ended_and_renewed(&fmt_date(add_days(today, -30)), &yesterday);
    k.ended_last_30d = ended;
    k.renewed_of_ended = renewed;
    k.retention_rate = (ended > 0).then(|| ((renewed as f64 / ended as f64) * 1000.0).round() / 10.0);
    k.avg_revenue_per_member = if k.active_members > 0 { k.collected_month / k.active_members } else { 0 };

    prof.mark("retention");
    // ---- 12-month series
    let first_month = sub_months(month_start(today), 11);
    let fm = fmt_date(first_month);
    let mut months: Vec<MonthPoint> = (0..12)
        .map(|i| {
            let d = add_months(first_month, i);
            MonthPoint {
                month: month_key(d),
                label: month_label(d, today.year()),
                collected: 0,
                expenses: 0,
                profit: 0,
                new_members: 0,
                renewals: 0,
                lapsed: 0,
                active_at_end: 0,
            }
        })
        .collect();
    let index: HashMap<String, usize> = months.iter().enumerate().map(|(i, m)| (m.month.clone(), i)).collect();
    let mut fill = |sql: &str, apply: &mut dyn FnMut(&mut MonthPoint, i64)| -> CoreResult<()> {
        let mut stmt = conn.prepare_cached(sql)?;
        let rows = stmt.query_map((&fm, &today_s), |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        for row in rows {
            let (key, v) = row?;
            if let Some(&i) = index.get(&key) {
                apply(&mut months[i], v);
            }
        }
        Ok(())
    };
    fill(
        "SELECT substr(paid_on, 1, 7), SUM(amount) FROM payments WHERE voided_at IS NULL AND paid_on BETWEEN ?1 AND ?2 GROUP BY 1",
        &mut |m, v| m.collected = v,
    )?;
    fill(
        "SELECT substr(expense_date, 1, 7), SUM(amount) FROM expenses WHERE deleted_at IS NULL AND expense_date BETWEEN ?1 AND ?2 GROUP BY 1",
        &mut |m, v| m.expenses = v,
    )?;
    fill(
        "SELECT substr(join_date, 1, 7), COUNT(*) FROM members WHERE deleted_at IS NULL AND join_date BETWEEN ?1 AND ?2 GROUP BY 1",
        &mut |m, v| m.new_members = v,
    )?;
    prof.mark("12-month fills");
    let yesterday_d = add_days(today, -1);
    for (i, m) in months.iter_mut().enumerate() {
        let d = add_months(first_month, i as u32);
        let (from, to) = (fmt_date(d), fmt_date(if i == 11 { today } else { month_end(d) }));
        m.active_at_end = subs.active_on(&to);
        m.renewals = subs.renewals_between(&from, &to);
        m.lapsed = subs.lapsed_between(&from, &fmt_date(month_end(d).min(yesterday_d)));
        m.profit = m.collected - m.expenses;
    }

    prof.mark("12-month active");
    // ---- 30-day series
    let mut days: Vec<DayPoint> = (0..30)
        .map(|i| DayPoint { date: fmt_date(add_days(today, i - 29)), collected: 0, check_ins: 0, new_members: 0 })
        .collect();
    let day_index: HashMap<String, usize> = days.iter().enumerate().map(|(i, d)| (d.date.clone(), i)).collect();
    let mut fill_day = |sql: &str, apply: &mut dyn FnMut(&mut DayPoint, i64)| -> CoreResult<()> {
        let mut stmt = conn.prepare_cached(sql)?;
        let rows = stmt.query_map((&d30, &today_s), |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        for row in rows {
            let (key, v) = row?;
            if let Some(&i) = day_index.get(&key) {
                apply(&mut days[i], v);
            }
        }
        Ok(())
    };
    fill_day(
        "SELECT paid_on, SUM(amount) FROM payments WHERE voided_at IS NULL AND paid_on BETWEEN ?1 AND ?2 GROUP BY 1",
        &mut |d, v| d.collected = v,
    )?;
    fill_day(
        &format!("SELECT substr(checked_in_at, 1, 10), COUNT(*) FROM attendance WHERE {AT_RANGE} GROUP BY 1"),
        &mut |d, v| d.check_ins = v,
    )?;
    fill_day(
        "SELECT join_date, COUNT(*) FROM members WHERE deleted_at IS NULL AND join_date BETWEEN ?1 AND ?2 GROUP BY 1",
        &mut |d, v| d.new_members = v,
    )?;

    prof.mark("30-day series");
    // ---- Mixes
    let mut stmt = conn.prepare_cached(
        "SELECT method, COUNT(*), SUM(amount) FROM payments WHERE voided_at IS NULL AND paid_on BETWEEN ?1 AND ?2
         GROUP BY method ORDER BY SUM(amount) DESC",
    )?;
    let methods_month = stmt
        .query_map((&m_start, &today_s), |r| Ok(MethodTotal { method: r.get(0)?, count: r.get(1)?, total: r.get(2)? }))?
        .collect::<Result<Vec<_>, _>>()?;

    // Every demographic breakdown from one pass over active members.
    let mut plan_c: HashMap<String, i64> = HashMap::new();
    let mut gender_c: HashMap<String, i64> = HashMap::new();
    let mut age_c: HashMap<&'static str, i64> = HashMap::new();
    let mut timing_c: HashMap<String, i64> = HashMap::new();
    let mut area_c: HashMap<String, i64> = HashMap::new();
    {
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT COALESCE(ms.plan_name, 'No plan'), m.gender, m.date_of_birth, COALESCE(m.timing, 'Not set'), COALESCE(m.area, 'Not set')
             FROM members m JOIN member_stats ms ON ms.member_id = m.id WHERE {ACTIVE_COND}"
        ))?;
        let mut rows = stmt.query([&today_s])?;
        while let Some(r) = rows.next()? {
            *plan_c.entry(r.get(0)?).or_default() += 1;
            let gender = match r.get::<_, String>(1)?.as_str() {
                "male" => "Male",
                "female" => "Female",
                _ => "Other",
            };
            *gender_c.entry(gender.to_string()).or_default() += 1;
            let dob: Option<String> = r.get(2)?;
            let age = dob.as_deref().and_then(parse_date).map(|d| {
                let mut a = today.year() - d.year();
                if (today.month(), today.day()) < (d.month(), d.day()) {
                    a -= 1;
                }
                a
            });
            let bucket = match age {
                None => "Not given",
                Some(a) if a < 18 => "Under 18",
                Some(a) if a < 25 => "18–24",
                Some(a) if a < 35 => "25–34",
                Some(a) if a < 45 => "35–44",
                Some(_) => "45+",
            };
            *age_c.entry(bucket).or_default() += 1;
            *timing_c.entry(r.get(3)?).or_default() += 1;
            *area_c.entry(r.get(4)?).or_default() += 1;
        }
    }
    let to_counts = |m: HashMap<String, i64>| -> Vec<NameCount> {
        let mut v: Vec<NameCount> = m.into_iter().map(|(name, count)| NameCount { name, count }).collect();
        v.sort_by(|a, b| b.count.cmp(&a.count).then(a.name.cmp(&b.name)));
        v
    };
    let plan_mix = top_n(to_counts(plan_c), 7);
    let gender_mix = to_counts(gender_c);
    let age_groups: Vec<NameCount> = ["Under 18", "18–24", "25–34", "35–44", "45+", "Not given"]
        .iter()
        .filter_map(|label| age_c.get(label).map(|&count| NameCount { name: label.to_string(), count }))
        .collect();
    let timing_mix = to_counts(timing_c);
    let source_mix = top_n(
        name_counts(
            conn,
            "SELECT COALESCE(source, 'Not set'), COUNT(*) FROM members WHERE deleted_at IS NULL AND join_date >= ?1 GROUP BY 1",
            [fmt_date(sub_months(today, 12))],
        )?,
        7,
    );
    let area_mix = top_n(to_counts(area_c), 8);

    prof.mark("mixes");
    // Heatmap: one index-only scan of the last 8 weeks, aggregated in memory (no per-row SQL functions).
    let mut grid = [[0i64; 24]; 7];
    scan_checkins(conn, &format!("{} 00:00:00", fmt_date(add_days(today, -55))), &format!("{today_s} 23:59:59"), |_, dow_sun, hour| {
        grid[dow_sun][hour] += 1;
    })?;
    let mut heatmap = Vec::new();
    for (dow, hours) in grid.iter().enumerate() {
        for (hour, &count) in hours.iter().enumerate() {
            if count > 0 {
                heatmap.push(HeatCell { dow: dow as i64, hour: hour as i64, count });
            }
        }
    }

    let expense_categories_month = if show_expenses {
        let mut stmt = conn.prepare_cached(
            "SELECT c.id, c.name, c.color, COUNT(*), SUM(e.amount) FROM expenses e JOIN expense_categories c ON c.id = e.category_id
             WHERE e.deleted_at IS NULL AND e.expense_date BETWEEN ?1 AND ?2 GROUP BY c.id ORDER BY SUM(e.amount) DESC",
        )?;
        stmt.query_map((&m_start, &today_s), |r| {
            Ok(CategoryTotal { category_id: r.get(0)?, name: r.get(1)?, color: r.get(2)?, count: r.get(3)?, total: r.get(4)? })
        })?
        .collect::<Result<Vec<_>, _>>()?
    } else {
        vec![]
    };

    prof.mark("heatmap + expense cats");
    // ---- Attention lists
    let expiring = quick_list(conn, &settings, &today_s, "t.q_status = 'expiring'", "t.q_end ASC, t.q_name", 8)?;
    let expired_recent =
        quick_list(conn, &settings, &today_s, "t.q_status = 'expired' AND t.q_end >= :expired_from", "t.q_end DESC, t.q_name", 8)?;
    let top_dues = quick_list(conn, &settings, &today_s, "t.q_balance > 0 AND t.q_status != 'archived'", "t.q_balance DESC", 8)?;
    prof.mark("expiring/expired/dues");
    let inactive: Vec<MemberQuick> =
        messages::reminder_queue(conn, clock, ReminderKind::Inactive, 8)?.into_iter().map(|r| r.member).collect();
    let inactivity_tracked = attendance::inactive_cutoff(conn, &settings, today)?.is_some();
    prof.mark("inactive");
    let birthdays: Vec<BirthdayRow> = messages::reminder_queue(conn, clock, ReminderKind::Birthday, 10)?
        .into_iter()
        .filter_map(|r| Some(BirthdayRow { in_days: r.birthday_in_days?, date_of_birth: r.date_of_birth?, member: r.member }))
        .collect();
    prof.mark("birthdays");
    let recent_payments = {
        let since = if show_revenue { "0000".to_string() } else { today_s.clone() };
        let mut stmt = conn.prepare_cached(&format!(
            "{} WHERE p.voided_at IS NULL AND p.paid_at >= ?1 ORDER BY p.paid_at DESC LIMIT 8",
            billing::PAYMENT_ROW_SELECT
        ))?;
        stmt.query_map([since], billing::row_to_payment)?.collect::<Result<Vec<_>, _>>()?
    };
    prof.mark("recent payments");
    let recent_check_ins = attendance::list(conn, clock, &AttendanceQuery { from: Some(today_s.clone()), page_size: Some(8), ..Default::default() })?.items;

    prof.mark("recent check-ins");
    // ---- Hide money the user may not see.
    if !show_revenue {
        k.collected_month = 0;
        k.collected_prev_period = 0;
        k.collected_prev_month = 0;
        k.collected_yesterday = 0;
        k.profit_month = 0;
        k.avg_revenue_per_member = 0;
        for m in months.iter_mut() {
            m.collected = 0;
            m.profit = 0;
        }
        for d in days.iter_mut() {
            d.collected = 0;
        }
    }
    if !show_expenses {
        k.expenses_month = 0;
        k.expenses_prev_period = 0;
        k.profit_month = 0;
        for m in months.iter_mut() {
            m.expenses = 0;
            m.profit = 0;
        }
    }
    let methods_month = if show_revenue { methods_month } else { vec![] };

    Ok(Dashboard {
        generated_at: clock.now_str(),
        today: today_s,
        show_revenue,
        show_expenses,
        kpis: k,
        months,
        days,
        methods_month,
        plan_mix,
        gender_mix,
        age_groups,
        timing_mix,
        source_mix,
        area_mix,
        heatmap,
        expense_categories_month,
        expiring,
        expired_recent,
        top_dues,
        inactive,
        inactivity_tracked,
        birthdays,
        recent_payments,
        recent_check_ins,
    })
}

// =============================================================================================
// Reports

#[derive(Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DateRange {
    pub from: String,
    pub to: String,
}

fn check_range(r: &DateRange) -> CoreResult<(NaiveDate, NaiveDate)> {
    let from = parse_date(&r.from).ok_or_else(|| CoreError::validation("from", "Invalid start date"))?;
    let to = parse_date(&r.to).ok_or_else(|| CoreError::validation("to", "Invalid end date"))?;
    if to < from {
        return Err(CoreError::validation("to", "End date is before the start date"));
    }
    if days_between(from, to) > 3700 {
        return Err(CoreError::validation("from", "Date range is too long"));
    }
    Ok((from, to))
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DateTotal {
    pub key: String,
    pub label: String,
    pub count: i64,
    pub total: i64,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CollectionsReport {
    pub from: String,
    pub to: String,
    pub total: i64,
    pub count: i64,
    pub average: i64,
    pub by_day: Vec<DateTotal>,
    pub by_month: Vec<DateTotal>,
    pub by_method: Vec<MethodTotal>,
    pub by_staff: Vec<NameTotal>,
    /// What was billed in the range (membership, admission, ...), before payments.
    pub billed_by_kind: Vec<NameTotal>,
    pub billed_total: i64,
    pub discounts_total: i64,
    pub voided_count: i64,
    pub voided_total: i64,
}

pub fn collections_report(conn: &Connection, actor: &Actor, range: &DateRange) -> CoreResult<CollectionsReport> {
    actor.require(Permission::ViewRevenue)?;
    let (from, to) = check_range(range)?;
    let (f, t) = (fmt_date(from), fmt_date(to));
    let (total, count): (i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0), COUNT(*) FROM payments WHERE voided_at IS NULL AND paid_on BETWEEN ?1 AND ?2",
        (&f, &t),
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let (voided_count, voided_total): (i64, i64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(amount), 0) FROM payments WHERE voided_at IS NOT NULL AND paid_on BETWEEN ?1 AND ?2",
        (&f, &t),
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let date_totals = |sql: &str, label: &dyn Fn(&str) -> String| -> CoreResult<Vec<DateTotal>> {
        let mut stmt = conn.prepare_cached(sql)?;
        let rows = stmt.query_map((&f, &t), |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))?;
        let mut out = Vec::new();
        for row in rows {
            let (key, count, total) = row?;
            out.push(DateTotal { label: label(&key), key, count, total });
        }
        Ok(out)
    };
    let by_day = date_totals(
        "SELECT paid_on, COUNT(*), SUM(amount) FROM payments WHERE voided_at IS NULL AND paid_on BETWEEN ?1 AND ?2 GROUP BY 1 ORDER BY 1",
        &|k| parse_date(k).map(|d| d.format("%d %b").to_string()).unwrap_or_else(|| k.to_string()),
    )?;
    let by_month = date_totals(
        "SELECT substr(paid_on, 1, 7), COUNT(*), SUM(amount) FROM payments WHERE voided_at IS NULL AND paid_on BETWEEN ?1 AND ?2 GROUP BY 1 ORDER BY 1",
        &|k| parse_date(&format!("{k}-01")).map(|d| d.format("%b %Y").to_string()).unwrap_or_else(|| k.to_string()),
    )?;
    let mut stmt = conn.prepare_cached(
        "SELECT method, COUNT(*), SUM(amount) FROM payments WHERE voided_at IS NULL AND paid_on BETWEEN ?1 AND ?2 GROUP BY 1 ORDER BY 3 DESC",
    )?;
    let by_method = stmt
        .query_map((&f, &t), |r| Ok(MethodTotal { method: r.get(0)?, count: r.get(1)?, total: r.get(2)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut stmt = conn.prepare_cached(
        "SELECT COALESCE(u.name, 'System'), COUNT(*), SUM(p.amount) FROM payments p LEFT JOIN users u ON u.id = p.received_by
         WHERE p.voided_at IS NULL AND p.paid_on BETWEEN ?1 AND ?2 GROUP BY 1 ORDER BY 3 DESC",
    )?;
    let by_staff = stmt
        .query_map((&f, &t), |r| Ok(NameTotal { name: r.get(0)?, count: r.get(1)?, total: r.get(2)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut stmt = conn.prepare_cached(
        "SELECT kind, COUNT(*), SUM(net_amount), SUM(discount) FROM charges WHERE voided_at IS NULL AND charge_date BETWEEN ?1 AND ?2
         GROUP BY kind ORDER BY 3 DESC",
    )?;
    let mut billed_total = 0;
    let mut discounts_total = 0;
    let billed_by_kind = stmt
        .query_map((&f, &t), |r| {
            let kind: crate::model::ChargeKind = r.get(0)?;
            Ok((NameTotal { name: kind.label().to_string(), count: r.get(1)?, total: r.get(2)? }, r.get::<_, i64>(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|(nt, disc)| {
            billed_total += nt.total;
            discounts_total += disc;
            nt
        })
        .collect();
    Ok(CollectionsReport {
        from: f,
        to: t,
        total,
        count,
        average: if count > 0 { total / count } else { 0 },
        by_day,
        by_month,
        by_method,
        by_staff,
        billed_by_kind,
        billed_total,
        discounts_total,
        voided_count,
        voided_total,
    })
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlanStat {
    pub plan_name: String,
    pub new_count: i64,
    pub renewal_count: i64,
    pub billed: i64,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MembershipMonth {
    pub month: String,
    pub label: String,
    pub new_members: i64,
    pub renewals: i64,
    pub lapsed: i64,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MembershipReport {
    pub from: String,
    pub to: String,
    pub new_members: i64,
    pub renewals: i64,
    pub ended: i64,
    pub renewed_after_end: i64,
    pub lapsed: i64,
    pub cancelled: i64,
    pub retention_rate: Option<f64>,
    pub by_plan: Vec<PlanStat>,
    pub months: Vec<MembershipMonth>,
    pub expiring_next_30: Vec<MemberQuick>,
}

pub fn memberships_report(conn: &Connection, actor: &Actor, clock: &Clock, range: &DateRange) -> CoreResult<MembershipReport> {
    actor.require(Permission::ViewReports)?;
    let settings = settings::load(conn)?;
    let (from, to) = check_range(range)?;
    let (f, t) = (fmt_date(from), fmt_date(to));
    let new_members = scalar_i64(conn, "SELECT COUNT(*) FROM members WHERE deleted_at IS NULL AND join_date BETWEEN ?1 AND ?2", (&f, &t))?;
    let renewals = scalar_i64(
        conn,
        "SELECT COUNT(*) FROM subscriptions WHERE kind = 'renewal' AND cancelled_at IS NULL AND substr(created_at, 1, 10) BETWEEN ?1 AND ?2",
        (&f, &t),
    )?;
    let cancelled = scalar_i64(conn, "SELECT COUNT(*) FROM subscriptions WHERE substr(cancelled_at, 1, 10) BETWEEN ?1 AND ?2", (&f, &t))?;
    let (ended, renewed_after_end): (i64, i64) = conn.query_row(
        "SELECT COUNT(DISTINCT s.member_id),
                COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM subscriptions s2 WHERE s2.member_id = s.member_id
                     AND s2.cancelled_at IS NULL AND s2.start_date > s.end_date) THEN s.member_id END)
         FROM subscriptions s WHERE s.cancelled_at IS NULL AND s.end_date BETWEEN ?1 AND ?2",
        (&f, &t),
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let mut stmt = conn.prepare_cached(
        "SELECT s.plan_name, SUM(s.kind IN ('new', 'migrated')), SUM(s.kind = 'renewal'), COALESCE(SUM(c.net_amount), 0)
         FROM subscriptions s LEFT JOIN charges c ON c.subscription_id = s.id AND c.kind = 'membership' AND c.voided_at IS NULL
         WHERE s.cancelled_at IS NULL AND substr(s.created_at, 1, 10) BETWEEN ?1 AND ?2
         GROUP BY s.plan_name ORDER BY 4 DESC",
    )?;
    let mut by_plan = stmt
        .query_map((&f, &t), |r| Ok(PlanStat { plan_name: r.get(0)?, new_count: r.get(1)?, renewal_count: r.get(2)?, billed: r.get(3)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    if !actor.can(Permission::ViewRevenue) {
        by_plan.iter_mut().for_each(|p| p.billed = 0);
    }

    // Month-by-month inside the range.
    let mut months = Vec::new();
    let mut cursor = month_start(from);
    while cursor <= to && months.len() < 120 {
        let ms = fmt_date(cursor.max(from));
        let me = fmt_date(month_end(cursor).min(to));
        months.push(MembershipMonth {
            month: month_key(cursor),
            label: cursor.format("%b %Y").to_string(),
            new_members: scalar_i64(conn, "SELECT COUNT(*) FROM members WHERE deleted_at IS NULL AND join_date BETWEEN ?1 AND ?2", (&ms, &me))?,
            renewals: scalar_i64(
                conn,
                "SELECT COUNT(*) FROM subscriptions WHERE kind = 'renewal' AND cancelled_at IS NULL AND substr(created_at, 1, 10) BETWEEN ?1 AND ?2",
                (&ms, &me),
            )?,
            lapsed: scalar_i64(
                conn,
                "SELECT COUNT(DISTINCT s.member_id) FROM subscriptions s WHERE s.cancelled_at IS NULL AND s.end_date BETWEEN ?1 AND ?2
                 AND NOT EXISTS (SELECT 1 FROM subscriptions s2 WHERE s2.member_id = s.member_id AND s2.cancelled_at IS NULL AND s2.start_date > s.end_date)",
                (&ms, &me),
            )?,
        });
        cursor = add_months(cursor, 1);
    }
    let today_s = clock.today_str();
    let in30 = fmt_date(add_days(clock.today(), 30));
    let sql = format!(
        "SELECT * FROM (SELECT {} FROM members m LEFT JOIN member_stats ms ON ms.member_id = m.id WHERE m.deleted_at IS NULL AND m.status = 'active') t
         WHERE t.q_end BETWEEN :today AND :in30 AND t.q_status IN ('active', 'expiring') ORDER BY t.q_end LIMIT 200",
        quick_columns!()
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let expiring_next_30 = stmt
        .query_map(
            rusqlite::named_params! { ":today": today_s, ":soon_date": settings.membership.soon_date(clock.today()), ":in30": in30 },
            MemberQuick::from_row,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(MembershipReport {
        from: f,
        to: t,
        new_members,
        renewals,
        ended,
        renewed_after_end,
        lapsed: ended - renewed_after_end,
        cancelled,
        retention_rate: (ended > 0).then(|| ((renewed_after_end as f64 / ended as f64) * 1000.0).round() / 10.0),
        by_plan,
        months,
        expiring_next_30,
    })
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HourCount {
    pub hour: i64,
    pub count: i64,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TopVisitor {
    pub member: MemberQuick,
    pub visits: i64,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AttendanceReport {
    pub from: String,
    pub to: String,
    pub total: i64,
    pub unique_members: i64,
    pub avg_per_day: f64,
    pub by_day: Vec<attendance::DayCount>,
    pub by_hour: Vec<HourCount>,
    pub by_weekday: Vec<NameCount>,
    pub top_members: Vec<TopVisitor>,
}

pub fn attendance_report(conn: &Connection, actor: &Actor, clock: &Clock, range: &DateRange) -> CoreResult<AttendanceReport> {
    actor.require(Permission::ViewReports)?;
    let settings = settings::load(conn)?;
    let (from, to) = check_range(range)?;
    let (f, t) = (fmt_date(from), fmt_date(to));
    let (from_ts, to_ts) = (format!("{f} 00:00:00"), format!("{t} 23:59:59"));

    // Totals, days, hours and weekdays from one ordered, index-only scan.
    let mut total = 0i64;
    let mut by_day: Vec<attendance::DayCount> = Vec::new();
    let mut hours = [0i64; 24];
    let mut weekdays = [0i64; 7];
    scan_checkins(conn, &from_ts, &to_ts, |date, dow_sun, hour| {
        total += 1;
        hours[hour] += 1;
        weekdays[dow_sun] += 1;
        match by_day.last_mut() {
            Some(d) if d.date == date => d.count += 1,
            _ => by_day.push(attendance::DayCount { date: date.to_string(), count: 1 }),
        }
    })?;
    let by_hour = hours.iter().enumerate().filter(|(_, c)| **c > 0).map(|(h, c)| HourCount { hour: h as i64, count: *c }).collect();
    let names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    let by_weekday = (0..7).map(|i| NameCount { name: names[i].into(), count: weekdays[(i + 1) % 7] }).collect();

    // Distinct visitors and top members through the per-member index (index-only counts).
    let unique_members = scalar_i64(
        conn,
        "SELECT COUNT(*) FROM members m WHERE EXISTS (SELECT 1 FROM attendance a WHERE a.member_id = m.id AND a.checked_in_at BETWEEN ?1 AND ?2)",
        (&from_ts, &to_ts),
    )?;
    let span = days_between(from, to.min(clock.today()).max(from)) + 1;
    let sql = format!(
        "SELECT {}, v.visits AS visits
         FROM (SELECT m2.id AS mid, (SELECT COUNT(*) FROM attendance a WHERE a.member_id = m2.id
                                     AND a.checked_in_at BETWEEN :from_ts AND :to_ts) AS visits
               FROM members m2 WHERE m2.deleted_at IS NULL ORDER BY visits DESC LIMIT 15) v
         JOIN members m ON m.id = v.mid LEFT JOIN member_stats ms ON ms.member_id = m.id
         WHERE v.visits > 0 ORDER BY v.visits DESC",
        quick_columns!()
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let top_members = stmt
        .query_map(
            rusqlite::named_params! {
                ":today": clock.today_str(), ":soon_date": settings.membership.soon_date(clock.today()),
                ":from_ts": from_ts, ":to_ts": to_ts,
            },
            |r| Ok(TopVisitor { member: MemberQuick::from_row(r)?, visits: r.get("visits")? }),
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(AttendanceReport {
        from: f,
        to: t,
        total,
        unique_members,
        avg_per_day: ((total as f64 / span.max(1) as f64) * 10.0).round() / 10.0,
        by_day,
        by_hour,
        by_weekday,
        top_members,
    })
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExpenseReport {
    pub from: String,
    pub to: String,
    pub total: i64,
    pub by_category: Vec<CategoryTotal>,
    pub by_month: Vec<DateTotal>,
    pub by_method: Vec<MethodTotal>,
}

pub fn expenses_report(conn: &Connection, actor: &Actor, range: &DateRange) -> CoreResult<ExpenseReport> {
    actor.require(Permission::ViewExpenses)?;
    let (from, to) = check_range(range)?;
    let (f, t) = (fmt_date(from), fmt_date(to));
    let total = expenses_between(conn, &f, &t)?;
    let mut stmt = conn.prepare_cached(
        "SELECT c.id, c.name, c.color, COUNT(*), SUM(e.amount) FROM expenses e JOIN expense_categories c ON c.id = e.category_id
         WHERE e.deleted_at IS NULL AND e.expense_date BETWEEN ?1 AND ?2 GROUP BY c.id ORDER BY 5 DESC",
    )?;
    let by_category = stmt
        .query_map((&f, &t), |r| {
            Ok(CategoryTotal { category_id: r.get(0)?, name: r.get(1)?, color: r.get(2)?, count: r.get(3)?, total: r.get(4)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut stmt = conn.prepare_cached(
        "SELECT substr(expense_date, 1, 7), COUNT(*), SUM(amount) FROM expenses WHERE deleted_at IS NULL AND expense_date BETWEEN ?1 AND ?2
         GROUP BY 1 ORDER BY 1",
    )?;
    let by_month = stmt
        .query_map((&f, &t), |r| {
            let key: String = r.get(0)?;
            let label = parse_date(&format!("{key}-01")).map(|d| d.format("%b %Y").to_string()).unwrap_or_else(|| key.clone());
            Ok(DateTotal { key, label, count: r.get(1)?, total: r.get(2)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut stmt = conn.prepare_cached(
        "SELECT method, COUNT(*), SUM(amount) FROM expenses WHERE deleted_at IS NULL AND expense_date BETWEEN ?1 AND ?2 GROUP BY 1 ORDER BY 3 DESC",
    )?;
    let by_method = stmt
        .query_map((&f, &t), |r| Ok(MethodTotal { method: r.get(0)?, count: r.get(1)?, total: r.get(2)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ExpenseReport { from: f, to: t, total, by_category, by_month, by_method })
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PnlMonth {
    pub month: String,
    pub label: String,
    pub income: i64,
    pub expenses: i64,
    pub profit: i64,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PnlReport {
    pub year: i32,
    pub months: Vec<PnlMonth>,
    pub total_income: i64,
    pub total_expenses: i64,
    pub total_profit: i64,
    pub expense_categories: Vec<CategoryTotal>,
}

/// Profit & loss for a calendar year (income = payments received, expenses = recorded costs).
pub fn pnl_report(conn: &Connection, actor: &Actor, year: i32) -> CoreResult<PnlReport> {
    actor.require(Permission::ViewRevenue)?;
    actor.require(Permission::ViewExpenses)?;
    if !(2000..=2100).contains(&year) {
        return Err(CoreError::validation("year", "Invalid year"));
    }
    let mut months = Vec::with_capacity(12);
    for m in 1..=12 {
        let start = NaiveDate::from_ymd_opt(year, m, 1).expect("valid month");
        let (s, e) = (fmt_date(start), fmt_date(month_end(start)));
        let income = collected(conn, &s, &e)?;
        let expenses = expenses_between(conn, &s, &e)?;
        months.push(PnlMonth { month: month_key(start), label: start.format("%b").to_string(), income, expenses, profit: income - expenses });
    }
    let total_income = months.iter().map(|m| m.income).sum();
    let total_expenses = months.iter().map(|m| m.expenses).sum();
    let report = expenses_report(conn, actor, &DateRange { from: format!("{year}-01-01"), to: format!("{year}-12-31") })?;
    Ok(PnlReport { year, months, total_income, total_expenses, total_profit: total_income - total_expenses, expense_categories: report.by_category })
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DailyClosing {
    pub date: String,
    pub payments: Vec<PaymentRow>,
    pub voided: Vec<PaymentRow>,
    pub by_method: Vec<MethodTotal>,
    pub by_staff: Vec<NameTotal>,
    pub total_collected: i64,
    pub cash_collected: i64,
    pub expenses: Vec<Expense>,
    pub total_expenses: i64,
    pub cash_expenses: i64,
    /// Cash that should be in the drawer: cash collected − cash expenses.
    pub net_cash: i64,
    pub new_members: i64,
    pub renewals: i64,
    pub check_ins: i64,
}

/// End-of-day summary for reconciling the cash drawer and digital wallets.
pub fn daily_closing(conn: &Connection, actor: &Actor, clock: &Clock, date: &str) -> CoreResult<DailyClosing> {
    let d = parse_date(date).ok_or_else(|| CoreError::validation("date", "Invalid date"))?;
    let date_s = fmt_date(d);
    if !actor.can(Permission::ViewRevenue) && d != clock.today() {
        return Err(CoreError::Forbidden);
    }
    let list = billing::list_payments(
        conn,
        &Actor::system(),
        clock,
        &PaymentQuery { from: Some(date_s.clone()), to: Some(date_s.clone()), page_size: Some(500), ..Default::default() },
    )?;
    let (voided, payments): (Vec<PaymentRow>, Vec<PaymentRow>) = list.items.into_iter().partition(|p| p.voided_at.is_some());
    let cash_collected = payments.iter().filter(|p| p.method.eq_ignore_ascii_case("cash")).map(|p| p.amount).sum();
    let mut staff: HashMap<String, (i64, i64)> = HashMap::new();
    for p in &payments {
        let e = staff.entry(p.received_by_name.clone().unwrap_or_else(|| "System".into())).or_default();
        e.0 += 1;
        e.1 += p.amount;
    }
    let mut by_staff: Vec<NameTotal> = staff.into_iter().map(|(name, (count, total))| NameTotal { name, count, total }).collect();
    by_staff.sort_by_key(|s| std::cmp::Reverse(s.total));
    let expenses = if actor.can(Permission::ViewExpenses) || actor.can(Permission::ManageExpenses) {
        crate::expenses::list(
            conn,
            &Actor::system(),
            &ExpenseQuery { from: Some(date_s.clone()), to: Some(date_s.clone()), page_size: Some(500), ..Default::default() },
        )?
        .items
    } else {
        vec![]
    };
    let total_expenses = expenses.iter().map(|e| e.amount).sum();
    let cash_expenses = expenses.iter().filter(|e| e.method.eq_ignore_ascii_case("cash")).map(|e| e.amount).sum::<i64>();
    Ok(DailyClosing {
        new_members: scalar_i64(conn, "SELECT COUNT(*) FROM members WHERE deleted_at IS NULL AND join_date = ?1", [&date_s])?,
        renewals: scalar_i64(
            conn,
            "SELECT COUNT(*) FROM subscriptions WHERE kind = 'renewal' AND cancelled_at IS NULL AND substr(created_at, 1, 10) = ?1",
            [&date_s],
        )?,
        check_ins: scalar_i64(conn, &format!("SELECT COUNT(*) FROM attendance WHERE {AT_DAY}"), [&date_s])?,
        date: date_s,
        total_collected: list.sum_amount,
        by_method: list.by_method,
        by_staff,
        net_cash: cash_collected - cash_expenses,
        cash_collected,
        payments,
        voided,
        expenses,
        total_expenses,
        cash_expenses,
    })
}
