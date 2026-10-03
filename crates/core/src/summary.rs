//! Maintains `member_stats`, the derived per-member summary used by fast list/status queries.
//!
//! Values are always recomputed from the source tables (never incremented), so they cannot drift.

use rusqlite::Connection;

use crate::error::CoreResult;

const COLUMNS: &str = "member_id, last_sub_id, plan_id, plan_name, start_date, end_date, freeze_start, freeze_end,
                       balance, total_charged, total_paid, last_payment_at, last_visit_at, visit_count";

/// Recomputes the summary for one member. Call inside the transaction that changed the member's data.
pub fn refresh_member(conn: &Connection, member_id: &str) -> CoreResult<()> {
    let sql = format!(
        "INSERT OR REPLACE INTO member_stats ({COLUMNS})
         SELECT m.id,
                ls.id, ls.plan_id, ls.plan_name, ls.start_date, ls.end_date,
                lf.start_date, lf.end_date,
                COALESCE(c.total, 0) - COALESCE(p.total, 0), COALESCE(c.total, 0), COALESCE(p.total, 0), p.last_at,
                a.last_at, COALESCE(a.cnt, 0)
         FROM members m
         LEFT JOIN (SELECT id, plan_id, plan_name, start_date, end_date FROM subscriptions
                    WHERE member_id = ?1 AND cancelled_at IS NULL
                    ORDER BY end_date DESC, start_date DESC LIMIT 1) ls ON 1 = 1
         LEFT JOIN (SELECT start_date, end_date FROM freezes
                    WHERE member_id = ?1 AND cancelled_at IS NULL AND days > 0
                    ORDER BY start_date DESC LIMIT 1) lf ON 1 = 1
         LEFT JOIN (SELECT SUM(net_amount) AS total FROM charges WHERE member_id = ?1 AND voided_at IS NULL) c ON 1 = 1
         LEFT JOIN (SELECT SUM(amount) AS total, MAX(paid_at) AS last_at FROM payments
                    WHERE member_id = ?1 AND voided_at IS NULL) p ON 1 = 1
         LEFT JOIN (SELECT MAX(checked_in_at) AS last_at, COUNT(*) AS cnt FROM attendance WHERE member_id = ?1) a ON 1 = 1
         WHERE m.id = ?1"
    );
    conn.prepare_cached(&sql)?.execute([member_id])?;
    Ok(())
}

/// Rebuilds the summary for every member (after migrations or a restore).
pub fn refresh_all(conn: &Connection) -> CoreResult<()> {
    let sql = format!(
        "DELETE FROM member_stats;
         INSERT INTO member_stats ({COLUMNS})
         SELECT m.id,
                ls.id, ls.plan_id, ls.plan_name, ls.start_date, ls.end_date,
                lf.start_date, lf.end_date,
                COALESCE(c.total, 0) - COALESCE(p.total, 0), COALESCE(c.total, 0), COALESCE(p.total, 0), p.last_at,
                a.last_at, COALESCE(a.cnt, 0)
         FROM members m
         LEFT JOIN (SELECT member_id, id, plan_id, plan_name, start_date, end_date,
                           ROW_NUMBER() OVER (PARTITION BY member_id ORDER BY end_date DESC, start_date DESC) AS rn
                    FROM subscriptions WHERE cancelled_at IS NULL) ls ON ls.member_id = m.id AND ls.rn = 1
         LEFT JOIN (SELECT member_id, start_date, end_date,
                           ROW_NUMBER() OVER (PARTITION BY member_id ORDER BY start_date DESC) AS rn
                    FROM freezes WHERE cancelled_at IS NULL AND days > 0) lf ON lf.member_id = m.id AND lf.rn = 1
         LEFT JOIN (SELECT member_id, SUM(net_amount) AS total FROM charges WHERE voided_at IS NULL GROUP BY member_id) c
                ON c.member_id = m.id
         LEFT JOIN (SELECT member_id, SUM(amount) AS total, MAX(paid_at) AS last_at FROM payments
                    WHERE voided_at IS NULL GROUP BY member_id) p ON p.member_id = m.id
         LEFT JOIN (SELECT member_id, MAX(checked_in_at) AS last_at, COUNT(*) AS cnt FROM attendance GROUP BY member_id) a
                ON a.member_id = m.id;"
    );
    conn.execute_batch(&sql)?;
    Ok(())
}

/// True when the summary table is missing rows (e.g. after an interrupted restore).
pub fn needs_rebuild(conn: &Connection) -> CoreResult<bool> {
    let missing: i64 = conn.query_row(
        "SELECT COUNT(*) FROM members m WHERE NOT EXISTS (SELECT 1 FROM member_stats ms WHERE ms.member_id = m.id)",
        [],
        |r| r.get(0),
    )?;
    Ok(missing > 0)
}
