//! Backups (consistent hot copies via `VACUUM INTO`) and validated restores.
//!
//! Restore flow: copy the chosen file to a staging file → integrity check → migrate → rebuild summaries →
//! safety backup of the live data → swap files while the pool is closed (see `db::Database::replace`).

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::clock::{fmt_ts, Clock};
use crate::db;
use crate::error::{CoreError, CoreResult};
use crate::summary;

pub const FILE_PREFIX: &str = "danish-fitness_";

#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum BackupKind {
    Auto,
    Manual,
    /// Taken automatically right before a restore.
    Safety,
    /// Taken when a new app version opens the data for the first time (before any upgrade).
    Update,
    /// Saved by the uninstaller before the app is removed.
    Uninstall,
}

impl BackupKind {
    fn tag(&self) -> &'static str {
        match self {
            BackupKind::Auto => "auto",
            BackupKind::Manual => "manual",
            BackupKind::Safety => "safety",
            BackupKind::Update => "update",
            BackupKind::Uninstall => "uninstall",
        }
    }
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BackupInfo {
    pub file_name: String,
    pub path: String,
    pub size_bytes: i64,
    pub created_at: String,
    pub kind: BackupKind,
}

fn info_for(path: &Path) -> Option<BackupInfo> {
    let name = path.file_name()?.to_str()?.to_string();
    let stem = name.strip_prefix(FILE_PREFIX)?.strip_suffix(".db")?;
    // stem = 2026-10-02_11-30-05_auto[_n]
    let mut parts = stem.splitn(3, '_');
    let date = parts.next()?;
    let time = parts.next()?;
    let rest = parts.next()?;
    let kind = match rest.split('_').next()? {
        "auto" => BackupKind::Auto,
        "manual" => BackupKind::Manual,
        "safety" => BackupKind::Safety,
        "update" => BackupKind::Update,
        "uninstall" => BackupKind::Uninstall,
        _ => return None,
    };
    let created_at = format!("{} {}", date, time.replace('-', ":"));
    let size_bytes = fs::metadata(path).ok()?.len() as i64;
    Some(BackupInfo { file_name: name, path: path.to_string_lossy().into_owned(), size_bytes, created_at, kind })
}

/// Writes a consistent copy of the live database into `dir`.
pub fn create_backup(conn: &Connection, dir: &Path, kind: BackupKind, clock: &Clock) -> CoreResult<BackupInfo> {
    fs::create_dir_all(dir)?;
    let stamp = clock.now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let mut path = dir.join(format!("{FILE_PREFIX}{stamp}_{}.db", kind.tag()));
    let mut n = 1;
    while path.exists() {
        n += 1;
        path = dir.join(format!("{FILE_PREFIX}{stamp}_{}_{n}.db", kind.tag()));
    }
    conn.execute("VACUUM INTO ?1", [path.to_string_lossy().as_ref()])?;
    info_for(&path).ok_or_else(|| CoreError::other("backup was written but could not be read back"))
}

/// Copies a finished backup into a second folder (USB drive, cloud-synced folder ...).
pub fn mirror(info: &BackupInfo, mirror_dir: &Path) -> CoreResult<PathBuf> {
    fs::create_dir_all(mirror_dir)?;
    let target = mirror_dir.join(&info.file_name);
    fs::copy(&info.path, &target)?;
    Ok(target)
}

/// Backups in a folder, newest first.
pub fn list_backups(dir: &Path) -> CoreResult<Vec<BackupInfo>> {
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out: Vec<BackupInfo> = fs::read_dir(dir)?.filter_map(|e| e.ok()).filter_map(|e| info_for(&e.path())).collect();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.file_name.cmp(&a.file_name)));
    Ok(out)
}

/// Backups found in any of `dirs` (newest first, each file once) - used on a fresh install to offer a restore.
pub fn find_backups(dirs: &[PathBuf], limit: usize) -> Vec<BackupInfo> {
    let mut seen = std::collections::HashSet::new();
    let mut all: Vec<BackupInfo> = dirs
        .iter()
        .flat_map(|d| list_backups(d).unwrap_or_default())
        .filter(|b| seen.insert(fs::canonicalize(&b.path).unwrap_or_else(|_| PathBuf::from(&b.path))))
        .collect();
    all.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.file_name.cmp(&a.file_name)));
    all.truncate(limit);
    all
}

/// Deletes the oldest *automatic* backups beyond `keep`. Manual, safety, update and uninstall copies are kept.
pub fn prune(dir: &Path, keep: usize) -> CoreResult<usize> {
    let autos: Vec<BackupInfo> = list_backups(dir)?.into_iter().filter(|b| b.kind == BackupKind::Auto).collect();
    let mut removed = 0;
    for b in autos.iter().skip(keep) {
        if fs::remove_file(&b.path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BackupCheck {
    pub ok: bool,
    pub message: String,
    pub schema_version: i64,
    pub members: i64,
    pub payments: i64,
    pub last_activity: Option<String>,
    pub gym_name: Option<String>,
}

/// Validates a database file opened at `path` (it may be migrated in place — only use on staging copies).
fn validate_staged(path: &Path) -> CoreResult<BackupCheck> {
    let mut conn = Connection::open(path)?;
    db::apply_pragmas(&conn)?;
    if !db::quick_check(&conn)? {
        return Err(CoreError::invalid("This backup file is damaged and cannot be restored."));
    }
    let tables: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('members', 'payments', 'settings', 'users')",
        [],
        |r| r.get(0),
    )?;
    if tables != 4 {
        return Err(CoreError::invalid("This file is not a Danish Fitness backup."));
    }
    let version = db::schema_version(&conn)?;
    if version > db::SCHEMA_VERSION {
        return Err(CoreError::invalid("This backup was made by a newer version of the app. Please update the app first."));
    }
    db::migrate(&mut conn)?;
    summary::refresh_all(&conn)?;
    let members: i64 = conn.query_row("SELECT COUNT(*) FROM members WHERE deleted_at IS NULL", [], |r| r.get(0))?;
    let payments: i64 = conn.query_row("SELECT COUNT(*) FROM payments WHERE voided_at IS NULL", [], |r| r.get(0))?;
    let last_activity: Option<String> = conn.query_row("SELECT MAX(at) FROM audit_log", [], |r| r.get(0)).optional()?.flatten();
    let gym_json: Option<String> = conn.query_row("SELECT value FROM settings WHERE key = 'gym'", [], |r| r.get(0)).optional()?;
    let gym_name = gym_json
        .and_then(|j| serde_json::from_str::<serde_json::Value>(&j).ok())
        .and_then(|v| v.get("name").and_then(|n| n.as_str()).map(str::to_string));
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;")?;
    Ok(BackupCheck {
        ok: true,
        message: format!("Backup looks good: {members} members, {payments} payments."),
        schema_version: version,
        members,
        payments,
        last_activity,
        gym_name,
    })
}

fn sidecar(path: &Path, ext: &str) -> PathBuf {
    let mut p = path.as_os_str().to_owned();
    p.push(ext);
    PathBuf::from(p)
}

fn remove_sidecars(path: &Path) {
    for ext in ["-wal", "-shm", "-journal"] {
        let _ = fs::remove_file(sidecar(path, ext));
    }
}

/// Name of the file (next to the database) that tells the uninstaller where backups go.
pub const BACKUP_POINTER_FILE: &str = "backup-folder.txt";

/// Records the folder the last backup went to, as UTF-16LE text, for the uninstaller's safety copy.
fn write_pointer(db_path: &Path, dir: &Path) {
    let text: Vec<u8> = dir.to_string_lossy().encode_utf16().flat_map(u16::to_le_bytes).collect();
    if let Err(e) = fs::write(db_path.with_file_name(BACKUP_POINTER_FILE), text) {
        log::warn!("could not record the backup folder: {e}");
    }
}

/// Copies a backup next to the live database and validates it. Returns the staging path and check result.
pub fn stage_restore(backup_path: &Path, live_db_path: &Path) -> CoreResult<(PathBuf, BackupCheck)> {
    if !backup_path.is_file() {
        return Err(CoreError::invalid("Backup file not found."));
    }
    let staging = live_db_path.with_file_name("restore-staging.db");
    remove_sidecars(&staging);
    let _ = fs::remove_file(&staging);
    fs::copy(backup_path, &staging)?;
    // A copy of a live database (e.g. saved by the uninstaller) may come with its journal: apply it too.
    let wal = sidecar(backup_path, "-wal");
    if wal.is_file() {
        fs::copy(&wal, sidecar(&staging, "-wal"))?;
    }
    match validate_staged(&staging) {
        Ok(check) => {
            remove_sidecars(&staging);
            Ok((staging, check))
        }
        Err(e) => {
            remove_sidecars(&staging);
            let _ = fs::remove_file(&staging);
            Err(e)
        }
    }
}

/// Validates a backup without restoring it (for the confirmation dialog).
pub fn inspect(backup_path: &Path, scratch_dir: &Path) -> CoreResult<BackupCheck> {
    fs::create_dir_all(scratch_dir)?;
    let (staging, check) = stage_restore(backup_path, &scratch_dir.join("inspect.db"))?;
    let _ = fs::remove_file(&staging);
    Ok(check)
}

/// Replaces the live database file with a staged copy. Call only while every connection is closed.
pub fn swap_in(staging: &Path, live_db_path: &Path) -> CoreResult<()> {
    remove_sidecars(live_db_path);
    fs::rename(staging, live_db_path)?;
    Ok(())
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BackupResult {
    pub info: BackupInfo,
    pub mirrored_to: Option<String>,
    pub mirror_error: Option<String>,
    pub pruned: i64,
}

#[derive(Serialize, TS, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BackupStatus {
    /// Where backups are saved right now.
    pub folder: String,
    /// False when the chosen folder cannot be used (drive missing) — backups then go to the default folder.
    pub folder_available: bool,
    /// A folder on a second drive, offered when backups sit on the same drive as the data.
    pub safer_folder: Option<String>,
    pub default_folder: String,
    pub mirror_folder: Option<String>,
    pub auto_backup: bool,
    pub interval_hours: i64,
    pub keep_count: i64,
    pub last_backup_at: Option<String>,
    pub last_backup_path: Option<String>,
    pub unsaved_changes: bool,
    pub backups: Vec<BackupInfo>,
}

/// Takes a backup into the configured folder, records it, mirrors it and prunes old automatic copies.
pub fn perform_backup(db: &db::Database, clock: &Clock, default_dir: &Path, kind: BackupKind) -> CoreResult<BackupResult> {
    db.with_conn(|c| {
        let s = crate::settings::load(c)?;
        // A chosen folder whose drive is missing (e.g. data restored on a PC without D:) falls back to the default.
        let dir = match s.backup.folder.as_deref().map(PathBuf::from) {
            Some(folder) if fs::create_dir_all(&folder).is_ok() => folder,
            Some(folder) => {
                log::warn!("backup folder {} is not available; using {}", folder.display(), default_dir.display());
                default_dir.to_path_buf()
            }
            None => default_dir.to_path_buf(),
        };
        let info = create_backup(c, &dir, kind, clock)?;
        mark_done(c, clock, &info)?;
        write_pointer(db.path(), &dir);
        let (mirrored_to, mirror_error) = match s.backup.mirror_folder.as_deref() {
            Some(m) => match mirror(&info, Path::new(m)) {
                Ok(p) => (Some(p.to_string_lossy().into_owned()), None),
                Err(e) => {
                    log::warn!("backup mirror to {m} failed: {e}");
                    (None, Some(format!("Could not copy to the second folder ({m}). Is the USB drive connected?")))
                }
            },
            None => (None, None),
        };
        let mut pruned = 0;
        if kind == BackupKind::Auto {
            let keep = s.backup.keep_count.clamp(3, 365) as usize;
            pruned = prune(&dir, keep)? as i64;
            if let Some(m) = s.backup.mirror_folder.as_deref() {
                let _ = prune(Path::new(m), keep);
            }
        }
        Ok(BackupResult { info, mirrored_to, mirror_error, pruned })
    })
}

/// Before a new app version touches the data: when the database needs upgrading, or was last opened by a
/// different app version, a copy is saved first (into the configured backup folder, else `fallback_dir`).
///
/// Uses a plain connection so nothing is migrated before the copy exists. Returns the copy, if one was made.
pub fn backup_before_upgrade(db_path: &Path, fallback_dir: &Path, app_version: &str, clock: &Clock) -> CoreResult<Option<BackupInfo>> {
    if !db_path.is_file() {
        return Ok(None);
    }
    let conn = Connection::open(db_path)?;
    conn.busy_timeout(std::time::Duration::from_secs(10))?;
    let version = db::schema_version(&conn)?;
    if version == 0 {
        return Ok(None);
    }
    let section = |key: &str| -> CoreResult<Option<serde_json::Value>> {
        let json: Option<String> = conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?;
        Ok(json.and_then(|j| serde_json::from_str(&j).ok()))
    };
    let last_version = section("system")?.and_then(|v| v.get("lastAppVersion").and_then(|x| x.as_str()).map(str::to_string));
    if version >= db::SCHEMA_VERSION && last_version.as_deref() == Some(app_version) {
        return Ok(None);
    }
    let dir = section("backup")?
        .and_then(|v| v.get("folder").and_then(|x| x.as_str()).map(PathBuf::from))
        .filter(|p| fs::create_dir_all(p).is_ok())
        .unwrap_or_else(|| fallback_dir.to_path_buf());
    Ok(Some(create_backup(&conn, &dir, BackupKind::Update, clock)?))
}

/// When the last backup was taken (from the system state), for scheduling.
pub fn is_due(last_backup_at: Option<&str>, clock: &Clock, hours: i64) -> bool {
    match last_backup_at.and_then(crate::clock::parse_ts) {
        Some(t) => clock.now() - t >= chrono::Duration::hours(hours) || t > clock.now(),
        None => true,
    }
}

/// Records a finished backup in the system state.
pub fn mark_done(conn: &Connection, clock: &Clock, info: &BackupInfo) -> CoreResult<()> {
    crate::settings::update_system(conn, clock, |s| {
        s.last_backup_at = Some(fmt_ts(clock.now()));
        s.last_backup_path = Some(info.path.clone());
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_app_version_saves_a_copy_before_touching_the_data() {
        let dir = tempfile::tempdir().unwrap();
        let live = dir.path().join("live.db");
        let fallback = dir.path().join("fallback");
        let clock = Clock::fixed("2026-10-03", "09:00:00");

        // Nothing to protect yet on a brand-new install.
        assert!(backup_before_upgrade(&live, &fallback, "1.0.0", &clock).unwrap().is_none());

        let db = db::Database::open(&live).unwrap();
        db.with_conn(|c| crate::settings::update_system(c, &clock, |s| s.last_app_version = Some("1.0.0".into()))).unwrap();
        db.shutdown();
        // Same version again: no copy.
        assert!(backup_before_upgrade(&live, &fallback, "1.0.0", &clock).unwrap().is_none());

        // A newer version: a copy lands in the fallback folder (no folder configured) and is never pruned.
        let copy = backup_before_upgrade(&live, &fallback, "1.1.0", &clock).unwrap().expect("backup made");
        assert_eq!(copy.kind, BackupKind::Update);
        assert!(Path::new(&copy.path).starts_with(&fallback));
        assert_eq!(prune(&fallback, 0).unwrap(), 0);
        assert_eq!(list_backups(&fallback).unwrap().len(), 1);

        // With a folder chosen in settings, the copy goes there.
        let chosen = dir.path().join("chosen");
        let db = db::Database::open(&live).unwrap();
        db.with_conn(|c| {
            let mut b = crate::settings::load(c)?.backup;
            b.folder = Some(chosen.to_string_lossy().into_owned());
            crate::settings::write_section(c, &clock, "backup", &b)
        })
        .unwrap();
        db.shutdown();
        let copy = backup_before_upgrade(&live, &fallback, "1.2.0", &clock).unwrap().expect("backup made");
        assert!(Path::new(&copy.path).starts_with(&chosen));
    }

    #[test]
    fn backup_list_prune_and_restore_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let live = dir.path().join("live.db");
        let backups = dir.path().join("backups");
        let db = db::Database::open(&live).unwrap();
        db.with_conn(|c| {
            db::next_counter(c, "receipt_no")?;
            Ok(())
        })
        .unwrap();
        let mut infos = Vec::new();
        for i in 0..5 {
            let clock = Clock::fixed("2026-10-02", &format!("10:0{i}:00"));
            let info = db.with_conn(|c| create_backup(c, &backups, BackupKind::Auto, &clock)).unwrap();
            infos.push(info);
        }
        let manual = db.with_conn(|c| create_backup(c, &backups, BackupKind::Manual, &Clock::fixed("2026-10-02", "11:00:00"))).unwrap();
        assert_eq!(list_backups(&backups).unwrap().len(), 6);
        assert_eq!(prune(&backups, 3).unwrap(), 2);
        let left = list_backups(&backups).unwrap();
        assert_eq!(left.len(), 4);
        assert_eq!(left[0].kind, BackupKind::Manual);

        // Change live data, then restore the manual backup (counter back to 1).
        db.with_conn(|c| {
            db::next_counter(c, "receipt_no")?;
            Ok(())
        })
        .unwrap();
        let (staging, check) = stage_restore(Path::new(&manual.path), &live).unwrap();
        assert!(check.ok);
        db.replace(|p| swap_in(&staging, p)).unwrap();
        let v = db.with_conn(|c| db::peek_counter(c, "receipt_no")).unwrap();
        assert_eq!(v, 1);

        // A random file is rejected.
        let junk = dir.path().join("junk.db");
        fs::write(&junk, b"not a database").unwrap();
        assert!(stage_restore(&junk, &live).is_err());
    }
}
