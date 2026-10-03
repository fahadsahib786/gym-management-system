//! Members: registration, profile, search, status filters, photos, archive/restore.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use chrono::{Datelike, NaiveDate};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::audit;
use crate::auth::{Actor, Permission};
use crate::billing::{self, NewPayment, PaymentEntry, PaymentResult, ReceiptItem};
use crate::clock::{add_days, fmt_date, human_date, parse_date, Clock};
use crate::db::{self, Params};
use crate::error::{CoreError, CoreResult, FieldResult};
use crate::memberships::{self, NewMembershipInput};
use crate::model::{paging, quick_columns, status_sql, ChargeKind, Gender, MemberQuick, MemberStatus, Page, SubscriptionKind};
use crate::settings::{self, Settings};
use crate::summary;
use crate::util::{
    clean_name, escape_like, format_money, new_id, normalize_cnic, normalize_phone, opt_text, opt_text_max, phone_search_fragment,
};

const BLOOD_GROUPS: [&str; 8] = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const MAX_PHOTO_BYTES: usize = 700 * 1024;
const MAX_THUMB_BYTES: usize = 80 * 1024;

/// Member details entered on the registration / edit form.
#[derive(Deserialize, TS, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct MemberInput {
    /// Leave empty to generate the next code (e.g. DF-0012). Existing register numbers can be typed in.
    pub member_code: Option<String>,
    pub full_name: String,
    pub father_name: Option<String>,
    pub gender: Gender,
    pub date_of_birth: Option<String>,
    pub phone: String,
    pub whatsapp: Option<String>,
    pub cnic: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub area: Option<String>,
    pub occupation: Option<String>,
    pub blood_group: Option<String>,
    pub emergency_name: Option<String>,
    pub emergency_phone: Option<String>,
    pub medical_notes: Option<String>,
    pub notes: Option<String>,
    pub timing: Option<String>,
    pub source: Option<String>,
    pub join_date: Option<String>,
}

struct Normalized {
    member_code: Option<String>,
    full_name: String,
    father_name: Option<String>,
    gender: Gender,
    date_of_birth: Option<String>,
    phone: String,
    whatsapp: Option<String>,
    cnic: Option<String>,
    email: Option<String>,
    address: Option<String>,
    area: Option<String>,
    occupation: Option<String>,
    blood_group: Option<String>,
    emergency_name: Option<String>,
    emergency_phone: Option<String>,
    medical_notes: Option<String>,
    notes: Option<String>,
    timing: Option<String>,
    source: Option<String>,
    join_date: String,
}

fn lenient_phone(value: Option<String>, field: &str) -> CoreResult<Option<String>> {
    let Some(v) = opt_text(value) else { return Ok(None) };
    match normalize_phone(&v) {
        Ok(p) => Ok(Some(p)),
        Err(_) => {
            let digits: String = v.chars().filter(|c| c.is_ascii_digit()).collect();
            if (7..=15).contains(&digits.len()) {
                Ok(Some(digits))
            } else {
                Err(CoreError::validation(field, "Enter a valid phone number"))
            }
        }
    }
}

fn normalize(input: &MemberInput, today: NaiveDate) -> CoreResult<Normalized> {
    let full_name = clean_name(&input.full_name);
    if full_name.chars().count() < 2 || full_name.chars().count() > 80 {
        return Err(CoreError::validation("fullName", "Enter the member's full name"));
    }
    let member_code = match opt_text(input.member_code.clone()) {
        Some(code) => {
            let code = code.to_uppercase();
            if code.chars().count() > 20 || !code.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '/')) {
                return Err(CoreError::validation("memberCode", "Member ID can use letters, numbers and - / _ (max 20)"));
            }
            Some(code)
        }
        None => None,
    };
    let date_of_birth = match opt_text(input.date_of_birth.clone()) {
        Some(d) => {
            let dob = parse_date(&d).ok_or_else(|| CoreError::validation("dateOfBirth", "Invalid date of birth"))?;
            let age = today.year() - dob.year();
            if dob > today || !(3..=100).contains(&age) {
                return Err(CoreError::validation("dateOfBirth", "Please check the date of birth"));
            }
            Some(fmt_date(dob))
        }
        None => None,
    };
    let phone = normalize_phone(&input.phone).field("phone")?;
    let whatsapp = match opt_text(input.whatsapp.clone()) {
        Some(w) => {
            let w = normalize_phone(&w).field("whatsapp")?;
            if w == phone { None } else { Some(w) }
        }
        None => None,
    };
    let cnic = normalize_cnic(input.cnic.as_deref()).field("cnic")?;
    let email = match opt_text(input.email.clone()) {
        Some(e) => {
            let e = e.to_lowercase();
            if e.len() > 100 || !e.contains('@') || !e.contains('.') || e.contains(' ') {
                return Err(CoreError::validation("email", "Enter a valid email address"));
            }
            Some(e)
        }
        None => None,
    };
    let blood_group = match opt_text(input.blood_group.clone()) {
        Some(b) => {
            let b = b.to_uppercase().replace(' ', "");
            if !BLOOD_GROUPS.contains(&b.as_str()) {
                return Err(CoreError::validation("bloodGroup", "Choose a blood group"));
            }
            Some(b)
        }
        None => None,
    };
    let join_date = match opt_text(input.join_date.clone()) {
        Some(d) => {
            let jd = parse_date(&d).ok_or_else(|| CoreError::validation("joinDate", "Invalid joining date"))?;
            if jd > today {
                return Err(CoreError::validation("joinDate", "Joining date cannot be in the future"));
            }
            fmt_date(jd)
        }
        None => fmt_date(today),
    };
    Ok(Normalized {
        member_code,
        full_name,
        father_name: opt_text(input.father_name.clone()).map(|n| clean_name(&n)).map(|n| n.chars().take(80).collect()),
        gender: input.gender,
        date_of_birth,
        phone,
        whatsapp,
        cnic,
        email,
        address: opt_text_max(input.address.clone(), 200),
        area: opt_text(input.area.clone()).map(|a| clean_name(&a).chars().take(60).collect()),
        occupation: opt_text(input.occupation.clone()).map(|o| clean_name(&o).chars().take(60).collect()),
        blood_group,
        emergency_name: opt_text(input.emergency_name.clone()).map(|n| clean_name(&n).chars().take(80).collect()),
        emergency_phone: lenient_phone(input.emergency_phone.clone(), "emergencyPhone")?,
        medical_notes: opt_text_max(input.medical_notes.clone(), 1000),
        notes: opt_text_max(input.notes.clone(), 1000),
        timing: opt_text_max(input.timing.clone(), 40),
        source: opt_text_max(input.source.clone(), 40),
        join_date,
    })
}

fn format_code(settings: &Settings, n: i64) -> String {
    let width = settings.membership.member_code_digits.clamp(1, 8) as usize;
    format!("{}{:0width$}", settings.membership.member_code_prefix, n, width = width)
}

fn code_taken(conn: &Connection, code: &str, exclude: Option<&str>) -> CoreResult<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM members WHERE member_code = ?1 COLLATE NOCASE AND id != COALESCE(?2, ''))",
        (code, exclude),
        |r| r.get(0),
    )?)
}

fn generate_code(conn: &Connection, settings: &Settings) -> CoreResult<String> {
    loop {
        let code = format_code(settings, db::next_counter(conn, "member_code")?);
        if !code_taken(conn, &code, None)? {
            return Ok(code);
        }
    }
}

/// The member ID the next registration will get (not reserved).
pub fn next_code(conn: &Connection) -> CoreResult<String> {
    let settings = settings::load(conn)?;
    let mut n = db::peek_counter(conn, "member_code")? + 1;
    loop {
        let code = format_code(&settings, n);
        if !code_taken(conn, &code, None)? {
            return Ok(code);
        }
        n += 1;
    }
}

fn check_cnic(conn: &Connection, cnic: Option<&str>, exclude: Option<&str>) -> CoreResult<()> {
    if let Some(cnic) = cnic {
        let other: Option<(String, String)> = conn
            .query_row(
                "SELECT full_name, member_code FROM members WHERE cnic = ?1 AND id != COALESCE(?2, '')",
                (cnic, exclude),
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((name, code)) = other {
            return Err(CoreError::validation("cnic", format!("This CNIC is already registered to {name} ({code})")));
        }
    }
    Ok(())
}

/// Photo captured from the webcam or uploaded: JPEG/PNG as base64 or data URL.
#[derive(Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PhotoInput {
    pub photo: String,
    pub thumb: String,
}

fn decode_image(data: &str, max: usize, what: &str) -> CoreResult<Vec<u8>> {
    let b64 = match data.find("base64,") {
        Some(i) => &data[i + 7..],
        None => data,
    };
    let bytes = BASE64.decode(b64.trim()).map_err(|_| CoreError::validation("photo", format!("The {what} could not be read")))?;
    let is_jpeg = bytes.starts_with(&[0xFF, 0xD8, 0xFF]);
    let is_png = bytes.starts_with(&[0x89, b'P', b'N', b'G']);
    if !is_jpeg && !is_png {
        return Err(CoreError::validation("photo", "Photo must be a JPEG or PNG image"));
    }
    if bytes.len() > max {
        return Err(CoreError::validation("photo", format!("The {what} is too large")));
    }
    Ok(bytes)
}

fn store_photo(conn: &Connection, clock: &Clock, member_id: &str, input: &PhotoInput) -> CoreResult<i64> {
    let photo = decode_image(&input.photo, MAX_PHOTO_BYTES, "photo")?;
    let thumb = decode_image(&input.thumb, MAX_THUMB_BYTES, "thumbnail")?;
    let mime = if photo.starts_with(&[0x89, b'P']) { "image/png" } else { "image/jpeg" };
    conn.execute(
        "INSERT OR REPLACE INTO member_photos(member_id, photo, thumb, mime, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        (member_id, photo, thumb, mime, clock.now_str()),
    )?;
    conn.execute("UPDATE members SET photo_version = photo_version + 1 WHERE id = ?1", [member_id])?;
    Ok(conn.query_row("SELECT photo_version FROM members WHERE id = ?1", [member_id], |r| r.get(0))?)
}

fn insert_member(conn: &Connection, actor: &Actor, clock: &Clock, code: &str, n: &Normalized) -> CoreResult<String> {
    let id = new_id();
    let now = clock.now_str();
    conn.execute(
        "INSERT INTO members(id, member_code, full_name, father_name, gender, date_of_birth, phone, whatsapp, cnic, email, address,
                             area, occupation, blood_group, emergency_name, emergency_phone, medical_notes, notes, timing, source,
                             join_date, status, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, 'active', ?22, ?23, ?23)",
        rusqlite::params![
            id,
            code,
            n.full_name,
            n.father_name,
            n.gender,
            n.date_of_birth,
            n.phone,
            n.whatsapp,
            n.cnic,
            n.email,
            n.address,
            n.area,
            n.occupation,
            n.blood_group,
            n.emergency_name,
            n.emergency_phone,
            n.medical_notes,
            n.notes,
            n.timing,
            n.source,
            n.join_date,
            actor.db_user_id(),
            now,
        ],
    )?;
    Ok(id)
}

#[derive(Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct RegisterMemberInput {
    pub member: MemberInput,
    pub photo: Option<PhotoInput>,
    pub membership: Option<NewMembershipInput>,
    /// Admission fee charged now (0 / empty = none). Ignored for existing members.
    pub admission_fee: Option<i64>,
    pub payment: Option<PaymentEntry>,
    /// Member joined before the software was used (migrating from the paper register).
    pub existing_member: Option<bool>,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RegisterResult {
    pub member_id: String,
    pub member_code: String,
    pub subscription_id: Option<String>,
    pub payment: Option<PaymentResult>,
    pub balance: i64,
}

/// Registers a member with optional photo, membership, admission fee and payment — all or nothing.
pub fn register(conn: &mut Connection, actor: &Actor, clock: &Clock, input: RegisterMemberInput) -> CoreResult<RegisterResult> {
    actor.require(Permission::RegisterMembers)?;
    let today = clock.today();
    let existing = input.existing_member.unwrap_or(false);
    let n = normalize(&input.member, today)?;
    let tx = db::write_tx(conn)?;
    let settings = settings::load(&tx)?;

    let code = match &n.member_code {
        Some(code) => {
            if code_taken(&tx, code, None)? {
                return Err(CoreError::validation("memberCode", format!("Member ID {code} is already used")));
            }
            code.clone()
        }
        None => generate_code(&tx, &settings)?,
    };
    check_cnic(&tx, n.cnic.as_deref(), None)?;
    let member_id = insert_member(&tx, actor, clock, &code, &n)?;
    if let Some(photo) = &input.photo {
        store_photo(&tx, clock, &member_id, photo)?;
    }

    let mut items: Vec<ReceiptItem> = Vec::new();
    let mut subscription_id = None;
    if let Some(membership) = &input.membership {
        let kind = if existing { SubscriptionKind::Migrated } else { SubscriptionKind::New };
        let default_start = if existing { parse_date(&n.join_date).unwrap_or(today) } else { today };
        let charge_date = if existing {
            membership.start_date.clone().filter(|s| !s.trim().is_empty()).or_else(|| Some(fmt_date(default_start)))
        } else {
            None
        };
        let sub = memberships::create_subscription(&tx, actor, clock, &member_id, kind, membership, default_start, charge_date.as_deref())?;
        items.push(ReceiptItem {
            description: format!("{} membership ({} – {})", sub.plan_name, human_date(sub.start), human_date(sub.end)),
            amount: sub.price,
            discount: sub.discount,
        });
        subscription_id = Some(sub.id);
    }
    if !existing {
        let fee = input.admission_fee.unwrap_or(0);
        if !(0..=1_000_000).contains(&fee) {
            return Err(CoreError::validation("admissionFee", "Enter a valid admission fee"));
        }
        if fee > 0 {
            billing::insert_charge(&tx, actor, clock, &member_id, None, ChargeKind::Admission, "Admission fee", fee, 0, &fmt_date(today))?;
            items.push(ReceiptItem { description: "Admission fee".into(), amount: fee, discount: 0 });
        }
    }

    let payment = match &input.payment {
        Some(entry) if entry.amount > 0 => {
            actor.require(Permission::RecordPayments)?;
            let mut entry = entry.clone();
            if existing && entry.paid_at.as_deref().map(str::trim).unwrap_or("").is_empty() {
                // Old fee paid before the software: date it at the start of the period, not today.
                entry.paid_at = input.membership.as_ref().and_then(|m| m.start_date.clone()).or_else(|| Some(n.join_date.clone()));
            }
            Some(billing::insert_payment(
                &tx,
                actor,
                clock,
                &settings,
                NewPayment { member_id: &member_id, subscription_id: subscription_id.as_deref(), entry: &entry, items: items.clone(), allow_backdate: existing },
            )?)
        }
        _ => None,
    };

    summary::refresh_member(&tx, &member_id)?;
    let balance = billing::live_balance(&tx, &member_id)?;
    let cur = &settings.billing.currency;
    let mut summary_text = format!("Registered {} ({code})", n.full_name);
    if existing {
        summary_text.push_str(" [existing member]");
    }
    if let Some(item) = items.first() {
        summary_text.push_str(&format!(" — {}", item.description));
    }
    if let Some(p) = &payment {
        summary_text.push_str(&format!(", paid {} (receipt {})", format_money(cur, p.amount), p.receipt_no));
    }
    if balance > 0 {
        summary_text.push_str(&format!(", due {}", format_money(cur, balance)));
    }
    audit::record(&tx, actor, clock, "member.register", Some("member"), Some(&member_id), summary_text, None)?;
    tx.commit()?;
    Ok(RegisterResult { member_id, member_code: code, subscription_id, payment, balance })
}

// ---------------------------------------------------------------------------------------------
// Profile

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Member {
    pub id: String,
    pub member_code: String,
    pub full_name: String,
    pub father_name: Option<String>,
    pub gender: Gender,
    pub date_of_birth: Option<String>,
    pub age: Option<i64>,
    pub phone: String,
    pub whatsapp: Option<String>,
    pub cnic: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub area: Option<String>,
    pub occupation: Option<String>,
    pub blood_group: Option<String>,
    pub emergency_name: Option<String>,
    pub emergency_phone: Option<String>,
    pub medical_notes: Option<String>,
    pub notes: Option<String>,
    pub timing: Option<String>,
    pub source: Option<String>,
    pub join_date: String,
    pub status: MemberStatus,
    pub archived_at: Option<String>,
    pub archive_reason: Option<String>,
    pub photo_version: i64,
    pub plan_id: Option<String>,
    pub plan_name: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub days_left: Option<i64>,
    pub freeze_start: Option<String>,
    pub freeze_end: Option<String>,
    pub balance: i64,
    pub total_charged: i64,
    pub total_paid: i64,
    pub last_payment_at: Option<String>,
    pub last_visit_at: Option<String>,
    pub visit_count: i64,
    pub visits_last_30_days: i64,
    pub created_by_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub fn get(conn: &Connection, clock: &Clock, id: &str) -> CoreResult<Member> {
    let settings = settings::load(conn)?;
    let today = clock.today();
    let today_s = fmt_date(today);
    let since = fmt_date(add_days(today, -29));
    let sql = format!(
        "SELECT m.id, m.member_code, m.full_name, m.father_name, m.gender, m.date_of_birth, m.phone, m.whatsapp, m.cnic, m.email,
                m.address, m.area, m.occupation, m.blood_group, m.emergency_name, m.emergency_phone, m.medical_notes, m.notes,
                m.timing, m.source, m.join_date, {status} AS status, m.archived_at, m.archive_reason, m.photo_version,
                ms.plan_id, ms.plan_name, ms.start_date, ms.end_date,
                CAST(julianday(ms.end_date) - julianday(:today) AS INTEGER),
                ms.freeze_start, ms.freeze_end, COALESCE(ms.balance, 0), COALESCE(ms.total_charged, 0), COALESCE(ms.total_paid, 0),
                ms.last_payment_at, ms.last_visit_at, COALESCE(ms.visit_count, 0),
                (SELECT COUNT(*) FROM attendance a WHERE a.member_id = m.id AND a.checked_in_at >= :since),
                u.name, m.created_at, m.updated_at
         FROM members m
         LEFT JOIN member_stats ms ON ms.member_id = m.id
         LEFT JOIN users u ON u.id = m.created_by
         WHERE m.id = :id AND m.deleted_at IS NULL",
        status = status_sql!()
    );
    conn.query_row(
        &sql,
        rusqlite::named_params! { ":today": today_s, ":soon_date": settings.membership.soon_date(today), ":id": id, ":since": since },
        |r| {
            let dob: Option<String> = r.get(5)?;
            let age = dob.as_deref().and_then(parse_date).map(|d| {
                let mut a = (today.year() - d.year()) as i64;
                if (today.month(), today.day()) < (d.month(), d.day()) {
                    a -= 1;
                }
                a
            });
            Ok(Member {
                id: r.get(0)?,
                member_code: r.get(1)?,
                full_name: r.get(2)?,
                father_name: r.get(3)?,
                gender: r.get(4)?,
                date_of_birth: dob,
                age,
                phone: r.get(6)?,
                whatsapp: r.get(7)?,
                cnic: r.get(8)?,
                email: r.get(9)?,
                address: r.get(10)?,
                area: r.get(11)?,
                occupation: r.get(12)?,
                blood_group: r.get(13)?,
                emergency_name: r.get(14)?,
                emergency_phone: r.get(15)?,
                medical_notes: r.get(16)?,
                notes: r.get(17)?,
                timing: r.get(18)?,
                source: r.get(19)?,
                join_date: r.get(20)?,
                status: r.get(21)?,
                archived_at: r.get(22)?,
                archive_reason: r.get(23)?,
                photo_version: r.get(24)?,
                plan_id: r.get(25)?,
                plan_name: r.get(26)?,
                start_date: r.get(27)?,
                end_date: r.get(28)?,
                days_left: r.get(29)?,
                freeze_start: r.get(30)?,
                freeze_end: r.get(31)?,
                balance: r.get(32)?,
                total_charged: r.get(33)?,
                total_paid: r.get(34)?,
                last_payment_at: r.get(35)?,
                last_visit_at: r.get(36)?,
                visit_count: r.get(37)?,
                visits_last_30_days: r.get(38)?,
                created_by_name: r.get(39)?,
                created_at: r.get(40)?,
                updated_at: r.get(41)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| CoreError::not_found("Member"))
}

/// Updates member details (not money or memberships). Returns the refreshed profile.
pub fn update(conn: &mut Connection, actor: &Actor, clock: &Clock, id: &str, input: MemberInput) -> CoreResult<Member> {
    actor.require(Permission::EditMembers)?;
    let n = normalize(&input, clock.today())?;
    let tx = db::write_tx(conn)?;
    let before = get(&tx, clock, id)?;
    let code = n.member_code.clone().unwrap_or_else(|| before.member_code.clone());
    if code != before.member_code && code_taken(&tx, &code, Some(id))? {
        return Err(CoreError::validation("memberCode", format!("Member ID {code} is already used")));
    }
    check_cnic(&tx, n.cnic.as_deref(), Some(id))?;
    tx.execute(
        "UPDATE members SET member_code = ?2, full_name = ?3, father_name = ?4, gender = ?5, date_of_birth = ?6, phone = ?7,
                whatsapp = ?8, cnic = ?9, email = ?10, address = ?11, area = ?12, occupation = ?13, blood_group = ?14,
                emergency_name = ?15, emergency_phone = ?16, medical_notes = ?17, notes = ?18, timing = ?19, source = ?20,
                join_date = ?21, updated_at = ?22
         WHERE id = ?1",
        rusqlite::params![
            id,
            code,
            n.full_name,
            n.father_name,
            n.gender,
            n.date_of_birth,
            n.phone,
            n.whatsapp,
            n.cnic,
            n.email,
            n.address,
            n.area,
            n.occupation,
            n.blood_group,
            n.emergency_name,
            n.emergency_phone,
            n.medical_notes,
            n.notes,
            n.timing,
            n.source,
            n.join_date,
            clock.now_str(),
        ],
    )?;
    let mut changed: Vec<&str> = Vec::new();
    let pairs: [(&str, Option<&str>, Option<&str>); 9] = [
        ("ID", Some(before.member_code.as_str()), Some(code.as_str())),
        ("name", Some(before.full_name.as_str()), Some(n.full_name.as_str())),
        ("phone", Some(before.phone.as_str()), Some(n.phone.as_str())),
        ("WhatsApp", before.whatsapp.as_deref(), n.whatsapp.as_deref()),
        ("CNIC", before.cnic.as_deref(), n.cnic.as_deref()),
        ("date of birth", before.date_of_birth.as_deref(), n.date_of_birth.as_deref()),
        ("timing", before.timing.as_deref(), n.timing.as_deref()),
        ("joining date", Some(before.join_date.as_str()), Some(n.join_date.as_str())),
        ("medical notes", before.medical_notes.as_deref(), n.medical_notes.as_deref()),
    ];
    for (label, a, b) in pairs {
        if a != b {
            changed.push(label);
        }
    }
    let summary_text = if changed.is_empty() {
        format!("Updated details of {} ({code})", n.full_name)
    } else {
        format!("Updated {} of {} ({code})", changed.join(", "), n.full_name)
    };
    audit::record(&tx, actor, clock, "member.update", Some("member"), Some(id), summary_text, None)?;
    let after = get(&tx, clock, id)?;
    tx.commit()?;
    Ok(after)
}

pub fn archive(conn: &mut Connection, actor: &Actor, clock: &Clock, id: &str, reason: Option<String>) -> CoreResult<()> {
    actor.require(Permission::ArchiveMembers)?;
    let tx = db::write_tx(conn)?;
    let m = get(&tx, clock, id)?;
    if m.status == MemberStatus::Archived {
        return Err(CoreError::conflict("This member is already archived."));
    }
    let reason = opt_text_max(reason, 200);
    tx.execute(
        "UPDATE members SET status = 'archived', archived_at = ?2, archive_reason = ?3, updated_at = ?2 WHERE id = ?1",
        (id, clock.now_str(), &reason),
    )?;
    audit::record(
        &tx,
        actor,
        clock,
        "member.archive",
        Some("member"),
        Some(id),
        format!("Archived {} ({}){}", m.full_name, m.member_code, reason.map(|r| format!(": {r}")).unwrap_or_default()),
        None,
    )?;
    tx.commit()?;
    Ok(())
}

pub fn restore(conn: &mut Connection, actor: &Actor, clock: &Clock, id: &str) -> CoreResult<()> {
    actor.require(Permission::ArchiveMembers)?;
    let tx = db::write_tx(conn)?;
    let m = get(&tx, clock, id)?;
    tx.execute(
        "UPDATE members SET status = 'active', archived_at = NULL, archive_reason = NULL, updated_at = ?2 WHERE id = ?1",
        (id, clock.now_str()),
    )?;
    audit::record(&tx, actor, clock, "member.restore", Some("member"), Some(id), format!("Restored {} ({})", m.full_name, m.member_code), None)?;
    tx.commit()?;
    Ok(())
}

/// Permanently deletes a member created by mistake. Members with any money history must be archived.
pub fn delete(conn: &mut Connection, actor: &Actor, clock: &Clock, id: &str) -> CoreResult<()> {
    actor.require(Permission::DeleteMembers)?;
    let tx = db::write_tx(conn)?;
    let m = get(&tx, clock, id)?;
    let has_history: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM payments WHERE member_id = ?1)
             OR EXISTS(SELECT 1 FROM charges WHERE member_id = ?1)
             OR EXISTS(SELECT 1 FROM subscriptions WHERE member_id = ?1)",
        [id],
        |r| r.get(0),
    )?;
    if has_history {
        return Err(CoreError::conflict("This member has membership or payment history, so they can only be archived."));
    }
    tx.execute("DELETE FROM freezes WHERE member_id = ?1", [id])?;
    tx.execute("DELETE FROM members WHERE id = ?1", [id])?;
    audit::record(&tx, actor, clock, "member.delete", Some("member"), Some(id), format!("Deleted {} ({})", m.full_name, m.member_code), None)?;
    tx.commit()?;
    Ok(())
}

pub fn set_photo(conn: &mut Connection, actor: &Actor, clock: &Clock, id: &str, photo: PhotoInput) -> CoreResult<i64> {
    actor.require(Permission::EditMembers)?;
    let tx = db::write_tx(conn)?;
    let m = get(&tx, clock, id)?;
    let version = store_photo(&tx, clock, id, &photo)?;
    tx.execute("UPDATE members SET updated_at = ?2 WHERE id = ?1", (id, clock.now_str()))?;
    audit::record(&tx, actor, clock, "member.photo", Some("member"), Some(id), format!("Updated photo of {} ({})", m.full_name, m.member_code), None)?;
    tx.commit()?;
    Ok(version)
}

pub fn remove_photo(conn: &mut Connection, actor: &Actor, clock: &Clock, id: &str) -> CoreResult<()> {
    actor.require(Permission::EditMembers)?;
    let tx = db::write_tx(conn)?;
    let m = get(&tx, clock, id)?;
    tx.execute("DELETE FROM member_photos WHERE member_id = ?1", [id])?;
    tx.execute("UPDATE members SET photo_version = 0, updated_at = ?2 WHERE id = ?1", (id, clock.now_str()))?;
    audit::record(&tx, actor, clock, "member.photo_remove", Some("member"), Some(id), format!("Removed photo of {} ({})", m.full_name, m.member_code), None)?;
    tx.commit()?;
    Ok(())
}

/// Raw image bytes for the photo protocol: `(bytes, mime)`.
pub fn get_photo(conn: &Connection, id: &str, thumb: bool) -> CoreResult<Option<(Vec<u8>, String)>> {
    let sql = if thumb {
        "SELECT thumb, mime FROM member_photos WHERE member_id = ?1"
    } else {
        "SELECT photo, mime FROM member_photos WHERE member_id = ?1"
    };
    Ok(conn.query_row(sql, [id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?)
}

// ---------------------------------------------------------------------------------------------
// Lists & search

#[derive(Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum MemberFilter {
    #[default]
    All,
    Active,
    Expiring,
    Expired,
    Frozen,
    Upcoming,
    NoPlan,
    Dues,
    Inactive,
    Archived,
}

#[derive(Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum MemberSort {
    Name,
    Code,
    Expiry,
    Balance,
    LastVisit,
    Joined,
    Recent,
}

#[derive(Deserialize, TS, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct MemberQuery {
    pub search: Option<String>,
    pub filter: Option<MemberFilter>,
    pub timing: Option<String>,
    pub gender: Option<Gender>,
    pub plan_id: Option<String>,
    pub sort: Option<MemberSort>,
    pub descending: Option<bool>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MemberRow {
    pub id: String,
    pub member_code: String,
    pub full_name: String,
    pub father_name: Option<String>,
    pub phone: String,
    pub gender: Gender,
    pub timing: Option<String>,
    pub status: MemberStatus,
    pub plan_name: Option<String>,
    pub end_date: Option<String>,
    pub days_left: Option<i64>,
    pub balance: i64,
    pub last_visit_at: Option<String>,
    pub photo_version: i64,
    pub join_date: String,
    /// For member cards printed from the list.
    pub cnic: Option<String>,
    pub blood_group: Option<String>,
}

#[derive(Serialize, TS, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MemberCounts {
    pub all: i64,
    pub active: i64,
    pub expiring: i64,
    pub expired: i64,
    pub frozen: i64,
    pub upcoming: i64,
    pub no_plan: i64,
    pub dues: i64,
    pub inactive: i64,
    pub archived: i64,
}

fn base_select() -> String {
    format!(
        "SELECT m.id, m.member_code, m.full_name, m.father_name, m.phone, m.gender, m.timing, m.photo_version, m.join_date,
                m.cnic, m.blood_group, m.created_at, ms.plan_id, ms.plan_name, ms.start_date, ms.end_date, COALESCE(ms.balance, 0) AS balance,
                ms.last_visit_at, CAST(julianday(ms.end_date) - julianday(:today) AS INTEGER) AS days_left,
                {} AS status
         FROM members m LEFT JOIN member_stats ms ON ms.member_id = m.id
         WHERE m.deleted_at IS NULL",
        status_sql!()
    )
}

fn search_condition(term: &str, params: &mut Params) -> String {
    let mut c = String::from(
        " AND (m.full_name LIKE :like ESCAPE '\\' OR m.member_code LIKE :like ESCAPE '\\'
              OR m.father_name LIKE :like ESCAPE '\\' OR m.area LIKE :like ESCAPE '\\'",
    );
    params.add(":like", format!("%{}%", escape_like(term)));
    if let Some(frag) = phone_search_fragment(term) {
        c.push_str(" OR m.phone LIKE :phone OR m.whatsapp LIKE :phone OR m.emergency_phone LIKE :phone");
        params.add(":phone", format!("%{frag}%"));
        let digits: String = term.chars().filter(|c| c.is_ascii_digit()).collect();
        if digits.len() >= 5 {
            c.push_str(" OR replace(m.cnic, '-', '') LIKE :cnic");
            params.add(":cnic", format!("%{digits}%"));
        }
    }
    c.push(')');
    c
}

fn filter_condition(filter: MemberFilter) -> &'static str {
    match filter {
        MemberFilter::All => "t.status != 'archived'",
        MemberFilter::Active => "t.status IN ('active', 'expiring')",
        MemberFilter::Expiring => "t.status = 'expiring'",
        MemberFilter::Expired => "t.status = 'expired'",
        MemberFilter::Frozen => "t.status = 'frozen'",
        MemberFilter::Upcoming => "t.status = 'upcoming'",
        MemberFilter::NoPlan => "t.status = 'none'",
        MemberFilter::Dues => "t.balance > 0 AND t.status != 'archived'",
        MemberFilter::Inactive => {
            "t.status IN ('active', 'expiring') AND COALESCE(t.last_visit_at, '') < :inactive_ts AND t.join_date <= :inactive_date"
        }
        MemberFilter::Archived => "t.status = 'archived'",
    }
}

fn order_clause(filter: MemberFilter, sort: Option<MemberSort>, descending: Option<bool>) -> String {
    let sort = sort.unwrap_or(match filter {
        MemberFilter::Expiring | MemberFilter::Upcoming => MemberSort::Expiry,
        MemberFilter::Expired => MemberSort::Expiry,
        MemberFilter::Dues => MemberSort::Balance,
        MemberFilter::Inactive => MemberSort::LastVisit,
        _ => MemberSort::Recent,
    });
    let (col, default_desc) = match sort {
        MemberSort::Name => ("t.full_name COLLATE NOCASE", false),
        MemberSort::Code => ("t.member_code COLLATE NOCASE", false),
        MemberSort::Expiry => ("t.end_date", filter == MemberFilter::Expired),
        MemberSort::Balance => ("t.balance", true),
        MemberSort::LastVisit => ("t.last_visit_at", filter != MemberFilter::Inactive),
        MemberSort::Joined => ("t.join_date", true),
        MemberSort::Recent => ("t.created_at", true),
    };
    let dir = if descending.unwrap_or(default_desc) { "DESC" } else { "ASC" };
    format!("{col} {dir} NULLS LAST, t.full_name COLLATE NOCASE ASC")
}

fn common_params(params: &mut Params, settings: &Settings, today: NaiveDate) {
    params.add(":today", fmt_date(today));
    params.add(":soon_date", settings.membership.soon_date(today));
}

/// Binds the inactivity cutoff; while it cannot be judged yet the empty bounds match nobody.
fn inactive_params(conn: &Connection, params: &mut Params, settings: &Settings, today: NaiveDate) -> CoreResult<()> {
    let (ts, date) = crate::attendance::inactive_cutoff(conn, settings, today)?.unwrap_or_default();
    params.add(":inactive_ts", ts);
    params.add(":inactive_date", date);
    Ok(())
}

pub fn list(conn: &Connection, clock: &Clock, q: &MemberQuery) -> CoreResult<Page<MemberRow>> {
    let settings = settings::load(conn)?;
    let today = clock.today();
    let filter = q.filter.unwrap_or_default();
    let (page, size, offset) = paging(q.page, q.page_size, 50);
    let mut params = Params::new();
    common_params(&mut params, &settings, today);
    let mut sql = base_select();
    if let Some(term) = q.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        sql.push_str(&search_condition(term, &mut params));
    }
    if let Some(timing) = q.timing.as_deref().filter(|s| !s.is_empty()) {
        sql.push_str(" AND m.timing = :timing");
        params.add(":timing", timing.to_string());
    }
    if let Some(gender) = q.gender {
        sql.push_str(" AND m.gender = :gender");
        params.add(":gender", gender);
    }
    if let Some(plan) = q.plan_id.as_deref().filter(|s| !s.is_empty()) {
        sql.push_str(" AND ms.plan_id = :plan");
        params.add(":plan", plan.to_string());
    }
    if filter == MemberFilter::Inactive {
        inactive_params(conn, &mut params, &settings, today)?;
    }
    let full = format!(
        "SELECT t.*, COUNT(*) OVER () AS total_rows FROM ({sql}) t WHERE {} ORDER BY {} LIMIT :limit OFFSET :offset",
        filter_condition(filter),
        order_clause(filter, q.sort, q.descending)
    );
    params.add(":limit", size).add(":offset", offset);
    let mut stmt = conn.prepare_cached(&full)?;
    let mut rows = stmt.query(params.named().as_slice())?;
    let mut items = Vec::new();
    let mut total = 0;
    while let Some(r) = rows.next()? {
        total = r.get("total_rows")?;
        items.push(MemberRow {
            id: r.get("id")?,
            member_code: r.get("member_code")?,
            full_name: r.get("full_name")?,
            father_name: r.get("father_name")?,
            phone: r.get("phone")?,
            gender: r.get("gender")?,
            timing: r.get("timing")?,
            status: r.get("status")?,
            plan_name: r.get("plan_name")?,
            end_date: r.get("end_date")?,
            days_left: r.get("days_left")?,
            balance: r.get("balance")?,
            last_visit_at: r.get("last_visit_at")?,
            photo_version: r.get("photo_version")?,
            join_date: r.get("join_date")?,
            cnic: r.get("cnic")?,
            blood_group: r.get("blood_group")?,
        });
    }
    if items.is_empty() && page > 1 {
        // Page past the end: report the real total so the UI can jump back.
        let c = counts_with(conn, &settings, today, q.search.as_deref())?;
        total = match filter {
            MemberFilter::All => c.all,
            MemberFilter::Active => c.active,
            MemberFilter::Expiring => c.expiring,
            MemberFilter::Expired => c.expired,
            MemberFilter::Frozen => c.frozen,
            MemberFilter::Upcoming => c.upcoming,
            MemberFilter::NoPlan => c.no_plan,
            MemberFilter::Dues => c.dues,
            MemberFilter::Inactive => c.inactive,
            MemberFilter::Archived => c.archived,
        };
    }
    Ok(Page { items, total, page, page_size: size })
}

fn counts_with(conn: &Connection, settings: &Settings, today: NaiveDate, search: Option<&str>) -> CoreResult<MemberCounts> {
    let mut params = Params::new();
    common_params(&mut params, settings, today);
    inactive_params(conn, &mut params, settings, today)?;
    let mut sql = base_select();
    if let Some(term) = search.map(str::trim).filter(|s| !s.is_empty()) {
        sql.push_str(&search_condition(term, &mut params));
    }
    let full = format!(
        "SELECT COALESCE(SUM(t.status != 'archived'), 0),
                COALESCE(SUM(t.status IN ('active', 'expiring')), 0),
                COALESCE(SUM(t.status = 'expiring'), 0),
                COALESCE(SUM(t.status = 'expired'), 0),
                COALESCE(SUM(t.status = 'frozen'), 0),
                COALESCE(SUM(t.status = 'upcoming'), 0),
                COALESCE(SUM(t.status = 'none'), 0),
                COALESCE(SUM(t.balance > 0 AND t.status != 'archived'), 0),
                COALESCE(SUM(t.status IN ('active', 'expiring') AND COALESCE(t.last_visit_at, '') < :inactive_ts
                             AND t.join_date <= :inactive_date), 0),
                COALESCE(SUM(t.status = 'archived'), 0)
         FROM ({sql}) t"
    );
    Ok(conn.query_row(&full, params.named().as_slice(), |r| {
        Ok(MemberCounts {
            all: r.get(0)?,
            active: r.get(1)?,
            expiring: r.get(2)?,
            expired: r.get(3)?,
            frozen: r.get(4)?,
            upcoming: r.get(5)?,
            no_plan: r.get(6)?,
            dues: r.get(7)?,
            inactive: r.get(8)?,
            archived: r.get(9)?,
        })
    })?)
}

/// Counts per status chip (optionally restricted by the current search text).
pub fn counts(conn: &Connection, clock: &Clock, search: Option<&str>) -> CoreResult<MemberCounts> {
    let settings = settings::load(conn)?;
    counts_with(conn, &settings, clock.today(), search)
}

/// Fast lookup for the check-in screen and the global search box.
pub fn quick_search(conn: &Connection, clock: &Clock, term: &str, limit: i64) -> CoreResult<Vec<MemberQuick>> {
    let term = term.trim();
    if term.is_empty() {
        return Ok(vec![]);
    }
    let settings = settings::load(conn)?;
    let mut params = Params::new();
    common_params(&mut params, &settings, clock.today());
    let cond = search_condition(term, &mut params);
    params.add(":exact", term.to_uppercase());
    params.add(":prefix", format!("{}%", escape_like(term)));
    params.add(":word", format!("% {}%", escape_like(term)));
    params.add(":limit", limit.clamp(1, 50));
    // Best matches first: exact ID, name starts with the term, a later word of the name does, the name
    // contains it, then matches on father's name, area or phone.
    let sql = format!(
        "SELECT {} FROM members m LEFT JOIN member_stats ms ON ms.member_id = m.id
         WHERE m.deleted_at IS NULL {cond}
         ORDER BY CASE WHEN m.member_code = :exact COLLATE NOCASE THEN 0
                       WHEN m.full_name LIKE :prefix ESCAPE '\\' THEN 1
                       WHEN m.full_name LIKE :word ESCAPE '\\' THEN 2
                       WHEN m.full_name LIKE :like ESCAPE '\\' THEN 3 ELSE 4 END,
                  m.status = 'archived', m.full_name COLLATE NOCASE
         LIMIT :limit",
        quick_columns!()
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let rows = stmt.query_map(params.named().as_slice(), MemberQuick::from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Exact member-ID lookup (barcode scanners type the code followed by Enter).
pub fn find_by_code(conn: &Connection, clock: &Clock, code: &str) -> CoreResult<Option<MemberQuick>> {
    let settings = settings::load(conn)?;
    let sql = format!(
        "SELECT {} FROM members m LEFT JOIN member_stats ms ON ms.member_id = m.id
         WHERE m.deleted_at IS NULL AND m.member_code = :code COLLATE NOCASE",
        quick_columns!()
    );
    Ok(conn
        .query_row(
            &sql,
            rusqlite::named_params! { ":today": clock.today_str(), ":soon_date": settings.membership.soon_date(clock.today()), ":code": code.trim() },
            MemberQuick::from_row,
        )
        .optional()?)
}

pub fn quick(conn: &Connection, clock: &Clock, id: &str) -> CoreResult<MemberQuick> {
    let settings = settings::load(conn)?;
    let sql = format!(
        "SELECT {} FROM members m LEFT JOIN member_stats ms ON ms.member_id = m.id WHERE m.id = :id AND m.deleted_at IS NULL",
        quick_columns!()
    );
    conn.query_row(
        &sql,
        rusqlite::named_params! { ":today": clock.today_str(), ":soon_date": settings.membership.soon_date(clock.today()), ":id": id },
        MemberQuick::from_row,
    )
    .optional()?
    .ok_or_else(|| CoreError::not_found("Member"))
}

#[derive(Deserialize, TS, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct DuplicateQuery {
    pub phone: Option<String>,
    pub cnic: Option<String>,
    pub full_name: Option<String>,
    pub exclude_id: Option<String>,
}

/// Members that may be the same person (same phone, CNIC or exact name).
pub fn find_duplicates(conn: &Connection, clock: &Clock, q: &DuplicateQuery) -> CoreResult<Vec<MemberQuick>> {
    let settings = settings::load(conn)?;
    let phone = q.phone.as_deref().and_then(|p| normalize_phone(p).ok());
    let cnic = normalize_cnic(q.cnic.as_deref()).ok().flatten();
    let name = q.full_name.as_deref().map(clean_name).filter(|n| n.chars().count() >= 3);
    if phone.is_none() && cnic.is_none() && name.is_none() {
        return Ok(vec![]);
    }
    let sql = format!(
        "SELECT {} FROM members m LEFT JOIN member_stats ms ON ms.member_id = m.id
         WHERE m.deleted_at IS NULL AND m.id != COALESCE(:exclude, '')
           AND ((:phone IS NOT NULL AND (m.phone = :phone OR m.whatsapp = :phone))
             OR (:cnic IS NOT NULL AND m.cnic = :cnic)
             OR (:name IS NOT NULL AND m.full_name = :name COLLATE NOCASE))
         ORDER BY m.full_name LIMIT 10",
        quick_columns!()
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let rows = stmt.query_map(
        rusqlite::named_params! {
            ":today": clock.today_str(), ":soon_date": settings.membership.soon_date(clock.today()),
            ":exclude": q.exclude_id, ":phone": phone, ":cnic": cnic, ":name": name,
        },
        MemberQuick::from_row,
    )?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[derive(Serialize, TS, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MemberSuggestions {
    pub areas: Vec<String>,
    pub occupations: Vec<String>,
}

/// Previously typed areas and occupations (autocomplete).
pub fn suggestions(conn: &Connection) -> CoreResult<MemberSuggestions> {
    let collect = |col: &str| -> CoreResult<Vec<String>> {
        let sql = format!(
            "SELECT {col} FROM members WHERE {col} IS NOT NULL AND deleted_at IS NULL GROUP BY {col} COLLATE NOCASE
             ORDER BY COUNT(*) DESC LIMIT 60"
        );
        let mut stmt = conn.prepare_cached(&sql)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    };
    Ok(MemberSuggestions { areas: collect("area")?, occupations: collect("occupation")? })
}
