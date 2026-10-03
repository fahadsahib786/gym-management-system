//! Deterministic demo data: a realistic simulated gym history for training, screenshots and performance tests.
//!
//! Members, memberships and payments go through the real services (so balances, receipts and audit rows are
//! genuine). Check-ins are bulk inserted for speed, then summaries are rebuilt.

use chrono::{Datelike, NaiveDate, NaiveDateTime, NaiveTime};
use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::auth::{self, Actor, NewUserInput};
use crate::billing::{self, PaymentEntry, RecordPaymentInput};
use crate::clock::{add_days, fmt_date, fmt_ts, sub_months, Clock};
use crate::error::CoreResult;
use crate::expenses::{self, ExpenseInput};
use crate::members::{self, MemberInput, RegisterMemberInput};
use crate::memberships::{self, FreezeInput, NewMembershipInput, RenewInput};
use crate::model::{Gender, Role};
use crate::plans;
use crate::settings::{self, GymSettings};
use crate::summary;
use crate::system::{self, SetupInput, SetupPlan};

/// Small, fast, deterministic PRNG (xorshift64*).
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed.max(1))
    }
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    /// Uniform in [0, 1).
    pub fn f(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
    pub fn range(&mut self, lo: i64, hi: i64) -> i64 {
        lo + (self.next_u64() % ((hi - lo + 1) as u64)) as i64
    }
    pub fn chance(&mut self, p: f64) -> bool {
        self.f() < p
    }
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[(self.next_u64() % items.len() as u64) as usize]
    }
}

const MALE: &[&str] = &[
    "Muhammad", "Ali", "Ahmed", "Hassan", "Hussain", "Usman", "Bilal", "Hamza", "Umar", "Abdullah", "Zain", "Faisal", "Imran",
    "Kashif", "Asad", "Waqas", "Adeel", "Shahid", "Tariq", "Kamran", "Junaid", "Saad", "Danish", "Fahad", "Arslan", "Haris",
    "Noman", "Rizwan", "Salman", "Sohail", "Talha", "Waleed", "Yasir", "Zeeshan", "Awais", "Shoaib", "Naveed", "Farhan",
];
const FEMALE: &[&str] = &[
    "Ayesha", "Fatima", "Zainab", "Maryam", "Sana", "Hira", "Iqra", "Amna", "Sadia", "Rabia", "Mehwish", "Nimra", "Kiran",
    "Saima", "Sidra", "Areeba", "Laiba", "Mahnoor", "Anum", "Bushra",
];
const SURNAMES: &[&str] = &[
    "Khan", "Ahmed", "Ali", "Hussain", "Malik", "Sheikh", "Qureshi", "Chaudhry", "Butt", "Rana", "Arain", "Baloch", "Siddiqui",
    "Abbasi", "Mughal", "Awan", "Bhatti", "Gill", "Shah", "Raza", "Iqbal", "Javed", "Akram", "Aslam",
];
const AREAS: &[&str] = &[
    "Model Town A", "Model Town B", "Satellite Town", "Shahi Road", "Railway Road", "Grain Market", "Islamia Colony",
    "Gulshan-e-Iqbal", "Madina Town", "Faisal Colony", "Jinnah Colony", "Liaqatpur Road", "Iqbal Town",
];
const OCCUPATIONS: &[&str] = &[
    "Student", "Shopkeeper", "Teacher", "Govt Employee", "Farmer", "Businessman", "Doctor", "Engineer", "Driver", "Banker",
    "Private Job",
];

#[derive(Serialize, TS, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SeedSummary {
    pub members: i64,
    pub subscriptions: i64,
    pub payments: i64,
    pub check_ins: i64,
    pub expenses: i64,
}

struct SimMember {
    id: String,
    plan_id: String,
    end: NaiveDate,
    visit_rate: f64,
    ladies: bool,
    churned: bool,
    renew_delay: i64,
}

fn visit_hour(rng: &mut Rng, ladies: bool) -> (u32, u32) {
    let h = if ladies {
        rng.range(10, 13)
    } else if rng.chance(0.35) {
        rng.range(5, 9)
    } else {
        rng.range(16, 22)
    };
    (h as u32, rng.range(0, 59) as u32)
}

/// Creates (if needed) a configured gym and simulates `months` of history ending at `clock.today()`.
pub fn seed_demo(conn: &mut Connection, clock: &Clock, target_members: usize, months: u32, seed: u64) -> CoreResult<SeedSummary> {
    let mut rng = Rng::new(seed);
    let now = clock.now();
    // Event times never go beyond "now" (otherwise today's data would look like it came from the future).
    let at = |day: NaiveDate, h: u32, m: u32| -> Clock {
        let t = NaiveDateTime::new(day, NaiveTime::from_hms_opt(h, m, 0).expect("valid time"));
        Clock::Fixed(t.min(now - chrono::Duration::minutes(1)))
    };
    let today = clock.today();
    let start = sub_months(today, months);
    conn.execute_batch("PRAGMA synchronous = OFF;")?;

    if !settings::is_setup_complete(conn)? {
        system::complete_setup(
            conn,
            &at(start, 9, 0),
            SetupInput {
                gym: GymSettings { phone: "0300-1234567".into(), ..GymSettings::default() },
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
        )?;
        let admin = Actor::system();
        auth::create_user(conn, &admin, &at(start, 9, 5), NewUserInput { name: "Ali Reception".into(), role: Role::Staff, pin: "1111".into() })?;
    }
    let today_s = fmt_date(today);
    let plan_list = plans::list(conn, &today_s, false)?;
    let pick_plan = |rng: &mut Rng| -> String {
        let roll = rng.f();
        let name = if roll < 0.62 {
            "Monthly"
        } else if roll < 0.80 {
            "Quarterly"
        } else if roll < 0.90 {
            "Half"
        } else if roll < 0.96 {
            "Yearly"
        } else {
            "Daily"
        };
        plan_list.iter().find(|p| p.name.starts_with(name)).unwrap_or(&plan_list[0]).id.clone()
    };
    let methods = ["Cash", "Cash", "Cash", "Cash", "JazzCash", "JazzCash", "Easypaisa", "Bank Transfer", "Raast"];
    let categories = expenses::list_categories(conn, false)?;
    let cat = |name: &str| categories.iter().find(|c| c.name.starts_with(name)).map(|c| c.id.clone()).unwrap_or_default();
    let owner = auth::list_users(conn, false)?.into_iter().find(|u| u.role == Role::Admin).map(|u| u.id).unwrap_or_default();
    let actor = auth::refresh_actor(conn, &owner)?;

    let total_days = (today - start).num_days().max(1);
    // Daily join weights: busier in January and summer, quieter in Ramadan-ish March, with day-to-day noise.
    let join_weights: Vec<f64> = (0..=total_days)
        .map(|i| {
            let season = match add_days(start, i).month() {
                1 => 1.6,
                6 | 7 => 1.3,
                3 => 0.6,
                _ => 1.0,
            };
            season * (0.3 + rng.f() * 1.4)
        })
        .collect();
    let total_weight: f64 = join_weights.iter().sum();
    let mut weight_so_far = 0.0;
    let mut sims: Vec<SimMember> = Vec::new();
    let mut summary_out = SeedSummary::default();
    let mut visits: Vec<(String, String)> = Vec::new();
    let mut day = start;
    let mut registered = 0usize;

    while day <= today {
        // Expenses at the start of each month, plus occasional repairs.
        if day.day() == 2 {
            let summer = (5..=9).contains(&day.month());
            let mut add = |c: &str, amount: i64, payee: &str| -> CoreResult<()> {
                expenses::save(conn, &actor, &at(day, 12, 0), ExpenseInput {
                    id: None,
                    category_id: cat(c),
                    amount,
                    expense_date: None,
                    method: Some(if amount > 20000 { "Bank Transfer".into() } else { "Cash".into() }),
                    payee: Some(payee.into()),
                    description: None,
                })?;
                summary_out.expenses += 1;
                Ok(())
            };
            add("Rent", 60000, "Building owner")?;
            add("Electricity", if summer { rng.range(42000, 58000) } else { rng.range(18000, 28000) }, "MEPCO")?;
            add("Salaries", 70000, "Trainers & staff")?;
            add("Internet", 2500, "PTCL")?;
            add("Water", 1500, "Water supplier")?;
        }
        if rng.chance(0.03) {
            expenses::save(conn, &actor, &at(day, 15, 0), ExpenseInput {
                id: None,
                category_id: cat(if rng.chance(0.5) { "Maintenance" } else { "Equipment" }),
                amount: rng.range(2, 40) * 500,
                expense_date: None,
                method: Some("Cash".into()),
                payee: None,
                description: Some("Repairs / small equipment".into()),
            })?;
            summary_out.expenses += 1;
        }

        // New members follow the weights and reach exactly `target_members` by today (randomly rounded per day).
        weight_so_far += join_weights[(day - start).num_days() as usize];
        let due = (target_members as f64 * weight_so_far / total_weight + rng.f() - 0.5).round().max(0.0) as usize;
        let new_today = due.min(target_members).saturating_sub(registered);
        for _ in 0..new_today {
            registered += 1;
            let female = rng.chance(0.14);
            let first = if female { *rng.pick(FEMALE) } else { *rng.pick(MALE) };
            let name = format!("{} {}", first, rng.pick(SURNAMES));
            let plan_id = pick_plan(&mut rng);
            let plan = plan_list.iter().find(|p| p.id == plan_id).expect("plan");
            let discount = if rng.chance(0.15) { (plan.price / 10 / 100) * 100 } else { 0 };
            let total = plan.price - discount + 1000;
            let paid = if rng.chance(0.85) { total } else if rng.chance(0.6) { total / 2 } else { 0 };
            let (h, m) = (rng.range(8, 21) as u32, rng.range(0, 59) as u32);
            let res = members::register(conn, &actor, &at(day, h, m), RegisterMemberInput {
                member: MemberInput {
                    member_code: None,
                    full_name: name,
                    father_name: Some(format!("{} {}", rng.pick(MALE), rng.pick(SURNAMES))),
                    gender: if female { Gender::Female } else { Gender::Male },
                    date_of_birth: Some(fmt_date(add_days(day, -rng.range(16 * 365, 48 * 365)))),
                    phone: format!("03{:02}{:07}", rng.range(0, 49), rng.range(0, 9_999_999)),
                    area: Some(rng.pick(AREAS).to_string()),
                    occupation: Some(rng.pick(OCCUPATIONS).to_string()),
                    timing: Some(if female { "Ladies".into() } else if rng.chance(0.35) { "Morning".into() } else { "Evening".into() }),
                    // Unique, valid-looking CNICs (district code of Rahim Yar Khan) for most members.
                    cnic: rng
                        .chance(0.75)
                        .then(|| format!("31303-{:07}-{}", 1_000_000 + (registered as u64 * 7919) % 9_000_000, rng.range(1, 9))),
                    blood_group: rng.chance(0.65).then(|| rng.pick(&["A+", "B+", "B+", "O+", "O+", "AB+", "A-", "B-", "O-"]).to_string()),
                    source: Some(rng.pick(&["Walk-in", "Friend / Family", "Friend / Family", "Facebook", "Instagram", "Banner / Flex"]).to_string()),
                    ..Default::default()
                },
                photo: None,
                membership: Some(NewMembershipInput { plan_id: plan_id.clone(), start_date: None, end_date: None, price: None, discount: Some(discount), notes: None }),
                admission_fee: Some(1000),
                payment: (paid > 0).then(|| PaymentEntry { amount: paid, method: rng.pick(&methods).to_string(), reference: None, note: None, paid_at: None }),
                existing_member: Some(false),
            })?;
            summary_out.members += 1;
            summary_out.subscriptions += 1;
            if paid > 0 {
                summary_out.payments += 1;
            }
            let end = plans::period_end(day, plan.duration_value, plan.duration_unit);
            sims.push(SimMember {
                id: res.member_id,
                plan_id,
                end,
                visit_rate: 0.25 + rng.f() * 0.55,
                ladies: female,
                churned: false,
                renew_delay: if rng.chance(0.72) { rng.range(-3, 8) } else { 999 },
            });
        }

        // Renewals and churn.
        for sim in sims.iter_mut() {
            if sim.churned {
                continue;
            }
            let due = add_days(sim.end, sim.renew_delay);
            if sim.renew_delay == 999 && day > add_days(sim.end, 1) {
                sim.churned = true;
                continue;
            }
            if day == due {
                let plan_id = if rng.chance(0.85) { sim.plan_id.clone() } else { pick_plan(&mut rng) };
                let plan = plan_list.iter().find(|p| p.id == plan_id).expect("plan");
                let paid = if rng.chance(0.88) { plan.price } else { plan.price / 2 };
                let result = memberships::renew(conn, &actor, &at(day, rng.range(8, 21) as u32, rng.range(0, 59) as u32), RenewInput {
                    member_id: sim.id.clone(),
                    plan_id: plan_id.clone(),
                    start_date: None,
                    end_date: None,
                    price: None,
                    discount: None,
                    notes: None,
                    payment: Some(PaymentEntry { amount: paid, method: rng.pick(&methods).to_string(), reference: None, note: None, paid_at: None }),
                });
                if let Ok(r) = result {
                    summary_out.subscriptions += 1;
                    summary_out.payments += 1;
                    sim.plan_id = plan_id;
                    sim.end = crate::clock::parse_date(&r.end_date).unwrap_or(sim.end);
                    sim.renew_delay = if rng.chance(0.78) { rng.range(-3, 8) } else { 999 };
                }
            }
            // Occasional freeze for travel.
            if !sim.churned && day <= sim.end && rng.chance(0.0008) {
                let days = rng.range(7, 20);
                if memberships::freeze(conn, &actor, &at(day, 11, 0), FreezeInput { member_id: sim.id.clone(), start_date: None, days, reason: Some("Travelling".into()) }).is_ok() {
                    sim.end = add_days(sim.end, days);
                }
            }
        }

        // Dues being cleared.
        if rng.chance(0.6) {
            let debtors: Vec<(String, i64)> = {
                let mut stmt = conn.prepare("SELECT member_id, balance FROM member_stats WHERE balance > 0 ORDER BY member_id")?;
                stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<Vec<_>, _>>()?
            };
            for (member_id, balance) in debtors {
                if rng.chance(0.08) {
                    billing::record_payment(conn, &actor, &at(day, rng.range(9, 21) as u32, rng.range(0, 59) as u32), RecordPaymentInput {
                        member_id,
                        amount: if rng.chance(0.7) { balance } else { (balance / 2).max(100) },
                        method: rng.pick(&methods).to_string(),
                        reference: None,
                        note: None,
                        paid_at: None,
                        subscription_id: None,
                    })?;
                    summary_out.payments += 1;
                }
            }
        }

        // Visits (Friday is a lighter day locally).
        let weekday_factor = if day.weekday() == chrono::Weekday::Fri { 0.6 } else { 1.0 };
        for s in sims.iter() {
            if s.churned || day > s.end {
                continue;
            }
            if rng.chance(s.visit_rate * weekday_factor) {
                let (h, m) = visit_hour(&mut rng, s.ladies);
                let ts = NaiveDateTime::new(day, NaiveTime::from_hms_opt(h, m, rng.range(0, 59) as u32).expect("valid time"));
                if ts <= clock.now() {
                    visits.push((s.id.clone(), fmt_ts(ts)));
                }
            }
        }
        day = add_days(day, 1);
    }

    // A couple of corrected mistakes, so voids appear in reports.
    let recent: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM payments WHERE voided_at IS NULL ORDER BY paid_at DESC LIMIT 40")?;
        stmt.query_map([], |r| r.get(0))?.collect::<Result<Vec<_>, _>>()?
    };
    for id in recent.iter().skip(7).step_by(19).take(2) {
        billing::void_payment(conn, &actor, clock, id, "Entered twice by mistake")?;
    }

    // Bulk insert check-ins.
    {
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO attendance(member_id, checked_in_at, method, created_by) VALUES (?1, ?2, ?3, ?4)",
            )?;
            for (member_id, ts) in &visits {
                stmt.execute((member_id, ts, if rng.chance(0.3) { "scan" } else { "manual" }, &owner))?;
            }
        }
        summary::refresh_all(&tx)?;
        tx.commit()?;
    }
    summary_out.check_ins = visits.len() as i64;
    conn.execute_batch("PRAGMA synchronous = FULL;")?;
    Ok(summary_out)
}
