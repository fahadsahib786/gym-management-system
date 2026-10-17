//! Getting back in when the owner forgets their PIN.
//!
//! * **Recovery key** — a one-time key the owner keeps on paper. On the login screen it sets a new PIN for an
//!   admin account; it is then used up and a fresh key is issued. Only its Argon2 hash is stored.
//! * **Support unlock** — for a lost key (or none). The login screen shows a short *support code*; the software
//!   provider turns it into an *unlock code* with a secret only they hold (HMAC-SHA256, see
//!   [`support_unlock_code`]; the shell receives the secret at build time). The code works once, and a fresh
//!   recovery key is issued.

use chrono::Duration;
use hmac::{Hmac, KeyInit, Mac};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use ts_rs::TS;

use crate::audit;
use crate::auth::{self, Actor, Permission, Role};
use crate::clock::{fmt_ts, parse_ts, Clock};
use crate::db;
use crate::error::{CoreError, CoreResult};
use crate::settings;

/// 31 symbols without look-alikes (no 0/O, 1/I/L): 20 of them carry ~99 bits.
const KEY_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const KEY_LEN: usize = 20;
const MAX_FAILED: i64 = 5;
const LOCK_MINUTES: i64 = 10;
const SETTINGS_KEY: &str = "recovery";
/// Support and unlock codes: 10 symbols (~49 bits), short enough to read out on the phone.
const SUPPORT_LEN: usize = 10;
const SUPPORT_SETTINGS_KEY: &str = "support_unlock";
/// The same support code is shown for a day, so the owner can call back.
const SUPPORT_VALID_HOURS: i64 = 24;
/// Domain separation: the provider's secret signs nothing else with this prefix.
const SUPPORT_CONTEXT: &str = "danish-fitness:pin-reset:v1:";

/// Wrong attempts and the lock they lead to, shared by the recovery key and the support code.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Throttle {
    failed_attempts: i64,
    locked_until: Option<String>,
}

impl Throttle {
    fn check(&self, clock: &Clock, what: &str) -> CoreResult<()> {
        if let Some(until) = self.locked_until.as_deref().and_then(parse_ts)
            && until > clock.now()
        {
            let minutes = ((until - clock.now()).num_seconds() + 59) / 60;
            return Err(CoreError::conflict(format!("Too many wrong {what}s. Try again in {minutes} minute(s).")));
        }
        Ok(())
    }

    /// Counts a wrong attempt; true when it locks recovery.
    fn fail(&mut self, clock: &Clock) -> bool {
        self.failed_attempts += 1;
        let locked = self.failed_attempts >= MAX_FAILED;
        if locked {
            self.failed_attempts = 0;
            self.locked_until = Some(fmt_ts(clock.now() + Duration::minutes(LOCK_MINUTES)));
        }
        locked
    }
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Stored {
    hash: String,
    created_at: String,
    #[serde(flatten)]
    throttle: Throttle,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct SupportRequest {
    code: String,
    created_at: String,
    #[serde(flatten)]
    throttle: Throttle,
}

#[derive(Serialize, TS, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RecoveryStatus {
    pub exists: bool,
    pub created_at: Option<String>,
}

fn load_json<T: for<'de> Deserialize<'de>>(conn: &Connection, key: &str) -> CoreResult<Option<T>> {
    let json: Option<String> =
        conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?;
    Ok(json.and_then(|j| serde_json::from_str(&j).ok()))
}

fn load(conn: &Connection) -> CoreResult<Option<Stored>> {
    Ok(load_json::<Stored>(conn, SETTINGS_KEY)?.filter(|s| !s.hash.is_empty()))
}

fn save(conn: &Connection, clock: &Clock, stored: &Stored) -> CoreResult<()> {
    settings::write_section(conn, clock, SETTINGS_KEY, stored)
}

pub fn status(conn: &Connection) -> CoreResult<RecoveryStatus> {
    let stored = load(conn)?;
    Ok(RecoveryStatus { exists: stored.is_some(), created_at: stored.map(|s| s.created_at) })
}

fn generate(len: usize) -> CoreResult<String> {
    let mut code = String::with_capacity(len);
    let mut buf = [0u8; 64];
    // Rejection sampling keeps every symbol equally likely.
    let limit = (256 / KEY_ALPHABET.len() * KEY_ALPHABET.len()) as u8;
    while code.len() < len {
        getrandom::fill(&mut buf).map_err(|e| CoreError::other(format!("could not create a random code: {e}")))?;
        for b in buf.iter().copied().filter(|b| *b < limit) {
            if code.len() == len {
                break;
            }
            code.push(KEY_ALPHABET[b as usize % KEY_ALPHABET.len()] as char);
        }
    }
    Ok(code)
}

/// `ABCDE-FGHJK-MNPQR-STUVW`
pub fn format_key(raw: &str) -> String {
    raw.as_bytes().chunks(5).map(|c| String::from_utf8_lossy(c).into_owned()).collect::<Vec<_>>().join("-")
}

/// What the owner typed, without spaces or dashes and in capitals.
fn normalize(input: &str) -> String {
    input.chars().filter(char::is_ascii_alphanumeric).map(|c| c.to_ascii_uppercase()).collect()
}

/// Stores a fresh key (replacing any old one) and returns it formatted, to be shown once.
fn issue(conn: &Connection, clock: &Clock) -> CoreResult<String> {
    let raw = generate(KEY_LEN)?;
    save(conn, clock, &Stored { hash: auth::hash_pin(&raw)?, created_at: clock.now_str(), throttle: Throttle::default() })?;
    Ok(format_key(&raw))
}

/// Creates or replaces the recovery key (admin). The old key stops working.
pub fn create_key(conn: &mut Connection, actor: &Actor, clock: &Clock) -> CoreResult<String> {
    actor.require(Permission::ManageUsers)?;
    let tx = db::write_tx(conn)?;
    let replaced = load(&tx)?.is_some();
    let key = issue(&tx, clock)?;
    let summary = if replaced {
        "Replaced the owner recovery key (the old key no longer works)"
    } else {
        "Created the owner recovery key"
    };
    audit::record(&tx, actor, clock, "user.recovery_key", None, None, summary.to_string(), None)?;
    tx.commit()?;
    Ok(key)
}

/// The account whose PIN is being reset must be an active admin (staff PINs are reset by an admin).
fn admin_name(conn: &Connection, user_id: &str) -> CoreResult<String> {
    let row: Option<(String, Role, bool)> = conn
        .query_row("SELECT name, role, is_active FROM users WHERE id = ?1", [user_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?;
    match row {
        Some((name, Role::Admin, true)) => Ok(name),
        _ => Err(CoreError::validation("userId", "Choose the owner / admin account")),
    }
}

fn set_pin(conn: &Connection, clock: &Clock, user_id: &str, new_pin: &str) -> CoreResult<()> {
    conn.execute(
        "UPDATE users SET pin_hash = ?2, failed_attempts = 0, locked_until = NULL, updated_at = ?3 WHERE id = ?1",
        (user_id, auth::hash_pin(new_pin)?, clock.now_str()),
    )?;
    Ok(())
}

/// Records the lock (when the wrong attempt caused one) and builds the error to show.
fn wrong_attempt(conn: &Connection, clock: &Clock, locked: bool, what: &str, field: &str, hint: &str) -> CoreResult<CoreError> {
    if locked {
        let note = format!("Too many wrong {what}s; recovery locked for {LOCK_MINUTES} minutes");
        audit::record(conn, &Actor::system(), clock, "auth.recovery_lockout", None, None, note, None)?;
        return Ok(CoreError::conflict(format!("Too many wrong {what}s. Try again in {LOCK_MINUTES} minutes.")));
    }
    Ok(CoreError::validation(field, hint))
}

/// Login screen: sets a new PIN for an admin with the recovery key. The key is used up; the new key is returned.
pub fn reset_pin_with_key(conn: &mut Connection, clock: &Clock, user_id: &str, key: &str, new_pin: &str) -> CoreResult<String> {
    auth::validate_pin(new_pin)?;
    let tx = db::write_tx(conn)?;
    let mut stored = load(&tx)?.ok_or_else(|| CoreError::conflict("No recovery key has been created on this PC."))?;
    stored.throttle.check(clock, "recovery key")?;
    let name = admin_name(&tx, user_id)?;
    if !auth::verify_pin(&normalize(key), &stored.hash) {
        let locked = stored.throttle.fail(clock);
        save(&tx, clock, &stored)?;
        let err = wrong_attempt(&tx, clock, locked, "recovery key", "key", "That recovery key is not right. Check each letter and try again.")?;
        tx.commit()?;
        return Err(err);
    }
    set_pin(&tx, clock, user_id, new_pin)?;
    let new_key = issue(&tx, clock)?;
    audit::record(
        &tx,
        &Actor::system(),
        clock,
        "user.reset_pin",
        Some("user"),
        Some(user_id),
        format!("PIN of {name} reset with the recovery key (a new recovery key was issued)"),
        None,
    )?;
    tx.commit()?;
    Ok(new_key)
}

fn load_support(conn: &Connection, clock: &Clock) -> CoreResult<Option<SupportRequest>> {
    Ok(load_json::<SupportRequest>(conn, SUPPORT_SETTINGS_KEY)?.filter(|s| {
        !s.code.is_empty()
            && parse_ts(&s.created_at).is_some_and(|t| clock.now() - t < Duration::hours(SUPPORT_VALID_HOURS))
    }))
}

/// Login screen ("Lost the key?"): the support code the owner reads out to the software provider. The same code
/// is returned for a day, until it is used.
pub fn support_code(conn: &mut Connection, clock: &Clock) -> CoreResult<String> {
    let tx = db::write_tx(conn)?;
    let code = match load_support(&tx, clock)? {
        Some(request) => request.code,
        None => {
            let code = generate(SUPPORT_LEN)?;
            let request = SupportRequest { code: code.clone(), created_at: clock.now_str(), throttle: Throttle::default() };
            settings::write_section(&tx, clock, SUPPORT_SETTINGS_KEY, &request)?;
            code
        }
    };
    tx.commit()?;
    Ok(format_key(&code))
}

/// The unlock code for a support code — what the provider's tool (`npm run support:unlock`) prints. The first
/// 64 bits of HMAC-SHA256(secret, context ‖ code), written as 10 symbols of the key alphabet, least significant
/// first.
pub fn support_unlock_code(secret: &[u8], support_code: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).expect("HMAC accepts keys of any length");
    mac.update(SUPPORT_CONTEXT.as_bytes());
    mac.update(normalize(support_code).as_bytes());
    let digest = mac.finalize().into_bytes();
    let mut n = u64::from_be_bytes(digest[..8].try_into().expect("SHA-256 gives 32 bytes"));
    let base = KEY_ALPHABET.len() as u64;
    let mut code = String::with_capacity(SUPPORT_LEN);
    for _ in 0..SUPPORT_LEN {
        code.push(KEY_ALPHABET[(n % base) as usize] as char);
        n /= base;
    }
    format_key(&code)
}

/// Login screen: sets a new admin PIN with the unlock code the provider gave for the current support code. The
/// support code is used up and a fresh recovery key is issued (the old one is assumed lost) and returned.
pub fn reset_pin_with_support_code(
    conn: &mut Connection,
    clock: &Clock,
    secret: &[u8],
    user_id: &str,
    unlock_code: &str,
    new_pin: &str,
) -> CoreResult<String> {
    auth::validate_pin(new_pin)?;
    let tx = db::write_tx(conn)?;
    let mut request = load_support(&tx, clock)?.ok_or_else(|| {
        CoreError::conflict("This support code has expired. Close this window, open it again and read out the new code.")
    })?;
    request.throttle.check(clock, "unlock code")?;
    let name = admin_name(&tx, user_id)?;
    if normalize(unlock_code) != normalize(&support_unlock_code(secret, &request.code)) {
        let locked = request.throttle.fail(clock);
        settings::write_section(&tx, clock, SUPPORT_SETTINGS_KEY, &request)?;
        let err = wrong_attempt(&tx, clock, locked, "unlock code", "unlockCode", "That unlock code is not right. Check each letter and try again.")?;
        tx.commit()?;
        return Err(err);
    }
    set_pin(&tx, clock, user_id, new_pin)?;
    tx.execute("DELETE FROM settings WHERE key = ?1", [SUPPORT_SETTINGS_KEY])?;
    let new_key = issue(&tx, clock)?;
    audit::record(
        &tx,
        &Actor::system(),
        clock,
        "user.reset_pin",
        Some("user"),
        Some(user_id),
        format!("PIN of {name} reset with an unlock code from the software provider (a new recovery key was issued)"),
        None,
    )?;
    tx.commit()?;
    Ok(new_key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{login, NewUserInput};

    const SECRET: &[u8] = b"test-secret-0123456789abcdef0123";

    fn gym() -> (Connection, Actor) {
        let mut conn = db::open_memory().unwrap();
        let owner = crate::system::complete_setup(
            &mut conn,
            &Clock::fixed("2026-10-01", "09:00:00"),
            crate::system::SetupInput {
                gym: settings::GymSettings::default(),
                owner_name: "Danish".into(),
                owner_pin: "1234".into(),
                admission_fee: 0,
                plans: vec![],
                member_code_prefix: None,
                backup_folder: None,
            },
        )
        .unwrap();
        (conn, owner)
    }

    #[test]
    fn keys_are_long_readable_and_random() {
        let a = generate(KEY_LEN).unwrap();
        let b = generate(KEY_LEN).unwrap();
        assert_eq!(a.len(), KEY_LEN);
        assert_ne!(a, b);
        assert!(a.bytes().all(|c| KEY_ALPHABET.contains(&c)));
        assert_eq!(format_key("ABCDEFGHJKMNPQRSTUVW"), "ABCDE-FGHJK-MNPQR-STUVW");
        assert_eq!(normalize(" abcde-fghjk mnpqr-stuvw "), "ABCDEFGHJKMNPQRSTUVW");
    }

    #[test]
    fn a_recovery_key_resets_the_owner_pin_once() {
        let (mut conn, owner) = gym();
        let clock = Clock::fixed("2026-10-02", "10:00:00");
        assert!(!status(&conn).unwrap().exists);
        let key = create_key(&mut conn, &owner, &clock).unwrap();
        assert!(status(&conn).unwrap().exists);

        // Typed in lower case without dashes still works; the key is then used up and a new one issued.
        let typed = key.replace('-', "").to_lowercase();
        let new_key = reset_pin_with_key(&mut conn, &clock, &owner.user_id, &typed, "9876").unwrap();
        assert_ne!(new_key, key);
        assert!(login(&mut conn, &clock, &owner.user_id, "9876").is_ok());
        assert!(reset_pin_with_key(&mut conn, &clock, &owner.user_id, &key, "1111").is_err());
        assert!(reset_pin_with_key(&mut conn, &clock, &owner.user_id, &new_key, "1111").is_ok());
    }

    #[test]
    fn wrong_keys_lock_recovery_and_staff_cannot_use_it() {
        let (mut conn, owner) = gym();
        let clock = Clock::fixed("2026-10-02", "10:00:00");
        let key = create_key(&mut conn, &owner, &clock).unwrap();
        let staff = auth::create_user(&mut conn, &owner, &clock, NewUserInput { name: "Ali".into(), role: Role::Staff, pin: "2222".into() })
            .unwrap();
        assert!(reset_pin_with_key(&mut conn, &clock, &staff.id, &key, "3333").is_err());
        for _ in 0..MAX_FAILED {
            assert!(reset_pin_with_key(&mut conn, &clock, &owner.user_id, "WRONG-WRONG-WRONG-WRONG", "3333").is_err());
        }
        // Locked now, even with the right key …
        assert!(matches!(reset_pin_with_key(&mut conn, &clock, &owner.user_id, &key, "3333"), Err(CoreError::Conflict(_))));
        // … until the lock expires.
        let later = Clock::fixed("2026-10-02", "10:11:00");
        assert!(reset_pin_with_key(&mut conn, &later, &owner.user_id, &key, "3333").is_ok());
    }

    #[test]
    fn unlock_codes_match_the_providers_tool() {
        // Same vector as scripts/support-unlock.mjs, so the app and the tool can never drift apart.
        assert_eq!(support_unlock_code(SECRET, "ABCDE-FGHJK"), "CRNGX-VNHUU");
        assert_eq!(support_unlock_code(SECRET, "abcde fghjk"), support_unlock_code(SECRET, "ABCDEFGHJK"));
        assert_ne!(support_unlock_code(SECRET, "ABCDE-FGHJK"), support_unlock_code(b"another secret", "ABCDE-FGHJK"));
    }

    #[test]
    fn a_support_unlock_code_resets_the_pin_once_and_issues_a_new_key() {
        let (mut conn, owner) = gym();
        let clock = Clock::fixed("2026-10-02", "10:00:00");
        let lost_key = create_key(&mut conn, &owner, &clock).unwrap();

        // The code stays the same while the owner calls the provider back.
        let code = support_code(&mut conn, &clock).unwrap();
        assert_eq!(code.len(), SUPPORT_LEN + 1);
        assert_eq!(support_code(&mut conn, &Clock::fixed("2026-10-02", "18:00:00")).unwrap(), code);

        let unlock = support_unlock_code(SECRET, &code);
        let wrong_secret = support_unlock_code(b"guessed secret", &code);
        assert!(reset_pin_with_support_code(&mut conn, &clock, SECRET, &owner.user_id, &wrong_secret, "4444").is_err());
        let new_key = reset_pin_with_support_code(&mut conn, &clock, SECRET, &owner.user_id, &unlock.to_lowercase(), "4444").unwrap();
        assert!(login(&mut conn, &clock, &owner.user_id, "4444").is_ok());

        // Used up; the lost key stopped working and the new one works.
        assert!(reset_pin_with_support_code(&mut conn, &clock, SECRET, &owner.user_id, &unlock, "5555").is_err());
        assert!(reset_pin_with_key(&mut conn, &clock, &owner.user_id, &lost_key, "5555").is_err());
        assert!(reset_pin_with_key(&mut conn, &clock, &owner.user_id, &new_key, "5555").is_ok());
        assert!(audit_has(&conn, "unlock code from the software provider"));
    }

    #[test]
    fn support_codes_expire_and_lock_after_wrong_unlock_codes() {
        let (mut conn, owner) = gym();
        let clock = Clock::fixed("2026-10-02", "10:00:00");
        let code = support_code(&mut conn, &clock).unwrap();
        let unlock = support_unlock_code(SECRET, &code);
        for _ in 0..MAX_FAILED {
            assert!(reset_pin_with_support_code(&mut conn, &clock, SECRET, &owner.user_id, "AAAAA-AAAAA", "4444").is_err());
        }
        assert!(matches!(
            reset_pin_with_support_code(&mut conn, &clock, SECRET, &owner.user_id, &unlock, "4444"),
            Err(CoreError::Conflict(_))
        ));
        assert!(audit_has(&conn, "Too many wrong unlock codes"));

        // A day later the old code has expired and a new one is shown.
        let next_day = Clock::fixed("2026-10-03", "10:00:00");
        assert!(reset_pin_with_support_code(&mut conn, &next_day, SECRET, &owner.user_id, &unlock, "4444").is_err());
        let fresh = support_code(&mut conn, &next_day).unwrap();
        assert_ne!(fresh, code);
        let fresh_unlock = support_unlock_code(SECRET, &fresh);
        assert!(reset_pin_with_support_code(&mut conn, &next_day, SECRET, &owner.user_id, &fresh_unlock, "4444").is_ok());
    }

    fn audit_has(conn: &Connection, text: &str) -> bool {
        conn.query_row("SELECT COUNT(*) FROM audit_log WHERE summary LIKE ?1", [format!("%{text}%")], |r| r.get::<_, i64>(0))
            .unwrap()
            > 0
    }
}
