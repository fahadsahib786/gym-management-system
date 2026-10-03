//! Typed application settings stored as one JSON document per section.

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::audit;
use crate::auth::{Actor, Permission};
use crate::clock::Clock;
use crate::db;
use crate::error::{CoreError, CoreResult};

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct GymSettings {
    pub name: String,
    pub tagline: String,
    pub address: String,
    pub city: String,
    pub phone: String,
    pub whatsapp: String,
    pub email: String,
    /// PNG/JPEG data URL, max ~300 KB.
    pub logo: Option<String>,
}

impl Default for GymSettings {
    fn default() -> Self {
        GymSettings {
            name: "Danish Fitness".into(),
            tagline: "Fitness & Bodybuilding Club".into(),
            address: "Model Town B".into(),
            city: "Khanpur, District Rahim Yar Khan".into(),
            phone: String::new(),
            whatsapp: String::new(),
            email: String::new(),
            logo: None,
        }
    }
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct MembershipSettings {
    pub member_code_prefix: String,
    pub member_code_digits: i64,
    /// A membership with this many days left (or fewer) is "expiring".
    pub expiring_soon_days: i64,
    /// Renewals within this many days after expiry continue from the old end date.
    pub late_renewal_grace_days: i64,
    pub default_admission_fee: i64,
    /// Active members without a visit for this many days are flagged "inactive".
    pub inactive_days: i64,
    /// Record check-ins (attendance) at the desk. Off hides the check-in screens and attendance figures.
    pub track_attendance: bool,
    /// A second check-in within this many minutes is ignored.
    pub checkin_cooldown_minutes: i64,
    /// Refuse check-in for expired / no-plan members instead of only warning.
    pub block_expired_checkin: bool,
    pub timings: Vec<String>,
    pub sources: Vec<String>,
}

impl MembershipSettings {
    /// Last end date that still counts as "expiring soon" (today + window), for string comparison in SQL.
    pub fn soon_date(&self, today: chrono::NaiveDate) -> String {
        crate::clock::fmt_date(crate::clock::add_days(today, self.expiring_soon_days))
    }
}

impl Default for MembershipSettings {
    fn default() -> Self {
        MembershipSettings {
            member_code_prefix: "DF-".into(),
            member_code_digits: 4,
            expiring_soon_days: 7,
            late_renewal_grace_days: 10,
            default_admission_fee: 1000,
            inactive_days: 10,
            track_attendance: true,
            checkin_cooldown_minutes: 60,
            block_expired_checkin: false,
            timings: vec!["Morning".into(), "Evening".into(), "Ladies".into()],
            sources: vec![
                "Walk-in".into(),
                "Friend / Family".into(),
                "Facebook".into(),
                "Instagram".into(),
                "WhatsApp".into(),
                "Banner / Flex".into(),
                "Other".into(),
            ],
        }
    }
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[ts(export)]
pub enum ReceiptPaper {
    #[serde(rename = "80mm")]
    Thermal80,
    #[serde(rename = "58mm")]
    Thermal58,
    #[serde(rename = "a5")]
    A5,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct BillingSettings {
    pub currency: String,
    pub receipt_prefix: String,
    pub receipt_digits: i64,
    pub payment_methods: Vec<String>,
    pub receipt_footer: String,
    pub receipt_paper: ReceiptPaper,
    /// Open the print dialog automatically after saving a payment.
    pub auto_print: bool,
}

impl Default for BillingSettings {
    fn default() -> Self {
        BillingSettings {
            currency: "Rs".into(),
            receipt_prefix: "R-".into(),
            receipt_digits: 6,
            payment_methods: vec![
                "Cash".into(),
                "JazzCash".into(),
                "Easypaisa".into(),
                "Bank Transfer".into(),
                "Raast".into(),
                "Card".into(),
            ],
            receipt_footer: "Fee once paid is non-refundable. Thank you for training with us!".into(),
            receipt_paper: ReceiptPaper::Thermal80,
            auto_print: false,
        }
    }
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum WhatsappOpenWith {
    /// WhatsApp Desktop app (`whatsapp://send`).
    Desktop,
    /// WhatsApp Web in the browser.
    Web,
    /// `wa.me` universal link.
    Wame,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct MessageTemplates {
    pub welcome: String,
    pub receipt: String,
    pub renewal: String,
    pub expiry_reminder: String,
    pub expired_reminder: String,
    pub dues_reminder: String,
    pub birthday: String,
    pub inactive: String,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[ts(export)]
pub enum TemplateLanguage {
    #[serde(rename = "en")]
    English,
    #[serde(rename = "roman-ur")]
    RomanUrdu,
}

impl MessageTemplates {
    pub fn defaults(language: TemplateLanguage) -> MessageTemplates {
        match language {
            TemplateLanguage::English => MessageTemplates {
                welcome: "Assalam-o-Alaikum {name}! 👋\nWelcome to *{gym}*. Your membership is now active. 💪\n\n🆔 Member ID: *{code}*\n📦 Package: {plan}\n📅 Valid till: *{end_date}*\n💰 Paid: {paid}\n⚠️ Balance due: {due}\n\nStay consistent and enjoy your workouts! 🏋️\n{gym} · {gym_phone}".into(),
                receipt: "🧾 *Payment Receipt — {gym}*\n\nReceipt #: *{receipt_no}*\nMember: {name} ({code})\nAmount received: *{amount}*\nMethod: {method}\nDate: {date}\nMembership valid till: {end_date}\n⚠️ Balance due: {due}\n\nThank you! 🙏".into(),
                renewal: "✅ *Membership Renewed — {gym}*\n\n{name}, your {plan} membership has been renewed.\n📅 {start_date} to *{end_date}*\n💰 Paid: {paid}\n⚠️ Balance due: {due}\n\nKeep it up! 💪".into(),
                expiry_reminder: "🔔 *Reminder from {gym}*\n\nDear {name}, your membership expires in *{days_left} day(s)* on *{end_date}*.\nPlease renew at the front desk to keep training without a break. 💪\n\nThank you!".into(),
                expired_reminder: "⏰ *{gym}*\n\nDear {name}, your membership expired on *{end_date}*.\nWe miss you at the gym! Renew today and get back on track. 💪".into(),
                dues_reminder: "💳 *Fee Reminder — {gym}*\n\nDear {name}, an amount of *{due}* is pending on your account.\nKindly clear it at your earliest convenience. Thank you! 🙏".into(),
                birthday: "🎉 *Happy Birthday, {first_name}!* 🎂\n\nWishing you a healthy, strong and happy year ahead.\n— Team {gym}".into(),
                inactive: "👋 Hi {first_name}, we haven't seen you at *{gym}* for a while!\nYour membership is active till {end_date}. Come back and continue your progress. 💪".into(),
            },
            TemplateLanguage::RomanUrdu => MessageTemplates {
                welcome: "Assalam-o-Alaikum {name}! 👋\n*{gym}* mein khush aamdeed. Aap ki membership active ho gayi hai. 💪\n\n🆔 Member ID: *{code}*\n📦 Package: {plan}\n📅 Aakhri tareekh: *{end_date}*\n💰 Wusool shuda raqam: {paid}\n⚠️ Baqaya raqam: {due}\n\nRegular aayen aur workout enjoy karen! 🏋️\n{gym} · {gym_phone}".into(),
                receipt: "🧾 *Raseed — {gym}*\n\nRaseed #: *{receipt_no}*\nMember: {name} ({code})\nWusool shuda raqam: *{amount}*\nTareeqa: {method}\nTareekh: {date}\nMembership: {end_date} tak\n⚠️ Baqaya raqam: {due}\n\nShukriya! 🙏".into(),
                renewal: "✅ *Membership Renew — {gym}*\n\n{name}, aap ki {plan} membership renew ho gayi hai.\n📅 {start_date} se *{end_date}* tak\n💰 Wusool shuda: {paid}\n⚠️ Baqaya: {due}\n\nShabash, jaari rakhen! 💪".into(),
                expiry_reminder: "🔔 *{gym} — Yaad dihani*\n\nMohtaram {name}, aap ki membership *{days_left} din* baad (*{end_date}*) khatam ho rahi hai.\nBaraye meharbani front desk par fee jama karwa ke renew karwa len. 💪\n\nShukriya!".into(),
                expired_reminder: "⏰ *{gym}*\n\nMohtaram {name}, aap ki membership *{end_date}* ko khatam ho chuki hai.\nHum aap ko miss kar rahe hain! Aaj hi renew karwayen aur dobara workout shuru karen. 💪".into(),
                dues_reminder: "💳 *Fee Yaad Dihani — {gym}*\n\nMohtaram {name}, aap ke account mein *{due}* baqaya hain.\nBaraye meharbani jald az jald ada kar den. Shukriya! 🙏".into(),
                birthday: "🎉 *Saalgirah Mubarak, {first_name}!* 🎂\n\nAllah aap ko sehat, taaqat aur khushiyon bhara saal ata farmaye.\n— Team {gym}".into(),
                inactive: "👋 {first_name}, kaafi din se aap *{gym}* nahi aaye!\nAap ki membership {end_date} tak active hai. Wapas aayen aur apni progress jaari rakhen. 💪".into(),
            },
        }
    }
}

impl Default for MessageTemplates {
    fn default() -> Self {
        MessageTemplates::defaults(TemplateLanguage::English)
    }
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct WhatsappSettings {
    pub open_with: WhatsappOpenWith,
    pub templates: MessageTemplates,
}

impl Default for WhatsappSettings {
    fn default() -> Self {
        WhatsappSettings { open_with: WhatsappOpenWith::Desktop, templates: MessageTemplates::default() }
    }
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct BackupSettings {
    pub auto_backup: bool,
    /// Backup folder chosen at setup (a second drive such as D: when the PC has one); `None` = the default.
    pub folder: Option<String>,
    /// Optional second copy (USB drive, Google Drive folder, ...).
    pub mirror_folder: Option<String>,
    /// Automatic backups to keep (manual backups are never deleted automatically).
    pub keep_count: i64,
    pub interval_hours: i64,
}

impl Default for BackupSettings {
    fn default() -> Self {
        BackupSettings { auto_backup: true, folder: None, mirror_folder: None, keep_count: 30, interval_hours: 6 }
    }
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct SecuritySettings {
    pub require_login: bool,
    /// Lock the screen after this many idle minutes (0 = never).
    pub auto_lock_minutes: i64,
    pub staff_can_see_revenue: bool,
    pub staff_can_add_expenses: bool,
}

impl Default for SecuritySettings {
    fn default() -> Self {
        SecuritySettings {
            require_login: true,
            auto_lock_minutes: 0,
            staff_can_see_revenue: false,
            staff_can_add_expenses: false,
        }
    }
}

/// Internal state (not edited from the settings screen).
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct SystemState {
    pub setup_completed_at: Option<String>,
    pub last_backup_at: Option<String>,
    pub last_backup_path: Option<String>,
    /// App version that last opened this database (a change triggers a "before update" backup).
    pub last_app_version: Option<String>,
}

#[derive(Serialize, TS, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Settings {
    pub gym: GymSettings,
    pub membership: MembershipSettings,
    pub billing: BillingSettings,
    pub whatsapp: WhatsappSettings,
    pub backup: BackupSettings,
    pub security: SecuritySettings,
    pub system: SystemState,
}

#[derive(Deserialize, TS, Debug, Clone)]
#[serde(tag = "section", content = "value", rename_all = "camelCase")]
#[ts(export)]
pub enum SettingsUpdate {
    Gym(GymSettings),
    Membership(MembershipSettings),
    Billing(BillingSettings),
    Whatsapp(WhatsappSettings),
    Backup(BackupSettings),
    Security(SecuritySettings),
}

fn read_section<T: for<'de> Deserialize<'de> + Default>(conn: &Connection, key: &str) -> CoreResult<T> {
    let raw: Option<String> =
        conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?;
    Ok(match raw {
        Some(json) => serde_json::from_str(&json).unwrap_or_else(|e| {
            log::warn!("settings section '{key}' unreadable ({e}); using defaults");
            T::default()
        }),
        None => T::default(),
    })
}

pub(crate) fn write_section<T: Serialize>(conn: &Connection, clock: &Clock, key: &str, value: &T) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO settings(key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (key, serde_json::to_string(value)?, clock.now_str()),
    )?;
    Ok(())
}

pub fn load(conn: &Connection) -> CoreResult<Settings> {
    Ok(Settings {
        gym: read_section(conn, "gym")?,
        membership: read_section(conn, "membership")?,
        billing: read_section(conn, "billing")?,
        whatsapp: read_section(conn, "whatsapp")?,
        backup: read_section(conn, "backup")?,
        security: read_section(conn, "security")?,
        system: read_section(conn, "system")?,
    })
}

pub fn is_setup_complete(conn: &Connection) -> CoreResult<bool> {
    let state: SystemState = read_section(conn, "system")?;
    Ok(state.setup_completed_at.is_some())
}

pub fn update_system<F: FnOnce(&mut SystemState)>(conn: &Connection, clock: &Clock, f: F) -> CoreResult<()> {
    let mut state: SystemState = read_section(conn, "system")?;
    f(&mut state);
    write_section(conn, clock, "system", &state)
}

fn clean_list(items: &[String], what: &str, max: usize) -> CoreResult<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    for item in items {
        let t = item.trim();
        if t.is_empty() {
            continue;
        }
        if t.chars().count() > 40 {
            return Err(CoreError::invalid(format!("'{t}' is too long for {what} (max 40 characters)")));
        }
        if !out.iter().any(|o| o.eq_ignore_ascii_case(t)) {
            out.push(t.to_string());
        }
    }
    if out.len() > max {
        return Err(CoreError::invalid(format!("Too many {what} (max {max})")));
    }
    Ok(out)
}

fn validate(update: SettingsUpdate) -> CoreResult<SettingsUpdate> {
    Ok(match update {
        SettingsUpdate::Gym(mut g) => {
            g.name = g.name.trim().to_string();
            if g.name.is_empty() {
                return Err(CoreError::validation("name", "Gym name is required"));
            }
            if let Some(logo) = &g.logo {
                if !logo.starts_with("data:image/") {
                    return Err(CoreError::validation("logo", "Logo must be an image"));
                }
                if logo.len() > 400_000 {
                    return Err(CoreError::validation("logo", "Logo is too large (max 300 KB)"));
                }
            }
            SettingsUpdate::Gym(g)
        }
        SettingsUpdate::Membership(mut m) => {
            m.member_code_prefix = m.member_code_prefix.trim().to_uppercase();
            if m.member_code_prefix.chars().count() > 8 {
                return Err(CoreError::validation("memberCodePrefix", "Prefix can have at most 8 characters"));
            }
            m.member_code_digits = m.member_code_digits.clamp(1, 8);
            m.expiring_soon_days = m.expiring_soon_days.clamp(1, 60);
            m.late_renewal_grace_days = m.late_renewal_grace_days.clamp(0, 90);
            m.inactive_days = m.inactive_days.clamp(3, 120);
            m.checkin_cooldown_minutes = m.checkin_cooldown_minutes.clamp(0, 720);
            if m.default_admission_fee < 0 {
                return Err(CoreError::validation("defaultAdmissionFee", "Admission fee cannot be negative"));
            }
            m.timings = clean_list(&m.timings, "timings", 12)?;
            m.sources = clean_list(&m.sources, "sources", 20)?;
            SettingsUpdate::Membership(m)
        }
        SettingsUpdate::Billing(mut b) => {
            b.currency = b.currency.trim().to_string();
            if b.currency.is_empty() {
                b.currency = "Rs".into();
            }
            b.receipt_prefix = b.receipt_prefix.trim().to_uppercase();
            b.receipt_digits = b.receipt_digits.clamp(3, 10);
            b.payment_methods = clean_list(&b.payment_methods, "payment methods", 15)?;
            if b.payment_methods.is_empty() {
                return Err(CoreError::validation("paymentMethods", "Keep at least one payment method"));
            }
            SettingsUpdate::Billing(b)
        }
        SettingsUpdate::Whatsapp(w) => {
            let t = &w.templates;
            for (name, body) in [
                ("welcome", &t.welcome),
                ("receipt", &t.receipt),
                ("renewal", &t.renewal),
                ("expiryReminder", &t.expiry_reminder),
                ("expiredReminder", &t.expired_reminder),
                ("duesReminder", &t.dues_reminder),
                ("birthday", &t.birthday),
                ("inactive", &t.inactive),
            ] {
                if body.trim().is_empty() {
                    return Err(CoreError::validation(name, "Message template cannot be empty"));
                }
                if body.chars().count() > 2000 {
                    return Err(CoreError::validation(name, "Message template is too long (max 2000 characters)"));
                }
            }
            SettingsUpdate::Whatsapp(w)
        }
        SettingsUpdate::Backup(mut b) => {
            b.keep_count = b.keep_count.clamp(3, 365);
            b.interval_hours = b.interval_hours.clamp(1, 24);
            b.folder = crate::util::opt_text(b.folder);
            b.mirror_folder = crate::util::opt_text(b.mirror_folder);
            SettingsUpdate::Backup(b)
        }
        SettingsUpdate::Security(mut s) => {
            s.auto_lock_minutes = s.auto_lock_minutes.clamp(0, 240);
            SettingsUpdate::Security(s)
        }
    })
}

/// Saves one settings section (admin only) and returns the full, updated settings.
pub fn update(conn: &mut Connection, actor: &Actor, clock: &Clock, update: SettingsUpdate) -> CoreResult<Settings> {
    actor.require(Permission::ManageSettings)?;
    let update = validate(update)?;
    let tx = db::write_tx(conn)?;
    let section = match &update {
        SettingsUpdate::Gym(v) => {
            write_section(&tx, clock, "gym", v)?;
            "gym"
        }
        SettingsUpdate::Membership(v) => {
            write_section(&tx, clock, "membership", v)?;
            "membership"
        }
        SettingsUpdate::Billing(v) => {
            write_section(&tx, clock, "billing", v)?;
            "billing"
        }
        SettingsUpdate::Whatsapp(v) => {
            write_section(&tx, clock, "whatsapp", v)?;
            "whatsapp"
        }
        SettingsUpdate::Backup(v) => {
            write_section(&tx, clock, "backup", v)?;
            "backup"
        }
        SettingsUpdate::Security(v) => {
            write_section(&tx, clock, "security", v)?;
            "security"
        }
    };
    audit::record(&tx, actor, clock, "settings.update", Some("settings"), Some(section), format!("Updated {section} settings"), None)?;
    tx.commit()?;
    load(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::Actor;

    #[test]
    fn defaults_load_and_update_roundtrip() {
        let mut conn = db::open_memory().unwrap();
        let clock = Clock::fixed("2026-10-02", "10:00:00");
        let s = load(&conn).unwrap();
        assert_eq!(s.gym.name, "Danish Fitness");
        assert_eq!(s.membership.member_code_prefix, "DF-");
        assert!(s.billing.payment_methods.contains(&"JazzCash".to_string()));

        let mut gym = s.gym.clone();
        gym.phone = "0300-1234567".into();
        let updated = update(&mut conn, &Actor::system(), &clock, SettingsUpdate::Gym(gym)).unwrap();
        assert_eq!(updated.gym.phone, "0300-1234567");

        let mut billing = updated.billing.clone();
        billing.payment_methods = vec!["  ".into()];
        assert!(update(&mut conn, &Actor::system(), &clock, SettingsUpdate::Billing(billing)).is_err());
    }

    #[test]
    fn roman_urdu_templates_exist() {
        let t = MessageTemplates::defaults(TemplateLanguage::RomanUrdu);
        assert!(t.welcome.contains("khush aamdeed"));
        assert!(t.dues_reminder.contains("{due}"));
    }
}
