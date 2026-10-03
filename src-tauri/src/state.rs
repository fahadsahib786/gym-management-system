//! Shared application state: database, session, clock and well-known folders.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};

use danish_core::db::Database;
use danish_core::rusqlite::Connection;
use danish_core::{Actor, Clock, CoreError, CoreResult};

pub struct AppPaths {
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    /// Backups when no folder is configured (or the configured one is unavailable).
    pub default_backup_dir: PathBuf,
    /// Offered at setup: a second drive (`D:\Danish Fitness\Backups`) when the PC has one, else the default.
    pub suggested_backup_dir: PathBuf,
    pub backup_on_other_drive: bool,
    pub log_dir: PathBuf,
}

pub struct AppState {
    pub db: Arc<Database>,
    pub clock: Clock,
    pub session: RwLock<Option<Actor>>,
    pub paths: AppPaths,
    /// Set after every successful write; cleared when a backup is taken.
    pub dirty: Arc<AtomicBool>,
}

impl AppState {
    pub fn actor(&self) -> CoreResult<Actor> {
        self.session.read().ok().and_then(|s| s.clone()).ok_or(CoreError::Unauthenticated)
    }

    pub fn set_session(&self, actor: Option<Actor>) {
        if let Ok(mut s) = self.session.write() {
            *s = actor;
        }
    }

    /// Runs read-only work on a blocking thread for the logged-in user.
    pub async fn read<T, F>(&self, f: F) -> CoreResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&Connection, &Clock, &Actor) -> CoreResult<T> + Send + 'static,
    {
        let actor = self.actor()?;
        let db = self.db.clone();
        let clock = self.clock.clone();
        tauri::async_runtime::spawn_blocking(move || db.with_conn(|c| f(c, &clock, &actor)))
            .await
            .map_err(|e| CoreError::other(format!("background task failed: {e}")))?
    }

    /// Runs a write on a blocking thread for the logged-in user and marks the data as changed.
    pub async fn write<T, F>(&self, f: F) -> CoreResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection, &Clock, &Actor) -> CoreResult<T> + Send + 'static,
    {
        let actor = self.actor()?;
        let db = self.db.clone();
        let clock = self.clock.clone();
        let dirty = self.dirty.clone();
        let result = tauri::async_runtime::spawn_blocking(move || db.with_conn(|c| f(c, &clock, &actor)))
            .await
            .map_err(|e| CoreError::other(format!("background task failed: {e}")))?;
        if result.is_ok() {
            dirty.store(true, Ordering::SeqCst);
        }
        result
    }

    /// Database work that does not need a logged-in user (login screen, setup, photos).
    pub async fn open<T, F>(&self, f: F) -> CoreResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection, &Clock) -> CoreResult<T> + Send + 'static,
    {
        let db = self.db.clone();
        let clock = self.clock.clone();
        tauri::async_runtime::spawn_blocking(move || db.with_conn(|c| f(c, &clock)))
            .await
            .map_err(|e| CoreError::other(format!("background task failed: {e}")))?
    }
}
