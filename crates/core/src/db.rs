//! Connection management, pragmas and schema migrations.

use std::path::{Path, PathBuf};
use std::sync::RwLock;

use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior};

use crate::error::{CoreError, CoreResult};

pub type Pool = r2d2::Pool<SqliteConnectionManager>;

/// Ordered list of migrations; index + 1 = schema version stored in `PRAGMA user_version`.
const MIGRATIONS: &[&str] = &[include_str!("../migrations/0001_init.sql")];

/// Current schema version understood by this build.
pub const SCHEMA_VERSION: i64 = MIGRATIONS.len() as i64;

/// Per-connection settings. `synchronous=FULL` keeps committed data safe through power cuts.
pub fn apply_pragmas(conn: &Connection) -> rusqlite::Result<()> {
    // Screens reuse a few dozen queries; keep them all prepared.
    conn.set_prepared_statement_cache_capacity(256);
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;
         PRAGMA synchronous = FULL;
         PRAGMA temp_store = MEMORY;
         PRAGMA cache_size = -16000;",
    )
}

/// Brings the schema up to date. Refuses to open databases created by a newer version.
pub fn migrate(conn: &mut Connection) -> CoreResult<()> {
    let current: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if current > SCHEMA_VERSION {
        return Err(CoreError::other(format!(
            "This data was created by a newer version of Danish Fitness (schema {current}). Please update the app."
        )));
    }
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (index + 1) as i64)?;
        tx.commit()?;
        log::info!("database migrated to schema version {}", index + 1);
    }
    Ok(())
}

/// Opens (creating if needed) a database file, enables WAL and runs migrations.
pub fn open_file(path: &Path) -> CoreResult<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    apply_pragmas(&conn)?;
    migrate(&mut conn)?;
    Ok(conn)
}

/// In-memory database with the full schema (tests and tools).
pub fn open_memory() -> CoreResult<Connection> {
    let mut conn = Connection::open_in_memory()?;
    apply_pragmas(&conn)?;
    migrate(&mut conn)?;
    Ok(conn)
}

/// Opens a pooled database. Migrations run once on a dedicated connection first.
pub fn open_pool(path: &Path, size: u32) -> CoreResult<Pool> {
    drop(open_file(path)?);
    let manager = SqliteConnectionManager::file(path).with_init(|c| apply_pragmas(c));
    let pool = r2d2::Pool::builder().max_size(size).min_idle(Some(1)).build(manager)?;
    Ok(pool)
}

/// Starts a write transaction that takes the write lock up front (avoids lock-upgrade deadlocks).
pub fn write_tx(conn: &mut Connection) -> CoreResult<Transaction<'_>> {
    Ok(conn.transaction_with_behavior(TransactionBehavior::Immediate)?)
}

/// Increments and returns a named counter (receipt numbers, member codes).
pub fn next_counter(conn: &Connection, name: &str) -> CoreResult<i64> {
    let value = conn.query_row(
        "INSERT INTO counters(name, value) VALUES (?1, 1)
         ON CONFLICT(name) DO UPDATE SET value = value + 1
         RETURNING value",
        [name],
        |r| r.get(0),
    )?;
    Ok(value)
}

/// Current value of a counter without changing it (0 when unused).
pub fn peek_counter(conn: &Connection, name: &str) -> CoreResult<i64> {
    let value: Option<i64> =
        conn.query_row("SELECT value FROM counters WHERE name = ?1", [name], |r| r.get(0)).optional()?;
    Ok(value.unwrap_or(0))
}

/// Named SQL parameters collected while building a dynamic query.
#[derive(Default)]
pub struct Params {
    items: Vec<(String, Box<dyn rusqlite::ToSql>)>,
}

impl Params {
    pub fn new() -> Self {
        Params::default()
    }

    pub fn add(&mut self, name: &str, value: impl rusqlite::ToSql + 'static) -> &mut Self {
        self.items.push((name.to_string(), Box::new(value)));
        self
    }

    pub fn named(&self) -> Vec<(&str, &dyn rusqlite::ToSql)> {
        self.items.iter().map(|(k, v)| (k.as_str(), v.as_ref())).collect()
    }
}

/// Runs SQLite's fast structural check.
pub fn quick_check(conn: &Connection) -> CoreResult<bool> {
    let result: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
    Ok(result == "ok")
}

pub fn schema_version(conn: &Connection) -> CoreResult<i64> {
    Ok(conn.pragma_query_value(None, "user_version", |r| r.get(0))?)
}

/// A pooled database that can be closed and reopened in place (used by restore).
pub struct Database {
    path: PathBuf,
    pool: RwLock<Option<Pool>>,
}

impl Database {
    pub fn open(path: &Path) -> CoreResult<Database> {
        let pool = open_pool(path, 4)?;
        Ok(Database { path: path.to_path_buf(), pool: RwLock::new(Some(pool)) })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Runs `f` with a pooled connection. Holds a read lock so restore can wait for in-flight work.
    pub fn with_conn<T>(&self, f: impl FnOnce(&mut Connection) -> CoreResult<T>) -> CoreResult<T> {
        let guard = self.pool.read().map_err(|_| CoreError::other("database lock poisoned"))?;
        let pool = guard.as_ref().ok_or_else(|| CoreError::other("The database is being restored. Try again."))?;
        let mut conn = pool.get()?;
        f(&mut conn)
    }

    /// Closes every connection, lets `f` replace/modify the file, then reopens (re-running migrations).
    pub fn replace<T>(&self, f: impl FnOnce(&Path) -> CoreResult<T>) -> CoreResult<T> {
        let mut guard = self.pool.write().map_err(|_| CoreError::other("database lock poisoned"))?;
        if let Some(pool) = guard.take() {
            drop(pool);
        }
        let result = f(&self.path);
        // Always try to reopen, even if `f` failed, so the app keeps working on the old file.
        *guard = Some(open_pool(&self.path, 4)?);
        result
    }

    /// Checkpoints the WAL and optimises statistics (call on shutdown).
    pub fn shutdown(&self) {
        let _ = self.with_conn(|c| {
            c.execute_batch("PRAGMA optimize; PRAGMA wal_checkpoint(TRUNCATE);")?;
            Ok(())
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_apply_and_counters_work() {
        let conn = open_memory().unwrap();
        assert_eq!(schema_version(&conn).unwrap(), SCHEMA_VERSION);
        assert_eq!(peek_counter(&conn, "receipt_no").unwrap(), 0);
        assert_eq!(next_counter(&conn, "receipt_no").unwrap(), 1);
        assert_eq!(next_counter(&conn, "receipt_no").unwrap(), 2);
        assert_eq!(peek_counter(&conn, "receipt_no").unwrap(), 2);
        assert!(quick_check(&conn).unwrap());
    }

    #[test]
    fn file_database_reopens_and_replaces() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let db = Database::open(&path).unwrap();
        db.with_conn(|c| {
            next_counter(c, "x")?;
            Ok(())
        })
        .unwrap();
        db.replace(|p| {
            assert!(p.exists());
            Ok(())
        })
        .unwrap();
        let v = db.with_conn(|c| peek_counter(c, "x")).unwrap();
        assert_eq!(v, 1);
    }
}
