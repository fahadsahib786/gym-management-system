//! Money: charges (what a member owes), payments (what they paid), receipts, ledger and dues.
//!
//! `balance = Σ charges.net_amount − Σ payments.amount` over non-voided rows. Positive = dues, negative = advance.
//! Nothing financial is ever deleted; mistakes are voided with a reason by an admin.

use std::collections::HashMap;

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::audit;
use crate::auth::{Actor, Permission};
use crate::clock::{add_days, fmt_ts, parse_date, parse_ts, Clock};
use crate::db;
use crate::error::{CoreError, CoreResult};
use crate::model::{paging, quick_columns, ChargeKind, MemberQuick};
use crate::settings::{self, Settings};
use crate::summary;
use crate::util::{escape_like, format_money, new_id, opt_text_max, phone_search_fragment};

/// One line printed on a receipt (snapshot taken when the payment is saved).
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReceiptItem {
    pub description: String,
    pub amount: i64,
    pub discount: i64,
}

/// Payment details entered on a form.
#[derive(Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct PaymentEntry {
    pub amount: i64,
    pub method: String,
    pub reference: Option<String>,
    pub note: Option<String>,
    /// `YYYY-MM-DD` or `YYYY-MM-DD HH:MM[:SS]`; defaults to now. Past dates need permission.
    pub paid_at: Option<String>,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PaymentResult {
    pub payment_id: String,
    pub receipt_no: String,
    pub amount: i64,
    pub balance_after: i64,
}

pub(crate) struct NewPayment<'a> {
    pub member_id: &'a str,
    pub subscription_id: Option<&'a str>,
    pub entry: &'a PaymentEntry,
    pub items: Vec<ReceiptItem>,
    /// Allow past dates without the BackdatePayments permission (migrating paper records).
    pub allow_backdate: bool,
}

/// Balance computed from source rows (inside transactions, before `member_stats` is refreshed).
pub(crate) fn live_balance(conn: &Connection, member_id: &str) -> CoreResult<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE((SELECT SUM(net_amount) FROM charges WHERE member_id = ?1 AND voided_at IS NULL), 0)
              - COALESCE((SELECT SUM(amount) FROM payments WHERE member_id = ?1 AND voided_at IS NULL), 0)",
        [member_id],
        |r| r.get(0),
    )?)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn insert_charge(
    conn: &Connection,
    actor: &Actor,
    clock: &Clock,
    member_id: &str,
    subscription_id: Option<&str>,
    kind: ChargeKind,
    description: &str,
    amount: i64,
    discount: i64,
    charge_date: &str,
) -> CoreResult<String> {
    if !(0..=10_000_000).contains(&amount) {
        return Err(CoreError::validation("amount", "Enter a valid amount"));
    }
    if discount < 0 || discount > amount {
        return Err(CoreError::validation("discount", "Discount cannot be more than the fee"));
    }
    let id = new_id();
    let now = clock.now_str();
    conn.execute(
        "INSERT INTO charges(id, member_id, subscription_id, kind, description, amount, discount, charge_date, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
        (&id, member_id, subscription_id, kind, description, amount, discount, charge_date, actor.db_user_id(), &now),
    )?;
    Ok(id)
}

/// Resolves the payment time, enforcing "no future dates" and the backdating permission.
fn resolve_paid_at(actor: &Actor, clock: &Clock, raw: Option<&str>, allow_backdate: bool) -> CoreResult<String> {
    let now = clock.now();
    let Some(raw) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(fmt_ts(now));
    };
    let ts = if raw.len() <= 10 {
        let d = parse_date(raw).ok_or_else(|| CoreError::validation("paidAt", "Invalid payment date"))?;
        if d == now.date() { now } else { d.and_hms_opt(12, 0, 0).expect("valid time") }
    } else {
        parse_ts(raw).ok_or_else(|| CoreError::validation("paidAt", "Invalid payment date"))?
    };
    if ts.date() > now.date() {
        return Err(CoreError::validation("paidAt", "Payment date cannot be in the future"));
    }
    if ts.date() < now.date() && !allow_backdate {
        actor.require(Permission::BackdatePayments)?;
    }
    Ok(fmt_ts(ts.min(now)))
}

fn format_receipt_no(settings: &Settings, n: i64) -> String {
    let width = settings.billing.receipt_digits.clamp(3, 10) as usize;
    format!("{}{:0width$}", settings.billing.receipt_prefix, n, width = width)
}

/// Inserts a payment with the next receipt number and a receipt snapshot.
pub(crate) fn insert_payment(
    conn: &Connection,
    actor: &Actor,
    clock: &Clock,
    settings: &Settings,
    p: NewPayment<'_>,
) -> CoreResult<PaymentResult> {
    let amount = p.entry.amount;
    if amount <= 0 || amount > 10_000_000 {
        return Err(CoreError::validation("amount", "Enter the amount received"));
    }
    let method = p.entry.method.trim();
    if method.is_empty() || method.chars().count() > 30 {
        return Err(CoreError::validation("method", "Choose a payment method"));
    }
    let paid_at = resolve_paid_at(actor, clock, p.entry.paid_at.as_deref(), p.allow_backdate)?;
    let before = live_balance(conn, p.member_id)?;
    let after = before - amount;
    let receipt_no = format_receipt_no(settings, db::next_counter(conn, "receipt_no")?);
    let items_json = if p.items.is_empty() { None } else { Some(serde_json::to_string(&p.items)?) };
    let id = new_id();
    let now = clock.now_str();
    conn.execute(
        "INSERT INTO payments(id, receipt_no, member_id, subscription_id, amount, method, reference, note, paid_at,
                              items_json, balance_before, balance_after, received_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)",
        (
            &id,
            &receipt_no,
            p.member_id,
            p.subscription_id,
            amount,
            method,
            opt_text_max(p.entry.reference.clone(), 60),
            opt_text_max(p.entry.note.clone(), 200),
            &paid_at,
            items_json,
            before,
            after,
            actor.db_user_id(),
            &now,
        ),
    )?;
    Ok(PaymentResult { payment_id: id, receipt_no, amount, balance_after: after })
}

fn member_label(conn: &Connection, member_id: &str) -> CoreResult<(String, String)> {
    conn.query_row(
        "SELECT full_name, member_code FROM members WHERE id = ?1 AND deleted_at IS NULL",
        [member_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?
    .ok_or_else(|| CoreError::not_found("Member"))
}

#[derive(Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct RecordPaymentInput {
    pub member_id: String,
    pub amount: i64,
    pub method: String,
    pub reference: Option<String>,
    pub note: Option<String>,
    pub paid_at: Option<String>,
    pub subscription_id: Option<String>,
}

/// Records a payment against a member's balance (dues or advance).
pub fn record_payment(conn: &mut Connection, actor: &Actor, clock: &Clock, input: RecordPaymentInput) -> CoreResult<PaymentResult> {
    actor.require(Permission::RecordPayments)?;
    let tx = db::write_tx(conn)?;
    let settings = settings::load(&tx)?;
    let (name, code) = member_label(&tx, &input.member_id)?;
    if let Some(sub) = input.subscription_id.as_deref() {
        let ok: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM subscriptions WHERE id = ?1 AND member_id = ?2)",
            (sub, &input.member_id),
            |r| r.get(0),
        )?;
        if !ok {
            return Err(CoreError::invalid("That membership does not belong to this member"));
        }
    }
    let entry = PaymentEntry {
        amount: input.amount,
        method: input.method.clone(),
        reference: input.reference.clone(),
        note: input.note.clone(),
        paid_at: input.paid_at.clone(),
    };
    let result = insert_payment(
        &tx,
        actor,
        clock,
        &settings,
        NewPayment { member_id: &input.member_id, subscription_id: input.subscription_id.as_deref(), entry: &entry, items: vec![], allow_backdate: false },
    )?;
    summary::refresh_member(&tx, &input.member_id)?;
    audit::record(
        &tx,
        actor,
        clock,
        "payment.create",
        Some("payment"),
        Some(&result.payment_id),
        format!(
            "Received {} from {} ({}) via {} — receipt {}",
            format_money(&settings.billing.currency, result.amount),
            name,
            code,
            entry.method.trim(),
            result.receipt_no
        ),
        Some(serde_json::json!({ "memberId": input.member_id, "receiptNo": result.receipt_no, "amount": result.amount })),
    )?;
    tx.commit()?;
    Ok(result)
}

fn require_reason(reason: &str) -> CoreResult<String> {
    let r = reason.trim();
    if r.chars().count() < 3 {
        return Err(CoreError::validation("reason", "Please write a short reason"));
    }
    Ok(r.chars().take(200).collect())
}

/// Voids a payment (admin). The receipt stays on record, marked VOID.
pub fn void_payment(conn: &mut Connection, actor: &Actor, clock: &Clock, payment_id: &str, reason: &str) -> CoreResult<()> {
    actor.require(Permission::VoidPayments)?;
    let reason = require_reason(reason)?;
    let tx = db::write_tx(conn)?;
    let settings = settings::load(&tx)?;
    let (member_id, receipt_no, amount, voided): (String, String, i64, Option<String>) = tx
        .query_row(
            "SELECT member_id, receipt_no, amount, voided_at FROM payments WHERE id = ?1",
            [payment_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?
        .ok_or_else(|| CoreError::not_found("Payment"))?;
    if voided.is_some() {
        return Err(CoreError::conflict("This payment is already void."));
    }
    let now = clock.now_str();
    tx.execute(
        "UPDATE payments SET voided_at = ?2, voided_by = ?3, void_reason = ?4, updated_at = ?2 WHERE id = ?1",
        (payment_id, &now, actor.db_user_id(), &reason),
    )?;
    summary::refresh_member(&tx, &member_id)?;
    let (name, code) = member_label(&tx, &member_id)?;
    audit::record(
        &tx,
        actor,
        clock,
        "payment.void",
        Some("payment"),
        Some(payment_id),
        format!("Voided receipt {receipt_no} ({}) of {name} ({code}): {reason}", format_money(&settings.billing.currency, amount)),
        Some(serde_json::json!({ "memberId": member_id, "receiptNo": receipt_no, "amount": amount })),
    )?;
    tx.commit()?;
    Ok(())
}

#[derive(Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct ChargeInput {
    pub member_id: String,
    pub kind: ChargeKind,
    pub description: Option<String>,
    pub amount: i64,
    pub discount: Option<i64>,
    pub charge_date: Option<String>,
    pub payment: Option<PaymentEntry>,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChargeResult {
    pub charge_id: String,
    pub payment: Option<PaymentResult>,
    pub balance_after: i64,
}

/// Adds a one-off charge (admission, personal training, locker, fine, product, other), optionally paid now.
pub fn add_charge(conn: &mut Connection, actor: &Actor, clock: &Clock, input: ChargeInput) -> CoreResult<ChargeResult> {
    actor.require(Permission::AddCharges)?;
    if input.kind == ChargeKind::Membership {
        return Err(CoreError::invalid("Use Renew to add a membership"));
    }
    if input.amount <= 0 {
        return Err(CoreError::validation("amount", "Enter the amount"));
    }
    let today = clock.today();
    let date = match input.charge_date.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(s) => parse_date(s).ok_or_else(|| CoreError::validation("chargeDate", "Invalid date"))?,
        None => today,
    };
    if date > today {
        return Err(CoreError::validation("chargeDate", "Date cannot be in the future"));
    }
    let description = opt_text_max(input.description.clone(), 120).unwrap_or_else(|| input.kind.label().to_string());
    let discount = input.discount.unwrap_or(0);
    let tx = db::write_tx(conn)?;
    let settings = settings::load(&tx)?;
    let (name, code) = member_label(&tx, &input.member_id)?;
    let charge_id = insert_charge(
        &tx,
        actor,
        clock,
        &input.member_id,
        None,
        input.kind,
        &description,
        input.amount,
        discount,
        &crate::clock::fmt_date(date),
    )?;
    let payment = match &input.payment {
        Some(entry) if entry.amount > 0 => {
            actor.require(Permission::RecordPayments)?;
            Some(insert_payment(
                &tx,
                actor,
                clock,
                &settings,
                NewPayment {
                    member_id: &input.member_id,
                    subscription_id: None,
                    entry,
                    items: vec![ReceiptItem { description: description.clone(), amount: input.amount, discount }],
                    allow_backdate: false,
                },
            )?)
        }
        _ => None,
    };
    summary::refresh_member(&tx, &input.member_id)?;
    let balance_after = live_balance(&tx, &input.member_id)?;
    audit::record(
        &tx,
        actor,
        clock,
        "charge.create",
        Some("charge"),
        Some(&charge_id),
        format!(
            "Added {} ({}) for {} ({}){}",
            description,
            format_money(&settings.billing.currency, input.amount - discount),
            name,
            code,
            payment.as_ref().map(|p| format!(" — paid, receipt {}", p.receipt_no)).unwrap_or_default()
        ),
        Some(serde_json::json!({ "memberId": input.member_id })),
    )?;
    tx.commit()?;
    Ok(ChargeResult { charge_id, payment, balance_after })
}

/// Voids a non-membership charge (memberships are cancelled instead).
pub fn void_charge(conn: &mut Connection, actor: &Actor, clock: &Clock, charge_id: &str, reason: &str) -> CoreResult<()> {
    actor.require(Permission::VoidCharges)?;
    let reason = require_reason(reason)?;
    let tx = db::write_tx(conn)?;
    let settings = settings::load(&tx)?;
    let (member_id, kind, description, net, voided, sub_cancelled): (String, ChargeKind, String, i64, Option<String>, Option<String>) = tx
        .query_row(
            "SELECT c.member_id, c.kind, c.description, c.net_amount, c.voided_at, s.cancelled_at
             FROM charges c LEFT JOIN subscriptions s ON s.id = c.subscription_id WHERE c.id = ?1",
            [charge_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .optional()?
        .ok_or_else(|| CoreError::not_found("Charge"))?;
    if voided.is_some() {
        return Err(CoreError::conflict("This charge is already void."));
    }
    if kind == ChargeKind::Membership && sub_cancelled.is_none() {
        return Err(CoreError::conflict("To remove a membership fee, cancel the membership instead."));
    }
    let now = clock.now_str();
    tx.execute(
        "UPDATE charges SET voided_at = ?2, voided_by = ?3, void_reason = ?4, updated_at = ?2 WHERE id = ?1",
        (charge_id, &now, actor.db_user_id(), &reason),
    )?;
    summary::refresh_member(&tx, &member_id)?;
    let (name, code) = member_label(&tx, &member_id)?;
    audit::record(
        &tx,
        actor,
        clock,
        "charge.void",
        Some("charge"),
        Some(charge_id),
        format!("Voided {description} ({}) of {name} ({code}): {reason}", format_money(&settings.billing.currency, net)),
        Some(serde_json::json!({ "memberId": member_id })),
    )?;
    tx.commit()?;
    Ok(())
}

/// Voids every charge of a cancelled subscription (called by memberships::cancel).
pub(crate) fn void_subscription_charges(conn: &Connection, actor: &Actor, clock: &Clock, subscription_id: &str, reason: &str) -> CoreResult<usize> {
    let now = clock.now_str();
    Ok(conn.execute(
        "UPDATE charges SET voided_at = ?2, voided_by = ?3, void_reason = ?4, updated_at = ?2
         WHERE subscription_id = ?1 AND voided_at IS NULL",
        (subscription_id, &now, actor.db_user_id(), reason),
    )?)
}

// ---------------------------------------------------------------------------------------------
// Receipts

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Receipt {
    pub payment_id: String,
    pub receipt_no: String,
    pub paid_at: String,
    pub amount: i64,
    pub method: String,
    pub reference: Option<String>,
    pub note: Option<String>,
    pub items: Vec<ReceiptItem>,
    pub balance_before: i64,
    pub balance_after: i64,
    pub member_id: String,
    pub member_code: String,
    pub member_name: String,
    pub member_phone: String,
    pub plan_name: Option<String>,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
    pub received_by: Option<String>,
    pub voided_at: Option<String>,
    pub void_reason: Option<String>,
}

pub fn get_receipt(conn: &Connection, payment_id: &str) -> CoreResult<Receipt> {
    conn.query_row(
        "SELECT p.id, p.receipt_no, p.paid_at, p.amount, p.method, p.reference, p.note, p.items_json, p.balance_before,
                p.balance_after, m.id, m.member_code, m.full_name, m.phone, s.plan_name, s.start_date, s.end_date,
                u.name, p.voided_at, p.void_reason
         FROM payments p
         JOIN members m ON m.id = p.member_id
         LEFT JOIN subscriptions s ON s.id = p.subscription_id
         LEFT JOIN users u ON u.id = p.received_by
         WHERE p.id = ?1",
        [payment_id],
        |r| {
            let items_json: Option<String> = r.get(7)?;
            Ok(Receipt {
                payment_id: r.get(0)?,
                receipt_no: r.get(1)?,
                paid_at: r.get(2)?,
                amount: r.get(3)?,
                method: r.get(4)?,
                reference: r.get(5)?,
                note: r.get(6)?,
                items: items_json.and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default(),
                balance_before: r.get(8)?,
                balance_after: r.get(9)?,
                member_id: r.get(10)?,
                member_code: r.get(11)?,
                member_name: r.get(12)?,
                member_phone: r.get(13)?,
                plan_name: r.get(14)?,
                period_start: r.get(15)?,
                period_end: r.get(16)?,
                received_by: r.get(17)?,
                voided_at: r.get(18)?,
                void_reason: r.get(19)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| CoreError::not_found("Payment"))
}

// ---------------------------------------------------------------------------------------------
// Payment list

#[derive(Deserialize, TS, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct PaymentQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    pub method: Option<String>,
    pub received_by: Option<String>,
    pub member_id: Option<String>,
    pub search: Option<String>,
    pub include_voided: Option<bool>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PaymentRow {
    pub id: String,
    pub receipt_no: String,
    pub paid_at: String,
    pub amount: i64,
    pub method: String,
    pub reference: Option<String>,
    pub note: Option<String>,
    pub member_id: String,
    pub member_code: String,
    pub member_name: String,
    pub member_phone: String,
    pub plan_name: Option<String>,
    pub received_by_name: Option<String>,
    pub balance_after: i64,
    pub voided_at: Option<String>,
    pub void_reason: Option<String>,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MethodTotal {
    pub method: String,
    pub count: i64,
    pub total: i64,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PaymentList {
    pub items: Vec<PaymentRow>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub sum_amount: i64,
    pub by_method: Vec<MethodTotal>,
    pub voided_count: i64,
    pub voided_amount: i64,
    /// The earliest date the current user may see (staff without revenue access see recent days only).
    pub visible_from: Option<String>,
}

pub(crate) const PAYMENT_ROW_SELECT: &str = "SELECT p.id, p.receipt_no, p.paid_at, p.amount, p.method, p.reference, p.note,
        m.id, m.member_code, m.full_name, m.phone, s.plan_name, u.name, p.balance_after, p.voided_at, p.void_reason
     FROM payments p
     CROSS JOIN members m ON m.id = p.member_id
     LEFT JOIN subscriptions s ON s.id = p.subscription_id
     LEFT JOIN users u ON u.id = p.received_by";

pub(crate) fn row_to_payment(r: &rusqlite::Row<'_>) -> rusqlite::Result<PaymentRow> {
    Ok(PaymentRow {
        id: r.get(0)?,
        receipt_no: r.get(1)?,
        paid_at: r.get(2)?,
        amount: r.get(3)?,
        method: r.get(4)?,
        reference: r.get(5)?,
        note: r.get(6)?,
        member_id: r.get(7)?,
        member_code: r.get(8)?,
        member_name: r.get(9)?,
        member_phone: r.get(10)?,
        plan_name: r.get(11)?,
        received_by_name: r.get(12)?,
        balance_after: r.get(13)?,
        voided_at: r.get(14)?,
        void_reason: r.get(15)?,
    })
}

/// How far back a user without revenue access may browse the payments ledger.
pub const STAFF_PAYMENT_HISTORY_DAYS: i64 = 2;

pub fn list_payments(conn: &Connection, actor: &Actor, clock: &Clock, q: &PaymentQuery) -> CoreResult<PaymentList> {
    let (page, size, offset) = paging(q.page, q.page_size, 50);
    let mut from = q.from.clone().filter(|s| !s.is_empty());
    let mut visible_from = None;
    if !actor.can(Permission::ViewRevenue) && q.member_id.is_none() {
        let min = crate::clock::fmt_date(add_days(clock.today(), -STAFF_PAYMENT_HISTORY_DAYS));
        if from.as_deref().map(|f| f < min.as_str()).unwrap_or(true) {
            from = Some(min.clone());
        }
        visible_from = Some(min);
    }

    let mut cond = String::from(" WHERE 1 = 1");
    let mut params: Vec<(String, Box<dyn rusqlite::ToSql>)> = Vec::new();
    if let Some(f) = from {
        cond.push_str(" AND p.paid_on >= :from");
        params.push((":from".into(), Box::new(f)));
    }
    if let Some(t) = q.to.clone().filter(|s| !s.is_empty()) {
        cond.push_str(" AND p.paid_on <= :to");
        params.push((":to".into(), Box::new(t)));
    }
    if let Some(m) = q.method.clone().filter(|s| !s.is_empty()) {
        cond.push_str(" AND p.method = :method");
        params.push((":method".into(), Box::new(m)));
    }
    if let Some(u) = q.received_by.clone().filter(|s| !s.is_empty()) {
        cond.push_str(" AND p.received_by = :user");
        params.push((":user".into(), Box::new(u)));
    }
    if let Some(m) = q.member_id.clone().filter(|s| !s.is_empty()) {
        cond.push_str(" AND p.member_id = :member");
        params.push((":member".into(), Box::new(m)));
    }
    if let Some(term) = q.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let like = format!("%{}%", escape_like(term));
        let mut c = String::from(
            " AND (p.receipt_no LIKE :like ESCAPE '\\' OR m.full_name LIKE :like ESCAPE '\\' OR m.member_code LIKE :like ESCAPE '\\'
                   OR p.reference LIKE :like ESCAPE '\\'",
        );
        if let Some(frag) = phone_search_fragment(term) {
            c.push_str(" OR m.phone LIKE :phone");
            params.push((":phone".into(), Box::new(format!("%{frag}%"))));
        }
        c.push(')');
        cond.push_str(&c);
        params.push((":like".into(), Box::new(like)));
    }
    let include_voided = q.include_voided.unwrap_or(true);
    let list_cond = if include_voided { cond.clone() } else { format!("{cond} AND p.voided_at IS NULL") };
    // Payments drive the query (CROSS JOIN keeps that order); members are only joined when searching by name.
    let member_join = if q.search.as_deref().map(str::trim).filter(|s| !s.is_empty()).is_some() {
        "CROSS JOIN members m ON m.id = p.member_id"
    } else {
        ""
    };

    let base: Vec<(&str, &dyn rusqlite::ToSql)> = params.iter().map(|(k, v)| (k.as_str(), v.as_ref())).collect();

    // Summary over the whole filtered range.
    let summary_sql = format!(
        "SELECT COUNT(*) FILTER (WHERE p.voided_at IS NULL), COALESCE(SUM(p.amount) FILTER (WHERE p.voided_at IS NULL), 0),
                COUNT(*) FILTER (WHERE p.voided_at IS NOT NULL), COALESCE(SUM(p.amount) FILTER (WHERE p.voided_at IS NOT NULL), 0)
         FROM payments p {member_join} {cond}"
    );
    let (count_valid, sum_amount, voided_count, voided_amount): (i64, i64, i64, i64) =
        conn.query_row(&summary_sql, base.as_slice(), |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;

    let method_sql = format!(
        "SELECT p.method, COUNT(*), SUM(p.amount) FROM payments p {member_join} {cond} AND p.voided_at IS NULL
         GROUP BY p.method ORDER BY SUM(p.amount) DESC"
    );
    let mut stmt = conn.prepare_cached(&method_sql)?;
    let by_method = stmt
        .query_map(base.as_slice(), |r| Ok(MethodTotal { method: r.get(0)?, count: r.get(1)?, total: r.get(2)? }))?
        .collect::<Result<Vec<_>, _>>()?;

    let total: i64 = if include_voided { count_valid + voided_count } else { count_valid };

    let mut list_params = base.clone();
    list_params.push((":limit", &size));
    list_params.push((":offset", &offset));
    let list_sql = format!("{PAYMENT_ROW_SELECT} {list_cond} ORDER BY p.paid_at DESC, p.receipt_no DESC LIMIT :limit OFFSET :offset");
    let mut stmt = conn.prepare_cached(&list_sql)?;
    let items = stmt.query_map(list_params.as_slice(), row_to_payment)?.collect::<Result<Vec<_>, _>>()?;

    Ok(PaymentList { items, total, page, page_size: size, sum_amount, by_method, voided_count, voided_amount, visible_from })
}

// ---------------------------------------------------------------------------------------------
// Charges, ledger and FIFO allocation

#[derive(Serialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PaidStatus {
    Paid,
    Partial,
    Unpaid,
    Void,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChargeRow {
    pub id: String,
    pub kind: ChargeKind,
    pub description: String,
    pub amount: i64,
    pub discount: i64,
    pub net_amount: i64,
    pub charge_date: String,
    pub subscription_id: Option<String>,
    pub paid_amount: i64,
    pub status: PaidStatus,
    pub created_by_name: Option<String>,
    pub voided_at: Option<String>,
    pub void_reason: Option<String>,
}

/// Payments are applied to the oldest charges first. Returns covered amount per charge id.
pub(crate) fn fifo_coverage(conn: &Connection, member_id: &str) -> CoreResult<HashMap<String, i64>> {
    let mut paid: i64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM payments WHERE member_id = ?1 AND voided_at IS NULL",
        [member_id],
        |r| r.get(0),
    )?;
    let mut stmt = conn.prepare_cached(
        "SELECT id, net_amount FROM charges WHERE member_id = ?1 AND voided_at IS NULL ORDER BY charge_date, created_at, id",
    )?;
    let rows = stmt.query_map([member_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    let mut out = HashMap::new();
    for row in rows {
        let (id, net) = row?;
        let covered = net.min(paid).max(0);
        paid -= covered;
        out.insert(id, covered);
    }
    Ok(out)
}

pub fn list_charges(conn: &Connection, member_id: &str) -> CoreResult<Vec<ChargeRow>> {
    let coverage = fifo_coverage(conn, member_id)?;
    let mut stmt = conn.prepare_cached(
        "SELECT c.id, c.kind, c.description, c.amount, c.discount, c.net_amount, c.charge_date, c.subscription_id,
                u.name, c.voided_at, c.void_reason
         FROM charges c LEFT JOIN users u ON u.id = c.created_by
         WHERE c.member_id = ?1 ORDER BY c.charge_date DESC, c.created_at DESC",
    )?;
    let rows = stmt.query_map([member_id], |r| {
        let id: String = r.get(0)?;
        let net: i64 = r.get(5)?;
        let voided: Option<String> = r.get(9)?;
        let paid = coverage.get(&id).copied().unwrap_or(0);
        let status = if voided.is_some() {
            PaidStatus::Void
        } else if paid >= net {
            PaidStatus::Paid
        } else if paid > 0 {
            PaidStatus::Partial
        } else {
            PaidStatus::Unpaid
        };
        Ok(ChargeRow {
            id,
            kind: r.get(1)?,
            description: r.get(2)?,
            amount: r.get(3)?,
            discount: r.get(4)?,
            net_amount: net,
            charge_date: r.get(6)?,
            subscription_id: r.get(7)?,
            paid_amount: if voided.is_some() { 0 } else { paid },
            status,
            created_by_name: r.get(8)?,
            voided_at: voided,
            void_reason: r.get(10)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// A fee invoice (bill) for one member, built on demand from the ledger (not stored).
#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FeeInvoice {
    /// `INV-<member ID>-<yymmdd>`: the same member gets the same number on the same day.
    pub number: String,
    pub issued_on: String,
    pub member_id: String,
    pub member_code: String,
    pub member_name: String,
    pub father_name: Option<String>,
    pub phone: String,
    pub cnic: Option<String>,
    pub address: Option<String>,
    /// Current (or latest) membership.
    pub plan_name: Option<String>,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
    /// Every charge not fully paid, plus everything billed since the current membership started (oldest first).
    pub lines: Vec<ChargeRow>,
    pub total: i64,
    pub paid: i64,
    pub due: i64,
    /// Overall account balance (negative = advance / credit).
    pub balance: i64,
    /// Date of the oldest unpaid charge.
    pub due_since: Option<String>,
}

/// Member columns printed on an invoice: code, name, father, phone, CNIC, address, area.
type InvoiceMember = (String, String, Option<String>, String, Option<String>, Option<String>, Option<String>);

pub fn fee_invoice(conn: &Connection, clock: &Clock, member_id: &str) -> CoreResult<FeeInvoice> {
    let today = clock.today_str();
    let (member_code, member_name, father_name, phone, cnic, address, area): InvoiceMember = conn
        .query_row(
            "SELECT member_code, full_name, father_name, phone, cnic, address, area FROM members WHERE id = ?1 AND deleted_at IS NULL",
            [member_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )
        .optional()?
        .ok_or_else(|| CoreError::not_found("Member"))?;
    let current: Option<(String, String, String, String)> = conn
        .query_row(
            "SELECT id, plan_name, start_date, end_date FROM subscriptions
             WHERE member_id = ?1 AND cancelled_at IS NULL
             ORDER BY (start_date <= ?2 AND end_date >= ?2) DESC, end_date DESC LIMIT 1",
            (member_id, &today),
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let current_id = current.as_ref().map(|c| c.0.clone());
    let current_start = current.as_ref().map(|c| c.2.clone());
    // Anything still owed, plus everything billed for the current membership period (fee, admission, PT, …).
    let mut lines: Vec<ChargeRow> = list_charges(conn, member_id)?
        .into_iter()
        .filter(|c| {
            c.status != PaidStatus::Void
                && (c.paid_amount < c.net_amount
                    || (current_id.is_some() && c.subscription_id == current_id)
                    || current_start.as_ref().is_some_and(|start| c.charge_date >= *start))
        })
        .collect();
    lines.sort_by(|a, b| a.charge_date.cmp(&b.charge_date).then(a.description.cmp(&b.description)));
    let total = lines.iter().map(|c| c.net_amount).sum();
    let paid = lines.iter().map(|c| c.paid_amount).sum();
    let due_since = lines.iter().find(|c| c.paid_amount < c.net_amount).map(|c| c.charge_date.clone());
    let balance: i64 =
        conn.query_row("SELECT COALESCE(balance, 0) FROM member_stats WHERE member_id = ?1", [member_id], |r| r.get(0)).optional()?.unwrap_or(0);
    Ok(FeeInvoice {
        number: format!("INV-{member_code}-{}", clock.today().format("%y%m%d")),
        issued_on: today,
        member_id: member_id.to_string(),
        member_code,
        member_name,
        father_name,
        phone,
        cnic,
        address: [address, area].into_iter().flatten().filter(|s| !s.trim().is_empty()).reduce(|a, b| format!("{a}, {b}")),
        plan_name: current.as_ref().map(|c| c.1.clone()),
        period_start: current.as_ref().map(|c| c.2.clone()),
        period_end: current.map(|c| c.3),
        total,
        paid,
        due: total - paid,
        balance,
        due_since,
        lines,
    })
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LedgerEntry {
    pub id: String,
    /// `charge` or `payment`.
    pub entry_type: String,
    pub date: String,
    pub description: String,
    pub debit: i64,
    pub credit: i64,
    /// Running balance after this entry (voided entries do not change it).
    pub balance: i64,
    pub voided: bool,
    pub receipt_no: Option<String>,
    pub method: Option<String>,
}

/// Chronological statement of charges and payments with a running balance.
pub fn member_ledger(conn: &Connection, member_id: &str) -> CoreResult<Vec<LedgerEntry>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, 'charge', charge_date || ' 00:00:00' AS ts, created_at, description ||
                CASE WHEN discount > 0 THEN ' (discount ' || discount || ')' ELSE '' END,
                net_amount, 0, voided_at IS NOT NULL, NULL, NULL
         FROM charges WHERE member_id = ?1
         UNION ALL
         SELECT id, 'payment', paid_at, created_at, 'Payment received' || COALESCE(' — ' || note, ''),
                0, amount, voided_at IS NOT NULL, receipt_no, method
         FROM payments WHERE member_id = ?1
         ORDER BY 3, 4",
    )?;
    let rows = stmt.query_map([member_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(4)?,
            r.get::<_, i64>(5)?,
            r.get::<_, i64>(6)?,
            r.get::<_, bool>(7)?,
            r.get::<_, Option<String>>(8)?,
            r.get::<_, Option<String>>(9)?,
        ))
    })?;
    let mut balance = 0i64;
    let mut out = Vec::new();
    for row in rows {
        let (id, entry_type, date, description, debit, credit, voided, receipt_no, method) = row?;
        if !voided {
            balance += debit - credit;
        }
        out.push(LedgerEntry { id, entry_type, date, description, debit, credit, balance, voided, receipt_no, method });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------------------------
// Dues

#[derive(Deserialize, TS, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct DuesQuery {
    pub search: Option<String>,
    /// `amount` (default), `age` or `name`.
    pub sort: Option<String>,
    pub include_archived: Option<bool>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DueRow {
    pub member: MemberQuick,
    pub oldest_due_date: Option<String>,
    pub age_days: i64,
    pub last_payment_at: Option<String>,
}

#[derive(Serialize, TS, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DuesAging {
    pub d0_30: i64,
    pub d31_60: i64,
    pub d61_90: i64,
    pub d90_plus: i64,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DuesList {
    pub items: Vec<DueRow>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub total_amount: i64,
    pub aging: DuesAging,
}

pub fn dues(conn: &Connection, clock: &Clock, settings: &Settings, q: &DuesQuery) -> CoreResult<DuesList> {
    let today = clock.today();
    let today_s = crate::clock::fmt_date(today);
    let (page, size, offset) = paging(q.page, q.page_size, 50);

    let mut sql = format!(
        "SELECT {}, ms.last_payment_at, ms.total_paid FROM members m JOIN member_stats ms ON ms.member_id = m.id
         WHERE m.deleted_at IS NULL AND ms.balance > 0",
        quick_columns!()
    );
    if !q.include_archived.unwrap_or(false) {
        sql.push_str(" AND m.status = 'active'");
    }
    let like;
    let frag;
    let soon_date = settings.membership.soon_date(today);
    let mut params: Vec<(&str, &dyn rusqlite::ToSql)> = vec![(":today", &today_s), (":soon_date", &soon_date)];
    if let Some(term) = q.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        like = format!("%{}%", escape_like(term));
        sql.push_str(" AND (m.full_name LIKE :like ESCAPE '\\' OR m.member_code LIKE :like ESCAPE '\\'");
        params.push((":like", &like));
        if let Some(f) = phone_search_fragment(term) {
            frag = format!("%{f}%");
            sql.push_str(" OR m.phone LIKE :phone");
            params.push((":phone", &frag));
        }
        sql.push(')');
    }
    let mut stmt = conn.prepare_cached(&sql)?;
    let mut rows: Vec<(MemberQuick, Option<String>, i64)> = stmt
        .query_map(params.as_slice(), |r| Ok((MemberQuick::from_row(r)?, r.get("last_payment_at")?, r.get("total_paid")?)))?
        .collect::<Result<Vec<_>, _>>()?;

    // FIFO over each debtor's charges to find unpaid portions and their age.
    let mut charge_stmt = conn.prepare_cached(
        "SELECT charge_date, net_amount FROM charges WHERE member_id = ?1 AND voided_at IS NULL ORDER BY charge_date, created_at, id",
    )?;
    let mut aging = DuesAging::default();
    let mut enriched: Vec<DueRow> = Vec::with_capacity(rows.len());
    for (member, last_payment_at, total_paid) in rows.drain(..) {
        let mut remaining_paid = total_paid;
        let mut oldest: Option<String> = None;
        let charges = charge_stmt
            .query_map([&member.id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        for (date, net) in charges {
            let covered = net.min(remaining_paid).max(0);
            remaining_paid -= covered;
            let unpaid = net - covered;
            if unpaid > 0 {
                let age = parse_date(&date).map(|d| crate::clock::days_between(d, today)).unwrap_or(0);
                match age {
                    i64::MIN..=30 => aging.d0_30 += unpaid,
                    31..=60 => aging.d31_60 += unpaid,
                    61..=90 => aging.d61_90 += unpaid,
                    _ => aging.d90_plus += unpaid,
                }
                if oldest.is_none() {
                    oldest = Some(date);
                }
            }
        }
        let age_days = oldest.as_deref().and_then(parse_date).map(|d| crate::clock::days_between(d, today)).unwrap_or(0);
        enriched.push(DueRow { member, oldest_due_date: oldest, age_days, last_payment_at });
    }

    match q.sort.as_deref() {
        Some("age") => enriched.sort_by(|a, b| b.age_days.cmp(&a.age_days).then(b.member.balance.cmp(&a.member.balance))),
        Some("name") => enriched.sort_by_cached_key(|r| r.member.full_name.to_lowercase()),
        _ => enriched.sort_by_key(|r| std::cmp::Reverse(r.member.balance)),
    }
    let total = enriched.len() as i64;
    let total_amount = enriched.iter().map(|r| r.member.balance).sum();
    let items = enriched.into_iter().skip(offset as usize).take(size as usize).collect();
    Ok(DuesList { items, total, page, page_size: size, total_amount, aging })
}
