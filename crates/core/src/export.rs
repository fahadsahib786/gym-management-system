//! CSV exports (open directly in Excel; UTF-8 with BOM so names and symbols display correctly).

use std::fs::File;
use std::io::Write;
use std::path::Path;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::audit;
use crate::auth::{Actor, Permission};
use crate::billing::{self, DuesQuery};
use crate::clock::Clock;
use crate::error::{CoreError, CoreResult};
use crate::settings;
use crate::util::display_phone;

#[derive(Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ExportKind {
    Members,
    Payments,
    Expenses,
    Attendance,
    Dues,
}

#[derive(Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct ExportRequest {
    pub kind: ExportKind,
    pub from: Option<String>,
    pub to: Option<String>,
    /// Destination file chosen in the save dialog.
    pub path: String,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExportResult {
    pub path: String,
    pub rows: i64,
}

fn writer(path: &Path) -> CoreResult<csv::Writer<File>> {
    let mut file = File::create(path)?;
    file.write_all(b"\xEF\xBB\xBF")?;
    Ok(csv::Writer::from_writer(file))
}

fn csv_err(e: csv::Error) -> CoreError {
    CoreError::other(format!("Could not write the file: {e}"))
}

fn date_range(req: &ExportRequest) -> (String, String) {
    (
        req.from.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| "0000-01-01".into()),
        req.to.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| "9999-12-31".into()),
    )
}

pub fn export_csv(conn: &Connection, actor: &Actor, clock: &Clock, req: &ExportRequest) -> CoreResult<ExportResult> {
    actor.require(Permission::ExportData)?;
    let path = Path::new(&req.path);
    if req.path.trim().is_empty() {
        return Err(CoreError::invalid("Choose where to save the file"));
    }
    let settings = settings::load(conn)?;
    let (from, to) = date_range(req);
    let mut w = writer(path)?;
    let mut rows = 0i64;
    match req.kind {
        ExportKind::Members => {
            w.write_record([
                "Member ID", "Name", "Father/Husband", "Gender", "Phone", "WhatsApp", "CNIC", "Date of birth", "Area", "Address",
                "Timing", "Plan", "Membership start", "Membership end", "Status", "Balance due", "Total paid", "Last visit",
                "Visits", "Joined", "Source", "Occupation", "Blood group", "Emergency contact", "Emergency phone", "Medical notes",
                "Notes",
            ])
            .map_err(csv_err)?;
            let sql = format!(
                "SELECT m.member_code, m.full_name, m.father_name, m.gender, m.phone, m.whatsapp, m.cnic, m.date_of_birth, m.area,
                        m.address, m.timing, ms.plan_name, ms.start_date, ms.end_date, {} AS status, COALESCE(ms.balance, 0),
                        COALESCE(ms.total_paid, 0), ms.last_visit_at, COALESCE(ms.visit_count, 0), m.join_date, m.source,
                        m.occupation, m.blood_group, m.emergency_name, m.emergency_phone, m.medical_notes, m.notes
                 FROM members m LEFT JOIN member_stats ms ON ms.member_id = m.id
                 WHERE m.deleted_at IS NULL ORDER BY m.member_code",
                crate::model::status_sql!()
            );
            let mut stmt = conn.prepare(&sql)?;
            let mut q = stmt.query(rusqlite::named_params! { ":today": clock.today_str(), ":soon_date": settings.membership.soon_date(clock.today()) })?;
            while let Some(r) = q.next()? {
                let opt = |i: usize| -> rusqlite::Result<String> { Ok(r.get::<_, Option<String>>(i)?.unwrap_or_default()) };
                let phone: String = r.get(4)?;
                let whatsapp = opt(5)?;
                let emergency = opt(24)?;
                w.write_record([
                    opt(0)?,
                    opt(1)?,
                    opt(2)?,
                    opt(3)?,
                    display_phone(&phone),
                    if whatsapp.is_empty() { String::new() } else { display_phone(&whatsapp) },
                    opt(6)?,
                    opt(7)?,
                    opt(8)?,
                    opt(9)?,
                    opt(10)?,
                    opt(11)?,
                    opt(12)?,
                    opt(13)?,
                    opt(14)?,
                    r.get::<_, i64>(15)?.to_string(),
                    r.get::<_, i64>(16)?.to_string(),
                    opt(17)?,
                    r.get::<_, i64>(18)?.to_string(),
                    opt(19)?,
                    opt(20)?,
                    opt(21)?,
                    opt(22)?,
                    opt(23)?,
                    if emergency.is_empty() { String::new() } else { display_phone(&emergency) },
                    opt(25)?,
                    opt(26)?,
                ])
                .map_err(csv_err)?;
                rows += 1;
            }
        }
        ExportKind::Payments => {
            actor.require(Permission::ViewRevenue)?;
            w.write_record([
                "Receipt", "Date", "Time", "Member ID", "Member", "Phone", "Amount", "Method", "Reference", "Plan", "Received by",
                "Note", "Status", "Void reason",
            ])
            .map_err(csv_err)?;
            let mut stmt = conn.prepare(&format!(
                "{} WHERE p.paid_on BETWEEN ?1 AND ?2 ORDER BY p.paid_at, p.receipt_no",
                billing::PAYMENT_ROW_SELECT
            ))?;
            let list = stmt.query_map((&from, &to), billing::row_to_payment)?;
            for p in list {
                let p = p?;
                w.write_record([
                    p.receipt_no,
                    p.paid_at.get(..10).unwrap_or("").to_string(),
                    p.paid_at.get(11..16).unwrap_or("").to_string(),
                    p.member_code,
                    p.member_name,
                    display_phone(&p.member_phone),
                    p.amount.to_string(),
                    p.method,
                    p.reference.unwrap_or_default(),
                    p.plan_name.unwrap_or_default(),
                    p.received_by_name.unwrap_or_default(),
                    p.note.unwrap_or_default(),
                    if p.voided_at.is_some() { "VOID".into() } else { "Valid".into() },
                    p.void_reason.unwrap_or_default(),
                ])
                .map_err(csv_err)?;
                rows += 1;
            }
        }
        ExportKind::Expenses => {
            actor.require(Permission::ViewExpenses)?;
            w.write_record(["Date", "Category", "Amount", "Method", "Paid to", "Description", "Recorded by"]).map_err(csv_err)?;
            let mut stmt = conn.prepare(
                "SELECT e.expense_date, c.name, e.amount, e.method, e.payee, e.description, u.name
                 FROM expenses e JOIN expense_categories c ON c.id = e.category_id LEFT JOIN users u ON u.id = e.created_by
                 WHERE e.deleted_at IS NULL AND e.expense_date BETWEEN ?1 AND ?2 ORDER BY e.expense_date",
            )?;
            let mut q = stmt.query((&from, &to))?;
            while let Some(r) = q.next()? {
                w.write_record([
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?.to_string(),
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(6)?.unwrap_or_default(),
                ])
                .map_err(csv_err)?;
                rows += 1;
            }
        }
        ExportKind::Attendance => {
            w.write_record(["Date", "Time", "Member ID", "Member", "Phone", "Method", "Recorded by"]).map_err(csv_err)?;
            let mut stmt = conn.prepare(
                "SELECT a.checked_in_at, m.member_code, m.full_name, m.phone, a.method, u.name
                 FROM attendance a JOIN members m ON m.id = a.member_id LEFT JOIN users u ON u.id = a.created_by
                 WHERE a.checked_in_at BETWEEN ?1 || ' 00:00:00' AND ?2 || ' 23:59:59' ORDER BY a.checked_in_at",
            )?;
            let mut q = stmt.query((&from, &to))?;
            while let Some(r) = q.next()? {
                let at: String = r.get(0)?;
                let phone: String = r.get(3)?;
                w.write_record([
                    at.get(..10).unwrap_or("").to_string(),
                    at.get(11..16).unwrap_or("").to_string(),
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    display_phone(&phone),
                    r.get::<_, String>(4)?,
                    r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                ])
                .map_err(csv_err)?;
                rows += 1;
            }
        }
        ExportKind::Dues => {
            w.write_record(["Member ID", "Member", "Phone", "Balance due", "Oldest unpaid since", "Days overdue", "Last payment", "Membership end", "Status"])
                .map_err(csv_err)?;
            let list = billing::dues(conn, clock, &settings, &DuesQuery { page_size: Some(500), ..Default::default() })?;
            for d in list.items {
                w.write_record([
                    d.member.member_code,
                    d.member.full_name,
                    display_phone(&d.member.phone),
                    d.member.balance.to_string(),
                    d.oldest_due_date.unwrap_or_default(),
                    d.age_days.to_string(),
                    d.last_payment_at.unwrap_or_default(),
                    d.member.end_date.unwrap_or_default(),
                    d.member.status.as_str().to_string(),
                ])
                .map_err(csv_err)?;
                rows += 1;
            }
        }
    }
    w.flush()?;
    audit::record(
        conn,
        actor,
        clock,
        "data.export",
        None,
        None,
        format!(
            "Exported {} ({rows} {}) to {}",
            match req.kind {
                ExportKind::Members => "members list",
                ExportKind::Payments => "payments",
                ExportKind::Expenses => "expenses",
                ExportKind::Attendance => "check-ins",
                ExportKind::Dues => "fee dues",
            },
            if rows == 1 { "row" } else { "rows" },
            path.file_name().and_then(|n| n.to_str()).unwrap_or("file")
        ),
        None,
    )?;
    Ok(ExportResult { path: req.path.clone(), rows })
}
