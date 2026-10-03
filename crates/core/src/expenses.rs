//! Running costs (rent, electricity, salaries, equipment ...) and their categories.

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::audit;
use crate::auth::{Actor, Permission};
use crate::clock::{fmt_date, human_date, human_date_str, parse_date, Clock};
use crate::db::{self, Params};
use crate::error::{CoreError, CoreResult};
use crate::model::paging;
use crate::settings;
use crate::util::{escape_like, format_money, new_id, opt_text_max};

pub const DEFAULT_CATEGORIES: [(&str, &str); 11] = [
    ("Rent", "#6366f1"),
    ("Electricity", "#f59e0b"),
    ("Salaries", "#10b981"),
    ("Equipment", "#0ea5e9"),
    ("Maintenance & Repairs", "#f97316"),
    ("Cleaning", "#14b8a6"),
    ("Water", "#3b82f6"),
    ("Internet & Phone", "#8b5cf6"),
    ("Marketing", "#ec4899"),
    ("Supplements & Stock", "#84cc16"),
    ("Miscellaneous", "#64748b"),
];

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExpenseCategory {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub is_active: bool,
    pub sort_order: i64,
    pub expense_count: i64,
}

#[derive(Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct CategoryInput {
    pub id: Option<String>,
    pub name: String,
    pub color: Option<String>,
    pub is_active: Option<bool>,
}

pub(crate) fn insert_default_categories(conn: &Connection, clock: &Clock) -> CoreResult<()> {
    let now = clock.now_str();
    for (i, (name, color)) in DEFAULT_CATEGORIES.iter().enumerate() {
        conn.execute(
            "INSERT OR IGNORE INTO expense_categories(id, name, color, is_active, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, 1, ?4, ?5, ?5)",
            (new_id(), name, color, i as i64, &now),
        )?;
    }
    Ok(())
}

pub fn list_categories(conn: &Connection, include_inactive: bool) -> CoreResult<Vec<ExpenseCategory>> {
    let mut stmt = conn.prepare_cached(
        "SELECT c.id, c.name, c.color, c.is_active, c.sort_order,
                (SELECT COUNT(*) FROM expenses e WHERE e.category_id = c.id AND e.deleted_at IS NULL)
         FROM expense_categories c WHERE (?1 = 1 OR c.is_active = 1) ORDER BY c.sort_order, c.name",
    )?;
    let rows = stmt.query_map([include_inactive as i64], |r| {
        Ok(ExpenseCategory {
            id: r.get(0)?,
            name: r.get(1)?,
            color: r.get(2)?,
            is_active: r.get(3)?,
            sort_order: r.get(4)?,
            expense_count: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn save_category(conn: &mut Connection, actor: &Actor, clock: &Clock, input: CategoryInput) -> CoreResult<ExpenseCategory> {
    actor.require(Permission::ManageExpenses)?;
    let name = input.name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() || name.chars().count() > 40 {
        return Err(CoreError::validation("name", "Category name is required (max 40 characters)"));
    }
    let tx = db::write_tx(conn)?;
    let dup: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM expense_categories WHERE name = ?1 COLLATE NOCASE AND id != COALESCE(?2, ''))",
        (&name, input.id.as_deref()),
        |r| r.get(0),
    )?;
    if dup {
        return Err(CoreError::validation("name", "This category already exists"));
    }
    let now = clock.now_str();
    let color = opt_text_max(input.color.clone(), 20);
    let id = match &input.id {
        Some(id) => {
            let n = tx.execute(
                "UPDATE expense_categories SET name = ?2, color = ?3, is_active = ?4, updated_at = ?5 WHERE id = ?1",
                (id, &name, &color, input.is_active.unwrap_or(true), &now),
            )?;
            if n == 0 {
                return Err(CoreError::not_found("Category"));
            }
            id.clone()
        }
        None => {
            let id = new_id();
            let sort: i64 = tx.query_row("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM expense_categories", [], |r| r.get(0))?;
            tx.execute(
                "INSERT INTO expense_categories(id, name, color, is_active, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?5)",
                (&id, &name, &color, sort, &now),
            )?;
            id
        }
    };
    audit::record(&tx, actor, clock, "expense_category.save", Some("expense_category"), Some(&id), format!("Saved expense category {name}"), None)?;
    let cat = list_categories(&tx, true)?.into_iter().find(|c| c.id == id).ok_or_else(|| CoreError::not_found("Category"))?;
    tx.commit()?;
    Ok(cat)
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Expense {
    pub id: String,
    pub category_id: String,
    pub category_name: String,
    pub category_color: Option<String>,
    pub amount: i64,
    pub expense_date: String,
    pub method: String,
    pub payee: Option<String>,
    pub description: Option<String>,
    pub created_by_name: Option<String>,
    pub created_at: String,
}

#[derive(Deserialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct ExpenseInput {
    pub id: Option<String>,
    pub category_id: String,
    pub amount: i64,
    pub expense_date: Option<String>,
    pub method: Option<String>,
    pub payee: Option<String>,
    pub description: Option<String>,
}

#[derive(Deserialize, TS, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields = nullable)]
pub struct ExpenseQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    pub category_id: Option<String>,
    pub search: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CategoryTotal {
    pub category_id: String,
    pub name: String,
    pub color: Option<String>,
    pub count: i64,
    pub total: i64,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExpenseList {
    pub items: Vec<Expense>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub total_amount: i64,
    pub by_category: Vec<CategoryTotal>,
}

const EXPENSE_SELECT: &str = "SELECT e.id, e.category_id, c.name, c.color, e.amount, e.expense_date, e.method, e.payee, e.description,
        u.name, e.created_at
     FROM expenses e JOIN expense_categories c ON c.id = e.category_id LEFT JOIN users u ON u.id = e.created_by";

fn row_to_expense(r: &rusqlite::Row<'_>) -> rusqlite::Result<Expense> {
    Ok(Expense {
        id: r.get(0)?,
        category_id: r.get(1)?,
        category_name: r.get(2)?,
        category_color: r.get(3)?,
        amount: r.get(4)?,
        expense_date: r.get(5)?,
        method: r.get(6)?,
        payee: r.get(7)?,
        description: r.get(8)?,
        created_by_name: r.get(9)?,
        created_at: r.get(10)?,
    })
}

pub fn list(conn: &Connection, actor: &Actor, q: &ExpenseQuery) -> CoreResult<ExpenseList> {
    actor.require(Permission::ViewExpenses)?;
    let (page, size, offset) = paging(q.page, q.page_size, 50);
    let mut params = Params::new();
    let mut cond = String::from(" WHERE e.deleted_at IS NULL");
    if let Some(f) = q.from.as_deref().filter(|s| !s.is_empty()) {
        cond.push_str(" AND e.expense_date >= :from");
        params.add(":from", f.to_string());
    }
    if let Some(t) = q.to.as_deref().filter(|s| !s.is_empty()) {
        cond.push_str(" AND e.expense_date <= :to");
        params.add(":to", t.to_string());
    }
    if let Some(c) = q.category_id.as_deref().filter(|s| !s.is_empty()) {
        cond.push_str(" AND e.category_id = :cat");
        params.add(":cat", c.to_string());
    }
    if let Some(s) = q.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        cond.push_str(" AND (e.payee LIKE :like ESCAPE '\\' OR e.description LIKE :like ESCAPE '\\' OR c.name LIKE :like ESCAPE '\\')");
        params.add(":like", format!("%{}%", escape_like(s)));
    }
    let named = params.named();
    let (total, total_amount): (i64, i64) = conn.query_row(
        &format!("SELECT COUNT(*), COALESCE(SUM(e.amount), 0) FROM expenses e JOIN expense_categories c ON c.id = e.category_id {cond}"),
        named.as_slice(),
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT c.id, c.name, c.color, COUNT(*), SUM(e.amount) FROM expenses e JOIN expense_categories c ON c.id = e.category_id {cond}
         GROUP BY c.id ORDER BY SUM(e.amount) DESC"
    ))?;
    let by_category = stmt
        .query_map(named.as_slice(), |r| {
            Ok(CategoryTotal { category_id: r.get(0)?, name: r.get(1)?, color: r.get(2)?, count: r.get(3)?, total: r.get(4)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut list_params = named.clone();
    list_params.push((":limit", &size));
    list_params.push((":offset", &offset));
    let mut stmt = conn.prepare_cached(&format!(
        "{EXPENSE_SELECT} {cond} ORDER BY e.expense_date DESC, e.created_at DESC LIMIT :limit OFFSET :offset"
    ))?;
    let items = stmt.query_map(list_params.as_slice(), row_to_expense)?.collect::<Result<Vec<_>, _>>()?;
    Ok(ExpenseList { items, total, page, page_size: size, total_amount, by_category })
}

fn get(conn: &Connection, id: &str) -> CoreResult<Expense> {
    conn.query_row(&format!("{EXPENSE_SELECT} WHERE e.id = ?1 AND e.deleted_at IS NULL"), [id], row_to_expense)
        .optional()?
        .ok_or_else(|| CoreError::not_found("Expense"))
}

pub fn save(conn: &mut Connection, actor: &Actor, clock: &Clock, input: ExpenseInput) -> CoreResult<Expense> {
    actor.require(Permission::ManageExpenses)?;
    if input.amount <= 0 || input.amount > 100_000_000 {
        return Err(CoreError::validation("amount", "Enter the amount"));
    }
    let today = clock.today();
    let date = match input.expense_date.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(s) => parse_date(s).ok_or_else(|| CoreError::validation("expenseDate", "Invalid date"))?,
        None => today,
    };
    if date > today {
        return Err(CoreError::validation("expenseDate", "Date cannot be in the future"));
    }
    let method = opt_text_max(input.method.clone(), 30).unwrap_or_else(|| "Cash".into());
    let payee = opt_text_max(input.payee.clone(), 80);
    let description = opt_text_max(input.description.clone(), 300);
    let tx = db::write_tx(conn)?;
    let settings = settings::load(&tx)?;
    let cat_name: String = tx
        .query_row("SELECT name FROM expense_categories WHERE id = ?1", [&input.category_id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| CoreError::validation("categoryId", "Choose a category"))?;
    let now = clock.now_str();
    let date_s = fmt_date(date);
    let id = match &input.id {
        Some(id) => {
            let before = get(&tx, id)?;
            tx.execute(
                "UPDATE expenses SET category_id = ?2, amount = ?3, expense_date = ?4, method = ?5, payee = ?6, description = ?7,
                        updated_at = ?8 WHERE id = ?1",
                (id, &input.category_id, input.amount, &date_s, &method, &payee, &description, &now),
            )?;
            audit::record(
                &tx,
                actor,
                clock,
                "expense.update",
                Some("expense"),
                Some(id),
                format!(
                    "Edited expense {} {} → {} {} on {}",
                    before.category_name,
                    format_money(&settings.billing.currency, before.amount),
                    cat_name,
                    format_money(&settings.billing.currency, input.amount),
                    human_date(date)
                ),
                None,
            )?;
            id.clone()
        }
        None => {
            let id = new_id();
            tx.execute(
                "INSERT INTO expenses(id, category_id, amount, expense_date, method, payee, description, created_by, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                (&id, &input.category_id, input.amount, &date_s, &method, &payee, &description, actor.db_user_id(), &now),
            )?;
            audit::record(
                &tx,
                actor,
                clock,
                "expense.create",
                Some("expense"),
                Some(&id),
                format!("Added expense {cat_name} {} on {}", format_money(&settings.billing.currency, input.amount), human_date(date)),
                None,
            )?;
            id
        }
    };
    let e = get(&tx, &id)?;
    tx.commit()?;
    Ok(e)
}

pub fn delete(conn: &mut Connection, actor: &Actor, clock: &Clock, id: &str, reason: Option<String>) -> CoreResult<()> {
    actor.require(Permission::ManageExpenses)?;
    let tx = db::write_tx(conn)?;
    let settings = settings::load(&tx)?;
    let e = get(&tx, id)?;
    let reason = opt_text_max(reason, 200);
    tx.execute(
        "UPDATE expenses SET deleted_at = ?2, deleted_by = ?3, delete_reason = ?4, updated_at = ?2 WHERE id = ?1",
        (id, clock.now_str(), actor.db_user_id(), &reason),
    )?;
    audit::record(
        &tx,
        actor,
        clock,
        "expense.delete",
        Some("expense"),
        Some(id),
        format!(
            "Deleted expense {} {} of {}{}",
            e.category_name,
            format_money(&settings.billing.currency, e.amount),
            human_date_str(&e.expense_date),
            reason.map(|r| format!(": {r}")).unwrap_or_default()
        ),
        None,
    )?;
    tx.commit()?;
    Ok(())
}
