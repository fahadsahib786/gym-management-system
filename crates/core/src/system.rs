//! First-run setup, app status for the login screen, and the clock guard.

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::audit;
use crate::auth::{self, Actor, NewUserInput, UserSummary};
use crate::clock::{fmt_ts, human_date, parse_ts, Clock};
use crate::db;
use crate::error::{CoreError, CoreResult};
use crate::expenses;
use crate::model::{DurationUnit, Role};
use crate::plans::{self, PlanInput};
use crate::settings::{self, GymSettings};

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SetupPlan {
    pub name: String,
    pub duration_value: i64,
    pub duration_unit: DurationUnit,
    pub price: i64,
}

#[derive(Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct SetupInput {
    pub gym: GymSettings,
    pub owner_name: String,
    pub owner_pin: String,
    pub admission_fee: i64,
    pub plans: Vec<SetupPlan>,
    pub member_code_prefix: Option<String>,
    /// Where backups go (suggested: a second drive such as D:, so a Windows reinstall cannot wipe them).
    pub backup_folder: Option<String>,
}

/// Starter packages offered in the setup wizard (prices typical for South Punjab, editable).
pub fn suggested_plans() -> Vec<(&'static str, i64, DurationUnit, i64)> {
    vec![
        ("Monthly", 1, DurationUnit::Month, 3000),
        ("Quarterly (3 Months)", 3, DurationUnit::Month, 8000),
        ("Half Yearly (6 Months)", 6, DurationUnit::Month, 15000),
        ("Yearly", 12, DurationUnit::Month, 27000),
        ("Daily Pass", 1, DurationUnit::Day, 300),
    ]
}

/// Pre-filled values for the first-run wizard.
#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SetupDefaults {
    pub gym: GymSettings,
    pub admission_fee: i64,
    pub member_code_prefix: String,
    pub plans: Vec<SetupPlan>,
    /// Suggested backup folder (see [`SetupInput::backup_folder`]).
    pub backup_folder: String,
    /// True when the suggested folder is on a different drive from Windows.
    pub backup_on_other_drive: bool,
}

pub fn setup_defaults(backup_folder: &std::path::Path, backup_on_other_drive: bool) -> SetupDefaults {
    SetupDefaults {
        backup_folder: backup_folder.to_string_lossy().into_owned(),
        backup_on_other_drive,
        gym: GymSettings::default(),
        admission_fee: 1000,
        member_code_prefix: "DF-".into(),
        plans: suggested_plans()
            .into_iter()
            .map(|(name, duration_value, duration_unit, price)| SetupPlan { name: name.into(), duration_value, duration_unit, price })
            .collect(),
    }
}

/// Completes first-run setup and returns the owner, logged in.
pub fn complete_setup(conn: &mut Connection, clock: &Clock, input: SetupInput) -> CoreResult<Actor> {
    if settings::is_setup_complete(conn)? || auth::count_users(conn)? > 0 {
        return Err(CoreError::conflict("Setup has already been completed."));
    }
    if input.gym.name.trim().is_empty() {
        return Err(CoreError::validation("gym.name", "Enter the gym name"));
    }
    if !(0..=1_000_000).contains(&input.admission_fee) {
        return Err(CoreError::validation("admissionFee", "Enter a valid admission fee"));
    }
    let backup_folder = input.backup_folder.as_deref().map(str::trim).filter(|f| !f.is_empty()).map(str::to_string);
    if let Some(folder) = &backup_folder {
        if !std::path::Path::new(folder).is_absolute() {
            return Err(CoreError::validation("backupFolder", "Choose a full folder path, e.g. D:\\Danish Fitness\\Backups"));
        }
        std::fs::create_dir_all(folder)
            .map_err(|e| CoreError::validation("backupFolder", format!("Cannot use this backup folder ({e}). Choose another one.")))?;
    }
    let system = Actor::system();
    let tx = db::write_tx(conn)?;
    let owner_id = auth::insert_user(&tx, clock, &NewUserInput { name: input.owner_name.clone(), role: Role::Admin, pin: input.owner_pin.clone() })?;

    let mut gym = input.gym.clone();
    gym.name = gym.name.trim().to_string();
    settings::write_section(&tx, clock, "gym", &gym)?;
    let mut membership = settings::load(&tx)?.membership;
    membership.default_admission_fee = input.admission_fee;
    if let Some(prefix) = input.member_code_prefix.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        membership.member_code_prefix = prefix.to_uppercase().chars().take(8).collect();
    }
    settings::write_section(&tx, clock, "membership", &membership)?;
    if backup_folder.is_some() {
        let mut backup = settings::load(&tx)?.backup;
        backup.folder = backup_folder;
        settings::write_section(&tx, clock, "backup", &backup)?;
    }
    for (i, p) in input.plans.iter().enumerate() {
        plans::insert_plan(
            &tx,
            clock,
            &PlanInput {
                id: None,
                name: p.name.clone(),
                duration_value: p.duration_value,
                duration_unit: p.duration_unit,
                price: p.price,
                description: None,
                color: None,
                is_active: Some(true),
                sort_order: Some(i as i64 + 1),
            },
        )?;
    }
    expenses::insert_default_categories(&tx, clock)?;
    settings::update_system(&tx, clock, |s| s.setup_completed_at = Some(clock.now_str()))?;
    let owner = auth::refresh_actor(&tx, &owner_id)?;
    audit::record(&tx, &system, clock, "system.setup", None, None, format!("First-run setup completed for {} (owner: {})", gym.name, owner.name), None)?;
    tx.commit()?;
    Ok(owner)
}

/// No gym set up and no users yet (a new install, or a reinstall after the data was removed).
pub fn is_fresh(conn: &Connection) -> CoreResult<bool> {
    Ok(!settings::is_setup_complete(conn)? && auth::count_users(conn)? == 0)
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppStatus {
    pub setup_complete: bool,
    pub require_login: bool,
    pub auto_lock_minutes: i64,
    pub gym_name: String,
    pub gym_logo: Option<String>,
    pub users: Vec<UserSummary>,
    pub clock_warning: Option<String>,
    pub schema_version: i64,
    pub member_count: i64,
}

/// Detects a PC clock that runs behind the data (dead CMOS battery or tampering).
pub fn clock_warning(conn: &Connection, clock: &Clock) -> CoreResult<Option<String>> {
    let latest: Option<String> = conn
        .query_row(
            "SELECT MAX(t) FROM (SELECT MAX(at) AS t FROM audit_log UNION ALL SELECT MAX(paid_at) FROM payments
                                  UNION ALL SELECT MAX(checked_in_at) FROM attendance)",
            [],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    let Some(latest_ts) = latest.as_deref().and_then(parse_ts) else { return Ok(None) };
    let now = clock.now();
    if latest_ts > now + chrono::Duration::minutes(10) {
        return Ok(Some(format!(
            "The computer's date looks wrong. It shows {} {}, but data was already saved on {} {}. \
             Please correct the Windows date and time before continuing.",
            human_date(now.date()),
            now.format("%I:%M %p"),
            human_date(latest_ts.date()),
            latest_ts.format("%I:%M %p"),
        )));
    }
    Ok(None)
}

pub fn status(conn: &Connection, clock: &Clock) -> CoreResult<AppStatus> {
    let s = settings::load(conn)?;
    Ok(AppStatus {
        setup_complete: s.system.setup_completed_at.is_some(),
        require_login: s.security.require_login,
        auto_lock_minutes: s.security.auto_lock_minutes,
        gym_name: s.gym.name.clone(),
        gym_logo: s.gym.logo.clone(),
        users: auth::list_users(conn, false)?,
        clock_warning: clock_warning(conn, clock)?,
        schema_version: db::schema_version(conn)?,
        member_count: conn.query_row("SELECT COUNT(*) FROM members WHERE deleted_at IS NULL", [], |r| r.get(0))?,
    })
}

/// Timestamp helper for callers that need "now" in storage format.
pub fn now_stamp(clock: &Clock) -> String {
    fmt_ts(clock.now())
}
