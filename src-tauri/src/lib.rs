//! Danish Fitness desktop shell (Tauri 2).

mod commands;
mod drives;
mod pdf;
mod protocol;
mod state;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use danish_core::backup::{self, BackupKind};
use danish_core::db::Database;
use danish_core::{settings, summary, Clock};
use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{Manager, RunEvent};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
use tauri_plugin_window_state::StateFlags;

use crate::state::{AppPaths, AppState};

/// Folders: `%APPDATA%\com.danishfitness.desk` for data; backups in the folder chosen at setup (suggested: a
/// second drive such as `D:\Danish Fitness\Backups`), else `Documents\Danish Fitness\Backups`.
/// `DANISH_FITNESS_DATA_DIR` overrides everything (portable installs and automated tests).
fn resolve_paths(app: &tauri::App) -> Result<AppPaths, Box<dyn std::error::Error>> {
    let log_dir = app.path().app_log_dir().unwrap_or_else(|_| std::env::temp_dir().join("danish-fitness-logs"));
    if let Some(custom) = std::env::var_os("DANISH_FITNESS_DATA_DIR") {
        let data_dir = PathBuf::from(custom);
        return Ok(AppPaths {
            db_path: data_dir.join("danish-fitness.db"),
            default_backup_dir: data_dir.join("backups"),
            suggested_backup_dir: data_dir.join("backups"),
            backup_on_other_drive: false,
            data_dir,
            log_dir,
        });
    }
    let data_dir = app.path().app_data_dir()?;
    let default_backup_dir = app
        .path()
        .document_dir()
        .map(|d| d.join("Danish Fitness").join("Backups"))
        .unwrap_or_else(|_| data_dir.join("backups"));
    let second_drive = drives::second_drive_backup_dir();
    Ok(AppPaths {
        db_path: data_dir.join("danish-fitness.db"),
        backup_on_other_drive: second_drive.is_some(),
        suggested_backup_dir: second_drive.unwrap_or_else(|| default_backup_dir.clone()),
        default_backup_dir,
        data_dir,
        log_dir,
    })
}

/// Automatic backups: on start when the last one is old, then every few hours when data changed.
fn spawn_backup_scheduler(db: Arc<Database>, dirty: Arc<AtomicBool>, default_dir: PathBuf) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(20));
        let clock = Clock::System;
        loop {
            let plan = db.with_conn(|c| {
                let s = settings::load(c)?;
                Ok((s.backup.auto_backup && s.system.setup_completed_at.is_some(), s.system.last_backup_at, s.backup.interval_hours))
            });
            if let Ok((enabled, last, hours)) = plan {
                let stale = backup::is_due(last.as_deref(), &clock, 20);
                let interval_due = backup::is_due(last.as_deref(), &clock, hours);
                if enabled && (stale || (interval_due && dirty.load(Ordering::SeqCst))) {
                    match backup::perform_backup(&db, &clock, &default_dir, BackupKind::Auto) {
                        Ok(r) => {
                            dirty.store(false, Ordering::SeqCst);
                            log::info!("automatic backup saved: {}", r.info.path);
                        }
                        Err(e) => log::error!("automatic backup failed: {e}"),
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(300));
        }
    });
}

pub fn run() {
    let app = tauri::Builder::default()
        // Must be first: a second launch just focuses the running window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::LogDir { file_name: Some("danish-fitness".into()) }),
                    Target::new(TargetKind::Stdout),
                ])
                .level(log::LevelFilter::Info)
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .max_file_size(2_000_000)
                .rotation_strategy(RotationStrategy::KeepSome(5))
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        // Member photos use the webcam. The app only shows its own pages, so skip WebView2's prompt — one
        // "Block" click there would disable the camera for good, with no obvious way back for the staff.
        .on_permission_request(|_, kind| match kind {
            PermissionKind::Camera => PermissionResponse::Allow,
            _ => PermissionResponse::Default,
        })
        .register_asynchronous_uri_scheme_protocol("photo", |ctx, request, responder| {
            protocol::handle(ctx.app_handle().clone(), request, responder);
        })
        .setup(|app| {
            let paths = resolve_paths(app)?;
            std::fs::create_dir_all(&paths.data_dir)?;
            let version = app.package_info().version.to_string();
            log::info!("Danish Fitness {version} starting; data: {}", paths.data_dir.display());
            // A new version (or an older database) gets a copy saved before anything is upgraded.
            match backup::backup_before_upgrade(&paths.db_path, &paths.default_backup_dir, &version, &Clock::System) {
                Ok(Some(b)) => log::info!("backup before update saved: {}", b.path),
                Ok(None) => {}
                Err(e) => log::error!("backup before update failed: {e}"),
            }
            let db = Arc::new(Database::open(&paths.db_path)?);
            db.with_conn(|c| {
                if !danish_core::db::quick_check(c)? {
                    log::error!("database quick_check reported problems");
                }
                if summary::needs_rebuild(c)? {
                    summary::refresh_all(c)?;
                }
                if settings::load(c)?.system.last_app_version.as_deref() != Some(version.as_str()) {
                    settings::update_system(c, &Clock::System, |s| s.last_app_version = Some(version.clone()))?;
                }
                c.execute_batch("PRAGMA optimize;")?;
                Ok(())
            })?;
            let dirty = Arc::new(AtomicBool::new(false));
            spawn_backup_scheduler(db.clone(), dirty.clone(), paths.default_backup_dir.clone());
            app.manage(AppState { db, clock: Clock::System, session: RwLock::new(None), paths, dirty });

            // Safety net: show the window even if the UI never reports ready.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(6));
                if let Some(w) = handle.get_webview_window("main") {
                    if !w.is_visible().unwrap_or(true) {
                        let _ = w.show();
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_status,
            commands::app_ready,
            commands::app_info,
            commands::setup_defaults,
            commands::setup_complete,
            commands::setup_find_backups,
            commands::setup_inspect_backup,
            commands::setup_restore,
            commands::demo_seed,
            commands::auth_login,
            commands::auth_auto_login,
            commands::auth_logout,
            commands::auth_session,
            commands::auth_change_pin,
            commands::users_list,
            commands::users_create,
            commands::users_update,
            commands::users_reset_pin,
            commands::settings_get,
            commands::settings_update,
            commands::settings_default_templates,
            commands::plans_list,
            commands::plans_save,
            commands::plans_delete,
            commands::members_list,
            commands::members_counts,
            commands::members_get,
            commands::members_quick,
            commands::members_quick_search,
            commands::members_find_by_code,
            commands::members_register,
            commands::members_update,
            commands::members_archive,
            commands::members_restore,
            commands::members_delete,
            commands::members_set_photo,
            commands::members_remove_photo,
            commands::members_duplicates,
            commands::members_next_code,
            commands::members_suggestions,
            commands::memberships_list,
            commands::memberships_preview,
            commands::memberships_renew,
            commands::memberships_cancel,
            commands::memberships_update_dates,
            commands::freezes_list,
            commands::freezes_create,
            commands::freezes_end,
            commands::payments_record,
            commands::payments_list,
            commands::payments_receipt,
            commands::payments_void,
            commands::charges_add,
            commands::charges_void,
            commands::charges_list,
            commands::ledger_get,
            commands::dues_list,
            commands::attendance_check_in,
            commands::attendance_today,
            commands::attendance_list,
            commands::attendance_delete,
            commands::attendance_member_days,
            commands::expense_categories_list,
            commands::expense_categories_save,
            commands::expenses_list,
            commands::expenses_save,
            commands::expenses_delete,
            commands::measurements_list,
            commands::measurements_save,
            commands::measurements_delete,
            commands::messages_send,
            commands::messages_list,
            commands::reminders_queue,
            commands::reminders_counts,
            commands::dashboard_get,
            commands::reports_collections,
            commands::reports_memberships,
            commands::reports_attendance,
            commands::reports_expenses,
            commands::reports_pnl,
            commands::reports_daily_closing,
            commands::audit_list,
            commands::backup_now,
            commands::backup_status,
            commands::backup_inspect,
            commands::backup_restore,
            commands::export_csv,
            commands::open_folder,
            commands::open_file,
            commands::save_pdf,
            commands::billing_invoice,
            commands::open_camera_settings,
            commands::reveal_file,
        ])
        .build(tauri::generate_context!())
        .expect("failed to start Danish Fitness");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            let state = handle.state::<AppState>();
            // Backup on exit when something changed since the last backup.
            if state.dirty.load(Ordering::SeqCst) {
                let auto = state.db.with_conn(|c| Ok(settings::load(c)?.backup.auto_backup)).unwrap_or(false);
                if auto {
                    match backup::perform_backup(&state.db, &state.clock, &state.paths.default_backup_dir, BackupKind::Auto) {
                        Ok(r) => log::info!("exit backup saved: {}", r.info.path),
                        Err(e) => log::error!("exit backup failed: {e}"),
                    }
                }
            }
            state.db.shutdown();
        }
    });
}
