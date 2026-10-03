//! Seeded-data tests.
//!
//! * `seeded_history_is_consistent` runs in the normal test suite (small data set).
//! * `performance_at_gym_scale` is the release benchmark:
//!   `cargo test -p danish-core --release --test performance -- --ignored --nocapture`

use std::time::{Duration, Instant};

use danish_core::billing::{self, DuesQuery, PaymentQuery};
use danish_core::clock::Clock;
use danish_core::members::{self, MemberFilter, MemberQuery};
use danish_core::{auth, db, seed, settings, stats, summary};

fn owner(conn: &rusqlite::Connection) -> danish_core::Actor {
    let users = auth::list_users(conn, false).unwrap();
    auth::refresh_actor(conn, &users.iter().find(|u| u.role == danish_core::model::Role::Admin).unwrap().id).unwrap()
}

#[test]
fn seeded_history_is_consistent() {
    let mut conn = db::open_memory().unwrap();
    let clock = Clock::fixed("2026-10-02", "20:00:00");
    let s = seed::seed_demo(&mut conn, &clock, 120, 6, 42).unwrap();
    assert_eq!(s.members, 120);
    assert!(s.payments > s.members / 2);
    assert!(s.check_ins > 1000);

    // Joins are spread over the whole period: the last month has new members too.
    let recent: i64 =
        conn.query_row("SELECT COUNT(*) FROM members WHERE join_date > '2026-09-02'", [], |r| r.get(0)).unwrap();
    assert!((8..=40).contains(&recent), "joined in the last month: {recent}");

    // Summaries maintained incrementally must equal a full rebuild.
    let before: Vec<(String, i64, Option<String>)> = {
        let mut st = conn.prepare("SELECT member_id, balance, end_date FROM member_stats ORDER BY member_id").unwrap();
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().map(Result::unwrap).collect()
    };
    summary::refresh_all(&conn).unwrap();
    let after: Vec<(String, i64, Option<String>)> = {
        let mut st = conn.prepare("SELECT member_id, balance, end_date FROM member_stats ORDER BY member_id").unwrap();
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().map(Result::unwrap).collect()
    };
    assert_eq!(before, after);

    // Ledger identity: Σ balances = Σ charges − Σ payments.
    let (charges, payments, balances): (i64, i64, i64) = conn
        .query_row(
            "SELECT (SELECT COALESCE(SUM(net_amount), 0) FROM charges WHERE voided_at IS NULL),
                    (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE voided_at IS NULL),
                    (SELECT COALESCE(SUM(balance), 0) FROM member_stats)",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(charges - payments, balances);

    // Receipt numbers are gap-free.
    let (count, max_no): (i64, String) =
        conn.query_row("SELECT COUNT(*), MAX(receipt_no) FROM payments", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!(max_no, format!("R-{count:06}"));

    let me = owner(&conn);
    let d = stats::dashboard(&conn, &me, &clock).unwrap();
    let counts = members::counts(&conn, &clock, None).unwrap();
    assert_eq!(d.kpis.active_members, counts.active);
    assert!(d.months.iter().any(|m| m.collected > 0));
    assert!(d.months.iter().any(|m| m.expenses > 0));
    assert!(!d.heatmap.is_empty());
    assert_eq!(
        counts.all,
        counts.active + counts.expired + counts.frozen + counts.upcoming + counts.no_plan,
        "every non-archived member has exactly one status"
    );
}

fn time<T>(label: &str, budget_ms: u64, f: impl Fn() -> T) -> T {
    // Warm-up (statement cache, page cache), then best of 3.
    let mut out = f();
    let mut best = Duration::MAX;
    for _ in 0..3 {
        let t = Instant::now();
        out = f();
        best = best.min(t.elapsed());
    }
    println!("{label:<34} {:>8.2} ms (budget {budget_ms} ms)", best.as_secs_f64() * 1000.0);
    assert!(best <= Duration::from_millis(budget_ms), "{label} took {best:?}");
    out
}

#[test]
#[ignore = "release benchmark: cargo test -p danish-core --release --test performance -- --ignored --nocapture"]
fn performance_at_gym_scale() {
    // The seeded database is cached between runs (delete it after schema changes: bump the file name).
    let path = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("perf-3000-s{}-v2.db", db::SCHEMA_VERSION));
    let fresh = !path.exists();
    let mut conn = db::open_file(&path).unwrap();
    let clock = Clock::fixed("2026-10-02", "20:00:00");
    if fresh {
        let t = Instant::now();
        let s = seed::seed_demo(&mut conn, &clock, 3000, 24, 7).unwrap();
        conn.execute_batch("PRAGMA optimize;").unwrap();
        println!(
            "seeded {} members, {} memberships, {} payments, {} check-ins, {} expenses in {:.1}s",
            s.members,
            s.subscriptions,
            s.payments,
            s.check_ins,
            s.expenses,
            t.elapsed().as_secs_f64()
        );
    }
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    println!("database size: {:.1} MB", size as f64 / 1_048_576.0);
    let me = owner(&conn);
    let settings = settings::load(&conn).unwrap();

    time("dashboard (everything)", 250, || stats::dashboard(&conn, &me, &clock).unwrap());
    time("member counts (status chips)", 40, || members::counts(&conn, &clock, None).unwrap());
    time("member list, all, page 1", 40, || members::list(&conn, &clock, &MemberQuery::default()).unwrap());
    time("member list, expiring", 40, || {
        members::list(&conn, &clock, &MemberQuery { filter: Some(MemberFilter::Expiring), ..Default::default() }).unwrap()
    });
    time("member search 'khan'", 40, || {
        members::list(&conn, &clock, &MemberQuery { search: Some("khan".into()), ..Default::default() }).unwrap()
    });
    time("member search by phone '0301'", 40, || {
        members::list(&conn, &clock, &MemberQuery { search: Some("0301".into()), ..Default::default() }).unwrap()
    });
    time("quick search (check-in) 'ali'", 25, || members::quick_search(&conn, &clock, "ali", 8).unwrap());
    time("payments, this month + totals", 60, || {
        billing::list_payments(&conn, &me, &clock, &PaymentQuery { from: Some("2026-10-01".into()), ..Default::default() }).unwrap()
    });
    time("payments, all time page 1", 120, || billing::list_payments(&conn, &me, &clock, &PaymentQuery::default()).unwrap());
    time("dues with ageing", 120, || billing::dues(&conn, &clock, &settings, &DuesQuery::default()).unwrap());
    let year = stats::DateRange { from: "2025-10-01".into(), to: "2026-09-30".into() };
    time("collections report (12 months)", 150, || stats::collections_report(&conn, &me, &year).unwrap());
    time("attendance report (12 months)", 250, || stats::attendance_report(&conn, &me, &clock, &year).unwrap());
    time("membership report (12 months)", 250, || stats::memberships_report(&conn, &me, &clock, &year).unwrap());
    time("profit & loss 2026", 60, || stats::pnl_report(&conn, &me, 2026).unwrap());
    let first = members::list(&conn, &clock, &MemberQuery::default()).unwrap().items[0].id.clone();
    time("member profile", 15, || members::get(&conn, &clock, &first).unwrap());
    time("member ledger", 15, || billing::member_ledger(&conn, &first).unwrap());
}

#[test]
#[ignore = "diagnostics: cargo test -p danish-core --release --test performance explain -- --ignored --nocapture"]
fn explain_query_plans() {
    let path = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("perf-3000-s{}-v2.db", db::SCHEMA_VERSION));
    if !path.exists() {
        println!("run performance_at_gym_scale first");
        return;
    }
    let conn = db::open_file(&path).unwrap();
    let plan = |label: &str, sql: &str| {
        println!("== {label}");
        let mut st = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
        let n = st.parameter_count();
        let params: Vec<String> = (0..n).map(|_| "2026-10-02".to_string()).collect();
        let refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p as &dyn rusqlite::ToSql).collect();
        let mut rows = st.query(refs.as_slice()).unwrap();
        while let Some(r) = rows.next().unwrap() {
            let detail: String = r.get(3).unwrap();
            println!("   {detail}");
        }
        let t = Instant::now();
        let mut st = conn.prepare(sql).unwrap();
        let mut rows = st.query(refs.as_slice()).unwrap();
        let mut count = 0;
        while rows.next().unwrap().is_some() {
            count += 1;
        }
        println!("   -> {count} rows in {:.2} ms", t.elapsed().as_secs_f64() * 1000.0);
    };
    let status = "(CASE WHEN m.status = 'archived' THEN 'archived' WHEN ms.end_date IS NULL THEN 'none' WHEN ms.end_date < ?1 THEN 'expired'
        WHEN NOT EXISTS (SELECT 1 FROM subscriptions sx WHERE sx.member_id = m.id AND sx.cancelled_at IS NULL AND sx.start_date <= ?1 AND sx.end_date >= ?1) THEN 'upcoming'
        ELSE 'active' END)";
    plan("baseline SELECT 1", "SELECT 1");
    plan("status over all members", &format!("SELECT m.id, {status} FROM members m LEFT JOIN member_stats ms ON ms.member_id = m.id"));
    plan("active_on", "SELECT COUNT(DISTINCT s.member_id) FROM subscriptions s JOIN members m ON m.id = s.member_id WHERE s.cancelled_at IS NULL AND m.deleted_at IS NULL AND s.start_date <= ?1 AND s.end_date >= ?1");
    plan("payments summary (no filter)", "SELECT COUNT(*) FILTER (WHERE p.voided_at IS NULL), COALESCE(SUM(p.amount) FILTER (WHERE p.voided_at IS NULL), 0) FROM payments p JOIN members m ON m.id = p.member_id WHERE 1 = 1");
    plan("recent payments list", "SELECT p.id FROM payments p JOIN members m ON m.id = p.member_id LEFT JOIN subscriptions s ON s.id = p.subscription_id LEFT JOIN users u ON u.id = p.received_by WHERE 1 = 1 AND p.voided_at IS NULL ORDER BY p.paid_at DESC, p.receipt_no DESC LIMIT 8");
    plan("today's check-ins", &format!("SELECT a.id, {status}, COUNT(*) OVER () FROM attendance a JOIN members m ON m.id = a.member_id LEFT JOIN member_stats ms ON ms.member_id = m.id WHERE a.checked_in_at >= ?1 || ' 00:00:00' ORDER BY a.checked_in_at DESC LIMIT 8"));
    plan("heatmap", "SELECT CAST(strftime('%w', checked_in_at) AS INTEGER), CAST(substr(checked_in_at, 12, 2) AS INTEGER), COUNT(*) FROM attendance WHERE checked_in_at >= ?1 GROUP BY 1, 2");
    plan("renewals per month", "SELECT substr(created_at, 1, 7), COUNT(*) FROM subscriptions WHERE kind = 'renewal' AND cancelled_at IS NULL AND substr(created_at, 1, 10) BETWEEN ?1 AND ?1 GROUP BY 1");
    plan("refresh member last visit", "SELECT MAX(checked_in_at), COUNT(*) FROM attendance WHERE member_id = ?1");
}

#[test]
fn seeding_early_in_the_morning_never_creates_future_records() {
    let mut conn = db::open_memory().unwrap();
    // 07:30: most simulated activity for "today" would be later in the day.
    let clock = Clock::fixed("2026-10-02", "07:30:00");
    seed::seed_demo(&mut conn, &clock, 40, 2, 9).unwrap();
    assert_eq!(danish_core::system::clock_warning(&conn, &clock).unwrap(), None);
    let latest: String = conn
        .query_row(
            "SELECT MAX(t) FROM (SELECT MAX(paid_at) AS t FROM payments UNION ALL SELECT MAX(checked_in_at) FROM attendance
                                  UNION ALL SELECT MAX(at) FROM audit_log)",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(latest.as_str() <= "2026-10-02 07:30:00", "latest record {latest}");
}
