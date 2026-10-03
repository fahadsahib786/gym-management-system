//! Staff accounts, PIN login and role-based permissions.

use argon2::password_hash::phc::PasswordHash;
use argon2::password_hash::{PasswordHasher, PasswordVerifier};
use argon2::Argon2;
use chrono::Duration;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::audit;
use crate::clock::{fmt_ts, parse_ts, Clock};
use crate::db;
use crate::error::{CoreError, CoreResult};
pub use crate::model::Role;
use crate::settings::{self, SecuritySettings};
use crate::util::{clean_name, new_id};

const MAX_FAILED_ATTEMPTS: i64 = 5;
const LOCKOUT_SECONDS: i64 = 30;
const SYSTEM_USER: &str = "system";

#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Permission {
    RegisterMembers,
    EditMembers,
    ArchiveMembers,
    DeleteMembers,
    RecordPayments,
    BackdatePayments,
    VoidPayments,
    AddCharges,
    VoidCharges,
    RenewMemberships,
    EditMemberships,
    CancelMemberships,
    ManageFreezes,
    CheckIn,
    DeleteAttendance,
    ManageMeasurements,
    SendMessages,
    ViewRevenue,
    ViewExpenses,
    ManageExpenses,
    ManagePlans,
    ViewReports,
    ExportData,
    ViewAudit,
    ManageUsers,
    ManageSettings,
    CreateBackup,
    RestoreBackup,
}

impl Permission {
    pub const ALL: [Permission; 28] = [
        Permission::RegisterMembers,
        Permission::EditMembers,
        Permission::ArchiveMembers,
        Permission::DeleteMembers,
        Permission::RecordPayments,
        Permission::BackdatePayments,
        Permission::VoidPayments,
        Permission::AddCharges,
        Permission::VoidCharges,
        Permission::RenewMemberships,
        Permission::EditMemberships,
        Permission::CancelMemberships,
        Permission::ManageFreezes,
        Permission::CheckIn,
        Permission::DeleteAttendance,
        Permission::ManageMeasurements,
        Permission::SendMessages,
        Permission::ViewRevenue,
        Permission::ViewExpenses,
        Permission::ManageExpenses,
        Permission::ManagePlans,
        Permission::ViewReports,
        Permission::ExportData,
        Permission::ViewAudit,
        Permission::ManageUsers,
        Permission::ManageSettings,
        Permission::CreateBackup,
        Permission::RestoreBackup,
    ];
}

/// Permissions granted to a role. Receptionists run the desk; admins/owners control money and setup.
pub fn permissions_for(role: Role, security: &SecuritySettings) -> Vec<Permission> {
    match role {
        Role::Admin => Permission::ALL.to_vec(),
        Role::Staff => {
            let mut p = vec![
                Permission::RegisterMembers,
                Permission::EditMembers,
                Permission::RecordPayments,
                Permission::AddCharges,
                Permission::RenewMemberships,
                Permission::ManageFreezes,
                Permission::CheckIn,
                Permission::ManageMeasurements,
                Permission::SendMessages,
                Permission::CreateBackup,
            ];
            if security.staff_can_see_revenue {
                p.extend([Permission::ViewRevenue, Permission::ViewReports]);
            }
            if security.staff_can_add_expenses {
                p.extend([Permission::ViewExpenses, Permission::ManageExpenses]);
            }
            p
        }
    }
}

/// The person performing an action.
#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Actor {
    pub user_id: String,
    pub name: String,
    pub role: Role,
    pub permissions: Vec<Permission>,
}

impl Actor {
    /// Internal actor for automatic tasks and first-run setup.
    pub fn system() -> Actor {
        Actor { user_id: SYSTEM_USER.into(), name: "System".into(), role: Role::Admin, permissions: Permission::ALL.to_vec() }
    }

    pub fn can(&self, p: Permission) -> bool {
        self.permissions.contains(&p)
    }

    pub fn require(&self, p: Permission) -> CoreResult<()> {
        if self.can(p) { Ok(()) } else { Err(CoreError::Forbidden) }
    }

    /// Value for `created_by`-style foreign keys (NULL for the system actor).
    pub fn db_user_id(&self) -> Option<&str> {
        if self.user_id == SYSTEM_USER { None } else { Some(self.user_id.as_str()) }
    }
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UserSummary {
    pub id: String,
    pub name: String,
    pub role: Role,
    pub is_active: bool,
    pub last_login_at: Option<String>,
    pub created_at: String,
}

#[derive(Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NewUserInput {
    pub name: String,
    pub role: Role,
    pub pin: String,
}

#[derive(Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateUserInput {
    pub id: String,
    pub name: String,
    pub role: Role,
    pub is_active: bool,
}

fn hash_pin(pin: &str) -> CoreResult<String> {
    Argon2::default()
        .hash_password(pin.as_bytes())
        .map(|h| h.to_string())
        .map_err(|e| CoreError::other(format!("could not secure PIN: {e}")))
}

fn verify_pin(pin: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default().verify_password(pin.as_bytes(), &parsed).is_ok(),
        Err(_) => false,
    }
}

fn validate_pin(pin: &str) -> CoreResult<()> {
    if pin.len() < 4 || pin.len() > 8 || !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err(CoreError::validation("pin", "PIN must be 4 to 8 digits"));
    }
    Ok(())
}

fn validate_name(conn: &Connection, name: &str, exclude_id: Option<&str>) -> CoreResult<String> {
    let name = clean_name(name);
    let len = name.chars().count();
    if !(2..=40).contains(&len) {
        return Err(CoreError::validation("name", "Name must be 2 to 40 characters"));
    }
    let taken: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM users WHERE name = ?1 COLLATE NOCASE AND id != COALESCE(?2, ''))",
        (&name, exclude_id),
        |r| r.get(0),
    )?;
    if taken {
        return Err(CoreError::validation("name", "Another user already has this name"));
    }
    Ok(name)
}

fn user_by_id(conn: &Connection, id: &str) -> CoreResult<UserSummary> {
    conn.query_row(
        "SELECT id, name, role, is_active, last_login_at, created_at FROM users WHERE id = ?1",
        [id],
        |r| {
            Ok(UserSummary {
                id: r.get(0)?,
                name: r.get(1)?,
                role: r.get(2)?,
                is_active: r.get(3)?,
                last_login_at: r.get(4)?,
                created_at: r.get(5)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| CoreError::not_found("User"))
}

pub fn count_users(conn: &Connection) -> CoreResult<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?)
}

pub fn list_users(conn: &Connection, include_inactive: bool) -> CoreResult<Vec<UserSummary>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, role, is_active, last_login_at, created_at FROM users
         WHERE (?1 = 1 OR is_active = 1)
         ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([include_inactive as i64], |r| {
        Ok(UserSummary {
            id: r.get(0)?,
            name: r.get(1)?,
            role: r.get(2)?,
            is_active: r.get(3)?,
            last_login_at: r.get(4)?,
            created_at: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Inserts a user inside an existing transaction (used by setup and `create_user`).
pub(crate) fn insert_user(conn: &Connection, clock: &Clock, input: &NewUserInput) -> CoreResult<String> {
    let name = validate_name(conn, &input.name, None)?;
    validate_pin(&input.pin)?;
    let id = new_id();
    let now = clock.now_str();
    conn.execute(
        "INSERT INTO users(id, name, role, pin_hash, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
        (&id, &name, input.role, hash_pin(&input.pin)?, &now),
    )?;
    Ok(id)
}

pub fn create_user(conn: &mut Connection, actor: &Actor, clock: &Clock, input: NewUserInput) -> CoreResult<UserSummary> {
    actor.require(Permission::ManageUsers)?;
    let tx = db::write_tx(conn)?;
    let id = insert_user(&tx, clock, &input)?;
    let user = user_by_id(&tx, &id)?;
    audit::record(&tx, actor, clock, "user.create", Some("user"), Some(&id), format!("Added user {} ({})", user.name, user.role.as_str()), None)?;
    tx.commit()?;
    Ok(user)
}

fn active_admin_count(conn: &Connection, excluding: &str) -> CoreResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = 1 AND id != ?1",
        [excluding],
        |r| r.get(0),
    )?)
}

pub fn update_user(conn: &mut Connection, actor: &Actor, clock: &Clock, input: UpdateUserInput) -> CoreResult<UserSummary> {
    actor.require(Permission::ManageUsers)?;
    let tx = db::write_tx(conn)?;
    let before = user_by_id(&tx, &input.id)?;
    let name = validate_name(&tx, &input.name, Some(&input.id))?;
    let loses_admin = before.role == Role::Admin && (input.role != Role::Admin || !input.is_active);
    if loses_admin && active_admin_count(&tx, &input.id)? == 0 {
        return Err(CoreError::conflict("Keep at least one active admin account."));
    }
    if input.id == actor.user_id && !input.is_active {
        return Err(CoreError::conflict("You cannot deactivate your own account."));
    }
    tx.execute(
        "UPDATE users SET name = ?2, role = ?3, is_active = ?4, updated_at = ?5 WHERE id = ?1",
        (&input.id, &name, input.role, input.is_active, clock.now_str()),
    )?;
    let after = user_by_id(&tx, &input.id)?;
    audit::record(
        &tx,
        actor,
        clock,
        "user.update",
        Some("user"),
        Some(&input.id),
        format!("Updated user {} (role {}, {})", after.name, after.role.as_str(), if after.is_active { "active" } else { "inactive" }),
        None,
    )?;
    tx.commit()?;
    Ok(after)
}

/// Admin sets a new PIN for any user.
pub fn reset_pin(conn: &mut Connection, actor: &Actor, clock: &Clock, user_id: &str, new_pin: &str) -> CoreResult<()> {
    actor.require(Permission::ManageUsers)?;
    validate_pin(new_pin)?;
    let tx = db::write_tx(conn)?;
    let user = user_by_id(&tx, user_id)?;
    tx.execute(
        "UPDATE users SET pin_hash = ?2, failed_attempts = 0, locked_until = NULL, updated_at = ?3 WHERE id = ?1",
        (user_id, hash_pin(new_pin)?, clock.now_str()),
    )?;
    audit::record(&tx, actor, clock, "user.reset_pin", Some("user"), Some(user_id), format!("Reset PIN for {}", user.name), None)?;
    tx.commit()?;
    Ok(())
}

/// A logged-in user changes their own PIN.
pub fn change_own_pin(conn: &mut Connection, actor: &Actor, clock: &Clock, current_pin: &str, new_pin: &str) -> CoreResult<()> {
    validate_pin(new_pin)?;
    let tx = db::write_tx(conn)?;
    let hash: String = tx
        .query_row("SELECT pin_hash FROM users WHERE id = ?1", [&actor.user_id], |r| r.get(0))
        .optional()?
        .ok_or(CoreError::Unauthenticated)?;
    if !verify_pin(current_pin, &hash) {
        return Err(CoreError::validation("currentPin", "Current PIN is wrong"));
    }
    tx.execute(
        "UPDATE users SET pin_hash = ?2, updated_at = ?3 WHERE id = ?1",
        (&actor.user_id, hash_pin(new_pin)?, clock.now_str()),
    )?;
    audit::record(&tx, actor, clock, "user.change_pin", Some("user"), Some(&actor.user_id), format!("{} changed their PIN", actor.name), None)?;
    tx.commit()?;
    Ok(())
}

/// Verifies a PIN and returns the actor with permissions resolved from the current settings.
pub fn login(conn: &mut Connection, clock: &Clock, user_id: &str, pin: &str) -> CoreResult<Actor> {
    let tx = db::write_tx(conn)?;
    let row: Option<(String, Role, String, bool, i64, Option<String>)> = tx
        .query_row(
            "SELECT name, role, pin_hash, is_active, failed_attempts, locked_until FROM users WHERE id = ?1",
            [user_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .optional()?;
    let Some((name, role, hash, active, failed, locked_until)) = row else {
        return Err(CoreError::not_found("User"));
    };
    if !active {
        return Err(CoreError::conflict("This account is turned off. Ask the admin."));
    }
    let now = clock.now();
    if let Some(until) = locked_until.as_deref().and_then(parse_ts) {
        if until > now {
            let secs = (until - now).num_seconds().max(1);
            return Err(CoreError::conflict(format!("Too many wrong PINs. Try again in {secs} seconds.")));
        }
    }
    if !verify_pin(pin, &hash) {
        let failed = failed + 1;
        if failed >= MAX_FAILED_ATTEMPTS {
            let until = fmt_ts(now + Duration::seconds(LOCKOUT_SECONDS));
            tx.execute(
                "UPDATE users SET failed_attempts = 0, locked_until = ?2 WHERE id = ?1",
                (user_id, &until),
            )?;
            let actor = Actor { user_id: user_id.into(), name: name.clone(), role, permissions: vec![] };
            audit::record(&tx, &actor, clock, "auth.lockout", Some("user"), Some(user_id), format!("{name}: too many wrong PINs, locked for {LOCKOUT_SECONDS}s"), None)?;
            tx.commit()?;
            return Err(CoreError::conflict(format!("Too many wrong PINs. Try again in {LOCKOUT_SECONDS} seconds.")));
        }
        tx.execute("UPDATE users SET failed_attempts = ?2 WHERE id = ?1", (user_id, failed))?;
        tx.commit()?;
        let left = MAX_FAILED_ATTEMPTS - failed;
        return Err(CoreError::validation("pin", format!("Wrong PIN. {left} tries left.")));
    }
    tx.execute(
        "UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?2 WHERE id = ?1",
        (user_id, clock.now_str()),
    )?;
    let security = settings::load(&tx)?.security;
    let actor = Actor { user_id: user_id.into(), name: name.clone(), role, permissions: permissions_for(role, &security) };
    audit::record(&tx, &actor, clock, "auth.login", Some("user"), Some(user_id), format!("{name} logged in"), None)?;
    tx.commit()?;
    Ok(actor)
}

/// Re-resolves permissions for an existing session (after settings or role changes).
pub fn refresh_actor(conn: &Connection, user_id: &str) -> CoreResult<Actor> {
    let (name, role, active): (String, Role, bool) = conn
        .query_row("SELECT name, role, is_active FROM users WHERE id = ?1", [user_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?
        .ok_or(CoreError::Unauthenticated)?;
    if !active {
        return Err(CoreError::Unauthenticated);
    }
    let security = settings::load(conn)?.security;
    Ok(Actor { user_id: user_id.into(), name, role, permissions: permissions_for(role, &security) })
}

/// Actor used when "require login" is off: the first active admin acts for the desk.
pub fn default_actor(conn: &Connection) -> CoreResult<Option<Actor>> {
    let id: Option<String> = conn
        .query_row(
            "SELECT id FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY created_at LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?;
    match id {
        Some(id) => Ok(Some(refresh_actor(conn, &id)?)),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (Connection, Clock, String) {
        let conn = db::open_memory().unwrap();
        let clock = Clock::fixed("2026-10-02", "09:00:00");
        let id = insert_user(&conn, &clock, &NewUserInput { name: "owner".into(), role: Role::Admin, pin: "1234".into() }).unwrap();
        (conn, clock, id)
    }

    #[test]
    fn login_success_and_failures() {
        let (mut conn, clock, id) = setup();
        let actor = login(&mut conn, &clock, &id, "1234").unwrap();
        assert_eq!(actor.name, "Owner");
        assert!(actor.can(Permission::VoidPayments));

        for _ in 0..4 {
            assert!(matches!(login(&mut conn, &clock, &id, "0000"), Err(CoreError::Validation { .. })));
        }
        // 5th failure locks the account.
        assert!(matches!(login(&mut conn, &clock, &id, "0000"), Err(CoreError::Conflict(_))));
        // Even the right PIN is refused while locked.
        assert!(matches!(login(&mut conn, &clock, &id, "1234"), Err(CoreError::Conflict(_))));
        // After the lockout window it works again.
        let later = Clock::fixed("2026-10-02", "09:01:00");
        assert!(login(&mut conn, &later, &id, "1234").is_ok());
    }

    #[test]
    fn staff_permissions_follow_settings() {
        let mut sec = SecuritySettings::default();
        let staff = permissions_for(Role::Staff, &sec);
        assert!(staff.contains(&Permission::RecordPayments));
        assert!(!staff.contains(&Permission::VoidPayments));
        assert!(!staff.contains(&Permission::ViewRevenue));
        sec.staff_can_see_revenue = true;
        assert!(permissions_for(Role::Staff, &sec).contains(&Permission::ViewRevenue));
    }

    #[test]
    fn last_admin_is_protected() {
        let (mut conn, clock, id) = setup();
        let actor = login(&mut conn, &clock, &id, "1234").unwrap();
        let other = create_user(&mut conn, &actor, &clock, NewUserInput { name: "Ali".into(), role: Role::Staff, pin: "5555".into() }).unwrap();
        let err = update_user(&mut conn, &actor, &clock, UpdateUserInput { id: id.clone(), name: "Owner".into(), role: Role::Staff, is_active: true });
        assert!(matches!(err, Err(CoreError::Conflict(_))));
        assert!(update_user(&mut conn, &actor, &clock, UpdateUserInput { id: other.id, name: "Ali Raza".into(), role: Role::Staff, is_active: false }).is_ok());
        assert!(create_user(&mut conn, &actor, &clock, NewUserInput { name: "ali raza".into(), role: Role::Staff, pin: "12".into() }).is_err());
    }
}
