//! Append-only activity log (enforced by database triggers).

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::auth::{Actor, Permission};
use crate::clock::Clock;
use crate::error::CoreResult;
use crate::model::{Page, paging};
use crate::util::{escape_like, new_id};

/// Writes one audit row. Call inside the same transaction as the change it describes.
#[allow(clippy::too_many_arguments)]
pub fn record(
    conn: &Connection,
    actor: &Actor,
    clock: &Clock,
    action: &str,
    entity: Option<&str>,
    entity_id: Option<&str>,
    summary: impl Into<String>,
    details: Option<serde_json::Value>,
) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO audit_log(id, at, user_id, user_name, action, entity, entity_id, summary, details)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        (
            new_id(),
            clock.now_str(),
            actor.db_user_id(),
            &actor.name,
            action,
            entity,
            entity_id,
            summary.into(),
            details.map(|d| d.to_string()),
        ),
    )?;
    Ok(())
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AuditRow {
    pub id: String,
    pub at: String,
    pub user_name: Option<String>,
    pub action: String,
    pub entity: Option<String>,
    pub entity_id: Option<String>,
    pub summary: String,
    pub details: Option<String>,
}

#[derive(Deserialize, TS, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct AuditQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    pub user_id: Option<String>,
    /// Action prefix, e.g. `payment.` or `member.register`.
    pub action: Option<String>,
    pub entity_id: Option<String>,
    pub search: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

fn row_to_audit(r: &rusqlite::Row<'_>) -> rusqlite::Result<AuditRow> {
    Ok(AuditRow {
        id: r.get(0)?,
        at: r.get(1)?,
        user_name: r.get(2)?,
        action: r.get(3)?,
        entity: r.get(4)?,
        entity_id: r.get(5)?,
        summary: r.get(6)?,
        details: r.get(7)?,
    })
}

pub fn list(conn: &Connection, actor: &Actor, q: &AuditQuery) -> CoreResult<Page<AuditRow>> {
    // Staff may only see the history of a specific record (e.g. a member's timeline).
    if q.entity_id.is_none() {
        actor.require(Permission::ViewAudit)?;
    }
    let (page, size, offset) = paging(q.page, q.page_size, 50);
    let mut sql = String::from(
        "SELECT id, at, user_name, action, entity, entity_id, summary, details, COUNT(*) OVER () AS total
         FROM audit_log WHERE 1 = 1",
    );
    let mut params: Vec<(String, Box<dyn rusqlite::ToSql>)> = Vec::new();
    if let Some(from) = q.from.as_deref().filter(|s| !s.is_empty()) {
        sql.push_str(" AND at >= :from");
        params.push((":from".into(), Box::new(format!("{from} 00:00:00"))));
    }
    if let Some(to) = q.to.as_deref().filter(|s| !s.is_empty()) {
        sql.push_str(" AND at <= :to");
        params.push((":to".into(), Box::new(format!("{to} 23:59:59"))));
    }
    if let Some(user) = q.user_id.as_deref().filter(|s| !s.is_empty()) {
        sql.push_str(" AND user_id = :user");
        params.push((":user".into(), Box::new(user.to_string())));
    }
    if let Some(action) = q.action.as_deref().filter(|s| !s.is_empty()) {
        sql.push_str(" AND action LIKE :action ESCAPE '\\'");
        params.push((":action".into(), Box::new(format!("{}%", escape_like(action)))));
    }
    if let Some(entity_id) = q.entity_id.as_deref().filter(|s| !s.is_empty()) {
        sql.push_str(" AND (entity_id = :entity_id OR details LIKE :entity_like ESCAPE '\\')");
        params.push((":entity_id".into(), Box::new(entity_id.to_string())));
        params.push((":entity_like".into(), Box::new(format!("%{}%", escape_like(entity_id)))));
    }
    if let Some(search) = q.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        sql.push_str(" AND (summary LIKE :search ESCAPE '\\' OR user_name LIKE :search ESCAPE '\\')");
        params.push((":search".into(), Box::new(format!("%{}%", escape_like(search)))));
    }
    sql.push_str(" ORDER BY at DESC, id DESC LIMIT :limit OFFSET :offset");
    params.push((":limit".into(), Box::new(size)));
    params.push((":offset".into(), Box::new(offset)));

    let named: Vec<(&str, &dyn rusqlite::ToSql)> = params.iter().map(|(k, v)| (k.as_str(), v.as_ref())).collect();
    let mut stmt = conn.prepare_cached(&sql)?;
    let mut total = 0i64;
    let mut items = Vec::new();
    let mut rows = stmt.query(named.as_slice())?;
    while let Some(r) = rows.next()? {
        total = r.get(8)?;
        items.push(row_to_audit(r)?);
    }
    Ok(Page { items, total, page, page_size: size })
}
