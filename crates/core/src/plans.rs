//! Membership packages (plans).

use chrono::NaiveDate;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::audit;
use crate::auth::{Actor, Permission};
use crate::clock::{add_days, add_months, Clock};
use crate::db;
use crate::error::{CoreError, CoreResult};
use crate::model::DurationUnit;
use crate::settings;
use crate::util::{format_money, new_id, opt_text_max};

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Plan {
    pub id: String,
    pub name: String,
    pub duration_value: i64,
    pub duration_unit: DurationUnit,
    pub price: i64,
    pub description: Option<String>,
    pub color: Option<String>,
    pub is_active: bool,
    pub sort_order: i64,
    /// Members whose current/latest membership uses this plan and is still valid today.
    pub active_members: i64,
    pub created_at: String,
}

#[derive(Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct PlanInput {
    pub id: Option<String>,
    pub name: String,
    pub duration_value: i64,
    pub duration_unit: DurationUnit,
    pub price: i64,
    pub description: Option<String>,
    pub color: Option<String>,
    pub is_active: Option<bool>,
    pub sort_order: Option<i64>,
}

/// Last day (inclusive) of a membership starting on `start`.
pub fn period_end(start: NaiveDate, value: i64, unit: DurationUnit) -> NaiveDate {
    let value = value.max(1);
    match unit {
        DurationUnit::Day => add_days(start, value - 1),
        DurationUnit::Month => add_days(add_months(start, value as u32), -1),
    }
}

/// `1 Month`, `3 Months`, `15 Days`.
pub fn describe_duration(value: i64, unit: DurationUnit) -> String {
    match (unit, value) {
        (DurationUnit::Day, 1) => "1 Day".into(),
        (DurationUnit::Day, v) => format!("{v} Days"),
        (DurationUnit::Month, 1) => "1 Month".into(),
        (DurationUnit::Month, 12) => "1 Year".into(),
        (DurationUnit::Month, v) => format!("{v} Months"),
    }
}

const SELECT: &str = "SELECT p.id, p.name, p.duration_value, p.duration_unit, p.price, p.description, p.color, p.is_active,
        p.sort_order, p.created_at,
        (SELECT COUNT(*) FROM member_stats ms JOIN members m ON m.id = ms.member_id
          WHERE ms.plan_id = p.id AND ms.end_date >= ?1 AND m.status = 'active' AND m.deleted_at IS NULL) AS active_members
     FROM plans p";

fn row_to_plan(r: &rusqlite::Row<'_>) -> rusqlite::Result<Plan> {
    Ok(Plan {
        id: r.get(0)?,
        name: r.get(1)?,
        duration_value: r.get(2)?,
        duration_unit: r.get(3)?,
        price: r.get(4)?,
        description: r.get(5)?,
        color: r.get(6)?,
        is_active: r.get(7)?,
        sort_order: r.get(8)?,
        created_at: r.get(9)?,
        active_members: r.get(10)?,
    })
}

pub fn list(conn: &Connection, today: &str, include_inactive: bool) -> CoreResult<Vec<Plan>> {
    let sql = format!(
        "{SELECT} WHERE p.deleted_at IS NULL AND (?2 = 1 OR p.is_active = 1)
         ORDER BY p.is_active DESC, p.sort_order, p.duration_unit, p.duration_value, p.name"
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let rows = stmt.query_map((today, include_inactive as i64), row_to_plan)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, today: &str, id: &str) -> CoreResult<Plan> {
    let sql = format!("{SELECT} WHERE p.id = ?2 AND p.deleted_at IS NULL");
    conn.query_row(&sql, (today, id), row_to_plan).optional()?.ok_or_else(|| CoreError::not_found("Plan"))
}

pub(crate) fn insert_plan(conn: &Connection, clock: &Clock, input: &PlanInput) -> CoreResult<String> {
    let (name, description, color) = validate(conn, input)?;
    let id = new_id();
    let now = clock.now_str();
    let sort: i64 = match input.sort_order {
        Some(s) => s,
        None => conn.query_row("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM plans", [], |r| r.get(0))?,
    };
    conn.execute(
        "INSERT INTO plans(id, name, duration_value, duration_unit, price, description, color, is_active, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
        (&id, &name, input.duration_value, input.duration_unit, input.price, &description, &color, input.is_active.unwrap_or(true), sort, &now),
    )?;
    Ok(id)
}

fn validate(conn: &Connection, input: &PlanInput) -> CoreResult<(String, Option<String>, Option<String>)> {
    let name = input.name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() || name.chars().count() > 50 {
        return Err(CoreError::validation("name", "Plan name is required (max 50 characters)"));
    }
    let max = match input.duration_unit {
        DurationUnit::Day => 3650,
        DurationUnit::Month => 120,
    };
    if input.duration_value < 1 || input.duration_value > max {
        return Err(CoreError::validation("durationValue", format!("Duration must be between 1 and {max}")));
    }
    if input.price < 0 || input.price > 10_000_000 {
        return Err(CoreError::validation("price", "Enter a valid fee"));
    }
    let duplicate: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM plans WHERE name = ?1 COLLATE NOCASE AND deleted_at IS NULL AND id != COALESCE(?2, ''))",
        (&name, input.id.as_deref()),
        |r| r.get(0),
    )?;
    if duplicate {
        return Err(CoreError::validation("name", "A plan with this name already exists"));
    }
    let color = opt_text_max(input.color.clone(), 20);
    Ok((name, opt_text_max(input.description.clone(), 300), color))
}

/// Creates or updates a plan. Price changes never affect memberships already sold.
pub fn save(conn: &mut Connection, actor: &Actor, clock: &Clock, input: PlanInput) -> CoreResult<Plan> {
    actor.require(Permission::ManagePlans)?;
    let today = clock.today_str();
    let tx = db::write_tx(conn)?;
    let currency = settings::load(&tx)?.billing.currency;
    let id = match &input.id {
        None => {
            let id = insert_plan(&tx, clock, &input)?;
            audit::record(
                &tx,
                actor,
                clock,
                "plan.create",
                Some("plan"),
                Some(&id),
                format!(
                    "Created plan {} ({}, {})",
                    input.name.trim(),
                    describe_duration(input.duration_value, input.duration_unit),
                    format_money(&currency, input.price)
                ),
                None,
            )?;
            id
        }
        Some(id) => {
            let before = get(&tx, &today, id)?;
            let (name, description, color) = validate(&tx, &input)?;
            tx.execute(
                "UPDATE plans SET name = ?2, duration_value = ?3, duration_unit = ?4, price = ?5, description = ?6, color = ?7,
                        is_active = ?8, sort_order = ?9, updated_at = ?10 WHERE id = ?1",
                (
                    id,
                    &name,
                    input.duration_value,
                    input.duration_unit,
                    input.price,
                    &description,
                    &color,
                    input.is_active.unwrap_or(before.is_active),
                    input.sort_order.unwrap_or(before.sort_order),
                    clock.now_str(),
                ),
            )?;
            let mut changes = Vec::new();
            if before.price != input.price {
                changes.push(format!("fee {} → {}", format_money(&currency, before.price), format_money(&currency, input.price)));
            }
            if before.name != name {
                changes.push(format!("name '{}' → '{}'", before.name, name));
            }
            if before.is_active != input.is_active.unwrap_or(before.is_active) {
                changes.push(if before.is_active { "deactivated".into() } else { "activated".into() });
            }
            let summary = if changes.is_empty() { format!("Updated plan {name}") } else { format!("Updated plan {name}: {}", changes.join(", ")) };
            audit::record(&tx, actor, clock, "plan.update", Some("plan"), Some(id), summary, None)?;
            id.clone()
        }
    };
    let plan = get(&tx, &today, &id)?;
    tx.commit()?;
    Ok(plan)
}

/// Deletes an unused plan; plans with history can only be deactivated.
pub fn delete(conn: &mut Connection, actor: &Actor, clock: &Clock, id: &str) -> CoreResult<()> {
    actor.require(Permission::ManagePlans)?;
    let tx = db::write_tx(conn)?;
    let plan = get(&tx, &clock.today_str(), id)?;
    let used: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM subscriptions WHERE plan_id = ?1)", [id], |r| r.get(0))?;
    if used {
        return Err(CoreError::conflict("This plan has been used by members. Turn it off instead of deleting it."));
    }
    tx.execute("UPDATE plans SET deleted_at = ?2, is_active = 0, updated_at = ?2 WHERE id = ?1", (id, clock.now_str()))?;
    audit::record(&tx, actor, clock, "plan.delete", Some("plan"), Some(id), format!("Deleted plan {}", plan.name), None)?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::{fmt_date, parse_date};

    #[test]
    fn period_maths() {
        let d = parse_date("2026-10-02").unwrap();
        assert_eq!(fmt_date(period_end(d, 1, DurationUnit::Month)), "2026-11-01");
        assert_eq!(fmt_date(period_end(d, 3, DurationUnit::Month)), "2027-01-01");
        assert_eq!(fmt_date(period_end(d, 1, DurationUnit::Day)), "2026-10-02");
        assert_eq!(fmt_date(period_end(d, 15, DurationUnit::Day)), "2026-10-16");
        assert_eq!(fmt_date(period_end(parse_date("2027-01-31").unwrap(), 1, DurationUnit::Month)), "2027-02-27");
        assert_eq!(describe_duration(12, DurationUnit::Month), "1 Year");
    }

    #[test]
    fn create_update_delete() {
        let mut conn = db::open_memory().unwrap();
        let clock = Clock::fixed("2026-10-02", "10:00:00");
        let actor = Actor::system();
        let p = save(&mut conn, &actor, &clock, PlanInput {
            id: None, name: " Monthly ".into(), duration_value: 1, duration_unit: DurationUnit::Month, price: 3000,
            description: None, color: None, is_active: None, sort_order: None,
        }).unwrap();
        assert_eq!(p.name, "Monthly");
        assert!(save(&mut conn, &actor, &clock, PlanInput {
            id: None, name: "monthly".into(), duration_value: 1, duration_unit: DurationUnit::Month, price: 1,
            description: None, color: None, is_active: None, sort_order: None,
        }).is_err());
        let p2 = save(&mut conn, &actor, &clock, PlanInput {
            id: Some(p.id.clone()), name: "Monthly".into(), duration_value: 1, duration_unit: DurationUnit::Month, price: 3500,
            description: Some("Gym + cardio".into()), color: None, is_active: Some(true), sort_order: None,
        }).unwrap();
        assert_eq!(p2.price, 3500);
        delete(&mut conn, &actor, &clock, &p.id).unwrap();
        assert!(list(&conn, "2026-10-02", true).unwrap().is_empty());
    }
}
