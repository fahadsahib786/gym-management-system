//! Tauri commands: thin wrappers that resolve the session, call `danish-core` on a blocking thread and return
//! typed results. Business rules and permission checks live in the core crate.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use danish_core::backup::{self, BackupKind};
use danish_core::model::{MemberQuick, Page};
use danish_core::settings::{MessageTemplates, Settings, SettingsUpdate, TemplateLanguage, WhatsappOpenWith};
use danish_core::{
    attendance, audit, auth, billing, expenses, export, measurements, members, memberships, messages, plans, seed, settings, stats,
    summary, system,
};
use danish_core::{Actor, CoreError, CoreResult, Permission};
use serde::Serialize;
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

use crate::drives;
use crate::pdf::{self, PdfPaper};
use crate::state::AppState;

type R<T> = CoreResult<T>;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> R<T> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| CoreError::other(format!("background task failed: {e}")))?
}

// =============================================================================================
// App & setup

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub data_dir: String,
    pub db_path: String,
    pub db_size_bytes: u64,
    pub log_dir: String,
    pub default_backup_dir: String,
    pub schema_version: i64,
}

#[tauri::command]
pub async fn app_status(state: State<'_, AppState>) -> R<system::AppStatus> {
    state.open(|c, clock| system::status(c, clock)).await
}

/// Called by the UI after its first paint so the window appears without a white flash.
#[tauri::command]
pub fn app_ready(window: WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

#[tauri::command]
pub async fn app_info(app: AppHandle, state: State<'_, AppState>) -> R<AppInfo> {
    state.actor()?;
    let db_path = state.paths.db_path.clone();
    let size = |p: &Path| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    let mut wal = db_path.as_os_str().to_owned();
    wal.push("-wal");
    let schema_version = state.open(|c, _| danish_core::db::schema_version(c)).await?;
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: state.paths.data_dir.to_string_lossy().into_owned(),
        db_path: db_path.to_string_lossy().into_owned(),
        db_size_bytes: size(&db_path) + size(&PathBuf::from(wal)),
        log_dir: state.paths.log_dir.to_string_lossy().into_owned(),
        default_backup_dir: state.paths.default_backup_dir.to_string_lossy().into_owned(),
        schema_version,
    })
}

/// Takes an automatic backup in the background (after setup or demo data, so a backup exists from day one).
fn backup_soon(state: &AppState) {
    let (db, clock, dir, dirty) = (state.db.clone(), state.clock.clone(), state.paths.default_backup_dir.clone(), state.dirty.clone());
    tauri::async_runtime::spawn_blocking(move || match backup::perform_backup(&db, &clock, &dir, BackupKind::Auto) {
        Ok(r) => {
            dirty.store(false, Ordering::SeqCst);
            log::info!("first backup saved: {}", r.info.path);
        }
        Err(e) => log::error!("first backup failed: {e}"),
    });
}

#[tauri::command]
pub fn setup_defaults(state: State<'_, AppState>) -> system::SetupDefaults {
    system::setup_defaults(&state.paths.suggested_backup_dir, state.paths.backup_on_other_drive)
}

/// Restoring during first-run is only allowed while this PC has no gym data yet.
async fn ensure_fresh(state: &AppState) -> R<()> {
    if state.open(|c, _| system::is_fresh(c)).await? {
        Ok(())
    } else {
        Err(CoreError::conflict("This PC already has gym data. To restore, use Settings → Backup & restore."))
    }
}

/// First run on a new or reinstalled PC: backups already on this PC (second drive, Documents), newest first.
#[tauri::command]
pub async fn setup_find_backups(state: State<'_, AppState>) -> R<Vec<backup::BackupInfo>> {
    ensure_fresh(&state).await?;
    let dirs = vec![state.paths.suggested_backup_dir.clone(), state.paths.default_backup_dir.clone()];
    blocking(move || Ok(backup::find_backups(&dirs, 8))).await
}

/// First run on a new or reinstalled PC: checks a backup file before restoring it.
#[tauri::command]
pub async fn setup_inspect_backup(state: State<'_, AppState>, path: String) -> R<backup::BackupCheck> {
    ensure_fresh(&state).await?;
    let scratch = state.paths.data_dir.join("tmp");
    blocking(move || backup::inspect(Path::new(&path), &scratch)).await
}

/// First run on a new or reinstalled PC: brings back all data from a backup instead of setting up a new gym.
#[tauri::command]
pub async fn setup_restore(state: State<'_, AppState>, path: String) -> R<backup::BackupCheck> {
    ensure_fresh(&state).await?;
    let (db, clock, db_path) = (state.db.clone(), state.clock.clone(), state.paths.db_path.clone());
    let check = blocking(move || {
        let source = PathBuf::from(&path);
        let (staging, check) = backup::stage_restore(&source, &db_path)?;
        db.replace(|live| backup::swap_in(&staging, live))?;
        db.with_conn(|c| {
            summary::refresh_all(c)?;
            audit::record(
                c,
                &Actor::system(),
                &clock,
                "backup.restore",
                None,
                None,
                format!(
                    "Data restored from {} during first-run setup",
                    source.file_name().and_then(|n| n.to_str()).unwrap_or("backup")
                ),
                None,
            )
        })?;
        Ok(check)
    })
    .await?;
    state.set_session(None);
    state.dirty.store(true, Ordering::SeqCst);
    backup_soon(&state);
    Ok(check)
}

#[tauri::command]
pub async fn setup_complete(state: State<'_, AppState>, input: system::SetupInput) -> R<Actor> {
    let actor = state.open(move |c, clock| system::complete_setup(c, clock, input)).await?;
    state.set_session(Some(actor.clone()));
    state.dirty.store(true, Ordering::SeqCst);
    backup_soon(&state);
    Ok(actor)
}

/// Fills an empty gym with a realistic year of demo data (for training on a spare PC).
#[tauri::command]
pub async fn demo_seed(state: State<'_, AppState>) -> R<seed::SeedSummary> {
    let actor = state.actor()?;
    actor.require(Permission::ManageSettings)?;
    let summary = state
        .open(|c, clock| {
            let members: i64 = c.query_row("SELECT COUNT(*) FROM members", [], |r| r.get(0))?;
            if members > 0 {
                return Err(CoreError::conflict("Demo data can only be loaded into an empty gym (no members yet)."));
            }
            seed::seed_demo(c, clock, 250, 12, 2026)
        })
        .await?;
    state.dirty.store(true, Ordering::SeqCst);
    backup_soon(&state);
    Ok(summary)
}

// =============================================================================================
// Session & users

#[tauri::command]
pub async fn auth_login(state: State<'_, AppState>, user_id: String, pin: String) -> R<Actor> {
    let actor = state.open(move |c, clock| auth::login(c, clock, &user_id, &pin)).await?;
    state.set_session(Some(actor.clone()));
    Ok(actor)
}

/// Used when "ask for PIN" is turned off: the first admin acts for the desk.
#[tauri::command]
pub async fn auth_auto_login(state: State<'_, AppState>) -> R<Actor> {
    let actor = state
        .open(|c, _| {
            if settings::load(c)?.security.require_login {
                return Err(CoreError::Unauthenticated);
            }
            auth::default_actor(c)?.ok_or(CoreError::Unauthenticated)
        })
        .await?;
    state.set_session(Some(actor.clone()));
    Ok(actor)
}

#[tauri::command]
pub fn auth_logout(state: State<'_, AppState>) {
    state.set_session(None);
}

/// Current user with permissions re-resolved from the database (roles/settings may have changed).
#[tauri::command]
pub async fn auth_session(state: State<'_, AppState>) -> R<Option<Actor>> {
    let Some(current) = state.session.read().ok().and_then(|s| s.clone()) else { return Ok(None) };
    let id = current.user_id.clone();
    match state.open(move |c, _| auth::refresh_actor(c, &id)).await {
        Ok(actor) => {
            state.set_session(Some(actor.clone()));
            Ok(Some(actor))
        }
        Err(CoreError::Unauthenticated) => {
            state.set_session(None);
            Ok(None)
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn auth_change_pin(state: State<'_, AppState>, current_pin: String, new_pin: String) -> R<()> {
    state.write(move |c, clock, actor| auth::change_own_pin(c, actor, clock, &current_pin, &new_pin)).await
}

#[tauri::command]
pub async fn users_list(state: State<'_, AppState>, include_inactive: bool) -> R<Vec<auth::UserSummary>> {
    state
        .read(move |c, _, actor| {
            actor.require(Permission::ManageUsers)?;
            auth::list_users(c, include_inactive)
        })
        .await
}

#[tauri::command]
pub async fn users_create(state: State<'_, AppState>, input: auth::NewUserInput) -> R<auth::UserSummary> {
    state.write(move |c, clock, actor| auth::create_user(c, actor, clock, input)).await
}

#[tauri::command]
pub async fn users_update(state: State<'_, AppState>, input: auth::UpdateUserInput) -> R<auth::UserSummary> {
    let user = state.write(move |c, clock, actor| auth::update_user(c, actor, clock, input)).await?;
    refresh_session(&state).await;
    Ok(user)
}

#[tauri::command]
pub async fn users_reset_pin(state: State<'_, AppState>, user_id: String, pin: String) -> R<()> {
    state.write(move |c, clock, actor| auth::reset_pin(c, actor, clock, &user_id, &pin)).await
}

async fn refresh_session(state: &State<'_, AppState>) {
    if let Ok(current) = state.actor() {
        let id = current.user_id.clone();
        match state.open(move |c, _| auth::refresh_actor(c, &id)).await {
            Ok(actor) => state.set_session(Some(actor)),
            Err(_) => state.set_session(None),
        }
    }
}

// =============================================================================================
// Settings & plans

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> R<Settings> {
    state.read(|c, _, _| settings::load(c)).await
}

#[tauri::command]
pub async fn settings_update(state: State<'_, AppState>, update: SettingsUpdate) -> R<Settings> {
    let refreshed = matches!(update, SettingsUpdate::Security(_));
    let s = state.write(move |c, clock, actor| settings::update(c, actor, clock, update)).await?;
    if refreshed {
        refresh_session(&state).await;
    }
    Ok(s)
}

#[tauri::command]
pub fn settings_default_templates(language: TemplateLanguage) -> MessageTemplates {
    MessageTemplates::defaults(language)
}

#[tauri::command]
pub async fn plans_list(state: State<'_, AppState>, include_inactive: bool) -> R<Vec<plans::Plan>> {
    state.read(move |c, clock, _| plans::list(c, &clock.today_str(), include_inactive)).await
}

#[tauri::command]
pub async fn plans_save(state: State<'_, AppState>, input: plans::PlanInput) -> R<plans::Plan> {
    state.write(move |c, clock, actor| plans::save(c, actor, clock, input)).await
}

#[tauri::command]
pub async fn plans_delete(state: State<'_, AppState>, id: String) -> R<()> {
    state.write(move |c, clock, actor| plans::delete(c, actor, clock, &id)).await
}

// =============================================================================================
// Members

#[tauri::command]
pub async fn members_list(state: State<'_, AppState>, query: members::MemberQuery) -> R<Page<members::MemberRow>> {
    state.read(move |c, clock, _| members::list(c, clock, &query)).await
}

#[tauri::command]
pub async fn members_counts(state: State<'_, AppState>, search: Option<String>) -> R<members::MemberCounts> {
    state.read(move |c, clock, _| members::counts(c, clock, search.as_deref())).await
}

#[tauri::command]
pub async fn members_get(state: State<'_, AppState>, id: String) -> R<members::Member> {
    state.read(move |c, clock, _| members::get(c, clock, &id)).await
}

#[tauri::command]
pub async fn members_quick(state: State<'_, AppState>, id: String) -> R<MemberQuick> {
    state.read(move |c, clock, _| members::quick(c, clock, &id)).await
}

#[tauri::command]
pub async fn members_quick_search(state: State<'_, AppState>, term: String, limit: Option<i64>) -> R<Vec<MemberQuick>> {
    state.read(move |c, clock, _| members::quick_search(c, clock, &term, limit.unwrap_or(8))).await
}

#[tauri::command]
pub async fn members_find_by_code(state: State<'_, AppState>, code: String) -> R<Option<MemberQuick>> {
    state.read(move |c, clock, _| members::find_by_code(c, clock, &code)).await
}

#[tauri::command]
pub async fn members_register(state: State<'_, AppState>, input: members::RegisterMemberInput) -> R<members::RegisterResult> {
    state.write(move |c, clock, actor| members::register(c, actor, clock, input)).await
}

#[tauri::command]
pub async fn members_update(state: State<'_, AppState>, id: String, input: members::MemberInput) -> R<members::Member> {
    state.write(move |c, clock, actor| members::update(c, actor, clock, &id, input)).await
}

#[tauri::command]
pub async fn members_archive(state: State<'_, AppState>, id: String, reason: Option<String>) -> R<()> {
    state.write(move |c, clock, actor| members::archive(c, actor, clock, &id, reason)).await
}

#[tauri::command]
pub async fn members_restore(state: State<'_, AppState>, id: String) -> R<()> {
    state.write(move |c, clock, actor| members::restore(c, actor, clock, &id)).await
}

#[tauri::command]
pub async fn members_delete(state: State<'_, AppState>, id: String) -> R<()> {
    state.write(move |c, clock, actor| members::delete(c, actor, clock, &id)).await
}

#[tauri::command]
pub async fn members_set_photo(state: State<'_, AppState>, id: String, photo: members::PhotoInput) -> R<i64> {
    state.write(move |c, clock, actor| members::set_photo(c, actor, clock, &id, photo)).await
}

#[tauri::command]
pub async fn members_remove_photo(state: State<'_, AppState>, id: String) -> R<()> {
    state.write(move |c, clock, actor| members::remove_photo(c, actor, clock, &id)).await
}

#[tauri::command]
pub async fn members_duplicates(state: State<'_, AppState>, query: members::DuplicateQuery) -> R<Vec<MemberQuick>> {
    state.read(move |c, clock, _| members::find_duplicates(c, clock, &query)).await
}

#[tauri::command]
pub async fn members_next_code(state: State<'_, AppState>) -> R<String> {
    state.read(|c, _, _| members::next_code(c)).await
}

#[tauri::command]
pub async fn members_suggestions(state: State<'_, AppState>) -> R<members::MemberSuggestions> {
    state.read(|c, _, _| members::suggestions(c)).await
}

// =============================================================================================
// Memberships & freezes

#[tauri::command]
pub async fn memberships_list(state: State<'_, AppState>, member_id: String) -> R<Vec<memberships::SubscriptionRow>> {
    state.read(move |c, clock, _| memberships::list_for_member(c, &clock.today_str(), &member_id)).await
}

#[tauri::command]
pub async fn memberships_preview(state: State<'_, AppState>, member_id: String, plan_id: Option<String>) -> R<memberships::RenewalPreview> {
    state.read(move |c, clock, _| memberships::renewal_preview(c, clock, &member_id, plan_id.as_deref())).await
}

#[tauri::command]
pub async fn memberships_renew(state: State<'_, AppState>, input: memberships::RenewInput) -> R<memberships::RenewResult> {
    state.write(move |c, clock, actor| memberships::renew(c, actor, clock, input)).await
}

#[tauri::command]
pub async fn memberships_cancel(state: State<'_, AppState>, id: String, reason: String) -> R<()> {
    state.write(move |c, clock, actor| memberships::cancel(c, actor, clock, &id, &reason)).await
}

#[tauri::command]
pub async fn memberships_update_dates(state: State<'_, AppState>, input: memberships::UpdateDatesInput) -> R<()> {
    state.write(move |c, clock, actor| memberships::update_dates(c, actor, clock, input)).await
}

#[tauri::command]
pub async fn freezes_list(state: State<'_, AppState>, member_id: String) -> R<Vec<memberships::FreezeRow>> {
    state.read(move |c, clock, _| memberships::list_freezes(c, &clock.today_str(), &member_id)).await
}

#[tauri::command]
pub async fn freezes_create(state: State<'_, AppState>, input: memberships::FreezeInput) -> R<memberships::FreezeRow> {
    state.write(move |c, clock, actor| memberships::freeze(c, actor, clock, input)).await
}

#[tauri::command]
pub async fn freezes_end(state: State<'_, AppState>, id: String) -> R<()> {
    state.write(move |c, clock, actor| memberships::end_freeze(c, actor, clock, &id)).await
}

// =============================================================================================
// Money

#[tauri::command]
pub async fn payments_record(state: State<'_, AppState>, input: billing::RecordPaymentInput) -> R<billing::PaymentResult> {
    state.write(move |c, clock, actor| billing::record_payment(c, actor, clock, input)).await
}

#[tauri::command]
pub async fn payments_list(state: State<'_, AppState>, query: billing::PaymentQuery) -> R<billing::PaymentList> {
    state.read(move |c, clock, actor| billing::list_payments(c, actor, clock, &query)).await
}

#[tauri::command]
pub async fn payments_receipt(state: State<'_, AppState>, id: String) -> R<billing::Receipt> {
    state.read(move |c, _, _| billing::get_receipt(c, &id)).await
}

#[tauri::command]
pub async fn payments_void(state: State<'_, AppState>, id: String, reason: String) -> R<()> {
    state.write(move |c, clock, actor| billing::void_payment(c, actor, clock, &id, &reason)).await
}

#[tauri::command]
pub async fn charges_add(state: State<'_, AppState>, input: billing::ChargeInput) -> R<billing::ChargeResult> {
    state.write(move |c, clock, actor| billing::add_charge(c, actor, clock, input)).await
}

#[tauri::command]
pub async fn charges_void(state: State<'_, AppState>, id: String, reason: String) -> R<()> {
    state.write(move |c, clock, actor| billing::void_charge(c, actor, clock, &id, &reason)).await
}

#[tauri::command]
pub async fn charges_list(state: State<'_, AppState>, member_id: String) -> R<Vec<billing::ChargeRow>> {
    state.read(move |c, _, _| billing::list_charges(c, &member_id)).await
}

#[tauri::command]
pub async fn ledger_get(state: State<'_, AppState>, member_id: String) -> R<Vec<billing::LedgerEntry>> {
    state.read(move |c, _, _| billing::member_ledger(c, &member_id)).await
}

#[tauri::command]
pub async fn dues_list(state: State<'_, AppState>, query: billing::DuesQuery) -> R<billing::DuesList> {
    state
        .read(move |c, clock, _| {
            let s = settings::load(c)?;
            billing::dues(c, clock, &s, &query)
        })
        .await
}

// =============================================================================================
// Attendance

#[tauri::command]
pub async fn attendance_check_in(state: State<'_, AppState>, input: attendance::CheckInInput) -> R<attendance::CheckInResult> {
    state.write(move |c, clock, actor| attendance::check_in(c, actor, clock, input)).await
}

#[tauri::command]
pub async fn attendance_today(state: State<'_, AppState>) -> R<Vec<attendance::AttendanceRow>> {
    state.read(|c, clock, _| attendance::today(c, clock)).await
}

#[tauri::command]
pub async fn attendance_list(state: State<'_, AppState>, query: attendance::AttendanceQuery) -> R<Page<attendance::AttendanceRow>> {
    state.read(move |c, clock, _| attendance::list(c, clock, &query)).await
}

#[tauri::command]
pub async fn attendance_delete(state: State<'_, AppState>, id: i64) -> R<()> {
    state.write(move |c, clock, actor| attendance::delete(c, actor, clock, id)).await
}

#[tauri::command]
pub async fn attendance_member_days(state: State<'_, AppState>, member_id: String, from: String, to: String) -> R<Vec<attendance::DayCount>> {
    state.read(move |c, _, _| attendance::member_days(c, &member_id, &from, &to)).await
}

// =============================================================================================
// Expenses & measurements

#[tauri::command]
pub async fn expense_categories_list(state: State<'_, AppState>, include_inactive: bool) -> R<Vec<expenses::ExpenseCategory>> {
    state.read(move |c, _, _| expenses::list_categories(c, include_inactive)).await
}

#[tauri::command]
pub async fn expense_categories_save(state: State<'_, AppState>, input: expenses::CategoryInput) -> R<expenses::ExpenseCategory> {
    state.write(move |c, clock, actor| expenses::save_category(c, actor, clock, input)).await
}

#[tauri::command]
pub async fn expenses_list(state: State<'_, AppState>, query: expenses::ExpenseQuery) -> R<expenses::ExpenseList> {
    state.read(move |c, _, actor| expenses::list(c, actor, &query)).await
}

#[tauri::command]
pub async fn expenses_save(state: State<'_, AppState>, input: expenses::ExpenseInput) -> R<expenses::Expense> {
    state.write(move |c, clock, actor| expenses::save(c, actor, clock, input)).await
}

#[tauri::command]
pub async fn expenses_delete(state: State<'_, AppState>, id: String, reason: Option<String>) -> R<()> {
    state.write(move |c, clock, actor| expenses::delete(c, actor, clock, &id, reason)).await
}

#[tauri::command]
pub async fn measurements_list(state: State<'_, AppState>, member_id: String) -> R<Vec<measurements::Measurement>> {
    state.read(move |c, _, _| measurements::list(c, &member_id)).await
}

#[tauri::command]
pub async fn measurements_save(state: State<'_, AppState>, input: measurements::MeasurementInput) -> R<measurements::Measurement> {
    state.write(move |c, clock, actor| measurements::save(c, actor, clock, input)).await
}

#[tauri::command]
pub async fn measurements_delete(state: State<'_, AppState>, id: String) -> R<()> {
    state.write(move |c, clock, actor| measurements::delete(c, actor, clock, &id)).await
}

// =============================================================================================
// WhatsApp & reminders

/// Percent-encodes text for a URL query value (UTF-8, unreserved characters kept).
fn encode_component(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 3);
    for b in text.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

pub fn whatsapp_url(open_with: WhatsappOpenWith, phone: &str, text: &str) -> String {
    let text = encode_component(text);
    match open_with {
        WhatsappOpenWith::Desktop => format!("whatsapp://send?phone={phone}&text={text}"),
        WhatsappOpenWith::Web => format!("https://web.whatsapp.com/send?phone={phone}&text={text}"),
        WhatsappOpenWith::Wame => format!("https://wa.me/{phone}?text={text}"),
    }
}

/// Logs the message and opens WhatsApp with it pre-filled (staff press Send in WhatsApp).
#[tauri::command]
pub async fn messages_send(app: AppHandle, state: State<'_, AppState>, input: messages::MessageLogInput) -> R<()> {
    let body = input.body.trim().to_string();
    let (phone, open_with) = state
        .write(move |c, clock, actor| {
            let open_with = settings::load(c)?.whatsapp.open_with;
            let phone = messages::log(c, actor, clock, input)?;
            Ok((phone, open_with))
        })
        .await?;
    app.opener()
        .open_url(whatsapp_url(open_with, &phone, &body), None::<&str>)
        .map_err(|e| CoreError::other(format!("Could not open WhatsApp: {e}")))
}

#[tauri::command]
pub async fn messages_list(state: State<'_, AppState>, member_id: Option<String>, limit: Option<i64>) -> R<Vec<messages::MessageLogRow>> {
    state.read(move |c, _, _| messages::list(c, member_id.as_deref(), limit.unwrap_or(100))).await
}

#[tauri::command]
pub async fn reminders_queue(state: State<'_, AppState>, kind: messages::ReminderKind, limit: Option<i64>) -> R<Vec<messages::ReminderRow>> {
    state.read(move |c, clock, _| messages::reminder_queue(c, clock, kind, limit.unwrap_or(200))).await
}

#[tauri::command]
pub async fn reminders_counts(state: State<'_, AppState>) -> R<messages::ReminderCounts> {
    state.read(|c, clock, _| messages::reminder_counts(c, clock)).await
}

// =============================================================================================
// Dashboard, reports, activity

#[tauri::command]
pub async fn dashboard_get(state: State<'_, AppState>) -> R<stats::Dashboard> {
    state.read(|c, clock, actor| stats::dashboard(c, actor, clock)).await
}

#[tauri::command]
pub async fn reports_collections(state: State<'_, AppState>, range: stats::DateRange) -> R<stats::CollectionsReport> {
    state.read(move |c, _, actor| stats::collections_report(c, actor, &range)).await
}

#[tauri::command]
pub async fn reports_memberships(state: State<'_, AppState>, range: stats::DateRange) -> R<stats::MembershipReport> {
    state.read(move |c, clock, actor| stats::memberships_report(c, actor, clock, &range)).await
}

#[tauri::command]
pub async fn reports_attendance(state: State<'_, AppState>, range: stats::DateRange) -> R<stats::AttendanceReport> {
    state.read(move |c, clock, actor| stats::attendance_report(c, actor, clock, &range)).await
}

#[tauri::command]
pub async fn reports_expenses(state: State<'_, AppState>, range: stats::DateRange) -> R<stats::ExpenseReport> {
    state.read(move |c, _, actor| stats::expenses_report(c, actor, &range)).await
}

#[tauri::command]
pub async fn reports_pnl(state: State<'_, AppState>, year: i32) -> R<stats::PnlReport> {
    state.read(move |c, _, actor| stats::pnl_report(c, actor, year)).await
}

#[tauri::command]
pub async fn reports_daily_closing(state: State<'_, AppState>, date: String) -> R<stats::DailyClosing> {
    state.read(move |c, clock, actor| stats::daily_closing(c, actor, clock, &date)).await
}

#[tauri::command]
pub async fn audit_list(state: State<'_, AppState>, query: audit::AuditQuery) -> R<Page<audit::AuditRow>> {
    state.read(move |c, _, actor| audit::list(c, actor, &query)).await
}

// =============================================================================================
// Backup, restore, export, files

#[tauri::command]
pub async fn backup_now(state: State<'_, AppState>) -> R<backup::BackupResult> {
    state.actor()?.require(Permission::CreateBackup)?;
    let (db, clock, dir) = (state.db.clone(), state.clock.clone(), state.paths.default_backup_dir.clone());
    let result = blocking(move || backup::perform_backup(&db, &clock, &dir, BackupKind::Manual)).await?;
    state.dirty.store(false, Ordering::SeqCst);
    Ok(result)
}

#[tauri::command]
pub async fn backup_status(state: State<'_, AppState>) -> R<backup::BackupStatus> {
    state.actor()?;
    let default_dir = state.paths.default_backup_dir.clone();
    let (suggested, data_dir) = (state.paths.suggested_backup_dir.clone(), state.paths.data_dir.clone());
    let backup_on_other_drive = state.paths.backup_on_other_drive;
    let unsaved = state.dirty.load(Ordering::SeqCst);
    state
        .open(move |c, _| {
            let s = settings::load(c)?;
            let configured = s.backup.folder.clone().map(PathBuf::from);
            let folder_available = configured.as_ref().is_none_or(|f| std::fs::create_dir_all(f).is_ok());
            let folder = configured.filter(|_| folder_available).unwrap_or_else(|| default_dir.clone());
            // Backups on the same drive as the data are lost together with it: point to a second drive.
            let safer_folder = (backup_on_other_drive && drives::drive_of(&folder) == drives::drive_of(&data_dir))
                .then(|| suggested.to_string_lossy().into_owned());
            Ok(backup::BackupStatus {
                backups: backup::list_backups(&folder)?,
                folder: folder.to_string_lossy().into_owned(),
                folder_available,
                safer_folder,
                default_folder: default_dir.to_string_lossy().into_owned(),
                mirror_folder: s.backup.mirror_folder,
                auto_backup: s.backup.auto_backup,
                interval_hours: s.backup.interval_hours,
                keep_count: s.backup.keep_count,
                last_backup_at: s.system.last_backup_at,
                last_backup_path: s.system.last_backup_path,
                unsaved_changes: unsaved,
            })
        })
        .await
}

#[tauri::command]
pub async fn backup_inspect(state: State<'_, AppState>, path: String) -> R<backup::BackupCheck> {
    state.actor()?.require(Permission::RestoreBackup)?;
    let scratch = state.paths.data_dir.join("tmp");
    blocking(move || backup::inspect(Path::new(&path), &scratch)).await
}

/// Restores a backup: validate → safety backup → swap → rebuild. Everyone must log in again afterwards.
#[tauri::command]
pub async fn backup_restore(state: State<'_, AppState>, path: String) -> R<backup::BackupCheck> {
    let actor = state.actor()?;
    actor.require(Permission::RestoreBackup)?;
    let (db, clock) = (state.db.clone(), state.clock.clone());
    let (default_dir, db_path) = (state.paths.default_backup_dir.clone(), state.paths.db_path.clone());
    let check = blocking(move || {
        let source = PathBuf::from(&path);
        let (staging, check) = backup::stage_restore(&source, &db_path)?;
        let safety = backup::perform_backup(&db, &clock, &default_dir, BackupKind::Safety)?;
        db.replace(|live| backup::swap_in(&staging, live))?;
        db.with_conn(|c| {
            summary::refresh_all(c)?;
            audit::record(
                c,
                &actor,
                &clock,
                "backup.restore",
                None,
                None,
                format!(
                    "{} restored data from {} (previous data saved as {})",
                    actor.name,
                    source.file_name().and_then(|n| n.to_str()).unwrap_or("backup"),
                    safety.info.file_name
                ),
                None,
            )
        })?;
        Ok(check)
    })
    .await?;
    state.set_session(None);
    state.dirty.store(false, Ordering::SeqCst);
    Ok(check)
}

#[tauri::command]
pub async fn export_csv(state: State<'_, AppState>, request: export::ExportRequest) -> R<export::ExportResult> {
    state.read(move |c, clock, actor| export::export_csv(c, actor, clock, &request)).await
}

/// Opens one of the app's folders in Explorer.
#[tauri::command]
pub async fn open_folder(app: AppHandle, state: State<'_, AppState>, which: String) -> R<()> {
    let actor = state.actor()?;
    let path = match which.as_str() {
        "backups" => {
            let default_dir = state.paths.default_backup_dir.clone();
            state.open(move |c, _| Ok(settings::load(c)?.backup.folder.map(PathBuf::from).unwrap_or(default_dir))).await?
        }
        "data" => {
            actor.require(Permission::ManageSettings)?;
            state.paths.data_dir.clone()
        }
        "logs" => state.paths.log_dir.clone(),
        _ => return Err(CoreError::invalid("Unknown folder")),
    };
    std::fs::create_dir_all(&path)?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| CoreError::other(format!("Could not open the folder: {e}")))
}

/// Saves what is in the print view (a receipt, invoice, member cards or a report) as a PDF file.
#[tauri::command]
pub async fn save_pdf(window: WebviewWindow, state: State<'_, AppState>, path: String, paper: PdfPaper) -> R<()> {
    state.actor()?;
    let path = PathBuf::from(path);
    if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) {
        return Err(CoreError::invalid("Choose a file name ending in .pdf"));
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    pdf::save(&window, path, paper).await
}

/// Opens a PDF or CSV the app just saved, in the program Windows uses for it.
#[tauri::command]
pub async fn open_file(app: AppHandle, state: State<'_, AppState>, path: String) -> R<()> {
    state.actor()?;
    let p = PathBuf::from(&path);
    let allowed = p.extension().and_then(|e| e.to_str()).is_some_and(|e| ["pdf", "csv"].contains(&e.to_ascii_lowercase().as_str()));
    if !allowed || !p.is_file() {
        return Err(CoreError::invalid("File not found"));
    }
    app.opener().open_path(path, None::<&str>).map_err(|e| CoreError::other(format!("Could not open the file: {e}")))
}

/// Fee invoice for a member: unpaid charges plus the current membership's charges, with paid and due amounts.
#[tauri::command]
pub async fn billing_invoice(state: State<'_, AppState>, member_id: String) -> R<billing::FeeInvoice> {
    state.read(move |c, clock, _| billing::fee_invoice(c, clock, &member_id)).await
}

/// Opens Windows' camera privacy page (when Windows blocks desktop apps from using the webcam).
#[tauri::command]
pub fn open_camera_settings(app: AppHandle) -> R<()> {
    app.opener()
        .open_url("ms-settings:privacy-webcam", None::<&str>)
        .map_err(|e| CoreError::other(format!("Could not open Windows Settings: {e}")))
}

/// Shows a file (e.g. an export) selected in Explorer.
#[tauri::command]
pub async fn reveal_file(app: AppHandle, state: State<'_, AppState>, path: String) -> R<()> {
    state.actor()?;
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err(CoreError::invalid("File not found"));
    }
    app.opener().reveal_item_in_dir(p).map_err(|e| CoreError::other(format!("Could not show the file: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whatsapp_urls_are_encoded() {
        let url = whatsapp_url(WhatsappOpenWith::Desktop, "923001234567", "Salam *Ali*!\nRs 3,500 & 100%");
        assert_eq!(url, "whatsapp://send?phone=923001234567&text=Salam%20%2AAli%2A%21%0ARs%203%2C500%20%26%20100%25");
        assert!(whatsapp_url(WhatsappOpenWith::Wame, "92300", "hi").starts_with("https://wa.me/92300?text="));
        assert_eq!(encode_component("💪"), "%F0%9F%92%AA");
    }
}
