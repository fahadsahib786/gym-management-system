//! Body measurements / progress tracking.

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::audit;
use crate::auth::{Actor, Permission};
use crate::clock::{fmt_date, human_date_str, parse_date, Clock};
use crate::db;
use crate::error::{CoreError, CoreResult};
use crate::util::{new_id, opt_text_max};

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Measurement {
    pub id: String,
    pub member_id: String,
    pub measured_on: String,
    pub weight_kg: Option<f64>,
    pub height_cm: Option<f64>,
    pub body_fat_pct: Option<f64>,
    pub chest_cm: Option<f64>,
    pub waist_cm: Option<f64>,
    pub hips_cm: Option<f64>,
    pub arm_cm: Option<f64>,
    pub thigh_cm: Option<f64>,
    pub bmi: Option<f64>,
    pub notes: Option<String>,
    pub created_by_name: Option<String>,
    pub created_at: String,
}

#[derive(Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct MeasurementInput {
    pub id: Option<String>,
    pub member_id: String,
    pub measured_on: Option<String>,
    pub weight_kg: Option<f64>,
    pub height_cm: Option<f64>,
    pub body_fat_pct: Option<f64>,
    pub chest_cm: Option<f64>,
    pub waist_cm: Option<f64>,
    pub hips_cm: Option<f64>,
    pub arm_cm: Option<f64>,
    pub thigh_cm: Option<f64>,
    pub notes: Option<String>,
}

/// BMI = kg / m², rounded to one decimal.
pub fn bmi(weight_kg: Option<f64>, height_cm: Option<f64>) -> Option<f64> {
    match (weight_kg, height_cm) {
        (Some(w), Some(h)) if w > 0.0 && h > 0.0 => {
            let m = h / 100.0;
            Some((w / (m * m) * 10.0).round() / 10.0)
        }
        _ => None,
    }
}

fn check_range(value: Option<f64>, field: &str, min: f64, max: f64) -> CoreResult<Option<f64>> {
    match value {
        Some(v) if !(min..=max).contains(&v) => Err(CoreError::validation(field, format!("Enter a value between {min} and {max}"))),
        Some(v) => Ok(Some((v * 10.0).round() / 10.0)),
        None => Ok(None),
    }
}

const SELECT: &str = "SELECT x.id, x.member_id, x.measured_on, x.weight_kg, x.height_cm, x.body_fat_pct, x.chest_cm, x.waist_cm,
        x.hips_cm, x.arm_cm, x.thigh_cm, x.notes, u.name, x.created_at
     FROM measurements x LEFT JOIN users u ON u.id = x.created_by";

fn row_to_measurement(r: &rusqlite::Row<'_>) -> rusqlite::Result<Measurement> {
    let weight: Option<f64> = r.get(3)?;
    let height: Option<f64> = r.get(4)?;
    Ok(Measurement {
        id: r.get(0)?,
        member_id: r.get(1)?,
        measured_on: r.get(2)?,
        weight_kg: weight,
        height_cm: height,
        body_fat_pct: r.get(5)?,
        chest_cm: r.get(6)?,
        waist_cm: r.get(7)?,
        hips_cm: r.get(8)?,
        arm_cm: r.get(9)?,
        thigh_cm: r.get(10)?,
        bmi: bmi(weight, height),
        notes: r.get(11)?,
        created_by_name: r.get(12)?,
        created_at: r.get(13)?,
    })
}

/// Oldest first, so charts can plot them directly.
pub fn list(conn: &Connection, member_id: &str) -> CoreResult<Vec<Measurement>> {
    let mut stmt = conn.prepare_cached(&format!(
        "{SELECT} WHERE x.member_id = ?1 AND x.deleted_at IS NULL ORDER BY x.measured_on, x.created_at"
    ))?;
    let rows = stmt.query_map([member_id], row_to_measurement)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn save(conn: &mut Connection, actor: &Actor, clock: &Clock, input: MeasurementInput) -> CoreResult<Measurement> {
    actor.require(Permission::ManageMeasurements)?;
    let today = clock.today();
    let date = match input.measured_on.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(s) => parse_date(s).ok_or_else(|| CoreError::validation("measuredOn", "Invalid date"))?,
        None => today,
    };
    if date > today {
        return Err(CoreError::validation("measuredOn", "Date cannot be in the future"));
    }
    let weight = check_range(input.weight_kg, "weightKg", 10.0, 300.0)?;
    let height = check_range(input.height_cm, "heightCm", 80.0, 250.0)?;
    let fat = check_range(input.body_fat_pct, "bodyFatPct", 2.0, 70.0)?;
    let chest = check_range(input.chest_cm, "chestCm", 30.0, 250.0)?;
    let waist = check_range(input.waist_cm, "waistCm", 30.0, 250.0)?;
    let hips = check_range(input.hips_cm, "hipsCm", 30.0, 250.0)?;
    let arm = check_range(input.arm_cm, "armCm", 10.0, 100.0)?;
    let thigh = check_range(input.thigh_cm, "thighCm", 20.0, 150.0)?;
    if [weight, height, fat, chest, waist, hips, arm, thigh].iter().all(Option::is_none) {
        return Err(CoreError::invalid("Enter at least one measurement"));
    }
    let notes = opt_text_max(input.notes.clone(), 300);
    let tx = db::write_tx(conn)?;
    let name: String = tx
        .query_row("SELECT full_name FROM members WHERE id = ?1 AND deleted_at IS NULL", [&input.member_id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| CoreError::not_found("Member"))?;
    let now = clock.now_str();
    let date_s = fmt_date(date);
    let id = match &input.id {
        Some(id) => {
            let n = tx.execute(
                "UPDATE measurements SET measured_on = ?2, weight_kg = ?3, height_cm = ?4, body_fat_pct = ?5, chest_cm = ?6,
                        waist_cm = ?7, hips_cm = ?8, arm_cm = ?9, thigh_cm = ?10, notes = ?11, updated_at = ?12
                 WHERE id = ?1 AND member_id = ?13 AND deleted_at IS NULL",
                rusqlite::params![id, date_s, weight, height, fat, chest, waist, hips, arm, thigh, notes, now, input.member_id],
            )?;
            if n == 0 {
                return Err(CoreError::not_found("Measurement"));
            }
            id.clone()
        }
        None => {
            let id = new_id();
            tx.execute(
                "INSERT INTO measurements(id, member_id, measured_on, weight_kg, height_cm, body_fat_pct, chest_cm, waist_cm, hips_cm,
                                          arm_cm, thigh_cm, notes, created_by, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)",
                rusqlite::params![id, input.member_id, date_s, weight, height, fat, chest, waist, hips, arm, thigh, notes, actor.db_user_id(), now],
            )?;
            id
        }
    };
    audit::record(
        &tx,
        actor,
        clock,
        "measurement.save",
        Some("measurement"),
        Some(&id),
        format!("Saved measurements of {name} for {}", human_date_str(&date_s)),
        Some(serde_json::json!({ "memberId": input.member_id })),
    )?;
    let m = tx.query_row(&format!("{SELECT} WHERE x.id = ?1"), [&id], row_to_measurement)?;
    tx.commit()?;
    Ok(m)
}

pub fn delete(conn: &mut Connection, actor: &Actor, clock: &Clock, id: &str) -> CoreResult<()> {
    actor.require(Permission::ManageMeasurements)?;
    let tx = db::write_tx(conn)?;
    let (member_id, date, name): (String, String, String) = tx
        .query_row(
            "SELECT x.member_id, x.measured_on, m.full_name FROM measurements x JOIN members m ON m.id = x.member_id
             WHERE x.id = ?1 AND x.deleted_at IS NULL",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .ok_or_else(|| CoreError::not_found("Measurement"))?;
    tx.execute("UPDATE measurements SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1", (id, clock.now_str()))?;
    audit::record(
        &tx,
        actor,
        clock,
        "measurement.delete",
        Some("measurement"),
        Some(id),
        format!("Deleted measurements of {name} for {}", human_date_str(&date)),
        Some(serde_json::json!({ "memberId": member_id })),
    )?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bmi_maths() {
        assert_eq!(bmi(Some(80.0), Some(180.0)), Some(24.7));
        assert_eq!(bmi(None, Some(180.0)), None);
    }
}
