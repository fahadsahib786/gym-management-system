//! Membership periods (subscriptions): creation, renewal, cancellation, date corrections and freezes.

use chrono::NaiveDate;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::audit;
use crate::auth::{Actor, Permission};
use crate::billing::{self, NewPayment, PaidStatus, PaymentEntry, PaymentResult, ReceiptItem};
use crate::clock::{add_days, days_between, fmt_date, human_date, human_date_str, parse_date, Clock};
use crate::db;
use crate::error::{CoreError, CoreResult};
use crate::model::{ChargeKind, MemberStatus, SubscriptionKind};
use crate::plans::{self, period_end};
use crate::settings::{self, Settings};
use crate::summary;
use crate::util::{format_money, new_id, opt_text_max};

#[derive(Serialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SubscriptionState {
    Current,
    Upcoming,
    Past,
    Cancelled,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SubscriptionRow {
    pub id: String,
    pub member_id: String,
    pub plan_id: Option<String>,
    pub plan_name: String,
    pub kind: SubscriptionKind,
    pub start_date: String,
    pub end_date: String,
    pub base_end_date: String,
    pub freeze_days: i64,
    pub notes: Option<String>,
    pub state: SubscriptionState,
    pub fee: i64,
    pub discount: i64,
    pub net_amount: i64,
    pub paid_amount: i64,
    pub paid_status: PaidStatus,
    pub created_at: String,
    pub created_by_name: Option<String>,
    pub cancelled_at: Option<String>,
    pub cancel_reason: Option<String>,
}

pub fn list_for_member(conn: &Connection, today: &str, member_id: &str) -> CoreResult<Vec<SubscriptionRow>> {
    let coverage = billing::fifo_coverage(conn, member_id)?;
    let mut stmt = conn.prepare_cached(
        "SELECT s.id, s.member_id, s.plan_id, s.plan_name, s.kind, s.start_date, s.end_date, s.base_end_date, s.freeze_days,
                s.notes, s.created_at, u.name, s.cancelled_at, s.cancel_reason,
                c.id, COALESCE(c.amount, 0), COALESCE(c.discount, 0), COALESCE(c.net_amount, 0), c.voided_at
         FROM subscriptions s
         LEFT JOIN users u ON u.id = s.created_by
         LEFT JOIN charges c ON c.subscription_id = s.id AND c.kind = 'membership'
         WHERE s.member_id = ?1
         ORDER BY s.start_date DESC, s.created_at DESC",
    )?;
    let rows = stmt.query_map([member_id], |r| {
        let start: String = r.get(5)?;
        let end: String = r.get(6)?;
        let cancelled_at: Option<String> = r.get(12)?;
        let charge_id: Option<String> = r.get(14)?;
        let net: i64 = r.get(17)?;
        let charge_voided: Option<String> = r.get(18)?;
        let paid = charge_id.as_ref().and_then(|id| coverage.get(id)).copied().unwrap_or(0);
        let state = if cancelled_at.is_some() {
            SubscriptionState::Cancelled
        } else if start.as_str() > today {
            SubscriptionState::Upcoming
        } else if end.as_str() < today {
            SubscriptionState::Past
        } else {
            SubscriptionState::Current
        };
        let paid_status = if cancelled_at.is_some() || charge_voided.is_some() {
            PaidStatus::Void
        } else if paid >= net {
            PaidStatus::Paid
        } else if paid > 0 {
            PaidStatus::Partial
        } else {
            PaidStatus::Unpaid
        };
        Ok(SubscriptionRow {
            id: r.get(0)?,
            member_id: r.get(1)?,
            plan_id: r.get(2)?,
            plan_name: r.get(3)?,
            kind: r.get(4)?,
            start_date: start,
            end_date: end,
            base_end_date: r.get(7)?,
            freeze_days: r.get(8)?,
            notes: r.get(9)?,
            state,
            fee: r.get(15)?,
            discount: r.get(16)?,
            net_amount: net,
            paid_amount: paid,
            paid_status,
            created_at: r.get(10)?,
            created_by_name: r.get(11)?,
            cancelled_at,
            cancel_reason: r.get(13)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Fields describing a new membership period (registration and renewal forms).
#[derive(Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct NewMembershipInput {
    pub plan_id: String,
    pub start_date: Option<String>,
    /// Override of the computed end date (inclusive).
    pub end_date: Option<String>,
    /// Override of the plan's fee for this member.
    pub price: Option<i64>,
    pub discount: Option<i64>,
    pub notes: Option<String>,
}

pub(crate) struct CreatedSubscription {
    pub id: String,
    pub plan_name: String,
    pub start: NaiveDate,
    pub end: NaiveDate,
    pub price: i64,
    pub discount: i64,
}

fn check_overlap(conn: &Connection, member_id: &str, start: &str, end: &str, exclude: Option<&str>) -> CoreResult<()> {
    let hit: Option<(String, String)> = conn
        .query_row(
            "SELECT start_date, end_date FROM subscriptions
             WHERE member_id = ?1 AND cancelled_at IS NULL AND id != COALESCE(?4, '')
               AND start_date <= ?3 AND end_date >= ?2
             ORDER BY start_date LIMIT 1",
            (member_id, start, end, exclude),
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((s, e)) = hit {
        let fmt = |x: &str| parse_date(x).map(human_date).unwrap_or_else(|| x.to_string());
        return Err(CoreError::conflict(format!(
            "These dates overlap an existing membership ({} – {}). Start after {}.",
            fmt(&s),
            fmt(&e),
            fmt(&e)
        )));
    }
    Ok(())
}

/// Inserts a subscription and its membership charge. Validates plan, dates and overlaps.
#[allow(clippy::too_many_arguments)]
pub(crate) fn create_subscription(
    conn: &Connection,
    actor: &Actor,
    clock: &Clock,
    member_id: &str,
    kind: SubscriptionKind,
    input: &NewMembershipInput,
    default_start: NaiveDate,
    charge_date: Option<&str>,
) -> CoreResult<CreatedSubscription> {
    let today = clock.today();
    let plan = plans::get(conn, &fmt_date(today), &input.plan_id)
        .map_err(|_| CoreError::validation("planId", "Choose a membership plan"))?;
    if !plan.is_active && kind != SubscriptionKind::Migrated {
        return Err(CoreError::validation("planId", "This plan is turned off. Choose another plan."));
    }
    let start = match input.start_date.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(s) => parse_date(s).ok_or_else(|| CoreError::validation("startDate", "Invalid start date"))?,
        None => default_start,
    };
    let end = match input.end_date.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(s) => parse_date(s).ok_or_else(|| CoreError::validation("endDate", "Invalid end date"))?,
        None => period_end(start, plan.duration_value, plan.duration_unit),
    };
    if end < start {
        return Err(CoreError::validation("endDate", "End date must be on or after the start date"));
    }
    if days_between(start, end) > 3700 {
        return Err(CoreError::validation("endDate", "Membership period is too long"));
    }
    if kind != SubscriptionKind::Migrated && days_between(today, start) > 366 {
        return Err(CoreError::validation("startDate", "Start date is too far in the future"));
    }
    let price = input.price.unwrap_or(plan.price);
    if !(0..=10_000_000).contains(&price) {
        return Err(CoreError::validation("price", "Enter a valid fee"));
    }
    let discount = input.discount.unwrap_or(0);
    if discount < 0 || discount > price {
        return Err(CoreError::validation("discount", "Discount cannot be more than the fee"));
    }
    let (start_s, end_s) = (fmt_date(start), fmt_date(end));
    check_overlap(conn, member_id, &start_s, &end_s, None)?;

    let id = new_id();
    let now = clock.now_str();
    conn.execute(
        "INSERT INTO subscriptions(id, member_id, plan_id, plan_name, kind, start_date, end_date, base_end_date, notes,
                                   created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9, ?10, ?10)",
        (&id, member_id, &plan.id, &plan.name, kind, &start_s, &end_s, opt_text_max(input.notes.clone(), 300), actor.db_user_id(), &now),
    )?;
    let description = format!("{} membership ({} – {})", plan.name, human_date(start), human_date(end));
    let charge_date = charge_date.map(str::to_string).unwrap_or_else(|| fmt_date(today));
    billing::insert_charge(conn, actor, clock, member_id, Some(&id), ChargeKind::Membership, &description, price, discount, &charge_date)?;
    Ok(CreatedSubscription { id, plan_name: plan.name, start, end, price, discount })
}

#[derive(Serialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum RenewalPolicy {
    /// First membership for this member: starts today.
    First,
    /// Current membership still running: continues the day after it ends.
    Continue,
    /// Expired within the grace period: continues from the old due date.
    Grace,
    /// Expired long ago: starts fresh today.
    Restart,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RenewalPreview {
    pub member_id: String,
    pub plan_id: Option<String>,
    pub plan_name: Option<String>,
    pub price: i64,
    pub start_date: String,
    pub end_date: Option<String>,
    pub previous_end_date: Option<String>,
    pub days_since_expiry: Option<i64>,
    pub policy: RenewalPolicy,
    pub note: String,
    pub balance: i64,
}

/// Suggested start date for the next membership according to the late-renewal policy.
pub(crate) fn suggested_start(settings: &Settings, today: NaiveDate, previous_end: Option<NaiveDate>) -> (NaiveDate, RenewalPolicy, String) {
    match previous_end {
        None => (today, RenewalPolicy::First, "First membership — starts today.".into()),
        Some(prev) if prev >= today => (
            add_days(prev, 1),
            RenewalPolicy::Continue,
            format!("Current membership ends on {}; the new one continues the next day.", human_date(prev)),
        ),
        Some(prev) => {
            let late = days_between(prev, today);
            let grace = settings.membership.late_renewal_grace_days;
            if late <= grace {
                (
                    add_days(prev, 1),
                    RenewalPolicy::Grace,
                    format!("Expired {late} day(s) ago. Within the {grace}-day grace period, so the fee date stays the same."),
                )
            } else {
                (today, RenewalPolicy::Restart, format!("Expired {late} days ago, so the new membership starts today."))
            }
        }
    }
}

pub fn renewal_preview(conn: &Connection, clock: &Clock, member_id: &str, plan_id: Option<&str>) -> CoreResult<RenewalPreview> {
    let settings = settings::load(conn)?;
    let today = clock.today();
    let today_s = fmt_date(today);
    let (last_plan, prev_end, balance): (Option<String>, Option<String>, i64) = conn
        .query_row(
            "SELECT ms.plan_id, ms.end_date, COALESCE(ms.balance, 0) FROM members m LEFT JOIN member_stats ms ON ms.member_id = m.id
             WHERE m.id = ?1 AND m.deleted_at IS NULL",
            [member_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .ok_or_else(|| CoreError::not_found("Member"))?;
    let previous_end = prev_end.as_deref().and_then(parse_date);
    let (start, policy, note) = suggested_start(&settings, today, previous_end);

    // Chosen plan → member's last plan (if still active) → first active plan.
    let plan = match plan_id.or(last_plan.as_deref()) {
        Some(id) => plans::get(conn, &today_s, id).ok().filter(|p| p.is_active || Some(id) == plan_id),
        None => None,
    }
    .or_else(|| plans::list(conn, &today_s, false).ok().and_then(|l| l.into_iter().next()));

    Ok(RenewalPreview {
        member_id: member_id.into(),
        plan_id: plan.as_ref().map(|p| p.id.clone()),
        plan_name: plan.as_ref().map(|p| p.name.clone()),
        price: plan.as_ref().map(|p| p.price).unwrap_or(0),
        start_date: fmt_date(start),
        end_date: plan.as_ref().map(|p| fmt_date(period_end(start, p.duration_value, p.duration_unit))),
        previous_end_date: prev_end,
        days_since_expiry: previous_end.filter(|e| *e < today).map(|e| days_between(e, today)),
        policy,
        note,
        balance,
    })
}

#[derive(Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct RenewInput {
    pub member_id: String,
    pub plan_id: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub price: Option<i64>,
    pub discount: Option<i64>,
    pub notes: Option<String>,
    pub payment: Option<PaymentEntry>,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RenewResult {
    pub subscription_id: String,
    pub plan_name: String,
    pub start_date: String,
    pub end_date: String,
    pub net_amount: i64,
    pub payment: Option<PaymentResult>,
    pub balance_after: i64,
}

/// Adds the next membership period, optionally with a payment, in one transaction.
pub fn renew(conn: &mut Connection, actor: &Actor, clock: &Clock, input: RenewInput) -> CoreResult<RenewResult> {
    actor.require(Permission::RenewMemberships)?;
    let tx = db::write_tx(conn)?;
    let settings = settings::load(&tx)?;
    let (name, code, status, prev_end): (String, String, String, Option<String>) = tx
        .query_row(
            "SELECT m.full_name, m.member_code, m.status, ms.end_date FROM members m
             LEFT JOIN member_stats ms ON ms.member_id = m.id WHERE m.id = ?1 AND m.deleted_at IS NULL",
            [&input.member_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?
        .ok_or_else(|| CoreError::not_found("Member"))?;
    if status == "archived" {
        // A returning member: bring them back automatically.
        tx.execute(
            "UPDATE members SET status = 'active', archived_at = NULL, archive_reason = NULL, updated_at = ?2 WHERE id = ?1",
            (&input.member_id, clock.now_str()),
        )?;
        audit::record(&tx, actor, clock, "member.restore", Some("member"), Some(&input.member_id), format!("{name} ({code}) returned and was restored"), None)?;
    }
    let (default_start, _, _) = suggested_start(&settings, clock.today(), prev_end.as_deref().and_then(parse_date));
    let kind = if prev_end.is_some() { SubscriptionKind::Renewal } else { SubscriptionKind::New };
    let membership = NewMembershipInput {
        plan_id: input.plan_id.clone(),
        start_date: input.start_date.clone(),
        end_date: input.end_date.clone(),
        price: input.price,
        discount: input.discount,
        notes: input.notes.clone(),
    };
    let sub = create_subscription(&tx, actor, clock, &input.member_id, kind, &membership, default_start, None)?;
    let net = sub.price - sub.discount;
    let payment = match &input.payment {
        Some(entry) if entry.amount > 0 => {
            actor.require(Permission::RecordPayments)?;
            Some(billing::insert_payment(
                &tx,
                actor,
                clock,
                &settings,
                NewPayment {
                    member_id: &input.member_id,
                    subscription_id: Some(&sub.id),
                    entry,
                    items: vec![ReceiptItem {
                        description: format!("{} membership ({} – {})", sub.plan_name, human_date(sub.start), human_date(sub.end)),
                        amount: sub.price,
                        discount: sub.discount,
                    }],
                    allow_backdate: false,
                },
            )?)
        }
        _ => None,
    };
    summary::refresh_member(&tx, &input.member_id)?;
    let balance_after = billing::live_balance(&tx, &input.member_id)?;
    let cur = &settings.billing.currency;
    audit::record(
        &tx,
        actor,
        clock,
        if kind == SubscriptionKind::Renewal { "membership.renew" } else { "membership.create" },
        Some("subscription"),
        Some(&sub.id),
        format!(
            "{} {} ({}) — {}, {} to {}, fee {}{}",
            if kind == SubscriptionKind::Renewal { "Renewed" } else { "Started membership for" },
            name,
            code,
            sub.plan_name,
            human_date(sub.start),
            human_date(sub.end),
            format_money(cur, net),
            payment.as_ref().map(|p| format!(", paid {} (receipt {})", format_money(cur, p.amount), p.receipt_no)).unwrap_or_default()
        ),
        Some(serde_json::json!({ "memberId": input.member_id })),
    )?;
    tx.commit()?;
    Ok(RenewResult {
        subscription_id: sub.id,
        plan_name: sub.plan_name,
        start_date: fmt_date(sub.start),
        end_date: fmt_date(sub.end),
        net_amount: net,
        payment,
        balance_after,
    })
}

/// (member id, name, code, start, end, cancelled at, freeze days) of a subscription.
type SubMember = (String, String, String, String, String, Option<String>, i64);

fn sub_member(conn: &Connection, subscription_id: &str) -> CoreResult<SubMember> {
    conn.query_row(
        "SELECT s.member_id, m.full_name, m.member_code, s.start_date, s.end_date, s.cancelled_at, s.freeze_days
         FROM subscriptions s JOIN members m ON m.id = s.member_id WHERE s.id = ?1",
        [subscription_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
    )
    .optional()?
    .ok_or_else(|| CoreError::not_found("Membership"))
}

/// Cancels a membership (admin): voids its fee and any freezes. Payments stay as credit/advance.
pub fn cancel(conn: &mut Connection, actor: &Actor, clock: &Clock, subscription_id: &str, reason: &str) -> CoreResult<()> {
    actor.require(Permission::CancelMemberships)?;
    let reason = reason.trim();
    if reason.chars().count() < 3 {
        return Err(CoreError::validation("reason", "Please write a short reason"));
    }
    let tx = db::write_tx(conn)?;
    let (member_id, name, code, start, end, cancelled, _) = sub_member(&tx, subscription_id)?;
    if cancelled.is_some() {
        return Err(CoreError::conflict("This membership is already cancelled."));
    }
    let now = clock.now_str();
    tx.execute(
        "UPDATE subscriptions SET cancelled_at = ?2, cancelled_by = ?3, cancel_reason = ?4, updated_at = ?2 WHERE id = ?1",
        (subscription_id, &now, actor.db_user_id(), reason),
    )?;
    tx.execute(
        "UPDATE freezes SET cancelled_at = ?2, cancelled_by = ?3, updated_at = ?2 WHERE subscription_id = ?1 AND cancelled_at IS NULL",
        (subscription_id, &now, actor.db_user_id()),
    )?;
    billing::void_subscription_charges(&tx, actor, clock, subscription_id, &format!("Membership cancelled: {reason}"))?;
    summary::refresh_member(&tx, &member_id)?;
    audit::record(
        &tx,
        actor,
        clock,
        "membership.cancel",
        Some("subscription"),
        Some(subscription_id),
        format!("Cancelled membership {} – {} of {name} ({code}): {reason}", human_date_str(&start), human_date_str(&end)),
        Some(serde_json::json!({ "memberId": member_id })),
    )?;
    tx.commit()?;
    Ok(())
}

#[derive(Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateDatesInput {
    pub subscription_id: String,
    pub start_date: String,
    pub end_date: String,
    pub reason: String,
}

/// Corrects the dates of a membership (admin).
pub fn update_dates(conn: &mut Connection, actor: &Actor, clock: &Clock, input: UpdateDatesInput) -> CoreResult<()> {
    actor.require(Permission::EditMemberships)?;
    let start = parse_date(&input.start_date).ok_or_else(|| CoreError::validation("startDate", "Invalid start date"))?;
    let end = parse_date(&input.end_date).ok_or_else(|| CoreError::validation("endDate", "Invalid end date"))?;
    if end < start {
        return Err(CoreError::validation("endDate", "End date must be on or after the start date"));
    }
    let reason = input.reason.trim();
    if reason.chars().count() < 3 {
        return Err(CoreError::validation("reason", "Please write a short reason"));
    }
    let tx = db::write_tx(conn)?;
    let (member_id, name, code, old_start, old_end, cancelled, freeze_days) = sub_member(&tx, &input.subscription_id)?;
    if cancelled.is_some() {
        return Err(CoreError::conflict("Cancelled memberships cannot be edited."));
    }
    let (start_s, end_s) = (fmt_date(start), fmt_date(end));
    check_overlap(&tx, &member_id, &start_s, &end_s, Some(&input.subscription_id))?;
    let base_end = fmt_date(add_days(end, -freeze_days).max(start));
    tx.execute(
        "UPDATE subscriptions SET start_date = ?2, end_date = ?3, base_end_date = ?4, updated_at = ?5 WHERE id = ?1",
        (&input.subscription_id, &start_s, &end_s, &base_end, clock.now_str()),
    )?;
    summary::refresh_member(&tx, &member_id)?;
    audit::record(
        &tx,
        actor,
        clock,
        "membership.edit_dates",
        Some("subscription"),
        Some(&input.subscription_id),
        format!(
            "Changed membership dates of {name} ({code}) from {} – {} to {} – {}: {reason}",
            human_date_str(&old_start),
            human_date_str(&old_end),
            human_date(start),
            human_date(end)
        ),
        Some(serde_json::json!({ "memberId": member_id })),
    )?;
    tx.commit()?;
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Freezes

#[derive(Serialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FreezeState {
    Scheduled,
    Active,
    Done,
    Cancelled,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FreezeRow {
    pub id: String,
    pub subscription_id: String,
    pub start_date: String,
    pub end_date: String,
    pub days: i64,
    pub reason: Option<String>,
    pub state: FreezeState,
    pub created_at: String,
    pub created_by_name: Option<String>,
    pub cancelled_at: Option<String>,
}

#[derive(Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct FreezeInput {
    pub member_id: String,
    pub start_date: Option<String>,
    pub days: i64,
    pub reason: Option<String>,
}

/// Moves every later membership of the member by `days` (positive or negative).
fn shift_later(conn: &Connection, clock: &Clock, member_id: &str, after: &str, days: i64) -> CoreResult<()> {
    if days == 0 {
        return Ok(());
    }
    let modifier = format!("{days:+} days");
    conn.execute(
        "UPDATE subscriptions SET start_date = date(start_date, ?3), end_date = date(end_date, ?3),
                base_end_date = date(base_end_date, ?3), updated_at = ?4
         WHERE member_id = ?1 AND cancelled_at IS NULL AND start_date > ?2",
        (member_id, after, &modifier, clock.now_str()),
    )?;
    Ok(())
}

pub fn list_freezes(conn: &Connection, today: &str, member_id: &str) -> CoreResult<Vec<FreezeRow>> {
    let mut stmt = conn.prepare_cached(
        "SELECT f.id, f.subscription_id, f.start_date, f.end_date, f.days, f.reason, f.created_at, u.name, f.cancelled_at
         FROM freezes f LEFT JOIN users u ON u.id = f.created_by WHERE f.member_id = ?1 ORDER BY f.start_date DESC",
    )?;
    let rows = stmt.query_map([member_id], |r| {
        let start: String = r.get(2)?;
        let end: String = r.get(3)?;
        let cancelled: Option<String> = r.get(8)?;
        let days: i64 = r.get(4)?;
        let state = if cancelled.is_some() || days == 0 {
            FreezeState::Cancelled
        } else if start.as_str() > today {
            FreezeState::Scheduled
        } else if end.as_str() < today {
            FreezeState::Done
        } else {
            FreezeState::Active
        };
        Ok(FreezeRow {
            id: r.get(0)?,
            subscription_id: r.get(1)?,
            start_date: start,
            end_date: end,
            days,
            reason: r.get(5)?,
            state,
            created_at: r.get(6)?,
            created_by_name: r.get(7)?,
            cancelled_at: cancelled,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Pauses a membership for `days` days; the end date (and any later renewals) move forward.
pub fn freeze(conn: &mut Connection, actor: &Actor, clock: &Clock, input: FreezeInput) -> CoreResult<FreezeRow> {
    actor.require(Permission::ManageFreezes)?;
    if input.days < 1 || input.days > 180 {
        return Err(CoreError::validation("days", "Freeze must be between 1 and 180 days"));
    }
    let today = clock.today();
    let start = match input.start_date.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(s) => parse_date(s).ok_or_else(|| CoreError::validation("startDate", "Invalid start date"))?,
        None => today,
    };
    if days_between(start, today) > 7 && !actor.can(Permission::EditMemberships) {
        return Err(CoreError::validation("startDate", "Freeze cannot start more than 7 days ago"));
    }
    let start_s = fmt_date(start);
    let end = add_days(start, input.days - 1);
    let end_s = fmt_date(end);
    let tx = db::write_tx(conn)?;
    let (name, code): (String, String) = tx
        .query_row("SELECT full_name, member_code FROM members WHERE id = ?1 AND deleted_at IS NULL", [&input.member_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()?
        .ok_or_else(|| CoreError::not_found("Member"))?;
    let sub: Option<(String, String)> = tx
        .query_row(
            "SELECT id, end_date FROM subscriptions WHERE member_id = ?1 AND cancelled_at IS NULL
             AND start_date <= ?2 AND end_date >= ?2 ORDER BY start_date LIMIT 1",
            (&input.member_id, &start_s),
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let Some((sub_id, sub_end)) = sub else {
        return Err(CoreError::validation("startDate", "There is no running membership on that date to freeze."));
    };
    let overlapping: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM freezes WHERE member_id = ?1 AND cancelled_at IS NULL AND days > 0
                       AND start_date <= ?3 AND end_date >= ?2)",
        (&input.member_id, &start_s, &end_s),
        |r| r.get(0),
    )?;
    if overlapping {
        return Err(CoreError::conflict("This member already has a freeze in that period."));
    }
    shift_later(&tx, clock, &input.member_id, &sub_end, input.days)?;
    let modifier = format!("+{} days", input.days);
    let now = clock.now_str();
    tx.execute(
        "UPDATE subscriptions SET end_date = date(end_date, ?2), freeze_days = freeze_days + ?3, updated_at = ?4 WHERE id = ?1",
        (&sub_id, &modifier, input.days, &now),
    )?;
    let id = new_id();
    let reason = opt_text_max(input.reason.clone(), 200);
    tx.execute(
        "INSERT INTO freezes(id, member_id, subscription_id, start_date, end_date, days, reason, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        (&id, &input.member_id, &sub_id, &start_s, &end_s, input.days, &reason, actor.db_user_id(), &now),
    )?;
    summary::refresh_member(&tx, &input.member_id)?;
    audit::record(
        &tx,
        actor,
        clock,
        "membership.freeze",
        Some("freeze"),
        Some(&id),
        format!("Froze membership of {name} ({code}) for {} day(s) from {}", input.days, human_date(start)),
        Some(serde_json::json!({ "memberId": input.member_id })),
    )?;
    let row = list_freezes(&tx, &fmt_date(today), &input.member_id)?
        .into_iter()
        .find(|f| f.id == id)
        .ok_or_else(|| CoreError::other("freeze not saved"))?;
    tx.commit()?;
    Ok(row)
}

/// Ends a freeze today (or cancels it if it has not started); unused days are given back.
pub fn end_freeze(conn: &mut Connection, actor: &Actor, clock: &Clock, freeze_id: &str) -> CoreResult<()> {
    actor.require(Permission::ManageFreezes)?;
    let today = clock.today();
    let tx = db::write_tx(conn)?;
    let (member_id, sub_id, start, end, days, cancelled): (String, String, String, String, i64, Option<String>) = tx
        .query_row(
            "SELECT member_id, subscription_id, start_date, end_date, days, cancelled_at FROM freezes WHERE id = ?1",
            [freeze_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .optional()?
        .ok_or_else(|| CoreError::not_found("Freeze"))?;
    if cancelled.is_some() || days == 0 {
        return Err(CoreError::conflict("This freeze was already cancelled."));
    }
    let start_d = parse_date(&start).ok_or_else(|| CoreError::other("bad freeze date"))?;
    let end_d = parse_date(&end).ok_or_else(|| CoreError::other("bad freeze date"))?;
    if end_d < today {
        return Err(CoreError::conflict("This freeze is already over."));
    }
    let used = if today <= start_d { 0 } else { days_between(start_d, today) };
    let give_back = days - used;
    let now = clock.now_str();
    let sub_end: String = tx.query_row("SELECT end_date FROM subscriptions WHERE id = ?1", [&sub_id], |r| r.get(0))?;
    shift_later(&tx, clock, &member_id, &sub_end, -give_back)?;
    tx.execute(
        "UPDATE subscriptions SET end_date = date(end_date, ?2), freeze_days = MAX(freeze_days - ?3, 0), updated_at = ?4 WHERE id = ?1",
        (&sub_id, format!("-{give_back} days"), give_back, &now),
    )?;
    if used == 0 {
        tx.execute(
            "UPDATE freezes SET cancelled_at = ?2, cancelled_by = ?3, days = 0, updated_at = ?2 WHERE id = ?1",
            (freeze_id, &now, actor.db_user_id()),
        )?;
    } else {
        tx.execute(
            "UPDATE freezes SET end_date = ?2, days = ?3, updated_at = ?4 WHERE id = ?1",
            (freeze_id, fmt_date(add_days(today, -1)), used, &now),
        )?;
    }
    summary::refresh_member(&tx, &member_id)?;
    let (name, code): (String, String) =
        tx.query_row("SELECT full_name, member_code FROM members WHERE id = ?1", [&member_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    audit::record(
        &tx,
        actor,
        clock,
        "membership.unfreeze",
        Some("freeze"),
        Some(freeze_id),
        format!("Ended freeze of {name} ({code}); {used} day(s) used, {give_back} day(s) given back"),
        Some(serde_json::json!({ "memberId": member_id })),
    )?;
    tx.commit()?;
    Ok(())
}

/// Helper for tests and seeding: the member's computed status today.
pub fn status_of(conn: &Connection, clock: &Clock, member_id: &str) -> CoreResult<MemberStatus> {
    let settings = settings::load(conn)?;
    let sql = format!(
        "SELECT {} FROM members m LEFT JOIN member_stats ms ON ms.member_id = m.id WHERE m.id = :id",
        crate::model::status_sql!()
    );
    let today = clock.today_str();
    Ok(conn.query_row(
        &sql,
        rusqlite::named_params! { ":today": today, ":soon_date": settings.membership.soon_date(clock.today()), ":id": member_id },
        |r| r.get(0),
    )?)
}
