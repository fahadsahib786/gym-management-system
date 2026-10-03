//! Shared types: enums stored in the database, pagination, compact member summaries.

use rusqlite::Row;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Declares a string-backed enum that round-trips through serde, SQLite and TypeScript.
macro_rules! db_enum {
    ($(#[$meta:meta])* $name:ident { $($variant:ident => $s:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq, Hash)]
        #[ts(export)]
        pub enum $name { $( #[serde(rename = $s)] $variant ),+ }

        impl $name {
            pub fn as_str(&self) -> &'static str {
                match self { $( $name::$variant => $s ),+ }
            }
            pub fn parse(s: &str) -> Option<Self> {
                match s { $( $s => Some($name::$variant), )+ _ => None }
            }
        }

        impl rusqlite::types::ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
                Ok(self.as_str().into())
            }
        }

        impl rusqlite::types::FromSql for $name {
            fn column_result(v: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
                let s = v.as_str()?;
                Self::parse(s).ok_or(rusqlite::types::FromSqlError::InvalidType)
            }
        }
    };
}

db_enum!(Gender { Male => "male", Female => "female", Other => "other" });
db_enum!(Role { Admin => "admin", Staff => "staff" });
db_enum!(DurationUnit { Day => "day", Month => "month" });
db_enum!(SubscriptionKind { New => "new", Renewal => "renewal", Migrated => "migrated" });
db_enum!(ChargeKind {
    Membership => "membership",
    Admission => "admission",
    Training => "training",
    Locker => "locker",
    Product => "product",
    Fine => "fine",
    Other => "other",
});
db_enum!(MemberStatus {
    Active => "active",
    Expiring => "expiring",
    Frozen => "frozen",
    Expired => "expired",
    Upcoming => "upcoming",
    NoPlan => "none",
    Archived => "archived",
});
db_enum!(CheckInMethod { Manual => "manual", Scan => "scan" });

// `db_enum!` declares the enum, so `#[default]` cannot be attached to a variant.
#[allow(clippy::derivable_impls)]
impl Default for Gender {
    fn default() -> Self {
        Gender::Male
    }
}

impl ChargeKind {
    pub fn label(&self) -> &'static str {
        match self {
            ChargeKind::Membership => "Membership fee",
            ChargeKind::Admission => "Admission fee",
            ChargeKind::Training => "Personal training",
            ChargeKind::Locker => "Locker",
            ChargeKind::Product => "Product",
            ChargeKind::Fine => "Fine",
            ChargeKind::Other => "Other",
        }
    }
}

/// One page of results.
#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

/// Normalises paging input: page ≥ 1, 1 ≤ size ≤ 500. Returns (page, size, offset).
pub fn paging(page: Option<i64>, page_size: Option<i64>, default_size: i64) -> (i64, i64, i64) {
    let size = page_size.unwrap_or(default_size).clamp(1, 500);
    let page = page.unwrap_or(1).max(1);
    (page, size, (page - 1) * size)
}

#[derive(Serialize, TS, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NameCount {
    pub name: String,
    pub count: i64,
}

#[derive(Serialize, TS, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NameTotal {
    pub name: String,
    pub count: i64,
    pub total: i64,
}

/// SQL expression computing a member's status. Needs `m` (members), `ms` (member_stats) and the
/// named parameters `:today` (YYYY-MM-DD) and `:soon_date` (today + expiring window, YYYY-MM-DD).
///
/// The correlated EXISTS only runs when the latest membership starts in the future (rare), so the common
/// case is pure column comparisons on `member_stats`.
macro_rules! status_sql {
    () => {
        "(CASE
            WHEN m.status = 'archived' THEN 'archived'
            WHEN ms.end_date IS NULL THEN 'none'
            WHEN ms.end_date < :today THEN 'expired'
            WHEN ms.freeze_start IS NOT NULL AND ms.freeze_start <= :today AND ms.freeze_end >= :today THEN 'frozen'
            WHEN ms.start_date > :today AND NOT EXISTS (SELECT 1 FROM subscriptions sx WHERE sx.member_id = m.id
                             AND sx.cancelled_at IS NULL AND sx.start_date <= :today AND sx.end_date >= :today) THEN 'upcoming'
            WHEN ms.end_date <= :soon_date THEN 'expiring'
            ELSE 'active' END)"
    };
}
pub(crate) use status_sql;

/// Columns for [`MemberQuick`]; same parameter requirements as [`status_sql!`].
macro_rules! quick_columns {
    () => {
        concat!(
            "m.id AS q_id, m.member_code AS q_code, m.full_name AS q_name, m.phone AS q_phone, m.gender AS q_gender, ",
            "m.photo_version AS q_photo, ms.plan_name AS q_plan, ms.end_date AS q_end, COALESCE(ms.balance, 0) AS q_balance, ",
            "ms.last_visit_at AS q_last_visit, CAST(julianday(ms.end_date) - julianday(:today) AS INTEGER) AS q_days_left, ",
            crate::model::status_sql!(),
            " AS q_status"
        )
    };
}
pub(crate) use quick_columns;

/// Compact member summary used in lists, check-in, reminders and the dashboard.
#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MemberQuick {
    pub id: String,
    pub member_code: String,
    pub full_name: String,
    pub phone: String,
    pub gender: Gender,
    pub status: MemberStatus,
    pub plan_name: Option<String>,
    pub end_date: Option<String>,
    pub days_left: Option<i64>,
    pub balance: i64,
    pub last_visit_at: Option<String>,
    pub photo_version: i64,
}

impl MemberQuick {
    /// Reads the `q_*` columns produced by [`quick_columns!`].
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(MemberQuick {
            id: row.get("q_id")?,
            member_code: row.get("q_code")?,
            full_name: row.get("q_name")?,
            phone: row.get("q_phone")?,
            gender: row.get("q_gender")?,
            status: row.get("q_status")?,
            plan_name: row.get("q_plan")?,
            end_date: row.get("q_end")?,
            days_left: row.get("q_days_left")?,
            balance: row.get("q_balance")?,
            last_visit_at: row.get("q_last_visit")?,
            photo_version: row.get("q_photo")?,
        })
    }
}
