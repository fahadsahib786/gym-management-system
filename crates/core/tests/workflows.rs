//! End-to-end business workflows against a real (in-memory) database.

use danish_core::auth::{self, NewUserInput};
use danish_core::billing::{self, DuesQuery, PaymentEntry, PaymentQuery, RecordPaymentInput};
use danish_core::clock::Clock;
use danish_core::db;
use danish_core::members::{self, MemberFilter, MemberInput, MemberQuery, RegisterMemberInput};
use danish_core::memberships::{self, FreezeInput, NewMembershipInput, RenewInput, RenewalPolicy};
use danish_core::model::{Gender, MemberStatus, Role};
use danish_core::settings::GymSettings;
use danish_core::stats;
use danish_core::system::{self, SetupInput, SetupPlan};
use danish_core::{Actor, CoreError, attendance, plans};
use rusqlite::Connection;

struct Gym {
    conn: Connection,
    owner: Actor,
    monthly: String,
    quarterly: String,
}

fn clock(date: &str) -> Clock {
    Clock::fixed(date, "10:00:00")
}

fn gym() -> Gym {
    let mut conn = db::open_memory().unwrap();
    let owner = system::complete_setup(
        &mut conn,
        &clock("2026-01-01"),
        SetupInput {
            gym: GymSettings::default(),
            owner_name: "Danish".into(),
            owner_pin: "1234".into(),
            admission_fee: 1000,
            plans: system::suggested_plans()
                .into_iter()
                .map(|(name, v, u, price)| SetupPlan { name: name.into(), duration_value: v, duration_unit: u, price })
                .collect(),
            member_code_prefix: None,
            backup_folder: None,
        },
    )
    .unwrap();
    let list = plans::list(&conn, "2026-01-01", false).unwrap();
    let monthly = list.iter().find(|p| p.name == "Monthly").unwrap().id.clone();
    let quarterly = list.iter().find(|p| p.name.starts_with("Quarterly")).unwrap().id.clone();
    Gym { conn, owner, monthly, quarterly }
}

fn person(name: &str, phone: &str) -> MemberInput {
    MemberInput { full_name: name.into(), phone: phone.into(), gender: Gender::Male, ..Default::default() }
}

fn register(g: &mut Gym, date: &str, name: &str, phone: &str, paid: i64) -> members::RegisterResult {
    let plan = g.monthly.clone();
    members::register(
        &mut g.conn,
        &g.owner.clone(),
        &clock(date),
        RegisterMemberInput {
            member: person(name, phone),
            photo: None,
            membership: Some(NewMembershipInput { plan_id: plan, start_date: None, end_date: None, price: None, discount: Some(500), notes: None }),
            admission_fee: Some(1000),
            payment: (paid > 0).then(|| PaymentEntry { amount: paid, method: "Cash".into(), reference: None, note: None, paid_at: None }),
            existing_member: Some(false),
        },
    )
    .unwrap()
}

#[test]
fn setup_cannot_run_twice_and_owner_is_admin() {
    let mut g = gym();
    assert!(g.owner.can(danish_core::Permission::ManageUsers));
    let again = system::complete_setup(
        &mut g.conn,
        &clock("2026-01-02"),
        SetupInput { gym: GymSettings::default(), owner_name: "X".into(), owner_pin: "1111".into(), admission_fee: 0, plans: vec![], member_code_prefix: None, backup_folder: None },
    );
    assert!(matches!(again, Err(CoreError::Conflict(_))));
    let status = system::status(&g.conn, &clock("2026-01-02")).unwrap();
    assert!(status.setup_complete);
    assert_eq!(status.users.len(), 1);
}

#[test]
fn registration_creates_member_membership_charges_and_receipt() {
    let mut g = gym();
    // Monthly 3000 − 500 discount + 1000 admission = 3500; pays 2000 now.
    let r = register(&mut g, "2026-10-02", "ali khan", "0300-1234567", 2000);
    assert_eq!(r.member_code, "DF-0001");
    assert_eq!(r.balance, 1500);
    let payment = r.payment.unwrap();
    assert_eq!(payment.receipt_no, "R-000001");
    assert_eq!(payment.balance_after, 1500);

    let m = members::get(&g.conn, &clock("2026-10-02"), &r.member_id).unwrap();
    assert_eq!(m.full_name, "Ali Khan");
    assert_eq!(m.phone, "923001234567");
    assert_eq!(m.start_date.as_deref(), Some("2026-10-02"));
    assert_eq!(m.end_date.as_deref(), Some("2026-11-01"));
    assert_eq!(m.status, MemberStatus::Active);
    assert_eq!(m.balance, 1500);
    assert_eq!(m.total_paid, 2000);

    let receipt = billing::get_receipt(&g.conn, &payment.payment_id).unwrap();
    assert_eq!(receipt.items.len(), 2);
    assert_eq!(receipt.items[0].discount, 500);
    assert_eq!(receipt.balance_before, 3500);

    // Second member gets the next code and receipt number.
    let r2 = register(&mut g, "2026-10-02", "Usman Tariq", "03211234567", 3500);
    assert_eq!(r2.member_code, "DF-0002");
    assert_eq!(r2.payment.unwrap().receipt_no, "R-000002");
    assert_eq!(r2.balance, 0);
}

#[test]
fn duplicate_cnic_and_member_code_are_rejected_but_shared_phones_are_allowed() {
    let mut g = gym();
    let owner = g.owner.clone();
    let mut input = person("Father Khan", "0300-1111111");
    input.cnic = Some("3130312345671".into());
    input.member_code = Some("old-17".into());
    let ok = members::register(&mut g.conn, &owner, &clock("2026-10-02"), RegisterMemberInput {
        member: input.clone(),
        photo: None,
        membership: None,
        admission_fee: None,
        payment: None,
        existing_member: None,
    })
    .unwrap();
    assert_eq!(ok.member_code, "OLD-17");

    let mut same_cnic = person("Someone Else", "0300-2222222");
    same_cnic.cnic = Some("31303-1234567-1".into());
    let err = members::register(&mut g.conn, &owner, &clock("2026-10-02"), RegisterMemberInput {
        member: same_cnic, photo: None, membership: None, admission_fee: None, payment: None, existing_member: None,
    });
    assert!(matches!(err, Err(CoreError::Validation { field: Some(ref f), .. }) if f == "cnic"));

    // Son shares the father's phone: allowed, and flagged as a possible duplicate.
    let son = members::register(&mut g.conn, &owner, &clock("2026-10-02"), RegisterMemberInput {
        member: person("Son Khan", "03001111111"), photo: None, membership: None, admission_fee: None, payment: None, existing_member: None,
    });
    assert!(son.is_ok());
    let dups = members::find_duplicates(&g.conn, &clock("2026-10-02"), &members::DuplicateQuery {
        phone: Some("0300-1111111".into()), ..Default::default()
    })
    .unwrap();
    assert_eq!(dups.len(), 2);
}

#[test]
fn renewal_policy_continue_grace_restart() {
    let mut g = gym();
    let r = register(&mut g, "2026-10-02", "Hamza Ali", "03001234567", 3500);
    let id = r.member_id;

    // Before expiry → continues the next day.
    let p = memberships::renewal_preview(&g.conn, &clock("2026-10-28"), &id, None).unwrap();
    assert_eq!(p.policy, RenewalPolicy::Continue);
    assert_eq!(p.start_date, "2026-11-02");
    assert_eq!(p.end_date.as_deref(), Some("2026-12-01"));

    // 5 days late (grace 10) → fee date unchanged.
    let p = memberships::renewal_preview(&g.conn, &clock("2026-11-06"), &id, None).unwrap();
    assert_eq!(p.policy, RenewalPolicy::Grace);
    assert_eq!(p.start_date, "2026-11-02");
    assert_eq!(p.days_since_expiry, Some(5));

    // 20 days late → starts today.
    let p = memberships::renewal_preview(&g.conn, &clock("2026-11-21"), &id, None).unwrap();
    assert_eq!(p.policy, RenewalPolicy::Restart);
    assert_eq!(p.start_date, "2026-11-21");

    // Renew in the grace window with a payment.
    let owner = g.owner.clone();
    let monthly = g.monthly.clone();
    let res = memberships::renew(&mut g.conn, &owner, &clock("2026-11-06"), RenewInput {
        member_id: id.clone(),
        plan_id: monthly.clone(),
        start_date: None,
        end_date: None,
        price: None,
        discount: None,
        notes: None,
        payment: Some(PaymentEntry { amount: 3000, method: "JazzCash".into(), reference: Some("TID123".into()), note: None, paid_at: None }),
    })
    .unwrap();
    assert_eq!(res.start_date, "2026-11-02");
    assert_eq!(res.end_date, "2026-12-01");
    assert_eq!(res.balance_after, 0);
    assert_eq!(memberships::status_of(&g.conn, &clock("2026-11-06"), &id).unwrap(), MemberStatus::Active);

    // Overlapping period is refused.
    let overlap = memberships::renew(&mut g.conn, &owner, &clock("2026-11-06"), RenewInput {
        member_id: id.clone(),
        plan_id: monthly,
        start_date: Some("2026-11-20".into()),
        end_date: None,
        price: None,
        discount: None,
        notes: None,
        payment: None,
    });
    assert!(matches!(overlap, Err(CoreError::Conflict(_))));
}

#[test]
fn statuses_follow_dates() {
    let mut g = gym();
    let id = register(&mut g, "2026-10-02", "Bilal Ahmed", "03001234567", 3500).member_id;
    let s = |date: &str, g: &Gym| memberships::status_of(&g.conn, &clock(date), &id).unwrap();
    assert_eq!(s("2026-10-10", &g), MemberStatus::Active);
    assert_eq!(s("2026-10-26", &g), MemberStatus::Expiring); // 6 days left
    assert_eq!(s("2026-11-01", &g), MemberStatus::Expiring); // last day
    assert_eq!(s("2026-11-02", &g), MemberStatus::Expired);
    let owner = g.owner.clone();
    members::archive(&mut g.conn, &owner, &clock("2026-12-01"), &id, Some("Moved to Lahore".into())).unwrap();
    assert_eq!(s("2026-12-01", &g), MemberStatus::Archived);
}

#[test]
fn freeze_extends_membership_and_later_renewals_and_unfreeze_gives_days_back() {
    let mut g = gym();
    let owner = g.owner.clone();
    let id = register(&mut g, "2026-10-02", "Faisal Iqbal", "03001234567", 3500).member_id;
    // Early renewal: Nov 2 – Dec 1.
    let monthly = g.monthly.clone();
    memberships::renew(&mut g.conn, &owner, &clock("2026-10-20"), RenewInput {
        member_id: id.clone(), plan_id: monthly, start_date: None, end_date: None, price: None, discount: None, notes: None, payment: None,
    })
    .unwrap();
    // Freeze 10 days from Oct 21 → current ends Nov 11, renewal moves to Nov 12 – Dec 11.
    let f = memberships::freeze(&mut g.conn, &owner, &clock("2026-10-21"), FreezeInput { member_id: id.clone(), start_date: None, days: 10, reason: None }).unwrap();
    assert_eq!(f.end_date, "2026-10-30");
    assert_eq!(memberships::status_of(&g.conn, &clock("2026-10-25"), &id).unwrap(), MemberStatus::Frozen);
    let subs = memberships::list_for_member(&g.conn, "2026-10-25", &id).unwrap();
    let ends: Vec<(&str, &str)> = subs.iter().map(|s| (s.start_date.as_str(), s.end_date.as_str())).collect();
    assert!(ends.contains(&("2026-10-02", "2026-11-11")));
    assert!(ends.contains(&("2026-11-12", "2026-12-11")));

    // Back after 4 days (Oct 25): 6 days returned.
    memberships::end_freeze(&mut g.conn, &owner, &clock("2026-10-25"), &f.id).unwrap();
    let subs = memberships::list_for_member(&g.conn, "2026-10-25", &id).unwrap();
    let ends: Vec<(&str, &str)> = subs.iter().map(|s| (s.start_date.as_str(), s.end_date.as_str())).collect();
    assert!(ends.contains(&("2026-10-02", "2026-11-05")));
    assert!(ends.contains(&("2026-11-06", "2026-12-05")));
    assert_eq!(memberships::status_of(&g.conn, &clock("2026-10-25"), &id).unwrap(), MemberStatus::Active);
    let freezes = memberships::list_freezes(&g.conn, "2026-10-25", &id).unwrap();
    assert_eq!(freezes[0].days, 4);
}

#[test]
fn voids_fix_mistakes_but_rows_are_never_deleted() {
    let mut g = gym();
    let owner = g.owner.clone();
    let r = register(&mut g, "2026-10-02", "Kashif Malik", "03001234567", 3500);
    let pid = r.payment.unwrap().payment_id;

    // Staff cannot void.
    let staff_user = auth::create_user(&mut g.conn, &owner, &clock("2026-10-02"), NewUserInput { name: "Ali".into(), role: Role::Staff, pin: "1111".into() }).unwrap();
    let staff = auth::login(&mut g.conn, &clock("2026-10-02"), &staff_user.id, "1111").unwrap();
    assert!(matches!(billing::void_payment(&mut g.conn, &staff, &clock("2026-10-02"), &pid, "typo"), Err(CoreError::Forbidden)));

    billing::void_payment(&mut g.conn, &owner, &clock("2026-10-02"), &pid, "Entered twice").unwrap();
    let m = members::get(&g.conn, &clock("2026-10-02"), &r.member_id).unwrap();
    assert_eq!(m.balance, 3500);
    assert!(billing::void_payment(&mut g.conn, &owner, &clock("2026-10-02"), &pid, "again").is_err());

    // Database refuses deletes and edits that would hide history.
    assert!(g.conn.execute("DELETE FROM payments WHERE id = ?1", [&pid]).is_err());
    assert!(g.conn.execute("UPDATE payments SET amount = 1 WHERE id = ?1", [&pid]).is_err());
    assert!(g.conn.execute("DELETE FROM audit_log", []).is_err());
    assert!(g.conn.execute("UPDATE audit_log SET summary = 'x'", []).is_err());

    // Receipt still exists, marked void, and the number is never reused.
    let receipt = billing::get_receipt(&g.conn, &pid).unwrap();
    assert!(receipt.voided_at.is_some());
    let p2 = billing::record_payment(&mut g.conn, &owner, &clock("2026-10-02"), RecordPaymentInput {
        member_id: r.member_id.clone(), amount: 3500, method: "Cash".into(), reference: None, note: None, paid_at: None, subscription_id: None,
    })
    .unwrap();
    assert_eq!(p2.receipt_no, "R-000002");
    assert_eq!(p2.balance_after, 0);
}

#[test]
fn staff_cannot_backdate_and_see_limited_payment_history() {
    let mut g = gym();
    let owner = g.owner.clone();
    let r = register(&mut g, "2026-09-01", "Old Member", "03001234567", 0);
    let user = auth::create_user(&mut g.conn, &owner, &clock("2026-10-02"), NewUserInput { name: "Desk".into(), role: Role::Staff, pin: "2222".into() }).unwrap();
    let staff = auth::login(&mut g.conn, &clock("2026-10-02"), &user.id, "2222").unwrap();
    let backdated = billing::record_payment(&mut g.conn, &staff, &clock("2026-10-02"), RecordPaymentInput {
        member_id: r.member_id.clone(), amount: 500, method: "Cash".into(), reference: None, note: None,
        paid_at: Some("2026-09-15".into()), subscription_id: None,
    });
    assert!(matches!(backdated, Err(CoreError::Forbidden)));
    // Owner can.
    billing::record_payment(&mut g.conn, &owner, &clock("2026-10-02"), RecordPaymentInput {
        member_id: r.member_id.clone(), amount: 500, method: "Cash".into(), reference: None, note: None,
        paid_at: Some("2026-09-15".into()), subscription_id: None,
    })
    .unwrap();
    // Future dates are refused for everyone.
    assert!(billing::record_payment(&mut g.conn, &owner, &clock("2026-10-02"), RecordPaymentInput {
        member_id: r.member_id.clone(), amount: 500, method: "Cash".into(), reference: None, note: None,
        paid_at: Some("2026-10-05".into()), subscription_id: None,
    })
    .is_err());

    let list = billing::list_payments(&g.conn, &staff, &clock("2026-10-02"), &PaymentQuery::default()).unwrap();
    assert_eq!(list.total, 0, "staff only see the last few days");
    assert_eq!(list.visible_from.as_deref(), Some("2026-09-30"));
    let list = billing::list_payments(&g.conn, &owner, &clock("2026-10-02"), &PaymentQuery::default()).unwrap();
    assert_eq!(list.total, 1);
}

#[test]
fn existing_member_migration_does_not_count_as_todays_income() {
    let mut g = gym();
    let owner = g.owner.clone();
    let quarterly = g.quarterly.clone();
    let mut input = person("Register Member", "03001234567");
    input.join_date = Some("2025-03-10".into());
    input.member_code = Some("117".into());
    let r = members::register(&mut g.conn, &owner, &clock("2026-10-02"), RegisterMemberInput {
        member: input,
        photo: None,
        membership: Some(NewMembershipInput {
            plan_id: quarterly, start_date: Some("2026-09-10".into()), end_date: None, price: None, discount: None, notes: None,
        }),
        admission_fee: Some(1000), // ignored for existing members
        payment: Some(PaymentEntry { amount: 8000, method: "Cash".into(), reference: None, note: None, paid_at: None }),
        existing_member: Some(true),
    })
    .unwrap();
    assert_eq!(r.member_code, "117");
    assert_eq!(r.balance, 0);
    let receipt = billing::get_receipt(&g.conn, &r.payment.unwrap().payment_id).unwrap();
    assert!(receipt.paid_at.starts_with("2026-09-10"));
    let dash = stats::dashboard(&g.conn, &owner, &clock("2026-10-02")).unwrap();
    assert_eq!(dash.kpis.collected_today, 0);
    assert_eq!(dash.kpis.collected_month, 0);
    assert_eq!(dash.kpis.new_members_month, 0);
    assert_eq!(dash.kpis.active_members, 1);
}

#[test]
fn check_in_warns_and_ignores_quick_repeats() {
    let mut g = gym();
    let owner = g.owner.clone();
    let paid = register(&mut g, "2026-10-02", "Paid Member", "03001234567", 3500).member_id;
    let owing = register(&mut g, "2026-10-02", "Owing Member", "03007654321", 1000).member_id;

    let c = Clock::fixed("2026-10-03", "07:00:00");
    let ok = attendance::check_in(&mut g.conn, &owner, &c, attendance::CheckInInput { member_id: paid.clone(), method: None }).unwrap();
    assert_eq!(ok.outcome, attendance::CheckInOutcome::Ok);
    assert!(ok.warnings.is_empty());

    let again = attendance::check_in(&mut g.conn, &owner, &Clock::fixed("2026-10-03", "07:30:00"), attendance::CheckInInput { member_id: paid.clone(), method: None }).unwrap();
    assert_eq!(again.outcome, attendance::CheckInOutcome::Duplicate);

    let evening = attendance::check_in(&mut g.conn, &owner, &Clock::fixed("2026-10-03", "19:00:00"), attendance::CheckInInput { member_id: paid.clone(), method: None }).unwrap();
    assert_eq!(evening.outcome, attendance::CheckInOutcome::Ok);
    assert_eq!(evening.visits_this_month, 2);

    let due = attendance::check_in(&mut g.conn, &owner, &c, attendance::CheckInInput { member_id: owing, method: None }).unwrap();
    assert!(due.warnings.iter().any(|w| w.contains("Fee due")));

    let m = members::get(&g.conn, &Clock::fixed("2026-10-03", "20:00:00"), &paid).unwrap();
    assert_eq!(m.visit_count, 2);
    assert_eq!(m.last_visit_at.as_deref(), Some("2026-10-03 19:00:00"));
}

#[test]
fn dues_are_aged_oldest_first() {
    let mut g = gym();
    let owner = g.owner.clone();
    let id = register(&mut g, "2026-08-01", "Slow Payer", "03001234567", 0).member_id; // 2500 + 1000 due on Aug 1
    let monthly = g.monthly.clone();
    memberships::renew(&mut g.conn, &owner, &clock("2026-09-01"), RenewInput {
        member_id: id.clone(), plan_id: monthly, start_date: None, end_date: None, price: None, discount: None, notes: None, payment: None,
    })
    .unwrap(); // +3000 on Sep 1
    billing::record_payment(&mut g.conn, &owner, &clock("2026-09-05"), RecordPaymentInput {
        member_id: id.clone(), amount: 3000, method: "Cash".into(), reference: None, note: None, paid_at: None, subscription_id: None,
    })
    .unwrap();
    let c = clock("2026-10-02");
    let settings = danish_core::settings::load(&g.conn).unwrap();
    let dues = billing::dues(&g.conn, &c, &settings, &DuesQuery::default()).unwrap();
    assert_eq!(dues.total, 1);
    assert_eq!(dues.total_amount, 3500);
    // 3000 paid covers the Aug charges (2500 membership + 500 of admission).
    assert_eq!(dues.items[0].oldest_due_date.as_deref(), Some("2026-08-01"));
    assert_eq!(dues.aging.d61_90, 500);
    assert_eq!(dues.aging.d0_30 + dues.aging.d31_60, 3000);

    let ledger = billing::member_ledger(&g.conn, &id).unwrap();
    assert_eq!(ledger.last().unwrap().balance, 3500);
}

#[test]
fn member_list_filters_and_counts() {
    let mut g = gym();
    let owner = g.owner.clone();
    register(&mut g, "2026-10-01", "Active One", "03001000001", 3500);
    register(&mut g, "2026-08-01", "Expired One", "03001000002", 3500);
    register(&mut g, "2026-09-05", "Expiring One", "03001000003", 1000);
    members::register(&mut g.conn, &owner, &clock("2026-10-02"), RegisterMemberInput {
        member: person("No Plan", "03001000004"), photo: None, membership: None, admission_fee: None, payment: None, existing_member: None,
    })
    .unwrap();
    let c = clock("2026-10-02");
    let counts = members::counts(&g.conn, &c, None).unwrap();
    assert_eq!(counts.all, 4);
    assert_eq!(counts.active, 2);
    assert_eq!(counts.expiring, 1);
    assert_eq!(counts.expired, 1);
    assert_eq!(counts.no_plan, 1);
    assert_eq!(counts.dues, 1);

    let page = members::list(&g.conn, &c, &MemberQuery { filter: Some(MemberFilter::Expiring), ..Default::default() }).unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].full_name, "Expiring One");

    let found = members::list(&g.conn, &c, &MemberQuery { search: Some("0300-1000002".into()), ..Default::default() }).unwrap();
    assert_eq!(found.total, 1);
    assert_eq!(found.items[0].full_name, "Expired One");

    let quick = members::quick_search(&g.conn, &c, "df-0001", 5).unwrap();
    assert_eq!(quick[0].member_code, "DF-0001");
}

#[test]
fn quick_search_puts_name_matches_before_other_fields() {
    let mut g = gym();
    let owner = g.owner.clone();
    let add = |g: &mut Gym, name: &str, father: Option<&str>, phone: &str| {
        let member = MemberInput { father_name: father.map(Into::into), ..person(name, phone) };
        members::register(&mut g.conn, &owner, &clock("2026-10-01"), RegisterMemberInput {
            member, photo: None, membership: None, admission_fee: None, payment: None, existing_member: None,
        })
        .unwrap();
    };
    add(&mut g, "Bilal Awan", Some("Imran Khan"), "03001000001");
    add(&mut g, "Awais Khan", None, "03001000002");
    add(&mut g, "Khan Muhammad", None, "03001000003");
    add(&mut g, "Ali Khanzada", None, "03001000004");
    add(&mut g, "Saad Ali", None, "03001000005");
    let names: Vec<String> =
        members::quick_search(&g.conn, &clock("2026-10-02"), "khan", 10).unwrap().into_iter().map(|m| m.full_name).collect();
    assert_eq!(names, ["Khan Muhammad", "Ali Khanzada", "Awais Khan", "Bilal Awan"]);
}

#[test]
fn dashboard_numbers_add_up() {
    let mut g = gym();
    let owner = g.owner.clone();
    register(&mut g, "2026-10-02", "A One", "03001000001", 3500);
    register(&mut g, "2026-10-02", "B Two", "03001000002", 2000);
    register(&mut g, "2026-09-15", "C Three", "03001000003", 3500);
    let d = stats::dashboard(&g.conn, &owner, &clock("2026-10-02")).unwrap();
    assert_eq!(d.kpis.collected_today, 5500);
    assert_eq!(d.kpis.collected_month, 5500);
    assert_eq!(d.kpis.collected_prev_month, 3500);
    assert_eq!(d.kpis.new_members_month, 2);
    assert_eq!(d.kpis.dues_total, 1500);
    assert_eq!(d.kpis.active_members, 3);
    assert_eq!(d.months.len(), 12);
    assert_eq!(d.months.last().unwrap().collected, 5500);
    assert_eq!(d.days.len(), 30);
    assert_eq!(d.methods_month[0].method, "Cash");

    // Staff without revenue access: monthly money is hidden, today's collection stays.
    let user = auth::create_user(&mut g.conn, &owner, &clock("2026-10-02"), NewUserInput { name: "Desk".into(), role: Role::Staff, pin: "2222".into() }).unwrap();
    let staff = auth::login(&mut g.conn, &clock("2026-10-02"), &user.id, "2222").unwrap();
    let d = stats::dashboard(&g.conn, &staff, &clock("2026-10-02")).unwrap();
    assert!(!d.show_revenue);
    assert_eq!(d.kpis.collected_today, 5500);
    assert_eq!(d.kpis.collected_month, 0);
    assert!(d.months.iter().all(|m| m.collected == 0));
}

#[test]
fn reports_compute_totals() {
    let mut g = gym();
    let owner = g.owner.clone();
    register(&mut g, "2026-10-02", "A One", "03001000001", 3500);
    let range = stats::DateRange { from: "2026-10-01".into(), to: "2026-10-31".into() };
    let col = stats::collections_report(&g.conn, &owner, &range).unwrap();
    assert_eq!(col.total, 3500);
    assert_eq!(col.billed_total, 3500);
    assert_eq!(col.discounts_total, 500);
    let closing = stats::daily_closing(&g.conn, &owner, &clock("2026-10-02"), "2026-10-02").unwrap();
    assert_eq!(closing.total_collected, 3500);
    assert_eq!(closing.cash_collected, 3500);
    assert_eq!(closing.new_members, 1);
    let pnl = stats::pnl_report(&g.conn, &owner, 2026).unwrap();
    assert_eq!(pnl.total_income, 3500);
}

#[test]
fn inactivity_is_only_judged_once_check_ins_cover_a_full_window() {
    use danish_core::messages::{self, ReminderKind};
    use danish_core::settings::{self, SettingsUpdate};

    let mut g = gym();
    let owner = g.owner.clone();
    let regular = register(&mut g, "2026-10-01", "Regular Visitor", "03001000001", 3500).member_id;
    register(&mut g, "2026-10-01", "Never Comes", "03001000002", 3500);
    let inactive = |g: &Gym, day: &str| members::counts(&g.conn, &clock(day), None).unwrap().inactive;
    let queue = |g: &Gym, day: &str| messages::reminder_queue(&g.conn, &clock(day), ReminderKind::Inactive, 50).unwrap().len();
    let visit = |g: &mut Gym, day: &str| {
        attendance::check_in(&mut g.conn, &owner, &Clock::fixed(day, "18:00:00"), attendance::CheckInInput { member_id: regular.clone(), method: None })
            .unwrap();
    };

    // A gym that does not record check-ins never sees everyone flagged as "inactive".
    assert_eq!(inactive(&g, "2026-10-20"), 0);
    assert_eq!(queue(&g, "2026-10-20"), 0);

    // Check-ins started on the 7th: with a 10-day window nothing can be judged on the 12th yet.
    visit(&mut g, "2026-10-07");
    assert_eq!(inactive(&g, "2026-10-12"), 0);

    // From the 20th the window is covered: the member who never came is flagged, the regular is not.
    visit(&mut g, "2026-10-15");
    assert_eq!(inactive(&g, "2026-10-20"), 1);
    assert_eq!(queue(&g, "2026-10-20"), 1);

    // Attendance switched off in settings: no inactivity tracking at all.
    let mut membership = settings::load(&g.conn).unwrap().membership;
    membership.track_attendance = false;
    settings::update(&mut g.conn, &owner, &clock("2026-10-20"), SettingsUpdate::Membership(membership)).unwrap();
    assert_eq!(inactive(&g, "2026-10-20"), 0);
    assert_eq!(queue(&g, "2026-10-20"), 0);
}

#[test]
fn fee_invoice_lists_what_is_owed_and_the_current_membership() {
    let mut g = gym();
    let owner = g.owner.clone();
    // Monthly 3,000 − 500 discount + 1,000 admission = 3,500; 1,500 paid at registration.
    let id = register(&mut g, "2026-10-01", "Invoice Member", "03001234567", 1500).member_id;
    let c = clock("2026-10-02");
    let inv = billing::fee_invoice(&g.conn, &c, &id).unwrap();
    assert_eq!(inv.number, format!("INV-{}-261002", inv.member_code));
    assert_eq!((inv.total, inv.paid, inv.due, inv.balance), (3500, 1500, 2000, 2000));
    assert_eq!(inv.lines.len(), 2);
    assert_eq!(inv.due_since.as_deref(), Some("2026-10-01"));
    assert!(inv.plan_name.is_some());

    // Paid in full: nothing due, but the current membership's charges still show (as paid).
    billing::record_payment(&mut g.conn, &owner, &c, RecordPaymentInput {
        member_id: id.clone(),
        amount: 2000,
        method: "Cash".into(),
        reference: None,
        note: None,
        paid_at: None,
        subscription_id: None,
    })
    .unwrap();
    let inv = billing::fee_invoice(&g.conn, &c, &id).unwrap();
    assert_eq!((inv.total, inv.paid, inv.due, inv.balance), (3500, 3500, 0, 0));
    assert_eq!(inv.due_since, None);
}
